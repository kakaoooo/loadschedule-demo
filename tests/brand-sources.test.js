// ที่มาของข้อมูล MCCB: รุ่นที่ "ยืนยันกับแคตตาล็อก" ต้องผูกเอกสารต้นทาง (Source_ID → data/brands/sources.json) + หน้าที่อ่านค่า + หมายเหตุวิธีได้ค่า
// และตัวเลขสำคัญต้องตรงกับที่อ่านจากตารางในแคตตาล็อกฉบับทางการ (ค่า golden ด้านล่างอ่านจากหน้า PDF ตามเลขหน้าที่ระบุ)
// รัน: node tests/brand-sources.test.js
const fs = require('fs');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const B = require('../public/js/brands.js');
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/brands/sources.json'), 'utf8'));

// โดเมนที่ยอมรับเป็นแหล่งข้อมูล: เว็บของผู้ผลิตเองเท่านั้น (เพิ่มโดเมนเมื่อเพิ่มแหล่งใหม่ — ห้ามใช้เว็บขายของ/ตัวแทน)
const OFFICIAL = ['se.com', 'schneider-electric.com', 'abb.com', 'mitsubishielectric.com', 'legrand.com', 'siemens.com', 'ls-electric.com', 'fujielectric.com', 'chintglobal.com', 'hager.com', 'weg.net', 'hd-hyundaielectric.com', 'terasaki.co.jp'];
const hostOk = (u) => { try { const h = new URL(u).hostname; return OFFICIAL.some((d) => h === d || h.endsWith('.' + d)); } catch (e) { return false; } };
const byId = new Map(SRC.sources.map((s) => [s.id, s]));
const ver = B.mccb.filter((m) => m.verified);
const row = (id) => B.mccb.find((m) => m.id === id);

