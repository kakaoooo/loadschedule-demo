#!/usr/bin/env node
'use strict';
// ตรวจหน้าจอจริงด้วย Chrome (headless) ผ่าน DevTools Protocol — คลิก/พิมพ์/สลับธีมในแอปจริง ไม่ต้องติดตั้งแพ็กเกจเพิ่ม
//   node tools/ui-smoke.js                 # ทุกฉาก
//   node tools/ui-smoke.js multilevel hot  # เลือกฉาก
//   CHROME_BIN=/path/to/chrome node tools/ui-smoke.js
// ต้องมี: Google Chrome (ค่าเริ่มต้นตำแหน่งบน macOS) และ Node ≥ 22 (ใช้ WebSocket ในตัว)
// ฉาก: multilevel (checkbox ประสานสายป้อน, แท็ก [1.6× Coord], หมายเหตุ Ik, ธีมมืด) · hot (แถบเตือน Ik" > IC + คำแนะนำ)
//      legacy (โครงการเก่าที่ปิด Auto-Selectivity/ประสานสายป้อนไว้ → แถบแจ้งให้เปิด: ตกลง/คงไว้)
//      tap (Tap ahead of main NFPA 20: ช่องติ๊กในกล่องแผง, กิ่งแยกใน SLD, CB ประธานเปลี่ยนเมื่อสลับ) · ตั้ง SMOKE_SHOT_DIR=/path เพื่อเซฟภาพ SLD ของฉากนี้เป็น PNG
// ออกแบบ: เซิร์ฟเวอร์ static ชั่วคราวเสิร์ฟ public/ + /seed.html (ฝังโครงการลง localStorage ของโปรไฟล์ Chrome ชั่วคราว) แล้วสั่งหน้าจอจริงผ่าน CDP
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = 5184;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) { console.error('ไม่พบ Chrome: ตั้ง CHROME_BIN ให้ชี้ไปที่ไฟล์ Chrome'); process.exit(2); }
if (typeof WebSocket === 'undefined') { console.error('ต้องใช้ Node ≥ 22 (WebSocket ในตัว)'); process.exit(2); }

global.self = global;
global.LS_DATA = require(path.join(ROOT, 'public/js/data.js'));
const E = global.LoadEngine = require(path.join(ROOT, 'public/js/engine.js'));

/* ---------- โครงการทดสอบ ---------- */
const P = (id, kind, parent, extra) => Object.assign({ id, name: id, kind, phases: 3, parent, feederLength: 20 }, extra || {});
const project = (meta, panels, items) => ({ version: 1, meta: Object.assign(E.defaultMeta(), { name: 'ทดสอบ UI', supply: 'lv', utility: 'MEA', serviceKA: 10 }, meta || {}), panels, items });
const ITEM = (panelId, o) => Object.assign({ id: 'i' + Math.random().toString(36).slice(2, 8), panelId, qty: 1, length: 20 }, o);
// MDB → SDB-1 → LP-1 (เต้ารับ 90 จุด) + SDB-2 (โหลดใหญ่ ดึงเมนประธานให้พอ) : เดิม SDB-1 25 AT ใต้ LP-1 25 AT = ไม่เลือกตัด → ประสานเป็น 40 AT
const multilevel = (meta) => project(meta, [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { name: 'SDB-1' }), P('LP1', 'LP', 'SDB1', { name: 'LP-1' }), P('SDB2', 'SDB', 'MDB', { name: 'SDB-2' })],
  [ITEM('LP1', { type: 'rec', points: 90 }), ITEM('SDB2', { type: 'custom', va: 20000, phases: 3, continuous: true, qty: 4, cat: 'other' })]);
// MCB Easy9 (Icn 6 kA) ที่บัสซึ่ง Ik" ≈ 15 kA → IC 6 < Ik" : ต้องเตือนและแนะนำ IC ≥ 18 kA
const hot = () => project({ serviceKA: 15, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' }, brands: { mcb: { brand: 'Schneider', series: 'Easy9' } } },
  [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 0 })], [ITEM('LP1', { type: 'rec', points: 10 })]);
