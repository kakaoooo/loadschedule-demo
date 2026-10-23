// ทดสอบจุดบกพร่องของตัวคำนวณ (Part B: D1–D13 + ความทนทาน + normalizeProject) ด้วยค่าที่คำนวณมือไว้ล่วงหน้า
// รัน: node tests/engine.test.js
const { test, assert, eq, near, done } = require('./helpers/eng-harness');
const { E, D, proj, P, I, findBad, clone } = require('./helpers/build');

const calc = (p) => E.calculate(p);
const po = (r, id) => r.panels.find((x) => x.id === id);
const SQ3 = Math.sqrt(3);
const V_PH = 400 / SQ3; // 230.94 V (แรงดันเฟส)
const custom3 = (pid, va) => I(pid, { type: 'custom', va, phases: 3, continuous: false });

/* =========================================================================================
 * D1 (สูง) แผง 1 เฟสใต้แผง 3 เฟส: กระแสเฟสต้องคิดตามเฟสที่ต่อจริง และสายป้อนของแม่ต้องรับไหว
 * ======================================================================================= */
function d1Project(extra) {
  // LP1 (1 เฟส): แอร์ 24,000 BTU (2.6 kVA) × 6 = 15,600 VA + ไฟ LED T8 18W 2 หลอด 20 โคม = 20×2×20 = 800 VA -> 16,400 VA
  const panels = [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB1', { phases: 1 })].concat((extra && extra.panels) || []);
  const items = [I('LP1', { type: 'ac', btu: 24000, qty: 6 }), I('LP1', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 20 })].concat((extra && extra.items) || []);
  return proj({ panels, items });
}
test('D1 แผง 1 เฟส 16.4 kVA ใต้ SDB 3 เฟส: เฟส A รับ 71 A -> CB สายป้อน SDB1 ต้อง 90 AT (ไม่ใช่ 30 AT) และสาย 35 mm²', () => {
  // Imax,phase = 16,400 / 230.94 = 71.01 A ; ×1.25 = 88.77 A -> CB มาตรฐานถัดไป 90 AT ; สาย IEC01 3 ตัวนำในท่อ ≥ 90 A -> 35 mm² (96 A)
  // (วิธีเดิม: I_F = 16,400/692.8 = 23.67 A ×1.25 = 29.6 -> 30 AT, สาย 6 mm²)
  const r = calc(d1Project());
  const s = po(r, 'SDB1');
  near(s.phaseVA[0], 16400, 1e-6); near(s.phaseVA[1], 0, 1e-6); near(s.phaseVA[2], 0, 1e-6);
  eq(s.feeder.cb.at, 90);
  eq(s.feeder.size, 35);
  assert(s.feeder.amp >= s.feeder.cb.at, 'สายต้องรับ CB ได้');
});
test('D1 ขั้นตอนใน steps บอกว่าใช้กระแสเฟสสูงสุด (÷ 230.94) เพราะมีแผง 1 เฟสต่ออยู่', () => {
  const s = po(calc(d1Project()), 'SDB1');
  assert(s.feeder.steps.some((x) => /เฟสสูงสุด/.test(x.t) && /230\.9/.test(x.f)), JSON.stringify(s.feeder.steps.map((x) => x.t)));
});
test('D1 แผง 1 เฟสบอกเฟสที่ต่อ (po.feedPhase) และ CB สายป้อนของตัวมันเองยังคิดจาก demand / 230 (90 AT)', () => {
  // I_F = 16,400/230 = 71.3 A ; ×1.25 = 89.1 -> 90 AT
  const r = calc(d1Project());
  eq(po(r, 'LP1').feedPhase, 0);
  eq(po(r, 'LP1').feeder.cb.at, 90);
  eq(po(r, 'SDB1').feedPhase, null);
});
test('D1 กระจายแผง 1 เฟสหลายแผงอัตโนมัติ: ใหญ่สุดก่อนลงเฟสที่เบาสุด (LP1 16.4 kVA -> A, LP2 9 kVA -> B)', () => {
  const r = calc(d1Project({ panels: [P('LP2', 'LP', 'SDB1', { phases: 1 })], items: [I('LP2', { type: 'custom', va: 9000, phases: 1 })] }));
  eq(po(r, 'LP1').feedPhase, 0); eq(po(r, 'LP2').feedPhase, 1);
  eq(po(r, 'SDB1').phaseVA.map(Math.round), [16400, 9000, 0]);
  eq(po(r, 'SDB1').phaseKidVA.map(Math.round), [16400, 9000, 0]);
  eq(po(r, 'MDB').phaseVA.map(Math.round), [16400, 9000, 0]);
});
test('D1 board.phase กำหนดเฟสเอง (LP2 -> C) แล้วแผงที่เหลือเลือกเฟสที่เบาสุด (LP1 -> A)', () => {
  const r = calc(d1Project({ panels: [P('LP2', 'LP', 'SDB1', { phases: 1, phase: 2 })], items: [I('LP2', { type: 'custom', va: 9000, phases: 1 })] }));
  eq(po(r, 'LP2').feedPhase, 2); eq(po(r, 'LP1').feedPhase, 0);
  eq(po(r, 'SDB1').phaseVA.map(Math.round), [16400, 0, 9000]);
});
test('D1 ใต้แผง 1 เฟสด้วยกัน (parent 1 เฟส) โหลดทั้งหมดอยู่เฟสเดียว และผลรวม phaseVA = connected', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { phases: 1 }), P('LP1', 'LP', 'SDB1', { phases: 1 })], items: [I('LP1', { type: 'custom', va: 3000, phases: 1 }), I('SDB1', { type: 'custom', va: 1000, phases: 1 })] }));
  eq(po(r, 'SDB1').phaseVA.map(Math.round), [4000, 0, 0]);
  eq(po(r, 'MDB').phaseVA.map(Math.round), [4000, 0, 0]);
});

