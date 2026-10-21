#!/usr/bin/env node
'use strict';
// สร้าง dist-demo/ สำหรับ deploy (GitHub Pages / Netlify / Cloudflare Pages / Vercel) :  node scripts/build-demo.js
//  1) คัดลอก public/ → dist-demo/
//  2) เขียน dist-demo/js/demo-config.js จาก environment (ไม่มีความลับใน repo):
//       SUPABASE_URL  SUPABASE_ANON_KEY  DEMO_REDIRECT_URL  DEMO_CONTACT_EMAIL  DEMO_OWNER_NAME  DEMO_ALLOW_JSON(=1)
//     — ปฏิเสธ service_role / sb_secret_ key (ห้ามถึงเบราว์เซอร์เด็ดขาด)
//  3) "ตรวจย้อนกลับ": ใน dist-demo ต้องไม่มีร่องรอยโค้ดสร้างไฟล์ (DXF / xlsx / CSV / รายงาน PDF) — พบ = build ล้ม
// ซอร์สของเวอร์ชันนี้ถอดโค้ดส่งออกออกไปแล้วตั้งแต่ใน repo ; ขั้นที่ 3 ป้องกันการเผลอใส่กลับมา
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ลายนิ้วมือของโค้ดสร้างไฟล์ที่ต้องไม่ปรากฏในไฟล์ที่ deploy
const BANNED = [
  [/AC1009|\bENDSEC\b|\$ACADVER/, 'โค้ดเขียนไฟล์ DXF'],
  [/\[Content_Types\]\.xml|xl\/worksheets|<styleSheet|spreadsheetml\.sheet\.main/, 'โค้ดเขียนไฟล์ .xlsx'],
  [/\bfunction zip\(|\bcrc32\b|\bCRC_T\b/, 'ตัวบีบ/เขียน zip (xlsx)'],
  [/ภาคผนวก — รายการคำนวณ|<section class="page/, 'ตัวสร้างรายงาน PDF/พิมพ์'],
  [/panelCSVRows\s*\(\s*p\s*,\s*result|allCSV\s*\(\s*result\s*\)\s*\{/, 'ตัวสร้าง CSV'],
  [/service_role|sb_secret_/, 'service_role/secret key']
];

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ตรวจไฟล์ข้อความทั้งหมดใน dir ; คืนรายการที่พบ [{file, what}]
function scanBanned(dir) {
  const hits = [];
  walk(dir).filter((f) => /\.(js|html|css|json|txt|md)$/i.test(f) && !/[\\/]vendor[\\/]/.test(f)).forEach((f) => {
    const text = fs.readFileSync(f, 'utf8');
    BANNED.forEach(([re, what]) => { if (re.test(text)) hits.push({ file: path.relative(dir, f), what }); });
  });
  return hits;
}

// ตรวจ key ที่จะใส่ใน demo-config.js: รับเฉพาะ anon JWT หรือ sb_publishable_ ; ปฏิเสธ service_role / sb_secret_
function checkAnonKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (/^sb_secret_/i.test(k)) throw new Error('SUPABASE_ANON_KEY เป็น secret key — ห้ามใส่ในเว็บ');
  if (/^sb_publishable_/i.test(k)) return k;
  const parts = k.split('.');
  if (parts.length !== 3) throw new Error('SUPABASE_ANON_KEY รูปแบบไม่ใช่ JWT/publishable key');
  let role = '';
  try { role = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role; } catch (e) { throw new Error('SUPABASE_ANON_KEY อ่าน JWT ไม่ได้'); }
  if (role !== 'anon') throw new Error(`SUPABASE_ANON_KEY มี role "${role}" — ต้องเป็น anon เท่านั้น`);
  return k;
}

function configText(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (url && !/^https:\/\/[a-z0-9-]{3,40}\.supabase\.co$/.test(url)) throw new Error('SUPABASE_URL ต้องเป็น https://<project-ref>.supabase.co');
  const redirect = String(env.DEMO_REDIRECT_URL || 'https://www.linkedin.com/in/photsawat-suksombat');
  if (!/^https:\/\//.test(redirect)) throw new Error('DEMO_REDIRECT_URL ต้องขึ้นต้นด้วย https://');
  const owner = String(env.DEMO_OWNER_NAME || 'Photsawat Suksombat').slice(0, 80);
  const cfg = {
    enabled: true,
    ownerName: owner,
    ownerRole: 'Electrical Engineer & Developer',
    watermarkText: `Ver.DEMO — Made by ${owner}`,
    watermarkSubText: 'FOR DEMONSTRATION ONLY • NOT FOR CONSTRUCTION OR SUBMISSION',
    redirectUrl: redirect,
    contactEmail: String(env.DEMO_CONTACT_EMAIL || ''),
    allowProjectJson: env.DEMO_ALLOW_JSON === '1',
    supabaseUrl: url,
    supabaseAnonKey: url ? checkAnonKey(env.SUPABASE_ANON_KEY) : ''
  };
  return `// สร้างโดย scripts/build-demo.js — ค่านี้ถูกส่งถึงเบราว์เซอร์ทุกคน (ห้ามมีความลับ)\n(function (root) { 'use strict'; root.DEMO_CONFIG = ${JSON.stringify(cfg, null, 2)}; })(typeof globalThis !== 'undefined' ? globalThis : window);\n`;
}

function build(env, outDir) {
  const out = outDir || path.join(ROOT, 'dist-demo');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), out, { recursive: true });
  fs.writeFileSync(path.join(out, 'js/demo-config.js'), configText(env || {}));
  // โทเค็นของ server.js (ใช้เฉพาะตอนรันในเครื่อง) ไม่มีความหมายบนโฮสต์ static — ตัดทิ้งไม่ให้ placeholder หลงไปขึ้นเว็บจริง (app.js อ่านไม่เจอจะใช้ค่าว่างและไม่เรียก API ในโหมดสาธิตอยู่แล้ว)
  const idx = path.join(out, 'index.html');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/[ \t]*<meta name="ls-token" content="__LS_TOKEN__">\r?\n?/, ''));
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  const hits = scanBanned(out);
  if (hits.length) {
    fs.rmSync(out, { recursive: true, force: true });
    throw new Error('พบโค้ดส่งออก/ความลับใน dist-demo:\n' + hits.map((h) => `  - ${h.file}: ${h.what}`).join('\n'));
  }
  return out;
}

module.exports = { build, scanBanned, checkAnonKey, configText, BANNED };

if (require.main === module) {
  try {
    const out = build(process.env);
    console.log('✅ สร้าง ' + path.relative(process.cwd(), out) + '/ สำเร็จ');
    console.log('   - ไม่พบร่องรอยโค้ดสร้างไฟล์ DXF / xlsx / CSV / รายงาน PDF');
    console.log('   - Supabase: ' + (process.env.SUPABASE_URL ? 'ตั้งค่าแล้ว' : 'ไม่ได้ตั้งค่า (ปิดฟีเจอร์ตัวอย่าง/แชร์ลิงก์)'));
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }
}
