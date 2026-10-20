// Master plan — ส่วนแสดงผล/แบบแปลน: ตารางโหลด Generic Spec, Title Block (กว./ผู้ตรวจ/โลโก้), SLD 12 องค์ประกอบ (SVG) และ DXF layers
// รัน: node tests/master-report.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { E, D, proj, P, I } = require('./helpers/build.js');
const X = require('../public/js/dxf.js');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');

// โหลด Report จาก export.js ผ่าน VM (เหมือน test/master-spec.test.js)
const ctx = { LoadEngine: E, LS_DATA: D, fmt: E.fmt };
ctx.self = ctx;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/export.js'), 'utf8'), ctx);
const Report = ctx.Report;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const calc = (p) => E.calculate(p);
const board = (r, id) => r.panels.find((b) => b.id === id);
const meta = (extra) => Object.assign({ name: 'อาคารทดสอบ', utility: 'MEA', supply: 'transformer', owner: 'บริษัท ทดสอบ จำกัด', designer: 'นายออกแบบ ทดสอบ', date: '2026-10-18' }, extra || {});
// อาคาร 2 ชั้น: MDB ชั้น 1 ; LP1 ชั้น 1 (เต้ารับทั่วไป + แอร์) ; LP2 ชั้น 2 (เต้ารับ heavy + มอเตอร์)
const building = (extraMeta) => proj({
  meta: meta(extraMeta),
  panels: [P('MDB', 'MDB', null, { floor: 1 }), P('LP1', 'LP', 'MDB', { floor: 1, feederLength: 25, name: 'LP-1' }), P('LP2', 'LP', 'MDB', { floor: 2, feederLength: 35, name: 'LP-2' })],
  items: [I('LP1', { type: 'rec', points: 20, name: 'เต้ารับทั่วไป' }), I('LP1', { type: 'ac', btu: 36000, phases: 3 }),
    I('LP2', { type: 'rec', duty: 'heavy', points: 6, name: 'เต้ารับครัว' }), I('LP2', { type: 'motor', kw: 3.7, phases: 3 })]
});
const R = () => calc(building());
const fnum = (r) => Report.feederNumbers(r);

/* ---------- A) ตารางโหลดกลาง: Generic Engineering Spec (ไม่มียี่ห้อ) ---------- */
const BRANDS = /Schneider|ABB|Siemens|Mitsubishi|Square\s*D|Eaton|LS\s|iC60|Acti9|Easy9|EZ9|EZC|NSX|3VA|System\s*pro/i;
const branded = () => {
  const p = building();
  p.meta.brands = { mcb: { brand: 'Schneider', series: 'Acti9' }, mccb: { brand: 'Schneider', series: 'EasyPact EZC' } };
  return calc(p);
};
const tbody = (html) => (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
test('A1 โหมดรายงาน/พิมพ์: ตารางโหลดไม่มีชื่อยี่ห้อ/รุ่นในเซลล์ใดเลย แม้เลือกยี่ห้อไว้', () => {
  const r = branded();
  assert(r.panels.some((p) => p.circuits.some((c) => c.cb && c.cb.bm)), 'ต้องมีวงจรที่ผูกยี่ห้อ (เงื่อนไขทดสอบ)');
  for (const id of ['LP1', 'LP2']) {
    const html = Report.panelScheduleHTML(board(r, id), r, fnum(r));
    const m = BRANDS.exec(tbody(html));
    assert(!m, `${id} มียี่ห้อในตาราง: ${m && m[0]}`);
  }
});
test('A2 ตารางโหลดแสดง Generic Spec: MCB/RCBO + AT + IC ; วงจร heavy เป็น RCBO 20 A', () => {
  const r = R();
  const html = Report.panelScheduleHTML(board(r, 'LP2'), r, fnum(r));
  const rows = html.match(/<tr [^>]*data-ck[\s\S]*?<\/tr>/g) || [];
  const heavy = rows.find((x) => /เต้ารับครัว/.test(x));
  assert(heavy && /<td>20<\/td><td>RCBO<\/td><td>\d+<\/td>/.test(heavy), heavy);
  const lp1 = Report.panelScheduleHTML(board(r, 'LP1'), r, fnum(r));
  assert(/<td>16<\/td><td>MCB<\/td><td>\d+<\/td>/.test(lp1), 'MCB 16 A');
});
test('A3 โหมดแก้ไขใน UI ยังแสดงรุ่นที่เลือก (ปุ่มเลือกรุ่นต้องเห็นว่าเลือกอะไรไว้)', () => {
  const r = branded();
  const html = Report.panelScheduleHTML(board(r, 'LP1'), r, fnum(r), { edit: true });
  assert(/br-mdl/.test(html) && /data-brcb/.test(html), 'edit mode ต้องมี br-mdl + data-brcb');
});
test('A4 ปั๊มดับเพลิง: ตารางโหลดแสดงชนิด MCCB Mag-only (ไม่ใช่ MCB/RCBO)', () => {
  const p = proj({ meta: meta(), panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { emergency: true })], items: [I('LP1', { type: 'fire_pump', kw: 22, name: 'ปั๊มดับเพลิง' })] });
  const r = calc(p);
  const html = Report.panelScheduleHTML(board(r, 'LP1'), r, fnum(r));
  assert(/ปั๊มดับเพลิง/.test(html) && /MCCB Mag-only/.test(html) && !/RCBO/.test(tbody(html)), tbody(html).slice(0, 600));
});

