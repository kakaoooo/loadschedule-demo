# แหล่งอ้างอิงข้อมูล MCCB (ยืนยันกับแคตตาล็อกทางการ)

เอกสารนี้สร้างจาก `data/brands/sources.json` และ `public/js/brands.js` (อัปเดต 2026-10-19). หลักการ: **ตัวเลขทุกตัวของรุ่นที่มีเครื่องหมาย ✔ ต้องอ่านได้จากตารางในเอกสารของผู้ผลิตตามเลขหน้าที่ระบุ — ไม่ประมาณ ไม่เดา ไม่คัดลอกจากเว็บขายของ/ตัวแทน**. ช่องที่เอกสารไม่ให้ตัวเลข (เช่น Ii ที่แสดงเป็นกราฟ, selectivity ต่อ MCB) เว้นว่างไว้ แล้วตัวคำนวณใช้ค่าทั่วไปของแอปแทน.

## ภาพรวมความครอบคลุม

MCCB ทั้งหมด **582 รุ่น** — ยืนยันกับแคตตาล็อกแล้ว **552 รุ่น** (95%) จาก **26 เอกสาร**. รุ่นที่เหลือเป็นข้อมูลรวบรวมเดิมและถูกทำเครื่องหมาย "ยังไม่ผูกแคตตาล็อก" ใน UI/รายงาน (ไม่ถูกเหมารวมว่าเชื่อถือได้).

| ยี่ห้อ | ซีรีส์ | ยืนยัน/ทั้งหมด | สถานะ | เอกสาร |
|---|---|---|---|---|
| Schneider Electric | EasyPact EZC | 14/14 | ✔ ยืนยัน | SE-LVED212091EN |
| Schneider Electric | EasyPact CVS | 15/15 | ✔ ยืนยัน | SE-LVED210011EN |
| Schneider Electric | ComPacT NSX | 22/22 | ✔ ยืนยัน | SE-LVPED221001EN |
| Schneider Electric | ComPacT NS | 0/4 | — ยังไม่ยืนยัน | — |
| ABB | Formula DSA | 12/12 | ✔ ยืนยัน | ABB-1SDC210401D0201 |
| ABB | Tmax XT | 30/30 | ✔ ยืนยัน | ABB-1SDC210100D0206 |
| Mitsubishi Electric | WS-V NF-C | 6/6 | ✔ ยืนยัน | MIT-Y0720J2309 |
| Mitsubishi Electric | WS-V NF-S | 17/17 | ✔ ยืนยัน | MIT-Y0720J2309 |
| Mitsubishi Electric | WS-V NF-L/H/R | 19/19 | ✔ ยืนยัน | MIT-Y0720J2309 |
| Mitsubishi Electric | WS-V NF-U | 4/4 | ✔ ยืนยัน | MIT-Y0720J2309 |
| Siemens | SENTRON 3VM | 12/12 | ✔ ยืนยัน | SIE-LV31-2018 |
| Siemens | SENTRON 3VA1 | 21/21 | ✔ ยืนยัน | SIE-LV10-2023-10 |
| Siemens | SENTRON 3VA2 | 33/33 | ✔ ยืนยัน | SIE-LV10-2023-10 |
| Fuji Electric | G-TWIN Standard | 34/34 | ✔ ยืนยัน | FUJ-62D1-E-0202 |
| Terasaki Electric | TemBreak 2 | 44/44 | ✔ ยืนยัน | TER-TB2-18I61E |
| Terasaki Electric | TemBreak PRO | 67/67 | ✔ ยืนยัน | TER-TBP-23I68E |
| Eaton (Moeller) | NZM Series | 0/7 | — ยังไม่ยืนยัน | — |
| Legrand | DRX Series | 8/8 | ✔ ยืนยัน | LEG-F00699EN-06, LEG-F00703EN-05, LEG-F02406EN-00 |
| Legrand | DPX3 Series | 15/15 | ✔ ยืนยัน | LEG-F01360EN-09, LEG-F01364EN-07, LEG-F01958EN-06, LEG-F01963EN-05 |
| LS Electric | Metasol | 22/22 | ✔ ยืนยัน | LS-METASOL-MANUAL |
| LS Electric | Susol | 31/31 | ✔ ยืนยัน | LS-SUSOL-CAT-V31 |
| HD Hyundai | HGM Series | 30/30 | ✔ ยืนยัน | HD-HG-MCCB-2026 |
| HD Hyundai | U-Series | 0/6 | — ยังไม่ยืนยัน | — |
| Hager | h3 Series | 11/11 | ✔ ยืนยัน | HAG-H3-CAT-2024 |
| Hager | h3+ Series | 27/27 | ✔ ยืนยัน | HAG-H3P-CAT-IT-2023 |
| CHINT Electric | NM1 Series | 18/18 | ✔ ยืนยัน | CHINT-NM1-CATALOG |
| CHINT Electric | NM8N Series | 28/28 | ✔ ยืนยัน | CHINT-NM8N-CATALOG |
| Shihlin Electric | BM Series | 0/7 | — ยังไม่ยืนยัน | — |
| GE (General Electric) | Record Plus | 0/6 | — ยังไม่ยืนยัน | — |
| WEG | DWB Series | 8/8 | ✔ ยืนยัน | WEG-50040542 |
| WEG | DWA Series | 4/4 | ✔ ยืนยัน | WEG-50040542 |

## ทะเบียนเอกสารต้นทาง

