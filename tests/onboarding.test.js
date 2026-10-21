// Onboarding 3 ขั้น + คู่มือ + เมนูส่งออก: โครงสร้างไฟล์ · CSP · ข้อมูลศัพท์ · พฤติกรรมในโหมดไม่มี DOM
// รัน: node tests/onboarding.test.js
const fs = require('fs');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('public/index.html');
const js = read('public/js/onboarding.js');
const css = read('public/css/app.css');
const O = require('../public/js/onboarding.js');

test('OB1 โมดูลโหลดได้โดยไม่มี DOM และมี 3 ขั้นตอน + ตัวอย่าง 4 อาคารตรงกับ manifest', () => {
  eq(O.STEPS.length, 3);
  const man = JSON.parse(read('public/presets/manifest.json')).map((x) => x.file).sort();
  eq(O.PRESETS.map((p) => p.file).sort(), man);
  O.PRESETS.forEach((p) => assert(fs.existsSync(path.join(ROOT, 'public/presets', p.file)), p.file));
});
test('OB2 พจนานุกรมศัพท์ครบคำที่แอปแสดง และไม่ว่าง', () => {
  const terms = O.GLOSSARY.map((g) => g[0]).join('|');
  ['Ik″', 'IC', 'Riser', 'Tap ahead of main', 'NFPA 20', 'Auto-Selectivity', 'Balance Load'].forEach((t) => assert(terms.includes(t), 'ขาด ' + t));
  O.GLOSSARY.forEach(([t, d]) => assert(t && d && d.length > 20, t));
});
test('OB3 index.html: โหลด onboarding.js หลัง demo-ui.js · มีปุ่มคู่มือ · เมนูส่งออกรวม 4 ปุ่มเดิมไว้ (สถิติแยกชนิดไฟล์ยังทำงาน)', () => {
  assert(html.indexOf('js/onboarding.js') > html.indexOf('js/demo-ui.js'), 'ลำดับสคริปต์');
  assert(html.includes('id="btn-open-guide"') && html.includes('id="exportMenuBtn"') && html.includes('id="exportMenu"'));
  ['export-pdf', 'export-xlsx', 'export-csv', 'export-dxf'].forEach((a) => assert(html.includes(`data-action="${a}"`), a));
});
test('OB7 แท็บในไกด์ตรงกับ TABS จริงใน app.js · ไอคอนที่ใช้มีอยู่ใน icons.js · ไม่มี emoji ในส่วนที่เพิ่ม', () => {
  const app = read('public/js/app.js');
  O.TAB_GUIDE.forEach(([k, name]) => assert(app.includes(`['${k}', '${name}']`), 'แท็บไม่ตรง: ' + k));
  const icons = read('public/js/icons.js');
  O.PRESETS.map((p) => p.icon).concat(['help', 'lock', 'scan', 'check', 'close', 'balance', 'moon', 'sun']).forEach((n) => assert(new RegExp('\\b' + n + ': s\\(').test(icons), 'ไม่มีไอคอน ' + n));
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert(!emoji.test(js) && !emoji.test(html), 'พบ emoji');
});
test('OB8 แถบ 3 ขั้นแสดงครั้งแรกครั้งเดียว + ปุ่มช่วยเหลือ (?) แทนปุ่มคู่มือ', () => {
  assert(/lsGet\(KEY\) !== '1'[\s\S]{0,60}lsSet\(KEY, '1'\)[\s\S]{0,30}buildStrip\(\)/.test(js), 'จดแฟลกทันทีที่แสดง');
  assert(/id="btn-open-guide"[^>]*>[\s\S]*?data-icon="help"[\s\S]*?ช่วยเหลือ/.test(html), 'ปุ่มช่วยเหลือ');
});
test('OB4 CSP: ไม่มี inline handler/innerHTML/eval ใน onboarding.js และ index.html', () => {
  assert(!/\son[a-z]+\s*=\s*["']/i.test(html), 'index.html มี inline handler');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write/.test(js), 'onboarding.js ใช้ API ที่ไม่ปลอดภัย');
});
test('OB5 CSS มีสไตล์ทุกส่วน + มือถือ (≤760px) + จอสัมผัส', () => {
  ['#guideStrip', '.gs-chip', '.export-menu', '.gd-card', '#tapPop'].forEach((s) => assert(css.includes(s), s));
  assert(/@media \(max-width: 760px\)\s*\{\s*#guideStrip/.test(css), 'มือถือ');
  assert(css.includes('@media (hover: none)'), 'จอสัมผัส');
});
test('OB6 ปุ่มส่งออกทุกปุ่มยังเป็นตัวดัก DemoGuard เดิม (ไม่มีโค้ดส่งออกเพิ่ม)', () => {
  const a = read('public/js/app.js');
  assert(a.includes("case 'export-pdf': exportPDF()") && a.includes("demoBlock('CSV')"));
});
test('OB9 ปุ่มส่งออก/ช่วยเหลือแสดงป้ายบนมือถือ · ไม่มีปุ่มซ้ำ "ใช้ตัวอย่างนี้" · มีปุ่ม (i) อธิบายศัพท์ที่ไม่ทับปุ่ม/ฟอร์ม · มีคำใบ้เลื่อนตารางบนมือถือ', () => {
  assert(/#exportMenuBtn \.lbl, #btn-open-guide \.lbl \{ display: inline !important/.test(css), 'ป้ายบนมือถือ');
  assert(!js.includes('ใช้ตัวอย่างนี้'), 'ปุ่มซ้ำ');
  assert(js.includes("'th, .label, h3'") && js.includes("closest('label, button, a, summary')") && js.includes('MutationObserver'), 'ตัวใส่ (i)');
  assert(css.includes('.gl-i') && /@media print \{ \.gl-i \{ display: none/.test(css), 'สไตล์ (i) + ซ่อนตอนพิมพ์');
  assert(/\.sched-top::after \{ content:/.test(css), 'คำใบ้เลื่อนตาราง');
  ['Connected', 'IC', 'Ik″', 'Riser', 'Demand', '%VD', 'Auto-Selectivity'].forEach((k) => assert(O.GLOSSARY.some((g) => g[0] === k), 'ศัพท์ที่ (i) อ้างถึงต้องมีในพจนานุกรม: ' + k));
});
done();
