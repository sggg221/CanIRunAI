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


def _debug_default_share():
    """One-time diagnostics for the user's configured public share link.
    Never log full HTML, tokens, cookies or unrelated user identifiers.
    """
    url = os.getenv("ROOM_SHARE_DEFAULT", "").strip()
    if not url or not _safe_url(url):
        return
    try:
        for hop in range(8):
            if not _safe_url(url):
                app.logger.warning("share-resolve hop=%d rejected off-domain host", hop)
                return
            parsed = urlsplit(url)
            with requests.get(url, headers=SESSION_HEADERS, timeout=(4, 10),
                              allow_redirects=False, stream=True) as response:
                redirect = response.headers.get("Location", "")
                app.logger.warning(
                    "share-resolve hop=%d host=%s path_type=%s status=%d redirect_host=%s",
                    hop, parsed.hostname,
                    "reflow" if ROOM_PATH.search(parsed.path) else "other",
                    response.status_code,
                    urlsplit(urljoin(url, redirect)).hostname if redirect else "-"
                )
                if redirect:
                    candidate = urljoin(url, redirect)
                    if not _safe_url(candidate):
                        return
                    url = candidate
                    continue
                response.raw.decode_content = True
                body = response.raw.read(2097152).decode("utf-8", errors="replace").replace("\\", "")
                app.logger.warning(
                    "share-resolve final encoding=%s type=%s decoded_len=%d html_like=%s owner_short_id=%s room_id_found=%s web_rid=%s",
                    response.headers.get("Content-Encoding", "-"), response.headers.get("Content-Type", "-")[:35], len(body),
                    body.lstrip().startswith(("<", "{")),
                    bool(OWNER_SHORT_ID.search(body)),
                    bool(re.search(r'"roomId"\s*:', body)),
                    bool(WEBRID_IN_HTML.search(body)),
                )
            return
    except requests.RequestException as exc:
        app.logger.warning("share-resolve request failure: %s", type(exc).__name__)


if os.getenv("SHARE_DIAGNOSTICS", "0") == "1" and os.getenv("ROOM_SHARE_DEFAULT"):
    threading.Thread(target=_debug_default_share, daemon=True).start()


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