test('A5 Ik" > IC: เซลล์ IC ของ CB ที่ไม่ปลอดภัยเป็นสีแดง + ⚠️ "Explosion Risk" ; CB ปกติไม่มี', () => {
  const hot = calc(proj({ meta: Object.assign(meta(), { supply: 'lv', serviceKA: 1000, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' } }),
    panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 0 })], items: [I('LP1', { type: 'rec', points: 10 })] }));
  const lp = Report.panelScheduleHTML(board(hot, 'LP1'), hot, fnum(hot));   // สายป้อน 0 m → Ik" ที่ LP1 = ที่ MDB (> 100 kA)
  assert(/class="ic-bad"[^>]*>[^<]*⚠️/.test(lp) && /Explosion Risk/.test(lp), lp.slice(0, 200));
  const safe = R();
  for (const id of ['LP1', 'LP2']) assert(!/ic-bad/.test(Report.panelScheduleHTML(board(safe, id), safe, fnum(safe))), id + ' ไม่ควรมี ic-bad');
});

test('A6 ปั๊มดับเพลิงอยู่ในกลุ่มสรุป PUMP ของตารางโหลด (ไม่ตกไป OTHER) และมีชื่อไทยในตารางดีมานด์', () => {
  const r = calc(proj({ meta: meta(), panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { emergency: true })], items: [I('LP1', { type: 'fire_pump', kw: 22, name: 'ปั๊มดับเพลิง' })] }));
  const html = Report.panelScheduleHTML(board(r, 'LP1'), r, fnum(r));
  const sum = (k) => { const m = new RegExp(`<td>${k}</td><td class="eq">=</td><td class="r num">([\\d,-]+)</td>`).exec(html); return m ? m[1] : null; };
  assert(sum('PUMP') && sum('PUMP') !== '-' && sum('OTHER') === '-', `PUMP=${sum('PUMP')} OTHER=${sum('OTHER')}`);
  assert(/ปั๊มดับเพลิง/.test(Report.demandStepsHTML(r.panels.find((p) => p.id === 'LP1'))), 'ชื่อไทยในตารางดีมานด์');
});

test('A7 โหมดรายงาน: ท้ายตารางโหลด (FEEDER CB) ไม่มีชื่อยี่ห้อ/รุ่น — ทั้งหน้า ไม่ใช่แค่ใน tbody', () => {
  const r = branded();
  for (const id of ['LP1', 'LP2']) {
    const html = Report.panelScheduleHTML(board(r, id), r, fnum(r));
    assert(!BRANDS.test(html), `${id}: ${(html.match(BRANDS) || [''])[0]}`);
    assert(/FEEDER CB : <b>\d+AT\/\d+AF<\/b>/.test(html), `${id}: ป้าย feeder CB ต้องเป็นสเปกกลาง`);
  }
  const edit = Report.panelScheduleHTML(board(r, 'LP1'), r, fnum(r), { edit: true });
  assert(/FEEDER CB : <b>[^<]*Schneider/.test(edit), 'โหมดแก้ไขยังเห็นรุ่น');
});

