// เบรกเกอร์ตามยี่ห้อ — ข้อมูล (public/js/brands.js จาก tools/import-brands.js), ตัวคำนวณ (AT ตามรุ่น, IC = Icu/Icn, คำเตือน),
// selectivity จากข้อมูลรุ่น, การตรวจไฟล์โครงการ (sanitize) และการส่งออก
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { E, D, proj, P, I } = require('./helpers/build.js');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const B = require('../public/js/brands.js');
const BR = require('../public/js/brandcb.js');
const Sanitize = require('../public/js/sanitize.js');
const Tool = require('../tools/import-brands.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const panel = (r, id) => r.panels.find((p) => p.id === id);
const allCB = (r) => {
  const out = [r.service.mainCB];
  r.panels.forEach((p) => { if (p.feeder) out.push(p.feeder.cb); p.circuits.forEach((c) => c.cb && out.push(c.cb)); if (p.layout) p.layout.slots.forEach((s) => s && s.auto && out.push(s.cb)); });
  return out;
};
const brandWarn = (r) => r.warnings.filter((w) => /ยี่ห้อ/.test(w));
// แผงย่อย LP1 รับไฟจาก MDB (รับไฟแรงต่ำ MEA) ; n วงจร 2 kVA + 1 วงจร 3 kVA (CB 16 A × n, 20 A × 1)
const L1 = (pid, va, n, extra) => Array.from({ length: n }, () => I(pid, Object.assign({ type: 'custom', va, phases: 1, continuous: true, cat: 'other' }, extra || {})));
const small = (n, meta, brands) => {
  const p = proj({ meta: Object.assign({ supply: 'lv', utility: 'MEA', serviceKA: 10, buildingType: 'other', autoSelectivity: false /* ทดสอบข้อมูลยี่ห้อกับขนาดเมนเดิม ; Auto-Selectivity อยู่ใน master-engine.test.js */ }, meta || {}), panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 10 })], items: L1('LP1', 2000, n).concat(L1('LP1', 3000, 1)) });
  if (brands) p.meta.brands = clone(brands);
  return p;
};
const sample = () => { global.self = global; global.LS_DATA = D; global.LoadEngine = E; require('../public/js/sample.js'); return global.SAMPLE_PROJECT(); };

