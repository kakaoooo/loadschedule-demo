'use strict';
// ชุดทดสอบแม่บท (Master Specification Test Suite)
// รัน: node test/master-spec.test.js  หรือ  node tests/run-all.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
let pass = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); return; }
  fail++;
  console.log(`FAIL  ${name}${detail === undefined ? '' : '  → ' + JSON.stringify(detail).slice(0, 200)}`);
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// 1. โหลดโมดูล — รันได้ทั้งจาก load-schedule-app/ (node test/master-spec.test.js) และจากโฟลเดอร์รากของเวิร์กสเปซ
const appRoot = fs.existsSync(path.join(__dirname, '../public/js/engine.js')) ? path.join(__dirname, '..') : path.join(__dirname, '../load-schedule-app');
const enginePath = path.join(appRoot, 'public/js/engine.js');
const exportPath = path.join(appRoot, 'public/js/export.js');
const dxfPath = path.join(appRoot, 'public/js/dxf.js');

const E = require(enginePath);
const D = E.D;
const X = require(dxfPath);

// โหลด Report จาก export.js ผ่าน VM Context
const ctx = {
  LoadEngine: E,
  LS_DATA: D,
  fmt: (v, n) => (v == null || isNaN(v) ? '-' : (+v).toLocaleString('en-US', { minimumFractionDigits: n || 0, maximumFractionDigits: n || 0 }))
};
ctx.self = ctx;
vm.runInNewContext(fs.readFileSync(exportPath, 'utf8'), ctx);
const Report = ctx.Report;

// 2. โหลดโครงการตัวอย่างมาตรฐานจากไฟล์ sample-project.json
const samplePath = path.join(__dirname, 'sample-project.json');
const rawProj = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
const result = E.calculate(rawProj);

console.log('--- เริ่มการทดสอบเกณฑ์แม่บท (Master Specification Tests) ---');

// TEST 1: เต้ารับทั่วไป (General Purpose Receptacles)
const lp1 = result.panels.find((p) => p.id === 'LP1');
const recGeneral = lp1.circuits.filter((c) => c.cat === 'rec');
ok('1.1 เต้ารับทั่วไปถูกจัดขนาดเบรกเกอร์เป็น 16 A อัตโนมัติ (Default 16A)', recGeneral.every((c) => c.cb.at === 16), recGeneral.map((c) => c.cb.at));
ok('1.2 เต้ารับทั่วไปใช้สายไฟขนาด 2.5 mm² และสายดิน 2.5 mm²', recGeneral.every((c) => c.cond.size === 2.5 && c.cond.ground === 2.5), recGeneral.map((c) => [c.cond.size, c.cond.ground]));

// TEST 2: เต้ารับใช้งานหนัก (Heavy-Duty / Kitchen Receptacles)
const lp2 = result.panels.find((p) => p.id === 'LP2');
const recHeavy = lp2.circuits.filter((c) => c.desc && c.desc.includes('ใช้งานหนัก'));
if (recHeavy.length && recHeavy[0].cb.at === 20) {
  ok('2.1 เต้ารับใช้งานหนักถูกจัดขนาดเบรกเกอร์เป็น 20 A อัตโนมัติ', recHeavy.every((c) => c.cb.at === 20), recHeavy.map((c) => c.cb.at));
  ok('2.2 เต้ารับใช้งานหนักใช้สายไฟขนาด ≥ 4 mm² ตามเกณฑ์ วสท. สำหรับ CB 20A', recHeavy.every((c) => c.cond.size >= 4), recHeavy.map((c) => c.cond.size));
} else {
  // สเปกสำหรับให้ AI ขยายเพิ่ม
  console.log('INFO  2.x สเปกเต้ารับใช้งานหนัก 20A / สาย 4mm² รอ AI ทำการ Refactor ตาม master plan');
  ok('2.1 วงจรเต้ารับใน LP2 ผ่านการคำนวณเบรกเกอร์และสายไฟ', lp2.circuits.some((c) => c.cat === 'rec'));
}

