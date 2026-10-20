#!/usr/bin/env node
// สร้าง public/js/brands.js (ฐานข้อมูลเบรกเกอร์ตามยี่ห้อ โหลดออฟไลน์แบบเดียวกับ data.js) จาก CSV ใน data/brands/
// ใช้:  node tools/import-brands.js                       → อ่าน data/brands/mccb.csv + data/brands/mcb.csv
//       node tools/import-brands.js <mccb.csv> <mcb.csv>  → คัดลอกไฟล์ใหม่ลง data/brands/ ก่อน แล้วสร้าง brands.js
// ข้อมูลส่วนใหญ่รวบรวมจากการค้นเว็บ (ไม่ใช่ตารางแคตตาล็อกโดยตรง) — ทุกจุดที่ใช้ในโปรแกรมต้องติดป้าย "ข้อมูลผู้ผลิต — ตรวจกับแคตตาล็อก"
// ยกเว้นรุ่นที่มี Source_ID (คอลัมน์ทางเลือก → data/brands/sources.json): อ่านค่าจากเอกสารทางการตามหน้าที่ระบุใน Source_Page + หมายเหตุวิธีได้ค่าใน Source_Note
//   รุ่นเหล่านี้ใส่ Ii_Default_Mult/Min_Ii_Amp_Num ได้เฉพาะเมื่อแคตตาล็อกให้ค่าตายตัว/ค่าต่ำสุด (เป็นคู่เสมอ) และเว้น Max_Selectivity_vs_MCB_kA ว่าง — ห้ามเดาตัวเลข
// คอลัมน์ข้อความอิสระ (Im_or_Ii_Multiple, Min_Fixed_Ii_Amp, Selectivity_Ratio_Rule, Ir_Range_Multiple) เก็บเป็นข้อความแสดงผลเท่านั้น
// mcb.csv (MCB/RCBO) ใช้คอลัมน์ Source_ID/Source_Page/Source_Note แบบเดียวกัน ; รุ่นที่ยืนยันเว้น Icu_60947_kA ได้ถ้าแคตตาล็อกไม่ให้ (เก็บเป็น null) แต่ Icn และตัวคูณแม่เหล็กต้องมี
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'brands');
const OUT = path.join(ROOT, 'public', 'js', 'brands.js');
const MCCB_COLS = ['Brand', 'Series', 'Sub_Model', 'Tier_Category', 'Frame_Size_AF', 'Available_AT_List', 'Poles', 'Icu_400V_kA', 'Ics_Percent', 'Util_Category', 'Trip_Unit_Type', 'Trip_Unit_Model', 'Ir_Range_Multiple', 'Im_or_Ii_Multiple', 'Min_Fixed_Ii_Amp', 'Selectivity_Ratio_Rule', 'Official_PDF_Datasheet_Ref', 'Ii_Default_Mult', 'Min_Ii_Amp_Num', 'Max_Selectivity_vs_MCB_kA'];
const SRC_COLS = ['Source_ID', 'Source_Page', 'Source_Note'];   // ทางเลือก: มีเฉพาะรุ่นที่ยืนยันกับแคตตาล็อก
const MCB_COLS = ['Brand', 'Device_Type', 'Series', 'Sub_Model', 'Standard_Ref', 'Trip_Curve', 'Available_AT_List', 'Poles', 'Icn_60898_kA', 'Icu_60947_kA', 'Energy_Limiting_Class', 'Magnetic_Trip_Min_Mult', 'Magnetic_Trip_Max_Mult', 'RCD_Sensitivity_mA', 'RCD_Type', 'Official_PDF_Datasheet_Ref'];

