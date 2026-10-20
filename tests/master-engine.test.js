// Master plan (docs/ai-engineering-agent-master-plan.md) — ส่วนคำนวณ: เต้ารับ general/heavy, Auto-Selectivity, Fire Pump, Riser
// รัน: node tests/master-engine.test.js
const { E, D, proj, P, I } = require('./helpers/build.js');
const { test, assert, eq, near, done } = require('./helpers/eng-harness.js');

const calc = (p) => E.calculate(p);
const board = (r, id) => r.panels.find((b) => b.id === id);
const one = (items, meta, panels) => proj({ meta, panels: panels || [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items });
const recs = (r, id) => board(r, id || 'LP1').circuits.filter((c) => c.cat === 'rec');

/* ---------- 1) เต้ารับ general (16 A / 2.5 mm²) vs heavy (20 A / 4 mm² / RCBO 30 mA) — แผนแม่บท 2.1 ---------- */
test('1.1 เต้ารับ duty=heavy: CB 20 A + RCBO 30 mA + สาย ≥ 4 mm² + ดิน 2.5 mm²', () => {
  const c = recs(calc(one([I('LP1', { type: 'rec', duty: 'heavy', points: 6, name: 'เต้ารับครัว' })])))[0];
  eq(c.cb.at, 20);
  assert(c.cb.rcd === true, 'ต้องเป็น RCBO: ' + JSON.stringify(c.cb));
  assert(c.cond.size >= 4, 'สายเฟส ' + c.cond.size);
  eq(c.cond.ground, 2.5);
});
test('1.2 เต้ารับ duty=heavy แบ่งวงจรไม่เกิน 6 จุด/วงจร (13 จุด → 3 วงจร)', () => {
  const cs = recs(calc(one([I('LP1', { type: 'rec', duty: 'heavy', points: 13 })])));
  eq(cs.length, 3);
  assert(cs.every((c) => c.points <= 6), JSON.stringify(cs.map((c) => c.points)));
  assert(cs.every((c) => c.cb.at === 20 && c.cb.rcd), 'ทุกวงจรต้อง 20 A RCBO');
});
test('1.3 เต้ารับ duty ไม่ระบุ/general: คง 16 A MCB สาย 2.5 mm² ไม่บังคับ RCD', () => {
  for (const duty of [undefined, 'general']) {
    const cs = recs(calc(one([I('LP1', { type: 'rec', duty, points: 10 })])));
    eq(cs.length, 1);
    eq([cs[0].cb.at, cs[0].cb.rcd, cs[0].cond.size, cs[0].cond.ground], [16, false, 2.5, 2.5]);
  }
});
test('1.4 ขั้นตอนคำนวณ heavy อธิบาย RCBO 30 mA และ CB 20 A', () => {
  const c = recs(calc(one([I('LP1', { type: 'rec', duty: 'heavy', points: 4 })])))[0];
  const txt = c.steps.map((s) => s.t + ' ' + s.f).join(' | ');
  assert(/RCBO/.test(txt) && /30 mA/.test(txt) && /20 A/.test(txt), txt);
});
test('1.5 Life-safety: วงจรเต้ารับที่ CB > 20 A (เช่น 40 A) ต้องมีคำเตือนเรื่องปลั๊ก 16 A (มอก. 166)', () => {
  const r = calc(one([I('LP1', { type: 'rec', points: 10, perCircuit: 10, vaPerPoint: 600 })]));
  const c = recs(r)[0];
  assert(c.cb.at > 20, 'cb ' + c.cb.at);
  assert(r.warnings.some((w) => /166/.test(w) && /20 A/.test(w)), JSON.stringify(r.warnings));
});
test('1.6 เต้ารับ general ปกติ (CB 16 A) ไม่มีคำเตือน มอก. 166', () => {
  const r = calc(one([I('LP1', { type: 'rec', points: 10 })]));
  assert(!r.warnings.some((w) => /166/.test(w)), JSON.stringify(r.warnings));
});

/* ---------- 2) Auto-Selectivity: CB สายป้อน ≥ 1.6 × CB วงจรย่อยใหญ่สุด — แผนแม่บท 2.2 ---------- */
// 90 จุด × 180 VA = 9 วงจร 16 A (สมดุล 3/3/3) ; demand ≈ 13.1 kVA → I_F 18.9 A × 1.25 = 23.6 A → เดิมเลือก 25 AT (25/16 = 1.56 < 1.6 → ไม่เลือกตัด)
const lp25 = (meta, extra) => calc(one([I('LP1', { type: 'rec', points: 90 })].concat(extra || []), meta));
const noneOf = (r, id) => board(r, id || 'LP1').selectivity.filter((s) => s.status === 'none');
test('2.1 เปิด autoSelectivity (ค่าเริ่มต้น): LP ที่เคยได้เมน 25 AT ขยับเป็น 30 AT และไม่มี "ไม่เลือกตัด"', () => {
  const r = lp25();
  eq(board(r, 'LP1').feeder.cb.at, 30);
  assert(noneOf(r).length === 0, JSON.stringify(noneOf(r).map((s) => [s.up, s.down, s.ratio])));
});
test('2.2 ปิด meta.autoSelectivity=false: พฤติกรรมเดิม (25 AT และ "ไม่เลือกตัด")', () => {
  const r = lp25({ autoSelectivity: false });
  eq(board(r, 'LP1').feeder.cb.at, 25);
  assert(noneOf(r).length > 0, 'ต้องมี none');
});
test('2.3 สายป้อนรับกระแสได้ ≥ CB ที่ขยับขึ้น (CB ปกป้องสาย)', () => {
  const f = board(lp25(), 'LP1').feeder;
  assert(f.amp >= f.cb.at, `amp ${f.amp} < at ${f.cb.at}`);
});
test('2.4 steps อธิบายการประสานการเลือกตัด (1.6 × CB ย่อยใหญ่สุด)', () => {
  const st = board(lp25(), 'LP1').feeder.steps.find((x) => /เลือกตัด|Selectivity/i.test(x.t));
  assert(st && /1\.6/.test(st.f) && /16/.test(st.f), JSON.stringify(st));
});
test('2.5 ไม่ขยับเมื่อไม่จำเป็น: CB เดิมเลือกตัดอยู่แล้ว → ไม่มี step selectivity', () => {
  const r = calc(one([I('LP1', { type: 'rec', points: 200 })]));   // 20 วงจร 16 A ; เมนตามโหลด ≈ 50 AT ใหญ่กว่า 1.6 × 16 อยู่แล้ว
  const f = board(r, 'LP1').feeder;
  assert(f.cb.at >= 1.6 * Math.max(...board(r, 'LP1').circuits.map((c) => c.cb.at)), 'ratio');
  assert(!f.steps.some((x) => /Auto-Selectivity/i.test(x.t)), 'ไม่ควรมี step');
});
test('2.6 วงจร heavy 20 A ในแผง → เมนต้อง ≥ 32 A (ขยับเป็น 40 AT) และวงจรย่อยทุกกลุ่มอัตราส่วน ≥ 1.6', () => {
  const r = calc(one([I('LP1', { type: 'rec', duty: 'heavy', points: 12 }), I('LP1', { type: 'rec', points: 20 })]));
  const f = board(r, 'LP1').feeder;
  assert(f.cb.at >= 32, 'at ' + f.cb.at);
  assert(board(r, 'LP1').selectivity.filter((s) => s.kind === 'branch').every((s) => s.ratio >= D.SELECTIVITY.ratioMin - 1e-9), JSON.stringify(board(r, 'LP1').selectivity.map((s) => s.ratio)));
});
test('2.7 วงจรสำรอง (SPARE) ไม่นับเป็น CB ย่อยใหญ่สุด', () => {
  const a = lp25();
  const b = lp25(undefined, [I('LP1', { type: 'spare', cb: 63 })]);
  eq(board(b, 'LP1').feeder.cb.at, board(a, 'LP1').feeder.cb.at);
});
test('2.8 มอเตอร์ในแผง: ไม่ดัน CB สายป้อนเกินเพดานสมการ 8-5 (ICB,F ≤ CB มอเตอร์ + กระแสโหลดอื่น) เว้นแต่ต้องรับ Ic', () => {
  const r = calc(one([I('LP1', { type: 'motor', kw: 7.5, phases: 3, start: 'DOL' }), I('LP1', { type: 'rec', points: 20 })]));
  const p = board(r, 'LP1'), f = p.feeder, m = p.circuits.find((c) => c.motor);
  const cbMax = m.cb.at + 3600 / (Math.sqrt(3) * 400);   // เต้ารับ 2 วงจร × 1,800 VA ; ดีมานด์ 100% (≤ 10 kVA)
  const minGeIc = D.MCCB_FRAMES.flatMap((fr) => fr.at).filter((a) => a >= f.Ic - 1e-9).sort((a, b) => a - b)[0];
  assert(f.cb.at <= cbMax + 1e-9 || f.cb.at === minGeIc, `at ${f.cb.at} cbMax ${cbMax.toFixed(1)} minGeIc ${minGeIc}`);
});
test('2.9 guard เมื่อปิด auto: คำแนะนำ CB ย่อยของวงจร heavy ต้องไม่ต่ำกว่า 20 A (ขั้นต่ำของเต้ารับใช้งานหนัก)', () => {
  const r = calc(one([I('LP1', { type: 'rec', duty: 'heavy', points: 6 }), I('LP1', { type: 'rec', points: 100 })], { autoSelectivity: false }));
  const heavy = board(r, 'LP1').selectivity.find((s) => s.kind === 'branch' && /^20A/.test(s.down));
  assert(heavy && heavy.status === 'none', JSON.stringify(heavy));
  assert(heavy.rec.at === null || heavy.rec.at >= 20, 'rec ' + JSON.stringify(heavy.rec));
});

/* ---------- 3) ปั๊มดับเพลิง (Fire Pump) — NFPA 20 / วสท. บทที่ 10 : Mag-only, ไม่มี Overload, สาย FRC, ห้าม RCD, ต่อตู้ฉุกเฉิน ---------- */
// ตัวอย่างคำนวณมือ: 22 kW 3 เฟส → FLA 42 A (ตาราง 8.2) ; LRC = 6 × 42 = 252 A ; CB ≥ 2.5 × 42 = 105 A → 125 AT (≤ 3 × 42 = 126 A) ; สาย ≥ 1.25 × 42 = 52.5 A
const fpItem = (extra) => I('LP1', Object.assign({ type: 'fire_pump', kw: 22, phases: 3, name: 'ปั๊มดับเพลิงหลัก' }, extra));
const fpProj = (extra, meta) => one([fpItem(extra)], meta, [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { emergency: true })]);
const fpc = (r, id) => board(r, id || 'LP1').circuits.find((c) => c.cat === 'fire_pump');
const SAN = require('../public/js/sanitize.js');
test('3.1 item fire_pump สร้างวงจร cat fire_pump พร้อม FLA 42 A และ LRC 6×FLA = 252 A', () => {
  const c = fpc(calc(fpProj()));
  assert(c, 'ไม่พบวงจร fire_pump (ถูกตัดทิ้ง?)');
  eq([c.motor.im, c.motor.lrc], [42, 252]);
});
test('3.2 CB เป็น MCCB 3P แบบ Magnetic-only 125 AT (2.5×FLA = 105 → ขนาดมาตรฐานถัดไป ≤ 3×FLA)', () => {
  const c = fpc(calc(fpProj()));
  eq([c.cb.type, c.cb.at, c.cb.poles, c.cb.magOnly, !!c.cb.rcd], ['MCCB', 125, 3, true, false]);
  assert(/Mag/i.test(c.cb.label), c.cb.label);
  assert(c.cb.at >= 2.5 * 42 && c.cb.at <= 3 * 42, 'อยู่ในช่วง 2.5–3×FLA');
});
test('3.3 ไม่มี Overload relay: olSet ว่าง, ไม่มี step Overload, cb.noOverload', () => {
  const c = fpc(calc(fpProj()));
  assert(c.olSet == null && c.cb.noOverload === true, JSON.stringify([c.olSet, c.cb.noOverload]));
  assert(!c.steps.some((x) => /Overload/i.test(x.t)), c.steps.map((x) => x.t));
  assert(c.steps.some((x) => /overload/i.test(x.f) && /ห้าม|ไม่/.test(x.f)), 'ต้องอธิบายว่าไม่ใช้ overload: ' + c.steps.map((x) => x.f));
});
test('3.4 สาย FRC (BS 6387 CWZ): ชนิด FRC รับกระแสได้ ≥ 1.25×FLA = 52.5 A (derated)', () => {
  const c = fpc(calc(fpProj()));
  eq(c.cond.cable, 'FRC');
  assert(c.cond.amp >= 52.5, 'amp ' + c.cond.amp);
  assert(D.CABLES.FRC && /BS 6387/.test(D.CABLES.FRC.label) && D.CABLES.FRC.fire === true, JSON.stringify(D.CABLES.FRC));
  assert(c.steps.some((x) => /BS 6387/.test(x.f + x.ref)), 'steps ต้องอ้าง BS 6387');
});
test('3.5 ห้าม RCD แม้ item ระบุ rcd/wet = true (ไม่มี RCBO, ไม่มี step RCD)', () => {
  const c = fpc(calc(fpProj({ rcd: true, wet: true })));
  assert(c.cb.rcd === false, 'cb.rcd');
  assert(!c.steps.some((x) => /RCBO|RCD|ไฟรั่ว/.test(x.t)), c.steps.map((x) => x.t));
  assert(c.steps.some((x) => /NFPA 20/.test(x.f + x.ref) && /RCD/.test(x.f)), 'ต้องระบุว่าห้าม RCD ตาม NFPA 20');
});
test('3.6 ไม่ต่อแผงฉุกเฉิน → เตือน ; แผงฉุกเฉิน หรือแผงแม่เป็นฉุกเฉิน → ไม่เตือน', () => {
  const warnEm = (r) => r.warnings.filter((w) => /ปั๊มดับเพลิง/.test(w) && /ฉุกเฉิน/.test(w));
  const no = calc(one([fpItem()]));                                   // LP1 ไม่ใช่แผงฉุกเฉิน
  assert(warnEm(no).length === 1, JSON.stringify(no.warnings));
  assert(warnEm(calc(fpProj())).length === 0, 'แผงฉุกเฉิน');
  const kid = calc(one([fpItem({ panelId: 'LP2' })].map((x) => Object.assign(x, { panelId: 'LP2' })), undefined,
    [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { emergency: true }), P('LP2', 'LP', 'SDB1')]));
  assert(warnEm(kid).length === 0, 'แม่ฉุกเฉิน: ' + JSON.stringify(kid.warnings));
});
test('3.7 เครื่องกำเนิดไฟฟ้าฉุกเฉินคิดปั๊มดับเพลิงเป็นมอเตอร์เริ่มเดิน DOL', () => {
  const g = calc(fpProj()).service.generator;
  assert(g && g.bigMotor && /ปั๊มดับเพลิง/.test(g.bigMotor.desc) && g.bigMotor.kind === 'DOL', JSON.stringify(g && g.bigMotor));
});
test('3.8 sanitize เก็บ item fire_pump (ชนิด/กำลัง) ไม่ตัดทิ้ง และเฟสที่ผิดรูปแบบ → 3 เฟส (ไม่ใช่ 1)', () => {
  const raw = fpProj({ phases: 'abc' });
  const out = SAN.project(JSON.parse(JSON.stringify(raw)));
  const it = (out.project || out).items.find((x) => x.type === 'fire_pump');
  assert(it && it.kw === 22 && it.phases === 3, JSON.stringify(it));
});
test('3.9 ปั๊มดับเพลิงไม่ถูกตรวจ/แนะนำ selectivity เหมือนวงจรทั่วไป (ไม่เตือน "ไม่เลือกตัด" ของวงจรปั๊ม)', () => {
  const r = calc(fpProj());
  assert(!board(r, 'LP1').selectivity.some((s) => s.kind === 'branch' && /^125A/.test(s.down)), JSON.stringify(board(r, 'LP1').selectivity.map((s) => s.down)));
});
test('3.10 ปั๊มบน SDB + เลือกยี่ห้อ MCCB: CB ยังเป็น Mag-only ไม่ถูกผูกรุ่น thermal-magnetic ของยี่ห้อ และ item.cbType=MCB ไม่เปลี่ยนชนิด', () => {
  const p = one([fpItem({ cbType: 'MCB' })], { supply: 'lv', utility: 'MEA', serviceKA: 10, brands: { mccb: { brand: 'Schneider', series: '' }, mcb: { brand: 'Schneider', series: '' } } },
    [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { emergency: true })]);
  p.items[0].panelId = 'SDB1';
  const c = fpc(calc(p), 'SDB1');
  eq([c.cb.type, c.cb.magOnly, c.cb.bm], ['MCCB', true, undefined]);
});

