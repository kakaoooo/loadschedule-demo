'use strict';
// ทดสอบความปลอดภัยของเซิร์ฟเวอร์ (CSRF/DNS-rebinding, crash DoS, path traversal, UTF-8 body, library/log routes, headers)
// รัน: node tests/security.test.js — ทุกอย่างใช้โฟลเดอร์ชั่วคราว ไม่แตะ projects/ จริง
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const APP = path.join(__dirname, '..');
const S = require('../server.js');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); return; }
  fail++;
  const d = detail === undefined ? '' : '  → ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).replace(/\s+/g, ' ').slice(0, 220);
  console.log(`FAIL  ${name}${d}`);
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// เก็บ exception ที่หลุดขึ้นมาถึง process (ถ้า handler พังจะหลุดมาตรงนี้ แทนที่จะทำให้เทสต์ตายทั้งไฟล์)
const uncaught = [];
process.on('uncaughtException', (e) => { uncaught.push(String((e && e.message) || e)); });
process.on('unhandledRejection', (e) => { uncaught.push(String((e && e.message) || e)); });

/* ---------- sandbox: public/ สำเนา + โฟลเดอร์พี่น้อง public-private + ไฟล์นอก projects ---------- */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-sec-'));
const ROOT = path.join(SANDBOX, 'public');
const REAL_INDEX = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
const CSS = 'body{color:#123}\n';
const MARKER_JS = "var placeholder = '__LS_TOKEN__';\n";
fs.mkdirSync(path.join(ROOT, 'css'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'js'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'index.html'), REAL_INDEX);
fs.writeFileSync(path.join(ROOT, 'css', 'app.css'), CSS);
fs.writeFileSync(path.join(ROOT, 'js', 'marker.js'), MARKER_JS);
fs.mkdirSync(path.join(SANDBOX, 'public-private'));
fs.writeFileSync(path.join(SANDBOX, 'public-private', 'secret.txt'), 'SECRET-OUTSIDE-ROOT');
fs.writeFileSync(path.join(SANDBOX, 'secret.json'), '{"secret":"OUTSIDE-PROJECTS"}');

const TOKEN = 'ab12'.repeat(12);
const EXPECTED_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const handles = [];
let projSeq = 0;
async function start(opts = {}) {
  const projectsDir = opts.projectsDir || path.join(SANDBOX, 'proj-' + (++projSeq));
  if (!opts.projectsDir) fs.mkdirSync(projectsDir, { recursive: true });
  const server = S.createServer(Object.assign({ root: ROOT, token: TOKEN }, opts, { projectsDir }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const h = { server, port: server.address().port, token: opts.token || TOKEN, projectsDir };
  handles.push(h);
  return h;
}
const closeAll = () => Promise.all(handles.map((h) => new Promise((resolve) => { try { h.server.closeAllConnections(); h.server.close(() => resolve()); } catch (e) { resolve(); } })));

/* ---------- ตัวช่วยยิง request ---------- */
const acHeaders = []; // ทุก response ต้องไม่มี access-control-*
function request(h, o = {}) {
  return new Promise((resolve) => {
    const method = o.method || 'GET';
    const headers = Object.assign({}, o.headers);
    if (o.token !== null) headers['x-ls-token'] = o.token === undefined ? h.token : o.token;
    let body = o.json !== undefined ? JSON.stringify(o.json) : o.body;
    if (typeof body === 'string') body = Buffer.from(body, 'utf8');
    if ((method === 'POST' || method === 'PUT') && o.ct !== null) headers['Content-Type'] = o.ct || 'application/json';
    if (body !== undefined && !o.chunked) headers['Content-Length'] = body.length;
    const req = http.request({ host: '127.0.0.1', port: h.port, method, path: o.path || '/', headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', () => {});
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        Object.keys(res.headers).forEach((k) => { if (k.startsWith('access-control-')) acHeaders.push(k); });
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
    });
    req.setTimeout(o.timeout || 2500, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, error: e.message, headers: {}, buf: Buffer.alloc(0), text: '' }));
    req.on('socket', (s) => s.setNoDelay(true));
    (async () => {
      try {
        if (body !== undefined) {
          const piece = o.drip ? 1 : (o.pieces || body.length || 1);
          for (let i = 0; i < body.length; i += piece) {
            req.write(body.subarray(i, i + piece));
            if (o.drip || o.pieces) await sleep(1);
          }
        }
        req.end();
      } catch (e) { /* ถูก destroy ไปแล้ว */ }
    })();
  });
}
function raw(h, text, wait = 900) {
  return new Promise((resolve) => {
    const s = net.connect(h.port, '127.0.0.1');
    let data = '';
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(t); s.destroy(); resolve(data); };
    const t = setTimeout(fin, wait);
    s.setEncoding('utf8');
    s.on('data', (d) => { data += d; });
    s.on('end', fin); s.on('close', fin); s.on('error', fin);
    s.write(text);
  });
}
const statusOf = (r) => { const m = /^HTTP\/1\.[01] (\d{3})/.exec(r); return m ? Number(m[1]) : 0; };
const json = (r) => { try { return JSON.parse(r.text); } catch (e) { return undefined; } };
const files = (h) => fs.readdirSync(h.projectsDir);
const GOOD = { meta: { name: 'good' }, panels: [], items: [] };