test('S1 sources.json: ทุกแหล่งมีชื่อ/เลขเอกสาร/ผู้จัดทำ/ฉบับ + URL https ของผู้ผลิต + ขนาด + SHA-256 + วันที่เข้าถึง + จำนวนหน้า', () => {
  assert(SRC.sources.length >= 15, 'ต้องมีแหล่งอย่างน้อย 15');
  for (const s of SRC.sources) {
    for (const k of ['id', 'title', 'docNo', 'publisher', 'edition']) assert(typeof s[k] === 'string' && s[k].trim(), `${s.id}: ขาด ${k}`);
    assert(s.urls.length >= 1 && s.urls.every((u) => /^https:\/\//.test(u) && hostOk(u)), `${s.id}: URL ต้องเป็น https ของผู้ผลิต ${JSON.stringify(s.urls)}`);
    // เอกสารข้อมูลทางเทคนิครุ่นเดียว (เช่น Legrand DRX 3–8 หน้า, < 1 MB) ก็เป็นแหล่งที่ถูกต้อง → กันไฟล์ว่าง/ถูกตัดด้วยเกณฑ์ขั้นต่ำ 100 KB และ 3 หน้า
    assert(/^[0-9a-f]{64}$/.test(s.sha256) && s.bytes > 1e5 && /^\d{4}-\d{2}-\d{2}$/.test(s.accessed) && s.pages >= 3, `${s.id}: sha256/ขนาด/วันที่/หน้า`);
  }
  eq(new Set(SRC.sources.map((s) => s.id)).size, SRC.sources.length);
});
test('S2 brands.js นำแหล่งทั้งหมดไปด้วย (meta.sources) และนับรุ่นที่ยืนยันแล้ว', () => {
  eq(B.meta.sources.map((s) => s.id), SRC.sources.map((s) => s.id));
  eq(B.meta.counts.mccbVerified, ver.length);
  assert(ver.length >= 304, 'รุ่นที่ยืนยัน ' + ver.length);
});
test('S3 ทุกรุ่นที่ยืนยัน: Source_ID มีจริง, หน้าอยู่ในช่วงเอกสาร, มีหมายเหตุวิธีได้ค่า, ref ระบุเลขเอกสาร+หน้า, ไม่ผูกแหล่งแล้วต้องไม่ถูกนับว่ายืนยัน', () => {
  for (const m of ver) {
    const s = byId.get(m.src.id);
    assert(s, `${m.id}: ไม่พบแหล่ง ${m.src.id}`);
    assert(m.src.pages.length >= 1 && m.src.pages.every((p) => Number.isInteger(p) && p >= 1 && p <= s.pages), `${m.id}: หน้า ${JSON.stringify(m.src.pages)} นอกช่วง 1..${s.pages}`);
    assert(m.src.note && m.src.note.length > 20, `${m.id}: ขาดหมายเหตุ`);
    assert(m.src.url === s.urls[0] && m.src.doc === s.docNo, `${m.id}: url/doc ต้องมาจากแหล่ง`);
    assert(m.ref.includes(s.docNo) && /p\.\d/.test(m.ref), `${m.id}: ref ต้องมีเลขเอกสารและหน้า: ${m.ref}`);
  }
  assert(B.mccb.filter((m) => !m.verified).every((m) => !m.src), 'รุ่นที่ไม่ผูกแหล่งต้องไม่มี src');
  eq(B.mccb.filter((m) => !m.verified).length + ver.length, B.mccb.length);   // รุ่นที่ยังไม่ผูกแหล่งต้องถูกนับแยกเป็น "ไม่ยืนยัน" ไม่ถูกเหมารวม (จำนวนเปลี่ยนเมื่อยืนยันซีรีส์เพิ่ม)
});
test('S4 ค่าสมเหตุสมผลของรุ่นที่ยืนยัน: Ics ≤ Icu, AT เรียงและไม่เกิน AF, ขั้ว 3/4, Ii ตัวเลข (ถ้ามี) เป็นคู่ครบ, selectivity ต่อ MCB ว่าง (ไม่เดา)', () => {
  for (const m of ver) {
    assert(m.icu > 0 && m.icsPct > 0 && m.icsPct <= 100 && m.ics <= m.icu + 1e-9, `${m.id}: Icu/Ics`);
    assert(m.at.every((a, i) => a > 0 && a <= m.af && (!i || a > m.at[i - 1])), `${m.id}: AT ${m.at}`);
    assert(m.poles.every((p) => p === 3 || p === 4) && m.poles.length >= 1, `${m.id}: poles`);
    assert((m.iiMult == null) === (m.iiMin == null), `${m.id}: iiMult/iiMin ต้องมีคู่กัน`);
    if (m.iiMult != null) assert(m.iiMult >= 1 && m.iiMin > 0, `${m.id}: Ii ${m.iiMult}/${m.iiMin}`);
    assert(m.selMCB == null, `${m.id}: แคตตาล็อกไม่ให้ค่า selectivity ต่อ MCB เป็นตัวเลขเดียว → ต้องว่าง ไม่เดา`);
  }
});

/* ---- Schneider ComPacT NSX (LVPED221001EN): Icu/Ics ที่ 380/415 V หน้า 23 (A-7) และ 25 (A-9) ; AT จากตาราง Catalog Numbers ---- */
test('S5 ComPacT NSX: 22 รุ่น (100/160/250 × B,F,N,H [+R ที่ 100/250] ; 400/630 × F,N,H,R) — Icu/Ics ตรงตารางระดับสมรรถนะ', () => {
  const sc = B.mccb.filter((m) => m.series === 'ComPacT NSX');
  eq(sc.length, 22);
  const icu = { B: 25, F: 36, N: 50, H: 70, R: 200 };
  for (const m of sc) {
    const lv = m.model.replace(/^NSX\d+/, '');
    eq([m.icu, m.icsPct], [icu[lv], 100]);
    eq(m.poles, [3, 4]);
  }
  eq(sc.map((m) => m.model).sort(), ['NSX100B', 'NSX100F', 'NSX100H', 'NSX100N', 'NSX100R', 'NSX160B', 'NSX160F', 'NSX160H', 'NSX160N', 'NSX250B', 'NSX250F', 'NSX250H', 'NSX250N', 'NSX250R', 'NSX400F', 'NSX400H', 'NSX400N', 'NSX400R', 'NSX630F', 'NSX630H', 'NSX630N', 'NSX630R'].sort());
});
test('S6 ComPacT NSX: รายการ AT ตรงตาราง Catalog Numbers (TM-D + MicroLogic) ของแต่ละเฟรม — ไม่มี AT ที่แคตตาล็อกไม่ขาย', () => {
  eq(row('Schneider|NSX100F').at, [16, 25, 32, 40, 50, 63, 80, 100]);
  eq(row('Schneider|NSX100R').at, [40, 50, 63, 80, 100]);
  eq(row('Schneider|NSX160N').at, [80, 100, 125, 160]);
  eq(row('Schneider|NSX250H').at, [100, 125, 160, 200, 250]);
  eq(row('Schneider|NSX400N').at, [250, 400]);
  eq(row('Schneider|NSX630F').at, [630]);
  eq(row('Schneider|NSX100F').af, 100); eq(row('Schneider|NSX630R').af, 630);
});
test('S7 ComPacT NSX: ค่า Ii ตัวเลขเป็นขอบล่างอนุรักษ์จากตารางตัดทันที (TM-D หน้า 41 / MicroLogic 2 หน้า 45) — ไม่เกินค่าจริงของทุกขนาด', () => {
  // NSX100 TM-D คงที่ 190…800 A (16…100 A) → ต่ำสุด 190 A ; ต่ำสุดของ Ii/In = 500/63 = 7.9×
  eq([row('Schneider|NSX100F').iiMult, row('Schneider|NSX100F').iiMin], [7.9, 190]);
  // NSX250: TM-D 200/250 A ปรับได้ 5–10×In → ขอบล่าง 5× ; ต่ำสุด 1000 A (200 A × 5)
  eq([row('Schneider|NSX250N').iiMult, row('Schneider|NSX250N').iiMin], [5, 1000]);
  // NSX400R/630R มีเฉพาะ MicroLogic (Ii ตายตัว 3000/4800/6900 A)
  eq([row('Schneider|NSX400R').iiMult, row('Schneider|NSX400R').iiMin], [12, 3000]);
  eq([row('Schneider|NSX630R').iiMult, row('Schneider|NSX630R').iiMin], [10.9, 6900]);
  assert(row('Schneider|NSX400R').electronic === true && row('Schneider|NSX100F').electronic === false, 'ชนิด trip: R 400/630 = อิเล็กทรอนิกส์ล้วน');
});

/* ---- ABB SACE Tmax XT (1SDC210100D0206): Icu/Ics ที่ 415 V หน้า 24, 25, 28, 29 ; In/I3 หน้า 58 ; Ekip หน้า 61 ---- */
test('S8 Tmax XT: 30 รุ่น (XT1 B,C,N,S,H · XT2 N,S,H,L,V · XT3 N,S · XT4 N,S,H,L,V,X · XT5 N,S,H,L,V,X · XT6 N,S,H · XT7 S,H,L) และ Icu ตรงตาราง', () => {
  const ab = B.mccb.filter((m) => m.series === 'Tmax XT');
  eq(ab.length, 30);
  const want = { XT1B: 18, XT1C: 25, XT1N: 36, XT1S: 50, XT1H: 70, XT2N: 36, XT2S: 50, XT2H: 70, XT2L: 120, XT2V: 150, XT3N: 36, XT3S: 50, XT4N: 36, XT4S: 50, XT4H: 70, XT4L: 120, XT4V: 150, XT4X: 200,
    XT5N: 36, XT5S: 50, XT5H: 70, XT5L: 120, XT5V: 200, XT5X: 200, XT6N: 36, XT6S: 50, XT6H: 70, XT7S: 50, XT7H: 70, XT7L: 120 };
  for (const m of ab) eq(m.icu, want[m.model.split(' ')[0]], m.id);
  eq(ab.map((m) => m.model.split(' ')[0]).sort(), Object.keys(want).sort());
});
test('S9 Tmax XT: Ics ตามตาราง (XT1 S 75%, H 50% ; XT3 S 50% ; ที่เหลือ 100%) และ AF/AT/ชนิด trip ตามหน้า 24–29/58/61', () => {
  const ics = (id) => row('ABB|' + id).icsPct;
  eq([ics('XT1B 160'), ics('XT1C 160'), ics('XT1N 160'), ics('XT1S 160'), ics('XT1H 160')], [100, 100, 100, 75, 50]);
  eq([ics('XT3N 250'), ics('XT3S 250')], [100, 50]);
  for (const id of ['XT2N 160', 'XT2V 160', 'XT4X 250', 'XT5V 630', 'XT6H 1000', 'XT7L 1600']) eq(ics(id), 100, id);
  eq(row('ABB|XT1N 160').at, [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160]);
  eq(row('ABB|XT3N 250').at, [63, 80, 100, 125, 160, 200, 250]);
  eq(row('ABB|XT4N 250').at, [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 225, 250]);
  eq(row('ABB|XT5N 630').at, [250, 320, 400, 500, 630]);
  eq(row('ABB|XT7S 1600').at, [630, 800, 1000, 1250, 1600]);
  eq([row('ABB|XT1N 160').af, row('ABB|XT4N 250').af, row('ABB|XT5N 630').af, row('ABB|XT6N 1000').af, row('ABB|XT7S 1600').af], [160, 250, 630, 1000, 1600]);
  assert(row('ABB|XT7S 1600').electronic === true && row('ABB|XT1N 160').electronic === false, 'XT7 = Ekip ล้วน, XT1 = TMD ล้วน');
});
test('S10 Tmax XT: Ii ตัวเลขมาจากตาราง I3 หน้า 58 (TMD คงที่/TMA ค่าต่ำสุด) ; XT7 (Ekip ล้วน ปรับได้) ไม่ใส่ตัวเลข → ใช้ค่าทั่วไปของแอป', () => {
  eq([row('ABB|XT1N 160').iiMult, row('ABB|XT1N 160').iiMin], [10, 450]);
  eq([row('ABB|XT3N 250').iiMult, row('ABB|XT3N 250').iiMin], [10, 630]);
  eq([row('ABB|XT4N 250').iiMult, row('ABB|XT4N 250').iiMin], [5, 300]);
  eq([row('ABB|XT6N 1000').iiMult, row('ABB|XT6N 1000').iiMin], [5, 3150]);
  eq([row('ABB|XT7S 1600').iiMult, row('ABB|XT7S 1600').iiMin], [null, null]);
});

/* ---- Schneider EasyPact EZC (LVED212091EN): Icu @400/415 V และ Ics หน้า 15 (A-7) / 17 (A-9) ; AT จาก Catalog Numbers หน้า 73–83 ---- */
test('S15 EasyPact EZC: 14 รุ่น (EZC100 B,F,N,H · EZC125 F,N,H · EZC250 F,N,H · EZC400 N,H · EZC630 N,H) — Icu/Ics ตรงตารางสมรรถนะ (EZC400/630 Ics = 100%)', () => {
  const ez = B.mccb.filter((m) => m.series === 'EasyPact EZC');
  eq(ez.map((m) => m.model).sort(), ['EZC100B', 'EZC100F', 'EZC100H', 'EZC100N', 'EZC125F', 'EZC125H', 'EZC125N', 'EZC250F', 'EZC250H', 'EZC250N', 'EZC400H', 'EZC400N', 'EZC630H', 'EZC630N']);
  const want = { EZC100B: [7.5, 25], EZC100F: [10, 50], EZC100N: [15, 50], EZC100H: [30, 25], EZC125F: [10, 50], EZC125N: [15, 50], EZC125H: [30, 25],
    EZC250F: [18, 50], EZC250N: [25, 50], EZC250H: [36, 50], EZC400N: [36, 100], EZC400H: [50, 100], EZC630N: [36, 100], EZC630H: [50, 100] };
  for (const m of ez) eq([m.icu, m.icsPct], want[m.model], m.id);
});
test('S16 EasyPact EZC: ขั้ว (B/F และ EZC125 = 3P เท่านั้น), รายการ AT, และ Ii (EZC100/125 ไม่ระบุตัวเลข → ว่าง ; EZC250/400 = 10×In ; EZC630 = 10×In/5000 A/6300 A)', () => {
  eq([row('Schneider|EZC100B').poles, row('Schneider|EZC100F').poles, row('Schneider|EZC100N').poles, row('Schneider|EZC125N').poles, row('Schneider|EZC400H').poles], [[3], [3], [3, 4], [3], [3, 4]]);
  eq(row('Schneider|EZC100B').at, [15, 20, 25, 30, 40, 50, 60]);
  eq(row('Schneider|EZC100F').at, [15, 16, 20, 25, 30, 32, 40, 50, 60, 63, 75, 80, 100]);
  eq(row('Schneider|EZC125H').at, [125]);
  eq(row('Schneider|EZC250N').at, [100, 125, 150, 160, 175, 200, 225, 250]);
  eq(row('Schneider|EZC400N').at, [300, 320, 350, 400]);
  eq(row('Schneider|EZC400H').at, [320, 350, 400]);
  eq(row('Schneider|EZC630N').at, [400, 500, 600, 630]);
  eq([row('Schneider|EZC100N').iiMult, row('Schneider|EZC100N').iiMin, row('Schneider|EZC125F').iiMult], [null, null, null]);
  eq([row('Schneider|EZC250N').iiMult, row('Schneider|EZC250N').iiMin], [10, 1000]);
  eq([row('Schneider|EZC400N').iiMult, row('Schneider|EZC400N').iiMin], [10, 3000]);
  eq([row('Schneider|EZC630N').iiMult, row('Schneider|EZC630N').iiMin], [8.3, 4000]);
  assert(B.mccb.filter((m) => m.series === 'EasyPact EZC').every((m) => m.electronic === false && m.af >= 100), 'EZC = TM');
});

/* ---- ABB SACE Formula DSA (1SDC210401D0201): Icu/Ics @415 V หน้า 14 (2/4) ; In/I3 หน้า 16 (2/6) ; Ordering หน้า 17–21 — แทนซีรีส์ "Formula DSP" เดิมที่ไม่มีในแคตตาล็อก ---- */
test('S17 ABB Formula DSA: 12 รุ่น (A0 A,B,C · A1 A,B,C,N · A2 B,C,N · A3 N,S) — Icu/Ics ที่ 415 V ตามตาราง และไม่มีซีรีส์ "Formula DSP" เดิมเหลืออยู่', () => {
  const fo = B.mccb.filter((m) => m.brandShort === 'ABB' && m.series === 'Formula DSA');
  eq(fo.map((m) => m.model).sort(), ['A0A 100', 'A0B 100', 'A0C 100', 'A1A 125', 'A1B 125', 'A1C 125', 'A1N 125', 'A2B 250', 'A2C 250', 'A2N 250', 'A3N 630', 'A3S 630']);
  const want = { 'A0A 100': [5, 100], 'A0B 100': [7.5, 50], 'A0C 100': [10, 50], 'A1A 125': [10, 50], 'A1B 125': [18, 50], 'A1C 125': [25, 25], 'A1N 125': [36, 25], 'A2B 250': [18, 50], 'A2C 250': [25, 50], 'A2N 250': [36, 50], 'A3N 630': [36, 50], 'A3S 630': [50, 50] };
  for (const m of fo) eq([m.icu, m.icsPct], want[m.model], m.id);
  assert(!B.mccb.some((m) => m.series === 'Formula DSP'), 'ซีรีส์ Formula DSP เดิมต้องถูกแทนที่');
});
test('S18 ABB Formula DSA: ขั้ว (A0 = 3P ; A1–A3 = 3P/4P), AF, รายการ AT จาก Ordering codes, Ii = 10×In (I3 ขั้นต่ำ 400 A ที่ A1; A3 มี ELT LI 630 A = 6000 A)', () => {
  const r = (id) => row('ABB|' + id);
  eq([r('A0B 100').poles, r('A1N 125').poles, r('A3S 630').poles], [[3], [3, 4], [3, 4]]);
  eq([r('A0A 100').af, r('A1A 125').af, r('A2N 250').af, r('A3N 630').af], [100, 125, 250, 630]);
  eq(r('A0A 100').at, [30, 40, 63, 80, 100]);
  eq(r('A1B 125').at, [15, 16, 20, 25, 30, 32, 40, 50, 60, 63, 70, 80, 90, 100, 125]);
  eq(r('A2C 250').at, [125, 150, 160, 175, 200, 225, 250]);
  eq(r('A3N 630').at, [300, 320, 400, 500, 630]);
  eq([r('A0A 100').iiMult, r('A0A 100').iiMin], [10, 300]);
  eq([r('A1N 125').iiMult, r('A1N 125').iiMin], [10, 400]);
  eq([r('A2N 250').iiMult, r('A2N 250').iiMin], [10, 1250]);
  eq([r('A3S 630').iiMult, r('A3S 630').iiMin], [9.5, 3000]);
  assert(B.mccb.filter((m) => m.series === 'Formula DSA').every((m) => m.electronic === false), 'TMF เป็นหลัก (A3 มี ELT LI เฉพาะ 630 A → ถือเป็น TM กรณีแย่กว่า)');
});

/* ---- Mitsubishi Electric World Super V (WS-V) General Catalog Y-0720J 2309: ตาราง Detailed Specifications หน้า PDF 20–29 (เลขหน้าพิมพ์ 18–27)
   Icu/Ics = ค่าในช่องที่แรเงา (rated) แถว 415 V ของตาราง IEC 60947-2 ; AF = ขนาดเฟรมสูงสุด ; AT = In ที่ไม่อยู่ในวงเล็บ (ค่าในวงเล็บ = ผลิตเมื่อสั่ง)
   รุ่นปรับกระแสได้เป็นช่วง (เช่น 125-160) ใช้ค่าสูงสุดของช่วงเป็น AT ; 2P ไม่ใส่ (ไม่ใช้กับวงจร 3 เฟส) ---- */
const R20 = [3, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63], R125 = [16, 20, 32, 40, 50, 63, 80, 100, 125], RG125 = [20, 25, 32, 40, 50, 63, 80, 100, 125];
const R250 = [125, 150, 160, 175, 200, 225, 250], R250C = [125, 150, 175, 200, 225, 250];
const A400 = [200, 225, 250, 300, 350, 400], A630 = [300, 350, 400, 500, 600, 630], A800 = [400, 450, 500, 600, 700, 800];
// [Icu kA @415V, Ics kA @415V, AF, ขั้ว, AT, Util, electronic, หน้า PDF]
const MIT = {
  'NF63-CV': [2.5, 2.5, 63, [3], R20, 'A', false, 20],
  'NF125-CV': [10, 5, 125, [3], [50, 63, 80, 100, 125], 'A', false, 20],
  'NF250-CV': [25, 19, 250, [3], R250C, 'A', false, 21],
  'NF400-CW': [36, 18, 400, [3], [250, 300, 350, 400], 'A', false, 21],
  'NF630-CW': [36, 18, 630, [3], [500, 600], 'A', false, 21],
  'NF800-CEW': [36, 18, 800, [3], A800, 'B', true, 21],
  'NF32-SV': [2.5, 2.5, 32, [3], [3, 4, 6, 10, 16, 20, 25, 32], 'A', false, 22],
  'NF63-SV': [7.5, 7.5, 63, [3, 4], R20, 'A', false, 22],
  'NF125-SV': [30, 30, 125, [3, 4], R125, 'A', false, 23],
  'NF125-SGV': [36, 36, 125, [3, 4], RG125, 'A', false, 23],
  'NF125-SEV': [36, 36, 125, [3, 4], [32, 63, 125], 'A', true, 23],
  'NF160-SGV': [36, 36, 160, [3, 4], [160], 'A', false, 23],
  'NF250-SV': [36, 36, 250, [3, 4], R250, 'A', false, 23],
  'NF250-SGV': [36, 36, 250, [3, 4], [160, 200, 250], 'A', false, 24],
  'NF250-SEV': [36, 36, 250, [3, 4], [160, 250], 'A', true, 24],
  'NF400-SW': [45, 45, 400, [3, 4], [250, 300, 350, 400], 'A', false, 24],
  'NF400-SEW': [50, 50, 400, [3, 4], A400, 'B', true, 24],
  'NF630-SW': [50, 50, 630, [3, 4], [500, 600], 'A', false, 24],
  'NF630-SEW': [50, 50, 630, [3, 4], A630, 'B', true, 25],
  'NF800-SEW': [50, 50, 800, [3, 4], A800, 'B', true, 25],
  'NF1000-SEW': [85, 43, 1000, [3, 4], [500, 600, 700, 800, 900, 1000], 'B', true, 25],
  'NF1250-SEW': [85, 43, 1250, [3, 4], [600, 700, 800, 1000, 1200, 1250], 'B', true, 25],
  'NF1600-SEW': [85, 43, 1600, [3, 4], [800, 1000, 1200, 1400, 1500, 1600], 'B', true, 25],
  'NF63-HV': [10, 8, 63, [3, 4], [10, 16, 20, 25, 30, 32, 40, 50, 63], 'A', false, 26],
  'NF125-HV': [50, 38, 125, [3, 4], R125, 'A', false, 26],
  'NF125-LGV': [50, 50, 125, [3, 4], RG125, 'A', false, 26],
  'NF125-HGV': [70, 70, 125, [3, 4], RG125, 'A', false, 26],
  'NF125-RGV': [150, 150, 125, [3], RG125, 'A', false, 26],
  'NF125-HEV': [70, 70, 125, [3, 4], [32, 63, 125], 'A', true, 27],
  'NF160-LGV': [50, 50, 160, [3, 4], [160], 'A', false, 27],
  'NF160-HGV': [70, 70, 160, [3, 4], [160], 'A', false, 27],
  'NF250-HV': [70, 70, 250, [3, 4], R250, 'A', false, 27],
  'NF250-LGV': [50, 50, 250, [3, 4], [160, 200, 250], 'A', false, 27],
  'NF250-HGV': [70, 70, 250, [3, 4], [160, 200, 250], 'A', false, 27],
  'NF250-RGV': [150, 150, 250, [3], [160, 200, 250], 'A', false, 27],
  'NF250-HEV': [70, 70, 250, [3, 4], [160, 250], 'A', true, 28],
  'NF400-HEW': [70, 70, 400, [3, 4], A400, 'B', true, 28],
  'NF400-REW': [125, 63, 400, [3], A400, 'B', true, 28],
  'NF630-HEW': [70, 70, 630, [3, 4], A630, 'B', true, 28],
  'NF630-REW': [125, 63, 630, [3], A630, 'B', true, 28],
  'NF800-HEW': [70, 70, 800, [3, 4], A800, 'B', true, 28],
  'NF800-REW': [125, 63, 800, [3], A800, 'B', true, 28],
  'NF125-UV': [200, 200, 125, [3, 4], [15, 20, 30, 40, 50, 60, 75, 100, 125], 'A', false, 29],
  'NF250-UV': [200, 200, 250, [3, 4], R250C, 'A', false, 29],
  'NF400-UEW': [200, 200, 400, [3, 4], A400, 'B', true, 29],
  'NF800-UEW': [200, 200, 800, [3, 4], A800, 'B', true, 29]
};
const mitRows = () => B.mccb.filter((m) => m.brandShort === 'Mitsubishi');
test('S19 Mitsubishi WS-V: 46 รุ่นตามตาราง Detailed Specifications (NF-C 6 · NF-S 17 · NF-L/H/R 19 · NF-U 4) ไม่มีรุ่นเดิมที่ไม่อยู่ในตาราง (NF30-CS, NF100-CV, NF160-CV, …) และทุกรุ่นยืนยันแล้ว', () => {
  const ms = mitRows();
  eq(ms.map((m) => m.model).sort(), Object.keys(MIT).sort());
  assert(ms.every((m) => m.verified && m.src.id === 'MIT-Y0720J2309'), 'ทุกรุ่น Mitsubishi ต้องผูกแหล่ง MIT-Y0720J2309');
  for (const bad of ['NF30-CS', 'NF100-CV', 'NF160-CV', 'NF160-SV']) assert(!ms.some((m) => m.model === bad), bad + ' ไม่มีในตารางแคตตาล็อก');
  assert(!B.mccb.some((m) => m.brandShort === 'Mitsubishi' && /^WS-V (Economy|Standard)$/.test(m.series)), 'ซีรีส์ที่รวบรวมเดิมต้องถูกแทนที่');
});
test('S20 Mitsubishi WS-V: Icu/Ics @415 V (ช่องแรเงา) — ค่า Ics เป็น kA ตามตารางจริง (เช่น 10/5, 25/19, 85/43, 125/63) ไม่ปัดเป็นเปอร์เซ็นต์หยาบ', () => {
  for (const m of mitRows()) {
    const w = MIT[m.model];
    eq([m.icu, m.ics], [w[0], w[1]], m.id);
    assert(Math.abs(m.icsPct - (w[1] / w[0]) * 100) < 0.01 + 1e-9, `${m.id}: Ics% ${m.icsPct}`);
  }
});
test('S21 Mitsubishi WS-V: AF, ขั้ว (3P/4P ; 2P ไม่ใส่), รายการ AT (ไม่รวมค่าในวงเล็บ ; ช่วงปรับ = ค่าสูงสุด), Util และชนิด trip ตรงตาราง', () => {
  for (const m of mitRows()) {
    const w = MIT[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.poles, w[3], m.id + ' poles'); eq(m.at, w[4], m.id + ' AT');
    eq(m.util, 'Cat ' + w[5], m.id + ' util'); eq(m.electronic, w[6], m.id + ' electronic');
    assert(m.src.pages.includes(w[7]) && m.src.pages.every((p) => p >= 20 && p <= 29), `${m.id}: หน้า ${m.src.pages} ต้องมี ${w[7]} และอยู่ใน 20–29`);
  }
});
test('S22 Mitsubishi WS-V: ค่าตัดทันที Ii ว่าง (แคตตาล็อกแสดงเป็นกราฟเท่านั้น ไม่ใช่ตัวเลข → ไม่เดา) ; หมายเหตุอธิบายวิธีได้ค่า ; แหล่งอยู่บนโดเมนผู้ผลิต', () => {
  const s = byId.get('MIT-Y0720J2309');
  assert(s && s.publisher === 'Mitsubishi Electric' && s.pages === 276 && s.docNo === 'Y-0720J 2309', 'ทะเบียนแหล่ง Mitsubishi');
  assert(/^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]), 'sha256 + โดเมนผู้ผลิต');
  for (const m of mitRows()) {
    assert(m.iiMult == null && m.iiMin == null, `${m.id}: ห้ามใส่ Ii (ไม่มีตัวเลขในตาราง)`);
    assert(/415 V/.test(m.src.note) && /วงเล็บ/.test(m.src.note) && /Ii/.test(m.src.note), `${m.id}: หมายเหตุต้องบอก 415 V / ค่าในวงเล็บ / Ii`);
    assert(m.ref.includes('Y-0720J 2309') && /p\.\d/.test(m.ref), `${m.id}: ref ${m.ref}`);
    assert(m.selMCB == null, `${m.id}: selectivity ต่อ MCB ต้องว่าง`);
  }
});

/* ---- Legrand DPX³ (เอกสารข้อมูลทางเทคนิคทางการของผู้ผลิต assets.legrand.com): 160 = F01360EN-09 p.2 ; 250 = F01364EN-07 p.1–2 ; 630 = F01958EN-06 p.2 ; 1600 = F01963EN-05 p.1–2
   Icu @415 V (ตาราง IEC 60947-2) ; Ics % Icu ตามแถว "Ics (% Icu)" (630/1600: 100% ที่ 36/50/70 kA, 70% ที่ 100 kA) ; In = Rated current ของเบรกเกอร์ TM ;
   Ii: DPX³ 160 ค่าคงที่ (400 A สำหรับ In ≤ 40 A ; 10×In เมื่อ In > 40 A) ; 250/630/1600 ปรับ 5–10×In → ใช้ขอบล่าง 5×In ---- */