/* ---------- 4) Vertical Riser: L = L_horiz + |ΔFloor| × floorHeight + 2 m — แผนแม่บท 2.5 ข้อ 3 ---------- */
// ใช้เมื่อแผงและแผงแม่ "ทั้งคู่" ระบุ floor (ตัวเลข) ; ไม่ระบุ/ว่าง = ใช้ระยะราบเดิม (ไม่กระทบโครงการเก่า)
const rise = (mdbFloor, floor, extraMeta, feederLength) => calc(proj({
  meta: Object.assign({}, extraMeta),
  panels: [P('MDB', 'MDB', null, mdbFloor === undefined ? {} : { floor: mdbFloor }), P('SDB1', 'SDB', 'MDB', Object.assign({ feederLength: feederLength == null ? 20 : feederLength }, floor === undefined ? {} : { floor }))],
  items: [I('SDB1', { type: 'custom', va: 6000, phases: 3, continuous: true })]
}));
const sdbOf = (r) => board(r, 'SDB1');
test('4.1 ชั้น 1 → ชั้น 5, สูงชั้น 3.6 m, ราบ 20 m: L = 20 + 4×3.6 + 2 = 36.4 m', () => {
  const f = sdbOf(rise(1, 5)).feeder;
  near(f.length, 36.4, 1e-9);
  eq(f.riser, { horiz: 20, dFloor: 4, floorHeight: 3.6, extra: 2, total: 36.4 });
});
test('4.2 ใช้ meta.floorHeight ที่กำหนด (4.2 m) และ |ΔFloor| ทั้งขึ้น/ลง (ชั้น 3 → B1 = ชั้น −1: Δ3 เพราะไม่มีชั้น 0 คั่นกลาง)', () => {
  near(sdbOf(rise(3, -1, { floorHeight: 4.2 })).feeder.length, 20 + 3 * 4.2 + 2, 1e-9);
});
test('4.7 ไม่มีชั้น 0: G/ชั้น 1 ↔ B1 = 1 ชั้น, B2 = 2, B1 ↔ B2 = 1, B1 ↔ ชั้น 3 = 3, ข้ามเครื่องหมายตัวเลข 1 ↔ −2 = 2', () => {
  const d = (m, f) => sdbOf(rise(m, f)).feeder.riser.dFloor;
  eq([d('G', 'B1'), d(1, 'B2'), d('B1', 'B2'), d('B1', 3), d(1, -2), d('GROUND', 'B3'), d(-1, 1), d(0, -1), d(0, 2)], [1, 2, 1, 3, 2, 3, 1, 1, 2]);
  eq([d('B1', 'G'), d(2, 'B2')], [1, 3]);
});
test('4.8 ชั้นลอย M = ชั้น 1.5 (ครึ่งชั้นเหนือ G ; ไม่เท่ากับชั้น 2) → ΔFloor 0.5 จากชั้น 1 และ 2, 1.5 จาก B1', () => {
  const d = (m, f) => sdbOf(rise(m, f)).feeder.riser.dFloor;
  eq([d('M', 2), d('M', 1), d('MEZZANINE', 'G'), d(2, 'M'), d('M', 'B1'), d('M', 3)], [0.5, 0.5, 0.5, 0.5, 1.5, 1.5]);
  near(sdbOf(rise('M', 2, null, 20)).feeder.length, 20 + 0.5 * 3.6 + 2, 1e-9);
});
test('4.3 แรงดันตกสายป้อนคิดจากความยาวรวมริเซอร์ (ขนาดสายเท่ากัน → VD ∝ L)', () => {
  const a = sdbOf(rise(undefined, undefined)).feeder, b = sdbOf(rise(1, 5)).feeder;
  eq(a.size, b.size);
  near(b.vd.volt / a.vd.volt, 36.4 / 20, 0.01);
});
test('4.4 ไม่ระบุ floor หรือระบุไม่ครบ/ว่าง → ใช้ระยะราบเดิม ไม่มี riser ไม่มีบรรทัดอธิบาย', () => {
  for (const [m, f] of [[undefined, undefined], [1, undefined], [undefined, 5], ['', 5], [1, null], [1, 'abc']]) {
    const x = sdbOf(rise(m, f)).feeder;
    assert(x.length === 20 && !x.riser, JSON.stringify([m, f, x.length, x.riser]));
    assert(!x.steps.some((s) => /Riser|แนวดิ่ง/.test(s.t)), 'ไม่ควรมี step riser');
  }
});
test('4.5 steps อธิบายสูตรความยาวสายแนวดิ่ง', () => {
  const st = sdbOf(rise(1, 5)).feeder.steps.find((s) => /Riser|แนวดิ่ง/.test(s.t));
  assert(st && /20/.test(st.f) && /3\.6/.test(st.f) && /36\.4/.test(st.f), JSON.stringify(st));
});
test('4.6 ลัดวงจรปลายสายและ BOM ใช้ความยาวรวมริเซอร์ (Ik ลดลง, ความยาวสายใน BOM เพิ่ม)', () => {
  const a = rise(undefined, undefined), b = rise(1, 5);
  assert(sdbOf(b).sc.Ik < sdbOf(a).sc.Ik, `Ik ${sdbOf(b).sc.Ik} vs ${sdbOf(a).sc.Ik}`);
  const tot = (r) => r.bom.cables.reduce((s, x) => s + x.length, 0);
  const d = tot(b) - tot(a), per = (36.4 - 20) * 1.1;   // เผื่อ 10% ต่อเส้น
  assert(d > 0 && d / per >= 3 && d / per <= 8, `delta ${d} / ${per}`);   // 3 เฟส + N + G ≈ 4–6 เส้น (BOM ปัดความยาวต่อรายการจึงไม่ใช่จำนวนเต็มพอดี)
});
test('4.7 sanitize เก็บ panel.floor และ meta.floorHeight (ไม่ถูกตัดตอนโหลดไฟล์)', () => {
  const raw = proj({ meta: { floorHeight: 4 }, panels: [P('MDB', 'MDB', null, { floor: 1 }), P('SDB1', 'SDB', 'MDB', { floor: -2 })], items: [] });
  const out = SAN.project(JSON.parse(JSON.stringify(raw))).project;
  eq([out.meta.floorHeight, out.panels.map((p) => p.floor)], [4, [1, -2]]);
});

