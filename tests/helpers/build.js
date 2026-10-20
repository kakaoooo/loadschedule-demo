// ตัวสร้างโครงการสำหรับทดสอบ + ตัวสุ่มแบบกำหนดผลซ้ำได้ (fixed seed)
const E = require('../../public/js/engine.js');
const D = E.D;

let _id = 0;
const uid = (p) => p + (++_id);

// proj({meta, panels, items}) : meta ผสมกับค่าเริ่มต้น (รวม branch/feeder/main/hv)
function proj(opts) {
  opts = opts || {};
  const def = E.defaultMeta();
  const meta = Object.assign(def, opts.meta || {});
  ['branch', 'feeder', 'main', 'hv'].forEach((k) => { meta[k] = Object.assign({}, E.defaultMeta()[k], (opts.meta || {})[k] || {}); });
  return { version: 1, meta, panels: opts.panels || [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }], items: opts.items || [] };
}
const P = (id, kind, parent, extra) => Object.assign({ id, name: id, kind, phases: 3, parent, feederLength: 20 }, extra || {});
const I = (panelId, o) => Object.assign({ id: uid('i'), panelId, qty: 1, length: 20 }, o);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------------- ตัวสุ่มโครงการ (พอร์ตจาก fuzz ของการตรวจสอบอิสระ) ---------------- */
// opt: real = โหลด 3 เฟสเฉพาะในแผง 3 เฟส/สายสั้น; sane = เลือกเฉพาะชนิดสาย/วิธีเดินที่ UI มีให้; big = โหลดเยอะ; orphans = มีแผงกำพร้า
function gen(seed, opt) {
  opt = opt || {};
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const real = !!opt.real;
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const chance = (p) => R() < p;
  const blank = (v, p) => (chance(p == null ? 0.08 : p) ? '' : v); // UI เก็บช่องตัวเลขว่างเป็น ''

  const cables = ['IEC01', 'NYY', 'CV', 'NYY4C', 'CV4C'];
  const methods = ['g1', 'g2', 'g3', 'g5', 'g6', 'g7'];
  const wiring = () => ({ cable: pick(cables), method: pick(methods), conduit: pick(D.CONDUIT_TYPES) });
  const meta = {
    buildingType: pick(['residential', 'office', 'hotel', 'hospital', 'warehouse', 'other', 'school']),
    utility: pick(['PEA', 'MEA']), supply: pick(['transformer', 'transformer', 'lv']), hvKV: pick([12, 22, 24, 33]),
    ambientAir: pick([25, 30, 35, 40, 45, 50, 55]), ambientGround: pick([20, 25, 30, 35, 40, 45]),
    recVA: pick([180, 200, 360]), recPerCircuit: pick([4, 6, 8, 10, 12, 20]), lightMaxLoading: pick([0.6, 0.7, 0.8, 1]),
    branchFactor: pick([1, 1.25]), feederFactor: pick([1, 1.25]), useMaxPhase: chance(0.4),
    vdBranch: pick([1, 2, 2, 2, 3]), vdFeeder: pick([1, 2, 2, 2, 3]), vdTotal: pick([3, 5, 5]),
    lightingDF: chance(0.3), lightingGround: chance(0.3),
    minLight: pick([1.5, 2.5, 4]), minRec: pick([2.5, 4]), minFeeder: pick([4, 6, 10]),
    cbLight: pick([10, 16, 20]), cbRec: pick([16, 20]), branchIC: pick([6, 10]),
    branch: wiring(), feeder: wiring(), main: Object.assign(wiring(), { length: pick([1, 5, 15, 30, 80]), maxSize: pick([185, 240, 300, 400]) }),
    sourceKA: pick([0, 0, 5, 20, 50]), serviceKA: pick([10, 25, 50, 100]), growth: pick([0, 0, 10, 25]),
    spareRatio: pick([0.1, 0.15, 0.2]), activeRatio: pick([0.6, 0.7, 0.8]),
    pfNow: pick([0.7, 0.8, 0.85, 0.9]), pfTarget: pick([0.9, 0.95, 1]), maxParallelSize: pick([185, 240, 300]), mccbICMin: pick([6, 10, 18, 25, 36])
  };
  if (opt.sane) {
    meta.branch.cable = pick(['IEC01', 'NYY', 'CV']); meta.branch.method = meta.branch.cable === 'IEC01' ? pick(['g1', 'g2']) : pick(['g1', 'g2', 'g3']);
    meta.feeder.cable = pick(['IEC01', 'NYY', 'CV']); meta.feeder.method = meta.feeder.cable === 'IEC01' ? pick(['g1', 'g2']) : pick(['g2', 'g5', 'g7']);
    meta.main.cable = pick(['NYY', 'CV']); meta.main.method = pick(['g5', 'g7']);
  }
  if (opt.meta) Object.assign(meta, opt.meta);

  const panels = [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }];
  const nSDB = ri(0, 4), nLP = ri(opt.minLP || 1, opt.maxLP || 6);
  const nonLP = ['MDB'];
  for (let i = 0; i < nSDB; i++) {
    const id = 'SDB' + i;
    panels.push({ id, name: id, kind: 'SDB', phases: (real || chance(0.9)) ? 3 : 1, parent: pick(nonLP), feederLength: blank(pick(real ? [5, 10, 20, 30, 60, 100] : [1, 10, 30, 80, 200, 500]), 0.05), nonlinear: chance(0.1) });
    nonLP.push(id);
  }
  for (let i = 0; i < nLP; i++) {
    const id = 'LP' + i;
    panels.push({ id, name: id, kind: 'LP', phases: chance(opt.pLP3 == null ? 0.8 : opt.pLP3) ? 3 : 1, parent: pick(nonLP), feederLength: blank(pick(real ? [5, 10, 20, 30, 60, 100] : [1, 10, 30, 80, 200, 500]), 0.05), ways: pick(opt.ways || ['', '', '', 12, 24, 42]), nonlinear: chance(0.2), mounting: 'SURFACE' });
  }
  if (opt.orphans && chance(0.5)) { const lps = panels.filter((p) => p.kind === 'LP'); pick(lps).parent = 'GHOST'; }
  const items = [];
  let n = 0;
  const lampIds = D.LAMPS.map((l) => l.id);
  const mkItem = (pid, forceType, onePhase) => {
    let t = forceType || pick(['light', 'light', 'rec', 'rec', 'ac', 'ac', 'heater', 'cook', 'motor', 'lift', 'esc', 'chiller', 'custom', 'custom', 'spare']);
    if (real && onePhase && ['lift', 'esc', 'chiller'].includes(t)) t = 'rec';
    if (real && !forceType && ['lift', 'esc', 'chiller'].includes(t) && chance(0.7)) t = 'light';
    const it = { id: 'i' + (++n), panelId: pid, type: t, name: chance(0.5) ? 'x' + n : '', qty: blank(ri(1, real ? 2 : 4), 0.1), length: blank(pick(real ? [5, 10, 20, 30, 50, 80] : [3, 10, 20, 40, 80, 150, 300]), 0.08) };
    switch (t) {
      case 'light': Object.assign(it, { lamp: pick(lampIds), perFixture: blank(ri(1, 4)), fixtures: blank(ri(1, opt.big ? 400 : 60)), circuits: chance(0.7) ? blank(0) : ri(1, 8) }); break;
      case 'rec': Object.assign(it, { points: blank(ri(1, opt.big ? 300 : 50)), vaPerPoint: pick(['', 180, 200, 360]), perCircuit: pick(['', '', 4, 6, 10, 20]), wet: chance(0.3) }); break;
      case 'ac': { const ph = onePhase && real ? 1 : pick(['', '', 1, 3]); const tbl = ph === 3 ? D.AC_3P : (ph === 1 ? D.AC_1P : D.AC_1P.concat(D.AC_3P)); Object.assign(it, { btu: pick(tbl)[0], phases: ph }); break; }
      case 'heater': Object.assign(it, { watt: blank(pick([1500, 3500, 4500, 6000, 9000])) }); break;
      case 'cook': Object.assign(it, { watt: blank(pick([1000, 2000, 5000, 9000, 15000])), phases: onePhase && real ? 1 : pick([1, 3]) }); break;
      case 'motor': { const ph = onePhase && real ? 1 : pick([3, 3, 3, 1]); const tbl = ph === 3 ? D.MOTOR_3P : D.MOTOR_1P; Object.assign(it, { phases: ph, kw: pick(tbl)[0], start: pick(['DOL', 'YD']) }); break; }
      case 'lift': Object.assign(it, { preset: ri(0, D.LIFTS.length - 1), kva: chance(0.2) ? ri(5, 60) : '' }); break;
      case 'esc': Object.assign(it, { preset: ri(0, D.ESCALATORS.length - 1), kva: chance(0.2) ? ri(5, 60) : '' }); break;
      case 'chiller': { const cooling = pick(['water', 'air']); const tb = cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER; Object.assign(it, { cooling, preset: ri(0, tb.length - 1), kva: chance(0.2) ? ri(20, 300) : '' }); break; }
      case 'custom': Object.assign(it, { watt: chance(0.5) ? ri(100, 20000) : '', pf: pick(['', 0.8, 0.9, 1]), va: chance(0.5) ? ri(100, 30000) : '', phases: onePhase && real ? 1 : pick([1, 1, 3]), continuous: chance(0.7), rcd: chance(0.2), cat: pick([undefined, undefined, 'light', 'rec', 'ac', 'heater', 'cook', 'motor', 'other']) }); break;
      case 'spare': Object.assign(it, { cb: pick([16, 20, 32]), va: pick(['', '', 500, 1600]), phases: onePhase && real ? 1 : pick([1, 1, 3]) }); break;
    }
    return it;
  };
  for (const p of panels) {
    const k = p.kind === 'LP' ? ri(opt.minItems || 0, opt.big ? 25 : (opt.maxItems || 12)) : ri(0, real ? 3 : 4);
    for (let i = 0; i < k; i++) {
      const allowed = p.kind === 'LP' ? null : pick(['motor', 'lift', 'esc', 'chiller', 'ac', 'custom']);
      items.push(mkItem(p.id, allowed, p.phases === 1));
    }
  }
  return { version: 1, meta, panels, items };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// หา NaN / Infinity / undefined ในผลลัพธ์ (ข้าม board และ ref ซึ่งเป็นข้อมูลเข้า/อ้างวนกลับ)
function findBad(o, path, seen) {
  path = path || 'r'; seen = seen || new Set();
  if (o === undefined) return path + '=undefined';
  if (typeof o === 'number') return Number.isFinite(o) ? null : path + '=' + o;
  if (o === null || typeof o !== 'object') return null;
  if (seen.has(o)) return null; seen.add(o);
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) { const b = findBad(o[i], path + '[' + i + ']', seen); if (b) return b; } return null; }
  for (const k of Object.keys(o)) { if (k === 'board' || k === 'ref') continue; if (o[k] === undefined) continue; const b = findBad(o[k], path + '.' + k, seen); if (b) return b; }
  return null;
}
module.exports = { E, D, proj, P, I, gen, rng, clone, uid, findBad };