/* D6: useMaxPhase ต้องตรงกับผลจัดวงจรจริง */
function d6Project(useMax) {
  // LP1: แอร์ 24,000 BTU × 4 (2,600 VA เท่ากัน): ช่อง 1-4 = เฟส A B C A -> A = 5,200, B = 2,600, C = 2,600
  // LP2: วงจร 1 เฟส 9,000 VA เดียว -> ช่อง 1 = เฟส A  => SDB1 phaseVA = [14,200, 2,600, 2,600], demand = connected = 19,400
  return proj({ meta: { useMaxPhase: useMax }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB1'), P('LP2', 'LP', 'SDB1')],
    items: [I('LP1', { type: 'ac', btu: 24000, qty: 4 }), I('LP2', { type: 'custom', va: 9000, phases: 1 })] });
}
test('D6 useMaxPhase=true: Imax,phase = 14,200/230.94 = 61.49 A ×1.25 = 76.9 -> CB 80 AT (วิธีเดิมประเมินก่อนจัดวงจรได้ 40 AT)', () => {
  const s = po(calc(d6Project(true)), 'SDB1');
  eq(s.phaseVA.map(Math.round), [14200, 2600, 2600]);
  eq(s.feeder.cb.at, 80);
});
// ไม่สมดุลเกิน 20% (เฟส A 14,200 VA vs เฉลี่ย 6,467 VA) → ใช้เฟสสูงสุดอัตโนมัติแม้ useMaxPhase=false
// (เดิมได้ 40 AT ขณะที่เฟส A มีกระแสจริง 61.5 A — CB ทริป/สายร้อนเกิน)
test('D6 useMaxPhase=false แต่ไม่สมดุล > 20%: ใช้เฟสสูงสุดอัตโนมัติ -> 80 AT', () => {
  const s = po(calc(d6Project(false)), 'SDB1');
  eq(s.feeder.cb.at, 80);
  assert(s.feeder.steps.some((x) => /อัตโนมัติ/.test(x.f)), 'ต้องแสดงเหตุผลในขั้นตอนคำนวณ');
});
test('D6 useMaxPhase=false และโหลดสมดุล: ยังใช้ I_F เฉลี่ย 3 เฟส', () => {
  const p = proj({ meta: { useMaxPhase: false }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB1')], items: [I('LP1', { type: 'ac', btu: 24000, qty: 6 })] });
  const s = po(calc(p), 'SDB1');
  const IF = s.demand / (Math.sqrt(3) * 400);
  assert(!s.feeder.steps.some((x) => /เฟสสูงสุด/.test(x.t)), JSON.stringify(s.phaseVA));
  // เมนแม่ต้องประสานการเลือกตัดกับสายป้อน LP1 (30 AT) ด้วย : ≥ 1.6 × 30 = 48 A -> 50 AT (แผนแม่บท 2.2 การประสานสายป้อนหลายชั้น)
  // ไม่ใช่เพราะใช้กระแสเฟสสูงสุด — ยืนยันด้วยการไม่มี step เฟสสูงสุดข้างบน และ CB ยังไม่เกิน 1.6 เท่าของค่าที่ประสานแล้ว
  const want = Math.max(IF * 1.25, E.D.SELECTIVITY.ratioMin * po(calc(p), 'LP1').feeder.cb.at);
  assert(s.feeder.cb.at >= want && s.feeder.cb.at < want * 1.6, `CB ${s.feeder.cb.at} IF ${IF} want ${want}`);
});
test('D6 CB สายป้อนทุกแผง 3 เฟส ≥ 1.25 × กระแสเฟสสูงสุดตามผลจัดวงจรสุดท้าย เมื่อ useMaxPhase=true', () => {
  const r = calc(d6Project(true));
  for (const id of ['SDB1', 'LP1', 'LP2']) {
    const p = po(r, id); const ratio = p.demand / p.connected;
    assert(p.feeder.cb.at + 1e-9 >= Math.max(...p.phaseVA) * ratio / V_PH * 1.25 - 1e-6, `${id}: CB ${p.feeder.cb.at}`);
  }
});

/* =========================================================================================
 * D2 (สูง) รับไฟแรงต่ำ: โหลดเกินแถวมิเตอร์ใหญ่สุด ต้องเตือนและแนะนำหม้อแปลง
 * ======================================================================================= */
test('D2 กฟภ. 150 kVA: I = 216.5 A ×1.25 = 270.6 A > มิเตอร์ใหญ่สุด 200 A -> เตือน "มิเตอร์" + แนะนำหม้อแปลง', () => {
  const r = calc(proj({ meta: { supply: 'lv', utility: 'PEA' }, items: [custom3('MDB', 150000)] }));
  near(r.service.demandI, 216.506, 0.01);
  eq(r.service.meter.over, true);
  const w = r.warnings.filter((x) => /มิเตอร์/.test(x));
  assert(w.length >= 1 && w.some((x) => /หม้อแปลง/.test(x)), JSON.stringify(r.warnings));
});
test('D2 กฟน. 400 kVA: I = 577 A เกินมิเตอร์ใหญ่สุด (400 A) -> เตือน', () => {
  const r = calc(proj({ meta: { supply: 'lv', utility: 'MEA' }, items: [custom3('MDB', 400000)] }));
  eq(r.service.meter.over, true);
  assert(r.warnings.some((x) => /มิเตอร์/.test(x) && /หม้อแปลง/.test(x)), JSON.stringify(r.warnings));
});
test('D2 กฟภ. 45 kVA อยู่ในพิกัด (I = 64.95 A ×1.25 = 81.2 A -> มิเตอร์ 30(100) A, CB 90 A) -> ไม่เตือนเรื่องมิเตอร์', () => {
  const r = calc(proj({ meta: { supply: 'lv', utility: 'PEA' }, items: [custom3('MDB', 45000)] }));
  eq(r.service.meter.size, '30(100) A'); eq(r.service.mainCB.at, 90);
  assert(!r.service.meter.over && !r.warnings.some((x) => /มิเตอร์/.test(x)), JSON.stringify(r.warnings));
});

/* =========================================================================================
 * D3 (สูง) สายที่เลือกรับกระแสไม่พอต้องเตือน และจำนวนชุดขนานต้องอยู่ในช่วง
 * ======================================================================================= */
test('D3 สายประธาน: 2,000 kVA (CB 3200 A) ต่อให้ขนาน 10 ชุด × 300 mm² ก็ไม่พอ -> sets ≤ 10 และเตือน', () => {
  // I = 2,000,000/692.8 = 2,886.8 A > CB ตามพิกัดหม้อแปลง 2500 A -> CB 3200 A ; XLPE ฝังดิน 300 mm² = 475 A × Fg(10 ชุด 0.45) × 10 = 2,137 A < 3200
  const r = calc(proj({ meta: { growth: 0 }, items: Array.from({ length: 20 }, () => custom3('MDB', 100000)) }));
  eq(r.service.mainCB.at, 3200);
  const m = r.service.mainFeeder;
  assert(m.sets >= 1 && m.sets <= 10, `sets ${m.sets}`);
  assert(r.warnings.some((x) => /สายประธาน/.test(x) && /รับ/.test(x)), JSON.stringify(r.warnings.filter((x) => !/สมดุล/.test(x))));
});
test('D3 สายป้อน: 1.2 MVA บน IEC01 -> CB 2500 A, ขนาน 8 ชุด × 300 mm² รับไม่พอ -> f.warn มีข้อความและขึ้นใน warnings', () => {
  // I_F = 1,200,000/692.8 = 1,732 A ; ×1.25 = 2,165 A -> 2500 AT ; IEC01 กลุ่ม 2 300 mm² = 343 A × Fg(8 ชุด 0.52) × 8 = 1,427 A < 2500
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items: Array.from({ length: 12 }, () => custom3('SDB1', 100000)) }));
  const f = po(r, 'SDB1').feeder;
  eq(f.cb.at, 2500); eq(f.sets, 8); eq(f.size, 300);
  assert(f.amp < f.cb.at && f.warn.some((x) => /รับ/.test(x) && /ไม่พอ|<|น้อยกว่า/.test(x)), JSON.stringify(f.warn));
  assert(r.warnings.some((x) => x.startsWith('SDB1') && /รับ/.test(x)), 'ต้องขึ้นใน warnings');
});