/* ================= 1) ข้อมูล ================= */
test('ข้อมูล: MCCB 582 รุ่น 15 ยี่ห้อ, MCB 39 + RCBO 24 รุ่น 11 ยี่ห้อ', () => {
  // MCB/RCBO: 28 → 63 แถว (แทน 10 แถวเดิมของ Schneider/ABB/Mitsubishi/Fuji ด้วย 45 แถวที่ยืนยันกับแคตตาล็อก — tests/brand-sources-mcb.test.js ; MCB 16 → 39, RCBO 12 → 24)
  eq([B.mccb.length, B.mcb.filter((m) => m.kind === 'MCB').length, B.mcb.filter((m) => m.kind === 'RCBO').length], [582, 39, 24]);   // รอบที่ 3: 484 → 582 (Susol TS1000–1600 +6, Hager h3+ 2→27, TemBreak PRO +67) ; รอบที่ 2: 372 → 484 (DRX 3→8, h3 4→11, WEG 5→12, NM1 4→18, HGD 2→HGM 30, Susol 6→24, TemBreak PRO 11→TemBreak 2 44) ; รอบแรก: 170 เดิม − 102 แถวเก่า (ComPacT NSX 7, Tmax XT 11, EasyPact EZC 8, Formula DSP 5, Mitsubishi WS-V 21, Legrand DPX3 4, Siemens 3VA 12 + 3VM 5, LS Metasol 5, Fuji G-TWIN 10, CHINT NM8N 6, EasyPact CVS 8) + 304 แถวที่ยืนยันกับแคตตาล็อก (tests/brand-sources.test.js)
  eq(new Set(B.mccb.map((m) => m.brandShort)).size, 15);
  eq(new Set(B.mcb.map((m) => m.brandShort)).size, 11);
  assert(B.meta.source && /ตรวจกับแคตตาล็อก/.test(B.meta.source), 'meta.source');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(B.meta.generatedAt), 'generatedAt');
});
test('ข้อมูล: ตรงกับ CSV ใน data/brands (จำนวนแถว/คอลัมน์)', () => {
  const rows = (f) => Tool.parseCSV(fs.readFileSync(path.join(__dirname, '../data/brands', f), 'utf8'));
  const a = rows('mccb.csv'), b = rows('mcb.csv');
  eq([a.length - 1, b.length - 1], [B.mccb.length, B.mcb.length]);
  assert(a.every((r) => r.length === 23) && b.every((r) => r.length === 19), 'จำนวนคอลัมน์ (MCCB = 20 เดิม + Source_ID/Source_Page/Source_Note ; MCB/RCBO = 16 เดิม + Source_ID/Source_Page/Source_Note)');
});
test('ข้อมูล: รหัสรุ่นไม่ซ้ำ (รวม MCCB + MCB)', () => {
  const ids = B.mccb.concat(B.mcb).map((m) => m.id);
  eq(new Set(ids).size, ids.length);
});
test('ข้อมูล MCCB: ตัวเลขครบ, AT เรียงและไม่เกิน AF, Ics ≤ Icu, selectivity ≤ Icu, ขั้ว 3/4', () => {
  const bad = B.mccb.filter((m) => !(m.af > 0 && m.at.length && m.at.every((a, i) => a > 0 && a <= m.af && (!i || a > m.at[i - 1]))
    && m.icu > 0 && m.ics > 0 && m.ics <= m.icu
    // รุ่นที่ยืนยันกับแคตตาล็อก: Ii เป็นขอบล่างจากตารางผู้ผลิต (≥ 4× — CVS630 600 A ปรับได้เริ่ม 4.2×In) หรือว่างทั้งคู่ถ้าปรับได้ ; selectivity ต่อ MCB ว่าง ; รุ่นอื่นต้องมีตามเดิม
    && (m.verified ? ((m.iiMult == null && m.iiMin == null) || (m.iiMult >= 4 && m.iiMin > 0)) && m.selMCB == null : (m.iiMult >= 5 && m.iiMin > 0 && m.selMCB >= 0 && m.selMCB <= m.icu))
    && m.poles.length && m.poles.every((x) => x === 3 || x === 4) && typeof m.ref === 'string' && m.ref));
  eq(bad.map((m) => m.id), []);
});
test('ข้อมูล MCB/RCBO: Icn ≤ Icu (ถ้ามี), เส้นโค้งตามตัวคูณแม่เหล็ก (รุ่นที่ยังไม่ยืนยัน = Type C 5–10× ; รุ่นที่ยืนยัน B/C/D ตามแคตตาล็อก), RCBO มี mA และ Type', () => {
  const bad = B.mcb.filter((m) => !(m.icn > 0 && (m.verified ? (m.icu == null || m.icu >= m.icn) : m.icu >= m.icn) && m.magMin > 0 && m.magMax > m.magMin
    && (m.verified || (m.magMin === 5 && m.magMax === 10)) && m.at.length && m.at[m.at.length - 1] <= 63
    && (m.kind === 'MCB' ? m.poles.includes(3) : m.withN && m.rcdMA === 30 && m.rcdTypes.length)));
  eq(bad.map((m) => m.id), []);
});
test('ข้อมูล: คอลัมน์ข้อความอิสระเก็บเป็นข้อความเท่านั้น (ไม่ใช้คำนวณ)', () => {
  // ใช้รุ่นที่ยังเป็นข้อมูลรวบรวม (ยังไม่ผูกแคตตาล็อก) เพราะรุ่นที่ยืนยันแล้วอาจว่าง Ii ถ้าแคตตาล็อกไม่ระบุเป็นตัวเลข
  const m = B.mccb.find((x) => !x.verified && x.iiMult > 0);
  assert(m, 'ต้องเหลือรุ่นที่ยังไม่ยืนยันอย่างน้อยหนึ่งรุ่น');
  eq([typeof m.iiText, typeof m.iiMinText, typeof m.selRule, typeof m.iiMult, typeof m.iiMin], ['string', 'string', 'string', 'number', 'number']);
});

