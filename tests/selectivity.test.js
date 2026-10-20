// Selectivity (การเลือกตัด) ประเมินเบื้องต้นแบบกฎ — engine checkSelectivity → result.panels[].selectivity
// เกณฑ์ (data.js SELECTIVITY): In ต้นทาง/ปลายทาง ≥ 1.6 (สมบูรณ์เมื่อ ≥ 2) และ Ik" ที่บัสแผงต้นทาง ≤ ค่าตัดทันทีต้นทาง (≈ k × In)
const { E, D, proj, P, I, gen } = require('./helpers/build.js');
const { test, assert, eq, near, done } = require('./helpers/eng-harness.js');

const S = D.SELECTIVITY;
// ไฟล์นี้ทดสอบ "ตัวตรวจ" selectivity และ guard (วงจรที่ประสานไม่ดีโดยตั้งใจ) จึงปิด Auto-Selectivity ของ designFeeder ; พฤติกรรม auto อยู่ใน master-engine.test.js
const calc = (opts) => E.calculate(proj(Object.assign({}, opts, { meta: Object.assign({ autoSelectivity: false }, opts && opts.meta) })));
const board = (r, id) => r.panels.find((b) => b.id === id);
const upOf = (r, p) => (p.feeder ? p.feeder.cb : r.service.mainCB);
const instKA = (cb) => { const k = S.instMult[cb.type]; return k == null ? S.acbIcwKA : k * cb.at / 1000; };
const load3P = (pid, va, qty) => I(pid, { type: 'custom', va, phases: 3, continuous: true, qty: qty || 1, cat: 'other' });

test('data.js มีสมมติฐาน selectivity ครบ (1.6 / 2 / MCCB 10×In / MCB 5×In)', () => {
  eq([S.ratioMin, S.ratioTotal, S.instMult.MCCB, S.instMult.MCB], [1.6, 2, 10, 5]);
  assert(S.acbIcwKA > 0);
});

/* ---------- 1) โซ่ที่ประสานดี: In ห่างกัน ≥ 2 เท่า, กระแสลัดวงจรต่ำ → total ---------- */
const chain = () => calc({
  meta: { supply: 'lv', utility: 'MEA', serviceKA: 1, buildingType: 'other' },
  panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB'), P('SDB2', 'SDB', 'MDB'), P('SDB3', 'SDB', 'MDB')],
  items: ['SDB1', 'SDB2', 'SDB3'].map((id) => load3P(id, 20000, 3))
});
test('โซ่ที่ประสานดี: ทุกคู่ใน MDB และ SDB เป็น total', () => {
  const r = chain();
  const pairs = r.panels.flatMap((p) => p.selectivity.map((s) => Object.assign({ at: p.id }, s)));
  assert(pairs.length >= 6, 'จำนวนคู่ ' + pairs.length);
  const bad = pairs.filter((s) => s.status !== 'total');
  assert(!bad.length, JSON.stringify(bad.map((s) => [s.at, s.up, s.down, s.ratio.toFixed(2), s.ikKA.toFixed(2), s.status])));
  assert(pairs.every((s) => s.ratio >= S.ratioTotal && s.ikKA <= s.limitKA), 'ratio/Ik');
});
test('โซ่ที่ประสานดี: MDB มีคู่ CB ประธาน → CB สายป้อนแผงลูก ครบ 3 แผง', () => {
  const r = chain(), m = board(r, 'MDB');
  const fd = m.selectivity.filter((s) => s.kind === 'feeder');
  eq(fd.map((s) => s.to).sort(), ['SDB1', 'SDB2', 'SDB3']);
  assert(fd.every((s) => s.up === `${r.service.mainCB.at}A ${r.service.mainCB.type}`), fd[0].up);
});
test('โซ่ที่ประสานดี: ไม่มีคำเตือน selectivity', () => {
  const w = chain().warnings.filter((x) => /selectivity/.test(x));
  eq(w, []);
});

