'use strict';
// ทดสอบแบบไล่ตัวเลขครบทุกเงื่อนไข (ไม่สุ่ม) — ทุกขนาดในตาราง × จำนวน × เฟส × รูปแบบเลขวงจร × Balance
//   1) ทุกเคสผ่านตัวตรวจ invariants ชุดเดียวกับ fuzz (CB ≥ โหลด, สาย ≥ CB, VA คงที่, ช่อง/เฟส, สายป้อน, ประธาน ...)
//   2) Connected ของแผงเท่ากับ VA ที่คาดจากตาราง (คำนวณมืออิสระใน helpers/invariants.expectedItemVA)
//   3) ความสัมพันธ์ทางเดียว (monotonic): โหลดมากขึ้น → Demand / CB สายป้อน / หม้อแปลง ไม่ลดลง
//   4) ค่าขอบ/ขยะทุกช่องของทุกชนิดอุปกรณ์: ผ่านตัวล้างข้อมูลแล้วคำนวณได้ ไม่มี NaN/Infinity
// รัน: node tests/numeric.test.js
global.window = global;
const { test, assert, report, done } = require('./helpers/eng-harness');
const { E, D, proj, P, I, clone, findBad } = require('./helpers/build');
const { check, FAIL, SEEN, expectedItemVA } = require('./helpers/invariants');
const SAN = require('../public/js/sanitize.js');

const po = (r, id) => r.panels.find((x) => x.id === id);
let seed = 900000, cases = 0;
const vaBad = [];

// โครงการ: MDB → SDB1 → LP1 (3 เฟส) + LP2 (1 เฟส) ; อุปกรณ์ลง LP ตามเฟสของอุปกรณ์
function mk(items, opt) {
  opt = opt || {};
  const p = proj({ panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('LP1', 'LP', 'SDB1', opt.lp1 || {}), P('LP2', 'LP', 'SDB1', Object.assign({ phases: 1 }, opt.lp2 || {}))], items });
  if (opt.pattern) p.meta.phasePattern = opt.pattern;
  if (opt.meta) Object.assign(p.meta, opt.meta);
  return p;
}
// รันหนึ่งเคส: ตรวจ invariants + VA ตรงตาราง (เฉพาะแผงที่มีอุปกรณ์ชิ้นเดียว)
function run(label, items, opt) {
  for (const pattern of ['seq', 'pair']) {
    const p = mk(clone(items), Object.assign({}, opt, { pattern }));
    seed++; cases++;
    check(seed, p, 'full');
    let r;
    try { r = E.calculate(p); } catch (e) { vaBad.push(`${label} (${pattern}): throw ${e.message}`); continue; }
    for (const pid of ['LP1', 'LP2']) {
      const its = p.items.filter((x) => x.panelId === pid);
      if (!its.length) continue;
      const want = its.reduce((n, it) => n + expectedItemVA(it, r.meta), 0);
      const got = po(r, pid).connected;
      if (Math.abs(got - want) > Math.max(1e-6, want * 1e-9)) vaBad.push(`${label} (${pattern}) ${pid}: connected ${got} ≠ ${want}`);
    }
  }
}
const lp = (it) => (Number(it.phases) === 1 || (it.type === 'light' || it.type === 'rec') ? 'LP2' : 'LP1');
const one = (o) => { const it = I('LP1', o); it.panelId = o.panelId || lp(o); return it; };

