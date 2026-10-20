// Master plan — ตรรกะ UI ที่ทดสอบได้ใน Node (public/js/uikit.js): Undo/Redo 30 สเต็ป, ค้นหาแผง Ctrl+K, คีย์ลัด, แถบเตือน Ik" > IC, ธีมมืด
// รัน: node tests/master-ui.test.js
const fs = require('fs');
const path = require('path');
const U = require('../public/js/uikit.js');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');

const snap = (n, extra) => JSON.stringify(Object.assign({ meta: { name: 'P' + n, logo: '' }, n }, extra || {}));

/* ---------- Undo / Redo ---------- */
test('U1 ผลคำนวณแรกเป็นฐาน (ย้อนไม่ได้) ; แก้แล้ว undo กลับสถานะก่อนหน้า ; redo กลับไปข้างหน้า', () => {
  const h = U.createHistory(30);
  h.record(snap(1));
  eq([h.canUndo(), h.canRedo()], [false, false]);
  h.record(snap(2)); h.record(snap(3));
  eq(h.counts(), { undo: 2, redo: 0 });
  eq(h.undo(), snap(2));
  eq(h.undo(), snap(1));
  eq(h.undo(), null);
  eq(h.redo(), snap(2));
  eq(h.counts(), { undo: 1, redo: 1 });
});
test('U2 undo แล้วคำนวณซ้ำผลเดิม (record ของสถานะที่เพิ่งกู้) ไม่ทำให้เกิดประวัติใหม่', () => {
  const h = U.createHistory(30);
  [1, 2, 3].forEach((n) => h.record(snap(n)));
  const back = h.undo();
  h.record(back);                          // onResult หลัง restore
  eq(h.counts(), { undo: 1, redo: 1 });
});
test('U3 แก้ใหม่หลัง undo ล้าง redo ; record สถานะซ้ำเดิมไม่เพิ่มประวัติ', () => {
  const h = U.createHistory(30);
  [1, 2, 3].forEach((n) => h.record(snap(n)));
  h.record(snap(3));
  eq(h.counts(), { undo: 2, redo: 0 });
  h.undo(); h.record(snap(9));
  eq(h.counts(), { undo: 2, redo: 0 });
  eq(h.undo(), snap(2));
});
test('U4 เก็บสูงสุด 30 สเต็ป (เก่าสุดหลุด)', () => {
  const h = U.createHistory(30);
  for (let i = 0; i <= 45; i++) h.record(snap(i));
  eq(h.counts().undo, 30);
  let last = null, n = 0;
  for (let s = h.undo(); s !== null; s = h.undo()) { last = s; n++; }
  eq(n, 30);
  eq(last, snap(15));                      // 45 → ย้อนได้ถึง 15
});
test('U5 โลโก้ไม่ถูกเก็บในประวัติ (กันหน่วยความจำบวม) และการเปลี่ยนเฉพาะโลโก้ไม่สร้างประวัติ', () => {
  const PNGISH = 'data:image/png;base64,' + 'A'.repeat(1000);
  const a = JSON.stringify({ meta: { name: 'X', logo: '' }, k: 1 }), b = JSON.stringify({ meta: { name: 'X', logo: PNGISH }, k: 1 });
  const h = U.createHistory(30);
  h.record(a); h.record(b);
  eq(h.counts().undo, 0);
  h.record(JSON.stringify({ meta: { name: 'X', logo: PNGISH }, k: 2 }));
  assert(!/base64/.test(h.undo()), 'ประวัติต้องไม่มีโลโก้');
});
test('U6 reset ล้างทุกอย่าง (ใช้ตอนสลับแปลน)', () => {
  const h = U.createHistory(30);
  [1, 2, 3].forEach((n) => h.record(snap(n)));
  h.reset();
  eq([h.counts(), h.undo(), h.redo()], [{ undo: 0, redo: 0 }, null, null]);
  h.record(snap(7));
  eq(h.canUndo(), false);
});