/* ================= 2) ค่าเริ่มต้น = ทั่วไป ================= */
test('ทั่วไป: ไม่มี meta.brands → ไม่มีข้อมูลรุ่นใน CB ใด ๆ และไม่มีคำเตือนยี่ห้อ', () => {
  const r = E.calculate(sample());
  assert(allCB(r).every((cb) => !cb.bm), 'มี cb.bm');
  eq(brandWarn(r), []);
});
test('ทั่วไป: เลือก "ทั่วไป" (brand ว่าง) ได้ผลเท่ากับไม่ตั้งค่า', () => {
  const p = sample(), q = clone(p);
  q.meta.brands = { mcb: { brand: '', series: '' }, mccb: { brand: '' } };
  eq(JSON.stringify(E.calculate(q).panels), JSON.stringify(E.calculate(p).panels));
});

/* ================= 3) AT / AF / IC ตามรุ่น ================= */
const sch = { mcb: { brand: 'Schneider', series: 'Acti9' }, mccb: { brand: 'Schneider', series: 'ComPacT NSX' } };
test('AT: รุ่นไม่มี 30 A → ขยับเป็น 32 A + เตือน "ไม่มีขนาด"', () => {
  const p = small(6); const g = panel(E.calculate(p), 'LP1').feeder.cb;
  eq([g.at, g.type, g.bm], [30, 'MCCB', undefined]);
  p.meta.brands = sch;
  const r = E.calculate(p), f = panel(r, 'LP1').feeder;
  // เลือกระดับสมรรถนะต่ำสุดที่ IC ≥ Ik (กฎของ pick) — ข้อมูลที่ยืนยันกับแคตตาล็อกมีระดับ B (25 kA) แล้ว จึงได้ NSX100B แทน NSX100F (36 kA) ที่เคยเป็นรุ่นแรกในฐานข้อมูล
  eq([f.cb.at, f.cb.af, f.cb.label], [32, 100, 'Schneider NSX100B 32AT/100AF']);
  assert(r.warnings.some((w) => /LP1: CB ยี่ห้อ Schneider NSX100B: รุ่นนี้ไม่มีขนาด 30 A — ขยับขึ้นเป็น 32 A/.test(w)), brandWarn(r));
  assert(f.steps.some((s) => s.t === 'CB ตามยี่ห้อ') && f.steps.some((s) => s.t === 'รุ่น CB ตามยี่ห้อ' && /ตรวจกับแคตตาล็อก/.test(s.ref || '')), 'steps');
});
test('AT: สายวงจรย่อยคิดจาก AT ตามรุ่น (Ireq ≥ AT)', () => {
  const p = small(2); p.items.push(I('LP1', { type: 'custom', va: 6500, phases: 1, continuous: true, cat: 'other' }));   // 28.3 × 1.25 = 35 A → 40 A
  p.meta.brands = { mcb: { brand: 'Schneider', series: 'Acti9' } };
  const c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.va === 6500);
  eq([c.cb.at, c.cb.bm.model], [40, 'iC60N']);
  assert(c.Ireq >= 40, c.Ireq);
});
test('IC: MCCB = Icu ของรุ่น, MCB = Icn (IEC 60898) ของรุ่น', () => {
  const r = E.calculate(small(6, null, sch)), lp = panel(r, 'LP1');
  eq(lp.feeder.cb.ic, BR.find('Schneider|NSX100B').icu);
  const c = lp.circuits[0];
  eq([c.cb.bm.id, c.cb.ic, c.cb.label], ['Schneider|iC60N', 6, `Schneider iC60N ${c.cb.at}A`]);
});
const stiff = { serviceKA: 25, main: { cable: 'CV', method: 'g5', conduit: 'IMC', length: 3, maxSize: 300 } };
test('IC: เลือกรุ่นที่ Icn ≥ Ik ก่อน (Acti9: Ik > 6 kA → iC60H 10 kA)', () => {
  const lp = panel(E.calculate(small(6, stiff, sch)), 'LP1');
  assert(lp.sc.Ik > 6 && lp.sc.Ik <= 10, 'Ik ' + lp.sc.Ik);
  eq(lp.circuits[0].cb.bm.id, 'Schneider|iC60H');
});
test('ค่าโครงการ "ทุกซีรีส์" → เฟรมเล็กสุดที่มี AT และ Icu ≥ Ik', () => {
  const r = E.calculate(small(6, null, { mccb: { brand: 'Mitsubishi', series: '' } }));
  const cb = panel(r, 'LP1').feeder.cb;
  assert(cb.bm && cb.bm.brandShort === 'Mitsubishi' && cb.bm.af <= 63 && cb.bm.icu >= panel(r, 'MDB').sc.Ik, JSON.stringify(cb.bm && [cb.bm.model, cb.bm.af, cb.bm.icu]));
});