/* ---------- B) Title Block: เลขที่ใบอนุญาต กว. + ผู้ตรวจ + กรอบโลโก้ ---------- */
const tb = (m) => Report.titleBlock(E.defaultMeta ? Object.assign(E.defaultMeta(), m) : m, 'E-01', 'ผังเส้นเดียว');
test('B1 Title Block แสดงผู้ออกแบบ + ระดับ/เลขที่ใบอนุญาต กว.', () => {
  const h = tb({ designer: 'นายออกแบบ', licenseTier: 'สฟก.', designerLicense: '12345', checker: 'นายตรวจ', checkerLicense: '67890' });
  assert(/นายออกแบบ/.test(h) && /สฟก\.\s*12345/.test(h), h);
  assert(/นายตรวจ/.test(h) && /67890/.test(h) && /CHECK/i.test(h), 'ผู้ตรวจ');
  assert(/กว\./.test(h), 'ป้ายกำกับ กว.');
});
test('B2 กรอบโลโก้บริษัทมีเสมอ ; มีโลโก้ → ฝัง <img> ; ไม่มี → กรอบว่าง', () => {
  assert(/class="tb-logo"/.test(tb({})) && !/<img/.test(tb({})), 'ไม่มีโลโก้ = กรอบเปล่า');
  const h = tb({ logo: PNG });
  assert(/<img[^>]+src="data:image\/png;base64,/.test(h) && /alt="/.test(h), h.slice(0, 400));
});
test('B3 ความปลอดภัย: โลโก้ที่ไม่ใช่ data URL รูปแรสเตอร์ไม่ถูกฝัง + ข้อความถูก escape', () => {
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', PNG + '" onerror="alert(1)']) {
    assert(!/<img/.test(tb({ logo: bad })), 'ฝังโลโก้ไม่ปลอดภัย: ' + bad);
  }
  const h = tb({ designer: '<img src=x onerror=alert(1)>', designerLicense: '"><script>' });
  assert(!/<img src=x/.test(h) && !/<script>/.test(h) && /&lt;img/.test(h), h);
});

