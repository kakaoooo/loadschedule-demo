// กรณีใช้งานจริงในประเทศไทย (use case) — โครงการตัวอย่างที่พบบ่อยตั้งแต่ทาวน์เฮาส์ถึงโรงงาน
// แต่ละกรณีตรวจผลที่วิศวกร/การไฟฟ้าคาดหวังจริง (มิเตอร์ กฟน./กฟภ., CB ประธาน, RCBO, มอเตอร์, ดีมานด์)
// test() = ต้องผ่าน, gap() = ความสามารถที่งานจริงต้องการแต่โปรแกรมยังไม่มี → พิมพ์ "GAP" (ไม่ทำให้ชุดทดสอบล้ม)
const { E, D, proj, P, I } = require('./helpers/build.js');
const { test, assert, near, done } = require('./helpers/eng-harness.js');

const V1 = 230;
const LED = D.LAMPS.find((l) => /LED/.test(l.label) && l.w >= 9).id;
const calc = (opts) => E.calculate(proj(opts));
const board = (r, id) => r.panels.find((b) => b.id === id);
const gaps = [];
function gap(name, fn) {
  let ok = false, why = '';
  try { ok = !!fn(); } catch (e) { why = e.message; }
  if (ok) console.log(`PASS  ${name}`); else { gaps.push(name); console.log(`GAP   ${name}${why ? ': ' + why : ''}`); }
}
const house = (phases, utility, items) => calc({ meta: { supply: 'lv', utility, buildingType: 'residential' }, panels: [P('MDB', 'MDB', null, { phases })], items: items.map((o) => I('MDB', o)) });

/* ---------- UC1 ทาวน์เฮาส์ 1 เฟส กฟน. (~5 kVA) ---------- */
const townhouse = [
  { type: 'light', lamp: LED, fixtures: 15 }, { type: 'rec', points: 10 },
  { type: 'ac', btu: 12000, phases: 1 }, { type: 'heater', watt: 3500 }
];
test('UC1 ทาวน์เฮาส์ 1 เฟส: กระแสดีมานด์คิดที่ 230 V', () => { const r = house(1, 'MEA', townhouse); near(r.service.demandI, r.totals.demand / V1, 1e-6); });
// ช่วงมิเตอร์ 1 เฟส กฟน.: 5(15) ≤ 10 A, 15(45) ≤ 30 A, 30(100) ≤ 75 A, 50(150) ≤ 100 A — เลือกตัวเล็กสุดที่พอ
test('UC1 ทาวน์เฮาส์ 1 เฟส: มิเตอร์ กฟน. 1 เฟสตัวเล็กสุดที่พอ, CB ประธาน 2P ไม่เกินพิกัดมิเตอร์', () => {
  const s = house(1, 'MEA', townhouse).service;
  const want = D.METER_MEA.find((m) => m[1] === 1 && m[3] >= s.demandI && m[2] >= s.demandI * 1.25);
  assert(s.meter.phases === 1 && s.meter.size === want[0], JSON.stringify(s.meter) + ' I=' + s.demandI.toFixed(1));
  assert(s.mainCB.poles === 2 && s.mainCB.at <= s.meter.cbMax && s.mainCB.at >= s.demandI * 1.25, s.mainCB.label);
});
test('UC1 บ้านเล็ก ~4 kVA → มิเตอร์ 1 เฟส 15(45) A', () => {
  const s = house(1, 'MEA', [{ type: 'light', lamp: LED, fixtures: 15 }, { type: 'rec', points: 10 }, { type: 'ac', btu: 12000, phases: 1 }]).service;
  assert(s.meter.size === '15(45) A' && s.meter.phases === 1, JSON.stringify(s.meter));
});
test('UC1 ทาวน์เฮาส์: BOM มี CB ประธาน 2P ไม่ใช่ 3P', () => {
  const b = house(1, 'MEA', townhouse).bom.breakers.find((x) => /MCCB/.test(x.label));
  assert(b && String(b.poles) === '2P', JSON.stringify(b));
});