/* ---------- คีย์ลัด ---------- */
const key = (code, o) => Object.assign({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName: 'DIV' } }, o || {});
test('U7 คีย์ลัด: Ctrl/Cmd+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo, Ctrl+K และ / = ค้นหาแผง (ใช้ e.code รองรับคีย์บอร์ดไทย)', () => {
  eq(U.shortcut(key('KeyZ', { ctrlKey: true })), 'undo');
  eq(U.shortcut(key('KeyZ', { metaKey: true })), 'undo');
  eq(U.shortcut(key('KeyY', { ctrlKey: true })), 'redo');
  eq(U.shortcut(key('KeyZ', { ctrlKey: true, shiftKey: true })), 'redo');
  eq(U.shortcut(key('KeyK', { ctrlKey: true })), 'search');
  eq(U.shortcut(key('Slash')), 'search');
  eq(U.shortcut(key('KeyZ')), null);
  eq(U.shortcut(key('KeyZ', { ctrlKey: true, altKey: true })), null);
});
test('U8 พิมพ์ในช่องกรอก (input/textarea/select/contenteditable): ไม่แย่ง Ctrl+Z/Y และ / ; แต่ Ctrl+K ยังทำงาน', () => {
  for (const t of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    eq(U.shortcut(key('KeyZ', { ctrlKey: true, target: t })), null);
    eq(U.shortcut(key('KeyY', { ctrlKey: true, target: t })), null);
    eq(U.shortcut(key('Slash', { target: t })), null);
    eq(U.shortcut(key('KeyK', { ctrlKey: true, target: t })), 'search');
  }
});

/* ---------- ค้นหาแผงด่วน ---------- */
const boards = [
  { id: 'MDB', name: 'MDB', kind: 'MDB', location: 'ห้องไฟฟ้า ชั้น 1', floor: 1 },
  { id: 'LP1', name: 'LP-1', kind: 'LP', location: 'สำนักงาน ชั้น 1', floor: 1 },
  { id: 'LP2', name: 'LP-2', kind: 'LP', location: 'ห้องครัวและพื้นที่บริการ ชั้น 2', floor: 2 },
  { id: 'SDB3', name: 'SDB-3', kind: 'SDB', location: 'ห้องไฟฟ้า ชั้น 3', floor: 3 }
];
test('U9 ค้นหาแผง: ไม่สนตัวพิมพ์/ขีด/ช่องว่าง, ค้นจากชื่อ id ที่ตั้ง ชั้น ชนิด ; ว่าง = ทั้งหมด', () => {
  eq(U.filterPanels(boards, '').length, 4);
  eq(U.filterPanels(boards, 'lp2'), ['LP2']);
  eq(U.filterPanels(boards, 'LP 2'), ['LP2']);
  eq(U.filterPanels(boards, 'ครัว'), ['LP2']);
  eq(U.filterPanels(boards, 'ชั้น 1').sort(), ['LP1', 'MDB']);
  eq(U.filterPanels(boards, '3rd'), ['SDB3']);
  eq(U.filterPanels(boards, 'sdb'), ['SDB3']);
  eq(U.filterPanels(boards, 'ไม่มีแผงนี้'), []);
});
test('U10 หลายคำค้น = AND ; ผลที่ชื่อขึ้นต้นตรงกับคำค้นมาก่อน', () => {
  eq(U.filterPanels(boards, 'lp ชั้น 2'), ['LP2']);
  const b2 = [{ id: 'A', name: 'XLP-9', kind: 'LP', location: '' }, { id: 'B', name: 'LP-9', kind: 'LP', location: '' }];
  eq(U.filterPanels(b2, 'lp'), ['B', 'A']);
});

/* ---------- แถบเตือน Ik" > IC ---------- */
test('U11 ไม่มีการละเมิด → ไม่แสดงแถบ ; มี → ระบุจำนวน/จุดที่ร้ายแรงสุดก่อน (Ik−IC มากสุด) และยุบส่วนเกิน', () => {
  eq(U.icBanner([]), null);
  eq(U.icBanner(undefined), null);
  const v = [
    { kind: 'branch', where: 'LP1', cb: 'A', at: 16, ic: 6, ik: 8 },
    { kind: 'main', where: 'MDB', cb: '70AT/100AF', at: 70, ic: 100, ik: 363.35 },
    { kind: 'feeder', where: 'MDB', cb: 'LP1: 30AT', at: 30, ic: 100, ik: 363.35 },
    { kind: 'branch', where: 'LP2', cb: 'B', at: 16, ic: 6, ik: 9 },
    { kind: 'branch', where: 'LP3', cb: 'C', at: 16, ic: 6, ik: 7 }
  ];
  const b = U.icBanner(v);
  eq(b.count, 5);
  assert(/Explosion Risk|เบรกเกอร์ระเบิด/.test(b.headline) && /5/.test(b.headline), b.headline);
  eq(b.items.length, 3);
  assert(/MDB/.test(b.items[0]) && /363\.35/.test(b.items[0]) && /100/.test(b.items[0]), b.items[0]);
  eq(b.more, 2);
});

