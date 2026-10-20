// ทดสอบตัวล้าง/ตรวจโครงการ (public/js/sanitize.js) — กันไฟล์โครงการ/localStorage ที่เสียหรือแฝง HTML
globalThis.self = globalThis;
globalThis.LS_DATA = require('../public/js/data.js');
globalThis.LoadEngine = require('../public/js/engine.js');
require('../public/js/sample.js');
const S = require('../public/js/sanitize.js');
const E = globalThis.LoadEngine;

let fail = 0;
function ok(name, cond, extra) {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + (extra === undefined ? '' : JSON.stringify(extra))}`);
}
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const PAYLOAD = '"><img src=x onerror=alert(1)>';
const hasMarkup = (v) => /[<>"'`]/.test(String(v));
const walk = (o, f, path = '') => { if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], f, path + '.' + k); else f(o, path); };

const sample = () => globalThis.SAMPLE_PROJECT();

// 1) โครงการตัวอย่างต้องผ่านโดยไม่เปลี่ยนความหมาย (คำนวณแล้วได้ผลเท่าเดิม)
{
  const raw = sample();
  const { project, notes } = S.project(clone(raw));
  const a = E.calculate(raw), b = E.calculate(project);
  ok('sample: ไม่มีหมายเหตุการแก้ไข', notes.length === 0, notes);
  ok('sample: Connected เท่าเดิม', Math.round(a.totals.connected) === Math.round(b.totals.connected), [a.totals.connected, b.totals.connected]);
  ok('sample: Demand เท่าเดิม', Math.round(a.totals.demand) === Math.round(b.totals.demand));
  ok('sample: จำนวนแผง/รายการเท่าเดิม', project.panels.length === raw.panels.length && project.items.length === raw.items.length);
}

// 2) ไฟล์ที่ไม่ใช่โครงการ → โยน error ภาษาไทย
ok('ไม่ใช่ object → error', throws(() => S.project(null)) && throws(() => S.project('x')) && throws(() => S.project(42)));
ok('ไม่มี panels → error', throws(() => S.project({ items: [] })));
ok('ไม่มี items → error', throws(() => S.project({ panels: [] })));
ok('panels ไม่ใช่ array → error', throws(() => S.project({ panels: {}, items: [] })));
ok('{} จาก localStorage → error (ไม่ทำให้หน้าเว็บตาย)', throws(() => S.project({})));

// 3) XSS: ข้อมูลแฝง HTML ต้องไม่รอดไปยังตัวเลข/ตัวเลือก/ไอดี
{
  const raw = sample();
  raw.panels[1].feederLength = PAYLOAD;
  raw.panels[1].id = 'LP1' + PAYLOAD;
  raw.items.forEach((it) => { if (it.panelId === 'LP1') it.panelId = raw.panels[1].id; });
  raw.items[0].id = 'i1' + PAYLOAD;
  raw.items[0].qty = PAYLOAD;
  raw.items[0].evil = PAYLOAD;
  raw.meta.feeder.cable = PAYLOAD; raw.meta.hvKV = PAYLOAD; raw.meta.branch.conduit = PAYLOAD;
  raw.meta.cbLight = PAYLOAD; raw.meta.recVA = PAYLOAD; raw.meta.date = PAYLOAD; raw.meta.growth = PAYLOAD; raw.meta.ambientAir = PAYLOAD;
  raw.meta.buildingType = PAYLOAD; raw.meta.utility = PAYLOAD; raw.meta.supply = PAYLOAD; raw.meta.main.method = PAYLOAD;
  const { project } = S.project(raw);
  ok('feederLength แฝง HTML → เป็นตัวเลข', typeof project.panels.find((p) => p.name === raw.panels[1].name).feederLength === 'number');
  const ids = [...project.panels.map((p) => p.id), ...project.items.map((i) => i.id), ...project.panels.map((p) => p.parent).filter(Boolean), ...project.items.map((i) => i.panelId)];
  ok('id/parent/panelId ไม่มี < > " \' `', ids.every((v) => !hasMarkup(v)), ids.filter(hasMarkup));
  ok('item.qty แฝง HTML → ตัวเลข', typeof project.items[0].qty === 'number' && Number.isFinite(project.items[0].qty));
  ok('คีย์แปลกในอุปกรณ์ถูกตัดทิ้ง', !('evil' in project.items[0]));
  const m = project.meta;
  ok('meta enum แฝง HTML → กลับเป็นค่าเริ่มต้น', ['feeder.cable', 'branch.conduit', 'main.method'].every((p) => { const [a, b] = p.split('.'); return !hasMarkup(m[a][b]); }) && !hasMarkup(m.buildingType) && !hasMarkup(m.utility) && !hasMarkup(m.supply), m);
  ok('meta ตัวเลขแฝง HTML → ตัวเลข', ['hvKV', 'cbLight', 'recVA', 'growth', 'ambientAir'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k])), [m.hvKV, m.cbLight, m.recVA, m.growth, m.ambientAir]);
  ok('meta.date แฝง HTML → รูปแบบวันที่', /^\d{4}-\d{2}-\d{2}$/.test(m.date), m.date);
  let bad = [];
  walk(project, (v, p) => { if (typeof v === 'string' && /[<>]/.test(v) && !/name|location|owner|designer|checker/.test(p)) bad.push(p); });
  ok('ไม่มีสตริงที่มี < > นอกช่องข้อความอิสระ', bad.length === 0, bad);
  ok('คำนวณได้หลังล้าง (ไม่ throw)', !throws(() => E.calculate(project)));
}