/* =========================================================================================
 * D9 ตาราง CB หมด / หม้อแปลงเล็กกว่าดีมานด์ ต้องไม่ throw
 * ======================================================================================= */
test('D9 breaker() เกิน 6300 A ไม่ throw -> oversize', () => {
  const b = E.breaker(7000, 'MCCB');
  eq(b.at, 7000); eq(b.oversize, true);
  assert(!E.breaker(100, 'MCCB').oversize, 'ปกติไม่ควร oversize');
});
test('D9 สายป้อน 3.7 MVA (I ×1.25 = 6,676 A > 6300) ไม่ throw: CB = 6300 oversize + เตือน', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items: [1, 2, 3, 4].map(() => custom3('SDB1', 925000)) }));
  const f = po(r, 'SDB1').feeder;
  eq(f.cb.at, 6300); eq(f.cb.oversize, true);
  assert(r.warnings.some((x) => x.startsWith('SDB1') && /6300|เกิน/.test(x)), JSON.stringify(r.warnings.filter((x) => !/สมดุล/.test(x))));
});
test('D9 MDB 4.5 MVA: หม้อแปลงสูงสุด 2500 kVA ต้องเตือน และ CB ประธาน = 6300 oversize (ไม่ throw)', () => {
  const r = calc(proj({ items: [1, 2, 3, 4, 5].map(() => custom3('MDB', 900000)) }));
  eq(r.service.trafo.kva, 2500);
  assert(r.warnings.some((x) => /หม้อแปลง/.test(x) && /2500/.test(x)), JSON.stringify(r.warnings.filter((x) => !/สมดุล/.test(x))));
  eq(r.service.mainCB.at, 6300); eq(r.service.mainCB.oversize, true);
});
test('D9 มอเตอร์ 320 kW (Im ≈ 563 A, 1.15Im = 648 A > DM สูงสุด 630): dm ต้องเป็นตัวเลข + เตือนที่วงจร', () => {
  const r = calc(proj({ items: [I('MDB', { type: 'motor', kw: 320, phases: 3 })] }));
  const c = po(r, 'MDB').circuits[0];
  assert(c.motor.im > 548, `Im ${c.motor.im}`);
  assert(Number.isFinite(c.motor.dm), `dm ${c.motor.dm}`);
  assert(c.warn.some((x) => /DM|เครื่องปลดวงจร/.test(x)), JSON.stringify(c.warn));
});

/* =========================================================================================
 * D4 / D12 IC ของ CB สำรอง + IC ของแผงต้องตรงกับ CB สายป้อน
 * ======================================================================================= */
function icProject() {
  // หม้อแปลง 800 kVA (8 × 100 kVA) สายประธานสั้น -> Ik ที่ LP1 ประมาณ 14–20 kA (> branchIC 6 kA)
  const panels = [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 2, spareCount: 2 })];
  const items = [I('LP1', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 10 }), I('LP1', { type: 'spare', cb: 16 })].concat(Array.from({ length: 8 }, () => custom3('MDB', 100000)));
  return proj({ meta: { growth: 0, main: { length: 2 } }, panels, items });
}
test('D4 CB สำรอง (spare item และ auto spare) ใช้กฎ IC เดียวกับ CB วงจรย่อย = max(branchIC, IC มาตรฐาน ≥ Ik)', () => {
  const r = calc(icProject());
  const lp = po(r, 'LP1');
  const Ik = lp.sc.Ik;
  assert(Ik > 6, `Ik ${Ik}`);
  const want = Math.max(r.meta.branchIC, D.IC_KA.find((x) => x >= Ik) || 100);
  assert(want > r.meta.branchIC, 'ต้องมากกว่า branchIC เพื่อให้ทดสอบมีความหมาย');
  eq(lp.circuits.find((c) => c.cat === 'light').cb.ic, want);
  eq(lp.circuits.find((c) => c.cat === 'spare').cb.ic, want);
  const autos = lp.layout.slots.filter((s) => s && s.auto);
  eq(autos.length, 2);
  autos.forEach((s) => eq(s.cb.ic, want));
});
test('D4 Ik > 100 kA: IC ทุกตัว = 100 (ไม่ตกไป branchIC) + เตือน', () => {
  const r = calc(proj({ meta: { supply: 'lv', serviceKA: 200, main: { length: 1 } }, items: [I('MDB', { type: 'ac', btu: 12000 })] }));
  assert(r.service.scMDB.Ik > 100, `Ik ${r.service.scMDB.Ik}`);
  eq(po(r, 'MDB').circuits[0].cb.ic, 100); eq(r.service.mainCB.ic, 100); eq(po(r, 'MDB').main.ic, 100);
  assert(r.warnings.some((x) => /100 kA/.test(x)), JSON.stringify(r.warnings));
});
test('D12 po.main.ic = IC ของ CB สายป้อนจริง (แผงย่อย) และ = IC ของ CB ประธาน (MDB)', () => {
  const r = calc(proj({ meta: { growth: 0, main: { length: 2 } }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { feederLength: 30 }), P('LP1', 'LP', 'SDB1', { feederLength: 10 })],
    items: [custom3('SDB1', 20000), I('LP1', { type: 'rec', points: 20 })].concat(Array.from({ length: 8 }, () => custom3('MDB', 100000))) }));
  for (const id of ['SDB1', 'LP1']) eq(po(r, id).main.ic, po(r, id).feeder.cb.ic, id);
  eq(po(r, 'MDB').main.ic, r.service.mainCB.ic);
});

/* =========================================================================================
 * D5 แบ่งวงจรแสงสว่างตามจำนวนโคมที่ใส่ได้จริง
 * ======================================================================================= */
test('D5 29 โคม × (T8 36W 2 หลอด = 200 VA): ต่อวงจรได้ floor(2944/200) = 14 โคม -> 3 วงจร (10,10,9 โคม) CB 16 A ทั้งหมด', () => {
  // วิธีเดิม ceil(5800/2944) = 2 วงจร 15/14 โคม = 3000 VA > 2944 -> CB 20 A
  const m = E.defaultMeta();
  const cs = E.expandItem({ id: 'z', type: 'light', lamp: 't8-36', perFixture: 2, fixtures: 29, length: 15 }, m);
  eq(cs.map((c) => c.va), [2000, 2000, 1800]);
  cs.forEach((c) => E.designBranch(c, m, 0));
  eq(cs.map((c) => c.cb.at), [16, 16, 16]);
});
test('D5 โคมเดียวเกิน 80% ของ CB (3 หลอด HPS 400W = 3,300 VA) -> 1 โคม/วงจร', () => {
  const cs = E.expandItem({ id: 'z', type: 'light', lamp: 'hps-400', perFixture: 3, fixtures: 3 }, E.defaultMeta());
  eq(cs.map((c) => c.va), [3300, 3300, 3300]);
});
test('D5 circuits = 0.4 (ปัดเป็น 0) ต้องยังได้ 1 วงจร ไม่ทำโหลดหาย', () => {
  const cs = E.expandItem({ id: 'z', type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 10, circuits: 0.4 }, E.defaultMeta());
  eq(cs.length, 1); eq(cs[0].va, 400);
});

