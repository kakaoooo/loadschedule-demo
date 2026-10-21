# เปิดเวอร์ชันสาธิตให้สาธารณะ + เชื่อม Supabase

เอกสารนี้อธิบายขั้นตอนทำให้ `load-schedule-demo` ให้คนอื่นเปิดทดลองผ่านลิงก์ได้ โดยใช้ Supabase โปรเจกต์ที่สร้างไว้แล้วสำหรับ 3 ฟีเจอร์: **ตัวอย่างโครงการ (Presets)**, **แชร์ลิงก์โครงการ**, **สถิติชนิดไฟล์ที่ผู้ใช้กดส่งออก**
ถ้าไม่ตั้งค่า Supabase แอปยังทำงานครบ (คำนวณ ตาราง ผัง SLD ลายน้ำ ล็อกส่งออก) แต่ปิด 3 ฟีเจอร์ข้างบน

## 0. ข้อมูลโปรเจกต์ Supabase ที่เชื่อมไว้

| รายการ | ค่า |
| --- | --- |
| ชื่อโปรเจกต์ | `load-schedule-demo` |
| Project ref | `ovdljungbrrjgxvlzcdu` |
| API URL (`SUPABASE_URL`) | `https://ovdljungbrrjgxvlzcdu.supabase.co` |
| ภูมิภาค | `ap-northeast-2` (โซล) |
| สถานะตอนเขียนเอกสาร | โปรเจกต์ว่าง ยังไม่มีตาราง/migration — ต้องรันขั้นที่ 1 ก่อน |

คีย์ที่ใส่ในเว็บได้ มี **ชนิดเดียว**: `anon` (JWT) หรือ `sb_publishable_…` ดูได้ที่ Supabase Dashboard → Project Settings → API Keys
**ห้ามใช้** `service_role` หรือ `sb_secret_…` — `scripts/build-demo.js` จะปฏิเสธและ build ล้มทันที

## 1. สร้างตารางและข้อมูลตัวอย่างในฐานข้อมูล (ทำครั้งเดียว)

เปิด Supabase Dashboard → **SQL Editor** แล้วรันตามลำดับ (วางเนื้อหาไฟล์ทั้งไฟล์ กด Run):

1. `sql/supabase-demo-schema.sql` — สร้าง 4 ตาราง, เปิด RLS ทุกตาราง, ตั้งสิทธิ์ระดับคอลัมน์, ตัวจำกัดอัตรา, RPC `get_demo_project`, ฟังก์ชันล้างข้อมูลหมดอายุ
2. `sql/seed-demo-presets.sql` — ใส่ 4 ตัวอย่างทางการ (Office / Condo / Hospital / Factory) สร้างจาก `npm run seed:presets` อย่าแก้มือ

ตรวจผล: Table Editor ต้องเห็น `demo_projects` (4 แถว, `is_official_preset = true`), `demo_export_logs`, `demo_private`, `demo_rate_limit` ทุกตารางขึ้นป้าย RLS enabled
แล้วเปิด **Advisors → Security** ต้องไม่มีคำเตือนระดับ ERROR (`demo_private` / `demo_rate_limit` อาจขึ้นเตือน "RLS enabled, no policy" ซึ่งตั้งใจ: anon/authenticated ไม่มีสิทธิ์ใด ๆ ในสองตารางนั้น)

### ความปลอดภัยที่ฐานข้อมูลบังคับ (เพราะ anon key ทุกคนเห็นได้)
- anon **อ่าน** `demo_projects` ได้เฉพาะแถว `is_official_preset = true` และเฉพาะคอลัมน์ `id, title, description, is_official_preset, created_at`
- โครงการที่ผู้ใช้แชร์ อ่านได้ผ่าน RPC `get_demo_project(uuid)` เท่านั้น ต้องรู้ UUID (ไล่ดูทั้งตารางไม่ได้)
- anon **เขียน** `demo_projects` ได้เฉพาะ `id, title, project_data` และ policy บังคับ `is_official_preset = false`, `view_count = 0`, ต้องมี `expires_at` (30 วัน); ขนาดข้อมูล ≤ 200,000 ไบต์
- anon เขียน `demo_export_logs` ได้เฉพาะ `attempted_format` (PDF/CSV/XLSX/DXF/JSON/OTHER) และ `client_kind` (desktop/mobile/unknown) — **อ่านล็อกไม่ได้**
- จำกัดอัตราต่อผู้ใช้: แชร์ได้ 10 ครั้ง/ชั่วโมง, ส่งสถิติ 60 ครั้ง/ชั่วโมง โดยเก็บเป็นแฮชเค็มของ IP ไม่เก็บ IP ดิบ
- สถิติเก็บเฉพาะชนิดไฟล์ + เดสก์ท็อป/มือถือ ไม่เก็บชื่อโครงการ, User-Agent หรือ IP

