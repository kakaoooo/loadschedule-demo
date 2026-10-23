// สเปกในวงเล็บหลังรุ่นเบรกเกอร์ (เฉพาะหน้าจอ) + ตำแหน่งการ์ด "เบรกเกอร์ตามยี่ห้อ" ในแท็บตั้งค่า
// รัน: node tests/brand-spec.test.js
const fs = require('fs');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const E = require('../public/js/engine.js');
const BR = require('../public/js/brandcb.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const calc = (brands) => E.calculate({ version: 1, meta: Object.assign(E.defaultMeta(), { brands }), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, { id: 'LP1', name: 'LP-1', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 20 }], items: [{ id: 'a', panelId: 'LP1', type: 'light', fixtures: 6, perFixture: 2, lamp: 'led-t8-18', qty: 1, length: 20 }, { id: 'b', panelId: 'LP1', type: 'rec', points: 6, qty: 1, length: 20 }] });

test('BS1 ยี่ห้อ Schneider: MCB แสดง "Type C · Icn 6 kA · 1P" และ MCCB แสดง "Icu ... kA" ต่อท้ายรุ่น ; label เดิมไม่เปลี่ยน', () => {
  const r = calc({ mcb: { brand: 'Schneider' }, mccb: { brand: 'Schneider' } });
  const po = r.panels.find((x) => x.id === 'LP1');
  const c = po.circuits.find((x) => x.cb && x.cb.bm && x.cb.bm.type !== 'MCCB');
  assert(c, 'ไม่พบวงจรที่ใช้ MCB ยี่ห้อ');
  assert(/^Schneider iC60N \d+A$/.test(c.cb.label), 'label ต้องไม่ถูกแก้: ' + c.cb.label);
  eq(BR.specOf(c.cb), 'Type C · Icn 6 kA · 1P');
  assert(BR.labelSpec(c.cb).endsWith(' (Type C · Icn 6 kA · 1P)'), BR.labelSpec(c.cb));
  const f = po.feeder.cb;
  assert(f.bm && /^Icu [\d.]+ kA/.test(BR.specOf(f)), 'MCCB: ' + BR.specOf(f));
  assert(BR.labelSpec(f).startsWith(f.label + ' ('), BR.labelSpec(f));
});

test('BS2 ค่า "ทั่วไป (วสท.)": ไม่มียี่ห้อ = ไม่มีสเปกต่อท้าย', () => {
  const po = calc(undefined).panels.find((x) => x.id === 'LP1');
  eq(BR.specOf(po.circuits[0].cb), '');
  eq(BR.labelSpec(po.circuits[0].cb), po.circuits[0].cb.label);
});

test('BS3 การ์ดเบรกเกอร์ตามยี่ห้ออยู่บนสุดของแท็บตั้งค่า · รายงาน/ตาราง generic ไม่ใช้สเปก (genCB ตัดยี่ห้อ)', () => {
  const a = read('public/js/app.js');
  const i = a.indexOf('<div class="settings">');
  assert(a.slice(i, i + 200).includes('BrandUI.settingsHTML(m)'), 'การ์ดยี่ห้อต้องมาก่อนการ์ดอื่น');
  assert((a.match(/BrandUI\.settingsHTML\(m\)/g) || []).length === 1, 'เรียกซ้ำ');
  const x = read('public/js/export.js');
  assert(x.includes("(edit ? (root.LS_BRANDCB") && x.includes(': genCB(cb))'), 'เฉพาะโหมด edit ที่ต่อสเปก');
});
test('BS4 หน้าตั้งค่า: ตัวเลือกซีรีส์/รุ่น CB ประธาน มีสเปกในวงเล็บ และเลือกแล้วมีบรรทัด "เลือก: ... (สเปก)"', () => {
  const u = read('public/js/brandui.js');
  assert(u.includes('seriesSpec(type, s.brand, x)') && u.includes('modelSpec(m)') && u.includes('class="br-pick'), 'โค้ดสเปกในการ์ดตั้งค่า');
  assert(!/parts\.push\(m\.trip\)/.test(u), 'ไม่ต่อ trip ที่มีวงเล็บซ้อน');
});
done();
