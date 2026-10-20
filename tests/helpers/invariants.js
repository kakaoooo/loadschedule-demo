// ตัวตรวจ invariants ของผลคำนวณ (พอร์ตและขยายจากชุดตรวจสอบอิสระ) — ใช้โดย tests/fuzz.test.js
// check(seed, project, level) บันทึกข้อที่ไม่ผ่านใน FAIL[ชื่อ] = {count, first:{seed,msg}}
//   level 'full' = โครงการสมเหตุสมผล (ชนิดสาย/วิธีเดินที่ UI มีให้) ตรวจครบ ; 'basic' = ค่าแปลกมาก ตรวจเฉพาะข้อที่ต้องจริงเสมอ
const { E, D, findBad } = require('./build');

const SQ3 = Math.sqrt(3);
const VPH = 400 / SQ3;
const EPS = 1e-6;
const FAIL = {};
const SEEN = new Set(); // ชื่อ invariant ที่เคยถูกตรวจ (เพื่อรายงาน PASS ทีละข้อ)
function fail(name, seed, msg) {
  const f = FAIL[name] || (FAIL[name] = { count: 0, first: null });
  f.count++; if (!f.first) f.first = { seed, msg };
}
// hold(name, ok, seed, msgFn) — ตรวจและนับ
function hold(name, ok, seed, msg) { SEEN.add(name); if (!ok) fail(name, seed, typeof msg === 'function' ? msg() : msg); }

const MCB_ALL = D.MCB_AT.concat([125, 150, 160, 175, 200, 225, 250, 320, 400, 500, 630, 700, 800, 1000, 1250, 1600, 2000, 2500, 3200]);
const nextUpMin = (x) => MCB_ALL.find((v) => v >= x - 1e-9);

function expectedItemVA(it, meta) {
  const cnt = (v, mx) => (v === '' || v == null ? 1 : Math.min(mx, Math.max(1, Math.round(Number(v) || 1))));
  const q = cnt(it.qty, 2000);
  const phs = (p, d) => (Number(p) === 3 ? 3 : Number(p) === 1 ? 1 : d);
  switch (it.type) {
    case 'light': { const l = D.LAMPS.find((x) => x.id === it.lamp) || D.LAMPS[1]; return l.va * Math.max(1, Number(it.perFixture) || 1) * cnt(it.fixtures, 20000); }
    case 'rec': return cnt(it.points, 2000) * (Number(it.vaPerPoint) || meta.recVA);
    case 'ac': { const btu = Number(it.btu) || 12000; const ph = phs(it.phases, btu >= 36000 ? 3 : 1); const tbl = ph === 3 ? D.AC_3P : D.AC_1P; const row = tbl.find((r) => r[0] >= btu - 1) || tbl[tbl.length - 1]; return row[1] * 1000 * q; }
    case 'heater': return (Number(it.watt) || 3500) * q;
    case 'cook': return (Number(it.watt) || 2000) * q;
    case 'motor': { const kw = Number(it.kw) || 1.5, ph = phs(it.phases, 3); const m = E.motorFLC(kw, ph); return (ph === 3 ? SQ3 * 400 * m.im : 230 * m.im) * q; }
    case 'lift': case 'esc': case 'chiller': {
      let kva = Number(it.kva) || 0;
      if (!kva && it.type === 'lift') kva = D.LIFTS[Math.round(Number(it.preset) || 0)][3];
      if (!kva && it.type === 'esc') kva = D.ESCALATORS[Math.round(Number(it.preset) || 0)][2];
      if (!kva && it.type === 'chiller') kva = (it.cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER)[Math.round(Number(it.preset) || 0)][1];
      return kva * 1000 * q;
    }
    case 'custom': { let va = Number(it.va) || 0; if (!va && it.watt) va = Number(it.watt) / (Number(it.pf) || 1); return va * q; }
    case 'spare': return (Number(it.va) || 0) * q;
  }
  return 0;
}

