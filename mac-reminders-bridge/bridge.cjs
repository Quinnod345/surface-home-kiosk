'use strict';
// HTTP bridge: exposes the native `remind` EventKit worker to the kiosk over the
// LAN. One-shot spawn per request (simple + robust). Token-protected so only the
// kiosk can read/edit the family's reminders. Config: bridge-config.json.
const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridge-config.json'), 'utf8'));
const REMIND = path.join(__dirname, 'remind');
const PORT = cfg.port || 8781;
const HOST = cfg.host || '0.0.0.0';
const TOKEN = cfg.token;

function run(args) {
  return new Promise((resolve) => {
    execFile(REMIND, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ ok: false, error: String(stderr || err.message).slice(0, 300) });
      try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); }
      catch { resolve({ ok: false, error: 'bad worker output', raw: String(stdout).slice(0, 200) }); }
    });
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'reminders-bridge' });

  // auth (everything except /health)
  const auth = req.headers.authorization || '';
  if (!TOKEN || auth !== `Bearer ${TOKEN}`) return send(res, 401, { ok: false, error: 'unauthorized' });

  try {
    if (req.method === 'GET' && url.pathname === '/lists') return send(res, 200, await run(['lists']));
    if (req.method === 'GET' && url.pathname === '/items') {
      const list = url.searchParams.get('list') || cfg.defaultList || 'Grocery';
      return send(res, 200, await run(['items', list]));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/add') {
        const list = body.list || cfg.defaultList || 'Grocery';
        if (!body.title || !String(body.title).trim()) return send(res, 400, { ok: false, error: 'title required' });
        return send(res, 200, await run(['add', list, String(body.title)]));
      }
      if (url.pathname === '/complete') return send(res, 200, await run(['complete', String(body.id)]));
      if (url.pathname === '/uncomplete') return send(res, 200, await run(['uncomplete', String(body.id)]));
      if (url.pathname === '/delete') return send(res, 200, await run(['delete', String(body.id)]));
    }
    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e.message || e).slice(0, 200) });
  }
});

server.listen(PORT, HOST, () => console.log(`reminders-bridge listening on ${HOST}:${PORT}`));