/* ---------- ธีม ---------- */
test('U12 ธีม: ค่าที่จำไว้ชนะ ; ไม่มี → ตามระบบ ; สลับไปมา ; ค่าแปลกถือว่าไม่มี', () => {
  eq([U.resolveTheme('dark', false), U.resolveTheme('light', true), U.resolveTheme(null, true), U.resolveTheme(undefined, false), U.resolveTheme('<script>', true)], ['dark', 'light', 'dark', 'light', 'dark']);
  eq([U.nextTheme('light'), U.nextTheme('dark')], ['dark', 'light']);
});

/* ---------- การเชื่อมต่อใน app.js / index.html / CSS (ตรวจโครงสร้างไฟล์) ---------- */
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('U13 index.html โหลด uikit.js ก่อน app.js และมีปุ่ม undo/redo/ธีม/ช่องค้นหาแผง', () => {
  const h = read('public/index.html');
  assert(h.indexOf('js/uikit.js') > 0 && h.indexOf('js/uikit.js') < h.indexOf('js/app.js'), 'ลำดับ script');
  for (const a of ['data-action="undo"', 'data-action="redo"', 'data-action="toggle-theme"']) assert(h.includes(a), 'ไม่พบ ' + a);
  assert(h.includes('id="ikBanner"'), 'ไม่พบ #ikBanner');
});
test('U14 app.css มีธีมมืด (html[data-theme="dark"]) และบล็อกกระดาษ (.sheet/.sld-wrap) คงโทนสว่างตอนพิมพ์/รายงาน', () => {
  const c = read('public/css/app.css');
  assert(/html\[data-theme="dark"\]\s*\{[^}]*--paper/.test(c), 'dark tokens');
  assert(/html\[data-theme="dark"\]\s+\.sheet/.test(c) && /html\[data-theme="dark"\]\s+\.sld-wrap/.test(c), 'paper scopes');
  assert(/\.ik-banner/.test(c) && /--ink-fill/.test(c), 'banner / ink-fill');
});
test('U15 app.js ต่อสายครบ: Undo/Redo, ค้นหาแผง, ธีม, แถบเตือน, เต้ารับ duty, ปั๊มดับเพลิง, ชั้น/Riser, ใบอนุญาต กว./โลโก้', () => {
  const a = read('public/js/app.js');
  const need = {
    'UIKit': 'window.UIKit', 'ประวัติ 30 สเต็ป': 'createHistory(30)', 'คีย์ลัด': 'UK.shortcut(e)', 'undo action': "case 'undo'", 'redo action': "case 'redo'",
    'ค้นหาแผง': 'id="panelSearch"', 'กรองแผง': 'UK.filterPanels(', 'ธีม': "'ls-theme'", 'สลับธีม': "case 'toggle-theme'",
    'แถบเตือน': 'UK.icBanner(', 'ปั๊มดับเพลิงในรายการ': "['fire_pump'", 'ฟอร์ม duty': "sel('duty'", 'ช่องชั้น': 'data-board="floor"',
    'ใบอนุญาต': "t('designerLicense'", 'ระดับใบอนุญาต': "se('licenseTier'", 'ใบอนุญาตผู้ตรวจ': "t('checkerLicense'", 'อัปโหลดโลโก้': 'data-logo-file',
    'ความสูงชั้น': "n('floorHeight'", 'auto selectivity': "ck('autoSelectivity'"
  };
  const miss = Object.entries(need).filter(([, v]) => !a.includes(v)).map(([k]) => k);
  assert(!miss.length, 'ขาด: ' + miss.join(', '));
});
test('U16 ตัวเลือกชนิดสายทั่วไปไม่รวมสายทนไฟ FRC (ใช้เฉพาะวงจรดับเพลิง) และ index.html โหลด theme-init.js ใน <head>', () => {
  assert(/D\.CABLES\)\.filter\(\(\[, c\]\) => !c\.fire\)/.test(read('public/js/app.js')), 'กรอง FRC');
  const h = read('public/index.html');
  assert(h.indexOf('js/theme-init.js') > 0 && h.indexOf('js/theme-init.js') < h.indexOf('</head>'), 'theme-init ใน head');
});