/* ================= 4) คำเตือน ================= */
test('เตือน: Icn < Ik ที่แผง → "อันตราย" (Easy9 มีแค่ 4.5 kA)', () => {
  const r = E.calculate(small(6, stiff, { mcb: { brand: 'Schneider', series: 'Easy9' } }));
  assert(panel(r, 'LP1').sc.Ik > 4.5, 'Ik');
  assert(r.warnings.some((w) => /^LP1 · .*อันตราย — CB ยี่ห้อ Schneider EZ9F .*Icn 4\.5 kA < Ik"/.test(w)), brandWarn(r));
});
test('เตือน: Ik > Ics (EZC100F Icu 10 kA, Ics 50% = 5 kA)', () => {
  // ฐานข้อมูลที่ยืนยันกับแคตตาล็อกมีระดับ B (Icu 7.5 kA, Ics 25%) ซึ่งตัวเลือกอัตโนมัติเลือกก่อน → กำหนด F รายตัวเพื่อทดสอบเงื่อนไข Ik > Ics ของ F
  const p0 = small(6, null, { mccb: { brand: 'Schneider', series: 'EasyPact EZC' } }); p0.panels[1].brOv = 'Schneider|EZC100F';
  const r = E.calculate(p0);
  const ik = panel(r, 'MDB').sc.Ik;
  assert(ik > 5 && ik <= 10, 'Ik ' + ik);
  eq(panel(r, 'LP1').feeder.cb.bm.id, 'Schneider|EZC100F');
  assert(r.warnings.some((w) => /LP1: CB ยี่ห้อ Schneider EZC100F 30 A: Ik" .* > Ics 5 kA \(50% ของ Icu\)/.test(w)), brandWarn(r));
});
test('EV: กรอง RCBO Type AC ออก — ยี่ห้อที่ไม่มี Type A/B/F (Mitsubishi BV-DN) ใช้ค่าทั่วไปคง RCD ไว้ + เตือน ; Schneider Type A ใช้ได้', () => {
  const p = small(2); p.items.push(I('LP1', { type: 'ev', preset: 0 }));
  p.meta.brands = { mcb: { brand: 'Mitsubishi', series: '' } };
  let c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.cat === 'ev');
  // BV-DN / BV-DN6 (Y-0713B 2209) เป็น Type AC ทั้งคู่ → ไม่เลือกรุ่น ; ห้ามถอยเป็น MCB (RCD 30 mA ต้องอยู่)
  eq([c.cb.rcd, !!c.cb.bm], [true, false]);
  assert(c.warn.some((w) => /ยี่ห้อ Mitsubishi ไม่มี RCBO \d+ A ที่เป็น RCD Type A\/B\/F/.test(w)), c.warn);
  p.meta.brands = { mcb: { brand: 'Schneider', series: 'Acti9' } };
  c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.cat === 'ev');
  eq(c.cb.bm.type, 'RCBO');
  assert(!c.warn.some((w) => /Type AC/.test(w)), c.warn);
});
test('EV: รุ่น Type AC ที่ผู้ใช้กำหนดเอง (brOv) ไม่ถูกกรอง — apply() เตือน Type AC', () => {
  const p = small(2); p.items.push(I('LP1', { type: 'ev', preset: 0, brOv: { 1: 'Mitsubishi|BV-DN6' } }));
  p.meta.brands = { mcb: { brand: 'Mitsubishi', series: '' } };
  const c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.cat === 'ev');
  eq(c.cb.bm.model, 'BV-DN6');
  assert(c.warn.some((w) => /Mitsubishi BV-DN6 เป็น Type AC — วงจรชาร์จรถไฟฟ้าต้องใช้ RCD Type A/.test(w)), c.warn);
});
test('เตือน: ยี่ห้อต่างกันต้นทาง–ปลายทาง → selectivity เกณฑ์ทั่วไป', () => {
  const r = E.calculate(small(6, null, { mcb: { brand: 'ABB', series: '' }, mccb: { brand: 'Schneider', series: 'ComPacT NSX' } }));
  assert(r.warnings.some((w) => /^LP1: ยี่ห้อ CB ต้นทาง \(Schneider\) ต่างจากปลายทาง \d+ วงจร \(ABB\) — selectivity ใช้เกณฑ์ทั่วไป/.test(w)), brandWarn(r));
  const sel = panel(r, 'LP1').selectivity;
  assert(sel.length && sel.every((s) => s.mixed && s.src === BR.SRC_GENERIC), JSON.stringify(sel.map((s) => [s.down, s.src])));
});
test('ทั่วไปสำรอง: วงจรต้องการ 80 A แต่ MCB ของยี่ห้อมีถึง 63 A → ใช้ค่าทั่วไป + เตือน', () => {
  const p = small(1); p.items.push(I('LP1', { type: 'custom', va: 14000, phases: 1, continuous: true, cat: 'other' }));
  p.meta.brands = { mcb: { brand: 'Schneider', series: 'Acti9' } };
  const c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.va === 14000);
  eq([c.cb.at, c.cb.bm, c.cb.label], [80, undefined, '80A']);
  assert(c.warn.some((w) => /ยี่ห้อ Schneider Acti9 ไม่มี CB 80 A \(มี 6–63 A\) — ใช้ค่าทั่วไป/.test(w)), c.warn);
});
test('กำหนดรายตัว: item.brOv / board.brOv / meta.brands.main ใช้รุ่นที่เลือก', () => {
  const p = small(6, null, sch);
  p.panels[1].brOv = 'Schneider|EZC100H';
  p.items[0].brOv = { 1: 'Schneider|iC60H' };
  p.meta.brands.main = 'Schneider|EZC100N';
  const r = E.calculate(p), lp = panel(r, 'LP1');
  eq([lp.feeder.cb.bm.id, lp.feeder.cb.bm.pinned, lp.circuits.find((c) => c.itemId === p.items[0].id).cb.bm.id, r.service.mainCB.bm.id], ['Schneider|EZC100H', true, 'Schneider|iC60H', 'Schneider|EZC100N']);
  assert(lp.circuits.filter((c) => c.itemId !== p.items[0].id).every((c) => c.cb.bm.id === 'Schneider|iC60N'), 'วงจรอื่นใช้ค่าโครงการ');
});
test('กำหนดรายตัว: รุ่นที่ชนิดไม่ตรง (MCCB ให้วงจร MCB) → ไม่ใช้ + เตือน', () => {
  const p = small(6, null, sch);
  p.items[0].brOv = { 1: 'Schneider|NSX100F' };
  const c = panel(E.calculate(p), 'LP1').circuits.find((x) => x.itemId === p.items[0].id);
  eq(c.cb.bm.id, 'Schneider|iC60N');
  assert(c.warn.some((w) => /ยี่ห้อ: รุ่นที่กำหนด "Schneider NSX100F \(ชนิด MCCB ใช้กับ CB MCB ไม่ได้\)"/.test(w)), c.warn);
});
test('ตัวอย่างโครงการ Schneider ทั้งระบบ: ไม่มีข้อผิดพลาดภายใน, ส่งผ่าน worker ได้', () => {
  const p = sample(); p.meta.brands = sch;
  const r = E.calculate(p);
  assert(!r.warnings.some((w) => /ข้อผิดพลาดภายใน/.test(w)), r.warnings);
  assert(allCB(r).filter((cb) => cb.bm).length > 20, 'จำนวน CB ที่มีรุ่น');
  const s = JSON.stringify(r); assert(s.length > 1000, 'serialize');
  assert(!JSON.stringify(r, (k, v) => (typeof v === 'function' ? 'FN' : v)).includes('"FN"'), 'มีฟังก์ชันในผลคำนวณ');
});

