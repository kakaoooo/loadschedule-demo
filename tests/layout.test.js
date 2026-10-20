// ทดสอบการจัดวงจรลงช่องเบรกเกอร์ (Part A): ลำดับเฟส A-B-C-A-B-C, Spare ท้ายสุด, สมดุลเฟสแบบ auto/deep, สัญญาข้อมูลที่ UI ใช้
// รัน: node tests/layout.test.js
const { test, assert, eq, near, done } = require('./helpers/eng-harness');
const { E, proj, P, I, gen, rng, clone } = require('./helpers/build');

const cust = (va, extra) => I('LP1', Object.assign({ type: 'custom', va, phases: 1, continuous: false }, extra || {}));
function runLP(items, o) {
  o = o || {};
  const p = proj({ meta: o.meta, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', o.panel || {})], items });
  const r = E.calculate(p);
  return { r, po: r.panels.find((x) => x.id === 'LP1'), p };
}
const nosOf = (po) => po.circuits.map((c) => c.slotNos);
const isLive = (c) => c && c.cat !== 'spare' && !c.auto;
const unb = (v) => { const a = (v[0] + v[1] + v[2]) / 3; return a ? Math.max(...v.map((x) => Math.abs(x - a))) / a * 100 : 0; };

/* ---------------------------------------------------------------- A1: helper + ค่าเริ่มต้น */
test('A1 slotPhase seq: i % 3', () => {
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => E.slotPhase(i, 'seq', true)), [0, 1, 2, 0, 1, 2, 0, 1, 2]);
});
test('A1 slotPhase pair: floor(i/2) % 3', () => {
  eq([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => E.slotPhase(i, 'pair', true)), [0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2, 0]);
});
test('A1 slotPhase 1 เฟส = 0 ทุกช่อง / pattern แปลก = seq', () => {
  eq([0, 1, 2, 3, 4, 5].map((i) => E.slotPhase(i, 'seq', false)), [0, 0, 0, 0, 0, 0]);
  eq([0, 1, 2, 3, 4, 5].map((i) => E.slotPhase(i, 'pair', false)), [0, 0, 0, 0, 0, 0]);
  eq([0, 1, 2, 3].map((i) => E.slotPhase(i, 'xyz', true)), [0, 1, 2, 0]);
});
test('A1 defaultMeta().phasePattern = seq และโครงการที่ไม่มีคีย์นี้ก็เป็น seq', () => {
  eq(E.defaultMeta().phasePattern, 'seq');
  const { r, po } = runLP([cust(1000), cust(1000)], {});
  delete r.meta.phasePattern;
  const p2 = proj({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [cust(1000), cust(1000)] });
  delete p2.meta.phasePattern;
  const po2 = E.calculate(p2).panels.find((x) => x.id === 'LP1');
  eq(po2.layout.pattern, 'seq');
  eq(po.layout.pattern, 'seq');
});

