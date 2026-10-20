// เวอร์ชันสาธิต (Public Demo): โค้ดส่งออกต้องไม่อยู่ในซอร์ส, ลายน้ำต้องครบ, ตัวดัก/Supabase/SQL/build ต้องปลอดภัย
// รัน: node tests/demo-security.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const E = require('../public/js/engine.js');
const D = E.D;
const sample = JSON.parse(read('test/sample-project.json'));
const result = E.calculate(sample);

// โหลดสคริปต์ browser (IIFE ที่ผูกกับ globalThis) แบบสด ๆ ภายใต้ globals ที่กำหนด แล้วคืน sandbox
function load(file, globals) {
  const ctx = Object.assign({ console, URL }, globals || {});
  ctx.globalThis = ctx; ctx.self = ctx; ctx.window = undefined;
  vm.runInNewContext(read('public/js/' + file), ctx, { filename: file });
  return ctx;
}
const guardStub = (over) => {
  const calls = [];
  const g = Object.assign({ isDemo: () => true, config: { watermarkText: 'Ver.DEMO — Made by Test Owner', watermarkSubText: 'FOR DEMO' }, interceptExport: (f) => { calls.push(f); return false; } }, over || {});
  return { g, calls };
};
const exportCtx = (g) => { const c = { LoadEngine: E, LS_DATA: D, fmt: E.fmt, DemoGuard: g }; c.self = c; c.globalThis = c; vm.runInNewContext(read('public/js/export.js'), c); return c.Report; };