/* ---------- UC2 บ้านเดี่ยว 1 เฟส กฟภ. (~12 kVA) ---------- */
const detached = townhouse.concat([{ type: 'ac', btu: 18000, phases: 1, qty: 2 }, { type: 'heater', watt: 4500 }, { type: 'rec', points: 10 }]);
test('UC2 บ้านเดี่ยว 1 เฟส กฟภ.: เลือกมิเตอร์ 1 เฟสที่ CB สูงสุด ≥ 1.25 × I', () => {
  const s = house(1, 'PEA', detached).service;
  assert(s.meter.phases === 1 && !s.meter.over && s.meter.cbMax >= s.demandI * 1.25, JSON.stringify(s.meter) + ' I=' + s.demandI.toFixed(1));
});
test('UC2 เครื่องทำน้ำอุ่น 4,500 W ได้ RCBO 30 mA (หัวข้อ 6.3.3)', () => {
  const c = board(house(1, 'PEA', detached), 'MDB').circuits.filter((x) => x.cat === 'heater');
  assert(c.length && c.every((x) => x.cb.rcd), c.map((x) => x.cb.label).join());
});

/* ---------- UC3 บ้านโหลดหนัก + EV charger: 1 เฟสไม่พอ ต้องเตือนให้ขอ 3 เฟส ---------- */
const heavy = detached.concat([{ type: 'custom', name: 'EV charger 7.4 kW', watt: 7400, pf: 1, phases: 1, continuous: true, rcd: true, cat: 'other' }, { type: 'heater', watt: 4500 }, { type: 'cook', watt: 3000, phases: 1 }]);
test('UC3 บ้าน 1 เฟสโหลดเกินมิเตอร์ 1 เฟส → เตือนให้ขอ 3 เฟส', () => {
  const r = house(1, 'MEA', heavy);
  assert(r.service.meter.over && r.warnings.some((w) => /มิเตอร์ 3 เฟส/.test(w)), r.warnings.join(' | '));
});
test('UC3 บ้านเดียวกันตั้ง MDB 3 เฟส → มิเตอร์ 3 เฟส ไม่เตือน', () => {
  const r = house(3, 'MEA', heavy);
  assert(r.service.meter.phases === 3 && !r.service.meter.over, JSON.stringify(r.service.meter));
});
test('UC3 EV charger 7.4 kW (โหลดต่อเนื่อง): CB ≥ 1.25 × 32 A และมี RCD', () => {
  const ev = board(house(3, 'MEA', heavy), 'MDB').circuits.find((c) => /EV/.test(c.desc));
  assert(ev.cb.at >= 1.25 * 7400 / V1 && ev.cb.rcd, JSON.stringify(ev.cb));
  assert(ev.cond.amp >= ev.cb.at, 'สายต้องรับกระแส ≥ CB: ' + ev.cond.text);
});

/* ---------- UC4 อาคารพาณิชย์/ร้านค้า 3 เฟส กฟน. ---------- */
test('UC4 อาคารพาณิชย์ 3 เฟส ~18 kVA: มิเตอร์ 3 เฟส 15(45) A หรือ 30(100) A', () => {
  const r = calc({ meta: { supply: 'lv', utility: 'MEA', buildingType: 'office' }, panels: [P('MDB', 'MDB', null)], items: [
    I('MDB', { type: 'light', lamp: LED, fixtures: 40 }), I('MDB', { type: 'rec', points: 20 }), I('MDB', { type: 'ac', btu: 24000, phases: 1, qty: 3 })] });
  assert(r.service.meter.phases === 3 && /^(15\(45\)|30\(100\))/.test(r.service.meter.size), JSON.stringify(r.service.meter));
});
test('UC4 รับไฟแรงต่ำเกินมิเตอร์ใหญ่สุด → เตือนให้ติดตั้งหม้อแปลงเอง', () => {
  const r = calc({ meta: { supply: 'lv', utility: 'MEA' }, panels: [P('MDB', 'MDB', null)], items: [I('MDB', { type: 'chiller', cooling: 'air', preset: D.CHILLER_AIR.length - 1, qty: 3 })] });
  assert(r.warnings.some((w) => /หม้อแปลง/.test(w)), r.warnings.join(' | '));
});