// CSV แบบ RFC 4180 (มีเครื่องหมายคำพูด, "" ในช่อง) — ไม่พึ่งแพ็กเกจภายนอก
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
function table(file, cols) {
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  const head = rows[0].map((h) => h.trim());
  const miss = cols.filter((c) => !head.includes(c));
  if (miss.length) throw new Error(`${path.basename(file)}: ไม่พบคอลัมน์ ${miss.join(', ')}`);
  return rows.slice(1).map((r, i) => {
    if (r.length !== head.length) throw new Error(`${path.basename(file)} แถว ${i + 2}: มี ${r.length} ช่อง (ต้องมี ${head.length})`);
    return Object.fromEntries(head.map((h, k) => [h, String(r[k]).trim()]));
  });
}

const numOf = (s) => { const t = String(s).replace(/%$/, '').trim(); const v = Number(t); return t !== '' && Number.isFinite(v) ? v : null; };
const atList = (s) => String(s).split('|').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
// "3P/4P" → [3,4] ; "1P/2P/3P/4P" → [1,2,3,4] ; "1P+N" → [1] (มีขั้วนิวทรัล)
const polesOf = (s) => String(s).split('/').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 4);
// ชื่อยี่ห้อแบบสั้นสำหรับป้าย: ตัดวงเล็บและคำว่า Electric ท้ายชื่อ ("Eaton (Moeller)" → "Eaton", "LS Electric" → "LS")
const shortBrand = (b) => String(b).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+Electric$/i, '').trim();
const isElectronic = (t) => /^Electronic/i.test(t);   // "Thermal-Magnetic / Electronic" = มีทั้งสองแบบ → ถือเป็น TM (กรณีแย่กว่า)

// อ่านทะเบียนแหล่งข้อมูล (data/brands/sources.json) — รุ่นที่ใส่ Source_ID ต้องอ้างแหล่งในนี้
function loadSources() {
  const f = path.join(DIR, 'sources.json');
  if (!fs.existsSync(f)) return [];
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!j || !Array.isArray(j.sources)) throw new Error('sources.json: ต้องมี sources[]');
  return j.sources;
}