/* ---------------------------------------------------------------- A3: วงจร 1 เฟสเรียงเลข A-B-C */
test('A3 seq: 7 วงจรเท่ากัน -> เลข 1..7 ติดกัน เฟส A B C A B C A, ไม่แยกฝั่งตามหมวด', () => {
  const { po } = runLP([1, 2, 3, 4, 5, 6, 7].map(() => cust(1000)));
  eq(nosOf(po), [[1], [2], [3], [4], [5], [6], [7]]);
  eq(po.circuits.map((c) => c.phase), [0, 1, 2, 0, 1, 2, 0]);
  eq(po.layout.slotPhase.slice(0, 7), [0, 1, 2, 0, 1, 2, 0]);
  eq(po.layout.slotPhase.length, po.layout.ways);
  eq(po.layout.pattern, 'seq');
  eq(po.phaseVA, [3000, 2000, 2000]);
});
test('A3 seq: ไม่มีการจัดฝั่งตามหมวด (แสงสว่างอยู่หน้า เต้ารับตามหลัง เรียงเลขขึ้น ไม่เว้นช่อง)', () => {
  const items = [I('LP1', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 60, circuits: 3 }), I('LP1', { type: 'rec', points: 30, perCircuit: 10 }), I('LP1', { type: 'ac', btu: 12000, qty: 3 })];
  const { po } = runLP(items);
  const nums = po.circuits.map((c) => c.slotNos[0]).sort((a, b) => a - b);
  eq(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // ในแต่ละเฟส เรียงตามเลขวงจรแล้วหมวดต้องไม่ย้อนกลับ (light < rec < ac)
  const ord = { light: 0, other: 1, heater: 2, cook: 3, rec: 4, ac: 5, motor: 6, lift: 7, esc: 7, chiller: 7 };
  for (const ph of [0, 1, 2]) {
    const seq = po.circuits.filter((c) => c.phase === ph).sort((a, b) => a.slotNos[0] - b.slotNos[0]).map((c) => ord[c.cat]);
    eq(seq, seq.slice().sort((a, b) => a - b), `เฟส ${ph}`);
  }
});
test('A3 seq: จำนวนวงจรต่อเฟสต่างกันไม่เกิน 1 แม้ VA ต่างกันมาก (VA สมดุลด้วยการเลือกเฟสให้วงจร)', () => {
  const { po } = runLP([9000, 100, 100, 100, 100, 100, 100].map((v) => cust(v)));
  const cnt = [0, 0, 0]; po.circuits.forEach((c) => cnt[c.phase]++);
  assert(Math.max(...cnt) - Math.min(...cnt) <= 1, `cnt ${cnt}`);
  eq(nosOf(po).map((n) => n[0]).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
});
test('A3 seq: วงจร Spare จาก item (cat spare) อยู่หลังวงจรใช้งานทั้งหมด และต่อลำดับ A-B-C', () => {
  const items = [1, 2, 3, 4, 5].map(() => cust(1000)).concat([I('LP1', { type: 'spare', cb: 16, qty: 2 })]);
  const { po } = runLP(items, { panel: { spareCount: 0 } });
  const live = po.circuits.filter((c) => c.cat !== 'spare').map((c) => c.slotNos[0]).sort((a, b) => a - b);
  const sp = po.circuits.filter((c) => c.cat === 'spare');
  eq(live, [1, 2, 3, 4, 5]);
  eq(sp.map((c) => c.slotNos[0]), [6, 7]);
  eq(sp.map((c) => c.phase), [2, 0]);
});
test('A3 seq: Spare อัตโนมัติ — เติมช่องว่างของ "สามชุดสุดท้ายที่ไม่เต็ม" ก่อน แล้วต่อด้วยเลขถัดไป (7 วงจร + 3 spare = 8,9,10)', () => {
  const { po } = runLP([1, 2, 3, 4, 5, 6, 7].map(() => cust(1000)), { panel: { spareCount: 3 } });
  const autos = po.layout.slots.map((s, i) => (s && s.auto ? i + 1 : 0)).filter(Boolean);
  eq(autos, [8, 9, 10]);
  eq(po.layout.slots.filter((s) => s && s.auto).map((s) => s.phase), [1, 2, 0]);
  assert(po.layout.slots.filter((s) => s && s.auto).every((s) => s.auto === true && s.cat === 'spare' && s.slotNos.length === 1));
});
test('A3 seq: Spare อัตโนมัติ 1 ตัว วางในช่องว่างเฟสที่เบาที่สุดของสามชุดสุดท้ายที่ไม่เต็ม', () => {
  // 7 วงจร: เลข 1..7 -> เฟส A B C A B C A ; ช่องว่างของสามชุดสุดท้าย = เลข 8 (B), 9 (C)
  const { po } = runLP([4000, 3000, 2000, 1500, 1200, 1000, 800].map((v) => cust(v)), { panel: { spareCount: 1 } });
  const auto = po.layout.slots.map((s, i) => (s && s.auto ? i + 1 : 0)).filter(Boolean);
  eq(auto.length, 1);
  assert(auto[0] === 8 || auto[0] === 9, `spare อยู่เลข ${auto[0]}`);
  const gapPh = [1, 2]; // เฟสของเลข 8, 9
  const lightest = gapPh.slice().sort((a, b) => po.phaseVA[a] - po.phaseVA[b] || a - b)[0];
  eq(po.layout.slotPhase[auto[0] - 1], lightest, 'ต้องอยู่เฟสที่เบากว่า');
});
test('A3 seq: แผง 1 เฟส เรียงเลขต่อกัน เฟสเป็น 0 ทุกช่อง Spare ท้ายสุด', () => {
  const { po } = runLP([1, 2, 3, 4, 5].map(() => cust(1000)), { panel: { phases: 1, spareCount: 2 } });
  eq(po.circuits.map((c) => c.slotNos[0]).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert(po.circuits.every((c) => c.phase === 0));
  assert(po.layout.slotPhase.every((x) => x === 0));
  eq(po.layout.slots.map((s, i) => (s && s.auto ? i + 1 : 0)).filter(Boolean), [6, 7]);
  eq(po.phaseVA, [5000, 0, 0]);
  eq(po.balance, null);
});

/* ---------------------------------------------------------------- A2: วงจร 3 เฟส */
test('A2 seq: 3P วางก่อนบนช่องฝั่งเดียวกันห่างกัน 2 (1-3-5) และ 1P เติมช่องที่เหลือต่อเนื่อง', () => {
  const items = [I('LP1', { type: 'motor', kw: 5.5, phases: 3 })].concat([1, 2, 3, 4].map(() => cust(1000)));
  const { po } = runLP(items);
  const m = po.circuits.find((c) => c.phases === 3);
  eq(m.slotNos, [1, 3, 5]);
  eq(m.slotNos.map((n) => po.layout.slotPhase[n - 1]).sort(), [0, 1, 2]);
  eq(po.circuits.filter((c) => c.phases !== 3).map((c) => c.slotNos[0]).sort((a, b) => a - b), [2, 4, 6, 7]);
});
test('A2 seq: 3P สองวงจร = 1-3-5 และ 2-4-6; สามวงจร = ... และ 7-9-11', () => {
  const m = (kw) => I('LP1', { type: 'motor', kw, phases: 3 });
  // วงจรที่ VA มากกว่าได้ช่องก่อน (เรียงตามหมวดแล้ว VA มากไปน้อย)
  const first = (po) => po.circuits.map((c) => c.slotNos).sort((a, b) => a[0] - b[0]);
  eq(first(runLP([m(5.5), m(7.5)]).po), [[1, 3, 5], [2, 4, 6]]);
  const three = runLP([m(5.5), m(7.5), m(11)]).po;
  eq(first(three), [[1, 3, 5], [2, 4, 6], [7, 9, 11]]);
  eq(three.circuits.find((c) => c.motor.kw === 11).slotNos, [1, 3, 5]);
});
test('A2 pair: 3P คงเป็นกลุ่มแถวต่อเนื่อง (1-3-5 / 2-4-6 ตามเดิม)', () => {
  const po = runLP([I('LP1', { type: 'motor', kw: 5.5, phases: 3 })], { meta: { phasePattern: 'pair' } }).po;
  const n = po.circuits[0].slotNos;
  eq([n[1] - n[0], n[2] - n[1]], [2, 2]);
  eq(n.map((x) => po.layout.slotPhase[x - 1]).sort(), [0, 1, 2]);
  eq(po.layout.pattern, 'pair');
});

/* ---------------------------------------------------------------- pair: ยังคงพฤติกรรมเดิม */
test('pair: เฟสของช่อง = floor(i/2)%3 และแสงสว่างอยู่เลขคี่ (ฝั่งซ้าย) เหมือนเดิม', () => {
  const items = [I('LP1', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 60, circuits: 3 }), I('LP1', { type: 'rec', points: 30, perCircuit: 10 })];
  const { po } = runLP(items, { meta: { phasePattern: 'pair' } });
  for (const c of po.circuits) {
    const n = c.slotNos[0];
    eq(po.layout.slotPhase[n - 1], Math.floor((n - 1) / 2) % 3);
    eq(c.phase, Math.floor((n - 1) / 2) % 3);
    if (c.cat === 'light') assert(n % 2 === 1, `light เลข ${n}`);
    if (c.cat === 'rec') assert(n % 2 === 0, `rec เลข ${n}`);
  }
});

/* ---------------------------------------------------------------- A5: สัญญาข้อมูล */
test('A5 po.balance: แผง 3 เฟส ≥ 2 วงจร 1 เฟส มี {mode, unbalance, autoUnbalance, deepUnbalance}; อื่น ๆ เป็น null', () => {
  const a = runLP([1, 2, 3, 4].map((i) => cust(800 * i))).po;
  eq(Object.keys(a.balance).sort(), ['autoUnbalance', 'deepUnbalance', 'mode', 'unbalance']);
  eq(a.balance.mode, 'auto');
  near(a.balance.unbalance, a.unbalance, 1e-9);
  near(a.balance.autoUnbalance, a.unbalance, 1e-9);
  assert(a.balance.deepUnbalance <= a.balance.autoUnbalance + 1e-9);
  eq(runLP([cust(1000)]).po.balance, null, 'มีวงจร 1 เฟสเพียง 1 วงจร');
  eq(runLP([]).po.balance, null, 'ไม่มีวงจร');
  eq(runLP([cust(1000), cust(2000)], { panel: { phases: 1 } }).po.balance, null, 'แผง 1 เฟส');
  const sdb = E.calculate(proj({ panels: [P('MDB', 'MDB', null)], items: [I('MDB', { type: 'custom', va: 1000, phases: 1 }), I('MDB', { type: 'custom', va: 2000, phases: 1 })] }));
  eq(sdb.panels[0].balance, null, 'ไม่ใช่แผง LP');
});
test('A5 board.balance = "deep" -> mode deep, unbalance = deepUnbalance ≤ autoUnbalance', () => {
  const items = [1500, 3500, 1000, 1000, 3500].map((v) => cust(v));
  const d = runLP(items, { panel: { balance: 'deep' } }).po;
  const a = runLP(items, {}).po;
  eq(d.balance.mode, 'deep');
  near(d.balance.unbalance, d.balance.deepUnbalance, 1e-9);
  near(d.unbalance, d.balance.deepUnbalance, 1e-9);
  near(d.balance.autoUnbalance, a.balance.autoUnbalance, 1e-9, 'autoUnbalance ต้องเท่ากันไม่ว่าเลือกโหมดไหน');
  assert(d.unbalance <= a.unbalance + 1e-9);
});
test('A5 c.phase ครบทุกวงจร 1 เฟสที่วางแล้ว และ c.slotNos ครบทุกวงจร', () => {
  const items = [I('LP1', { type: 'motor', kw: 5.5, phases: 3 }), cust(1000), cust(2000), I('LP1', { type: 'spare', cb: 16 })];
  const po = runLP(items).po;
  for (const c of po.circuits) {
    assert(Array.isArray(c.slotNos) && c.slotNos.length === (c.phases === 3 ? 3 : 1), 'slotNos');
    if (c.phases !== 3) assert([0, 1, 2].includes(c.phase), 'phase');
  }
});
test('A5 c.share: light=fixtures, rec=points, อื่น ๆ = qty 1; ผลรวมกลับเท่าจำนวนใน item', () => {
  const items = [
    I('LP1', { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 61 }), I('LP1', { type: 'rec', points: 37, perCircuit: 10 }),
    I('LP1', { type: 'ac', btu: 12000, qty: 3 }), I('LP1', { type: 'heater', qty: 2 }), I('LP1', { type: 'cook', qty: 2 }),
    I('LP1', { type: 'motor', kw: 5.5, phases: 3, qty: 2 }), I('LP1', { type: 'custom', va: 500, qty: 4 }), I('LP1', { type: 'spare', qty: 3 }),
    I('LP1', { type: 'lift', preset: 1, qty: 2 }), I('LP1', { type: 'esc', preset: 1, qty: 1 }), I('LP1', { type: 'chiller', preset: 2, qty: 1 })
  ];
  const po = runLP(items, { panel: { ways: 42 } }).po;
  const byItem = {};
  po.circuits.forEach((c) => { (byItem[c.itemId] = byItem[c.itemId] || []).push(c); });
  for (const it of items) {
    const cs = byItem[it.id];
    const field = it.type === 'light' ? 'fixtures' : it.type === 'rec' ? 'points' : 'qty';
    assert(cs.every((c) => c.share && c.share.field === field), `${it.type} field`);
    const want = it.type === 'light' ? it.fixtures : it.type === 'rec' ? it.points : it.qty;
    eq(cs.reduce((s, c) => s + c.share.n, 0), want, it.type);
    if (field === 'qty') assert(cs.every((c) => c.share.n === 1), `${it.type} n=1`);
    assert(cs.every((c) => c.itemId === it.id));
  }
});

/* ---------------------------------------------------------------- spareCount */
test('A5 board.spareCount: จำนวน Spare อัตโนมัติ = ค่านั้นพอดี (0, 1, 5) แม้มี spare item อยู่แล้ว', () => {
  const live = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => cust(1000));
  const nAuto = (po) => po.layout.slots.filter((s) => s && s.auto).length;
  for (const n of [0, 1, 5]) {
    eq(nAuto(runLP(live, { panel: { spareCount: n } }).po), n, `spareCount ${n}`);
    eq(nAuto(runLP(live.concat([I('LP1', { type: 'spare', qty: 2 })]), { panel: { spareCount: n } }).po), n, `spareCount ${n} + spare item`);
  }
});
test('A5 ไม่กำหนด spareCount -> สูตรเดิม max(1, round(ways × spareRatio)) − spare item', () => {
  const live = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => cust(1000));
  for (const ex of [0, 2]) {
    const items = live.concat(ex ? [I('LP1', { type: 'spare', qty: ex })] : []);
    const po = runLP(items).po;
    const n = po.layout.slots.filter((s) => s && s.auto).length;
    eq(n, Math.max(0, Math.max(1, Math.round(po.layout.ways * 0.15)) - ex));
  }
});
test('A5 spareCount เกินที่ใส่ได้ในแผงที่กำหนด ways -> ใส่เท่าที่ได้ + เตือน', () => {
  const live = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => cust(1000));
  const { po, r } = runLP(live, { panel: { ways: 12, spareCount: 5 } });
  eq(po.layout.slots.filter((s) => s && s.auto).length, 2);
  assert(r.warnings.some((w) => w.includes('LP1') && /Spare/i.test(w)), 'ต้องมีคำเตือน spare: ' + JSON.stringify(r.warnings.filter((w) => w.includes('LP1'))));
});