// Tap ahead of main (NFPA 20): FP-1 (ปั๊มดับเพลิง 37 kW) ต่อก่อน CB ประธาน ; ส่วนที่เหลือของอาคารคือ LP-1
const tapPanel = () => project({}, [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { name: 'LP-1' }), P('FP1', 'SDB', 'MDB', { name: 'FP-1', emergency: true, feederLength: 12, tap: 'ahead_of_main' })],
  [ITEM('LP1', { type: 'rec', points: 40 }), ITEM('FP1', { type: 'fire_pump', kw: 37, phases: 3, name: 'ปั๊มดับเพลิง' })]);
const SCENES = {
  tap: { project: tapPanel, run: sceneTap },
  multilevel: { project: () => multilevel(), run: sceneMultilevel },
  hot: { project: hot, run: sceneHot },
  legacy: { project: () => multilevel({ autoSelectivity: false, coordinateKidFeeders: false }), run: sceneLegacy }
};

/* ---------- เซิร์ฟเวอร์ static + seed ---------- */
let current = null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (u === '/seed.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(`<!doctype html><meta charset=utf-8><script>localStorage.clear();localStorage.setItem('load-schedule-project-v1', ${JSON.stringify(JSON.stringify(current)).replace(/</g, '\\u003c')});</script>seeded`); }
  const base = path.join(ROOT, 'public'), f = path.join(base, u === '/' ? 'index.html' : u);
  if (!f.startsWith(base + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
});

/* ---------- Chrome + CDP ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function launch() {
  return new Promise((resolve, reject) => {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-smoke-prof-'));
    const c = cp.spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    const t = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('Chrome ไม่เปิด DevTools ภายใน 20 วินาที')); }, 20000);
    c.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(t); resolve({ c, prof, port: +m[1] }); } });
    c.on('error', reject);
  });
}
async function connect(port) {
  let page = null;
  for (let i = 0; i < 40 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page'); } catch (e) { /* รอ */ } if (!page) await sleep(250); }
  if (!page) throw new Error('ไม่พบแท็บของ Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(), listeners = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result); } else listeners.forEach((l) => l(m)); };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('เชื่อม DevTools ไม่ได้')); });
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  return { send, on: (l) => listeners.push(l), close: () => ws.close() };
}