/* ---------- 1–2) ไล่ทุกขนาดในตาราง ---------- */
for (const l of D.LAMPS) for (const per of [1, 2, 4]) for (const fx of [1, 13, 150]) run(`light ${l.id} ${per}x${fx}`, [one({ type: 'light', lamp: l.id, perFixture: per, fixtures: fx })]);
for (const pts of [1, 2, 9, 10, 11, 64, 400]) for (const vpp of ['', 100, 180, 300]) run(`rec ${pts}@${vpp}`, [one({ type: 'rec', points: pts, vaPerPoint: vpp, wet: pts % 2 === 0 })]);
for (const [tbl, ph] of [[D.AC_1P, 1], [D.AC_3P, 3]]) for (const row of tbl) for (const q of [1, 3]) run(`ac ${row[0]} ${ph}φ x${q}`, [one({ type: 'ac', btu: row[0], phases: ph, qty: q, panelId: 'LP1' })]);
for (const t of ['heater', 'cook']) for (const w of [500, 1500, 3500, 4500, 6000, 9000, 12000]) for (const ph of [1, 3]) run(`${t} ${w}W ${ph}φ`, [one({ type: t, watt: w, phases: ph, qty: 2, panelId: 'LP1' })]);
for (const [tbl, ph] of [[D.MOTOR_3P, 3], [D.MOTOR_1P, 1]]) for (const row of tbl) for (const st of ['DOL', 'YD']) {
  if (st === 'YD' && ph === 1) continue;
  run(`motor ${row[0]}kW ${ph}φ ${st}`, [one({ type: 'motor', kw: row[0], phases: ph, start: st, qty: 1, panelId: 'LP1' })]);
}
D.LIFTS.forEach((_, i) => run(`lift preset ${i}`, [one({ type: 'lift', preset: i, qty: 1, panelId: 'LP1' })]));
D.ESCALATORS.forEach((_, i) => run(`esc preset ${i}`, [one({ type: 'esc', preset: i, qty: 2, panelId: 'LP1' })]));
for (const [tbl, cool] of [[D.CHILLER_WATER, 'water'], [D.CHILLER_AIR, 'air']]) tbl.forEach((_, i) => run(`chiller ${cool} ${i}`, [one({ type: 'chiller', cooling: cool, preset: i, qty: 1, panelId: 'LP1' })]));
for (const va of [1, 100, 2300, 6900, 20000, 99999]) for (const ph of [1, 3]) for (const pf of [0.5, 0.8, 1]) run(`custom ${va}VA ${ph}φ pf${pf}`, [one({ type: 'custom', va, phases: ph, pf, continuous: va % 2 === 0, panelId: 'LP1' })]);
// ผสมหลายชนิดในแผงเดียว × Balance auto/deep × spareCount × ระบบรับไฟ/การไฟฟ้า
const MIX = () => [one({ type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 24, panelId: 'LP1' }), one({ type: 'rec', points: 18, panelId: 'LP1' }), one({ type: 'ac', btu: 24000, qty: 3, panelId: 'LP1' }),
  one({ type: 'heater', watt: 4500, qty: 2, panelId: 'LP1' }), one({ type: 'motor', kw: 2.2, phases: 3, panelId: 'LP1' }), one({ type: 'custom', va: 3000, phases: 1, panelId: 'LP1' })];
for (const bal of ['', 'deep']) for (const sc of ['', 0, 2, 6]) for (const supply of ['transformer', 'lv']) for (const utility of ['PEA', 'MEA']) for (const useMaxPhase of [false, true]) {
  run(`mix bal=${bal} spare=${sc} ${supply}/${utility} maxPh=${useMaxPhase}`, MIX(), { lp1: { balance: bal, spareCount: sc }, meta: { supply, utility, useMaxPhase } });
}
// ตรึงเฟส/กำหนด CB ทุกค่าที่เป็นไปได้ บนวงจรแรกของแต่ละชนิด
for (const ph of [0, 1, 2]) for (const at of D.MCB_AT) {
  const items = MIX(); items[0].phOv = { 1: ph }; items[1].cbOv = { 1: at };
  run(`pin ph=${ph} cb=${at}`, items, { lp1: { balance: ph === 1 ? 'deep' : '' } });
}

