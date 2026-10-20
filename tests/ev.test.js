// ที่ชาร์จรถไฟฟ้า (EV charger) — ชนิดอุปกรณ์ 'ev': รุ่นมาตรฐาน D.EV_CHARGERS + kW กำหนดเอง
// ตรวจ: CB ≥ 1.25 × I (โหลดต่อเนื่อง), RCD 30 mA เสมอ, เฟส, สายรับกระแส ≥ CB, ดีมานด์ 100%, 1 เครื่อง/วงจร, sanitize, importer
const { E, D, proj, P, I } = require('./helpers/build.js');
const { test, assert, eq, near, done } = require('./helpers/eng-harness.js');
const S = require('../public/js/sanitize.js');
const IM = require('../public/js/importer.js');

const calc = (items, extra) => E.calculate(proj(Object.assign({ meta: { supply: 'transformer', buildingType: 'residential' }, panels: [P('MDB', 'MDB', null)], items: items.map((o) => I('MDB', o)) }, extra || {})));
const evCircuits = (r) => r.panels.find((b) => b.id === 'MDB').circuits.filter((c) => c.cat === 'ev');

// [preset, kW, เฟส, A, CB ที่คาด]
const PRESETS = [[0, 7.4, 1, 32, 40], [1, 11, 3, 16, 20], [2, 22, 3, 32, 40]];

test('EV ตาราง D.EV_CHARGERS มี 3 รุ่น 7.4 / 11 / 22 kW', () => eq(D.EV_CHARGERS.map((e) => [e[0], e[1], e[2]]), [[7.4, 1, 32], [11, 3, 16], [22, 3, 32]]));

for (const [preset, kw, ph, amp, cbWant] of PRESETS) {
  const r = calc([{ type: 'ev', preset }]);
  const cs = evCircuits(r);
  const c = cs[0];
  test(`EV ${kw} kW: 1 วงจร ${ph} เฟส I = ${amp} A`, () => { eq(cs.length, 1); eq(c.phases, ph); near(c.I, amp, 0.01); });
  test(`EV ${kw} kW: CB ${cbWant} A (≥ 1.25 × ${amp} A)`, () => { eq(c.cb.at, cbWant); assert(c.cb.at >= 1.25 * c.I - 1e-9, `CB ${c.cb.at} < 1.25I`); eq(c.cb.poles, ph === 3 ? 3 : 1); });
  test(`EV ${kw} kW: RCD 30 mA + หมายเหตุ Type A 6 mA DC / Type B`, () => {
    assert(c.cb.rcd === true, 'ไม่มี RCD');
    const st = c.steps.find((s) => s.t === 'เครื่องตัดไฟรั่ว');
    assert(st && /30 mA/.test(st.f) && /Type A \+ 6 mA DC detection or Type B/.test(st.f), st ? st.f : 'ไม่มีขั้นตอน RCD');
  });
  test(`EV ${kw} kW: สายรับกระแส ≥ CB`, () => { assert(c.cond && c.cond.amp >= c.cb.at, `สาย ${c.cond && c.cond.amp} A < CB ${c.cb.at} A`); });
  test(`EV ${kw} kW: ดีมานด์ 100%`, () => {
    const d = r.panels.find((b) => b.id === 'MDB').demandLocal.cats.ev;
    assert(d, 'ไม่มีหมวด ev ในดีมานด์');
    near(d.df, 1, 1e-9); near(d.demand, d.connected, 1e-6);
  });
}

test('EV จำนวน 4 เครื่อง = 4 วงจรเฉพาะ และดีมานด์ 100% (ไม่มีตัวคูณ)', () => {
  const r = calc([{ type: 'ev', preset: 2, qty: 4 }]);
  const cs = evCircuits(r);
  eq(cs.length, 4);
  const d = r.panels.find((b) => b.id === 'MDB').demandLocal.cats.ev;
  near(d.demand, cs.reduce((s, c) => s + c.va, 0), 1e-6);
});

test('EV kW กำหนดเอง 50 kW → 3 เฟส อัตโนมัติ, CB ≥ 1.25I, RCD', () => {
  const c = evCircuits(calc([{ type: 'ev', kw: 50 }]))[0];
  eq(c.phases, 3); near(c.va, 50000, 1e-6);
  assert(c.cb.at >= 1.25 * c.I && c.cb.rcd && c.cond.amp >= c.cb.at, JSON.stringify([c.cb.at, c.I, c.cond.amp]));
});
test('EV kW กำหนดเอง 3.7 kW → 1 เฟส อัตโนมัติ; ระบุ phases = 3 ได้', () => {
  eq(evCircuits(calc([{ type: 'ev', kw: 3.7 }]))[0].phases, 1);
  eq(evCircuits(calc([{ type: 'ev', kw: 7, phases: 3 }]))[0].phases, 3);
});
test('EV preset นอกช่วง → ใช้รุ่นสุดท้าย + แจ้งเตือน', () => {
  const r = calc([{ type: 'ev', preset: 9 }]);
  near(evCircuits(r)[0].I, 32, 0.01); eq(evCircuits(r)[0].phases, 3);
  assert(r.warnings.some((w) => /ที่ชาร์จรถไฟฟ้า/.test(w)), r.warnings.join(' | '));
});

test('sanitize: รับชนิด ev + preset/kw ว่าง', () => {
  const r = S.project({ meta: {}, panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3 }], items: [
    { id: 'a', panelId: 'MDB', type: 'ev', preset: 2, kw: '', qty: 2 }, { id: 'b', panelId: 'MDB', type: 'ev', kw: 30, phases: 3 }, { id: 'c', panelId: 'MDB', type: 'ev', preset: 99 }] });
  const it = r.project.items;
  eq(it.length, 3); eq([it[0].type, it[0].preset, it[0].kw], ['ev', 2, '']); eq([it[1].kw, it[1].phases], [30, 3]); eq(it[2].preset, D.EV_CHARGERS.length - 1);
});

const imp = (s) => { const r = IM.parseText(s); return (r.rows || [])[0]; };
test('importer: "EV charger 7.4 kW" → ev รุ่น 7.4 kW', () => { const r = imp('EV charger 7.4 kW'); eq([r.type, r.preset, r.kw], ['ev', 0, '']); });
test('importer: "ที่ชาร์จรถไฟฟ้า" → ev (ไม่ใช่โคมไฟ)', () => { eq(IM.classify('ที่ชาร์จรถไฟฟ้า'), 'ev'); eq(imp('ที่ชาร์จรถไฟฟ้า').type, 'ev'); });
test('importer: "Wallbox 22kW" → ev รุ่น 22 kW', () => { const r = imp('Wallbox 22kW'); eq([r.type, r.preset], ['ev', 2]); });
test('importer: "EV charger 11 kW 3 เฟส x 4" → 4 เครื่อง รุ่น 11 kW', () => { const r = imp('ลานจอดรถ: EV charger 11 kW 3 เฟส x 4'); eq([r.type, r.preset, r.qty], ['ev', 1, 4]); });
test('importer: EV kW นอกรุ่นมาตรฐาน → kW กำหนดเอง', () => { const r = imp('EV charger 50 kW'); eq([r.type, r.kw, r.phases], ['ev', 50, 3]); });
test('importer: rowToItem → engine ได้วงจร ev', () => {
  const it = IM.rowToItem(imp('Wallbox 22kW'), 'MDB');
  const c = evCircuits(calc([it]))[0];
  assert(c && c.cb.at === 40 && c.cb.rcd, JSON.stringify(it));
});

done();
