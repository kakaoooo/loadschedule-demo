// ทดสอบตัวคำนวณกับตัวอย่างในเอกสารประกอบการเรียน  —  รัน: node tests/test.js
const E = require('../public/js/engine.js');
let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(got)}${ok ? '' : `  (ต้องได้ ${JSON.stringify(want)})`}`);
}
const meta = (m) => Object.assign(E.defaultMeta(), m);

// --- ตัวอย่าง 6.3.1: โคม T8 LPF 36W 2 หลอด 12 โคม -> 2,400 VA, 10.43 A, CB 16A, 2x2.5 IEC01, 1/2" EMT
{
  const m = meta({ branchFactor: 1 });
  const c = E.expandItem({ id: 'x', type: 'light', lamp: 't8-36', perFixture: 2, fixtures: 12, length: 10 }, m)[0];
  E.designBranch(c, m, 0);
  eq('6.3.1 VA', c.va, 2400);
  eq('6.3.1 CB', c.cb.at, 16);
  eq('6.3.1 สาย', c.cond.text, '2-2.5');
  eq('6.3.1 ท่อ', c.conduit.inch, '1/2');
}
// --- ตัวอย่าง 6.3.3: เต้ารับ duplex 15 ชุด 180VA -> 2,700 VA, CB 20A, 2x2.5 G2.5
{
  const m = meta({ branchFactor: 1, recPerCircuit: 20, cbRec: 20 });   // ตำราใช้ CB เต้ารับ 20 A (ค่าเริ่มต้นโปรแกรมเปลี่ยนเป็น 16 A)
  const c = E.expandItem({ id: 'r', type: 'rec', points: 15, length: 10 }, m)[0];
  E.designBranch(c, m, 0);
  eq('6.3.3 VA', c.va, 2700);
  eq('6.3.3 CB', c.cb.at, 20);
  eq('6.3.3 สาย', c.cond.text, '2-2.5/G-2.5');
}
// --- ตัวอย่าง 8.3.6: มอเตอร์ 11 kW DOL -> Im 21, CB 50, สาย 1.25Im=26.25 -> 4 mm²
{
  const m = meta({ minOther: 2.5 });
  const c = E.expandItem({ id: 'm', type: 'motor', kw: 11, phases: 3, length: 10 }, m)[0];
  E.designBranch(c, m, 0);
  eq('8.3.6 Im', c.motor.im, 21);
  eq('8.3.6 CB ≤ 2.5Im', c.cb.at, 50);
  eq('8.3.6 DM', c.motor.dm, 25);
  eq('8.3.6 สาย (1.25Im = 26.25 A → 6 mm²)', c.cond.size, 6);
}
// --- ตารางโหลด LP1A (ไฟล์ตัวอย่าง LP_1st): demand 21,872 VA -> 40AT/100AF, 4-10/G-4
{
  const light = [536, 64, 640, 640, 224, 64, 280, 600, 1000, 128, 320, 256, 720];
  const rec = [10, 12, 14, 10, 10, 6, 6];
  const items = [];
  light.forEach((va, i) => items.push({ id: 'l' + i, panelId: 'LP1A', type: 'custom', name: 'Lighting', va, phases: 1, length: 15 }));
  rec.forEach((p, i) => items.push({ id: 'r' + i, panelId: 'LP1A', type: 'rec', points: p, vaPerPoint: 200, perCircuit: 20, length: 15 }));
  [1000, 1000, 1000, 1600].forEach((va, i) => items.push({ id: 's' + i, panelId: 'LP1A', type: 'spare', va, cb: 16 }));
  const p = { meta: meta({ buildingType: 'office', feeder: { cable: 'IEC01', method: 'g2', conduit: 'EMT' } }),
    panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB' }, { id: 'LP1A', name: 'LP1A', kind: 'LP', parent: 'MDB', feederLength: 25 }], items };
  const r = E.calculate(p);
  const lp = r.panels.find((x) => x.id === 'LP1A');
  eq('LP1A connected', Math.round(lp.connected), 23672);
  eq('LP1A demand', Math.round(lp.demand), 21872);
  eq('LP1A feeder CB', lp.feeder.cb.label, '40AT/100AF');
  eq('LP1A feeder', lp.feeder.text, '4-10/G-4');
  eq('LP1A conduit', lp.feeder.raceway, '1" EMT');
  console.log('  warnings:', r.warnings.slice(0, 5));
}
// --- ตัวอย่าง 6.5.1: LP2A demand 32,470 VA -> 46.87 A -> 60AT/100AF, IEC01 4-25/G-6
{
  const f = E.designFeeder({ phases: 3, demandVA: 32470, nonMotorVA: 32470, motors: [], length: 0 }, meta({}));
  eq('6.5.1 IF', Math.round(f.I_F * 100) / 100, 46.87);
  eq('6.5.1 CB', f.cb.label, '60AT/100AF');
  eq('6.5.1 สาย', f.text, '4-25/G-6');
}
// --- ตัวอย่าง 6.4.6: 24 kVA CV 1/C ร้อยท่อฝังดิน 60 m VD ≤ 2% -> 50AT, 10 -> 16 mm² (VD), G-6
{
  const m = meta({ feederFactor: 1.25 });
  const f = E.designFeeder({ phases: 3, demandVA: 24000, nonMotorVA: 24000, motors: [], length: 60, spec: { cable: 'CV', method: 'g5', conduit: 'IMC' } }, m);
  eq('6.4.6 CB', f.cb.at, 50);
  eq('6.4.6 สาย (หลังเช็ค VD)', f.size, 16);
  eq('6.4.6 สายดิน', f.ground, 6);
}
// --- ตัวอย่าง 8.3.7: SDB1 มอเตอร์ 45kW(Y-D) + 15kW + LP1A 42kVA + LP1B 25kVA -> CB ≤ 325.7 → 320AT
{
  const f = E.designFeeder({ phases: 3, demandVA: 0, nonMotorVA: (42000 + 25000), motors: [{ im: 81, cbAt: 200 }, { im: 29, cbAt: 70 }], length: 0 }, meta({}));
  eq('8.3.7 CB', f.cb.at, 320);
  eq('8.3.7 Ifeeder', f.Ic.toFixed(1), '227.0');
  eq('8.3.7 สาย', f.size, 150);
}
// --- ตัวนำเข้าข้อความ: แยกชั้น/ประเภท/จำนวน และจัดแผงตามข้อกำหนด
{
  global.self = global; require('../public/js/data.js'); global.LoadEngine = E;
  const I = require('../public/js/importer.js');
  const r = I.parseText(require('fs').readFileSync(__dirname + '/import-sample.txt', 'utf8'));
  const meet = r.rows.filter((x) => x.room === 'ห้องประชุม');
  eq('import แอร์ 24,000 BTU x2', meet.filter((x) => x.type === 'ac').map((x) => [x.btu, x.qty]), [[24000, 2]]);
  eq('import โคม 2x18W 12 ชุด', meet.filter((x) => x.type === 'light').map((x) => [x.lamp, x.perFixture, x.fixtures]), [['led-t8-18', 2, 12]]);
  eq('import ชั้นที่พบ', [...new Set(r.rows.map((x) => x.floor))], [1, 2, 3, 0]);
  eq('import ห้องน้ำมีเต้ารับ RCBO', r.rows.some((x) => /ห้องน้ำ/.test(x.room) && x.type === 'rec' && x.wet), true);
  eq('import ปั๊ม 3HP → 3 kW', r.rows.find((x) => /ทิ้ง/.test(x.name)).kw, 3);
  const L = I.buildLayout(r.rows, { meta: E.defaultMeta(), panels: [], items: [] }, {});
  eq('layout แผง', L.panels.map((p) => p.name), ['MDB', 'LP-1', 'LA-1', 'SDB-2', 'LP-2', 'LA-2', 'SDB-3', 'LP-3', 'LA-3', 'PB']);
}
// --- นำเข้าตารางโหลดแบบ Panel Board Schedule (ตามรูป THE KOP ENGINEER)
{
  const r = require('../public/js/importer.js').parseText(require('fs').readFileSync(__dirname + '/schedule-sample.txt', 'utf8'));
  eq('schedule แถวที่อ่านได้', r.rows.length, 8);
  eq('schedule ยอดรวมตรง TOTAL', [r.rows.reduce((s, x) => s + x.va, 0), r.info.verified, r.info.total], [10860, true, 10860]);
  eq('schedule ชื่อแผง/โครงการ', [r.info.panel, r.info.project], ['CU', 'บ้านพักอาศัย 1 ชั้น']);
  eq('schedule หมวด', r.rows.map((x) => x.cat), ['light', 'light', 'rec', 'rec', 'ac', 'ac', 'heater', 'motor']);
  eq('schedule RCBO', r.rows.map((x) => x.rcd), [false, true, true, true, false, false, true, true]);
  eq('schedule ไม่มีคำเตือน', r.warnings, []);
  const I2 = require('../public/js/importer.js');
  const L2 = I2.buildLayout(r.rows, { meta: E.defaultMeta(), panels: [], items: [] }, {});
  eq('schedule ใช้ชื่อแผง CU', L2.panels.map((p) => p.name), ['MDB', 'CU']);
  const R2 = E.calculate({ meta: E.defaultMeta(), panels: L2.panels, items: L2.items });
  eq('schedule connected VA หลังคำนวณ', Math.round(R2.panels.find((p) => p.board.name === 'CU').connected), 10860);
  // บรรทัดอังกฤษปกติ ต้องไม่ถูกมองเป็นหัวตาราง
  const e = I2.parseText('Lighting: LED T8 18W 2 หลอด/โคม 10 โคม');
  eq('รายการ Lighting: ไม่ถูกข้าม', e.rows.map((x) => [x.type, x.fixtures]), [['light', 10]]);
}
console.log(fail ? `\n${fail} รายการไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
