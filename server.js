// เซิร์ฟเวอร์ local ขนาดเล็ก (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม) — รัน: node server.js
// ผูกที่ 127.0.0.1 เท่านั้น. ป้องกัน: DNS-rebinding/CSRF (Host + Origin + token ต่อการเปิด + application/json),
// path traversal, process crash, body UTF-8/ขนาด, header ความปลอดภัย
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const DEFAULT_ROOT = path.join(__dirname, 'public');
const DEFAULT_PROJECTS = path.join(__dirname, 'projects');
const DEFAULT_PORT = 5180;
const MAX_PROJECT_BYTES = 20e6;
const TOKEN_PLACEHOLDER = '__LS_TOKEN__';
const PLAN_ID = /^[A-Za-z0-9_-]{1,40}$/; // ตรงกับ app.js
const MAX_PLANS = 200;      // แปลนที่ส่งให้หน้าเว็บต่อครั้ง (ใหม่สุดก่อน)
const MAX_LOGS = 5000;      // บันทึกกิจกรรมที่เก็บบนดิสก์
const MAX_LOG_SEND = 800;   // ส่งให้หน้าเว็บเฉพาะล่าสุด (เท่ากับที่เบราว์เซอร์เก็บ)
const MAX_VERSIONS = 40;    // เวอร์ชันย้อนหลังต่อแปลน (เก่าสุดถูกลบเมื่อเกิน)
const LOG_TYPES = ['plan', 'item', 'panel', 'circuit', 'breaker', 'balance', 'setting', 'file', 'import'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8'
};

// CSP ใช้กับ response ที่เป็น HTML (แอปใช้ pdf.js/tesseract worker จาก /vendor, style="" inline, favicon แบบ data:)
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// ชื่อที่ Windows สงวนไว้เป็นอุปกรณ์ (ใช้กับ "ส่วนก่อนจุดแรก" ของชื่อไฟล์)
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;

function parsePort(v) {
  const s = v == null ? '' : String(v);
  if (!/^[0-9]{1,5}$/.test(s)) return DEFAULT_PORT;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : DEFAULT_PORT;
}

// คำสั่งเปิดเบราว์เซอร์ — รับเฉพาะพอร์ตที่เป็นเลขจำนวนเต็ม 1-65535 และสร้าง URL เอง ไม่รับข้อความจากภายนอก
function openCommand(port, platform) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const u = `http://localhost:${port}`;
  const p = platform || process.platform;
  return p === 'win32' ? `start "" "${u}"` : p === 'darwin' ? `open ${u}` : `xdg-open ${u}`;
}