/* ====================================================================== */
async function main() {
  /* ---------- V2a: Host (DNS rebinding) ---------- */
  {
    const h = await start();
    for (const host of ['evil.example', `evil.example:${h.port}`, `localhost.evil.example:${h.port}`, 'localhost', `localhost:${h.port + 1}`, `127.0.0.1.evil.example:${h.port}`]) {
      const r = await request(h, { path: '/', headers: { Host: host } });
      eq(`V2 Host "${host.replace(String(h.port), 'PORT').replace(String(h.port + 1), 'PORT+1')}" → 403`, r.status, 403);
    }
    const rb = await request(h, { path: '/api/projects', headers: { Host: 'evil.example' } });
    eq('V2 Host ปลอม + token ถูก → 403 (API)', rb.status, 403);
    for (const host of [`localhost:${h.port}`, `127.0.0.1:${h.port}`, `[::1]:${h.port}`, `LOCALHOST:${h.port}`]) {
      const r = await request(h, { path: '/', headers: { Host: host } });
      eq(`V2 Host "${host.replace(String(h.port), 'PORT')}" → 200`, r.status, 200);
    }
  }

  /* ---------- V2b: Origin ---------- */
  {
    const h = await start();
    const post = (origin) => request(h, { method: 'POST', path: '/api/projects', json: GOOD, headers: origin === undefined ? {} : { Origin: origin } });
    for (const o of ['http://evil.example', 'null', `https://localhost:${h.port}`, `http://localhost:${h.port + 1}`, `http://localhost.evil.example:${h.port}`, `http://evil.example:${h.port}`]) {
      const r = await post(o);
      eq(`V2 POST Origin "${o.replace(String(h.port + 1), 'PORT+1').replace(String(h.port), 'PORT')}" → 403`, r.status, 403);
    }
    eq('V2 Origin ปลอมแล้วไม่มีไฟล์ถูกเขียน', files(h), []);
    const g = await request(h, { path: '/', headers: { Origin: 'http://evil.example' } });
    eq('V2 GET / พร้อม Origin ปลอม → 403', g.status, 403);
    for (const o of [`http://localhost:${h.port}`, `http://127.0.0.1:${h.port}`, `http://[::1]:${h.port}`, undefined]) {
      const r = await post(o);
      eq(`V2 POST Origin ${o ? '"' + o.replace(String(h.port), 'PORT') + '"' : '(ไม่มี)'} → 200`, r.status, 200);
    }
  }

  /* ---------- V2c: token ---------- */
  {
    const h = await start();
    const t = h.token;
    for (const [label, tok] of [['ไม่มี', null], ['ผิด', 'x'.repeat(t.length)], ['สั้นกว่า', t.slice(0, -1)], ['ยาวกว่า', t + 'a'], ['ว่าง', ''], ['placeholder', '__LS_TOKEN__']]) {
      const r = await request(h, { path: '/api/projects', token: tok });
      eq(`V2 GET /api/projects token ${label} → 403`, r.status, 403);
      ok(`V2 403 ไม่เปิดเผย token (${label})`, !r.text.includes(t), r.text);
    }
    eq('V2 GET /api/projects token ถูก → 200', (await request(h, { path: '/api/projects' })).status, 200);
    eq('V2 GET /api/library ไม่มี token → 403', (await request(h, { path: '/api/library', token: null })).status, 403);
    eq('V2 GET /api/logs ไม่มี token → 403', (await request(h, { path: '/api/logs', token: null })).status, 403);
    eq('V2 GET /api/projects/x ไม่มี token → 403', (await request(h, { path: '/api/projects/x', token: null })).status, 403);
    eq('V2 GET /api/อื่นๆ ไม่มี token → 403', (await request(h, { path: '/api/nothing', token: null })).status, 403);
    eq('V2 GET /api/อื่นๆ มี token → 404', (await request(h, { path: '/api/nothing' })).status, 404);
    eq('V2 POST /api/projects ไม่มี token → 403', (await request(h, { method: 'POST', path: '/api/projects', json: GOOD, token: null })).status, 403);
    eq('V2 POST /api/projects token ผิด → 403', (await request(h, { method: 'POST', path: '/api/projects', json: GOOD, token: 'nope' })).status, 403);
    eq('V2 ไม่มีไฟล์ถูกเขียนจาก request ที่ไม่มี token', files(h), []);
    const plan = { id: 'plan-t', name: 't', updated: 1, project: GOOD };
    eq('V2 PUT /api/library/:id ไม่มี token → 403', (await request(h, { method: 'PUT', path: '/api/library/plan-t', json: plan, token: null })).status, 403);
    eq('V2 DELETE /api/library/:id ไม่มี token → 403', (await request(h, { method: 'DELETE', path: '/api/library/plan-t', token: null })).status, 403);
    eq('V2 POST /api/logs ไม่มี token → 403', (await request(h, { method: 'POST', path: '/api/logs', json: { logs: [{ t: 1, type: 'plan', msg: 'x' }] }, token: null })).status, 403);
    eq('V2 DELETE /api/logs ไม่มี token → 403', (await request(h, { method: 'DELETE', path: '/api/logs', token: null })).status, 403);
    ok('V2 ไม่มีโฟลเดอร์ library ถูกสร้างจาก request ที่ไม่มี token', !fs.existsSync(path.join(h.projectsDir, 'library')));
  }

  /* ---------- V2d/e: Content-Type, method, CORS ---------- */
  {
    const h = await start();
    const body = JSON.stringify(GOOD);
    for (const ct of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx']) {
      const r = await request(h, { method: 'POST', path: '/api/projects', body, ct });
      eq(`V2 POST Content-Type ${ct} → 415`, r.status, 415);
    }
    eq('V2 POST ไม่มี Content-Type → 415', (await request(h, { method: 'POST', path: '/api/projects', body, ct: null })).status, 415);
    eq('V2 ไม่มีไฟล์ถูกเขียนจาก text/plain', files(h), []);
    eq('V2 PUT library text/plain → 415', (await request(h, { method: 'PUT', path: '/api/library/plan-t', body: JSON.stringify({ id: 'plan-t', name: 't', updated: 1, project: GOOD }), ct: 'text/plain' })).status, 415);
    eq('V2 POST logs text/plain → 415', (await request(h, { method: 'POST', path: '/api/logs', body: '{"logs":[]}', ct: 'text/plain' })).status, 415);
    ok('V2 text/plain ไม่เขียนอะไรลง library', !fs.existsSync(path.join(h.projectsDir, 'library')));
    eq('V2 POST application/json; charset=utf-8 → 200', (await request(h, { method: 'POST', path: '/api/projects', body, ct: 'application/json; charset=utf-8' })).status, 200);
    eq('V2 POST APPLICATION/JSON → 200', (await request(h, { method: 'POST', path: '/api/projects', body, ct: 'APPLICATION/JSON' })).status, 200);

    for (const hdrs of [{ Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' }, { Origin: `http://127.0.0.1:${h.port}`, 'Access-Control-Request-Method': 'POST' }, {}]) {
      const r = await request(h, { method: 'OPTIONS', path: '/api/projects', headers: hdrs });
      ok(`V2 OPTIONS (${hdrs.Origin ? hdrs.Origin.replace(String(h.port), 'PORT') : 'ไม่มี Origin'}) → 403/404`, r.status === 403 || r.status === 404, r.status);
    }
    eq('V2 DELETE / → 405', (await request(h, { method: 'DELETE', path: '/' })).status, 405);
  }

  /* ---------- V3: URL ที่เคยทำให้ process ตาย ---------- */
  {
    const h = await start();
    fs.mkdirSync(path.join(h.projectsDir, 'dir.json'));
    fs.writeFileSync(path.join(h.projectsDir, 'notes.txt'), 'x');
    const H = `Host: 127.0.0.1:${h.port}\r\nx-ls-token: ${h.token}\r\nConnection: close\r\n`;
    const cases = [
      ['GET /%', `GET /% HTTP/1.1\r\n${H}\r\n`],
      ['GET /api/projects/%', `GET /api/projects/% HTTP/1.1\r\n${H}\r\n`],
      ['GET /index.html%00', `GET /index.html%00 HTTP/1.1\r\n${H}\r\n`],
      ['GET //', `GET // HTTP/1.1\r\n${H}\r\n`],
      ['GET http://[ (absolute URL เสีย)', `GET http://[ HTTP/1.1\r\n${H}\r\n`],
      ['GET /%E0%A4%A (UTF-8 เสีย)', `GET /%E0%A4%A HTTP/1.1\r\n${H}\r\n`],
      ['GET /api/projects/%E0%A4%A', `GET /api/projects/%E0%A4%A HTTP/1.1\r\n${H}\r\n`],
      ['GET /api/projects/a%00b (NUL)', `GET /api/projects/a%00b HTTP/1.1\r\n${H}\r\n`],
      ['GET /api/projects/dir (เป็นโฟลเดอร์ชื่อ dir.json)', `GET /api/projects/dir HTTP/1.1\r\n${H}\r\n`]
    ];
    for (const [label, text] of cases) {
      const before = uncaught.length;
      const resp = await raw(h, text);
      const st = statusOf(resp);
      await sleep(30);
      const follow = await request(h, { path: '/api/library' });
      ok(`V3 ${label}: ไม่ crash`, uncaught.length === before, uncaught.slice(before).join(' | '));
      ok(`V3 ${label}: ตอบ 400/403/404`, [400, 403, 404].includes(st), `status ${st}`);
      ok(`V3 ${label}: request ถัดไปยังปกติ`, follow.status === 200, follow.status);
    }
    const list = json(await request(h, { path: '/api/projects' }));
    eq('V3 รายชื่อโครงการข้ามโฟลเดอร์/ไฟล์ที่ไม่ใช่ .json', Array.isArray(list) ? list.map((x) => x.file) : list, []);
  }
  {
    const h = await start();
    fs.rmSync(h.projectsDir, { recursive: true, force: true });
    const before = uncaught.length;
    const r = await request(h, { path: '/api/projects' });
    ok('V3 โฟลเดอร์ projects หายตอน GET /api/projects: ไม่ crash', uncaught.length === before, uncaught.slice(before).join(' | '));
    ok('V3 โฟลเดอร์ projects หาย → 200 []', r.status === 200 && JSON.stringify(json(r)) === '[]', `${r.status} ${r.text.slice(0, 60)}`);
    fs.rmSync(h.projectsDir, { recursive: true, force: true });
    const w = await request(h, { method: 'POST', path: '/api/projects', json: GOOD });
    ok('V3 โฟลเดอร์ projects หายตอน POST: สร้างใหม่แล้วบันทึกได้', w.status === 200 && fs.existsSync(path.join(h.projectsDir, 'good.json')), `${w.status} ${w.text.slice(0, 80)}`);
  }
  {
    // HTTP/1.0 ไม่มี Host ต้องไม่ผ่าน
    const h = await start();
    eq('V2 HTTP/1.0 ไม่มี Host → 403', statusOf(await raw(h, 'GET / HTTP/1.0\r\n\r\n')), 403);
    eq('V2 HTTP/1.0 ไม่มี Host (API พร้อม token) → 403', statusOf(await raw(h, `GET /api/projects HTTP/1.0\r\nx-ls-token: ${h.token}\r\n\r\n`)), 403);
  }
  {
    // ตาข่ายชั้นสุดท้าย: handler พังด้วยเหตุใดก็ตาม -> 500 กลางๆ ไม่มี stack/path และเซิร์ฟเวอร์ยังอยู่
    const h = await start();
    const crypto = require('crypto');
    const realTse = crypto.timingSafeEqual;
    const origErr = console.error;
    console.error = () => {};
    let r;
    try {
      crypto.timingSafeEqual = () => { throw new Error('boom C:\\secret\\place.js:12 at Object.<anonymous>'); };
      r = await request(h, { path: '/api/projects' });
    } finally { crypto.timingSafeEqual = realTse; console.error = origErr; }
    eq('V3 handler พังกลางทาง → 500', r.status, 500);
    ok('V3 500 เป็น JSON กลางๆ ไม่มี stack/path/ข้อความ error ภายใน', json(r) && json(r).ok === false && !/boom|secret|place\.js|at Object/.test(r.text), r.text);
    ok('V3 500 ยังมี header ความปลอดภัย', r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'DENY', r.headers);
    eq('V3 หลัง 500 เซิร์ฟเวอร์ยังตอบปกติ', (await request(h, { path: '/api/projects' })).status, 200);
  }
  {
    // projects/ ใช้ไม่ได้ (เป็นไฟล์): ไม่ crash, ไม่เปิดเผย path
    fs.writeFileSync(path.join(SANDBOX, 'blocker'), 'x');
    const h = await start({ projectsDir: path.join(SANDBOX, 'blocker') });
    const origErr = console.error;
    console.error = () => {};
    let w, l;
    const before = uncaught.length;
    try {
      w = await request(h, { method: 'POST', path: '/api/projects', json: GOOD });
      l = await request(h, { path: '/api/projects' });
    } finally { console.error = origErr; }
    ok('V3 projects/ เป็นไฟล์: POST → 500 กลางๆ ไม่มี path ภายใน', w.status === 500 && !w.text.includes(SANDBOX) && !/EEXIST|ENOTDIR|ENOENT/.test(w.text), `${w.status} ${w.text.slice(0, 100)}`);
    ok('V3 projects/ เป็นไฟล์: GET list → 200 []', l.status === 200 && JSON.stringify(json(l)) === '[]', `${l.status} ${l.text.slice(0, 60)}`);
    ok('V3 projects/ เป็นไฟล์: ไม่ crash', uncaught.length === before, uncaught.slice(before).join(' | '));
  }

  /* ---------- V4: path traversal ---------- */
  {
    const h = await start();
    const cases = [
      ['/..%2fpublic-private/secret.txt', 'โฟลเดอร์พี่น้อง public-private (..%2f)'],
      ['/..%2fpublic-private%2fsecret.txt', '..%2f ทั้งหมด'],
      ['/%2e%2e%2fpublic-private%2fsecret.txt', '%2e%2e%2f'],
      ['/..%5cpublic-private%5csecret.txt', 'backslash %5c'],
      ['/%2e%2e%5cpublic-private%5csecret.txt', '%2e%2e%5c'],
      ['/css%2f..%2f..%2fpublic-private%2fsecret.txt', 'css%2f..%2f..'],
      ['/../public-private/secret.txt', '../ ตรงๆ'],
      ['/%2e%2e/public-private/secret.txt', '%2e%2e/'],
      ['/css/../../public-private/secret.txt', 'css/../..'],
      ['/C:/Windows/win.ini', 'drive letter'],
      ['/C%3A%5CWindows%5Cwin.ini', 'drive letter เข้ารหัส'],
      ['/index.html::$DATA', 'alternate data stream ::$DATA'],
      ['/index.html:$DATA', 'alternate data stream :$DATA'],
      ['/css/app.css:stream', 'alternate data stream :stream'],
      ['/nul', 'ชื่ออุปกรณ์ Windows nul'],
      ['/nul.txt', 'ชื่ออุปกรณ์ Windows nul.txt'],
      ['/css%2fapp.css', '%2f ซ่อนใน segment']
    ];
    for (const [p, label] of cases) {
      const r = await request(h, { path: p });
      ok(`V4 ไม่เสิร์ฟ: ${label}`, [400, 403, 404].includes(r.status) && !r.text.includes('SECRET-OUTSIDE-ROOT'), `${r.status} ${r.text.slice(0, 40)}`);
    }
    const css = await request(h, { path: '/css/app.css' });
    ok('V4 ไฟล์ static ปกติยังเสิร์ฟได้ (css/app.css)', css.status === 200 && css.text === CSS, css.status);
    eq('V4 ชนิดไฟล์ css', css.headers['content-type'], 'text/css; charset=utf-8');
    eq('V4 โฟลเดอร์ /css/ → 404', (await request(h, { path: '/css/' })).status, 404);
    eq('V4 ไฟล์ไม่มี → 404', (await request(h, { path: '/nope.js' })).status, 404);
    // GET /api/projects/<ชื่อ> ต้องไม่หลุดออกนอก projects/
    for (const p of ['/api/projects/..%2fsecret', '/api/projects/..%5csecret', '/api/projects/%2e%2e%2fsecret.json', '/api/projects/..%2f..%2fsecret']) {
      const r = await request(h, { path: p });
      ok(`V4 ${p} ไม่อ่านไฟล์นอก projects/`, r.status !== 200 && !r.text.includes('OUTSIDE-PROJECTS'), `${r.status} ${r.text.slice(0, 40)}`);
    }
  }

  /* ---------- V5: body เป็น Buffer, UTF-8 ไม่เพี้ยน, เพดานขนาด, ตรวจรูปแบบ ---------- */
  {
    const h = await start();
    const thai = { meta: { name: 'ทดสอบโหลด' }, panels: [], items: [{ id: 'a', name: 'ห้องประชุมใหญ่ ชั้น 2 — ไฟ LED 2x18W' }] };
    const r = await request(h, { method: 'POST', path: '/api/projects', json: thai, drip: true, timeout: 20000 });
    eq('V5 ภาษาไทยส่งทีละ 1 ไบต์ → 200', r.status, 200);
    const saved = r.status === 200 ? fs.readFileSync(path.join(h.projectsDir, json(r).file), 'utf8') : '';
    ok('V5 ไฟล์ที่บันทึกไม่มี U+FFFD', saved !== '' && !saved.includes('\ufffd'), saved.slice(0, 80));
    eq('V5 ภาษาไทยส่งทีละ 1 ไบต์: ข้อมูลตรงทุกตัวอักษร', saved ? JSON.parse(saved) : null, thai);
    const back = await request(h, { path: '/api/projects/' + encodeURIComponent(thai.meta.name) });
    eq('V5 GET /api/projects/<ชื่อไทย> อ่านกลับได้ตรงเดิม', json(back), thai);

    const items = [];
    for (let i = 0; i < 8000; i++) items.push({ id: 'i' + i, name: 'ตารางโหลดสำเร็จรูป ห้องประชุม ' + i });
    const bigThai = { meta: { name: 'big-thai' }, panels: [], items };
    const r2 = await request(h, { method: 'POST', path: '/api/projects', json: bigThai, pieces: 4099, timeout: 20000 });
    eq('V5 body ไทยก้อนใหญ่ แบ่งชิ้นไม่ตรงขอบตัวอักษร → 200', r2.status, 200);
    const saved2 = r2.status === 200 ? fs.readFileSync(path.join(h.projectsDir, json(r2).file), 'utf8') : '';
    ok('V5 body ก้อนใหญ่: ไม่มี U+FFFD และข้อมูลตรงเดิม', saved2 !== '' && !saved2.includes('\ufffd') && JSON.stringify(JSON.parse(saved2)) === JSON.stringify(bigThai));
  }
  {
    const h = await start({ maxProjectBytes: 2000 });
    const big = { meta: { name: 'big' }, panels: [], items: [{ x: 'a'.repeat(10000) }] };
    const r = await request(h, { method: 'POST', path: '/api/projects', json: big });
    eq('V5 body เกินเพดาน (Content-Length) → 413', r.status, 413);
    eq('V5 body เกินเพดาน: ไม่มีไฟล์ถูกเขียน', files(h), []);
    const rc = await request(h, { method: 'POST', path: '/api/projects', body: JSON.stringify(big), chunked: true, pieces: 1000 });
    eq('V5 body เกินเพดาน (chunked ไม่มี Content-Length) → 413', rc.status, 413);
    const text = `POST /api/projects HTTP/1.1\r\nHost: 127.0.0.1:${h.port}\r\nx-ls-token: ${h.token}\r\nContent-Type: application/json\r\nContent-Length: 99999999\r\nConnection: close\r\n\r\n`;
    eq('V5 Content-Length ใหญ่เกิน ตอบ 413 ทันทีโดยไม่รอ body', statusOf(await raw(h, text, 1500)), 413);
    const ra = await request(h, { method: 'PUT', path: '/api/library/plan-big', json: { id: 'plan-big', name: 'big', updated: 1, project: big } });
    eq('V5 PUT library เกินเพดาน → 413', ra.status, 413);
    ok('V5 PUT library เกินเพดาน: ไม่มีไฟล์แปลน', !fs.existsSync(path.join(h.projectsDir, 'library', 'plan-big.plan.json')));
    eq('V5 หลังโดน 413 ยังบันทึกไฟล์เล็กได้', (await request(h, { method: 'POST', path: '/api/projects', json: GOOD })).status, 200);
  }
  {
    const h = await start();
    const bad = [
      ['null', 'null'], ['array', '[]'], ['string', '"x"'], ['number', '42'], ['true', 'true'], ['{}', '{}'],
      ['ไม่มี panels', '{"meta":{},"items":[]}'], ['ไม่มี items', '{"meta":{},"panels":[]}'], ['ไม่มี meta', '{"panels":[],"items":[]}'],
      ['meta เป็น array', '{"meta":[],"panels":[],"items":[]}'], ['meta เป็น null', '{"meta":null,"panels":[],"items":[]}'],
      ['panels เป็น object', '{"meta":{},"panels":{},"items":[]}'], ['items เป็น string', '{"meta":{},"panels":[],"items":"x"}'],
      ['JSON เสีย', '{"meta":'], ['body ว่าง', '']
    ];
    for (const [label, body] of bad) {
      const before = uncaught.length;
      const r = await request(h, { method: 'POST', path: '/api/projects', body });
      ok(`V5 POST body ${label} → 400`, r.status === 400 && uncaught.length === before, `${r.status} ${r.text.slice(0, 60)}`);
    }
    eq('V5 body ไม่ถูกต้องทั้งหมด: ไม่มีไฟล์ถูกเขียน', files(h), []);
    eq('V5 body ถูกต้องขั้นต่ำ → 200', (await request(h, { method: 'POST', path: '/api/projects', body: '{"meta":{"name":"ok"},"panels":[],"items":[],"extra":1}' })).status, 200);
    const e = json(await request(h, { method: 'POST', path: '/api/projects', body: 'null' }));
    ok('V5 ข้อความ error ไม่มี stack/path ภายใน', e && typeof e.error === 'string' && !/\bat |\.js:|[A-Z]:\\/.test(e.error), e);
  }
  {
    // ชื่อไฟล์ (หน่วย: ฟังก์ชัน safeName)
    const cases = [
      ['con', 'con_'], ['CON', 'CON_'], ['nul.', 'nul_'], ['NUL', 'NUL_'], ['prn', 'prn_'], ['aux', 'aux_'], ['COM1', 'COM1_'], ['com9', 'com9_'], ['lpt1', 'lpt1_'], ['LPT9', 'LPT9_'],
      ['aux.txt', 'aux_.txt'], ['con ', 'con_'], ['console', 'console'], ['com10', 'com10'], ['nulx', 'nulx'],
      ['a/b\\c:d*e?f"g<h>i|j', 'a_b_c_d_e_f_g_h_i_j'], ['foo...  ', 'foo'], ['foo. . ', 'foo'], ['  bar', 'bar'], ['x\u0000y\u001fz\n\t', 'xyz'],
      ['', 'project'], ['   ', 'project'], ['...', 'project'], ['..', 'project'], [null, 'project'], [undefined, 'project'], [{ a: 1 }, 'project'], [['a'], 'project'], [123, '123'],
      ['ก'.repeat(200), 'ก'.repeat(80)], ['a'.repeat(200), 'a'.repeat(80)], ['a'.repeat(79) + '.', 'a'.repeat(79)], ['😀'.repeat(100), '😀'.repeat(80)]
    ];
    for (const [input, want] of cases) {
      let got;
      try { got = S.safeName(input); } catch (e) { got = 'THROWS ' + e.message; }
      eq(`V5 safeName(${JSON.stringify(typeof input === 'string' && input.length > 20 ? input.slice(0, 6) + '…×' + input.length : input)}) → ${JSON.stringify(want.length > 20 ? want.slice(0, 6) + '…×' + want.length : want)}`, got, want);
    }
    // ทดสอบผ่าน HTTP จริง: ไฟล์ที่เกิดขึ้นต้องอยู่ใน projects/ เท่านั้น ชื่อปลอดภัย
    const h = await start();
    const names = ['con', 'nul.', 'a/b\\c:d', 'foo...  ', 'x\u0000y\nz', 'ก'.repeat(200)];
    for (const name of names) {
      const r = await request(h, { method: 'POST', path: '/api/projects', json: { meta: { name }, panels: [], items: [] } });
      const f = json(r) && json(r).file;
      ok(`V5 POST ชื่อ ${JSON.stringify(name.length > 20 ? name.slice(0, 4) + '…' : name)} → ชื่อไฟล์ปลอดภัย`, r.status === 200 && typeof f === 'string' && fs.existsSync(path.join(h.projectsDir, f)) && f === S.safeName(name) + '.json' && !/^(con|nul)\./i.test(f), `${r.status} ${f}`);
    }
    const stray = fs.readdirSync(SANDBOX).filter((f) => /\.json$/i.test(f) && f !== 'secret.json');
    eq('V5 ไม่มีไฟล์ .json หลุดออกนอก projects/', stray, []);
    // GET ใช้ safeName เดียวกัน และอ่านได้เฉพาะ .json ใน projects/
    await request(h, { method: 'POST', path: '/api/projects', json: { meta: { name: 'my project' }, panels: [], items: [{ k: 1 }] } });
    for (const p of ['my%20project', 'my%20project.json']) {
      const r = await request(h, { path: '/api/projects/' + p });
      ok(`V5 GET /api/projects/${p} → 200 ข้อมูลเดิม`, r.status === 200 && json(r) && json(r).items[0].k === 1, `${r.status} ${r.text.slice(0, 40)}`);
    }
    eq('V5 GET โครงการที่ไม่มี → 404', (await request(h, { path: '/api/projects/ghost' })).status, 404);
    const lst = json(await request(h, { path: '/api/projects' }));
    ok('V5 รายชื่อโครงการมีเฉพาะ .json ที่เปิดอ่านได้', Array.isArray(lst) && lst.every((x) => x.file.endsWith('.json') && typeof x.modified === 'string'), lst);
  }

  /* ---------- V10: header ความปลอดภัย + token ใน index.html ---------- */
  {
    ok('V10 CSP คงที่ตรงตามสเปก (export S.CSP)', S.CSP === EXPECTED_CSP, S.CSP);
    const h = await start({ maxProjectBytes: 500 });
    const must = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
    const probes = [
      ['GET /', { path: '/' }], ['GET /index.html', { path: '/index.html' }], ['GET /css/app.css', { path: '/css/app.css' }], ['GET /favicon.ico', { path: '/favicon.ico' }],
      ['GET /api/library', { path: '/api/library' }], ['GET /api/logs', { path: '/api/logs' }], ['GET /api/projects', { path: '/api/projects' }], ['GET 404', { path: '/nope.txt' }],
      ['GET 403 Host ปลอม', { path: '/', headers: { Host: 'evil.example' } }], ['GET 403 ไม่มี token', { path: '/api/projects', token: null }],
      ['POST 415', { method: 'POST', path: '/api/projects', body: '{}', ct: 'text/plain' }], ['POST 413', { method: 'POST', path: '/api/projects', body: JSON.stringify({ x: 'a'.repeat(900) }) }],
      ['POST 400', { method: 'POST', path: '/api/projects', body: 'null' }], ['OPTIONS', { method: 'OPTIONS', path: '/api/projects' }], ['GET /% (400)', { path: '/%' }]
    ];
    for (const [label, o] of probes) {
      const r = await request(h, o);
      const missing = Object.keys(must).filter((k) => r.headers[k] !== must[k]);
      ok(`V10 header ความปลอดภัยครบ: ${label}`, r.status !== 0 && missing.length === 0, `${r.status} ขาด/ผิด ${missing.join(',')}`);
    }
    for (const p of ['/', '/index.html']) {
      const r = await request(h, { path: p });
      eq(`V10 CSP บน HTML (${p})`, r.headers['content-security-policy'], EXPECTED_CSP);
    }
    // token ใน index.html
    const idx = await request(h, { path: '/' });
    ok('V10 GET / มี token แทน __LS_TOKEN__', idx.text.includes(`<meta name="ls-token" content="${TOKEN}">`) && !idx.text.includes('__LS_TOKEN__'), idx.text.slice(0, 160));
    eq('V10 GET / เหมือน index.html จริงที่แทนที่ token แล้วเท่านั้น', idx.text, REAL_INDEX.split('__LS_TOKEN__').join(TOKEN));
    const idx2 = await request(h, { path: '/index.html' });
    eq('V10 GET /index.html เหมือนกับ /', idx2.text, idx.text);
    const css = await request(h, { path: '/css/app.css' });
    eq('V10 ไฟล์ static อื่นไม่ถูกแก้', css.text, CSS);
    const mk = await request(h, { path: '/js/marker.js' });
    eq('V10 ไฟล์อื่นที่มีข้อความ __LS_TOKEN__ ไม่ถูกแทนที่', mk.text, MARKER_JS);
    const a = await start({ token: undefined });
    const b = await start({ token: undefined });
    const tokOf = async (x) => { const m = /name="ls-token" content="([^"]*)"/.exec((await request(x, { path: '/', token: null })).text); return m && m[1]; };
    const ta = await tokOf(a); const tb = await tokOf(b);
    ok('V10 token สุ่มต่อการเปิดเซิร์ฟเวอร์ (hex 48 ตัว ไม่ซ้ำกัน)', /^[0-9a-f]{48}$/.test(ta || '') && /^[0-9a-f]{48}$/.test(tb || '') && ta !== tb, `${ta} ${tb}`);
    eq('V10 token สุ่มใช้เรียก API ได้', (await request(a, { path: '/api/projects', token: ta })).status, 200);
  }

  /* ---------- timeouts / PORT / คำสั่งเปิดเบราว์เซอร์ / process guards / CLI ---------- */
  {
    const h = await start();
    eq('timeout: requestTimeout = 60s', h.server.requestTimeout, 60000);
    eq('timeout: headersTimeout = 15s', h.server.headersTimeout, 15000);
    eq('timeout: keepAliveTimeout = 5s', h.server.keepAliveTimeout, 5000);
    eq('listen: ผูก 127.0.0.1', h.server.address().address, '127.0.0.1');

    const pp = typeof S.parsePort === 'function' ? S.parsePort : () => 'no parsePort';
    for (const [v, want] of [[undefined, 5180], ['', 5180], ['abc', 5180], ['0', 5180], ['-1', 5180], ['70000', 5180], ['65536', 5180], ['12.5', 5180], ['1e3', 5180], [' 80', 5180], ['80; calc', 5180], ['8080', 8080], ['1', 1], ['65535', 65535], ['5180', 5180]]) {
      eq(`PORT ${JSON.stringify(v)} → ${want}`, pp(v), want);
    }
    const oc = typeof S.openCommand === 'function' ? S.openCommand : () => 'no openCommand';
    eq('openCommand win32', oc(5180, 'win32'), 'start "" "http://localhost:5180"');
    eq('openCommand darwin', oc(5180, 'darwin'), 'open http://localhost:5180');
    eq('openCommand linux', oc(8080, 'linux'), 'xdg-open http://localhost:8080');
    eq('openCommand ปฏิเสธพอร์ตที่ไม่ใช่เลขจำนวนเต็ม 1-65535', ['5180; calc', '1 & calc', 0, 70000, 1.5, NaN, null].map((p) => oc(p, 'win32')), [null, null, null, null, null, null, null]);

    const guard = spawnSync(process.execPath, ['-e', `
      const s = require(${JSON.stringify(path.join(APP, 'server.js'))});
      s.installProcessGuards();
      setTimeout(() => { throw new Error('guard-sync-boom'); }, 10);
      setTimeout(() => { Promise.reject(new Error('guard-async-boom')); }, 30);
      setTimeout(() => { console.log('STILL-ALIVE'); }, 200);`], { encoding: 'utf8', timeout: 8000 });
    ok('process guards: uncaughtException/unhandledRejection ถูก log และ process ยังทำงานต่อ', /STILL-ALIVE/.test(guard.stdout || '') && guard.status === 0 && /guard-sync-boom/.test(guard.stderr || '') && /guard-async-boom/.test(guard.stderr || ''), `${guard.status} ${(guard.stderr || '').slice(0, 100)}`);
    const inert = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(APP, 'server.js'))}); console.log('L=' + process.listenerCount('uncaughtException'));`], { encoding: 'utf8', timeout: 8000 });
    ok('require("server.js") ไม่ listen และไม่ติด handler ระดับ process', inert.status === 0 && /L=0/.test(inert.stdout || ''), `${inert.status} ${inert.stdout}`);
  }
  {
    // เปิดด้วย `node server.js` จริง
    const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const cliProj = path.join(SANDBOX, 'cli-projects');
    const child = spawn(process.execPath, [path.join(APP, 'server.js')], { cwd: APP, env: Object.assign({}, process.env, { PORT: String(port), NO_OPEN: '1', LS_PROJECTS_DIR: cliProj }) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let exited = false; child.on('exit', () => { exited = true; });
    try {
      for (let i = 0; i < 50 && !out.includes(`http://localhost:${port}`) && !exited; i++) await sleep(100);
      ok('CLI: node server.js แสดง URL', out.includes(`http://localhost:${port}`), out.slice(0, 120));
      const h = { port, token: null };
      const idx = await request(h, { path: '/', token: null });
      const m = /name="ls-token" content="([^"]*)"/.exec(idx.text);
      ok('CLI: index.html มี token จริง (ไม่ใช่ __LS_TOKEN__)', idx.status === 200 && m && m[1] !== '__LS_TOKEN__' && /^[0-9a-f]{48}$/.test(m[1]), m && m[1]);
      h.token = m ? m[1] : '';
      ok('CLI: LS_PROJECTS_DIR ถูกใช้และสร้างให้เมื่อยังไม่มี', (await request(h, { path: '/api/projects' })).status === 200 && fs.existsSync(cliProj), cliProj);
      for (const t of ['GET /% HTTP/1.1', 'GET /api/projects/% HTTP/1.1', 'GET // HTTP/1.1']) await raw(h, `${t}\r\nHost: localhost:${port}\r\nx-ls-token: ${h.token}\r\nConnection: close\r\n\r\n`, 500);
      await sleep(100);
      ok('CLI: ยิง URL อันตรายแล้ว process ไม่ตายและยังตอบ', !exited && (await request(h, { path: '/api/library' })).status === 200, `exited=${exited} ${out.slice(-160)}`);
      const rb = await request({ port, token: h.token }, { path: '/', headers: { Host: 'evil.example' } });
      eq('CLI: Host ปลอมถูกปฏิเสธ', rb.status, 403);
    } finally { child.kill(); }
  }

  /* ---------- สรุป ---------- */
  eq('ไม่มี exception หลุดถึงระดับ process ตลอดการทดสอบ', uncaught, []);
  eq('ไม่มี header Access-Control-* ในทุก response', acHeaders, []);
}

main().catch((e) => { fail++; console.log('FAIL  การทดสอบหยุดกลางคัน  → ' + String(e && e.stack || e).replace(/\s+/g, ' ').slice(0, 300)); }).finally(async () => {
  await closeAll();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log(fail ? `\n${fail} รายการไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(fail ? 1 : 0);
});
