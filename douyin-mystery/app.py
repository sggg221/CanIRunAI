import gzip
import hmac
import os
import re
import threading
import time
from collections import deque
from functools import wraps
from urllib.parse import urlsplit, urljoin, parse_qs
import requests
from dy_apis.douyin_api import DouyinAPI
from flask import Flask, jsonify, request, send_file
from mystery_hunter import MysteryHunter
from static import Live_pb2

app = Flask(__name__)
TOKEN = os.getenv("DASHBOARD_TOKEN", "").strip()
if len(TOKEN) < 16:
    raise RuntimeError("Set DASHBOARD_TOKEN (16+ chars) in Render Variables")

lock = threading.RLock()
events = deque(maxlen=150)
state = dict(status="idle", room="", connected=False, error="", total=0, count=0, hunter=None)

def protected(func):
    @wraps(func)
    def check(*args, **kwargs):
        if not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return jsonify(error="访问口令错误"), 401
        return func(*args, **kwargs)
    return check

ALLOWED_HOSTS = {"v.douyin.com", "live.douyin.com", "www.douyin.com", "douyin.com"}
SHARE_LINK_RE = re.compile(r"https?://[^\s<>\"'，。]+", re.I)
SESSION_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"}


def room_from_url(url):
    """Accept only Douyin-controlled HTTPS links; never accept arbitrary redirect targets."""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        return None
    for key in ("room_id", "roomId", "web_rid", "webRid", "live_id"):
        for item in parse_qs(parsed.query).get(key, []):
            if re.fullmatch(r"\d{5,30}", item):
                return item
    parts = [p for p in parsed.path.split("/") if p]
    if not parts:
        return None
    last = parts[-1]
    if re.fullmatch(r"\d{5,30}", last):
        if parsed.hostname == "live.douyin.com" or (len(parts) > 1 and parts[-2] == "live"):
            return last
    return None


def get_room(raw):
    """Parse a numeric room, a Douyin live URL or a share message with a short link."""
    raw = str(raw or "").strip()
    if len(raw) > 2000:
        return None
    if re.fullmatch(r"\d{5,30}", raw):
        return raw
    match = SHARE_LINK_RE.search(raw)
    if not match:
        return None
    url = match.group(0).rstrip("!！?？,，.;；)]）")
    for _ in range(5):
        room = room_from_url(url)
        if room:
            return room
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            return None
        # Do not request arbitrary URLs. Redirects are followed only after host validation.
        with requests.get(url, headers=SESSION_HEADERS, timeout=(4, 9),
                          allow_redirects=False, stream=True) as response:
            redirect = response.headers.get("Location", "")
            if redirect:
                url = urljoin(url, redirect)
                continue
            if parsed.hostname == "live.douyin.com" and response.ok:
                html = response.raw.read(550000).decode("utf-8", errors="ignore").replace("\\", "")
                matched = re.search(r'"roomId"\s*:\s*"?(\d{5,30})', html)
                if matched:
                    return matched.group(1)
        return None
    return None


def _public_live_info(auth, live_id):
    """The upstream stand-alone hunter passes auth=None, which its newer API rejects.
    Read the publicly accessible live page without a cookie instead.
    """
    result = requests.get("https://live.douyin.com/" + str(live_id),
                          headers=SESSION_HEADERS, timeout=(4, 12))
    result.raise_for_status()
    html = result.text.replace("\\", "")
    room_match = re.search(r'"roomId"\s*:\s*"?(\d{5,30})', html)
    user_match = re.search(r'"user_unique_id"\s*:\s*"?(\d{5,30})', html)
    if not room_match or not user_match:
        return None
    return {"room_id": room_match.group(1), "user_id": user_match.group(1)}


# Correct the upstream hunter's auth=None invocation without changing its WebSocket machinery.
DouyinAPI.get_live_info = staticmethod(_public_live_info)

def limited(value, max_length=180):
    return str(value or "").strip()[:max_length]