/* =========================================================================================
 * D7 แรงดันตกต้องเพิ่มชุดขนาน ก่อนจะใช้สายใหญ่เกิน maxParallelSize
 * ======================================================================================= */
test('D7 150 kVA 400 m CV ฝังดิน maxParallelSize 185: ต้องขนาน 4 ชุด × 185 mm² (VD 1.73%) ไม่ใช่สายเดี่ยวเกิน 185', () => {
  // I_F = 216.5 A ; CB 320 AT ; VD: mV/A/m(185, XLPE 3 เฟส) = 0.32 -> 0.32×216.5×400/1000/sets/400 ≤ 2%
  //   sets=1: 6.93%, 2: 3.46%, 3: 2.31% (ไม่ผ่าน), 4: 1.73% (ผ่าน) ; 150 mm² ×4: 0.37 -> 2.0025% (ไม่ผ่านนิดเดียว)
  const r = calc(proj({ meta: { autoSelectivity: false, maxParallelSize: 185, feeder: { cable: 'CV', method: 'g5', conduit: 'IMC' } }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { feederLength: 400 })], items: [custom3('SDB1', 150000)] }));
  const f = po(r, 'SDB1').feeder;
  eq(f.cb.at, 320);
  eq(f.sets, 4); eq(f.size, 185);
  near(f.vd.pct, 0.32 * (150000 / (SQ3 * 400)) * 400 / 1000 / 4 / 400 * 100, 1e-6);
  assert(f.vd.pct <= 2, 'VD ต้องไม่เกิน 2%');
  assert(f.amp >= 320, 'สายรับ CB ได้');
});

/* =========================================================================================
 * D10 มิเตอร์ กฟภ.: สายทองแดงขั้นต่ำตามตาราง 7.4 ต้องบังคับใช้จริง
 * ======================================================================================= */
test('D10 กฟภ. 45 kVA -> มิเตอร์ 30(100) A สาย Cu ขั้นต่ำ 35 mm²: สายประธานต้อง ≥ 35 (เดิมเลือก 25 ตามกระแส)', () => {
  // CB 90 A: CV ฝังดินท่อ 25 mm² = 109 A ใช้ได้ตามกระแส แต่ตารางมิเตอร์กำหนดขั้นต่ำ 35 mm²
  const r = calc(proj({ meta: { supply: 'lv', utility: 'PEA' }, items: [custom3('MDB', 45000)] }));
  eq(r.service.meter.extra, 35);
  assert(r.service.mainFeeder.size >= 35, `size ${r.service.mainFeeder.size}`);
  assert(r.service.mainFeeder.steps.some((x) => /มิเตอร์|ขั้นต่ำ/.test(x.f)), 'ต้องบอกในขั้นตอน');
});

/* =========================================================================================
 * D11 โครงสร้างแผงผิดปกติ: กำพร้า / วนลูป / ลำดับ / อ้างแผงที่ไม่มี
 * ======================================================================================= */
test('D11 แผงกำพร้า (LP9 -> SDB9 -> GHOST ที่ LP9 ถูกลิสต์ก่อน): ไม่มี NaN/undefined ทั้งผล, ออกแบบ CB ครบ, เตือน, ไม่นับรวมใน MDB', () => {
  const p = proj({ panels: [P('MDB', 'MDB', null), P('LP9', 'LP', 'SDB9'), P('SDB9', 'SDB', 'GHOST')], items: [I('LP9', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 10 })] });
  const r = calc(p);
  eq(findBad(r), null);
  for (const id of ['LP9', 'SDB9']) {
    const x = po(r, id);
    assert(x && x.feeder, `${id} ต้องมีสายป้อน`);
    assert(x.circuits.every((c) => c.cb), `${id} วงจรต้องมี CB`);
    assert(r.warnings.some((w) => w.includes(x.board.name) && /ไม่ได้เชื่อมกับ MDB/.test(w)), `${id} ต้องเตือน`);
  }
  eq(po(r, 'LP9').connected, 400);
  eq(po(r, 'SDB9').connected, 400);
  eq(r.totals.connected, 0);
});
test('D11 MDB วนกลับ (MDB.parent = LP1, LP1.parent = MDB) ไม่ stack overflow', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', 'LP1'), P('LP1', 'LP', 'MDB')], items: [I('LP1', { type: 'rec', points: 8 })] }));
  eq(findBad(r), null);
  eq(po(r, 'LP1').connected, r.totals.connected);
});
test('D11 วนกลับไม่ผ่าน MDB (A<->B) และแผงที่ชี้ตัวเอง: ไม่ throw ออกแบบครบ เตือน', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('A', 'SDB', 'B'), P('B', 'SDB', 'A'), P('S', 'LP', 'S')], items: [I('A', { type: 'ac', btu: 12000 }), I('B', { type: 'ac', btu: 12000 }), I('S', { type: 'rec', points: 4 })] }));
  eq(findBad(r), null);
  ['A', 'B', 'S'].forEach((id) => { assert(po(r, id).circuits.every((c) => c.cb), id); assert(r.warnings.some((w) => w.includes(id) && /ไม่ได้เชื่อมกับ MDB/.test(w)), 'เตือน ' + id); });
});
test('D11 item ที่ panelId ไม่มีอยู่จริง -> เตือน (ไม่หายเงียบ)', () => {
  const r = calc(proj({ items: [I('NOPE', { id: 'itemX', type: 'ac', btu: 12000, qty: 5, name: 'แอร์ผี' })] }));
  assert(r.warnings.some((w) => /ไม่พบแผง/.test(w) && /NOPE/.test(w)), JSON.stringify(r.warnings));
  eq(r.totals.connected, 0);
});
test('D11 id แผงซ้ำ / ไม่มี id: ไม่ throw มีคำเตือน', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB'), P('LP1', 'LP', 'MDB'), { name: 'noid', kind: 'LP' }], items: [I('LP1', { type: 'rec', points: 8 })] }));
  eq(findBad(r), null);
  assert(r.warnings.some((w) => /id/i.test(w)), JSON.stringify(r.warnings));
});

/* =========================================================================================
 * D13 ตัวประกอบกำลัง
 * ======================================================================================= */
