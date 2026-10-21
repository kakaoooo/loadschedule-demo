// สุขอนามัยของไฟล์ที่ deploy: ไม่มี placeholder token หลงเหลือ · CSP เหมือนกันทุกที่และรองรับ OCR (wasm ฝังเป็น data:) โดยไม่เปิด eval/inline script
// รัน: node tests/deploy-hygiene.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const B = require('../scripts/build-demo.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('H1 build-demo: index.html ที่ deploy ไม่มี __LS_TOKEN__ / meta ls-token (ของ server.js เท่านั้น) แต่ public/ ยังมีไว้ให้ server.js แทนค่า', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  try {
    B.build({}, out);
    const idx = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert(!/__LS_TOKEN__|ls-token/.test(idx), 'dist ยังมี token placeholder');
    assert(idx.includes('<meta charset="utf-8">') && idx.includes('js/onboarding.js'), 'index.html ต้องยังสมบูรณ์');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  assert(read('public/index.html').includes('__LS_TOKEN__'), 'public/index.html ต้องมี placeholder ให้ server.js');
});

test('H2 CSP ตรงกันทั้ง index.html / _headers / server.js : connect-src มี data: (Tesseract fetch wasm ฝัง) และไม่มี unsafe-eval / unsafe-inline ใน script-src', () => {
  const csp = {
    meta: read('public/index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1],
    headers: read('public/_headers').match(/Content-Security-Policy:\s*([^\n]+)/)[1].trim(),
    server: read('server.js').match(/const CSP = "([^"]+)"/)[1]
  };
  Object.entries(csp).forEach(([k, v]) => {
    assert(/connect-src 'self' https:\/\/\*\.supabase\.co data:/.test(v), k + ': connect-src');
    assert(!/'unsafe-eval'|script-src[^;]*'unsafe-inline'/.test(v), k + ': script-src');
  });
  const core = (v) => v.split(';').map((x) => x.trim()).filter((x) => /^(default|script|worker|child|connect|object|base|form)-?/.test(x)).join(';');
  eq(core(csp.meta).replace(/\s+frame-ancestors[^;]*/, ''), core(csp.server).replace(/\s+frame-ancestors[^;]*/, ''));
});

test('H3 OCR ใช้ไฟล์ในเครื่องทั้งหมด (worker/core/lang จาก vendor/tesseract) ไม่ดึงจากโดเมนนอก', () => {
  const r = read('public/js/reader.js');
  ['vendor/tesseract/worker.min.js', 'vendor/tesseract/core', 'vendor/tesseract/lang'].forEach((p) => assert(r.includes(p), p));
  assert(!/https?:\/\/(?!www\.w3\.org)/.test(r.replace(/\/\/.*$/gm, '')), 'reader.js อ้าง URL ภายนอก');
  ['worker.min.js'].forEach((f) => assert(fs.existsSync(path.join(ROOT, 'public/vendor/tesseract', f)), f));
  ['tha.traineddata.gz', 'eng.traineddata.gz'].forEach((f) => assert(fs.existsSync(path.join(ROOT, 'public/vendor/tesseract/lang', f)), f));
});
done();