class Observer(MysteryHunter):
    def __init__(self, room):
        super().__init__(room, verbose=False)
        self.opened = False

    def on_open(self, ws):
        self.opened = True
        with lock:
            if state["hunter"] is self:
                state.update(status="listening", connected=True, error="")

    def on_error(self, ws, error):
        with lock:
            if state["hunter"] is self:
                state["error"] = limited(error, 200)

    def on_close(self, ws, code, reason):
        with lock:
            if state["hunter"] is self:
                state.update(status="stopped", connected=False, error="连接已关闭")

    def on_message(self, ws, payload):
        try:
            frame = Live_pb2.PushFrame()
            frame.ParseFromString(payload)
            data = Live_pb2.LiveResponse()
            data.ParseFromString(gzip.decompress(frame.payload))
            classes = {
                "WebcastMemberMessage": ("进场", Live_pb2.MemberMessage),
                "WebcastChatMessage": ("发言", Live_pb2.ChatMessage),
                "WebcastGiftMessage": ("送礼", Live_pb2.GiftMessage),
            }
            for item in data.messagesList:
                if item.method not in classes:
                    continue
                action, message_class = classes[item.method]
                msg = message_class()
                msg.ParseFromString(item.payload)
                user = msg.user
                with lock:
                    if state["hunter"] is not self:
                        return
                    if action == "进场":
                        state["total"] += 1
                if not (user.mystery_man or user.is_anonymous):
                    continue
                record = dict(
                    at=int(time.time()), action=action,
                    display=limited(user.desensitized_nickname, 80) or "神秘人",
                    nickname=limited(user.nickname, 80),
                    sec_uid=limited(user.sec_uid),
                    level=int(user.consume_diamond_level or 0),
                )
                with lock:
                    if state["hunter"] is self:
                        events.appendleft(record)
                        state["count"] += 1
        except Exception:
            # Platform message format can change; do not log raw user payloads.
            return

def run(hunter):
    try:
        hunter.connect()
    except Exception as error:
        with lock:
            if state["hunter"] is hunter:
                state["error"] = "启动失败：" + limited(error)
    finally:
        with lock:
            if state["hunter"] is hunter:
                state.update(status="stopped", connected=False)
                if not hunter.opened and not state["error"]:
                    state["error"] = "无法连接。请确认正在直播且上游接口可用。"

@app.get("/")
def index():
    return send_file("index.html")

@app.get("/healthz")
def health():
    return jsonify(ok=True)

@app.get("/api/default-room")
def default_room():
    return jsonify(room=os.getenv("ROOM_SHARE_DEFAULT", ""))

@app.get("/api/status")
@protected
def status():
    with lock:
        return jsonify(status=state["status"], room=state["room"],
            connected=state["connected"], error=state["error"],
            total=state["total"], count=state["count"], events=list(events))

@app.post("/api/start")
@protected
def start():
    try:
        room = get_room((request.get_json(silent=True) or {}).get("room"))
    except requests.RequestException:
        return jsonify(error="抖音分享链接暂时无法解析。可打开直播的网页版并复制 live.douyin.com/数字房间号"), 502
    if not room:
        return jsonify(error="未解析出房间号。请尝试粘贴网页版直播地址 live.douyin.com/数字房间号"), 400
    with lock:
        if state["status"] in {"starting", "listening"}:
            return jsonify(error="已有监听任务，请先停止"), 409
        hunter = Observer(room)
        events.clear()
        state.update(status="starting", room=room, connected=False, error="",
                     count=0, total=0, hunter=hunter)
    threading.Thread(target=run, args=(hunter,), daemon=True).start()
    return jsonify(ok=True)

@app.post("/api/stop")
@protected
def stop():
    with lock:
        hunter = state["hunter"]
        state.update(hunter=None, status="stopped", connected=False, error="")
    if hunter and hunter.ws:
        try:
            hunter.ws.close()
        except Exception:
            pass
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")))