/* ---------- UC5 อาคารสำนักงาน 3 ชั้น หม้อแปลงของผู้ใช้ไฟ ---------- */
const office = () => {
  const panels = [P('MDB', 'MDB', null)], items = [];
  for (let f = 1; f <= 3; f++) {
    panels.push(P('SDB' + f, 'SDB', 'MDB', { feederLength: 15 + 4 * f }), P('LP' + f, 'LP', 'SDB' + f), P('LA' + f, 'LP', 'SDB' + f));
    items.push(I('LP' + f, { type: 'light', lamp: LED, fixtures: 80 }), I('LP' + f, { type: 'rec', points: 80 }), I('LA' + f, { type: 'ac', btu: 36000, phases: 3, qty: 4 }));
  }
  items.push(I('MDB', { type: 'lift', preset: 1 }), I('MDB', { type: 'motor', phases: 3, kw: 5.5, start: 'DOL', qty: 2, name: 'ปั๊มน้ำดี' }));
  return calc({ meta: { supply: 'transformer', utility: 'PEA', buildingType: 'office' }, panels, items });
};
test('UC5 สำนักงาน: หม้อแปลงขนาดมาตรฐาน ≥ ดีมานด์', () => {
  const s = office().service;
  assert(D.TRANSFORMERS.some((t) => t.kva === s.trafo.kva) && s.trafo.kva >= s.demandKVA, s.trafo.kva + ' vs ' + s.demandKVA);
});
test('UC5 สำนักงาน: CB ประธาน ≥ กระแสดีมานด์ และ ≤ พิกัดหม้อแปลง (ตาราง 7.2)', () => {
  const s = office().service;
  assert(s.mainCB.at >= s.demandI && s.mainCB.at <= s.Ilv * 1.0001, `${s.mainCB.at} / I=${s.demandI.toFixed(0)} / ILV=${s.Ilv.toFixed(0)}`);
});
test('UC5 สำนักงาน: IC ของ CB ประธาน ≥ กระแสลัดวงจรที่ MDB', () => { const s = office().service; assert(s.mainCB.ic >= s.scMDB.Ik, s.mainCB.ic + ' < ' + s.scMDB.Ik); });
test('UC5 สำนักงาน: แรงดันตกรวมถึงปลายวงจรทุกแผง ≤ 5%', () => {
  const r = office();
  r.panels.forEach((b) => b.circuits.forEach((c) => { if (c.vd) assert((b.vdUp || 0) + c.vd.pct <= 5 + 1e-6, `${b.id} ${c.desc} ${((b.vdUp || 0) + c.vd.pct).toFixed(2)}%`); }));
});
test('UC5 สำนักงาน: เต้ารับเกิน 10 kVA คิดดีมานด์ 50% ส่วนเกิน (ตาราง 6.11)', () => {
  const rec = board(office(), 'LP1').demandLocal.cats.rec;
  assert(rec.connected > 10000, 'ตัวอย่างต้องมีเต้ารับเกิน 10 kVA: ' + rec.connected);
  near(rec.demand, 10000 + (rec.connected - 10000) * 0.5, 1e-6);
});

/* ---------- UC6 โรงงานขนาดเล็ก (มอเตอร์ DOL / Y-Δ) ---------- */
const factory = () => calc({ meta: { supply: 'transformer', utility: 'PEA', buildingType: 'other' }, panels: [P('MDB', 'MDB', null), P('MCC', 'SDB', 'MDB', { feederLength: 40 })], items: [
  I('MCC', { type: 'motor', phases: 3, kw: 30, start: 'YD', qty: 2 }), I('MCC', { type: 'motor', phases: 3, kw: 7.5, start: 'DOL', qty: 4 }), I('MCC', { type: 'motor', phases: 3, kw: 55, start: 'YD' })] });
