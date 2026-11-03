"""Resolve Douyin live share text to the stable live.douyin.com web_rid.

Only trusted Douyin domains are fetched; never persist the one-session reflow id.
"""
from __future__ import annotations

import html
import re
import urllib.error
import urllib.parse
import urllib.request


class RoomLinkError(ValueError):
    pass


ALLOWED_HOSTS = frozenset({
    'v.douyin.com', 'live.douyin.com', 'www.douyin.com',
    'douyin.com', 'webcast.amemv.com', 'www.iesdouyin.com',
})
LINK_RE = re.compile(r'https?://[^\s<>"\'，。；;、！!]+', re.I)
LIVE_RE = re.compile(r'(?:https?://)?live\.douyin\.com/([0-9]{3,30})(?=[/?#\s]|$)', re.I)
WEB_RID_RE = re.compile(r'(?:[?&]|\\u0026)web_rid=([0-9]{3,30})(?:[&#]|$)', re.I)
OWNER_RE = re.compile(r'"owner"\s*:\s*\{', re.I)
SHORT_ID_RE = re.compile(r'"shortId"\s*:\s*"?([0-9]{3,30})"?', re.I)
USER_AGENT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _validate_url(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    host = (p.hostname or '').lower().rstrip('.')
    if p.scheme != 'https' or host not in ALLOWED_HOSTS or p.username or p.password or p.port not in (None, 443):
        raise RoomLinkError('只支持抖音官方直播分享链接，请检查粘贴的内容')
    return url


def _owner_id(body: bytes) -> str | None:
    text = html.unescape(body.decode('utf-8', errors='replace'))
    # Douyin embeds escaped JSON in script content, sometimes double escaped.
    for _ in range(3):
        match = OWNER_RE.search(text)
        while match:
            candidate = SHORT_ID_RE.search(text, match.end(), min(match.end() + 6000, len(text)))
            if candidate and candidate.group(1).strip('0'):
                return candidate.group(1)
            match = OWNER_RE.search(text, match.end())
        text = text.replace('\\\\"', '"').replace('\\"', '"')
    return None


def resolve_share_short_url(url: str) -> str:
    """Resolve a Douyin short link by following up to 6 domain-checked hops.

    The reflow path contains a temporary live-session id; only owner.shortId
    from its HTML response is accepted as a stable web_rid.
    """
    url = _validate_url(url)
    opener = urllib.request.build_opener(NoRedirect())
    saw_reflow = False
    for _ in range(6):
        _validate_url(url)
        p = urllib.parse.urlsplit(url)
        if p.hostname == 'live.douyin.com':
            m = re.fullmatch(r'/([0-9]{3,30})/?', p.path)
            if m:
                return m.group(1)
        if p.hostname in ('live.douyin.com', 'www.douyin.com', 'douyin.com'):
            q = urllib.parse.parse_qs(p.query)
            rid = (q.get('web_rid') or [None])[0]
            if rid and re.fullmatch(r'[0-9]{3,30}', rid):
                return rid
        if p.hostname == 'webcast.amemv.com' and '/douyin/webcast/reflow/' in p.path:
            saw_reflow = True

        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'})
        try:
            response = opener.open(request, timeout=8)
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise RoomLinkError('暂时无法访问抖音短链接，请稍后重试或提供网页版直播地址') from error
        with response:
            status = response.status
            if 300 <= status < 400:
                location = response.headers.get('Location')
                if not location:
                    break
                url = _validate_url(urllib.parse.urljoin(url, location))
                continue
            if status != 200:
                raise RoomLinkError(f'抖音短链接暂时无法解析（HTTP {status}），请尝试网页版直播地址')
            body = response.read(2 * 1024 * 1024)
            if saw_reflow:
                rid = _owner_id(body)
                if rid:
                    return rid
            # The document might be a client-side redirect; never trust its
            # arbitrary URLs as a stable id, nor use a temporary reflow room id.
            break
    raise RoomLinkError('没有取得主播长期有效的直播间号。短链接可能过期或被抖音限制，请粘贴网页版 live.douyin.com 链接')


def resolve_room_input(value: str) -> str:
    raw = (value or '').strip()
    if re.fullmatch(r'[0-9]{3,30}', raw):
        return raw
    long_url = LIVE_RE.search(raw)
    if long_url:
        return long_url.group(1)
    urls = LINK_RE.findall(raw)
    if not urls and re.fullmatch(r'v\.douyin\.com/[A-Za-z0-9_-]{3,48}/?', raw, re.I):
        urls = ['https://' + raw]
    if not urls:
        raise RoomLinkError('请粘贴抖音分享文案、抖音直播链接或数字直播间号')
    url = urls[0].rstrip(')）]】.,')
    _validate_url(url)
    p = urllib.parse.urlsplit(url)
    if p.hostname == 'v.douyin.com':
        if not re.fullmatch(r'/[A-Za-z0-9_-]{3,48}/?', p.path):
            raise RoomLinkError('抖音分享短链接格式不正确')
        return resolve_share_short_url(url)
    if p.hostname in ('live.douyin.com', 'www.douyin.com', 'douyin.com'):
        rid = (urllib.parse.parse_qs(p.query).get('web_rid') or [None])[0]
        if rid and re.fullmatch(r'[0-9]{3,30}', rid):
            return rid
        if p.hostname == 'live.douyin.com':
            return resolve_share_short_url(url)
    raise RoomLinkError('请使用直播间分享链接，而不是主页或作品链接；也可以输入 live.douyin.com/数字')
