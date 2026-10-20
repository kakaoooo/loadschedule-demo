/*
 * อ่านไฟล์ที่ผู้ใช้อัปโหลด → ข้อความ (ทำงานในเครื่อง ไม่ส่งไฟล์ออกไปไหน)
 *  - .xlsx .xlsm        : อ่านด้วย XlsxIO (js/xlsx-io.js) → ข้อความตาราง
 *  - .txt .csv .tsv .md : อ่านตรง (ถอดรหัส UTF-8 / UTF-8 BOM / UTF-16 / TIS-620 อัตโนมัติ — Reader.decodeText)
 *  - .pdf               : ดึงข้อความด้วย pdf.js ถ้าหน้าไหนไม่มีข้อความ (สแกน) จะ OCR ให้
 *  - รูปภาพ             : OCR ด้วย Tesseract (ภาษาไทย + อังกฤษ)
 */
(function (root) {
  'use strict';
  let ocrWorker = null, pdfjs = null;

  // เครื่องหมายแบ่งหน้าใน PDF หลายหน้า — Importer.parseText ข้ามบรรทัดนี้
  const pageMarker = (i) => `--- หน้า ${i} ---`;

  /*
   * ถอดรหัสไฟล์ข้อความ: UTF-8 BOM / UTF-16 LE-BE (มี BOM หรือเดาจากไบต์ 0) / UTF-8 ล้วน (strict)
   * ถ้าไม่ใช่ UTF-8 ที่ถูกต้อง ถือเป็น windows-874 (TIS-620) ซึ่ง Excel ไทยบันทึก "CSV (Comma delimited)" เป็นแบบนี้
   */
  function toBytes(x) {
    if (x instanceof Uint8Array) return x;
    if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return new Uint8Array(x || 0);
  }
  function decodeText(buf) {
    const b = toBytes(buf);
    if (!b.length) return '';
    const dec = (enc, bytes, opt) => new TextDecoder(enc, opt).decode(bytes);
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return dec('utf-8', b.subarray(3));
    if (b[0] === 0xFF && b[1] === 0xFE) return dec('utf-16le', b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return dec('utf-16be', b.subarray(2));
    // UTF-16 ไม่มี BOM: ข้อความ ASCII จะมีไบต์ 0 สลับตำแหน่งสม่ำเสมอ
    const n = Math.min(b.length, 400) >> 1;
    if (n >= 4) {
      let odd = 0, even = 0;
      for (let i = 0; i < n; i++) { if (b[2 * i] === 0) even++; if (b[2 * i + 1] === 0) odd++; }
      if (odd >= n * 0.3 && even === 0) return dec('utf-16le', b);
      if (even >= n * 0.3 && odd === 0) return dec('utf-16be', b);
    }
    try { return dec('utf-8', b, { fatal: true }); } catch (e) { /* ไม่ใช่ UTF-8 */ }
    try { return dec('windows-874', b); } catch (e) { return dec('utf-8', b); }
  }

  // ตัดช่องว่างก่อนสระ/วรรณยุกต์ (PDF ไทยแตกคำเป็นหลายชิ้น) — เชิงเส้น: ยุบช่องว่างก่อน แล้วลบ " " เดี่ยวหน้าสระ
  const fixThaiSpacing = (s) => String(s).replace(/\x00/g, '').replace(/\s+/g, ' ').replace(/ (?=[ัำ-ฺ็-๎])/g, '').trim();

  async function getOCR(progress) {
    if (ocrWorker) return ocrWorker;
    progress && progress('กำลังโหลดตัวอ่านตัวอักษร (ครั้งแรกใช้เวลาสักครู่)…', 0.05);
    ocrWorker = await root.Tesseract.createWorker(['tha', 'eng'], 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href,
      corePath: new URL('vendor/tesseract/core', location.href).href,
      langPath: new URL('vendor/tesseract/lang', location.href).href,
      gzip: true,
      logger: (m) => { if (progress && m.status === 'recognizing text') progress('กำลังอ่านตัวอักษร…', 0.15 + m.progress * 0.8); }
    });
    return ocrWorker;
  }
  async function getPDF() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    return pdfjs;
  }

  /*
   * เตรียมภาพก่อน OCR: ขยายภาพเล็ก → ขาวดำ (Otsu) → ลบเส้นตารางยาว ๆ (เส้นเหล่านี้ทำให้ Tesseract อ่านตัวอักษรเพี้ยน)
   * คืน { canvas, tableLike } — tableLike = พบเส้นตารางมาก ใช้โหมดอ่านทีละบรรทัด
   */
  async function prepCanvas(blob) {
    const bmp = await createImageBitmap(blob);
    const long = Math.max(bmp.width, bmp.height);
    const k = long < 2400 ? Math.min(3, 2400 / long) : (long > 4200 ? 4200 / long : 1);
    const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, W, H);
    const id = g.getImageData(0, 0, W, H), d = id.data, N = W * H;
    const gray = new Uint8Array(N), hist = new Uint32Array(256);
    for (let i = 0; i < N; i++) { const v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0; gray[i] = v; hist[v]++; }
    // Otsu
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let wB = 0, sB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; } }
    thr = Math.min(200, Math.max(90, thr));
    const dark = new Uint8Array(N); for (let i = 0; i < N; i++) dark[i] = gray[i] < thr ? 1 : 0;
    // เส้นตาราง = แนวนอน/แนวตั้งที่ดำต่อเนื่องยาวเกิน minRun
    const minRun = Math.max(40, Math.round(long * k * 0.022));
    const kill = new Uint8Array(N); let lines = 0;
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (dark[y * W + x]) { let x2 = x; while (x2 < W && dark[y * W + x2]) x2++; if (x2 - x >= minRun) { lines++; for (let q = x; q < x2; q++) kill[y * W + q] = 1; } x = x2; } else x++; } }
    for (let x = 0; x < W; x++) { let y = 0; while (y < H) { if (dark[y * W + x]) { let y2 = y; while (y2 < H && dark[y2 * W + x]) y2++; if (y2 - y >= minRun) { lines++; for (let q = y; q < y2; q++) kill[q * W + x] = 1; } y = y2; } else y++; } }
    const tableLike = lines > 60;
    for (let i = 0; i < N; i++) { const v = dark[i] && !(tableLike && kill[i]) ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
    return { canvas: c, tableLike };
  }
  async function ocrBlob(blob, progress) {
    const w = await getOCR(progress);
    const { canvas, tableLike } = await prepCanvas(blob);
    // preserve_interword_spaces: เว้นวรรคระหว่างคอลัมน์ตารางไว้ (ตัวอ่านตารางโหลดใช้ช่องว่างแยกคอลัมน์)
    const run = async (psm) => { await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }); return w.recognize(canvas); };
    const len = (x) => (x.data.text || '').replace(/\s/g, '').length;
    let r = await run(tableLike ? '6' : '3');
    // ความมั่นใจต่ำ: ลองอีกโหมด (ตาราง ↔ ทั้งหน้า) แล้วเลือกผลที่มั่นใจกว่า; ข้อความแทบไม่มี: โหมดข้อความกระจัดกระจาย
    if (len(r) >= 12 && r.data.confidence < 65) { const alt = await run(tableLike ? '4' : '6'); if (alt.data.confidence > r.data.confidence + 3 && len(alt) >= len(r) * 0.6) r = alt; }
    if (len(r) < 12) { const alt = await run('11'); if (len(alt) > len(r)) r = alt; }
    return r;
  }

  // จัดข้อความจาก pdf.js เป็นบรรทัดตามตำแหน่ง y
  function itemsToLines(items) {
    const rows = [];
    for (const it of items || []) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      // ระยะที่ถือว่าบรรทัดเดียวกัน: ครึ่งหนึ่งของความสูงตัวอักษร (ตัวใหญ่/เล็กในหน้าเดียวกันไม่ปนบรรทัด) อย่างน้อย 2 pt
      const tol = Math.max(2, Math.min(8, Math.abs(it.height || it.transform[3] || 6) * 0.5));
      let row = rows.find((r) => Math.abs(r.y - y) < tol);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    // ชิ้นที่ติดกัน (ช่องว่างแคบ) ต่อกันโดยไม่เว้นวรรค — PDF ภาษาไทยมักแตกคำเป็นหลายชิ้น
    return rows.map((r) => {
      const ps = r.parts.sort((a, b) => a.x - b.x);
      let s = '';
      ps.forEach((p, i) => { if (i) { const prev = ps[i - 1]; s += (p.x - (prev.x + prev.w) > 2) ? ' ' : ''; } s += p.s; });
      return fixThaiSpacing(s);
    }).join('\n');
  }

  async function readFile(file, progress, opts) {
    const name = String(file.name || '').toLowerCase(), mime = String(file.type || '');
    // Excel → ข้อความ (js/xlsx-io.js) แล้วให้ Importer อ่านต่อเหมือน CSV ; .xls เก่าได้ข้อความแนะนำจาก XlsxIO
    // (Windows ส่ง .csv มาเป็น application/vnd.ms-excel — ไฟล์ข้อความจึงไม่เข้าทางนี้)
    if (/\.xls[xm]?$/.test(name) || (/spreadsheetml|ms-excel/.test(mime) && !/\.(txt|csv|tsv|md)$/.test(name))) {
      if (!root.XlsxIO) throw new Error('ตัวอ่าน Excel ไม่พร้อมใช้งาน (js/xlsx-io.js)');
      return root.XlsxIO.readFile(file, progress, opts);
    }
    if (/\.(txt|csv|tsv|md)$/.test(name) || mime.startsWith('text/')) {
      progress && progress('อ่านไฟล์ข้อความ', 1);
      const text = typeof file.arrayBuffer === 'function' ? decodeText(await file.arrayBuffer()) : await file.text();
      return { text, kind: 'text' };
    }
    if (name.endsWith('.pdf') || mime === 'application/pdf') {
      const lib = await getPDF();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const out = [];
      let scanned = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        progress && progress(`อ่าน PDF หน้า ${i}/${doc.numPages}`, i / doc.numPages * 0.6);
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        let t = itemsToLines(tc.items);
        // ข้อความน้อยมาก = น่าจะเป็นแบบสแกน/เส้นล้วน → OCR ภาพหน้า
        if (t.replace(/\s/g, '').length < 40) {
          scanned++;
          const vp = page.getViewport({ scale: 3 });   // ~216 dpi — ตัวอักษรไทยเล็ก ๆ ในแบบสแกนอ่านได้ดีกว่าที่ 144 dpi
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
          t = (await ocrBlob(blob, progress)).data.text;
        }
        out.push(doc.numPages > 1 ? `${pageMarker(i)}\n${t}` : t);
      }
      return { text: out.join('\n'), kind: 'pdf', pages: doc.numPages, scanned };
    }
    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/.test(name)) {
      const r = await ocrBlob(file, progress);
      return { text: r.data.text, kind: 'image', conf: r.data.confidence };
    }
    throw new Error('ไม่รองรับไฟล์ชนิดนี้ (ใช้ .xlsx .csv .txt .pdf หรือรูปภาพ)');
  }

  const API = { readFile, decodeText, itemsToLines, pageMarker };
  root.Reader = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