test('UC6 โรงงาน: CB มอเตอร์แต่ละตัว ≤ 2.5 Im และ ≥ Im (ตาราง 8.5)', () => {
  board(factory(), 'MCC').circuits.forEach((c) => assert(c.cb.at >= c.motor.im && c.cb.at <= 2.5 * c.motor.im + 1e-6, `${c.desc} CB ${c.cb.at} Im ${c.motor.im}`));
});
test('UC6 โรงงาน: กระแสออกแบบสายป้อน = 1.25 Im ตัวใหญ่ + ΣIm ตัวอื่น (สมการ 8-7)', () => {
  const m = board(factory(), 'MCC');
  const ims = m.circuits.map((c) => c.motor.im).sort((a, b) => b - a);
  near(m.feeder.Ic, 1.25 * ims[0] + ims.slice(1).reduce((s, x) => s + x, 0), 0.5);
});
test('UC6 โรงงาน: สายป้อนรับกระแส ≥ กระแสออกแบบ', () => { const f = board(factory(), 'MCC').feeder; assert(f.amp * f.sets >= f.Ic, `${f.text} ${f.amp}×${f.sets} < ${f.Ic}`); });

/* ---------- UC7 โรงแรม: แอร์แยกห้อง 75% ---------- */
test('UC7 โรงแรม: แอร์คิดดีมานด์ 75% (ตาราง 6.12)', () => {
  const r = calc({ meta: { buildingType: 'hotel' }, panels: [P('MDB', 'MDB', null), P('LA', 'LP', 'MDB')], items: [I('LA', { type: 'ac', btu: 12000, phases: 1, qty: 20 })] });
  const ac = board(r, 'LA').demandLocal.cats.ac;
  near(ac.demand, ac.connected * 0.75, 1e-6);
});

