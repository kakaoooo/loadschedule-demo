// ระบบไฟฟ้าฉุกเฉิน: แผงฉุกเฉิน (รับไฟผ่าน ATS) → ขนาด ATS + เครื่องกำเนิดไฟฟ้า (result.service.generator)
// ค่าคงที่ใน D.GEN / D.GEN_KVA / D.ATS_AT เป็นสมมติฐาน (ไม่มีในเอกสาร วสท.) — ทดสอบตามสูตรที่ engine แสดงใน steps
const { E, D, proj, P, I } = require('./helpers/build.js');
const S = require('../public/js/sanitize.js');
const { test, assert, eq, near, done } = require('./helpers/eng-harness.js');

const SQ3 = Math.sqrt(3);
const LED = D.LAMPS.find((l) => /LED/.test(l.label) && l.w >= 9).id;
const calc = (opts) => E.calculate(proj(opts));

// โรงพยาบาล: EMDB (ฉุกเฉิน) มีปั๊มดับเพลิง 30 kW Y-Δ + ลิฟต์ + แผงย่อยไฟฉุกเฉิน ; MDB มีชิลเลอร์ (ไม่อยู่บนเครื่องกำเนิดฯ)
const hospital = (extra) => {
  const o = {
    meta: Object.assign({ buildingType: 'hospital', supply: 'transformer' }, (extra || {}).meta || {}),
    panels: [P('MDB', 'MDB', null), P('EMDB', 'SDB', 'MDB', { emergency: true }), P('ELP', 'LP', 'EMDB'), P('LP1', 'LP', 'MDB')],
    items: [
      I('EMDB', { type: 'motor', kw: 30, start: 'YD', name: 'Fire pump' }),
      I('EMDB', { type: 'lift', preset: 2, name: 'Bed lift' }),
      I('ELP', { type: 'light', lamp: LED, fixtures: 120 }), I('ELP', { type: 'rec', points: 30 }),
      I('LP1', { type: 'light', lamp: LED, fixtures: 200 }), I('LP1', { type: 'rec', points: 60 }),
      I('MDB', { type: 'chiller', cooling: 'air', preset: 3 })
    ]
  };
  return calc(o);
};
const board = (r, id) => r.panels.find((b) => b.id === id);

/* ---------- ไม่มีแผงฉุกเฉิน ---------- */
test('ไม่มีแผงฉุกเฉิน → generator = null และ BOM ไม่มีเครื่องกำเนิดฯ', () => {
  const r = calc({ meta: { buildingType: 'office' }, items: [I('MDB', { type: 'light', lamp: LED, fixtures: 20 })] });
  eq(r.service.generator, null);
  assert(!r.bom.equipment.length, JSON.stringify(r.bom.equipment));
  assert(!r.warnings.some((w) => /ระบบไฟฟ้าฉุกเฉิน/.test(w)), 'สำนักงานไม่ต้องเตือน');
});
test('โรงพยาบาล/โรงแรมไม่มีแผงฉุกเฉิน → คำเตือนแบบข้อมูล', () => {
  ['hospital', 'hotel'].forEach((bt) => {
    const r = calc({ meta: { buildingType: bt }, items: [I('MDB', { type: 'light', lamp: LED, fixtures: 20 })] });
    assert(r.service.generator === null && r.warnings.some((w) => /^ข้อมูล:.*ระบบไฟฟ้าฉุกเฉิน/.test(w)), bt + ': ' + r.warnings.join(' | '));
  });
});
test('board.emergency เป็น boolean เสมอ (ค่าเริ่มต้น false)', () => {
  const r = hospital();
  assert(board(r, 'EMDB').board.emergency === true && board(r, 'LP1').board.emergency === false && board(r, 'ELP').board.emergency === false);
});

