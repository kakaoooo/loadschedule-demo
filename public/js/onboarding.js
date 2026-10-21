/*
 * Onboarding — พาผู้ใช้ใหม่ "เห็นคุณค่าก่อน" ใน 3 ขั้น (เฉพาะเวอร์ชันสาธิต)
 *  - เปิดมาที่แท็บ "ตารางโหลด" ทันที (โครงการตัวอย่างอาคารสำนักงานคำนวณเสร็จแล้ว) พร้อมแถบ 3 ขั้นตอนที่ไม่บังหน้าจอ — แสดง "ครั้งแรกครั้งเดียว" :
 *      1) เลือกอาคารตัวอย่าง  2) ดู/ลองแก้ตารางโหลด (Balance Load)  3) ดูผลต่อเนื่อง (สายป้อน · SLD · วัสดุ)
 *  - ปุ่ม "ช่วยเหลือ ?" บนแถบบน : ไกด์เริ่มต้น · แต่ละแท็บทำอะไร · ทริค · พจนานุกรมศัพท์ — เปิดได้เสมอ
 *  - เมนูส่งออก (ถูกล็อกในเวอร์ชันสาธิต) ยุบเหลือปุ่มเดียว
 *  - มือถือ/จอสัมผัส : แตะองค์ประกอบที่มี title= เพื่ออ่านคำอธิบายในป๊อปอัป (hover ไม่ได้)
 * สร้าง DOM ด้วย textContent เท่านั้น ไม่มี inline handler (CSP script-src 'self') · ไอคอนเป็น SVG ของแอป (icons.js) · ไม่แตะลอจิกคำนวณ
 * ต้องโหลดหลัง app.js และ demo-ui.js (ใช้ window.DemoHooks)
 */
