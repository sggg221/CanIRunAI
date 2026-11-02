import gzip
import hmac
import os
import re
import threading
import time
from collections import deque
from functools import wraps
from urllib.parse import urlsplit, urljoin, parse_qs, urlencode
from websocket import WebSocketApp
from builder.header import HeaderBuilder
from utils.dy_util import generate_signature
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

# Restrict network requests to Douyin-operated domains.
# Mobile share links normally redirect via webcast.amemv.com/douyin/webcast/reflow/<room_id>.
ALLOWED_HOSTS = {
    "v.douyin.com", "live.douyin.com", "www.douyin.com", "douyin.com",
    "webcast.amemv.com", "www.iesdouyin.com", "iesdouyin.com"
}
SHARE_LINK_RE = re.compile(r"https?://[^\s<>\"'，。]+", re.I)
SESSION_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.douyin.com/"
}
OWNER_SHORT_ID = re.compile(r'"owner"\s*:\s*\{[^{}]{0,5000}?"shortId"\s*:\s*"?(\d{5,30})', re.S)
ROOM_PATH = re.compile(r"/douyin/webcast/reflow/(\d{5,30})(?:/|$)")
WEBRID_IN_HTML = re.compile(r'"web_rid"\s*:\s*"?(\d{5,30})', re.I)


def _safe_url(url):
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS and parsed.port in (None, 443)


def _room_from_url(url):
    parsed = urlsplit(url)
    if not _safe_url(url):
        return None
    params = parse_qs(parsed.query)
    # A browser live link has an account-stable web_rid.
    for key in ("web_rid", "webRid"):
        for value in params.get(key, []):
            if re.fullmatch(r"\d{5,30}", value):
                return value
    parts = [p for p in parsed.path.split("/") if p]
    if parsed.hostname == "live.douyin.com" and len(parts) == 1:
        if re.fullmatch(r"\d{5,30}", parts[0]):
            return parts[0]
    # Do not treat reflow/<roomId> as web_rid; that is an event-specific room ID.
    return None


def get_room(raw):
    """Resolve share text or Douyin short link to a stable live.douyin.com web_rid."""
    raw = str(raw or "").strip()
    if len(raw) > 2500:
        return None
    if re.fullmatch(r"\d{5,30}", raw):
        return raw
    match = SHARE_LINK_RE.search(raw)
    if not match:
        return None
    url = match.group(0).rstrip("!！?？,，.;；)]）")
    if not _safe_url(url):
        return None
    saw_reflow = False
    for hop in range(8):
        account_id = _room_from_url(url)
        if account_id:
            return account_id
        if not _safe_url(url):
            return None
        parsed = urlsplit(url)
        if ROOM_PATH.search(parsed.path) and parsed.hostname == "webcast.amemv.com":
            saw_reflow = True
        with requests.get(url, headers=SESSION_HEADERS, timeout=(4, 10),
                          allow_redirects=False, stream=True) as response:
            redirect = response.headers.get("Location")
            if redirect:
                candidate = urljoin(url, redirect)
                if not _safe_url(candidate):
                    return None
                url = candidate
                continue
            response.raw.decode_content = True
            body = response.raw.read(2097152).decode("utf-8", errors="replace")
            if saw_reflow or parsed.hostname == "live.douyin.com":
                # Douyin embeds JSON in both escaped and unescaped form.
                normalized = body.replace("\\", "")
                owner = OWNER_SHORT_ID.search(normalized)
                if owner:
                    return owner.group(1)
                stable = WEBRID_IN_HTML.search(normalized)
                if stable:
                    return stable.group(1)
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
    return {"room_id": room_match.group(1), "user_id": user_match.group(1), "ttwid": result.cookies.get("ttwid", "")}


# Correct the upstream hunter's auth=None invocation without changing its WebSocket machinery.
DouyinAPI.get_live_info = staticmethod(_public_live_info)

def limited(value, max_length=180):
    return str(value or "").strip()[:max_length]

