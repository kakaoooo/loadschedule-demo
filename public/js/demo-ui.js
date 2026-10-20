/*
 * Demo UI — แถบเครื่องมือของเวอร์ชันสาธิต: ตัวอย่างโครงการ · แชร์ลิงก์ (?demo=<uuid>) · ป้าย Ver.DEMO
 *  - ตัวอย่างโครงการมา 2 แหล่ง: ไฟล์ในเว็บ (public/presets/manifest.json — ใช้ได้เสมอแม้ไม่ต่อ Supabase) และ Supabase (ถ้าตั้งค่าไว้)
 *  - แชร์ลิงก์/?demo= ใช้เมื่อตั้งค่า Supabase เท่านั้น
 * ต้องโหลดหลัง app.js (ใช้ window.DemoHooks ที่ app.js เปิดให้เฉพาะโหมดสาธิต)
 */
(function (root) {
  'use strict';
  const G = root.DemoGuard, S = root.SupabaseDemo, H = root.DemoHooks;
  if (!G || !G.isDemo() || !H || typeof document === 'undefined') return;

  const el = (tag, attrs, text) => { const e = document.createElement(tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); if (text != null) e.textContent = text; return e; };
  const cfg = G.config;
  const configured = !!(S && S.isConfigured && S.isConfigured());
  const SAFE_FILE = /^[a-z0-9_-]{1,40}\.json$/;

  async function openLocal(file) {
    if (!SAFE_FILE.test(String(file))) { H.toast('ชื่อไฟล์ตัวอย่างไม่ถูกต้อง'); return false; }
    try {
      const r = await fetch('presets/' + file, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (H.apply(await r.json()) === false) return false;
      return true;
    } catch (e) { H.toast('เปิดตัวอย่างไม่สำเร็จ: ' + (e.message || e)); return false; }
  }
  async function openShared(id) {
    try {
      const r = await S.loadProject(id);
      if (!r) { H.toast('ไม่พบโปรเจกต์ที่แชร์'); return false; }
      if (H.apply(r.project) === false) return false;
      H.toast('เปิดโครงการ "' + (r.title || 'ตัวอย่าง') + '" แล้ว');
      return true;
    } catch (e) { H.toast(e.message || 'เปิดโครงการไม่สำเร็จ'); return false; }
  }

  function build() {
    const bar = el('div', { id: 'demoBar', role: 'region', 'aria-label': 'เวอร์ชันสาธิต' });
    bar.appendChild(el('span', { class: 'demo-bar-badge' }, cfg.watermarkText));
    const sel = el('select', { id: 'demoPreset', 'aria-label': 'ตัวอย่างโครงการ' });
    sel.appendChild(el('option', { value: '' }, 'ตัวอย่างโครงการ…'));
    sel.disabled = true;
    bar.appendChild(sel);

    // รอทั้งสองแหล่งก่อนสร้างรายการ : ตัวอย่างใน Supabase ที่ชื่อซ้ำกับตัวอย่างในเว็บไม่แสดงซ้ำ
    const local = el('optgroup', { label: 'ตัวอย่างในเว็บ' });
    const localTitles = new Set();
    const localLoaded = fetch('presets/manifest.json', { credentials: 'omit' }).then((r) => (r.ok ? r.json() : [])).then((list) => {
      (Array.isArray(list) ? list : []).filter((x) => x && SAFE_FILE.test(String(x.file))).forEach((x) => {
        const title = String(x.title || x.file).slice(0, 120);
        const o = el('option', { value: 'local:' + x.file }, title);
        if (x.description) o.title = String(x.description).slice(0, 300);
        local.appendChild(o); localTitles.add(title);
      });
      if (local.children.length) { sel.appendChild(local); sel.disabled = false; }
    }).catch(() => { /* ไม่มีตัวอย่าง = ซ่อนไว้ */ });

    if (configured) {
      const remote = el('optgroup', { label: 'ตัวอย่างจาก Supabase' });
      Promise.all([S.listPresets(), localLoaded]).then(([list]) => {
        list.filter((x) => !localTitles.has(String(x.title))).forEach((x) => { const o = el('option', { value: 'db:' + x.id }, x.title); if (x.description) o.title = x.description; remote.appendChild(o); });
        if (remote.children.length) { sel.appendChild(remote); sel.disabled = false; }
      }).catch(() => { /* ใช้ตัวอย่างในเว็บต่อไป */ });
      const share = el('button', { type: 'button', class: 'demo-bar-btn', id: 'demoShare' }, 'แชร์ลิงก์ (ดูได้อย่างเดียว)');
      bar.appendChild(share);
      share.addEventListener('click', async () => {
        share.disabled = true;
        try {
          const p = H.current();
          const id = await S.saveShareableDemo(p.meta && p.meta.name, p);
          const link = location.origin + location.pathname + '?demo=' + id;
          let copied = false;
          try { await navigator.clipboard.writeText(link); copied = true; } catch (e) { /* ignore */ }
          H.toast((copied ? 'คัดลอกลิงก์แชร์แล้ว (หมดอายุใน 30 วัน): ' : 'ลิงก์แชร์ (หมดอายุใน 30 วัน): ') + link);
        } catch (e) { H.toast(e.message || 'สร้างลิงก์ไม่สำเร็จ'); }
        share.disabled = false;
      });
    }
    sel.addEventListener('change', async () => {
      const v = sel.value; sel.value = '';
      if (v.startsWith('local:')) await openLocal(v.slice(6)); else if (v.startsWith('db:')) await openShared(v.slice(3));
    });

    const nav = document.getElementById('tabs');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav); else document.body.insertBefore(bar, document.body.firstChild);
  }

  build();
  // ลิงก์แชร์ ?demo=<uuid> (เฉพาะเมื่อตั้งค่า Supabase)
  try {
    const id = new URLSearchParams(location.search).get('demo');
    if (id && configured) {
      openShared(id).then(() => { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } });
    }
  } catch (e) { /* ignore */ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