/* ---------- โรงพยาบาล: EMDB + ปั๊มดับเพลิง Y-Δ + ลิฟต์ ---------- */
test('ดีมานด์ฉุกเฉิน = ดีมานด์ EMDB (รวม ELP) ไม่รวมโหลดปกติ', () => {
  const r = hospital(), g = r.service.generator;
  near(g.demandKVA, board(r, 'EMDB').demand / 1000, 1e-9);
  assert(g.demandKVA < r.totals.demand / 1000, 'ต้องน้อยกว่าดีมานด์ทั้งอาคาร');
});
test('ปั๊มดับเพลิง 30 kW Y-Δ: kVA เริ่มเดิน = 2 × Im × √3 × 400 (Im ตาราง 8.2)', () => {
  const g = hospital().service.generator;
  const im = D.MOTOR_3P.find((m) => m[0] === 30)[1];
  assert(/Fire pump/.test(g.bigMotor.desc) && g.bigMotor.kind === 'YD', JSON.stringify(g.bigMotor));
  near(g.startKVA, D.GEN.start.YD * im * SQ3 * 400 / 1000, 1e-6);
});
test('ปั๊มดับเพลิงเดียวกันแบบ DOL → kVA เริ่มเดิน 3 เท่า และเครื่องใหญ่ขึ้น', () => {
  const yd = hospital().service.generator;
  const r = calc({ meta: { buildingType: 'hospital' }, panels: [P('MDB', 'MDB', null), P('EMDB', 'SDB', 'MDB', { emergency: true })], items: [I('EMDB', { type: 'motor', kw: 30, start: 'DOL' }), I('EMDB', { type: 'lift', preset: 2 })] });
  const dol = r.service.generator;
  near(dol.startKVA, yd.startKVA * 3, 1e-6);
  assert(dol.kva > yd.kva, `DOL ${dol.kva} kVA vs Y-Δ ${yd.kva} kVA`);
});
test('เครื่องกำเนิดฯ ≥ ดีมานด์ / 0.8 และ ≥ (โหลดอื่น + kVA เริ่มเดิน) และ ≥ เกณฑ์แรงดันตก', () => {
  const g = hospital().service.generator, G = D.GEN;
  assert(g.kva >= g.demandKVA / G.loading - 1e-9, `${g.kva} < ${g.demandKVA}/0.8`);
  assert(g.kva >= g.demandKVA - g.bigMotor.runKVA + g.startKVA - 1e-9, 'เกณฑ์เริ่มเดิน');
  assert(g.kva >= g.startKVA * G.xd * (1 - G.dip) / G.dip - 1e-9, 'เกณฑ์แรงดันตก');
  near(g.criteria.load, g.demandKVA / G.loading, 1e-9);
});
test('เครื่องกำเนิดฯ เป็นขนาดมาตรฐานตัวเล็กสุดที่พอ', () => {
  const g = hospital().service.generator;
  assert(D.GEN_KVA.includes(g.kva), String(g.kva));
  eq(g.kva, D.GEN_KVA.find((k) => k >= g.need - 1e-9));
  near(g.need, Math.max(g.criteria.load, g.criteria.start, g.criteria.dip), 1e-9);
});
test('เผื่อโหลดในอนาคต meta.growth ใช้กับเครื่องกำเนิดฯ', () => {
  const g0 = hospital().service.generator, g = hospital({ meta: { growth: 50 } }).service.generator;
  near(g.need, g0.need * 1.5, 1e-6);
  assert(g.kva >= g0.kva && g.steps.some((s) => /50%/.test(s.f)));
});
test('ATS ≥ 1.25 × I ฉุกเฉิน, 4 ขั้ว, ขนาดมาตรฐานตัวเล็กสุดที่พอ', () => {
  const g = hospital().service.generator;
  near(g.I, g.demandKVA * 1000 / (SQ3 * 400), 1e-6);
  assert(g.ats.at >= 1.25 * g.I && g.ats.poles === 4 && D.ATS_AT.includes(g.ats.at), JSON.stringify(g.ats));
  eq(g.ats.at, D.ATS_AT.find((a) => a >= 1.25 * g.I));
});
test('CB ขาออกเครื่องกำเนิดฯ ≥ กระแสพิกัดเครื่อง', () => {
  const g = hospital().service.generator;
  near(g.Ig, g.kva * 1000 / (SQ3 * 400), 1e-6);
  assert(g.cb.at >= g.Ig && g.cb.ic > 0, JSON.stringify(g.cb));
});
test('steps มีสูตรครบ: โหลดฉุกเฉิน, ATS, 3 เกณฑ์, เลือกขนาด, CB', () => {
  const t = hospital().service.generator.steps.map((s) => s.t).join('|');
  ['โหลดฉุกเฉิน', 'ATS', 'เกณฑ์ 1', 'เกณฑ์ 2', 'เกณฑ์ 3', 'เลือกเครื่องกำเนิดไฟฟ้า', 'CB ขาออก'].forEach((k) => assert(t.includes(k), k + ' ไม่อยู่ใน ' + t));
  assert(hospital().service.generator.steps.every((s) => typeof s.f === 'string' && !/NaN|undefined/.test(s.f)));
});
test('BOM: เครื่องกำเนิดฯ + ATS + CB ขาออก', () => {
  const r = hospital(), g = r.service.generator;
  assert(r.bom.equipment.some((e) => e.label.includes(`${g.kva} kVA`)) && r.bom.equipment.some((e) => e.label === g.ats.label), JSON.stringify(r.bom.equipment));
  assert(r.bom.breakers.some((b) => b.label.includes(g.cb.label)), 'ไม่มี CB เครื่องกำเนิดฯ ใน BOM');
});