/* ---------- C) SLD 12 องค์ประกอบ (SVG) ตามแบบ The Kop Engineer ---------- */
const SLD = () => { const r = R(); return { r, svg: Report.sldSVG(r, fnum(r)) }; };
const el = (svg, name) => { const m = new RegExp(`<g[^>]*data-el="${name}"[^>]*>([\\s\\S]*?)</g>`).exec(svg); return m ? m[1] : null; };
const ELEMENTS = ['banner', 'source', 'meter', 'demarcation', 'pothead', 'enclosure', 'instrument', 'ct', 'maincb', 'busbar', 'ground', 'vtext', 'loadblock'];
test('C1 SLD มีครบทุกองค์ประกอบ (data-el): ' + ELEMENTS.join(', '), () => {
  const { svg } = SLD();
  const miss = ELEMENTS.filter((n) => !new RegExp(`data-el="${n}"`).test(svg));
  assert(!miss.length, 'ขาด: ' + miss.join(', '));
});
test('C2 ป้ายหัวผัง + แหล่งจ่าย 3Φ 4W 230/400V + เส้นเขตกรรมสิทธิ์ BY MEA. / BY OWNER', () => {
  const { svg } = SLD();
  assert(/ELECTRICAL SINGLE LINE DIAGRAM/.test(el(svg, 'banner') || ''), 'banner');
  assert(/3Φ 4W 230\/400V/.test(el(svg, 'source') || '') && /FROM MEA\./.test(el(svg, 'source') || ''), 'source');
  const dm = el(svg, 'demarcation') || '';
  assert(/BY MEA\./.test(dm) && /BY OWNER/.test(dm) && /stroke-dasharray/.test(svg.slice(svg.indexOf('data-el="demarcation"'), svg.indexOf('data-el="demarcation"') + 600)), 'demarcation');
});
test('C3 การไฟฟ้า PEA → "BY PEA." / "FROM PEA."', () => {
  const r = calc(building({ utility: 'PEA' })), svg = Report.sldSVG(r, fnum(r));
  assert(/BY PEA\./.test(svg) && /FROM PEA\./.test(svg) && !/BY MEA\./.test(svg), 'PEA');
});
test('C4 วงจรวัด: Fuse 3x6A + Pilot Lamps (x3) + Digital Meter [DP] + 3xCT n/5A (n = พิกัดมาตรฐานถัดจาก CB ประธาน)', () => {
  const { r, svg } = SLD();
  const ins = el(svg, 'instrument') || '';
  assert(/3x6A/.test(ins) && /Pilot Lamps \(x3\)/.test(ins) && />DP</.test(ins), ins.slice(0, 300));
  const m = /3xCT (\d+)\/5A/.exec(el(svg, 'ct') || '');
  assert(m, 'CT');
  const want = D.CT_PRIMARY.find((x) => x >= r.service.mainCB.at);
  eq(+m[1], want);
});
test('C5 CB ประธาน + กรอบตู้ระบุ IC ≥ kA + บัสบาร์ "4xnnnA, Cu. BUSBAR W/GROUND BUS"', () => {
  const { r, svg } = SLD();
  assert(new RegExp(r.service.mainCB.label.replace(/\//g, '\\/')).test(el(svg, 'maincb') || '') && />3P</.test(el(svg, 'maincb') || ''), 'maincb');
  assert(new RegExp(`IC ≥ ${r.service.mainCB.ic}kA\\.`).test(el(svg, 'enclosure') || ''), 'enclosure IC');
  assert(/4x\d+A, Cu\. BUSBAR W\/GROUND BUS/.test(el(svg, 'busbar') || ''), 'busbar');
});
test('C6 ระบบต่อลงดิน: MBJ → Test Link → Ground Rod 5/8" x 10 FT ≤ 5 Ω + สายต่อหลักดินตาม GEC', () => {
  const { r, svg } = SLD();
  const g = el(svg, 'ground') || '';
  assert(/MBJ/.test(g) && /TEST LINK/.test(g) && /GROUND ROD 5\/8" x 10 FT/.test(g) && /≤ 5 Ω/.test(g), g.slice(0, 400));
  assert(new RegExp(`1x${r.service.gec}-IEC01`).test(g), 'GEC 1x' + r.service.gec);
});
test('C7 โหลดปลายทางเป็นบล็อกทึบสีดำ ระบุชั้น (1st FL./2nd FL.) และข้อความสายป้อนแนวตั้ง rotate(-90)', () => {
  const { svg } = SLD();
  const blocks = svg.match(/<g[^>]*data-el="loadblock"[\s\S]*?<\/g>/g) || [];
  eq(blocks.length, 2);
  assert(blocks.every((b) => /class="[^"]*\bload-block\b/.test(b)), 'class load-block');
  assert(blocks.some((b) => /LP-1/.test(b) && /1st FL\./.test(b)) && blocks.some((b) => /LP-2/.test(b) && /2nd FL\./.test(b)), blocks.join('\n').slice(0, 500));
  const vt = svg.match(/<text[^>]*transform="rotate\(-90[^"]*"[^>]*>[^<]*<\/text>/g) || [];
  assert(vt.length >= 4 && vt.some((t) => /25|16|4×|IEC01|CV|NYY/.test(t)), 'vertical text ' + vt.length);
});
test('C8 ปั๊มดับเพลิงในผัง: สัญลักษณ์ FP (ไม่ใช่ L) และ SVG ยังมีชื่อแผง/ป้าย CB เดิมครบ', () => {
  const p = proj({ meta: meta(), panels: [P('MDB', 'MDB', null), P('SDB1', 'SDB', 'MDB', { emergency: true, floor: undefined })], items: [I('SDB1', { type: 'fire_pump', kw: 22, name: 'ปั๊มดับเพลิง' })] });
  const r = calc(p), svg = Report.sldSVG(r, fnum(r));
  assert(/>FP</.test(svg) && svg.includes('MDB') && svg.includes('SDB1'), 'FP');
});
test('C9 SVG สมบูรณ์: well-formed (แท็กสมดุล), ขนาดกว้าง/สูงเป็นตัวเลข, ไม่มี NaN/undefined', () => {
  const { svg } = SLD();
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'svg');
  assert(!/NaN|undefined|\[object/.test(svg), 'ค่าไม่ถูกต้อง');
  const open = (svg.match(/<(g|text)\b[^>]*[^/]>/g) || []).length, close = (svg.match(/<\/(g|text)>/g) || []).length;
  eq(open, close);
  assert(/viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/.test(svg), 'viewBox');
});

/* ---------- D) DXF: layers ตามสเปก ---------- */
const dxf = () => X.build(R());
const layersDeclared = (d) => { const l = d.split('\n'); const out = []; for (let i = 0; i < l.length - 1; i++) if (l[i] === '0' && l[i + 1] === 'LAYER') out.push(l[i + 3]); return out; };
const ents = (d) => { const l = d.split('\n'), out = []; let cur = null; for (let i = 0; i + 1 < l.length; i += 2) { if (l[i] === '0') { cur = { t: l[i + 1] }; out.push(cur); } else if (cur) { (cur[l[i]] = cur[l[i]] || []).push(l[i + 1]); } } return out; };
/* ---------- E) ส่งออกทุกทาง (CSV / Excel / รายงาน PDF / ส่งผ่าน Worker) กับโครงการที่ใช้ฟีเจอร์ใหม่ครบ ต้องไม่ error และไม่มี NaN/undefined ---------- */
const rich = () => {
  const p = building({ designerLicense: '12345', licenseTier: 'สฟก.', checker: 'นายตรวจ', checkerLicense: '67890', logo: PNG });
  p.panels.push(P('EM1', 'LP', 'MDB', { emergency: true, floor: 1, feederLength: 10, name: 'EM-1' }));
  p.items.push(I('EM1', { type: 'fire_pump', kw: 22, name: 'ปั๊มดับเพลิง' }));
  return calc(p);
};
/* ---------- F) แท็กที่มาของขนาด CB (Multilevel Feeder Coordination) + คำแนะนำ Ik" > IC ในเซลล์ ---------- */
const coordProj = (extra) => proj({ meta: meta(Object.assign({ supply: 'lv', serviceKA: 10 }, extra)),
  panels: [P('MDB', 'MDB', null), P('SDB', 'SDB', 'MDB', { name: 'SDB' }), P('LP1', 'LP', 'SDB', { name: 'LP-1' }), P('SDB2', 'SDB', 'MDB', { name: 'SDB-2' })],
  items: [I('LP1', { type: 'rec', points: 90 }), I('SDB2', { type: 'custom', va: 20000, phases: 3, continuous: true, qty: 4, cat: 'other' })] });
test('F1 ตาราง Feeder: แถวสายป้อนที่ CB ถูกขยับตามแผงลูกมีแท็ก [1.6× Coord] ; แถวอื่นและโหมดปิดประสานไม่มี', () => {
  const r = calc(coordProj()), m = board(r, 'MDB');
  assert(board(r, 'SDB').feeder.coord, 'เงื่อนไขทดสอบ: SDB ต้องถูกประสาน');
  const html = Report.feederScheduleHTML(m, r, fnum(r));
  const rows = html.split('<tr').filter((x) => /<b>SDB<\/b>/.test(x) || /<b>SDB-2<\/b>/.test(x));
  const sdb = rows.find((x) => /<b>SDB<\/b>/.test(x)), sdb2 = rows.find((x) => /<b>SDB-2<\/b>/.test(x));
  assert(/<span class="tag coord"[^>]*>\[1\.6× Coord\]<\/span>/.test(sdb), sdb.slice(0, 400));
  assert(!/tag coord/.test(sdb2), 'SDB-2 ไม่ได้ถูกประสานตามลูก');
  const off = calc(coordProj({ coordinateKidFeeders: false }));
  assert(!/tag coord/.test(Report.feederScheduleHTML(board(off, 'MDB'), off, fnum(off))), 'ปิดประสานต้องไม่มีแท็ก');
});
test('F3 เซลล์ IC สีแดง: tooltip มีคำแนะนำเชิงวิศวกรรม (IC ≥ มาตรฐานถัดไปที่รับ Ik" ได้ + Cascading/Back-up ตาม IEC 60947-2) และไม่มีชื่อยี่ห้อ (ตารางโหลดเป็น Generic Spec)', () => {
  const hot = calc(proj({ meta: Object.assign(meta(), { supply: 'lv', serviceKA: 1000, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' } }),
    panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 0 })], items: [I('LP1', { type: 'rec', points: 10 })] }));
  const html = Report.panelScheduleHTML(board(hot, 'LP1'), hot, fnum(hot));
  const t = (html.match(/class="ic-bad" title="([^"]*)"/) || [])[1] || '';
  assert(/Explosion Risk/.test(t) && /IEC 60947-2/.test(t) && /Cascading/.test(t) && /Back-up/.test(t), t);
  assert(!BRANDS.test(t), 'tooltip ในตารางโหลดต้องเป็นสเปกกลาง: ' + t);
  const warm = calc(proj({ meta: Object.assign(meta(), { supply: 'lv', serviceKA: 12, main: { length: 0.5, cable: 'CV', method: 'g5', conduit: 'IMC' }, branchIC: 6 }),
    panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 0 })], items: [I('LP1', { type: 'rec', points: 10 })] }));
  warm.panels.forEach((p) => (p.circuits || []).forEach((c) => { if (c.cb) c.cb.ic = Math.min(c.cb.ic, 6); }));   // จำลอง MCB 6 kA ที่บัสซึ่ง Ik" สูงกว่า
  const w = Report.panelScheduleHTML(board(warm, 'LP1'), warm, fnum(warm));
  const tw = (w.match(/class="ic-bad" title="([^"]*)"/) || [])[1] || '';
  assert(/IC ≥ (10|18|25) kA/.test(tw), 'ต้องระบุ IC มาตรฐานที่รับ Ik" ได้: ' + tw);
});