(function (root) {
  'use strict';

  const KEY = 'ls-onboard-v1';   // '1' = เคยแสดงแถบ 3 ขั้นแล้ว (ไม่เด้งซ้ำ ; เปิดใหม่ได้จากปุ่ม "ช่วยเหลือ")

  const PRESETS = [
    { file: 'office.json', icon: 'office', label: 'สำนักงาน', note: 'HVAC สูง · ลิฟต์' },
    { file: 'condo.json', icon: 'condo', label: 'คอนโด', note: '24 ห้อง · Riser' },
    { file: 'hospital.json', icon: 'hospital', label: 'โรงพยาบาล', note: 'ATS · ปั๊มดับเพลิง' },
    { file: 'factory.json', icon: 'factory', label: 'โรงงาน', note: 'มอเตอร์ · Ik″ สูง' }
  ];

  const STEPS = [
    { n: 1, title: 'เลือกอาคารตัวอย่าง', short: 'เลือกตัวอย่าง', desc: 'ตอนนี้เปิดตัวอย่างอาคารสำนักงานไว้ให้แล้ว อยากลองอาคารแบบอื่นก็กดเลือกได้ หรือนำเข้าตารางโหลดของคุณเอง' },
    { n: 2, title: 'ลองแก้โหลดแล้วดูตารางเปลี่ยน', short: 'แก้โหลดดูผล', desc: 'เปลี่ยนจำนวนหรือกำลังของโหลดสักรายการ แล้วกลับมาดูตารางโหลด เบรกเกอร์ สายไฟ และเฟส A/B/C จะคำนวณใหม่ตามค่าที่ใส่' },
    { n: 3, title: 'ดูสายป้อน ผัง SLD และวัสดุ', short: 'ดูผลต่อเนื่อง', desc: 'ค่าที่แก้ไปส่งต่อถึงสายป้อน ผังเส้นเดียว และรายการวัสดุเอง ไม่ต้องกรอกซ้ำ' }
  ];

  // แท็บจริงของแอป (ต้องตรงกับ TABS ใน app.js) พร้อมคำอธิบายสั้น
  const TAB_GUIDE = [
    ['dash', 'ภาพรวม', 'สรุปโหลดรวม ขนาดหม้อแปลง คำเตือน และแปลนทั้งหมดที่เปิดไว้ ใช้เทียบแปลนหรือย้อนดูประวัติได้ที่นี่'],
    ['design', 'ออกแบบ', 'สร้างแผงไฟ (MDB/SDB/LP) บอกว่าอยู่ชั้นไหน แล้วใส่โหลด เช่น โคมไฟ เต้ารับ แอร์ มอเตอร์ EV'],
    ['schedule', 'ตารางโหลด', 'ตารางโหลดของแต่ละแผง จัดเฟสด้วย Balance Load หรือเปลี่ยนขนาดเบรกเกอร์ทีละวงจร'],
    ['feeder', 'สายป้อน & ระบบประธาน', 'สายป้อนระหว่างแผง แรงดันตก กระแสลัดวงจร และขนาดหม้อแปลงกับสายประธาน'],
    ['sld', 'ผังเส้นเดียว', 'ผังเส้นเดียวที่โปรแกรมวาดให้จากผลคำนวณ'],
    ['method', 'วิธีคำนวณ', 'สูตรและขั้นตอนที่ใช้คำนวณ ไล่ดูที่มาของตัวเลขได้ทีละบรรทัด'],
    ['bom', 'รายการวัสดุ', 'ปริมาณสาย ท่อ และเบรกเกอร์ ไว้ใช้ประเมินราคา'],
    ['settings', 'ตั้งค่าโครงการ', 'เกณฑ์ออกแบบ ความสูงต่อชั้น ข้อมูลโครงการ และเลขใบอนุญาตผู้ออกแบบ']
  ];

  // ทริคที่มีอยู่จริงในแอป (ตรวจกับ uikit.js / app.js)
  const TIPS = [
    ['ค้นหาแผง', 'กด Ctrl+K หรือ / แล้วพิมพ์ชื่อแผง ชั้น หรือที่ตั้ง'],
    ['ย้อนกลับ/ทำซ้ำ', 'Ctrl+Z ย้อนกลับ Ctrl+Y ทำซ้ำ เก็บย้อนหลังได้ 30 ขั้นต่อแปลน'],
    ['เปลี่ยนขนาดเบรกเกอร์', 'ลากขนาดจากถาดเบรกเกอร์ไปวางที่แถววงจร หรือจับ ⋮⋮ ในช่อง AT แล้วลากขึ้นลง'],
    ['ย้ายเฟส', 'ลากป้าย A/B/C หน้าวงจรไปวางที่เฟสอื่น'],
    ['ย้ายต้นทางไฟ', 'ในแท็บออกแบบ ลากแผงไปวางบน MDB หรือ SDB เพื่อเปลี่ยนว่าแผงนี้รับไฟจากที่ไหน'],
    ['นำเข้าจากแบบ', 'ลากไฟล์รูป PDF หรือข้อความที่เป็นตารางโหลดมาวางในหน้านำเข้า โปรแกรมจะอ่านแล้วจัดลงแผงให้'],
    ['เวอร์ชันสาธิต', 'คำนวณและดูผลได้ครบ แต่ส่งออกไฟล์ไม่ได้ กดเมนูส่งออกเพื่อดูว่าเวอร์ชันเต็มทำอะไรได้บ้าง']
  ];

  // คำอธิบายศัพท์ — ข้อความอ้างอิงตามที่แอปคำนวณจริง (engine.js) ไม่เพิ่มตัวเลขนอกเหนือจากที่แอปใช้
  const GLOSSARY = [
    ['Ik″', 'กระแสลัดวงจรเริ่มต้น (kA) ที่จุดนั้น โปรแกรมคำนวณแบบย่อตาม IEC 60909 ไว้ตรวจว่าเบรกเกอร์ตัดกระแสได้พอ'],
    ['IC', 'พิกัดตัดกระแสลัดวงจรของเบรกเกอร์ (kA) ต้องไม่น้อยกว่า Ik″ ที่จุดติดตั้ง'],
    ['Balance Load', 'จัดวงจรเข้าเฟส A/B/C ให้โหลดแต่ละเฟสต่างกันน้อยที่สุด โปรแกรมเตือนเมื่อไม่สมดุลเกิน 20%'],
    ['Connected', 'โหลดติดตั้งรวมทั้งหมด (VA) ก่อนคิดตัวคูณ ส่วน Demand คือค่าหลังคิดตัวคูณแล้ว'],
    ['Demand', 'โหลดที่คาดว่าจะใช้พร้อมกันจริง คิดจาก Connected × ตัวคูณการใช้พร้อมกัน'],
    ['Riser', 'สายป้อนที่ต้องเดินขึ้นลงระหว่างชั้น ความยาวคิดจากจำนวนชั้นที่ต่างกัน × ความสูงต่อชั้น (ตั้งได้ในแท็บตั้งค่าโครงการ)'],
    ['Auto-Selectivity', 'ปรับ CB สายป้อนให้ใหญ่พอ (≥ 1.6 เท่าของ CB วงจรย่อยตัวใหญ่สุด) เพื่อให้ตัวปลายทางตัดก่อน ไฟจะได้ไม่ดับทั้งตู้'],
    ['Tap ahead of main', 'ต่อสายป้อนของแผงนั้น (เช่นปั๊มดับเพลิง) ก่อนเมนสวิตช์ เพื่อให้ยังมีไฟแม้ตัดเมนอาคาร แต่การตีความขึ้นกับโครงการและการไฟฟ้า โปรแกรมจึงปิดไว้ก่อน'],
    ['NFPA 20', 'มาตรฐานปั๊มดับเพลิง โปรแกรมใช้ CB แบบ Magnetic-only (ไม่ตัดจากโอเวอร์โหลด) สายทนไฟ FRC ไม่ใส่ RCD และต่อเข้าแผงฉุกเฉิน'],
    ['%VD', 'แรงดันตกของสายป้อนเป็นเปอร์เซ็นต์ ดูได้ในแท็บสายป้อน & ระบบประธาน']
  ];

  const SECTIONS = [['start', 'เริ่มต้น'], ['tabs', 'แต่ละแท็บ'], ['tips', 'ทริค'], ['terms', 'ศัพท์']];

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  // ไอคอน SVG จาก icons.js (สตริงของแอปเอง ไม่ใช่ข้อมูลผู้ใช้) แปลงเป็น node ด้วย DOMParser
  function icon(name) {
    const src = root.ICON && root.ICON[name];
    const span = el('span', { class: 'ob-i', 'aria-hidden': 'true' });
    if (!src || typeof DOMParser === 'undefined') return span;
    try {
      const doc = new DOMParser().parseFromString(src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
      if (doc.documentElement && doc.documentElement.nodeName === 'svg') span.appendChild(document.importNode(doc.documentElement, true));
    } catch (e) { /* ไม่มีไอคอน = แสดงเฉพาะข้อความ */ }
    return span;
  }
  const withIcon = (name, text) => { const f = document.createDocumentFragment(); f.appendChild(icon(name)); f.appendChild(document.createTextNode(text)); return f; };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ไม่มี storage: ใช้ได้เฉพาะรอบนี้ */ } };

  // ----- ตัวช่วยแตะแอปจริง (ผ่าน DOM ที่ app.js ดักไว้ ไม่แตะตัวแปรภายใน) -----
  function goTab(k) {
    const b = $('.tab[data-tab="' + k + '"]');
    if (b) b.click();
  }
  function toast(msg) {
    const H = root.DemoHooks;
    if (H && H.toast) H.toast(msg);
  }

  const onTab = () => { const t = $('.tab.on'); return t ? t.dataset.tab : ''; };

  let cur = 1;          // ขั้นที่กำลังแสดง
  let strip = null;

  async function loadPreset(p) {
    const H = root.DemoHooks;
    if (!H) return;
    try {
      const r = await fetch('presets/' + p.file, { credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (H.apply(await r.json()) === false) return;
      goTab('schedule');
      setStep(2);
    } catch (e) { toast('เปิดตัวอย่างไม่สำเร็จ: ' + (e.message || e)); }
  }

  // ขั้น 2: พาไปแท็บออกแบบแล้วเปิดฟอร์มแก้โหลดรายการแรก (ผ่านปุ่มเดิมของแอป) ; แก้เสร็จกด "กลับไปดูตารางโหลด" ในแถบ
  function editFirstLoad() {
    goTab('design');
    const it = $('#main [data-edit]');
    if (it) it.click(); else toast('แผงนี้ยังไม่มีโหลด เพิ่มโหลดจากรายการด้านล่างก่อน แล้วค่อยกลับไปดูตารางโหลด');
  }

  function balanceAll() {
    goTab('schedule');
    const b = $('[data-balance-all]');
    if (b) { b.click(); } else { toast('โครงการนี้ไม่มีแผง 3 เฟสที่ต้องจัดเฟส'); }
  }

  // ----- แถบ 3 ขั้นตอน -----
  function buildStrip() {
    strip = el('section', { id: 'guideStrip', role: 'region', 'aria-label': 'เริ่มต้นใช้งาน 3 ขั้นตอน' });
    const nav = $('#tabs');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(strip, nav.nextSibling); else document.body.insertBefore(strip, document.body.firstChild);
    drawStrip();
  }

  function drawStrip() {
    if (!strip) return;
    strip.textContent = '';
    const head = el('div', { class: 'gs-head' });
    head.appendChild(el('b', { class: 'gs-title' }, 'เริ่มใน 3 ขั้นตอน'));
    const steps = el('div', { class: 'gs-steps', role: 'tablist' });
    STEPS.forEach((s) => {
      const b = el('button', { type: 'button', class: 'gs-step' + (s.n === cur ? ' on' : '') + (s.n < cur ? ' done' : ''), 'data-gs-step': String(s.n), role: 'tab', 'aria-selected': String(s.n === cur) });
      const n = el('span', { class: 'gs-n', 'aria-hidden': 'true' });
      if (s.n < cur) n.appendChild(icon('check')); else n.textContent = String(s.n);
      b.appendChild(n);
      b.appendChild(el('span', { class: 'gs-lbl' }, s.short));
      steps.appendChild(b);
    });
    head.appendChild(steps);
    const x = el('button', { type: 'button', class: 'gs-x', 'data-gs-close': '1', 'aria-label': 'ปิดแถบเริ่มต้นใช้งาน', title: 'ปิด' });
    x.appendChild(icon('close'));
    head.appendChild(x);
    strip.appendChild(head);

    const s = STEPS[cur - 1];
    const body = el('div', { class: 'gs-body' });
    body.appendChild(el('p', { class: 'gs-desc' }, s.desc));
    const act = el('div', { class: 'gs-act' });
    if (cur === 1) {
      if (root.DemoHooks) {
        PRESETS.forEach((p, i) => {
          const b = el('button', { type: 'button', class: 'gs-chip', 'data-gs-preset': String(i) });
          const ic = icon(p.icon); ic.classList.add('gs-ic');
          b.appendChild(ic);
          b.appendChild(el('span', { class: 'gs-ct' }, p.label));
          b.appendChild(el('small', null, p.note));
          act.appendChild(b);
        });
      }
      const imp = el('button', { type: 'button', class: 'btn sm', 'data-gs-import': '1' });
      imp.appendChild(withIcon('scan', 'นำเข้าจากแบบของคุณ'));
      act.appendChild(imp);
    } else if (cur === 2) {
      act.appendChild(el('button', { type: 'button', class: 'btn accent sm', 'data-gs-edit': '1' }, 'ลองแก้โหลดสักรายการ'));
      const bal = el('button', { type: 'button', class: 'btn sm', 'data-gs-balance': '1' });
      bal.appendChild(withIcon('balance', 'Balance Load ทุกแผง'));
      act.appendChild(bal);
      if (onTab() !== 'schedule') act.appendChild(el('button', { type: 'button', class: 'btn sm', 'data-gs-tab': 'schedule' }, 'กลับไปดูตารางโหลด'));
      act.appendChild(el('button', { type: 'button', class: 'btn sm', 'data-gs-go': '3' }, 'ขั้น 3 →'));
    } else {
      [['feeder', 'สายป้อน & ระบบประธาน'], ['sld', 'ผังเส้นเดียว (SLD)'], ['bom', 'รายการวัสดุ']].forEach(([k, t]) => act.appendChild(el('button', { type: 'button', class: 'btn sm accent', 'data-gs-tab': k }, t)));
      act.appendChild(el('button', { type: 'button', class: 'btn sm', 'data-gs-done': '1' }, 'ปิดแถบนี้'));
    }
    body.appendChild(act);
    strip.appendChild(body);
  }

  function setStep(n) { cur = Math.max(1, Math.min(3, n)); drawStrip(); }
  function dismiss() {
    lsSet(KEY, '1');
    if (strip) { strip.remove(); strip = null; }
  }
  function showStrip(n) {
    cur = n || 1;
    if (!strip) buildStrip(); else drawStrip();
    strip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ----- หน้าต่างช่วยเหลือ (หลายหมวด) -----
  function closeGuide() { const m = $('#guideModal'); if (m) m.remove(); }

  function sectionBody(key) {
    const box = el('div', { class: 'gd-sec', role: 'tabpanel' });
    if (key === 'start') {
      box.appendChild(el('p', { class: 'gd-lead' }, 'โปรแกรมนี้คำนวณตารางโหลดแผงไฟจากรายการโหลดที่ใส่ แล้วต่อยอดเป็นสายป้อน ผังเส้นเดียว และรายการวัสดุ'));
      const ol = el('ol', { class: 'gd-steps' });
      STEPS.forEach((s) => { const li = el('li'); li.appendChild(el('b', null, s.title)); li.appendChild(el('span', null, ': ' + s.desc)); ol.appendChild(li); });
      box.appendChild(ol);
      box.appendChild(el('button', { type: 'button', class: 'btn accent', 'data-gd-start': '1' }, 'เริ่มต้นทัวร์ 3 ขั้น'));
    } else if (key === 'tabs') {
      box.appendChild(el('p', { class: 'gd-lead' }, 'แตะแท็บที่ต้องการเพื่อไปที่นั่น'));
      const list = el('div', { class: 'gd-tabs' });
      TAB_GUIDE.forEach(([k, name, d], i) => {
        const b = el('button', { type: 'button', class: 'gd-tab', 'data-gd-tab': k });
        b.appendChild(el('span', { class: 'gd-no' }, String(i + 1).padStart(2, '0')));
        const t = el('span', { class: 'gd-tt' });
        t.appendChild(el('b', null, name));
        t.appendChild(el('small', null, d));
        b.appendChild(t);
        list.appendChild(b);
      });
      box.appendChild(list);
    } else if (key === 'tips') {
      const dl = el('dl', { class: 'gd-gloss gd-tips' });
      TIPS.forEach(([t, d]) => { dl.appendChild(el('dt', null, t)); dl.appendChild(el('dd', null, d)); });
      box.appendChild(dl);
    } else {
      const dl = el('dl', { class: 'gd-gloss' });
      GLOSSARY.forEach(([t, d]) => { dl.appendChild(el('dt', null, t)); dl.appendChild(el('dd', null, d)); });
      box.appendChild(dl);
    }
    return box;
  }

  function showSection(key) {
    const c = $('#guideModal .gd-card');
    if (!c) return;
    $$all('[data-gd-sec]', c).forEach((b) => { const on = b.dataset.gdSec === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const old = $('.gd-sec', c); if (old) old.remove();
    c.appendChild(sectionBody(key));
  }
  const $$all = (s, r) => Array.from((r || document).querySelectorAll(s));

  function openGuide(key) {
    closeGuide();
    const m = el('div', { id: 'guideModal', class: 'gd-backdrop' });
    const c = el('div', { class: 'gd-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gdTitle' });
    const h = el('div', { class: 'gd-head' });
    const t = el('h3', { id: 'gdTitle' });
    t.appendChild(withIcon('help', 'ช่วยเหลือ'));
    h.appendChild(t);
    const x = el('button', { type: 'button', class: 'gs-x', 'data-gd-close': '1', 'aria-label': 'ปิดหน้าต่างช่วยเหลือ' });
    x.appendChild(icon('close'));
    h.appendChild(x);
    c.appendChild(h);
    const nav = el('div', { class: 'gd-nav', role: 'tablist' });
    SECTIONS.forEach(([k, name]) => nav.appendChild(el('button', { type: 'button', class: 'gd-navb', 'data-gd-sec': k, role: 'tab', 'aria-selected': 'false' }, name)));
    c.appendChild(nav);
    m.appendChild(c);
    document.body.appendChild(m);
    showSection(key || 'start');
    const f = $('[data-gd-sec].on', c); if (f) f.focus();
  }

  // ----- ปุ่ม (i) ข้างศัพท์ในหัวตาราง/หัวข้อ : แตะแล้วขึ้นคำอธิบายจากพจนานุกรม -----
  // เฉพาะ th / .label / h3 ที่ข้อความสั้น (ไม่แตะปุ่ม ลิงก์ หรือ label ของช่องกรอก) — idempotent ให้ MutationObserver เรียกซ้ำได้
  const TERM_RE = [[/Ik["″]/, 'Ik″'], [/\bIC\b/, 'IC'], [/Riser/, 'Riser'], [/Demand/, 'Demand'], [/Connected/, 'Connected'], [/%?VD\b/, '%VD'], [/Selectivity/, 'Auto-Selectivity']];
  const glossDesc = (k) => { const g = GLOSSARY.find((x) => x[0] === k); return g ? g[1] : ''; };
  function markTerms() {
    const main = $('#main');
    if (!main) return;
    main.querySelectorAll('th, .label, h3').forEach((n) => {
      if (n.querySelector('.gl-i') || n.closest('label, button, a, summary')) return;
      const txt = (n.textContent || '').trim();
      if (!txt || txt.length > 48) return;
      const hit = TERM_RE.find(([re]) => re.test(txt));
      if (!hit) return;
      const b = el('button', { type: 'button', class: 'gl-i', 'data-gl': hit[1], 'aria-label': 'ความหมายของ ' + hit[1] }, 'i');
      n.appendChild(b);
    });
  }
  let markQueued = false;
  function queueMark() {
    if (markQueued) return;
    markQueued = true;
    (root.requestAnimationFrame || setTimeout)(() => { markQueued = false; markTerms(); });
  }

  // ----- เมนูส่งออก (ล็อกในเวอร์ชันสาธิต) -----
  function toggleExport(force) {
    const menu = $('#exportMenu'), btn = $('#exportMenuBtn');
    if (!menu || !btn) return;
    const open = force != null ? force : menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  // ----- ป๊อปอัปแตะดูคำอธิบาย (จอสัมผัส) -----
  function closePop() { const p = $('#tapPop'); if (p) p.remove(); }
  function showPop(text, head) {
    closePop();
    const p = el('div', { id: 'tapPop', role: 'status' });
    const body = el('span');
    if (head) body.appendChild(el('b', null, head + ': '));
    body.appendChild(document.createTextNode(text));
    p.appendChild(body);
    const b = el('button', { type: 'button', 'data-pop-close': '1', 'aria-label': 'ปิดคำอธิบาย' });
    b.appendChild(icon('close'));
    p.appendChild(b);
    document.body.appendChild(p);
  }
  const touchOnly = () => !!(root.matchMedia && root.matchMedia('(hover: none)').matches);

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-pop-close]')) { closePop(); return; }

    const gl = t.closest('[data-gl]'); if (gl) { e.stopPropagation(); showPop(glossDesc(gl.dataset.gl), gl.dataset.gl); return; }

    // เมนูส่งออก
    if (t.closest('#exportMenuBtn')) { toggleExport(); return; }
    if (!t.closest('#exportMenu')) toggleExport(false);
    else if (t.closest('[data-action]')) toggleExport(false);   // เลือกรูปแบบแล้วปิดเมนู (ปุ่มเดิมยังทำงานผ่านตัวดักของแอป)

    // ช่วยเหลือ
    if (t.closest('#btn-open-guide')) { openGuide('start'); return; }
    if (t.closest('[data-gd-close]') || t.id === 'guideModal') { closeGuide(); return; }
    const sec = t.closest('[data-gd-sec]'); if (sec) { showSection(sec.dataset.gdSec); return; }
    const gt = t.closest('[data-gd-tab]'); if (gt) { closeGuide(); goTab(gt.dataset.gdTab); return; }
    if (t.closest('[data-gd-start]')) { closeGuide(); showStrip(1); goTab('schedule'); return; }

    // แถบ 3 ขั้น
    const st = t.closest('[data-gs-step]'); if (st) { setStep(+st.dataset.gsStep); return; }
    const go = t.closest('[data-gs-go]'); if (go) { setStep(+go.dataset.gsGo); if (+go.dataset.gsGo === 2) goTab('schedule'); return; }
    const tb = t.closest('[data-gs-tab]'); if (tb) { goTab(tb.dataset.gsTab); if (tb.dataset.gsTab !== 'schedule') cur = 3; drawStrip(); return; }
    const pr = t.closest('[data-gs-preset]'); if (pr) { loadPreset(PRESETS[+pr.dataset.gsPreset]); return; }
    if (t.closest('[data-gs-import]')) { const b = $('[data-action="open-importer"]'); if (b) b.click(); return; }
    if (t.closest('[data-gs-edit]')) { editFirstLoad(); drawStrip(); return; }
    if (t.closest('[data-gs-balance]')) { balanceAll(); return; }
    if (t.closest('[data-gs-close]')) { dismiss(); toast('ถ้าอยากดูอีก กดปุ่ม ช่วยเหลือ ที่แถบบน'); return; }
    if (t.closest('[data-gs-done]')) { dismiss(); return; }

    // จอสัมผัส: แตะองค์ประกอบ (ที่ไม่ใช่ปุ่ม/ช่องกรอก) ที่มี title เพื่ออ่านคำอธิบาย
    if (touchOnly()) {
      const withTitle = t.closest('[title]');
      if (withTitle && !withTitle.closest('button, a, input, select, textarea, label, summary')) {
        const txt = (withTitle.getAttribute('title') || '').trim();
        if (txt.length >= 4) { showPop(txt); return; }
      }
      if (!t.closest('#tapPop')) closePop();
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    closePop(); toggleExport(false);
    if ($('#guideModal')) closeGuide();
  }

  function init() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);

    const main = $('#main');
    if (main && root.MutationObserver) { new root.MutationObserver(queueMark).observe(main, { childList: true, subtree: true }); }
    const tabs = $('#tabs');
    if (tabs && root.MutationObserver) { new root.MutationObserver(() => { if (strip && cur === 2) drawStrip(); }).observe(tabs, { attributes: true, attributeFilter: ['class'], subtree: true }); }
    queueMark();

    // เปิดมาที่ตารางโหลดเลย (ยกเว้นเปิดจากลิงก์แชร์ ?demo=)
    let shared = false;
    try { shared = new URLSearchParams(location.search).has('demo'); } catch (e) { /* ignore */ }
    if (!shared) goTab('schedule');

    // แถบ 3 ขั้น: แสดงครั้งแรกครั้งเดียว (จดไว้ทันทีที่แสดง ; ไม่มี storage = แสดงทุกรอบ)
    if (lsGet(KEY) !== '1' && !shared) { lsSet(KEY, '1'); buildStrip(); }
  }

  const Onboarding = { STEPS, PRESETS, GLOSSARY, TAB_GUIDE, TIPS, openGuide, showStrip, dismiss };
  root.Onboarding = Onboarding;
  if (typeof module !== 'undefined' && module.exports) module.exports = Onboarding;

  if (typeof document !== 'undefined') {
    const G = root.DemoGuard;
    if (G && G.isDemo && G.isDemo()) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