// [Icu, Ics%, AF, AT, Ii mult, Min Ii, เอกสาร, หน้า]
const LEG = {
  'DPX3 160 16kA': [16, 100, 160, [16, 25, 40, 63, 80, 100, 125, 160], 10, 400, 'LEG-F01360EN-09', [2]],
  'DPX3 160 25kA': [25, 100, 160, [16, 25, 40, 63, 80, 100, 125, 160], 10, 400, 'LEG-F01360EN-09', [2]],
  'DPX3 160 36kA': [36, 100, 160, [16, 25, 40, 63, 80, 100, 125, 160], 10, 400, 'LEG-F01360EN-09', [2]],
  'DPX3 160 50kA': [50, 100, 160, [16, 25, 40, 63, 80, 100, 125, 160], 10, 400, 'LEG-F01360EN-09', [2]],
  'DPX3 250 25kA': [25, 100, 250, [100, 160, 200, 250], 5, 500, 'LEG-F01364EN-07', [1, 2]],
  'DPX3 250 36kA': [36, 100, 250, [100, 160, 200, 250], 5, 500, 'LEG-F01364EN-07', [1, 2]],
  'DPX3 250 50kA': [50, 100, 250, [100, 160, 200, 250], 5, 500, 'LEG-F01364EN-07', [1, 2]],
  'DPX3 630 36kA': [36, 100, 630, [250, 320, 400, 500, 630], 5, 1250, 'LEG-F01958EN-06', [2]],
  'DPX3 630 50kA': [50, 100, 630, [250, 320, 400, 500, 630], 5, 1250, 'LEG-F01958EN-06', [2]],
  'DPX3 630 70kA': [70, 100, 630, [250, 320, 400, 500, 630], 5, 1250, 'LEG-F01958EN-06', [2]],
  'DPX3 630 100kA': [100, 70, 630, [250, 320, 400, 500, 630], 5, 1250, 'LEG-F01958EN-06', [2]],
  'DPX3 1600 36kA': [36, 100, 1600, [500, 630, 800, 1000, 1250], 5, 2500, 'LEG-F01963EN-05', [1, 2]],
  'DPX3 1600 50kA': [50, 100, 1600, [500, 630, 800, 1000, 1250], 5, 2500, 'LEG-F01963EN-05', [1, 2]],
  'DPX3 1600 70kA': [70, 100, 1600, [500, 630, 800, 1000, 1250], 5, 2500, 'LEG-F01963EN-05', [1, 2]],
  'DPX3 1600 100kA': [100, 70, 1600, [500, 630, 800, 1000, 1250], 5, 2500, 'LEG-F01963EN-05', [1, 2]]
};
test('S23 Legrand DPX³ (เบรกเกอร์ TM): 15 รุ่น (160 ×4 · 250 ×3 · 630 ×4 · 1600 ×4) แทนแถวที่รวบรวมเดิมของ "DPX3 Series" — Icu/Ics ตรงตารางของแต่ละเอกสาร', () => {
  const ls = B.mccb.filter((m) => m.brandShort === 'Legrand' && m.series === 'DPX3 Series');
  eq(ls.map((m) => m.model).sort(), Object.keys(LEG).sort());
  for (const m of ls) { const w = LEG[m.model]; eq([m.icu, m.icsPct], [w[0], w[1]], m.id); assert(m.verified && m.src.id === w[6], `${m.id}: แหล่ง ${m.src && m.src.id}`); }
  assert(!B.mccb.some((m) => m.brandShort === 'Legrand' && m.series === 'DPX3 Series' && !m.verified), 'ไม่เหลือแถว DPX3 ที่รวบรวมเดิม');
  assert(B.mccb.filter((m) => m.brandShort === 'Legrand' && /^DRX/.test(m.series)).every((m) => m.verified), 'DRX ผูกแหล่งแล้ว (S45–S47) → ไม่เหลือแถวที่รวบรวมเดิม');
});
test('S24 Legrand DPX³: AF, ขั้ว 3P/4P, AT ตาม Rated current, Util A, ชนิด TM ; Ii = 400 A/10×In (DPX³ 160) และขอบล่าง 5×In (250/630/1600)', () => {
  for (const m of B.mccb.filter((x) => x.brandShort === 'Legrand' && x.series === 'DPX3 Series')) {
    const w = LEG[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[4], w[5]], m.id + ' Ii'); eq([m.util, m.electronic], ['Cat A', false], m.id);
    assert(m.src.pages.length === w[7].length && w[7].every((p) => m.src.pages.includes(p)), `${m.id}: หน้า ${m.src.pages}`);
    assert(/415 V/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, `${m.id}: หมายเหตุ/selMCB`);
  }
});
test('S25 Legrand DPX³: ทะเบียนแหล่ง 4 เอกสาร (เลขเอกสาร/ฉบับ/SHA-256/โดเมน legrand.com) ครบ', () => {
  const want = { 'LEG-F01360EN-09': 'F01360EN-09', 'LEG-F01364EN-07': 'F01364EN-07', 'LEG-F01958EN-06': 'F01958EN-06', 'LEG-F01963EN-05': 'F01963EN-05' };
  for (const [id, doc] of Object.entries(want)) {
    const s = byId.get(id);
    assert(s && s.docNo === doc && s.publisher === 'Legrand' && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]) && /^https:\/\/assets\.legrand\.com\/pim\/NP-FT-GT\//.test(s.urls[0]), `แหล่ง ${id}`);
  }
});

/* ---- Siemens SENTRON 3VA (Catalog Extract LV 10 · 10/2023, 100 หน้า): Icu/Ics @380…415 V หน้า PDF 12–13 (3VA10–15, พิมพ์ 2/8–2/9) และ 16–17 (3VA20–27, พิมพ์ 2/12–2/13) ;
   AT = "Max. rated current In max" (Line protection) ตารางโครงสร้างเลขที่สินค้า หน้า 28 (2/24) ; 3VA27 In max จากหน้า 76 (2/72) ; ตัวเลข Ir/Ii ไม่มีในเอกสารนี้ → ไม่ใส่ ---- */
const S1 = [16, 20, 25, 32, 40, 50, 63, 80, 100];
const SIE = {};
const addSie = (frame, af, at, trip, levels, pages) => levels.forEach(([cls, icu, ics]) => { SIE[`${frame} ${cls}`] = [icu, ics, af, at, trip, pages]; });
addSie('3VA10', 100, S1, 'TM', [['B', 16, 16], ['N', 25, 25], ['S', 36, 36]], [12, 28]);
addSie('3VA11', 160, [...S1, 125, 160], 'TM', [['N', 25, 25], ['S', 36, 36], ['M', 55, 55], ['H', 70, 70]], [13, 12, 28]);
addSie('3VA12', 250, [160, 200, 250], 'TM', [['S', 36, 36], ['M', 55, 55], ['H', 70, 70]], [13, 12, 28]);
addSie('3VA13', 400, [320, 400], 'TM', [['S', 36, 36], ['M', 55, 55], ['H', 70, 70], ['C', 110, 110]], [13, 12, 28]);
addSie('3VA14', 630, [500, 630], 'TM', [['S', 36, 36], ['M', 55, 55], ['H', 70, 70], ['C', 110, 110]], [13, 12, 28]);
addSie('3VA15', 1000, [630, 800, 1000], 'TM', [['M', 55, 55], ['H', 70, 70], ['C', 110, 85]], [13, 12, 28]);
addSie('3VA20', 100, [25, 40, 63, 100], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110], ['L', 150, 150]], [16, 28]);
addSie('3VA21', 160, [25, 40, 63, 100, 160], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110], ['L', 150, 150], ['E', 200, 200]], [16, 28]);
addSie('3VA22', 250, [160, 250], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110], ['L', 150, 150], ['E', 200, 200]], [16, 28]);
addSie('3VA23', 400, [250, 400], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110], ['L', 150, 150], ['E', 200, 200]], [17, 16, 28]);
addSie('3VA24', 630, [400, 500, 630], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110], ['L', 150, 150], ['E', 200, 200]], [17, 16, 28]);
addSie('3VA25', 1000, [630, 800, 1000], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 85]], [17, 16, 28]);
addSie('3VA26', 1250, [1250], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 85]], [17, 16, 28]);
addSie('3VA27', 1600, [800, 1000, 1250, 1600], 'ETU', [['M', 55, 55], ['H', 85, 85], ['C', 110, 110]], [17, 16, 76]);
const sieRows = () => B.mccb.filter((m) => m.brandShort === 'Siemens' && /^SENTRON 3VA/.test(m.series));
test('S26 Siemens SENTRON 3VA: 54 รุ่น (3VA10–15 TM 21 รุ่น · 3VA20–27 อิเล็กทรอนิกส์ 33 รุ่น) แทนแถวที่รวบรวมเดิม — ชื่อรุ่น = เฟรม + ระดับ (B/N/S/M/H/C/L/E)', () => {
  const rs = sieRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(SIE).sort());
  eq(Object.keys(SIE).length, 54);
  assert(rs.every((m) => m.verified && m.src.id === 'SIE-LV10-2023-10'), 'ผูกแหล่ง SIE-LV10-2023-10 ทุกรุ่น');
});
test('S27 Siemens 3VA: Icu/Ics @415 V ตามตาราง (Ics = Icu ยกเว้น 3VA15/3VA25/3VA26 ระดับ C = 110/85 kA)', () => {
  for (const m of sieRows()) { const w = SIE[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); }
  eq([row('Siemens|3VA15 C').icsPct, row('Siemens|3VA25 C').icsPct], [Math.round((85 / 110) * 10000) / 100, Math.round((85 / 110) * 10000) / 100]);
});
test('S28 Siemens 3VA: AF = Size, AT = In max (ไม่ใช่ช่วง), ขั้ว 3P/4P, ชนิด trip (3VA1 = TM, 3VA2 = อิเล็กทรอนิกส์) ; ไม่ใส่ Ii/selectivity เพราะเอกสารไม่ให้ตัวเลข', () => {
  for (const m of sieRows()) {
    const w = SIE[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq(m.electronic, w[4] === 'ETU', m.id + ' electronic');
    assert(w[5].every((p) => m.src.pages.includes(p)) && m.src.pages.every((p) => w[5].includes(p)), `${m.id}: หน้า ${m.src.pages}`);
    assert(m.iiMult == null && m.iiMin == null && m.selMCB == null, `${m.id}: ห้ามใส่ Ii/selectivity`);
    assert(/415 V/.test(m.src.note) && /In max/.test(m.src.note) && /Ii/.test(m.src.note), `${m.id}: หมายเหตุ`);
  }
});
test('S29 Siemens: ทะเบียนแหล่ง (LV 10 · 10/2023 — โดเมน siemens.com, SHA-256, 100 หน้า)', () => {
  const s = byId.get('SIE-LV10-2023-10');
  assert(s && s.publisher === 'Siemens' && s.pages === 100 && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]) && /LV 10/.test(s.docNo), 'ทะเบียนแหล่ง Siemens');
});

/* ---- LS Electric Metasol (Technical Manual Metasol MCCB/ELCB — ls-electric.com) : ตาราง Ratings หน้า PDF 8–11 (พิมพ์ A-6…A-9) ; Icu = แถว 415/460 V ; Ics = % × Icu ;
   AT = In ที่ไม่อยู่ในวงเล็บ ; Ii จาก "Magnetic trip range" (ค่าตัวเลขในตาราง) — ≤ 250AF : 400 A (In 15–30 A) / 12×In ; 400–800AF : 8–12×In ปรับได้ → ใช้ขอบล่าง 8×In ---- */
const R100 = [15, 20, 30, 40, 50, 60, 75, 100];
// [Icu, Ics%, AF, AT, Ii mult, Min Ii, หน้า PDF]
const LSM = {
  ABS33c: [14, 100, 30, [15, 20, 30], 13.3, 400, 8],
  ABN53c: [14, 100, 50, [15, 20, 30, 40, 50], 12, 400, 8], ABS53c: [18, 100, 50, [15, 20, 30, 40, 50], 12, 400, 8], ABH53c: [50, 100, 50, [15, 20, 30, 40, 50], 12, 400, 8],
  ABN63c: [14, 100, 60, [15, 20, 30, 40, 50, 60], 12, 400, 8], ABS63c: [18, 100, 60, [15, 20, 30, 40, 50, 60], 12, 400, 9],
  ABN103c: [18, 100, 100, R100, 12, 400, 9],
  ABS103c: [37, 100, 125, [...R100, 125], 12, 400, 9], ABH103c: [50, 100, 125, [...R100, 125], 12, 400, 9],
  ABN203c: [26, 100, 250, [100, 125, 150, 175, 200, 225, 250], 12, 1200, 9], ABS203c: [37, 100, 250, [100, 125, 150, 175, 200, 225, 250], 12, 1200, 9], ABH203c: [50, 100, 250, [100, 125, 150, 175, 200, 225, 250], 12, 1200, 9],
  ABN403c: [37, 100, 400, [250, 300, 350, 400], 8, 2000, 10], ABS403c: [50, 100, 400, [250, 300, 350, 400], 8, 2000, 10], ABH403c: [65, 100, 400, [250, 300, 350, 400], 8, 2000, 10], ABL403c: [85, 75, 400, [250, 300, 350, 400], 8, 2000, 10],
  ABN603c: [37, 100, 630, [500, 630], 8, 4000, 11], ABS603c: [65, 100, 630, [500, 630], 8, 4000, 11], ABL603c: [85, 75, 630, [500, 630], 8, 4000, 11],
  ABN803c: [37, 100, 800, [700, 800], 8, 5600, 11], ABS803c: [65, 100, 800, [700, 800], 8, 5600, 11], ABL803c: [85, 75, 800, [700, 800], 8, 5600, 11]
};
const lsmRows = () => B.mccb.filter((m) => m.brandShort === 'LS' && m.series === 'Metasol');
test('S30 LS Metasol: 22 รุ่น (30AF ×1 · 50AF ×3 · 60AF ×2 · 100AF ×1 · 125AF ×2 · 250AF ×3 · 400AF ×4 · 630AF ×3 · 800AF ×3) แทนแถวที่รวบรวมเดิม — Icu @415/460 V และ Ics ตรงตาราง (ABL Ics 75%, ที่เหลือ 100%)', () => {
  const rs = lsmRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(LSM).sort());
  for (const m of rs) { const w = LSM[m.model]; eq([m.icu, m.icsPct], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'LS-METASOL-MANUAL', m.id); }
  assert(B.mccb.filter((m) => m.brandShort === 'LS' && m.series === 'Susol' && m.verified).every((m) => m.src.id === 'LS-SUSOL-CAT-V31'), 'Susol ที่ยืนยันแล้วต้องมาจากแคตตาล็อก Susol (S59–S61) ไม่ใช่คู่มือ Metasol');
});
test('S31 LS Metasol: AF, ขั้ว 3P/4P, AT (ไม่รวม In ในวงเล็บ 3/5/10 A ของ 30AF), TM, Ii จาก Magnetic trip range (400 A / 12×In / ขอบล่าง 8×In)', () => {
  for (const m of lsmRows()) {
    const w = LSM[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles'); eq(m.electronic, false, m.id);
    eq([m.iiMult, m.iiMin], [w[4], w[5]], m.id + ' Ii');
    assert(m.src.pages.includes(w[6]) && m.src.pages.every((p) => p >= 8 && p <= 11), `${m.id}: หน้า ${m.src.pages}`);
    assert(/415/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, m.id + ' หมายเหตุ');
  }
});
test('S32 LS Metasol: ทะเบียนแหล่ง (ls-electric.com, SHA-256, 100 หน้า) และบอกชัดว่าเป็นฉบับก่อนเปลี่ยนชื่อบริษัท ควรตรวจกับแคตตาล็อกล่าสุด', () => {
  const s = byId.get('LS-METASOL-MANUAL');
  assert(s && s.publisher === 'LS Electric' && s.pages === 100 && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]) && /ก่อน/.test(s.edition), 'ทะเบียนแหล่ง LS');
});

