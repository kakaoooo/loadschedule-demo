/*
 * เบรกเกอร์ตามยี่ห้อ — ตัวเลือกรุ่นจากฐานข้อมูล LS_BRANDS (public/js/brands.js สร้างโดย tools/import-brands.js)
 * ค่าเริ่มต้น "ทั่วไป (ตาราง วสท.)" = ไม่มี meta.brands และไม่มีค่ากำหนดรายตัว → context() คืน null และตัวคำนวณทำงานแบบเดิมทุกอย่าง
 *
 * ที่เก็บค่าในโครงการ:
 *   meta.brands = { mcb: { brand, series }, mccb: { brand, series }, main: '<รหัสรุ่น MCCB>' }   brand '' = ทั่วไป, series '' = ทุกซีรีส์ของยี่ห้อ
 *   item.brOv   = { "<ลำดับวงจรในอุปกรณ์>": '<รหัสรุ่น>' }   CB วงจรย่อย (MCB/RCBO หรือ MCCB ตามชนิด CB ของวงจร)
 *   board.brOv  = '<รหัสรุ่น MCCB>'                          CB สายป้อนที่จ่ายแผงนี้ (อยู่ที่แผงแม่)
 * รหัสรุ่น = "<ยี่ห้อย่อ>|<Sub_Model>" เช่น "Schneider|NSX160F"
 * ข้อมูลรวบรวมจากการค้นเว็บ ไม่ใช่ตารางแคตตาล็อกโดยตรง → ทุกผลที่ใช้ข้อมูลนี้ติดป้าย SRC_BRAND
 */
