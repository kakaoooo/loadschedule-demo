// ทดสอบท่อนำเข้าไฟล์ (importer.js / reader.js) — รัน: node tests/import.test.js  (หรือ npm test)
// ส่วน A = 61 รายการจากรายงานตรวจสอบอิสระ (แต่ละข้อระบุพฤติกรรมที่ "ถูกต้อง")  ส่วน B ขึ้นไป = พฤติกรรมใหม่/สัญญา UI
const { createHarness } = require('./helpers/harness');
const H = require('./helpers/env');
const { E, I, D, P, R, first, proj0, sampleProject, clone, meta } = H;
const { t, ta, ok, eq, done } = createHarness();

const sumVA = (rows) => rows.reduce((s, r) => s + (r.va || 0), 0);
const lay = (rows, proj, opt) => I.buildLayout(rows, proj || proj0(), opt || {});
const thai = (w) => typeof w === 'string' && /[ก-๙]/.test(w);

/* ============================ A. พอร์ตจากรายงานตรวจสอบ (61) ============================ */
console.log('# A. audit regression');
// ---- numerals / floors
t('N1', 'Thai digits: "ชั้น ๒ ... x ๑๐" -> floor 2, fixtures 10', () => { const r = first('ชั้น ๒\nห้องประชุม: โคม LED 18W x ๑๐'); return ok(r.floor === 2 && r.fixtures === 10, [r.floor, r.fixtures]); });
t('N2', 'full-width digits "ชั้น ２ ... x １０"', () => { const r = first('ชั้น ２\nห้องประชุม: โคม LED 18W x １０'); return ok(r.floor === 2 && r.fixtures === 10, [r.floor, r.fixtures]); });
t('F1', '"2F" header sets floor 2', () => ok(first('2F\nOffice: LED 18W x 10').floor === 2, first('2F\nOffice: LED 18W x 10').floor));
t('F2', '"ชั้น G" / "B1" / "ชั้นลอย" header after ชั้น 2 must change the floor (else loads silently carry over to floor 2)', () => { const fl = ['ชั้น G', 'B1', 'ชั้นลอย'].map((h) => R('ชั้น 2\nA: LED 18W x 1\n' + h + '\nB: LED 18W x 1')[1].floor); return ok(fl.every((f) => f !== 2), fl); });
t('F3', '"F2" header gives no spurious "อ่านไม่ออก" warning', () => ok(P('F2\nOffice: LED 18W x 10').warnings.length === 0, P('F2\nOffice: LED 18W x 10').warnings));
t('F4', 'line containing "ส่วนกลาง" inside floor 2 must not move the next rooms to floor 0', () => { const r = R('ชั้น 2\nทางเดินส่วนกลาง 40 ตร.ม.\nสำนักงาน 100 ตร.ม.'); return ok(r.length > 0 && r.every((x) => x.floor === 2 || x.floor === 0 && /ทางเดิน/.test(x.room)) && r.filter((x) => x.room === 'สำนักงาน').every((x) => x.floor === 2), r.map((x) => [x.room, x.floor])); });
t('F5', '"Basement parking: LED" then next room on floor 4 stays floor 4', () => { const r = R('ชั้น 4\nRoof garden lights: LED 9W x 10\nOffice: LED 18W x 5'); return ok(r[1].floor === 4, r.map((x) => [x.room, x.floor])); });
t('F6', 'area-only central room ("Pump room 20 ตร.ม.") is not silently dropped', () => ok(R('Pump room 20 ตร.ม.').length > 0, R('Pump room 20 ตร.ม.').length));
// ---- quantities
t('Q1', '"เต้ารับ 1,200 จุด" -> 1200 points', () => ok(first('เต้ารับ 1,200 จุด').points === 1200, first('เต้ารับ 1,200 จุด').points));
t('Q2', '"Hall 1,200 ตร.ม." -> area 1200', () => ok(first('Hall 1,200 ตร.ม.').area === 1200, first('Hall 1,200 ตร.ม.').area));
// (ปรับ) ต้นฉบับ: points === 12345 — ข้อกำหนดใหม่: จำนวนมากเกิน 5000 ถูกจำกัดที่ 5000 พร้อมคำเตือน; ที่ยังต้องไม่ถูกตัดหลักเป็น 2345
t('Q3', '"เต้ารับ 12345 จุด" not truncated to 2345 (clamped to 5000 with a warning)', () => { const p = P('เต้ารับ 12345 จุด'); return ok(p.rows[0].points === 5000 && p.warnings.length > 0, [p.rows[0].points, p.warnings]); });
t('Q4', '"โคม LED 10x18W" -> 10 fixtures', () => { const r = first('โคม LED 10x18W'); return ok(r.fixtures === 10 && r.perFixture === 1, [r.perFixture, r.fixtures]); });
t('Q5', '"โคม LED 18W 2 หลอด 10 โคม" -> 2 lamps x 10 fixtures', () => { const r = first('โคม LED 18W 2 หลอด 10 โคม'); return ok(r.perFixture === 2 && r.fixtures === 10, [r.perFixture, r.fixtures]); });
t('Q6', '"ห้อง 301 โคม LED 18W" -> room number not used as qty', () => ok(first('ห้อง 301 โคม LED 18W').fixtures === 1, first('ห้อง 301 โคม LED 18W').fixtures));
t('Q7', '"ปั๊ม 11 kW 3 เฟส" qty 1 (phase digit not a quantity)', () => ok(first('ปั๊ม 11 kW 3 เฟส').qty === 1, first('ปั๊ม 11 kW 3 เฟส').qty));
t('Q8', '"UPS 10 kVA 3 เฟส" qty 1', () => ok(first('UPS 10 kVA 3 เฟส').qty === 1, first('UPS 10 kVA 3 เฟส').qty));
t('Q9', '"แอร์ 60000 BTU 3 phase" qty 1', () => ok(first('แอร์ 60000 BTU 3 phase').qty === 1, first('แอร์ 60000 BTU 3 phase').qty));
t('Q10', '"ลิฟต์ 1000 kg 8 ชั้น" qty 1', () => ok(first('ลิฟต์ 1000 kg 8 ชั้น').qty === 1, first('ลิฟต์ 1000 kg 8 ชั้น').qty));
t('Q11', '"x 0" quantity is not shown as 0 / not silently 1', () => ok(first('แอร์ 12000 BTU x 0').qty !== 0, first('แอร์ 12000 BTU x 0').qty));
// ---- units
t('U1', '"เครื่องทำน้ำอุ่น 4,500 วัตต์ 2 เครื่อง" -> 4500 W', () => ok(first('เครื่องทำน้ำอุ่น 4,500 วัตต์ 2 เครื่อง').watt === 4500, first('เครื่องทำน้ำอุ่น 4,500 วัตต์ 2 เครื่อง').watt));
t('U2', '"ปั๊มน้ำ 3 แรงม้า x 2" -> 3 kW', () => ok(first('ปั๊มน้ำ 3 แรงม้า x 2').kw === 3, first('ปั๊มน้ำ 3 แรงม้า x 2').kw));
t('U3', '"โคม LED 9 วัตต์ x 10" -> 9 W class lamp', () => ok(first('โคม LED 9 วัตต์ x 10').lamp === 'led-t8-9', first('โคม LED 9 วัตต์ x 10').lamp));
t('U4', '"โคม LED 18 วัตต์" -> 1 fixture (not 18)', () => ok(first('โคม LED 18 วัตต์').fixtures === 1, first('โคม LED 18 วัตต์').fixtures));
t('U5', '"ปั๊ม 1500 วัตต์" -> 1.5 kW (not default 2.2)', () => ok(first('ปั๊มน้ำ 1500 วัตต์').kw === 1.5, first('ปั๊มน้ำ 1500 วัตต์').kw));
t('U6', '"โคม LED 100W x 4" must not become 16 W lamp', () => { const r = first('Floodlight LED 100W x 4'); const lamp = r.lamp ? E.lampById(r.lamp) : null; return ok(r.type !== 'light' || (lamp && lamp.w >= 100), r.lamp); });
t('U7', '"ปั๊ม 0.75 kW 1P"/"single phase"/"220V" -> 1 phase', () => ok(['ปั๊ม 0.75 kW 1P', 'ปั๊ม 0.75 kW single phase'].every((s) => first(s).phases === 1), ['ปั๊ม 0.75 kW 1P', 'ปั๊ม 0.75 kW single phase'].map((s) => first(s).phases)));
t('U8', 'custom "equipment 9 kW 3P" / "3-phase" -> 3 phase', () => ok(['equipment 9 kW 3P', 'equipment 9 kW 3-phase'].every((s) => first(s).phases === 3), ['equipment 9 kW 3P', 'equipment 9 kW 3-phase'].map((s) => first(s).phases)));
t('U9', '"แอร์ 24.000 BTU" (OCR dot) -> 24000', () => ok(first('แอร์ 24.000 BTU').btu === 24000, first('แอร์ 24.000 BTU').btu));
t('U10', '"อุปกรณ์ 1500 W pf 0.8" -> pf kept (VA 1875)', () => ok(first('อุปกรณ์ 1500 W pf 0.8').pf === 0.8, first('อุปกรณ์ 1500 W pf 0.8').pf));
// ---- keyword false positives
t('K1', '"ระบบแจ้งเหตุไฟไหม้ 500 VA" is not light x500', () => ok(!(first('ระบบแจ้งเหตุไฟไหม้ 500 VA').type === 'light'), first('ระบบแจ้งเหตุไฟไหม้ 500 VA').fixtures));
t('K2', '"เครื่องกำเนิดไฟ"/"ที่ชาร์จไฟรถ EV 7 kW" not light', () => ok(['เครื่องกำเนิดไฟ', 'ที่ชาร์จไฟรถ EV 7 kW x 2'].every((s) => first(s).type !== 'light'), ['เครื่องกำเนิดไฟ', 'ที่ชาร์จไฟรถ EV 7 kW x 2'].map((s) => first(s).type)));
t('K3', '"Upstairs hall 50 ตร.ม." gets area estimate (not custom 1 kVA)', () => ok(R('Upstairs hall 50 ตร.ม.').some((r) => r.est), R('Upstairs hall 50 ตร.ม.').map((r) => r.type)));
t('K4', '"Loading dock 100 ตร.ม." gets area estimate', () => ok(R('Loading dock 100 ตร.ม.').some((r) => r.est), R('Loading dock 100 ตร.ม.').map((r) => r.type)));
t('K5', '"Server room 30 ตร.ม." gets area estimate (ROOM_RULES server rule unreachable)', () => ok(R('Server room 30 ตร.ม.').some((r) => r.est), R('Server room 30 ตร.ม.').map((r) => r.type)));
t('K6', '"Motorcycle parking 50 ตร.ม." not a motor row', () => ok(first('Motorcycle parking 50 ตร.ม.').type !== 'motor', first('Motorcycle parking 50 ตร.ม.').type));
t('K7', '"Showcase 20 ตร.ม." not classed as toilet (wc substring)', () => ok(!R('Showcase 20 ตร.ม.').some((r) => r.wet), R('Showcase 20 ตร.ม.').map((r) => r.wet)));
t('K8', 'ocrFix leaves "หน้า" (front/page) intact', () => ok(I.ocrFix('ห้องด้านหน้า') === 'ห้องด้านหน้า', I.ocrFix('ห้องด้านหน้า')));
// ---- "item: value" lines
t('C1', '"ปั๊มน้ำ: 5.5 kW x 2" -> motor 5.5 kW x2', () => { const r = first('ปั๊มน้ำ: 5.5 kW x 2'); return ok(r.type === 'motor' && r.kw === 5.5 && r.qty === 2, [r.type, r.kw, r.qty]); });
t('C2', '"เต้ารับ: 8 จุด" not dropped', () => ok(R('เต้ารับ: 8 จุด').length === 1, R('เต้ารับ: 8 จุด').length));
t('C3', '"ลิฟต์: 1000 kg" not dropped', () => ok(R('ลิฟต์: 1000 kg').length === 1, R('ลิฟต์: 1000 kg').length));
t('C4', '"โคม LED: 18W x 10" is a light', () => ok(first('โคม LED: 18W x 10').type === 'light', first('โคม LED: 18W x 10').type));
// ---- file formats
t('X1', 'CSV with header floor,room,item,qty,watt -> 2 rows qty 10 / 8, header not a room', () => { const r = R('floor,room,item,qty,watt\n1,ห้องประชุม,โคม LED,10,18\n1,ห้องประชุม,เต้ารับ,8,180'); return ok(r.length === 2 && r[0].fixtures === 10 && r[1].points === 8, r.map((x) => [x.room, x.fixtures || x.points])); });
t('X2', 'quoted CSV field with comma stays one field', () => { const r = R('floor,room,item,qty\n1,"ห้องประชุม, ใหญ่","โคม LED 18W, 2 หลอด",10'); return ok(r.length === 1 && r[0].fixtures === 10 && r[0].perFixture === 2, r.map((x) => [x.room, x.perFixture, x.fixtures])); });
t('X3', 'TSV: qty column read', () => ok(first('1\tห้องประชุม\tโคม LED 18W\t10').fixtures === 10, first('1\tห้องประชุม\tโคม LED 18W\t10').fixtures));
t('X4', 'CR-only line endings (Excel for Mac) -> 2 rows', () => ok(R('ชั้น 1\rห้อง A: LED 18W x 5\rห้อง B: LED 18W x 6').length === 2, R('ชั้น 1\rห้อง A: LED 18W x 5\rห้อง B: LED 18W x 6').length));
t('X5', 'multi-page marker "--- หน้า 2 ---" yields no warning / room', () => { const p = P('ชั้น 1\n--- หน้า 1 ---\nห้อง A: LED 18W x 5\n--- หน้า 2 ---\nโคม LED 18W x 7'); return ok(p.warnings.length === 0 && p.rows[1].room === 'ห้อง A', [p.warnings, p.rows[1].room]); });
// ---- schedule
const hdr = 'PANEL NO. : LP-3 CAPACITY : 12 CKT.\nLOCATION : FLOOR 3\nCKT. NO. DESCRIPTION POLE CB TYPE WIRE CONDUIT CONNECTED LOAD IN VA.\n';
t('S1', 'schedule row, pipe-separated -> VA 700', () => ok(sumVA(R(hdr + '1 | แสงสว่าง | 1 | 10 | MCB | 6 | 2x2.5 | IEC01 | 1/2" | EMT | 700')) === 700, sumVA(R(hdr + '1 | แสงสว่าง | 1 | 10 | MCB | 6 | 2x2.5 | IEC01 | 1/2" | EMT | 700'))));
t('S2', 'schedule row, tab-separated (Excel paste) -> VA 700', () => ok(sumVA(R(hdr + '1\tแสงสว่าง\t1\t10\tMCB\t6\t2x2.5\tIEC01\t1/2"\tEMT\t700')) === 700, sumVA(R(hdr + '1\tแสงสว่าง\t1\t10\tMCB\t6\t2x2.5\tIEC01\t1/2"\tEMT\t700'))));
t('S3', 'ckt no "1-3-5" (3P) -> one sched row 36000 VA, not chiller x25', () => { const r = R(hdr + '1-3-5 Chiller 3 63 MCCB 6 4x25 IEC01 1" EMT 12,000 12,000 12,000'); return ok(r.length === 1 && r[0].sched && r[0].va === 36000, r.map((x) => [x.type, x.qty, x.va])); });
t('S4', 'ckt no 3 digits "101"', () => ok(sumVA(R(hdr + '101 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700')) === 700, sumVA(R(hdr + '101 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700'))));
t('S5', 'CB type word missing -> still not a bogus light row', () => ok(sumVA(R(hdr + '1 แสงสว่าง 1 10 6 2x2.5 IEC01 1/2" EMT 700')) === 700, sumVA(R(hdr + '1 แสงสว่าง 1 10 6 2x2.5 IEC01 1/2" EMT 700'))));
t('S6', 'VA "700.50" -> 700.5 (not 750)', () => ok(sumVA(R(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700.50')) === 700.5, sumVA(R(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700.50'))));
t('S7', 'row with missing VA yields a warning (not silently dropped)', () => ok(P(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT\n2 เต้ารับ 1 16 RCBO 6 2x2.5 IEC01 1/2" EMT 1,800').warnings.length > 0, P(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT\n2 เต้ารับ 1 16 RCBO 6 2x2.5 IEC01 1/2" EMT 1,800').warnings));
t('S8', 'Thai-digit VA "๗๐๐"', () => ok(sumVA(R(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT ๗๐๐')) === 700, sumVA(R(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT ๗๐๐'))));
// ---- buildLayout
t('L1', 'one AC row qty 80 does not create empty LA-1B/LA-1C', () => { const L = lay(R('ชั้น 1\nแอร์ 12000 BTU x 80')); const empty = L.panels.filter((p) => p.kind === 'LP' && !L.items.some((i) => i.panelId === p.id)); return ok(empty.length === 0 && L.panels.filter((p) => p.kind === 'LP').every((p) => L.items.filter((i) => i.panelId === p.id).reduce((s, i) => s + (i.qty || 1), 0) <= 33), empty.map((p) => p.name)); });
t('L2', 'two schedules, same PANEL NO on different floors are not merged', () => { const s = H.read('tests/schedule-sample.txt'); const L = lay(R(s + '\n' + s.replace('FLOOR 1', 'FLOOR 2'))); return ok(L.panels.filter((p) => p.kind === 'LP').length === 2 && !L.panels.some((p) => p.kind === 'SDB' && !L.items.some((i) => i.panelId === p.id) && !L.panels.some((q) => q.parent === p.id)), L.panels.map((p) => p.name)); });
t('L3', 'append the same import twice: no panel above 42 ways', () => { const S = sampleProject(); const big = R('ชั้น 1\n' + Array.from({ length: 25 }, (_, i) => `ห้อง ${i + 1}: โคม LED 18W x 40`).join('\n')); let a = lay(big, clone(S), { mode: 'append' }); S.panels = a.panels; S.items = a.items; let b = lay(big, S, { mode: 'append' }); const r = E.calculate({ meta: S.meta, panels: b.panels, items: b.items }); return ok(!r.warnings.some((w) => /เกิน 42/.test(w)), r.warnings.filter((w) => /42/.test(w))); });
t('L4', 'item ids unique across two imports in the same millisecond', () => { const real = Date.now; const f = real(); Date.now = () => f; try { let p = proj0(); const a = lay(R('ชั้น 1\nA: LED 18W x 5'), p, { mode: 'replace' }); p.panels = a.panels; p.items = a.items; const b = lay(R('ชั้น 1\nB: LED 18W x 7'), p, { mode: 'append' }); return ok(b.items.length === new Set(b.items.map((i) => i.id)).size, b.items.map((i) => i.id)); } finally { Date.now = real; } });
// (ปรับ) ต้นฉบับห้ามรวมเข้า LP-1 เดิมเลย — สัญญา C: ใน append รวมเข้าแผงเดิมได้ "เฉพาะเมื่อยังมีที่" และห้ามเกินความจุ (33 ช่อง) ส่วนเกินไปแผงพี่น้อง LP-1B
t('L5', 'append into project with existing LP-1: joins it only while capacity remains, never above 33 slots', () => {
  const S = sampleProject(); const m = Object.assign(meta(), S.meta);
  const lp1Id = S.panels.find((p) => p.name === 'LP-1').id;
  const before = H.slotsIn(S, lp1Id, m);
  const rooms = (n, tag) => R('ชั้น 1\n' + Array.from({ length: n }, (_, i) => `ห้อง ${tag}${i}: โคม LED 18W x 5`).join('\n'));   // 1 วงจรต่อห้อง
  // นำเข้ารอบแรกให้ LP-1 เหลือที่ว่าง 3 ช่อง แล้วนำเข้ารอบสองอีก 10 วงจร → เติม LP-1 ให้เต็มที่ 33 ที่เหลือไปแผงพี่น้อง ห้ามเกินความจุ
  const a = lay(rooms(33 - before - 3, 'a'), clone(S), { mode: 'append' });
  const S2 = { meta: S.meta, panels: a.panels, items: a.items };
  const b = lay(rooms(10, 'b'), S2, { mode: 'append' });
  const lp = b.panels.filter((p) => p.kind === 'LP' && p.parent === 'MDB' && /^LP-1/.test(p.name));
  const slots = Object.fromEntries(lp.map((p) => [p.name, H.slotsIn(b, p.id, m)]));
  const over = Object.keys(slots).filter((k) => slots[k] > 33);
  return ok(over.length === 0 && slots['LP-1'] === 33 && slots['LP-1B'] === 7 && b.panels.filter((p) => p.name === 'LP-1').length === 1, { before, slots });
});
t('L6', 'preview does not create 24 empty panels for 10,000 m2 room', () => { const L = lay(R('ชั้น 1\nโกดัง 10000 ตร.ม.')); return ok(L.panels.filter((p) => p.kind === 'LP' && !L.items.some((i) => i.panelId === p.id)).length === 0, L.panels.length); });

/* ============================ B. parseText: ตัวอักษร/หน่วย/จำนวน ============================ */
console.log('# B. normalisation, units, phases, quantities');
t('ND1', 'Thai digits everywhere (floor, BTU with comma, qty)', () => { const r = R('ชั้น ๓\nแอร์ ๒๔,๐๐๐ BTU x ๒'); return ok(r[0].floor === 3 && r[0].btu === 24000 && r[0].qty === 2, r[0]); });
t('ND2', 'full-width punctuation/letters ("：" "，" "ｘ" "Ｗ")', () => { const r = R('ห้องประชุม：โคม LED １８Ｗ ｘ １０，เต้ารับ ８ จุด'); return ok(r.length === 2 && r[0].fixtures === 10 && r[0].lamp === 'led-t8-18' && r[1].points === 8, r.map((x) => [x.type, x.fixtures, x.points])); });
t('ND3', 'NBSP / ideographic space between tokens', () => { const r = first('ชั้น\u00A02\nห้อง\u00A0A:\u00A0LED\u00A018W\u3000x\u00A05'); return ok(r.floor === 2 && r.fixtures === 5, [r.floor, r.fixtures]); });
t('ND4', 'zero-width characters inside tokens are removed', () => { const r = first('โคม\u200B LED 1\u200B8W x\u200B 5'); return ok(r.lamp === 'led-t8-18' && r.fixtures === 5, [r.lamp, r.fixtures]); });
t('ND5', 'BOM at the start does not break the first line', () => ok(first('\uFEFFชั้น 2\nA: LED 18W x 5').floor === 2, first('\uFEFFชั้น 2\nA: LED 18W x 5').floor));
t('ND6', 'U+2028 / U+2029 / CRLF line separators', () => { const a = R('ชั้น 1\u2028ห้อง A: LED 18W x 5\u2029ห้อง B: LED 18W x 6'); const b = R('ชั้น 1\r\nห้อง A: LED 18W x 5\r\nห้อง B: LED 18W x 6\r\n'); return ok(a.length === 2 && b.length === 2 && b[1].floor === 1, [a.length, b.length]); });
t('TH1', '"3500วัตต์" attached + "x 2"', () => { const r = first('เครื่องทำน้ำอุ่น 3500วัตต์ x 2'); return ok(r.watt === 3500 && r.qty === 2, [r.watt, r.qty]); });
t('TH2', '"โคม LED 18 วัตต์ x 10" -> led-t8-18 x10', () => { const r = first('โคม LED 18 วัตต์ x 10'); return ok(r.lamp === 'led-t8-18' && r.fixtures === 10, [r.lamp, r.fixtures]); });
t('TH3', '"ปั๊ม 10 แรงม้า" -> 7.5 kW, "ปั๊ม 3HP" -> 3, "ปั๊ม 1.5 กิโลวัตต์"', () => ok(first('ปั๊ม 10 แรงม้า').kw === 7.5 && first('ปั๊ม 3HP').kw === 3 && first('ปั๊ม 1.5 กิโลวัตต์').kw === 1.5, [first('ปั๊ม 10 แรงม้า').kw, first('ปั๊ม 3HP').kw, first('ปั๊ม 1.5 กิโลวัตต์').kw]));
t('TH4', 'motor larger than the table is not snapped down (250 kW stays 250)', () => ok(first('ปั๊ม 250 kW').kw === 250, first('ปั๊ม 250 kW').kw));
t('PH1', '3-phase tokens never become quantity (motor)', () => { const s = ['ปั๊ม 11 kW 3 เฟส', 'pump 11 kW 3 phase', 'pump 11 kW 3P', 'pump 11 kW 3-phase', 'pump 11 kW 3φ', 'pump 11 kW 380V', 'pump 11 kW 400V']; const g = s.map((x) => [first(x).qty, first(x).phases]); return ok(g.every((x) => x[0] === 1 && x[1] === 3), g); });
t('PH2', '1-phase tokens (motor): 1 เฟส / 1P / single phase / 220V / 230V', () => { const s = ['ปั๊ม 0.75 kW 1 เฟส', 'ปั๊ม 0.75 kW 1P', 'ปั๊ม 0.75 kW single phase', 'ปั๊ม 0.75 kW 220V', 'pump 0.75 kW 230V']; const g = s.map((x) => [first(x).qty, first(x).phases]); return ok(g.every((x) => x[0] === 1 && x[1] === 1), g); });
t('PH3', 'UPS / custom load phases', () => { const a = first('UPS 10 kVA 3P'), b = first('UPS 3 kVA 1P'), c = first('UPS 20 kVA 380V'); return ok(a.phases === 3 && b.phases === 1 && c.phases === 3 && a.qty === 1 && b.qty === 1, [a.phases, b.phases, c.phases]); });
t('PH4', 'AC with phase token and real quantity', () => { const a = first('แอร์ 48,000 BTU 3 เฟส 2 เครื่อง'), b = first('แอร์ 2 เครื่อง 48,000 BTU 3P'), c = first('แอร์ 48000 BTU 3 เฟส'); return ok(a.qty === 2 && b.qty === 2 && c.qty === 1 && a.btu === 48000, [a.qty, b.qty, c.qty, a.btu]); });
t('PH5', 'heater 3 เฟส keeps 3 phases, 9000 W, qty 1', () => { const r = first('เครื่องทำน้ำอุ่น 9 kW 3 เฟส'); return ok(r.qty === 1 && r.phases === 3 && r.watt === 9000, r); });
t('PH6', 'room/zone/tag numbers are not quantities', () => { const g = [first('ห้อง 301 ปั๊ม 5.5 kW').qty, first('Zone 3 แอร์ 12000 BTU').qty, first('FCU-2 12000 BTU').qty, first('AHU No. 2 5.5 kW').qty, first('Room 2 Downlight 9W').fixtures, first('ลิฟต์ 1000 kg ชั้น 8').qty]; return ok(g.every((x) => x === 1), g); });
t('PH7', 'floor token inside an equipment line does not change the floor', () => { const r = R('ชั้น 3\nลิฟต์ 1000 kg ชั้น 8\nA: LED 18W x 2'); return ok(r[1].floor === 3, r.map((x) => x.floor)); });
t('QT1', '"10 x 18W" (spaces) -> 10 fixtures x 1 lamp; "2x18W" alone -> 2 lamps x 1', () => { const a = first('โคม LED 10 x 18W'), b = first('โคม LED 2x18W'); return ok(a.fixtures === 10 && a.perFixture === 1 && b.perFixture === 2 && b.fixtures === 1, [a.perFixture, a.fixtures, b.perFixture, b.fixtures]); });
t('QT2', '"2x18W x 10" -> 2 lamps x 10 fixtures; "2x36W fluorescent 10 ชุด"', () => { const a = first('โคม LED 2x18W x 10'), b = first('โคมฟลูออเรสเซนต์ T8 2x36W 10 ชุด'); return ok(a.perFixture === 2 && a.fixtures === 10 && b.lamp === 't8-36' && b.perFixture === 2 && b.fixtures === 10, [a.perFixture, a.fixtures, b.lamp, b.perFixture, b.fixtures]); });
t('QT3', '"10 โคม 2 หลอด" and "3 หลอด/โคม 45 โคม" and "2 หลอด ต่อ 1 โคม x 10"', () => { const a = first('โคม LED 18W 10 โคม 2 หลอด'), b = first('โคม LED 18W 3 หลอด/โคม 45 โคม'), c = first('โคม LED 18W 2 หลอด ต่อ 1 โคม x 10'); return ok(a.perFixture === 2 && a.fixtures === 10 && b.perFixture === 3 && b.fixtures === 45 && c.perFixture === 2 && c.fixtures === 10, [a, b, c].map((x) => [x.perFixture, x.fixtures])); });
t('QT4', '"หลอด LED 18W 20 หลอด" -> 20 fixtures x 1', () => { const r = first('หลอด LED 18W 20 หลอด'); return ok(r.fixtures === 20 && r.perFixture === 1, [r.fixtures, r.perFixture]); });
t('QT5', 'huge quantities clamp at 5000 with a Thai warning', () => { const a = P('แอร์ 12000 BTU x 99999'), b = P('โคม LED 18W x 6000'); return ok(a.rows[0].qty === 5000 && b.rows[0].fixtures === 5000 && a.warnings.some((w) => /5,?000/.test(w)) && b.warnings.some(thai), [a.rows[0].qty, b.rows[0].fixtures, a.warnings]); });
t('QT6', 'zero / negative quantity: no row with 0, warning given', () => { const g = ['แอร์ 12000 BTU x 0', 'โคม LED 18W x -3', 'เต้ารับ 0 จุด'].map((s) => P(s)); return ok(g.every((p) => p.rows.every((r) => r.qty !== 0 && r.fixtures !== 0 && r.points !== 0) && p.warnings.length > 0 && p.warnings.every(thai)), g.map((p) => [p.rows.length, p.warnings])); });
t('QT7', 'labelled quantity: จำนวน / qty:', () => { const g = ['โคม LED 18W จำนวน 10', 'โคม LED 18W qty: 10', 'โคม LED 18W จำนวน 10 ชุด'].map((s) => first(s).fixtures); return ok(g.every((x) => x === 10), g); });
t('QT8', 'x2 spellings: x2 / ×2 / * 2 / X 2', () => { const g = ['แอร์ 24,000 BTU x2', 'แอร์ 24,000 BTU ×2', 'แอร์ 24,000 BTU * 2', 'แอร์ 24,000 BTU X 2'].map((s) => [first(s).btu, first(s).qty]); return ok(g.every((x) => x[0] === 24000 && x[1] === 2), g); });
t('QT9', 'prefix quantity: "2 x 24000 BTU" and "5 x โคม LED 18W"', () => { const a = first('แอร์ 2 x 24000 BTU'), b = first('5 x โคม LED 18W'); return ok(a.qty === 2 && a.btu === 24000 && b.fixtures === 5, [a.qty, a.btu, b.fixtures]); });
t('QT10', 'unit words: เครื่อง / 2เครื่อง / units / points / ช่อง', () => { const g = [first('แอร์ 24000 BTU 2 เครื่อง').qty, first('แอร์ 24000 BTU 2เครื่อง').qty, first('A/C 24000 BTU 3 units').qty, first('outlet 50 points').points, first('ปลั๊ก 6 ช่อง').points, first('ปลั๊กไฟ 3 ช่อง x 6').points]; return eqArr(g, [2, 2, 3, 50, 6, 6]); });
t('QT11', 'lone trailing integer is the quantity ("แอร์ 12000 BTU 5", "Outlet 10")', () => ok(first('แอร์ 12000 BTU 5').qty === 5 && first('Outlet 10').points === 10, [first('แอร์ 12000 BTU 5').qty, first('Outlet 10').points]));
t('QT12', 'dimensions / lux are not quantities ("60x60 cm", "300 lux")', () => { const a = first('โคม LED 60x60 cm 18W x 4'), b = first('โคม LED 18W 300 lux x 5'); return ok(a.fixtures === 4 && a.lamp === 'led-t8-18' && b.fixtures === 5, [a.fixtures, b.fixtures]); });
function eqArr(a, b) { return ok(JSON.stringify(a) === JSON.stringify(b), a); }

console.log('# B2. item: value lines, unreadable lines, central');
t('CL1', '"เครื่องทำน้ำอุ่น: 3500W" / "แอร์: 24,000 BTU x 2" / "แอร์: 2 เครื่อง" / "ตู้เย็น: 150W x 3"', () => { const a = first('เครื่องทำน้ำอุ่น: 3500W'), b = first('แอร์: 24,000 BTU x 2'), c = first('แอร์: 2 เครื่อง'), d = first('ตู้เย็น: 150W x 3'); return ok(a.type === 'heater' && a.watt === 3500 && b.type === 'ac' && b.btu === 24000 && b.qty === 2 && c.type === 'ac' && c.qty === 2 && d.type === 'custom' && d.watt === 150 && d.qty === 3, [a.type, a.watt, b.btu, b.qty, c.type, c.qty, d.type, d.watt, d.qty]); });
t('CL2', 'item head keeps the room context (name = item, room unchanged)', () => { const r = R('ห้องเครื่อง\nปั๊มน้ำ: 5.5 kW x 2'); return ok(r[0].type === 'motor' && /ปั๊มน้ำ/.test(r[0].name) && r[0].room === 'ห้องเครื่อง', r[0]); });
t('CL3', 'room head with typed items is still a room ("Server room: แอร์..., UPS...")', () => { const r = R('Server room: แอร์ 18000 BTU x 2, UPS 3 kVA'); return ok(r.length === 2 && r[0].room === 'Server room' && r[0].type === 'ac' && r[1].type === 'custom' && r[1].va === 3000, r.map((x) => [x.room, x.type])); });
t('CL4', 'item head with several values: "แอร์: 24,000 BTU x 2, 12,000 BTU x 1" -> 2 AC rows', () => { const r = R('แอร์: 24,000 BTU x 2, 12,000 BTU x 1'); return ok(r.length === 2 && r.every((x) => x.type === 'ac') && r[0].btu === 24000 && r[1].btu === 12000, r.map((x) => [x.type, x.btu, x.qty])); });
t('CL5', 'room + area + items without a colon: "ห้องประชุม 40 ตร.ม. โคม LED 18W x 10"', () => { const r = R('ห้องประชุม 40 ตร.ม. โคม LED 18W x 10'); return ok(r.length === 1 && r[0].room === 'ห้องประชุม' && r[0].area === 40 && r[0].fixtures === 10, r.map((x) => [x.room, x.area, x.fixtures])); });
t('CL6', 'comma list without colon: first untyped part is the room ("ห้อง A, LED 18W x 5")', () => { const r = R('ห้อง A, LED 18W x 5, เต้ารับ 4 จุด'); return ok(r.length === 2 && r[0].room === 'ห้อง A', r.map((x) => [x.room, x.type])); });
t('CL7', 'unreadable lines produce a Thai warning, never a silent drop', () => { const g = ['เครื่องกำเนิดไฟ', 'ข้อความอะไรก็ไม่รู้', 'สวิตช์ไฟ 20 จุด'].map((s) => P(s)); return ok(g.every((p) => p.warnings.length > 0 && p.warnings.every(thai)), g.map((p) => p.warnings)); });
t('CL8', 'plain room header followed by item lines produces no warning', () => { const p = P('ชั้น 1\nห้องประชุม\nโคม LED 18W x 10\nเต้ารับ 8 จุด'); return ok(p.warnings.length === 0 && p.rows.length === 2 && p.rows.every((r) => r.room === 'ห้องประชุม'), [p.warnings, p.rows.map((r) => r.room)]); });
t('CE1', 'central room name only affects its own line ("ห้องปั๊ม:" then office)', () => { const r = R('ชั้น 2\nห้องปั๊ม: ปั๊มน้ำ 5.5 kW\nสำนักงาน: LED 18W x 5'); return ok(r[0].central === true && r[1].floor === 2 && !r[1].central, r.map((x) => [x.floor, x.central])); });
t('CE2', 'a bare "ส่วนกลาง" header still switches the following lines until the next floor', () => { const r = R('ชั้น 2\nA: LED 18W x 5\nส่วนกลาง\nปั๊มน้ำ 5.5 kW\nไฟทางเดิน LED 9W x 4\nชั้น 3\nB: LED 18W x 3'); return ok(r[0].floor === 2 && !r[0].central && r[1].floor === 0 && r[1].central && r[2].floor === 0 && r[2].central && r[3].floor === 3 && !r[3].central, r.map((x) => [x.floor, x.central])); });
t('CE3', 'area-only central room is estimated AND central; the next room is not', () => { const r = R('ชั้น 2\nPump room 20 ตร.ม.\nสำนักงาน 100 ตร.ม.'); const pr = r.filter((x) => /Pump/.test(x.room)), of = r.filter((x) => x.room === 'สำนักงาน'); return ok(pr.length > 0 && pr.every((x) => x.central && x.est) && of.length > 0 && of.every((x) => !x.central && x.floor === 2), r.map((x) => [x.room, x.floor, x.central])); });
t('CE4', 'floors ≤ 0 (B1 / ชั้นใต้ดิน / Roof) are central', () => { const g = ['B1\nจอดรถ: LED 18W x 10', 'ชั้นใต้ดิน\nจอดรถ: LED 18W x 10', 'Roof\nExhaust fan 0.75 kW x 2'].map((s) => first(s)); return ok(g.every((r) => r.floor <= 0 && r.central === true), g.map((r) => [r.floor, r.central])); });
t('CE5', 'central room header then item lines (no colon), next room back to the floor', () => { const r = R('ชั้น 2\nห้องปั๊ม\nปั๊มน้ำ 5.5 kW\nสำนักงาน\nLED 18W x 5'); return ok(r[0].central === true && r[1].floor === 2 && !r[1].central, r.map((x) => [x.room, x.floor, x.central])); });

console.log('# B3. keywords, lamps, AC/lift/chiller tables');
t('KW1', '"ไฟ" real light words are lights', () => { const g = ['ไฟทางเดิน LED 18W x 10', 'ไฟส่องสว่าง 5 จุด', 'ไฟ LED 9W x 4', 'ไฟห้องน้ำ 3 ดวง'].map((s) => first(s).type); return ok(g.every((x) => x === 'light'), g); });
t('KW2', '"ไฟ" inside other words is not light (ไฟล์ / ไฟฟ้า / สวิตช์ไฟ)', () => { const a = R('ห้องเก็บไฟล์ 20 ตร.ม.'), b = R('ห้องไฟฟ้า 10 ตร.ม.'); return ok(a.length > 0 && a.every((r) => r.est) && b.length > 0 && b.every((r) => r.est) && first('สวิตช์ไฟ 20 จุด').type !== 'light', [a.map((r) => r.type), b.map((r) => r.type)]); });
t('KW3', 'Latin keywords need word-ish boundaries (Groups / Setups / Back office / Pumpkin / Lamphun / Compressor room)', () => { const s = ['Groups meeting room 30 ตร.ม.', 'Setups area 20 ตร.ม.', 'Back office 40 ตร.ม.', 'Pumpkin cafe 30 ตร.ม.', 'Lamphun branch 200 ตร.ม.', 'Compressor room 20 ตร.ม.', 'Control room 20 ตร.ม.']; const g = s.map((x) => R(x)); return ok(g.every((rs) => rs.length > 0 && rs.every((r) => r.est)), g.map((rs) => rs.map((r) => r.type))); });
t('KW4', 'Latin keywords still match next to Thai or digits (โคมLED / UPS3kVA / Motors)', () => { const a = first('โคมLED 18W x 5'), b = first('UPS3kVA'), c = first('Motors 2.2 kW x 3'); return ok(a.type === 'light' && b.type === 'custom' && b.va === 3000 && c.type === 'motor' && c.qty === 3, [a.type, b.type, b.va, c.type, c.qty]); });
t('KW5', '"Server room 30 ตร.ม." uses the server rule (A/C 1200 BTU/m2 -> 36000)', () => { const r = R('Server room 30 ตร.ม.'); const ac = r.find((x) => x.type === 'ac'); return ok(ac && ac.btu === 36000 && r.every((x) => x.est), r.map((x) => [x.type, x.btu])); });
t('KW6', 'area-only lines with equipment words in a room name are estimated ("AC room", "ห้องปั๊ม")', () => { const g = ['AC room 20 ตร.ม.', 'ห้องปั๊ม 20 ตร.ม.', 'ห้องเครื่องปรับอากาศ 30 ตร.ม.'].map((s) => R(s)); return ok(g.every((rs) => rs.length > 0 && rs.every((r) => r.est)), g.map((rs) => rs.map((r) => [r.type, r.est]))); });
t('KW7', 'an equipment line with an area keeps its spec ("แอร์ 20 ตร.ม." sizes by area)', () => { const r = R('แอร์ 20 ตร.ม.'); return ok(r.length === 1 && r[0].type === 'ac' && r[0].est === true && r[0].btu === 18000, r.map((x) => [x.type, x.btu, x.est])); });
t('LM1', 'T8 36W without the word fluorescent -> t8-36; bare T8 18W -> LED', () => ok(first('โคม T8 36W x 10').lamp === 't8-36' && first('โคม T8 18W').lamp === 'led-t8-18' && first('โคม LED T8 18W').lamp === 'led-t8-18', [first('โคม T8 36W x 10').lamp, first('โคม T8 18W').lamp]));
t('LM2', 'LED 100W floodlight keeps its wattage (custom light load or ≥100 W lamp), VA ≥ 400', () => { const r = first('Floodlight LED 100W x 4'); const va = H.vaOfRows([r], meta()); const okShape = r.type === 'light' ? E.lampById(r.lamp).w >= 100 : (r.type === 'custom' && r.cat === 'light' && r.watt === 100 && r.qty === 4); return ok(okShape && va >= 400, [r.type, r.cat, r.watt, r.lamp, va]); });
t('LM3', 'nearest valid lamp by wattage: 20W -> 18, 8W -> bulb 8, 7W -> t8-7', () => { const w = (s) => E.lampById(first(s).lamp).w; return ok(w('โคม LED 20W') === 18 && first('โคม LED 8W').lamp === 'led-bulb-8' && first('โคม LED 7W').lamp === 'led-t8-7', [w('โคม LED 20W'), first('โคม LED 8W').lamp, first('โคม LED 7W').lamp]); });
t('LM4', 'downlight 9W rounds up to led-bulb-10 (as before)', () => ok(first('ดาวน์ไลท์ LED 9W x 20').lamp === 'led-bulb-10', first('ดาวน์ไลท์ LED 9W x 20').lamp));
t('LM5', 'T5 / HID families and out-of-table HID falls back to a custom light load', () => { const a = first('โคม T5 2x14W 5 ชุด'), b = first('HPS 150W x 3'), c = first('metal halide 400W x 2'), d = first('HPS 1000W x 2'); return ok(a.lamp === 't5-14' && a.perFixture === 2 && b.lamp === 'hps-150' && c.lamp === 'mh-400' && d.type === 'custom' && d.cat === 'light' && d.watt === 1000 && d.qty === 2, [a.lamp, b.lamp, c.lamp, d.type, d.cat, d.watt]); });
t('LM6', 'pf is applied: "อุปกรณ์ 1500 W pf 0.8" -> 1875 VA', () => ok(Math.round(H.vaOfRows([first('อุปกรณ์ 1500 W pf 0.8')], meta())) === 1875, H.vaOfRows([first('อุปกรณ์ 1500 W pf 0.8')], meta())));
t('AC1', 'AC unit spellings -> BTU', () => { const g = ['แอร์ 1.5 ตัน x 2', 'split type 3 TR 4 units', 'แอร์ 12k BTU', 'แอร์ 12000 BTU/h 5 เครื่อง', 'แอร์ 18,000 btu'].map((s) => first(s).btu); return eqArr(g, [18000, 36000, 12000, 12000, 18000]); });
t('AC2', 'AC without BTU is an estimate with the quantity ("แอร์ 3 เครื่อง")', () => { const r = first('แอร์ 3 เครื่อง'); return ok(r.est === true && r.qty === 3 && r.btu === 12000, [r.est, r.qty, r.btu]); });
t('LF1', 'lift above the table (2000 kg) uses a custom kVA with a flag, not 1000 kg', () => { const r = first('ลิฟต์ 2000 kg'); return ok(r.kva > 34 && typeof r.flag === 'string' && r.flag.length > 0, [r.kva, r.flag, r.preset]); });
t('LF2', 'lift in the table picks the first entry ≥ the load (1000 kg / 1600 kg / 20 persons)', () => { const a = first('ลิฟต์ 1000 kg'), b = first('ลิฟต์ 1600 kg'), c = first('Lift 20 persons x 2'); return ok(D.LIFTS[a.preset][0] === 1000 && !a.flag && D.LIFTS[b.preset][0] === 1600 && D.LIFTS[c.preset][1] === 20 && c.qty === 2, [D.LIFTS[a.preset], D.LIFTS[b.preset], D.LIFTS[c.preset]]); });
t('CH1', 'chiller above the table (400 TR) -> custom kVA + flag (not the 71 TR preset)', () => { const r = first('Chiller 400 TR'); return ok(r.kva > 210 && typeof r.flag === 'string' && r.flag.length > 0, [r.kva, r.flag, r.preset]); });
t('CH2', 'chiller in range: water 150 ตัน -> 154 TR, air 100 TR -> 110 TR, 71 TR -> first', () => { const a = first('ชิลเลอร์ 150 ตัน'), b = first('Chiller 100 TR air cooled'), c = first('Chiller 71 TR'); return ok(D.CHILLER_WATER[a.preset][0] === 154 && b.cooling === 'air' && D.CHILLER_AIR[b.preset][0] === 110 && c.preset === 0 && !a.flag, [a.preset, b.preset, c.preset]); });
t('CH3', 'chiller with explicit kVA keeps it', () => ok(first('Chiller 100 kVA').kva === 100, first('Chiller 100 kVA').kva));
console.log('# B4. review-found cases');
t('RV1', 'unit glued to "x N": "LED 9Wx10" / "แอร์ 12000BTUx2"', () => { const a = first('โคม LED 9Wx10'), b = first('แอร์ 12000BTUx2'); return ok(a.lamp === 'led-t8-9' && a.fixtures === 10 && b.btu === 12000 && b.qty === 2, [a.lamp, a.fixtures, b.btu, b.qty]); });
t('RV2', 'fractional horsepower: 1/2 HP, 1 1/2 HP', () => ok(first('ปั๊มน้ำ 1/2 แรงม้า').kw === 0.37 && first('ปั๊ม 1 1/2 HP').kw === 1.12, [first('ปั๊มน้ำ 1/2 แรงม้า').kw, first('ปั๊ม 1 1/2 HP').kw]));
t('RV3', '"มอเตอร์ไซค์" (motorcycle) is not a motor; AHU is a 3-phase motor', () => { const a = R('ที่จอดมอเตอร์ไซค์ 100 ตร.ม.'); const b = first('AHU 7.5 kW 3 เฟส'); return ok(a.length > 0 && a.every((r) => r.est && r.type !== 'motor') && b.type === 'motor' && b.kw === 7.5 && b.phases === 3, [a.map((r) => r.type), b.type]); });
t('RV4', '"Basement parking: LED" is a central room line; the next room keeps the floor', () => { const r = R('ชั้น 4\nBasement parking: LED 18W x 10\nOffice: LED 18W x 5'); return ok(r[0].central === true && r[1].floor === 4 && !r[1].central, r.map((x) => [x.room, x.floor, x.central])); });
t('RV5', '"item,qty" form: "โคม LED 18W,10" and "ห้อง A,แอร์ 24,000 BTU,2"', () => { const a = P('โคม LED 18W,10'), b = P('ห้อง A,แอร์ 24,000 BTU,2'); return ok(a.rows[0].fixtures === 10 && a.warnings.length === 0 && b.rows[0].btu === 24000 && b.rows[0].qty === 2 && b.rows[0].room === 'ห้อง A', [a.rows[0], b.rows]); });
t('RV6', 'decimal comma before a unit ("อุปกรณ์ 1,5 kW") and OCR "24,OOO BTU"', () => { const a = P('อุปกรณ์ 1,5 kW'), b = first('แอร์ 24,OOO BTU x 2'); return ok(a.rows.length === 1 && a.rows[0].watt === 1500 && b.btu === 24000 && b.qty === 2, [a.rows.map((r) => r.watt), b.btu, b.qty]); });
t('RV7', 'bare 36 W falls back to fluorescent T8 when the text does not say LED; explicit T5 28 W -> t5-25', () => ok(first('โคม 36W x 10').lamp === 't8-36' && first('โคม LED 36W x 10').type === 'custom' && first('โคม T5 28W').lamp === 't5-25', [first('โคม 36W x 10').lamp, first('โคม LED 36W x 10').type]));
t('RV8', 'names stay readable: never empty, unit words after the quantity are dropped', () => { const a = first('FCU-2 12000 BTU 4 เครื่อง'), b = first('T8 LED 2x18W x 10 fixtures'), c = first('โคม LED 2x18W จำนวน 10 ชุด'); return ok(a.name.length > 0 && !/fixtures/.test(b.name) && c.name === 'โคม LED', [a.name, b.name, c.name]); });
t('RV9', 'multi-level list numbers "1.1 ล็อบบี้" are stripped, but a leading decimal quantity "2.5 kW ปั๊ม" is not', () => { const a = R('1.1 ล็อบบี้ 120 ตร.ม.'), b = first('2.5 kW ปั๊ม'); return ok(a.length > 0 && a.every((r) => r.room === 'ล็อบบี้') && b.type === 'motor' && b.kw === 3, [a.map((r) => r.room), b.kw]); });
t('RC1', 'receptacle per-point VA ("เต้ารับ 10 จุด 200 VA/จุด") is kept',() => ok(first('เต้ารับ 10 จุด 200 VA/จุด').vaPerPoint === 200 && first('เต้ารับ 10 จุด 200 VA/จุด').points === 10, first('เต้ารับ 10 จุด 200 VA/จุด')));

console.log('# C. schedule rows');
t('SC1', 'circuit numbers "1,3" and "1-3" pairs', () => ok(sumVA(R(hdr + '1,3 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700')) === 700 && sumVA(R(hdr + '2-4 เต้ารับ 1 16 RCBO 6 2x2.5 IEC01 1/2" EMT 900')) === 900, 0));
t('SC2', 'single VA on a 3-pole row is the TOTAL of the breaker and `why` says so', () => { const r = R(hdr + '2 Pump 3 20 MCB 6 4x4 IEC01 3/4" EMT 3,000'); return ok(r.length === 1 && r[0].va === 3000 && r[0].phases === 3 && thai(r[0].why) && /รวม/.test(r[0].why), r.map((x) => [x.va, x.phases, x.why])); });
t('SC3', '3-pole row with A B C values sums them', () => { const r = R(hdr + '2 ปั๊มน้ำ 3 20 MCB 6 4x4 IEC01 3/4" EMT 1,000 1,000 1,000'); return ok(r.length === 1 && r[0].va === 3000 && r[0].phases === 3, r.map((x) => [x.va, x.phases])); });
t('SC4', 'SPARE / SPACE / ว่าง rows are skipped without a warning', () => { const p = P(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700\n2 SPARE 1 16 MCB 6 2x2.5 IEC01 1/2" EMT 0\n3 SPACE\n4 ว่าง 1 10 MCB\n5 Spare 1 16 MCB 6 2x2.5 IEC01 1/2" EMT 1,000'); return ok(p.rows.length === 1 && p.warnings.length === 0, [p.rows.length, p.warnings]); });
t('SC5', 'missing-VA warning names the circuit (Thai)', () => { const w = P(hdr + '7 เครื่องซักผ้า 1 16 MCB 6 2x2.5 IEC01 1/2" EMT').warnings; return ok(w.length === 1 && thai(w[0]) && /7/.test(w[0]), w); });
t('SC6', 'VA with decimals in the tail "1,234.5"', () => ok(sumVA(R(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 1,234.5')) === 1234.5, 0));
t('SC7', 'pipe-bordered OCR rows with trailing pipe', () => ok(sumVA(R(hdr + '| 1 | แสงสว่าง | 1 | 10 | MCB | 6 | 2x2.5 | IEC01 | 1/2" | EMT | 700 |\n| 2 | เต้ารับ | 1 | 16 | RCBO | 6 | 2x2.5 | IEC01 | 1/2" | EMT | 1,800 |')) === 2500, 0));
t('SC8', 'TOTAL mismatch warns, TOTAL match verifies', () => { const a = P(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700\nTOTAL CONNECTED LOAD : 999 VA'), b = P(hdr + '1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT 700\nTOTAL CONNECTED LOAD : 700 VA'); return ok(a.warnings.length === 1 && thai(a.warnings[0]) && b.info.verified === true && b.warnings.length === 0, [a.warnings, b.info]); });
t('SC9', 'free text "3 MCB 20A เครื่องล้างจาน 1,500" is not a schedule row', () => { const p = P('3 MCB 20A เครื่องล้างจาน 1,500'); return ok(p.rows.every((r) => !r.sched), p.rows.map((r) => r.type)); });
t('SC10', 'two panels in one text keep separate PANEL NO and floors', () => { const mk = (p, fl, va) => `PANEL NO. : ${p} CAPACITY : 12 CKT.\nLOCATION : FLOOR ${fl}\nCKT. NO. DESCRIPTION POLE CB TYPE WIRE CONDUIT CONNECTED LOAD IN VA.\n1 แสงสว่าง 1 10 MCB 6 2x2.5 IEC01 1/2" EMT ${va}\nTOTAL CONNECTED LOAD : ${va} VA\n`; const r = R(mk('LP-1', 1, 700) + mk('LP-2', 2, 900)); return ok(r.length === 2 && r[0].panelName === 'LP-1' && r[0].floor === 1 && r[1].panelName === 'LP-2' && r[1].floor === 2, r.map((x) => [x.panelName, x.floor, x.va])); });
t('SC11', 'schedule-sample unchanged: 8 rows, 10,860 VA, verified, no warnings, never central', () => { const p = I.parseText(H.read('tests/schedule-sample.txt')); return ok(p.rows.length === 8 && sumVA(p.rows) === 10860 && p.info.verified === true && p.warnings.length === 0 && p.rows.every((r) => !r.central), [p.rows.length, sumVA(p.rows), p.warnings]); });

console.log('# D. ocrFix, page markers, ReDoS caps, performance');
t('OC1', 'ocrFix keeps "หน้า" words intact', () => { const s = ['ห้องด้านหน้า', 'หน้าต่าง', 'หน้า 2', 'ข้างหน้า', 'หน้าที่']; return eqArr(s.map((x) => I.ocrFix(x)), s); });
t('OC2', 'ocrFix still repairs the OCR "น้า" -> "น้ำ" words', () => { const g = [I.ocrFix('ปั๊มน้า'), I.ocrFix('ห้องน้า'), I.ocrFix('เครื่องทำน้าอุ่น'), I.ocrFix('ลิฟท์'), I.ocrFix('LED 18 หป')]; return eqArr(g, ['ปั๊มน้ำ', 'ห้องน้ำ', 'เครื่องทำน้ำอุ่น', 'ลิฟต์', 'LED 18W']); });
t('OC3', 'page markers of every spelling are ignored (no room, no warning)', () => { const p = P('ชั้น 1\nห้อง A: LED 18W x 5\n--- หน้า 2 ---\n--- Page 3 ---\n== หน้า 2/5 ==\n----------\nหน้า 4\nโคม LED 18W x 7'); return ok(p.warnings.length === 0 && p.rows.length === 2 && p.rows[1].room === 'ห้อง A', [p.warnings, p.rows.map((r) => r.room)]); });
t('OC4', 'a real room named with "หน้า" (ห้องด้านหน้า 20 ตร.ม.) is a room and not a marker', () => { const r = R('ห้องด้านหน้า 20 ตร.ม.'); return ok(r.length > 0 && r.every((x) => x.room === 'ห้องด้านหน้า'), r.map((x) => x.room)); });
const ms = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
t('RD1', '100k-char lines (spaces / digits / x / tabs / pipes) parse in < 200 ms each', () => { const bad = {}; const cases = { spaces: ' '.repeat(1e5), digits: '1'.repeat(1e5), x: 'x'.repeat(1e5), sp1: '1 '.repeat(5e4) + 'MCB 1', proj: 'PROJECT ' + 'a '.repeat(5e4), tabs: '\t'.repeat(1e5), pipes: '|'.repeat(1e5), commas: ',,,,'.repeat(25000), floors: 'ชั้น '.repeat(2e4), led: 'LED 1'.repeat(2e4), quotes: '"'.repeat(1e5), dots: '1.'.repeat(5e4), room: 'ห้อง A: ' + ' '.repeat(1e5) + 'LED 18W x 5' }; for (const k in cases) { const d = ms(() => P(cases[k])); if (d > 200) bad[k] = Math.round(d); } return ok(Object.keys(bad).length === 0, bad); });
t('RD2', 'over-long line is truncated to 1500 chars with a warning', () => { const p = P('ห้อง A: ' + 'โคม LED 18W x 5, '.repeat(20000)); return ok(p.warnings.some((w) => /1,?500/.test(w) && thai(w)) && p.rows.length < 200, [p.rows.length, p.warnings]); });
t('RD3', 'text over 2 MB is capped with a warning and still parses quickly', () => { const line = 'ห้อง A: LED 18W x 5\n'; const big = line.repeat(Math.ceil(2.4 * 1024 * 1024 / line.length)); let p; const d = ms(() => { p = P(big); }); return ok(p.warnings.some((w) => /2 ?MB|2,?097,?152/.test(w)) && d < 8000, [Math.round(d), p.warnings.slice(0, 2)]); });
t('RD4', 'ocrFix is linear on whitespace runs and combining marks', () => { const d = Math.max(ms(() => I.ocrFix(' '.repeat(1e5) + 'x')), ms(() => I.ocrFix(' ั'.repeat(5e4))), ms(() => I.ocrFix('น้า'.repeat(3e4)))); return ok(d < 200, d); });
t('RD5', 'many short lines parse linearly (20,000 lines < 3 s)', () => { const txt = Array.from({ length: 10000 }, (_, i) => `ชั้น ${1 + (i % 20)}\nห้อง ${i}: โคม LED 2x18W ${5 + (i % 30)} ชุด, เต้ารับ ${4 + i % 9} จุด`).join('\n'); const d = ms(() => P(txt)); return ok(d < 3000, Math.round(d)); });

console.log('# E. tables (CSV/TSV), decoding, keys, output shape');
const csv = 'ชั้น,ห้อง,รายการ,จำนวน,วัตต์\n1,ห้องประชุม,โคม LED,10,18\n,,เต้ารับ,8,\n2,สำนักงาน,แอร์ 12000 BTU,3,\n';
t('TB1', 'parseTable exists and returns {rows, warnings, info.sourceKind="table"}', () => { const p = I.parseTable ? I.parseTable(csv) : null; return ok(p && Array.isArray(p.rows) && Array.isArray(p.warnings) && p.info && p.info.sourceKind === 'table' && p.rows.length === 3, p && p.rows.length); });
t('TB2', 'Thai headers + blank floor/room cells carry the previous value', () => { const r = R(csv); return ok(r.length === 3 && r[1].floor === 1 && r[1].room === 'ห้องประชุม' && r[1].points === 8 && r[2].floor === 2 && r[2].btu === 12000 && r[2].qty === 3 && r[0].lamp === 'led-t8-18', r.map((x) => [x.floor, x.room, x.type])); });
t('TB3', 'semicolon and tab delimiters with English headers', () => { const a = R('floor;room;item;qty;watt\n1;Office;LED tube;20;18\n1;Office;Outlet;10;'), b = R('floor\troom\titem\tqty\n3\tLab\tLED 18W\t12\n3\tLab\tOutlet\t6'); return ok(a.length === 2 && a[0].fixtures === 20 && a[1].points === 10 && b.length === 2 && b[0].floor === 3 && b[0].fixtures === 12 && b[1].points === 6, [a.map((x) => x.type), b.map((x) => x.type)]); });
t('TB4', 'header synonyms: level/zone/description/quantity + kW/BTU/VA/kVA/pole/area columns', () => { const r = R('level,zone,description,quantity,kW,BTU,VA,kVA,pole,area\n2,Plant,Pump,2,5.5,,,,3,\n2,Plant,AC,3,,24000,,,,\n2,Plant,Load,1,,,1500,,,\n2,Plant,UPS,1,,,,10,3,'); return ok(r.length === 4 && r[0].type === 'motor' && r[0].kw === 5.5 && r[0].qty === 2 && r[0].phases === 3 && r[1].btu === 24000 && r[1].qty === 3 && r[2].va === 1500 && r[3].va === 10000 && r[3].phases === 3, r.map((x) => [x.type, x.kw, x.btu, x.va, x.qty, x.phases])); });
t('TB5', 'room + area columns without items are estimated like free text', () => { const r = R('ชั้น,ห้อง,พื้นที่ (ตร.ม.)\n1,ห้องประชุม,40\n1,ทางเดิน,30'); return ok(r.length > 0 && r.every((x) => x.est) && r.some((x) => x.room === 'ห้องประชุม' && x.type === 'ac'), r.map((x) => [x.room, x.type])); });
t('TB6', 'quoted newline inside a field stays one record; doubled quotes unescaped', () => { const r = R('floor,room,item,qty\n1,"Meeting\nroom","LED 18W",10\n1,"Hall ""A""",Outlet,4'); return ok(r.length === 2 && r[0].room === 'Meeting room' && r[0].fixtures === 10 && r[1].room === 'Hall "A"' && r[1].points === 4, r.map((x) => [x.room, x.type])); });
t('TB7', 'BOM + CRLF + quoted thousands "1,200"', () => { const r = R('\uFEFFfloor,room,item,qty\r\n1,Hall,Outlet,"1,200"\r\n'); return ok(r.length === 1 && r[0].points === 1200, r.map((x) => x.points)); });
t('TB8', 'zero qty and unreadable item cells warn with the row number', () => { const p = P('floor,room,item,qty\n1,A,LED 18W,0\n1,A,xyz unknown thing,2'); return ok(p.rows.length === 0 && p.warnings.length === 2 && p.warnings.every(thai) && /3/.test(p.warnings[1]), p.warnings); });
t('TB9', 'floor cells: G / B1 / ชั้น 2 / 2F', () => { const r = R('floor,room,item,qty\nG,A,Outlet,1\nB1,B,Outlet,1\nชั้น 2,C,Outlet,1\n3F,D,Outlet,1'); return eqArr(r.map((x) => x.floor), [1, -1, 2, 3]); });
t('TB10', 'headerless TSV: floor | room | item | qty', () => { const r = R('1\tห้องประชุม\tโคม LED 18W\t10\n2\tสำนักงาน\tเต้ารับ\t8'); return ok(r.length === 2 && r[0].floor === 1 && r[0].room === 'ห้องประชุม' && r[0].fixtures === 10 && r[1].floor === 2 && r[1].points === 8, r.map((x) => [x.floor, x.room, x.type])); });
t('TB11', 'free text with many commas is NOT mistaken for a table', () => { const p = P(H.read('tests/import-sample.txt')); return ok(p.info.sourceKind === 'text' && p.rows.length > 10, [p.info.sourceKind, p.rows.length]); });
t('TB12', 'a TSV schedule is not hijacked by the table parser', () => { const p = P(hdr + '1\tแสงสว่าง\t1\t10\tMCB\t6\t2x2.5\tIEC01\t1/2"\tEMT\t700\n2\tเต้ารับ\t1\t16\tRCBO\t6\t2x2.5\tIEC01\t1/2"\tEMT\t1,800'); return ok(p.info.sourceKind === 'schedule' && sumVA(p.rows) === 2500, [p.info.sourceKind, sumVA(p.rows)]); });
t('TB13', 'panel column in a CSV names the target panel', () => { const r = R('floor,room,item,qty,panel\n1,A,Outlet,10,LP-9'); return ok(r.length === 1 && r[0].panelName === 'LP-9', r.map((x) => x.panelName)); });
t('TB14', 'parseTable never throws on empty / header-less input and says why', () => { const a = I.parseTable(''), b = I.parseTable('abc;def\n1;2'), c = I.parseTable('no delimiters here'); return ok(a.rows.length === 0 && b.rows.length === 0 && b.warnings.length > 0 && b.warnings.every(thai) && c.rows.length === 0 && c.warnings.every(thai), [a, b.warnings, c.warnings]); });
t('TB15', 'Thai header synonyms: ชั้นที่ / พื้นที่ใช้งาน / อุปกรณ์ / จำนวน / กำลัง (kW) / ขั้ว', () => { const r = R('ชั้นที่,พื้นที่ใช้งาน,อุปกรณ์,จำนวน,กำลัง (kW),ขั้ว\n3,ห้องเครื่อง,ปั๊มน้ำ,2,5.5,3'); return ok(r.length === 1 && r[0].floor === 3 && r[0].room === 'ห้องเครื่อง' && r[0].type === 'motor' && r[0].kw === 5.5 && r[0].qty === 2 && r[0].phases === 3, r.map((x) => [x.floor, x.room, x.type, x.kw, x.qty, x.phases])); });
t('TB16', 'bare "พื้นที่" header is an area when the cells are numbers, a room name when they are text', () => { const a = R('ชั้น,ห้อง,พื้นที่\n1,ห้องประชุม,40'), b = R('ชั้น,พื้นที่,รายการ,จำนวน\n1,สำนักงาน,โคม LED 18W,5'); return ok(a.length > 0 && a.every((x) => x.est && x.area === 40) && b.length === 1 && b[0].room === 'สำนักงาน' && b[0].fixtures === 5, [a.map((x) => x.area), b.map((x) => x.room)]); });
t('PH8', 'AC phase tokens: 1P keeps the 1-phase table, a 3-phase token below 36,000 BTU is not bumped up', () => { const a = first('แอร์ 36000 BTU 1P'), b = first('แอร์ 24000 BTU 3 เฟส'), c = first('แอร์ 48000 BTU 3P'); return ok(a.phases === 1 && a.btu === 36000 && b.btu === 24000 && c.phases === 3 && c.btu === 48000, [a.phases, a.btu, b.btu, c.phases]); });
t('WC1', 'warnings are capped at 200 (+1 summary) and the over-long-line note stays first', () => { const junk = Array.from({ length: 600 }, (_, i) => `ข้อความสุ่ม ${i} ไม่มีสาระ`).join('\n'); const p = P('x'.repeat(2000) + '\n' + junk); return ok(p.warnings.length === 201 && /1,?500/.test(p.warnings[0]) && /อีก/.test(p.warnings[200]), [p.warnings.length, p.warnings[0], p.warnings[200]]); });
t('SK1', 'info.sourceKind: text / table / schedule / empty',() => ok(P('ห้อง A: LED 18W x 5').info.sourceKind === 'text' && P(csv).info.sourceKind === 'table' && P(H.read('tests/schedule-sample.txt')).info.sourceKind === 'schedule' && P('').info.sourceKind === 'empty', [P('ห้อง A: LED 18W x 5').info.sourceKind, P(csv).info.sourceKind, P(H.read('tests/schedule-sample.txt')).info.sourceKind, P('').info.sourceKind]));
t('SK2', 'parseText never throws on null/undefined/non-string and returns the 3 fields', () => { const g = [null, undefined, 42, {}, []].map((x) => I.parseText(x)); return ok(g.every((p) => Array.isArray(p.rows) && Array.isArray(p.warnings) && p.info && typeof p.info.sourceKind === 'string'), 0); });
t('SK3', 'every warning is a non-empty Thai string (mixed bad input)', () => { const p = P('ข้อความมั่ว\nแอร์ x 0\nเครื่องกำเนิดไฟ\n' + hdr + '1 x 1 10 MCB 6 2x2.5 IEC01 1/2" EMT\n' + 'โคม LED 18W x 99999'); return ok(p.warnings.length >= 4 && p.warnings.every(thai), p.warnings); });
const Rd = H.Reader;
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const tis = (s) => Buffer.from([...s].map((ch) => { const c = ch.codePointAt(0); return c >= 0x0E01 && c <= 0x0E5B ? c - 0x0E01 + 0xA1 : c; }));
const sampleTxt = 'ชั้น 1\nห้องประชุม: โคม LED 18W x 10';
t('DC0', 'reader.js loads in Node and exports decodeText', () => ok(Rd && typeof Rd.decodeText === 'function', H.readerError));
t('DC1', 'decodeText: UTF-8 / UTF-8 BOM (stripped) / pure ASCII / empty', () => { const d = Rd.decodeText; return ok(d(ab(Buffer.from(sampleTxt))) === sampleTxt && d(ab(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(sampleTxt)]))) === sampleTxt && d(ab(Buffer.from('abc'))) === 'abc' && d(new ArrayBuffer(0)) === '', 0); });
t('DC2', 'decodeText: UTF-16 LE and BE with BOM', () => { const le = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(sampleTxt, 'utf16le')]); const be = Buffer.from(le); be.swap16(); be[0] = 0xFE; be[1] = 0xFF; const bb = Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(Buffer.from(sampleTxt, 'utf16le')).swap16()]); return ok(Rd.decodeText(ab(le)) === sampleTxt && Rd.decodeText(ab(bb)) === sampleTxt, 0); });
t('DC3', 'decodeText: TIS-620 / windows-874 bytes (Thai Excel "CSV") decode to Thai', () => ok(Rd.decodeText(ab(tis(sampleTxt))) === sampleTxt, Rd.decodeText(ab(tis(sampleTxt)))));
t('DC4', 'decodeText: accepts ArrayBuffer, Uint8Array and Buffer; broken UTF-8 never throws', () => { const b = Buffer.from(sampleTxt); const bad = Buffer.from([0x41, 0xE0, 0xB8]); return ok(Rd.decodeText(new Uint8Array(b)) === sampleTxt && Rd.decodeText(b) === sampleTxt && typeof Rd.decodeText(bad) === 'string', 0); });
t('DC5', 'TIS-620 CSV bytes decoded then parsed gives the right rows', () => { const txt = Rd.decodeText(ab(tis('ชั้น,ห้อง,รายการ,จำนวน\n1,ห้องประชุม,โคม LED 18W,10'))); const r = R(txt); return ok(r.length === 1 && r[0].fixtures === 10 && r[0].room === 'ห้องประชุม', r.length); });
ta('DC6', 'readFile(text/csv) decodes TIS-620 bytes via decodeText (not File.text)', async () => {
  if (!Rd || !Rd.readFile) return ok(false, 'missing');
  const bytes = tis('ชั้น,ห้อง,รายการ,จำนวน\n1,ห้องประชุม,โคม LED 18W,10');
  const fake = { name: 'โหลด.csv', type: 'text/csv', arrayBuffer: async () => ab(bytes), text: async () => new TextDecoder('utf-8').decode(bytes) };
  const r = await Rd.readFile(fake);
  return ok(r.kind === 'text' && R(r.text).length === 1 && r.text.indexOf('ห้องประชุม') >= 0, r.text && r.text.slice(0, 30));
});
t('DC7', 'itemsToLines is exported, linear on whitespace, and joins close parts', () => { if (!Rd || !Rd.itemsToLines) return ok(false, 'missing'); const items = [{ str: 'ห้อง', transform: [1, 0, 0, 1, 10, 100], width: 20 }, { str: 'ประชุม', transform: [1, 0, 0, 1, 31, 100], width: 30 }, { str: ' '.repeat(1e5) + 'x', transform: [1, 0, 0, 1, 80, 100], width: 5 }]; let out; const d = ms(() => { out = Rd.itemsToLines(items); }); return ok(d < 200 && /^ห้องประชุม/.test(out), [d, out.slice(0, 30)]); });
t('DC8', 'the PDF page marker is something parseText ignores', () => { if (!Rd || !Rd.pageMarker) return ok(false, 'missing'); const m = Rd.pageMarker(2); const p = P('ชั้น 1\nห้อง A: LED 18W x 5\n' + m + '\nโคม LED 18W x 7'); return ok(p.warnings.length === 0 && p.rows.length === 2 && p.rows[1].room === 'ห้อง A', [m, p.warnings]); });
t('KY1', 'every row has a string key, unique', () => { const rows = R(H.read('tests/import-sample.txt')); return ok(rows.every((r) => typeof r.key === 'string' && r.key.length > 0) && new Set(rows.map((r) => r.key)).size === rows.length, rows.map((r) => r.key).slice(0, 4)); });
t('KY2', 'key format is `${normalised src}#${n}` and duplicates count in order', () => { const r = R('ชั้น 1\nห้อง A: LED 18W x 5\nห้อง B: LED  18W x 5\nห้อง C: เต้ารับ 4 จุด'); return ok(r[0].key === 'led 18w x 5#0' && r[1].key === 'led 18w x 5#1' && r[2].key === 'เต้ารับ 4 จุด#0', r.map((x) => x.key)); });
t('KY3', 'keys of unchanged lines survive edits elsewhere in the text', () => { const a = R('ชั้น 1\nห้อง A: LED 18W x 5\nห้อง B: เต้ารับ 4 จุด\nห้อง C: แอร์ 12000 BTU'); const b = R('ชั้น 1\nห้อง A: LED 18W x 5\nห้อง B: เต้ารับ 9 จุด\nห้อง C: แอร์ 12000 BTU\nห้อง D: เต้ารับ 1 จุด'); return ok(a[0].key === b[0].key && a[2].key === b[2].key && a[1].key !== b[1].key, [a.map((x) => x.key), b.map((x) => x.key)]); });
t('KY4', 'estimated rows from one room still get unique keys', () => { const rows = R('ชั้น 1\nห้องประชุม 40 ตร.ม.'); return ok(rows.length >= 2 && new Set(rows.map((r) => r.key)).size === rows.length, rows.map((r) => r.key)); });
t('KY5', 'keys also exist for table rows and schedule rows', () => { const a = R(csv), b = R(H.read('tests/schedule-sample.txt')); return ok([a, b].every((rs) => rs.length > 0 && rs.every((r) => typeof r.key === 'string' && /#\d+$/.test(r.key))), 0); });

console.log('# F. buildLayout: dest overrides, placement, panel identity, capacity');
const M = meta();
const slotsOfPanel = (L, name) => { const p = L.panels.find((x) => x.name === name); return p ? H.slotsIn(L, p.id, M) : -1; };
const byName = (L, name) => L.panels.find((p) => p.name === name);
const itemsIn = (L, name) => { const p = byName(L, name); return p ? L.items.filter((i) => i.panelId === p.id) : []; };
const parentName = (L, name) => { const p = byName(L, name); const q = p && L.panels.find((x) => x.id === p.parent); return q && q.name; };
const withDest = (rows, i, dest) => { rows[i].dest = dest; return rows; };
t('RT1', 'rowToItem is exported and produces an engine item', () => { const r = first('โคม LED 18W x 5'); const it = I.rowToItem ? I.rowToItem(r, 'P1') : null; return ok(it && it.panelId === 'P1' && it.type === 'light' && it.fixtures === 5 && typeof it.id === 'string', it); });
t('LY1', 'dest.floor = 3 on a floor-1 row -> placed in LP-3 under SDB-3', () => { const rows = withDest(R('ชั้น 1\nห้อง A: LED 18W x 5'), 0, { floor: 3 }); const L = lay(rows); return ok(itemsIn(L, 'LP-3').length === 1 && parentName(L, 'LP-3') === 'SDB-3' && !byName(L, 'LP-1') && L.placement[0].panelName === 'LP-3' && L.placement[0].floor === 3, [L.panels.map((p) => p.name), L.placement]); });
t('LY2', 'dest.floor = "C" -> LP-C under PB, placement.floor 0', () => { const rows = withDest(R('ชั้น 2\nห้อง A: LED 18W x 5'), 0, { floor: 'C' }); const L = lay(rows); return ok(itemsIn(L, 'LP-C').length === 1 && parentName(L, 'LP-C') === 'PB' && L.placement[0].panelName === 'LP-C' && L.placement[0].floor === 0 && !byName(L, 'SDB-2'), [L.panels.map((p) => p.name), L.placement]); });
t('LY3', 'dest.panel = an auto panel name created by other rows', () => { const rows = withDest(R('ชั้น 1\nA: LED 18W x 5\nชั้น 2\nB: LED 18W x 5'), 0, { panel: 'LP-2' }); const L = lay(rows); return ok(itemsIn(L, 'LP-2').length === 2 && !byName(L, 'LP-1') && L.placement[0].panelName === 'LP-2', [L.panels.map((p) => p.name), L.placement.map((x) => x.panelName)]); });
t('LY4', 'dest.panel = a new name creates that LP under the floor parent', () => { const rows = withDest(R('ชั้น 1\nA: LED 18W x 5'), 0, { panel: 'MYPANEL' }); const L = lay(rows); const p = byName(L, 'MYPANEL'); return ok(p && p.kind === 'LP' && parentName(L, 'MYPANEL') === 'MDB' && itemsIn(L, 'MYPANEL').length === 1 && !byName(L, 'LP-1'), L.panels.map((x) => x.name)); });
t('LY5', 'dest beats row.panelName and row.central', () => { const sch = R(H.read('tests/schedule-sample.txt')); withDest(sch, 0, { panel: 'LP-X' }); const L = lay(sch); const rows = withDest(R('ชั้น 1\nลิฟต์ 1000 kg'), 0, { floor: 2 }); const L2 = lay(rows); return ok(itemsIn(L, 'LP-X').length === 1 && itemsIn(L, 'CU').length === 7 && L2.placement[0].panelName === 'PP-2' && parentName(L2, 'PP-2') === 'SDB-2', [L.panels.map((p) => p.name), L2.panels.map((p) => p.name)]); });
t('LY6', 'dest with undefined fields behaves exactly like no dest', () => { const mk = () => R(H.read('tests/import-sample.txt')); const a = lay(mk()); const rows = mk(); rows.forEach((r, i) => { r.dest = i % 2 ? {} : { floor: undefined, panel: undefined }; }); const b = lay(rows); const sig = (L) => JSON.stringify([L.panels.map((p) => [p.name, p.kind]), L.items.map((i) => [i.type, (L.panels.find((p) => p.id === i.panelId) || {}).name])]); return ok(sig(a) === sig(b), 0); });
t('LY7', 'invalid dest values (NaN, "", spaces, garbage) are ignored', () => { const mk = () => R('ชั้น 2\nห้อง A: LED 18W x 5'); const a = lay(mk()); const rows = withDest(mk(), 0, { floor: NaN, panel: '   ' }); const b = lay(rows); const rows2 = withDest(mk(), 0, { floor: 'abc', panel: '' }); const c = lay(rows2); return ok(b.placement[0].panelName === a.placement[0].panelName && c.placement[0].panelName === a.placement[0].panelName, [a.placement, b.placement, c.placement]); });
t('LY8', 'result shape: panels/items/log/warnings/placement; placement aligned with rows', () => { const rows = R(H.read('tests/import-sample.txt')); const L = lay(rows); return ok(Array.isArray(L.panels) && Array.isArray(L.items) && Array.isArray(L.log) && Array.isArray(L.warnings) && L.placement.length === rows.length && L.placement.every((pl) => { const p = L.panels.find((x) => x.id === pl.panelId); return p && p.name === pl.panelName && typeof pl.floor === 'number'; }), L.placement.length + '/' + rows.length); });
t('LY9', 'a split row reports its first panel in placement and lists the parts', () => { const rows = R('ชั้น 1\nแอร์ 12000 BTU x 80'); const L = lay(rows); const pl = L.placement[0]; return ok(L.panels.some((p) => p.id === pl.panelId) && Array.isArray(pl.split) && pl.split.length === 3, pl); });
t('ID1', 'same PANEL NO on two floors -> two distinct panels, second named "CU (ชั้น 2)"', () => { const s = H.read('tests/schedule-sample.txt'); const L = lay(R(s + '\n' + s.replace('FLOOR 1', 'FLOOR 2'))); return ok(byName(L, 'CU') && byName(L, 'CU (ชั้น 2)') && parentName(L, 'CU') === 'MDB' && parentName(L, 'CU (ชั้น 2)') === 'SDB-2' && itemsIn(L, 'CU').length === 8 && itemsIn(L, 'CU (ชั้น 2)').length === 8, L.panels.map((p) => p.name)); });
t('ID2', 'same PANEL NO on the same floor (two pages) is one panel', () => { const s = H.read('tests/schedule-sample.txt'); const L = lay(R(s + '\n' + s)); return ok(L.panels.filter((p) => p.name === 'CU').length === 1 && itemsIn(L, 'CU').length === 16, L.panels.map((p) => p.name)); });
t('ID3', 'unique panel and item ids even when Date.now and Math.random are frozen', () => { const dn = Date.now, mr = Math.random; Date.now = () => 1700000000000; Math.random = () => 0.5; try { let p = proj0(); const txt = 'ชั้น 1\nA: LED 18W x 5, แอร์ 12000 BTU x 3\nชั้น 2\nB: LED 18W x 5, ปั๊ม 5.5 kW x 2\nส่วนกลาง\nลิฟต์ 1000 kg'; for (let k = 0; k < 3; k++) { const L = lay(R(txt), p, { mode: k ? 'append' : 'replace' }); p = { meta: p.meta, panels: L.panels, items: L.items }; } return ok(new Set(p.items.map((i) => i.id)).size === p.items.length && new Set(p.panels.map((x) => x.id)).size === p.panels.length, [p.items.length, p.panels.length]); } finally { Date.now = dn; Math.random = mr; } });
t('ID4', 'ids are unique against ids already in the project (module counter reset, same millisecond)', () => { const path = require('path'); const dn = Date.now; Date.now = () => 1700000000000; try { const key = require.resolve(path.join(H.ROOT, 'public/js/importer.js')); const orig = I; delete require.cache[key]; const fresh = require(key); global.Importer = orig; const txt = 'ชั้น 1\nA: LED 18W x 5\nชั้น 2\nB: LED 18W x 5'; const a = orig.buildLayout(orig.parseText(txt).rows, proj0(), {}); const b = fresh.buildLayout(fresh.parseText(txt).rows, { meta: meta(), panels: a.panels, items: a.items }, { mode: 'append' }); return ok(new Set(b.items.map((i) => i.id)).size === b.items.length && new Set(b.panels.map((x) => x.id)).size === b.panels.length, [a.items.map((i) => i.id), b.items.map((i) => i.id)]); } finally { Date.now = dn; } });
t('ID5', 'floors ≤ 0, "C" and fractional/NaN floors: ≤0/C -> PB, NaN/undefined -> floor 1', () => { const base = { type: 'light', lamp: 'led-t8-18', perFixture: 1, fixtures: 4, room: 'x', name: 'x', src: 'x' }; const rows = [{ floor: -2 }, { floor: 0, central: false }, { floor: 'C' }, { floor: NaN }, { floor: undefined }, { floor: 2.4 }].map((o, i) => Object.assign({}, base, o, { src: 'x' + i })); const L = lay(rows); const pl = L.placement.map((x) => x.panelName); return ok(pl.slice(0, 3).every((n) => n === 'LP-C') && pl[3] === 'LP-1' && pl[4] === 'LP-1' && pl[5] === 'LP-2', pl); });
t('ID6', 'switchboards are created only where needed (floor 3 only -> MDB, SDB-3, LP-3)', () => { const L = lay(R('ชั้น 3\nA: LED 18W x 5')); return eqArr(L.panels.map((p) => p.name), ['MDB', 'SDB-3', 'LP-3']); });
t('ID7', 'floorHeight: garbage falls back to 3.6 (finite feeder), 4 m changes SDB feeder length', () => { const rows = () => R('ชั้น 3\nA: LED 18W x 5'); const a = lay(rows(), proj0(), { floorHeight: 'abc' }), b = lay(rows(), proj0(), { floorHeight: 4 }), c = lay(rows(), proj0(), { floorHeight: 0 }); const fl = (L) => byName(L, 'SDB-3').feederLength; return ok(isFinite(fl(a)) && fl(a) === Math.round(15 + 3.6 * 2) && fl(b) === 23 && isFinite(fl(c)), [fl(a), fl(b), fl(c)]); });
t('ID8', 'central: lift/chiller directly in PB, small loads in LP-C under PB, PB only when needed', () => { const L = lay(R('ส่วนกลาง\nปั๊มน้ำ 5.5 kW x 2\nลิฟต์ 1000 kg\nไฟทางเดิน LED 18W x 10')); const none = lay(R('ชั้น 1\nA: LED 18W x 5')); return ok(itemsIn(L, 'PB').length === 2 && itemsIn(L, 'LP-C').length === 1 && parentName(L, 'LP-C') === 'PB' && !byName(none, 'PB'), [L.panels.map((p) => p.name), none.panels.map((p) => p.name)]); });
t('ID9', 'a couple of AC circuits join LP-n (no separate LA-n) unless LA-n already exists', () => { const L = lay(R('ชั้น 1\nA: LED 18W x 5, แอร์ 12000 BTU x 2')); const S = sampleProject(); const L2 = lay(R('ชั้น 1\nB: LED 18W x 5, แอร์ 12000 BTU x 2'), S, { mode: 'append' }); return ok(!byName(L, 'LA-1') && itemsIn(L, 'LP-1').length === 2 && L2.placement[1].panelName === 'LA-1', [L.panels.map((p) => p.name), L2.placement.map((x) => x.panelName)]); });
t('CP1', '80 AC units are split 27/27/26 across LA-1A..C (≤ 33 slots each, no empty panel)', () => { const L = lay(R('ชั้น 1\nแอร์ 12000 BTU x 80')); const names = L.panels.filter((p) => p.kind === 'LP').map((p) => p.name); const sl = names.map((n) => slotsOfPanel(L, n)); return ok(JSON.stringify(names) === '["LA-1A","LA-1B","LA-1C"]' && sl.every((s) => s <= 33 && s > 0) && sl.reduce((a, b) => a + b, 0) === 80, [names, sl]); });
t('CP2', '15 separate 3-phase pumps -> PP-2A/PP-2B within 33 slots each', () => { const L = lay(R('ชั้น 2\n' + Array.from({ length: 15 }, (_, i) => `Blower ${i + 1}: blower 5.5 kW`).join('\n'))); const pp = L.panels.filter((p) => /^PP-2/.test(p.name)); const sl = pp.map((p) => slotsOfPanel(L, p.name)); return ok(pp.length === 2 && sl.every((s) => s <= 33) && sl[0] + sl[1] === 45, [pp.map((p) => p.name), sl]); });
t('CP3', 'a named schedule panel with 50 circuits is split by capacity (≤ 33 each, unique names, 50 circuits)', () => { const many = 'PANEL NO. : BIG CAPACITY : 42 CKT.\nLOCATION : FLOOR 1\nCKT. NO. DESCRIPTION POLE CB TYPE WIRE CONDUIT CONNECTED LOAD IN VA.\n' + Array.from({ length: 50 }, (_, i) => `${(i % 42) + 1} Light ${i} 1 10 MCB 6 2x2.5 IEC01 1/2" EMT ${700 + i}`).join('\n'); const L = lay(R(many)); const big = L.panels.filter((p) => /^BIG/.test(p.name)); const sl = big.map((p) => slotsOfPanel(L, p.name)); return ok(big.length === 2 && sl.every((s) => s <= 33 && s > 0) && sl[0] + sl[1] === 50 && new Set(L.panels.map((p) => p.name)).size === L.panels.length, [big.map((p) => p.name), sl]); });
t('CP4', '5000 fixtures in one row (34 circuits) are split over several LP panels, VA conserved', () => { const rows = R('ชั้น 1\nโคม LED 18W x 5000'); const A = H.auditLayout(rows, proj0(), {}); const lps = A.L.panels.filter((p) => p.kind === 'LP'); const sl = lps.map((p) => slotsOfPanel(A.L, p.name)); return ok(lps.length >= 2 && sl.every((s) => s <= 33) && Math.abs(A.expectVA - A.gotVA) < 0.5 && A.emptyNew.length === 0, [lps.length, sl, A.expectVA, A.gotVA]); });
t('CP5', 'capacity follows meta.activeRatio and the largest PANEL_WAYS (0.5 -> 21 slots)', () => { const proj = { meta: Object.assign(meta(), { activeRatio: 0.5 }), panels: [], items: [] }; const L = lay(R('ชั้น 1\nแอร์ 12000 BTU x 80'), proj); const sl = L.panels.filter((p) => p.kind === 'LP').map((p) => slotsOfPanel(L, p.name)); return ok(sl.length >= 4 && sl.every((s) => s <= 21), sl); });
t('CP6', 'central small loads (LP-C) obey capacity too', () => { const L = lay(R('ส่วนกลาง\n' + Array.from({ length: 50 }, (_, i) => `จุด ${i}: LED 18W x 5`).join('\n'))); const lc = L.panels.filter((p) => /^LP-C/.test(p.name)); const sl = lc.map((p) => slotsOfPanel(L, p.name)); return ok(lc.length === 2 && sl.every((s) => s <= 33) && sl[0] + sl[1] === 50, [lc.map((p) => p.name), sl]); });
t('CP7', 'no panel is ever created empty, whatever the input (incl. 10,000 m2 estimate)', () => { const g = ['ชั้น 1\nโกดัง 10000 ตร.ม.', 'ชั้น 2\n' + Array.from({ length: 40 }, (_, i) => `ห้อง ${i + 1}: โคม LED 18W x 40`).join('\n'), 'ชั้น 1\nแอร์ 12000 BTU x 80\nชั้น 2\nแอร์ 12000 BTU x 70']; const bad = g.map((s) => H.auditLayout(R(s), proj0(), {})).filter((a) => a.emptyNew.length || a.dupPanelNames || a.orphanItems); return ok(bad.length === 0, bad.map((a) => a.emptyNew)); });
t('CP8', 'existing LP over capacity gets nothing new; new rows go to the next free sibling', () => { const S = sampleProject(); const lp1 = S.panels.find((p) => p.name === 'LP-1'); for (let i = 0; i < 12; i++) S.items.push({ id: 'ex' + i, panelId: lp1.id, type: 'custom', va: 500, phases: 1, qty: 3, length: 10 }); const before = slotsOfPanel(S, 'LP-1'); const L = lay(R('ชั้น 1\nA: LED 18W x 5'), S, { mode: 'append' }); return ok(before > 33 && slotsOfPanel(L, 'LP-1') === before && L.placement[0].panelName === 'LP-1B', [before, L.placement[0].panelName]); });
t('CP9', 'quantity-5000 rows are laid out quickly (< 2 s each) with VA conserved item by item', () => { const txt = ['ชั้น 1\nแอร์ 12000 BTU x 5000', 'ชั้น 1\nอุปกรณ์ 500 W x 5000', 'ชั้น 1\nเต้ารับ 5000 จุด', 'ชั้น 1\nโคม LED 18W x 5000', 'ส่วนกลาง\nลิฟต์ 1000 kg x 5000', 'ส่วนกลาง\nปั๊ม 5.5 kW x 5000']; const bad = []; for (const s of txt) { const rows = R(s); let L; const d = ms(() => { L = lay(rows); }); const got = H.vaOfItems(L.items, M), want = H.vaOfRows(rows, M); if (d > 2000 || Math.abs(got - want) > 0.5) bad.push([s.split('\n')[1], Math.round(d), Math.round(got), Math.round(want)]); } return ok(bad.length === 0, bad); });
t('CP10', 'no single item exceeds the engine per-item cap (1000 units / 20000 fixtures); central rows are chunked', () => { const L = lay(R('ส่วนกลาง\nลิฟต์ 1000 kg x 5000')); const q = L.items.map((i) => i.qty); return ok(q.length === 5 && q.every((x) => x <= 1000) && q.reduce((a, b) => a + b, 0) === 5000 && L.placement[0].panelName === 'PB', q); });
t('AP1', 'append: a same-named existing panel of another kind is never filled; names stay unique', () => { const pj = { meta: meta(), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, { id: 'X1', name: 'LP-1', kind: 'SDB', phases: 3, parent: 'MDB' }], items: [] }; const L = lay(R('ชั้น 1\nA: LED 18W x 5'), pj, { mode: 'append' }); const p = L.panels.find((x) => x.id === L.placement[0].panelId); return ok(p.kind === 'LP' && p.id !== 'X1' && new Set(L.panels.map((x) => x.name)).size === L.panels.length, L.panels.map((x) => x.name + ':' + x.kind)); });
t('AP2', 'append reuses the existing SDB-2 (no duplicate switchboard)', () => { const S = sampleProject(); const L = lay(R('ชั้น 2\nห้องใหม่: LED 18W x 5'), S, { mode: 'append' }); return ok(L.panels.filter((p) => p.name === 'SDB-2').length === 1 && L.panels.length === S.panels.length, L.panels.map((p) => p.name)); });
t('AP3', 'append and replace never mutate the input project', () => { const S = sampleProject(); const snap = JSON.stringify(S); lay(R('ชั้น 1\nA: LED 18W x 5\nชั้น 5\nB: LED 18W x 5'), S, { mode: 'append' }); lay(R('ชั้น 1\nA: LED 18W x 5'), S, { mode: 'replace' }); return ok(JSON.stringify(S) === snap, 0); });
t('AP4', 'append keeps all existing panels and items byte-for-byte', () => { const S = sampleProject(); const L = lay(R('ชั้น 1\nA: LED 18W x 5, เต้ารับ 4 จุด\nชั้น 4\nB: แอร์ 12000 BTU x 2'), clone(S), { mode: 'append' }); return ok(S.panels.every((p, i) => JSON.stringify(L.panels[i]) === JSON.stringify(p)) && S.items.every((it, i) => JSON.stringify(L.items[i]) === JSON.stringify(it)), 0); });
t('AP5', 'append twice (dest + auto rows) keeps every panel ≤ 33 slots and no overflow warning', () => { let S = sampleProject(); const rows = () => R('ชั้น 1\n' + Array.from({ length: 20 }, (_, i) => `ห้อง ${i}: โคม LED 18W x 40, แอร์ 12000 BTU x 2`).join('\n')); for (let k = 0; k < 3; k++) { const L = lay(rows(), S, { mode: 'append' }); S = { meta: S.meta, panels: L.panels, items: L.items }; } const r = E.calculate(S); const over = S.panels.filter((p) => p.kind === 'LP' && slotsOfPanel(S, p.name) > 33).map((p) => p.name); return ok(over.length === 0 && !r.warnings.some((w) => /เกิน 42/.test(w)), [over, r.warnings.slice(0, 3)]); });
t('AP6', 'replace mode ignores the old project (fresh MDB, old ids gone)', () => { const S = sampleProject(); const L = lay(R('ชั้น 1\nA: LED 18W x 5'), S, { mode: 'replace' }); return ok(L.panels.length === 2 && L.panels[0].kind === 'MDB' && L.items.length === 1, L.panels.map((p) => p.name)); });
t('AP7', 'layout is deterministic (same rows -> same names/structure)', () => { const mk = () => R(H.read('tests/import-sample.txt')); const sig = (L) => JSON.stringify([L.panels.map((p) => [p.name, p.kind, p.feederLength]), L.items.map((i) => [i.type, i.name, i.qty])]); return ok(sig(lay(mk())) === sig(lay(mk())), 0); });
t('AP8', 'import-sample layout keeps the documented panel names', () => eqArr(lay(R(H.read('tests/import-sample.txt'))).panels.map((p) => p.name), ['MDB', 'LP-1', 'LA-1', 'SDB-2', 'LP-2', 'LA-2', 'SDB-3', 'LP-3', 'LA-3', 'PB']));

console.log('# G. conservation property, performance');
// ---- conservation property (สัญญา E)
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, n) => Math.floor(r() * n);
function randText(r) {
  const out = []; const nf = 1 + int(r, 5);
  const itemOf = () => pick(r, [
    () => `โคม LED ${pick(r, [9, 18, 36, 7])}W x ${1 + int(r, 60)}`, () => `โคม T8 ${pick(r, [2, 3, 4])}x${pick(r, [18, 36])}W ${1 + int(r, 30)} ชุด`,
    () => `เต้ารับ ${1 + int(r, 80)} จุด`, () => `แอร์ ${pick(r, [9000, 12000, 18000, 24000, 36000, 48000, 60000])} BTU x ${1 + int(r, 25)}`,
    () => `ปั๊ม ${pick(r, [0.75, 1.5, 5.5, 11])} kW x ${1 + int(r, 6)}`, () => `ปั๊ม ${pick(r, [1, 3, 10])} HP ${pick(r, ['1P', '3P'])}`, () => `เครื่องทำน้ำอุ่น ${pick(r, [3500, 4500])} W x ${1 + int(r, 4)}`,
    () => `ไมโครเวฟ 1200W x ${1 + int(r, 3)}`, () => `UPS ${pick(r, [3, 10])} kVA ${pick(r, ['1P', '3P'])}`, () => `อุปกรณ์ ${100 + int(r, 3000)} W pf 0.${8 + int(r, 2)} x ${1 + int(r, 5)}`,
    () => `ลิฟต์ ${pick(r, [450, 1000, 1600, 2000])} kg`, () => `Chiller ${pick(r, [71, 100, 400])} TR`, () => `บันไดเลื่อน x ${1 + int(r, 2)}`, () => `Floodlight LED 100W x ${1 + int(r, 6)}`]);
  for (let f = 0; f < nf; f++) {
    out.push(pick(r, [`ชั้น ${1 + int(r, 6)}`, `Floor ${1 + int(r, 6)}`, `${1 + int(r, 6)}F`]));
    const nr = 1 + int(r, 6);
    for (let k = 0; k < nr; k++) {
      const kind = r();
      if (kind < 0.25) out.push(`${pick(r, ['ห้องประชุม', 'สำนักงาน', 'ทางเดิน', 'ห้องน้ำ', 'Server room', 'ห้องปั๊ม', 'Lobby'])} ${5 + int(r, 400)} ตร.ม.`);
      else if (kind < 0.35) out.push(pick(r, ['ส่วนกลาง', 'Roof', 'B1']) + '\n' + itemOf()());
      else { const n = 1 + int(r, 4); out.push(`ห้อง ${f}-${k}: ` + Array.from({ length: n }, () => itemOf()()).join(', ')); }
    }
  }
  if (r() < 0.3) out.push(H.read('tests/schedule-sample.txt').replace('FLOOR 1', 'FLOOR ' + (1 + int(r, 4))));
  return out.join('\n');
}
function conserve(label, seeds, mk) {
  t(label[0], label[1], () => {
    const bad = [];
    for (const seed of seeds) {
      const r = H.rng(seed); const text = randText(r); const rows = P(text).rows; if (!rows.length) continue;
      const { proj, opt, mutate } = mk(r);
      if (mutate) mutate(rows, r);
      const existing = { panels: new Set((proj.panels || []).map((p) => p.id)), items: new Set((proj.items || []).map((i) => i.id)) };
      const A = H.auditLayout(rows, clone(proj), opt, existing);
      const why = [];
      if (Math.abs(A.expectVA - A.gotVA) > 0.5) why.push(`VA ${Math.round(A.expectVA)} vs ${Math.round(A.gotVA)}`);
      if (A.dupItemIds) why.push('dup item ids'); if (A.dupPanelIds) why.push('dup panel ids'); if (A.dupPanelNames) why.push('dup panel names');
      if (A.orphanItems) why.push('orphan items'); if (A.unlinked) why.push('unlinked panels'); if (A.emptyNew.length) why.push('empty ' + A.emptyNew); if (A.nan) why.push('NaN');
      if (A.L.placement.length !== rows.length || A.L.placement.some((pl) => !A.L.panels.some((p) => p.id === pl.panelId))) why.push('placement');
      const over = A.L.panels.filter((p) => p.kind === 'LP' && !existing.panels.has(p.id) && H.slotsIn(A.L, p.id, Object.assign(meta(), proj.meta || {})) > 33).map((p) => p.name);
      const manual = rows.some((r) => r.dest && r.dest.panel);   // เลือกแผงเอง → อนุญาตเกินความจุ แต่ต้องมีคำเตือนชื่อแผงนั้น
      if (over.length && !manual) why.push('over capacity ' + over);
      if (over.length && manual && !over.every((n) => A.L.warnings.some((w) => w.indexOf(n) >= 0))) why.push('no warning for over-capacity manual panel ' + over);
      if (why.length) bad.push([seed, why.join('; ')]);
    }
    return ok(bad.length === 0, bad.slice(0, 5));
  });
}
const seedsA = Array.from({ length: 60 }, (_, i) => i + 1), seedsB = Array.from({ length: 30 }, (_, i) => i + 101), seedsC = Array.from({ length: 40 }, (_, i) => i + 201);
conserve(['CV1', 'conservation (replace): Σ row VA == project connected VA; no dup/orphan/empty/NaN; capacity ≤ 33 (60 random inputs)'], seedsA, () => ({ proj: proj0(), opt: {} }));
conserve(['CV2', 'conservation (append onto SAMPLE_PROJECT, 30 random inputs)'], seedsB, () => ({ proj: sampleProject(), opt: { mode: 'append' } }));
conserve(['CV3', 'conservation with random dest overrides (floor / "C" / panel names, 40 random inputs)'], seedsC, () => ({ proj: proj0(), opt: {}, mutate: (rows, r) => rows.forEach((row) => { if (r() < 0.3) row.dest = { floor: pick(r, [undefined, 1, 2, 5, 'C', 0, -1]), panel: pick(r, [undefined, undefined, 'LP-1', 'ZZ', 'ZZ', 'LP-9']) }; }) }));
conserve(['CV4', 'conservation (append) with dest overrides onto SAMPLE_PROJECT'], seedsC.slice(0, 20), () => ({ proj: sampleProject(), opt: { mode: 'append' }, mutate: (rows, r) => rows.forEach((row) => { if (r() < 0.3) row.dest = { floor: pick(r, [undefined, 2, 3, 'C']), panel: pick(r, [undefined, 'LP-2', 'YY']) }; }) }));
t('PF1', 'buildLayout on 600 rows takes < 150 ms', () => { const txt = Array.from({ length: 600 }, (_, i) => `ชั้น ${1 + (i % 12)}\nห้อง ${i}: โคม LED 18W x ${5 + (i % 9)}`).join('\n'); const rows = R(txt).slice(0, 600); let L; const d = ms(() => { L = lay(rows); }); return ok(rows.length === 600 && d < 150 && L.items.length >= 600, [rows.length, Math.round(d)]); });
t('PF2', 'buildLayout with 600 mixed rows incl. 3-phase and huge-qty rows < 150 ms', () => { const r = H.rng(7); const rows = P(Array.from({ length: 60 }, () => randText(r)).join('\n')).rows.slice(0, 600); let L; const d = ms(() => { L = lay(rows); }); return ok(rows.length >= 300 && d < 150, [rows.length, Math.round(d)]); });
t('PF3', 'parseText of a 2000-room document < 1.5 s', () => { const txt = Array.from({ length: 2000 }, (_, i) => `ชั้น ${1 + (i % 20)}\nห้อง ${i}: โคม LED 2x18W ${5 + (i % 30)} ชุด, เต้ารับ ${4 + i % 9} จุด, แอร์ ${[9000, 12000, 18000, 24000][i % 4]} BTU x ${1 + i % 3}`).join('\n'); const d = ms(() => P(txt)); return ok(d < 1500, Math.round(d)); });

/* ====================== วรรณยุกต์หายจากการดึงข้อความ PDF / OCR ====================== */
// pdf.js ดึง "ชั้น" จากไฟล์ตัวอย่างเป็น "ชัน" (ไม้โทหาย) → หัวชั้นต้องยังอ่านได้ ไม่งั้นทุกห้องตกไปชั้น 1
t('TM1', 'หัวชั้นที่ไม้โทหาย "ชัน 2" ยังเป็นชั้น 2', () => {
  const rows = R('ชัน 1\nล็อบบี 80 ตร.ม.\nชัน 2\nสำนักงาน 150 ตร.ม.');
  const fl = [...new Set(rows.map((r) => r.floor))].sort();
  return ok(JSON.stringify(fl) === '[1,2]', fl);
});
t('TM2', 'หัวชั้นที่ไม้โทหาย "ชันที่ 3" และ "ชัน3" เป็นชั้น 3', () => {
  const a = R('ชันที่ 3\nห้องประชุม: โคม LED 18W x 4').map((r) => r.floor);
  const b = R('ชัน3\nห้องประชุม: โคม LED 18W x 4').map((r) => r.floor);
  return ok(a.length > 0 && a.every((f) => f === 3) && b.length > 0 && b.every((f) => f === 3), [a, b]);
});
t('TM3', 'คำว่า "ชัน" ที่ไม่ได้ตามด้วยเลข (เช่น ที่ลาดชัน) ไม่ถูกแก้เป็น "ชั้น"', () => ok(!/ชั้น/.test(I.ocrFix('ทางลาดชัน ห้องเก็บของ 20 ตร.ม.')), I.ocrFix('ทางลาดชัน ห้องเก็บของ 20 ตร.ม.')));


/* ====================== H. calibration corpus (ข้อความจริงจากแบบ/รายการโหลด) ====================== */
console.log('# H. calibration corpus');
// แต่ละข้อ: ข้อความ → รายการที่ต้องได้ (เฉพาะฟิลด์ที่ระบุ) ตามลำดับ
const CAL = [
  ['C1', 'ห้องน้ำ: โคมไฟเพดาน 18W 2 ชุด เครื่องทำน้ำอุ่น 4500W 1 เครื่อง เต้ารับกันน้ำ 1 จุด', [{ type: 'light', fixtures: 2 }, { type: 'heater', watt: 4500, qty: 1 }, { type: 'rec', points: 1, wet: true }]],
  ['C2', 'บันไดเลื่อน 1 ชุด ลิฟต์ 1000 kg 2 ชุด', [{ type: 'esc', qty: 1 }, { type: 'lift', qty: 2 }]],
  ['C3', 'พัดลมระบายอากาศ 40W x 4', [{ type: 'custom', watt: 40, qty: 4, phases: 1 }]],
  ['C4', 'Exhaust fan 25 W 6 ea', [{ type: 'custom', watt: 25, qty: 6, phases: 1 }]],
  ['C5', 'พัดลมระบายอากาศ 0.75 kW 2 ตัว', [{ type: 'motor', kw: 0.75, qty: 2, phases: 1 }]],
  ['C6', 'ปั๊มน้ำ 370W', [{ type: 'motor', kw: 0.37, phases: 1 }]],
  ['C7', 'ปั๊มน้ำ 750W', [{ type: 'motor', kw: 0.75, phases: 1 }]],
  ['C7b', 'ปั๊มน้ำ 1.1 kW', [{ type: 'motor', kw: 1.12, phases: 3 }]],
  ['C8', 'ปั๊มน้ำ 370W 3 เฟส', [{ type: 'motor', kw: 0.37, phases: 3 }]],
  ['C9', 'คอมเพรสเซอร์ 7.5 kW', [{ type: 'motor', kw: 7.5, phases: 3 }]],
  ['C10', 'เต้ารับ 2 ช่อง 4 จุด', [{ type: 'rec', points: 4 }]],
  ['C11', 'เต้ารับ 6 ช่อง', [{ type: 'rec', points: 6 }]],
  ['C12', 'Duplex receptacle 2 gang 8 nos.', [{ type: 'rec', points: 8 }]],
  ['C13', 'ป้ายทางออก 5W 6 ชุด', [{ type: 'light', fixtures: 6 }]],
  ['C14', 'โคมไฟถนน LED 100W 8 ต้น', [{ cat: 'light', qty: 8, watt: 100 }]],
  ['C15', 'สปอตไลท์ 50 วัตต์ 4 ดวง', [{ cat: 'light', qty: 4, watt: 50 }]],
  ['C16', 'แอร์ 9000 BTU, 12000 BTU, 18000 BTU อย่างละ 2 เครื่อง', [{ type: 'ac', btu: 9000, qty: 2, name: 'แอร์' }, { type: 'ac', btu: 12000, qty: 2, name: 'แอร์' }, { type: 'ac', btu: 18000, qty: 2, name: 'แอร์' }]],
  ['C17', 'แอร์ 12000 BTU 2 เครื่อง + 18000 BTU 1 เครื่อง', [{ type: 'ac', btu: 12000, qty: 2 }, { type: 'ac', btu: 18000, qty: 1, name: 'แอร์' }]],
  ['C18', 'โคม LED 2 หลอด 10 โคม', [{ type: 'light', fixtures: 10, perFixture: 2 }]],
  ['C19', 'ดาวน์ไลท์ 6 ดวง สีขาว', [{ type: 'light', fixtures: 6 }]],
  ['C20', 'โคม LED 18W 2 หลอด ต่อ 1 โคม x 10', [{ type: 'light', fixtures: 10, perFixture: 2 }]],
  ['C21', 'มอเตอร์ 5 แรงม้า 380V 1 ตัว', [{ type: 'motor', kw: 4, phases: 3 }]],
  ['C22', 'ปั๊ม 1 HP 220V', [{ type: 'motor', kw: 0.75, phases: 1 }]],
  ['C23', 'ห้องนอน 1: ดาวน์ไลท์ LED 9W 6 ดวง, เต้ารับคู่ 4 จุด, แอร์ 12000 BTU 1 เครื่อง', [{ type: 'light', fixtures: 6 }, { type: 'rec', points: 4 }, { type: 'ac', btu: 12000, qty: 1 }]],
  ['C24', 'Water heater 6 kW 2 nos', [{ type: 'heater', watt: 6000, qty: 2 }]],
  ['C25', 'แอร์ 2 ตัน 2 เครื่อง', [{ type: 'ac', btu: 24000, qty: 2 }]],
  ['C26', 'ปั๊มน้ำ 2 ตัว ห้องปั๊ม', [{ type: 'motor', qty: 2 }]],
  // ที่ชาร์จรถไฟฟ้า → ชนิด 'ev' (รุ่นมาตรฐาน D.EV_CHARGERS: 0 = 7.4 kW 1 เฟส, 2 = 22 kW 3 เฟส)
  ['C27', 'EV charger 7.4 kW 2 ชุด', [{ type: 'ev', preset: 0, qty: 2, phases: 1 }]],
  ['C28', 'เครื่องชาร์จรถไฟฟ้า 22 kW 3 เฟส', [{ type: 'ev', preset: 2, phases: 3 }]],
  ['C29', 'ครัว: เตาไฟฟ้า 2 หัว 3000 วัตต์, ไมโครเวฟ 1200W, ตู้เย็น 150W', [{ type: 'cook', watt: 3000, qty: 1 }, { type: 'cook', watt: 1200 }, { type: 'custom', watt: 150 }]],
  ['C30', 'หลอดไฟ LED 18 วัตต์ จำนวน 20 หลอด', [{ type: 'light', fixtures: 20, perFixture: 1 }]],
  // รีวิว: ห้ามตัดสเปกที่ตามหลังจำนวนออกเป็นรายการใหม่ / ห้ามทิ้งรายการที่ขึ้นต้นด้วยสเปก
  ['R1', 'ห้อง: แอร์ 1 เครื่อง BTU 12000', [{ type: 'ac', btu: 12000, qty: 1 }]],
  ['R2', 'โคม 10 ดวง LED 18W', [{ type: 'light', fixtures: 10, lamp: 'led-t8-18' }]],
  ['R3', 'โคม 10 ดวง ดาวน์ไลท์ 10W', [{ type: 'light', fixtures: 10, lamp: 'led-bulb-10' }]],
  ['R4', 'โคม 2 ชุด หลอด LED 18W', [{ type: 'light', fixtures: 2 }]],
  ['R5', 'ห้อง: แอร์ 12000 BTU 1 เครื่อง 18000 BTU 2 เครื่อง', [{ type: 'ac', btu: 12000, qty: 1 }, { type: 'ac', btu: 18000, qty: 2, name: 'แอร์' }]],
  ['R6', 'ห้อง: เครื่องทำน้ำอุ่น 4500W, 3500W อย่างละ 3 เครื่อง, โคม 18W 2 ชุด', [{ type: 'heater', watt: 4500, qty: 3 }, { type: 'heater', watt: 3500, qty: 3, name: 'เครื่องทำน้ำอุ่น' }, { type: 'light', fixtures: 2 }]],
  ['R7', 'เครื่องทำน้ำอุ่น 4500W อย่างละ 3 เครื่อง', [{ type: 'heater', watt: 4500, qty: 3, name: 'เครื่องทำน้ำอุ่น' }]],
  ['R8', 'ห้อง: โคม LED 18W, 2 ชุด', [{ type: 'light', fixtures: 2 }]]
];
const strip = (r) => (r.name || '').replace(/^.*· /, '');
CAL.forEach(([id, text, want]) => t(id, text, () => {
  const rows = R('ชั้น 1\n' + text);
  const okRows = rows.length === want.length && want.every((w, i) => Object.entries(w).every(([k, v]) => (k === 'name' ? strip(rows[i]) === v : rows[i][k] === v)));
  return ok(okRows, rows.map((r) => ({ type: r.type, cat: r.cat, qty: r.qty, fixtures: r.fixtures, perFixture: r.perFixture, points: r.points, btu: r.btu, kw: r.kw, watt: r.watt, phases: r.phases, name: r.name })));
}));
t('C31', 'ดาวน์ไลท์ไม่ระบุวัตต์ใช้หลอดใกล้ 10 W (ไม่ใช่ 5 W ตัวเล็กสุด)', () => { const r = first('ดาวน์ไลท์ 6 ดวง'); const l = D.LAMPS.find((x) => x.id === r.lamp); return ok(l && l.w >= 8 && l.w <= 13, r.lamp); });
t('C32', 'ocrFix: 8TU/BTV → BTU, KVV → kW, KVA → kVA, LEO → LED', () => eq(['แอร์ 12000 8TU 2 เครื่อง', 'ปั๊ม 2.2 KVV', 'LEO 18W x 4', 'UPS 10 KVA'].map((x) => I.ocrFix(x)), ['แอร์ 12000 BTU 2 เครื่อง', 'ปั๊ม 2.2 kW', 'LED 18W x 4', 'UPS 10 kVA']));
t('C33', 'ocrFix ไม่แก้คำที่ไม่ใช่หน่วย (KWAN, BTUX, LEON)', () => eq(['KWAN 5', 'BTUX', 'LEON 2'].map((x) => I.ocrFix(x)), ['KWAN 5', 'BTUX', 'LEON 2']));
t('C34', 'ตัดหลายรายการไม่ตัดคำบรรยาย ("ดาวน์ไลท์ 6 ดวง สีขาว" ยังเป็นรายการเดียว)', () => ok(R('ดาวน์ไลท์ 6 ดวง สีขาว').length === 1));
t('C35', 'ตัดหลายรายการ: รวมจำนวนโหลดไม่หาย (VA ก่อน/หลังเท่ากับแยกบรรทัด)', () => {
  const one = R('ชั้น 1\nห้องน้ำ: โคม 18W 2 ชุด เครื่องทำน้ำอุ่น 4500W 1 เครื่อง เต้ารับ 1 จุด');
  const sep = R('ชั้น 1\nห้องน้ำ: โคม 18W 2 ชุด, เครื่องทำน้ำอุ่น 4500W 1 เครื่อง, เต้ารับ 1 จุด');
  return eq(one.map((r) => [r.type, r.fixtures || r.points || r.qty]), sep.map((r) => [r.type, r.fixtures || r.points || r.qty]));
});

/* ====================== (ส่วนทดสอบใหม่ต่อท้ายตรงนี้) ====================== */
done('import.test.js');