| รหัส | ผู้ผลิต | เลขเอกสาร | ชื่อเอกสาร | ฉบับ | หน้า | SHA-256 (ย่อ) | หน้าที่ใช้ |
|---|---|---|---|---|---|---|---|
| `SE-LVPED221001EN` | Schneider Electric | LVPED221001EN | ComPacT NSX & NSXm — Circuit Breakers and Switch Disconnectors from 16 to 630 A up to 690 V (Catalog) | Catalog 2026 (ไฟล์ PDF สร้าง 2026-03-24 ; หน้าเอกสารบน se.com ระบุ version 4.0) | 374 | `8eb77f29749121de…` | 23 (A-7) และ 25 (A-9) ตาราง Breaking Capacity Levels ; 41 (B-7) TM-D ; 45 (B-11) MicroLogic 2 ; 275–282, 308–312 Catalog Numbers |
| `SE-LVED212091EN` | Schneider Electric | LVED212091EN | EasyPact EZC Molded-case Circuit Breakers and Switch-disconnectors (Catalog) | 2024-09-24 (ไฟล์ LVED212091EN-EZC-catalog-2024-09-24.pdf ; หน้าเอกสารบน se.com ใช้รหัส LVED212091ENWEB) | 86 | `e16607c1526eeb78…` | 15 (A-7) EZC100/125 ; 17 (A-9) EZC250/400/630 ; 73–74, 77–78, 82–83 Catalog Numbers |
| `ABB-1SDC210100D0206` | ABB | 1SDC210100D0206 | SACE Tmax XT — Low voltage molded case circuit-breakers (IEC Catalog) | Revision B, 2024-08-28 (ไฟล์ 1SDC210100D0206_Tmax XT_IEC_EN_08_2024.pdf ; PDF สร้าง 2024-07-31) | 386 | `68fa57c2e6219887…` | 24 (2/2) XT1 ; 25 (2/3) XT2/XT3/XT4 ; 28 (2/6) XT5 ; 29 (2/7) XT6/XT7 ; 58 (3/20) TMD/TMA ; 61 (3/23) Ekip Dip |
| `ABB-1SDC210401D0201` | ABB | 1SDC210401D0201 | SACE Formula DSA — Low voltage molded-case circuit-breakers up to 630 A (Technical catalogue) | ไฟล์ PDF สร้าง 2021-01-19 (ดาวน์โหลดจาก search.abb.com ด้วย DocumentID=1SDC210401D0201) | 106 | `e38c6ba661ee74a2…` | 14 (2/4) Icu/Ics ; 16 (2/6) TMF ; 17–21 (2/7–2/11) Ordering codes |
| `MIT-Y0720J2309` | Mitsubishi Electric | Y-0720J 2309 | World Super V Series (WS-V Series) — Molded Case Circuit Breakers and Earth Leakage Circuit Breakers (General Catalog) | Revised publication, effective September 2023 (ไฟล์ PDF สร้าง 2023-09-15 ; หมายเหตุท้ายเล่ม 'Y-0720J 2309') ; เลขหน้าพิมพ์ = เลขหน้า PDF − 2 | 276 | `63570f58a77b5256…` | 20–29 (พิมพ์ 18–27) ตาราง Detailed Specifications NF-C / NF-S / NF-L,H,R / NF-U : แถว Icu/Ics 415 V ช่องแรเงา, Frame, In, จำนวนขั้ว, Utilization category, Automatic tripping device |
| `LEG-F01360EN-09` | Legrand | F01360EN-09 | DPX3 160 thermal magnetic circuit breakers / DPX3-I 160 trip-free switches (Technical data sheet) | Updated 11/07/2025, created 25/05/2011 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com) | 13 | `61fc40df6f46b12a…` | 2 (3.1 Electrical characteristics) : Rated current, Ii, ตาราง Breaking capacity (Icu @415 V, Ics % Icu), ตาราง Phases limit trip current |
| `LEG-F01364EN-07` | Legrand | F01364EN-07 | DPX3 250 thermal magnetic circuit breakers / DPX3-I 250 trip-free switches (Technical data sheet) | Updated 23/05/2025, created 25/05/2011 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com) | 12 | `a3456e8a28de76cc…` | 1 (Rated current, Ir/Ii adjustment) ; 2 (ตาราง Breaking capacity 380/415 V, Ics % Icu, Phases limit trip current) |
| `LEG-F01958EN-06` | Legrand | F01958EN-06 | DPX3 630 thermal magnetic circuit breakers / DPX3-I 630 trip-free switches (Technical data sheet) | Updated 31/10/2025, created 06/10/2014 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com) | 14 | `f0283c0315c1dd59…` | 2 (3.1 Electrical characteristics) : Rated current, Ir/Ii adjustment, ตาราง Breaking capacity (Icu @415 V, Ics % Icu), ตาราง Phases limit trip current (5×In / 10×In) |
| `LEG-F01963EN-05` | Legrand | F01963EN-05 | DPX3 1600 thermal magnetic circuit breakers / DPX3-I 1600 trip-free switches (Technical data sheet) | Updated 10/12/2025, created 06/10/2014 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com) | 14 | `5b3e18fbd1a0af36…` | 1 (Rated current ของเบรกเกอร์ TM) ; 2 (ตาราง Breaking capacity 380/415 V และ Ics % Icu, Phases limit trip current 5×Ir / 10×Ir) |
| `SIE-LV10-2023-10` | Siemens | Siemens LV 10 · 10/2023 | SENTRON 3VA — Molded Case Circuit Breakers up to 1600 A (Catalog Extract from LV 10) | Catalog Extract from LV 10 · 10/2023 (PDF สร้าง 2023-12-04 ; เลขหน้าพิมพ์ 2/n = หน้า PDF − 4 ในช่วง 2/8–2/24 และ 2/72) | 100 | `aa72dac7ca57a745…` | 12–13 (2/8–2/9) 3VA10–3VA15 : Icu/Ics 380…415 V ; 16–17 (2/12–2/13) 3VA20–3VA27 : Icu/Ics 380…415 V ; 28 (2/24) โครงสร้างเลขที่สินค้า : Max. rated current In max ; 76 (2/72) 3VA27 In max |
| `LS-METASOL-MANUAL` | LS Electric | Metasol MCCB/ELCB Technical Manual | Metasol MCCB/ELCB Technical Manual — Low voltage circuit breakers Meta Solution | ไม่ระบุปีที่พิมพ์ ; ท้ายหน้าใช้ชื่อบริษัท LS Industrial Systems (ก่อนเปลี่ยนชื่อเป็น LS ELECTRIC) จึงเป็นฉบับก่อนหน้า — ควรตรวจกับแคตตาล็อกล่าสุด | 100 | `5b0d1f5febb5b576…` | 8–11 (พิมพ์ A-6…A-9) ตาราง Ratings ของ Metasol MCCB : In, จำนวนขั้ว, Icu 415/460 V, Ics, Magnetic trip range ; 5 (A-3) กราฟเทียบกำลังตัด |
| `FUJ-62D1-E-0202` | Fuji Electric | 62D1-E-0202 | G-TWIN Series — Distribution: Molded Case Circuit Breakers & Earth Leakage Circuit Breakers (catalogue) | PDF สร้าง 2016-09-29 (เอกสารจากเว็บ Fuji Electric ประเทศไทย) ; ผู้ผลิตระบุ "Information subject to change without notice" จึงควรตรวจกับแคตตาล็อกล่าสุด ; เลขหน้า PDF = เลขหน้าพิมพ์ | 192 | `16e8caa7ffc59543…` | 14–22 Quick reference guide : G-TWIN Standard Series ชนิด G (line protection) — In, จำนวนขั้ว, Icu/Ics ที่ 415 V ; 12 การตั้งชื่อรุ่นและระดับกำลังตัด |
| `CHINT-NM8N-CATALOG` | CHINT | NM8N-MCCB-Catalog | NM8N Moulded Case Circuit Breaker — Catalogue | PDF สร้าง 2024-08-12 (ไฟล์ NM8N-MCCB-Catalog.pdf จากเว็บ CHINT Global) | 87 | `d176563d4d25f3e0…` | 4–5 (4. Technical data) : In, จำนวนขั้ว, Icu/Ics AC380/400/415V, Utilization category ของ NM8N-125/250/400/630/800/1600 ; 2 (3.1 Type designation) : In ตามขนาดเฟรม |
| `SE-LVED210011EN` | Schneider Electric | LVED210011EN | EasyPact CVS Molded-case Circuit Breakers and Switch-disconnectors (Catalog) | Catalog 2024 (ไฟล์ LVED210011EN-EasyPact CVS Catalog-2024.pdf ; PDF สร้าง 2024-08-13) ; เลขหน้าพิมพ์ A-n = หน้า PDF − 10 ในช่วง A-4…A-6 | 162 | `b612b0a75439afd6…` | 14–15 (A-4…A-5) ตาราง Breaking capacity levels (Icu/Ics) ; 16 (A-6) TM-D : Ir/Ii ; 119 (E-3) Catalogue Numbers CVS100/160/250 B,F,N ; 131 (E-15) Catalogue Numbers CVS400/630 F,N,H |
| `SIE-LV31-2018` | Siemens | Siemens LV 31 · 2018 | SENTRON 3VM Molded Case Circuit Breakers (Catalog LV 31) | Catalog LV 31 · 2018 (PDF สร้าง 2018-10-30) ; เลขหน้าพิมพ์ 1/n, 2/n | 92 | `03f23d93a42ab4b6…` | 10–11 (1/4–1/5) General data : Icu/Ics 380…415 V ของ 3VM10–3VM14 ; 28 (2/4) 3 ขั้ว TM210 FTFM : In/Ir/Ii ; 30 (2/6) TM220 ATFM |
| `HAG-H3-CAT-2024` | Hager | HA_79103074 | h3 MCCB Technical catalogue — Moulded Case Circuit breakers from 16 to 1600 A (Hager) | 2024 (ไฟล์ h3 MCCB Catalogue_2024.pdf บน assets.hager.com ; เลขหน้าพิมพ์ = เลขหน้า PDF − 2) ; ตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง | 84 | `8b7d1ee89a36408d…` | 6–7 (พิมพ์ 4–5) ตาราง Electrical characteristics : Icu/Ics @380/415 V ; 9–10 References guide : In ที่สั่งซื้อ ; 13, 17 (x160) ; 23, 26 (x250) ; 37, 40 (h800/h1000) ; 50, 52 (h1600) : Icu/Ics, ช่วงตั้งค่า Ii |
| `LEG-F00699EN-06` | Legrand | F00699EN-06 | DRX 125 circuit breaker (not adjustable) (Technical data sheet) | Last update 30/10/2014, created 16/11/2007 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com ; ฉบับเก่า ควรตรวจกับแคตตาล็อกล่าสุด) | 8 | `64b0f9affa65faf9…` | 1 (Range : In × Icu) ; 3 (6.2 Breaking capacity : Icu 380/415 V, Ics % Icu) ; 4 (6.3 Technical features : Magnetic limit Isd) |
| `LEG-F00703EN-05` | Legrand | F00703EN-05 | DRX 250 circuit breaker (not adjustable) (Technical data sheet) | Last update 30/11/2014 (หน้าแรกระบุ 30/10/2014), created 16/11/2007 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com ; ฉบับเก่า ควรตรวจกับแคตตาล็อกล่าสุด) | 8 | `ee6ba3b9988ddb88…` | 1 (Range : In × Icu) ; 3 (6.2 Breaking capacity : Icu 380/415 V, Ics % Icu — เป็นภาพ) ; 4 (6.3 General features : Magnetic limit Isd) |
| `LEG-F02406EN-00` | Legrand | F02406EN-00 | DRX 630 thermal magnetic adjustable circuit breaker (Technical sheet) | Update 23/12/2016, creation 23/12/2016 (เอกสารข้อมูลทางเทคนิคฉบับภาษาอังกฤษบน assets.legrand.com ; ฉบับเก่า ควรตรวจกับแคตตาล็อกล่าสุด) | 7 | `be0ee7ab1d25b6df…` | 1 (Range : In 320–630 A) ; 2 (5. Electrical characteristics : Magnetic adjustment 5–10×In) ; 3 (5.2 Breaking capacity : Icu 380/415 V, Ics % Icu) |
| `WEG-50040542` | WEG | 50040542 | Interruptores en Caja Moldeada DWB / DWA — Catálogo (WEG) | ภาษาสเปน, PDF สร้าง 2015-05-11 (ไฟล์ 50040542_spanish_web.pdf บน static.weg.net) ; แผ่นพับ IEC ภาษาอังกฤษ 50049689 (09/2016) ใช้เทียบเท่านั้น (ไม่มี Ics/รายการ In) ; ตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง | 48 | `b0bd80d9b8fe5159…` | 6–7 ตาราง Características eléctricas : Icu (kA) และ Ics (% Icu) @380-415 V ; 9–12 Guía de Selección : In, Icu, ช่วงปรับแม่เหล็ก/คงที่ (3P p.9–10, 4P p.11–12) |
| `CHINT-NM1-CATALOG` | CHINT | NM1-MCCB-Catalog | NM1 Moulded Case Circuit Breaker — Catalogue | PDF สร้าง 2026-01-29 (ไฟล์ NM1-MCCB-Catalog.pdf จากเว็บ CHINT Global ; ชั้นข้อความในไฟล์เพี้ยน จึงอ่านตารางจากภาพหน้า) | 25 | `31f6664a64eacee3…` | 3 (5. Technical data : Icu AC380/400/415 V, Ics 50% Icu, In) ; 22 (12.7 Technical Data of NM1 series : Icu/Ics รายรุ่น — ยืนยันซ้ำ) ; 11, 15 (ตารางสกรู/อุปกรณ์เสริม : รายการรุ่น) |
| `HD-HG-MCCB-2026` | HD Hyundai Electric | HG-MCCB-2609 | HG-MCCB — Molded Case Circuit Breakers & Earth Leakage Circuit Breakers (Catalog HGM, HGE, HGP) | ไฟล์ "[MCCB,ELCB]_영문 카탈로그_HGM,HGE,HGP(2609).pdf" (ลงรายการบนหน้า Download ของผู้ผลิต 2026-10-16 ; PDF สร้าง 2026-06-23) ; ดาวน์โหลดผ่านหน้า Download ของผู้ผลิต (ส่ง POST ไป /elec/common/fileDown.jsp ด้วยชื่อไฟล์ 2026_10_16_080317_1.pdf) | 270 | `df9cd0141874720c…` | 30 (HGM30/50/60, 32–63 AF) ; 31 (HGM100/125/250) ; 32 (HGM400/630/800) ตาราง Model Selection : Icu/Ics, In, Instantaneous ; 120, 142 (ตาราง cascading ที่ระบุว่า HGD = ลูกข่ายขนาดเล็ก) |
| `LS-SUSOL-CAT-V31` | LS Electric | C01092-31 | [Susol MCCB] Molded Case Circuit Breakers (Catalog) | v31 · 2025-09-19 (ไฟล์ [Susol_MCCB]_EN_C01092-31-202509.pdf ; ลงรายการบนหน้า Susol MCCB ของ ls-electric.com เป็น Catalog [Susol MCCB] v31 ภาษาอังกฤษ ; ไม่ใช่แผ่นพับ "Up to 1000Vac") ; ตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง | 384 | `69f5892b7b032c46…` | 40 (TD100/TD160) และ 41 (TS100–TS800) ตาราง Electrical characteristics : Icu, Ics, In ; 42 (ตารางพิกัดกระแสของ TM) ; 45, 48–49 (TD/TS100–250), 51–53 (TS400/630), 55 (TS800) : ตาราง Magnetic short-circuit protection / Ii ; 110 (TS1000/TS1250/TS1600) ตาราง Electrical characteristics |
| `TER-TB2-18I61E` | Terasaki Electric | 18-I61E | TemBreak 2 Moulded Case Circuit Breakers 16A to 1600A — The Ultimate Safety Breaker (Catalogue) | Catalogue No. 18-I61E (ไฟล์ 18-I61E_web_19.04.03.pdf บน terasaki.co.jp ; เมตาดาตา PDF ระบุชื่อ 16-I61E สร้าง 2015-11-26) — แคตตาล็อก TemBreak 2 ฉบับสหราชอาณาจักร ; รุ่นต่อมาคือ TemBreak PRO ควรตรวจกับแคตตาล็อกล่าสุด | 204 | `1ce8bd800bdd9404…` | 16–21 (พิมพ์ 15–20) ตาราง MCCB Electrical characteristics : In 45 °C, Icu/Ics 400/415 V, Utilisation category ; 7 Easy Selection Guide (ยืนยันซ้ำ Icu) |
| `HAG-H3P-CAT-IT-2023` | Hager | HA_32110426 | h3+ — Catalogo tecnico interruttori automatici scatolati fino a 630 A (P160, P250, P630) | ภาษาอิตาลี, PDF สร้าง 2023-03-10 (ไฟล์ P160-P250-P630_MANUALE-USO.pdf บน assets.hager.com) ; ตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง | 198 | `505a75de2f482c90…` | 18 ตารางคุณสมบัติทั่วไป : Icu/Ics @380/415 V ตามระดับ H/N/M/E/S/P, Util ; 22–23 sganciatori TM : ช่วงปรับแม่เหล็ก Ii ; 166–181 รายการอ้างอิง : In ที่สั่งซื้อและป้ายกลุ่ม Icu/Ics (TM p.168/174/178 ; LSnI/LSI/LSIG/Energy p.171–173/175–177/179–181) |
| `TER-TBP-23I68E` | Terasaki Electric | 23-I68E | TemBreak PRO Moulded Case Circuit Breakers — IoT with SMART MCCB (Catalogue) | Catalogue No. '23-I68E (ไฟล์ 23-I68E_web_24.6.28.pdf บน terasaki.co.jp ; PDF สร้าง 2023-11-24) ; ตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง | 632 | `bcb8349bc1f3db93…` | 26–39 บทที่ 2 ตาราง Ratings and Specifications : Frame size, Type, poles, Rated current (Calibrated at 40°C/45°C), Icu/Ics แถว 415V (ยืนยันเทียบแถว 380V), Utilization Category, Overcurrent trip mechanism |