/* ---------- 2) CB ขนาดเท่ากัน → none ---------- */
test('CB วงจรย่อยขนาดเท่า CB สายป้อนแผง → none + คำเตือนภาษาไทย', () => {
  // ฮีตเตอร์ 3,500 W × 6 ในแผง 3 เฟส: CB วงจรย่อย 20 A, CB สายป้อน 20 A
  const r = calc({ meta: { supply: 'lv', utility: 'MEA', serviceKA: 10 }, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: Array.from({ length: 6 }, () => I('LP1', { type: 'heater', watt: 3500 })) });
  const lp = board(r, 'LP1'), fAt = lp.feeder.cb.at;
  const s = lp.selectivity.find((x) => x.down === `${fAt}A MCB`);
  assert(s, `CB สายป้อน ${fAt} A: ` + JSON.stringify(lp.selectivity.map((x) => x.down)));
  near(s.ratio, 1, 1e-9);
  eq([s.status, s.limitKA, s.count], ['none', null, 6]);
  // ฮีตเตอร์ 15.2 A × 1.25 = 19 A → CB ย่อยเล็กกว่า 20 A ไม่ได้ → แนะนำขยายเมนแผง ≥ 20 × 1.6 = 32 A
  const w = r.warnings.filter((x) => x.startsWith('LP1:') && /คำเตือนการเลือกตัด/.test(x));
  assert(w.length === 1 && /วงจรย่อยใช้ CB 20 A เทียบกับเมนแผง 20 A \(อัตราส่วน 1 < 1\.6\)/.test(w[0]) && /\(6 วงจร\)/.test(w[0]), w.join(' | '));
  assert(s.rec && s.rec.at === null && s.rec.enlargeMain >= 32 && w[0].includes(`ขยายเมนแผงเป็น ${s.rec.enlargeMain} A`), JSON.stringify(s.rec));
});
test('MDB ป้อนแผงเดียวรับโหลดทั้งหมด: CB ประธานใกล้เคียง CB สายป้อน → none', () => {
  const r = calc({ meta: { supply: 'lv', utility: 'MEA', serviceKA: 10 }, panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB')], items: [load3P('SDB1', 20000, 4)] });
  const s = board(r, 'MDB').selectivity.find((x) => x.to === 'SDB1');
  assert(s.ratio < S.ratioMin && s.status === 'none', JSON.stringify(s));
});

/* ---------- 3) ใกล้หม้อแปลง กระแสลัดวงจรสูง → partial ถึงค่าตัดทันทีต้นทาง ---------- */
test('ใกล้หม้อแปลง: Ik" ที่ MDB > 10×In ต้นทาง → partial, limit = k×In ต้นทาง', () => {
  const r = calc({
    meta: { supply: 'transformer', utility: 'PEA', sourceKA: 0, buildingType: 'other', main: { length: 1 } },
    panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 30 })],
    items: [load3P('MDB', 30000, 25), I('LP1', { type: 'rec', points: 8 })]
  });
  const m = board(r, 'MDB'), up = r.service.mainCB;
  assert(up.type === 'MCCB', up.label);
  const lim = instKA(up);
  near(lim, 10 * up.at / 1000, 1e-9);
  assert(m.sc.Ik > lim, `Ik ${m.sc.Ik} ≤ ${lim}`);
  const s = m.selectivity.find((x) => x.to === 'LP1');
  assert(s.ratio >= S.ratioTotal, 'ratio ' + s.ratio);
  eq(s.status, 'partial');
  near(s.limitKA, lim, 1e-9, 'limitKA');
  near(s.ikKA, m.sc.Ik, 1e-9, 'ikKA = Ik" ที่ MDB');
  assert(/เลือกตัดได้ถึง/.test(s.note), s.note);
  assert(r.warnings.some((w) => w.startsWith('MDB:') && /เลือกตัดบางส่วน/.test(w)), 'ไม่มีคำเตือน MDB');
});
test('อัตราส่วน 1.6–2 และ Ik ต่ำ → partial (marginal) ไม่มี limitKA', () => {
  let seen = 0;
  // กรณีนี้เกิดน้อย (Ik ต่ำกว่าค่าตัดทันทีต้นทาง) — สุ่มให้กว้างพอ (เดิม 300 เมล็ด; หลังแก้สายป้อนตามสมการ 8-7/เฟสไม่สมดุลต้องใช้ ~600+)
  for (let seed = 1; seed <= 1200; seed++) {
    const g = E.calculate(gen(seed, { real: true, sane: true }));
    for (const p of g.panels) for (const s of p.selectivity) {
      if (s.ratio >= S.ratioMin && s.ratio < S.ratioTotal && s.ikKA <= instKA(upOf(g, p))) { seen++; assert(s.status === 'partial' && s.marginal && s.limitKA === null, JSON.stringify(s)); }
    }
  }
  assert(seen > 0, 'ไม่พบคู่ใกล้ขอบในโครงการสุ่ม');
  return `พบ ${seen} คู่`;
});