function buildMCCB(rows, issues, sources) {
  const seen = new Set();
  const srcOf = new Map((sources || []).map((s) => [s.id, s]));
  return rows.map((r, i) => {
    const line = i + 2;
    const brandShort = shortBrand(r.Brand);
    const id = `${brandShort}|${r.Sub_Model}`;
    if (seen.has(id)) throw new Error(`MCCB แถว ${line}: รหัสรุ่นซ้ำ ${id}`);
    seen.add(id);
    const at = atList(r.Available_AT_List), af = numOf(r.Frame_Size_AF), icu = numOf(r.Icu_400V_kA), pct = numOf(r.Ics_Percent);
    const iiMult = numOf(r.Ii_Default_Mult), iiMin = numOf(r.Min_Ii_Amp_Num), selMCB = numOf(r.Max_Selectivity_vs_MCB_kA);
    const sid = String(r.Source_ID || '').trim(), verified = !!sid;
    let src = null;
    if (verified) {
      const s = srcOf.get(sid);
      if (!s) throw new Error(`MCCB แถว ${line} (${id}): ไม่พบ Source_ID ${sid} ใน sources.json`);
      const pages = String(r.Source_Page || '').split(/[;,]/).map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x >= 1 && x <= s.pages);
      if (!pages.length || !String(r.Source_Note || '').trim()) throw new Error(`MCCB แถว ${line} (${id}): รุ่นที่ยืนยันต้องมี Source_Page (1–${s.pages}) และ Source_Note`);
      src = { id: sid, doc: s.docNo, url: s.urls[0], pages, note: String(r.Source_Note).trim() };
    }
    const o = {
      id, brand: r.Brand, brandShort, series: r.Series, model: r.Sub_Model, tier: r.Tier_Category,
      af, at, poles: polesOf(r.Poles), icu, icsPct: pct, ics: icu != null && pct != null ? Math.round(icu * pct) / 100 : null,
      util: r.Util_Category, trip: r.Trip_Unit_Type, electronic: isElectronic(r.Trip_Unit_Type), tripModel: r.Trip_Unit_Model,
      iiMult, iiMin, selMCB, verified,
      // ข้อความอิสระ — แสดงใน tooltip เท่านั้น
      irText: r.Ir_Range_Multiple, iiText: r.Im_or_Ii_Multiple, iiMinText: r.Min_Fixed_Ii_Amp, selRule: r.Selectivity_Ratio_Rule,
      ref: r.Official_PDF_Datasheet_Ref
    };
    if (src) o.src = src;
    const bad = [];
    if (!af) bad.push('AF');
    if (!at.length) bad.push('AT');
    if (!o.poles.length) bad.push('Poles');
    if (!(icu > 0)) bad.push('Icu');
    if (!(pct > 0 && pct <= 100)) bad.push('Ics%');
    // รุ่นที่ยืนยัน: Ii เว้นว่างได้ทั้งคู่ (แคตตาล็อกไม่ให้ค่าตายตัว → ตัวคำนวณใช้ค่าทั่วไป) แต่ต้องไม่มีแค่ตัวเดียว ; รุ่นที่ไม่ยืนยันบังคับเหมือนเดิม
    if (verified && (iiMult == null) !== (iiMin == null)) bad.push('Ii_Default_Mult/Min_Ii_Amp_Num (ต้องมีคู่กัน)');
    if (!(iiMult > 0) && !(verified && iiMult == null)) bad.push('Ii_Default_Mult');
    if (!(iiMin > 0) && !(verified && iiMin == null)) bad.push('Min_Ii_Amp_Num');
    if (!(selMCB >= 0) && !(verified && selMCB == null)) bad.push('Max_Selectivity_vs_MCB_kA');
    if (bad.length) throw new Error(`MCCB แถว ${line} (${id}): ค่าไม่ถูกต้อง ${bad.join(', ')}`);
    // ข้อสังเกต (ไม่หยุดการสร้าง) — รายงานให้ตรวจกับแคตตาล็อก ; ข้อสังเกตเชิงประมาณการ (Economy/Icu/Ics) ไม่ใช้กับรุ่นที่ยืนยันแล้ว เพราะค่าจริงมาจากตารางแคตตาล็อก
    if (at.some((a) => a > af)) issues.push(`MCCB ${id}: AT ${at.filter((a) => a > af).join('/')} เกิน AF ${af}`);
    if (at.some((a, k) => k && a <= at[k - 1])) issues.push(`MCCB ${id}: รายการ AT ไม่เรียงจากน้อยไปมาก`);
    if (selMCB > icu) issues.push(`MCCB ${id}: Max_Selectivity_vs_MCB ${selMCB} kA เกิน Icu ${icu} kA`);
    if (/\//.test(r.Tier_Category)) issues.push(`MCCB ${id}: Tier_Category เป็นค่าผสม "${r.Tier_Category}"`);
    if (iiMult != null && iiMin != null && iiMin < iiMult * at[0] - 1) issues.push(`MCCB ${id}: Min_Ii ${iiMin} A ต่ำกว่า Ii_Default × AT ต่ำสุด (${iiMult} × ${at[0]} = ${iiMult * at[0]} A)`);
    if (!verified && r.Tier_Category === 'Economy' && icu >= 36) issues.push(`MCCB ${id}: รุ่น Economy แต่ Icu ${icu} kA — ควรตรวจ`);
    if (!verified && o.icsPct === 100 && r.Tier_Category === 'Economy') issues.push(`MCCB ${id}: รุ่น Economy แต่ Ics 100% — ควรตรวจ`);
    return o;
  });
}