### URL และ checksum ฉบับเต็ม

- `SE-LVPED221001EN` — <https://www.se.com/us/en/download/document/LVPED221001EN/> · <https://download.schneider-electric.com/files?p_enDocType=Catalog&p_File_Name=LVPED221001EN.pdf&p_Doc_Ref=LVPED221001EN> (เข้าถึง 2026-10-19, 93.5 MB, SHA-256 `8eb77f29749121ded86fb55beb2b284ab1287706c369beaae0920b12a17ef58c`)
- `SE-LVED212091EN` — <https://www.se.com/ph/en/download/document/LVED212091ENWEB/> · <https://download.schneider-electric.com/files?p_Doc_Ref=LVED212091ENWEB&p_enDocType=Catalog&p_File_Name=LVED212091EN-EZC-catalog-2024-09-24.pdf> (เข้าถึง 2026-10-19, 12.8 MB, SHA-256 `e16607c1526eeb78a70fec680dc45227dc2827743bd5a6554b4dc0af2c633d53`)
- `ABB-1SDC210100D0206` — <https://library.abb.com/d/1SDC210100D0206> · <https://search.abb.com/library/Download.aspx?DocumentID=1SDC210100D0206&LanguageCode=en&DocumentPartId=&Action=Launch> (เข้าถึง 2026-10-19, 73.8 MB, SHA-256 `68fa57c2e62198875abb8a9e7f1525804655ecf499fa99c516b3017d331df553`)
- `ABB-1SDC210401D0201` — <https://library.abb.com/d/1SDC210401D0201> · <https://search.abb.com/library/Download.aspx?DocumentID=1SDC210401D0201&LanguageCode=en&DocumentPartId=&Action=Launch> (เข้าถึง 2026-10-19, 11.6 MB, SHA-256 `e38c6ba661ee74a2aa8879a39ba0ae905bba082a228404854d952294a28987c4`)
- `MIT-Y0720J2309` — <https://us.mitsubishielectric.com/fa/en/support/technical-support/knowledge-base/getdocument/?docid=3E26SJWH3ZZR-38-3308> · <https://us.mitsubishielectric.com/fa/en/products/lvd/circuit-breakers/molded-case/> (เข้าถึง 2026-10-19, 30.3 MB, SHA-256 `63570f58a77b52564dfe5841bf3dfeb93de2f06485ecb083bdc105f84939984d`)
- `LEG-F01360EN-09` — <https://assets.legrand.com/pim/NP-FT-GT/F01360EN_09.pdf> (เข้าถึง 2026-10-19, 5.0 MB, SHA-256 `61fc40df6f46b12a419f57b39d6752e1fd6e56ae1814c910b7ca1a618a8c80f2`)
- `LEG-F01364EN-07` — <https://assets.legrand.com/pim/NP-FT-GT/F01364EN_07.pdf> (เข้าถึง 2026-10-19, 2.8 MB, SHA-256 `a3456e8a28de76cc70c973f1ef958eacc59774135d5e354e5d953287943439d7`)
- `LEG-F01958EN-06` — <https://assets.legrand.com/pim/NP-FT-GT/F01958EN_06.pdf> (เข้าถึง 2026-10-19, 4.7 MB, SHA-256 `f0283c0315c1dd59b74ebc3c76b88b2113a9d9ae22c421d07b1535d13c753bb9`)
- `LEG-F01963EN-05` — <https://assets.legrand.com/pim/NP-FT-GT/F01963EN_05.pdf> (เข้าถึง 2026-10-19, 2.4 MB, SHA-256 `5b3e18fbd1a0af365accfd438f84d2b2d9b12ececf0ed15ad9049ed553c6c527`)
- `SIE-LV10-2023-10` — <https://assets.new.siemens.com/siemens/assets/api/uuid:77ecee1e-a769-4de2-8f27-0a6d1e23559f/Catalogo-Disjuntores-3VA-LV10-2023-10-EN-.pdf> (เข้าถึง 2026-10-19, 10.3 MB, SHA-256 `aa72dac7ca57a745ff60a7bb9e6b3d97342779d5eb17996dc28d670e8123df30`)
- `LS-METASOL-MANUAL` — <https://www.ls-electric.com/upload/customer/download/1213/Metasol_MCCB-ELCB_Technical%20Manual_E.pdf> (เข้าถึง 2026-10-19, 15.8 MB, SHA-256 `5b0d1f5febb5b5768dbe026cafc434899635f5cb8d6a182f89f8e11643be3737`)
- `FUJ-62D1-E-0202` — <https://www.th.fujielectric.com/en/products/62D1-E-0202.pdf> (เข้าถึง 2026-10-19, 7.5 MB, SHA-256 `16e8caa7ffc59543f2f5e0574b6738ac9635c45fb042e3297261137b10739501`)
- `CHINT-NM8N-CATALOG` — <https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/secondary-power-distribution/mccb/nm8n/catalog/NM8N-MCCB-Catalog.pdf> (เข้าถึง 2026-10-19, 12.1 MB, SHA-256 `d176563d4d25f3e01aec109562f8bd3514df08b0c10da3666d189a42e1d52cda`)
- `SE-LVED210011EN` — <https://www.se.com/in/en/download/document/LVED210011EN/> · <https://download.schneider-electric.com/files?p_Doc_Ref=LVED210011EN&p_enDocType=Catalog&p_File_Name=LVED210011EN-EasyPact+CVS+Catalog-2024.pdf> (เข้าถึง 2026-10-19, 20.4 MB, SHA-256 `b612b0a75439afd655f33cc98c8cfc24de5f86d314b024128a57529e92a10681`)
- `SIE-LV31-2018` — <https://assets.new.siemens.com/siemens/assets/api/uuid:607ac5d3-e5c1-42d3-bd80-a3194aa12551/version:1572547674/disjuntores-3vm-catalogo-lv31-en.pdf> (เข้าถึง 2026-10-19, 20.0 MB, SHA-256 `03f23d93a42ab4b68777599118ebd4d3e68322472820b99c0ac0142aa03124b3`)
- `HAG-H3-CAT-2024` — <https://assets.hager.com/step-content/P/HA_79103074/Document/std.lang.all/h3%20MCCB%20Catalogue_2024.pdf> (เข้าถึง 2026-10-19, 9.9 MB, SHA-256 `8b7d1ee89a36408de5eb94245bf309cca53dc5351d74e18fa60cb04fe4e41b5a`)
- `LEG-F00699EN-06` — <https://assets.legrand.com/pim/NP-FT-GT/F00699EN06_DRX125.pdf> (เข้าถึง 2026-10-19, 1.0 MB, SHA-256 `64b0f9affa65faf9ee92f086beed9f5a556eaa0366b2182c7f8c23e42203b8f1`)
- `LEG-F00703EN-05` — <https://assets.legrand.com/pim/NP-FT-GT/F00703EN05_DRX250.pdf> (เข้าถึง 2026-10-19, 1.0 MB, SHA-256 `ee6ba3b9988ddb880ed91f865e36c4ae211c66089f6dafdc55683dd24e66bbad`)
- `LEG-F02406EN-00` — <https://assets.legrand.com/pim/NP-FT-GT/F02406EN00_DRX630_adjENG_v2.0.pdf> (เข้าถึง 2026-10-19, 0.6 MB, SHA-256 `be0ee7ab1d25b6df3aaaefeb76e1a199873e1b2e53fb42cff80aad440accf095`)
- `WEG-50040542` — <https://static.weg.net/medias/downloadcenter/h2c/h1e/50040542_spanish_web.pdf> (เข้าถึง 2026-10-19, 6.6 MB, SHA-256 `b0bd80d9b8fe51592687e1e948f14ba1580f8494509e9c76a75e2b6818a7bb31`)
- `CHINT-NM1-CATALOG` — <https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/secondary-power-distribution/mccb/nm1/catalog/NM1-MCCB-Catalog.pdf> (เข้าถึง 2026-10-19, 3.4 MB, SHA-256 `31f6664a64eacee36249e3637275388e8a2161f8714c9842bc6aba8c03dde5c5`)
- `HD-HG-MCCB-2026` — <https://www.hd-hyundaielectric.com/elect/en/customer/download.jsp> (เข้าถึง 2026-10-19, 44.5 MB, SHA-256 `df9cd0141874720c36b70551e969248126bc281a5d32dfefb2c8943047176b92`)
- `LS-SUSOL-CAT-V31` — <https://www.ls-electric.com/ko/cat/%5BSusol_MCCB%5D_EN_C01092-31-202509.pdf> (เข้าถึง 2026-10-19, 74.2 MB, SHA-256 `69f5892b7b032c46d4f9679b622af7dcb0ce258fb10f10879d84dac8da94d858`)
- `TER-TB2-18I61E` — <https://www.terasaki.co.jp/english/files/business/breaker/18-I61E_web_19.04.03.pdf> (เข้าถึง 2026-10-19, 12.2 MB, SHA-256 `1ce8bd800bdd940484fca2f7dfe5f02d04ae44f5d289c1a1e6a1eb4fa304ab31`)
- `HAG-H3P-CAT-IT-2023` — <https://assets.hager.com/step-content/P/HA_32110426/Document/std.lang.all/P160-P250-P630_MANUALE-USO.pdf> (เข้าถึง 2026-10-19, 30.3 MB, SHA-256 `505a75de2f482c90f8342739404d1fd8c3dcc3cd074fffe0c459095350fa3664`)
- `TER-TBP-23I68E` — <https://www.terasaki.co.jp/english/files/business/breaker/23-I68E_web_24.6.28.pdf> (เข้าถึง 2026-10-19, 61.1 MB, SHA-256 `bcb8349bc1f3db934b0e989a8ff18c1bfa7e9a9e44e57f96af9735c3d786ceca`)