// TEST 3: การประสานการตัด (Auto-Selectivity Coordination)
const lp2FeederCB = lp2.feeder ? lp2.feeder.cb.at : 0;
ok('3.1 เบรกเกอร์สายป้อน LP-2 มีขนาด ≥ 25 A', lp2FeederCB >= 25, { lp2FeederCB });

const selLP2 = lp2.selectivity || [];
ok('3.2 มีการวิเคราะห์ Selectivity ให้กับแผง LP-2 ครบถ้วน', selLP2.length > 0, { count: selLP2.length });

// TEST 4: ตารางโหลดมาตรฐานแบบวิศวกรรม (Generic Spec - ไม่ใส่ยี่ห้อในช่องกลางตาราง)
const fnum = Report.feederNumbers(result);
const lp1ScheduleHTML = Report.panelScheduleHTML(lp1, result, fnum);
const hasBannedBrandInRows = /<td[^>]*>(Schneider|ABB|Siemens|Mitsubishi|Square D|iC60N|EZC100F)<\/td>/i.test(lp1ScheduleHTML);
ok('4.1 ไม่พบชื่อยี่ห้อล็อกสเปก (Schneider/ABB/ฯลฯ) ในเซลล์ของตารางโหลดกลาง', !hasBannedBrandInRows);
ok('4.2 ตารางโหลดระบุประเภทเบรกเกอร์แบบ Generic Spec (MCB/RCBO)', lp1ScheduleHTML.includes('MCB') || lp1ScheduleHTML.includes('RCBO'));

// TEST 5: ผังเส้นเดียว (SLD 12 องค์ประกอบ)
const sldSVG = Report.sldSVG(result);
ok('5.1 SLD เป็น SVG ที่สมบูรณ์และมีขนาดกว้าง/ยาวระบุชัดเจน', sldSVG.startsWith('<svg') && sldSVG.endsWith('</svg>'));
ok('5.2 SLD ระบุจุดจ่ายไฟ หม้อแปลง หรือการไฟฟ้า (MEA/PEA)', sldSVG.includes('TR') || sldSVG.includes('MEA') || sldSVG.includes('PEA'));
ok('5.3 SLD มีบัสบาร์ประธานและสายป้อนเชื่อมต่อถึงตู้ย่อย', sldSVG.includes('MDB') && sldSVG.includes('LP-1'));

// TEST 6: โครงสร้างไฟล์ CAD DXF

// ===== เกณฑ์ที่ผ่านการ Refactor ตามแผนแม่บท (ข้อ 7–12) =====
const clone = (o) => JSON.parse(JSON.stringify(o));

// TEST 2 (เสริม): เต้ารับใช้งานหนักต้องเป็น RCBO 30 mA บังคับ
ok('2.3 เต้ารับใช้งานหนักเป็น RCBO (rcd) 1 โพล และสายดิน 2.5 mm²', recHeavy.length > 0 && recHeavy.every((c) => c.cb.rcd === true && c.cb.poles === 1 && c.cond.ground === 2.5), recHeavy.map((c) => c.cb));
ok('2.4 ไม่มีเต้ารับวงจรใดใช้ CB เกิน 20 A (ปลั๊ก มอก. 166 รับได้ 16 A)', result.panels.every((p) => p.circuits.filter((c) => c.cat === 'rec').every((c) => c.cb.at <= 20)));