/* ---- Fuji Electric G-TWIN Standard Series (Distribution catalogue 62D1-E-0202, th.fujielectric.com): Quick reference guide หน้า 14–22 (ชนิด G = line protection) ;
   Icu/Ics @415 V จากตาราง IEC 60947-2 ; ขั้ว 3P/4P (2P ไม่นำเข้า) ; BW100AAG ไม่นำเข้า (ตารางไม่ให้ค่า 415 V) ; รุ่นป้องกันมอเตอร์ (M) และ Global Series (…GU) ไม่นำเข้า ---- */
const FR125 = [15, 20, 30, 40, 50, 60, 75, 100, 125], FR50 = [5, 10, 15, 20, 30, 32, 40, 50], FA250 = [175, 200, 225, 250];
// [Icu, Ics, AF, ขั้ว, AT, trip (H = hydraulic-magnetic, T = thermal-magnetic), หน้า]
const FUJ = {
  BW32AAG: [1.5, 1, 32, [3], [3, 5, 10, 15, 20, 30, 32], 'H', 14], BW32SAG: [2.5, 2, 32, [3], [3, 5, 10, 15, 20, 30, 32], 'H', 14],
  BW50AAG: [1.5, 1, 50, [3], FR50, 'H', 15], BW50EAG: [2.5, 2, 50, [3], FR50, 'H', 15], BW50SAG: [7.5, 4, 50, [3], FR50, 'H', 15],
  BW50RAG: [10, 5, 50, [3], [10, 15, 20, 30, 32, 40, 50], 'H', 15], BW50HAG: [65, 17, 50, [3], [15, 20, 30, 40, 50], 'T', 15],
  BW63EAG: [2.5, 2, 63, [3], [60, 63], 'H', 16], BW63SAG: [7.5, 4, 63, [3], [60, 63], 'H', 16], BW63RAG: [10, 5, 63, [3], [60, 63], 'H', 16],
  BW100EAG: [10, 5, 100, [3], [50, 60, 63, 75, 100], 'T', 17],
  BW125JAG: [30, 15, 125, [3, 4], FR125, 'T', 18], BW125SAG: [36, 18, 125, [3, 4], FR125, 'T', 18], BW125RAG: [50, 25, 125, [3, 4], FR125, 'T', 18], BW125HAG: [65, 17, 125, [3], FR125, 'T', 18],
  BW160EAG: [18, 9, 160, [3], [125, 150, 160], 'T', 19], BW160JAG: [30, 15, 160, [3, 4], [125, 150, 160], 'T', 19], BW160SAG: [36, 18, 160, [3, 4], [125, 150, 160], 'T', 19], BW160RAG: [50, 25, 160, [3, 4], [125, 150, 160], 'T', 19],
  BW250EAG: [18, 9, 250, [3], FA250, 'T', 20], BW250JAG: [30, 15, 250, [3, 4], FA250, 'T', 20], BW250SAG: [36, 18, 250, [3, 4], FA250, 'T', 20], BW250RAG: [50, 25, 250, [3, 4], FA250, 'T', 20],
  BW250HAG: [65, 17, 250, [3], [125, 150, 160, 175, 200, 225, 250], 'T', 20],
  BW400EAG: [30, 15, 400, [3], [250, 300, 350, 400], 'T', 21], BW400SAG: [36, 18, 400, [3], [250, 300, 350, 400], 'T', 21], BW400RAG: [50, 25, 400, [3, 4], [250, 300, 350, 400], 'T', 21], BW400HAG: [70, 35, 400, [3, 4], [250, 300, 350, 400], 'T', 21],
  BW630EAG: [36, 18, 630, [3], [500, 600, 630], 'T', 22], BW630RAG: [50, 25, 630, [3, 4], [500, 600, 630], 'T', 22], BW630HAG: [70, 35, 630, [3, 4], [500, 600, 630], 'T', 22],
  BW800EAG: [36, 18, 800, [3], [700, 800], 'T', 22], BW800RAG: [50, 25, 800, [3, 4], [700, 800], 'T', 22], BW800HAG: [70, 35, 800, [3, 4], [700, 800], 'T', 22]
};
const fujRows = () => B.mccb.filter((m) => m.brandShort === 'Fuji');
test('S33 Fuji G-TWIN: 34 รุ่นชนิด G (32AF ×2 · 50AF ×5 · 63AF ×3 · 100AF ×1 · 125AF ×4 · 160AF ×4 · 250AF ×5 · 400AF ×4 · 630AF ×3 · 800AF ×3) แทนแถวที่รวบรวมเดิม — Icu/Ics @415 V ตามตาราง', () => {
  const rs = fujRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(FUJ).sort());
  eq(Object.keys(FUJ).length, 34);
  for (const m of rs) { const w = FUJ[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'FUJ-62D1-E-0202', m.id); }
  assert(!rs.some((m) => /Economy/.test(m.series)), 'ซีรีส์ "G-TWIN Economy" ที่รวบรวมเดิมต้องถูกแทนที่');
});
test('S34 Fuji G-TWIN: AF, ขั้ว, AT, ชนิด trip (50AF–63AF และ 32AF = hydraulic-magnetic ยกเว้น BW50HAG ; ที่เหลือ thermal-magnetic) ; ไม่ใส่ Ii เพราะตารางไม่ให้ตัวเลข', () => {
  for (const m of fujRows()) {
    const w = FUJ[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.poles, w[3], m.id + ' poles'); eq(m.at, w[4], m.id + ' AT'); eq(m.electronic, false, m.id);
    assert(new RegExp(w[5] === 'H' ? '^Hydraulic' : '^Thermal').test(m.trip), `${m.id}: trip ${m.trip}`);
    assert(m.src.pages.includes(w[6]) && m.src.pages.every((p) => p >= 14 && p <= 22), `${m.id}: หน้า ${m.src.pages}`);
    assert(m.iiMult == null && m.iiMin == null && m.selMCB == null && /415 V/.test(m.src.note), m.id + ' Ii/หมายเหตุ');
  }
});
test('S35 Fuji: ทะเบียนแหล่ง (th.fujielectric.com, SHA-256, 192 หน้า) ระบุฉบับ 2016 ที่ผู้ผลิตแจ้ง "subject to change" ให้ตรวจกับแคตตาล็อกล่าสุด', () => {
  const s = byId.get('FUJ-62D1-E-0202');
  assert(s && s.publisher === 'Fuji Electric' && s.pages === 192 && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]) && /2016/.test(s.edition) && /subject to change/.test(s.edition), 'ทะเบียนแหล่ง Fuji');
});