ไฟล์ PDF ไม่ถูกเก็บในรีโป (ใหญ่/ลิขสิทธิ์ผู้ผลิต) แต่ดาวน์โหลดซ้ำได้จาก URL ด้านบน และตรวจว่าเป็นไฟล์เดียวกันด้วย SHA-256. เลขหน้าในแอปคือ **เลขหน้า PDF** (เลขหน้าพิมพ์ในเล่มอาจต่างกัน — ระบุไว้ในหมายเหตุของแต่ละรุ่น).

## กติกาการอ่านค่า (ใช้กับทุกยี่ห้อ)

- **Icu/Ics ที่ 415 V** (ถ้าตารางรวม 380…415 V หรือ 400/415 V ใช้แถวนั้น; ถ้าตารางแยก 400 V กับ 415 V ใช้ 415 V ซึ่งต่ำกว่าหรือเท่ากันเพื่อความปลอดภัย และใส่ค่า 400 V ไว้ในหมายเหตุ). Mitsubishi ใช้เฉพาะช่องแรเงา (ค่า rated) ของแถว 415 V.
- **Ics** เก็บเป็นเปอร์เซ็นต์ของ Icu (ปัดทศนิยม 2 ตำแหน่ง) — ตัวแอปคำนวณ Ics กลับเป็น kA ได้ตรงกับตาราง (เช่น 85/43 kA, 125/63 kA).
- **AT (พิกัด In)** = In ที่เป็นตัวเลือกสั่งซื้อตามตาราง; ค่าในวงเล็บที่เอกสารระบุว่า "ผลิตเมื่อสั่ง" ไม่นำเข้า; รุ่นที่ปรับกระแสเป็นช่วง (เช่น 125-160 A) ใช้ค่าสูงสุดของช่วง.
- **Ii (ค่าตัดทันที)** ใส่เป็นตัวเลขก็ต่อเมื่อตารางให้ตัวเลขจริง: ค่าคงที่ใช้ค่าต่ำสุดของรายการ AT; ค่าที่ปรับได้ใช้ขอบล่างของช่วง; ไม่ใส่ค่าที่หักความคลาดเคลื่อน. ถ้าเอกสารให้เป็นกราฟ → เว้นว่างทั้ง `Ii_Default_Mult` และ `Min_Ii_Amp_Num` (ต้องว่างพร้อมกันเสมอ) แล้วตัวคำนวณใช้ 10×In.
- **selectivity ต่อ MCB** (`Max_Selectivity_vs_MCB_kA`) เว้นว่างทุกรุ่นที่ยืนยัน — แคตตาล็อกให้เป็นตาราง cascading/selectivity แยกตามคู่รุ่น ไม่ใช่ตัวเลขเดียวต่อรุ่น.
- **ขั้ว**: นำเข้าเฉพาะ 3P/4P (1P/2P ไม่ใช้กับวงจร 3 เฟส และ Icu มักต่างจาก 3P).
- รุ่นที่ไม่มีตัวเลข 415 V ในตาราง (เช่น BW100AAG) ไม่นำเข้า; รุ่นป้องกันมอเตอร์/DC/Global-UL ไม่นำเข้า.
- Trip แบบ "TM + อิเล็กทรอนิกส์" ในแถวเดียวถือเป็น TM (กรณีแย่กว่า) ; รุ่นอิเล็กทรอนิกส์ล้วนถูกทำเครื่องหมาย `electronic` ซึ่ง **ตัวคำนวณ selectivity ใช้อัตราส่วน 1.25 กับต้นทางแบบอิเล็กทรอนิกส์** (สมมติฐานของแอป ไม่ได้มาจากแคตตาล็อก — ดู engine.js `pair()`).
- **Icu ที่ต่างกันตามช่วง In** (เชิงอรรถในตาราง) → แยกเป็นหลายแถวตามช่วง In เช่น WEG DWB160N (In 16–32 A = 20 kA ; 40–160 A = 30 kA), Terasaki S160-NJ (In 20 และ 32 A = 30/25 kA ตามเชิงอรรถ *).
- **ค่าที่เอกสารให้ขัดกัน** (ตารางสองแห่งในเล่มเดียวกันหรือสองฉบับของผู้ผลิต) ไม่นำเข้าค่านั้นแล้วบันทึกเหตุผลใน `Source_Note` เช่น WEG DWB400H (แคตตาล็อก 2015 = 65 kA, แผ่นพับ 2016 = 50 kA ที่ 415 V), LS TD100 In 50 A/60 A (หน้า 40 กับหน้า 45 ไม่ตรงกัน), CHINT NM1-250C/NM1-800S (อยู่เฉพาะตารางหน้า 3), Terasaki S125-NJ/S125-GJ (Ics "36/30", "36/33" ไม่มีคำอธิบาย).
- **เชิงอรรถที่แยก 400 V กับ 415 V** ใช้ค่า 415 V แล้วใส่ค่า 400 V ในหมายเหตุ (Terasaki S1250-GE และ S1600-NE = 85/65 kA ที่ 415 V ; 100/75 kA ที่ 400 V). ค่าที่ผู้ผลิตรวมเป็นแถว 415/440/460 V (HD Hyundai HGM30–250) ใช้แถวนั้นเพราะรวม 415 V.
- **In ในวงเล็บ** ที่ผู้ผลิตระบุข้อจำกัดอื่นที่ไม่ใช่ "ผลิตเมื่อสั่ง" (LS TS160 In (100) A ที่ ATU ไม่มีให้) ก็ไม่นำเข้าเช่นกัน เพื่อไม่ตีความเอง.
- **หน่วยตัดอิเล็กทรอนิกส์ที่ตั้งกระแสได้หลายค่า** (Terasaki TemBreak PRO รุ่น …E, Hager h3+ LSI/Energy) ใช้ทุกค่า In ที่เอกสารระบุในแถว Rated current / รายการอ้างอิง (ไม่ตัดเหลือค่าสูงสุดอย่างเดียว) และบันทึกไว้ในหมายเหตุ ; เฟรมเกิน 1600 A (Terasaki XS2000NE/XS2500NE/XS3200NE) ไม่นำเข้าเพราะอยู่นอกช่วง MCCB ของแอป.