/* ================= 5) Selectivity ================= */
test('selectivity: EZC100F 30 A กับ MCB 20 A → ไม่เลือกตัด (อัตราส่วน 1.5 < 1.6 ยังเป็นปัญหาจริง)', () => {
  const p = small(6, null, { mcb: { brand: 'Schneider', series: 'Easy9' } }); p.panels[1].brOv = 'Schneider|EZC100F';
  const s = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^20A/.test(x.down));
  eq([s.up, s.down, s.status, s.src], ['30A Schneider EZC100F', '20A Schneider EZ9F', 'none', BR.SRC_BRAND]);
});
test('selectivity: รุ่นที่ยืนยันกับแคตตาล็อก (EZC100F) ไม่มีค่า selectivity ต่อ MCB → ไม่อ้างตัวเลขที่ไม่มีที่มา ใช้ค่าตัดทันทีทั่วไป (บางส่วน ≈ 0.3 kA)', () => {
  const p = small(6);
  const g = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^16A/.test(x.down));
  eq([g.status, g.limitKA, g.src], ['partial', 0.3, undefined]);
  p.meta.brands = { mcb: { brand: 'Schneider', series: 'Easy9' } }; p.panels[1].brOv = 'Schneider|EZC100F';
  const s = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^16A/.test(x.down));
  eq([s.status, s.limitKA, s.src], ['partial', 0.3, BR.SRC_BRAND]);   // เดิมข้อมูลรวบรวมอ้าง "total ถึง 6 kA" โดยไม่มีที่มาในแคตตาล็อก
  assert(!/ขีดจำกัด selectivity กับ MCB/.test(s.note), s.note);
});
test('selectivity: รุ่นที่ยังเป็นข้อมูลรวบรวมและมีค่าต่อ MCB (32 A กับ MCB 16 A ยี่ห้อเดียวกัน) → total ถึงค่า selMCB ที่ระบุ', () => {
  const u = ['Eaton|NZMN1-A', 'Hager|x160', 'LS|TD100N', 'CHINT|NM1-125S', 'Terasaki|S160-NJ', 'Legrand|DRX 125'].map((id) => B.mccb.find((x) => x.id === id)).find((x) => x && !x.verified && x.at.includes(32) && x.selMCB >= 10);
  assert(u, 'ต้องเหลือรุ่นที่ยังไม่ยืนยันที่มี selMCB สำหรับทดสอบ');
  const p = small(6, null, { mcb: { brand: u.brandShort, series: '' } }); p.panels[1].brOv = u.id;
  const s = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^16A/.test(x.down));
  eq([s.up, s.status, s.limitKA, s.src], ['32A ' + u.brandShort + ' ' + u.model, 'total', u.selMCB, BR.SRC_BRAND]);
  assert(new RegExp('ขีดจำกัด selectivity กับ MCB ' + u.brandShort + ' ≈ ' + u.selMCB + ' kA').test(s.note), s.note);
});
test('selectivity: ค่าตัดทันทีของรุ่น = max(Ii_Default_Mult × In, Min_Ii_Amp_Num)', () => {
  eq(BR.instKA({ at: 30, bm: { type: 'MCCB', iiMult: 10, iiMin: 500 } }), 0.5);
  eq(BR.instKA({ at: 125, bm: { type: 'MCCB', iiMult: 12, iiMin: 300 } }), 1.5);
  eq(BR.instKA({ at: 20, bm: { type: 'MCB', magMin: 5 } }), 0.1);
  eq(BR.instKA({ at: 20, type: 'MCB' }), null);
});
test('selectivity: trip อิเล็กทรอนิกส์ใช้อัตราส่วน 1.25 (3VA20 M 25 A กับ MCB 20 A ผ่านอัตราส่วน, TM 3VA10 B ไม่ผ่าน)', () => {
  const p = small(5, null, { mcb: { brand: 'Siemens', series: '' } });
  p.panels[1].brOv = 'Siemens|3VA20 M';
  let s = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^20A/.test(x.down));
  // 3VA20 M ผูกแคตตาล็อกแล้ว แต่แคตตาล็อกไม่ให้ตัวเลข Ii/selectivity ต่อ MCB (เว้นว่าง ไม่เดา) → ขีดตัดทันทีใช้ค่าทั่วไป 10×In ของแอป: อัตราส่วน 1.25 ผ่านแต่ Ik สูงกว่าขีดจึงเป็น 'partial' (เดิมข้อมูลที่รวบรวมเองอ้าง total ถึง 36 kA ซึ่งตรวจกับแคตตาล็อกไม่ได้)
  eq([s.up, s.ratio, s.status], ['25A Siemens 3VA20 M', 1.25, 'partial']);
  p.panels[1].brOv = 'Siemens|3VA10 B';
  s = panel(E.calculate(p), 'LP1').selectivity.find((x) => /^20A/.test(x.down));
  eq(s.status, 'none');
});
test('selectivity: คำเตือนระบุแหล่งข้อมูล (ข้อมูลผู้ผลิต vs ประเมินเบื้องต้น)', () => {
  const p = small(13, null, { mcb: { brand: 'Schneider', series: 'Easy9' } }); p.panels[1].brOv = 'Schneider|EZC100F';
  assert(E.calculate(p).warnings.some((w) => /^LP1: selectivity .*\(ข้อมูลผู้ผลิต — ตรวจกับแคตตาล็อก\)$/.test(w)), 'brand');
  assert(E.calculate(small(13)).warnings.some((w) => /^LP1: selectivity .*\(ประเมินเบื้องต้น — ยืนยันด้วยตาราง selectivity ของผู้ผลิต\)$/.test(w)), 'generic');
});