function check(seed, project, level) {
  const full = level === 'full';
  const before = JSON.stringify(project);
  let r;
  const t0 = Date.now();
  try { r = E.calculate(project); } catch (e) { fail('NO_CRASH', seed, e.message + ' @ ' + (e.stack.split('\n')[1] || '').trim()); return null; }
  SEEN.add('NO_CRASH');
  const ms = Date.now() - t0;
  hold('INPUT_NOT_MUTATED', JSON.stringify(project) === before, seed, 'calculate() แก้ข้อมูลเข้า');
  let r2; try { r2 = E.calculate(JSON.parse(before)); } catch (e) { fail('NO_CRASH', seed, 'run 2: ' + e.message); return null; }
  hold('DETERMINISM', JSON.stringify(r) === JSON.stringify(r2), seed, 'สองรอบผลต่างกัน');
  const bad = findBad(r);
  hold('NO_NAN_INF_UNDEF', !bad, seed, () => bad);
  const neg = []; (function scan(o, path, seen) { if (o == null || typeof o !== 'object' || seen.has(o)) return; seen.add(o); for (const k of Object.keys(o)) { if (k === 'board' || k === 'ref') continue; const v = o[k]; if (typeof v === 'number' && v < -EPS && !/^(vdMargin)$/.test(k)) neg.push(path + '.' + k + '=' + v); else scan(v, path + '.' + k, seen); } })(r, 'r', new Set());
  hold('NO_NEGATIVE', !neg.length, seed, () => neg.slice(0, 5).join(', '));
  hold('NO_INTERNAL_ERROR', !r.warnings.some((w) => /ข้อผิดพลาดภายใน/.test(w)), seed, () => r.warnings.filter((w) => /ข้อผิดพลาดภายใน/.test(w)).join(' | '));

  const meta = r.meta;
  const panels = r.panels;
  const byId = Object.fromEntries(panels.map((p) => [p.id, p]));
  const warnText = r.warnings.join('\n');
  const reachable = new Set(); (function w(id) { reachable.add(id); (byId[id].kids || []).forEach(w); })(r.panels.find((p) => p.board.kind === 'MDB' && !p.board.parent || p.id === 'MDB').id);
  const mdbId = [...reachable][0];

  const itemType = {}, itemWet = {}; project.items.forEach((it) => { itemType[it.id] = it.type; itemWet[it.id] = it.wet; });
  // ปริมาณ VA ของ item ครบทุกชั้น: item -> วงจร
  const itemVA = {};
  for (const p of panels) for (const c of p.circuits) itemVA[c.itemId] = (itemVA[c.itemId] || 0) + c.va;
  for (const it of project.items) {
    if (!panels.find((p) => p.id === String(it.panelId))) continue;
    const exp = expectedItemVA(it, meta), got = itemVA[it.id] || 0;
    hold('ITEM_VA_CONSERVATION', Math.abs(exp - got) <= 1e-6 * Math.max(1, exp) + 1e-6, seed, () => `${it.type} ${it.id}: expected ${exp} got ${got}`);
  }
  // วงจรแสงสว่างที่แบ่งอัตโนมัติ ไม่เกิน lightMaxLoading × CB (ยกเว้นโคมเดียวก็เกินแล้ว)
  {
    const maxVA = meta.cbLight * 230 * meta.lightMaxLoading;
    const itemsById = Object.fromEntries(project.items.map((it) => [it.id, it]));
    for (const p of panels) for (const c of p.circuits) {
      const it = itemsById[c.itemId]; if (!it || it.type !== 'light' || Number(it.circuits) > 0) continue;
      const lamp = D.LAMPS.find((l) => l.id === it.lamp) || D.LAMPS[1];
      const vaFix = lamp.va * Math.max(1, Number(it.perFixture) || 1);
      if (vaFix <= maxVA + 1e-9) hold('LIGHT_CIRCUIT_LE_MAX', c.va <= maxVA + 1e-6, seed, () => `${p.id}: ${c.va} VA > ${maxVA}`);
    }
  }
  for (const p of panels) if (!reachable.has(p.id)) hold('ORPHAN_DESIGNED', p.circuits.every((c) => c.cb) && !!p.feeder, seed, () => `${p.id} ไม่ถูกออกแบบ`);

  let sumConn = 0;
  for (const p of panels) {
    if (!reachable.has(p.id)) continue;
    const kidConn = (p.kids || []).reduce((s, id) => s + byId[id].connected, 0);
    const own = p.circuits.reduce((s, c) => s + c.va, 0);
    hold('PANEL_CONNECTED_SUM', Math.abs(p.connected - (own + kidConn)) <= 1e-6 * Math.max(1, p.connected), seed, () => `${p.id}: ${p.connected} vs ${own}+${kidConn}`);
    const ph = p.phaseVA.reduce((a, b) => a + b, 0);
    hold('PHASEVA_SUM_EQ_CONNECTED', Math.abs(ph - p.connected) <= 1e-6 * Math.max(1, p.connected), seed, () => `${p.id}: Σphase=${ph} connected=${p.connected}`);
    const avg = ph / 3; const ub = avg ? Math.max(...p.phaseVA.map((v) => Math.abs(v - avg))) / avg * 100 : 0;
    hold('UNBALANCE_CONSISTENT', Math.abs(ub - p.unbalance) <= 1e-6, seed, () => `${p.id}: ${ub} vs ${p.unbalance}`);
    const kidDem = (p.kids || []).reduce((s, id) => s + byId[id].demand, 0);
    hold('PARENT_DEMAND_INCLUDES_KIDS', Math.abs(p.demand - (p.demandLocal.total + kidDem)) <= 1e-6 * Math.max(1, p.demand), seed, () => p.id);
    const extraSub = (function f(id) { const q = byId[id]; return (q.demandLocal.motorExtra || 0) + (q.kids || []).reduce((s, k) => s + f(k), 0); })(p.id);
    hold('DEMAND_LE_CONNECTED', p.demand <= p.connected + extraSub + 1e-6, seed, () => `${p.id}: demand ${p.demand} > connected ${p.connected} + extra ${extraSub}`);
    // โหลดต่อเฟส = วงจรของแผงเอง (ตาม c.phase) + แผงลูก (3 เฟส: phaseVA ลูก ; 1 เฟส: connected ลงเฟส feedPhase)
    const own3 = [0, 0, 0];
    p.circuits.forEach((c) => { if (p.board.phases !== 3) own3[0] += c.va; else if (c.phases === 3) for (let k = 0; k < 3; k++) own3[k] += c.va / 3; else own3[c.phase] += c.va; });
    const kid3 = [0, 0, 0];
    (p.kids || []).forEach((id) => { const k = byId[id]; if (p.board.phases !== 3) kid3[0] += k.connected; else if (k.board.phases === 3) for (let q = 0; q < 3; q++) kid3[q] += k.phaseVA[q]; else kid3[k.feedPhase] += k.connected; });
    hold('PHASEVA_FROM_CIRCUITS_AND_KIDS', [0, 1, 2].every((k) => Math.abs(own3[k] + kid3[k] - p.phaseVA[k]) <= 1e-6 * Math.max(1, p.connected)), seed, () => `${p.id}: ${own3.map(Math.round)}+${kid3.map(Math.round)} vs ${p.phaseVA.map(Math.round)}`);
    hold('PHASEKIDVA_MATCH', [0, 1, 2].every((k) => Math.abs(kid3[k] - p.phaseKidVA[k]) <= 1e-6 * Math.max(1, p.connected)), seed, () => `${p.id}: ${kid3.map(Math.round)} vs ${p.phaseKidVA.map(Math.round)}`);
    (p.kids || []).forEach((id) => { const k = byId[id]; if (p.board.phases === 3 && k.board.phases !== 3) hold('ONE_PHASE_KID_HAS_FEEDPHASE', [0, 1, 2].includes(k.feedPhase), seed, () => `${id} feedPhase ${k.feedPhase}`); });
    if (p.id === mdbId) sumConn = p.connected;
  }
  hold('TOTALS_CONNECTED', Math.abs(r.totals.connected - sumConn) <= 1e-6, seed, () => `${r.totals.connected} vs ${sumConn}`);

  // วงจรย่อย
  for (const p of panels) {
    const Ik = p.sc ? p.sc.Ik : 0;
    const icNeed = Math.min(Ik, 100);
    if (!reachable.has(p.id) && !full) continue;
    for (const c of p.circuits) {
      if (!c.cb) { hold('CIRCUIT_HAS_CB', false, seed, `${p.id} ${c.desc}`); continue; }
      hold(c.cat === 'spare' ? 'SPARE_IC_GE_IK' : 'BRANCH_IC_GE_IK', c.cb.ic + 1e-9 >= icNeed, seed, () => `${p.id} ${c.cat}: IC ${c.cb.ic} < Ik ${Ik.toFixed(2)}`);
      hold('BRANCH_IC_RULE', c.cb.ic === Math.max(c.cb.type === 'MCCB' ? (meta.mccbICMin || 0) : meta.branchIC, D.IC_KA.find((x) => x >= Ik) || 100), seed, () => `${p.id} ${c.cat}: IC ${c.cb.ic}`);
      if (c.cat === 'spare') continue;
      const isMotor = c.motor && !c.motor.packaged;
      const noCableWarn = c.warn.some((w) => w.includes('ไม่มีขนาดสาย'));
      const cbOver = c.cb.oversize;
      if (!isMotor) {
        const Id = c.I * (c.continuous ? meta.branchFactor : 1);
        hold('BRANCH_CB_GE_LOAD', cbOver || c.cb.at + 1e-9 >= Id, seed, () => `${p.id} ${c.cat} I=${c.I} Id=${Id} CB=${c.cb.at}`);
        hold('BRANCH_CABLE_GE_CB', noCableWarn || c.cond.amp + 1e-9 >= c.cb.at, seed, () => `${p.id} ${c.cat} CB=${c.cb.at} cable ${c.cond.size} amp=${c.cond.amp.toFixed(1)}`);
      } else {
        // Star-Delta: สายหลังสตาร์ทเตอร์ 6 เส้น (amp รวม Fg 0.8 แล้ว) ≥ 1.25 × 0.58 Im ; อื่น ๆ ≥ 1.25 Im (บทที่ 8)
        hold('MOTOR_CABLE_GE_125IM', noCableWarn || c.cond.amp + 1e-9 >= (c.cond.yd ? 1.25 * 0.58 : 1.25) * c.motor.im, seed, () => `${p.id} Im=${c.motor.im} cable ${c.cond.size} amp=${c.cond.amp.toFixed(1)}`);
        hold('MOTOR_CB_GE_125IM', cbOver || c.cb.at + 1e-9 >= 1.25 * c.motor.im, seed, () => `${p.id} Im=${c.motor.im} CB=${c.cb.at}`);
        hold('MOTOR_CB_LE_250IM', c.cb.at <= 2.5 * c.motor.im + 1e-9 || c.cb.at <= nextUpMin(1.25 * c.motor.im), seed, () => `${p.id} Im=${c.motor.im} CB=${c.cb.at}`);
        hold('MOTOR_DM_NUMBER', Number.isFinite(c.motor.dm) && (c.motor.dm >= 1.15 * c.motor.im - 1e-9 || c.motor.dmOver), seed, () => `${p.id} Im=${c.motor.im} DM=${c.motor.dm}`);
      }
      hold('BRANCH_VD_LIMIT_OR_WARN', c.vd.pct <= meta.vdBranch + 1e-9 || c.warn.some((w) => w.includes('แรงดันตก')), seed, () => `${p.id} ${c.cat} vd=${c.vd.pct.toFixed(2)} limit ${meta.vdBranch}`);
      if (full) {
        const vdc = c.cond.yd ? E.vdPercent(meta.branch.cable, meta.branch.method, c.phases, c.cond.size, 2 * 0.58 * c.motor.im, c.L, 2)
          : E.vdPercent(meta.branch.cable, meta.branch.method, c.phases, c.cond.size, c.I, c.L, 1);
        hold('BRANCH_VD_RECOMPUTE', Math.abs(vdc.pct - c.vd.pct) <= 1e-9, seed, () => `${p.id} ${c.cat}: ${vdc.pct} vs ${c.vd.pct}`);
      }
      hold('GROUND_LE_PHASE', !c.cond.ground || c.cond.ground <= c.cond.size, seed, p.id);
      hold('POLES_3P', c.phases !== 3 || c.cb.poles === 3, seed, p.id);
      if (itemType[c.itemId] === 'heater') hold('HEATER_RCBO', c.cb.rcd, seed, p.id);
      if (itemType[c.itemId] === 'rec' && itemWet[c.itemId]) hold('WET_REC_RCBO', c.cb.rcd, seed, p.id);
      if (full && c.conduit && c.conduit.inch !== '-' && D.CABLES[meta.branch.cable].core === 's') {
        const cd = D.CONDUIT.find((x) => x.inch === c.conduit.inch);
        const A = D.CABLE_AREA[D.CABLES[meta.branch.cable].area];
        const a = (A[c.cond.size] || 0) * c.cond.n + (c.cond.ground ? (A[c.cond.ground] || 0) : 0);
        const n = c.cond.n + (c.cond.ground ? 1 : 0);
        const fill = n === 1 ? 0.53 : n === 2 ? 0.31 : 0.40;
        hold('CONDUIT_FILL', cd.area * fill + 1e-9 >= a || c.conduit.inch === '6', seed, () => `${p.id} ${c.cat} conduit ${c.conduit.inch} area ${a}`);
      }
    }
  }

  // การจัดวงจรลงช่อง
  const pattern = meta.phasePattern === 'pair' ? 'pair' : 'seq';
  for (const p of panels) {
    if (!p.isLP || !reachable.has(p.id)) continue;
    const L = p.layout;
    const three = p.board.phases === 3;
    hold('LAYOUT_CONTRACT', L.pattern === pattern && Array.isArray(L.slotPhase) && L.slotPhase.length === L.ways && L.slotPhase.every((x, i) => x === E.slotPhase(i, pattern, three)), seed, () => `${p.id} slotPhase/pattern`);
    if (L.overflow) {
      const need = p.circuits.reduce((s, c) => s + (c.phases === 3 ? 3 : 1), 0);
      const threeInOne = !three && p.circuits.some((c) => c.phases === 3);
      const ways = Number(p.board.ways) || 42;
      hold('OVERFLOW_ONLY_WHEN_NEEDED', threeInOne || need > ways || need > 42, seed, () => `${p.id}: need ${need} poles <= ways ${ways} yet overflow`);
      hold('OVERFLOW_HAS_WARNING', warnText.includes(p.board.name + ': จำนวนวงจรเกิน'), seed, p.id);
      continue;
    }
    const seen = new Set();
    p.circuits.forEach((c) => {
      if (!c.slotNos) { hold('LAYOUT_PLACED', false, seed, `${p.id} ${c.cat}`); return; }
      hold('LAYOUT_PLACED', true, seed, '');
      if (c.phases === 3) {
        hold('LAYOUT_3P_STRIDE2_SAME_SIDE', c.slotNos.length === 3 && c.slotNos[1] - c.slotNos[0] === 2 && c.slotNos[2] - c.slotNos[1] === 2, seed, () => `${p.id}: ${c.slotNos}`);
        if (c.slotNos.length === 3) hold('LAYOUT_3P_DISTINCT_PHASES', [0, 1, 2].every((ph) => c.slotNos.some((n) => L.slotPhase[n - 1] === ph)), seed, () => `${p.id}: ${c.slotNos}`);
        if (pattern === 'pair' && c.slotNos.length === 3) hold('LAYOUT_3P_PAIR_ROWS_ALIGNED', Math.floor((c.slotNos[0] - 1) / 2) % 3 === 0, seed, () => `${p.id}: ${c.slotNos}`);
      } else {
        hold('LAYOUT_1P_LEN', c.slotNos.length === 1, seed, p.id);
        hold('LAYOUT_1P_PHASE', c.phase === L.slotPhase[c.slotNos[0] - 1], seed, () => `${p.id}: ${c.slotNos} phase ${c.phase}`);
      }
      c.slotNos.forEach((n) => {
        hold('LAYOUT_SLOT_UNIQUE', !seen.has(n), seed, () => `${p.id} slot ${n}`); seen.add(n);
        const s = L.slots[n - 1];
        hold('LAYOUT_SLOT_MATCH', s === c || (s && s.ref === c), seed, () => `${p.id} slot ${n}`);
        hold('LAYOUT_SLOT_RANGE', n >= 1 && n <= L.ways, seed, p.id);
      });
    });
    L.slots.forEach((s, i) => { if (s && !s.ref && !s.auto) hold('LAYOUT_NO_FOREIGN_SLOT', p.circuits.includes(s), seed, () => `${p.id} ${i}`); });
    hold('LAYOUT_USED_LE_WAYS', L.slots.length === L.ways && L.slots.filter(Boolean).length <= L.ways, seed, p.id);
    L.slots.forEach((sl) => { if (sl && sl.auto) hold('AUTOSPARE_IC_GE_IK', sl.cb.ic + 1e-9 >= Math.min(p.sc ? p.sc.Ik : 0, 100), seed, () => `${p.id}: IC ${sl.cb.ic} < Ik`); });
    if (three) {
      const v = [0, 0, 0];
      p.circuits.forEach((c) => { if (c.phases === 3) for (let k = 0; k < 3; k++) v[k] += c.va / 3; else v[L.slotPhase[c.slotNos[0] - 1]] += c.va; });
      hold('PHASEVA_FROM_SLOTS', v.every((x, k) => Math.abs(x - (p.phaseVA[k] - p.phaseKidVA[k])) < 1e-6), seed, () => `${p.id}: ${v} vs ${p.phaseVA}`);
      if (pattern === 'seq') {
        const cnt = [0, 0, 0]; p.circuits.filter((c) => c.phases !== 3 && c.cat !== 'spare').forEach((c) => cnt[c.phase]++);
        hold('SEQ_PHASE_COUNTS_DIFF_LE_1', Math.max(...cnt) - Math.min(...cnt) <= 1, seed, () => `${p.id}: ${cnt}`);
        const live = p.circuits.filter((c) => c.cat !== 'spare');
        if (live.length) {
          const top1 = Math.max(0, ...live.filter((c) => c.phases !== 3).map((c) => c.slotNos[0]));
          const spans = live.filter((c) => c.phases === 3).map((c) => [c.slotNos[0], c.slotNos[2]]);
          const top = Math.max(...live.map((c) => Math.max(...c.slotNos)));
          for (let n = 1; n <= top; n++) {
            const s = L.slots[n - 1]; const o = s && (s.ref || s);
            // ข้อยกเว้น (เลี่ยงไม่ได้): ช่องคั่นภายในช่วงของวงจร 3 เฟส เหนือวงจร 1 เฟสทั้งหมด ; ถ้าเป็น Spare ต้องเพราะท้ายแผงเต็มแล้ว
            const tailFull = L.slots.slice(top).every(Boolean);
            const sp3Tight = o && o.cat === 'spare' && o.phases === 3 && tailFull; // Spare 3 เฟสในแผงที่เต็มพอดี จึงต้องสลับกับวงจรใช้งาน
            const ok = (o && o.cat !== 'spare' && !o.auto) || sp3Tight || (n > top1 && spans.some(([a, b]) => n > a && n < b) && (!o || tailFull));
            hold('SEQ_NO_SPARE_OR_SPACE_BEFORE_LIVE', ok, seed, () => `${p.id}: เลข ${n} ก่อนวงจรใช้งานเลข ${top}`);
          }
        }
      }
      if (p.balance) {
        hold('BALANCE_DEEP_LE_AUTO', p.balance.deepUnbalance <= p.balance.autoUnbalance + 1e-9, seed, () => `${p.id}: ${JSON.stringify(p.balance)}`);
        hold('BALANCE_MATCH', Math.abs(p.balance.unbalance - p.unbalance) < 1e-9 && Math.abs(p.balance.unbalance - (p.balance.mode === 'deep' ? p.balance.deepUnbalance : p.balance.autoUnbalance)) < 1e-6, seed, () => `${p.id}: ${JSON.stringify(p.balance)} vs ${p.unbalance}`);
      }
      if (pattern === 'pair' && p.unbalance > 20 && !(p.kids || []).length) {
        const free = [0, 1, 2].map((ph) => L.slots.filter((s, i) => !s && L.slotPhase[i] === ph).length);
        const avg = (p.phaseVA[0] + p.phaseVA[1] + p.phaseVA[2]) / 3;
        const dev = (vv) => Math.max(...vv.map((x) => Math.abs(x - avg))) / avg * 100;
        let best = p.unbalance;
        for (const c of p.circuits) { if (c.phases === 3) continue; for (let b = 0; b < 3; b++) { if (b === c.phase || !free[b]) continue; const vv = p.phaseVA.slice(); vv[c.phase] -= c.va; vv[b] += c.va; best = Math.min(best, dev(vv)); } }
        hold('PAIR_BALANCE_MOVE_FIXES_WARNING', best > 20 - 1e-9, seed, () => `${p.id}: unbalance ${p.unbalance.toFixed(1)}% but a single circuit move gives ${best.toFixed(1)}%`);
      }
    } else if (p.circuits.length) hold('PHASEVA_1P', Math.abs(p.phaseVA[0] - p.circuits.reduce((s, c) => s + c.va, 0) - p.phaseKidVA[0]) < 1e-6, seed, p.id);
    // share
  }
  // แผ่น share ของวงจร
  for (const p of panels) for (const c of p.circuits) {
    const field = c.cat === 'light' && itemType[c.itemId] === 'light' ? 'fixtures' : itemType[c.itemId] === 'rec' ? 'points' : 'qty';
    hold('SHARE_FIELD', !!c.share && c.share.field === field && c.share.n >= 1, seed, () => `${p.id} ${c.cat} ${JSON.stringify(c.share)}`);
  }
  {
    const sums = {};
    for (const p of panels) for (const c of p.circuits) { const k = c.itemId; sums[k] = (sums[k] || 0) + (c.share ? c.share.n : 0); }
    for (const it of project.items) {
      if (!panels.find((p) => p.id === String(it.panelId))) continue;
      const cnt = (v, mx) => (v === '' || v == null ? 1 : Math.min(mx, Math.max(1, Math.round(Number(v) || 1))));
      const want = it.type === 'light' ? cnt(it.fixtures, 20000) : it.type === 'rec' ? cnt(it.points, 2000) : cnt(it.qty, 2000);
      hold('SHARE_SUMS_TO_ITEM', sums[it.id] === want, seed, () => `${it.type} ${it.id}: ${sums[it.id]} vs ${want}`);
    }
  }

  // สายป้อน
  for (const p of panels) {
    if (!reachable.has(p.id) || p.id === mdbId) continue;
    const f = p.feeder; if (!f) { hold('FEEDER_PRESENT', false, seed, p.id); continue; }
    const par = byId[p.board.parent];
    const hasMotors = p.circuits.some((c) => c.motor);
    const IF = f.I_F;
    const cbOver = f.cb.oversize;
    if (p.board.phases === 3 || !p.circuits.some((c) => c.phases === 3)) hold('FEEDER_CB_GE_IF', cbOver || f.cb.at + 1e-9 >= IF, seed, () => `${p.id}: CB ${f.cb.at} < I_F ${IF.toFixed(1)}`);
    const ph = p.board.phases === 3 ? 3 : 1;
    const ratio = p.connected ? p.demand / p.connected : 1;
    const has1P = (p.kids || []).some((k) => byId[k].board.phases !== 3);
    const Imx = ph === 3 ? Math.max(...p.phaseVA) * ratio / VPH : 0;
    const useMax = ph === 3 && (meta.useMaxPhase || has1P);
    const Ibase = Math.max(IF, useMax ? Imx : 0);
    if (!hasMotors) {
      hold('FEEDER_CB_GE_FACTOR_IBASE', cbOver || f.cb.at + 1e-9 >= Ibase * meta.feederFactor - 1e-6, seed, () => `${p.id}: CB ${f.cb.at} < ${meta.feederFactor}*I_base ${(Ibase * meta.feederFactor).toFixed(1)} (I_F ${IF.toFixed(1)}, Imax ${Imx.toFixed(1)}, useMax ${useMax})`);
      hold('FEEDER_CABLE_GE_CB_OR_WARN', f.amp + 1e-6 >= f.cb.at || f.warn.length > 0, seed, () => `${p.id}: amp ${f.amp.toFixed(1)} < CB ${f.cb.at} sets ${f.sets} size ${f.size}`);
    } else hold('FEEDER_MOTOR_CABLE_GE_IC_OR_WARN', f.amp + 1e-6 >= f.Ic || f.warn.length > 0, seed, () => `${p.id}: amp ${f.amp.toFixed(1)} < Ic ${f.Ic.toFixed(1)}`);
    hold('FEEDER_VD_LIMIT_OR_WARN', f.vd.pct <= meta.vdFeeder + 1e-9 || f.warn.length > 0, seed, () => `${p.id}: vd ${f.vd.pct}`);
    hold('FEEDER_SIZE_LE_MAXPARALLEL', f.size <= Math.max(meta.maxParallelSize, meta.minFeeder), seed, () => `${p.id}: size ${f.size} > maxParallelSize ${meta.maxParallelSize} (sets ${f.sets})`);
    hold('FEEDER_SETS_RANGE', f.sets >= 1 && f.sets <= 8, seed, () => `${p.id}: sets ${f.sets}`);
    hold('FEEDER_GROUND_LE_PHASE', f.ground <= f.size, seed, p.id);
    hold('FEEDER_NEUTRAL_LE_PHASE', !f.nSize || f.nSize <= f.size, seed, p.id);
    const parIk = par && par.sc ? par.sc.Ik : 0;
    hold('FEEDER_IC_GE_IK', f.cb.ic + 1e-9 >= Math.min(parIk, 100), seed, () => `${p.id}: IC ${f.cb.ic} < Ik@parent ${parIk.toFixed(2)}`);
    hold('PANEL_MAIN_CONSISTENT', p.main.at === f.cb.at && p.main.ic === f.cb.ic, seed, () => `${p.id}: main ${JSON.stringify(p.main)} vs feeder ${f.cb.at}/${f.cb.ic}`);
    hold('IK_DECREASING', !(p.sc && par && par.sc) || p.sc.Ik <= par.sc.Ik + 1e-9, seed, p.id);
    hold('VDUP_ACCUM', Math.abs(p.vdUp - ((par ? par.vdUp : 0) + f.vd.pct)) < 1e-9, seed, p.id);
    hold('BUSBAR_GE_MAIN_OR_WARN', p.busbar >= (f.cb.af || f.cb.at) || (p.busbarOver && /บัสบาร์/.test(warnText)), seed, () => `${p.id}: busbar ${p.busbar} vs ${f.cb.af || f.cb.at}`);
  }

  // ระบบประธาน
  const s = r.service;
  const demandI = r.totals.demand / (SQ3 * 400);
  hold('SERVICE_DEMANDI', Math.abs(demandI - s.demandI) < 1e-9, seed, '');
  const mcOver = s.mainCB.oversize;
  const mainI = s.tap ? s.tap.mainDemandI : demandI;   // แผง tap ahead of main (NFPA 20): CB ประธานคิดจากดีมานด์ที่ไม่รวมแผง tap
  if (meta.supply === 'transformer') {
    hold('MAINCB_GE_DEMAND_OR_WARN', mcOver || s.mainCB.at + 1e-9 >= mainI || /ใหญ่กว่า/.test(warnText), seed, () => `mainCB ${s.mainCB.at} < demand I ${mainI.toFixed(1)}`);
    hold('TRAFO_GE_DEMAND_OR_WARN', s.trafo.kva * 1000 + 1e-6 >= r.totals.demand * (1 + (Number(meta.growth) || 0) / 100) || /หม้อแปลง/.test(warnText), seed, () => `trafo ${s.trafo.kva} < demand ${(r.totals.demand / 1000).toFixed(1)} kVA`);
    hold('MAINCB_LE_ILV_OR_WARN', s.mainCB.at <= s.Ilv + 1e-9 || /ใหญ่กว่า/.test(warnText), seed, '');
  } else {
    hold('LV_MAINCB_GE_DEMAND_OR_WARN', mcOver || s.mainCB.at + 1e-9 >= mainI || (s.meter.over && /มิเตอร์/.test(warnText)), seed, () => `mainCB ${s.mainCB.at} < demand I ${mainI.toFixed(1)} meter ${s.meter.size}`);
  }
  const mf = s.mainFeeder;
  if (meta.supply === 'lv' && meta.utility === 'PEA') hold('PEA_MAIN_CABLE_GE_METER_MIN', mf.size + 1e-9 >= s.meter.extra, seed, () => `main cable ${mf.sets}x${mf.size} < meter min Cu ${s.meter.extra} mm2 (${s.meter.size})`);
  hold('MAIN_SETS_RANGE', mf.sets >= 1 && mf.sets <= 10, seed, () => `main feeder sets=${mf.sets}`);
  {
    const pk = E.pickConductor({ cable: meta.main.cable, method: meta.main.method, ncc: 3, Ireq: 1, minSize: mf.size, maxSize: mf.size, meta, groups: mf.sets });
    hold('MAIN_CABLE_GE_MAINCB_OR_WARN', pk.derated * mf.sets + 1e-6 >= s.mainCB.at || /สายประธาน/.test(warnText), seed, () => `main cable ${mf.sets}x${mf.size} derated ${(pk.derated * mf.sets).toFixed(0)} A < CB ${s.mainCB.at}`);
    // tap ahead of main: CB ประธานไม่ป้องกันช่วงก่อนจุด tap → สายประธานต้องรับดีมานด์ทั้งอาคาร (ไม่ใช่แค่ CB ประธานที่เล็กลง)
    if (s.tap) hold('TAP_MAIN_CABLE_GE_FULL_DEMAND_OR_WARN', pk.derated * mf.sets + 1e-6 >= s.demandI || /สายประธาน/.test(warnText), seed, () => `main cable ${mf.sets}x${mf.size} derated ${(pk.derated * mf.sets).toFixed(0)} A < full demand ${s.demandI.toFixed(1)} A`);
  }
  hold('MAIN_IC_GE_IK', s.mainCB.ic + 1e-9 >= Math.min(s.scMDB.Ik, 100), seed, () => `${s.mainCB.ic} < ${s.scMDB.Ik}`);
  hold('IK_OVER_100KA_WARNED', s.scMDB.Ik <= 100 || /100 kA/.test(warnText), seed, () => `Ik@MDB ${s.scMDB.Ik.toFixed(1)} kA`);
  hold('PFC_NONNEG', s.pfc.kvar >= 0 && s.pfc.bank >= 0 && Number.isFinite(s.pfc.kvar), seed, () => `${s.pfc.kvar}`);
  hold('SERVICE_BUSBAR_OR_WARN', Number.isFinite(s.busbar) && (s.busbar >= (s.mainCB.af || s.mainCB.at) || /บัสบาร์/.test(warnText)), seed, () => `busbar ${s.busbar} vs main ${s.mainCB.af || s.mainCB.at}`);
  r.bom.cables.forEach((c) => hold('BOM_CABLE_LEN', c.length >= 0, seed, () => JSON.stringify(c)));
  {
    let expCB = 1, expLen = 0;
    for (const p of panels) {
      for (const c of p.circuits) { if (!c.cb) continue; expCB++; if (c.cond) expLen += c.L * 1.1 * (c.cond.n + (c.cond.ground ? 1 : 0)); }
      if (p.layout) p.layout.slots.forEach((sl) => { if (sl && sl.auto) expCB++; });
      if (p.feeder) { const f = p.feeder, L = Math.min(1e5, Math.max(0, Number(p.board.feederLength) || 0)) * 1.1; expCB++; expLen += L * f.sets * ((p.board.phases === 3 ? 3 : 2) + (f.nSize ? 1 : 0) + 1); }
    }
    expLen += meta.main.length * 1.1 * (4 * mf.sets + mf.sets);
    const gotCB = r.bom.breakers.reduce((a, b) => a + b.qty, 0);
    hold('BOM_BREAKER_COUNT', gotCB === expCB, seed, () => `bom ${gotCB} vs expected ${expCB}`);
    const gotLen = r.bom.cables.reduce((a, b) => a + b.length, 0);
    hold('BOM_CABLE_TOTAL', gotLen + 1e-6 >= expLen && gotLen <= expLen + r.bom.cables.length + 1e-6, seed, () => `bom ${gotLen} vs expected ${expLen.toFixed(1)}`);
  }
  return { r, ms };
}

module.exports = { check, FAIL, SEEN, expectedItemVA };