/* ---------- 1) โค้ดส่งออกถูกถอดออกจริง ---------- */
test('S1 dxf.js เป็น stub: build() คืนค่าว่างและเรียกตัวดัก ; ไม่มีโค้ดเขียน DXF ในไฟล์', () => {
  const { g, calls } = guardStub();
  const c = load('dxf.js', { DemoGuard: g });
  eq(c.SldDXF.build(result), '');
  eq(calls, ['AutoCAD DXF (.dxf)']);
  const src = read('public/js/dxf.js');
  assert(!/AC1009|ENDSEC|SECTION|\bLAYER\b|\$ACADVER/.test(src.replace(/\/\*[\s\S]*?\*\//, '')), 'พบโค้ด DXF');
  assert(src.length < 1500, 'dxf.js ควรเล็กมาก (stub) แต่ ' + src.length);
});
test('S2 xlsx-io.js: ไม่มี writer/zip/crc32 ; exportXlsx/buildSheets/writeXlsx เป็น stub ; ส่วนอ่านไฟล์นำเข้ายังอยู่', () => {
  const { g, calls } = guardStub();
  const c = load('xlsx-io.js', { DemoGuard: g });
  const X = c.XlsxIO;
  ['exportXlsx', 'buildSheets', 'writeXlsx'].forEach((k) => eq(X[k](result), null, k));
  eq(calls.length, 3);
  assert(calls.every((x) => /xlsx/i.test(x)), calls.join());
  ['readFile', 'readWorkbook', 'describe', 'bookText', 'scheduleText', 'tableText', 'precheck'].forEach((k) => assert(typeof X[k] === 'function', 'หายไป: ' + k));
  ['crc32', 'zip', 'sheetName'].forEach((k) => assert(!(k in X), 'ยังเหลือ ' + k));
  const src = read('public/js/xlsx-io.js');
  assert(!/\[Content_Types\]|xl\/worksheets|<styleSheet|CRC_T|function zip|function sheetXML|serviceSheet|panelSheet/.test(src), 'พบโค้ดเขียน xlsx');
});
test('S3 export.js: allCSV/panelCSV ถูกดัก (CSV) ; reportHTML ถูกดัก (PDF) และไม่มีตัวประกอบหน้ารายงานในซอร์ส', () => {
  const { g, calls } = guardStub();
  const R = exportCtx(g);
  eq(R.allCSV(result), ''); eq(R.panelCSV(result.panels[0], result), '');
  const h = R.reportHTML(result);
  assert(/Ver\.DEMO/.test(h) && !/class="page/.test(h), 'reportHTML ต้องเป็นข้อความบล็อกเท่านั้น');
  eq(calls, ['CSV', 'CSV', 'PDF']);
  const src = read('public/js/export.js');
  assert(!/ภาคผนวก — รายการคำนวณ|สารบัญแผ่น|function panelCSVRows\(p, result/.test(src), 'พบโค้ดสร้างรายงาน/CSV');
});

/* ---------- 2) ลายน้ำ ---------- */
test('S4 ลายน้ำใน SVG ผังเส้นเดียว (data-el="demo-watermark") ฝังในเนื้อ SVG + escape ข้อความ + SVG ยัง well-formed', () => {
  const { g } = guardStub({ config: { watermarkText: 'Ver.DEMO — <img src=x onerror=alert(1)>', watermarkSubText: 'A & B' } });
  const R = exportCtx(g);
  const svg = R.sldSVG(result, R.feederNumbers(result));
  assert(svg.includes('data-el="demo-watermark"') && svg.includes('Ver.DEMO — &lt;img'), 'ไม่มีลายน้ำ/ไม่ escape');
  assert(!/<img src=x/.test(svg), 'ข้อความต้องถูก escape');
  assert((svg.match(/<svg\b/g) || []).length === 1 && svg.trim().endsWith('</svg>'), 'SVG ผิดรูป');
  assert(svg.indexOf('demo-watermark') > svg.lastIndexOf('data-el="load'), 'ลายน้ำควรอยู่ทับบนสุด (ท้าย SVG)');
});
test('S5 ตารางโหลดทุกแผงมีแถบลายน้ำหัว+ท้าย (data-el="schedule-watermark") และปิดได้เมื่อ enabled=false', () => {
  const { g } = guardStub();
  const R = exportCtx(g), f = R.feederNumbers(result);
  result.panels.filter((p) => p.isLP).forEach((p) => {
    const html = R.panelScheduleHTML(p, result, f);
    eq((html.match(/data-el="schedule-watermark"/g) || []).length, 2, p.id);
    assert(html.startsWith('<div class="demo-wm">') && html.includes('Made by Test Owner'), p.id);
  });
  const off = exportCtx(guardStub({ isDemo: () => false }).g);
  const html = off.panelScheduleHTML(result.panels.find((p) => p.isLP), result, off.feederNumbers(result));
  assert(!html.includes('schedule-watermark') && !off.sldSVG(result, off.feederNumbers(result)).includes('demo-watermark'), 'ต้องไม่มีลายน้ำเมื่อปิดโหมดสาธิต');
});

/* ---------- 3) DemoGuard ---------- */
const guardWith = (cfg, sup) => load('demo-guard.js', { DEMO_CONFIG: cfg, SupabaseDemo: sup }).DemoGuard;
test('S6 หน้าต่างล็อก: escape ชื่อ/ข้อความ, รับเฉพาะลิงก์ https, ไม่รับ javascript:/http:, อีเมลต้องถูกรูปแบบ, มีปุ่มปิดและ ARIA', () => {
  const G = guardWith({ ownerName: '<img src=x onerror=alert(1)>', redirectUrl: 'javascript:alert(1)', contactEmail: 'a"b@x.com' });
  const m = G.modalHTML('PDF');
  assert(!/<img src=x/.test(m) && /&lt;img/.test(m), 'ไม่ escape ชื่อเจ้าของ');
  assert(!/href="javascript/i.test(m) && !/class="demo-btn-primary"/.test(m), 'ต้องไม่มีปุ่มพาไป javascript:');
  assert(!/mailto:/.test(m), 'อีเมลผิดรูปแบบต้องไม่แสดง');
  assert(/role="dialog"/.test(m) && /data-demo-close/.test(m), 'ขาด ARIA/ปุ่มปิด');
  const ok = guardWith({ redirectUrl: 'https://example.com/me', contactEmail: 'me@example.com' }).modalHTML('CSV');
  assert(/href="https:\/\/example\.com\/me"/.test(ok) && /rel="noopener noreferrer"/.test(ok) && /mailto:me@example\.com/.test(ok), 'ลิงก์ถูกต้องต้องแสดง');
  eq([G.safeUrl('http://x.com'), G.safeUrl('data:text/html,1'), G.safeUrl('https://a.b/c')], ['', '', 'https://a.b/c']);
});
test('S7 interceptExport: คืน false เสมอ, ส่งสถิติครั้งเดียวต่อรูปแบบต่อนาที (กันยิงรัว), ไม่ล้มเมื่อ Supabase พัง', async () => {
  let n = 0; const seen = [];
  const sup = { logExportAttempt: (f) => { n++; seen.push(f); return Promise.reject(new Error('down')); } };
  const G = guardWith({}, sup);
  eq(G.interceptExport('PDF'), false);
  G.interceptExport('PDF'); G.interceptExport('PDF');
  G.interceptExport('CSV');
  eq(n, 2); eq(seen, ['PDF', 'CSV']);
  await new Promise((r) => setTimeout(r, 5));      // ไม่มี unhandled rejection
});
test('S8 บล็อกพิมพ์: ดัก Ctrl/Cmd+P (capture) และ beforeprint ; CSS พิมพ์ซ่อนทุกอย่างเหลือแต่ข้อความ Ver.DEMO', () => {
  const g = read('public/js/demo-guard.js'), css = read('public/css/print.css');
  assert(/addEventListener\('keydown'[\s\S]*?ctrlKey \|\| e\.metaKey[\s\S]*?=== 'p'[\s\S]*?preventDefault\(\)[\s\S]*?\}, true\)/.test(g), 'keydown Ctrl+P');
  assert(/addEventListener\('beforeprint', onPrintAttempt\)/.test(g), 'beforeprint');
  assert(/body\.demo-mode > \*:not\(#demo-print-blocker\) \{ display: none !important; \}/.test(css) && /body\.demo-mode #demo-print-blocker \{ display: flex !important;/.test(css), 'print.css');
});

/* ---------- 4) Supabase client ---------- */
const KEY = 'a'.repeat(40);
function supaCtx(cfg, fetchImpl, extra) {
  return load('supabase-client.js', Object.assign({ DEMO_CONFIG: cfg, fetch: fetchImpl, crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' }, navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' }, AbortController, setTimeout, clearTimeout }, extra || {})).SupabaseDemo;
}
const okJson = (body, status) => Promise.resolve({ ok: (status || 200) < 400, status: status || 200, json: async () => body });
test('S9 ไม่ได้ตั้งค่า Supabase = ไม่ยิงเครือข่ายเลย ; URL ต้องเป็น https://<ref>.supabase.co ; id ต้องเป็น UUID', async () => {
  let called = 0; const f = () => { called++; return okJson([]); };
  const off = supaCtx({}, f);
  eq(off.isConfigured(), false); eq(await off.listPresets(), []); eq(await off.loadProject('11111111-2222-4333-8444-555555555555'), null); await off.logExportAttempt('PDF');
  eq(called, 0);
  eq(supaCtx({ supabaseUrl: 'https://evil.example.com', supabaseAnonKey: KEY }, f).isConfigured(), false);
  eq(supaCtx({ supabaseUrl: 'http://abc.supabase.co', supabaseAnonKey: KEY }, f).isConfigured(), false);
  const on = supaCtx({ supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: KEY }, f);
  eq(on.isConfigured(), true);
  let threw = false; try { await on.loadProject("x' or 1=1"); } catch (e) { threw = true; }
  assert(threw && called === 0, 'id ไม่ถูกต้องต้องไม่ถึงเครือข่าย');
});
test('S10 logExportAttempt: ส่งเฉพาะ {attempted_format, client_kind} (ไม่มีชื่อโครงการ/User-Agent/IP) + กำหนดรูปแบบตามชุดที่ DB ยอมรับ', async () => {
  const reqs = [];
  const S = supaCtx({ supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: KEY }, (u, o) => { reqs.push({ u, o }); return okJson([]); });
  await S.logExportAttempt('PDF / พิมพ์', 'ชื่อโครงการลับ');
  await S.logExportAttempt('Excel (.xlsx)'); await S.logExportAttempt('AutoCAD DXF (.dxf)'); await S.logExportAttempt('อะไรก็ไม่รู้');
  const bodies = reqs.map((r) => JSON.parse(r.o.body));
  eq(bodies.map((b) => b.attempted_format), ['PDF', 'XLSX', 'DXF', 'OTHER']);
  bodies.forEach((b) => eq(Object.keys(b).sort(), ['attempted_format', 'client_kind']));
  assert(!reqs.some((r) => /ชื่อโครงการลับ|Mozilla/.test(r.o.body)), 'ห้ามรั่วชื่อโครงการ/UA');
  assert(reqs.every((r) => r.u === 'https://abcdefgh.supabase.co/rest/v1/demo_export_logs' && r.o.credentials === 'omit' && r.o.headers.apikey === KEY), 'URL/credentials/headers');
});
test('S11 saveShareableDemo: ตัดโลโก้, ส่งเฉพาะ id/title/project_data, id เป็น UUID, จำกัดขนาด, 429 ให้ข้อความที่เข้าใจได้', async () => {
  const reqs = [];
  const cfg = { supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: KEY };
  const S = supaCtx(cfg, (u, o) => { reqs.push({ u, o }); return okJson(null, 201); });
  const p = JSON.parse(JSON.stringify(sample)); p.meta.logo = 'data:image/png;base64,AAAA';
  const id = await S.saveShareableDemo('ชื่อ'.repeat(100), p);
  const b = JSON.parse(reqs[0].o.body);
  eq(id, '11111111-2222-4333-8444-555555555555');
  eq(Object.keys(b).sort(), ['id', 'project_data', 'title']);
  eq(b.project_data.meta.logo, ''); assert(b.title.length <= 120, 'title ยาวเกิน');
  eq(reqs[0].o.headers.Prefer, 'return=minimal');
  const big = JSON.parse(JSON.stringify(sample)); big.meta.name = 'x'.repeat(160000);
  let e1 = null; try { await S.saveShareableDemo('big', big); } catch (e) { e1 = e; }
  assert(e1 && /150 KB|ใหญ่/.test(e1.message), 'ต้องปฏิเสธโครงการใหญ่');
  const S429 = supaCtx(cfg, () => okJson(null, 429));
  let e2 = null; try { await S429.saveShareableDemo('t', sample); } catch (e) { e2 = e; }
  assert(e2 && /ถี่/.test(e2.message), '429');
});
test('S12 loadProject: เรียก RPC get_demo_project ด้วย UUID และกรองผ่าน Sanitize.project ก่อนใช้งานเสมอ', async () => {
  const seen = []; let sanitized = 0;
  const cfg = { supabaseUrl: 'https://abcdefgh.supabase.co', supabaseAnonKey: KEY };
  const S = supaCtx(cfg, (u, o) => { seen.push({ u, o }); return okJson([{ id: 'x', title: 'T'.repeat(500), project_data: { meta: { name: 'evil' }, panels: [], items: [] } }]); },
    { Sanitize: { project: (raw) => { sanitized++; return { project: Object.assign({}, raw, { cleaned: true }) }; } } });
  const r = await S.loadProject('11111111-2222-4333-8444-555555555555');
  assert(r.project.cleaned === true && sanitized === 1 && r.title.length <= 120, 'ไม่ผ่าน Sanitize');
  eq(seen[0].u, 'https://abcdefgh.supabase.co/rest/v1/rpc/get_demo_project');
  eq(JSON.parse(seen[0].o.body), { p_id: '11111111-2222-4333-8444-555555555555' });
});

/* ---------- 5) SQL ---------- */
test('S13 SQL: เปิด RLS ทุกตาราง, ไม่มี SELECT เปิดกว้าง, column grants จำกัด, ตัวจำกัดอัตรา, RPC security definer + search_path', () => {
  const sql = read('sql/supabase-demo-schema.sql');
  ['demo_projects', 'demo_export_logs', 'demo_private', 'demo_rate_limit'].forEach((t) => assert(new RegExp(`alter table public\\.${t} enable row level security`).test(sql), 'RLS ' + t));
  assert(/create policy demo_projects_select_official[\s\S]*?using \(is_official_preset\)/.test(sql) && !/for select[^;]*using \(true\)/i.test(sql), 'select ต้องจำกัดเฉพาะตัวอย่างทางการ');
  assert(/grant insert \(id, title, project_data\) on public\.demo_projects to anon/.test(sql) && /grant insert \(attempted_format, client_kind\) on public\.demo_export_logs to anon/.test(sql), 'column grants');
  assert(!/grant (all|insert|update|delete) on public\./i.test(sql) && !/grant select on public\./i.test(sql), 'ห้าม grant ทั้งตาราง');
  assert(/revoke all on public\.demo_projects, public\.demo_export_logs, public\.demo_private, public\.demo_rate_limit from anon, authenticated/.test(sql), 'revoke');
  assert(!/for (update|delete)/i.test(sql.replace(/--[^\n]*/g, '')), 'anon ต้องไม่มีสิทธิ์แก้/ลบ');
  assert(/PT429/.test(sql) && /demo_rate_check\('share', 10\)/.test(sql) && /demo_rate_check\('log', 60\)/.test(sql), 'rate limit');
  assert(/sha256\(/.test(sql), 'IP ต้องเก็บเป็นแฮช');
  const defs = sql.match(/security definer/g) || [], paths = sql.match(/set search_path = public, pg_temp/g) || [];
  assert(defs.length >= 5 && paths.length >= defs.length, 'security definer ทุกตัวต้องล็อก search_path');
  assert(/check \(is_official_preset or expires_at is not null\)/.test(sql) && /char_length\(title\) between 1 and 120/.test(sql) && /pg_column_size\(project_data\) <= 200000/.test(sql), 'constraints');
  assert(/grant execute on function public\.get_demo_project\(uuid\) to anon/.test(sql) && /revoke all on function public\.demo_rate_check/.test(sql), 'ฟังก์ชัน');
});
test('S14 seed ตัวอย่างทางการ: ทุกแถว is_official_preset = true, ไม่หมดอายุ, JSON ใช้ได้และคำนวณผ่าน', () => {
  const sql = read('sql/seed-demo-presets.sql');
  const rows = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$::jsonb, true, null\);/g)];
  eq(rows.length, 5);
  rows.forEach((m) => { const p = JSON.parse(m[1]); assert(Array.isArray(p.panels) && Array.isArray(p.items), 'รูปแบบ'); assert(E.calculate(p).panels.length === p.panels.length, 'คำนวณไม่ได้'); });
  assert(!/service_role|insert into public\.demo_export_logs/.test(sql), 'seed ต้องไม่แตะสิ่งอื่น');
});

/* ---------- 6) build / ความลับ ---------- */
const B = require('../scripts/build-demo.js');
const jwt = (role) => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.s';
test('S15 build-demo: ปฏิเสธ secret/service_role key, รับ anon/publishable, ปฏิเสธ URL/redirect ที่ไม่ปลอดภัย', () => {
  let m = ''; try { B.checkAnonKey(jwt('service_role')); } catch (e) { m = e.message; }
  assert(/service_role/.test(m), 'ต้องปฏิเสธ service_role');
  m = ''; try { B.checkAnonKey('sb_secret_abcdefg'); } catch (e) { m = e.message; }
  assert(/secret/.test(m), 'ต้องปฏิเสธ sb_secret_');
  eq(B.checkAnonKey(jwt('anon')), jwt('anon')); eq(B.checkAnonKey('sb_publishable_abc'), 'sb_publishable_abc'); eq(B.checkAnonKey(''), '');
  const bad = (env) => { try { B.configText(env); return ''; } catch (e) { return e.message; } };
  assert(/supabase\.co/.test(bad({ SUPABASE_URL: 'https://evil.com', SUPABASE_ANON_KEY: jwt('anon') })), 'URL');
  assert(/https/.test(bad({ DEMO_REDIRECT_URL: 'javascript:alert(1)' })), 'redirect');
  const cfg = B.configText({ SUPABASE_URL: 'https://abcdefgh.supabase.co/', SUPABASE_ANON_KEY: jwt('anon'), DEMO_OWNER_NAME: 'ผู้ทดสอบ' });
  assert(/"supabaseUrl": "https:\/\/abcdefgh\.supabase\.co"/.test(cfg) && /Made by ผู้ทดสอบ/.test(cfg) && !/service_role/.test(cfg), 'config');
});
test('S16 build-demo: สร้าง dist ได้, config ถูกเขียนทับ, ไม่มีไฟล์ฝั่งเซิร์ฟเวอร์ ; ถ้ามีโค้ดส่งออกหลุดเข้ามา build ต้องล้ม', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-dist-'));
  B.build({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_' + 'x'.repeat(30) }, out);
  const files = fs.readdirSync(out);
  assert(files.includes('index.html') && files.includes('_headers') && files.includes('.nojekyll') && !files.includes('server.js'), files.join());
  assert(/"supabaseUrl": "https:\/\/abcdefgh\.supabase\.co"/.test(fs.readFileSync(path.join(out, 'js/demo-config.js'), 'utf8')), 'config');
  eq(B.scanBanned(out), []);
  // จำลองการเผลอใส่โค้ดส่งออกกลับ: ต้องจับได้
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-bad-'));
  fs.writeFileSync(path.join(tmp, 'x.js'), "const h = '0\\nSECTION\\n2\\nHEADER\\n9\\n$ACADVER\\n1\\nAC1009'; const k = 'service_role';");
  const hits = B.scanBanned(tmp).map((h) => h.what);
  assert(hits.some((w) => /DXF/.test(w)) && hits.some((w) => /service_role/.test(w)), hits.join());
  fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
});
test('S17 ไฟล์ที่ deploy (public/) ไม่มี service_role/secret และไม่โหลดอะไรจากโดเมนภายนอก (ยกเว้น Supabase ผ่าน connect-src)', () => {
  const idx = read('public/index.html');
  const refs = [...idx.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  assert(refs.length > 10 && refs.every((u) => !/^(https?:)?\/\//.test(u)), 'พบ URL ภายนอก: ' + refs.filter((u) => /^(https?:)?\/\//.test(u)).join());
  assert(!/<script(?![^>]*\bsrc=)[^>]*>/.test(idx), 'ห้ามมี inline script');
  assert(B.scanBanned(path.join(ROOT, 'public')).length === 0, 'public/ มีร่องรอยโค้ดส่งออก/ความลับ');
  const meta = idx.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1], hdr = read('public/_headers'), srv = read('server.js');
  [meta, hdr, srv].forEach((t, i) => assert(/connect-src 'self' https:\/\/\*\.supabase\.co/.test(t) && !/'unsafe-eval'|script-src[^;]*'unsafe-inline'/.test(t), 'CSP #' + i));
  assert(/frame-ancestors 'none'/.test(hdr), '_headers ต้องมี frame-ancestors');
  const order = ['demo-config.js', 'demo-guard.js', 'supabase-client.js', 'xlsx-io.js', 'export.js', 'dxf.js', 'app.js', 'demo-ui.js'].map((f) => idx.indexOf('js/' + f));
  assert(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), 'ลำดับสคริปต์ผิด: ' + order.join());
});

/* ---------- 7) จุดเชื่อมใน app.js ---------- */
test('S18 app.js: ทุกทางออกของไฟล์ผ่านตัวดัก (download เป็นด่านสุดท้าย) · ปิดการซิงก์ server.js · DemoHooks เฉพาะโหมดสาธิต', () => {
  const a = read('public/js/app.js');
  assert(/function download\(name, content, type\) \{\s*\/\/[^\n]*\n\s*if \(demoBlock\(/.test(a), 'download() ต้องดักเป็นบรรทัดแรก');
  assert(/async function saveFile\(\) \{\s*if \(!\(window\.DemoGuard[^\n]*allowProjectJson\) && demoBlock\('JSON/.test(a), 'saveFile');
  assert(/function exportPDF\(\) \{\s*if \(demoBlock\('PDF'\)\) return;/.test(a), 'exportPDF');
  ["case 'export-csv': if (demoBlock('CSV')) break;", "if (demoBlock('Excel (.xlsx)')) break;", "if (demoBlock('AutoCAD DXF (.dxf)')) break;", "if (demoBlock('CSV')) return; const p ="].forEach((s) => assert(a.includes(s), 'ไม่พบ: ' + s));
  assert(/on: !!TOKEN && !DEMO\(\)/.test(a), 'disk.on ต้องปิดในโหมดสาธิต');
  assert(/if \(DEMO\(\)\) window\.DemoHooks = \{/.test(a), 'DemoHooks');
  const dl = a.match(/function download\([\s\S]*?\n  \}/)[0];
  assert(dl.indexOf('demoBlock') < dl.indexOf('new Blob'), 'ต้องดักก่อนสร้าง Blob');
});
test('S19 ส่วนที่อ่านไฟล์นำเข้ายังทำงาน (Importer) และเอนจินคำนวณปกติ ไม่ถูกกระทบจากการถอดโค้ดส่งออก', () => {
  const Imp = require('../public/js/importer.js');
  const r = Imp.parseText('ชั้น 1\nห้องประชุม: โคม LED 18W x 10');
  assert(r.rows.length === 1, 'importer');
  assert(result.panels.length >= 3 && result.service.mainCB.at > 0 && result.totals.demand > 0, 'engine');
});

done();