/* ---------- 5) ธงเตือน Ik" > IC (ความปลอดภัยต่อชีวิต) — result.icViolations ใช้ขับแถบเตือนสีแดง ---------- */
const hot = () => calc(proj({ meta: { supply: 'lv', serviceKA: 1000, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' } },
  panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 1 })], items: [I('LP1', { type: 'rec', points: 10 })] }));
test('5.1 โครงการปกติ: icViolations เป็นอาร์เรย์ว่าง (IC ≥ Ik" ทุกตัว)', () => {
  const r = calc(one([I('LP1', { type: 'rec', points: 10 })]));
  assert(Array.isArray(r.icViolations) && r.icViolations.length === 0, JSON.stringify(r.icViolations));
});
test('5.2 Ik" 363 kA > IC สูงสุด 100 kA: ระบุ CB ประธานและ CB สายป้อนที่ติดบัส MDB พร้อมค่า ik/ic (วงจรย่อยของ LP1 ที่ Ik" ต่ำกว่าไม่ถูกธง)', () => {
  const v = hot().icViolations;
  const main = v.find((x) => x.kind === 'main');
  assert(main && main.ic === 100 && main.ik > 300, JSON.stringify(v));
  eq(v.map((x) => x.kind).sort(), ['feeder', 'main']);
  assert(v.every((x) => x.ik > x.ic && x.where === 'MDB' && x.cb), JSON.stringify(v));
});
test('5.3 วงจรย่อยที่ต่อตรงบัส MDB (Ik" 363 kA) ถูกธงเป็น branch', () => {
  const r = calc(proj({ meta: { supply: 'lv', serviceKA: 1000, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' } },
    panels: [P('MDB', 'MDB', null)], items: [I('MDB', { type: 'custom', va: 3000, phases: 3, continuous: true })] }));
  const b = r.icViolations.filter((x) => x.kind === 'branch');
  assert(b.length === 1 && b[0].where === 'MDB' && b[0].ik > b[0].ic, JSON.stringify(r.icViolations));
});

/* ---------- 6) ข้อมูล Title Block: เลขที่ใบอนุญาต กว. (ภฟก./สฟก./วฟก.), ผู้ตรวจ, โลโก้บริษัท ---------- */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const sanMeta = (m) => SAN.project(JSON.parse(JSON.stringify(proj({ meta: m })))).project.meta;
test('6.1 defaultMeta มีฟิลด์ใบอนุญาต/ผู้ตรวจ/โลโก้ (ค่าว่าง)', () => {
  const m = E.defaultMeta();
  eq([m.designerLicense, m.licenseTier, m.checkerLicense, m.logo, m.checker], ['', '', '', '', '']);
});
test('6.2 sanitize เก็บเลขที่ใบอนุญาต/ผู้ตรวจ ; licenseTier รับเฉพาะ ภฟก./สฟก./วฟก.', () => {
  const m = sanMeta({ designerLicense: 'ภฟก.12345', licenseTier: 'สฟก.', checker: 'นายตรวจ ทดสอบ', checkerLicense: 'วฟก.999' });
  eq([m.designerLicense, m.licenseTier, m.checker, m.checkerLicense], ['ภฟก.12345', 'สฟก.', 'นายตรวจ ทดสอบ', 'วฟก.999']);
  eq(sanMeta({ licenseTier: 'ฟฟฟ' }).licenseTier, '');
});
test('6.3 โลโก้: รับเฉพาะ data URL ของรูป png/jpeg/webp ขนาดไม่เกินเพดาน ; อย่างอื่นถูกตัดเป็นว่าง (กัน XSS/URL ภายนอก)', () => {
  eq(sanMeta({ logo: PNG }).logo, PNG);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', PNG + '"onerror="x', 'data:image/png;base64,' + 'A'.repeat(200001)]) {
    eq(sanMeta({ logo: bad }).logo, '');
  }
});

