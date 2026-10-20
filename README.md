# ตารางโหลดสำเร็จรูป — Public Demo Edition (Ver.DEMO)

เวอร์ชันสาธิตของ `load-schedule-app`: **คำนวณโหลด จัดเฟส ดูตารางโหลด ผังเส้นเดียว (SLD) และรายการคำนวณได้ครบ** แต่ **ส่งออก/พิมพ์ไม่ได้** (PDF, CSV, Excel, AutoCAD DXF, บันทึกไฟล์โครงการ) และทุกตาราง/ผังมีลายน้ำ `Ver.DEMO — Made by <ชื่อเจ้าของ>`
เวอร์ชันเต็ม (ส่งออกได้ทุกแบบ) อยู่ในที่เก็บส่วนตัวของเจ้าของผลงาน

> ⚠ นี่คือ **ตัวขัดขวาง ไม่ใช่การเข้ารหัส**: ข้อมูลที่แสดงบนจอ (ตาราง/ผัง) คัดลอกหรือแคปภาพได้เสมอ ส่วนที่ทำได้จริงคือ "ไม่มีโค้ดสร้างไฟล์ CAD/Excel/CSV/PDF อยู่ในซอร์ส" + ลายน้ำ + ข้อความลิขสิทธิ์ — อ่านข้อจำกัดทั้งหมดใน [`docs/DEMO-BLUEPRINT-REVIEW.md`](docs/DEMO-BLUEPRINT-REVIEW.md)

## ใช้งานในเครื่อง
```bash
npm start            # http://localhost:5180  (ต้องมี Node ≥ 18, ไม่ต้อง npm install)
npm test             # 22 ไฟล์ทดสอบ + master-spec
```

## สิ่งที่ถูกถอดออกจากเวอร์ชันเต็ม (ในซอร์ส ไม่ใช่แค่ซ่อนปุ่ม)
| ไฟล์ | สถานะ |
| --- | --- |
| `public/js/dxf.js` | เหลือ stub (เรียก `build()` = หน้าต่าง Ver.DEMO) — ไม่มีโค้ดเขียน DXF |
| `public/js/xlsx-io.js` | ถอด writer/zip/สไตล์ออก เหลือ **อ่านไฟล์นำเข้า** เท่านั้น |
| `public/js/export.js` | ถอดตัวสร้าง CSV และรายงาน PDF ; ตัวแสดงตาราง/SLD บนจอยังอยู่ (+ลายน้ำ) |
| `public/js/app.js` | ทุกปุ่ม/ทางออกผ่าน `DemoGuard.interceptExport()` ; `download()` เป็นด่านสุดท้าย ; ไม่คุยกับ `server.js` |

`npm run build:demo` สร้าง `dist-demo/` และ **ล้มทันที** ถ้าพบร่องรอยโค้ดส่งออก (DXF/xlsx/CSV/รายงาน) หรือคีย์ลับ (service_role / `sb_secret_`) ใน `public/`

## Supabase (ตัวอย่างโครงการ · แชร์ลิงก์ · สถิติความสนใจ)
> ขั้นตอนเปิดสาธารณะแบบละเอียด (รวมโปรเจกต์ Supabase ที่สร้างไว้ + เช็กลิสต์): [`docs/PUBLIC-DEPLOY.md`](docs/PUBLIC-DEPLOY.md)

ปิดอยู่จนกว่าจะตั้งค่า (ไม่ตั้ง = แอปทำงานได้เต็มโดยไม่ยิงเครือข่าย)
1. สร้างโปรเจกต์ Supabase → SQL Editor รัน `sql/supabase-demo-schema.sql` แล้ว `sql/seed-demo-presets.sql` (สร้างใหม่ด้วย `npm run seed:presets`)
2. ใส่ค่า **ตอน build** (ไม่ commit ลง repo): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon/publishable เท่านั้น), `DEMO_REDIRECT_URL`, `DEMO_CONTACT_EMAIL`, `DEMO_OWNER_NAME`
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> DEMO_REDIRECT_URL=https://github.com/<you> npm run build:demo
   ```
3. ความปลอดภัยอยู่ที่ฐานข้อมูล (anon key ทุกคนเห็นได้): RLS ทุกตาราง · anon อ่านได้เฉพาะ "ตัวอย่างทางการ" · โครงการที่แชร์อ่านได้ผ่าน RPC ด้วย UUID เท่านั้น · เขียนได้เฉพาะคอลัมน์ที่อนุญาต · จำกัดอัตราต่อ IP (แฮชเค็ม) · หมดอายุ 30 วัน · สถิติเก็บเฉพาะชนิดไฟล์ + desktop/mobile (ไม่เก็บ IP/ชื่อโครงการ/User-Agent)

## Deploy
- **GitHub Pages**: `.github/workflows/pages.yml` (ตั้ง Actions variables `SUPABASE_URL`, `DEMO_REDIRECT_URL`… และ secret `SUPABASE_ANON_KEY`) — Pages ไม่รองรับ `_headers` จึงใช้ `<meta>` CSP ใน `index.html`
- **Netlify / Cloudflare Pages**: publish `dist-demo/` (ใช้ `_headers` → CSP เต็มรวม `frame-ancestors`)

## โครงสร้างที่เพิ่มจากเวอร์ชันเต็ม
`public/js/demo-config.js` (ค่าตั้ง) · `demo-guard.js` (ตัวดัก+ลายน้ำ+บล็อก Ctrl+P) · `supabase-client.js` · `demo-ui.js` (แถบตัวอย่าง/แชร์ลิงก์) · `sql/` · `presets/` · `scripts/` · `tests/demo-security.test.js`

© เจ้าของผลงาน — สงวนลิขสิทธิ์ (ยังไม่ได้กำหนด LICENSE: ถ้าเปิด repo สาธารณะ ให้เพิ่มไฟล์ LICENSE ที่ตรงเจตนา)
