"""音浪监控：轻量本地工作台。无抖音私有协议实现；依赖合法可用的采集上游。"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager, contextmanager, closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('DB_PATH', BASE / 'data' / 'yinlang.db'))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
TZ = ZoneInfo(os.environ.get('REPORT_TZ', 'Asia/Shanghai'))
INGEST_KEY = os.environ.get('INGEST_KEY', '')
DYHUB_URL = os.environ.get('DYHUB_URL', '').rstrip('/')
DYHUB_INTERVAL = max(20, int(os.environ.get('DYHUB_POLL_SECONDS', '60')))
DYHUB_ACCOUNT_ID = os.environ.get('DYHUB_ACCOUNT_ID', '')
state = {'upstream': '未配置', 'last_sync': None, 'error': None}
write_lock = threading.RLock()


def now_ms():
    return int(time.time() * 1000)


def db():
    c = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=10000')
    return c


@contextmanager
def transaction():
    with write_lock:
        con = db()
        try:
            con.execute('BEGIN IMMEDIATE')
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()


def initialize():
    with closing(db()) as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS streamers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            live_id TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'unknown',
            last_seen_ms INTEGER,
            created_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            streamer_id INTEGER NOT NULL REFERENCES streamers(id),
            source_key TEXT NOT NULL,
            source TEXT NOT NULL,
            started_ms INTEGER NOT NULL,
            ended_ms INTEGER,
            status TEXT NOT NULL DEFAULT 'live',
            reported_diamonds INTEGER,
            reported_unknown_qty INTEGER,
            updated_ms INTEGER NOT NULL,
            UNIQUE(streamer_id, source_key)
        );
        CREATE TABLE IF NOT EXISTS processed_events (
            streamer_id INTEGER NOT NULL,
            event_id TEXT NOT NULL,
            processed_ms INTEGER NOT NULL,
            PRIMARY KEY(streamer_id, event_id)
        );
        CREATE TABLE IF NOT EXISTS gift_groups (
            session_id INTEGER NOT NULL,
            group_key TEXT NOT NULL,
            highwater INTEGER NOT NULL,
            PRIMARY KEY(session_id, group_key)
        );
        CREATE TABLE IF NOT EXISTS gift_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            streamer_id INTEGER NOT NULL REFERENCES streamers(id),
            event_id TEXT NOT NULL,
            gift_id TEXT NOT NULL,
            gift_name TEXT NOT NULL,
            sender_id TEXT,
            sender_name TEXT,
            count_delta INTEGER NOT NULL,
            unit_diamonds INTEGER,
            total_diamonds INTEGER,
            occurred_ms INTEGER NOT NULL,
            UNIQUE(streamer_id, event_id)
        );
        CREATE TABLE IF NOT EXISTS gift_catalog (
            gift_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            last_unit_diamonds INTEGER NOT NULL,
            last_seen_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS value_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            at_ms INTEGER NOT NULL,
            amount_delta INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_streamer ON sessions(streamer_id, started_ms);
        CREATE INDEX IF NOT EXISTS idx_gifts_streamer_time ON gift_events(streamer_id, occurred_ms);
        CREATE INDEX IF NOT EXISTS idx_samples_time ON value_samples(at_ms);
        ''')
        c.commit()


def parse_live_id(s: str) -> str:
    s = s.strip()
    m = re.fullmatch(r'(?:https?://)?live\.douyin\.com/(\d+)(?:[/?#].*)?', s, re.I)
    if m:
        return m.group(1)
    if re.fullmatch(r'\d{3,30}', s):
        return s
    raise HTTPException(422, '请填写 live.douyin.com/数字 直播间链接或数字直播间号')


def as_int(v, default=0):
    try:
        return int(v)
    except (ValueError, TypeError):
        return default


def active_session(con, streamer_id):
    return con.execute('SELECT * FROM sessions WHERE streamer_id=? AND status=? ORDER BY started_ms DESC, id DESC LIMIT 1', (streamer_id, 'live')).fetchone()


def open_session(con, streamer_id, source, source_key=None, started_ms=None):
    current = active_session(con, streamer_id)
    if current and (source_key is None or current['source_key'] == source_key):
        return current['id']
    if current:
        con.execute('UPDATE sessions SET status=?,ended_ms=?,updated_ms=? WHERE id=?', ('ended', now_ms(), now_ms(), current['id']))
    ts = started_ms or now_ms()
    key = source_key or ('manual:' + secrets.token_hex(8))
    con.execute('INSERT OR IGNORE INTO sessions (streamer_id,source_key,source,started_ms,updated_ms) VALUES (?,?,?,?,?)', (streamer_id,key,source,ts,now_ms()))
    sess = con.execute('SELECT id FROM sessions WHERE streamer_id=? AND source_key=?', (streamer_id,key)).fetchone()
    con.execute('UPDATE sessions SET status=?, ended_ms=NULL, updated_ms=? WHERE id=?', ('live',now_ms(),sess['id']))
    con.execute('UPDATE streamers SET status=?,last_seen_ms=? WHERE id=?', ('live',now_ms(),streamer_id))
    return sess['id']


def stop_active(con, streamer_id, ended_ms=None):
    sess = active_session(con, streamer_id)
    if sess:
        con.execute('UPDATE sessions SET status=?,ended_ms=?,updated_ms=? WHERE id=?', ('ended',ended_ms or now_ms(),now_ms(),sess['id']))
    con.execute('UPDATE streamers SET status=?,last_seen_ms=? WHERE id=?', ('offline',now_ms(),streamer_id))


def get_streamer(con, streamer_id):
    s = con.execute('SELECT * FROM streamers WHERE id=?', (streamer_id,)).fetchone()
    if not s:
        raise HTTPException(404,'没有找到主播')
    return s


class AddStreamer(BaseModel):
    name: str = Field(min_length=1,max_length=50)
    room: str = Field(min_length=3,max_length=300)

class StatusPayload(BaseModel):
    live_id: str
    live: bool
    source_key: Optional[str] = None
    started_ms: Optional[int] = None

class GiftPayload(BaseModel):
    live_id: str
    event_id: str = Field(min_length=1,max_length=160)
    gift_id: str = Field(min_length=1,max_length=128)
    gift_name: str = Field(min_length=1,max_length=128)
    sender_id: Optional[str] = None
    sender_name: Optional[str] = None
    recipient_id: Optional[str] = None
    group_id: Optional[str] = None
    quantity: int = Field(ge=1,le=10000000)
    cumulative: bool = False
    unit_diamonds: Optional[int] = Field(default=None,ge=0,le=1000000000)
    occurred_ms: Optional[int] = None


def require_ingest(token):
    if not INGEST_KEY or not secrets.compare_digest(token or '', INGEST_KEY):
        raise HTTPException(403, '未配置或未提供采集密钥 INGEST_KEY')


def current_rows(con, today_start=None, month_start=None):
    out=[]
    rows=con.execute('SELECT * FROM streamers ORDER BY created_ms DESC').fetchall()
    for r in rows:
        a = con.execute('''SELECT s.*,
               COALESCE(s.reported_diamonds, (SELECT COALESCE(SUM(total_diamonds),0) FROM gift_events g WHERE g.session_id=s.id)) AS value,
               COALESCE(s.reported_unknown_qty, (SELECT COALESCE(SUM(count_delta),0) FROM gift_events g WHERE g.session_id=s.id AND unit_diamonds IS NULL)) AS unknown_qty
               FROM sessions s WHERE s.streamer_id=? ORDER BY s.started_ms DESC LIMIT 1''',(r['id'],)).fetchone()
        out.append({**dict(r),'latest_session':dict(a) if a else None})
    return out


def session_rows(con, limit=60):
    return [dict(x) for x in con.execute('''SELECT s.id, s.streamer_id, s.source, s.started_ms, s.ended_ms, s.status, st.name,
          COALESCE(s.reported_diamonds,(SELECT COALESCE(SUM(total_diamonds),0) FROM gift_events g WHERE g.session_id=s.id)) AS value,
          COALESCE(s.reported_unknown_qty,(SELECT COALESCE(SUM(count_delta),0) FROM gift_events g WHERE g.session_id=s.id AND g.unit_diamonds IS NULL)) AS unknown_qty
          FROM sessions s JOIN streamers st ON st.id=s.streamer_id ORDER BY s.started_ms DESC LIMIT ?''',(limit,)).fetchall()]


def summary():
    t = datetime.now(TZ)
    start_day = int(t.replace(hour=0,minute=0,second=0,microsecond=0).timestamp()*1000)
    start_month = int(t.replace(day=1,hour=0,minute=0,second=0,microsecond=0).timestamp()*1000)
    with closing(db()) as con:
        sessions = session_rows(con,100000)
        # 实时礼物事件按照发生时间归属，不能按场次开播日算（跨午夜场次）。
        counts = con.execute('''SELECT
           SUM(CASE WHEN occurred_ms >= ? THEN COALESCE(total_diamonds,0) ELSE 0 END) AS today,
           SUM(CASE WHEN occurred_ms >= ? THEN COALESCE(total_diamonds,0) ELSE 0 END) AS month,
           SUM(CASE WHEN occurred_ms >= ? AND unit_diamonds IS NULL THEN count_delta ELSE 0 END) AS unknown_today
           FROM gift_events''',(start_day,start_month,start_day)).fetchone()
        totals = {'today':counts['today'] or 0,'month':counts['month'] or 0,'unknown_today':counts['unknown_today'] or 0,
                  'streamers':con.execute('SELECT COUNT(*) FROM streamers').fetchone()[0],
                  'live':con.execute("SELECT COUNT(*) FROM streamers WHERE status='live'").fetchone()[0]}
        buckets=[0]*24
        for r in con.execute('''SELECT occurred_ms,total_diamonds FROM gift_events
             WHERE occurred_ms >= ? AND total_diamonds IS NOT NULL''',(start_day,)):
            h=datetime.fromtimestamp(r['occurred_ms']/1000,TZ).hour
            buckets[h]+=r['total_diamonds']
        trend=[]; value=0
        for i,delta in enumerate(buckets):
            value+=delta
            trend.append({'hour':f'{i:02d}:00','value':value})
        return {'totals':totals,'streamers':current_rows(con),'sessions':sessions[:15], 'trend':trend,
                'upstream':dict(state),'timezone':str(TZ),'basis':'采集到的礼物钻石价值（非官方结算音浪）'}


def dyhub_request(path, method='GET', body=None):
    data=json.dumps(body).encode('utf-8') if body is not None else None
    headers={'Accept':'application/json','User-Agent':'YinlangMonitor/1.0'}
    if body is not None:
        headers['Content-Type']='application/json'
    req=urllib.request.Request(DYHUB_URL+path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=8) as response:
        return json.loads(response.read().decode('utf-8'))


def receive_event(event):
    if not isinstance(event,dict) or event.get('type') in ('__hello',None):
        return
    live_id=str(event.get('roomId') or '')
    if not re.fullmatch(r'\d{3,30}',live_id):
        return
    with closing(db()) as con:
        r=con.execute('SELECT id,enabled FROM streamers WHERE live_id=?',(live_id,)).fetchone()
    if r is None or not r['enabled']:
        return
    typ=event.get('type')
    if typ=='roomStatus':
        status=(event.get('data') or {}).get('status')
        if status=='live':
            with transaction() as con:open_session(con,r['id'],'dyhub')
        elif status=='closed':
            with transaction() as con:stop_active(con,r['id'])
        return
    if typ != 'gift':
        return
    d=event.get('data') or {}
    u=event.get('user') or {}
    group=str(d.get('groupId') or d.get('traceId') or '')
    price=d.get('diamondCount')
    # groupCount 是每次送出件数；连送 repeatCount 是累计点击次数。
    pack_count=max(1,as_int(d.get('groupCount'),1))
    raw_quantity=(max(1,as_int(d.get('repeatCount') or d.get('comboCount'),1))*pack_count) if group else pack_count
    try:
        quantity=max(1,int(raw_quantity))
        unit=None if price is None else int(price)
        if unit is not None and unit<0:unit=None
        gift=GiftPayload(live_id=live_id,event_id=str(event.get('id') or secrets.token_hex(12)),
             gift_id=str(d.get('giftId') or d.get('giftName') or 'unknown'),
             gift_name=str(d.get('giftName') or '未知礼物'),
             sender_id=str(u.get('id') or ''),sender_name=str(u.get('nickname') or ''),
             group_id=group or None,quantity=quantity,cumulative=bool(group),unit_diamonds=unit,
             occurred_ms=as_int(event.get('ts'),now_ms()))
        persist_gift(gift)
    except (ValueError,TypeError,HTTPException):
        return


def sync_rooms():
    with closing(db()) as con:
        targets=[dict(r) for r in con.execute('SELECT * FROM streamers WHERE enabled=1').fetchall()]
    rooms=dyhub_request('/api/rooms').get('rooms',[])
    room_map={str(r.get('roomId')):r for r in rooms}
    good=0; problems=[]
    for r in targets:
        rid=r['live_id']
        try:
            info=room_map.get(rid)
            upstream_status=(info or {}).get('status')
            if upstream_status in (None,'stopped','error','closed'):
                body={'roomId':rid}
                if DYHUB_ACCOUNT_ID:body['accountId']=DYHUB_ACCOUNT_ID
                info=(dyhub_request('/api/rooms/connect',method='POST',body=body) or {}).get('room',{})
                upstream_status=info.get('status')
            if upstream_status=='live':
                with transaction() as con:open_session(con,r['id'],'dyhub')
            elif upstream_status=='closed':
                with transaction() as con:stop_active(con,r['id'])
            good+=1
        except (urllib.error.URLError,urllib.error.HTTPError,ValueError,OSError) as e:
            problems.append(f"{r['name']}: {str(e)[:70]}")
    state.update(upstream=f'已连接 DyHub · {good}/{len(targets)} 个直播间',last_sync=now_ms(),
                 error='；'.join(problems) if problems else None)


def poll_worker(stop_event):
    if not DYHUB_URL:
        state.update(upstream='未连接采集服务',error='请配置 DYHUB_URL，然后启动 DyHub')
        return
    while not stop_event.is_set():
        try:sync_rooms()
        except Exception as exc:state.update(upstream='采集连接异常',error=str(exc)[:200])
        stop_event.wait(DYHUB_INTERVAL)


def stream_worker(stop_event):
    if not DYHUB_URL:return
    from websockets.sync.client import connect
    from urllib.parse import urlsplit
    p=urlsplit(DYHUB_URL)
    scheme='wss' if p.scheme=='https' else 'ws'
    url=f'{scheme}://{p.netloc}/ws?types=gift,roomStatus'
    while not stop_event.is_set():
        try:
            with connect(url,open_timeout=8,close_timeout=2,ping_interval=20) as ws:
                state['events']='实时连接正常'
                while not stop_event.is_set():
                    try:raw=ws.recv(timeout=5)
                    except TimeoutError:continue
                    receive_event(json.loads(raw))
        except Exception as e:
            state['events']='连接中断：'+str(e)[:90]
            stop_event.wait(5)


@asynccontextmanager
async def lifespan(app):
    initialize()
    ev=threading.Event()
    threads=[threading.Thread(target=fn,args=(ev,),daemon=True) for fn in (poll_worker,stream_worker)]
    for th in threads:th.start()
    yield
    ev.set()
    for th in threads:th.join(timeout=2)

app=FastAPI(title='音浪监控 API',docs_url='/docs',lifespan=lifespan)

# Public Render deployments must be access-controlled; HTTP Basic auth applies to both
# the dashboard and its JSON APIs. INGEST_KEY is still required for external ingestion.
ADMIN_USER = os.environ.get('ADMIN_USER', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')

@app.middleware('http')
async def protect_dashboard(request: Request, call_next):
    if request.url.path == '/healthz':
        return await call_next(request)
    if not ADMIN_PASSWORD:
        return await call_next(request)  # local development only; not for public services
    import base64
    auth = request.headers.get('Authorization', '')
    valid = False
    if auth.startswith('Basic '):
        try:
            text = base64.b64decode(auth[6:], validate=True).decode('utf-8')
            username, password = text.split(':', 1)
            valid = (secrets.compare_digest(username, ADMIN_USER) and
                     secrets.compare_digest(password, ADMIN_PASSWORD))
        except (UnicodeDecodeError, ValueError):
            pass
    if not valid:
        return Response('需要登录后访问音浪监控', status_code=401,
                        headers={'WWW-Authenticate': 'Basic realm="Yinlang Monitor"'})
    return await call_next(request)

@app.get('/healthz')
def healthz():
    return {'ok': True, 'data_source_configured': bool(DYHUB_URL)}


@app.get('/')
def home():
    return FileResponse(BASE/'static'/'index.html')

@app.get('/static/{name}')
def static(name:str):
    if name not in {'style.css','app.js'}:
        raise HTTPException(404)
    content={'style.css':'text/css','app.js':'application/javascript'}[name]
    return FileResponse(BASE/'static'/name,media_type=content)

@app.get('/api/dashboard')
def dashboard():
    return summary()

@app.post('/api/streamers',status_code=201)
def add_streamer(s: AddStreamer):
    live_id=parse_live_id(s.room)
    with transaction() as con:
        try:
            cur=con.execute('INSERT INTO streamers (name,live_id,created_ms) VALUES (?,?,?)',(s.name.strip(),live_id,now_ms()))
        except sqlite3.IntegrityError:
            raise HTTPException(409,'这个直播间已添加')
        return {'id':cur.lastrowid,'name':s.name,'live_id':live_id}

@app.patch('/api/streamers/{streamer_id}')
def set_streamer(streamer_id:int, request_body: dict):
    if set(request_body)-{'enabled','name'}:
        raise HTTPException(422,'只支持 enabled 和 name')
    with transaction() as con:
        get_streamer(con,streamer_id)
        if 'enabled' in request_body:
            enabled=int(bool(request_body['enabled']))
            con.execute('UPDATE streamers SET enabled=? WHERE id=?',(enabled,streamer_id))
        if 'name' in request_body:
            n=str(request_body['name']).strip()
            if not n or len(n)>50:raise HTTPException(422,'昵称长度不正确')
            con.execute('UPDATE streamers SET name=? WHERE id=?',(n,streamer_id))
        return {'ok':True}

@app.post('/api/streamers/{streamer_id}/manual-start')
def manual_start(streamer_id:int):
    with transaction() as con:
        get_streamer(con,streamer_id)
        sess=open_session(con,streamer_id,'manual')
        return {'ok':True,'session_id':sess,'note':'手动标记开播；礼物需要采集源推送才会累计'}

@app.post('/api/streamers/{streamer_id}/manual-stop')
def manual_stop(streamer_id:int):
    with transaction() as con:
        get_streamer(con,streamer_id)
        stop_active(con,streamer_id)
        return {'ok':True}

@app.post('/api/ingest/status')
def ingest_status(body:StatusPayload,x_ingest_key:Optional[str]=Header(None)):
    require_ingest(x_ingest_key)
    live_id=parse_live_id(body.live_id)
    with transaction() as con:
        st=con.execute('SELECT * FROM streamers WHERE live_id=?',(live_id,)).fetchone()
        if not st:raise HTTPException(404,'请先添加主播')
        if body.live:
            sid=open_session(con,st['id'],'webhook',body.source_key,body.started_ms)
            return {'ok':True,'session_id':sid}
        stop_active(con,st['id']);return {'ok':True}

@app.post('/api/ingest/gift')
def ingest_gift(body:GiftPayload,x_ingest_key:Optional[str]=Header(None)):
    require_ingest(x_ingest_key)
    return persist_gift(body)


def persist_gift(body:GiftPayload):
    live_id=parse_live_id(body.live_id)
    if body.cumulative and not body.group_id:
        raise HTTPException(422,'连送累计消息需提供 group_id，避免错计')
    ts=body.occurred_ms or now_ms()
    if ts<0 or ts>now_ms()+3600000:
        raise HTTPException(422,'礼物时间戳不合理')
    with transaction() as con:
        st=con.execute('SELECT * FROM streamers WHERE live_id=?',(live_id,)).fetchone()
        if not st:raise HTTPException(404,'请先添加主播')
        if con.execute('SELECT 1 FROM processed_events WHERE streamer_id=? AND event_id=?',(st['id'],body.event_id)).fetchone():
            return {'ok':True,'duplicate':True,'delta_qty':0,'value':0}
        sid=open_session(con,st['id'],'webhook')
        con.execute('INSERT INTO processed_events (streamer_id,event_id,processed_ms) VALUES (?,?,?)',(st['id'],body.event_id,now_ms()))
        qty=body.quantity
        if body.cumulative:
            group=json.dumps([live_id,body.sender_id,body.recipient_id,body.gift_id,body.group_id],ensure_ascii=False)
            old=con.execute('SELECT highwater FROM gift_groups WHERE session_id=? AND group_key=?',(sid,group)).fetchone()
            old_qty=old['highwater'] if old else 0
            qty=max(0,body.quantity-old_qty)
            if body.quantity>old_qty:
                con.execute('INSERT INTO gift_groups (session_id,group_key,highwater) VALUES (?,?,?) ON CONFLICT(session_id,group_key) DO UPDATE SET highwater=excluded.highwater',(sid,group,body.quantity))
        if body.unit_diamonds is not None:
            con.execute('INSERT INTO gift_catalog (gift_id,name,last_unit_diamonds,last_seen_ms) VALUES (?,?,?,?) ON CONFLICT(gift_id) DO UPDATE SET name=excluded.name,last_unit_diamonds=excluded.last_unit_diamonds,last_seen_ms=excluded.last_seen_ms', (body.gift_id,body.gift_name,body.unit_diamonds,ts))
        if qty:
            value=qty*body.unit_diamonds if body.unit_diamonds is not None else None
            con.execute('INSERT INTO gift_events (session_id,streamer_id,event_id,gift_id,gift_name,sender_id,sender_name,count_delta,unit_diamonds,total_diamonds,occurred_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)',(sid,st['id'],body.event_id,body.gift_id,body.gift_name,body.sender_id,body.sender_name,qty,body.unit_diamonds,value,ts))
        else:
            value=0
        return {'ok':True,'duplicate':False,'delta_qty':qty,'value':value, 'price_status':'known' if body.unit_diamonds is not None else 'unknown'}

@app.get('/api/gifts')
def gifts(streamer_id:Optional[int]=None,limit:int=Query(100,ge=1,le=500)):
    with closing(db()) as con:
        if streamer_id:
            rows=con.execute('SELECT * FROM gift_events WHERE streamer_id=? ORDER BY occurred_ms DESC LIMIT ?',(streamer_id,limit)).fetchall()
        else:
            rows=con.execute('SELECT * FROM gift_events ORDER BY occurred_ms DESC LIMIT ?',(limit,)).fetchall()
        return [dict(x) for x in rows]

@app.get('/api/prices')
def prices():
    with closing(db()) as con:
        return [dict(x) for x in con.execute('SELECT * FROM gift_catalog ORDER BY last_seen_ms DESC LIMIT 1000').fetchall()]

@app.get('/api/export.csv')
def export():
    with closing(db()) as con:
        rows=session_rows(con,100000)
    f=io.StringIO()
    w=csv.writer(f)
    w.writerow(['主播','场次ID','开始时间(北京时间)','结束时间(北京时间)','记录钻石','未定价件数','采集来源','状态'])
    for x in rows:
        d=lambda ts:datetime.fromtimestamp(ts/1000,TZ).strftime('%Y-%m-%d %H:%M:%S') if ts else ''
        w.writerow([x['name'],x['id'],d(x['started_ms']),d(x['ended_ms']),x['value'],x['unknown_qty'],x['source'],x['status']])
    return Response('\ufeff'+f.getvalue(),media_type='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename="yinlang-sessions.csv"'})

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host=os.environ.get('HOST','127.0.0.1'),port=int(os.environ.get('PORT','8088')))