/* ================= 6) sanitize ================= */
test('sanitize: เก็บยี่ห้อ/ซีรีส์/รุ่นที่มีในฐานข้อมูล', () => {
  const p = small(2, null, { mcb: { brand: 'ABB', series: 'SH200 Series' }, mccb: { brand: 'LS', series: 'Susol' }, main: 'LS|TS250N' });
  p.items[0].brOv = { 1: 'ABB|SH200T / SH200' }; p.panels[1].brOv = 'LS|TD100N';
  const o = Sanitize.project(p);
  eq(o.project.meta.brands, { mcb: { brand: 'ABB', series: 'SH200 Series' }, mccb: { brand: 'LS', series: 'Susol' }, main: 'LS|TS250N' });
  eq([o.project.items[0].brOv, o.project.panels[1].brOv], [{ 1: 'ABB|SH200T / SH200' }, 'LS|TD100N']);
  assert(!o.notes.some((n) => /ยี่ห้อ/.test(n)), o.notes);
});
test('sanitize: ตัดรุ่น/ยี่ห้อ/ซีรีส์ที่ไม่รู้จัก พร้อมแจ้ง', () => {
  const p = small(2, null, { mcb: { brand: 'Acme', series: 'X' }, mccb: { brand: 'Schneider', series: 'ไม่มี' }, main: 'Schneider|iC60N' });
  p.items[0].brOv = { 1: 'Schneider|NSX999', 2: '<img src=x>', 3: 'ABB|S200M' }; p.panels[1].brOv = 'Fake|Model';
  const o = Sanitize.project(p);
  eq(o.project.meta.brands, { mccb: { brand: 'Schneider', series: '' } });
  eq([o.project.items[0].brOv, o.project.panels[1].brOv], [{ 3: 'ABB|S200M' }, undefined]);
  assert(o.notes.some((n) => /ยี่ห้อ MCB "Acme" ไม่มีในฐานข้อมูล/.test(n)), o.notes);
  assert(o.notes.some((n) => /ซีรีส์ "ไม่มี"/.test(n)) && o.notes.some((n) => /รุ่น CB ประธาน "Schneider\|iC60N"/.test(n)), o.notes);
  assert(o.notes.some((n) => /ตัดรุ่นเบรกเกอร์ที่ไม่มีในฐานข้อมูลยี่ห้อ 3 รายการ/.test(n)), o.notes);
});
test('sanitize: โครงการที่ไม่มียี่ห้อ ไม่ได้ meta.brands เพิ่ม', () => {
  eq(Sanitize.project(small(2)).project.meta.brands, undefined);
});