function safeName(n) {
  let s = (typeof n === 'string' || typeof n === 'number') ? String(n) : '';
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/[\\/:*?"<>|]+/g, '_').replace(/^\s+/, '');
  const dot = s.indexOf('.');
  const base = (dot < 0 ? s : s.slice(0, dot)).trimEnd();
  if (RESERVED.test(base)) s = s.slice(0, base.length) + '_' + s.slice(base.length);
  s = Array.from(s).slice(0, 80).join('').replace(/[.\s]+$/, '');
  return s || 'project';
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const redact = (s) => String(s == null ? '' : s).replace(/sk-ant-[A-Za-z0-9_-]+/g, '[key]');
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isJsonType = (req) => /^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] || ''));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, code, data, ext, extra) {
  const headers = Object.assign({ 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, extra);
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  res.writeHead(code, headers);
  res.end(data);
}
const sendJson = (res, code, obj, extra) => send(res, code, JSON.stringify(obj), '.json', Object.assign({ 'Cache-Control': 'no-store' }, extra));
const fail = (res, code, error, extra) => sendJson(res, code, { ok: false, error }, extra);

// อ่าน body เป็น Buffer จำกัดขนาดเป็น "ไบต์" แล้วค่อยแปลง UTF-8 ครั้งเดียวตอนจบ
// เกินเพดาน: หยุดเก็บทันที (ไม่กินหน่วยความจำเพิ่ม) แล้วทิ้งส่วนที่เหลือจนผู้ส่งส่งจบหรือครบ 3 วินาที จึงตอบ 413
// (ตอบทั้งที่ผู้ส่งยังส่งอยู่ ทำให้ปลายทางที่ไม่ใช้ keep-alive โดน reset ก่อนอ่านคำตอบ).
// ถ้า Content-Length ที่ประกาศมาเกินเพดานอยู่แล้ว ตอบ 413 ทันทีโดยไม่รอ body
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, 'ไฟล์ใหญ่เกินไป');
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > limit) return reject(tooBig());
    const chunks = [];
    let size = 0;
    let over = false;
    let grace = null;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; grace = setTimeout(() => reject(tooBig()), 3000); } else chunks.push(c);
    });
    req.once('end', () => { clearTimeout(grace); if (over) reject(tooBig()); else resolve(Buffer.concat(chunks, size)); });
    req.once('error', () => { clearTimeout(grace); reject(new HttpError(400, 'อ่านคำขอไม่สำเร็จ')); });
    req.once('close', () => { if (!req.complete) { clearTimeout(grace); reject(new HttpError(400, 'คำขอไม่สมบูรณ์')); } });
  });
}
function parseJsonBody(buf) {
  let t = buf.toString('utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return JSON.parse(t);
}

function createServer(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const projectsDir = path.resolve(opts.projectsDir || process.env.LS_PROJECTS_DIR || DEFAULT_PROJECTS);
  const token = typeof opts.token === 'string' && opts.token ? opts.token : crypto.randomBytes(24).toString('hex');
  const tokenHash = sha256(token);
  const maxProject = opts.maxProjectBytes || MAX_PROJECT_BYTES;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => internalError(res, e));
  });
  server.requestTimeout = 60 * 1000;
  server.headersTimeout = 15 * 1000;
  server.keepAliveTimeout = 5 * 1000;
  server.on('clientError', (err, socket) => {
    if (!socket.writable || socket.destroyed) return socket.destroy();
    const status = err && err.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' : '400 Bad Request';
    const hdr = Object.entries(SECURITY_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status}\r\n${hdr}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  });

  const livePort = () => { const a = server.address(); return a && typeof a === 'object' ? a.port : (opts.port || 0); };
  const hostOk = (h) => {
    if (typeof h !== 'string') return false;
    const p = livePort(); const l = h.toLowerCase();
    return l === `localhost:${p}` || l === `127.0.0.1:${p}` || l === `[::1]:${p}`;
  };
  const originOk = (o) => {
    if (typeof o !== 'string') return false;
    const p = livePort(); const l = o.toLowerCase();
    return l === `http://localhost:${p}` || l === `http://127.0.0.1:${p}` || l === `http://[::1]:${p}`;
  };
  const tokenOk = (v) => typeof v === 'string' && crypto.timingSafeEqual(sha256(v), tokenHash);

  function internalError(res, e) {
    console.error('[server] error:', redact(e && e.message).slice(0, 200));
    try {
      if (!res.headersSent) fail(res, 500, 'internal error');
      else res.destroy();
    } catch (e2) { try { res.destroy(); } catch (e3) { /* ignore */ } }
  }

  async function handle(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    if (!hostOk(req.headers.host)) return fail(res, 403, 'forbidden');
    if (req.headers.origin !== undefined && !originOk(req.headers.origin)) return fail(res, 403, 'forbidden');
    if (req.method === 'OPTIONS') return fail(res, 403, 'forbidden'); // ไม่มี CORS preflight และไม่ส่ง Access-Control-* เลย

    const url = req.url || '';
    if (url.charAt(0) !== '/') return fail(res, 400, 'bad request');
    const q = url.indexOf('?');
    const rawPath = q < 0 ? url : url.slice(0, q);
    let segs;
    try { segs = rawPath.split('/').slice(1).map((s) => decodeURIComponent(s)); } catch (e) { return fail(res, 400, 'bad request'); }
    for (let i = 0; i < segs.length; i++) {
      if (/[\u0000-\u001f\u007f]/.test(segs[i]) || (segs[i] === '' && i < segs.length - 1)) return fail(res, 400, 'bad request');
    }

    if (segs[0] === 'api') {
      if (!tokenOk(req.headers['x-ls-token'])) return fail(res, 403, 'forbidden');
      return api(req, res, segs.slice(1));
    }
    return serveStatic(req, res, segs);
  }

  /* ---------- API ---------- */
  function api(req, res, rest) {
    const [a, b] = rest;
    if (a === 'projects' && rest.length === 1) {
      if (req.method === 'GET') return listProjects(res);
      if (req.method === 'POST') return saveProject(req, res);
      return fail(res, 405, 'method not allowed', { Allow: 'GET, POST' });
    }
    if (a === 'projects' && rest.length === 2 && b !== '') {
      if (req.method !== 'GET') return fail(res, 405, 'method not allowed', { Allow: 'GET' });
      return getProject(res, b);
    }
    if (a === 'library' && rest.length === 1) {
      if (req.method !== 'GET') return fail(res, 405, 'method not allowed', { Allow: 'GET' });
      return listLibrary(res);
    }
    if (a === 'library' && rest.length === 2) {
      if (!PLAN_ID.test(b)) return fail(res, 400, 'รหัสแปลนไม่ถูกต้อง');
      if (req.method === 'PUT') return putPlan(req, res, b);
      if (req.method === 'DELETE') return deletePlan(res, b);
      return fail(res, 405, 'method not allowed', { Allow: 'PUT, DELETE' });
    }
    if (a === 'history' && (rest.length === 2 || rest.length === 3)) {
      if (!PLAN_ID.test(b)) return fail(res, 400, 'รหัสแปลนไม่ถูกต้อง');
      if (rest.length === 3) {
        if (!/^\d{1,16}$/.test(rest[2])) return fail(res, 400, 'รหัสเวอร์ชันไม่ถูกต้อง');
        if (req.method !== 'GET') return fail(res, 405, 'method not allowed', { Allow: 'GET' });
        return getVersion(res, b, rest[2]);
      }
      if (req.method === 'GET') return listVersions(res, b);
      if (req.method === 'POST') return saveVersion(req, res, b);
      return fail(res, 405, 'method not allowed', { Allow: 'GET, POST' });
    }
    if (a === 'logs' && rest.length === 1) {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, logs: readLogs() });
      if (req.method === 'POST') return appendLogs(req, res);
      if (req.method === 'DELETE') return clearLogs(res);
      return fail(res, 405, 'method not allowed', { Allow: 'GET, POST, DELETE' });
    }
    return fail(res, 404, 'not found');
  }

  const ensureProjectsDir = () => fs.mkdirSync(projectsDir, { recursive: true });

  function listProjects(res) {
    let names = [];
    try { ensureProjectsDir(); names = fs.readdirSync(projectsDir); } catch (e) { names = []; }
    const list = [];
    for (const f of names) {
      if (!f.endsWith('.json')) continue;
      try {
        const st = fs.statSync(path.join(projectsDir, f));
        if (st.isFile()) list.push({ file: f, modified: st.mtime });
      } catch (e) { /* ไฟล์หายระหว่างอ่าน */ }
    }
    list.sort((x, y) => y.modified - x.modified);
    return send(res, 200, JSON.stringify(list), '.json', { 'Cache-Control': 'no-store' });
  }

  function getProject(res, name) {
    const file = path.join(projectsDir, safeName(name.replace(/\.json$/i, '')) + '.json');
    if (path.dirname(file) !== projectsDir) return send(res, 404, '{}', '.json');
    let data;
    try {
      if (!fs.statSync(file).isFile()) return send(res, 404, '{}', '.json');
      data = fs.readFileSync(file);
    } catch (e) { return send(res, 404, '{}', '.json'); }
    return send(res, 200, data, '.json', { 'Cache-Control': 'no-store' });
  }

  // อ่าน + ตรวจ body ของ POST; คืน undefined หลังตอบ error ให้แล้ว
  async function readJsonBody(req, res, limit) {
    if (!isJsonType(req)) { fail(res, 415, 'ต้องส่งเป็น Content-Type: application/json'); return undefined; }
    let buf;
    try { buf = await readBody(req, limit); } catch (e) {
      if (e instanceof HttpError) {
        fail(res, e.status, e.message);
        if (e.status === 413) { // ตอบแล้วทิ้งส่วนที่เหลือ; ถ้าผู้ส่งยังไม่เลิกส่งภายใน 3 วินาทีให้ตัดการเชื่อมต่อ
          const t = setTimeout(() => req.destroy(), 3000);
          t.unref();
          req.once('close', () => clearTimeout(t));
        }
        return undefined;
      }
      throw e;
    }
    try { return { value: parseJsonBody(buf) }; } catch (e) { fail(res, 400, 'JSON ไม่ถูกต้อง'); return undefined; }
  }

  async function saveProject(req, res) {
    const body = await readJsonBody(req, res, maxProject);
    if (!body) return;
    const p = body.value;
    if (!isPlain(p) || !isPlain(p.meta) || !Array.isArray(p.panels) || !Array.isArray(p.items)) {
      return fail(res, 400, 'รูปแบบโครงการไม่ถูกต้อง (ต้องมี meta เป็นอ็อบเจกต์, panels และ items เป็นอาร์เรย์)');
    }
    const file = safeName(p.meta.name) + '.json';
    try {
      ensureProjectsDir();
      fs.writeFileSync(path.join(projectsDir, file), JSON.stringify(p, null, 2), 'utf8');
    } catch (e) {
      console.error('[server] บันทึกไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'บันทึกไฟล์ไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true, file });
  }

  /* ---------- ห้องสมุดแปลน + บันทึกกิจกรรม (projects/library/) ----------
   * <id>.plan.json = แปลนละไฟล์ {id,name,updated,project} · deleted.json = {id: เวลาที่ลบ} (กันเครื่อง/แท็บที่ค้างไว้ดึงกลับมา)
   * activity.jsonl = บันทึกกิจกรรมบรรทัดละรายการ เก็บล่าสุด MAX_LOGS รายการ */
  const libDir = path.join(projectsDir, 'library');
  const planFile = (id) => path.join(libDir, id + '.plan.json');
  const tombFile = path.join(libDir, 'deleted.json');
  const logFile = path.join(libDir, 'activity.jsonl');
  const ensureLibDir = () => fs.mkdirSync(libDir, { recursive: true });
  // เขียนไฟล์ใหม่ทั้งไฟล์แบบไม่ค้างครึ่ง ๆ (เขียนไฟล์ชั่วคราวแล้ว rename ทับ)
  function writeAtomic(file, text) {
    ensureLibDir();
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }   // ลงดิสก์จริงก่อน rename (ไฟดับแล้วไม่ได้ไฟล์ว่าง)
      fs.renameSync(tmp, file);
    } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ } throw e; }
  }
  const readJsonFile = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };
  function readTombs() {
    const t = readJsonFile(tombFile), out = {};
    if (isPlain(t)) for (const [k, v] of Object.entries(t)) if (PLAN_ID.test(k) && Number.isFinite(v)) out[k] = v;
    return out;
  }
  const okPlan = (x) => isPlain(x) && PLAN_ID.test(String(x.id)) && Number.isFinite(x.updated) && typeof x.name === 'string' &&
    isPlain(x.project) && isPlain(x.project.meta) && Array.isArray(x.project.panels) && Array.isArray(x.project.items);

  function listLibrary(res) {
    let names = [];
    try { names = fs.readdirSync(libDir); } catch (e) { names = []; }
    const plans = [];
    for (const f of names) {
      if (!f.endsWith('.plan.json')) continue;
      const p = readJsonFile(path.join(libDir, f));
      if (okPlan(p) && p.id + '.plan.json' === f) plans.push(p);
    }
    plans.sort((x, y) => y.updated - x.updated);
    return sendJson(res, 200, { ok: true, plans: plans.slice(0, MAX_PLANS), deleted: readTombs() });
  }

  // เก็บฉบับที่ updated ใหม่กว่าเสมอ (เครื่อง/แท็บที่ค้างไว้นานส่งฉบับเก่ามาจะไม่ทับ) — เขียนเองถือว่ากู้แปลนที่เคยลบ
  async function putPlan(req, res, id) {
    const body = await readJsonBody(req, res, maxProject);
    if (!body) return;
    const p = body.value;
    if (!okPlan(p) || p.id !== id) return fail(res, 400, 'รูปแบบแปลนไม่ถูกต้อง');
    // นาฬิกาเครื่องที่เดินเร็วเกินไปต้องไม่ล็อกแปลนไว้ (ฉบับจาก "อนาคต" จะชนะทุกเครื่องตลอดไป) — จำกัดไม่เกินเวลาเซิร์ฟเวอร์ + 5 นาที
    const plan = { id, name: p.name.slice(0, 100), updated: Math.min(p.updated, Date.now() + 5 * 60 * 1000), project: p.project };
    const cur = readJsonFile(planFile(id));
    if (okPlan(cur) && cur.updated > plan.updated) return sendJson(res, 200, { ok: true, stored: false, updated: cur.updated });
    // ฉบับที่แก้ก่อนเวลาที่ถูกลบ (แท็บ/เครื่องที่ค้างคิวไว้) ไม่ดึงแปลนที่ลบแล้วกลับมา — กู้คืนต้องส่งฉบับที่ใหม่กว่าเวลาลบ
    const tomb0 = readTombs()[id];
    if (tomb0 !== undefined && tomb0 >= plan.updated) return sendJson(res, 200, { ok: true, stored: false, deleted: true });
    try {
      writeAtomic(planFile(id), JSON.stringify(plan));
      const tombs = readTombs();
      if (tombs[id] !== undefined) { delete tombs[id]; writeAtomic(tombFile, JSON.stringify(tombs)); }
    } catch (e) {
      console.error('[server] บันทึกแปลนไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'บันทึกแปลนไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true, stored: true, updated: plan.updated });
  }

  function deletePlan(res, id) {
    try {
      try { fs.unlinkSync(planFile(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.rmSync(histDir(id), { recursive: true, force: true });   // ประวัติเวอร์ชันของแปลนที่ลบไม่ค้างกินดิสก์
      const tombs = readTombs();
      tombs[id] = Date.now();
      // เก็บป้ายลบไว้ไม่เกิน 500 รายการล่าสุด
      const keep = Object.entries(tombs).sort((x, y) => y[1] - x[1]).slice(0, 500);
      writeAtomic(tombFile, JSON.stringify(Object.fromEntries(keep)));
    } catch (e) {
      console.error('[server] ลบแปลนไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'ลบแปลนไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- ประวัติเวอร์ชัน: library/history/<id>/<เวลา>.json = { v, t, name, note, auto, project } ---------- */
  const histDir = (id) => path.join(libDir, 'history', id);
  function versionFiles(id) {
    let names = [];
    try { names = fs.readdirSync(histDir(id)); } catch (e) { names = []; }
    return names.filter((f) => /^\d{1,16}\.json$/.test(f)).map((f) => Number(f.slice(0, -5))).sort((x, y) => y - x);
  }
  // index.json = สรุปเวอร์ชัน (ไม่มี project) — รายการเวอร์ชันไม่ต้องอ่าน snapshot ใหญ่ทุกไฟล์ ; หาย/ไม่ตรงไฟล์ → สร้างใหม่จากไฟล์
  const metaOf = (v, x) => ({ v, t: Number.isFinite(x.t) ? x.t : v, name: typeof x.name === 'string' ? x.name : '', note: typeof x.note === 'string' ? x.note : '', auto: !!x.auto });
  function versionIndex(id) {
    const files = versionFiles(id), idx = readJsonFile(path.join(histDir(id), 'index.json'));
    if (Array.isArray(idx) && idx.length === files.length && idx.every((m, i) => isPlain(m) && m.v === files[i])) return idx;
    const out = [];
    for (const v of files) { const x = readJsonFile(path.join(histDir(id), v + '.json')); if (isPlain(x) && isPlain(x.project)) out.push(metaOf(v, x)); }
    if (files.length) { try { writeAtomic(path.join(histDir(id), 'index.json'), JSON.stringify(out)); } catch (e) { /* ใช้ค่าที่อ่านได้ไปก่อน */ } }
    return out;
  }
  function listVersions(res, id) {
    return sendJson(res, 200, { ok: true, versions: versionIndex(id) });
  }
  function getVersion(res, id, v) {
    const x = readJsonFile(path.join(histDir(id), Number(v) + '.json'));
    if (!isPlain(x) || !isPlain(x.project)) return fail(res, 404, 'ไม่พบเวอร์ชันนี้');
    return sendJson(res, 200, { ok: true, version: x });
  }
  async function saveVersion(req, res, id) {
    const body = await readJsonBody(req, res, maxProject);
    if (!body) return;
    const x = body.value, p = isPlain(x) ? x.project : null;
    if (!isPlain(p) || !isPlain(p.meta) || !Array.isArray(p.panels) || !Array.isArray(p.items)) return fail(res, 400, 'รูปแบบเวอร์ชันไม่ถูกต้อง');
    let v = Date.now();
    const have = new Set(versionFiles(id));
    while (have.has(v)) v++;   // บันทึกสองครั้งในมิลลิวินาทีเดียวกันไม่ทับกัน
    const rec = { v, t: v, name: typeof x.name === 'string' ? x.name.slice(0, 100) : '', note: typeof x.note === 'string' ? x.note.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200) : '', auto: !!x.auto, project: p };
    try {
      fs.mkdirSync(histDir(id), { recursive: true });
      const prevIdx = versionIndex(id);
      writeAtomic(path.join(histDir(id), v + '.json'), JSON.stringify(rec));
      const drop = new Set(versionFiles(id).slice(MAX_VERSIONS));
      drop.forEach((old) => { try { fs.unlinkSync(path.join(histDir(id), old + '.json')); } catch (e) { /* ignore */ } });
      const idx = [metaOf(v, rec)].concat(prevIdx).filter((m) => !drop.has(m.v)).sort((a, b) => b.v - a.v);
      writeAtomic(path.join(histDir(id), 'index.json'), JSON.stringify(idx));
    } catch (e) {
      console.error('[server] บันทึกเวอร์ชันไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'บันทึกเวอร์ชันไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true, v });
  }

  const okLog = (x) => isPlain(x) && Number.isFinite(x.t) && typeof x.msg === 'string' && LOG_TYPES.includes(x.type);
  const cleanLog = (x) => ({ t: x.t, type: x.type, msg: x.msg.slice(0, 300), pid: PLAN_ID.test(String(x.pid)) ? x.pid : '', pn: typeof x.pn === 'string' ? x.pn.slice(0, 100) : '' });
  const logKey = (l) => l.t + '|' + l.pid + '|' + l.msg;
  let logCache = null; // อ่านไฟล์ครั้งแรกแล้วจำไว้ (เซิร์ฟเวอร์เป็นผู้เขียนไฟล์นี้คนเดียว)
  function loadLogs() {
    if (logCache) return logCache;
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch (e) { text = ''; }
    const seen = new Set();
    logCache = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let x; try { x = JSON.parse(line); } catch (e) { continue; }
      if (!okLog(x)) continue;
      const l = cleanLog(x), k = logKey(l);
      if (!seen.has(k)) { seen.add(k); logCache.push(l); }
    }
    logCache.sort((x, y) => x.t - y.t);
    if (logCache.length > MAX_LOGS) logCache = logCache.slice(-MAX_LOGS);
    return logCache;
  }
  const readLogs = () => loadLogs().slice(-MAX_LOG_SEND).reverse(); // ล่าสุดก่อน

  async function appendLogs(req, res) {
    const body = await readJsonBody(req, res, 2e6);
    if (!body) return;
    const v = body.value;
    const list = isPlain(v) && Array.isArray(v.logs) ? v.logs : null;
    if (!list || list.length > 1000) return fail(res, 400, 'รูปแบบบันทึกไม่ถูกต้อง');
    const cur = loadLogs(), seen = new Set(cur.map(logKey)), add = [];
    for (const x of list) {
      if (!okLog(x)) continue;
      const l = cleanLog(x), k = logKey(l);
      if (!seen.has(k)) { seen.add(k); add.push(l); }
    }
    if (!add.length) return sendJson(res, 200, { ok: true, added: 0 });
    try {
      ensureLibDir();
      cur.push(...add);
      cur.sort((x, y) => x.t - y.t); // เกือบเรียงอยู่แล้ว (แท็บอื่นส่งของเก่ามาช้า) — sort ถูก
      if (cur.length > MAX_LOGS * 1.2) { // ล้นเพดาน: ตัดของเก่าทิ้งแล้วเขียนทั้งไฟล์ใหม่ครั้งเดียว
        logCache = cur.slice(-MAX_LOGS);
        writeAtomic(logFile, logCache.map((l) => JSON.stringify(l)).join('\n') + '\n');
      } else {
        // บรรทัดท้ายไฟล์ขาดกลางคัน (ไฟดับระหว่างเขียน) → ขึ้นบรรทัดใหม่ก่อน ไม่ให้รายการใหม่ไปต่อท้ายบรรทัดเสีย
        let lead = '';
        try { const st = fs.statSync(logFile); if (st.size) { const fd = fs.openSync(logFile, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, st.size - 1); fs.closeSync(fd); if (b[0] !== 10) lead = '\n'; } } catch (e) { /* ยังไม่มีไฟล์ */ }
        fs.appendFileSync(logFile, lead + add.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
      }
    } catch (e) {
      logCache = null; // อ่านไฟล์ใหม่ครั้งหน้า ให้ตรงกับที่อยู่บนดิสก์จริง
      console.error('[server] บันทึก log ไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'บันทึก log ไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true, added: add.length });
  }

  function clearLogs(res) {
    try { ensureLibDir(); writeAtomic(logFile, ''); logCache = []; } catch (e) {
      console.error('[server] ล้าง log ไม่สำเร็จ:', redact(e && e.code));
      return fail(res, 500, 'ล้าง log ไม่สำเร็จ');
    }
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- ไฟล์ static ---------- */
  async function serveStatic(req, res, segs) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    if (segs.length === 1 && segs[0] === 'favicon.ico') { res.writeHead(204); return res.end(); }

    const parts = segs.filter((s, i) => !(s === '' && i === segs.length - 1));
    for (const s of parts) {
      // ไม่รับ .. / . / "/" ที่ซ่อนมาด้วย %2f / backslash / ":" (drive letter, alternate data stream) / อักขระที่ Windows ไม่ยอมรับ / จุดหรือช่องว่างท้ายชื่อ
      if (s === '.' || s === '..' || /[\\/:*?"<>|]/.test(s) || /[. ]$/.test(s)) return fail(res, 400, 'bad request');
      if (RESERVED.test(s.split('.')[0].trimEnd())) return send(res, 404, 'not found', '.html');
    }
    const file = path.join(root, ...(parts.length ? parts : ['index.html']));
    if (file !== root && !file.startsWith(root + path.sep)) return fail(res, 403, 'forbidden');

    let data;
    try { data = await fs.promises.readFile(file); } catch (e) { return send(res, 404, 'not found', '.html'); }
    const ext = path.extname(file).toLowerCase();
    if (path.dirname(file).toLowerCase() === root.toLowerCase() && path.basename(file).toLowerCase() === 'index.html') {
      data = Buffer.from(data.toString('utf8').split(TOKEN_PLACEHOLDER).join(token), 'utf8');
      return send(res, 200, data, '.html', { 'Cache-Control': 'no-store' });
    }
    return send(res, 200, data, ext);
  }

  return server;
}

let guardsInstalled = false;
function installProcessGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const brief = (e) => redact((e && e.stack) || e).split('\n').slice(0, 4).join(' | ');
  process.on('uncaughtException', (e) => { console.error('[uncaughtException]', brief(e)); });
  process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', brief(e)); });
}

module.exports = { createServer, safeName, parsePort, openCommand, installProcessGuards, CSP };

if (require.main === module) {
  installProcessGuards();
  const PORT = parsePort(process.env.PORT);
  const server = createServer({ port: PORT });
  server.on('error', (e) => {
    console.error(e && e.code === 'EADDRINUSE' ? `\n  พอร์ต ${PORT} ถูกใช้งานอยู่แล้ว — ปิดโปรแกรมเดิม หรือตั้งค่า PORT เป็นเลขอื่น\n` : '[server] error: ' + redact(e && e.message));
    if (!server.listening) process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    try { fs.mkdirSync(path.resolve(process.env.LS_PROJECTS_DIR || DEFAULT_PROJECTS), { recursive: true }); } catch (e) { /* สร้างตอนบันทึกแทน */ }
    const u = `http://localhost:${PORT}`;
    console.log(`\n  ตารางโหลดสำเร็จรูป  →  ${u}\n  (กด Ctrl+C เพื่อปิด)\n`);
    const cmd = openCommand(PORT);
    if (cmd && !process.env.NO_OPEN) exec(cmd, () => {});
  });
}