/* ---------- 7) ข้อพบจากการรีวิวโค้ด ---------- */
const sanP = (raw) => SAN.project(JSON.parse(JSON.stringify(raw))).project;
test('7.1 sanitize: โปรเจกต์เก่าที่ไม่มีคีย์ autoSelectivity ต้องได้ค่าเริ่มต้น (เปิด) ไม่ใช่ปิดเงียบ ๆ ; ค่าที่ผู้ใช้ปิดไว้ต้องคงอยู่', () => {
  const base = { version: 1, panels: [{ id: 'MDB', kind: 'MDB' }], items: [] };
  eq(sanP(Object.assign({ meta: { name: 'เก่า' } }, base)).meta.autoSelectivity, true);
  eq(sanP(Object.assign({ meta: { name: 'ปิด', autoSelectivity: false } }, base)).meta.autoSelectivity, false);
  eq(sanP(Object.assign({ meta: { name: 'เปิด', autoSelectivity: true } }, base)).meta.autoSelectivity, true);
});
test('7.2 สายทนไฟ FRC ใช้ได้เฉพาะวงจรปั๊มดับเพลิง: ตั้งเป็นสายทั่วไป (branch/feeder/main) ถูกปัดกลับค่าเริ่มต้น', () => {
  const m = sanP({ version: 1, meta: { branch: { cable: 'FRC' }, feeder: { cable: 'FRC' }, main: { cable: 'FRC' } }, panels: [{ id: 'MDB', kind: 'MDB' }], items: [] }).meta;
  assert(m.branch.cable !== 'FRC' && m.feeder.cable !== 'FRC' && m.main.cable !== 'FRC', JSON.stringify([m.branch.cable, m.feeder.cable, m.main.cable]));
  const r = calc(proj({ meta: { branch: { cable: 'FRC' } }, items: [I('LP1', { type: 'rec', points: 8 })], panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')] }));
  assert(r.meta.branch.cable !== 'FRC' && r.warnings.some((w) => /FRC|ทนไฟ/.test(w)), JSON.stringify(r.meta.branch));
});
test('7.3 Auto-Selectivity ไม่ดันเมนแผงย่อยเกินเมนต้นทาง (CB ใหญ่กว่าต้นทางตัดไม่ทันก่อน) — ยังเตือน/แนะนำขยายเมนต้นทางแทน', () => {
  const mk = (auto) => calc(proj({ meta: { supply: 'lv', utility: 'PEA', serviceKA: 10, autoSelectivity: auto }, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 10 })],
    items: [I('LP1', { type: 'rec', duty: 'heavy', points: 6 }), I('LP1', { type: 'ac', btu: 18000, phases: 1 }), I('LP1', { type: 'custom', va: 2700, phases: 1, continuous: true, cat: 'other' })] }));
  const on = mk(true), off = mk(false);
  const f = board(on, 'LP1').feeder;
  assert(f.cb.at <= on.service.mainCB.at, `เมนแผงย่อย ${f.cb.at} > เมนประธาน ${on.service.mainCB.at}`);
  eq(f.cb.at, board(off, 'LP1').feeder.cb.at);   // ถูกจำกัดที่ต้นทาง = เท่าค่าที่ตามโหลดอย่างเดียว
  assert(board(on, 'LP1').selectivity.some((s) => s.status === 'none') && on.warnings.some((w) => /ขยายเมน/.test(w)), 'ต้องเตือนขยายเมน');
});
test('7.4 Auto-Selectivity ยังทำงานเมื่อเมนต้นทางใหญ่พอ (ไม่ถูกจำกัดโดยไม่จำเป็น)', () => {
  const r = lp25({ supply: 'lv', utility: 'PEA', serviceKA: 10 });   // 90 จุด → ต้นทางเป็นเมนประธานขนาดพอ
  assert(board(r, 'LP1').feeder.cb.at >= 1.6 * 16 || board(r, 'LP1').feeder.cb.at === r.service.mainCB.at, 'at ' + board(r, 'LP1').feeder.cb.at);
});