test('F4 ป้ายชั้น: ชั้นลอย (1.5) = M FL. ไม่ปัดเป็น 2nd FL. ; G/B/ลำดับปกติคงเดิม', () => {
  eq([Report.floorLabel(1.5), Report.floorLabel(2.5), Report.floorLabel(1), Report.floorLabel(2), Report.floorLabel(-1), Report.floorLabel(0)], ['M FL.', '2M FL.', '1st FL.', '2nd FL.', 'B1 FL.', 'G FL.']);
});

/* ---------- G) Tap Ahead of Main (NFPA 20): SLD แยกกิ่งจากสายประธานเหนือ Main CB + DXF layer E-SLD-EMERGENCY (ตัวเลือกปิดไว้) ---------- */
const TAP_LABEL = 'FIRE PUMP FEEDER (TAP AHEAD OF MAIN - MAG ONLY CB)';
const tapBuilding = (kind) => {
  const p = building();
  p.panels.push(P('FP1', kind || 'SDB', 'MDB', { floor: 1, feederLength: 12, name: 'FP-1', emergency: true, tap: 'ahead_of_main' }));
  p.items.push(I('FP1', { type: 'fire_pump', kw: 22, phases: 3, name: 'ปั๊มดับเพลิง' }));
  return p;
};
const num = (s) => Number(s);
const sldOf = (p) => { const r = calc(p); return { r, svg: Report.sldSVG(r, fnum(r)) }; };
const widthOf = (svg) => +/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)[1];
const busbarSpan = (svg) => { const m = /d="M(\d+(?:\.\d+)?) \d+(?:\.\d+)? H(\d+(?:\.\d+)?)" style="stroke-width:3\.4"/.exec(svg); return m ? [num(m[1]), num(m[2])] : null; };
const loadBlocks = (svg) => [...svg.matchAll(/<g class="n" data-el="loadblock"[^>]*>\s*<rect class="box load-block[^"]*" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*\/>([\s\S]*?)<\/g>/g)].map((m) => ({ x: num(m[1]), y: num(m[2]), w: num(m[3]), body: m[4] }));
test('G1 ไม่ tap: SLD ไม่มี data-el="tap-ahead" และไม่มีป้าย FIRE PUMP FEEDER ; DXF ไม่ประกาศ layer E-SLD-EMERGENCY (ผลเดิมไม่เปลี่ยน)', () => {
  const svg = SLD().svg;
  assert(!/tap-ahead|FIRE PUMP FEEDER/.test(svg), 'พบองค์ประกอบ tap ใน SLD ปกติ');
  assert(!layersDeclared(dxf()).includes('E-SLD-EMERGENCY'), 'layer ใหม่ต้องปรากฏเฉพาะเมื่อมี tap');
});
test('G2 tap: มีกิ่ง data-el="tap-ahead" + ป้าย "' + TAP_LABEL + '" + CB และสายของสายป้อนแผงนั้น', () => {
  for (const kind of ['SDB', 'LP']) {
    const { r, svg } = sldOf(tapBuilding(kind));
    const t = el(svg, 'tap-ahead') || '';
    assert(t, kind + ': ไม่พบกลุ่ม tap-ahead');
    assert(t.includes(TAP_LABEL), kind + ': ไม่พบป้าย: ' + t.slice(0, 300));
    const f = board(r, 'FP1').feeder;
    assert(t.includes(f.cb.label) || t.includes(f.cb.label.replace(/ /g, ' ')), kind + ': ไม่พบ CB ' + f.cb.label + ' ใน ' + t.slice(0, 400));
    assert(t.includes(f.text.replace(/&/g, '&amp;')) || t.includes(f.text), kind + ': ไม่พบสาย ' + f.text);
  }
});
test('G3 แผง tap ไม่ได้แขวนจากบัสบาร์ MDB : บล็อกโหลดของแผงอยู่นอกช่วงบัสบาร์ ; แผงอื่นยังอยู่บนบัสบาร์ ; ชื่อแผงปรากฏเป็นบล็อกโหลดครั้งเดียว', () => {
  const { svg } = sldOf(tapBuilding());
  const bb = busbarSpan(svg);
  assert(bb, 'ไม่พบบัสบาร์');
  const blocks = loadBlocks(svg);
  const fp = blocks.filter((b) => /FP-1/.test(b.body));
  eq(fp.length, 1);
  assert(fp[0].x + fp[0].w <= bb[0] || fp[0].x >= bb[1], `บล็อก FP-1 x ${fp[0].x}-${fp[0].x + fp[0].w} ทับบัสบาร์ ${bb}`);
  const lp = blocks.filter((b) => /LP-[12]/.test(b.body));
  eq(lp.length, 2);
  assert(lp.every((b) => b.x + b.w / 2 >= bb[0] && b.x + b.w / 2 <= bb[1]), 'LP-1/LP-2 ต้องแขวนจากบัสบาร์ (กึ่งกลางบล็อกอยู่ในช่วงบัสบาร์) ' + JSON.stringify([bb, lp.map((b) => [b.x, b.w])]));
});
test('G4 จุดแยกอยู่บนสายประธานเหนือ Main CB (y 186–244 ที่ x เดียวกับ Pothead) และไม่ชนข้อความสายประธาน (y ≤ 210) ', () => {
  const { svg } = sldOf(tapBuilding());
  const cx = num(/data-el="pothead"[^>]*><path[^>]*class="wire"[^>]*d="M([\d.]+) 92/.exec(svg)[1]);
  const t = el(svg, 'tap-ahead');
  const start = /<path[^>]*class="wire[^"]*"[^>]*d="M([\d.]+) ([\d.]+)/.exec(t);
  assert(start && num(start[1]) === cx, `กิ่งต้องเริ่มที่ x=${cx} : ${start && start[0]}`);
  assert(num(start[2]) > 210 && num(start[2]) < 244, 'y จุดแยก ' + start[2]);
  assert(new RegExp(`<circle[^>]*cx="${cx}"[^>]*cy="${start[2]}"`).test(t), 'ควรมีจุดต่อ (junction dot) ที่จุดแยก');
});
test('G5 ทุกองค์ประกอบอยู่ในความกว้าง SVG (พิกัดไม่ติดลบ/ไม่เกิน width ; ข้อความไม่ล้นขอบ) เมื่อมี tap', () => {
  for (const kind of ['SDB', 'LP']) {
    const { svg } = sldOf(tapBuilding(kind)), W = widthOf(svg);
    const xs = [...svg.matchAll(/\b(?:x|cx|x1|x2)="(-?[\d.]+)"/g)].map((m) => num(m[1]));
    const bad = xs.filter((v) => v < 0 || v > W);
    assert(!bad.length, `${kind}: x นอกกรอบ ${bad.slice(0, 5)} (width ${W})`);
    const T = [...svg.matchAll(/<text(?![^>]*transform)([^>]*)>([^<]*)<\/text>/g)];
    T.forEach((m) => {
      const a = m[1], x = num((/\sx="(-?[\d.]+)"/.exec(a) || [0, NaN])[1]), fs = num((/font-size="([\d.]+)"/.exec(a) || [0, 10])[1]);
      const len = m[2].replace(/&[a-z]+;/g, 'x').length * fs * 0.6, anc = (/text-anchor="(\w+)"/.exec(a) || [0, 'start'])[1];
      const l = anc === 'middle' ? x - len / 2 : anc === 'end' ? x - len : x, rr = l + len;
      assert(l >= -2 && rr <= W + 2, `${kind}: ข้อความล้นกรอบ [${l.toFixed(0)}, ${rr.toFixed(0)}] / ${W}: ${m[2].slice(0, 50)}`);
    });
  }
});
done();