/* ---------- 4) โครงการสุ่ม ~200 seed: ไม่มี NaN, สถานะถูกต้อง ---------- */
test('โครงการสุ่ม 200 seed: selectivity ไม่มี NaN และสอดคล้องกฎ', () => {
  let pairs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = E.calculate(gen(seed, { orphans: true }));
    for (const p of r.panels) {
      assert(Array.isArray(p.selectivity), `seed ${seed} ${p.id}: ไม่มี selectivity`);
      for (const s of p.selectivity) {
        pairs++;
        const tag = `seed ${seed} ${p.id} ${JSON.stringify(s)}`;
        assert(Number.isFinite(s.ratio) && s.ratio > 0 && Number.isFinite(s.ikKA) && s.ikKA >= 0, tag);
        assert(s.limitKA === null || (Number.isFinite(s.limitKA) && s.limitKA > 0), tag);
        assert(['total', 'partial', 'none'].includes(s.status), tag);
        assert(!/NaN|undefined/.test(s.up + s.down + s.note), tag);
        assert(Number.isInteger(s.count) && s.count >= 1, tag);
        if (s.ratio < S.ratioMin) assert(s.status === 'none', tag);
        if (s.status === 'total') assert(s.ratio >= S.ratioTotal && s.ikKA <= s.limitKA + 1e-9, tag);
        if (s.status === 'partial' && s.limitKA !== null) assert(s.ikKA > s.limitKA, tag);
      }
    }
    assert(!r.warnings.some((w) => /ข้อผิดพลาดภายใน \(selectivity\)/.test(w)), `seed ${seed}: ` + r.warnings.find((w) => /selectivity\)/.test(w)));
  }
  return `${pairs} คู่`;
});

/* ---------- Selective Coordination Guard: วงจรย่อยถูกปรับเป็น 20 A ในแผงเมน 30 A ---------- */
// เต้ารับ 70 จุด → เมนแผง (CB สายป้อน LP1) 30 A ; วงจรที่ 1 ผู้ใช้ปรับเป็น 20 A (cbOv)
const guard = (ov) => calc({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [I('LP1', Object.assign({ type: 'rec', points: 70 }, ov ? { cbOv: ov } : {}))] });
test('GUARD-1 วงจรย่อย 20 A ใต้เมนแผง 30 A → ไม่เลือกตัด (none) + คำเตือนแนะนำ 16 A', () => {
  const r = guard({ 1: 20 }), lp = board(r, 'LP1');
  eq(lp.feeder.cb.at, 30, 'เงื่อนไขตั้งต้น: เมนแผง 30 A');
  const s = lp.selectivity.find((x) => x.kind === 'branch' && x.down === '20A MCB');
  assert(s && s.status === 'none', JSON.stringify(s));
  eq(s.rec, { at: 16, enlargeMain: null });
  const msg = 'คำเตือนการเลือกตัด: วงจรย่อยใช้ CB 20 A เทียบกับเมนแผง 30 A (อัตราส่วน 1.5 < 1.6) — หากเกิดลัดวงจร เมนแผงอาจตัดพร้อมกัน แนะนำให้ใช้ 16 A';
  assert(s.warn && s.warn.includes(msg), s.warn);
  const ws = r.warnings.filter((w) => w.includes(msg));
  assert(ws.length === 1 && ws[0].startsWith('LP1: '), ws.join(' | '));
  assert(!r.warnings.some((w) => w.startsWith('LP1:') && /ไม่เลือกตัด \d+ วงจร/.test(w)), 'ห้ามซ้ำกับบรรทัดสรุปของแผง');
});
test('GUARD-2 ใช้ 16 A ตามค่าเริ่มต้น (30/16 = 1.88 ≥ 1.6) → ไม่มีคำเตือนการเลือกตัด', () => {
  const r = guard(null);
  assert(!r.warnings.some((w) => /คำเตือนการเลือกตัด/.test(w)), r.warnings.join(' | '));
  assert(board(r, 'LP1').selectivity.every((x) => x.status !== 'none'));
});
test('GUARD-3 ไม่มีขนาด CB ย่อยที่เลือกตัดได้และรับโหลดได้ → แนะนำขยายเมนแผงแทน', () => {
  // เต้ารับ 30 จุด → เมนแผง 15 A ; CB ย่อย 16 A: 15/16 < 1.6 และเล็กกว่า 16 A ไม่ได้ (ขั้นต่ำเต้ารับ) → เมนต้อง ≥ 16 × 1.6 = 25.6 → 30 A
  const r = calc({ panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB')], items: [I('LP1', { type: 'rec', points: 30 })] });
  const s = board(r, 'LP1').selectivity.find((x) => x.kind === 'branch' && x.down === '16A MCB');
  assert(s && s.status === 'none' && s.rec && s.rec.at === null && s.rec.enlargeMain === 30, JSON.stringify(s));
  assert(/แนะนำให้ขยายเมนแผงเป็น 30 A/.test(s.warn), s.warn);
});

test('GUARD-4 ตาราง C-09 (selectivityHTML) แสดงคำเตือนและขนาดที่แนะนำ', () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const ctx = { LoadEngine: E, LS_DATA: D }; ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/export.js'), 'utf8'), ctx);
  const html = ctx.Report.selectivityHTML(guard({ 1: 20 }));
  assert(html.includes('แนะนำให้ใช้ 16 A') && html.includes('วงจรย่อยใช้ CB 20 A เทียบกับเมนแผง 30 A'), html.slice(0, 600));
});

done();