## ข้อมูลเดิมที่ถูกแทนที่เพราะไม่ตรงแคตตาล็อก (ตัวอย่าง)

- Mitsubishi WS-V: แถวเดิม NF63-CV ระบุ Icu 10 kA แต่แคตตาล็อกหน้า 20 ให้ 2.5/2.5 kA ที่ 415 V; รุ่น NF30-CS, NF100-CV, NF160-CV ไม่อยู่ในตาราง Detailed Specifications.
- LS Metasol: แถวเดิมใช้ Ics 50% กับ ABN แต่คู่มือให้ Ics = 100% × Icu.
- Siemens 3VM: ข้อมูลเดิม Ics 75% ทั้งหมด แต่แคตตาล็อก LV 31 ให้ 3VM10 = 8/12/12 kA ฯลฯ.
- Schneider NSX/EZC, ABB XT/Formula, Legrand DPX³, Siemens 3VA, Fuji G-TWIN, CHINT NM8N, EasyPact CVS: แถวเดิมถูกแทนที่ทั้งซีรีส์ (ชื่อรุ่นเดิมที่ไม่มีในแคตตาล็อก เช่น "Formula DSP" ถูกลบ).
- Schneider: เลขเอกสารเก่า MKTED210011EN / LVPED209003EN / LVPED221002EN ตอบ 404 บนเว็บผู้ผลิต จึงถือว่าตรวจสอบไม่ได้.
- Terasaki: ซีรีส์ "TemBreak PRO" เดิม 11 แถว (E125-NJ, S160-NJ, E250-NJ, S250-NJ, B250-NJ, E400-NJ, S400-NE, XS630-NJ, XS800-NJ, XS1250-SE, XS1600-SE) — ชื่อรุ่นที่มีจริงเป็นของ **TemBreak 2** (แคตตาล็อก 18-I61E) ส่วน B250-NJ/XS630-NJ/XS800-NJ/XS1250-SE/XS1600-SE ไม่มีในแคตตาล็อก ; แทนที่ด้วยซีรีส์ "TemBreak 2" 44 รุ่น และเพิ่มซีรีส์ "TemBreak PRO" จริง 67 รุ่นจากแคตตาล็อก 23-I68E (รุ่นที่ชื่อซ้ำกับ TemBreak 2 ต่อท้าย "(PRO)").
- HD Hyundai: แถวเดิม HGD100/HGD250 (MCCB) — แคตตาล็อก HG-MCCB ปัจจุบันใช้ HGD32/63/125 เป็นลูกข่ายขนาดเล็กในตาราง cascading ไม่ใช่ MCCB ; ถอดออก แล้วนำเข้า HGM30–HGM800 (30 รุ่น) แทน.
- Legrand DRX เดิม Icu 16/25/36 kA Ics 50% : แคตตาล็อกให้ DRX 125 = 10/20/36 kA (Ics 100/75/50%), DRX 250 = 18/25/36 kA (100/75/50%), DRX 630 = 36/50 kA (100%).
- Hager h3 เดิม (x160/x250/h1000/h1600 Icu 25–50 kA Ics 75–100%) : ค่าจริง x160 = 18/25/40 kA (Ics 18/20/25), x250 = 25/40 kA (Ics 20/20), h800 = 50/70 kA, h1000/h1600 = 50/70 kA (Ics 50) ; รุ่น "h250/h630 Energy" ของ h3+ ไม่อยู่ในแคตตาล็อกฉบับนี้.
- Hager h3+: แถวเดิม "h250 Energy" (40/100/160/250 A) และ "h630 Energy" (250/400/630 A) Icu 50 kA Ics 100% ไม่ตรงคู่มือเทคนิค h3+ — P250 ระดับ M = 50/50 kA แต่ระดับ E = 70/50 kA, P630 ระดับ M = 50/50 และ E = 70/70 kA ; In ของ Energy คือ 40/100/160/250 A (P250) และ 250/400/630 A (P630) ; แทนที่ด้วย 27 รุ่น.
- WEG: แถวเดิม DWB160B (Icu 25 kA) ไม่ตรงแคตตาล็อก (DWB160B = 16 kA ที่ 380-415 V) และ DWB800N/DWA1600N (อิเล็กทรอนิกส์ 50/65 kA) ไม่มีในเล่ม — ตระกูล 800 A คือ DWA800 N/H (35/65 kA, thermal-magnetic) ; DWA1600 = S/H 50/65 kA.
- CHINT NM1: ค่า Icu เดิมของ NM1-125S/250S/400S/630S (25/25/35/35 kA, Ics 50%) ตรงแคตตาล็อก แต่ขาดระดับ C/H/R และเฟรม 63/800/1250 ; รายการ AT เดิมถูกแทนที่ตามแถว Rated current (เช่น 125S เดิม 16–125 A → 25–125 A).
- LS Susol: Icu ระดับ N เดิมตรงแคตตาล็อก v31 แต่ขาดระดับ H/L และเฟรม TS100/TS160 ; ชนิด trip เดิมของ TS250–TS800 ระบุอิเล็กทรอนิกส์ล้วนขณะที่แคตตาล็อกมีทั้ง TM (FTU/FMU/ATU) และอิเล็กทรอนิกส์ (ใช้ TM เป็นกรณีแย่กว่า) ; รายการ AT เดิม (เช่น TS250N 100–250 A) ถูกแทนที่ตามตาราง.
- LS Susol TS1600N เดิม (Icu 75 kA, AT 1000/1250/1600 A): แคตตาล็อก v31 หน้า 110 ให้ TS1600N = 50 kA (H = 70 kA, Ics 75%), In 1600 A เท่านั้น ; TS1000 (N/H/L) และ TS1250 (N/H) เพิ่มเข้ามา.