/* ---------- UC8 อาคารชุด / คอนโด (ห้องชุดจำนวนมาก) ---------- */
const condo = (n) => {
  const panels = [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items = [];
  for (let i = 1; i <= n; i++) {
    panels.push(P('U' + i, 'LP', 'SDB1', { phases: 1, feederLength: 30 }));
    items.push(I('U' + i, { type: 'light', lamp: LED, fixtures: 10 }), I('U' + i, { type: 'rec', points: 8 }), I('U' + i, { type: 'ac', btu: 12000, phases: 1 }), I('U' + i, { type: 'heater', watt: 3500 }));
  }
  return calc({ meta: { buildingType: 'condo', supply: 'transformer', utility: 'MEA' }, panels, items });
};
test('UC8 คอนโด 40 ห้อง: คำนวณได้ ไม่มี NaN และหม้อแปลง ≥ ดีมานด์', () => {
  const r = condo(40);
  assert(Number.isFinite(r.totals.demand) && r.service.trafo.kva >= r.service.demandKVA);
});
test('UC8 คอนโด 40 ห้อง: ใช้ตัวคูณโหลดพร้อมกันของห้องชุด (ตาราง 9.x) — ดีมานด์ต้องน้อยกว่าผลรวม', () => {
  const r = condo(40);
  assert(r.totals.demand < r.totals.connected * 0.9, r.totals.demand + ' vs ' + r.totals.connected);
});
// ตาราง 9.3 คิดเป็นขั้นตามตัวอย่าง 9.3.3/9.3.4 ในตำรา: ห้อง 1–10 × 0.9, 11–20 × 0.8, 21–30 × 0.7, 31–40 × 0.6, 41+ × 0.5
test('UC8 คอนโด: ตัวคูณเป็นขั้นตามตาราง 9.3 (8 / 14 / 40 / 45 ห้อง) ที่ SDB/MDB และขั้นตอนคำนวณแสดงทุกขั้น', () => {
  [[8, 8 * 0.9], [14, 10 * 0.9 + 4 * 0.8], [40, 10 * (0.9 + 0.8 + 0.7 + 0.6)], [45, 30 + 5 * 0.5]].forEach(([n, units]) => {
    const r = condo(n), sdb = board(r, 'SDB1'), u1 = board(r, 'U1');
    assert(sdb.condo && sdb.condo.res.n === n, n + ' ห้อง: ' + JSON.stringify(sdb.condo));
    near(sdb.demand, u1.demand * units, 1e-6, n + ' ห้อง');
    near(sdb.condo.res.f, units / n, 1e-9);
    near(board(r, 'MDB').demand, sdb.demand, 1e-6);
    const st = r.service.steps.find((s) => /ตัวคูณโหลดพร้อมกัน/.test(s.t));
    assert(st && st.f.includes('ห้อง 1–' + Math.min(n, 10) + ' × 0.9'), 'ไม่พบขั้นตอนตัวคูณ: ' + (st && st.f));
  });
});
test('UC8 คอนโด: ดีมานด์ไม่ลดลงเมื่อเพิ่มห้อง (เดิมกระโดด 40 → 41 ห้อง)', () => {
  let prev = 0;
  for (let n = 1; n <= 60; n++) { const d = board(condo(n), 'SDB1').demand; assert(d >= prev - 1e-6, `${n} ห้อง ${d} < ${prev}`); prev = d; }
});
test('UC8 คอนโด: ห้องที่โหลดมากสุดได้ตัวคูณ 0.9 ก่อน (เรียงจากมากไปน้อย)', () => {
  const panels = [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items = [];
  for (let i = 1; i <= 11; i++) { panels.push(P('U' + i, 'LP', 'SDB1', { phases: 1 })); items.push(I('U' + i, { type: 'rec', points: i === 11 ? 20 : 5 })); }
  const r = calc({ meta: { buildingType: 'condo' }, panels, items });
  const big = board(r, 'U11').demand, small = board(r, 'U1').demand;
  near(board(r, 'SDB1').demand, big * 0.9 + small * 9 * 0.9 + small * 0.8, 1e-6);
});
test('UC8 คอนโด: ห้องเดียวไม่คูณ, ห้องชุดพาณิชย์ใช้ตาราง 9.4 (1–10 × 1.0, 11+ × 0.85), แผงส่วนกลางคิด 100%', () => {
  const panels = [P('MDB', 'MDB', null), P('SH1', 'LP', 'MDB', { unit: 'com' }), P('SH2', 'LP', 'MDB', { unit: 'com' }), P('CA', 'LP', 'MDB', { phases: 1, unit: 'none' })];
  const items = ['SH1', 'SH2', 'CA'].map((id) => I(id, { type: 'rec', points: 10 }));
  for (let i = 0; i < 11; i++) { panels.push(P('S' + i, 'LP', 'MDB', { unit: 'com' })); items.push(I('S' + i, { type: 'rec', points: 10 })); }
  const r = calc({ meta: { buildingType: 'condo' }, panels, items });
  const m = board(r, 'MDB');
  assert(m.condo.com.n === 13 && m.condo.res.n === 0, JSON.stringify(m.condo));
  near(m.condo.com.f, (10 + 3 * 0.85) / 13, 1e-9);
  near(m.demand, m.condo.com.va * (10 + 3 * 0.85) / 13 + board(r, 'CA').demand, 1e-6);
  const one = calc({ meta: { buildingType: 'condo' }, panels: [P('MDB', 'MDB', null), P('U1', 'LP', 'MDB', { phases: 1 })], items: [I('U1', { type: 'rec', points: 10 })] });
  near(board(one, 'MDB').demand, board(one, 'U1').demand, 1e-6);
});
test('UC8 อาคารที่อยู่อาศัยเดิม (ไม่ใช่อาคารชุด) ไม่ใช้ตัวคูณห้องชุด', () => {
  const panels = [P('MDB', 'MDB', null)], items = [];
  for (let i = 1; i <= 20; i++) { panels.push(P('U' + i, 'LP', 'MDB', { phases: 1 })); items.push(I('U' + i, { type: 'rec', points: 8 })); }
  const r = calc({ meta: { buildingType: 'residential' }, panels, items });
  assert(!board(r, 'MDB').condo); near(r.totals.demand, r.totals.connected, 1e-6);
});

/* ---------- ความสามารถที่งานจริงต้องการ (ยังไม่มี) ---------- */
test('บ้าน 1 เฟสรับไฟแรงต่ำ: ไม่แนะนำตู้คาปาซิเตอร์ 25 kVAR (ใช้กับผู้ใช้ไฟรายใหญ่)', () => {
  const s = house(1, 'MEA', townhouse).service;
  assert(s.pfc.bank === 0 && s.steps.some((x) => /ตัวประกอบกำลัง/.test(x.t) && /ไม่ต้องติดตั้ง/.test(x.f)), JSON.stringify(s.pfc));
});
test('ตู้คาปาซิเตอร์ยังแนะนำสำหรับอาคารที่มีหม้อแปลงเอง', () => { assert(office().service.pfc.bank > 0, JSON.stringify(office().service.pfc)); });

/* ---------- UC9 โรงพยาบาลขนาดเล็ก: EMDB ผ่าน ATS + เครื่องกำเนิดไฟฟ้า ---------- */
const hospital = () => calc({ meta: { buildingType: 'hospital', supply: 'transformer', utility: 'PEA' },
  panels: [P('MDB', 'MDB', null), P('EMDB', 'SDB', 'MDB', { emergency: true }), P('ELP', 'LP', 'EMDB'), P('LP1', 'LP', 'MDB')],
  items: [I('EMDB', { type: 'motor', phases: 3, kw: 30, start: 'YD', name: 'Fire pump' }), I('EMDB', { type: 'lift', preset: 2, name: 'Bed lift' }),
    I('ELP', { type: 'light', lamp: LED, fixtures: 120 }), I('ELP', { type: 'rec', points: 30 }),
    I('LP1', { type: 'light', lamp: LED, fixtures: 200 }), I('LP1', { type: 'rec', points: 60 }), I('MDB', { type: 'chiller', cooling: 'air', preset: 3 })] });
test('UC9 อาคารไม่มีแผงฉุกเฉิน → ไม่มีเครื่องกำเนิดไฟฟ้า', () => assert(office().service.generator == null));
test('UC9 โรงพยาบาล: เครื่องกำเนิดไฟฟ้าขนาดมาตรฐาน ≥ ดีมานด์ฉุกเฉิน / 0.8 และ ≤ ดีมานด์ทั้งอาคาร', () => {
  const s = hospital().service, g = s.generator;
  assert(g && g.kva >= g.demandKVA / 0.8 - 1e-9, JSON.stringify({ kva: g && g.kva, dem: g && g.demandKVA }));
  assert(g.demandKVA < s.demandKVA, 'โหลดฉุกเฉินต้องน้อยกว่าทั้งอาคาร (ชิลเลอร์ไม่อยู่บนเครื่องกำเนิดฯ)');
});
test('UC9 โรงพยาบาล: ATS 4P ≥ 1.25 × กระแสโหลดฉุกเฉิน', () => {
  const g = hospital().service.generator;
  assert(g.ats.poles === 4 && g.ats.at >= 1.25 * g.I, JSON.stringify(g.ats));
});
test('UC9 โรงพยาบาล: เครื่องกำเนิดไฟฟ้าและ ATS อยู่ใน BOM', () => {
  const r = hospital(), g = r.service.generator;
  assert(r.bom.equipment.some((e) => e.label.includes(`${g.kva} kVA`)) && r.bom.equipment.some((e) => e.label === g.ats.label), JSON.stringify(r.bom.equipment));
});

/* ---------- UC10 ลานจอดคอนโด: EV charger 22 kW × 4 ---------- */
test('UC10 EV 22 kW × 4: วงจรละเครื่อง 3 เฟส, RCD ทุกวงจร, CB ≥ 1.25 × 32 A, ดีมานด์ 100%', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null), P('EV', 'LP', 'MDB')], items: [I('EV', { type: 'ev', preset: 2, qty: 4 })] });
  const cs = board(r, 'EV').circuits.filter((c) => c.phases === 3);
  assert(cs.length === 4 && cs.every((c) => c.cb.rcd && c.cb.at >= 40 && c.cond.amp >= c.cb.at), cs.map((c) => c.cb.label + '/' + c.cond.text).join());
  const d = board(r, 'EV').demandLocal;
  near(d.total, d.connected, 1e-6);
});