const names = [...SEEN].sort();
for (const n of names) {
  const f = FAIL[n];
  if (!f) report(true, `numeric ${n}`);
  else report(false, `numeric ${n}`, `${f.count} ครั้ง ครั้งแรก seed ${f.first.seed}: ${String(f.first.msg).slice(0, 220)}`);
}
test(`ไล่ตัวเลขครบ ${cases} เคส: Connected ของแผงตรงกับตาราง (คำนวณมือ)`, () => { assert(!vaBad.length, `${vaBad.length} เคส เช่น ${vaBad.slice(0, 3).join(' | ')}`); assert(cases >= 1000, 'จำนวนเคส ' + cases); });

/* ---------- 3) monotonic ---------- */
function series(build, n) { const out = []; for (let k = 1; k <= n; k++) out.push(E.calculate(build(k))); return out; }
const nonDec = (arr, f) => arr.every((r, i) => i === 0 || f(r) >= f(arr[i - 1]) - 1e-9);
for (const [label, o] of [['light', { type: 'light', lamp: 'led-t8-18', perFixture: 2 }], ['rec', { type: 'rec' }], ['ac', { type: 'ac', btu: 18000 }], ['heater', { type: 'heater', watt: 4500 }], ['motor', { type: 'motor', kw: 3, phases: 3 }], ['custom', { type: 'custom', va: 2000, phases: 1 }]]) {
  const key = o.type === 'light' ? 'fixtures' : o.type === 'rec' ? 'points' : 'qty';
  const rs = series((k) => mk([I('LP1', Object.assign({}, o, { [key]: k * 3 }))]), 25);
  // CB สายป้อนเลือกจากกระแสออกแบบ Ic (ค่าเริ่มต้นใช้ IF ตามหัวข้อ 6.4.2; เปิด "ใช้กระแสเฟสสูงสุด" หรือมีแผง 1 เฟสต่อ → ใช้เฟสหนักสุด)
  // เพิ่มวงจร 1 เฟสแล้วแตกลงอีกเฟสอาจทำให้เฟสหนักสุดเบาลงได้จริง จึงตรวจว่า CB ไม่ลดลงเมื่อเรียงตาม Ic (ไม่ใช่ตามจำนวนอุปกรณ์)
  // Auto-Selectivity จำกัดเมนแผงย่อยไม่เกินเมนต้นทาง (ซึ่งต่างกันตามโครงการ) → เทียบเฉพาะกลุ่มที่เมนต้นทางเท่ากัน (cap)
  const byIc = (id) => rs.map((r) => ({ m: po(r, id).feeder.Ic, cb: po(r, id).feeder.cb.at, cap: id === 'SDB1' ? r.service.mainCB.at : po(r, 'SDB1').feeder.cb.at })).sort((a, b) => a.m - b.m);
  test(`monotonic ${label}: จำนวนเพิ่ม → Connected เพิ่ม, Demand/Main CB/หม้อแปลงไม่ลด ; CB สายป้อนไม่ลดตามกระแสออกแบบ Ic`, () => {
    assert(rs.every((r, i) => i === 0 || po(r, 'LP1').connected > po(rs[i - 1], 'LP1').connected), 'connected');
    assert(nonDec(rs, (r) => r.totals.demand), 'demand');
    for (const id of ['LP1', 'SDB1']) {
      const all = byIc(id);
      for (const cap of [...new Set(all.map((x) => x.cap))]) { const s = all.filter((x) => x.cap === cap); assert(s.every((x, i) => i === 0 || x.cb >= s[i - 1].cb || Math.abs(x.m - s[i - 1].m) < 1e-6), id + ' feeder CB (main ' + cap + ' A) ' + JSON.stringify(s)); }
    }
    assert(nonDec(rs, (r) => r.service.mainCB.at), 'main CB');
    assert(nonDec(rs, (r) => (r.service.trafo ? r.service.trafo.kva : 0)), 'transformer');
  });
}
test('monotonic ระยะสายป้อน: ยาวขึ้น → ขนาดสายไม่เล็กลง และ %VD อยู่ในเกณฑ์หรือมีคำเตือน', () => {
  const rs = [5, 10, 20, 40, 80, 120, 200, 300].map((len) => { const p = mk([I('LP1', { type: 'custom', va: 15000, phases: 3 })]); p.panels.find((x) => x.id === 'LP1').feederLength = len; return E.calculate(p); });
  assert(nonDec(rs, (r) => po(r, 'LP1').feeder.size), 'feeder size ' + rs.map((r) => po(r, 'LP1').feeder.size));
  rs.forEach((r) => { const f = po(r, 'LP1').feeder; assert(Number.isFinite(f.vd.pct) && f.vd.pct >= 0, 'vd'); });
});