/* ---------- 8) Multilevel Feeder Coordination — เมนแม่ประสานการเลือกตัดกับ CB สายป้อนแผงลูก (ลูกก่อนแม่) ---------- */
// ลำดับ: ออกแบบ CB/สายป้อนแผงลูกก่อน (post-order) → เมนแม่ = max(Ic, min(1.6 × max(CB วงจรย่อย, CB สายป้อนลูก), CB ประธาน))
//        แล้วคำนวณ Z/Ik/IC/vdUp บนลงล่างโดยใช้ขนาดสายแม่ที่ final (ลูกต้องไม่ได้ค่าเก่าค้าง)
const CO = { coordinateKidFeeders: true };
const LVM = { supply: 'lv', utility: 'MEA', serviceKA: 10 };
const sib = (pid) => I(pid, { type: 'custom', va: 20000, phases: 3, continuous: true, qty: 4, cat: 'other' });   // โหลดแผงพี่น้อง: ดึงเมนประธานให้ใหญ่ (175 AT) ไม่เป็นเพดานของแผงที่ทดสอบ
const feederSel = (r, id) => board(r, id).selectivity.filter((s) => s.kind === 'feeder');
const mdbOf = (r) => r.panels.find((p) => p.board.kind === 'MDB');
const parentPanel = (r, p) => r.panels.find((q) => (q.kids || []).includes(p.id)) || mdbOf(r);
// Z/Ik/vdUp ของทุกแผงต้องมาจากสายป้อนแม่ที่ final : Zลูก = Zแม่ + Zสายลูก, vdUp ลูก = vdUp แม่ + VD สายลูก, Ik ลูก ≤ Ik แม่
const chainProblems = (r) => {
  const bad = [];
  for (const p of r.panels) {
    if (p === mdbOf(r) || !p.feeder) continue;
    const q = parentPanel(r, p), z = D.CABLE_Z[p.feeder.size];
    if (!z) continue;
    const n = p.feeder.sets || 1, R = q.sc.R + z[0] * p.feeder.length / 1000 / n, X = q.sc.X + z[1] * p.feeder.length / 1000 / n;
    if (Math.abs(R - p.sc.R) > 1e-9 || Math.abs(X - p.sc.X) > 1e-9) bad.push(`${p.id}: Z ลูก (R ${p.sc.R.toFixed(5)}, X ${p.sc.X.toFixed(5)}) ไม่ตรงสายแม่ final (R ${R.toFixed(5)}, X ${X.toFixed(5)})`);
    if (Math.abs(q.vdUp + p.feeder.vd.pct - p.vdUp) > 1e-9) bad.push(`${p.id}: vdUp ${p.vdUp.toFixed(4)} ≠ vdUp แม่ ${q.vdUp.toFixed(4)} + ${p.feeder.vd.pct.toFixed(4)}`);
    if (p.sc.Ik > q.sc.Ik + 1e-9) bad.push(`${p.id}: Ik ลูก ${p.sc.Ik.toFixed(3)} > Ik แม่ ${q.sc.Ik.toFixed(3)}`);
  }
  return bad;
};
const chain2 = (meta, pts) => calc(proj({ meta: Object.assign({}, LVM, meta), panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB'), P('SDB2', 'SDB', 'MDB')], items: [I('LP1', { type: 'rec', points: pts || 90 }), sib('SDB2')] }));
const chain3 = (meta) => calc(proj({ meta: Object.assign({}, LVM, meta), panels: [P('MDB', 'MDB', null), P('A', 'SDB', 'MDB'), P('B', 'SDB', 'A'), P('LP1', 'LP', 'B'), P('SDB2', 'SDB', 'MDB')], items: [I('LP1', { type: 'rec', points: 90 }), sib('SDB2')] }));

test('8.1 MDB→SDB→LP1: เดิม SDB 25 AT ใต้ LP1 25 AT = "ไม่เลือกตัด" ; เปิดประสาน → เมน SDB 40 AT (= 1.6 × 25) ไม่เป็น none และสายรับ ≥ CB', () => {
  const off = chain2({ coordinateKidFeeders: false });
  eq([board(off, 'SDB').feeder.cb.at, board(off, 'LP1').feeder.cb.at], [25, 25]);
  assert(feederSel(off, 'SDB').length === 1 && feederSel(off, 'SDB')[0].status === 'none', JSON.stringify(feederSel(off, 'SDB')));
  const on = chain2(CO), f = board(on, 'SDB').feeder;
  eq([f.cb.at, board(on, 'LP1').feeder.cb.at], [40, 25]);
  const s = feederSel(on, 'SDB');
  assert(s.length === 1 && s[0].status !== 'none' && s[0].ratio >= D.SELECTIVITY.ratioMin - 1e-9, JSON.stringify(s));
  assert(f.amp >= f.cb.at, `amp ${f.amp} < at ${f.cb.at}`);
});
test('8.2 ไม่ดันเมนแม่เกิน CB ประธาน: ไม่มีแผงอื่นดึงเมนประธาน (25 AT) → SDB คง 25 AT (ยังเตือนไม่เลือกตัด ให้ผู้ใช้ขยายเมนต้นทางเอง)', () => {
  const r = calc(proj({ meta: Object.assign({}, LVM, CO), panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB')], items: [I('LP1', { type: 'rec', points: 90 })] }));
  eq(r.service.mainCB.at, 25);
  eq(board(r, 'SDB').feeder.cb.at, 25);
  assert(feederSel(r, 'SDB')[0].status === 'none', JSON.stringify(feederSel(r, 'SDB')));
  assert(r.panels.every((p) => !p.feeder || p.feeder.cb.at <= r.service.mainCB.at), 'มีสายป้อนใหญ่กว่า CB ประธาน');
});
test('8.3 Z/Ik/vdUp ของแผงลูกคิดจากสายแม่ที่ final (ไม่ค้างค่าก่อนขยับเมนแม่) และไม่มี Ik" > IC', () => {
  for (const r of [chain2(CO), chain3(CO)]) {
    eq(chainProblems(r), []);
    eq(r.icViolations, []);
  }
  const r = chain2(CO), a = board(r, 'SDB'), l = board(r, 'LP1');
  assert(a.feeder.size > chain2({ coordinateKidFeeders: false }).panels.find((p) => p.id === 'SDB').feeder.size, 'สาย SDB ต้องใหญ่ขึ้นตามเมนที่ขยับ');
  assert(l.feeder.cb.ic + 1e-9 >= a.sc.Ik, `IC สายป้อน LP1 ${l.feeder.cb.ic} < Ik ที่บัส SDB ${a.sc.Ik}`);
});
test('8.4 หลายชั้น (ลูกก่อนแม่): A 70 AT ≥ 1.6 × B 40 AT ≥ 1.6 × LP1 25 AT และ Z/Ik ไล่ลงถูกต้องทุกชั้น', () => {
  const r = chain3(CO);
  eq(['A', 'B', 'LP1'].map((id) => board(r, id).feeder.cb.at), [70, 40, 25]);
  assert(['A', 'B'].every((id) => feederSel(r, id).every((s) => s.status !== 'none')), JSON.stringify(['A', 'B'].map((id) => feederSel(r, id).map((s) => s.status))));
  eq(chainProblems(r), []);
});
test('8.5 หลายแผงลูก: เมนแม่ประสานกับสายป้อนลูกที่ใหญ่สุด (80 AT = 1.6 × 50) และ steps อธิบายที่มา', () => {
  const r = calc(proj({ meta: Object.assign({}, LVM, CO), panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB'), P('LP2', 'LP', 'SDB'), P('SDB2', 'SDB', 'MDB')], items: [I('LP1', { type: 'rec', points: 90 }), I('LP2', { type: 'rec', points: 200 }), sib('SDB2')] }));
  eq(['SDB', 'LP1', 'LP2'].map((id) => board(r, id).feeder.cb.at), [80, 30, 50]);
  assert(feederSel(r, 'SDB').every((s) => s.status !== 'none'), JSON.stringify(feederSel(r, 'SDB').map((s) => [s.down, s.status])));
  const st = board(r, 'SDB').feeder.steps.find((x) => /สายป้อนแผงลูก/.test(x.t + x.f));
  assert(st && /1\.6/.test(st.f) && /50/.test(st.f), JSON.stringify(board(r, 'SDB').feeder.steps.map((x) => x.t)));
  eq(chainProblems(r), []);
});
test('8.6 มีมอเตอร์ในแผงลูก: ไม่ขยับ CB แผงแม่ (คงเพดานสมการ 8-5) — ผลเท่ากับปิดประสาน', () => {
  const mk = (meta) => calc(proj({ meta: Object.assign({}, LVM, meta), panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB'), P('SDB2', 'SDB', 'MDB')],
    items: [I('LP1', { type: 'motor', kw: 7.5, phases: 3, start: 'DOL' }), I('LP1', { type: 'rec', points: 90 }), sib('SDB2')] }));
  const on = mk(CO), off = mk({ coordinateKidFeeders: false });
  eq(['SDB', 'LP1'].map((id) => [board(on, id).feeder.cb.at, board(on, id).feeder.size]), ['SDB', 'LP1'].map((id) => [board(off, id).feeder.cb.at, board(off, id).feeder.size]));
  eq(chainProblems(on), []);
});
test('8.7 ปิด meta.autoSelectivity=false: ไม่ประสานสายป้อนลูกด้วย (SDB คง 25 AT)', () => {
  const r = chain2(Object.assign({ autoSelectivity: false }, CO));
  eq([board(r, 'SDB').feeder.cb.at, board(r, 'LP1').feeder.cb.at], [25, 25]);
});
test('8.8 fuzz 150 โครงการ (เปิดประสาน): CB ไม่ลดลง ไม่เกิน CB ต้นทาง สายรับ ≥ CB ที่ขยับ แผงไม่มีลูก/มีมอเตอร์ใต้ไม่ถูกขยับ และ Z/vdUp ตรงสายแม่ final', () => {
  const { gen, clone } = require('./helpers/build.js');
  const withMeta = (base, m) => { const p = clone(base); Object.assign(p.meta, m); return p; };
  const motorUnder = (r, p) => p.circuits.some((c) => c.motor) || (p.kids || []).some((k) => motorUnder(r, r.panels.find((x) => x.id === k)));
  const bad = [];
  let changed = 0;
  for (let seed = 71000; seed < 71150; seed++) {
    const base = gen(seed, { real: true, sane: true, maxLP: 6 });
    const on = calc(withMeta(base, CO)), off = calc(withMeta(base, { coordinateKidFeeders: false }));
    chainProblems(on).forEach((m) => bad.push(`seed ${seed} ${m}`));
    if (on.icViolations.length > off.icViolations.length) bad.push(`seed ${seed}: Ik" > IC เพิ่มขึ้น ${JSON.stringify(on.icViolations)}`);
    for (const p of on.panels) {
      if (!p.feeder) continue;
      const o = off.panels.find((x) => x.id === p.id), a = p.feeder.cb.at, b = o.feeder.cb.at;
      if (a < b) bad.push(`seed ${seed} ${p.id}: CB ลดลง ${b} → ${a}`);
      if (a === b) continue;
      changed++;
      const kids = (p.kids || []).map((k) => on.panels.find((x) => x.id === k)).filter((k) => k.feeder);
      if (!kids.length || motorUnder(on, p)) { bad.push(`seed ${seed} ${p.id}: ขยับ ${b} → ${a} ทั้งที่ไม่มีลูก/มีมอเตอร์ใต้แผง`); continue; }
      const q = parentPanel(on, p), upAt = q.feeder ? q.feeder.cb.at : on.service.mainCB.at;   // CB ต้นทาง (final) ; MDB = CB ประธาน
      if (a > Math.max(b, upAt)) bad.push(`seed ${seed} ${p.id}: ${a} ใหญ่กว่า CB ต้นทาง ${upAt}`);
      if (p.feeder.amp + 1e-9 < a && !p.feeder.warn.length) bad.push(`seed ${seed} ${p.id}: สายรับ ${p.feeder.amp} A < CB ${a}`);
      const want = Math.min(D.SELECTIVITY.ratioMin * Math.max(...kids.map((k) => k.feeder.cb.at)), upAt);
      if (a + 1e-9 < want) bad.push(`seed ${seed} ${p.id}: ${a} < min(1.6 × ลูกใหญ่สุด, CB ต้นทาง) = ${want}`);
    }
  }
  assert(changed >= 10, `fuzz ต้องมีกรณีที่ถูกประสานจริง (พบ ${changed})`);
  assert(!bad.length, bad.length + ' ปัญหา เช่น ' + bad.slice(0, 3).join(' | '));
  return `ถูกประสาน ${changed} แผง`;
});
test('8.9 invariants ของ fuzz เดิม (IC ≥ Ik", สาย ≥ CB, CB ≥ 1.25 × I ฯลฯ) ผ่านเมื่อเปิดประสาน 200 โครงการ', () => {
  const { gen, clone } = require('./helpers/build.js');
  const { check, FAIL } = require('./helpers/invariants.js');
  const before = Object.keys(FAIL).length;
  for (let seed = 72000; seed < 72200; seed++) { const p = clone(gen(seed, { real: true, sane: true })); Object.assign(p.meta, CO); check(seed, p, 'full'); }
  const names = Object.keys(FAIL);
  assert(!names.length && !before, names.map((n) => `${n} ×${FAIL[n].count} seed ${FAIL[n].first.seed}: ${String(FAIL[n].first.msg).slice(0, 160)}`).join(' | '));
});

test('8.10 ค่าเริ่มต้นเปิด: ไม่ต้องตั้ง meta ก็ประสานสายป้อนลูก ; ไฟล์เก่าที่ไม่มีคีย์ = เปิด และตั้ง false ปิดได้', () => {
  eq(E.defaultMeta().coordinateKidFeeders, true);
  const r = chain2({});
  eq([board(r, 'SDB').feeder.cb.at, board(r, 'LP1').feeder.cb.at], [40, 25]);
  const base = { version: 1, panels: [{ id: 'MDB', kind: 'MDB' }], items: [] };
  eq(sanP(Object.assign({ meta: { name: 'เก่า' } }, base)).meta.coordinateKidFeeders, true);
  eq(sanP(Object.assign({ meta: { name: 'ปิด', coordinateKidFeeders: false } }, base)).meta.coordinateKidFeeders, false);
  eq(board(chain2({ coordinateKidFeeders: false }), 'SDB').feeder.cb.at, 25);
});

test('8.11 CB สายป้อนที่ถูกขยับตามสายป้อนแผงลูกถูกระบุที่ผลลัพธ์ (feeder.coord) + step มีแท็ก ; แผงที่ไม่ถูกขยับ/ปิดประสานไม่มี', () => {
  const on = chain2({}), f = board(on, 'SDB').feeder;
  eq([f.coord.by, f.coord.ratio, f.coord.kidAt, f.coord.at], ['kid', 1.6, 25, 40]);
  const st = f.steps.filter((x) => x.tag);
  assert(st.length === 1 && /1\.6/.test(st[0].tag) && /สายป้อนแผงลูก/.test(st[0].f), JSON.stringify(f.steps.map((x) => [x.t, x.tag])));
  assert(!board(on, 'LP1').feeder.coord && !board(on, 'LP1').feeder.steps.some((x) => x.tag), 'LP1 ไม่ได้ถูกขยับตามลูก');
  assert(!board(chain2({ coordinateKidFeeders: false }), 'SDB').feeder.coord, 'ปิดประสานต้องไม่มี coord');
  const r3 = chain3({});
  eq(['A', 'B', 'LP1'].map((id) => !!board(r3, id).feeder.coord), [true, true, false]);
});
test('8.12 ธงประสานต้องตรงความจริง: ทุกแผงที่มี coord ต้องใหญ่กว่า CB ตามโหลดอย่างเดียว (ถ้าปิดประสาน) และ ≥ 1.6 × CB ลูก หรือชนเพดาน', () => {
  const { gen, clone } = require('./helpers/build.js');
  let flagged = 0;
  const bad = [];
  for (let seed = 73000; seed < 73100; seed++) {
    const base = gen(seed, { real: true, sane: true, maxLP: 6 });
    const on = calc(Object.assign(clone(base), { meta: Object.assign(clone(base.meta), CO) })), off = calc(Object.assign(clone(base), { meta: Object.assign(clone(base.meta), { coordinateKidFeeders: false }) }));
    for (const p of on.panels) {
      if (!p.feeder) continue;
      const o = off.panels.find((x) => x.id === p.id).feeder;
      if (p.feeder.coord) {
        flagged++;
        if (!(p.feeder.cb.at > o.cb.at)) bad.push(`seed ${seed} ${p.id}: มี coord แต่ CB ไม่ได้ใหญ่ขึ้น (${o.cb.at} → ${p.feeder.cb.at})`);
        const kids = (p.kids || []).map((k) => on.panels.find((x) => x.id === k).feeder.cb.at);
        if (p.feeder.coord.kidAt !== Math.max(...kids)) bad.push(`seed ${seed} ${p.id}: kidAt ${p.feeder.coord.kidAt} ≠ ${Math.max(...kids)}`);
      } else if (p.feeder.cb.at !== o.cb.at) bad.push(`seed ${seed} ${p.id}: CB เปลี่ยน ${o.cb.at} → ${p.feeder.cb.at} แต่ไม่มี coord`);
    }
  }
  assert(flagged >= 5, 'ต้องมีกรณีที่ถูกระบุอย่างน้อย 5 (พบ ' + flagged + ')');
  assert(!bad.length, bad.length + ' ปัญหา เช่น ' + bad.slice(0, 3).join(' | '));
  return `coord ${flagged} แผง`;
});

test('8.13 แผงที่สายถูกขยับตามการประสานมี step "ผลต่อกระแสลัดวงจร": Ik" จริงที่บัสแผงนี้เทียบค่าถ้าไม่ประสาน (สายแม่ใหญ่ขึ้น → Ik" สูงขึ้น)', () => {
  const on = chain2({}), off = chain2({ coordinateKidFeeders: false });
  const f = board(on, 'SDB').feeder, o = board(off, 'SDB').feeder;
  assert(f.size > o.size, 'เงื่อนไขทดสอบ: สาย SDB ต้องใหญ่ขึ้น ' + o.size + ' → ' + f.size);
  const st = f.steps.filter((x) => /ผลต่อกระแสลัดวงจร/.test(x.t));
  assert(st.length === 1, JSON.stringify(f.steps.map((x) => x.t)));
  const ikOn = board(on, 'SDB').sc.Ik, ikOff = board(off, 'SDB').sc.Ik;
  assert(ikOn > ikOff + 1e-9, `Ik" ต้องสูงขึ้น ${ikOff} → ${ikOn}`);
  assert(st[0].f.includes(`${E.fmt(ikOn, 2)} kA`) && st[0].f.includes(`${E.fmt(ikOff, 2)} kA`) && /ถ้าไม่ประสาน/.test(st[0].f), st[0].f);
  assert(st[0].f.includes(`${o.size} → ${f.size} mm²`), 'ต้องบอกขนาดสายก่อน/หลัง: ' + st[0].f);
  assert(!board(on, 'LP1').feeder.steps.some((x) => /ผลต่อกระแสลัดวงจร/.test(x.t)), 'LP1 ไม่ถูกขยับ ต้องไม่มี step นี้');
  assert(!board(off, 'SDB').feeder.steps.some((x) => /ผลต่อกระแสลัดวงจร/.test(x.t)), 'ปิดประสานต้องไม่มี');
});


/* ================= 9) สายดินบริภัณฑ์ขยายตามสัดส่วนสายเฟส (fixandupgrade 3.4) ================= */
const egcCase = (kind, va, L, on = true) => {
  const r = calc(proj({ meta: { supply: 'lv', serviceKA: 10, egcProportional: on }, panels: [P('MDB', 'MDB', null), P('X', kind === 'br' ? 'LP' : 'SDB', 'MDB', { feederLength: kind === 'br' ? 5 : L })],
    items: [I('X', kind === 'br' ? { type: 'custom', va, phases: 1, continuous: true, length: L } : { type: 'custom', va, phases: 3, continuous: true })] }));
  const b = board(r, 'X');
  return kind === 'br' ? b.circuits.find((c) => c.cond) : b.feeder;
};
test('9.1 วงจรย่อย: สายเฟสถูกขยายเพราะแรงดันตก → สายดินขยายตามสัดส่วน (2.5 → 10 ที่เฟส 10 ; → 35 ที่เฟส 35) และไม่เกินสายเฟส ; ไม่ขยายเฟส = สายดินตามตาราง', () => {
  const g = (L) => { const c = egcCase('br', 3500, L); return [c.cond.size, c.cond.ground]; };
  eq(g(10), [2.5, 2.5]);
  eq(g(60), [10, 10]);
  eq(g(200), [35, 35]);
  const st = egcCase('br', 3500, 200).steps.find((x) => x.t === 'สายดิน');
  assert(st && /สัดส่วน/.test(st.f), JSON.stringify(st));
});
test('9.2 สายป้อน: เฟส 10 → 35 mm² (VD) → สายดิน 4 → 16 ; เฟส 25 → 120 → สายดิน 10 → 50 ; ไม่ขยายเฟส สายดินคงตามตาราง ; ไม่เกินสายเฟส', () => {
  const f1 = egcCase('fd', 20000, 20), f2 = egcCase('fd', 20000, 200), f3 = egcCase('fd', 40000, 300), f4 = egcCase('fd', 20000, 100);
  eq([f1.size, f1.ground], [10, 4]);
  eq([f4.size, f4.ground], [16, 10]);
  eq([f2.size, f2.ground], [35, 16]);
  eq([f3.size, f3.ground], [120, 50]);
  assert(f2.steps.some((x) => x.t === 'สายดินบริภัณฑ์' && /สัดส่วน/.test(x.f)), JSON.stringify(f2.steps.filter((x) => /สายดิน/.test(x.t))));
});
test('9.0 ค่าเริ่มต้นปิด: สายเฟสขยายเพราะแรงดันตก สายดินคงตามตาราง 4.2 ตาม CB (ตรงตัวอย่างตำรา 6.4.6) ; meta.egcProportional เริ่มต้น false', () => {
  eq(E.defaultMeta().egcProportional, false);
  const f = egcCase('fd', 20000, 200, false), b = egcCase('br', 3500, 200, false);
  eq([f.size, f.ground], [35, 4]);
  eq([b.cond.size, b.cond.ground], [35, 2.5]);
  assert(!f.steps.some((x) => /สัดส่วน/.test(x.f)), 'ไม่ควรมีบรรทัดขยายสัดส่วนเมื่อปิด');
});
test('9.3 สายดินไม่เกินสายเฟสและไม่ลดลงต่ำกว่าตารางเดิมในโครงการสุ่ม 120 โครงการ (เปิด/ปิดตัวเลือก)', () => {
  for (let i = 0; i < 120; i++) {
    const L = 5 + (i * 37) % 450, va = 5000 + (i * 1733) % 90000;
    for (const k of ['fd', 'br']) {
      const x = egcCase(k, k === 'br' ? Math.min(va, 7000) : va, L, i % 2 === 0), g = k === 'br' ? x.cond.ground : x.ground, sz = k === 'br' ? x.cond.size : x.size, at = x.cb.at;
      assert(g <= sz && g >= Math.min(sz, D.GROUND_EQUIP.find(([a]) => a >= at)[1]), JSON.stringify([k, L, va, at, sz, g]));
    }
  }
});

/* ================= 10) ตรวจความร้อนลัดวงจรของสายป้อน (Adiabatic, IEC 60364-4-43) — ทางเลือก meta.adiabaticCheck ================= */
const adia = (extra, va = 20000, L = 10) => calc(proj({ meta: Object.assign({ supply: 'lv', serviceKA: 40 }, extra), panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { feederLength: L })], items: [I('SDB1', { type: 'custom', va, phases: 3, continuous: true })] }));
test('10.1 ค่าเริ่มต้นปิด: ไม่มี feeder.adia และไม่เพิ่มคำเตือน (CB จำกัดกระแสมี I²t จริงของผู้ผลิต ซึ่งแอปไม่มีข้อมูล)', () => {
  const f = sdbOf(adia({})).feeder;
  assert(f.adia === undefined && !f.warn.some((w) => /Adiabatic|ความร้อนลัดวงจร/.test(w)), JSON.stringify(f.adia));
  eq(E.defaultMeta().adiabaticCheck, false);
});
test('10.2 เปิดตัวเลือก: Smin = Ik" × 1000 × √t / k (t = 0.01 s ; PVC 115, XLPE 143) เทียบ S × จำนวนชุด ; สาย IEC01 10 mm² ที่ Ik" ≈ 12.5 kA ไม่ผ่าน (Smin ≈ 10.9) และมีคำเตือน + step', () => {
  const r = adia({ adiabaticCheck: true }), f = sdbOf(r).feeder, ik = board(r, 'MDB').sc.Ik;
  assert(f.adia && f.adia.t === 0.01, JSON.stringify(f.adia));
  near(f.adia.smin, ik * 1000 * Math.sqrt(0.01) / f.adia.k, 0.006);
  assert(f.adia.k === 115 && f.size === 10 && f.adia.ok === false, JSON.stringify([f.adia, f.size]));
  assert(f.warn.some((w) => /Adiabatic/.test(w)), JSON.stringify(f.warn));
  assert(f.steps.some((x) => /Adiabatic/.test(x.t) && /115/.test(x.f)), JSON.stringify(f.steps.map((x) => x.t)));
});
test('10.3 สาย CV (XLPE) ใช้ k = 143 ; ผ่านเมื่อ ขนาด × ชุด ≥ Smin (ไม่มีคำเตือน) และตรงกันกับคำเตือนเสมอ', () => {
  const r = adia({ adiabaticCheck: true, feeder: { cable: 'CV', method: 'g5', conduit: 'IMC' } }, 150000, 10), f = sdbOf(r).feeder;
  assert(f.adia && f.adia.k === 143, JSON.stringify(f.adia));
  assert(f.adia.ok === (f.size * f.sets >= f.adia.smin - 1e-9) && (f.adia.ok ? !f.warn.some((w) => /Adiabatic/.test(w)) : f.warn.some((w) => /Adiabatic/.test(w))), JSON.stringify([f.adia, f.size, f.sets]));
});

/* ================= 11) ปั๊มดับเพลิง: แรงดันตกขณะสตาร์ท ≤ 15% (NFPA 20) ที่ LRC = 6×FLA, cosθ = 0.30 ================= */
const fpStart = (kw, L) => {
  const r = calc(proj({ meta: { supply: 'transformer' }, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 5 })], items: [I('LP1', { type: 'fire_pump', kw, phases: 3, length: L })] }));
  return board(r, 'LP1').circuits.find((c) => c.firePump);
};
const startPct = (c) => { const z = E.cableZ(c.cond.size, c.L, 1); return Math.sqrt(3) * c.motor.lrc * (z.R * 0.30 + z.X * 0.9539) / 400 * 100; };
test('11.1 วงจรปั๊มดับเพลิงเก็บ vdStartPct = √3 × LRC × L × (R cosθ + X sinθ) / 400 × 100 พร้อม step อธิบาย ; ตัวอย่างทั่วไปไม่เกิน 15%', () => {
  for (const [kw, L] of [[22, 30], [37, 100], [55, 150]]) {
    const c = fpStart(kw, L);
    assert(typeof c.vdStartPct === 'number', JSON.stringify([kw, L, c.vdStartPct]));
    near(c.vdStartPct, startPct(c), 0.006);
    assert(c.vdStartPct <= 15 + 1e-9, JSON.stringify([kw, L, c.vdStartPct]));
    assert(c.steps.some((x) => /สตาร์ท/.test(x.t) && /15/.test(x.f)), JSON.stringify(c.steps.map((x) => x.t)));
  }
});
test('11.2 กรณีสุดโต่ง (110 kW, 400 m): ถ้าแม้ขยายสายแล้วยังเกิน 15% ต้องมีคำเตือน ; ถ้าไม่เกินต้องไม่มีคำเตือนแรงดันตกขณะสตาร์ท', () => {
  const c = fpStart(110, 400);
  assert(c.vdStartPct > 0 && c.vdStartPct === Math.round(startPct(c) * 100) / 100, JSON.stringify([c.vdStartPct, startPct(c)]));
  assert((c.vdStartPct > 15) === c.warn.some((w) => /สตาร์ท.*15|15.*สตาร์ท/.test(w)), JSON.stringify([c.vdStartPct, c.warn]));
});
test('11.3 วงจรที่ไม่ใช่ปั๊มดับเพลิงไม่มี vdStartPct', () => {
  const r = calc(proj({ meta: { supply: 'transformer' }, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 5 })], items: [I('LP1', { type: 'motor', kw: 22, phases: 3, length: 50 })] }));
  assert(board(r, 'LP1').circuits.every((c) => c.vdStartPct === undefined));
});

/* ================= 12) ค่าปรับตั้ง Ir (โอเวอร์โหลด) ของ MCCB สายป้อน — ข้อมูลอ้างอิงในรายงาน (fixandupgrade 2.3) ================= */
test('12.1 feeder.cb.ir = min(AT, max(⌈Ic⌉, round(0.7 × AT))) เป็นจำนวนเต็ม อยู่ในช่วงปรับ 0.7–1.0 × AT และ ≥ กระแสออกแบบ Ic (ยกเว้น Ic เกิน AT) พร้อม step', () => {
  for (const [va, L] of [[8000, 20], [20000, 100], [40000, 50], [90000, 30], [150000, 20]]) {
    const f = egcCase('fd', va, L, false), at = f.cb.at;
    eq(f.cb.ir, Math.min(at, Math.max(Math.ceil(f.Ic), Math.round(at * 0.7))));
    assert(Number.isInteger(f.cb.ir) && f.cb.ir <= at && f.cb.ir >= Math.round(at * 0.7) && (f.Ic > at || f.cb.ir >= f.Ic - 1e-9), JSON.stringify([va, at, f.Ic, f.cb.ir]));
    assert(f.steps.some((x) => /Ir/.test(x.t) && new RegExp(String(f.cb.ir)).test(x.f)), JSON.stringify(f.steps.map((x) => x.t)));
  }
});

/* ================= 13) Tap Ahead of Main (NFPA 20) : board.tap = 'ahead_of_main' — ตัวเลือกปิดไว้ (fixandupgrade 3.1 + 4.1) ================= */
// ปั๊มดับเพลิงรับไฟจากสายประธานก่อน CB ประธานของอาคาร : CB ประธานไม่รวมดีมานด์ของแผงนี้ แต่หม้อแปลง/สายประธาน/เครื่องกำเนิดไฟฟ้า/Ik" ใช้ดีมานด์ทั้งหมด
const SQ3_ = Math.sqrt(3);
const tapProj = (supply, tap, fpKW, extra) => proj({
  meta: Object.assign({ supply, utility: 'MEA', serviceKA: 25 }, extra || {}),
  panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { name: 'LP-1' }), P('FP', 'SDB', 'MDB', Object.assign({ name: 'FP-PANEL', emergency: true, feederLength: 15 }, tap ? { tap: 'ahead_of_main' } : {}))],
  items: [I('LP1', { type: 'rec', points: 20 }), I('FP', { type: 'fire_pump', kw: fpKW || 55, phases: 3, name: 'ปั๊มดับเพลิง' })]
});
const tapOf = (r) => r.panels.filter((p) => p.board.tap === 'ahead_of_main').map((p) => p.id);
const tapWarn = (r) => r.warnings.filter((w) => /tap/i.test(w));

