/*
 * DemoGuard — ตัวควบคุมเวอร์ชันสาธิต (Public Demo)
 *  - interceptExport(format, projectName): ทุกจุดที่ "จะสร้างไฟล์/พิมพ์" เรียกที่นี่ → แสดงหน้าต่าง Ver.DEMO + บันทึกสถิติแบบไม่ระบุตัวตน (ถ้าต่อ Supabase)
 *  - บล็อก Ctrl/Cmd+P และ beforeprint (พิมพ์จากเมนูเบราว์เซอร์) ; CSS ฝั่งพิมพ์ซ่อนเนื้อหาทั้งหมดเหลือแต่ข้อความ Ver.DEMO
 *  - ชั้นลายน้ำเต็มจอ (#demo-wm-layer) + ป้ายมุมจอ ; ลายน้ำในผัง SLD/ตารางโหลดฝังที่ export.js
 * หมายเหตุความปลอดภัย: นี่คือ "ตัวขัดขวาง" ไม่ใช่การเข้ารหัส — ข้อมูลที่แสดงบนจอคัดลอก/แคปได้เสมอ ส่วนโค้ดสร้างไฟล์ถูกถอดออกจากซอร์ส (ดู README-DEMO.md)
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    ownerName: 'Photsawat Suksombat',
    ownerRole: '',
    watermarkText: 'Ver.DEMO — Made by Photsawat Suksombat',
    watermarkSubText: 'FOR DEMONSTRATION ONLY • NOT FOR CONSTRUCTION OR SUBMISSION',
    redirectUrl: '',
    contactEmail: '',
    allowProjectJson: false,
    supabaseUrl: '',
    supabaseAnonKey: ''
  };
  const cfg = Object.freeze(Object.assign({}, DEFAULTS, root.DEMO_CONFIG || {}));

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
  // ลิงก์ที่ยอมรับ: https เท่านั้น (กัน javascript:/data: ที่มาจากไฟล์ตั้งค่า)
  const safeUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.href : ''; } catch (e) { return ''; } };
  const safeMail = (m) => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(m || '')) ? String(m) : '');
  const isDemo = () => cfg.enabled === true;

  /* ---------- หน้าต่างแจ้งล็อกการส่งออก ---------- */
  function modalHTML(formatName) {
    const url = safeUrl(cfg.redirectUrl), mail = safeMail(cfg.contactEmail);
    return `<div class="demo-modal-card" role="dialog" aria-modal="true" aria-labelledby="demo-modal-title">
      <div class="demo-badge">${esc(cfg.watermarkText)}</div>
      <h3 id="demo-modal-title">การนำออกไฟล์ (${esc(formatName)}) ถูกล็อกในเวอร์ชันสาธิต</h3>
      <p>เวอร์ชันนี้เปิดให้ทดลองคำนวณ ดูตารางโหลดและผังเส้นเดียวเท่านั้น — ฟังก์ชัน <strong>ส่งออก PDF, CSV, Excel (.xlsx), AutoCAD (.DXF) และพิมพ์</strong> สงวนไว้สำหรับเวอร์ชันเต็ม</p>
      <div class="demo-owner-box"><strong>พัฒนาโดย:</strong> ${esc(cfg.ownerName)}${cfg.ownerRole ? ` · ${esc(cfg.ownerRole)}` : ''}<br>
        <span>ต้องการเวอร์ชันเต็มหรือสอบถามเพิ่มเติม กรุณาติดต่อผู้พัฒนา${mail ? ` — <a href="mailto:${esc(mail)}">${esc(mail)}</a>` : ''}</span></div>
      <div class="demo-modal-actions">
        ${url ? `<a class="demo-btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">ไปหน้าผู้พัฒนา →</a>` : ''}
        <button type="button" class="demo-btn-secondary" data-demo-close>ปิด</button>
      </div>
    </div>`;
  }

  let lastFocus = null;
  function closeModal() {
    const m = document.getElementById('demo-lock-modal');
    if (m) m.remove();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
    lastFocus = null;
  }
  function showDemoModal(formatName) {
    if (typeof document === 'undefined') return;
    const old = document.getElementById('demo-lock-modal');
    if (old) old.remove(); else lastFocus = document.activeElement;
    const m = document.createElement('div');
    m.id = 'demo-lock-modal'; m.className = 'demo-modal-backdrop';
    m.innerHTML = modalHTML(formatName);
    document.body.appendChild(m);
    const focusables = () => [...m.querySelectorAll('a[href],button')];
    const first = focusables()[0]; if (first) first.focus();
    m.addEventListener('click', (e) => { if (e.target === m || (e.target.closest && e.target.closest('[data-demo-close]'))) closeModal(); });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
  }

  /* ---------- จุดดักการส่งออก ---------- */
  const lastLog = new Map();          // รูปแบบไฟล์ → เวลาที่ส่งสถิติล่าสุด (กันยิงรัว)
  const LOG_EVERY = 60 * 1000;
  function interceptExport(formatName, projectName) {
    const f = String(formatName || 'FILE');
    const now = Date.now();
    if (root.SupabaseDemo && typeof root.SupabaseDemo.logExportAttempt === 'function' && !(lastLog.has(f) && now - lastLog.get(f) < LOG_EVERY)) {
      lastLog.set(f, now);
      try { Promise.resolve(root.SupabaseDemo.logExportAttempt(f, projectName)).catch(() => {}); } catch (e) { /* ignore */ }
    }
    showDemoModal(f);
    return false;
  }

  /* ---------- บล็อกพิมพ์ (Ctrl/Cmd+P, เมนูพิมพ์ของเบราว์เซอร์) ---------- */
  let printAt = 0;
  function onPrintAttempt() {
    const now = Date.now();
    if (now - printAt < 1500) return;
    printAt = now;
    interceptExport('PDF / พิมพ์');
  }

  function install() {
    if (typeof document === 'undefined' || !isDemo()) return;
    document.documentElement.classList.add('demo-mode');
    if (document.body) document.body.classList.add('demo-mode');
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'p') { e.preventDefault(); e.stopPropagation(); onPrintAttempt(); }
    }, true);
    window.addEventListener('beforeprint', onPrintAttempt);
    // ชั้นลายน้ำเต็มจอ (ไม่รับเมาส์) + ป้ายมุมจอ — ติดไปกับภาพแคปหน้าจอ
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='460' height='240'><text x='20' y='120' fill='rgba(220,38,38,0.10)' font-family='sans-serif' font-size='19' font-weight='bold' transform='rotate(-26 230 120)'>${esc(cfg.watermarkText)}</text></svg>`;
    const layer = document.createElement('div');
    layer.id = 'demo-wm-layer'; layer.setAttribute('aria-hidden', 'true');
    // แหล่งเดียวของลายน้ำภาพ: ตัวแปร CSS --demo-wm-img (ชั้นเต็มจอและ .demo-wm::after ของตารางโหลดใช้ร่วมกัน)
    document.documentElement.style.setProperty('--demo-wm-img', `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`);
    document.body.appendChild(layer);
    const tag = document.createElement('div');
    tag.id = 'demo-corner-tag'; tag.textContent = cfg.watermarkText;
    document.body.appendChild(tag);
    // ข้อความสำหรับหน้าพิมพ์ (CSS print ซ่อนทุกอย่างยกเว้นนี้)
    const blocker = document.createElement('div');
    blocker.id = 'demo-print-blocker';
    blocker.innerHTML = `<h1>${esc(cfg.watermarkText)}</h1><p>การพิมพ์และส่งออก PDF ปิดใช้งานในเวอร์ชันสาธิต</p>`;
    document.body.appendChild(blocker);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }

  root.DemoGuard = { config: cfg, isDemo, interceptExport, showDemoModal, closeModal, modalHTML, safeUrl, safeMail, esc, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DemoGuard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