/* ---------- 4) ค่าขอบ/ขยะทุกช่อง ---------- */
const GARB = [0, -1, -0.5, 0.0001, 1e9, 1e308, NaN, Infinity, -Infinity, '', ' ', 'abc', '12', ' 7 ', '1e3', null, undefined, true, false, [], {}, [3], { a: 1 }];
const BASES = { light: { type: 'light', lamp: 'led-t8-18', perFixture: 2, fixtures: 10 }, rec: { type: 'rec', points: 8, vaPerPoint: 180 }, ac: { type: 'ac', btu: 12000, phases: 1 },
  heater: { type: 'heater', watt: 3500 }, cook: { type: 'cook', watt: 2000 }, motor: { type: 'motor', kw: 2.2, phases: 3, start: 'DOL' }, lift: { type: 'lift', preset: 3, kva: '' }, esc: { type: 'esc', preset: 1 },
  chiller: { type: 'chiller', preset: 2, cooling: 'water' }, custom: { type: 'custom', va: 1500, watt: '', pf: 0.9, phases: 1 }, spare: { type: 'spare', va: 0, phases: 1 } };
{
  const bad = [];
  let n = 0;
  for (const [t, base] of Object.entries(BASES)) {
    const fields = Object.keys(base).filter((k) => k !== 'type').concat(['qty', 'length', 'phases', 'cbOv', 'phOv', 'name']);
    for (const f of fields) for (const g of GARB) {
      const it = Object.assign(I('LP1', base), { [f]: g });
      const raw = mk([it]);
      n++;
      let r;
      try { r = E.calculate(SAN.project(clone(raw)).project); } catch (e) { bad.push(`${t}.${f}=${String(g)}: ${e.message}`); continue; }
      const b = findBad(r); if (b) bad.push(`${t}.${f}=${String(g)}: ${b}`);
      try { E.calculate(raw); } catch (e) { bad.push(`${t}.${f}=${String(g)} (ไม่ผ่านตัวล้าง): ${e.message}`); }
    }
  }
  test(`ค่าขอบ/ขยะ ${n} กรณี (ทุกช่อง × ${GARB.length} ค่า × ${Object.keys(BASES).length} ชนิด): ไม่ throw ไม่มี NaN/Infinity`, () => assert(!bad.length, `${bad.length} กรณี เช่น ${bad.slice(0, 3).join(' | ')}`));
}
{
  // meta: ค่าขอบทุกช่องตัวเลข
  const bad = [];
  const keys = Object.keys(E.defaultMeta()).filter((k) => typeof E.defaultMeta()[k] !== 'object');
  for (const k of keys) for (const g of GARB) {
    const p = mk([I('LP1', { type: 'custom', va: 5000, phases: 3 })]); p.meta[k] = g;
    try { const r = E.calculate(SAN.project(clone(p)).project); const b = findBad(r); if (b) bad.push(`meta.${k}=${String(g)}: ${b}`); } catch (e) { bad.push(`meta.${k}=${String(g)}: ${e.message}`); }
  }
  test(`ค่าขอบ meta ${keys.length} ช่อง × ${GARB.length} ค่า: ไม่ throw ไม่มี NaN/Infinity`, () => assert(!bad.length, `${bad.length} กรณี เช่น ${bad.slice(0, 3).join(' | ')}`));
}

done();
