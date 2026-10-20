/*
 * ตรรกะ UI ล้วน ๆ (ไม่แตะ DOM) เพื่อทดสอบใน Node ได้ — app.js เป็นตัวต่อ DOM
 *  - createHistory : ประวัติ Undo/Redo ของโครงการ (snapshot JSON, สูงสุด 30 สเต็ป, ไม่เก็บโลโก้)
 *  - shortcut      : แปลงคีย์ลัดเป็นคำสั่ง (ใช้ e.code → ใช้ได้กับคีย์บอร์ดไทย)
 *  - filterPanels  : ค้นหาแผงด่วน (Ctrl+K)
 *  - icBanner      : ข้อความแถบเตือนสีแดง Ik" > IC (ความปลอดภัยต่อชีวิต) + คำแนะนำเชิงวิศวกรรม (icAdvice)
 *  - resolveTheme / nextTheme : ธีมมืด/สว่าง
 */
(function (root) {
  'use strict';
  const MAX_HISTORY = 30;

  // โลโก้เป็น data URL ใหญ่ (≤ 150 KB) — ไม่เก็บในประวัติ ; ค่าที่ validate แล้วไม่มีเครื่องหมาย " จึงใช้ regex แทนการ parse ได้
  const stripLogo = (json) => String(json).replace(/"logo":"[^"]*"/, '"logo":""');

  function createHistory(max) {
    const cap = max > 0 ? max : MAX_HISTORY;
    let undo = [], redo = [], cur = null;
    return {
      reset() { undo = []; redo = []; cur = null; },
      // เรียกทุกครั้งที่คำนวณสำเร็จด้วยสถานะ snapshot นี้ : ครั้งแรก = ฐาน ; ต่างจากเดิม = เพิ่มประวัติ ; เท่าเดิม = ไม่ทำอะไร
      record(json) {
        const s = stripLogo(json);
        if (cur === null) { cur = s; return; }
        if (s === cur) return;
        undo.push(cur); if (undo.length > cap) undo.shift();
        redo = []; cur = s;
      },
      undo() { if (!undo.length) return null; redo.push(cur); cur = undo.pop(); return cur; },
      redo() { if (!redo.length) return null; undo.push(cur); cur = redo.pop(); return cur; },
      current: () => cur,
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      counts: () => ({ undo: undo.length, redo: redo.length })
    };
  }

  const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const NON_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);   // INPUT ที่ไม่มีเคอร์เซอร์พิมพ์ — Ctrl+Z ยังเป็นของโครงการ
  // คืน 'undo' | 'redo' | 'search' | null ; ช่องกรอกข้อความต้องใช้ undo ของตัวเอง จึงไม่แย่ง Ctrl+Z/Y และ "/" ; Ctrl+K ใช้ได้ทุกที่
  function shortcut(e) {
    if (!e || e.altKey) return null;
    const mod = !!(e.ctrlKey || e.metaKey);
    const t = e.target || {};
    const tag = String(t.tagName || '').toUpperCase();
    const typing = (TYPING.has(tag) && !(tag === 'INPUT' && NON_TEXT.has(String(t.type || '').toLowerCase()))) || !!t.isContentEditable;
    if (mod && e.code === 'KeyK') return 'search';
    if (typing) return null;
    if (mod && e.code === 'KeyZ') return e.shiftKey ? 'redo' : 'undo';
    if (mod && e.code === 'KeyY') return 'redo';
    if (!mod && !e.shiftKey && e.code === 'Slash') return 'search';
    return null;
  }

  // ชั้นแบบ ordinal เพื่อให้ค้น "3rd" ได้เหมือนป้ายในแบบ
  function floorWords(v) {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return '';
    let n = typeof v === 'number' ? v : NaN;
    if (typeof v === 'string') {
      const s = v.trim().toUpperCase();
      if (/^B\d+$/.test(s)) n = -parseInt(s.slice(1), 10);
      else if (s === 'B' || s === 'BASEMENT') n = -1;
      else if (s === 'G' || s === 'GROUND') n = 0;
      else if (s === 'M' || s === 'MEZZ' || s === 'MEZZANINE') return 'm mezz mezzanine fl ชั้นลอย';
      else n = Number(s);
    }
    n = Math.round(n);
    if (!Number.isFinite(n)) return '';
    if (n === 0) return 'g fl ground ชั้น g';
    if (n < 0) return `b${-n} fl basement ชั้น b${-n}`;
    const k = n % 100, suf = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return `${n}${suf} fl ชั้น ${n}`;
  }
  const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s\-_.,/]+/g, '');
  // boards: [{id,name,kind,location,floor}] → id เรียงตามความตรง (ชื่อขึ้นต้นด้วยคำค้นก่อน) ; หลายคำค้น = AND
  function filterPanels(boards, query) {
    const list = Array.isArray(boards) ? boards : [];
    // "ชั้น 2" / "fl 2" = วลีเดียว (ไม่ให้ "2" ไปจับ id อย่าง LP2 ที่อยู่ชั้นอื่น)
    const terms = String(query || '').toLowerCase().replace(/(ชั้น|floor|fl\.?)\s*(-?\d+)/g, '$1$2').split(/\s+/).filter(Boolean);
    if (!terms.length) return list.map((b) => b.id);
    const scored = [];
    list.forEach((b, i) => {
      const hay = squash([b.id, b.name, b.kind, b.location, floorWords(b.floor)].join(' '));
      if (!terms.every((t) => hay.includes(squash(t)))) return;
      const name = squash(b.name), id = squash(b.id), q0 = squash(terms[0]);
      const rank = name.startsWith(q0) || id.startsWith(q0) ? 0 : 1;
      scored.push({ id: b.id, rank, i });
    });
    scored.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return scored.map((x) => x.id);
  }

  // IC มาตรฐาน (kA) = D.IC_KA ใน data.js ; app.js ส่งตารางจริงเข้ามา ค่านี้เป็นค่าสำรองให้ใช้ใน Node/เทสต์
  const IC_STD = [6, 10, 18, 25, 30, 36, 50, 65, 85, 100];
  // คำแนะนำเมื่อ Ik" เกิน IC : IC มาตรฐานถัดไปที่รับ Ik" สูงสุดได้ ; ตัวอย่างรุ่นให้เฉพาะ ≤ 10 kA (ข้อมูลแคตตาล็อกในแอป: iC60N Icu 10 kA, EZC Icu ≥ 10 kA) — สูงกว่านั้นให้เลือกจากแคตตาล็อกเอง
  // ตัวอย่างรุ่น MCCB จากแคตตาล็อกของแอป (brands.mccb) : Icu ≥ need, ใกล้ค่าที่ต้องการสุดก่อน, ไม่ซ้ำยี่ห้อ, สูงสุด 2 รุ่น — ไม่มีแคตตาล็อก/ไม่มีรุ่นรับไหว = ว่าง (ห้ามแต่งชื่อรุ่น)
  function icExamples(need, brands) {
    const list = brands && Array.isArray(brands.mccb) ? brands.mccb : [];
    const seen = new Set(), out = [];
    list.filter((m) => m && m.icu + 1e-9 >= need).sort((a, b) => a.icu - b.icu || String(a.brandShort).localeCompare(String(b.brandShort)) || String(a.model).localeCompare(String(b.model)))
      .forEach((m) => { if (out.length < 2 && !seen.has(m.brandShort)) { seen.add(m.brandShort); out.push(`${m.brandShort} ${m.model} (Icu ${m.icu} kA)`); } });
    return out;
  }
  function icAdvice(ikMax, list, brands) {
    const std = Array.isArray(list) && list.length ? list : IC_STD;
    const need = std.slice().sort((a, b) => a - b).find((x) => x + 1e-9 >= ikMax);
    const tail = 'หรืออ้างอิงตาราง Cascading/Back-up Protection ตาม IEC 60947-2';
    if (need === undefined) return `⚠️ Ik" เกินพิกัดตัดกระแส: Ik" สูงสุด ${Math.round(ikMax * 100) / 100} kA เกิน IC สูงสุดในตาราง (${Math.max(...std)} kA) — ต้องใช้ CB จำกัดกระแส (current-limiting) หรือเพิ่มอิมพีแดนซ์ ${tail}`;
    if (need <= 10) return `⚠️ Ik" เกินพิกัดตัดกระแส: แนะนำเลือกรุ่นเบรกเกอร์ IC ≥ ${need} kA (เช่น Acti9 iC60N หรือ EasyPact EZC) ${tail}`;
    const ex = icExamples(need, brands);
    if (brands && Array.isArray(brands.mccb) && !ex.length) return `⚠️ Ik" เกินพิกัดตัดกระแส: ไม่มีรุ่น MCCB ในแคตตาล็อกของแอปที่ IC ≥ ${need} kA — ใช้ CB จำกัดกระแส (current-limiting) หรือเพิ่มอิมพีแดนซ์ ${tail}`;
    return `⚠️ Ik" เกินพิกัดตัดกระแส: แนะนำเลือกรุ่นเบรกเกอร์ IC ≥ ${need} kA${ex.length ? ` (เช่น ${ex.join(', ')})` : ''} ${tail}`;
  }

  // violations: result.icViolations → แถบเตือนสีแดง ; null = ไม่ต้องแสดง ; icList = D.IC_KA ; brands = LS_BRANDS (ใช้หาตัวอย่างรุ่น)
  function icBanner(violations, icList, brands) {
    const v = Array.isArray(violations) ? violations.filter((x) => x && x.ik > x.ic) : [];
    if (!v.length) return null;
    const worst = v.slice().sort((a, b) => (b.ik - b.ic) - (a.ik - a.ic));
    const fmt = (n) => String(Math.round(n * 100) / 100);
    const items = worst.slice(0, 3).map((x) => `${x.where} · ${x.cb}: Ik" ${fmt(x.ik)} kA > IC ${fmt(x.ic)} kA`);
    return {
      count: v.length,
      headline: `⚠️ เบรกเกอร์ระเบิด (Explosion Risk): พบ ${v.length} จุดที่ Ik" > IC — ต้องเพิ่ม IC / ใช้ CB จำกัดกระแส / เพิ่มอิมพีแดนซ์`,
      items,
      more: Math.max(0, v.length - items.length),
      advice: icAdvice(Math.max(...v.map((x) => x.ik)), icList, brands)
    };
  }

  // โครงการเก่าที่เก็บ autoSelectivity / coordinateKidFeeders = false ไว้ (ค่าเริ่มต้นตอนนั้นยังปิด) : แจ้งให้เปิดโดยไม่เปลี่ยนค่าเอง — dismissed = ผู้ใช้กด "คงไว้"/ปรับเองแล้ว
  function selectivityNotice(meta, dismissed) {
    if (dismissed) return null;
    const m = meta && typeof meta === 'object' ? meta : {};
    const off = [];
    if (m.autoSelectivity === false) off.push('Auto-Selectivity');
    if (m.coordinateKidFeeders === false) off.push('ประสานสายป้อนหลายชั้น');
    if (!off.length) return null;
    return { off, headline: `โครงการนี้ปิด ${off.join(' และ ')} ไว้ — ค่าเริ่มต้นของแอปตอนนี้คือเปิด (เมนแผงแม่ ≥ 1.6 × CB สายป้อนแผงลูก เพื่อให้เลือกตัด) เปิดเลยไหม?`, enable: 'เปิดทั้งหมด', keep: 'คงไว้ (ไม่ถามอีก)' };
  }

  const resolveTheme = (stored, prefersDark) => (stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light'));
  const nextTheme = (cur) => (cur === 'dark' ? 'light' : 'dark');

  const API = { createHistory, stripLogo, shortcut, filterPanels, icBanner, icAdvice, icExamples, selectivityNotice, resolveTheme, nextTheme, MAX_HISTORY };
  root.UIKit = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