/* ---------- UC11 selectivity เบื้องต้นของสำนักงาน ---------- */
test('UC11 สำนักงาน: ทุกแผงที่มี CB ต้นทาง–ปลายทางมีผลตรวจ selectivity และสถานะถูกต้อง', () => {
  const r = office();
  const all = r.panels.flatMap((b) => b.selectivity || []);
  assert(all.length > 0 && all.every((x) => ['total', 'partial', 'none'].includes(x.status)), JSON.stringify(all.slice(0, 3)));
});

/* ---------- UC12 แผง PB (ปั๊ม/ลิฟต์ต่อตรงที่แผงสวิตช์รอง): ชนิด CB ต้องตรงกันทุกตาราง ---------- */
// บั๊กเดิม: ตาราง Feeder/SLD แสดง "25AT/100AF" (MCCB) แต่ BOM/selectivity นับเป็น MCB 25A
const Report = (() => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { LoadEngine: E, LS_DATA: D }; ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/export.js'), 'utf8'), ctx);
  return ctx.Report;
})();
const pbProject = (extra) => calc({ meta: { supply: 'transformer', utility: 'PEA', buildingType: 'office' }, panels: [P('MDB', 'MDB', null), P('PB', 'SDB', 'MDB', { feederLength: 10 })], items: [
  I('PB', { type: 'motor', phases: 3, kw: 5.5, start: 'DOL', qty: 2, name: 'ปั๊มน้ำดี' }), I('PB', { type: 'motor', phases: 3, kw: 2.2, start: 'DOL', name: 'ปั๊มน้ำทิ้ง' }),
  I('PB', { type: 'lift', preset: 1, name: 'ลิฟต์โดยสาร' }), I('PB', Object.assign({ type: 'light', lamp: LED, fixtures: 10, name: 'ไฟห้องปั๊ม' }, extra || {}))] });
