// ค่าตั้งของเวอร์ชันสาธิต — ไฟล์นี้ตั้งใจให้ "แก้/เขียนทับตอน deploy" (scripts/build-demo.js เขียนทับจาก environment)
// ห้ามใส่คีย์ฝั่งเซิร์ฟเวอร์ (secret / role สูง) หรือความลับใด ๆ ที่นี่: ไฟล์นี้ถูกส่งถึงเบราว์เซอร์ทุกคน (anon key ปลอดภัยได้เฉพาะเมื่อเปิด RLS ตาม sql/supabase-demo-schema.sql)
(function (root) {
  'use strict';
  root.DEMO_CONFIG = {
    enabled: true,                                   // false = เปิดฟีเจอร์เต็มในเครื่อง (ไม่มีลายน้ำ/ไม่ล็อกส่งออก) ใช้เฉพาะตอนพัฒนา
    ownerName: 'Photsawat Suksombat',
    ownerRole: 'Electrical Engineer & Developer',
    watermarkText: 'Ver.DEMO — Made by Photsawat Suksombat',
    watermarkSubText: 'FOR DEMONSTRATION ONLY • NOT FOR CONSTRUCTION OR SUBMISSION',
    redirectUrl: 'https://www.linkedin.com/in/photsawat-suksombat', // ลิงก์โปรไฟล์ LinkedIn ผู้พัฒนา
    contactEmail: '',                                // เว้นว่าง = ไม่แสดง
    allowProjectJson: false,                         // true = อนุญาตบันทึกไฟล์โครงการ .json (ข้อมูลที่ผู้ใช้กรอกเอง ไม่มีผลคำนวณ)
    supabaseUrl: '',                                 // เช่น https://<project-ref>.supabase.co  (เว้นว่าง = ปิดฟีเจอร์ Supabase ทั้งหมด)
    supabaseAnonKey: ''                              // publishable/anon key เท่านั้น
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