// 4) ค่าสุดโต่งถูกจำกัด
{
  const raw = sample();
  raw.items.push({ id: 'big', panelId: 'PB', type: 'lift', qty: 1e9, length: 1e9, preset: 9999 });
  raw.items.push({ id: 'neg', panelId: 'LP1', type: 'rec', points: -5, qty: -3, length: -10 });
  raw.items.push({ id: 'pts', panelId: 'LP1', type: 'rec', points: 1e7 });
  raw.items.push({ id: 'fx', panelId: 'LP1', type: 'light', lamp: 'ไม่มีรหัสนี้', fixtures: 1e9, perFixture: 1e6 });
  const { project } = S.project(raw);
  const g = (id) => project.items.find((i) => i.id === id);
  ok('qty ใหญ่เกิน → จำกัด ≤ 2000', g('big').qty <= 2000 && g('big').qty >= 1, g('big'));
  ok('length เกิน → จำกัด ≤ 2000', g('big').length <= 2000 && g('big').length >= 1);
  ok('preset เกินตาราง → อยู่ในช่วงตาราง', g('big').preset >= 0 && g('big').preset < globalThis.LS_DATA.LIFTS.length, g('big').preset);
  ok('ค่าติดลบ → ≥ 1', g('neg').points >= 1 && g('neg').qty >= 1 && g('neg').length >= 1, g('neg'));
  ok('points เกิน → ≤ 5000', g('pts').points <= 5000);
  ok('lamp ไม่มีในตาราง → ใช้ค่าเริ่มต้น', globalThis.LS_DATA.LAMPS.some((l) => l.id === g('fx').lamp), g('fx').lamp);
  ok('fixtures/perFixture เกิน → จำกัด', g('fx').fixtures <= 20000 && g('fx').perFixture <= 12);
  const t0 = Date.now();
  let r; try { r = E.calculate(project); } catch (e) { r = null; }
  ok('โครงการสุดโต่งคำนวณไม่ค้าง (< 5 วินาที)', Date.now() - t0 < 5000, Date.now() - t0);
}