test('UC12 แผง PB: มอเตอร์/ลิฟต์ต่อตรง = MCCB, ไฟ 1 เฟสเล็ก = MCB', () => {
  const pb = board(pbProject(), 'PB');
  pb.circuits.forEach((c) => {
    const want = c.motor || c.cat === 'lift' ? 'MCCB' : 'MCB';
    assert(c.cb.type === want && (want === 'MCCB') === !!c.cb.af, `${c.desc}: ${JSON.stringify(c.cb)}`);
  });
});
test('UC12 แผง PB: ป้าย CB ในตาราง Feeder = ใน BOM = ใน selectivity', () => {
  const r = pbProject(), mdb = board(r, 'MDB'), pb = board(r, 'PB');
  const fr = Report.feederRows(pb, r, Report.feederNumbers ? Report.feederNumbers(r) : undefined).filter((x) => x.direct);
  const bom = r.bom.breakers.map((b) => b.label);
  pb.circuits.forEach((c) => {
    const row = fr.find((x) => x.c === c);
    assert(row && row.cb === c.cb.label, `${c.desc}: feeder ${row && row.cb} vs ${c.cb.label}`);
    const bomLabel = c.cb.type === 'MCB' ? `MCB ${c.cb.at}A` : `MCCB ${c.cb.label}`;
    assert(bom.includes(bomLabel), `${c.desc}: BOM ไม่มี ${bomLabel} (${bom.join(', ')})`);
    assert(row.ic === c.cb.ic, `${c.desc}: IC ตาราง ${row.ic} vs ${c.cb.ic}`);
  });
  const sel = (pb.selectivity || []).filter((x) => x.kind === 'branch');
  pb.circuits.filter((c) => c.cat !== 'spare').forEach((c) => assert(sel.some((x) => x.down === `${c.cb.at}A ${c.cb.type}`), `${c.desc}: selectivity ไม่มี ${c.cb.at}A ${c.cb.type}`));
  assert(mdb.circuits.length === 0);
});
test('UC12 ผู้ออกแบบเลือกชนิด CB เอง (cbType) ได้ทั้งสองทาง และ MCCB ใช้ IC ≥ mccbICMin', () => {
  const r = pbProject({ cbType: 'MCCB' });
  const light = board(r, 'PB').circuits.find((c) => c.cat === 'light');
  assert(light.cb.type === 'MCCB' && light.cb.ic >= r.meta.mccbICMin, JSON.stringify(light.cb));
  const r2 = calc({ panels: [P('MDB', 'MDB', null), P('PB', 'SDB', 'MDB')], items: [I('PB', { type: 'motor', phases: 3, kw: 2.2, cbType: 'MCB' })] });
  assert(board(r2, 'PB').circuits[0].cb.type === 'MCB', JSON.stringify(board(r2, 'PB').circuits[0].cb));
});
test('UC12 บ้าน 1 เฟส: วงจรที่ MDB (ตู้คอนซูเมอร์) ยังเป็น MCB', () => {
  board(house(1, 'MEA', townhouse), 'MDB').circuits.forEach((c) => assert(c.cb.type === 'MCB', `${c.desc}: ${c.cb.label}`));
});

