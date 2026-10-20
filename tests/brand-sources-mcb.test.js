// ที่มาของข้อมูล MCB/RCBO (ต่อจาก tests/brand-sources.test.js ที่ตรวจ MCCB): รุ่นที่ "ยืนยันกับแคตตาล็อก" ต้องผูกเอกสารต้นทาง (Source_ID → data/brands/sources.json) + หน้า + หมายเหตุวิธีได้ค่า
// ค่า golden ด้านล่างพิมพ์จากหน้า PDF ฉบับทางการของผู้ผลิต 4 ราย (Schneider, ABB, Mitsubishi, Fuji) ตามเลขหน้าที่ระบุ — ไม่ได้มาจาก CSV
// รัน: node tests/brand-sources-mcb.test.js
const fs = require('fs');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const B = require('../public/js/brands.js');
const BR = require('../public/js/brandcb.js');
const Tool = require('../tools/import-brands.js');
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/brands/sources.json'), 'utf8'));

const OFFICIAL = ['se.com', 'schneider-electric.com', 'abb.com', 'mitsubishielectric.com', 'fujielectric.com'];
const hostOk = (u) => { try { const h = new URL(u).hostname; return OFFICIAL.some((d) => h === d || h.endsWith('.' + d)); } catch (e) { return false; } };
const byId = new Map(SRC.sources.map((s) => [s.id, s]));
const ver = B.mcb.filter((m) => m.verified);
const row = (id) => B.mcb.find((m) => m.id === id);
const AT = [6, 10, 16, 20, 25, 32, 40, 50, 63];   // ขนาดที่ตัวคำนวณใช้ (ขนาด 0.5–4, 8, 13 A มีในแคตตาล็อกแต่ไม่ใส่ในรายการ AT)
const AT40 = [6, 10, 16, 20, 25, 32, 40];
const P4 = [1, 2, 3, 4];

/* golden: id → [kind, Icn kA, Icu kA (null = เอกสารไม่ให้), curve, magMin ×In, magMax ×In, AT, ขั้ว, rcdMA, RCD types, Source_ID, หน้า PDF]
   Schneider: iC60N/H/L = CA909006E หน้า 9–11 (Icu/Icn ตาราง) + 13 (Magnetic tripping C 8 In ±20 %, D 12 In ±20 % → 6.4–9.6, 9.6–14.4) ; iDPN Vigi = Acti9 RCBO catalogue หน้า PDF 2–4 (Icn 6000/10000 A, B 3–5 In, C 5–10 In) */
