// Restricted gift collector bridge. Never expose DyHub's admin/login API publicly.
// Only the paired monitoring app knows COLLECTOR_TOKEN.
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';

const listenPort = Number(process.env.PORT || 10000);
const upstreamPort = 8757;
const token = process.env.COLLECTOR_TOKEN || '';
if (token.length < 32) throw new Error('COLLECTOR_TOKEN must be at least 32 characters');

function isAuthenticated(req) {
  const provided = req.headers['x-collector-token'];
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
const allowedRoutes = new Set(['GET /api/rooms', 'POST /api/rooms/connect', 'GET /api/stats']);
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    http.get('http://127.0.0.1:8757/api/stats', r => {
      r.resume(); res.writeHead(r.statusCode === 200 ? 200 : 503, {'Content-Type':'application/json'});
      res.end(JSON.stringify({alive:r.statusCode === 200}));
    }).on('error', () => { res.writeHead(503); res.end('not ready'); });
    return;
  }
  if (!isAuthenticated(req)) {
    res.writeHead(401, {'Content-Type':'application/json'});
    res.end('{"error":"Unauthorized"}'); return;
  }
  const route = req.method + ' ' + (req.url || '').split('?')[0];
  if (!allowedRoutes.has(route)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const upstream = http.request({
    hostname:'127.0.0.1', port:upstreamPort, method:req.method, path:req.url,
    headers:{'Content-Type':req.headers['content-type']||'application/json'},
    timeout:15000
  }, response => {
    res.writeHead(response.statusCode || 502, {'Content-Type':response.headers['content-type']||'application/json'});
    response.pipe(res);
  });
  upstream.on('error', () => {if(!res.headersSent)res.writeHead(502);res.end('Collector temporarily unavailable');});
  req.pipe(upstream);
});
server.on('upgrade', (req, client, head) => {
  if (!isAuthenticated(req) || !req.url?.startsWith('/ws?') || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    client.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); client.destroy(); return;
  }
  const upstream = net.connect(upstreamPort, '127.0.0.1');
  upstream.on('connect', () => {
    const key=req.headers['sec-websocket-key']||'';
    upstream.write(
      'GET '+req.url+' HTTP/1.1\r\nHost: 127.0.0.1:8757\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n'
    );
    if(head.length)upstream.write(head);
    client.pipe(upstream);upstream.pipe(client);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});
server.listen(listenPort,'0.0.0.0',()=>console.log('Authenticated collector bridge on',listenPort));