/* ---------- กรณีขอบ ---------- */
test('แผงฉุกเฉินซ้อนกัน (ELP ฉุกเฉินใต้ EMDB ฉุกเฉิน) → ไม่นับซ้ำ', () => {
  const a = hospital().service.generator;
  const r = calc({ meta: { buildingType: 'hospital', supply: 'transformer' }, panels: [P('MDB', 'MDB', null), P('EMDB', 'SDB', 'MDB', { emergency: true }), P('ELP', 'LP', 'EMDB', { emergency: true }), P('LP1', 'LP', 'MDB')],
    items: [I('EMDB', { type: 'motor', kw: 30, start: 'YD', name: 'Fire pump' }), I('EMDB', { type: 'lift', preset: 2 }), I('ELP', { type: 'light', lamp: LED, fixtures: 120 }), I('ELP', { type: 'rec', points: 30 }),
      I('LP1', { type: 'light', lamp: LED, fixtures: 200 }), I('LP1', { type: 'rec', points: 60 }), I('MDB', { type: 'chiller', cooling: 'air', preset: 3 })] });
  const g = r.service.generator;
  near(g.demandKVA, a.demandKVA, 1e-9); eq(g.panels.length, 1);
});
test('2 แผงฉุกเฉินแยกกัน → ATS แยกแต่ละแผง + ATS รวมจากดีมานด์รวม', () => {
  const r = calc({ meta: { buildingType: 'hotel' }, panels: [P('MDB', 'MDB', null), P('E1', 'LP', 'MDB', { emergency: true }), P('E2', 'LP', 'MDB', { emergency: true })],
    items: [I('E1', { type: 'light', lamp: LED, fixtures: 80 }), I('E2', { type: 'rec', points: 40 })] });
  const g = r.service.generator;
  eq(g.panels.length, 2);
  near(g.demandKVA, (board(r, 'E1').demand + board(r, 'E2').demand) / 1000, 1e-9);
  g.panels.forEach((p) => assert(p.ats.at >= 1.25 * p.I, JSON.stringify(p.ats)));
  eq(r.bom.equipment.filter((e) => /^ATS/.test(e.label)).reduce((s, e) => s + e.qty, 0), 2);
  assert(!r.warnings.some((w) => /ยังไม่ได้ตั้งแผงใดเป็น/.test(w)), 'มีแผงฉุกเฉินแล้วไม่ต้องเตือน');
});
test('ไม่มีมอเตอร์ → kVA = ดีมานด์/0.8 ปัดขึ้นขนาดมาตรฐาน (ขั้นต่ำ 20 kVA)', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null), P('E1', 'LP', 'MDB', { emergency: true })], items: [I('E1', { type: 'light', lamp: LED, fixtures: 20 })] });
  const g = r.service.generator;
  eq(g.startKVA, 0); eq(g.kva, D.GEN_KVA[0]);
});
test('แผงฉุกเฉิน 1 เฟส → ATS 2 ขั้ว ที่ 230 V', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null), P('E1', 'LP', 'MDB', { emergency: true, phases: 1 })], items: [I('E1', { type: 'light', lamp: LED, fixtures: 40 })] });
  const g = r.service.generator;
  near(g.I, g.demandKVA * 1000 / 230, 1e-6); eq(g.ats.poles, 2);
});
test('โหลดฉุกเฉินเกินตาราง → ใช้ขนาดสูงสุด + เตือนให้ขนานเครื่อง', () => {
  const r = calc({ meta: { supply: 'transformer' }, panels: [P('MDB', 'MDB', null, { emergency: true })], items: [I('MDB', { type: 'chiller', cooling: 'air', preset: D.CHILLER_AIR.length - 1, qty: 8 })] });
  const g = r.service.generator;
  assert(g.over && g.kva === D.GEN_KVA[D.GEN_KVA.length - 1] && r.warnings.some((w) => /ขนาน/.test(w)), g.kva + ' ' + r.warnings.join(' | '));
});
test('MDB ตั้งเป็นแผงฉุกเฉิน → ทั้งอาคารอยู่บนเครื่องกำเนิดฯ', () => {
  const r = calc({ panels: [P('MDB', 'MDB', null, { emergency: true }), P('LP1', 'LP', 'MDB')], items: [I('LP1', { type: 'light', lamp: LED, fixtures: 50 }), I('MDB', { type: 'motor', kw: 7.5 })] });
  near(r.service.generator.demandKVA, r.totals.demand / 1000, 1e-9);
});

/* ---------- ข้อมูลเข้า: sanitize / normalizeProject ---------- */
test('sanitize: เก็บ panel.emergency เป็น boolean', () => {
  const p = S.project({ meta: {}, panels: [{ id: 'MDB', kind: 'MDB' }, { id: 'E', kind: 'SDB', parent: 'MDB', emergency: 'true' }, { id: 'L', kind: 'LP', parent: 'MDB', emergency: 'x' }], items: [] }).project;
  eq(p.panels.find((x) => x.id === 'E').emergency, true);
  eq(p.panels.find((x) => x.id === 'L').emergency, false);
  assert(!('emergency' in p.panels.find((x) => x.id === 'MDB')), 'ไม่ใส่ฟิลด์ถ้าไม่มีในข้อมูลเข้า');
});
test('normalizeProject: emergency เป็น boolean, แผงที่ไม่ระบุไม่เติมฟิลด์', () => {
  const p = E.normalizeProject({ panels: [{ id: 'MDB', kind: 'MDB' }, { id: 'E', kind: 'SDB', parent: 'MDB', emergency: 1 }, { id: 'L', kind: 'LP', parent: 'MDB' }], items: [] }).project;
  eq(p.panels.find((x) => x.id === 'E').emergency, true);
  assert(!('emergency' in p.panels.find((x) => x.id === 'L')));
});

done();