## ข้อจำกัดที่ควรรู้

- เอกสารบางฉบับเก่า: Fuji G-TWIN (2016, "subject to change"), LS Metasol (ก่อนบริษัทเปลี่ยนชื่อเป็น LS ELECTRIC), Siemens 3VM (2018), Legrand DRX (เอกสารข้อมูลทางเทคนิค 2014/2016), WEG (แคตตาล็อกภาษาสเปน 2015), Terasaki TemBreak 2 (ฉบับ web 2019 — รุ่นต่อมาคือ TemBreak PRO), Hager h3+ (คู่มือเทคนิคภาษาอิตาลี 2023), LS Susol (v31 2025). ควรตรวจกับแคตตาล็อกล่าสุดก่อนใช้งานจริง.
- ยังไม่ผูกแหล่ง (รอบที่ 3, 2026-10-19):
  - **Eaton NZM (7 รุ่น)**: ไฟล์ทางการ `eaton.com/content/dam/eaton/products/electrical-circuit-protection/circuit-breakers/india/nzm/01_NZM MCCB Catalog.pdf` (4.2 MB) เปิดได้ในเบราว์เซอร์ในแอปเท่านั้น — curl ถูกตัด (HTTP/2 INTERNAL_ERROR แล้ว timeout) ; จากเบราว์เซอร์บันทึกลงโฟลเดอร์ scratchpad ไม่ได้ (หน้า PDF ต่อ localhost ไม่ได้, ส่งไบต์ผ่านผลลัพธ์เครื่องมือไม่คุ้ม, การฝัง pdf.js ในหน้าบุคคลที่สามถูกปฏิเสธ) และอ่านด้วยพิกัดคำ + SHA-256 ตามขั้นตอนไม่ได้ จึงไม่นำเข้า.
  - **Shihlin BM (7 รุ่น)**: `global.seec.com.tw` (ที่มีแคตตาล็อก MCCB_ELCB_MCB.pdf) ตอบ HTTP 403 "Access Denied" ทั้งจาก curl และเบราว์เซอร์ในแอป ; เว็บ `www.seec.com.tw` (ไต้หวัน) ไม่มีแคตตาล็อก MCCB ในหน้าดาวน์โหลดแบบ static.
  - **GE Record Plus (6 รุ่น)**: ผู้ผลิตปัจจุบันคือ ABB ; โบรชัวร์ ABB 9AKK107680A0141 ยืนยันเฟรม FD160/FE250/FG630/FK1600 และช่วง 22–150 kA เท่านั้น ไม่มีตาราง Icu/Ics ที่ 415 V รายรุ่น (ข้อมูล Record Plus ใน empower.abb.com เป็นแบบ UL ต่อ catalogue number).
  - **Schneider ComPacT NS (4 รุ่น)**: แคตตาล็อก LVPED221008EN ไม่มีตาราง Ics ที่ชัดเจน — คงสถานะไม่ยืนยัน (หน้าสินค้า se.com ให้ Icu 50 kA ที่ 415 V ของ NS800N/NS1600N แต่ไม่ใช่ตารางแคตตาล็อก).
  - **HD Hyundai U-Series (6 รุ่น)**: ไม่อยู่ในแคตตาล็อก HG-MCCB ปัจจุบัน (สายผลิตภัณฑ์เก่า).