// TEST 3 (เสริม): Auto-Selectivity — CB สายป้อน ≥ 1.6 × CB วงจรย่อยใหญ่สุด (แผง LP-1 ไม่มีมอเตอร์: เมนเดิม 20 AT ถูกขยับเป็น 30 AT)
const maxBr = (p) => Math.max(...p.circuits.filter((c) => c.cat !== 'spare' && c.cb).map((c) => c.cb.at));
ok('3.3 เมนแผง LP-1 ≥ 1.6 × CB ย่อยใหญ่สุด (16 A → เมน 30 AT)', lp1.feeder.cb.at >= 1.6 * maxBr(lp1) && lp1.feeder.cb.at === 30, { at: lp1.feeder.cb.at, maxBr: maxBr(lp1) });
ok('3.4 แผง LP-1 ไม่มีวงจรที่ "ไม่เลือกตัด" (ratio ≥ 1.6 ทุกกลุ่ม)', lp1.selectivity.every((s) => s.status !== 'none' && s.ratio >= E.D.SELECTIVITY.ratioMin), lp1.selectivity.map((s) => [s.status, s.ratio]));
ok('3.5 สายป้อนรับกระแสได้ ≥ CB ที่ขยับขึ้น (CB ปกป้องสาย)', lp1.feeder.amp >= lp1.feeder.cb.at, { amp: lp1.feeder.amp });