/* ---------- ตัวช่วยของฉาก ---------- */
function helpers(cdp, errors) {
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 10000) => {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < ms) { try { last = await ev(expr); if (last) return last; } catch (e) { last = e.message; } await sleep(100); }
    throw new Error(`รอเงื่อนไขไม่ทัน: ${what}${last && typeof last === 'string' ? ' (' + last + ')' : ''}`);
  };
  const calcDone = () => waitFor("!document.body.classList.contains('calculating') && /คำนวณแล้ว/.test(document.querySelector('#calcChip').textContent)", 'คำนวณเสร็จ');
  const open = async (hash) => {
    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/${hash || ''}` });
    await waitFor("document.readyState === 'complete' && !!document.querySelector('#calcChip')", 'หน้าโหลด');
    await calcDone();
  };
  const tab = async (name) => { await ev(`document.querySelector('[data-tab=${name}]').click()`); await sleep(150); };
  const click = async (sel) => { await ev(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(120); await calcDone(); };
  const check = [];
  const ok = (cond, msg) => { check.push({ ok: !!cond, msg }); };
  // บันทึกภาพ SVG ของผังเส้นเดียวเป็น PNG เมื่อกำหนด SMOKE_SHOT_DIR (ใช้ตรวจเลย์เอาต์ด้วยตา)
  const shot = async (name) => {
    const dir = process.env.SMOKE_SHOT_DIR;
    if (!dir) return;
    const r = await ev("(()=>{const w=document.querySelector('.sld-wrap');w.style.overflow='visible';const b=document.querySelector('.sld').getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}})()");
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(r.w) + 80, height: Math.ceil(r.h) + 200, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(img.data, 'base64'));
  };
  return { ev, waitFor, open, calcDone, tab, click, ok, check, errors, shot };
}
const lum = "const lum=(c)=>{const [r,g,b]=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};";

/* ---------- ฉาก ---------- */
async function sceneMultilevel(h) {
  const { ev, tab, click, ok, open } = h;
  await open();
  await tab('settings');
  const st = () => ev(`(()=>{const a=document.querySelector('input[data-m=autoSelectivity]'),c=document.querySelector('input[data-m=coordinateKidFeeders]');return {a:a.checked,c:c.checked,cOff:c.disabled,dim:c.closest('label').classList.contains('dim'),noticeHidden:(document.querySelector('#selNotice')||{hidden:true}).hidden}})()`);
  let s = await st();
  ok(s.a && s.c && !s.cOff && !s.dim, `ค่าเริ่มต้น: Auto-Selectivity และประสานสายป้อนติ๊ก/ใช้งานได้ ${JSON.stringify(s)}`);
  ok(s.noticeHidden, 'โครงการค่าเริ่มต้นไม่มีแถบแจ้งให้เปิด');
  await tab('feeder');
  const tags = () => ev("[...document.querySelectorAll('table.dt .tag.coord')].map(e=>e.textContent)");
  ok(JSON.stringify(await tags()) === JSON.stringify(['[1.6× Coord]']), 'ตารางสายป้อนมีแท็ก [1.6× Coord] เพียงแถวเดียว ' + JSON.stringify(await tags()));
  ok(await ev("[...document.querySelectorAll('table.dt tr')].filter(r=>r.querySelector('.tag.coord')).every(r=>/SDB-1/.test(r.textContent))"), 'แท็กอยู่ที่แถว SDB-1');
  await tab('method');
  const stepInfo = await ev("(()=>{const li=[...document.querySelectorAll('.acc .steps li')];const tagged=li.filter(x=>x.querySelector('.tag.coord'));const ik=li.find(x=>/ผลต่อกระแสลัดวงจร/.test(x.textContent));return {tagged:tagged.length,ik:ik?ik.textContent:null}})()");
  ok(stepInfo.tagged === 1, 'รายการคำนวณมี step ที่ติดแท็ก 1 จุด');
  ok(stepInfo.ik && /Ik/.test(stepInfo.ik) && /ถ้าไม่ประสาน/.test(stepInfo.ik), 'step "ผลต่อกระแสลัดวงจร" บอก Ik" ก่อน/หลังประสาน: ' + stepInfo.ik);
  // สลับ Auto-Selectivity ในแอปจริง: ประสานสายป้อนต้องถูกปิดใช้งาน และแท็กหาย
  await tab('settings');
  await click('input[data-m=autoSelectivity]');
  s = await st();
  ok(!s.a && s.cOff && s.dim && s.c, `ปิด Auto-Selectivity → checkbox ประสานถูก disabled/จาง (ค่าที่เก็บยังติ๊ก) ${JSON.stringify(s)}`);
  ok(s.noticeHidden, 'ผู้ใช้ปิดเอง → ไม่มีแถบแจ้งให้เปิด (จำการตัดสินใจ ไม่ตื๊อ)');
  await tab('feeder');
  ok((await tags()).length === 0, 'ปิด Auto-Selectivity → ไม่มีแท็ก');
  await tab('settings');
  await click('input[data-m=autoSelectivity]');
  s = await st();
  ok(s.a && !s.cOff && !s.dim, 'เปิด Auto-Selectivity กลับ → checkbox ประสานใช้ได้อีกครั้ง');
  // ปิดเฉพาะประสานสายป้อน: SDB-1 กลับเป็น 25 AT และไม่มีแท็ก
  await click('input[data-m=coordinateKidFeeders]');
  await tab('feeder');
  ok((await tags()).length === 0 && await ev("/25AT/.test([...document.querySelectorAll('table.dt tr')].find(r=>/SDB-1/.test(r.textContent)).textContent)"), 'ปิดประสานสายป้อน → SDB-1 กลับเป็น 25 AT ไม่มีแท็ก');
  await tab('settings');
  await click('input[data-m=coordinateKidFeeders]');
  // ธีมมืด: สูตรใน Steps ต้องอ่านออก
  await ev("document.documentElement.getAttribute('data-theme')==='dark' || document.querySelector('[data-action=toggle-theme]').click()");
  await tab('method');
  const c = await ev(`(()=>{${lum}const f=document.querySelector('.acc .steps .f');let bg='rgba(0, 0, 0, 0)',n=f;while(n&&/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)){bg=getComputedStyle(n).backgroundColor;n=n.parentElement}return {theme:document.documentElement.dataset.theme,ratio:cr(getComputedStyle(f).color,bg)}})()`);
  ok(c.theme === 'dark' && c.ratio >= 4.5, `ธีมมืด: สูตรใน Steps contrast ${c.ratio.toFixed(2)} (≥ 4.5) ${c.theme}`);
}

async function sceneTap(h) {
  const { ev, tab, click, ok, open, shot } = h;
  await open();
  await tab('sld');
  const sld = () => ev("(()=>{const s=document.querySelector('.sld');return {tap:!!s.querySelector('[data-el=tap-ahead]'),label:(s.querySelector('[data-el=tap-label]')||{}).textContent||'',vb:s.getAttribute('viewBox'),box:!!s.querySelector('[data-el=tap-box]')}})()");
  let s = await sld();
  ok(s.tap && s.box && s.label === 'FIRE PUMP FEEDER (TAP AHEAD OF MAIN - MAG ONLY CB)', 'SLD มีกิ่ง tap ahead of main พร้อมป้าย ' + JSON.stringify(s));
  await shot('tap-sld');
  const mainCB = async () => { await tab('feeder'); return ev("(document.querySelector('.feeder-chip dd:nth-of-type(2)')||document.body).textContent"); };
  const withTap = await mainCB();
  // กล่องแผง: เลือก FP-1 → ช่องติ๊ก Tap ahead of main ติ๊กอยู่ ; MDB ไม่มีช่องนี้
  await tab('design');
  await click('[data-select=FP1]');
  ok(await ev("!!document.querySelector('input[data-board=tap]') && document.querySelector('input[data-board=tap]').checked"), 'FP-1: ช่องติ๊ก Tap ahead of main แสดงและติ๊กอยู่');
  ok(await ev("[...document.querySelectorAll('#tree .tag, .node .tag')].some(e=>e.textContent==='TAP')"), 'ต้นไม้แผงมีแท็ก TAP');
  await click('[data-select=MDB]');
  ok(await ev("!document.querySelector('input[data-board=tap]')"), 'MDB ไม่มีช่องติ๊ก tap');
  // ปิด tap → กิ่งหาย และ CB ประธานรวมโหลดปั๊ม (ใหญ่ขึ้น)
  await click('[data-select=FP1]');
  await click('input[data-board=tap]');
  await tab('sld');
  s = await sld();
  ok(!s.tap, 'ปิด tap → SLD ไม่มีกิ่ง tap-ahead ' + JSON.stringify(s));
  const noTap = await mainCB();
  ok(withTap && noTap && withTap !== noTap, `CB ประธานเปลี่ยนเมื่อสลับ tap: ${withTap} → ${noTap}`);
  // เปิดกลับ
  await tab('design');
  await click('input[data-board=tap]');
  await tab('sld');
  s = await sld();
  ok(s.tap, 'เปิด tap กลับ → กิ่งกลับมา');
}

async function sceneHot(h) {
  const { ev, ok, open, tab } = h;
  await open();
  const b = await ev("(()=>{const e=document.querySelector('#ikBanner');return {hidden:e.hidden,text:e.textContent,advice:(e.querySelector('.advice')||{}).textContent||''}})()");
  ok(!b.hidden && /Ik" > IC/.test(b.text), 'แถบเตือน Ik" > IC แสดง');
  ok(/IC ≥ 18 kA/.test(b.advice) && /IEC 60947-2/.test(b.advice) && /Cascading/.test(b.advice), 'คำแนะนำ: ' + b.advice);
  // ตัวอย่างรุ่นต้องมาจากแคตตาล็อกในแอป: รุ่นที่ Icu ≥ 18 kA
  const ex = await ev("(()=>{const t=(document.querySelector('#ikBanner .advice')||{}).textContent||'';const B=window.LS_BRANDS;const hit=B.mccb.filter(m=>t.includes(m.model)&&m.icu>=18);return {n:hit.length,text:t}})()");
  ok(ex.n >= 1, 'ตัวอย่างรุ่นในคำแนะนำมาจากแคตตาล็อก (Icu ≥ 18 kA): ' + ex.text);
  await tab('schedule');
  const tip = await ev("(()=>{const t=document.querySelector('td.ic-bad');return t?t.getAttribute('title'):null})()");
  ok(tip && /IC ≥ 18 kA/.test(tip) && /Cascading/.test(tip) && !/Schneider|Acti9|EZC/.test(tip), 'tooltip ช่อง IC สีแดงเป็นสเปกกลาง: ' + tip);
}

async function sceneLegacy(h) {
  const { ev, ok, open, tab, calcDone } = h;
  await open();
  const n = () => ev("(()=>{const e=document.querySelector('#selNotice');return e?{hidden:e.hidden,text:e.textContent,btns:[...e.querySelectorAll('button')].map(b=>b.dataset.action)}:null})()");
  let s = await n();
  ok(s && !s.hidden && /Auto-Selectivity/.test(s.text) && /ประสานสายป้อน/.test(s.text), 'โครงการเก่าที่ปิดไว้ → แสดงแถบแจ้งให้เปิด ' + JSON.stringify(s));
  ok(s && s.btns.includes('sel-enable') && s.btns.includes('sel-keep'), 'มีปุ่ม เปิด/คงไว้');
  // "คงไว้" → ซ่อนและจำ (รีโหลดแล้วไม่ถามอีก) โดยไม่แก้โครงการ
  await ev("document.querySelector('[data-action=sel-keep]').click()");
  await sleep(150);
  s = await n(); ok(s && s.hidden, 'กด "คงไว้" → แถบหาย');
  await open();
  s = await n(); ok(s && s.hidden, 'รีโหลดแล้วไม่ถามอีก (จำต่อแปลน)');
  await tab('settings');
  ok(await ev("!document.querySelector('input[data-m=autoSelectivity]').checked && !document.querySelector('input[data-m=coordinateKidFeeders]').checked"), '"คงไว้" ไม่เปลี่ยนค่าในโครงการ');
  // ล้างการจำ แล้วกด "เปิด" → ทั้งสองตัวถูกติ๊ก คำนวณใหม่ และแถบหาย
  await ev("Object.keys(localStorage).filter(k=>k.startsWith('ls-sel-notice-')).forEach(k=>localStorage.removeItem(k))");
  await open();
  s = await n(); ok(s && !s.hidden, 'ล้างค่าที่จำ → แถบกลับมา');
  await ev("document.querySelector('[data-action=sel-enable]').click()");
  await calcDone();
  s = await n(); ok(s && s.hidden, 'กด "เปิด" → แถบหาย');
  await tab('settings');
  ok(await ev("document.querySelector('input[data-m=autoSelectivity]').checked && document.querySelector('input[data-m=coordinateKidFeeders]').checked"), 'กด "เปิด" → Auto-Selectivity และประสานสายป้อนถูกติ๊ก');
  await tab('feeder');
  ok(await ev("document.querySelectorAll('table.dt .tag.coord').length === 1"), 'ผลคำนวณเปลี่ยนจริง: มีแท็ก [1.6× Coord]');
}

/* ---------- ตัวรัน ---------- */
srv.listen(PORT, async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
  let failed = 0;
  for (const name of which) {
    if (!SCENES[name]) { console.error('ไม่รู้จักฉาก ' + name + ' (มี: ' + Object.keys(SCENES).join(', ') + ')'); failed++; continue; }
    current = SCENES[name].project();
    let chrome;
    const errors = [];
    try {
      chrome = await launch();
      const cdp = await connect(chrome.port);
      cdp.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 200));
      });
      await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `http://localhost:${PORT}/seed.html` });
      await sleep(600);
      const h = helpers(cdp, errors);
      let crash = null;
      try { await SCENES[name].run(h); } catch (e) { crash = e; }
      h.ok(!errors.length, 'ไม่มี JS exception/console.error' + (errors.length ? ': ' + errors[0] : ''));
      const bad = h.check.filter((c) => !c.ok);
      process.stdout.write(`== ${name}: ${h.check.length - bad.length}/${h.check.length} ผ่าน${crash ? ' · หยุดกลางทาง: ' + crash.message : ''}\n`);
      bad.forEach((c) => process.stdout.write(`   FAIL ${c.msg}\n`));
      if (bad.length || crash) failed++;
      cdp.close();
    } catch (e) {
      process.stdout.write(`== ${name}: ผิดพลาด ${e.message}\n`); failed++;
    } finally {
      if (chrome) { chrome.c.kill('SIGKILL'); try { fs.rmSync(chrome.prof, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
    }
  }
  srv.close();
  process.exit(failed ? 1 : 0);
});