const G = {
  'Schneider|iC60N': ['MCB', 6, 10, 'Type C', 6.4, 9.6, AT, P4, null, [], 'SE-CA909006E', [9, 13]],
  'Schneider|iC60N D': ['MCB', 6, 10, 'Type D', 9.6, 14.4, AT, P4, null, [], 'SE-CA909006E', [9, 13]],
  'Schneider|iC60H': ['MCB', 10, 15, 'Type C', 6.4, 9.6, AT, [1, 3], null, [], 'SE-CA909006E', [10, 13]],
  'Schneider|iC60L 6-25A': ['MCB', 15, 25, 'Type C', 6.4, 9.6, [6, 10, 16, 20, 25], P4, null, [], 'SE-CA909006E', [11, 13]],
  'Schneider|iC60L 32-40A': ['MCB', 15, 20, 'Type C', 6.4, 9.6, [32, 40], P4, null, [], 'SE-CA909006E', [11, 13]],
  'Schneider|iDPN N Vigi': ['RCBO', 6, null, 'Type C', 5, 10, AT40, [1], 30, ['AC', 'A'], 'SE-ACTI9-RCBO-ID', [2, 4]],
  'Schneider|iDPN N Vigi B': ['RCBO', 6, null, 'Type B', 3, 5, AT40, [1], 30, ['AC', 'A'], 'SE-ACTI9-RCBO-ID', [2, 4]],
  'Schneider|iDPN H Vigi': ['RCBO', 10, null, 'Type C', 5, 10, [6, 10, 16, 20, 25, 32], [1], 30, ['A'], 'SE-ACTI9-RCBO-ID', [3, 4]],
  'Schneider|iDPN H Vigi B': ['RCBO', 10, null, 'Type B', 3, 5, [6, 10, 16, 20, 25, 32], [1], 30, ['A'], 'SE-ACTI9-RCBO-ID', [3, 4]],
  /* ABB: ตารางเลือกรุ่น หน้า 8 (Icn @230/400 V, Icu @400 V) + หน้า 20 (S 200 / S 200 M) + หน้ารายการสั่งซื้อของแต่ละเส้นโค้ง (B 26 / C 28 / D 31 ; M: B 40 / C 42 / D 45 ; P: B 65 / C 67 / D 70) ;
     ตัวคูณแม่เหล็ก B 3–5, C 5–10, D 10–20 × In มาจาก 2CDC400002D0201 หน้า 8 ; DS201 = data sheet หน้า 2–3 */
  'ABB|S200': ['MCB', 6, 10, 'Type C', 5, 10, AT, P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 28]],
  'ABB|S200 B': ['MCB', 6, 10, 'Type B', 3, 5, AT, P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 26]],
  'ABB|S200 D': ['MCB', 6, 10, 'Type D', 10, 20, AT, P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 31]],
  'ABB|S200M': ['MCB', 10, 15, 'Type C', 5, 10, AT, P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 42]],
  'ABB|S200M B': ['MCB', 10, 15, 'Type B', 3, 5, [10, 16, 20, 25, 32, 40, 50, 63], P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 40]],   // 6 A มีเฉพาะ 1P/2P
  'ABB|S200M D': ['MCB', 10, 15, 'Type D', 10, 20, AT, P4, null, [], 'ABB-2CHC419005C0201', [8, 20, 45]],
  'ABB|S200P 6-25A': ['MCB', 25, 25, 'Type C', 5, 10, [6, 10, 16, 20, 25], P4, null, [], 'ABB-2CHC419005C0201', [8, 67]],
  'ABB|S200P B 6-25A': ['MCB', 25, 25, 'Type B', 3, 5, [6, 10, 16, 20, 25], P4, null, [], 'ABB-2CHC419005C0201', [8, 65]],
  'ABB|S200P D 6-25A': ['MCB', 25, 25, 'Type D', 10, 20, [6, 10, 16, 20, 25], P4, null, [], 'ABB-2CHC419005C0201', [8, 70]],
  'ABB|S200P 32-63A': ['MCB', 15, 15, 'Type C', 5, 10, [32, 40, 50, 63], P4, null, [], 'ABB-2CHC419005C0201', [8, 67]],
  'ABB|S200P B 32-63A': ['MCB', 15, 15, 'Type B', 3, 5, [32, 40, 50, 63], P4, null, [], 'ABB-2CHC419005C0201', [8, 65]],
  'ABB|S200P D 32-63A': ['MCB', 15, 15, 'Type D', 10, 20, [32, 40, 50, 63], P4, null, [], 'ABB-2CHC419005C0201', [8, 70]],
  'ABB|DS201 L': ['RCBO', 4.5, 6, 'Type C', 5, 10, [6, 10, 16, 20, 25, 32], [1], 30, ['AC', 'A'], 'ABB-9AKK107492A6187', [2]],
  'ABB|DS201': ['RCBO', 6, 10, 'Type C', 5, 10, AT40, [1], 30, ['AC', 'A'], 'ABB-9AKK107492A6187', [2, 3]],
  'ABB|DS201 B': ['RCBO', 6, 10, 'Type B', 3, 5, AT40, [1], 30, ['AC', 'A'], 'ABB-9AKK107492A6187', [2, 3]],
  'ABB|DS201 M': ['RCBO', 10, 15, 'Type C', 5, 10, AT40, [1], 30, ['AC', 'A', 'F'], 'ABB-9AKK107492A6187', [2, 3]],
  'ABB|DS201 M B': ['RCBO', 10, 15, 'Type B', 3, 5, AT40, [1], 30, ['AC', 'A', 'F'], 'ABB-9AKK107492A6187', [2, 3]],
  /* Mitsubishi DIN Series Y-0713B 2209: หน้า PDF 8 (line-up) + 10 (Specifications MCB, พิมพ์ 7) + 11 (RCBO, พิมพ์ 8) — Icn ตาม IEC 60898-1 / 61009-1 ; ไม่มี Icu ; หมายเหตุ *2 : B 3–5, C 5–10, D 10–20 × In */
  'Mitsubishi|BH-D6': ['MCB', 6, null, 'Type C', 5, 10, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BH-D6 B': ['MCB', 6, null, 'Type B', 3, 5, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BH-D6 D': ['MCB', 6, null, 'Type D', 10, 20, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BH-D10': ['MCB', 10, null, 'Type C', 5, 10, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BH-D10 B': ['MCB', 10, null, 'Type B', 3, 5, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BH-D10 D': ['MCB', 10, null, 'Type D', 10, 20, AT, P4, null, [], 'MIT-Y0713B2209', [8, 10]],
  'Mitsubishi|BV-DN': ['RCBO', 4.5, null, 'Type C', 5, 10, AT40, [1], 30, ['AC'], 'MIT-Y0713B2209', [8, 11]],
  'Mitsubishi|BV-DN6': ['RCBO', 6, null, 'Type C', 5, 10, AT40, [1], 30, ['AC'], 'MIT-Y0713B2209', [8, 11]],
  /* Fuji BCL series 62D1-E-0287a: MCB BCL63E0 (6 kA) / BCL63H0 (10 kA) หน้า 4–5 ; RCBO add-on BCL63E0□L หน้า 9–10 (6–63 A, type AC) ; BCL40H0□L-2P หน้า 12–13 (10 kA, 6–40 A, B/C) — Icn ตาม IEC 60898-1 / 61009-1 */
  'Fuji|BCL63E0': ['MCB', 6, null, 'Type C', 5, 10, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63E0 B': ['MCB', 6, null, 'Type B', 3, 5, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63E0 D': ['MCB', 6, null, 'Type D', 10, 20, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63H0': ['MCB', 10, null, 'Type C', 5, 10, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63H0 B': ['MCB', 10, null, 'Type B', 3, 5, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63H0 D': ['MCB', 10, null, 'Type D', 10, 20, AT, P4, null, [], 'FUJ-62D1-E-0287A', [4, 5]],
  'Fuji|BCL63E0L': ['RCBO', 6, null, 'Type C', 5, 10, AT, [1], 30, ['AC'], 'FUJ-62D1-E-0287A', [9, 10]],
  'Fuji|BCL63E0L B': ['RCBO', 6, null, 'Type B', 3, 5, AT, [1], 30, ['AC'], 'FUJ-62D1-E-0287A', [9, 10]],
  'Fuji|BCL63E0L D': ['RCBO', 6, null, 'Type D', 10, 20, AT, [1], 30, ['AC'], 'FUJ-62D1-E-0287A', [9, 10]],
  'Fuji|BCL40H0L': ['RCBO', 10, null, 'Type C', 5, 10, AT40, [1], 30, ['AC'], 'FUJ-62D1-E-0287A', [12, 13]],
  'Fuji|BCL40H0L B': ['RCBO', 10, null, 'Type B', 3, 5, AT40, [1], 30, ['AC'], 'FUJ-62D1-E-0287A', [12, 13]]
};
const G_IDS = Object.keys(G);
const brandOf = (id) => id.split('|')[0];

/* ================= 1) ทะเบียนแหล่ง ================= */
test('M1 sources.json: เอกสารใหม่ 7 ฉบับ (Schneider ×2, ABB ×3, Mitsubishi, Fuji) มีเลขเอกสาร/ผู้จัดทำ/ฉบับ/URL https ของผู้ผลิต/SHA-256/ขนาด/วันที่/จำนวนหน้า', () => {
  const want = {
    'SE-CA909006E': ['CA909006E', 'Schneider Electric', 112],
    'SE-ACTI9-RCBO-ID': ['Acti9_RCBO_Katalog_Indonesia', 'Schneider Electric', 4],
    'ABB-2CHC419005C0201': ['2CHC419005C0201', 'ABB', 188],
    'ABB-2CDC400002D0201': ['2CDC400002D0201', 'ABB', 10],
    'ABB-9AKK107492A6187': ['9AKK107492A6187', 'ABB', 18],
    'MIT-Y0713B2209': ['Y-0713B 2209', 'Mitsubishi Electric', 20],
    'FUJ-62D1-E-0287A': ['62D1-E-0287a', 'Fuji Electric', 20]
  };
  for (const [id, [doc, pub, pages]] of Object.entries(want)) {
    const s = byId.get(id);
    assert(s, `ไม่พบแหล่ง ${id}`);
    eq([s.docNo, s.publisher, s.pages], [doc, pub, pages], id);
    for (const k of ['title', 'edition']) assert(typeof s[k] === 'string' && s[k].trim().length > 3, `${id}: ขาด ${k}`);
    assert(s.urls.length >= 1 && s.urls.every((u) => /^https:\/\//.test(u) && hostOk(u)), `${id}: URL ${JSON.stringify(s.urls)}`);
    assert(/^[0-9a-f]{64}$/.test(s.sha256) && s.bytes > 1e5 && /^\d{4}-\d{2}-\d{2}$/.test(s.accessed), `${id}: sha256/ขนาด/วันที่`);
  }
  eq(new Set(SRC.sources.map((s) => s.id)).size, SRC.sources.length);
});

/* ================= 2) โครงสร้างข้อมูลที่ยืนยัน ================= */
test('M2 ทุกแถว MCB/RCBO ที่ยืนยัน: Source_ID มีจริง, หน้าอยู่ในช่วงเอกสาร, มีหมายเหตุวิธีได้ค่า, ref ระบุเลขเอกสาร+หน้า ; แถวที่ไม่ผูกแหล่งต้องไม่มี src ; จำนวนใน meta ตรง', () => {
  eq(ver.length, G_IDS.length);
  for (const m of ver) {
    const s = byId.get(m.src.id);
    assert(s, `${m.id}: ไม่พบแหล่ง ${m.src.id}`);
    assert(m.src.pages.length >= 1 && m.src.pages.every((p) => Number.isInteger(p) && p >= 1 && p <= s.pages), `${m.id}: หน้า ${JSON.stringify(m.src.pages)} นอกช่วง 1..${s.pages}`);
    assert(m.src.note && m.src.note.length > 40, `${m.id}: ขาดหมายเหตุ`);
    assert(m.src.url === s.urls[0] && m.src.doc === s.docNo, `${m.id}: url/doc ต้องมาจากแหล่ง`);
    assert(m.ref.includes(s.docNo) && /p\.\d/.test(m.ref), `${m.id}: ref ต้องมีเลขเอกสารและหน้า: ${m.ref}`);
  }
  assert(B.mcb.filter((m) => !m.verified).every((m) => !m.src), 'แถวที่ไม่ผูกแหล่งต้องไม่มี src');
  eq(B.meta.counts.mcbVerified, ver.length);
  eq(B.meta.counts.mcb + B.meta.counts.rcbo, B.mcb.length);
});

/* ================= 3) ค่า golden รายรุ่น ================= */
test('M3 ชุดรุ่นที่ยืนยัน = ตาม golden (Schneider 9 · ABB 17 · Mitsubishi 8 · Fuji 11 = 45 รุ่น ; MCB 29 + RCBO 16) และแต่ละรุ่นตรงตารางในแคตตาล็อก', () => {
  eq(ver.map((m) => m.id).sort(), G_IDS.slice().sort());
  eq(ver.filter((m) => m.kind === 'MCB').length + ':' + ver.filter((m) => m.kind === 'RCBO').length, '29:16');
  for (const id of G_IDS) {
    const m = row(id), w = G[id];
    assert(m, `ไม่พบ ${id}`);
    eq([m.kind, m.icn, m.icu, m.curve, m.magMin, m.magMax], [w[0], w[1], w[2], w[3], w[4], w[5]], id);
    eq(m.at, w[6], id + ' AT'); eq(m.poles, w[7], id + ' poles');
    eq([m.rcdMA, m.rcdTypes], [w[8], w[9]], id + ' RCD');
    assert(m.src.id === w[10] && w[11].length === m.src.pages.length && w[11].every((p) => m.src.pages.includes(p)), `${id}: แหล่ง ${m.src.id} หน้า ${m.src.pages} (ต้อง ${w[10]} ${w[11]})`);
  }
});
test('M4 ความสมเหตุสมผลทางกายภาพ: Icu (ถ้ามี) ≥ Icn, เส้นโค้งสอดคล้องกับตัวคูณแม่เหล็ก (B 3–5, C 5–10, D 10–20 ± ค่าเผื่อที่แคตตาล็อกพิมพ์), AT เรียงและ ≤ 63 A, RCBO = 1P+N 30 mA ชนิด AC/A/F/B', () => {
  const band = { 'Type B': [3, 5], 'Type C': [5, 10], 'Type D': [10, 20] };
  for (const m of ver) {
    assert(m.icn > 0 && (m.icu == null || m.icu >= m.icn), `${m.id}: Icn/Icu`);
    const [lo, hi] = band[m.curve];
    assert(m.magMin >= lo * 0.96 - 1e-9 && m.magMax <= hi * 1.0 + 1e-9 && m.magMin < m.magMax, `${m.id}: ${m.curve} ${m.magMin}–${m.magMax}`);
    assert(m.at.every((a, i) => a > 0 && a <= 63 && (!i || a > m.at[i - 1])), `${m.id}: AT ${m.at}`);
    assert(/60898-1/.test(m.std) || m.kind === 'RCBO', `${m.id}: std ${m.std}`);
    if (m.kind === 'RCBO') assert(/61009-1/.test(m.std) && m.withN && m.rcdMA === 30 && m.rcdTypes.length && m.rcdTypes.every((t) => ['AC', 'A', 'F', 'B'].includes(t)), `${m.id}: RCBO`);
    else assert(!m.withN && m.rcdMA == null && m.rcdTypes.length === 0 && m.poles.includes(3), `${m.id}: MCB`);
  }
});
test('M5 หมายเหตุวิธีได้ค่า: บอกว่า Icn/Icu ได้จากตารางใด, ขนาด AT ที่ตัดออก และ (ABB) เอกสารเสริมของตัวคูณแม่เหล็ก ; Mitsubishi/Fuji บอกว่าเอกสารไม่ระบุ Icu', () => {
  for (const m of ver) {
    assert(/Icn/.test(m.src.note) && /AT/.test(m.src.note), `${m.id}: หมายเหตุ`);
    if (m.icu == null) assert(/ไม่ระบุ Icu/.test(m.src.note), `${m.id}: ต้องบอกว่าไม่ระบุ Icu`);
    if (brandOf(m.id) === 'ABB' && m.kind === 'MCB') assert(m.src.note.includes('ABB-2CDC400002D0201') && /หน้า 8/.test(m.src.note), `${m.id}: ต้องอ้างเอกสารเสริมสำหรับตัวคูณแม่เหล็ก`);
    if (brandOf(m.id) === 'Schneider' && m.kind === 'MCB') assert(/8 In/.test(m.src.note) && /20 ?%/.test(m.src.note), `${m.id}: ต้องบอก 8 In ± 20 % (C) / 12 In ± 20 % (D)`);
  }
  assert(row('ABB|DS201').src.note.includes('4500') && /32 A/.test(row('ABB|DS201').src.note), 'DS201: I∆m 4500 A ที่ 32/40 A');
  assert(/APR/.test(row('ABB|DS201 M').src.note), 'DS201 M: ชนิด APR/F');
});

/* ================= 4) ผลต่อผู้ใช้ ================= */
test('M6 แถวเดิมที่ไม่มีในแคตตาล็อกถูกแทนที่ (Fuji BC1E/BR1E, ABB S200M / S200 และ DS201C / DSE201, Schneider iDPN N Vigi / iC60 RCBO) ; Mitsubishi BV-DN ที่เคยบันทึก 6 kA ตอนนี้เป็น 4.5 kA ตามตาราง', () => {
  for (const id of ['Fuji|BC1E', 'Fuji|BR1E', 'ABB|S200M / S200', 'ABB|DS201C / DSE201', 'Schneider|iDPN N Vigi / iC60 RCBO']) assert(!row(id), `${id} ยังอยู่`);
  eq(row('Mitsubishi|BV-DN').icn, 4.5);
  // แถวที่ยังไม่ยืนยัน (Easy9, SH200 และยี่ห้ออื่น) คงเดิมและยังติดป้ายไม่ยืนยัน
  for (const id of ['Schneider|EZ9F', 'Schneider|EZ9D', 'ABB|SH200T / SH200', 'Siemens|5SL6 / 5SY6', 'Hager|MBN / MCN']) assert(row(id) && !row(id).verified, `${id}`);
  eq(B.mcb.filter((m) => !m.verified).length, 18);
});
test('M7 ครบทั้ง 4 ยี่ห้อ: มี MCB ≥ 10 kA (Icn) และ RCBO ≥ 10 kA ยกเว้น Mitsubishi ที่แคตตาล็อกให้ RCBO สูงสุด 6 kA (BV-DN6) ; RCBO 50–63 A มีเฉพาะ Fuji BCL63E0L', () => {
  const maxIcn = (b, kind) => Math.max(...ver.filter((m) => brandOf(m.id) === b && m.kind === kind).map((m) => m.icn));
  eq(['Schneider', 'ABB', 'Mitsubishi', 'Fuji'].map((b) => maxIcn(b, 'MCB')), [15, 25, 10, 10]);
  eq(['Schneider', 'ABB', 'Mitsubishi', 'Fuji'].map((b) => maxIcn(b, 'RCBO')), [10, 10, 6, 10]);
  const big = ver.filter((m) => m.kind === 'RCBO' && m.at.some((a) => a >= 50)).map((m) => brandOf(m.id));
  eq([...new Set(big)], ['Fuji']);
  for (const b of ['Schneider', 'ABB', 'Mitsubishi']) assert(ver.filter((m) => brandOf(m.id) === b && m.kind === 'RCBO').every((m) => Math.max(...m.at) === (m.id.includes('H Vigi') || m.id === 'ABB|DS201 L' ? 32 : 40)), `${b}: RCBO สูงสุด 32/40 A`);
});
test('M8 ตัวเลือกรุ่นของตัวคำนวณ (Ik" 6.3 kA ที่แผงห้องชุด): Schneider/ABB/Mitsubishi/Fuji ได้ MCB 10 kA ; RCBO 10 kA ยกเว้น Mitsubishi (6 kA → ยังเตือน) ; RCBO 50 A ได้เฉพาะ Fuji', () => {
  const ctx = (brand, series) => BR.context({ brands: { mcb: { brand, series } } }, null);
  const pk = (c, type, at, ik) => c.pick(type, at, 1, ik).model;
  const S = ctx('Schneider', 'Acti9'), A = ctx('ABB', 'System pro M compact'), M = ctx('Mitsubishi', 'DIN Series'), F = ctx('Fuji', 'BCL Series');
  eq([pk(S, 'MCB', 16, 6.3).id, pk(S, 'RCBO', 32, 6.3).id], ['Schneider|iC60H', 'Schneider|iDPN H Vigi']);
  eq([pk(A, 'MCB', 16, 6.3).id, pk(A, 'RCBO', 32, 6.3).id], ['ABB|S200M', 'ABB|DS201 M']);
  eq([pk(M, 'MCB', 16, 6.3).id, pk(M, 'RCBO', 32, 6.3).id], ['Mitsubishi|BH-D10', 'Mitsubishi|BV-DN6']);
  eq([pk(F, 'MCB', 16, 6.3).id, pk(F, 'RCBO', 32, 6.3).id], ['Fuji|BCL63H0', 'Fuji|BCL40H0L']);
  eq(BR.ratingOf(pk(M, 'RCBO', 32, 6.3)), 6);
  // วงจรชาร์จ EV 1 เฟส 50 A: มี RCBO เฉพาะ Fuji (BCL63E0L 6 kA ชนิด AC) — อีกสามยี่ห้อไม่มีรุ่น 50 A
  eq(pk(F, 'RCBO', 50, 3).id, 'Fuji|BCL63E0L');
  for (const c of [S, A, M]) { const r = c.pick('RCBO', 50, 1, 3); assert(!r.model && (r.notOffered || r.none), JSON.stringify(r)); }
  // Ik" ต่ำ: เลือกรุ่นมาตรฐาน Type C ตัวแรก (เส้นโค้ง B/D ต้องมาหลังเสมอ ไม่ถูกเลือกเอง)
  for (const [c, id] of [[S, 'Schneider|iC60N'], [A, 'ABB|S200'], [M, 'Mitsubishi|BH-D6'], [F, 'Fuji|BCL63E0']]) eq(pk(c, 'MCB', 16, 3).id, id);
});

/* ================= 5) ตัวสร้าง brands.js (tools/import-brands.js) ================= */
const HEAD = ['Brand', 'Device_Type', 'Series', 'Sub_Model', 'Standard_Ref', 'Trip_Curve', 'Available_AT_List', 'Poles', 'Icn_60898_kA', 'Icu_60947_kA', 'Energy_Limiting_Class', 'Magnetic_Trip_Min_Mult', 'Magnetic_Trip_Max_Mult', 'RCD_Sensitivity_mA', 'RCD_Type', 'Official_PDF_Datasheet_Ref', 'Source_ID', 'Source_Page', 'Source_Note'];
const mk = (o) => Object.assign({ Brand: 'Fuji Electric', Device_Type: 'MCB', Series: 'T', Sub_Model: 'X1', Standard_Ref: 'IEC 60898-1', Trip_Curve: 'Type C', Available_AT_List: '6|10', Poles: '1P/2P/3P/4P', Icn_60898_kA: '6', Icu_60947_kA: '', Energy_Limiting_Class: 'N/A', Magnetic_Trip_Min_Mult: '5', Magnetic_Trip_Max_Mult: '10', RCD_Sensitivity_mA: 'N/A', RCD_Type: 'N/A', Official_PDF_Datasheet_Ref: 'doc p.1', Source_ID: 'FUJ-62D1-E-0287A', Source_Page: '4', Source_Note: 'หมายเหตุทดสอบ Icn AT ไม่ระบุ Icu' }, o);
const build = (rows) => Tool.buildMCB(rows, [], SRC.sources);
const err = (rows) => { try { build(rows); } catch (e) { return e.message; } return ''; };
test('M9 importer: แถวที่ยืนยันเว้น Icu ได้ (icu = null) แต่ต้องมี Source_Page + Source_Note ; Source_ID ที่ไม่มีใน sources.json = error ; แถวที่ไม่ยืนยันยังต้องมี Icu', () => {
  const [ok] = build([mk({})]);
  eq([ok.verified, ok.icu, ok.icn, ok.src.id, ok.src.pages], [true, null, 6, 'FUJ-62D1-E-0287A', [4]]);
  assert(/Source_Page/.test(err([mk({ Source_Page: '' })])), 'ต้องมี Source_Page');
  assert(/Source_Page/.test(err([mk({ Source_Page: '999' })])), 'หน้านอกช่วง');
  assert(/NOPE/.test(err([mk({ Source_ID: 'NOPE' })])), 'Source_ID ไม่มีใน sources.json');
  assert(/Icu/.test(err([mk({ Source_ID: '', Source_Page: '', Source_Note: '' })])), 'แถวไม่ยืนยันต้องมี Icu');
  eq(build([mk({ Source_ID: '', Source_Page: '', Source_Note: '', Icu_60947_kA: '10' })])[0].verified, false);
});
test('M10 importer: ชนิด RCD "AC / A / A-SI" → [AC, A] (ตัดซ้ำ) ; แถวที่ยืนยันกำหนด Magnetic_Trip ได้ทศนิยม (6.4–9.6) ; ตัวคูณแม่เหล็กห้ามว่าง', () => {
  const r = build([mk({ Device_Type: 'RCBO', Poles: '1P+N', RCD_Sensitivity_mA: '30', RCD_Type: 'AC / A / A-SI', Magnetic_Trip_Min_Mult: '6.4', Magnetic_Trip_Max_Mult: '9.6' })])[0];
  eq([r.kind, r.rcdTypes, r.rcdMA, r.magMin, r.magMax, r.withN], ['RCBO', ['AC', 'A'], 30, 6.4, 9.6, true]);
  assert(/Magnetic_Trip/.test(err([mk({ Magnetic_Trip_Min_Mult: '' })])), 'ต้องมี Magnetic_Trip');
});
test('M11 mcb.csv: 19 คอลัมน์ (16 เดิม + Source_ID/Source_Page/Source_Note) และจำนวนแถวตรงกับ brands.js', () => {
  const rows = Tool.parseCSV(fs.readFileSync(path.join(__dirname, '../data/brands/mcb.csv'), 'utf8'));
  eq(rows[0].map((h) => h.trim()), HEAD);
  assert(rows.every((r) => r.length === 19), 'จำนวนคอลัมน์');
  eq(rows.length - 1, B.mcb.length);
});

/* ================= 6) หน้าจอ ================= */
test('M12 tooltip รุ่น MCB ที่ไม่มี Icu ในแคตตาล็อก (Mitsubishi/Fuji) ไม่แสดง "Icu null/undefined" แต่บอกว่าไม่ระบุ', () => {
  const u = fs.readFileSync(path.join(__dirname, '../public/js/brandui.js'), 'utf8');
  assert(/m\.icu != null/.test(u) && /Icu ไม่ระบุในแคตตาล็อก/.test(u), 'brandui.js ต้องจัดการ Icu ว่าง');
});

done();
