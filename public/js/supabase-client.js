/*
 * SupabaseDemo — ตัวเชื่อม Supabase ของเวอร์ชันสาธิต (REST โดยตรง ไม่ต้องลงแพ็กเกจ)
 *  - ใช้ anon/publishable key เท่านั้น ความปลอดภัยมาจาก RLS + column grants + RPC ใน sql/supabase-demo-schema.sql
 *  - ข้อมูลที่ดึงมาผ่าน Sanitize.project() เสมอ ก่อนเข้า engine
 *  - เปิดใช้เมื่อ DEMO_CONFIG.supabaseUrl เป็น https://<ref>.supabase.co และมี supabaseAnonKey ; ไม่ตั้งค่า = ทุกฟังก์ชันคืนค่าว่างโดยไม่ยิงเครือข่าย
 */
(function (root) {
  'use strict';

  const C = root.DEMO_CONFIG || {};
  const URL_OK = /^https:\/\/[a-z0-9-]{3,40}\.supabase\.co$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MAX_JSON = 150000;            // ตัวอักษรของ project_data ที่ยอมส่ง (ฐานข้อมูลจำกัดที่ 200 KB)
  const TIMEOUT = 6000;

  const base = () => String(C.supabaseUrl || '').replace(/\/+$/, '');
  const isConfigured = () => URL_OK.test(base()) && typeof C.supabaseAnonKey === 'string' && C.supabaseAnonKey.length > 20;
  const validId = (id) => UUID.test(String(id || ''));

  function headers(extra) {
    return Object.assign({ 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, extra || {});
  }
  async function req(path, opts) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
    try {
      const f = root.fetch ? root.fetch.bind(root) : fetch;
      return await f(base() + path, Object.assign({ credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined }, opts));
    } finally { if (t) clearTimeout(t); }
  }

  // ชื่อรูปแบบไฟล์ → ค่าในชุดที่ฐานข้อมูลยอมรับ (check constraint ฝั่งเซิร์ฟเวอร์)
  function normFormat(name) {
    const s = String(name || '');
    if (/pdf|พิมพ์|print/i.test(s)) return 'PDF';
    if (/csv/i.test(s)) return 'CSV';
    if (/xlsx|excel/i.test(s)) return 'XLSX';
    if (/dxf|cad/i.test(s)) return 'DXF';
    if (/json/i.test(s)) return 'JSON';
    return 'OTHER';
  }
  const clientKind = () => (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') ? 'mobile' : 'desktop');

  // 1) รายการโครงการตัวอย่างทางการ (อ่านได้ตรง ๆ ผ่าน RLS: เฉพาะ is_official_preset = true)
  async function listPresets() {
    if (!isConfigured()) return [];
    const r = await req('/rest/v1/demo_projects?is_official_preset=eq.true&select=id,title,description&order=created_at.asc&limit=50', { headers: headers() });
    if (!r.ok) throw new Error('โหลดรายการโครงการตัวอย่างไม่ได้');
    const rows = await r.json();
    return Array.isArray(rows) ? rows.filter((x) => validId(x.id)).map((x) => ({ id: x.id, title: String(x.title || '').slice(0, 120), description: String(x.description || '').slice(0, 300) })) : [];
  }

  // 2) โหลดโครงการตามรหัส (ตัวอย่างทางการหรือลิงก์แชร์) ผ่าน RPC — โครงการที่แชร์ไม่สามารถไล่ดูทั้งตารางได้ ต้องรู้ UUID เท่านั้น
  async function loadProject(id) {
    if (!isConfigured()) return null;
    if (!validId(id)) throw new Error('รหัสโปรเจกต์ไม่ถูกต้อง');
    const r = await req('/rest/v1/rpc/get_demo_project', { method: 'POST', headers: headers(), body: JSON.stringify({ p_id: id }) });
    if (!r.ok) throw new Error('ไม่พบโปรเจกต์ที่แชร์ (อาจหมดอายุแล้ว)');
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || !row.project_data) return null;
    const raw = row.project_data;
    const clean = root.Sanitize ? root.Sanitize.project(raw).project : raw;
    return { id, title: String(row.title || '').slice(0, 120), project: clean };
  }

  // 3) สร้างลิงก์แชร์: id สร้างฝั่งเบราว์เซอร์ (UUID v4 เดายาก) ส่งเฉพาะคอลัมน์ที่ anon มีสิทธิ์ (id, title, project_data) ; ตัดโลโก้ออก (ส่วนตัว/ขนาดใหญ่)
  async function saveShareableDemo(title, projectObj) {
    if (!isConfigured()) throw new Error('ยังไม่ได้ตั้งค่า Supabase');
    if (!(root.crypto && root.crypto.randomUUID)) throw new Error('เบราว์เซอร์ไม่รองรับการสร้างรหัสลิงก์');
    const clean = JSON.parse(JSON.stringify(root.Sanitize ? root.Sanitize.project(projectObj).project : projectObj));
    if (clean.meta) clean.meta.logo = '';
    const body = JSON.stringify({ id: root.crypto.randomUUID(), title: String(title || 'Shared Demo Project').slice(0, 120), project_data: clean });
    if (body.length > MAX_JSON + 400) throw new Error('โครงการใหญ่เกินกว่าจะแชร์ (> 150 KB)');
    const payload = JSON.parse(body);
    const r = await req('/rest/v1/demo_projects', { method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body });
    if (r.status === 429 || r.status === 403) throw new Error('สร้างลิงก์ถี่เกินไป — ลองใหม่ภายหลัง');
    if (!r.ok) throw new Error('สร้างลิงก์แชร์ไม่ได้');
    return payload.id;
  }

  // 4) สถิติความสนใจเมื่อกดปุ่มที่ถูกล็อก: เก็บเฉพาะ ชนิดไฟล์ + เดสก์ท็อป/มือถือ (ไม่เก็บชื่อโครงการ, ไม่เก็บ User-Agent, ไม่เก็บ IP)
  async function logExportAttempt(formatName) {
    if (!isConfigured()) return;
    await req('/rest/v1/demo_export_logs', { method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify({ attempted_format: normFormat(formatName), client_kind: clientKind() }) });
  }

  root.SupabaseDemo = { isConfigured, listPresets, loadProject, saveShareableDemo, logExportAttempt, normFormat, validId };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SupabaseDemo;
})(typeof globalThis !== 'undefined' ? globalThis : window);