test('D13 ปกติ: 100 kVA, pf 0.85 -> 0.95 : P = 85 kW, Kc = 0.6197 − 0.3287 = 0.2911, Qc = 24.74 kVAR -> ตู้ 25 kVAR', () => {
  const r = calc(proj({ meta: { pfNow: 0.85, pfTarget: 0.95 }, items: [custom3('MDB', 100000)] }));
  near(r.service.pfc.P, 85, 1e-6);
  near(r.service.pfc.kvar, 24.74, 0.02); eq(r.service.pfc.bank, 25);
});
test('D13 pfNow 0.97 > เป้าหมาย 0.95: kVAR = 0, ตู้ 0 และมีหมายเหตุ', () => {
  const r = calc(proj({ meta: { pfNow: 0.97, pfTarget: 0.95 }, items: [custom3('MDB', 100000)] }));
  eq(r.service.pfc.kvar, 0); eq(r.service.pfc.bank, 0);
  assert(/ไม่ต้อง/.test(r.service.steps.filter((s) => /ตัวประกอบกำลัง/.test(s.t)).map((s) => s.f).join(' ')), 'ต้องมีหมายเหตุ');
});
test('D13 pfTarget = 0 / 1.2 / pfNow = 0 ถูกบีบเข้าช่วง ไม่ติดลบ ไม่ Infinity', () => {
  for (const m of [{ pfTarget: 0 }, { pfTarget: 1.2 }, { pfNow: 0 }, { pfNow: 2, pfTarget: 2 }, { pfNow: -1 }]) {
    const r = calc(proj({ meta: m, items: [custom3('MDB', 100000)] }));
    assert(Number.isFinite(r.service.pfc.kvar) && r.service.pfc.kvar >= 0 && Number.isFinite(r.service.pfc.bank), JSON.stringify(m) + ' -> ' + r.service.pfc.kvar);
  }
  // pfTarget 1.2 -> 1 : Kc = tan(acos .85) = 0.6197 -> Qc = 85 × 0.6197 = 52.68 kVAR
  near(calc(proj({ meta: { pfTarget: 1.2 }, items: [custom3('MDB', 100000)] })).service.pfc.kvar, 52.68, 0.05);
});

/* =========================================================================================
 * ความทนทาน: ค่าผิดปกติต้องไม่ทำให้ throw
 * ======================================================================================= */
test('ROB รหัสสายไม่รู้จัก / วิธีเดินสายไม่รู้จัก / ชนิดท่อไม่รู้จัก -> ไม่ throw มีคำเตือน', () => {
  const base = () => ({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [I('LP1', { type: 'rec', points: 8 }), I('LP1', { type: 'ac', btu: 12000 })] });
  for (const m of [{ branch: { method: 'g4' } }, { main: { cable: 'ZZ' } }, { feeder: { cable: 'QQ', method: 'g9', conduit: 'XX' } }, { branch: { cable: 'NOPE' } }]) {
    const r = calc(proj(Object.assign(base(), { meta: m })));
    eq(findBad(r), null, JSON.stringify(m));
    assert(r.warnings.some((w) => /ไม่รู้จัก|ไม่ถูกต้อง/.test(w)), JSON.stringify(m) + ' ' + JSON.stringify(r.warnings));
  }
});
test('ROB maxParallelSize / main.maxSize เล็กผิดปกติ (2) และ minFeeder ใหญ่เกินตาราง (1000) -> ไม่ throw', () => {
  const base = () => ({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB1')], items: [I('LP1', { type: 'rec', points: 8 }), I('SDB1', { type: 'motor', kw: 30, phases: 3 })] });
  for (const m of [{ maxParallelSize: 2 }, { main: { maxSize: 2 } }, { minFeeder: 1000 }, { minOther: 1000, minLight: 1000 }]) {
    const r = calc(proj(Object.assign(base(), { meta: m })));
    eq(findBad(r), null, JSON.stringify(m));
  }
});
test('ROB preset ลิฟต์/บันไดเลื่อน/ชิลเลอร์ เกินช่วง -> ใช้ตัวสุดท้าย/ตัวแรก ไม่ throw + เตือนที่วงจร', () => {
  const r = calc(proj({ items: [I('MDB', { type: 'lift', preset: 99 }), I('MDB', { type: 'esc', preset: 99 }), I('MDB', { type: 'chiller', preset: -1, cooling: 'water' }), I('MDB', { type: 'chiller', preset: 99, cooling: 'air' })] }));
  const cs = po(r, 'MDB').circuits;
  eq(cs.map((c) => c.va), [D.LIFTS[D.LIFTS.length - 1][3] * 1000, D.ESCALATORS[D.ESCALATORS.length - 1][2] * 1000, D.CHILLER_WATER[0][1] * 1000, D.CHILLER_AIR[D.CHILLER_AIR.length - 1][1] * 1000]);
  assert(cs.every((c) => c.warn.some((w) => /preset|รุ่น|ช่วง/.test(w))), JSON.stringify(cs.map((c) => c.warn)));
});
test('ROB ค่าติดลบ: heater watt −3500 -> 3500, length −10 -> 20, pf −0.5 -> 1, ไม่มีกระแส/VD ติดลบ', () => {
  const r = calc(proj({ items: [I('MDB', { type: 'heater', watt: -3500, length: -10 }), I('MDB', { type: 'custom', watt: 1000, pf: -0.5 }), I('MDB', { type: 'custom', va: -500 })] }));
  const cs = po(r, 'MDB').circuits;
  eq(cs.map((c) => c.va), [3500, 1000, 0]);
  eq(cs[0].L, 20);
  assert(cs.every((c) => c.I >= 0 && c.vd.pct >= 0), 'ไม่ติดลบ');
  eq(findBad(r), null);
});
test('ROB qty/points/fixtures: 0, NaN, ติดลบ -> 1 ; เกินช่วง -> ถูกจำกัด (2000 / 2000 / 20000) พร้อมเตือน', () => {
  const m = E.defaultMeta();
  for (const q of [0, 'abc', -3, 0.4]) eq(E.expandItem({ id: 'a', type: 'ac', btu: 12000, qty: q }, m).length, 1, 'qty ' + q);
  eq(E.expandItem({ id: 'a', type: 'ac', btu: 12000, qty: 5000 }, m).length, 2000);
  const rec = E.expandItem({ id: 'r', type: 'rec', points: 1e6, perCircuit: 10 }, m);
  eq(rec.reduce((s, c) => s + c.points, 0), 2000);
  const lt = E.expandItem({ id: 'l', type: 'light', lamp: 'led-t8-18', perFixture: 1, fixtures: 1e6 }, m);
  eq(lt.reduce((s, c) => s + c.share.n, 0), 20000);
  const w = []; E.expandItem({ id: 'a', type: 'ac', btu: 12000, qty: 5000 }, m, w);
  assert(w.length && /2,000/.test(w.join(' ')), JSON.stringify(w));
  const r = calc(proj({ items: [I('MDB', { type: 'ac', btu: 12000, qty: 5000, name: 'แอร์เยอะ' })] }));
  assert(r.warnings.some((x) => /2,000/.test(x)), 'ต้องเตือนใน calculate');
});
test('ROB ตาราง A/C: 1 เฟส 48,000 BTU เกินตาราง (แถว 40,000) และ 3 เฟส 12,000 BTU ต่ำกว่าตาราง (แถว 36,000) -> เตือนที่วงจร', () => {
  const m = E.defaultMeta();
  const a = E.expandItem({ id: 'a', type: 'ac', btu: 48000, phases: 1 }, m)[0];
  eq(a.va, 4800);
  const r = calc(proj({ items: [I('MDB', { type: 'ac', btu: 48000, phases: 1 }), I('MDB', { type: 'ac', btu: 12000, phases: 3 }), I('MDB', { type: 'ac', btu: 24000, phases: 1 })] }));
  const cs = po(r, 'MDB').circuits;
  assert(cs[0].warn.some((w) => /BTU/.test(w)), JSON.stringify(cs[0].warn));
  assert(cs[1].warn.some((w) => /BTU/.test(w)), JSON.stringify(cs[1].warn));
  assert(!cs[2].warn.some((w) => /BTU/.test(w)), 'ในตารางไม่ต้องเตือน');
});
test('ROB ways ที่กำหนดเองใหญ่ผิดปกติ (1e9) ไม่ทำให้หน่วยความจำหมด ; board.phase ที่ไม่ใช่ 0|1|2|A|B|C ถูกมองข้าม', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { ways: 1e9 }), P('LP2', 'LP', 'MDB', { ways: -5 }), P('S', 'SDB', 'MDB'), P('K1', 'LP', 'S', { phases: 1, phase: true }), P('K2', 'LP', 'S', { phases: 1, phase: 'C' })],
    items: [I('LP1', { type: 'rec', points: 8 }), I('LP2', { type: 'rec', points: 8 }), I('K1', { type: 'rec', points: 8 }), I('K2', { type: 'rec', points: 8 })] }));
  eq(findBad(r), null);
  assert(po(r, 'LP1').layout.ways <= 120, 'ways ถูกจำกัด');
  eq(po(r, 'K2').feedPhase, 2); // 'C' = เฟสที่ 3
  assert([0, 1].includes(po(r, 'K1').feedPhase), 'phase: true ต้องถูกมองข้าม แล้วกระจายอัตโนมัติ (ไม่ใช่เฟส C ที่ K2 ใช้อยู่)');
});
test('ROB ค่าใหญ่มาก (1e308 VA / kW / ความยาว) ยังได้ตัวเลขจำกัดค่า ไม่ Infinity', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { feederLength: 1e308 })], items: [I('SDB1', { type: 'custom', va: 1e308, phases: 3 }), I('SDB1', { type: 'motor', kw: 1e308 }), I('SDB1', { type: 'rec', points: 5, vaPerPoint: 1e308, length: 1e308 })] }));
  eq(findBad(r), null);
});
test('ROB project น้อยที่สุด ({}, ไม่มี panels/items/meta) ก็คำนวณได้ผลลัพธ์', () => {
  for (const p of [{}, { meta: {} }, { panels: [], items: [] }, { panels: [{ id: 'MDB', kind: 'MDB' }] }, { meta: { branch: null, feeder: null }, panels: null, items: null }]) {
    const r = calc(p);
    assert(r && Array.isArray(r.panels) && r.panels.length >= 1 && r.service, JSON.stringify(p));
    eq(findBad(r), null);
  }
});
test('ROB phases ผิดค่า (2, "3") ถูกจัดเป็น 1/3 เฟส ไม่ทำให้ช่องผิด', () => {
  const r = calc(proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { phases: '3' })], items: [I('LP1', { type: 'motor', kw: 5.5, phases: '3' }), I('LP1', { type: 'cook', watt: 2000, phases: 2 })] }));
  const lp = po(r, 'LP1');
  eq(lp.circuits[0].slotNos.length, 3);
  eq(lp.circuits[1].phases, 1);
});