test('U17 print.css: หน้าสูงคงที่ + Title Block สูงคงที่ห้ามตัดข้ามหน้า + พิมพ์พื้นขาวแม้ธีมมืด + ซ่อนแถบเตือนบนจอ', () => {
  const c = read('public/css/print.css');
  assert(/\.page \{[^}]*\bheight: 268mm;[^}]*overflow: hidden/.test(c) && /\.page\.land \{[^}]*height: 180mm/.test(c), 'หน้าสูงคงที่');
  assert(/\.tb \{[^}]*height: 15mm;[^}]*break-inside: avoid/.test(c), 'Title Block สูงคงที่');
  assert(/html\[data-theme\][^}]*background: #fff !important/.test(c) && /color-scheme: light !important/.test(c), 'พิมพ์ขาว');
  assert(/#ikBanner \{ display: none !important/.test(c), 'ซ่อน ikBanner');
  assert(/\.page\.calc \{[^}]*height: auto/.test(c), 'หน้าภาคผนวกไหลต่อได้');
});
test('U18 fitPrintPages ย่อ .page-b ตามความสูงคงที่ของหน้า (scrollHeight vs clientHeight) และถูกเรียกทั้งจากปุ่ม PDF และโหมด #print', () => {
  const a = read('public/js/app.js');
  assert(/function fitPrintPages\(\)[\s\S]*b\.scrollHeight > b\.clientHeight/.test(a) && /classList\.add\('flow'\)/.test(a), 'fit ใช้ scroll/client + flow fallback');
  assert(/#print' && !DEMO\(\)\) \{ \$\('#report'\)\.innerHTML = R\.reportHTML\(result\); fitPrintPages\(\); \}/.test(a), '#print (ปิดในเวอร์ชันสาธิต) ยังเรียก fit');
  assert(/const nFit = fitPrintPages\(\)/.test(a), 'exportPDF เรียก fit');
});
test('U19 แถบบน: ปุ่มย้อน/ซ้ำอยู่ในกลุ่ม .tb-group ใช้ไอคอน SVG (ไม่ใช่ตัวอักษรลูกศร) มีตัวนับ .cnt และปุ่มที่ใช้ไม่ได้ยังเห็นขอบ', () => {
  const h = read('public/index.html'), c = read('public/css/app.css'), i = read('public/js/icons.js');
  assert(/class="tb-group"[^>]*>\s*<button[^>]*data-action="undo"[\s\S]*?data-icon="undo"[\s\S]*?class="cnt"[\s\S]*?data-action="redo"[\s\S]*?data-icon="redo"/.test(h), 'กลุ่มย้อน/ซ้ำ');
  assert(!/↶|↷/.test(h), 'ไม่ใช้ตัวอักษรลูกศร');
  assert(/undo: s\(/.test(i) && /redo: s\(/.test(i), 'มีไอคอน undo/redo');
  assert(/\.tb-btn\[disabled\] \{ opacity: \.4\d?;/.test(c) && /\.tb-group \{[^}]*border: 1px solid/.test(c) && /min-height: 36px/.test(c), 'สไตล์กลุ่ม/ปิดใช้งาน/ความสูงเท่ากัน');
});

/* ---------- ข้อพบจากการรีวิวโค้ด (UI) ---------- */
test('U20 ช่อง checkbox/radio/ปุ่ม ไม่ใช่ "ช่องพิมพ์": Ctrl+Z/Y ยังทำงานเมื่อโฟกัสอยู่ที่ checkbox ที่เพิ่งติ๊ก ; ช่องข้อความ/ตัวเลข/select ยังแย่งคีย์ไม่ได้', () => {
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'range']) eq(U.shortcut(key('KeyZ', { ctrlKey: true, target: { tagName: 'INPUT', type } })), 'undo');
  for (const type of ['text', 'number', 'search', 'date', 'email', undefined]) eq(U.shortcut(key('KeyZ', { ctrlKey: true, target: { tagName: 'INPUT', type } })), null);
  eq(U.shortcut(key('KeyZ', { ctrlKey: true, target: { tagName: 'SELECT' } })), null);
});
test('U21 ประวัติ: current() คือสถานะที่บันทึกล่าสุด (ใช้ตัดสินว่ามีการแก้ที่ยังไม่ถูกบันทึกหรือไม่ก่อนกด Undo)', () => {
  const h = U.createHistory(30);
  eq(h.current(), null);
  h.record(snap(1)); h.record(snap(2));
  eq(h.current(), snap(2));
  h.undo(); eq(h.current(), snap(1));
});
test('U22 ค้นหาแผง: วลี "ชั้น 2" ต้องจับที่ตั้งชั้น 2 จริง ไม่หลุดไปแผงที่แค่ id มีเลข 2 (LP2 ที่อยู่ชั้น 1)', () => {
  const b = [{ id: 'LP2', name: 'LP-2', kind: 'LP', location: 'ห้องไฟฟ้า ชั้น 1', floor: 1 }, { id: 'LP3', name: 'LP-3', kind: 'LP', location: 'สำนักงาน ชั้น 2', floor: 2 }, { id: 'LP4', name: 'LP-4', kind: 'LP', location: 'ห้องครัว', floor: 2 }];
  eq(U.filterPanels(b, 'ชั้น 2').sort(), ['LP3', 'LP4']);   // LP4 อยู่ floor 2 (ชื่อชั้นมาจาก floor)
  eq(U.filterPanels(b, 'lp ชั้น 2').sort(), ['LP3', 'LP4']); // ไม่มีวลีตรง → AND ของคำ ; LP2 ไม่ตรง (floor 1 / ที่ตั้งชั้น 1)
});
test('U23 app.js: Undo เมื่อมีการแก้ที่ยังไม่ถูกบันทึก (debounce/กำลังคำนวณ) ต้องกู้สถานะที่บันทึกล่าสุดก่อน ไม่ข้ามไปย้อนอีกขั้น ; ล้างประวัติเมื่อรับแปลนจากดิสก์ ; ปั๊มดับเพลิงไม่มีช่องเลือก CB/ชนิด CB', () => {
  const a = read('public/js/app.js'), x = read('public/js/export.js');
  assert(/undoHist\.current\(\)/.test(a) && /UK\.stripLogo\(JSON\.stringify\(project\)\)/.test(a), 'กู้ current ก่อน undo');
  assert(/lastGood = null; planSig\.set\(planId, JSON\.stringify\(p\)\);\s*undoHist\.reset\(\)/.test(a), 'รีเซ็ตประวัติตอนรับจากดิสก์');
  assert(/it\.type !== 'spare' && it\.type !== 'fire_pump'/.test(a), 'ซ่อนชนิด CB ของปั๊ม');
  assert(/if \(c\.firePump\) return `<td>\$\{c\.cb\.at\}<\/td>`/.test(x), 'cbCell ปั๊มเป็นตัวเลขล้วน');
});

/* ---------- การตั้งค่า + คำแนะนำ Ik" > IC ---------- */
test('U24 หน้าตั้งค่า: มี checkbox ประสานสายป้อนหลายชั้น (data-m = coordinateKidFeeders, เปิดเมื่อไม่ใช่ false) ถัดจาก Auto-Selectivity พร้อมป้ายกำกับตามสเปก', () => {
  const a = read('public/js/app.js');
  const i = a.indexOf("ck('autoSelectivity'"), j = a.indexOf("ck('coordinateKidFeeders', m.coordinateKidFeeders !== false,");
  assert(i > 0 && j > i && j - i < 400, 'ตำแหน่ง checkbox ต้องอยู่ถัดจาก autoSelectivity');
  assert(/ประสานสายป้อนหลายชั้น \(Multilevel Feeder Coordination: ลูกก่อนแม่\)/.test(a) && /เมนแผงแม่ ≥ 1\.6 × CB สายป้อนแผงลูก \(ป้องกันการทริปข้ามชั้น\)/.test(a), 'ป้ายกำกับ');
  const R = require('../public/js/sanitize.js');
  eq(R.project({ version: 1, meta: { coordinateKidFeeders: false }, panels: [{ id: 'MDB', kind: 'MDB' }], items: [] }).project.meta.coordinateKidFeeders, false);
});
test('U25 แถบเตือน Ik" > IC มีคำแนะนำเชิงวิศวกรรม: IC ≥ มาตรฐานถัดไปที่รับ Ik" สูงสุด + ตัวอย่างรุ่น + Cascading/Back-up ตาม IEC 60947-2 ; เกินตาราง → ต้องใช้ CB จำกัดกระแส', () => {
  const v = (ik) => [{ kind: 'branch', where: 'LP1', cb: 'A', at: 16, ic: 6, ik }];
  const adv = (ik) => U.icBanner(v(ik)).advice;
  assert(/Ik" เกินพิกัดตัดกระแส/.test(adv(7.3)) && /≥ 10 kA/.test(adv(7.3)) && /Acti9 iC60N/.test(adv(7.3)) && /EasyPact EZC/.test(adv(7.3)) && /Cascading\/Back-up Protection/.test(adv(7.3)) && /IEC 60947-2/.test(adv(7.3)), adv(7.3));
  assert(/≥ 18 kA/.test(adv(12)) && /≥ 100 kA/.test(adv(95)), adv(12) + ' | ' + adv(95));
  const big = adv(363.35);
  assert(/จำกัดกระแส/.test(big) && !/≥ \d+ kA \(เช่น/.test(big), big);
  const mixed = U.icBanner([{ kind: 'branch', where: 'LP1', cb: 'A', at: 16, ic: 6, ik: 7.3 }, { kind: 'feeder', where: 'MDB', cb: 'B', at: 30, ic: 10, ik: 15 }]);
  assert(/≥ 18 kA/.test(mixed.advice), mixed.advice);
  eq(U.icBanner([]), null);
});
test('U26 app.js แสดงคำแนะนำในแถบเตือน (#ikBanner) และ CSS มีสไตล์แท็ก .tag.coord ทั้งธีมสว่าง/มืด', () => {
  const a = read('public/js/app.js'), c = read('public/css/app.css');
  assert(/b\.advice/.test(a) && /class="advice"/.test(a), 'app.js ต้อง render b.advice');
  assert(/\.ik-banner \.advice/.test(c), 'สไตล์ .advice');
  assert(/\.tag\.coord \{/.test(c), 'สไตล์ .tag.coord');
});

test('U27 หน้าตั้งค่า: checkbox ประสานสายป้อนถูกปิดใช้งาน (disabled + จางลง) เมื่อ Auto-Selectivity ปิดอยู่ เพราะไม่มีผลโดยลำพัง', () => {
  const a = read('public/js/app.js'), c = read('public/css/app.css');
  assert(/const ck = \(path, v, label, off\) => `<label class="check\$\{off \? ' dim' : ''\}"><input type="checkbox" data-m="\$\{path\}" \$\{v \? 'checked' : ''\} \$\{off \? 'disabled' : ''\}>/.test(a), 'ck รองรับ off');
  assert(/ck\('coordinateKidFeeders', m\.coordinateKidFeeders !== false, '[^']*', m\.autoSelectivity === false\)/.test(a), 'ผูก disabled กับ autoSelectivity');
  assert(/\.check\.dim \{[^}]*opacity/.test(c), 'สไตล์ .check.dim');
});
test('U28 ธีมมืด: สูตรในรายการคำนวณ (.steps .f) อ่านออกบนพื้นเข้ม — ใช้ token --formula (มืด = สีอ่อน) และกรอบกระดาษ/รายงานคืนเป็นสีเข้ม', () => {
  const c = read('public/css/app.css');
  assert(/\.steps \.f \{[^}]*color: var\(--formula, #173f63\)/.test(c), '.steps .f ใช้ --formula');
  const dark = (c.match(/html\[data-theme="dark"\] \{[^}]*\}/) || [''])[0], paper = (c.match(/html\[data-theme="dark"\] \.sheet, html\[data-theme="dark"\] \.sld-wrap[^{]*\{[^}]*\}/) || [''])[0];
  const lum = (h) => { const n = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const f = (dark.match(/--formula: (#[0-9a-f]{6})/i) || [])[1], card = (dark.match(/--card: (#[0-9a-f]{6})/i) || [])[1];
  assert(f && card && ratio(f, card) >= 7, `สูตรบนการ์ดมืด contrast ${f && card ? ratio(f, card).toFixed(1) : '?'} (ต้อง ≥ 7)`);
  const pf = (paper.match(/--formula: (#[0-9a-f]{6})/i) || [])[1], pc = (paper.match(/--card: (#[0-9a-f]{6})/i) || [])[1];
  assert(pf && pc && ratio(pf, pc) >= 7, `สูตรในกรอบกระดาษ contrast ${pf && pc ? ratio(pf, pc).toFixed(1) : '?'}`);
});

test('U29 โฟกัสคีย์บอร์ดของ checkbox/radio เห็นชัด (เดิม input:focus-visible ปิด outline แล้วเหลือแค่เงาจาง 15% ซึ่งช่อง checkbox ไม่ใช้)', () => {
  const c = read('public/css/app.css');
  assert(/input\[type="checkbox"\]:focus-visible, input\[type="radio"\]:focus-visible \{ outline: 2px solid var\(--blue\); outline-offset: 2px; \}/.test(c), 'กฎ focus-visible ของ checkbox/radio');
  assert(c.indexOf('input[type="checkbox"]:focus-visible') > c.indexOf('input:focus-visible, select:focus-visible, textarea:focus-visible { outline: none; }'), 'ต้องอยู่หลังกฎที่ปิด outline');
});

test('U30 คำแนะนำ IC > 10 kA: ตัวอย่างรุ่นมาจากแคตตาล็อกจริง (Icu ≥ ค่าที่แนะนำ ตัวเลข Icu ตรงข้อมูล) ; ไม่มีรุ่นรับไหว → บอกตรง ๆ ไม่แต่งชื่อรุ่น ; ≤ 10 kA คงตัวอย่างเดิม', () => {
  const B = require('../public/js/brands.js');
  const v = (ik) => [{ kind: 'branch', where: 'LP1', cb: 'A', at: 16, ic: 6, ik }];
  const adv = (ik) => U.icBanner(v(ik), [6, 10, 18, 25, 30, 36, 50, 65, 85, 100], B).advice;
  const a = adv(12);
  assert(/IC ≥ 18 kA/.test(a) && /\(เช่น [^)]*Icu \d+ kA\)/.test(a), a);
  const named = B.mccb.filter((m) => a.includes(`${m.brandShort} ${m.model} (Icu ${m.icu} kA)`));
  assert(named.length >= 1 && named.length <= 2 && named.every((m) => m.icu >= 18), 'ตัวอย่างต้องอยู่ในแคตตาล็อกและ Icu ≥ 18: ' + a);
  assert(new Set(named.map((m) => m.brandShort)).size === named.length, 'ยี่ห้อไม่ซ้ำกัน');
  eq(adv(12), adv(12));                                  // ผลคงที่ (ไม่สุ่ม)
  // ต้อง ≥ 85 kA แต่แคตตาล็อกจำลองที่ตัดรุ่น Icu > 75 kA ออกไม่มีรุ่นรับไหว (แคตตาล็อกจริงตอนนี้มีรุ่น 200 kA แล้ว จึงต้องจำลอง)
  const none = U.icBanner(v(70), [6, 10, 18, 25, 30, 36, 50, 65, 85, 100], { mccb: B.mccb.filter((m) => m.icu <= 75) }).advice;
  assert(/IC ≥ 85 kA/.test(none) && /ไม่มีรุ่น MCCB ในแคตตาล็อก/.test(none) && /จำกัดกระแส/.test(none) && !/\(เช่น/.test(none), none);
  assert(/Acti9 iC60N/.test(adv(7.3)) && /EasyPact EZC/.test(adv(7.3)), 'IC ≤ 10 kA คงตัวอย่างเดิม');
  const plain = U.icBanner(v(12)).advice;               // ไม่ส่งแคตตาล็อก (Node/เทสต์เดิม) → ไม่มีตัวอย่างรุ่น แต่ยังมีคำแนะนำ
  assert(/IC ≥ 18 kA/.test(plain) && !/\(เช่น/.test(plain), plain);
});
test('U31 app.js ส่งแคตตาล็อกยี่ห้อ (LS_BRANDS) ให้ icBanner', () => {
  assert(/UK\.icBanner\(result && result\.icViolations, window\.LS_DATA && window\.LS_DATA\.IC_KA, window\.LS_BRANDS\)/.test(read('public/js/app.js')), 'icBanner(..., LS_BRANDS)');
});

/* ---------- แถบแจ้งโครงการเก่าที่ปิด Auto-Selectivity / ประสานสายป้อนไว้ (ไม่เปลี่ยนค่าเอง ต้องให้ผู้ใช้กด) ---------- */
test('U32 selectivityNotice: แสดงเฉพาะเมื่อ meta ตั้งเป็น false จริง ๆ และยังไม่เคยกด "คงไว้"/ปรับเอง ; ไม่มีคีย์/ค่าอื่น = ไม่แสดง', () => {
  eq(U.selectivityNotice({}, false), null);
  eq(U.selectivityNotice(undefined, false), null);
  eq(U.selectivityNotice({ autoSelectivity: true, coordinateKidFeeders: true }, false), null);
  eq(U.selectivityNotice({ autoSelectivity: 0, coordinateKidFeeders: 'false' }, false), null);   // ตรงกับ engine: มีแค่ === false ที่ถือว่าปิด
  const a = U.selectivityNotice({ autoSelectivity: false }, false);
  eq(a.off, ['Auto-Selectivity']);
  const c = U.selectivityNotice({ autoSelectivity: true, coordinateKidFeeders: false }, false);
  eq(c.off, ['ประสานสายป้อนหลายชั้น']);
  const both = U.selectivityNotice({ autoSelectivity: false, coordinateKidFeeders: false }, false);
  eq(both.off, ['Auto-Selectivity', 'ประสานสายป้อนหลายชั้น']);
  assert(/Auto-Selectivity/.test(both.headline) && /ประสานสายป้อนหลายชั้น/.test(both.headline) && /ค่าเริ่มต้น/.test(both.headline) && both.enable && both.keep, JSON.stringify(both));
  eq(U.selectivityNotice({ autoSelectivity: false, coordinateKidFeeders: false }, true), null);
});
test('U33 แถบแจ้ง: มี #selNotice (ซ่อนไว้) ถัดจาก #ikBanner, ปุ่ม sel-enable/sel-keep, คำนวณเสร็จแล้วอัปเดต, ผู้ใช้ปรับสองตัวเลือกเองแล้วจำไว้ไม่ถามซ้ำ, ไม่พิมพ์ลงกระดาษ', () => {
  const h = read('public/index.html'), a = read('public/js/app.js'), c = read('public/css/app.css'), p = read('public/css/print.css');
  assert(/<div class="ik-banner" id="ikBanner"[^>]*hidden><\/div>\s*<div class="sel-notice" id="selNotice"[^>]*hidden><\/div>/.test(h), '#selNotice ถัดจาก #ikBanner');
  assert(/case 'sel-enable':[^;]*autoSelectivity = true[^;]*;[^;]*coordinateKidFeeders = true/.test(a) && /case 'sel-keep':/.test(a), 'action เปิด/คงไว้');
  assert(/function updateSelNotice\(\)/.test(a) && /updateIkBanner\(\);\s*updateSelNotice\(\);/.test(a), 'อัปเดตหลังคำนวณ');
  assert(/path\[0\] === 'autoSelectivity' \|\| path\[0\] === 'coordinateKidFeeders'\) lsSet\(selNoticeKey\(\), '1'\)/.test(a), 'ปรับเองแล้วจำ');
  assert(/\.sel-notice \{/.test(c) && /\.sel-notice\[hidden\] \{ display: none; \}/.test(c), 'สไตล์ + [hidden]');
  assert(/#selNotice \{ display: none !important; \}/.test(p), 'ไม่พิมพ์');
});
test('U34 ธีมมืด: หัวตาราง/แถวชี้/สถานะใช้ token (ไม่มีสีครีม/ขาวตายตัว) และทุก token มีค่าใน :root + ธีมมืด + กรอบกระดาษ', () => {
  const c = read('public/css/app.css');
  const decl = (sel) => { const m = c.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm')); assert(m, 'ไม่พบกฎ ' + sel); return m[1]; };
  ['table.dt th', 'table.dt tbody tr:hover', 'table.ps thead th', '.imp-r', '.unb.ok', '.unb.warn', '.at-cell.forced', 'tr.cb-over, tr.cb-over td', '.hdiff'].forEach((sel) => {
    const d = decl(sel);
    assert(!/#(?:f|e)[0-9a-f]{5}\b/i.test(d) && !/background:\s*#fff\b/i.test(d), `${sel} ยังมีสีสว่างตายตัว: ${d.trim().slice(0, 90)}`);
  });
  const vars = ['--tint-th', '--tint-head', '--tint-hover', '--tint-blue', '--tint-ok', '--tint-warm', '--warn-ink', '--warn-bg', '--warn-line', '--ok-ink', '--ok-bg', '--ok-line'];
  const blocks = [c.match(/:root \{[^}]*\}/)[0], c.match(/html\[data-theme="dark"\] \{[^}]*\}/)[0], c.match(/html\[data-theme="dark"\] \.sheet[^{]*\{[^}]*\}/)[0]];
  blocks.forEach((b, i) => vars.forEach((v) => assert(new RegExp(v + ':').test(b), `${v} ไม่มีในบล็อก ${['root', 'dark', 'paper'][i]}`)));
  // ป้ายหมวดคำเตือน: ธีมมืดต้องมีสีของตัวเอง (พื้นอ่อนตายตัวบนพื้นมืด = แถบขาว)
  ['wc-vd', 'wc-phase', 'wc-cb', 'wc-cap', 'wc-data', 'wc-brand', 'wc-selectivity'].forEach((k) => assert(new RegExp('html\\[data-theme="dark"\\] \\.wtag\\.' + k).test(c), 'ไม่มีสีธีมมืดของ ' + k));
});

done();