// MCB/RCBO: คอลัมน์ทางเลือก Source_ID/Source_Page/Source_Note เหมือน MCCB — แถวที่มี Source_ID = อ่านจากเอกสารทางการตามหน้าที่ระบุ
// แถวที่ยืนยันเว้น Icu (IEC 60947-2) ได้เมื่อแคตตาล็อกให้เฉพาะ Icn (IEC 60898-1/61009-1) → icu = null (ห้ามเดา) ; ตัวคูณแม่เหล็ก Magnetic_Trip_* ต้องมีเสมอ (ตัวเลขที่เอกสารพิมพ์ เช่น 8 In ±20 % → 6.4–9.6)
function buildMCB(rows, issues, sources) {
  const seen = new Set();
  const srcOf = new Map((sources || []).map((s) => [s.id, s]));
  return rows.map((r, i) => {
    const line = i + 2;
    const brandShort = shortBrand(r.Brand);
    const kind = /RCBO/i.test(r.Device_Type) ? 'RCBO' : 'MCB';
    const id = `${brandShort}|${r.Sub_Model}`;
    if (seen.has(id)) throw new Error(`MCB แถว ${line}: รหัสรุ่นซ้ำ ${id}`);
    seen.add(id);
    const icn = numOf(r.Icn_60898_kA), icu = numOf(r.Icu_60947_kA), rcdMA = numOf(r.RCD_Sensitivity_mA);
    const sid = String(r.Source_ID || '').trim(), verified = !!sid;
    let src = null;
    if (verified) {
      const s = srcOf.get(sid);
      if (!s) throw new Error(`MCB แถว ${line} (${id}): ไม่พบ Source_ID ${sid} ใน sources.json`);
      const pages = String(r.Source_Page || '').split(/[;,]/).map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x) && x >= 1 && x <= s.pages);
      if (!pages.length || !String(r.Source_Note || '').trim()) throw new Error(`MCB แถว ${line} (${id}): รุ่นที่ยืนยันต้องมี Source_Page (1–${s.pages}) และ Source_Note`);
      src = { id: sid, doc: s.docNo, url: s.urls[0], pages, note: String(r.Source_Note).trim() };
    }
    const o = {
      id, kind, brand: r.Brand, brandShort, series: r.Series, model: r.Sub_Model, std: r.Standard_Ref, curve: r.Trip_Curve,
      at: atList(r.Available_AT_List), poles: polesOf(r.Poles), withN: /\+N/i.test(r.Poles), icn, icu, cls: r.Energy_Limiting_Class,
      magMin: numOf(r.Magnetic_Trip_Min_Mult), magMax: numOf(r.Magnetic_Trip_Max_Mult),
      rcdMA: kind === 'RCBO' ? rcdMA : null,
      // "AC / A / A-SI" → [AC, A] (A-SI = Type A ภูมิคุ้มกันสูง ; ตัดชนิดซ้ำ)
      rcdTypes: kind === 'RCBO' ? [...new Set(String(r.RCD_Type).match(/\b(AC|A|B|F)\b/g) || [])] : [],
      ref: r.Official_PDF_Datasheet_Ref, verified
    };
    if (src) o.src = src;
    const bad = [];
    if (!o.at.length) bad.push('AT');
    if (!o.poles.length) bad.push('Poles');
    if (!(icn > 0)) bad.push('Icn');
    if (!(icu > 0) && !(verified && icu == null)) bad.push('Icu');
    if (!(o.magMin > 0 && o.magMax >= o.magMin)) bad.push('Magnetic_Trip');
    if (kind === 'RCBO' && (!(rcdMA > 0) || !o.rcdTypes.length)) bad.push('RCD');
    if (bad.length) throw new Error(`MCB แถว ${line} (${id}): ค่าไม่ถูกต้อง ${bad.join(', ')}`);
    if (icu != null && icu < icn) issues.push(`MCB ${id}: Icu ${icu} kA ต่ำกว่า Icn ${icn} kA`);
    if (o.at.some((a, k) => k && a <= o.at[k - 1])) issues.push(`MCB ${id}: รายการ AT ไม่เรียงจากน้อยไปมาก`);
    return o;
  });
}