/* =========================================================================================
 * normalizeProject
 * ======================================================================================= */
test('normalizeProject: เติมค่าเริ่มต้นของ meta (รวม deep-merge branch/feeder/main/hv และ phasePattern=pair) ไม่แก้ข้อมูลเข้า', () => {
  const raw = { meta: { name: 'x', branch: { cable: 'CV' }, main: { length: 7 } }, panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3 }], items: [] };
  const before = JSON.stringify(raw);
  const { project, notes } = E.normalizeProject(raw);
  eq(JSON.stringify(raw), before, 'input mutated');
  eq(project.meta.name, 'x');
  eq(project.meta.branch, { cable: 'CV', method: 'g2', conduit: 'EMT' });
  eq(project.meta.main.length, 7); eq(project.meta.main.cable, 'CV'); eq(project.meta.main.maxSize, 300);
  eq(project.meta.hv, { length: 20 });
  eq(project.meta.phasePattern, 'pair');
  assert(Array.isArray(notes));
});
test('normalizeProject: ซ่อมแผง (id ซ้ำ/ไม่มี, parent ไม่มี/วน/ชี้ตัวเอง, ไม่มี MDB) และตัดรายการเสีย พร้อมหมายเหตุ', () => {
  const raw = {
    panels: [{ id: 'LP1', name: 'a', kind: 'LP', parent: 'MDB' }, { id: 'LP1', name: 'dup', kind: 'LP', parent: 'MDB' }, { name: 'noid', kind: 'LP' }, { id: 'S1', kind: 'SDB', parent: 'S2' }, { id: 'S2', kind: 'SDB', parent: 'S1' }, { id: 'Z', kind: 'LP', parent: 'Z' }, { id: 'G', kind: 'LP', parent: 'GHOST' }, 'junk', null],
    items: [{ id: 'a', panelId: 'LP1', type: 'rec', points: 4 }, { id: 'a', panelId: 'LP1', type: 'rec', points: 5 }, { panelId: 'LP1', type: 'ac' }, { id: 'b', panelId: 'NOPE', type: 'rec' }, { id: 'c', panelId: 'LP1', type: 'weird' }, 7, null]
  };
  const { project, notes } = E.normalizeProject(raw);
  const ids = project.panels.map((p) => p.id);
  eq(new Set(ids).size, ids.length, 'id แผงต้องไม่ซ้ำ');
  assert(ids.every((x) => typeof x === 'string' && x), 'id ต้องเป็นข้อความ');
  eq(project.panels.filter((p) => p.kind === 'MDB').length, 1);
  const mdb = project.panels.find((p) => p.kind === 'MDB');
  eq(mdb.parent, null);
  // ทุกแผงที่ไม่ใช่ MDB ต้องเดินขึ้นไปถึง MDB ได้
  for (const p of project.panels) { let cur = p, n = 0; while (cur.kind !== 'MDB' && n++ < 50) cur = project.panels.find((x) => x.id === cur.parent); assert(cur && cur.kind === 'MDB', p.id + ' ไม่ถึง MDB'); }
  const iids = project.items.map((i) => i.id);
  eq(new Set(iids).size, iids.length, 'id item ต้องไม่ซ้ำ');
  assert(project.items.every((i) => ids.includes(i.panelId) && D.LAMPS && ['light', 'rec', 'ac', 'heater', 'cook', 'motor', 'lift', 'esc', 'chiller', 'custom', 'spare'].includes(i.type)), 'item ต้องอ้างแผงที่มีและชนิดที่รู้จัก');
  assert(notes.length >= 3 && notes.every((x) => typeof x === 'string'), JSON.stringify(notes));
  // ผลที่ได้คำนวณได้และไม่มีคำเตือนเรื่องโครงสร้าง
  const r = calc(project);
  eq(findBad(r), null);
  assert(!r.warnings.some((w) => /ไม่ได้เชื่อมกับ MDB|ไม่พบแผง/.test(w)), JSON.stringify(r.warnings));
});
test('normalizeProject ทำซ้ำได้ (idempotent) และโครงการดี ๆ ไม่ถูกแก้ ไม่มีหมายเหตุ', () => {
  const good = proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [I('LP1', { type: 'rec', points: 8 })] });
  const a = E.normalizeProject(good);
  eq(a.notes, []);
  eq(a.project.panels, good.panels); eq(a.project.items, good.items);
  const b = E.normalizeProject(a.project);
  eq(b.project, a.project); eq(b.notes, []);
});