test('13.1 ค่าเริ่มต้นปิด: ไม่มี board.tap → ผลลัพธ์ไม่มีฟิลด์ tap, ไม่มี service.tap, ไม่มีคำเตือนเรื่อง tap ; ค่า false/""/null เท่ากับไม่ระบุ', () => {
  for (const v of [undefined, false, '', null]) {
    const p = tapProj('lv', false);
    if (v !== undefined) p.panels.find((x) => x.id === 'FP').tap = v;
    const r = calc(p);
    assert(r.panels.every((x) => !('tap' in x.board) || !x.board.tap), JSON.stringify(r.panels.map((x) => x.board.tap)));
    assert(r.service.tap === undefined && !tapWarn(r).length, JSON.stringify([r.service.tap, tapWarn(r)]));
  }
});
test('13.2 normalise: tap ที่ถูกต้องเฉพาะแผงที่รับไฟตรงจาก MDB ; MDB เอง / แผงลูกของแผงอื่น / ค่าแปลก → ตัดทิ้งพร้อมคำเตือน', () => {
  eq(tapOf(calc(tapProj('lv', true))), ['FP']);
  const mdbTap = tapProj('lv', true); mdbTap.panels[0].tap = 'ahead_of_main';
  const r1 = calc(mdbTap);
  eq(tapOf(r1), ['FP']);   // MDB ไม่ใช่แผงที่ tap ได้
  assert(r1.warnings.some((w) => /MDB/.test(w) && /tap/i.test(w)), JSON.stringify(r1.warnings.filter((w) => /tap/i.test(w))));
  const deep = proj({ meta: { supply: 'lv' }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('FP', 'LP', 'SDB1', { tap: 'ahead_of_main', emergency: true })], items: [I('FP', { type: 'fire_pump', kw: 22, phases: 3 })] });
  const r2 = calc(deep);
  eq(tapOf(r2), []);
  assert(r2.service.tap === undefined, 'ไม่ใช่ลูกตรงของ MDB ต้องไม่มี service.tap');
  assert(r2.warnings.some((w) => /FP/.test(w) && /tap/i.test(w) && /MDB/.test(w)), JSON.stringify(r2.warnings.filter((w) => /tap/i.test(w))));
  const junk = tapProj('lv', false); junk.panels.find((x) => x.id === 'FP').tap = 'before_main';
  const r3 = calc(junk);
  eq(tapOf(r3), []);
  assert(r3.warnings.some((w) => /before_main/.test(w) && /tap/i.test(w)), JSON.stringify(r3.warnings.filter((w) => /tap/i.test(w))));
});
test('13.3 รับไฟแรงต่ำ: CB ประธานไม่รวมดีมานด์แผง tap (เล็กลง) แต่ดีมานด์รวม/มิเตอร์/เครื่องกำเนิดไฟฟ้าเท่าเดิม และ CB ประธาน≥ กระแสดีมานด์ที่ไม่รวมแผง tap', () => {
  const base = calc(tapProj('lv', false)), tap = calc(tapProj('lv', true));
  assert(tap.service.mainCB.at < base.service.mainCB.at, `main ${tap.service.mainCB.at} vs ${base.service.mainCB.at}`);
  eq([tap.service.demandKVA, tap.totals.demand, tap.service.demandI], [base.service.demandKVA, base.totals.demand, base.service.demandI]);
  eq(tap.service.meter.size, base.service.meter.size);
  eq([tap.service.generator.kva, tap.service.generator.demandKVA], [base.service.generator.kva, base.service.generator.demandKVA]);
  const fpVA = tap.panels.find((x) => x.id === 'FP').demand;
  const mainI = (tap.totals.demand - fpVA) / (SQ3_ * 400);
  assert(tap.service.mainCB.at + 1e-9 >= mainI * tap.meta.feederFactor, `main ${tap.service.mainCB.at} < ${mainI * tap.meta.feederFactor}`);
  near(tap.service.tap.mainDemandI, mainI, 1e-9);
  near(tap.service.tap.tappedVA, fpVA, 1e-6);
  eq(tap.service.tap.panels, ['FP']);
});
test('13.4 สายประธาน (service conductors) ไม่เล็กลงตาม CB ประธาน : ต้องไม่เล็กกว่ากรณีไม่ tap และรับกระแสดีมานด์ทั้งอาคารได้ ; Busbar MDB ตามเมน', () => {
  for (const supply of ['lv', 'transformer']) {
    const base = calc(tapProj(supply, false)), tap = calc(tapProj(supply, true));
    const mf = tap.service.mainFeeder, bf = base.service.mainFeeder;
    assert(mf.size * mf.sets >= bf.size * bf.sets, `${supply}: ${mf.sets}x${mf.size} < ${bf.sets}x${bf.size}`);
    const pk = E.pickConductor({ cable: tap.meta.main.cable, method: tap.meta.main.method, ncc: 3, Ireq: 1, minSize: mf.size, maxSize: mf.size, meta: tap.meta, groups: mf.sets });
    assert(pk.derated * mf.sets + 1e-6 >= tap.service.demandI, `${supply}: สายประธานรับ ${(pk.derated * mf.sets).toFixed(0)} A < ดีมานด์ ${tap.service.demandI.toFixed(0)} A`);
    assert(pk.derated * mf.sets + 1e-6 >= tap.service.mainCB.at, `${supply}: สายประธานน้อยกว่า CB ประธาน`);
    assert(tap.service.busbar >= tap.service.mainCB.at, 'busbar ' + tap.service.busbar);
    assert(tap.service.steps.some((x) => /tap/i.test(x.t + x.f)), `${supply}: ต้องมี step อธิบายการ tap`);
  }
});
test('13.5 รับไฟผ่านหม้อแปลง: ขนาดหม้อแปลง/Ik" เท่ากรณีไม่ tap (ใช้ดีมานด์รวม) ; CB ประธาน ≥ ดีมานด์ที่ไม่รวมแผง tap และไม่เกิน ILV', () => {
  const base = calc(tapProj('transformer', false)), tap = calc(tapProj('transformer', true));
  eq([tap.service.trafo.kva, tap.service.hv.fuse], [base.service.trafo.kva, base.service.hv.fuse]);
  near(tap.service.scTrafo.Ik, base.service.scTrafo.Ik, 1e-9);
  near(tap.service.scMDB.Ik, base.service.scMDB.Ik, 1e-9);   // สายประธานเท่าเดิม → Ik" ที่ MDB เท่าเดิม
  assert(tap.service.mainCB.at <= tap.service.Ilv + 1e-9, `main ${tap.service.mainCB.at} > ILV ${tap.service.Ilv}`);
  assert(tap.service.mainCB.at + 1e-9 >= tap.service.tap.mainDemandI, 'main < ดีมานด์ที่ไม่รวมแผง tap');
});
// แผง tap ที่ไม่มีมอเตอร์ (ใช้ทดสอบเพดาน parentAt + selectivity) : โหลด 3 เฟส 15 kVA × 2 ; ส่วนที่เหลือของอาคารเล็กมาก → CB ประธานเล็ก
const capProj = (tap) => proj({
  meta: { supply: 'lv', utility: 'MEA', serviceKA: 25 },
  panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { name: 'LP-1' }), P('TP', 'SDB', 'MDB', Object.assign({ name: 'TAP-PANEL', emergency: true }, tap ? { tap: 'ahead_of_main' } : {}))],
  items: [I('LP1', { type: 'rec', points: 4 }), I('TP', { type: 'custom', va: 15000, phases: 3, continuous: true, qty: 2, cat: 'other', name: 'โหลดทดสอบ' })]
});
test('13.6 CB สายป้อนแผง tap ไม่ถูกจำกัดด้วย CB ประธาน (parentAt) : ใหญ่กว่า CB ประธานได้และยังเลือกตัดกับวงจรย่อยของแผงเอง ; แผงปกติยังถูกจำกัดตามเดิม', () => {
  const r = calc(capProj(true)), tp = board(r, 'TP');
  assert(tp.feeder.cb.at > r.service.mainCB.at, `tap feeder ${tp.feeder.cb.at} ไม่ใหญ่กว่า main ${r.service.mainCB.at}`);
  const maxBr = Math.max(...tp.circuits.filter((c) => c.cb && c.cat !== 'spare').map((c) => c.cb.at));
  assert(tp.feeder.cb.at / maxBr >= 1.6 - 1e-9, `อัตราส่วน ${tp.feeder.cb.at}/${maxBr}`);
  const base = calc(capProj(false));
  assert(board(base, 'TP').feeder.cb.at <= base.service.mainCB.at, 'ควบคุม: ไม่ tap แล้ว CB สายป้อนต้องไม่เกิน CB ประธาน');
});
test('13.7 selectivity: แผง tap ไม่เป็นคู่ "CB ประธาน vs CB สายป้อน" ; ไม่ tap ยังมีคู่นี้ ; แผง tap ยังประสาน CB สายป้อนของตัวเองกับวงจรย่อย', () => {
  const r = calc(capProj(true)), base = calc(capProj(false));
  assert(!board(r, 'MDB').selectivity.some((s) => s.kind === 'feeder' && s.to === 'TP'), 'พบคู่ MDB→TP ทั้งที่ tap');
  assert(board(base, 'MDB').selectivity.some((s) => s.kind === 'feeder' && s.to === 'TP'), 'ควบคุม: ไม่ tap ต้องมีคู่ MDB→TP');
  assert(board(r, 'TP').selectivity.some((s) => s.kind === 'branch'), 'TP ยังต้องตรวจวงจรย่อยของตัวเอง');
  assert(!r.warnings.some((w) => /selectivity/.test(w) && /TAP-PANEL/.test(w) && /ต้นทาง/.test(w) && /ไม่เลือกตัด/.test(w)), JSON.stringify(r.warnings.filter((w) => /TAP-PANEL/.test(w))));
});
test('13.8 IC ของ CB สายป้อนแผง tap ใช้ Ik" ที่ MDB (ด้านเข้า) และ icViolations ว่าง ; ขั้นตอนระบุจุด tap', () => {
  const r = calc(tapProj('lv', true)), fp = board(r, 'FP');
  eq(fp.feeder.cb.ic, Math.max(r.meta.mccbICMin || 0, E.icStd(r.service.scMDB.Ik)));
  assert(fp.feeder.cb.ic + 1e-9 >= r.service.scMDB.Ik, `${fp.feeder.cb.ic} < Ik" ${r.service.scMDB.Ik}`);
  eq(r.icViolations, []);
  assert(fp.feeder.steps.some((x) => /tap/i.test(x.t + x.f) && /MDB/.test(x.f)), JSON.stringify(fp.feeder.steps.map((x) => x.t)));
});
test('13.9 เครื่องกำเนิดไฟฟ้าใช้ดีมานด์เต็มของแผง tap ที่เป็นแผงฉุกเฉิน (มอเตอร์ปั๊มนับเป็นมอเตอร์เริ่มเดิน)', () => {
  const r = calc(tapProj('transformer', true)), g = r.service.generator;
  assert(g && g.panels.some((p) => p.id === 'FP') && g.bigMotor && /ปั๊มดับเพลิง/.test(g.bigMotor.desc), JSON.stringify(g && g.panels.map((p) => p.id)));
  near(g.demandKVA, board(r, 'FP').demand / 1000, 1e-9);
});
test('13.10 แผง tap ที่ไม่มีวงจรปั๊มดับเพลิงใต้แผง → เตือน (tap ก่อนเมนเฉพาะปั๊มดับเพลิง NFPA 20) ; มีปั๊ม → ไม่เตือนเรื่องนี้', () => {
  const no = calc(capProj(true));
  assert(no.warnings.some((w) => /TAP-PANEL/.test(w) && /tap/i.test(w) && /ปั๊มดับเพลิง/.test(w)), JSON.stringify(tapWarn(no)));
  const yes = calc(tapProj('lv', true));
  assert(!yes.warnings.some((w) => /FP-PANEL/.test(w) && /tap/i.test(w)), JSON.stringify(tapWarn(yes)));
});
test('13.11 sanitize / normalizeProject เก็บ tap = "ahead_of_main" ; ค่าอื่นถูกตัด (ไม่ใส่ฟิลด์)', () => {
  const raw = (v) => ({ meta: {}, panels: [{ id: 'MDB', kind: 'MDB' }, { id: 'FP', kind: 'SDB', parent: 'MDB', tap: v }], items: [] });
  const get = (v) => (SAN.project(raw(v)).project || SAN.project(raw(v))).panels.find((x) => x.id === 'FP');
  eq(get('ahead_of_main').tap, 'ahead_of_main');
  for (const v of ['x', true, 1, '', null, 'AHEAD']) assert(!('tap' in get(v)), 'ต้องตัด tap=' + JSON.stringify(v) + ' → ' + JSON.stringify(get(v)));
  eq(E.normalizeProject(raw('ahead_of_main')).project.panels.find((x) => x.id === 'FP').tap, 'ahead_of_main');
});


done();
