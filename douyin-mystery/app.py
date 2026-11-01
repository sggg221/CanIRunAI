import gzip
import hmac
import os
import re
import threading
import time
from collections import deque
from functools import wraps
from urllib.parse import urlsplit
from flask import Flask, jsonify, request, send_file
from mystery_hunter import MysteryHunter
from static import Live_pb2

app = Flask(__name__)
TOKEN = os.getenv("DASHBOARD_TOKEN", "").strip()
if len(TOKEN) < 16:
    raise RuntimeError("Set DASHBOARD_TOKEN (16+ chars) in Railway Variables")

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

def get_room(raw):
    raw = str(raw or "").strip()
    if re.fullmatch(r"\d{5,30}", raw):
        return raw
    if len(raw) > 300 or not raw.startswith(("https://", "http://")):
        return None
    parsed = urlsplit(raw)
    if parsed.hostname not in {"live.douyin.com", "www.douyin.com", "douyin.com"}:
        return None
    last = parsed.path.strip("/").split("/")[-1]
    return last if re.fullmatch(r"\d{5,30}", last) else None

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
    room = get_room((request.get_json(silent=True) or {}).get("room"))
    if not room:
        return jsonify(error="请输入有效数字房间号或 live.douyin.com 链接"), 400
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