// 5) โครงสร้างแผง: ซ่อมให้ถูกต้อง ไม่ทิ้งงานผู้ใช้
{
  const raw = sample();
  raw.items.push({ id: 'ghost', panelId: 'NOPE', type: 'rec', points: 4 });
  raw.items.push({ id: 'weird', panelId: 'LP1', type: 'toaster' });
  const r1 = S.project(raw);
  ok('อุปกรณ์ที่ชี้แผงไม่มีอยู่ → ตัดออกพร้อมหมายเหตุ', !r1.project.items.some((i) => i.id === 'ghost') && r1.notes.some((n) => /ghost|แผงที่ไม่มี|ไม่พบแผง/.test(n)), r1.notes);
  ok('ชนิดอุปกรณ์ไม่รู้จัก → ตัดออกพร้อมหมายเหตุ', !r1.project.items.some((i) => i.id === 'weird') && r1.notes.length >= 2, r1.notes);

  const c = sample();
  c.panels.find((p) => p.id === 'SDB2').parent = 'LP2';       // วน: SDB2 → LP2 → SDB2
  const r2 = S.project(c);
  const mdb = r2.project.panels.find((p) => p.kind === 'MDB');
  const reach = (id, seen = new Set()) => { const p = r2.project.panels.find((x) => x.id === id); if (!p || seen.has(id)) return false; if (p.kind === 'MDB') return true; seen.add(id); return reach(p.parent, seen); };
  ok('ลูปของแผงถูกตัด ทุกแผงสืบไปถึง MDB ได้', r2.project.panels.every((p) => reach(p.id)), r2.project.panels.map((p) => [p.id, p.parent]));
  ok('คำนวณได้หลังซ่อมลูป', !throws(() => E.calculate(r2.project)));

  const d = sample();
  d.panels.push({ id: 'LP1', name: 'ซ้ำ', kind: 'LP', parent: 'MDB' });
  const r3 = S.project(d);
  const idsU = r3.project.panels.map((p) => p.id);
  ok('id แผงซ้ำ → ทำให้ไม่ซ้ำ', new Set(idsU).size === idsU.length, idsU);

  const e = sample();
  e.panels = e.panels.filter((p) => p.kind !== 'MDB');
  e.panels.forEach((p) => { if (p.parent === 'MDB') p.parent = null; });
  const r4 = S.project(e);
  ok('ไม่มี MDB → สร้างให้ 1 แผง', r4.project.panels.filter((p) => p.kind === 'MDB').length === 1);

  const f = sample();
  f.panels.push({ id: 'M2', name: 'MDB2', kind: 'MDB', parent: null });
  const r5 = S.project(f);
  ok('MDB เกิน 1 → เหลือ 1', r5.project.panels.filter((p) => p.kind === 'MDB').length === 1);

  const g = sample();
  g.panels.find((p) => p.id === 'LP2').parent = 'LP1';        // แผงย่อยเป็นแม่ไม่ได้
  const r6 = S.project(g);
  ok('แม่เป็น LP → ย้ายไป MDB', r6.project.panels.find((p) => p.id === 'LP2').parent === mdb.id);
}

// 6) ไฟล์รุ่นเก่า: meta ไม่ครบ
{
  const raw = sample();
  delete raw.meta.main; delete raw.meta.hv; delete raw.meta.branch.method; raw.meta.spareRatio = 'abc';
  const { project } = S.project(raw);
  ok('meta ที่ขาดถูกเติมค่าเริ่มต้น', project.meta.main && project.meta.main.cable && project.meta.hv && project.meta.branch.method && project.meta.spareRatio === E.defaultMeta().spareRatio, project.meta);
  ok('เมนู Settings ไม่พัง: meta.main.maxSize เป็นตัวเลข', typeof project.meta.main.maxSize === 'number');
}

// 7) idempotent + ไม่แก้ input
{
  const raw = sample(); raw.items[0].qty = 5000; raw.panels[1].id = 'a b';
  const snap = JSON.stringify(raw);
  const a = S.project(raw);
  ok('ไม่แก้ข้อมูลต้นทาง', JSON.stringify(raw) === snap);
  const b = S.project(clone(a.project));
  ok('ล้างซ้ำได้ผลเดิม (idempotent)', JSON.stringify(a.project) === JSON.stringify(b.project) && b.notes.length === 0, b.notes);
}

