/*
 * ตรวจ/ล้างไฟล์โครงการก่อนใช้งาน (ไฟล์ .json ที่เปิด, localStorage, ผลนำเข้า)
 *  - โครงสร้างต้องครบ: panels[] / items[] / meta{}
 *  - ตัวเลขเป็นตัวเลขและอยู่ในช่วงที่ปลอดภัย, ตัวเลือก (enum) ต้องอยู่ในรายการ, id เหลือแค่ A-Z a-z 0-9 _ -
 *  - คีย์แปลก ๆ ถูกตัดทิ้ง (กันข้อมูลแฝง HTML / ค่าที่ทำให้ตัวคำนวณค้าง)
 * project(raw) -> { project, notes[] }   โยน Error ภาษาไทยถ้าไม่ใช่ไฟล์โครงการ
 */
(function (root) {
  'use strict';
  const D = root.LS_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  const E = root.LoadEngine || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const BR = root.LS_BRANDCB || (typeof require !== 'undefined' ? require('./brandcb.js') : null);   // ยี่ห้อ/รุ่นเบรกเกอร์ที่รับได้

  const TYPES = ['light', 'rec', 'ac', 'heater', 'cook', 'motor', 'fire_pump', 'lift', 'esc', 'chiller', 'ev', 'custom', 'spare'];
  const CATS = ['light', 'rec', 'ac', 'heater', 'cook', 'motor', 'other'];
  const MAX_PANELS = 500, MAX_ITEMS = 5000;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const NUMERIC = /^\s*-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\s*$/i;
  const toNum = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && NUMERIC.test(v) ? Number(v) : NaN));

  function makeCtx() { return { clamped: 0 }; }
  // ตัวเลขในช่วง [lo, hi]; ไม่ใช่ตัวเลข → ค่าเริ่มต้น; นับจำนวนค่าที่ต้องปรับ
  function num(ctx, v, def, lo, hi, int) {
    let n = toNum(v);
    if (!Number.isFinite(n)) { if (v !== undefined && v !== '' && v !== null) ctx.clamped++; return def; }
    const before = n;
    n = Math.min(hi, Math.max(lo, n));
    if (int) n = Math.round(n);
    if (n !== before) ctx.clamped++;
    return n;
  }
  const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max || 200);
  const en = (v, list, def) => (list.includes(v) ? v : def);
  const enNum = (v, list, def) => { const n = toNum(v); return list.includes(n) ? n : def; };
  const bool = (v) => v === true || v === 'true' || v === 1;

  /* ---------------- meta ---------------- */
  // ระดับใบอนุญาตผู้ประกอบวิชาชีพวิศวกรรมควบคุม (สภาวิศวกร): ภาคีวิศวกร / สามัญวิศวกร / วุฒิวิศวกร (ไฟฟ้ากำลัง)
  const LICENSE_TIERS = ['', 'ภฟก.', 'สฟก.', 'วฟก.'];
  // โลโก้: รับเฉพาะ data URL ของรูปแรสเตอร์ (ไม่รับ SVG/URL ภายนอก/สคริปต์) และไม่เกิน LOGO_MAX อักขระ (เก็บใน localStorage หลายโครงการ)
  const LOGO_MAX = 150000;
  const safeLogo = (v) => (typeof v === 'string' && v.length <= LOGO_MAX && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : '');
  const BUILDING = ['residential', 'condo', 'office', 'hotel', 'hospital', 'warehouse', 'other'];
  const ENUM = {
    buildingType: (v, d) => en(v, BUILDING, d), utility: (v, d) => en(v, ['PEA', 'MEA'], d), supply: (v, d) => en(v, ['transformer', 'lv'], d),
    licenseTier: (v, d) => en(v, LICENSE_TIERS, d), logo: (v) => safeLogo(v),
    hvKV: (v, d) => enNum(v, [12, 22, 24, 33], d), phasePattern: (v, d) => en(v, ['seq', 'pair'], d),
    'main.maxSize': (v, d) => enNum(v, [185, 240, 300, 400], d), maxParallelSize: (v, d) => enNum(v, [185, 240, 300], d)
  };
  ['branch', 'feeder', 'main'].forEach((k) => {
    ENUM[k + '.cable'] = (v, d) => en(v, Object.keys(D.CABLES).filter((c) => !D.CABLES[c].fire), d);   // สายทนไฟ (FRC) ใช้เฉพาะวงจรปั๊มดับเพลิง
    ENUM[k + '.method'] = (v, d) => en(v, Object.keys(D.METHODS), d);
    ENUM[k + '.conduit'] = (v, d) => en(v, D.CONDUIT_TYPES, d);
  });
  const RANGE = {
    vdBranch: [0.1, 20], vdFeeder: [0.1, 20], vdTotal: [0.1, 30], pfNow: [0.3, 1], pfTarget: [0.5, 1], ambientAir: [-20, 90], ambientGround: [-20, 90],
    lightMaxLoading: [0.1, 1], spareRatio: [0, 0.5], activeRatio: [0.3, 1], recVA: [1, 5000], recPerCircuit: [1, 100], growth: [0, 300],
    'main.length': [0, 2000], 'hv.length': [0, 2000], serviceKA: [1, 200], sourceKA: [0, 1000], branchFactor: [1, 2], feederFactor: [1, 2],
    cbLight: [6, 63], cbRec: [6, 63], branchIC: [1, 100], mccbICMin: [1, 100], floorHeight: [1, 20], minLight: [0.5, 95], minRec: [0.5, 95], minOther: [0.5, 95], minFeeder: [1, 240]
  };
  function cleanVal(ctx, path, v, d) {
    if (ENUM[path]) return ENUM[path](v, d);
    if (typeof d === 'number') { const r = RANGE[path] || [-1e9, 1e9]; return num(ctx, v, d, r[0], r[1]); }
    if (typeof d === 'boolean') return v === undefined ? d : bool(v);   // ไม่มีคีย์ = ค่าเริ่มต้น (autoSelectivity เริ่มต้นเปิด)
    if (path === 'date') return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d;
    return typeof v === 'string' || typeof v === 'number' ? str(v, 200) : d;
  }
  function cleanMeta(ctx, raw) {
    const def = E.defaultMeta(), src = isObj(raw) ? raw : {}, out = {};
    for (const k of Object.keys(def)) {
      const d = def[k], v = src[k];
      if (isObj(d)) {
        out[k] = {};
        for (const kk of Object.keys(d)) out[k][kk] = cleanVal(ctx, k + '.' + kk, isObj(v) ? v[kk] : undefined, d[kk]);
      } else out[k] = cleanVal(ctx, k, v, d);
    }
    return out;
  }

  /* ---------------- id ---------------- */
  function idOf(v, fallback, used) {
    let s = String(v == null ? '' : v).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 40);
    if (!s) s = fallback;
    let u = s, k = 2;
    while (used.has(u)) u = s + '_' + k++;
    used.add(u);
    return u;
  }

  /* ---------------- items ---------------- */
  // [ต่ำสุด, สูงสุด, ค่าเริ่มต้น, ยอมให้ว่าง, จำนวนเต็ม]
  const ISPEC = {
    qty: [1, 2000, 1, false, true], length: [1, 2000, 20, false, false], points: [1, 5000, 1, false, true], fixtures: [1, 20000, 1, false, true],
    perFixture: [1, 12, 1, false, true], circuits: [0, 500, 0, false, true], vaPerPoint: [1, 5000, '', true, false], perCircuit: [1, 100, '', true, true],
    btu: [1000, 1000000, 12000, false, false], watt: [0, 10000000, 0, false, false], kw: [0.1, 1000, 1.5, false, false], kva: [0, 100000, '', true, false],
    pf: [0.1, 1, 1, false, false], va: [0, 10000000, '', true, false], cb: [2, 6300, 16, false, true]
  };
  function cleanItem(ctx, it, id, panelId) {
    const type = it.type;
    const o = { id, panelId, type };
    if (it.name !== undefined) o.name = str(it.name, 120);
    if (it.room !== undefined) o.room = str(it.room, 120);
    for (const k of Object.keys(ISPEC)) {
      if (it[k] === undefined) continue;
      const [lo, hi, def, blank, int] = ISPEC[k];
      o[k] = blank && it[k] === '' ? '' : num(ctx, it[k], def, lo, hi, int);
    }
    // ที่ชาร์จรถไฟฟ้า: kw ว่าง = ใช้รุ่นมาตรฐาน (preset)
    if (type === 'ev' && it.kw === '') o.kw = '';
    if (it.preset !== undefined) {
      const t = type === 'lift' ? D.LIFTS : type === 'esc' ? D.ESCALATORS : type === 'ev' ? D.EV_CHARGERS : (it.cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER);
      o.preset = num(ctx, it.preset, 0, 0, Math.max(0, (t || []).length - 1), true);
    }
    if (it.phases !== undefined) { const n = toNum(it.phases); o.phases = n === 1 || n === 3 ? n : (it.phases === '' ? '' : (type === 'motor' || type === 'fire_pump' ? 3 : 1)); }
    if (it.start !== undefined) o.start = en(it.start, ['DOL', 'YD'], 'DOL');
    if (it.cooling !== undefined) o.cooling = en(it.cooling, ['water', 'air'], 'water');
    if (it.duty !== undefined) o.duty = en(it.duty, ['general', 'heavy'], 'general');
    if (it.cat !== undefined && CATS.includes(it.cat)) o.cat = it.cat;
    if (it.lamp !== undefined) o.lamp = (D.LAMPS.some((l) => l.id === it.lamp) ? it.lamp : 'led-t8-18');
    ['wet', 'continuous', 'rcd'].forEach((k) => { if (it[k] !== undefined) o[k] = bool(it[k]); });
    if (it.cbType === 'MCB' || it.cbType === 'MCCB') o.cbType = it.cbType;   // ชนิด CB ของโหลดต่อตรงที่ MDB/SDB
    // cbOv: ขนาด CB ที่ผู้ออกแบบกำหนดต่อวงจร { "ลำดับวงจรในอุปกรณ์": AT } — รับเฉพาะขนาดมาตรฐานของ MCB
    if (isObj(it.cbOv)) {
      const ov = {};
      Object.keys(it.cbOv).slice(0, 500).forEach((k) => {
        const idx = toNum(k), at = toNum(it.cbOv[k]);
        if (Number.isInteger(idx) && idx >= 1 && idx <= 500 && D.MCB_AT.includes(at)) ov[idx] = at;
      });
      if (Object.keys(ov).length) o.cbOv = ov;
    }
    // phOv: เฟสที่ผู้ออกแบบตรึงวงจรไว้ { "ลำดับวงจรในอุปกรณ์": 0|1|2 } (A/B/C)
    if (isObj(it.phOv)) {
      const pv = {};
      Object.keys(it.phOv).slice(0, 500).forEach((k) => {
        const idx = toNum(k), raw = it.phOv[k], ph = raw === '' || raw === null || typeof raw === 'boolean' ? NaN : toNum(raw);
        if (Number.isInteger(idx) && idx >= 1 && idx <= 500 && (ph === 0 || ph === 1 || ph === 2)) pv[idx] = ph;
      });
      if (Object.keys(pv).length) o.phOv = pv;
    }
    // brOv: รุ่นเบรกเกอร์ตามยี่ห้อที่ผู้ออกแบบเลือกต่อวงจร { "ลำดับวงจรในอุปกรณ์": "<ยี่ห้อ>|<รุ่น>" } — รับเฉพาะรุ่นที่มีในฐานข้อมูล
    if (it.brOv !== undefined && BR) { const [bo, bad] = BR.cleanItemOv(it.brOv); if (bo) o.brOv = bo; ctx.brandBad = (ctx.brandBad || 0) + (isObj(it.brOv) ? bad : 1); }
    return o;
  }

  /* ---------------- project ---------------- */
  function project(raw) {
    if (!isObj(raw)) throw new Error('ไม่ใช่ไฟล์โครงการ');
    if (!Array.isArray(raw.panels) || !raw.panels.length && !Array.isArray(raw.items)) throw new Error('ไม่ใช่ไฟล์โครงการ (ไม่พบรายการแผง)');
    if (!Array.isArray(raw.items)) throw new Error('ไม่ใช่ไฟล์โครงการ (ไม่พบรายการอุปกรณ์)');
    const ctx = makeCtx(), notes = [];
    const meta = cleanMeta(ctx, raw.meta);
    const brands = BR && isObj(raw.meta) ? BR.cleanMetaBrands(raw.meta.brands, notes) : undefined;   // ยี่ห้อ/ซีรีส์ระดับโครงการ + รุ่น CB ประธาน
    if (brands) meta.brands = brands;

    /* แผง */
    const rawPanels = raw.panels.filter(isObj).slice(0, MAX_PANELS);
    const usedP = new Set(), idMap = {};
    let hasMDB = false;
    const panels = rawPanels.map((p, i) => {
      const id = idOf(p.id, 'P' + (i + 1), usedP);
      if (!(String(p.id) in idMap)) idMap[String(p.id)] = id;
      let kind = en(p.kind, ['MDB', 'SDB', 'LP'], 'LP');
      if (kind === 'MDB') { if (hasMDB) { kind = 'SDB'; notes.push(`พบ MDB มากกว่า 1 แผง — ${str(p.name, 40) || id} ถูกเปลี่ยนเป็นแผงสวิตช์รอง`); } else hasMDB = true; }
      const o = { id, name: str(p.name, 60) || id, kind, phases: toNum(p.phases) === 1 ? 1 : 3, parent: kind === 'MDB' ? null : (p.parent == null ? null : String(p.parent)) };
      if (p.feederLength !== undefined) o.feederLength = p.feederLength === '' ? 0 : num(ctx, p.feederLength, 20, 0, 2000);
      if (p.floor !== undefined && p.floor !== null && p.floor !== '') {
        let flNum = NaN;
        if (typeof p.floor === 'number') flNum = p.floor;
        else if (typeof p.floor === 'string') {
          const s = p.floor.trim().toUpperCase();
          if (/^B\d+$/.test(s)) flNum = -parseInt(s.slice(1), 10);
          else if (s === 'B' || s === 'BASEMENT') flNum = -1;
          else if (s === 'G' || s === 'GROUND') flNum = 1;
          else if (s === 'M' || s === 'MEZZ' || s === 'MEZZANINE') flNum = 1.5;   // ชั้นลอย = ครึ่งชั้นเหนือชั้น 1
          else flNum = toNum(s);
        }
        if (Number.isFinite(flNum)) o.floor = Math.max(-20, Math.min(200, Math.round(flNum * 2) / 2));   // ขั้นละครึ่งชั้น (ชั้นลอย 1.5)
      }   // ชั้นของแผง (Riser): ลบ = ชั้นใต้ดิน
      if (p.location !== undefined) o.location = str(p.location, 100);
      if (p.mounting !== undefined) o.mounting = en(p.mounting, ['SURFACE', 'FLUSH'], 'SURFACE');
      if (p.nonlinear !== undefined) o.nonlinear = bool(p.nonlinear);
      if (p.emergency !== undefined) o.emergency = bool(p.emergency);
      if (typeof p.tap === 'string' && p.tap.trim().toLowerCase() === 'ahead_of_main') o.tap = 'ahead_of_main';   // ต่อก่อนเมนสวิตช์ (NFPA 20) ; ค่าอื่นตัดทิ้ง — engine ตรวจตำแหน่งแผงอีกชั้น
      if (p.ways !== undefined) o.ways = p.ways === '' ? '' : enNum(p.ways, D.PANEL_WAYS, '');
      const ph = toNum(p.phase); if ([0, 1, 2].includes(ph)) o.phase = ph;
      if (p.balance === 'deep') o.balance = 'deep';
      if (['res', 'com', 'none'].includes(p.unit)) o.unit = p.unit;
      if (p.brOv !== undefined && p.brOv !== '' && BR) { const bo = BR.cleanBoardOv(p.brOv); if (bo) o.brOv = bo; else ctx.brandBad = (ctx.brandBad || 0) + 1; }   // รุ่น MCCB ของ CB สายป้อนแผงนี้
      if (p.spareCount !== undefined && p.spareCount !== '') { const sc = toNum(p.spareCount); if (Number.isFinite(sc)) o.spareCount = Math.min(200, Math.max(0, Math.round(sc))); }
      return o;
    });
    if (!hasMDB) {
      const id = idOf('MDB', 'MDB', usedP);
      panels.unshift({ id, name: 'MDB', kind: 'MDB', phases: 3, parent: null });
      hasMDB = true;
      notes.push('ไม่พบแผงสวิตช์ประธาน (MDB) — สร้างให้ใหม่ 1 แผง');
    }
    const mdb = panels.find((p) => p.kind === 'MDB');
    const byId = Object.fromEntries(panels.map((p) => [p.id, p]));
    let fixed = 0;
    for (const p of panels) {
      if (p.kind === 'MDB') continue;
      const par = p.parent == null ? null : byId[idMap[p.parent] || p.parent];
      if (!par || par === p || par.kind === 'LP') { if (p.parent != null || !par) fixed += p.parent == null ? 0 : 1; p.parent = mdb.id; } else p.parent = par.id;
    }
    for (const p of panels) {                                   // ตัดวงวน: เดินขึ้นไปจนถึง MDB
      const seen = new Set();
      let cur = p;
      while (cur && cur.kind !== 'MDB') {
        if (seen.has(cur.id)) { cur.parent = mdb.id; fixed++; break; }
        seen.add(cur.id);
        cur = byId[cur.parent];
      }
    }
    if (fixed) notes.push(`ซ่อมการรับไฟของแผง ${fixed} แผง (แม่ไม่มีอยู่/วนกลับ/เป็นแผงย่อย) — ย้ายไปรับไฟจาก MDB`);

    /* อุปกรณ์ */
    const usedI = new Set();
    let ghost = 0, weird = 0;
    const items = [];
    raw.items.slice(0, MAX_ITEMS).forEach((it, i) => {
      if (!isObj(it)) { weird++; return; }
      if (!TYPES.includes(it.type)) { weird++; return; }
      const pid = idMap[String(it.panelId)];
      if (!pid) { ghost++; return; }
      items.push(cleanItem(ctx, it, idOf(it.id, 'i' + (i + 1), usedI), pid));
    });
    if (raw.items.length > MAX_ITEMS) notes.push(`รายการอุปกรณ์เกิน ${MAX_ITEMS} — ตัดส่วนที่เกินออก`);
    if (ghost) notes.push(`ตัดอุปกรณ์ที่ชี้ไปแผงที่ไม่มีอยู่ ${ghost} รายการ`);
    if (weird) notes.push(`ตัดรายการที่อ่านไม่ได้/ชนิดอุปกรณ์ไม่รู้จัก ${weird} รายการ`);
    if (ctx.brandBad) notes.push(`ตัดรุ่นเบรกเกอร์ที่ไม่มีในฐานข้อมูลยี่ห้อ ${ctx.brandBad} รายการ — ใช้ค่าโครงการแทน`);
    if (ctx.clamped) notes.push(`ปรับค่าที่เกินช่วงที่ปลอดภัย ${ctx.clamped} ค่า`);

    return { project: { version: 1, meta, panels, items }, notes };
  }

  const API = { project };
  root.Sanitize = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
