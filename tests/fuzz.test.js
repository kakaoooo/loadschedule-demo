// Fuzz แบบ seed คงที่: โครงการสุ่มที่ถูกต้องตามรูปแบบ ≥ 400 โครงการ ตรวจ invariants ของตัวคำนวณ (ดู tests/helpers/invariants.js)
//   - ไม่ throw, ไม่มี NaN/Inf/undefined/ติดลบ, VA คงที่ item -> วงจร -> connected -> phaseVA, CB ≥ โหลด × ตัวคูณ, สาย ≥ CB (หรือมีคำเตือน)
//   - แรงดันตกอยู่ในเกณฑ์หรือเตือน, การจัดช่อง/เฟส, CB สายป้อน ≥ 1.25 × I_base, IC ตามกฎเดียวกัน, ผลซ้ำได้, ไม่แก้ข้อมูลเข้า
// รัน: node tests/fuzz.test.js
const { test, assert, eq, report, done } = require('./helpers/eng-harness');
const { E, gen, rng, clone, findBad } = require('./helpers/build');
const { check, FAIL, SEEN } = require('./helpers/invariants');

// เพิ่มตัวเลือกระดับแผงแบบสุ่ม (balance deep / spareCount / เฟสของแผง 1 เฟส) ให้ครอบคลุมสัญญาข้อมูลใหม่
function decorate(p, seed) {
  const R = rng(seed * 7919 + 13);
  p.panels.forEach((b) => {
    if (b.kind === 'LP' && R() < 0.3) b.balance = 'deep';
    if (b.kind === 'LP' && R() < 0.3) b.spareCount = Math.floor(R() * 7);
    if (b.phases === 1 && R() < 0.3) b.phase = Math.floor(R() * 3);
  });
  return p;
}

const SETS = [
  { name: 'real+sane (seq)', n: 400, seed0: 20000, opt: { real: true, sane: true }, level: 'full' },
  { name: 'real+sane (pair)', n: 100, seed0: 30000, opt: { real: true, sane: true }, level: 'full', pattern: 'pair' },
  { name: 'real+sane big', n: 60, seed0: 40000, opt: { real: true, sane: true, big: true }, level: 'full' },
  { name: 'orphans', n: 100, seed0: 50000, opt: { real: true, sane: true, orphans: true }, level: 'full' },
  { name: 'tap ahead of main (NFPA 20)', n: 120, seed0: 90000, opt: { real: true, sane: true }, level: 'full', tap: true },
  { name: 'wild (non-sane wiring, huge loads)', n: 120, seed0: 60000, opt: {}, level: 'basic' }
];

let total = 0, msSum = 0, msMax = 0;
for (const S of SETS) {
  const t0 = Date.now();
  for (let i = 0; i < S.n; i++) {
    const seed = S.seed0 + i;
    const p = decorate(gen(seed, S.opt), seed);
    if (S.tap) { const R = rng(seed); const d = p.panels.filter((b) => b.kind !== 'MDB' && b.parent === 'MDB'); if (d.length) { d[Math.floor(R() * d.length)].tap = 'ahead_of_main'; if (d.length > 1 && R() < 0.3) d[Math.floor(R() * d.length)].tap = 'ahead_of_main'; } }   // ต่อก่อนเมนสวิตช์ : ตรวจ invariants เดิมทั้งชุด (CB ประธาน/สายประธานตามดีมานด์ที่ไม่รวม/รวมแผง tap)
    if (S.pattern) p.meta.phasePattern = S.pattern;
    const res = check(seed, p, S.level);
    total++;
    if (res) { msSum += res.ms; msMax = Math.max(msMax, res.ms); }
  }
  console.log(`  [${S.name}] ${S.n} โครงการ ใช้เวลา ${((Date.now() - t0) / 1000).toFixed(1)} วินาที`);
}

