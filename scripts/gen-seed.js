#!/usr/bin/env node
'use strict';
// สร้าง sql/seed-demo-presets.sql — โครงการตัวอย่างทางการ (is_official_preset = true, ไม่หมดอายุ) จาก public/presets/manifest.json (แหล่งเดียวกับที่แอปใช้เมื่อไม่ต่อ Supabase)
//   node scripts/gen-seed.js
// รันไฟล์ที่ได้ใน Supabase SQL Editor "หลัง" sql/supabase-demo-schema.sql (ต้องรันด้วยสิทธิ์เจ้าของโปรเจกต์ — anon ตั้ง is_official_preset เองไม่ได้)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');


const PRE = path.join(ROOT, 'public/presets');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PRE, 'manifest.json'), 'utf8'));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const out = ['-- สร้างโดย scripts/gen-seed.js — อย่าแก้มือ ; รันหลัง supabase-demo-schema.sql (สิทธิ์เจ้าของโปรเจกต์)', 'begin;', 'delete from public.demo_projects where is_official_preset;'];
const add = (m, project) => {
  const json = JSON.stringify(project);
  if (json.includes('$json$')) throw new Error('JSON มี delimiter $json$');
  out.push(`insert into public.demo_projects (title, description, project_data, is_official_preset, expires_at) values (${q(m.title)}, ${q(m.description)}, $json$${json}$json$::jsonb, true, null);`);
};
MANIFEST.forEach((m) => add(m, JSON.parse(fs.readFileSync(path.join(PRE, m.file), 'utf8'))));
out.push('commit;', '');
fs.mkdirSync(path.join(ROOT, 'sql'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sql/seed-demo-presets.sql'), out.join('\n'));
console.log('เขียน sql/seed-demo-presets.sql แล้ว (' + out.filter((l) => l.startsWith('insert into')).length + ' โครงการ)');