/* ================= 7) ส่งออก ================= */
const Report = (() => {
  const ctx = { LoadEngine: E, LS_DATA: D, console };
  ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/export.js'), 'utf8'), ctx);
  return ctx.Report;
})();
test('ส่งออก: ตาราง Feeder / SLD / ตารางโหลดแสดงรุ่น', () => {
  const r = E.calculate(small(6, null, sch)), mdb = panel(r, 'MDB'), lp = panel(r, 'LP1'), fn = Report.feederNumbers(r);
  const row = Report.feederRows(mdb, r, fn).find((x) => x.to === 'LP1');
  eq([row.cb, row.ic, row.key], ['Schneider NSX100B 32AT/100AF', 25, 'f|LP1']);
  assert(Report.feederScheduleHTML(mdb, r, fn).includes('data-brcb="f|LP1"'), 'feeder data-brcb');
  const sld = Report.sldSVG(r, fn);
  assert(sld.includes('>Schneider NSX100B</text>') && sld.includes('>32AT/100AF 25kA</text>'), 'SLD');
  const html = Report.panelScheduleHTML(lp, r, fn, { edit: true });
  assert(html.includes('<div class="br-mdl">Schneider iC60N</div>') && html.includes('data-brcb="c|LP1|'), 'schedule');
  assert(!Report.panelScheduleHTML(lp, r, fn).includes('data-brcb'), 'รายงานไม่มีช่องคลิก');
});
test('BOM จัดกลุ่มตามยี่ห้อ/รุ่น + แหล่งอ้างอิงยี่ห้อ', () => {
  const r = E.calculate(small(6, null, sch));
  const br = r.bom.breakers;
  const models = br.map((b) => b.model);
  assert(br.every((b) => b.brand === 'Schneider') && models.join() === models.slice().sort((a, c) => a.localeCompare(c, 'en', { numeric: true })).join(), JSON.stringify(br));
  assert(Report.bomHTML(r).includes('class="br-grp"'), 'bom grp');
  const refs = Report.brandRefsHTML(r);
  assert(refs.includes('NSX100B') && refs.includes(BR.find('Schneider|NSX100B').ref) && /ตรวจ.*แคตตาล็อก/.test(refs), 'refs');
  eq(Report.brandRefsHTML(E.calculate(small(6))), '');
});

done();