function main(argv) {
  fs.mkdirSync(DIR, { recursive: true });
  const mccbCSV = path.join(DIR, 'mccb.csv'), mcbCSV = path.join(DIR, 'mcb.csv');
  if (argv.length >= 2) { fs.copyFileSync(argv[0], mccbCSV); fs.copyFileSync(argv[1], mcbCSV); }
  else if (argv.length === 1) throw new Error('ต้องระบุ 2 ไฟล์: <mccb.csv> <mcb.csv>');
  const issues = [];
  const sources = loadSources();
  const mccb = buildMCCB(table(mccbCSV, MCCB_COLS), issues, sources);
  const mcb = buildMCB(table(mcbCSV, MCB_COLS), issues, sources);
  // ข้อมูล MCB ทุกยี่ห้อมีเส้นโค้งเหมือนกันหมด (Type C, 5–10×) = ค่าทั่วไปตามมาตรฐาน ไม่ได้ต่างตามยี่ห้อจริง
  const curves = new Set(mcb.map((m) => `${m.curve} ${m.magMin}–${m.magMax}×`));
  if (curves.size === 1) issues.push(`MCB ทุกรุ่นมีเส้นโค้งเดียวกัน (${[...curves][0]}) — เป็นค่าทั่วไป ไม่ใช่ค่าเฉพาะยี่ห้อ`);
  const out = {
    meta: {
      source: 'รุ่นที่ติดป้าย "ยืนยันกับแคตตาล็อก" อ่านจากเอกสารทางการตามหน้าที่ระบุ ; รุ่นอื่นรวบรวมจากการค้นเว็บ (ยังไม่ผูกแคตตาล็อกรายแถว) — ตรวจกับแคตตาล็อกก่อนใช้งานจริง',
      files: ['data/brands/mccb.csv', 'data/brands/mcb.csv', 'data/brands/sources.json'],
      sources: sources.map((s) => ({ id: s.id, title: s.title, docNo: s.docNo, publisher: s.publisher, edition: s.edition, urls: s.urls, bytes: s.bytes, sha256: s.sha256, accessed: s.accessed, pages: s.pages })),
      generatedAt: new Date().toISOString().slice(0, 10),
      counts: { mccb: mccb.length, mccbVerified: mccb.filter((m) => m.verified).length, mcb: mcb.filter((m) => m.kind === 'MCB').length, rcbo: mcb.filter((m) => m.kind === 'RCBO').length, mcbVerified: mcb.filter((m) => m.verified).length },
      issues
    },
    mccb, mcb
  };
  const js = `// สร้างอัตโนมัติด้วย tools/import-brands.js จาก ${out.meta.files.join(' + ')} — อย่าแก้ไฟล์นี้ด้วยมือ (แก้ CSV แล้วรันสคริปต์ใหม่)
// ${out.meta.source}
(function (root) {
  'use strict';
  const BRANDS = ${JSON.stringify(out)};
  root.LS_BRANDS = BRANDS;
  if (typeof module !== 'undefined' && module.exports) module.exports = BRANDS;
})(typeof self !== 'undefined' ? self : this);
`;
  fs.writeFileSync(OUT, js);
  return out;
}

if (require.main === module) {
  try {
    const out = main(process.argv.slice(2));
    console.log(`สร้าง ${path.relative(ROOT, OUT)}: MCCB ${out.meta.counts.mccb} รุ่น (ยืนยันกับแคตตาล็อก ${out.meta.counts.mccbVerified}), MCB ${out.meta.counts.mcb} รุ่น, RCBO ${out.meta.counts.rcbo} รุ่น (MCB/RCBO ยืนยันกับแคตตาล็อก ${out.meta.counts.mcbVerified})`);
    if (out.meta.issues.length) { console.log(`ข้อสังเกต ${out.meta.issues.length} รายการ (ตรวจกับแคตตาล็อก):`); out.meta.issues.forEach((s) => console.log('  - ' + s)); }
  } catch (e) { console.error('ผิดพลาด: ' + e.message); process.exit(1); }
}
module.exports = { parseCSV, main, shortBrand, polesOf, atList, buildMCB, MCCB_COLS, SRC_COLS };
