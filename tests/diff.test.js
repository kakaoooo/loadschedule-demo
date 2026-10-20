'use strict';
// ทดสอบตัวเทียบโครงการ (public/js/diff.js) ที่ใช้ในประวัติเวอร์ชัน — รัน: node tests/diff.test.js
const Df = require('../public/js/diff.js');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); return; }
  fail++;
  console.log(`FAIL  ${name}${detail === undefined ? '' : '  → ' + JSON.stringify(detail).slice(0, 240)}`);
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const base = () => ({
  meta: { name: 'A', owner: 'x', branch: { cable: 'IEC01', length: 15 } },
  panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB' }, { id: 'LP1', name: 'LP-1', kind: 'LP', parent: 'MDB' }],
  items: [{ id: 'i1', panelId: 'LP1', type: 'light', name: 'ไฟห้องประชุม', fixtures: 10 }, { id: 'i2', panelId: 'LP1', type: 'rec', points: 8 }]
});

eq('D1 โครงการเหมือนกัน → same', Df.diffProjects(base(), base()).same, true);
{
  const b = base(); b.meta.name = 'B'; b.meta.branch.length = 20;
  const d = Df.diffProjects(base(), b);
  eq('D2 meta ซ้อนกันเทียบเป็นคีย์มีจุด', d.meta.map((x) => [x.k, x.a, x.b]), [['branch.length', 15, 20], ['name', 'A', 'B']]);
}
{
  const b = base(); b.panels.push({ id: 'LP2', name: 'LP-2', kind: 'LP', parent: 'MDB' }); b.panels[1].parent = 'LP2';
  const d = Df.diffProjects(base(), b);
  eq('D3 แผงเพิ่ม', d.panels.added.map((x) => x.label), ['LP-2']);
  eq('D4 แผงเปลี่ยน "รับไฟจาก"', d.panels.changed.map((x) => [x.label, x.fields.map((f) => [f.k, f.a, f.b])]), [['LP-1', [['parent', 'MDB', 'LP2']]]]);
}
{
  const b = base(); b.items = b.items.filter((x) => x.id !== 'i2'); b.items[0].fixtures = 12; b.items.push({ id: 'i3', panelId: 'LP1', type: 'ac', btu: 12000 });
  const d = Df.diffProjects(base(), b);
  eq('D5 อุปกรณ์เพิ่ม/ลบ/แก้', [d.items.added.map((x) => x.label), d.items.removed.map((x) => x.label), d.items.changed.map((x) => x.fields.map((f) => f.k))], [['ac · LP-1'], ['rec · LP-1'], [['fixtures']]]);
  eq('D6 นับรวมการเปลี่ยนแปลง', d.count, 3);
}
{
  const a = base(); a.items[0].cbOv = { 1: 20 };
  const b = base(); b.items[0].cbOv = { 1: 32 }; b.items[0].phOv = { 1: 2 };
  const d = Df.diffProjects(a, b);
  eq('D7 ค่าออบเจ็กต์ (cbOv/phOv) เทียบทั้งก้อน', d.items.changed[0].fields.map((f) => f.k), ['cbOv', 'phOv']);
}
{
  const b = base(); b.items[1].panelId = 'MDB';
  const d = Df.diffProjects(base(), b);
  eq('D8 ย้ายอุปกรณ์ไปแผงอื่น: ชื่อแสดงแผงใหม่', d.items.changed.map((x) => x.label), ['rec · MDB']);
  eq('D9 ชื่อรายการที่ถูกลบใช้แผงของฉบับเก่า', Df.diffProjects(Object.assign(base(), { items: [{ id: 'z', panelId: 'LP1', type: 'motor' }] }), base()).items.removed.map((x) => x.label), ['motor · LP-1']);
  const r = Df.diffProjects(b, base());
  ok('D10 ทิศทางกลับกันให้ผลสมมาตร', r.items.changed.length === 1 && r.items.changed[0].fields[0].a === 'MDB', r.items.changed);
}
ok('D11 อินพุตขยะไม่พัง', [null, undefined, 1, 'x', [], { panels: 'x', items: null }, { panels: [null, 1, { name: 'no id' }], items: [{}] }].every((x) => { try { const d = Df.diffProjects(x, base()); return typeof d.count === 'number'; } catch (e) { return false; } }));
{
  const a = { meta: {}, panels: [{ id: 'P', name: 'x' }, { id: 'P', name: 'dup' }], items: [] };
  const d = Df.diffProjects(a, { meta: {}, panels: [{ id: 'P', name: 'x' }], items: [] });
  ok('D12 id ซ้ำใช้ตัวแรก ไม่นับซ้ำ', d.same, d);
}
{
  const a = base(), b = base(); delete b.meta.owner; a.items[0].extra = undefined;
  const d = Df.diffProjects(a, b);
  eq('D13 ฟิลด์หาย = เปลี่ยนเป็นว่าง ; undefined เท่ากับไม่มีฟิลด์', [d.meta.map((x) => x.k), d.items.changed.length], [['owner'], 0]);
}
{
  const big = base(); for (let i = 0; i < 3000; i++) big.items.push({ id: 'g' + i, panelId: 'LP1', type: 'custom', va: i });
  const b2 = JSON.parse(JSON.stringify(big)); b2.items.forEach((x, i) => { if (i % 10 === 0) x.va = (x.va || 0) + 1; });
  const t0 = Date.now(); const d = Df.diffProjects(big, b2); const ms = Date.now() - t0;
  ok('D14 3,000 รายการเทียบได้เร็ว (< 300 ms) และนับถูก', ms < 300 && d.items.changed.length === 301, [ms, d.items.changed.length]);
}

console.log(fail ? `\n${fail} ไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