/* ---------------------------------------------------------------- A4: deep ต้องได้ค่าที่ดีที่สุดจริง */
function bruteBest(vas, card, base) {
  const n = vas.length, tot = vas.reduce((s, x) => s + x, 0) + base[0] + base[1] + base[2], avg = tot / 3;
  let best = Infinity; const cnt = [0, 0, 0], ld = base.slice();
  (function rec(i) {
    if (i === n) { const d = Math.max(...ld.map((v) => Math.abs(v - avg))); if (d < best) best = d; return; }
    for (let p = 0; p < 3; p++) { if (cnt[p] >= card[p]) continue; cnt[p]++; ld[p] += vas[i]; rec(i + 1); cnt[p]--; ld[p] -= vas[i]; }
  })(0);
  return avg ? best / avg * 100 : 0;
}
test('A4 deep (pair): ตัวอย่างเลวร้ายจากการตรวจสอบ [rec 1500, ac 3500, ac 1000, rec 1000, ac 3500] ได้ 0% (ค่าที่ดีที่สุดจริง)', () => {
  const mk = (va, cat) => I('LP1', { type: 'custom', va, cat, phases: 1, continuous: false });
  const items = [mk(1500, 'rec'), mk(3500, 'ac'), mk(1000, 'ac'), mk(1000, 'rec'), mk(3500, 'ac')];
  const d = runLP(items, { meta: { phasePattern: 'pair' }, panel: { balance: 'deep' } }).po;
  near(d.unbalance, 0, 1e-9);
  near(d.balance.deepUnbalance, 0, 1e-9);
  eq(d.phaseVA, [3500, 3500, 3500]);
  const a = runLP(items, { meta: { phasePattern: 'pair' } }).po;
  assert(a.balance.autoUnbalance >= d.balance.deepUnbalance - 1e-9);
});
test('A4 deep (seq): ตัวอย่างเดียวกัน = ค่าที่ดีที่สุดภายใต้กฎจำนวนวงจร/เฟสต่างกันไม่เกิน 1 (28.57%)', () => {
  const mk = (va, cat) => I('LP1', { type: 'custom', va, cat, phases: 1, continuous: false });
  const items = [mk(1500, 'rec'), mk(3500, 'ac'), mk(1000, 'ac'), mk(1000, 'rec'), mk(3500, 'ac')];
  const d = runLP(items, { panel: { balance: 'deep' } }).po;
  // เลข 1..5 -> เฟส A B C A B = จำนวน (2,2,1); ค่าที่ดีที่สุด: C = 3500, A/B = {3500,1000},{1500,1000} -> 4500/2500/3500
  near(d.unbalance, 1000 / 3500 * 100, 1e-6);
  near(bruteBest([1500, 3500, 1000, 1000, 3500], [2, 2, 1], [0, 0, 0]), 1000 / 3500 * 100, 1e-6);
});
test('A4 deep = ค่าที่ดีที่สุดจริง (brute force) ทั้ง seq และ pair บนชุดสุ่ม 60 ชุด (วงจร 4-10)', () => {
  const R = rng(4242);
  const vaSet = [300, 500, 800, 1000, 1200, 1500, 2000, 2500, 3500, 5000, 7000];
  for (let t = 0; t < 60; t++) {
    const n = 4 + Math.floor(R() * 7);
    const vas = Array.from({ length: n }, () => vaSet[Math.floor(R() * vaSet.length)]);
    const items = vas.map((v) => cust(v));
    const seq = runLP(items, { panel: { balance: 'deep', spareCount: 0 } }).po;
    const card = [0, 1, 2].map((p) => seq.layout.slotPhase.slice(0, n).filter((x) => x === p).length);
    near(seq.unbalance, bruteBest(vas, card, [0, 0, 0]), 1e-6, `seq t=${t} ${vas}`);
    const pair = runLP(items, { meta: { phasePattern: 'pair' }, panel: { balance: 'deep', spareCount: 0 } }).po;
    const cap = pair.layout.ways / 3;
    near(pair.unbalance, bruteBest(vas, [cap, cap, cap], [0, 0, 0]), 1e-6, `pair t=${t} ${vas}`);
  }
});