(function (root) {
  'use strict';
  const B = root.LS_BRANDS || (typeof require !== 'undefined' ? require('./brands.js') : null);
  const SRC_BRAND = 'ข้อมูลผู้ผลิต — ตรวจกับแคตตาล็อก';
  const SRC_GENERIC = 'ประเมินเบื้องต้น';
  const GENERIC_NAME = 'ทั่วไป (ตาราง วสท.)';

  const MCCB = B ? B.mccb.map((m) => Object.assign({ type: 'MCCB' }, m)) : [];
  const MCB = B ? B.mcb.map((m) => Object.assign({ type: m.kind }, m)) : [];   // type 'MCB' | 'RCBO'
  const BY_ID = new Map();
  MCCB.concat(MCB).forEach((m) => { if (!BY_ID.has(m.id)) BY_ID.set(m.id, m); });
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? '-' : String(Math.round(Number(x) * 10 ** d) / 10 ** d));

  const find = (id) => (typeof id === 'string' ? BY_ID.get(id) || null : null);
  const rowsOf = (type) => (type === 'MCCB' ? MCCB : MCB.filter((m) => m.type === type));
  // ยี่ห้อ/ซีรีส์ที่มีในฐานข้อมูล: [{ brand, name, series: [..] }] (ซีรีส์ของ MCB ไม่นับซีรีส์ที่มีแต่ RCBO)
  function brands(type) {
    const out = new Map();
    for (const m of rowsOf(type === 'MCCB' ? 'MCCB' : 'MCB')) {
      if (!out.has(m.brandShort)) out.set(m.brandShort, { brand: m.brandShort, name: m.brand, series: [] });
      const s = out.get(m.brandShort).series;
      if (!s.includes(m.series)) s.push(m.series);
    }
    return [...out.values()];
  }
  const ratingOf = (m) => (m.type === 'MCCB' ? m.icu : m.icn);   // MCB/RCBO ใช้ Icn (IEC 60898/61009) เป็น IC
  const ratingName = (m) => (m.type === 'MCCB' ? 'Icu' : 'Icn');
  const polesOk = (m, poles) => !poles || Math.max(...m.poles) >= poles;   // MCCB 3P ใช้แทน 2P ได้
  const nameOf = (m) => `${m.brandShort} ${m.model}`;
  const selName = (s) => (s ? `${s.brand}${s.series ? ' ' + s.series : ''}` : GENERIC_NAME);

  // รุ่นที่เป็นตัวเลือกของค่าโครงการ {brand, series}: RCBO ใช้ซีรีส์เดียวกันก่อน ไม่มีจึงใช้ทุกซีรีส์ของยี่ห้อ
  function pool(type, s) {
    if (!s || !s.brand) return [];
    const rows = rowsOf(type).filter((m) => m.brandShort === s.brand);
    const same = rows.filter((m) => !s.series || m.series === s.series);
    return type === 'RCBO' && !same.length ? rows : same;
  }
  // ค่าโครงการที่ใช้ได้จริง (ยี่ห้อ/ซีรีส์ต้องมีในฐานข้อมูล)
  function selOf(meta, key) {
    const s = meta && isObj(meta.brands) && isObj(meta.brands[key]) ? meta.brands[key] : null;
    if (!s || typeof s.brand !== 'string' || !s.brand) return null;
    const b = brands(key === 'mccb' ? 'MCCB' : 'MCB').find((x) => x.brand === s.brand);
    if (!b) return null;
    return { brand: b.brand, series: typeof s.series === 'string' && b.series.includes(s.series) ? s.series : '' };
  }
  const typeMatches = (m, type) => (type === 'MCCB' ? m.type === 'MCCB' : m.type === 'MCB' || m.type === 'RCBO');

  /* ---- ตัวคำนวณเรียกผ่าน context ---- */
  // ctx = null → ไม่มีอะไรเกี่ยวกับยี่ห้อเลย (ทั่วไป) ; type = 'MCB' | 'RCBO' | 'MCCB'
  function context(meta, project) {
    const sel = { MCB: selOf(meta, 'mcb'), MCCB: selOf(meta, 'mccb') };
    sel.RCBO = sel.MCB;
    const mainOv = meta && isObj(meta.brands) && find(meta.brands.main) && find(meta.brands.main).type === 'MCCB' ? meta.brands.main : null;
    const anyOv = !!mainOv || (project && Array.isArray(project.items) && project.items.some((it) => it && isObj(it.brOv) && Object.keys(it.brOv).length))
      || (project && Array.isArray(project.panels) && project.panels.some((p) => p && typeof p.brOv === 'string' && p.brOv));
    if (!sel.MCB && !sel.MCCB && !anyOv) return null;

    // รุ่นที่เป็นไปได้: กำหนดรายตัว (ชนิดต้องตรง) หรือ pool ของค่าโครงการ
    function cands(type, poles, ovId) {
      const ov = find(ovId);
      if (ov && typeMatches(ov, type)) return { list: polesOk(ov, poles) ? [ov] : [], ov, label: nameOf(ov) };
      let list = pool(type, sel[type]).filter((m) => polesOk(m, poles));
      let t = type;
      if (type === 'RCBO' && !list.length) { list = pool('MCB', sel.MCB).filter((m) => polesOk(m, poles)); t = 'MCB'; }   // RCBO 3 เฟสไม่มีในฐานข้อมูล → MCB + RCD แยก
      return { list, ov: null, label: selName(sel[t]), badOv: ovId ? (ov ? `${nameOf(ov)} (ชนิด ${ov.type} ใช้กับ CB ${type === 'RCBO' ? 'MCB' : type} ไม่ได้)` : String(ovId)) : null };
    }
    // ขนาด AT ที่ขายจริง (รวมทุกรุ่นที่เป็นตัวเลือก) — null = ไม่มียี่ห้อสำหรับ CB ตัวนี้
    function list(type, poles, ovId) {
      if (type !== 'MCB' && type !== 'RCBO' && type !== 'MCCB') return null;
      const c = cands(type, poles, ovId);
      if (!c.list.length) return null;
      const s = new Set();
      c.list.forEach((m) => m.at.forEach((a) => s.add(a)));
      return [...s].sort((a, b) => a - b);
    }
    // เลือกรุ่นเมื่อรู้ AT และ Ik แล้ว: มี AT นั้น + ขั้วพอ → ที่ IC ≥ Ik ก่อน, เฟรมเล็กสุด, IC ต่ำสุดที่พอ (ไม่มีรุ่นพอ = IC สูงสุด)
    // ev = วงจรชาร์จรถไฟฟ้า: RCBO ต้องมี RCD Type A/B/F (ตัด Type AC) ; ไม่มีรุ่นที่ผ่าน → evNoType (ใช้ค่าทั่วไป คง RCD 30 mA ไว้ ห้ามถอยเป็น MCB) ; รุ่นที่ผู้ใช้กำหนดเองไม่กรอง (apply() เตือนแทน)
    function pick(type, at, poles, ik, ovId, ev) {
      if (type !== 'MCB' && type !== 'RCBO' && type !== 'MCCB') return { model: null };
      const c = cands(type, poles, ovId);
      if (!c.list.length) return { model: null, label: c.label, badOv: c.badOv, none: true };
      let has = c.list.filter((m) => m.at.includes(at));
      if (!has.length) return { model: null, label: c.label, badOv: c.badOv, notOffered: true, avail: list(type, poles, ovId) };
      if (ev && !c.ov) {
        has = has.filter((m) => m.type !== 'RCBO' || evRcdOk(m));
        if (!has.length) return { model: null, label: c.label, badOv: c.badOv, evNoType: true };
      }
      // ตัวเลือกอัตโนมัติ: มีรุ่นที่ยืนยันแคตตาล็อกในกลุ่มเดียวกัน → เลือกเฉพาะรุ่นที่ยืนยัน (รุ่นไม่ยืนยันที่ IC ต่ำกว่าไม่แย่งเลือก) ; รุ่นที่ผู้ใช้กำหนดเองไม่กรอง
      if (!c.ov && has.some((m) => m.verified)) has = has.filter((m) => m.verified);
      const ok = has.filter((m) => ratingOf(m) >= (ik || 0) - 1e-9);
      const from = ok.length ? ok : has;
      // มีรุ่นที่ IC พอ → เฟรมเล็กสุด แล้ว IC ต่ำสุดที่พอ ; ไม่มีรุ่นไหนพอ → IC สูงสุดก่อน (ใกล้ Ik" ที่สุด) แล้วค่อยเฟรมเล็ก — เดิมเรียงเฟรมก่อนจึงเลือกรุ่น IC ต่ำสุดของเฟรมเล็กสุด (เช่น Fuji BW32SAG 2.5 kA ที่จุด Ik" 19.9 kA)
      from.sort((a, b) => (ok.length ? (a.af || 0) - (b.af || 0) || ratingOf(a) - ratingOf(b) : ratingOf(b) - ratingOf(a) || (a.af || 0) - (b.af || 0)));
      return { model: from[0], label: c.label, badOv: c.badOv, pinned: !!c.ov };
    }
    return { sel, mainOv, list, pick };
  }

  const evRcdOk = (m) => (m.rcdTypes || []).some((t) => t === 'A' || t === 'B' || t === 'F');

  // ใส่ข้อมูลรุ่นลงใน cb (object เดียวกับที่ทุกตารางอ่าน) แล้วคืนข้อความเตือน (ภาษาไทย มีคำว่า "ยี่ห้อ" ทุกข้อ → หมวด "เบรกเกอร์ตามยี่ห้อ")
  function apply(cb, m, ik, opt) {
    opt = opt || {};
    const warn = [];
    const rating = ratingOf(m);
    cb.bm = {
      id: m.id, type: m.type, brand: m.brand, brandShort: m.brandShort, series: m.series, model: m.model,
      af: m.af || null, icu: m.icu, icn: m.icn || null, ics: m.ics != null ? m.ics : null, icsPct: m.icsPct != null ? m.icsPct : null,
      trip: m.trip || (m.curve ? `${m.curve} (${m.magMin}–${m.magMax}× In)` : ''), electronic: !!m.electronic, util: m.util || '',
      iiMult: m.iiMult || null, iiMin: m.iiMin || null, iiText: m.iiText || '', selMCB: m.selMCB != null ? m.selMCB : null, selRule: m.selRule || '',
      magMin: m.magMin || null, magMax: m.magMax || null, rcdTypes: m.rcdTypes || [], rcdMA: m.rcdMA || null, std: m.std || '',
      ref: m.ref, src: SRC_BRAND, pinned: !!opt.pinned,
      // ที่มาของข้อมูล (รุ่นที่อ่านจากแคตตาล็อกทางการมี m.src จาก Source_ID ใน CSV ; รุ่นอื่น verified=false)
      verified: !!m.verified, srcDoc: m.src ? m.src.doc : null, srcPages: m.src ? m.src.pages : null, srcUrl: m.src ? m.src.url : null
    };
    cb.ic = rating;
    if (m.type === 'MCCB') { cb.af = m.af; cb.type = 'MCCB'; cb.label = `${m.brandShort} ${m.model} ${cb.at}AT/${m.af}AF`; }
    else cb.label = `${m.brandShort} ${m.model} ${cb.at}A`;
    const nm = `CB ยี่ห้อ ${nameOf(m)} ${cb.at} A`;
    if (ik > rating + 1e-9) warn.push(`อันตราย — ${nm}: ${ratingName(m)} ${fmt(rating, 1)} kA < Ik" ${fmt(ik, 2)} kA ที่แผง — ตัดกระแสลัดวงจรไม่ได้ เลือกรุ่นที่ ${ratingName(m)} สูงขึ้น`);
    else if (m.type === 'MCCB' && m.ics != null && ik > m.ics + 1e-9) warn.push(`${nm}: Ik" ${fmt(ik, 2)} kA > Ics ${fmt(m.ics, 1)} kA (${m.icsPct}% ของ Icu) — ตัดได้ แต่ต้องตรวจ/เปลี่ยน CB หลังลัดวงจร`);
    if (opt.ev && m.type === 'RCBO' && !evRcdOk(m)) warn.push(`RCBO ยี่ห้อ ${nameOf(m)} เป็น Type AC — วงจรชาร์จรถไฟฟ้าต้องใช้ RCD Type A (+ ตรวจจับ DC 6 mA) หรือ Type B`);
    else if (opt.ev && m.type === 'RCBO' && m.rcdTypes.includes('AC')) cb.bm.rcdNote = 'สั่ง Type A (รุ่นนี้มีทั้ง AC และ A)';
    return warn;
  }

  // ค่าตัดทันที (kA) จากข้อมูลรุ่น: MCCB = max(Ii_Default_Mult × In, Min_Ii_Amp_Num) ; MCB = Magnetic_Trip_Min × In (กรณีแย่สุด)
  function instKA(cb) {
    const m = cb && cb.bm;
    if (!m) return null;
    if (m.type === 'MCCB') return Math.max((m.iiMult || 10) * cb.at, m.iiMin || 0) / 1000;
    return m.magMin ? m.magMin * cb.at / 1000 : null;
  }

  /* ---- ตรวจไฟล์โครงการ (sanitize.js) — รับเฉพาะยี่ห้อ/ซีรีส์/รุ่นที่มีในฐานข้อมูล ---- */
  function cleanMetaBrands(raw, notes) {
    if (!isObj(raw)) return undefined;
    const out = {};
    for (const key of ['mcb', 'mccb']) {
      const s = raw[key];
      if (!isObj(s) || !s.brand) continue;
      const b = brands(key === 'mccb' ? 'MCCB' : 'MCB').find((x) => x.brand === s.brand);
      if (!b) { if (notes) notes.push(`ยี่ห้อ ${key.toUpperCase()} "${String(s.brand).slice(0, 40)}" ไม่มีในฐานข้อมูล — ใช้ ${GENERIC_NAME}`); continue; }
      const series = typeof s.series === 'string' && b.series.includes(s.series) ? s.series : '';
      if (s.series && !series && notes) notes.push(`ซีรีส์ "${String(s.series).slice(0, 40)}" ของยี่ห้อ ${b.brand} ไม่มีในฐานข้อมูล — ใช้ทุกซีรีส์`);
      out[key] = { brand: b.brand, series };
    }
    if (raw.main !== undefined && raw.main !== '' && raw.main !== null) {
      const m = find(raw.main);
      if (m && m.type === 'MCCB') out.main = m.id; else if (notes) notes.push(`รุ่น CB ประธาน "${String(raw.main).slice(0, 40)}" ไม่มีในฐานข้อมูลยี่ห้อ — ตัดทิ้ง`);
    }
    return Object.keys(out).length ? out : undefined;
  }
  // item.brOv → [{ idx: id } เฉพาะรุ่นที่มีจริง, จำนวนที่ตัดทิ้ง]
  function cleanItemOv(raw) {
    if (!isObj(raw)) return [undefined, 0];
    const ov = {};
    let bad = 0;
    Object.keys(raw).slice(0, 500).forEach((k) => {
      const idx = Number(k);
      if (Number.isInteger(idx) && idx >= 1 && idx <= 500 && find(raw[k])) ov[idx] = raw[k]; else bad++;
    });
    return [Object.keys(ov).length ? ov : undefined, bad];
  }
  const cleanBoardOv = (v) => { const m = find(v); return m && m.type === 'MCCB' ? m.id : undefined; };

  const API = { data: B, SRC_BRAND, SRC_GENERIC, GENERIC_NAME, find, brands, pool, rowsOf, ratingOf, ratingName, nameOf, selName, polesOk, context, apply, instKA, cleanMetaBrands, cleanItemOv, cleanBoardOv };
  root.LS_BRANDCB = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