def _connect_live(self):
    info = DouyinAPI.get_live_info(None, self.live_id)
    if not isinstance(info, dict) or not info.get("room_id"):
        raise RuntimeError("public_room_metadata_unavailable")
    room_id = info["room_id"]
    user_id = info["user_id"]
    params = {
        "app_name": "douyin_web",
        "version_code": "180800",
        "webcast_sdk_version": "1.0.15",
        "update_version_code": "1.0.15",
        "compress": "gzip",
        "device_platform": "web",
        "cookie_enabled": "true",
        "screen_width": "1707",
        "screen_height": "960",
        "browser_language": "zh-CN",
        "browser_platform": "Win32",
        "browser_name": "Mozilla",
        "browser_version": HeaderBuilder.ua.split("Mozilla/")[-1],
        "browser_online": "true",
        "tz_name": "Asia/Shanghai",
        "cursor": "-1",
        "host": "https://live.douyin.com",
        "aid": "6383",
        "live_id": "1",
        "did_rule": "3",
        "endpoint": "live_pc",
        "support_wrds": "1",
        "user_unique_id": user_id,
        "im_path": "/webcast/im/fetch/",
        "identity": "audience",
        "need_persist_msg_count": "15",
        "insert_task_id": "",
        "live_reason": "",
        "room_id": room_id,
        "heartbeatDuration": "0",
        "signature": generate_signature(room_id, user_id),
    }
    endpoint = "wss://webcast5-ws-web-lq.douyin.com/webcast/im/push/v2/?"
    headers = ["User-Agent: " + SESSION_HEADERS["User-Agent"]]
    if info.get("ttwid"):
        headers.append("Cookie: ttwid=" + info["ttwid"])
    self.ws = WebSocketApp(
        endpoint + urlencode(params),
        header=headers,
        on_open=self.on_open,
        on_message=self.on_message,
        on_error=self.on_error,
        on_close=self.on_close,
    )
    self.ws.run_forever(origin="https://live.douyin.com")



class Observer(MysteryHunter):
    def __init__(self, room):
        super().__init__(room, verbose=False)
        self.opened = False
        self.ack_count = 0
        self.frame_count = 0
        self._heartbeat_stop = threading.Event()
        self._connected_since = 0.0

    def connect(self):
        self._heartbeat_stop.clear()
        return _connect_live(self)

    def _heartbeat(self, ws):
        # Douyin expects binary PushFrame heartbeat packets, not just RFC 6455 pings.
        while not self._heartbeat_stop.is_set():
            try:
                frame = Live_pb2.PushFrame()
                frame.payloadType = "hb"
                ws.send(frame.SerializeToString(), opcode=0x02)
            except Exception:
                break
            if self._heartbeat_stop.wait(10):
                break

    def on_open(self, ws):
        self.opened = True
        self._connected_since = time.monotonic()
        app.logger.info("live-ws opened")
        with lock:
            if state["hunter"] is not self:
                ws.close()
                return
            state.update(status="listening", connected=True, error="")
        threading.Thread(target=self._heartbeat, args=(ws,), daemon=True).start()

    def on_error(self, ws, error):
        # WebSocket exception strings may include signed URLs: never show them to clients.
        with lock:
            if state["hunter"] is self:
                state["error"] = "直播连接异常：" + type(error).__name__

    def on_close(self, ws, code, reason):
        self._heartbeat_stop.set()
        elapsed = max(0.0, time.monotonic() - self._connected_since) if self._connected_since else 0.0
        app.logger.warning("live-ws closed code=%s duration_s=%.1f frames=%s acks=%s",
                           code if isinstance(code, int) else "none",
                           elapsed, self.frame_count, self.ack_count)
        with lock:
            if state["hunter"] is self:
                code_text = str(code) if isinstance(code, int) else "未知"
                state.update(status="reconnecting", connected=False,
                             error="直播连接中断（代码 " + code_text + "），准备重连")

    def on_message(self, ws, payload):
        try:
            frame = Live_pb2.PushFrame()
            frame.ParseFromString(payload)
            data = Live_pb2.LiveResponse()
            data.ParseFromString(gzip.decompress(frame.payload))
            self.frame_count += 1
            # Douyin requires application-level acknowledgments for selected frames.
            # Missing this ACK commonly leads to a disconnection after a few seconds.
            if data.needAck:
                ack = Live_pb2.PushFrame()
                ack.payloadType = "ack"
                ack.payload = data.internalExt.encode("utf-8")
                ack.logId = frame.logId
                ws.send(ack.SerializeToString(), opcode=0x02)
                self.ack_count += 1
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
    # Automatically recover a brief upstream disconnect, but avoid infinite retries.
    for retry in range(4):
        with lock:
            if state["hunter"] is not hunter:
                return
            if retry:
                state.update(status="reconnecting", connected=False,
                             error=f"重新连接中（第 {retry}/3 次）")
        try:
            hunter.connect()
        except Exception as exc:
            with lock:
                if state["hunter"] is hunter:
                    state["error"] = "连接失败：" + type(exc).__name__
        finally:
            hunter._heartbeat_stop.set()

        with lock:
            if state["hunter"] is not hunter:
                return
            state["connected"] = False
        if retry < 3:
            # Allow Stop to cancel between attempts.
            for _ in range((retry + 1) * 4):
                with lock:
                    if state["hunter"] is not hunter:
                        return
                time.sleep(0.5)

    with lock:
        if state["hunter"] is hunter:
            state.update(status="stopped", connected=False,
                         error="连续连接失败，请确认直播是否结束，或稍后重新开始")

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
    if hunter:
        hunter._heartbeat_stop.set()
    if hunter and hunter.ws:
        try:
            hunter.ws.close()
        except Exception:
            pass
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")))