// ---- ค่าเสียแบบสุ่ม: โครงการรูปแบบถูกต้องแต่ค่าบางช่องเป็นขยะ (ติดลบ, ใหญ่มาก, ข้อความ, null, อาร์เรย์ ...) ต้องไม่ throw ไม่ได้ NaN/Inf ----
const GARB = [-1, 0, -1e9, 1e9, 1e308, 0.0001, 'abc', '', null, true, false, [], {}, [3], { a: 1 }, '12', ' 7 ', -0.5, 99999999999, 2.7];
function garbage(seed) {
  const R = rng(seed * 31 + 7);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const p = clone(gen(seed, { real: R() < 0.5, sane: R() < 0.5, big: R() < 0.1 }));
  Object.keys(p.meta).forEach((k) => { if (R() < 0.08) p.meta[k] = pick(GARB); });
  ['branch', 'feeder', 'main', 'hv'].forEach((k) => { if (p.meta[k] && typeof p.meta[k] === 'object') Object.keys(p.meta[k]).forEach((kk) => { if (R() < 0.08) p.meta[k][kk] = pick(GARB); }); });
  p.panels.forEach((b) => ['name', 'kind', 'phases', 'parent', 'feederLength', 'ways', 'nonlinear', 'balance', 'spareCount', 'phase', 'feederSpec', 'location'].forEach((k) => { if (R() < 0.06) b[k] = pick(GARB); }));
  p.items.forEach((it) => Object.keys(it).filter((k) => k !== 'id').forEach((k) => { if (R() < 0.08) it[k] = pick(GARB); }));
  return p;
}
{
  const N = 500, bad = { crash: [], nan: [], mut: [], det: [], internal: [] };
  for (let seed = 1; seed <= N; seed++) {
    const p = garbage(seed), before = JSON.stringify(p);
    let r;
    try { r = E.calculate(p); } catch (e) { bad.crash.push(seed + ': ' + e.message + ' @ ' + String(e.stack).split(String.fromCharCode(10))[1]); continue; }
    if (JSON.stringify(p) !== before) bad.mut.push(seed);
    const b = findBad(r); if (b) bad.nan.push(seed + ': ' + b);
    if (r.panels.reduce((n, x) => n + x.circuits.length, 0) <= 2000 && JSON.stringify(r) !== JSON.stringify(E.calculate(JSON.parse(before)))) bad.det.push(seed); // โครงการใหญ่มากข้ามการเทียบผลซ้ำ (ช้า)
    if (r.warnings.some((w) => /ข้อผิดพลาดภายใน/.test(w))) bad.internal.push(seed + ': ' + r.warnings.filter((w) => /ข้อผิดพลาดภายใน/.test(w)).join(' | '));
  }
  total += N;
  for (const [k, label] of [['crash', 'ไม่ throw'], ['nan', 'ไม่มี NaN/Infinity/undefined'], ['mut', 'ไม่แก้ข้อมูลเข้า'], ['det', 'ผลซ้ำได้'], ['internal', 'ไม่มีข้อผิดพลาดภายใน']]) {
    if (bad[k].length) report(false, `fuzz ค่าเสีย ${N} โครงการ: ${label}`, `${bad[k].length} ครั้ง เช่น ${bad[k][0]}`);
    else report(true, `fuzz ค่าเสีย ${N} โครงการ: ${label}`);
  }
}

const names = [...SEEN].sort();
for (const n of names) {
  const f = FAIL[n];
  if (!f) report(true, `fuzz ${n}`);
  else report(false, `fuzz ${n}`, `${f.count} ครั้ง ครั้งแรก seed ${f.first.seed}: ${String(f.first.msg).slice(0, 220)}`);
}
test(`fuzz จำนวนโครงการ ≥ 400 (ทดสอบ ${total}) และเวลาคำนวณเฉลี่ย ${(msSum / total).toFixed(1)} ms (สูงสุด ${msMax} ms)`, () => {
  assert(total >= 400, `total ${total}`);
  assert(msMax < 1500, `โครงการเดียวใช้ ${msMax} ms`);
});
test('fuzz ทุก invariant ถูกตรวจจริง (ไม่ว่างเปล่า)', () => {
  assert(names.length >= 60, `มี ${names.length} invariants`);
  return `${names.length} invariants`;
});

done();