/* ---------------------------------------------------------------- ชุดสุ่ม (seed คงที่) */
const SEEDS = Array.from({ length: 150 }, (_, i) => 500 + i);
function lpsOf(r) { return r.panels.filter((p) => p.isLP && p.layout && !p.layout.overflow && p.kids.length === 0); }
function randomProjects(pattern) {
  return SEEDS.map((s) => {
    const p = gen(s, { real: true, sane: true, minLP: 2, maxLP: 5, minItems: 2, maxItems: 14, ways: ['', '', '', 24, 42] });
    p.meta.phasePattern = pattern;
    return p;
  });
}
const seqProjects = randomProjects('seq');

test('A6 seq: เลขวงจร n ของวงจร 1 เฟสมีเฟส (n-1)%3 และ c.phase / layout.slotPhase ตรงกัน (แผง 3 เฟส); แผง 1 เฟสเป็น 0', () => {
  let nc = 0;
  for (const p of seqProjects) {
    const r = E.calculate(p);
    for (const po of lpsOf(r)) {
      const three = po.board.phases === 3;
      assert(po.layout.pattern === 'seq' && po.layout.slotPhase.length === po.layout.ways, `${po.id} layout contract`);
      po.layout.slotPhase.forEach((x, i) => assert(x === E.slotPhase(i, 'seq', three), `${po.id} slotPhase[${i}]`));
      for (const c of po.circuits) {
        if (c.phases === 3) continue;
        const n = c.slotNos[0]; nc++;
        assert(c.phase === (three ? (n - 1) % 3 : 0), `${po.id} เลข ${n}: phase ${c.phase}`);
        assert(po.layout.slotPhase[n - 1] === c.phase, `${po.id} slotPhase เลข ${n}`);
      }
      po.layout.slots.forEach((s, i) => { if (s && s.auto) assert(s.phase === E.slotPhase(i, 'seq', three) && s.slotNos[0] === i + 1, `${po.id} auto spare phase`); });
    }
  }
  return `${nc} วงจร`;
});
test('A6 seq: จำนวนวงจร 1 เฟสที่ใช้งานต่อเฟสต่างกันไม่เกิน 1', () => {
  for (const p of seqProjects) for (const po of lpsOf(E.calculate(p))) {
    if (po.board.phases !== 3) continue;
    const cnt = [0, 0, 0]; po.circuits.filter((c) => c.phases !== 3 && c.cat !== 'spare').forEach((c) => { assert([0, 1, 2].includes(c.phase), `${po.id}: c.phase ${c.phase}`); cnt[c.phase]++; });
    assert(Math.max(...cnt) - Math.min(...cnt) <= 1, `${po.id}: ${cnt}`);
  }
});
// กฎ: ช่อง 1..(เลขสูงสุดของวงจร 1 เฟสที่ใช้งาน) ต้องเป็นวงจรใช้งานทั้งหมด ไม่มี SPARE/SPACE แทรก
// ข้อยกเว้นเดียว (เลี่ยงไม่ได้): วงจร 3 เฟสกินช่อง n, n+2, n+4 จึงเหลือช่องคั่นกลาง (n+1, n+3) ถ้ามีวงจร 1 เฟสไม่พอจะเติม
//   -> ช่องว่างที่อยู่ "ภายในช่วง" ของวงจร 3 เฟสเหนือวงจร 1 เฟสทั้งหมดยอมให้เป็น SPACE ได้
test('A6 seq: ไม่มี SPARE/SPACE เลขต่ำกว่าวงจรใช้งานใด ๆ (ยกเว้นช่องคั่นภายในช่วงของวงจร 3 เฟส ซึ่งเลี่ยงไม่ได้)', () => {
  let n3sp = 0, nHole = 0;
  for (const p of seqProjects) for (const po of lpsOf(E.calculate(p))) {
    const live = po.circuits.filter(isLive);
    if (!live.length) continue;
    const top = Math.max(...live.map((c) => Math.max(...c.slotNos)));
    const top1 = Math.max(0, ...live.filter((c) => c.phases !== 3).map((c) => c.slotNos[0]));
    const spans = live.filter((c) => c.phases === 3).map((c) => [c.slotNos[0], c.slotNos[2]]);
    for (let n = 1; n <= top; n++) {
      const s = po.layout.slots[n - 1];
      const owner = s && (s.ref || s);
      if (owner && isLive(owner)) continue;
      const sp3Tight = owner && owner.cat === 'spare' && owner.phases === 3 && po.layout.slots.slice(top).every(Boolean); // แผงเต็มพอดี Spare 3 เฟสต้องสลับกับวงจรใช้งาน
      const inside3P = sp3Tight || (n > top1 && spans.some(([a, b]) => n > a && n < b));
      assert(inside3P, `${po.id}: เลข ${n} (ก่อนวงจรใช้งานเลข ${top}) เป็น ${owner ? (owner.auto ? 'auto spare' : owner.cat) : 'SPACE'}`);
      nHole++;
      // ช่องคั่นนี้เป็น SPACE ได้เสมอ ; จะเป็น Spare ได้ก็ต่อเมื่อท้ายแผงไม่มีช่องว่างเหลือแล้วเท่านั้น (เลี่ยงไม่ได้)
      if (owner) assert(po.layout.slots.slice(top).every(Boolean), `${po.id}: spare แทรกที่เลข ${n} ทั้งที่ท้ายแผงยังว่าง`);
    }
    if (po.circuits.some((c) => c.cat === 'spare' && c.phases === 3)) n3sp++;
  }
  return `ผ่านรวมถึง ${n3sp} แผงที่มี spare 3 เฟส, ช่องคั่นภายใน 3P ${nHole} ช่อง`;
});
test('A6 ผลรวม phaseVA = connected (ทุกแผงใน seq และ pair, รวมแผง 1 เฟส)', () => {
  for (const pat of ['seq', 'pair']) for (const p of seqProjects.slice(0, 80)) {
    const q = clone(p); q.meta.phasePattern = pat;
    const r = E.calculate(q);
    for (const po of r.panels) {
      if (po.id !== 'MDB' && !r.panels.some((x) => x.id === po.id)) continue;
      near(po.phaseVA[0] + po.phaseVA[1] + po.phaseVA[2], po.connected, 1e-6 * Math.max(1, po.connected), `${pat} ${po.id}`);
    }
  }
});
test('A6 วงจร 3 เฟส: ช่องฝั่งเดียวกัน ห่างกัน 2 และครบ 3 เฟสที่ต่างกัน (seq และ pair; pair เริ่มที่แถวชุดละ 3)', () => {
  let n3 = 0;
  for (const pat of ['seq', 'pair']) for (const p of seqProjects) {
    const q = clone(p); q.meta.phasePattern = pat;
    for (const po of lpsOf(E.calculate(q))) {
      for (const c of po.circuits.filter((x) => x.phases === 3)) {
        n3++;
        const i = c.slotNos.map((n) => n - 1);
        assert(i[1] === i[0] + 2 && i[2] === i[0] + 4, `${po.id}: ${c.slotNos}`);
        assert(i[0] % 2 === i[1] % 2 && i[1] % 2 === i[2] % 2, 'same side');
        eq(i.map((x) => po.layout.slotPhase[x]).sort(), [0, 1, 2], `${pat} ${po.id} ${c.slotNos}`);
        if (pat === 'pair') assert(Math.floor(i[0] / 2) % 3 === 0, 'pair row-aligned');
        assert(po.layout.slots[i[0]] === c && po.layout.slots[i[1]].ref === c && po.layout.slots[i[2]].ref === c, 'slot objects');
      }
    }
  }
  return `${n3} วงจร`;
});
test('A6 pair: เฟสของวงจร 1 เฟส = floor((n-1)/2)%3 และ c.phase ตรงกัน', () => {
  for (const p of seqProjects) {
    const q = clone(p); q.meta.phasePattern = 'pair';
    for (const po of lpsOf(E.calculate(q))) {
      const three = po.board.phases === 3;
      assert(po.layout.pattern === 'pair', 'pattern');
      for (const c of po.circuits) {
        if (c.phases === 3) continue;
        const n = c.slotNos[0];
        assert(c.phase === (three ? Math.floor((n - 1) / 2) % 3 : 0) && po.layout.slotPhase[n - 1] === c.phase, `${po.id} เลข ${n}`);
      }
    }
  }
});
test('A6 ผลซ้ำได้ (determinism) และไม่แก้ข้อมูลเข้า', () => {
  for (const p of seqProjects.slice(0, 60)) {
    const before = JSON.stringify(p);
    const a = JSON.stringify(E.calculate(p)), b = JSON.stringify(E.calculate(JSON.parse(before)));
    assert(JSON.stringify(p) === before, 'input mutated');
    assert(a === b, 'two runs differ');
  }
});
test('A6 deep ≤ auto ทุกชุดสุ่ม (seq และ pair) และ balance ตรงกับค่าของแผง', () => {
  let n = 0, better = 0;
  for (const pat of ['seq', 'pair']) for (const p of seqProjects) {
    const q = clone(p); q.meta.phasePattern = pat;
    const ra = E.calculate(q);
    const qd = clone(q); qd.panels.forEach((x) => { if (x.kind === 'LP') x.balance = 'deep'; });
    const rd = E.calculate(qd);
    for (const pa of lpsOf(ra)) {
      const pd = rd.panels.find((x) => x.id === pa.id);
      if (!pa.balance) { assert(pd.balance === null, 'balance null ต้องตรงกัน'); continue; }
      n++;
      assert(pa.balance.mode === 'auto' && pd.balance.mode === 'deep', 'mode');
      assert(pd.unbalance <= pa.unbalance + 1e-9, `${pat} ${pa.id}: deep ${pd.unbalance} > auto ${pa.unbalance}`);
      near(pa.balance.unbalance, pa.unbalance, 1e-9); near(pd.balance.unbalance, pd.unbalance, 1e-9);
      near(pd.balance.autoUnbalance, pa.balance.autoUnbalance, 1e-9, 'autoUnbalance คงที่');
      near(pa.balance.deepUnbalance, pd.balance.deepUnbalance, 1e-9, 'deepUnbalance คงที่');
      near(pd.unbalance, pd.balance.deepUnbalance, 1e-9);
      if (pd.unbalance < pa.unbalance - 1e-9) better++;
    }
  }
  return `${n} แผง (deep ดีกว่า auto ${better})`;
});
test('A6 pair: ถ้าย้ายวงจรเดียวทำให้ผ่านเกณฑ์ 20% ได้ ต้องไม่ทิ้งไว้เกิน 20% (auto มีการย้ายเดี่ยว)', () => {
  let checked = 0;
  for (const p of seqProjects) {
    const q = clone(p); q.meta.phasePattern = 'pair';
    for (const po of lpsOf(E.calculate(q))) {
      if (po.board.phases !== 3 || po.unbalance <= 20) continue;
      const L = po.layout;
      const free = [0, 1, 2].map((ph) => L.slots.filter((s, i) => !s && L.slotPhase[i] === ph).length);
      const avg = (po.phaseVA[0] + po.phaseVA[1] + po.phaseVA[2]) / 3;
      let best = po.unbalance;
      for (const c of po.circuits) {
        if (c.phases === 3) continue;
        for (let b = 0; b < 3; b++) { if (b === c.phase || !free[b]) continue; const v = po.phaseVA.slice(); v[c.phase] -= c.va; v[b] += c.va; best = Math.min(best, unb(v)); }
      }
      checked++;
      assert(best > 20 - 1e-9, `${po.id}: ${po.unbalance.toFixed(1)}% แต่ย้ายวงจรเดียวได้ ${best.toFixed(1)}%`);
    }
  }
  return `${checked} แผงที่เกิน 20%`;
});
test('A6 share: ผลรวม share.n ของแต่ละ item = จำนวนใน item (fixtures / points / qty)', () => {
  let nitems = 0;
  for (const p of seqProjects.slice(0, 80)) {
    const r = E.calculate(p);
    const byItem = {};
    r.panels.forEach((po) => po.circuits.forEach((c) => { (byItem[c.itemId] = byItem[c.itemId] || []).push(c); }));
    for (const it of p.items) {
      if (!r.panels.some((po) => po.id === it.panelId)) continue;
      const cs = byItem[it.id] || [];
      const field = it.type === 'light' ? 'fixtures' : it.type === 'rec' ? 'points' : 'qty';
      const want = it.type === 'light' ? Math.max(1, Math.round(Number(it.fixtures) || 1)) : it.type === 'rec' ? Math.max(1, Math.round(Number(it.points) || 1)) : Math.max(1, Math.round(Number(it.qty) || 1));
      assert(cs.length && cs.every((c) => c.share && c.share.field === field && c.share.n >= 1), `${it.type} ${it.id} share`);
      assert(cs.reduce((s, c) => s + c.share.n, 0) === want, `${it.type} ${it.id}: ${cs.map((c) => c.share.n)} vs ${want}`);
      nitems++;
    }
  }
  return `${nitems} items`;
});
test('A6 spareCount: ชุดสุ่มได้ Spare อัตโนมัติตามที่กำหนดพอดี (0, 1, 5) เมื่อแผงใหญ่พอ', () => {
  let n = 0;
  for (const pat of ['seq', 'pair']) for (const sc of [0, 1, 5]) for (const p of seqProjects.slice(0, 70)) {
    const q = clone(p); q.meta.phasePattern = pat; q.panels.forEach((x) => { if (x.kind === 'LP') { x.spareCount = sc; x.ways = ''; } });
    for (const po of lpsOf(E.calculate(q))) {
      const k = po.layout.slots.filter((s) => s && s.auto).length;
      const free = po.layout.ways - po.layout.slots.filter(Boolean).length + k;
      assert(k === Math.min(sc, free) && (k === sc || po.layout.ways === 42), `${po.id}: spareCount ${sc} ได้ ${k} (ways ${po.layout.ways})`);
      n++;
    }
  }
  return `${n} แผง`;
});
test('A6 ทุกวงจรของแผงที่ overflow มีคำเตือน และแผงที่ไม่ overflow ใส่ครบทุกวงจร', () => {
  for (const p of seqProjects) {
    const r = E.calculate(p);
    for (const po of r.panels.filter((x) => x.isLP)) {
      if (po.layout.overflow) { assert(r.warnings.some((w) => w.includes(po.board.name + ': จำนวนวงจรเกิน')), `${po.id} overflow warning`); continue; }
      assert(po.circuits.every((c) => c.slotNos && c.slotNos.length), `${po.id} unplaced`);
    }
  }
});

done();