// 8) ฟิลด์ใหม่ของ Balance/Spare/เฟสแผง 1 เฟส ผ่านได้และถูกจำกัด
{
  const raw = sample();
  raw.panels[1].balance = 'deep'; raw.panels[1].spareCount = 3; raw.panels[2].phase = 1; raw.panels[2].phases = 1;
  raw.panels[3].balance = PAYLOAD; raw.panels[3].spareCount = -4; raw.panels[3].phase = 9;
  const { project } = S.project(raw);
  const P = (n) => project.panels.find((p) => p.name === n);
  ok('balance=deep, spareCount, phase ที่ถูกต้องคงอยู่', P('LP-1').balance === 'deep' && P('LP-1').spareCount === 3 && P('LA-1').phase === 1, [P('LP-1'), P('LA-1')]);
  ok('balance/spareCount/phase ที่ผิด → ตัดหรือจำกัด', !P('SDB-2').balance && (P('SDB-2').spareCount === '' || P('SDB-2').spareCount === undefined || P('SDB-2').spareCount >= 0) && (P('SDB-2').phase === undefined || P('SDB-2').phase === '' || [0, 1, 2].includes(P('SDB-2').phase)), P('SDB-2'));
}

{
  const p0 = sample();
  p0.items[0].cbOv = { 1: 32, 2: 33, x: 20, 0: 16, 9999: 20, 3: '40' };
  const out = S.project(p0).project;
  const ov = out.items[0].cbOv;
  ok('cbOv: เก็บเฉพาะขนาด MCB มาตรฐานและลำดับ 1..500', ov && ov[1] === 32 && ov[3] === 40 && !('2' in ov) && !('x' in ov) && !('0' in ov) && !('9999' in ov), ov);
  const p1 = sample(); p1.items[0].cbOv = { 1: 33 };
  ok('cbOv: ไม่เหลือค่าใช้ได้ → ตัด cbOv ทิ้ง', !('cbOv' in S.project(p1).project.items[0]));
  const p2 = sample(); p2.items[0].cbOv = 'x';
  ok('cbOv: ไม่ใช่ object → ตัดทิ้ง', !('cbOv' in S.project(p2).project.items[0]));
}

{
  const p0 = sample();
  p0.items[0].phOv = { 1: 0, 2: 2, 3: '1', 4: 3, 5: -1, 6: 1.5, 7: '', 8: null, 9: true, x: 1, 0: 1, 9999: 2 };
  const pv = S.project(p0).project.items[0].phOv;
  ok('phOv: เก็บเฉพาะ 0/1/2 และลำดับ 1..500', pv && pv[1] === 0 && pv[2] === 2 && pv[3] === 1 && Object.keys(pv).length === 3, pv);
  const p1 = sample(); p1.items[0].phOv = { 1: 7 };
  ok('phOv: ไม่เหลือค่าใช้ได้ → ตัดทิ้ง', !('phOv' in S.project(p1).project.items[0]));
  const p2 = sample(); p2.items[0].phOv = [0, 1];
  ok('phOv: เป็น array → ตัดทิ้ง', !('phOv' in S.project(p2).project.items[0]));
}


// 13) ชั้นของแผง: ชั้นลอย M = 1.5 (ไม่ปัดเป็นชั้น 2) ; G = 1 ; B/B1/B2 ติดลบ ; ใช้คำนวณ riser ได้ตรงกับ engine
{
  const flOf = (v) => { const q = sample(); q.panels[1].floor = v; const r = S.project(q).project.panels[1]; return r.floor; };
  ok('floor: M / MEZZ / MEZZANINE → 1.5', flOf('M') === 1.5 && flOf('mezz') === 1.5 && flOf('Mezzanine') === 1.5, [flOf('M'), flOf('mezz')]);
  ok('floor: G → 1, B → -1, B2 → -2, ตัวเลขเต็มคงเดิม', flOf('G') === 1 && flOf('B') === -1 && flOf('B2') === -2 && flOf(5) === 5 && flOf(-3) === -3);
  ok('floor: ปัดเป็นขั้น 0.5 (1.4 → 1.5, 2.2 → 2)', flOf(1.4) === 1.5 && flOf(2.2) === 2, [flOf(1.4), flOf(2.2)]);
}

console.log(fail ? `\n${fail} ข้อไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(fail ? 1 : 0);