/* ---------- UC13 ข้อเสนอจาก AI อีกตัวที่ตรวจกับตำราแล้ว (docs/antigravity-review.md) ---------- */
test('UC13 EV 7.4 kW เฟสเดียวในแผง 3 เฟส: CB/สายป้อนรับกระแสเฟสจริง (≥ 1.25 × 32 A)', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null), P('LP', 'LP', 'MDB')], items: [I('LP', { type: 'ev', preset: 0 }), I('LP', { type: 'light', lamp: LED, fixtures: 10 })] });
  const lp = board(r, 'LP'), Iph = Math.max(...lp.phaseVA) / (400 / Math.sqrt(3));
  assert(lp.feeder.cb.at >= 1.25 * Iph && lp.feeder.amp * lp.feeder.sets >= lp.feeder.cb.at, `${lp.feeder.cb.label} ${lp.feeder.text} Iph=${Iph.toFixed(1)}`);
});
test('UC13 ดีมานด์ไม่เกินโหลดติดตั้ง (25% มอเตอร์ใหญ่สุดใช้คิดขนาดสายเท่านั้น)', () => {
  const r = pbProject();
  assert(r.totals.demand <= r.totals.connected + 1e-6, `${r.totals.demand} > ${r.totals.connected}`);
  r.panels.forEach((b) => assert(b.demand <= b.connected + 1e-6, `${b.id}: ${b.demand} > ${b.connected}`));
});
test('UC13 สายป้อนแผงที่มีมอเตอร์อยู่ในแผงลูก: ยังรับ +25% ของมอเตอร์ตัวใหญ่สุด (สมการ 8-7)', () => {
  const r = calc({ meta: { feederFactor: 1 }, panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB'), P('PB', 'SDB', 'SDB')], items: [I('PB', { type: 'motor', phases: 3, kw: 30, start: 'YD' }), I('SDB', { type: 'custom', va: 20000, phases: 3 })] });
  const sdb = board(r, 'SDB'), im = board(r, 'PB').circuits[0].motor.im;
  assert(sdb.feeder.Ic + 1e-6 >= sdb.demand / (Math.sqrt(3) * 400) + 0.25 * im, `Ic ${sdb.feeder.Ic} Im ${im}`);
});
test('UC13 Star-Delta 55 kW: สายหลังสตาร์ทเตอร์ 6 เส้น ≥ 0.906 Im (Fg 0.8), เล็กกว่าแบบ DOL; CB ≤ 2.5 Im เหมือน DOL', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null), P('MCC', 'SDB', 'MDB')], items: [I('MCC', { type: 'motor', phases: 3, kw: 55, start: 'YD' }), I('MCC', { type: 'motor', phases: 3, kw: 55, start: 'DOL' })] });
  const [yd, dol] = board(r, 'MCC').circuits;
  assert(yd.cond.n === 6 && yd.cond.amp >= 0.725 * yd.motor.im && yd.cond.size < dol.cond.size && yd.cond.preSize === dol.cond.size, JSON.stringify([yd.cond, dol.cond]));
  assert(yd.cb.at === dol.cb.at && yd.cb.at <= 2.5 * yd.motor.im, `${yd.cb.at} ${dol.cb.at}`);
});
test('UC13 ท่อฝังดิน (g5) ใช้ตัวคูณกลุ่มตาราง 5-46, ฝังดินโดยตรง (g6) ตาราง 5-45', () => {
  const pick = (method) => E.pickConductor({ cable: 'NYY', method, ncc: 3, Ireq: 100, minSize: 4, meta: proj().meta, groups: 3 });
  const g5 = pick('g5'), g6 = pick('g6');
  assert(g5.fg.f === 0.75 && /5-46/.test(g5.fg.ref) && g6.fg.f === 0.65 && /5-45/.test(g6.fg.ref), JSON.stringify([g5.fg, g6.fg]));
});

console.log(`\nช่องว่างเทียบงานจริง (GAP): ${gaps.length} รายการ`);
done();
