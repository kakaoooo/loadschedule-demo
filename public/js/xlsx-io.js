/*
 * Excel (.xlsx) — นำเข้าเท่านั้น (เวอร์ชันสาธิต: ไม่มีโค้ดส่งออก) · ทำงานในเครื่องทั้งหมด
 *  - ส่งออก: เขียนไฟล์ .xlsx เอง (SpreadsheetML + zip แบบ store) — หัวตารางตัวหนาและตรึงแถว, ตัวเลขเก็บเป็นตัวเลขจริง
 *            ข้อความที่ขึ้นต้นด้วย = + - @ เก็บเป็นข้อความ (inline string + quotePrefix) ไม่มีทางกลายเป็นสูตร
 *  - นำเข้า: อ่านด้วย SheetJS CE (vendor/sheetjs/xlsx.mini.min.js — โหลดเมื่อใช้ครั้งแรก) → แปลงชีตเป็นข้อความ
 *            แล้วส่งต่อให้ Importer.parseText เดิม (ตารางโหลดแผง → รูปแบบ Panel Board Schedule, ตารางอื่น → TSV ตามหัวคอลัมน์)
 */
(function (root) {
  'use strict';
  const LIMITS = { bytes: 20 * 1024 * 1024, rows: 5000, cols: 60, sheets: 60, cell: 32767 };
  const ERR = {
    empty: 'ไฟล์ Excel ว่างเปล่า (0 ไบต์) — ตรวจว่าบันทึกไฟล์เสร็จแล้ว แล้วลองใหม่',
    big: 'ไฟล์ Excel ใหญ่เกิน 20 MB — คัดลอกเฉพาะชีตตารางโหลดไปไฟล์ใหม่ก่อน',
    xls: 'ไฟล์ Excel แบบเก่า (.xls) หรือไฟล์ที่ตั้งรหัสผ่าน ยังไม่รองรับ — เปิดใน Excel แล้ว "บันทึกเป็น" .xlsx (ไม่ใส่รหัสผ่าน) หรือ CSV',
    bad: 'อ่านไฟล์ Excel ไม่ได้ — ไฟล์เสียหายหรือไม่ใช่ .xlsx (ลองเปิดใน Excel แล้วบันทึกใหม่)',
    noData: 'ไม่พบข้อมูลในไฟล์ Excel (ทุกชีตว่าง)',
    lib: 'โหลดตัวอ่าน Excel ไม่สำเร็จ (vendor/sheetjs) — ลองรีเฟรชหน้าเว็บ',
    cancel: 'ยกเลิกการเลือกชีต'
  };

  /* ================= ส่งออก ================= */
  const isNumStr = (s) => /^-?\d{1,15}(?:\.\d{1,10})?$/.test(s);
  const rnd = (v, d) => (Number.isFinite(v) ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d) : '');
  const txt = (v) => (v == null ? '' : v);
  const INJ = /^\s*[=+\-@\t\r|%]/;

  /* ---- เวอร์ชันสาธิต: ส่วนเขียนไฟล์ .xlsx (สไตล์ XML, zip, ตัวสร้างชีต) ถูกถอดออกจากซอร์สทั้งหมด — เหลือเฉพาะ "อ่าน" ไฟล์เพื่อนำเข้า ---- */
  const blocked = () => { const g = root.DemoGuard; if (g) g.interceptExport('Excel (.xlsx)'); return null; };
  const exportXlsx = blocked, buildSheets = blocked, writeXlsx = blocked;

  /* ================= นำเข้า ================= */
  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return new Uint8Array(x || 0);
  }
  // ตรวจไบต์ก่อนโหลดไลบรารี — ไฟล์ว่าง/ใหญ่เกิน/.xls เก่า/ไม่ใช่ zip ได้ข้อความภาษาไทยทันที
  function precheck(buf) {
    const b = toBytes(buf);
    if (!b.length) throw new Error(ERR.empty);
    if (b.length > LIMITS.bytes) throw new Error(ERR.big);
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) throw new Error(ERR.xls);
    if (b.length < 22 || !(b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04)) throw new Error(ERR.bad);
    return b;
  }

  let libP = null;
  function loadLib() {
    if (root.XLSX && typeof root.XLSX.read === 'function') return Promise.resolve(root.XLSX);
    if (typeof document === 'undefined') {
      try { return Promise.resolve(require('../vendor/sheetjs/xlsx.mini.min.js')); } catch (e) { return Promise.reject(new Error(ERR.lib)); }
    }
    if (!libP) {
      libP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('vendor/sheetjs/xlsx.mini.min.js', location.href).href;
        s.onload = () => (root.XLSX && typeof root.XLSX.read === 'function' ? resolve(root.XLSX) : reject(new Error(ERR.lib)));
        s.onerror = () => reject(new Error(ERR.lib));
        document.head.appendChild(s);
      }).catch((e) => { libP = null; throw e; });
    }
    return libP;
  }

  const cellVal = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    return String(v).replace(/[\t\r\n\u2028\u2029]+/g, ' ').trim();
  };
  // อ่านไฟล์ → [{ name, rows }] (เฉพาะชีตที่มีข้อมูล; ข้ามชีตซ่อนถ้ามีชีตที่มองเห็น) — สูตรใช้ค่าที่คำนวณไว้ ไม่ประมวลสูตร
  function readWorkbook(buf, X) {
    const b = precheck(buf);
    let wb;
    try {
      wb = X.read(b, { type: 'array', dense: true, sheetRows: LIMITS.rows + 1, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellDates: false, bookVBA: false });
    } catch (e) { throw new Error(ERR.bad); }
    if (!wb || !Array.isArray(wb.SheetNames) || !wb.SheetNames.length || !wb.Sheets) throw new Error(ERR.bad);
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    const out = [];
    wb.SheetNames.slice(0, LIMITS.sheets).forEach((name, i) => {
      const ws = wb.Sheets[name];
      if (!ws) return;
      let rows;
      try { rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false }); } catch (e) { return; }
      rows = rows.slice(0, LIMITS.rows).map((r) => (Array.isArray(r) ? r.slice(0, LIMITS.cols).map(cellVal) : []));
      if (rows.some((r) => r.some((c) => c !== ''))) out.push({ name: String(name), rows, hidden: !!(meta[i] && meta[i].Hidden) });
    });
    const shown = out.filter((s) => !s.hidden);
    const list = shown.length ? shown : out;
    if (!list.length) throw new Error(ERR.noData);
    return list;
  }

  /* ---- ชีต → ข้อความสำหรับ Importer.parseText ---- */
  const normH = (s) => String(s == null ? '' : s).toLowerCase().replace(/\([^)]{0,30}\)/g, ' ').replace(/[._:#]+/g, ' ').replace(/\s+/g, ' ').trim();
  const SCHED_COLS = {
    no: /^(?:cct|ckt|cir|circuit)(?: ?no)?$|^วงจร(?:ที่)?$/,
    desc: /^(?:description|desc|load description|รายการ|รายละเอียด|รายการโหลด)$/,
    pole: /^(?:pole|poles|ขั้ว)$/,
    at: /^(?:at|cb at|ขนาด at)$/,
    va: /^(?:va|load va|va [abc]|ph [abc] va)$/,
    rcbo: /^(?:rcbo|rcd|elcb)$/,
    cbtype: /^(?:cb type|breaker type|ชนิด cb)$/,
    ic: /^(?:ic|ic ka)$/, cond: /^(?:conductor|wire|สายไฟ)$/, cable: /^(?:cable|ชนิดสาย)$/, conduit: /^(?:conduit|ท่อ)$/, ctype: /^(?:conduit type|ชนิดท่อ)$/
  };
  function scheduleCols(rec) {
    const c = { va: [] };
    rec.forEach((cell, i) => {
      const h = normH(cell);
      if (!h) return;
      for (const k of Object.keys(SCHED_COLS)) {
        if (!SCHED_COLS[k].test(h)) continue;
        if (k === 'va') c.va.push(i); else if (c[k] == null) c[k] = i;
        break;
      }
    });
    return c.no != null && c.desc != null && c.pole != null && c.at != null && c.va.length ? c : null;
  }
  const clean = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  const numOf = (v) => { if (typeof v === 'number') return v; const s = String(v == null ? '' : v).replace(/[,\s]/g, ''); return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN; };

  // ตารางโหลดแผง (CCT NO. / Description / Pole / AT / VA…) → ข้อความแบบ Panel Board Schedule ที่ Importer อ่านได้
  function scheduleText(rows, sheetName) {
    let hi = -1, c = null;
    for (let i = 0; i < Math.min(rows.length, 30); i++) { c = scheduleCols(rows[i]); if (c) { hi = i; break; } }
    if (hi < 0) return null;
    let panel = '', loc = '';
    rows.slice(0, hi).forEach((r) => r.forEach((cell) => {
      const s = String(cell); let x;
      if (!panel && (x = /ตารางโหลด\s*[:：]?\s*(\S.{0,40})$/.exec(s) || /PANEL\s{0,3}(?:NO\.?|NAME)?\s{0,3}[:：]?\s{0,3}(\S.{0,40})$/i.exec(s))) panel = x[1].trim();
      if (!loc && (x = /(?:ตำแหน่ง|LOCATION)\s*[:：]\s*(\S.{0,150})$/i.exec(s))) loc = x[1].trim();
    }));
    panel = clean(panel || sheetName).replace(/\s+/g, '-');
    const circuits = [], byDesc = new Map();
    let connected = null;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const head = clean(r[0]);
      if (/^TOTAL/i.test(head)) { const k = r.findIndex((x) => /^connected/i.test(String(x))); if (k >= 0 && Number.isFinite(numOf(r[k + 1]))) connected = numOf(r[k + 1]); continue; }
      const no = numOf(r[c.no]);
      if (!Number.isInteger(no) || no < 1 || no > 999) continue;
      const desc = clean(r[c.desc]);
      const va = c.va.reduce((s, k) => { const v = numOf(r[k]); return s + (Number.isFinite(v) ? v : 0); }, 0);
      const cont = /^\(ต่อ\)\s*/.exec(desc);
      if (cont) { const t = byDesc.get(desc.slice(cont[0].length)); if (t) t.va += va; continue; }
      if (!desc || /^(?:spare|space|ว่าง)(?![A-Za-z0-9ก-๙])/i.test(desc)) continue;
      const pole = Math.min(4, Math.max(1, Math.round(numOf(r[c.pole])) || 1));
      const at = Math.round(numOf(r[c.at])) || 0;
      const rc = c.rcbo != null && clean(r[c.rcbo]) && !/^(?:-|no|ไม่มี|0)$/i.test(clean(r[c.rcbo]));
      const ty = c.cbtype != null && /MCCB/i.test(String(r[c.cbtype])) ? 'MCCB' : 'MCB';
      const opt = (k) => (c[k] != null && clean(r[c[k]]) ? clean(r[c[k]]) : '-');
      const circ = { no, desc, pole, at, cb: rc ? 'RCBO' : ty, ic: opt('ic'), cond: opt('cond'), cable: opt('cable'), conduit: opt('conduit'), ctype: opt('ctype'), va };
      circuits.push(circ); byDesc.set(desc, circ);
    }
    if (!circuits.length) return null;
    const out = [`PANEL NO: ${panel}`];
    if (loc) out.push(`LOCATION: ${clean(loc)}`);
    out.push('CKT | DESCRIPTION | POLE | AT | TYPE | IC | WIRE | CABLE | CONDUIT | TYPE | VA');
    circuits.forEach((x) => out.push(`${x.no} | ${x.desc} | ${x.pole} | ${x.at} | ${x.cb} | ${x.ic} | ${x.cond} | ${x.cable} | ${x.conduit} | ${x.ctype} | ${Math.round(x.va)}`));
    if (connected != null) out.push(`TOTAL CONNECTED LOAD: ${Math.round(connected)} VA`);
    return { text: out.join('\n'), circuits: circuits.length, panel };
  }
  // ตารางทั่วไป → TSV เริ่มที่แถวหัวตาราง (แถวชื่อเรื่องด้านบนตัดทิ้ง) ให้ตัวอ่าน CSV เดิมจับคอลัมน์จากหัวตาราง
  function tableText(rows) {
    const tsv = (rs) => rs.map((r) => r.map((v) => (typeof v === 'number' ? String(v) : clean(v).replace(/\t/g, ' '))).join('\t').replace(/\t+$/, '')).join('\n');
    const imp = root.Importer;
    if (imp && imp.sniffTable) {
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const t = tsv(rows.slice(i));
        const spec = imp.sniffTable(t);
        if (spec && spec.header) return t;
      }
    }
    return tsv(rows);
  }
  function describe(book) {
    return book.map((s) => {
      const sc = scheduleText(s.rows, s.name);
      return sc ? { name: s.name, kind: 'schedule', text: sc.text, n: sc.circuits } : { name: s.name, kind: 'table', text: tableText(s.rows), n: s.rows.length };
    });
  }
  // choice: ดัชนีชีต หรือ 'all' (ตารางโหลดทุกชีต); ไม่ระบุ = ตารางโหลดทุกชีต ถ้ามี ไม่งั้นชีตแรก
  function bookText(list, choice) {
    const scheds = list.filter((s) => s.kind === 'schedule');
    if (choice === 'all' || (choice == null && scheds.length)) return (scheds.length ? scheds : list.slice(0, 1)).map((s) => s.text).join('\n\n');
    const s = list[Number(choice)] || list[0];
    return s.text;
  }

  /* ---- กล่องเลือกชีต (ใช้ #modal เดียวกับกล่องยืนยันของแอป) ---- */
  function pickSheetDialog(list, fileName) {
    const m = typeof document !== 'undefined' && document.getElementById('modal');
    if (!m) return Promise.resolve(null);
    const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const scheds = list.filter((s) => s.kind === 'schedule').length;
    const opts = [];
    if (scheds >= 2) opts.push({ v: 'all', label: `ตารางโหลดทุกชีต (${scheds} แผง)`, sub: 'แนะนำสำหรับไฟล์ที่ส่งออกจากโปรแกรมนี้' });
    list.forEach((s, i) => opts.push({ v: String(i), label: s.name, sub: s.kind === 'schedule' ? `ตารางโหลด ${s.n} วงจร` : `ตาราง ${s.n} แถว` }));
    const def = scheds >= 2 ? 'all' : String(Math.max(0, list.findIndex((s) => s.kind === 'schedule')));
    return new Promise((resolve) => {
      m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-label="เลือกชีตที่จะนำเข้า"><h3>เลือกชีตที่จะนำเข้า</h3><p>${esc(fileName || 'ไฟล์ Excel')} มี ${list.length} ชีต</p>
        <div style="display:grid;gap:6px;max-height:min(50vh,360px);overflow:auto;margin:0 0 14px">${opts.map((o) => `<label class="check" style="align-items:flex-start;gap:8px"><input type="radio" name="xlsxSheet" value="${esc(o.v)}" ${o.v === def ? 'checked' : ''}><span><b>${esc(o.label)}</b><br><span class="muted tiny">${esc(o.sub)}</span></span></label>`).join('')}</div>
        <div class="modal-f"><button class="btn" data-m-cancel>ยกเลิก</button><button class="btn dark" data-m-ok>นำเข้า</button></div></div>`;
      m.classList.add('on');
      const finish = (v) => { m.classList.remove('on'); m.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const chosen = () => { const r = m.querySelector('input[name="xlsxSheet"]:checked'); return r ? r.value : def; };
      const onClick = (e) => { if (e.target.closest('[data-m-ok]')) finish(chosen()); else if (e.target.closest('[data-m-cancel]') || e.target === m) finish(null); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
        else if (e.key === 'Enter' && !(document.activeElement && document.activeElement.closest('[data-m-cancel]'))) { e.preventDefault(); e.stopPropagation(); finish(chosen()); }
      };
      m.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);
      setTimeout(() => { const r = m.querySelector('input[name="xlsxSheet"]:checked') || m.querySelector('[data-m-ok]'); if (r) r.focus(); }, 30);
    });
  }

  // opts.pickSheet(list, fileName) → Promise<ดัชนี | 'all' | null(ยกเลิก)> ; ไม่ส่งมา = ใช้กล่องเลือกในหน้าเว็บ (ถ้ามีหลายชีต)
  async function readFile(file, progress, opts) {
    progress && progress('อ่านไฟล์ Excel', 0.1);
    const buf = precheck(new Uint8Array(await file.arrayBuffer()));
    const X = await loadLib();
    progress && progress('อ่านไฟล์ Excel', 0.4);
    const list = describe(readWorkbook(buf, X));
    let choice = null;
    if (list.length > 1) {
      const pick = (opts && opts.pickSheet) || (typeof document !== 'undefined' ? pickSheetDialog : null);
      if (pick) { choice = await pick(list, file.name); if (choice == null) throw new Error(ERR.cancel); }
    }
    progress && progress('อ่านไฟล์ Excel', 1);
    return { text: bookText(list, choice), kind: 'text', sheets: list.length };
  }

  const API = { exportXlsx, buildSheets, writeXlsx, readWorkbook, readFile, describe, bookText, scheduleText, tableText, precheck, loadLib, ERR, MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  root.XlsxIO = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