### งานดูแล
- ล้างโครงการแชร์ที่หมดอายุ: รัน `select public.purge_expired_demo_projects();` เป็นครั้งคราว หรือเปิด extension `pg_cron` แล้ว `select cron.schedule('purge-demo', '17 3 * * *', 'select public.purge_expired_demo_projects()');`
- ดูสถิติความสนใจ (เจ้าของโปรเจกต์ใน SQL Editor เท่านั้น): `select attempted_format, client_kind, count(*) from demo_export_logs group by 1, 2 order by 3 desc;`
- แผนฟรีของ Supabase พักโปรเจกต์ที่ไม่มีการใช้งานนาน — `.github/workflows/keepalive.yml` เรียกอ่านตัวอย่างโครงการทุก 3 วัน (ใช้ `SUPABASE_URL` / `SUPABASE_ANON_KEY` ชุดเดียวกับ Pages) ถ้า workflow ขึ้นสีแดงแปลว่าโปรเจกต์ถูกพักไปแล้ว ให้เข้า Dashboard แล้ว Restore · GitHub จะปิด workflow ตามเวลาอัตโนมัติถ้ารีโปไม่มีกิจกรรม 60 วัน ให้เข้าแท็บ Actions กด Enable

## 2. ทดสอบในเครื่องก่อนเปิดจริง

```bash
SUPABASE_URL=https://ovdljungbrrjgxvlzcdu.supabase.co \
SUPABASE_ANON_KEY=<anon หรือ sb_publishable_ จาก Dashboard> \
npm run build:demo
npx http-server dist-demo -p 5190   # หรือเซิร์ฟเวอร์ static ใดก็ได้
```

เช็กลิสต์:
- [ ] Dropdown "ตัวอย่างโครงการ…" โหลด 4 รายการจากฐานข้อมูล
- [ ] กดปุ่ม Excel / DXF / PDF / CSV ขึ้นหน้าต่าง Ver.DEMO และปุ่ม "ไปหน้าผู้พัฒนา →" ชี้ไป `https://www.linkedin.com/in/photsawat-suksombat`
- [ ] หลังกดส่งออก 1 ครั้ง มีแถวใหม่ใน `demo_export_logs` (ดูใน SQL Editor)
- [ ] สร้างลิงก์แชร์แล้วเปิดลิงก์นั้นในหน้าต่างไม่ระบุตัวตนได้
- [ ] `npm test` ผ่านทั้งหมด

## 3. เผยแพร่บน GitHub Pages

1. สร้าง repo บน GitHub แล้ว push `main` (`git remote add origin <url>` → `git push -u origin main`)
   - **repo สาธารณะ = ซอร์สเดโมทั้งหมดเปิดสาธารณะ** (เวอร์ชันเต็มอยู่ใน `load-schedule-app` ซึ่งไม่ push) — เพิ่มไฟล์ `LICENSE` ตามเจตนาก่อนเปิด repo
   - Pages บน repo ส่วนตัวต้องใช้แผนที่ GitHub รองรับ
2. Settings → Pages → Source: **GitHub Actions**
3. Settings → Secrets and variables → Actions:

   | ชนิด | ชื่อ | ค่า |
   | --- | --- | --- |
   | Variable | `SUPABASE_URL` | `https://ovdljungbrrjgxvlzcdu.supabase.co` |
   | Secret | `SUPABASE_ANON_KEY` | anon / publishable key (ไม่ใช่ secret/service_role) |
   | Variable (ไม่ตั้งก็ได้) | `DEMO_REDIRECT_URL` | ค่าเริ่มต้นคือ `https://www.linkedin.com/in/photsawat-suksombat` |
   | Variable (ไม่ตั้งก็ได้) | `DEMO_OWNER_NAME` | ค่าเริ่มต้น `Photsawat Suksombat` |
   | Variable (ไม่ตั้งก็ได้) | `DEMO_CONTACT_EMAIL` | เว้นว่าง = ไม่แสดงอีเมล |

   anon key ถูกฝังลงไฟล์ `js/demo-config.js` ที่ทุกคนดาวน์โหลดได้ จึงไม่ใช่ความลับจริง การเก็บเป็น Secret ใน Actions เพียงกันไม่ให้ไปอยู่ในประวัติ git; ความปลอดภัยจริงอยู่ที่ RLS ในขั้นที่ 1
4. Push เข้า `main` หรือกด Run workflow ที่ `.github/workflows/pages.yml` — workflow รัน `npm test` และ `npm run build:demo` (ล้มทันทีถ้าพบโค้ดส่งออกไฟล์ หรือ key ลับใน `dist-demo/`) แล้ว deploy
5. ลิงก์ที่ได้: `https://<ผู้ใช้>.github.io/<ชื่อ repo>/`

ทางเลือกอื่น: Netlify / Cloudflare Pages — ตั้ง build command `npm run build:demo`, publish directory `dist-demo`, ใส่ environment variables ชุดเดียวกัน (ใช้ `_headers` จึงได้ CSP เต็มรวม `frame-ancestors`; GitHub Pages ใช้ `<meta>` CSP ใน `index.html` แทน)

## 4. หลังเปิดจริง

- ทดสอบซ้ำเช็กลิสต์ในหัวข้อ 2 บน URL จริง
- ถ้า anon key รั่วหรืออยากเปลี่ยน: Dashboard → API Keys → สร้างคีย์ใหม่/ปิดคีย์เก่า แล้วอัปเดต Secret `SUPABASE_ANON_KEY` และรัน workflow ใหม่
- ถ้า `service_role` / `sb_secret_` เคยหลุดไปที่ใดก็ตาม ให้ rotate ทันทีที่ Dashboard
- ข้อจำกัด: ตัวขัดขวางส่งออกไม่ใช่การเข้ารหัส — ข้อมูลที่แสดงบนจอ (ตาราง/ผัง) คัดลอกหรือแคปภาพได้เสมอ