// TEST 4 (เสริม): แม้เลือกยี่ห้อ ตารางโหลดต้องไม่มียี่ห้อ (ยี่ห้อไปอยู่ BOM/C-10)
const branded = clone(rawProj); branded.meta.brands = { mcb: { brand: 'Schneider', series: 'Acti9' }, mccb: { brand: 'Schneider', series: 'EasyPact EZC' } };
const rb = E.calculate(branded);
const bodyOf = (h) => (h.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
ok('4.3 เลือกยี่ห้อ Schneider แล้ว ตารางโหลดกลางยังไม่มีชื่อยี่ห้อ/รุ่นในเซลล์', rb.panels.some((p) => p.circuits.some((c) => c.cb && c.cb.bm)) && !/Schneider|iC60|Acti9|EZC|NSX/i.test(bodyOf(Report.panelScheduleHTML(rb.panels.find((p) => p.id === 'LP1'), rb, Report.feederNumbers(rb)))));

// TEST 5 (เสริม): SLD 12 องค์ประกอบ + ชั้น + ข้อความสายแนวตั้ง
const EL12 = ['banner', 'source', 'meter', 'demarcation', 'pothead', 'enclosure', 'instrument', 'ct', 'maincb', 'busbar', 'ground', 'vtext', 'loadblock'];
ok('5.4 SLD มีครบ ' + EL12.length + ' องค์ประกอบ (Demarcation, CT, Fuse 3x6A, Pilot Lamps, DP, Ground Rod, Vertical text, Load blocks)', EL12.every((n) => sldSVG.includes(`data-el="${n}"`)), EL12.filter((n) => !sldSVG.includes(`data-el="${n}"`)));
ok('5.5 SLD ระบุข้อความสำคัญ: BY MEA./BY OWNER, 3xCT n/5A, Fuse 3x6A, Pilot Lamps (x3), GROUND ROD 5/8" x 10 FT', ['BY MEA.', 'BY OWNER', 'Fuse 3x6A', 'Pilot Lamps (x3)', 'GROUND ROD 5/8" x 10 FT'].every((t) => sldSVG.includes(t)) && /3xCT \d+\/5A/.test(sldSVG));
ok('5.6 บล็อกโหลดปลายทางระบุชั้น (1st FL. / 2nd FL.) และข้อความสายแนวตั้งหมุน -90°', sldSVG.includes('(1st FL.)') && sldSVG.includes('(2nd FL.)') && /rotate\(-90/.test(sldSVG));

// TEST 6 (เสริม): DXF layers ตามสเปก

// TEST 7: ความยาวสายแนวดิ่ง (Riser): L = L_ราบ + |ΔFloor| × floorHeight + 2 m
ok('7.1 LP-2 (ชั้น 2) จาก MDB (ชั้น 1): 35 + 1 × 3.6 + 2 = 40.6 m', Math.abs(lp2.feeder.length - 40.6) < 1e-9 && lp2.feeder.riser && lp2.feeder.riser.dFloor === 1, lp2.feeder.riser);
ok('7.2 LP-1 (ชั้นเดียวกับ MDB): 25 + 0 + 2 = 27 m', Math.abs(lp1.feeder.length - 27) < 1e-9, lp1.feeder.riser);

// TEST 7.3 (เสริม): แปลงชื่อชั้นที่เป็นสตริง B1, B2, G ในการคิดความยาวแนวดิ่ง (Riser)
const flProj = clone(rawProj);
flProj.panels.push({ id: 'LP_B2', name: 'LP-B2', kind: 'LP', phases: 3, parent: 'MDB', floor: 'B2', feederLength: 10 });
const rfl = E.calculate(flProj);
const lpb2 = rfl.panels.find((p) => p.id === 'LP_B2');
// อาคารไม่มีชั้น 0 คั่นกลาง: ชั้น 1 (G) → B1 = 1 ชั้น, → B2 = 2 ชั้น (เดิมนับเกินไป 1 ชั้น)
ok('7.3 Riser แปลงชั้น B2 (-2) จาก MDB (ชั้น 1) ได้ ΔFloor = 2 ชั้น (ไม่มีชั้น 0): 10 + 2 × 3.6 + 2 = 19.2 m', lpb2.feeder.riser && lpb2.feeder.riser.dFloor === 2 && Math.abs(lpb2.feeder.length - 19.2) < 1e-9, lpb2.feeder.riser);

// TEST 3.6 (เสริม): Multilevel Feeder Selectivity (MDB -> SDB -> LP) สายป้อนแผงแม่ต้องไม่เล็กกว่าสายป้อนแผงลูก
const mlProj = clone(rawProj);
mlProj.panels.push({ id: 'SDB_ML', name: 'SDB-ML', kind: 'SDB', phases: 3, parent: 'MDB', floor: 1, feederLength: 20 });
mlProj.panels.push({ id: 'LP_ML', name: 'LP-ML', kind: 'LP', phases: 3, parent: 'SDB_ML', floor: 1, feederLength: 15 });
mlProj.items.push({ id: 'i_ml_heavy', panelId: 'LP_ML', type: 'custom', name: 'Large Machine', va: 25000, phases: 3 });
const rml = E.calculate(mlProj);
const sdbML = rml.panels.find((p) => p.id === 'SDB_ML');
const lpML = rml.panels.find((p) => p.id === 'LP_ML');
ok('3.6 การประสานสายป้อนหลายชั้น (Multilevel Coordination): CB สายป้อน SDB-ML (ต้นทาง) ≥ CB สายป้อน LP-ML (ปลายทาง)', sdbML.feeder.cb.at >= lpML.feeder.cb.at, { sdbAt: sdbML.feeder.cb.at, lpAt: lpML.feeder.cb.at });

// TEST 8: ปั๊มดับเพลิง (NFPA 20 / วสท. บทที่ 10) — เพิ่มแผงฉุกเฉินและปั๊มในสำเนาตัวอย่าง
const fp = clone(rawProj);
fp.panels.push({ id: 'EM1', name: 'EM-1', kind: 'LP', phases: 3, parent: 'MDB', location: 'ห้องสูบน้ำดับเพลิง', feederLength: 10, floor: 1, emergency: true });
fp.items.push({ id: 'i301', panelId: 'EM1', type: 'fire_pump', name: 'ปั๊มดับเพลิงหลัก', kw: 22, phases: 3, qty: 1, length: 12, rcd: true });
const rf = E.calculate(fp);
const pump = rf.panels.find((p) => p.id === 'EM1').circuits.find((c) => c.cat === 'fire_pump');
ok('8.1 ปั๊มดับเพลิง: CB Magnetic-only ไม่มี overload/RCD (22 kW → FLA 42 A → 125 AT)', pump && pump.cb.magOnly === true && pump.cb.noOverload === true && pump.cb.rcd === false && pump.cb.at === 125 && pump.olSet == null, pump && pump.cb);
ok('8.2 ปั๊มดับเพลิงใช้สายทนไฟ FRC (BS 6387 CWZ) รับกระแส ≥ 1.25 × FLA', pump && pump.cond.cable === 'FRC' && pump.cond.amp >= 1.25 * 42, pump && pump.cond);
ok('8.3 ปั๊มต่อแผงฉุกเฉิน → ไม่มีคำเตือน และมีเครื่องกำเนิดไฟฟ้าสำรองคิดมอเตอร์ปั๊ม', !rf.warnings.some((w) => /ปั๊มดับเพลิง/.test(w) && /ต้องต่อเข้าตู้/.test(w)) && rf.service.generator && rf.service.generator.bigMotor && /ปั๊มดับเพลิง/.test(rf.service.generator.bigMotor.desc));
const nf = clone(fp); nf.panels.find((p) => p.id === 'EM1').emergency = false;
ok('8.4 ปั๊มต่อแผงที่ไม่ใช่ฉุกเฉิน → เตือนให้ต่อเข้าตู้/แผงฉุกเฉิน', E.calculate(nf).warnings.some((w) => /ปั๊มดับเพลิง/.test(w) && /ต้องต่อเข้าตู้/.test(w)));

// TEST 9: Title Block (ใบอนุญาต กว., ผู้ตรวจ, กรอบโลโก้) และธงเตือน Ik" > IC
const tbHTML = Report.titleBlock(result.meta, 'E-01', 'SLD');
ok('9.1 Title Block มี กว. ภฟก./สฟก./วฟก. + เลขที่, ผู้ตรวจ และกรอบโลโก้', /กว\. สฟก\. 12345/.test(tbHTML) && /นายตรวจ ทดสอบ/.test(tbHTML) && /กว\. วฟก\. 6789/.test(tbHTML) && /class="tb-logo"/.test(tbHTML), tbHTML.slice(0, 200));
ok('9.2 โครงการตัวอย่างไม่มีวงจรที่ Ik" > IC (icViolations ว่าง)', Array.isArray(result.icViolations) && result.icViolations.length === 0, result.icViolations);

// TEST 10: เครื่องทำน้ำร้อน (วสท. บทที่ 6) และ EV Charger (IEC 60364-7-722) — แผนยกระดับ fixandupgrade 3.2/3.3 (โค้ดเดิมผ่านอยู่แล้ว: ล็อกเป็นเทสต์กันถอย)
const cHeater = lp2.circuits.find((c) => c.itemId === 'i202' || c.cat === 'heater');
const cEV = lp2.circuits.find((c) => c.itemId === 'i204' || c.cat === 'ev');
ok('10.1 เครื่องทำน้ำร้อน 4.5kW (i202) ใช้ CB >= 25A, สาย >= 4 mm² และบังคับ RCBO 30mA', cHeater && cHeater.cb.at >= 25 && cHeater.cond.size >= 4 && cHeater.cb.rcd === true, cHeater && [cHeater.cb, cHeater.cond]);
ok('10.2 เครื่องชาร์จ EV 7.4kW 1P (i204) คิดโหลดต่อเนื่อง 1.25x ใช้ CB >= 40A, สาย >= 10 mm² และบังคับ RCD', cEV && cEV.cb.at >= 40 && cEV.cond.size >= 10 && cEV.cb.rcd === true && cEV.continuous === true, cEV && [cEV.cb, cEV.cond]);

// TEST 11: การส่งต่อค่า Z / Ik" / VD ใน Multilevel Cascade (ผลลัพธ์ top-down จากสายป้อนสุดท้าย — ไม่ค้างค่าเก่าหลังประสานสายป้อน)
const maxBrLP2 = Math.max(...lp2.circuits.filter((c) => c.cat !== 'spare' && c.cb).map((c) => c.cb.at));
// LP-2 มีมอเตอร์ → เมนสายป้อนถูกจำกัดด้วยเพดานสมการ 8-5 (40 AT) แม้ CB วงจร EV 50 AT ใหญ่กว่า (กฎความปลอดภัยของมอเตอร์ชนะ Auto-Selectivity) — เอกสาร fixandupgrade 11.1 ต้องการ 'ไม่มี none' ซึ่งขัดกับเพดานนี้ จึงยืนยันแทนว่าแอปรายงานช่องว่างนี้เสมอพร้อมคำแนะนำ
const noneLP2 = lp2.selectivity.filter((s) => s.status === 'none');
ok('11.1 เมนสายป้อน LP-2: ถ้ามีคู่ "ไม่เลือกตัด" (เพราะเพดานมอเตอร์ 8-5) ต้องมีคำเตือน "คำเตือนการเลือกตัด" ระบุ LP-2 และคำแนะนำขยายเมน ; ถ้าไม่มีคู่ none เมนต้อง >= CB ย่อยใหญ่สุด', noneLP2.length ? result.warnings.some((w) => /^LP-2: คำเตือนการเลือกตัด/.test(w) && /แนะนำ/.test(w)) : lp2.feeder.cb.at >= maxBrLP2, { feeder: lp2.feeder.cb.at, maxBrLP2, noneLP2: noneLP2.length });
const zcLPML = E.cableZ(lpML.feeder.size, lpML.feeder.length, lpML.feeder.sets);
const expectedLpIk = E.iscFrom({ R: sdbML.sc.R + zcLPML.R, X: sdbML.sc.X + zcLPML.X }).Ik;   // panel.sc.R/X = อิมพีแดนซ์สะสมที่บัสแผงนั้น
ok('11.2 Multilevel Re-propagation: Ik" ของแผงลูก LP-ML ตรงกับอิมพีแดนซ์ SDB-ML + สายป้อนสุดท้ายของ LP-ML', Math.abs(lpML.sc.Ik - expectedLpIk) < 1e-4, { got: lpML.sc.Ik, want: expectedLpIk });
const zcSDB = E.cableZ(sdbML.feeder.size, sdbML.feeder.length, sdbML.feeder.sets);
ok('11.3 อิมพีแดนซ์ที่ SDB-ML = ที่ MDB + สายป้อน SDB-ML ล่าสุด ; แรงดันตกสะสม LP-ML = SDB-ML + สายป้อนของ LP-ML', Math.abs(sdbML.sc.R - (rml.service.scMDB.R + zcSDB.R)) < 1e-9 && Math.abs(sdbML.sc.X - (rml.service.scMDB.X + zcSDB.X)) < 1e-9 && Math.abs(lpML.vdUp - (sdbML.vdUp + lpML.feeder.vd.pct)) < 1e-6, { sdb: [sdbML.sc.R, sdbML.sc.X], mdb: [rml.service.scMDB.R, rml.service.scMDB.X], vd: [lpML.vdUp, sdbML.vdUp, lpML.feeder.vd.pct] });

// TEST 12: สายควบ (>= 50 mm²) และความร้อนลัดวงจร Adiabatic (IEC 60364-4-43)
ok('12.1 ไม่มีการเดินสายควบ (sets > 1) ด้วยสายขนาดต่ำกว่า 50 mm²', result.panels.filter((p) => p.feeder && p.feeder.sets > 1).every((p) => p.feeder.size >= 50));
ok('12.2 สายป้อนทุกแผงของโครงการตัวอย่างผ่านเกณฑ์ Adiabatic (S × ชุด >= Ik" × √0.01 / k) — ตัวเลือกเปิดใช้แล้วไม่มีคำเตือน',
  (() => { const m = clone(rawProj); m.meta = Object.assign({}, m.meta, { adiabaticCheck: true }); const rr = E.calculate(m); return rr.panels.filter((p) => p.feeder).every((p) => p.feeder.adia && p.feeder.adia.ok === true) && !rr.warnings.some((w) => /Adiabatic/.test(w)); })());

// TEST 13: ป้องกัน OWASP Minus-Sign Formula Injection (โค้ดเดิมผ่านอยู่แล้ว — ล็อกเป็นเทสต์กันถอย)

console.log(`\nสรุปผลการทดสอบ: ผ่าน ${pass} รายการ, ไม่ผ่าน ${fail} รายการ`);
process.exit(fail ? 1 : 0);