/* =========================================================================================
 * ประสิทธิภาพ
 * ======================================================================================= */
test('PERF โครงการ 1,000 วงจร (35 แผง LP + 5 SDB) คำนวณ < 1.5 วินาที', () => {
  const panels = [P('MDB', 'MDB', null)], items = [];
  for (let s = 0; s < 5; s++) {
    panels.push(P('SDB' + s, 'SDB', 'MDB'));
    for (let l = 0; l < 7; l++) {
      const id = `LP${s}_${l}`; panels.push(P(id, 'LP', 'SDB' + s));
      items.push(I(id, { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 150, circuits: 8 }));
      items.push(I(id, { type: 'rec', points: 100, perCircuit: 10 }));
      items.push(I(id, { type: 'ac', btu: 18000, qty: 6 }));
      items.push(I(id, { type: 'heater', watt: 3500, qty: 2 }));
      items.push(I(id, { type: 'custom', va: 800, qty: 3 }));
    }
  }
  const p = proj({ panels, items });
  const t0 = Date.now(); const r = calc(p); const ms = Date.now() - t0;
  const nC = r.panels.reduce((s, x) => s + x.circuits.length, 0);
  assert(nC >= 1000, `circuits ${nC}`);
  assert(ms < 1500, `${ms} ms สำหรับ ${nC} วงจร`);
  return `${nC} วงจร ${ms} ms`;
});

/* =========================================================================================
 * CB กำหนดเองรายวงจร (item.cbOv — ลากวาง/เลือกจาก dropdown ในหน้าตารางโหลด)
 * ======================================================================================= */
function cbProject(cbOv) {
  const it = I('LP1', { type: 'rec', points: 20, length: 20 });
  if (cbOv) it.cbOv = cbOv;
  return proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [it] });
}
const firstRec = (r) => po(r, 'LP1').circuits.find((c) => c.cat === 'rec');
test('CBOV1 ไม่กำหนด → เลือก CB เอง และไม่มี cbForce; ทุกวงจรมี cIdx เรียง 1..n', () => {
  const r = calc(cbProject());
  const cs = po(r, 'LP1').circuits.filter((c) => c.cat === 'rec');
  assert(cs.every((c, i) => c.cIdx === i + 1 && !c.cbForce), 'cIdx/cbForce');
});
test('CBOV2 กำหนด 50 A → CB 50 A, สายใหญ่ขึ้นตาม CB, บันทึก cbAuto ไว้คืนค่า', () => {
  const auto = firstRec(calc(cbProject()));
  const c = firstRec(calc(cbProject({ 1: 50 })));
  eq(c.cb.at, 50); eq(c.cbAuto, auto.cb.at);
  assert(c.cond.size > auto.cond.size, `สาย ${c.cond.size} ต้องใหญ่กว่า ${auto.cond.size}`);
  assert(c.steps.some((x) => x.t === 'CB กำหนดเอง'), 'ต้องมีขั้นตอนอธิบาย');
});
test('CBOV3 กำหนดเฉพาะวงจรที่ 2 → วงจรอื่นไม่เปลี่ยน', () => {
  const base = po(calc(cbProject()), 'LP1').circuits.filter((c) => c.cat === 'rec');
  const got = po(calc(cbProject({ 2: 40 })), 'LP1').circuits.filter((c) => c.cat === 'rec');
  assert(base.length >= 2, 'ต้องมีอย่างน้อย 2 วงจร');
  eq(got[1].cb.at, 40); eq(got[0].cb.at, base[0].cb.at);
});
test('CBOV4 CB เล็กกว่ากระแสโหลด → ยังคำนวณได้และมีคำเตือน', () => {
  const p = proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [Object.assign(I('LP1', { type: 'custom', va: 6900, phases: 1, continuous: false }), { cbOv: { 1: 10 } })] });
  const c = po(calc(p), 'LP1').circuits.find((x) => x.itemId === p.items[0].id);
  eq(c.cb.at, 10);
  assert(c.warn.some((w) => /CB ที่กำหนด/.test(w)), 'ต้องเตือน: ' + JSON.stringify(c.warn));
});
test('CBOV5 ค่านอกเหนือ/ขยะใน cbOv ไม่ทำให้คำนวณพัง', () => {
  const r = calc(cbProject({ 1: 'x', 99: 16, 0: 20, 2: -5 }));
  assert(firstRec(r).cb.at > 0, 'ต้องได้ CB');
});

test('CBOV6 CB มอเตอร์ที่กำหนดใหญ่เกินไม่ขยาย CB สายป้อน (สมการ 8-5 ใช้ค่าที่ระบบเลือก)', () => {
  const mk = (ov) => { const it = I('LP1', { type: 'motor', kw: 7.5, phases: 3, qty: 1, length: 15 }); if (ov) it.cbOv = ov; return proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items: [Object.assign(it, { panelId: 'SDB1' })] }); };
  const a = po(calc(mk()), 'SDB1'), b = po(calc(mk({ 1: 80 })), 'SDB1');
  eq(b.circuits[0].cb.at, 80);
  eq(b.feeder.cb.at, a.feeder.cb.at);
  assert(b.circuits[0].warn.some((w) => /2\.5Im/.test(w)), 'ต้องเตือนเกิน 2.5Im');
});
test('CBOV7 ขนาดที่ไม่ใช่ MCB มาตรฐานใน cbOv ถูกเมิน', () => {
  const auto = firstRec(calc(cbProject())).cb.at;
  eq(firstRec(calc(cbProject({ 1: 16.5 }))).cb.at, auto);
  eq(firstRec(calc(cbProject({ 1: 100000 }))).cb.at, auto);
});