/* ---- CHINT NM8N (NM8N-MCCB-Catalog.pdf, chintglobal.com): หน้า PDF 4 (125/250 AF) และ 5 (400/630/800/1600 AF) — Icu/Ics แถว AC380/400/415V ; In จากแถว Rated operating current (TM ∪ อิเล็กทรอนิกส์) ; ขั้ว 3P/4P ; Ii ไม่นำเข้า (ตาราง TM ปรับได้ซับซ้อน) ---- */
const CN125 = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125], CN250 = [32, 63, 100, 125, 160, 180, 200, 225, 250];
const CN = {};
const addCn = (frame, at, levels, trip) => levels.forEach(([cls, icu, ics]) => { CN[`NM8N-${frame}${cls}`] = [icu, ics, frame, at, trip]; });
const cLv = [['C', 36, 36], ['S', 50, 50], ['Q', 70, 70], ['H', 100, 100], ['R', 150, 150]];
addCn(125, CN125, cLv, 'TM'); addCn(250, CN250, cLv, 'TM/E'); addCn(400, [250, 315, 350, 400], cLv, 'TM/E'); addCn(630, [400, 500, 630], cLv, 'TM/E'); addCn(800, [500, 630, 700, 800], cLv, 'TM/E');
addCn(1600, [800, 1000, 1250, 1600], [['S', 50, 50], ['Q', 70, 70], ['H', 100, 70]], 'TM/E');
const chnRows = () => B.mccb.filter((m) => m.brandShort === 'CHINT' && m.series === 'NM8N Series');
test('S36 CHINT NM8N: 28 รุ่น (125/250/400/630/800 × C,S,Q,H,R · 1600 × S,Q,H) — Icu/Ics @380/400/415 V ตามตาราง (Ics = Icu ยกเว้น NM8N-1600H 100/70 kA) แทนแถวที่รวบรวมเดิม', () => {
  const rs = chnRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(CN).sort());
  eq(Object.keys(CN).length, 28);
  for (const m of rs) { const w = CN[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'CHINT-NM8N-CATALOG', m.id); }
  assert(B.mccb.filter((m) => m.brandShort === 'CHINT' && m.series === 'NM1 Series').every((m) => m.verified && m.src.id === 'CHINT-NM1-CATALOG'), 'NM1 ผูกแหล่งแล้ว (S54–S56) — คนละเอกสารกับ NM8N');
});
test('S37 CHINT NM8N: AF, ขั้ว 3P/4P, AT (รวม TM + อิเล็กทรอนิกส์), ชนิด trip ; ไม่ใส่ Ii/selectivity', () => {
  for (const m of chnRows()) {
    const w = CN[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles'); eq(m.electronic, false, m.id);
    assert(w[4] === 'TM' ? /^Thermal-Magnetic$/.test(m.trip) : /^Thermal-Magnetic \/ Electronic/.test(m.trip), `${m.id}: trip ${m.trip}`);
    assert(m.src.pages.includes(m.af <= 250 ? 4 : 5) && m.src.pages.every((p) => p === 4 || p === 5), `${m.id}: หน้า ${m.src.pages}`);
    assert(m.iiMult == null && m.iiMin == null && m.selMCB == null && /415/.test(m.src.note), m.id + ' Ii/หมายเหตุ');
  }
});
test('S38 CHINT: ทะเบียนแหล่ง (chintglobal.com, SHA-256, 87 หน้า)', () => {
  const s = byId.get('CHINT-NM8N-CATALOG');
  assert(s && s.publisher === 'CHINT' && s.pages === 87 && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง CHINT');
});

/* ---- Schneider EasyPact CVS (LVED210011EN, catalog 2024): Icu/Ics @380/415 V หน้า PDF 15 (A-5, ป้ายแถวอยู่หน้า 14) ; Ii จากตาราง TM-D หน้า 16 (A-6) ; In จาก Catalogue Numbers หน้า 119 (CVS100/160/250 B,F,N) และ 131 (CVS400/630 F,N,H) ---- */
const CVS = {
  CVS100B: [25, 100, [16, 25, 32, 40, 50, 63, 80, 100], 7.9, 190, [15, 14, 16, 119]], CVS100F: [36, 100, [16, 25, 32, 40, 50, 63, 80, 100], 7.9, 190, [15, 14, 16, 119]], CVS100N: [50, 100, [16, 25, 32, 40, 50, 63, 80, 100], 7.9, 190, [15, 14, 16, 119]],
  CVS160B: [25, 100, [100, 125, 160], 7.8, 800, [15, 14, 16, 119]], CVS160F: [36, 100, [100, 125, 160], 7.8, 800, [15, 14, 16, 119]], CVS160N: [50, 100, [100, 125, 160], 7.8, 800, [15, 14, 16, 119]],
  CVS250B: [25, 100, [160, 200, 250], 7.8, 1250, [15, 14, 16, 119]], CVS250F: [36, 100, [160, 200, 250], 7.8, 1250, [15, 14, 16, 119]], CVS250N: [50, 100, [160, 200, 250], 7.8, 1250, [15, 14, 16, 119]],
  CVS400F: [36, 100, [320, 400], 5, 1600, [15, 14, 16, 131]], CVS400N: [50, 100, [320, 400], 5, 1600, [15, 14, 16, 131]], CVS400H: [70, 100, [320, 400], 5, 1600, [15, 14, 16, 131]],
  CVS630F: [36, 100, [500, 600, 630], 4.1, 2500, [15, 14, 16, 131]], CVS630N: [50, 100, [500, 600, 630], 4.1, 2500, [15, 14, 16, 131]], CVS630H: [70, 100, [500, 600, 630], 4.1, 2500, [15, 14, 16, 131]]
};
const cvsRows = () => B.mccb.filter((m) => m.brandShort === 'Schneider' && m.series === 'EasyPact CVS');
test('S39 EasyPact CVS: 15 รุ่น (CVS100/160/250 × B,F,N · CVS400/630 × F,N,H) — Icu/Ics @380/415 V ตามตาราง (Ics = Icu 100%) แทนแถวที่รวบรวมเดิม', () => {
  const rs = cvsRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(CVS).sort());
  for (const m of rs) { const w = CVS[m.model]; eq([m.icu, m.icsPct], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'SE-LVED210011EN', m.id); }
  assert(B.mccb.filter((m) => m.brandShort === 'Schneider' && m.series === 'ComPacT NS').every((m) => !m.verified), 'ComPacT NS ยังไม่ผูกแหล่ง (แคตตาล็อกไม่ให้ตาราง Ics ชัดเจน)');
});
test('S40 EasyPact CVS: AF, ขั้ว 3P/4P, AT ตาม TM-D, Ii จากตาราง TM-D (CVS100 คงที่ 190…800 A ; CVS160/250 800…2500 A ; CVS400/630 ปรับได้ใช้ขอบล่าง 5×In / 2500 A)', () => {
  for (const m of cvsRows()) {
    const w = CVS[m.model];
    eq(m.af, Number(m.model.slice(3, 6)), m.id + ' AF'); eq(m.at, w[2], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles'); eq(m.electronic, false, m.id);
    eq([m.iiMult, m.iiMin], [w[3], w[4]], m.id + ' Ii');
    assert(w[5].every((p) => m.src.pages.includes(p)) && m.src.pages.length === w[5].length, `${m.id}: หน้า ${m.src.pages}`);
    assert(/380\/415 V/.test(m.src.note) && /TM-D/.test(m.src.note) && m.selMCB == null, m.id + ' หมายเหตุ');
  }
});
test('S41 EasyPact CVS: ทะเบียนแหล่ง LVED210011EN (se.com, SHA-256, 162 หน้า)', () => {
  const s = byId.get('SE-LVED210011EN');
  assert(s && s.publisher === 'Schneider Electric' && s.pages === 162 && s.docNo === 'LVED210011EN' && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง CVS');
});

/* ---- Siemens SENTRON 3VM (Catalog LV 31 · 2018, 92 หน้า): Icu/Ics @380…415 V หน้า PDF 10 (3VM10/3VM11) และ 11 (3VM12–14) ; In และ Ii (คงที่) จากตาราง Ordering หน้า 28 (TM210) / 30 (TM220) ---- */
const V10 = [16, 20, 25, 32, 40, 50, 63, 80, 100];
const SVM = {};
const addVm = (frame, af, at, levels, pages) => levels.forEach(([cls, icu, ics]) => { SVM[`${frame} ${cls}`] = [icu, ics, af, at, pages]; });
addVm('3VM10', 100, V10, [['B', 16, 8], ['N', 25, 12], ['S', 36, 12]], [10, 28, 30]);
addVm('3VM11', 160, [...V10, 125, 160], [['N', 25, 18], ['S', 36, 27], ['M', 55, 41]], [10, 28, 30]);
addVm('3VM12', 250, [200, 250], [['S', 36, 27], ['M', 55, 41]], [11, 10, 28, 30]);
addVm('3VM13', 400, [320, 400], [['S', 36, 27], ['M', 55, 41]], [11, 10, 28, 30]);
addVm('3VM14', 630, [500, 630], [['S', 36, 27], ['M', 55, 41]], [11, 10, 28, 30]);
const vmRows = () => B.mccb.filter((m) => m.brandShort === 'Siemens' && m.series === 'SENTRON 3VM');
test('S42 Siemens SENTRON 3VM: 12 รุ่น (3VM10 B,N,S · 3VM11 N,S,M · 3VM12/13/14 S,M) — Icu/Ics @380…415 V ตามตาราง (Ics ต่ำกว่า Icu: เช่น 3VM10 S = 36/12 kA) แทนแถวที่รวบรวมเดิม', () => {
  const rs = vmRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(SVM).sort());
  eq(Object.keys(SVM).length, 12);
  for (const m of rs) { const w = SVM[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'SIE-LV31-2018', m.id); }
});
test('S43 Siemens 3VM: AF, ขั้ว 3P/4P, AT ตามตาราง Ordering, Ii คงที่ = 10×In (ต่ำสุด 320 A ที่ In ≤ 32 A)', () => {
  for (const m of vmRows()) {
    const w = SVM[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles'); eq(m.electronic, false, m.id);
    eq([m.iiMult, m.iiMin], m.at[0] <= 32 ? [10, 320] : [10, 10 * m.at[0]], m.id + ' Ii');
    assert(w[4].every((p) => m.src.pages.includes(p)) && m.src.pages.length === w[4].length, `${m.id}: หน้า ${m.src.pages}`);
    assert(/415 V/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, m.id + ' หมายเหตุ');
  }
});
test('S44 Siemens 3VM: ทะเบียนแหล่ง LV 31 · 2018 (siemens.com, SHA-256, 92 หน้า) และระบุว่าเป็นฉบับปี 2018', () => {
  const s = byId.get('SIE-LV31-2018');
  assert(s && s.publisher === 'Siemens' && s.pages === 92 && /LV 31/.test(s.docNo) && /2018/.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง 3VM');
});

/* ===== รอบที่ 2 (2026-10-19): Legrand DRX · Hager h3 · WEG DWB/DWA · CHINT NM1 · HD Hyundai HGM — ค่า golden อ่านจากตารางในเอกสารผู้ผลิตตามหน้าที่ระบุ (ทั้งพิกัดคำและภาพหน้า) ===== */
const seriesRows = (brandShort, series) => B.mccb.filter((m) => m.brandShort === brandShort && m.series === series);
const samePages = (m, pages) => m.src.pages.length === pages.length && pages.every((p) => m.src.pages.includes(p));
// [Icu @415 V, Ics kA, AF, AT, Ii mult, Min Ii, เอกสาร, หน้า]

/* ---- Legrand DRX (เอกสารข้อมูลทางเทคนิค assets.legrand.com): DRX 125 = F00699EN/06 ; DRX 250 = F00703EN/05 ; DRX 630 = F02406EN/00 — Icu/Ics ตาราง Breaking capacity (380/415 V ; Ics % Icu) ; In จากตาราง Range ; Ii จากตาราง Magnetic limit Isd / Magnetic adjustment ---- */
const DRX_AT = { 125: [15, 20, 25, 30, 40, 50, 60, 63, 75, 80, 100, 125], 250: [125, 150, 160, 175, 200, 225, 250], 630: [320, 400, 500, 630] };
const DRX = {
  'DRX 125 10kA': [10, 10, 125, DRX_AT[125], 10, 150, 'LEG-F00699EN-06', [3, 1, 4]],
  'DRX 125 20kA': [20, 15, 125, DRX_AT[125], 10, 150, 'LEG-F00699EN-06', [3, 1, 4]],
  'DRX 125 36kA': [36, 18, 125, DRX_AT[125], 10, 150, 'LEG-F00699EN-06', [3, 1, 4]],
  'DRX 250 18kA': [18, 18, 250, DRX_AT[250], 10, 1250, 'LEG-F00703EN-05', [3, 1, 4]],
  'DRX 250 25kA': [25, 18.75, 250, DRX_AT[250], 10, 1250, 'LEG-F00703EN-05', [3, 1, 4]],
  'DRX 250 36kA': [36, 18, 250, DRX_AT[250], 10, 1250, 'LEG-F00703EN-05', [3, 1, 4]],
  'DRX 630 36kA': [36, 36, 630, DRX_AT[630], 5, 1600, 'LEG-F02406EN-00', [3, 1, 2]],
  'DRX 630 50kA': [50, 50, 630, DRX_AT[630], 5, 1600, 'LEG-F02406EN-00', [3, 1, 2]]
};
test('S45 Legrand DRX: 8 รุ่น (125 ×3 · 250 ×3 · 630 ×2) แทนแถวที่รวบรวมเดิม — Icu @380/415 V และ Ics (% Icu 100/75/50 ที่ 125/250, 100 ที่ 630) ตรงตารางของแต่ละเอกสาร', () => {
  const rs = seriesRows('Legrand', 'DRX Series');
  eq(rs.map((m) => m.model).sort(), Object.keys(DRX).sort());
  for (const m of rs) { const w = DRX[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === w[6], `${m.id}: แหล่ง ${m.src && m.src.id}`); }
  eq(rs.filter((m) => /^DRX 1|^DRX 2/.test(m.model)).map((m) => m.icsPct), [100, 75, 50, 100, 75, 50]);
});
test('S46 Legrand DRX: AF, ขั้ว 3P/4P, AT ตามตาราง Range, Util A, TM ; Ii = Isd 10×In (125/250: 150 A / 1250 A ต่ำสุดของรายการ AT) และปรับ 5–10×In (630: ขอบล่าง 1600 A)', () => {
  for (const m of seriesRows('Legrand', 'DRX Series')) {
    const w = DRX[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[4], w[5]], m.id + ' Ii'); eq([m.util, m.electronic], ['Cat A', false], m.id);
    assert(samePages(m, w[7]), `${m.id}: หน้า ${m.src.pages}`);
    assert(/415 V/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, `${m.id}: หมายเหตุ/selMCB`);
  }
  assert(/misprint|พิมพ์ผิด/.test(row('Legrand|DRX 125 10kA').src.note), 'DRX 125: ต้องบันทึกว่าแถว Isd(A) ของ 100/125 A ในเอกสารผิดพิมพ์และไม่ถูกนำมาใช้');
});
test('S47 Legrand DRX: ทะเบียนแหล่ง 3 เอกสาร (เลขเอกสาร/ฉบับ 2014–2016/SHA-256/โดเมน legrand.com)', () => {
  const want = { 'LEG-F00699EN-06': ['F00699EN-06', 8, /2014/], 'LEG-F00703EN-05': ['F00703EN-05', 8, /2014/], 'LEG-F02406EN-00': ['F02406EN-00', 7, /2016/] };
  for (const [id, [doc, pages, yr]] of Object.entries(want)) {
    const s = byId.get(id);
    assert(s && s.docNo === doc && s.publisher === 'Legrand' && s.pages === pages && yr.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/assets\.legrand\.com\/pim\/NP-FT-GT\//.test(s.urls[0]) && hostOk(s.urls[0]), `แหล่ง ${id}`);
  }
});

/* ---- Hager h3 (Technical catalogue 2024, assets.hager.com, 84 หน้า; เลขหน้าพิมพ์ = PDF − 2): Icu/Ics @380/415 V หน้า 6–7 (ยืนยันซ้ำหน้า 17/26/40/52) ; In จาก References guide หน้า 9–10 ; Ii จากหน้า 17 (x160 Imag), 23/26 (x250), 37 (h800) ---- */
const HAG_X160 = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160], HAG_X250 = [100, 125, 160, 200, 250];
const HAGER = {
  'x160 HDA': [18, 18, 160, HAG_X160, 10, 600, 'Thermal-Magnetic', [6, 17, 9, 13]],
  'x160 HHA': [25, 20, 160, HAG_X160, 10, 600, 'Thermal-Magnetic', [6, 17, 9, 13]],
  'x160 HNA': [40, 25, 160, HAG_X160, 10, 600, 'Thermal-Magnetic', [6, 17, 9, 13]],
  'x250 HHB': [25, 20, 250, HAG_X250, 10, 1000, 'Thermal-Magnetic', [6, 26, 9, 23]],
  'x250 HNB': [40, 20, 250, HAG_X250, 5, 600, 'Thermal-Magnetic', [6, 26, 9, 23]],
  'h800 HNK': [50, 50, 800, [630, 800], 5, 3150, 'Thermal-Magnetic', [7, 40, 10, 37]],
  'h800 HEK': [70, 50, 800, [630, 800], 5, 3150, 'Thermal-Magnetic', [7, 40, 10, 37]],
  'h1000 HNE': [50, 50, 1000, [630, 800, 1000], null, null, 'Electronic', [7, 40, 10, 37]],
  'h1000 HEE': [70, 50, 1000, [800, 1000], null, null, 'Electronic', [7, 40, 10, 37]],
  'h1600 HNF': [50, 50, 1600, [1250, 1600], null, null, 'Electronic', [7, 52, 10, 50]],
  'h1600 HEF': [70, 50, 1600, [1250, 1600], null, null, 'Electronic', [7, 52, 10, 50]]
};
test('S48 Hager h3: 11 รุ่น (x160 HDA/HHA/HNA · x250 HHB/HNB · h800 HNK/HEK · h1000 HNE/HEE · h1600 HNF/HEF) — Icu/Ics @380/415 V ตรงตาราง (เช่น HNA 40/25, HNB 40/20, HEK 70/50) แทนแถว h3 เดิม', () => {
  const rs = seriesRows('Hager', 'h3 Series');
  eq(rs.map((m) => m.model).sort(), Object.keys(HAGER).sort());
  for (const m of rs) { const w = HAGER[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'HAG-H3-CAT-2024', m.id); }
  assert(!B.mccb.some((m) => m.brandShort === 'Hager' && m.series === 'h3 Series' && !m.verified), 'ไม่เหลือแถว h3 ที่รวบรวมเดิม (x160/x250/h1000/h1600)');
});
test('S49 Hager h3: AF, ขั้ว 3P/4P, AT ตาม References guide, ชนิด trip, Ii (x160 Imag 600 A ; x250 Z 10×In/U 5–13×In ; h800 5–10×In ; LSI อิเล็กทรอนิกส์ = ว่าง เพราะ Ii = 14×Ir)', () => {
  for (const m of seriesRows('Hager', 'h3 Series')) {
    const w = HAGER[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[4], w[5]], m.id + ' Ii'); eq(m.electronic, w[6] === 'Electronic', m.id);
    assert(samePages(m, w[7]), `${m.id}: หน้า ${m.src.pages}`);
    assert(/415 V/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, `${m.id}: หมายเหตุ/selMCB`);
  }
  // h250/h400/h630 มีเฉพาะช่วง In ในตารางคุณสมบัติ (ไม่มีรายการ In ที่สั่งซื้อ) → ไม่นำเข้า ; h3+ (h250/h630 Energy) ไม่อยู่ในเอกสารนี้ → ต้องยัง "ไม่ยืนยัน"
  assert(seriesRows('Hager', 'h3+ Series').length > 0 && seriesRows('Hager', 'h3+ Series').every((m) => m.verified && m.src.id === 'HAG-H3P-CAT-IT-2023'), 'h3+ ผูกกับคู่มือเทคนิค h3+ แล้ว (S65–S67) ไม่ใช่แคตตาล็อก h3 ปี 2024');
});
test('S50 Hager: ทะเบียนแหล่ง (assets.hager.com, SHA-256, 84 หน้า, ฉบับ 2024) ', () => {
  const s = byId.get('HAG-H3-CAT-2024');
  assert(s && s.publisher === 'Hager' && s.pages === 84 && /2024/.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/assets\.hager\.com\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง Hager');
});

/* ---- WEG DWB/DWA (catálogo "Interruptores en Caja Moldeada" 50040542, static.weg.net, 48 หน้า, PDF 2015): Icu @380-415 V จากตารางเลือกรุ่นหน้า 9–12 ; Ics = % Icu @380-415 V หน้า 6 (DWB160/250) และ 7 (DWB400/DWA) ; Ii จากคอลัมน์ Protección magnética ---- */
const W160 = [16, 20, 25, 32, 40, 50, 63, 70, 80, 90, 100, 110, 125, 150, 160];
const WEG = {
  'DWB160B': [16, 16, 160, W160, 6.8, 300, [6, 9, 11]],
  'DWB160N 16-32A': [20, 10, 160, [16, 20, 25, 32], 10, 300, [6, 9, 11]],
  'DWB160N 40-160A': [30, 15, 160, W160.slice(4), 6.8, 400, [6, 9, 11]],
  'DWB160L': [80, 60, 160, W160.slice(0, 13), 8.8, 300, [6, 9, 11]],
  'DWB250B': [16, 16, 250, [100, 125, 160, 200, 250], 10, 1000, [6, 10, 12]],
  'DWB250N': [35, 17.5, 250, [100, 125, 160, 200, 250], 10, 1000, [6, 10, 12]],
  'DWB250L': [80, 60, 250, [100, 125, 160, 200], 10, 1000, [6, 10, 12]],
  'DWB400N': [35, 35, 400, [200, 250, 320, 400], 5, 1000, [7, 10, 12]],
  'DWA800N': [35, 35, 800, [500, 630, 800], 4, 2500, [7, 10]],
  'DWA800H': [65, 48.75, 800, [500, 630, 800], 4, 2500, [7, 10]],
  'DWA1600S': [50, 50, 1600, [1250, 1600], null, null, [7, 10]],
  'DWA1600H': [65, 48.75, 1600, [1250, 1600], null, null, [7, 10]]
};
const wegRows = () => [...seriesRows('WEG', 'DWB Series'), ...seriesRows('WEG', 'DWA Series')];
test('S51 WEG: 12 รุ่น (DWB160 B, N ×2 [16–32 A = 20 kA ; 40–160 A = 30 kA], L · DWB250 B,N,L · DWB400 N · DWA800 N,H · DWA1600 S,H) — Icu/Ics ตรงตาราง ; ไม่มี DWB400H (ตารางสองฉบับขัดแย้งที่ 415 V)', () => {
  const rs = wegRows();
  eq(rs.map((m) => m.model).sort(), Object.keys(WEG).sort());
  for (const m of rs) { const w = WEG[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'WEG-50040542', m.id); }
  assert(!rs.some((m) => /DWB400H|DWB800/.test(m.model)), 'ห้ามมี DWB400H / DWB800N เดิม');
});
test('S52 WEG: AF, ขั้ว 3P/4P, AT ตามตารางเลือกรุ่น, ชนิด trip, Ii จากคอลัมน์แม่เหล็ก (DWB160 คงที่ 300…1100 A → ต่ำสุด 300 A ; DWA1600 อิเล็กทรอนิกส์ = ว่าง)', () => {
  for (const m of wegRows()) {
    const w = WEG[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[4], w[5]], m.id + ' Ii'); eq(m.electronic, /^DWA1600/.test(m.model), m.id);
    assert(samePages(m, w[6]), `${m.id}: หน้า ${m.src.pages}`);
    assert(/380-415 V/.test(m.src.note) && /Ii/.test(m.src.note) && m.selMCB == null, `${m.id}: หมายเหตุ/selMCB`);
  }
  assert(/20 kA/.test(row('WEG|DWB160N 16-32A').src.note) && /30 kA/.test(row('WEG|DWB160N 40-160A').src.note), 'DWB160N: หมายเหตุต้องบอกว่า Icu แยกตามช่วง In');
  assert(/ขัดแย้ง|50 kA/.test(row('WEG|DWB400N').src.note), 'หมายเหตุ DWB400: ต้องบอกเรื่อง DWB400H ที่ไม่นำเข้า');
});
test('S53 WEG: ทะเบียนแหล่ง (static.weg.net, SHA-256, 48 หน้า, ภาษาสเปน, PDF 2015) และไม่ใช่ Ics ที่เดาเอง', () => {
  const s = byId.get('WEG-50040542');
  assert(s && s.publisher === 'WEG' && s.docNo === '50040542' && s.pages === 48 && /2015/.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/static\.weg\.net\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง WEG');
});

/* ---- CHINT NM1 (NM1-MCCB-Catalog.pdf, chintglobal.com, 25 หน้า): Icu/Ics @AC380/400/415 V ตาราง Technical data หน้า PDF 3 (ยืนยันซ้ำหน้า 22 ตาราง 12.7) ; Ics = 50% Icu ; In จากแถว Rated current หน้า 3 ---- */
const NM1_AT = { 63: [10, 16, 20, 25, 30, 32, 40, 50, 63], 125: [25, 30, 32, 40, 50, 63, 80, 100, 125], 250: [100, 125, 140, 150, 160, 175, 180, 200, 225, 250], 400: [250, 300, 315, 350, 400], 630: [400, 450, 500, 630], 800: [630, 700, 800], 1250: [800, 1000, 1250] };
// [Icu, Ics kA, ขั้ว]
const NM1 = {
  'NM1-63S': [15, 7.5, [3]], 'NM1-63H': [35, 17.5, [3, 4]],
  'NM1-125C': [20, 10, [3]], 'NM1-125S': [25, 12.5, [3]], 'NM1-125H': [50, 25, [3, 4]], 'NM1-125R': [65, 32.5, [3]],
  'NM1-250S': [25, 12.5, [3, 4]], 'NM1-250H': [50, 25, [3, 4]], 'NM1-250R': [65, 32.5, [3]],
  'NM1-400S': [35, 17.5, [3, 4]], 'NM1-400H': [50, 25, [3]], 'NM1-400R': [70, 35, [3]],
  'NM1-630S': [35, 17.5, [3, 4]], 'NM1-630H': [50, 25, [3]], 'NM1-630R': [70, 35, [3]],
  'NM1-800H': [60, 30, [3, 4]], 'NM1-800R': [70, 35, [3]], 'NM1-1250H': [65, 32.5, [3]]
};
test('S54 CHINT NM1: 18 รุ่น (63 S,H · 125 C,S,H,R · 250 S,H,R · 400/630 S,H,R · 800 H,R · 1250 H) — Icu/Ics @380/400/415 V ตรงตาราง (Ics = 50% Icu) แทนแถว NM1 เดิม ; ไม่มี NM1-250C/NM1-800S (อยู่เฉพาะตารางเดียว)', () => {
  const rs = seriesRows('CHINT', 'NM1 Series');
  eq(rs.map((m) => m.model).sort(), Object.keys(NM1).sort());
  for (const m of rs) { const w = NM1[m.model]; eq([m.icu, m.ics, m.icsPct], [w[0], w[1], 50], m.id); assert(m.verified && m.src.id === 'CHINT-NM1-CATALOG', m.id); }
  assert(/NM1-250C/.test(row('CHINT|NM1-250S').src.note) && /NM1-800S/.test(row('CHINT|NM1-800H').src.note), 'หมายเหตุต้องบอกรุ่นที่ไม่นำเข้า');
});
test('S55 CHINT NM1: AF, ขั้ว, AT ตามแถว Rated current, Util A, trip แบบ fixed ; ไม่ใส่ Ii (แคตตาล็อกให้เฉพาะกราฟ)', () => {
  for (const m of seriesRows('CHINT', 'NM1 Series')) {
    const w = NM1[m.model], fr = Number(m.model.match(/^NM1-(\d+)/)[1]);
    eq(m.af, fr, m.id + ' AF'); eq(m.at, NM1_AT[fr], m.id + ' AT'); eq(m.poles, w[2], m.id + ' poles');
    eq([m.iiMult, m.iiMin, m.selMCB, m.util, m.electronic], [null, null, null, 'Cat A', false], m.id);
    assert(samePages(m, [3, 22]) && /415 V/.test(m.src.note), `${m.id}: หน้า/หมายเหตุ`);
  }
});
test('S56 CHINT NM1: ทะเบียนแหล่ง (chintglobal.com, SHA-256, 25 หน้า) แยกจาก NM8N', () => {
  const s = byId.get('CHINT-NM1-CATALOG');
  assert(s && s.publisher === 'CHINT' && s.pages === 25 && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]) && s.id !== 'CHINT-NM8N-CATALOG', 'ทะเบียนแหล่ง NM1');
});

/* ---- HD Hyundai Electric HG-MCCB (catalogue HGM/HGE/HGP, hd-hyundaielectric.com, 270 หน้า): ตาราง Model Selection หน้า PDF 30 (HGM30/50/60), 31 (HGM100/125/250), 32 (HGM400/630/800) ; Icu แถว AC 415/440/460 V (32–250 AF) และ AC 380/415 V (400–800 AF) ; Ics = 100% ยกเว้น HGM100 H 75% / L 50% ---- */
const HGM_AT = { 30: [16, 20, 25, 32], 50: [16, 20, 25, 32, 40, 50], 60: [16, 20, 25, 32, 40, 50, 63], 100: [16, 20, 25, 32, 40, 50, 63, 75, 80, 100], 125: [16, 20, 25, 32, 40, 50, 63, 75, 80, 100, 125], 250: [100, 125, 150, 160, 175, 200, 225, 250], 400: [250, 300, 350, 400], 630: [500, 630], 800: [700, 800] };
// frame → [AF, Ii mult, Min Ii, หน้า, {ระดับ: [Icu, Ics%]}]
const HGM_F = {
  30: [32, 12.5, 400, [30], { E: [16, 100] }],
  50: [50, 10, 400, [30], { E: [16, 100], S: [20, 100], H: [38, 100], L: [55, 100] }],
  60: [63, 10, 400, [30], { E: [16, 100], S: [20, 100] }],
  100: [100, 10, 400, [31], { E: [16, 100], S: [20, 100], H: [26, 75], L: [30, 50] }],
  125: [125, 10, 400, [31], { E: [20, 100], S: [26, 100], H: [38, 100], L: [55, 100] }],
  250: [250, 10, 1000, [31], { E: [20, 100], S: [26, 100], H: [38, 100], L: [55, 100] }],
  400: [400, 10, 2500, [32], { E: [45, 100], S: [65, 100], H: [85, 100], L: [100, 100] }],
  630: [630, 10, 5000, [32], { E: [45, 100], S: [65, 100], H: [85, 100], L: [100, 100] }],
  800: [800, 10, 7000, [32], { S: [65, 100], H: [85, 100], L: [100, 100] }]
};
const HGM = {};
for (const [fr, [af, iim, imin, pg, lv]] of Object.entries(HGM_F)) for (const [c, [icu, pct]] of Object.entries(lv)) HGM[`HGM${fr}${c}`] = [icu, pct, Number(fr), af, HGM_AT[fr], iim, imin, pg];
test('S57 HD Hyundai HGM: 30 รุ่น (HGM30 E · 50 E,S,H,L · 60 E,S · 100/125/250/400/630 E,S,H,L · 800 S,H,L) — Icu @415 V / Ics ตรงตาราง Model Selection ; แทน HGD100/HGD250 เดิม (HGD = MCB ในแคตตาล็อก ไม่ใช่ MCCB)', () => {
  const rs = seriesRows('HD Hyundai', 'HGM Series');
  eq(rs.length, 30);
  eq(rs.map((m) => m.model).sort(), Object.keys(HGM).sort());
  for (const m of rs) { const w = HGM[m.model]; eq([m.icu, m.icsPct], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'HD-HG-MCCB-2026', m.id); }
  assert(!B.mccb.some((m) => m.brandShort === 'HD Hyundai' && m.series === 'HGD Series'), 'HGD Series ต้องถูกถอด');
  assert(seriesRows('HD Hyundai', 'U-Series').length === 6 && seriesRows('HD Hyundai', 'U-Series').every((m) => !m.verified), 'U-Series ไม่อยู่ในแคตตาล็อกฉบับนี้ → ยัง "ไม่ยืนยัน"');
});
test('S58 HD Hyundai HGM: AF, ขั้ว 3P/4P, AT ตาม Rated Current, TM ปรับความร้อนได้, Ii (400 A ที่ In ≤ 32 A ; อื่น ๆ 10×In)', () => {
  for (const m of seriesRows('HD Hyundai', 'HGM Series')) {
    const w = HGM[m.model];
    eq(m.af, w[3], m.id + ' AF'); eq(m.at, w[4], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[5], w[6]], m.id + ' Ii'); eq([m.util, m.electronic], ['Cat A', false], m.id);
    assert(samePages(m, w[7]) && /415/.test(m.src.note) && m.selMCB == null, `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
  const s = byId.get('HD-HG-MCCB-2026');
  assert(s && s.publisher === 'HD Hyundai Electric' && s.pages === 270 && /2026/.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง HD Hyundai');
});

/* ---- LS Electric Susol (catalogue [Susol MCCB] v31 · 2025-09, ls-electric.com, 384 หน้า): Icu @380/415 V ระดับ N/H/L หน้า PDF 40 (TD100/TD160) และ 41 (TS100–TS800) ; Ics = 100% Icu (แถว AC 220~525 V) ; In จากแถว Rated current ; Ii จากตาราง Magnetic short-circuit protection หน้า 45–55 ---- */
const LSF = { // frame → [AF, AT, Icu N/H/L, Ii mult, Min Ii, หน้า]
  TD100: [100, [16, 20, 25, 32, 40, 63, 80, 100], [50, 85, 150], 10, 400, [40, 45]],
  TD160: [160, [100, 125, 160], [50, 85, 150], 10, 1000, [40, 45]],
  TS100: [100, [40, 50, 63, 80, 100], [50, 85, 150], 10, 400, [41, 48, 49]],
  TS160: [160, [125, 160], [50, 85, 150], 5, 625, [41, 48, 49]],
  TS250: [250, [125, 160, 200, 250], [50, 85, 150], 5, 625, [41, 48, 49]],
  TS400: [400, [300, 400], [65, 85, 150], 5, 1500, [41, 51, 53]],
  TS630: [630, [500, 630], [65, 85, 150], 5, 2500, [41, 51, 53]],
  TS800: [800, [700, 800], [65, 100, 150], 5, 4000, [41, 55]]
};
const LS = {};
for (const [fr, [af, at, icu, iim, imin, pg]] of Object.entries(LSF)) ['N', 'H', 'L'].forEach((lv, i) => { LS[fr + lv] = [icu[i], af, at, iim, imin, pg]; });
// เฟรม 1000–1600 (หน้า PDF 110): อิเล็กทรอนิกส์ ; [Icu @380/415 V, Ics %Icu, AF, AT, Util]
const LSE = {
  TS1000N: [50, 100, 1000, [800, 1000], 'B'], TS1000H: [70, 75, 1000, [800, 1000], 'B'], TS1000L: [150, 100, 1000, [800, 1000], 'A'],
  TS1250N: [50, 100, 1250, [1250], 'B'], TS1250H: [70, 75, 1250, [1250], 'B'],
  TS1600N: [50, 100, 1600, [1600], 'B'], TS1600H: [70, 75, 1600, [1600], 'B']
};
const lsSusol = () => B.mccb.filter((m) => m.brandShort === 'LS' && m.series === 'Susol');
test('S59 LS Susol: 31 รุ่น (TD100/TD160/TS100/TS160/TS250/TS400/TS630/TS800 × N,H,L = 24 ; TS1000 N,H,L · TS1250 N,H · TS1600 N,H = 7) — Icu @380/415 V ตรงตาราง (Ics 100% ; TS1000–1600 H = 75%) ; ไม่เหลือแถวที่รวบรวมเดิม (TS1600N เดิม 75 kA → 50 kA)', () => {
  const all = lsSusol();
  eq(all.map((m) => m.model).sort(), [...Object.keys(LS), ...Object.keys(LSE)].sort());
  eq(Object.keys(LS).length + Object.keys(LSE).length, 31);
  for (const m of all) {
    assert(m.verified && m.src.id === 'LS-SUSOL-CAT-V31', m.id);
    if (LS[m.model]) eq([m.icu, m.icsPct], [LS[m.model][0], 100], m.id); else eq([m.icu, m.icsPct], [LSE[m.model][0], LSE[m.model][1]], m.id);
  }
  eq(row('LS|TS1600N').icu, 50);
});
test('S59b LS Susol TS1000–TS1600: AF, ขั้ว 3P/4P, AT ตาม Rated current, อิเล็กทรอนิกส์, Util B (TS1000L = A) ; ไม่ใส่ Ii', () => {
  for (const [model, w] of Object.entries(LSE)) {
    const m = row('LS|' + model);
    eq([m.af, m.at, m.poles, m.electronic, m.util], [w[2], w[3], [3, 4], true, 'Cat ' + w[4]], m.id);
    eq([m.iiMult, m.iiMin, m.selMCB], [null, null, null], m.id);
    assert(samePages(m, [110]) && /415 V/.test(m.src.note), `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
});
test('S60 LS Susol: AF, ขั้ว 3P/4P, AT (ไม่รวม In ในวงเล็บ (100) ของ TS160 และ 50/60 A ของ TD100 ที่สองตารางในเล่มขัดกัน), Util A, Ii (TD/TS100 คงที่ 10×In ; TS160–TS800 ใช้ขอบล่าง ATU 5×In)', () => {
  for (const m of lsSusol().filter((x) => x.verified && LS[x.model])) {
    const w = LS[m.model];
    eq(m.af, w[1], m.id + ' AF'); eq(m.at, w[2], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq([m.iiMult, m.iiMin], [w[3], w[4]], m.id + ' Ii'); eq([m.util, m.electronic], ['Cat A', false], m.id);
    assert(samePages(m, w[5]) && /415 V/.test(m.src.note) && m.selMCB == null, `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
  assert(/50 A|60 A/.test(row('LS|TD100N').src.note) && /\(100\)/.test(row('LS|TS160N').src.note), 'หมายเหตุต้องบอก In ที่ไม่นำเข้า');
});
test('S61 LS Susol: ทะเบียนแหล่ง (ls-electric.com, v31 ภาษาอังกฤษ, 384 หน้า, SHA-256) — ไม่ใช่แผ่นพับ Up to 1000Vac', () => {
  const s = byId.get('LS-SUSOL-CAT-V31');
  assert(s && s.publisher === 'LS Electric' && s.pages === 384 && /v?31/i.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/www\.ls-electric\.com\/ko\/cat\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง LS Susol');
});

/* ---- Terasaki TemBreak 2 (catalogue 18-I61E "The Ultimate Safety Breaker", terasaki.co.jp, 204 หน้า): ตาราง MCCB Electrical characteristics หน้า PDF 16–21 (แถว 400/415 V AC ของ Icu และ Ics) ; ยืนยันซ้ำกับ Easy Selection Guide หน้า 7 ; ชื่อรุ่นเดิม "TemBreak PRO" (E125-NJ, S160-NJ …) คือรุ่นของ TemBreak 2 ---- */
const T = (icu, ics, af, at, trip, util, pages) => [icu, ics, af, at, trip, util, pages];
const T125 = [20, 32, 50, 63, 100, 125], T160 = [20, 32, 50, 63, 100, 125, 160], T250E = [40, 125, 160, 250], T400 = [250, 400];
const TB2 = {
  'E125-NJ': T(25, 19, 125, T125, 'J', 'A', [16, 7]), 'H125-NJ': T(125, 85, 125, T125, 'J', 'A', [17, 7]), 'L125-NJ': T(200, 150, 125, T125, 'J', 'A', [17, 7]),
  'S160-NJ 20-32A': T(30, 25, 160, [20, 32], 'J', 'A', [17, 7]), 'S160-NJ 50-160A': T(36, 36, 160, [50, 63, 100, 125, 160], 'J', 'A', [17, 7]), 'S160-GJ': T(65, 36, 160, [50, 63, 100, 125, 160], 'J', 'A', [17, 7]),
  'H160-NJ': T(125, 85, 160, [160], 'J', 'A', [17, 7]), 'L160-NJ': T(200, 150, 160, [160], 'J', 'A', [17, 7]),
  'E250-NJ': T(25, 19, 250, [20, 32, 50, 63, 100, 125, 160, 200, 250], 'J', 'A', [18, 7]), 'S250-NJ': T(36, 36, 250, [160, 200, 250], 'J', 'A', [18, 7]), 'S250-GJ': T(65, 36, 250, [160, 200, 250], 'J', 'A', [18, 7]),
  'S250-NE': T(36, 36, 250, T250E, 'E', 'A', [18, 7]), 'S250-GE': T(65, 36, 250, T250E, 'E', 'A', [18, 7]), 'S250-PE': T(70, 70, 250, T250E, 'E', 'A', [19, 7]),
  'H250-NJ': T(125, 85, 250, [160, 250], 'J', 'A', [19, 7]), 'H250-NE': T(125, 85, 250, T250E, 'E', 'A', [19, 7]), 'L250-NJ': T(200, 150, 250, [160, 250], 'J', 'A', [19, 7]),
  'E400-NJ': T(25, 25, 400, T400, 'J', 'A', [19, 7]), 'S400-CJ': T(36, 36, 400, T400, 'J', 'A', [19, 7]), 'S400-NJ': T(50, 50, 400, T400, 'J', 'A', [19, 7]), 'S400-NE': T(50, 50, 400, T400, 'E', 'B', [19, 7]),
  'S400-GJ': T(70, 50, 400, T400, 'J', 'A', [19, 7]), 'S400-GE': T(70, 50, 400, T400, 'E', 'B', [19, 7]), 'S400-PJ': T(85, 85, 400, T400, 'J', 'A', [19, 7]), 'S400-PE': T(85, 85, 400, T400, 'E', 'B', [19, 7]),
  'H400-NE': T(125, 85, 400, T400, 'E', 'B', [19, 7]), 'L400-NE': T(200, 150, 400, T400, 'E', 'B', [19, 7]),
  'E630-NE': T(36, 36, 630, [630], 'E', 'A', [19, 7]), 'S630-CE': T(50, 50, 630, [630], 'E', 'A', [19, 7]), 'S630-GE': T(70, 50, 630, [630], 'E', 'A', [19, 7]),
  'S800-CJ': T(36, 36, 800, [630, 800], 'J', 'A', [20, 7]), 'S800-NJ': T(50, 50, 800, [630, 800], 'J', 'A', [20, 7]), 'S800-RJ': T(70, 50, 800, [630, 800], 'J', 'A', [21, 7]),
  'S800-NE': T(50, 50, 800, [630, 800], 'E', 'B', [21, 7]), 'S800-RE': T(70, 50, 800, [630, 800], 'E', 'B', [21, 7]), 'H800-NE': T(125, 94, 800, [630, 800], 'E', 'B', [21, 7]), 'L800-NE': T(200, 150, 800, [630, 800], 'E', 'B', [21, 7]),
  'S1000-SE': T(50, 38, 1000, [1000], 'E', 'A', [21, 7]), 'S1000-NE': T(70, 50, 1000, [1000], 'E', 'A', [21, 7]),
  'S1250-SE': T(50, 38, 1250, [800, 1250], 'E', 'B', [21, 7]), 'S1250-NE': T(70, 50, 1250, [800, 1250], 'E', 'B', [21, 7]), 'S1250-GE': T(85, 65, 1250, [800, 1250], 'E', 'B', [21, 7]),
  'S1600-SE': T(50, 38, 1600, [1600], 'E', 'B', [21, 7]), 'S1600-NE': T(85, 65, 1600, [1600], 'E', 'B', [21, 7])
};
const tbRows = () => B.mccb.filter((m) => m.brandShort === 'Terasaki' && m.series === 'TemBreak 2');
test('S62 Terasaki TemBreak 2: 44 รุ่น (125 ×3 · 160 ×5 · 250 ×9 · 400 ×10 · 630 ×3 · 800 ×7 · 1000 ×2 · 1250 ×3 · 1600 ×2) — Icu/Ics @400/415 V ตรงตาราง (S160-NJ แยก 20–32 A = 30/25 kA ตามเชิงอรรถ ; S1250-GE/S1600-NE = 85/65 kA ที่ 415 V, 100/75 kA ที่ 400 V) แทน "TemBreak PRO" เดิม', () => {
  const rs = tbRows();
  eq(Object.keys(TB2).length, 44);
  eq(rs.map((m) => m.model).sort(), Object.keys(TB2).sort());
  for (const m of rs) { const w = TB2[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'TER-TB2-18I61E', m.id); }
  assert(!B.mccb.some((m) => m.brandShort === 'Terasaki' && (m.series === 'TemBreak PRO' ? !m.verified || m.src.id !== 'TER-TBP-23I68E' : false)) && !B.mccb.some((m) => /^Terasaki\|(B250-NJ|XS630-NJ|XS800-NJ|XS1250-SE|XS1600-SE)$/.test(m.id)), 'ไม่เหลือแถว "TemBreak PRO" เดิม (B250-NJ/XS630-NJ/XS800-NJ/XS1250-SE/XS1600-SE ไม่มีในแคตตาล็อก) — ซีรีส์ TemBreak PRO ใหม่มาจาก catalogue 23-I68E (S68–S70)');
  assert(/100 kA/.test(row('Terasaki|S1250-GE').src.note) && /75 kA/.test(row('Terasaki|S1250-GE').src.note), 'หมายเหตุต้องบอกค่าที่ 400 V');
});
test('S63 Terasaki TemBreak 2: AF, ขั้ว 3P/4P, AT ตามแถว In (45 °C), ชนิด trip (J = ปรับความร้อน/แม่เหล็กได้, E = อิเล็กทรอนิกส์), Util A/B ; ไม่ใส่ Ii (แคตตาล็อกให้ช่วง/กราฟ)', () => {
  for (const m of tbRows()) {
    const w = TB2[m.model];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq(m.electronic, w[4] === 'E', m.id); eq(m.util, 'Cat ' + w[5], m.id + ' util');
    eq([m.iiMult, m.iiMin, m.selMCB], [null, null, null], m.id);
    assert(samePages(m, w[6]) && /415 V/.test(m.src.note), `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
  assert(/S125-NJ/.test(row('Terasaki|E125-NJ').src.note) && /36\/30/.test(row('Terasaki|E125-NJ').src.note), 'หมายเหตุต้องบอกว่า S125-NJ/GJ ไม่นำเข้าเพราะ Ics ในตารางเป็น "36/30", "36/33" ไม่มีคำอธิบาย');
});
test('S64 Terasaki: ทะเบียนแหล่ง (terasaki.co.jp, SHA-256, 204 หน้า, catalogue 18-I61E)', () => {
  const s = byId.get('TER-TB2-18I61E');
  assert(s && s.publisher === 'Terasaki Electric' && s.pages === 204 && /18-I61E/.test(s.docNo) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/www\.terasaki\.co\.jp\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง Terasaki');
});

/* ---- Hager h3+ (Catalogo tecnico h3+ fino a 630 A, ภาษาอิตาลี, assets.hager.com, 198 หน้า, PDF 2023): Icu/Ics @380/415 V ตารางหน้า PDF 18 (ยืนยันซ้ำกับรายการอ้างอิงหน้า 166–181) ; In จากรายการอ้างอิง (TM ปรับได้ หน้า 168/174/178 ; อิเล็กทรอนิกส์ LSnI/LSI/LSIG/Energy หน้า 171–173/175–177/179–181) ; Ii ของ TM จากหน้า 22–23 ---- */
const H3P_L = { P160: { H: [25, 25], N: [40, 40], M: [50, 50], E: [70, 50] }, P250: { H: [25, 25], N: [40, 40], M: [50, 50], E: [70, 50], S: [85, 50] }, P630: { H: [25, 25], N: [40, 40], M: [50, 50], E: [70, 70], P: [110, 110] } };
const H3P_AT = { P160: { TM: [25, 40, 63, 80, 100, 125, 160], E: [40, 100, 160] }, P250: { TM: [50, 63, 100, 125, 160, 200, 250], E: [40, 100, 160, 250] }, P630: { TM: [250, 320, 400, 630], E: [250, 400, 630] } };
const H3P_II = { P160: [6, 150], P250: [6, 300], P630: [4, 1000] };   // ขอบล่างของช่วงปรับ 6–12/10, 6–13/12/10, 4–10/8 × In ; Min = ขอบล่าง × In ต่ำสุดของรายการ AT
const H3P_PG = { P160: { TM: [18, 168, 22, 23], E: [18, 171, 172, 173] }, P250: { TM: [18, 174, 22, 23], E: [18, 175, 176, 177] }, P630: { TM: [18, 178, 22], E: [18, 179, 180, 181] } };
const H3P = {};
for (const [fr, lv] of Object.entries(H3P_L)) for (const [l, [icu, ics]] of Object.entries(lv)) {
  if (!(fr === 'P250' && l === 'S')) H3P[`${fr} ${l} TM`] = [icu, ics, fr, 'TM'];
  H3P[`${fr} ${l} Elec`] = [icu, ics, fr, 'E'];
}
const h3p = () => seriesRows('Hager', 'h3+ Series');
test('S65 Hager h3+: 27 รุ่น (P160 H,N,M,E · P250 H,N,M,E [+ S เฉพาะอิเล็กทรอนิกส์] · P630 H,N,M,E,P × TM ปรับได้ / อิเล็กทรอนิกส์) — Icu/Ics @380/415 V ตรงตารางหน้า 18 (เช่น E = 70/50 ที่ P160/P250, 70/70 ที่ P630, P = 110/110) แทน "h250/h630 Energy" เดิม', () => {
  const rs = h3p();
  eq(Object.keys(H3P).length, 27);
  eq(rs.map((m) => m.model).sort(), Object.keys(H3P).sort());
  for (const m of rs) { const w = H3P[m.model]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'HAG-H3P-CAT-IT-2023', m.id); }
  assert(!B.mccb.some((m) => m.id === 'Hager|h250 Energy' || m.id === 'Hager|h630 Energy'), 'ไม่เหลือแถว h250/h630 Energy เดิม');
});
test('S66 Hager h3+: AF, ขั้ว 3P/4P, AT ตามรายการอ้างอิง (TM ปรับได้ ≠ อิเล็กทรอนิกส์), ชนิด trip, Ii ของ TM = ขอบล่างของช่วงปรับ (P160 6×In/150 A · P250 6×In/300 A · P630 4×In/1000 A) ; อิเล็กทรอนิกส์ไม่ใส่ Ii', () => {
  for (const m of h3p()) {
    const [, , fr, fam] = H3P[m.model];
    eq(m.af, Number(fr.slice(1)), m.id + ' AF'); eq(m.at, H3P_AT[fr][fam], m.id + ' AT'); eq(m.poles, [3, 4], m.id + ' poles');
    eq(m.electronic, fam === 'E', m.id);
    eq([m.iiMult, m.iiMin], fam === 'TM' ? H3P_II[fr] : [null, null], m.id + ' Ii');
    eq(m.util, fr === 'P630' ? 'Cat B (≤ 400 A) / Cat A (630 A)' : 'Cat A', m.id + ' util');
    assert(samePages(m, H3P_PG[fr][fam]) && /415 V/.test(m.src.note) && m.selMCB == null, `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
  assert(/TM คงที่/.test(row('Hager|P160 H TM').src.note), 'หมายเหตุต้องบอกว่ารุ่น TM คงที่ของ P160 (Ics 20 kA) ไม่นำเข้าเพราะขัดกับตารางหน้า 18');
  assert(/80 A/.test(row('Hager|P250 H TM').src.note), 'หมายเหตุ P250 TM ต้องบอก In 80 A ที่อยู่ในเมทริกซ์หน้า 23 แต่ไม่อยู่ในรายการอ้างอิง');
});
test('S67 Hager h3+: ทะเบียนแหล่ง (assets.hager.com, SHA-256, 198 หน้า, ภาษาอิตาลี, PDF 2023)', () => {
  const s = byId.get('HAG-H3P-CAT-IT-2023');
  assert(s && s.publisher === 'Hager' && s.pages === 198 && /2023/.test(s.edition) && /อิตาลี/.test(s.edition) && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/assets\.hager\.com\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง Hager h3+');
});

/* ---- Terasaki TemBreak PRO (Catalogue 23-I68E, terasaki.co.jp, 632 หน้า): บทที่ 2 ตาราง Ratings and Specifications หน้า PDF 26–39 (Economical/Standard/High-fault level/Current limiting) — Icu/Ics แถว 415V, In แถว Rated current, Utilization Category, ชนิด trip จากแถว Overcurrent trip mechanism ; ไม่นำเข้า XS2000NE/XS2500NE/XS3200NE (เฟรมเกิน 1600 A) ---- */
// [Icu @415 V, Ics kA, AF (เฟรมสูงสุดของรุ่น), AT, ขั้ว, Util, trip (T = thermal-magnetic, Tadj = thermal-magnetic ปรับได้, E = อิเล็กทรอนิกส์), หน้า PDF]
const TBP = {
  'PE30-NF': [1.5, 1.5, 30, [3, 5, 10, 15, 20, 30], '3P', 'A', 'T', 26],
  'PE50-NF': [2.5, 2.5, 50, [15, 20, 30, 40, 50], '3P', 'A', 'T', 26],
  'PE60-NF': [2.5, 2.5, 60, [60], '3P', 'A', 'T', 26],
  'PE125-NF': [10, 5, 125, [60, 75, 100, 125], '3P', 'A', 'T', 26],
  'E250-SF': [25, 19, 250, [125, 150, 175, 200, 225, 250], '3P', 'A', 'T', 26],
  'E400-NF': [25, 25, 400, [250, 300, 350, 400], '3P', 'A', 'T', 26],
  'PS30-NF': [2.5, 2.5, 30, [3, 5, 10, 15, 20, 30], '3P', 'A', 'T', 27],
  'PS50-NF': [7.5, 7.5, 50, [15, 20, 30, 40, 50], '3P', 'A', 'T', 27],
  'S50-SF': [30, 15, 50, [15, 20, 30, 40, 50], '3P/4P', 'A', 'T', 27],
  'PS60-NF': [10, 5, 60, [60], '3P', 'A', 'T', 27],
  'S125-SF': [30, 15, 125, [15, 20, 30, 40, 50, 60, 75, 100, 125], '3P/4P', 'A', 'T', 28],
  'PS125-NF': [36, 36, 125, [15, 20, 30, 40, 50, 60, 75, 100, 125], '3P/4P', 'A', 'T', 28],
  'PS125-NE': [36, 36, 125, [40, 50, 60, 63, 75, 100, 125], '3P/4P', 'A', 'E', 29],
  'S250-SF': [40, 20, 250, [125, 150, 175, 200, 225, 250], '3P/4P', 'A', 'T', 29],
  'PS250-NE': [36, 36, 250, [125, 150, 175, 200, 225, 250], '3P/4P', 'A', 'E', 29],
  'PS400-CF': [36, 36, 400, [225, 250, 300, 350, 400], '3P/4P', 'A', 'Tadj', 29],
  'PS400-NF': [50, 50, 400, [225, 250, 300, 350, 400], '3P/4P', 'A', 'Tadj', 30],
  'PS400-NE': [50, 50, 400, [125, 150, 175, 200, 225, 250, 300, 350, 400], '3P/4P', 'B', 'E', 30],
  'S630-CF': [36, 36, 630, [500, 600, 630], '3P/4P', 'A', 'Tadj', 30],
  'PS630-CF': [36, 36, 600, [500, 600], '3P/4P', 'A', 'Tadj', 30],
  'S630-NF': [50, 50, 630, [500, 600, 630], '3P/4P', 'A', 'Tadj', 30],
  'PS630-NF': [50, 50, 600, [500, 600], '3P/4P', 'A', 'Tadj', 30],
  'S630-NE': [50, 50, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'B', 'E', 31],
  'PS630-NE': [50, 50, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'A', 'E', 31],
  'S800-CF': [36, 36, 800, [700, 800], '3P/4P', 'A', 'Tadj', 31],
  'S800-NF': [50, 50, 800, [700, 800], '3P/4P', 'A', 'Tadj', 31],
  'S800-NE': [50, 50, 800, [350, 400, 450, 500, 600, 700, 800], '3P/4P', 'B', 'E', 31],
  'S1000-CE': [65, 50, 1000, [400, 500, 600, 700, 800, 900, 1000], '3P/4P', 'A', 'E', 31],
  'S1250-NE': [70, 50, 1250, [500, 600, 700, 800, 1000, 1200, 1250], '3P/4P', 'B', 'E', 31],
  'S1600-NE': [85, 65, 1600, [700, 800, 900, 1000, 1200, 1400, 1500, 1600], '3P/4P', 'B', 'E', 31],
  'PS50-PF': [70, 50, 50, [15, 20, 30, 40, 50], '3P/4P', 'A', 'T', 33],
  'S100-GF': [65, 33, 100, [15, 20, 30, 40, 50, 60, 75, 100], '3P/4P', 'A', 'T', 33],
  'S125-GF': [65, 33, 125, [125], '3P/4P', 'A', 'T', 33],
  'PS125-PF': [70, 50, 125, [15, 20, 30, 40, 50, 60, 75, 100, 125], '3P/4P', 'A', 'T', 34],
  'PS125-PE': [70, 50, 125, [40, 50, 60, 63, 75, 100, 125], '3P/4P', 'A', 'E', 34],
  'PS250-PF': [70, 50, 250, [125, 150, 175, 200, 225, 250], '3P/4P', 'A', 'T', 35],
  'PS250-PE': [70, 50, 250, [125, 150, 175, 200, 225, 250], '3P/4P', 'A', 'E', 35],
  'PS400-GF': [70, 70, 400, [225, 250, 300, 350, 400], '3P/4P', 'A', 'Tadj', 35],
  'PS400-GE': [70, 70, 400, [125, 150, 175, 200, 225, 250, 300, 350, 400], '3P/4P', 'B', 'E', 35],
  'PS630-GF': [70, 70, 600, [500, 600], '3P/4P', 'A', 'Tadj', 36],
  'PS630-GE': [70, 70, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'A', 'E', 36],
  'S800-RF': [70, 50, 800, [700, 800], '3P/4P', 'A', 'Tadj', 36],
  'S800-RE': [70, 50, 800, [350, 400, 450, 500, 600, 700, 800], '3P/4P', 'B', 'E', 36],
  'S800-PF': [100, 50, 800, [700, 800], '3P/4P', 'A', 'Tadj', 36],
  'S800-PE': [100, 50, 800, [350, 400, 450, 500, 600, 700, 800], '3P/4P', 'B', 'E', 36],
  'S1250-GE': [85, 65, 1250, [500, 600, 700, 800, 1000, 1200, 1250], '3P/4P', 'B', 'E', 36],
  'H100-NF': [125, 85, 100, [15, 20, 30, 40, 50, 60, 75, 100], '3P/4P', 'A', 'T', 37],
  'H125-NF': [125, 85, 125, [125], '3P/4P', 'A', 'T', 37],
  'H225-NF': [125, 85, 225, [125, 150, 175, 200, 225], '3P/4P', 'A', 'T', 37],
  'H250-NF': [125, 85, 250, [250], '3P/4P', 'A', 'T', 37],
  'H225-NE': [125, 85, 225, [125, 150, 175, 200, 225], '3P/4P', 'A', 'E', 37],
  'PH400-CF': [110, 110, 400, [225, 250, 300, 350, 400], '3P/4P', 'A', 'Tadj', 37],
  'PH400-CE': [110, 110, 400, [125, 150, 175, 200, 225, 250, 300, 350, 400], '3P/4P', 'B', 'E', 37],
  'H400-NE': [125, 85, 400, [125, 150, 175, 200, 225, 250, 300, 350, 400], '3P/4P', 'B', 'E', 37],
  'PH630-CF': [110, 110, 600, [500, 600], '3P/4P', 'A', 'Tadj', 38],
  'PH630-CE': [110, 110, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'A', 'E', 38],
  'H630-NE': [125, 94, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'B', 'E', 38],
  'H800-NE': [125, 94, 800, [350, 400, 450, 500, 600, 700, 800], '3P/4P', 'B', 'E', 38],
  'TL-1000NE': [125, 65, 1000, [500, 600, 700, 800, 900, 1000], '3P/4P', 'B', 'E', 38],
  'TL-1200NE': [125, 65, 1200, [600, 700, 800, 1000, 1200], '3P/4P', 'B', 'E', 38],
  'L100-NF': [200, 150, 100, [15, 20, 30, 40, 50, 60, 75, 100], '3P/4P', 'A', 'T', 39],
  'L125-NF': [200, 150, 125, [125], '3P/4P', 'A', 'T', 39],
  'L225-NF': [200, 150, 225, [125, 150, 175, 200, 225], '3P/4P', 'A', 'T', 39],
  'L250-NF': [200, 150, 250, [250], '3P/4P', 'A', 'T', 39],
  'L400-NE': [200, 150, 400, [125, 150, 175, 200, 225, 250, 300, 350, 400], '3P/4P', 'B', 'E', 39],
  'L630-NE': [200, 150, 630, [250, 300, 350, 400, 500, 600, 630], '3P/4P', 'B', 'E', 39],
  'L800-NE': [200, 150, 800, [350, 400, 450, 500, 600, 700, 800], '3P/4P', 'B', 'E', 39],
};
const tbpName = (k) => (Object.prototype.hasOwnProperty.call(TB2, k) ? k + ' (PRO)' : k);   // ชื่อซ้ำกับรุ่น TemBreak 2 (ค่าเหมือนกัน) → ต่อท้าย (PRO) เพื่อให้รหัสรุ่นไม่ซ้ำ
const tbpRows = () => B.mccb.filter((m) => m.brandShort === 'Terasaki' && m.series === 'TemBreak PRO');
test('S68 Terasaki TemBreak PRO: 67 รุ่น (Economical 6 · Standard 24 · High-fault level 16 · Current limiting 14 · Current limiting high-fault 7) — Icu/Ics @415 V ตรงตารางหน้า 26–39 (ไม่ใช่แถว 380 V ที่สูงกว่า เช่น S1000-CE 65/50 ที่ 415 V แต่ 85/50 ที่ 380 V)', () => {
  const rs = tbpRows();
  eq(Object.keys(TBP).length, 67);
  eq(rs.map((m) => m.model).sort(), Object.keys(TBP).map(tbpName).sort());
  for (const m of rs) { const w = TBP[m.model.replace(/ \(PRO\)$/, '')]; eq([m.icu, m.ics], [w[0], w[1]], m.id); assert(m.verified && m.src.id === 'TER-TBP-23I68E', m.id); }
  eq([row('Terasaki|S1000-CE').icu, row('Terasaki|S1000-CE').ics], [65, 50]);
  assert(/380 V/.test(row('Terasaki|S1000-CE').src.note) && /85/.test(row('Terasaki|S1000-CE').src.note), 'หมายเหตุต้องบอกค่าที่ 380 V');
  assert(!rs.some((m) => /^XS(2000|2500|3200)/.test(m.model)), 'XS2000–XS3200 ไม่นำเข้า');
});
test('S69 Terasaki TemBreak PRO: AF, ขั้ว (3P เมื่อเอกสารระบุ 2,3 ; 3P/4P เมื่อมี 4), AT ตามแถว Rated current, Util A/B, ชนิด trip ; ไม่ใส่ Ii', () => {
  for (const m of tbpRows()) {
    const w = TBP[m.model.replace(/ \(PRO\)$/, '')];
    eq(m.af, w[2], m.id + ' AF'); eq(m.at, w[3], m.id + ' AT'); eq(m.poles, w[4] === '3P' ? [3] : [3, 4], m.id + ' poles');
    eq(m.util, 'Cat ' + w[5], m.id + ' util'); eq(m.electronic, w[6] === 'E', m.id);
    eq([m.iiMult, m.iiMin, m.selMCB], [null, null, null], m.id);
    assert(m.src.pages.length === 1 && m.src.pages[0] === w[7] && /415 V/.test(m.src.note), `${m.id}: หน้า ${m.src.pages}/หมายเหตุ`);
  }
});
test('S70 Terasaki TemBreak PRO: ทะเบียนแหล่ง (terasaki.co.jp, SHA-256, 632 หน้า, catalogue 23-I68E) และซีรีส์ TemBreak 2 ยังอยู่แยกกัน', () => {
  const s = byId.get('TER-TBP-23I68E');
  assert(s && s.publisher === 'Terasaki Electric' && s.pages === 632 && s.docNo === '23-I68E' && /^[0-9a-f]{64}$/.test(s.sha256) && /^https:\/\/www\.terasaki\.co\.jp\//.test(s.urls[0]) && hostOk(s.urls[0]), 'ทะเบียนแหล่ง TemBreak PRO');
  eq(tbRows().length, 44);
});

/* ---- เชื่อมกับตัวคำนวณ: รุ่นที่ยืนยันใช้งานได้จริง (AT snapping / IC / ป้ายอ้างอิง) ---- */
test('S11 เลือก ComPacT NSX/Tmax XT แล้วคำนวณได้: AT ขยับตามที่แคตตาล็อกมีขาย + ผูกรุ่นสำเร็จ + ไม่มีข้อผิดพลาดภายใน', () => {
  const { E, proj, P, I } = require('./helpers/build.js');
  for (const [ser, brand] of [['ComPacT NSX', 'Schneider'], ['Tmax XT', 'ABB']]) {
    const p = proj({ meta: { supply: 'lv', utility: 'MEA', serviceKA: 10, autoSelectivity: false, brands: { mccb: { brand, series: ser } } }, panels: [P('MDB', 'MDB', null), P('LP1', 'LP', 'MDB', { feederLength: 10 })], items: [I('LP1', { type: 'rec', points: 120 })] });
    const r = E.calculate(p), f = r.panels.find((x) => x.id === 'LP1').feeder;
    assert(f.cb.bm && f.cb.bm.series === ser, `${ser}: ผูกรุ่นไม่สำเร็จ ${JSON.stringify(f.cb.bm && f.cb.bm.id)}`);
    assert(B.mccb.find((m) => m.id === f.cb.bm.id).at.includes(f.cb.at), `${ser}: AT ${f.cb.at} ต้องเป็นขนาดที่รุ่น ${f.cb.bm.id} มีขาย`);
    assert(!r.warnings.some((w) => /ข้อผิดพลาดภายใน/.test(w)), 'ข้อผิดพลาดภายใน');
  }
});

/* ---- แหล่งอ้างอิงต้องไปถึงผู้ใช้: cb.bm → tooltip/popover (brandui.js) → ภาคผนวกรายงาน (export.js) ---- */
const vm = require('vm');
const { E: E2, D: D2, proj: proj2, P: P2, I: I2 } = require('./helpers/build.js');
const calcWith = (brand, series) => E2.calculate(proj2({ meta: { supply: 'lv', utility: 'MEA', serviceKA: 10, autoSelectivity: false, brands: { mccb: { brand, series } } }, panels: [P2('MDB', 'MDB', null), P2('LP1', 'LP', 'MDB', { feederLength: 10 })], items: [I2('LP1', { type: 'rec', points: 120 })] }));
// ซีรีส์ที่ยังไม่ผูกแหล่ง (ใช้เป็นตัวอย่าง 'ไม่ยืนยัน') — เลือกอัตโนมัติจากรายการผู้สมัครเพื่อไม่ต้องแก้เทสต์ทุกครั้งที่ยืนยันซีรีส์เพิ่ม
const UNV = [['Eaton', 'NZM Series'], ['Hager', 'h3 Series'], ['CHINT', 'NM1 Series'], ['LS', 'Susol'], ['Shihlin', 'BM Series'], ['Terasaki', 'TemBreak PRO'], ['Fuji', 'G-TWIN Standard'], ['GE', 'Record Plus']].find(([b, sr]) => B.mccb.some((m) => m.brandShort === b && m.series === sr) && B.mccb.filter((m) => m.brandShort === b && m.series === sr).every((m) => !m.verified));
assert(UNV, 'ต้องเหลืออย่างน้อยหนึ่งซีรีส์ที่ยังไม่ยืนยันไว้เป็นตัวอย่าง');
test('S12 cb.bm พกที่มาของข้อมูล: รุ่นที่ยืนยัน = verified + เลขเอกสาร + หน้า + URL ; รุ่นที่ไม่ยืนยัน = verified false และไม่มี srcDoc', () => {
  const v = calcWith('Schneider', 'ComPacT NSX').panels.find((p) => p.id === 'LP1').feeder.cb.bm;
  assert(v.verified === true && v.srcDoc === 'LVPED221001EN' && v.srcPages.includes(23) && /^https:\/\/www\.se\.com\//.test(v.srcUrl), JSON.stringify(v));
  const u = calcWith(UNV[0], UNV[1]).panels.find((p) => p.id === 'LP1').feeder.cb.bm;
  assert(u && u.verified === false && !u.srcDoc && !u.srcUrl, JSON.stringify(u));
});
test('S13 ภาคผนวกรายงาน: รุ่นที่ยืนยันมีเครื่องหมาย ✔ + เลขเอกสาร + หน้า + URL ต้นทาง ; รุ่นที่ไม่ยืนยันบอกตรง ๆ ว่ายังไม่ผูกแคตตาล็อก', () => {
  const ctx = { LoadEngine: E2, LS_DATA: D2, console }; ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/export.js'), 'utf8'), ctx);
  const R = ctx.Report;
  const a = R.brandRefsHTML(calcWith('Schneider', 'ComPacT NSX'));
  assert(a.includes('✔') && a.includes('LVPED221001EN') && /หน้า 23/.test(a) && a.includes('https://www.se.com/us/en/download/document/LVPED221001EN/') && /ตรวจ.*แคตตาล็อก/.test(a), a.slice(0, 600));
  const b = R.brandRefsHTML(calcWith(UNV[0], UNV[1]));
  assert(!b.includes('✔') && /ยังไม่ผูกแคตตาล็อก/.test(b) && /ตรวจ.*แคตตาล็อก/.test(b), b.slice(0, 600));
});
test('S14 หน้าจอ: tooltip บอกสถานะยืนยัน/ไม่ยืนยัน + เลขเอกสาร/หน้า, popover มีลิงก์ไปเอกสารต้นทาง (เปิดแท็บใหม่แบบปลอดภัย) และเครื่องหมาย ✔ ที่รุ่น, CSS มี .br-ver', () => {
  const u = fs.readFileSync(path.join(__dirname, '../public/js/brandui.js'), 'utf8'), c = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
  assert(/ยืนยันกับแคตตาล็อก/.test(u) && /รวบรวมจากเว็บ — ยังไม่ผูกแคตตาล็อก/.test(u) && /m\.srcDoc/.test(u) && /m\.srcPages/.test(u), 'tooltip');
  assert(/rel="noopener noreferrer"/.test(u) && /target="_blank"/.test(u) && /cur\.src\.url/.test(u) && /\$\{m\.verified \? '✔ ' : ''\}/.test(u), 'popover');
  assert(/\.br-ver \{/.test(c), 'CSS');
});

done();