- รุ่นที่มี Ii ว่าง (เช่น Mitsubishi, Fuji, CHINT NM8N, Siemens 3VA) ใช้ค่าตัดทันทีทั่วไป 10×In ในการตรวจ selectivity.

## วิธีเพิ่มแหล่งใหม่

1. ดาวน์โหลด PDF จากเว็บผู้ผลิตลงโฟลเดอร์แยก (ไม่รันโค้ดจากไฟล์) แล้วบันทึก SHA-256/ขนาด/จำนวนหน้า.
2. อ่านตารางด้วยพิกัดคำ (PyMuPDF `get_text('words')`) **และ** ดูภาพหน้านั้นยืนยัน โดยเฉพาะเซลล์ที่รวมหลายคอลัมน์.
3. เพิ่มรายการใน `data/brands/sources.json` (โดเมนต้องเป็นของผู้ผลิต — เพิ่มโดเมนใน `OFFICIAL` ของ `tests/brand-sources.test.js`).
4. เขียนเทสต์ golden ก่อน (ค่าที่อ่านจากตาราง + หน้า) แล้วจึงเพิ่มแถวใน `data/brands/mccb.csv` (คอลัมน์ `Source_ID`, `Source_Page`, `Source_Note`).
5. `node tools/import-brands.js` แล้วรัน `node tests/run-all.js`.