/* ---------- ตรึงเฟสวงจร (item.phOv) ---------- */
const VAS = [3200, 2900, 2500, 2100, 1800, 1500, 1200, 900, 600];
function phProject(pins, opt) {
  opt = opt || {};
  const items = VAS.map((va) => I('LP1', { type: 'custom', va, phases: 1, continuous: false }));
  Object.entries(pins || {}).forEach(([k, ph]) => { items[k].phOv = { 1: ph }; });
  if (opt.three) items.push(I('LP1', { type: 'custom', va: 9000, phases: 3, continuous: false }));
  const pr = proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', opt.lp || {})], items });
  if (opt.pattern) pr.meta.phasePattern = opt.pattern;
  return pr;
}
const cOf = (r, pr, k) => po(r, 'LP1').circuits.find((c) => c.itemId === pr.items[k].id);
for (const pattern of ['seq', 'pair']) for (const bal of ['auto', 'deep']) {
  test(`PHOV1 ${pattern}/${bal}: ตรึงวงจรไว้เฟส A/B/C ได้ตามที่กำหนด`, () => {
    for (const [k, ph] of [[0, 2], [1, 2], [8, 0], [4, 1]]) {
      const pr = phProject({ [k]: ph }, { pattern, lp: { balance: bal } });
      const r = calc(pr);
      eq(cOf(r, pr, k).phase, ph);
      assert(!r.warnings.some((w) => /ตรึง/.test(w)), r.warnings.join(' | '));
    }
  });
  test(`PHOV2 ${pattern}/${bal}: ตรึงหลายวงจรพร้อมกัน ทุกตัวอยู่เฟสที่กำหนด และโหลดรวมทุกเฟสเท่าเดิม`, () => {
    const pins = { 0: 0, 1: 1, 2: 2, 3: 0 };
    const pr = phProject(pins, { pattern, lp: { balance: bal } });
    const base = po(calc(phProject({}, { pattern, lp: { balance: bal } })), 'LP1');
    const r = calc(pr), p = po(r, 'LP1');
    Object.entries(pins).forEach(([k, ph]) => eq(cOf(r, pr, Number(k)).phase, ph));
    near(p.phaseVA[0] + p.phaseVA[1] + p.phaseVA[2], base.phaseVA[0] + base.phaseVA[1] + base.phaseVA[2], 1e-6);
  });
}
test('PHOV3 ตรึงทุกวงจรไว้เฟส A เกินจำนวนช่อง (seq) → ตัวที่ใส่ไม่ได้ปลดตรึง + มีคำเตือน ไม่พัง', () => {
  const pins = {}; VAS.forEach((_, k) => { pins[k] = 0; });
  const pr = phProject(pins, { pattern: 'seq' });
  const r = calc(pr), p = po(r, 'LP1');
  const onA = VAS.map((_, k) => cOf(r, pr, k)).filter((c) => c.phase === 0).length;
  const slotsA = p.layout.slotPhase.filter((x, i) => x === 0 && p.layout.slots[i] && !p.layout.slots[i].auto && !p.layout.slots[i].ref).length;
  eq(onA, slotsA);
  assert(r.warnings.some((w) => /ตรึง .* ไว้เฟส A ไม่ได้/.test(w)), 'ต้องมีคำเตือน: ' + r.warnings.join(' | '));
});
test('PHOV4 ค่าขยะใน phOv ถูกเมิน (ไม่พัง ไม่ตรึง)', () => {
  const pr = phProject({});
  pr.items[0].phOv = { 1: 'x' }; pr.items[1].phOv = { 1: 5 }; pr.items[2].phOv = { 1: -1 }; pr.items[3].phOv = null; pr.items[4].phOv = { 1: '' }; pr.items[5].phOv = { 1: 1.5 };
  const r = calc(pr);
  assert(po(r, 'LP1').circuits.every((c) => c.phForce == null), 'ต้องไม่มีวงจรถูกตรึง');
});
test('PHOV5 วงจร 3 เฟสไม่รับการตรึงเฟส', () => {
  const pr = phProject({}, { three: true });
  pr.items[pr.items.length - 1].phOv = { 1: 1 };
  const r = calc(pr), c = cOf(r, pr, pr.items.length - 1);
  eq(c.phForce, undefined); eq(c.phase, null);
});
test('PHOV6 แผง 1 เฟส: phOv ไม่มีผล ทุกวงจรอยู่เฟสเดียว', () => {
  const pr = phProject({ 0: 2 }, { lp: { phases: 1 } });
  const r = calc(pr);
  assert(po(r, 'LP1').circuits.every((c) => c.phase === 0), 'ทุกวงจรเฟส 0');
});
test('PHOV7 ตรึงวงจรใหญ่สุด 2 ตัวไว้เฟสเดียวกัน → ตัวจัดเฟสชดเชยได้ดีที่สุดเท่าที่ข้อจำกัดยอม', () => {
  // seq: 9 วงจร = เฟสละ 3 ช่องพอดี → A ต้องมี 3200+2900+วงจรเล็กสุด 600 = 6700 ; เฉลี่ย 16700/3 → ไม่สมดุลต่ำสุด 20.36%
  const seq = po(calc(phProject({ 0: 0, 1: 0 }, { pattern: 'seq', lp: { balance: 'deep' } })), 'LP1');
  near(seq.phaseVA[0], 6700, 1e-6);
  assert(seq.unbalance <= 20.36, 'seq unbalance ' + seq.unbalance);
  // pair: ไม่จำกัดจำนวนต่อเฟส → A = 6100, B/C แบ่ง 10600 → ไม่สมดุลต่ำสุด ≈ 9.58%
  const pair = po(calc(phProject({ 0: 0, 1: 0 }, { pattern: 'pair', lp: { balance: 'deep' } })), 'LP1');
  near(pair.phaseVA[0], 6100, 1e-6);
  assert(pair.unbalance <= 9.6, 'pair unbalance ' + pair.unbalance);
});

test('PHOV8 Spare ไม่รับการตรึงเฟส ; คำเตือนตรึงไม่ได้ระบุเลขวงจร', () => {
  const pr = phProject({});
  pr.items.push(I('LP1', { type: 'spare', va: 0, phases: 1, qty: 2 })); pr.items[pr.items.length - 1].phOv = { 1: 2, 2: 2 };
  const r = calc(pr);
  assert(po(r, 'LP1').circuits.filter((c) => c.cat === 'spare').every((c) => c.phForce == null), 'spare ต้องไม่ถูกตรึง');
  const pins = {}; VAS.forEach((_, k) => { pins[k] = 0; });
  const r2 = calc(phProject(pins, { pattern: 'seq' }));
  assert(r2.warnings.filter((w) => /ตรึง/.test(w)).every((w) => /\(วงจร \d+\)/.test(w)), r2.warnings.join(' | '));
});

/* =========================================================================================
 * CB เต้ารับเริ่มต้น 16 A (เต้ารับ มอก. 166-2549 พิกัด 16 A) — ขยับเป็น 20 A เมื่อ I × 1.25 > 16 A
 * ======================================================================================= */
const recPanel = (rec) => proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [I('LP1', Object.assign({ type: 'rec' }, rec))] });
test('CB16-1 เต้ารับทั่วไป 10 จุด × 180 VA = 1,800 VA (7.83 A × 1.25 = 9.8 A) → CB 16 A อัตโนมัติ', () => {
  const c = po(calc(recPanel({ points: 10 })), 'LP1').circuits.find((x) => x.cat === 'rec');
  eq(c.cb.at, 16);
});
test('CB16-2 เต้ารับ 10 จุด × 360 VA = 3,600 VA (15.65 A × 1.25 = 19.6 A > 16 A) → ขยับเป็น CB 20 A', () => {
  const c = po(calc(recPanel({ points: 10, vaPerPoint: 360 })), 'LP1').circuits.find((x) => x.cat === 'rec');
  eq(c.cb.at, 20);
});
done();
