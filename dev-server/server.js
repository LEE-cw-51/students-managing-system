'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('../tests/memory-store.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DATA = path.join(__dirname, 'data.json');
const PORT = Number(process.env.PORT || 8787);

const store = createMemoryStore({
  fs,
  file: DATA,
  today: process.env.LMS_TODAY || '2026-09-14',
  now: process.env.LMS_NOW || '2026-09-14T10:00:00'
});

if (!store.readTable('Students').length) {
  seedDemo(LMS.createService(store));
}

function renderIndex() {
  let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('([^']+)'\);\s*\?>/g, (_, name) => {
    return fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
  });
  const boot = LMS.createService(store).getBootstrap();
  html = html.replace('<?!= bootJson; ?>', JSON.stringify(boot).replace(/</g, '\\u003c'));
  html = html.replace('<head>', '<head>\n    <script>window.__LMS_DEV__ = true;</script>');
  return html;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
  });
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
  res.end(body);
}

function json(res, obj) {
  send(res, 200, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, renderIndex(), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, { ok: true });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/resetDemo') {
      store.reset();
      seedDemo(LMS.createService(store));
      return json(res, { ok: true, data: { seeded: true } });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      const api = LMS.createService(store);
      const body = await readBody(req);
      const args = Array.isArray(body.args) ? body.args : [];
      if (name === 'apiBatch') {
        const calls = args[0] || [];
        const data = calls.map((c) => {
          if (!c || typeof api[c.name] !== 'function') {
            throw new Error('알 수 없는 API입니다.');
          }
          return api[c.name].apply(api, c.args || []);
        });
        return json(res, { ok: true, data });
      }
      if (typeof api[name] !== 'function') {
        return json(res, { ok: false, error: '알 수 없는 API입니다.' });
      }
      const data = api[name].apply(api, args);
      return json(res, { ok: true, data });
    }
    send(res, 404, 'Not found');
  } catch (e) {
    json(res, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('LMS dev server http://127.0.0.1:' + PORT);
});
