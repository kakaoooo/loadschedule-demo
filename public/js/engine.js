/*
 * ตัวคำนวณตารางโหลด / สายป้อน / ระบบประธาน
 * ใช้ได้ทั้งใน browser (Web Worker) และ Node (สำหรับทดสอบ)
 *
 * ลำดับ: อุปกรณ์ -> วงจรย่อย -> จัดลงช่องเบรกเกอร์ (สมดุลเฟส) -> ดีมานด์/โหลดแต่ละเฟสของแผง
 *        -> สายป้อนแผง -> แผงสวิตช์รอง/MDB -> หม้อแปลง/มิเตอร์ -> กระแสลัดวงจร
 * ทุกขั้นเก็บ "steps" ไว้ให้หน้า "วิธีคำนวณ" แสดงเหตุผลการเลือก
 *
 * การจัดวงจรลงช่อง (meta.phasePattern):
 *   'pair' (ค่าเริ่มต้น) เฟสของช่อง = floor(i / 2) % 3  ->  AA-BB-CC : วงจร 3 เฟสใช้ 1-3-5 / 2-4-6 ได้ A-B-C ลงมาทั้งสองคอลัมน์ ; ตารางโหลดแสดงครึ่งบน = เลขคี่ ครึ่งล่าง = เลขคู่
 *   'seq'  เลขวงจร n (ช่อง i = n-1) อยู่เฟส i % 3  ->  A-B-C-A-B-C ตามเลขวงจร
 * วงจร 3 เฟสในแบบ seq (meta.threePole):
 *   'consecutive' (ค่าเริ่มต้น) ใช้ 3 เลขติดกัน เริ่มที่เลขหารด้วย 3 ลงตัว: 1-2-3, 4-5-6 ... เฟส A-B-C ทุกวงจร
 *   'column' ใช้ 3 ช่องคอลัมน์เดียวกัน (i, i+2, i+4): 1-3-5, 2-4-6, 7-9-11
 */
(function (root) {
  'use strict';
  const D = root.LS_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  // เบรกเกอร์ตามยี่ห้อ (ไม่มีไฟล์ = ใช้ค่าทั่วไปตาราง วสท. เสมอ)
  const BR = root.LS_BRANDCB || (typeof require !== 'undefined' ? (() => { try { return require('./brandcb.js'); } catch (e) { return null; } })() : null);

  const V1 = 230, V3 = 400, SQ3 = Math.sqrt(3);
  const VPH = V3 / SQ3; // 230.94 V แรงดันเฟสของระบบ 400/230 V
  const UNBAL_AUTO = 0.2; // เฟสสูงสุดเกินค่าเฉลี่ย > 20% → สายป้อนคิดจากเฟสสูงสุดอัตโนมัติ (ดุลยพินิจวิศวกรรม ไม่มีตัวเลขในตำรา)
  const PH = ['A', 'B', 'C'];

  /* ======================= helpers ======================= */
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;
  // toLocaleString ช้ามาก (สร้างตัวจัดรูปแบบใหม่ทุกครั้ง) -> เก็บตัวจัดรูปแบบไว้ใช้ซ้ำตามจำนวนทศนิยม
  const NF = {};
  const fmt = (x, d = 2) => {
    if (x == null || isNaN(x)) return '-';
    const nf = NF[d] || (NF[d] = new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
    return nf.format(Number(x));
  };
  const nextUp = (list, x) => list.find((v) => v >= x - 1e-9);
  const lastDown = (list, x) => { let r = null; for (const v of list) if (v <= x + 1e-9) r = v; return r; };
  // ขึ้นไปค่ามาตรฐานถัดไป ถ้าเกินตาราง ใช้ค่าสูงสุดและบอกว่าเกิน (ไม่ throw)
  function pickUp(list, x) { const a = nextUp(list, x); return a !== undefined ? { at: a, over: false } : { at: list[list.length - 1], over: true }; }
  const lookupRange = (rows, x) => rows.find((r) => x <= r[0]) || rows[rows.length - 1];
  const sizeLabel = (s) => String(s);
  const isBlank = (x) => x === undefined || x === null || x === '';
  const num = (x, d) => { const v = Number(x); return Number.isFinite(v) ? v : d; };
  const pos = (x, d) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : d; };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const phasesOf = (x, def) => { const v = Number(x); return v === 1 ? 1 : v === 3 ? 3 : def; };

  function mccbAll() {
    const s = new Set();
    D.MCCB_FRAMES.forEach((f) => f.at.forEach((a) => s.add(a)));
    return [...s].sort((a, b) => a - b);
  }
  const MCCB_AT = mccbAll();
  const ACB_MAX = D.ACB_AT[D.ACB_AT.length - 1];

  // เลือกเบรกเกอร์: MCB สำหรับวงจรย่อยในแผง loadcenter, MCCB/ACB สำหรับสายป้อน — ไม่ throw แม้เกินตาราง
  function breaker(at, kind) {
    if (kind === 'MCB' && at <= 100) return { at, af: null, type: 'MCB', label: `${at}A` };
    if (at > 3200) {
      const b = { at, af: at, type: 'ACB', label: `${at}AT/${at}AF ACB` };
      if (at > ACB_MAX) b.oversize = true;
      return b;
    }
    const fr = D.MCCB_FRAMES.find((f) => f.at.includes(at)) || D.MCCB_FRAMES.find((f) => f.af >= at);
    if (!fr) return { at, af: at, type: 'ACB', label: `${at}AT/${at}AF ACB`, oversize: true };
    return { at, af: fr.af, type: 'MCCB', label: `${at}AT/${fr.af}AF` };
  }
  function cbList(kind) {
    if (kind === 'MCB') return D.MCB_AT.concat(MCCB_AT.filter((a) => a > 100)).concat(D.ACB_AT.filter((a) => a > 3200));
    return MCCB_AT.concat(D.ACB_AT.filter((a) => a > 3200));
  }
  // IC มาตรฐานที่ ≥ Ik (kA); เกินตาราง = ค่าสูงสุด
  const IC_MAX = D.IC_KA[D.IC_KA.length - 1];
  const icStd = (Ik) => { const x = nextUp(D.IC_KA, Ik || 0); return x === undefined ? IC_MAX : x; };
  // IC ของ CB วงจรย่อย (รวม Spare) = ไม่ต่ำกว่า branchIC และ ≥ Ik ที่แผง
  const branchICFor = (meta, Ik) => Math.max(num(meta.branchIC, 6), icStd(Ik));
  // ยี่ห้อที่เลือก: ตั้งระหว่าง calculate() เท่านั้น (null = ทั่วไป) — เรียก designBranch เดี่ยว ๆ ได้ผลแบบเดิม
  let BCTX = null;
  // ชนิด CB ของวงจรตามกฎเดียวกับ finishIC (LP = MCB ; MDB/SDB: มอเตอร์/ลิฟต์/ชิลเลอร์, 3 เฟส, > 63 A = MCCB ; item.cbType ชนะ)
  function cbKindOf(c, at) {
    if (c.brLP) return 'MCB';
    const big = c.motor || c.phases === 3 || at > 63 || ['lift', 'esc', 'chiller'].includes(c.cat);
    const want = c.brType === 'MCB' || c.brType === 'MCCB' ? c.brType : (big ? 'MCCB' : 'MCB');
    return want === 'MCB' && at <= 100 ? 'MCB' : (want === 'MCCB' || at <= 3200 ? 'MCCB' : 'ACB');
  }
  // ขนาด AT ที่รุ่น/ซีรีส์ที่เลือกมีขาย สำหรับวงจรนี้ (null = ไม่มียี่ห้อ)
  function brandATFor(c, at) {
    if (!BCTX) return null;
    const k = cbKindOf(c, at);
    return BCTX.list(k === 'MCB' && c.rcd ? 'RCBO' : k, c.phases === 3 ? 3 : 1, c.brOv);
  }
  // ใส่รุ่นตามยี่ห้อให้ cb เมื่อรู้ Ik ที่แผงแล้ว: AF/IC/ป้าย/ข้อมูลรุ่น + คำเตือน (warn) + บรรทัดวิธีคำนวณ (steps)
  function brandOne(cb, type, poles, ik, ovId, opt, warn, steps) {
    if (!BCTX || !cb || !(cb.at > 0)) return;
    if (cb.type === 'ACB') { if (ovId) warn(`ยี่ห้อ: CB ${cb.at} A เป็น ACB — ฐานข้อมูลยี่ห้อมีถึง MCCB 1600 AF จึงใช้ค่าทั่วไป (ตาราง วสท.)`); return; }
    const t = type === 'MCB' && cb.rcd ? 'RCBO' : type;
    const r = BCTX.pick(t, cb.at, poles, ik, ovId, !!(opt && opt.ev));
    if (r.badOv) warn(`ยี่ห้อ: รุ่นที่กำหนด "${r.badOv}" ใช้กับ CB นี้ไม่ได้ — ใช้ค่าโครงการ`);
    if (!r.model) {
      if (r.notOffered) warn(`ยี่ห้อ ${r.label} ไม่มี CB ${cb.at} A${r.avail ? ` (มี ${r.avail[0]}–${r.avail[r.avail.length - 1]} A)` : ''} — ใช้ค่าทั่วไป (ตาราง วสท.)`);
      else if (r.evNoType) warn(`ยี่ห้อ ${r.label} ไม่มี RCBO ${cb.at} A ที่เป็น RCD Type A/B/F สำหรับวงจรชาร์จรถไฟฟ้า — ใช้ค่าทั่วไป (RCD 30 mA Type A/B ตาม IEC 60364-7-722) ตรวจเลือกรุ่นจากยี่ห้ออื่น`);
      else if (r.none && (BCTX.sel[t] || ovId)) warn(`ยี่ห้อ ${r.label} ไม่มี ${t} ${poles}P — ใช้ค่าทั่วไป (ตาราง วสท.)`);
      return;
    }
    const m = r.model;
    BR.apply(cb, m, ik, { ev: opt && opt.ev, pinned: r.pinned }).forEach(warn);
    const snap = opt && opt.snap;
    if (snap) warn(`CB ยี่ห้อ ${BR.nameOf(m)}: รุ่นนี้ไม่มีขนาด ${snap.from} A — ${snap.to > snap.from ? 'ขยับขึ้นเป็น' : 'ใช้'} ${snap.to} A${m.electronic ? ' (หรือใช้ trip unit ปรับ Ir ได้)' : ''} ตรวจขนาดสาย/CB ต้นทาง`);
    if (steps) steps.push({ t: 'รุ่น CB ตามยี่ห้อ', f: `${cb.label} · ${BR.ratingName(m)} ${BR.ratingOf(m)} kA ${BR.ratingOf(m) >= ik ? '≥' : '<'} Ik" ${fmt(ik, 2)} kA${m.ics != null ? ` · Ics ${m.ics} kA (${m.icsPct}%)` : ''}${m.trip ? ` · ${m.trip}` : ''}`, ref: `${m.ref} — ${BR.SRC_BRAND}` });
  }
  const brandStep = (from, to, list) => ({ t: 'CB ตามยี่ห้อ', f: `รุ่นที่เลือกมีขนาด ${list.join(', ')} A → ${from} A ${to > from ? 'ขยับขึ้น' : 'ใช้'}เป็น ${to} A`, ref: 'ข้อมูลผู้ผลิต — ตรวจกับแคตตาล็อก' });

  const cableOf = (cable) => D.CABLES[cable] || D.CABLES.IEC01;
  const methodOf = (m) => D.METHODS[m] || D.METHODS.g2;
  function insulOf(cable) { return cableOf(cable).insul; }
  function coreOf(cable) { return cableOf(cable).core; }
  // ชนิดสาย/วิธีเดิน/ท่อ ที่ไม่รู้จัก -> ค่าเริ่มต้นของ branch (ไม่ throw)
  function wiringOf(spec, def) {
    spec = spec || {}; def = def || { cable: 'IEC01', method: 'g2', conduit: 'EMT' };
    return {
      cable: D.CABLES[spec.cable] ? spec.cable : def.cable,
      method: D.METHODS[spec.method] ? spec.method : def.method,
      conduit: D.CONDUIT_TYPES.includes(spec.conduit) ? spec.conduit : def.conduit
    };
  }

  function ampKey(cable, method, ncc) {
    const ins = insulOf(cable), core = coreOf(cable);
    let g = method;
    // IEC 01 ไม่มีเปลือก — ใช้ได้เฉพาะกลุ่ม 1,2 (ท่อ) ตามตาราง 5-48; ถ้าเลือกอย่างอื่นให้ใช้กลุ่ม 2
    if (cable === 'IEC01' && !['g1', 'g2'].includes(method)) g = 'g2';
    const n = ncc >= 3 ? 3 : 2;
    let k = `${ins}:${g}:${n}:${core}`;
    if (!D.AMPACITY[k]) k = `${ins}:${g}:${n}:s`;
    if (!D.AMPACITY[k]) k = `${ins}:${g}:3:s`;
    if (!D.AMPACITY[k]) k = `${ins}:g2:${n}:s`;
    return k;
  }
  function ampRef(cable, method) {
    const x = insulOf(cable) === 'XLPE';
    switch (method) {
      case 'g1': case 'g2': return x ? 'ตาราง 5-27' : 'ตาราง 5-20';
      case 'g3': return 'ตาราง 5-21';
      case 'g5': case 'g6': return x ? 'ตาราง 5-29' : 'ตาราง 5-23';
      case 'g7': return x ? 'ตาราง 5-32' : 'ตาราง 5-30';
      default: return 'ตาราง 5-20';
    }
  }

  function tempFactor(cable, method, meta) {
    const underground = D.METHODS[method] && D.METHODS[method].ground;
    const t = num(underground ? meta.ambientGround : meta.ambientAir, underground ? 30 : 40);
    const rows = underground ? D.TEMP_GROUND : D.TEMP_AIR;
    const row = lookupRange(rows, t);
    const f = insulOf(cable) === 'XLPE' ? row[2] : row[1];
    return { f: f == null ? 0.5 : f, t, ref: underground ? 'ตาราง 5-44' : 'ตาราง 5-43' };
  }
  function groupFactor(method, n) {
    if (n <= 1) return { f: 1, ref: '-' };
    if (method === 'g7') { const r = lookupRange(D.GROUPING_TRAY, n); return { f: r[1], ref: 'ตาราง 5-41' }; }
    // ใต้ดิน: ตาราง 5-8 (ในอากาศ) ใช้ไม่ได้ — ท่อฝังดิน = ตาราง 5-46, ฝังดินโดยตรง = ตาราง 5-45 (คอลัมน์วางชิดกัน = กรณีเลวสุด)
    if (method === 'g5') { const r = lookupRange(D.GROUPING_DUCT, n); return { f: r[1], ref: 'ตาราง 5-46' }; }
    if (method === 'g6') { const r = lookupRange(D.GROUPING_DIRECT, n); return { f: r[1], ref: 'ตาราง 5-45' }; }
    const r = lookupRange(D.GROUPING, n);
    const surface = method === 'g3';
    return { f: surface ? r[2] : r[1], ref: 'ตาราง 5-8' };
  }

  // เลือกขนาดสายที่เล็กที่สุดที่ ampacity * Ft * Fg >= Ireq ; ไม่ null เสมอ (ถ้าตารางไม่พอ ok = false และใช้ขนาดใหญ่สุดที่ใช้ได้)
  function pickConductor(o) {
    const key = ampKey(o.cable, o.method, o.ncc);
    const tbl = D.AMPACITY[key];
    const ft = tempFactor(o.cable, o.method, o.meta);
    const fg = groupFactor(o.method, o.groups || 1);
    const k = ft.f * fg.f;
    const all = D.SIZES.filter((s) => tbl[s] != null);
    let sizes = all.filter((s) => s >= (o.minSize || 0) && (!o.maxSize || s <= o.maxSize));
    if (!sizes.length) sizes = all.filter((s) => s >= (o.minSize || 0)); // minSize/maxSize ขัดกัน: ละเลย maxSize
    if (!sizes.length) sizes = all.slice(-1);                              // minSize ใหญ่กว่าตาราง: ใช้ขนาดใหญ่สุด
    for (const s of sizes) {
      if (tbl[s] * k >= o.Ireq - 1e-9) return { size: s, base: tbl[s], derated: tbl[s] * k, ft, fg, key, ok: true };
    }
    const s = sizes[sizes.length - 1];
    return { size: s, base: tbl[s], derated: tbl[s] * k, ft, fg, key, ok: false };
  }
  function ampOf(cable, method, ncc, size, meta, groups) {
    const tbl = D.AMPACITY[ampKey(cable, method, ncc)];
    const k = tempFactor(cable, method, meta).f * groupFactor(method, groups || 1).f;
    return tbl[size] != null ? tbl[size] * k : 0;
  }

  // แรงดันตก (%) ใช้ mV/A/m จากตาราง ฐ.
  function vdPercent(cable, method, phases, size, I, L, sets) {
    const vt = D.VD[cableOf(cable).vd];
    const touching = ['g3', 'g6', 'g7'].includes(method) && coreOf(cable) === 's';
    const col = phases === 3 ? (touching && vt['3t'] ? '3t' : 3) : (touching && vt['1t'] ? '1t' : 1);
    const mv = (vt[col] || vt[phases === 3 ? 3 : 1])[size];
    if (mv == null) return { pct: 0, volt: 0, mv: 0 };
    const volt = mv * I * L / 1000 / (sets || 1);
    const pct = volt / (phases === 3 ? V3 : V1) * 100;
    return { pct, volt, mv, ref: { PVC_S: 'ตาราง ฐ.1', PVC_M: 'ตาราง ฐ.2', XLPE_S: 'ตาราง ฐ.3', XLPE_M: 'ตาราง ฐ.4' }[cableOf(cable).vd] };
  }

  function groundFor(at) { return lookupRange(D.GROUND_EQUIP, at)[1]; }
  // สายดินบริภัณฑ์ขยายตามสัดส่วนเมื่อสายเฟสถูกขยายเกินขนาดตามกระแส (เช่น เพิ่มขนาดเพื่อลดแรงดันตก) — IEC 60364-5-54 / วสท. ตาราง 4.2 หมายเหตุ ; ปัดขึ้นเป็นขนาดมาตรฐาน (ผู้เรียกจำกัดไม่ให้เกินสายเฟส)
  function scaleEGC(baseG, baseP, actualP) {
    if (!(baseG > 0) || !(baseP > 0) || !(actualP > baseP)) return baseG;
    const req = baseG * (actualP / baseP);
    for (const z of D.SIZES) if (z >= req - 1e-9) return z;
    return D.SIZES[D.SIZES.length - 1];
  }
  const PARALLEL_MIN_SIZE = 50;   // สายเดินควบ (ขนานหลายชุด) ต่อชุดไม่เล็กกว่า 50 mm² (แผนยกระดับ fixandupgrade 3.4 อ้าง วสท. — ไม่ได้ตรวจเลขข้อกับต้นฉบับ)

  function cableArea(cable, size, cores) {
    if (coreOf(cable) === 'm') {
      const base = cable === 'CV4C' ? 'CV' : 'NYY';
      return D.CABLE_AREA[base + Math.min(4, Math.max(2, cores))][size] || 0;
    }
    return D.CABLE_AREA[cableOf(cable).area][size] || 0;
  }

  // ท่อร้อยสาย: wires = [{size,count}] สายแกนเดียว
  function pickConduit(cable, wires) {
    let area = 0, n = 0;
    for (const w of wires) { area += cableArea(cable, w.size, 1) * w.count; n += w.count; }
    const fill = n === 1 ? D.FILL[1] : n === 2 ? D.FILL[2] : D.FILL.many;
    const c = D.CONDUIT.find((c) => c.area * fill >= area) || null;
    return { area, n, fill, conduit: c, ok: !!c };
  }
  function pickWireway(totalArea) {
    const w = D.WIREWAY.find(([a, b]) => a * b * D.WIREWAY_FILL >= totalArea);
    return w ? { w: w[0], h: w[1] } : null;
  }

  function motorFLC(kw, phases) {
    const tbl = phases === 3 ? D.MOTOR_3P : D.MOTOR_1P;
    const row = tbl.find((r) => r[0] >= kw - 1e-9);
    if (row) return { im: row[1], kwTable: row[0], ref: 'ตาราง 8.2' };
    // ใหญ่กว่าตาราง: คำนวณ P/(√3 V pf eff) โดยประมาณ pf*eff = 0.82
    const im = phases === 3 ? kw * 1000 / (SQ3 * V3 * 0.82) : kw * 1000 / (V1 * 0.75);
    return { im: r1(im), kwTable: kw, ref: 'คำนวณโดยประมาณ (นอกตาราง 8.2)' };
  }

  function lampById(id) { return D.LAMPS.find((l) => l.id === id) || D.LAMPS[1]; }
  // clamp: 'over' = BTU เกินแถวสุดท้ายของตาราง (ใช้แถวสุดท้าย), 'under' = ต่ำกว่าแถวแรก (ใช้แถวแรก)
  function acKVA(btu, phases) {
    const tbl = phases === 3 ? D.AC_3P : D.AC_1P;
    const hit = tbl.find((r) => r[0] >= btu - 1);
    const row = hit || tbl[tbl.length - 1];
    const clampKind = !hit ? 'over' : (btu < tbl[0][0] - 1 ? 'under' : null);
    return { kva: row[1], btuTable: row[0], ref: phases === 3 ? 'ตาราง 6.5' : 'ตาราง 6.4', clamp: clampKind };
  }

  /* ======================= defaults ======================= */
  function defaultMeta() {
    return {
      name: 'โครงการใหม่', owner: '', location: '', designer: '', checker: '',
      designerLicense: '', licenseTier: '', checkerLicense: '', logo: '',   // Title Block: เลขที่ใบอนุญาต กว. (ภฟก./สฟก./วฟก.) ของผู้ออกแบบ/ผู้ตรวจ + โลโก้บริษัท (data URL png/jpeg/webp)
      date: new Date().toISOString().slice(0, 10),
      buildingType: 'office', utility: 'PEA', supply: 'transformer', hvKV: 22,
      ambientAir: 40, ambientGround: 30,
      recVA: 180, recPerCircuit: 10, lightMaxLoading: 0.8,
      branchFactor: 1.25, feederFactor: 1.25, useMaxPhase: false,
      autoSelectivity: true,   // ขยับ CB สายป้อนให้ ≥ 1.6 × CB วงจรย่อยใหญ่สุด (แผนแม่บท 2.2)
      adiabaticCheck: false,     // ตรวจความร้อนลัดวงจรสายป้อน S ≥ Ik" × √t / k (IEC 60364-4-43) แล้วเตือน — ปิดไว้: ไม่มี I²t ผ่านตัวจริงของ CB จึงอาจเตือนเกินจริงกับ CB จำกัดกระแส
      egcProportional: false,    // สายดินขยายตามสัดส่วนเมื่อสายเฟสถูกขยายเพื่อลดแรงดันตก (IEC 60364-5-54 / NEC 250.122(B)) — ปิดไว้เป็นค่าเริ่มต้น: ตัวอย่างตำรา 6.4.6 คงสายดินตามตาราง 4.2 แม้เฟสขยาย 10 → 16 mm²
      coordinateKidFeeders: true,    // เมนแม่ ≥ min(1.6 × CB สายป้อนแผงลูกใหญ่สุด, CB ต้นทาง) — ต้องเปิด autoSelectivity ด้วย ; ข้ามแผงที่มีมอเตอร์ในแผง/ใต้แผง (เพดานสมการ 8-5) ; ปิด = เมนแม่ตามโหลดและวงจรย่อยของตัวเอง
      floorHeight: 3.6,        // ความสูงต่อชั้น (m) ใช้คิดสายป้อนแนวดิ่ง (Riser) เมื่อแผงระบุ floor ; 3.6 = ค่าเดียวกับตัวนำเข้า (importer)
      vdBranch: 2, vdFeeder: 2, vdTotal: 5,
      lightingDF: false, lightingGround: false,
      minLight: 2.5, minRec: 2.5, minOther: 2.5, minFeeder: 4,
      cbLight: 16, cbRec: 16, branchIC: 6,   // cbRec 16: เต้ารับ มอก. 166-2549 พิกัด 16 A (ขยับขึ้นเองเมื่อ I × 1.25 > 16 A)
      branch: { cable: 'IEC01', method: 'g2', conduit: 'EMT' },
      feeder: { cable: 'IEC01', method: 'g2', conduit: 'IMC' },
      main: { cable: 'CV', method: 'g5', conduit: 'IMC', length: 15, maxSize: 300 },
      hv: { length: 20 },
      sourceKA: 0, serviceKA: 25, growth: 0, spareRatio: 0.15, activeRatio: 0.8,
      pfNow: 0.85, pfTarget: 0.95, maxParallelSize: 300, mccbICMin: 10,
      phasePattern: 'pair',   // ค่าเริ่มต้น: 1-3-5 / 2-4-6 เฟส A-B-C ลงมา (AA-BB-CC) · 'seq' = เลขวงจรไล่ A-B-C ต่อเนื่อง
      threePole: 'consecutive'   // วงจร 3 เฟสแบบ seq: 'consecutive' = 3 เลขติดกัน (1-2-3, 4-5-6) · 'column' = 3 ช่องคอลัมน์เดียวกัน (1-3-5, 2-4-6)
    };
  }

  /* ======================= branch circuits ======================= */
  const MAX_QTY = 2000, MAX_FIXTURES = 20000;
  // item -> วงจรย่อย ; warn (ไม่บังคับ) = array รับข้อความเตือนของ item; ข้อความเดียวกันอยู่ที่ c.notes และกลายเป็น c.warn ตอนออกแบบวงจร
  function expandItem(item, meta, warn) {
    const out = [];
    item = item || {};
    meta = meta || defaultMeta();
    const notes = [];
    const note = (m) => { notes.push(m); };
    // จำนวนเต็ม 1..max ; ว่าง = 1 (ไม่เตือน), ค่าแปลก/เกินช่วง = ปรับและเตือน
    const count = (v, max, label) => {
      if (isBlank(v)) return 1;
      const n0 = Number(v);
      if (!Number.isFinite(n0)) { note(`${label} "${v}" ไม่ถูกต้อง — ใช้ 1`); return 1; }
      const n = Math.round(n0);
      if (n < 1) { note(`${label} ${n0} ไม่ถูกต้อง — ใช้ 1`); return 1; }
      if (n > max) { note(`${label} ${fmt(n, 0)} เกินที่รองรับ — จำกัดที่ ${fmt(max, 0)}`); return max; }
      return n;
    };
    // ตัวเลขบวก ; ว่าง = ค่าเริ่มต้น (ไม่เตือน), ติดลบ/0/ไม่ใช่ตัวเลข = ค่าเริ่มต้นและเตือน
    const posN = (v, d, label, max) => {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) {
        if (max && n > max) { note(`${label} ${fmt(n, 0)} เกินที่รองรับ — จำกัดที่ ${fmt(max, 0)}`); return max; }
        return n;
      }
      if (!isBlank(v)) note(`${label} "${v}" ไม่ถูกต้อง — ใช้ ${d}`);
      return d;
    };
    const presetIdx = (v, len, label) => {
      const n = isBlank(v) ? 0 : Math.round(num(v, 0));
      const c = clamp(n, 0, len - 1);
      if (c !== n) note(`${label}: รุ่นที่ ${n} อยู่นอกช่วง (0–${len - 1}) — ใช้รุ่นที่ ${c}`);
      return c;
    };
    const base = { itemId: item.id, room: item.room || '', L: posN(item.length, 20, 'ระยะสาย', 100000), notes };
    const qty = () => count(item.qty, MAX_QTY, 'จำนวน');
    const finish = (name) => { if (warn) notes.forEach((n) => warn.push(`${name}: ${n}`)); return out; };
    const sharedQty = { field: 'qty', n: 1 };
    switch (item.type) {
      case 'light': {
        const lamp = lampById(item.lamp);
        if (!isBlank(item.lamp) && !D.LAMPS.some((l) => l.id === item.lamp)) note(`ไม่พบรหัสโคม "${item.lamp}" — ใช้ ${lamp.label}`);
        const per = Math.max(1, Math.min(1000, pos(item.perFixture, 1)));
        const fixtures = count(item.fixtures, MAX_FIXTURES, 'จำนวนโคม');
        const vaFix = lamp.va * per;
        const maxVA = clamp(pos(meta.cbLight, 16), 6, 100) * V1 * clamp(pos(meta.lightMaxLoading, 0.8), 0.1, 1);
        // จำนวนโคมสูงสุดต่อวงจรตามกำลังจริงของโคม (โคมเดียวเกินเกณฑ์ -> 1 โคม/วงจร)
        const perMax = Math.max(1, Math.floor(maxVA / vaFix + 1e-9));
        let nCirc = Number(item.circuits) > 0 ? Math.max(1, Math.round(item.circuits)) : Math.ceil(fixtures / perMax);
        nCirc = Math.max(1, Math.min(nCirc, fixtures));
        // แบ่งจำนวนโคมให้แต่ละวงจรใกล้เคียงกัน
        for (let i = 0; i < nCirc; i++) {
          const f = Math.floor(fixtures / nCirc) + (i < fixtures % nCirc ? 1 : 0);
          out.push(Object.assign({}, base, {
            cat: 'light', phases: 1, va: vaFix * f, continuous: true,
            desc: item.name || 'Lighting',
            calc: `${f} โคม × ${per} หลอด × ${lamp.va} VA (${lamp.label}, ตาราง 6.${lamp.group === 'LED' ? 3 : lamp.group === 'HID' ? 2 : 1})`,
            lampW: lamp.w, share: { field: 'fixtures', n: f }
          }));
        }
        break;
      }
      case 'rec': {
        // ประเภทเต้ารับ: heavy (ครัว/เวิร์กช็อป) = 20 A สาย ≥ 4 mm² RCBO 30 mA บังคับ ; ค่าอื่น = general (แผนแม่บท 2.1)
        const heavy = item.duty === 'heavy', RD = D.REC_DUTY;
        const points = count(item.points, MAX_QTY, 'จำนวนจุด');
        const vaPt = Math.min(1e6, pos(item.vaPerPoint, heavy ? RD.heavy.vaPerPoint : pos(meta.recVA, 180)));
        const per = Math.max(1, Math.min(1000, Math.round(pos(item.perCircuit, heavy ? RD.heavy.perCircuit : pos(meta.recPerCircuit, 10)))));
        const n = Math.ceil(points / per);
        for (let i = 0; i < n; i++) {
          const p = Math.floor(points / n) + (i < points % n ? 1 : 0);
          out.push(Object.assign({}, base, {
            cat: 'rec', duty: heavy ? 'heavy' : 'general', phases: 1, va: p * vaPt, continuous: false, rcd: heavy || !!item.wet,
            desc: item.name || 'Receptacle', calc: `${p} จุด × ${vaPt} VA/จุด`, points: p, share: { field: 'points', n: p }
          }));
        }
        break;
      }
      case 'ac': {
        const btu = posN(item.btu, 12000, 'BTU', 1e7);
        const ph = phasesOf(item.phases, btu >= 36000 ? 3 : 1);
        const k = acKVA(btu, ph);
        if (k.clamp === 'over') note(`${fmt(btu, 0)} BTU เกินตาราง ${ph} เฟส (สูงสุด ${fmt(k.btuTable, 0)} BTU) — ใช้ค่าแถวสุดท้าย ${k.kva} kVA อาจต่ำกว่าจริง`);
        if (k.clamp === 'under') note(`${fmt(btu, 0)} BTU ต่ำกว่าตาราง ${ph} เฟส (เริ่ม ${fmt(k.btuTable, 0)} BTU) — ใช้ค่าแถวแรก ${k.kva} kVA`);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'ac', phases: ph, va: k.kva * 1000, continuous: true,
          desc: item.name || `A/C ${fmt(btu, 0)} BTU`, calc: `แอร์ ${fmt(btu, 0)} BTU/h → ${k.kva} kVA (${k.ref})`, share: sharedQty
        }));
        break;
      }
      case 'heater': {
        const w = posN(item.watt, 3500, 'วัตต์', 1e9);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'heater', phases: 1, va: w, continuous: true, rcd: true,
          desc: item.name || `Water heater ${fmt(w, 0)} W`, calc: `เครื่องทำน้ำร้อน ${fmt(w, 0)} W (pf = 1)`, share: sharedQty
        }));
        break;
      }
      case 'ev': {
        // ที่ชาร์จรถไฟฟ้า: โหลดต่อเนื่อง 1 เครื่องต่อ 1 วงจรเฉพาะ + RCD 30 mA เสมอ ; kw ว่าง = ใช้รุ่นมาตรฐาน (D.EV_CHARGERS)
        let kw = Math.min(1000, pos(item.kw, 0)), ph, va, ref;
        if (kw) {
          ph = phasesOf(item.phases, kw > 7.4 ? 3 : 1);
          va = kw * 1000; ref = `ผู้ใช้กำหนด ${kw} kW ${ph} เฟส (pf = 1)`;
        } else {
          const e = D.EV_CHARGERS[presetIdx(item.preset, D.EV_CHARGERS.length, 'ที่ชาร์จรถไฟฟ้า')];
          kw = e[0]; ph = e[1];
          va = ph === 3 ? SQ3 * V3 * e[2] : V1 * e[2]; ref = `${kw} kW ${ph} เฟส ${e[2]} A`;
        }
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'ev', phases: ph, va, continuous: true, rcd: true, ev: true,
          desc: item.name || `EV charger ${kw} kW`, calc: `ที่ชาร์จรถไฟฟ้า ${ref}`, share: sharedQty
        }));
        break;
      }
      case 'cook': {
        const w = posN(item.watt, 2000, 'วัตต์', 1e9);
        const ph = phasesOf(item.phases, 1);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'cook', phases: ph, va: w, continuous: false,
          desc: item.name || `Cooking ${fmt(w, 0)} W`, calc: `เครื่องหุงต้ม ${fmt(w, 0)} W`, share: sharedQty
        }));
        break;
      }
      case 'motor': {
        const kw = posN(item.kw, 1.5, 'กำลังมอเตอร์ kW', 1e6);
        const ph = phasesOf(item.phases, 3);
        const m = motorFLC(kw, ph);
        const va = ph === 3 ? SQ3 * V3 * m.im : V1 * m.im;
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'motor', phases: ph, va, continuous: true, motor: { kw, im: m.im, ref: m.ref, start: item.start === 'YD' ? 'YD' : 'DOL' },
          desc: item.name || `Motor ${kw} kW`, calc: `มอเตอร์ ${kw} kW ${ph} เฟส → Im = ${m.im} A (${m.ref})`, share: sharedQty
        }));
        break;
      }
      case 'fire_pump': {
        // ปั๊มดับเพลิง (NFPA 20 / วสท. บทที่ 10): โหลดวิกฤต 100% · CB Magnetic-only ไม่ตัดจาก overload · สาย FRC · ห้าม RCD · ต้องต่อแผงฉุกเฉิน
        if (item.rcd || item.wet) note('ปั๊มดับเพลิงห้ามมี RCD/RCBO — ไม่ใส่ให้ (NFPA 20)');
        const kw = posN(item.kw, 15, 'กำลังปั๊มดับเพลิง kW', 1e6);
        const ph = phasesOf(item.phases, 3);
        const m = motorFLC(kw, ph);
        const va = ph === 3 ? SQ3 * V3 * m.im : V1 * m.im;
        const lrc = r1(D.FIRE_PUMP.lrcMult * m.im);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'fire_pump', firePump: true, phases: ph, va, continuous: true, rcd: false,
          motor: { kw, im: m.im, ref: m.ref, start: 'DOL', fire: true, lrc },
          desc: item.name || `Fire pump ${kw} kW`, calc: `ปั๊มดับเพลิง ${kw} kW ${ph} เฟส → FLA = ${m.im} A (${m.ref}), LRC ≈ ${D.FIRE_PUMP.lrcMult}×FLA = ${fmt(lrc)} A`, share: sharedQty
        }));
        break;
      }
      case 'lift': case 'esc': case 'chiller': {
        let kva = Math.min(1e6, pos(item.kva, 0)), ref = 'ผู้ใช้กำหนด';
        if (!kva && item.type === 'lift') { const l = D.LIFTS[presetIdx(item.preset, D.LIFTS.length, 'ลิฟต์')]; kva = l[3]; ref = `ตาราง 6.8 (${l[0]} kg, ${l[1]} คน, ${l[2]} m/min)`; }
        if (!kva && item.type === 'esc') { const e = D.ESCALATORS[presetIdx(item.preset, D.ESCALATORS.length, 'บันไดเลื่อน')]; kva = e[2]; ref = `ตาราง 6.9 (กว้าง ${e[0]} mm)`; }
        if (!kva && item.type === 'chiller') { const t = item.cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER; const c = t[presetIdx(item.preset, t.length, 'ชิลเลอร์')]; kva = c[1]; ref = `${item.cooling === 'air' ? 'ตาราง 6.7' : 'ตาราง 6.6'} (${c[0]} TR)`; }
        const im = kva * 1000 / (SQ3 * V3);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: item.type, phases: 3, va: kva * 1000,
          motor: item.type === 'chiller' ? null : { kw: null, im: r2(im), ref, start: 'DOL', packaged: true },
          desc: item.name || ({ lift: 'Passenger lift', esc: 'Escalator', chiller: 'Chiller' })[item.type],
          calc: `${kva} kVA (${ref}) → I = ${fmt(im)} A`, continuous: true, share: sharedQty
        }));
        break;
      }
      case 'custom': {
        const ph = phasesOf(item.phases, 1);
        let va = posN(item.va, 0, 'VA', 1e9);
        if (!va && item.watt) {
          const pfRaw = Number(item.pf);
          const pf = pfRaw > 0 && pfRaw <= 1 ? pfRaw : 1;
          if (!isBlank(item.pf) && pf !== pfRaw) note(`pf "${item.pf}" ไม่ถูกต้อง — ใช้ 1`);
          va = posN(item.watt, 0, 'วัตต์', 1e9) / pf;
        }
        // item.cat: ให้รายการ "กำหนดเอง" (เช่น นำเข้าจากตารางโหลดที่มี VA ระบุแล้ว) ไปอยู่หมวดที่ถูกต้อง
        const cat = ['light', 'rec', 'ac', 'heater', 'cook', 'motor', 'other'].includes(item.cat) ? item.cat : 'other';
        const continuous = item.continuous === undefined ? !['rec', 'cook'].includes(cat) : item.continuous !== false;
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat, phases: ph, va, continuous, rcd: !!item.rcd,
          desc: item.name || 'Equipment', calc: item.watt ? `${fmt(item.watt, 0)} W / pf ${item.pf || 1} = ${fmt(va, 0)} VA` : `${fmt(va, 0)} VA`, share: sharedQty
        }));
        break;
      }
      case 'spare': {
        const cb = posN(item.cb, 16, 'CB', 6300);
        const ph = phasesOf(item.phases, 1);
        const va = posN(item.va, 0, 'VA', 1e9);
        for (let i = 0, n = qty(); i < n; i++) out.push(Object.assign({}, base, {
          cat: 'spare', phases: ph, va, continuous: false,
          desc: 'SPARE', spareCB: cb, calc: 'วงจรสำรอง (มี CB ไม่มีสาย)', share: sharedQty
        }));
        break;
      }
    }
    return finish(item.name || item.type || 'item');
  }

  function designBranch(c, meta, scKA) {
    const steps = [];
    const bc = c.firePump ? wiringOf({ cable: D.FIRE_PUMP.cable, method: meta.branch.method, conduit: meta.branch.conduit }, wiringOf(meta.branch)) : wiringOf(meta.branch);
    const mth = methodOf(bc.method);
    c.warn = (c.notes || []).slice();
    const V = c.phases === 3 ? V3 : V1;
    const I = c.phases === 3 ? c.va / (SQ3 * V3) : c.va / V1;
    c.I = I;
    steps.push({ t: 'โหลดของวงจร', f: c.calc + ` = ${fmt(c.va, 0)} VA` });
    steps.push({ t: 'กระแสโหลด', f: c.phases === 3 ? `I = ${fmt(c.va, 0)} / (√3 × 400) = ${fmt(I)} A` : `I = ${fmt(c.va, 0)} / 230 = ${fmt(I)} A` });

    if (c.cat === 'spare') {
      if (c.cbForce) { c.cbAuto = c.spareCB; c.spareCB = c.cbForce; }
      const bl = !c.cbForce && brandATFor(c, c.spareCB), sn = bl && nextUp(bl, c.spareCB);
      if (sn && sn !== c.spareCB) { c.brSnap = { from: c.spareCB, to: sn }; c.spareCB = sn; }
      c.cb = breaker(c.spareCB, 'MCB'); c.cb.poles = c.phases === 3 ? 3 : 1; c.cb.ic = branchICFor(meta, scKA);
      c.cond = null; c.conduit = null; c.vd = { pct: 0 };
      steps.push({ t: 'วงจรสำรอง', f: `ใส่ CB ${c.cb.at} A ไว้ ไม่เดินสาย/ท่อ (หลักการทำตารางโหลด บทที่ 6.5)` });
      c.steps = steps; return c;
    }

    let Ireq, cbAt, ground, olSet = null, condStep;
    let cbOver = false;
    const cat = c.cat;
    const heavyRec = cat === 'rec' && c.duty === 'heavy';
    const minSize = cat === 'light' ? meta.minLight : cat === 'rec' ? (heavyRec ? Math.max(meta.minRec, D.REC_DUTY.heavy.minSize) : meta.minRec) : meta.minOther;

    if (c.firePump) {
      // ปั๊มดับเพลิง: ไม่ใช้กฎมอเตอร์ทั่วไป (ไม่มี overload relay) — CB Mag-only ≈ 2.5–3 × FLA, สาย FRC ≥ 1.25 × FLA, ห้าม RCD
      const FP = D.FIRE_PUMP, im = c.motor.im, lrc = c.motor.lrc;
      const pk = pickUp(cbList('MCCB'), FP.cbMin * im);
      cbAt = pk.at; cbOver = pk.over;
      Ireq = FP.condFactor * im;
      ground = groundFor(cbAt);
      steps.push({ t: 'ปั๊มดับเพลิง (NFPA 20)', f: `FLA = ${im} A, LRC ≈ ${FP.lrcMult}×FLA = ${fmt(lrc)} A — โหลดวิกฤตต่อเนื่อง: ห้ามตัดวงจรจาก overload, ห้ามมี RCD/RCBO, ต่อแผงฉุกเฉิน`, ref: 'NFPA 20 บทที่ 9–10 / วสท. บทที่ 10' });
      steps.push({ t: 'เบรกเกอร์ (Magnetic-only)', f: `CB ไม่มี overload release (Mag-only) ; AT ≈ ${FP.cbMin}–${FP.cbMax} × ${im} = ${fmt(FP.cbMin * im)}–${fmt(FP.cbMax * im)} A → ${cbAt} AT ; ตั้ง instantaneous ≥ LRC ${fmt(lrc)} A ไม่ให้ตัดขณะสตาร์ท`, ref: 'NFPA 20 ข้อ 9.3 / ตาราง 8.5' });
      if (cbAt > FP.cbMax * im + 1e-9) c.warn.push(`ไม่มี CB มาตรฐานในช่วง ${FP.cbMin}–${FP.cbMax} × FLA (${fmt(FP.cbMin * im)}–${fmt(FP.cbMax * im)} A) — ใช้ ${cbAt} AT ตรวจเส้นโค้ง trip ให้ผ่าน LRC ${fmt(lrc)} A`);
      condStep = `สาย FRC (BS 6387 CWZ) Icable ≥ ${FP.condFactor} × FLA = ${fmt(Ireq)} A`;
      c.motor.ol = null;
    } else if (c.motor && !c.motor.packaged) {
      // วงจรมอเตอร์ตามบทที่ 8
      const im = c.motor.im;
      olSet = r1(im * 1.0);
      const olRange = D.OVERLOAD_RANGES.find((r) => olSet >= r[0] && olSet <= r[1]) || null;
      let dm = nextUp(D.DM_SIZES, 1.15 * im);
      let dmOver = false;
      if (dm === undefined) { dm = D.DM_SIZES[D.DM_SIZES.length - 1]; dmOver = true; c.warn.push(`เครื่องปลดวงจร (DM) ต้องการ ≥ ${fmt(1.15 * im)} A เกินขนาดมาตรฐานสูงสุด ${dm} A — ใช้ ${dm} A (ต้องเลือกพิเศษ)`); }
      const cbMax = 2.5 * im;
      let at = lastDown(cbList('MCB'), cbMax);
      if (!at || at < 1.25 * im) { const pk = pickUp(cbList('MCB'), 1.25 * im); at = pk.at; cbOver = pk.over; }
      cbAt = at;
      const bl = brandATFor(c, cbAt);
      if (bl && !c.cbForce) {   // ยี่ห้อ: ใช้กฎเดิม (≤ 2.5Im, ≥ 1.25Im) กับขนาดที่รุ่นมีขาย ; รุ่นไม่มีขนาดที่พอ = คงค่าทั่วไป (finishIC เตือน)
        let a2 = lastDown(bl, cbMax);
        if (!a2 || a2 < 1.25 * im) { const pk = pickUp(bl, 1.25 * im); a2 = pk.over ? null : pk.at; }
        if (a2 && a2 !== cbAt) { if (!bl.includes(cbAt)) c.brSnap = { from: cbAt, to: a2 }; steps.push(brandStep(cbAt, a2, bl)); cbAt = a2; cbOver = false; }
      }
      if (c.cbForce) {
        c.cbAuto = cbAt; cbAt = c.cbForce; cbOver = false;
        if (cbAt !== c.cbAuto) {
          steps.push({ t: 'CB กำหนดเอง', f: `ผู้ออกแบบกำหนด ${cbAt} A (ระบบเลือก ${c.cbAuto} A)` });
          if (cbAt < 1.25 * im) c.warn.push(`CB ที่กำหนด ${cbAt} A ต่ำกว่า 1.25Im = ${fmt(1.25 * im)} A — มอเตอร์อาจตัดตอนสตาร์ท`);
          if (cbAt > cbMax) c.warn.push(`CB ที่กำหนด ${cbAt} A เกิน 2.5Im = ${fmt(cbMax)} A (ตาราง 8.5)`);
        }
      }
      const yd = c.motor.start === 'YD';
      Ireq = 1.25 * im;
      steps.push({ t: 'Overload relay', f: `ตั้งไม่เกิน Im → ${olSet} A${olRange ? ` (ช่วงปรับ ${olRange[0]}–${olRange[1]} A ตาราง 8.4)` : ''}`, ref: 'ตาราง 8.3 มอเตอร์ทั่วไป 100%' });
      steps.push({ t: 'เครื่องปลดวงจร (DM)', f: `IDM ≥ 1.15 × ${im} = ${fmt(1.15 * im)} A → ${dm} A${dmOver ? ' (เกินตาราง)' : ''}`, ref: 'สมการ 8-3' });
      steps.push({ t: 'เบรกเกอร์ป้องกันลัดวงจร', f: `ICB ≤ 2.5 × ${im} = ${fmt(cbMax)} A → เลือก ${cbAt} A (เวลาผกผัน 250%)`, ref: 'ตาราง 8.5' });
      ground = groundFor(olSet);
      condStep = yd ? `Star-Delta: ก่อน controller ≥ 1.25Im = ${fmt(Ireq)} A, หลัง controller ≥ 0.906Im = ${fmt(0.906 * im)} A (6 เส้น kg 0.8)`
        : `DOL: Icable ≥ 1.25 × Im = ${fmt(Ireq)} A`;
      c.motor.ol = olSet; c.motor.dm = dm; c.motor.olRange = olRange;
      if (dmOver) c.motor.dmOver = true;
    } else {
      // เต้ารับ: เผื่อ branchFactor (1.25) ตอนเลือก CB แม้ไม่ใช่โหลดต่อเนื่อง — CB 16 A (เต้ารับ มอก. 166-2549) ใช้ได้เมื่อ I × 1.25 ≤ 16 A
      const f = c.continuous || cat === 'rec' ? meta.branchFactor : 1;
      const Id = I * f;
      c.Id = Id;   // กระแสออกแบบ (ใช้ตอนแนะนำขนาด CB ในผลตรวจ selectivity)
      const minCB = cat === 'light' ? meta.cbLight : cat === 'rec' ? (heavyRec ? Math.max(meta.cbRec, D.REC_DUTY.heavy.cb) : meta.cbRec) : 16;
      c.minCB = minCB;   // CB ขั้นต่ำตามชนิดโหลด (heavy = 20 A) — checkSelectivity/guardAdvice ใช้แนะนำขนาด
      const pk = pickUp(cbList('MCB'), Math.max(Id, minCB));
      cbAt = pk.at; cbOver = pk.over;
      const bl = !c.cbForce && brandATFor(c, cbAt), pk2 = bl && pickUp(bl, Math.max(Id, minCB));
      const genAt = cbAt;
      if (pk2 && !pk2.over && pk2.at !== cbAt) { if (!bl.includes(cbAt)) c.brSnap = { from: cbAt, to: pk2.at }; cbAt = pk2.at; cbOver = false; }
      steps.push({
        t: 'เลือก CB', f: (f !== 1 ? `${cat === 'rec' && !c.continuous ? 'เต้ารับ เผื่อ' : 'โหลดต่อเนื่อง'} I × ${f} = ${fmt(Id)} A; ` : '') + `ICB ≥ Iload และไม่ต่ำกว่า ${minCB} A → ${genAt} A`,
        ref: 'สมการ 6-1, ตาราง MCB หน้า 1'
      });
      if (genAt !== cbAt) steps.push(brandStep(genAt, cbAt, bl));
      if (c.cbForce) {
        c.cbAuto = cbAt;
        if (c.cbForce !== cbAt) {
          cbAt = c.cbForce; cbOver = false;
          steps.push({ t: 'CB กำหนดเอง', f: `ผู้ออกแบบกำหนด ${cbAt} A (ระบบเลือก ${c.cbAuto} A) → สายต้องรับ ≥ ${cbAt} A` });
          if (cbAt < Id) c.warn.push(`CB ที่กำหนด ${cbAt} A ต่ำกว่ากระแสโหลด ${fmt(Id)} A — CB จะตัดวงจร`);
        }
      }
      Ireq = Math.max(cbAt, Id);
      condStep = `Icable ≥ ICB = ${cbAt} A`;
      ground = groundFor(cbAt);
    }

    const ncc = c.phases === 3 ? 3 : 2;
    let pick = pickConductor({ cable: bc.cable, method: bc.method, ncc, Ireq, minSize, meta, groups: 1 });
    steps.push({
      t: 'ขนาดสาย (กระแส)', f: `${condStep} → ${pick.size} mm² รับได้ ${pick.base} A × Ft ${pick.ft.f} = ${fmt(pick.derated)} A`,
      ref: `${ampRef(bc.cable, bc.method)}, Ft ${pick.ft.ref} (${pick.ft.t}°C), ขั้นต่ำ ${minSize} mm²`
    });
    // Star-Delta: สายที่เดินไปมอเตอร์คือช่วง "หลังสตาร์ทเตอร์" 6 เส้น แต่ละเส้นนำ 0.58 Im (1/√3) ร้อยท่อเดียวกัน = 2 กลุ่ม (kg 0.8 ตาราง 5-8)
    // → It ≥ 1.25 × 0.58 Im / 0.8 = 0.906 Im (บทที่ 8 หน้า 261, ตัวอย่าง 8.3.2) ; ช่วงก่อนสตาร์ทเตอร์ (ในตู้) ≥ 1.25 Im ตามขนาดเดิม
    let vdI = I, vdSets = 1, preSize = null;
    if (c.motor && c.motor.start === 'YD' && c.phases === 3) {
      const imY = num(c.motor.im, 0);
      const post = pickConductor({ cable: bc.cable, method: bc.method, ncc, Ireq: 1.25 * 0.58 * imY, minSize, meta, groups: 2 });
      preSize = pick.size;
      if (post.size < pick.size) pick = post;
      vdI = 2 * 0.58 * imY; vdSets = 2;   // 2 เส้นต่อเฟส แต่ละเส้น 0.58 Im
      steps.push({ t: 'ขนาดสาย (หลังสตาร์ทเตอร์ 6 เส้น)', f: `It ≥ 1.25 × 0.58 × ${fmt(imY)} / 0.8 = ${fmt(0.906 * imY)} A → ${pick.size} mm² (Fg ${post.fg ? post.fg.f : 0.8}); ช่วงก่อนสตาร์ทเตอร์ในตู้ ≥ 1.25Im → ${preSize} mm²`, ref: 'บทที่ 8 หน้า 261, ตาราง 5-8' });
    }
    // แรงดันตก
    let vd = vdPercent(bc.cable, bc.method, c.phases, pick.size, vdI, c.L, vdSets);
    let size = pick.size;
    const baseSize = size;   // ขนาดตามกระแส (ก่อนเพิ่มเพื่อแรงดันตก) — ฐานของสัดส่วนสายดิน
    const limit = meta.vdBranch;
    if (vd.pct > limit) {
      const sizes = D.SIZES.filter((s) => s > size && D.AMPACITY[pick.key][s] != null);
      for (const s of sizes) { const v = vdPercent(bc.cable, bc.method, c.phases, s, vdI, c.L, vdSets); size = s; vd = v; if (v.pct <= limit) break; }
      steps.push({ t: 'แรงดันตก', f: `เกิน ${limit}% → เพิ่มขนาดเป็น ${size} mm²: VD = ${vd.mv} × ${fmt(vdI / vdSets)} × ${c.L} / 1000 = ${fmt(vd.volt)} V (${fmt(vd.pct)}%)`, ref: vd.ref });
    } else {
      steps.push({ t: 'แรงดันตก', f: `VD = ${vd.mv} mV/A/m × ${fmt(vdI / vdSets)} A × ${c.L} m / 1000 = ${fmt(vd.volt)} V = ${fmt(vd.pct)}% ≤ ${limit}%`, ref: vd.ref });
    }
    // ปั๊มดับเพลิง (NFPA 20): แรงดันตกขณะสตาร์ทที่ LRC ≤ 15% — คิดเฉพาะช่วงสายวงจรปั๊ม (ไม่รวมแรงดันตกสายป้อนต้นทางที่กระแสสตาร์ท) ; เกินแล้วขยายสายจนผ่านหรือเตือนถ้าถึงขนาดสูงสุดแล้ว
    if (c.firePump && c.phases === 3 && c.motor && c.motor.lrc > 0) {
      const FP = D.FIRE_PUMP;
      const startPct = (z) => { const zc = cableZ(z, c.L, 1); return SQ3 * c.motor.lrc * (zc.R * FP.startCos + zc.X * FP.startSin) / V3 * 100; };
      let sp = startPct(size);
      const was = size;
      if (sp > FP.vdStartMax) {
        for (const z of D.SIZES.filter((z) => z > size && D.AMPACITY[pick.key][z] != null)) { size = z; sp = startPct(z); if (sp <= FP.vdStartMax) break; }
      }
      c.vdStartPct = r2(sp);
      steps.push({ t: 'แรงดันตกขณะสตาร์ท (NFPA 20)', f: `%VD = √3 × ${fmt(c.motor.lrc, 0)} A × ${c.L} m × (R × ${FP.startCos} + X × ${FP.startSin}) / ${V3} = ${fmt(sp, 2)}% ${sp <= FP.vdStartMax ? '≤' : '>'} ${FP.vdStartMax}%${size !== was ? ` (ขยายสายจาก ${was} เป็น ${size} mm²)` : ''}`, ref: 'NFPA 20 (แรงดันที่ขั้วตู้ควบคุมตกไม่เกิน 15% ขณะสตาร์ท)' });
      if (size !== was) vd = vdPercent(bc.cable, bc.method, c.phases, size, vdI, c.L, vdSets);
      if (sp > FP.vdStartMax) c.warn.push(`แรงดันตกขณะสตาร์ทปั๊มดับเพลิง ${fmt(sp, 1)}% เกิน ${FP.vdStartMax}% (NFPA 20) แม้ขยายสายสูงสุดแล้ว — ลดความยาวสาย/ย้ายตู้ควบคุม หรือใช้สายขนาน`);
    }
    let egcScaled = null;
    if (meta.egcProportional === true && size > baseSize) { const g2 = Math.min(scaleEGC(ground, baseSize, size), size); if (g2 > ground) { egcScaled = { from: ground, base: baseSize }; ground = g2; } }
    if (ground > size) ground = size;
    const withGround = !(cat === 'light' && !meta.lightingGround);
    const isMotor3 = c.motor && c.phases === 3;
    const nLive = c.phases === 3 ? (isMotor3 ? 3 : 4) : 2;
    if (withGround) steps.push({ t: 'สายดิน', f: `${c.motor && !c.motor.packaged && olSet != null ? `ตาม OL ${olSet} A` : `ตาม CB ${cbAt} A`} → G ${ground} mm²${egcScaled ? ` (สายเฟสขยาย ${egcScaled.base} → ${size} mm² สายดินขยายตามสัดส่วน ${egcScaled.from} × ${size}/${egcScaled.base})` : ''}`, ref: 'ตาราง 4.2' });

    const wires = [{ size, count: nLive }];
    if (withGround) wires.push({ size: ground, count: 1 });
    if (c.motor && c.motor.start === 'YD') wires[0].count = 6;
    const cd = mth.raceway === 'conduit' ? pickConduit(bc.cable, wires) : null;
    if (cd) steps.push({ t: 'ท่อร้อยสาย', f: `พื้นที่สาย ${fmt(cd.area, 1)} mm² (${cd.n} เส้น, fill ${cd.fill * 100}%) → ${cd.conduit ? cd.conduit.inch + '" ' + bc.conduit : 'เกิน 6"'}`, ref: 'ตาราง 5.1–5.3' });

    c.cb = breaker(cbAt, c.firePump ? 'MCCB' : 'MCB');
    if (cbOver) c.cb.oversize = true;
    c.cb.poles = c.phases === 3 ? 3 : (c.firePump ? 2 : 1);
    c.cb.ic = branchICFor(meta, scKA);
    c.cb.rcd = !!c.rcd;
    if (c.firePump) { c.cb.magOnly = true; c.cb.noOverload = true; c.cb.instMinA = Math.ceil(c.motor.lrc); c.cb.label += ' Mag-only'; }
    if (heavyRec) steps.push({ t: 'เต้ารับใช้งานหนัก', f: `ครัว/แพนทรี่/เวิร์กช็อป → CB ไม่ต่ำกว่า ${D.REC_DUTY.heavy.cb} A, สายเฟส/นิวทรัล ≥ ${D.REC_DUTY.heavy.minSize} mm², RCBO IΔn ≤ 30 mA บังคับ`, ref: 'แผนแม่บท 2.1 / วสท. 022001' });
    else if (c.rcd && c.ev) steps.push({ t: 'เครื่องตัดไฟรั่ว', f: 'ที่ชาร์จรถไฟฟ้า → RCD IΔn ≤ 30 mA ทุกจุดชาร์จ: RCD Type A + 6 mA DC detection or Type B', ref: 'IEC 60364-7-722' });
    else if (c.rcd) steps.push({ t: 'เครื่องตัดไฟรั่ว', f: 'วงจรนี้อยู่ในพื้นที่เปียก/เครื่องทำน้ำร้อน → RCBO IΔn ≤ 30 mA', ref: 'หัวข้อ 6.3.3' });
    const nWire = (c.motor && c.motor.start === 'YD') ? 6 : nLive;
    c.cond = {
      size, ground: withGround ? ground : null, n: nWire, cable: bc.cable,
      text: `${nWire}-${sizeLabel(size)}${withGround ? `/G-${sizeLabel(ground)}` : ''}`,
      amp: ampOf(bc.cable, bc.method, ncc, size, meta, preSize ? 2 : 1)   // Star-Delta: 6 เส้นในท่อเดียว = 2 กลุ่ม
    };
    if (preSize) { c.cond.preSize = preSize; c.cond.yd = true; }
    c.conduit = cd && cd.conduit ? { inch: cd.conduit.inch, type: bc.conduit } : (mth.raceway === 'tray' ? { inch: '-', type: 'TRAY' } : { inch: '-', type: '-' });
    c.vd = vd;
    c.Ireq = Ireq;
    c.olSet = olSet;
    c.steps = steps;
    // ข้อเตือน
    if (cat === 'light' && cbAt > 20 && !(c.lampW >= 250)) c.warn.push('วงจรแสงสว่างไม่ควรใช้ CB เกิน 20 A (ยกเว้นโคม ≥ 250 W)');
    if (cat === 'rec' && cbAt > D.REC_DUTY.maxCB) c.warn.push(`วงจรเต้ารับใช้ CB ${cbAt} A เกิน ${D.REC_DUTY.maxCB} A — หน้าสัมผัสเต้ารับ มอก. 166-2549 รับได้เพียง 16 A เต้าเสียบอาจไหม้ก่อน CB ตัด: แบ่งวงจรให้เล็กลง หรือใช้ปลั๊กอุตสาหกรรม IEC 60309`);
    if (cat === 'rec' && cbAt > 50) c.warn.push('วงจรที่มีจุดจ่ายไฟ ≥ 2 จุดต้องไม่เกิน 50 A');
    if (vd.pct > limit) c.warn.push(`แรงดันตก ${fmt(vd.pct)}% ยังเกิน ${limit}% แม้ใช้สายใหญ่สุด`);
    if (!pick.ok) c.warn.push('ไม่มีขนาดสายในตารางที่รับกระแสได้พอ');
    if (cbOver) c.warn.push(`CB ที่ต้องการเกินตาราง (สูงสุด ${cbAt} A) — แบ่งเป็นหลายวงจร`);
    return c;
  }

  /* ===================== phase balancing / slots ===================== */
  // ลำดับหมวดในตาราง: แสงสว่าง, อื่น ๆ, น้ำร้อน, หุงต้ม, เต้ารับ, แอร์, มอเตอร์, ลิฟต์/บันไดเลื่อน/ชิลเลอร์, Spare
  const CAT_ORDER = { light: 0, other: 1, heater: 2, cook: 3, rec: 4, ac: 5, motor: 6, fire_pump: 6, lift: 7, esc: 7, chiller: 7, spare: 9 };
  const ordOf = (c) => (CAT_ORDER[c.cat] === undefined ? 8 : CAT_ORDER[c.cat]);
  const sortCircuits = (list) => list.map((c, i) => ({ c, i })).sort((a, b) => (ordOf(a.c) - ordOf(b.c)) || (b.c.va - a.c.va) || (a.i - b.i)).map((x) => x.c);
  const unbOf = (v) => { const a = (v[0] + v[1] + v[2]) / 3; return a ? Math.max(Math.abs(v[0] - a), Math.abs(v[1] - a), Math.abs(v[2] - a)) / a * 100 : 0; };

  // เฟสของช่อง i (0-based; เลขวงจร = i+1): seq -> i%3 (A-B-C-A-B-C), pair -> floor(i/2)%3 (AA-BB-CC), แผง 1 เฟส -> 0
  function slotPhase(i, pattern, threeP) {
    if (!threeP) return 0;
    return pattern === 'pair' ? Math.floor(i / 2) % 3 : i % 3;
  }
  const patternOf = (meta) => (meta.phasePattern === 'seq' ? 'seq' : 'pair');

  /*
   * ตัวแบ่งเฟส: แบ่ง "วงจร 1 เฟส" เป็น 3 กลุ่ม (A/B/C) ให้โหลดต่างกันน้อยที่สุด (ลด max|โหลดเฟส − เฉลี่ย|)
   * items = [{va, grp, ord}] (เรียงตามหมวดแล้ว VA มากไปน้อย), lim[g] = {lo:[3], hi:[3]} จำนวนวงจรต่อเฟสของกลุ่ม g
   *   seq : lo = hi = จำนวนช่องของแต่ละเฟส (จำนวนวงจรต่อเฟสต่างกันไม่เกิน 1)
   *   pair: lo = 0, hi = ช่องว่างของเฟสนั้น
   * base = โหลดคงที่ต่อเฟส (วงจร 3 เฟส ÷ 3 + แผงลูก)
   * auto : จัดสามชุด/LPT แล้วสลับคู่ (หมวดเดียวกันก่อน) ; deep : หลายจุดเริ่ม + ย้าย/สลับคู่/วนสามตัว + ค้นหาแบบ branch-and-bound
   * ทั้งหมดกำหนดผลแน่นอน (ไม่สุ่ม ไม่ขึ้นกับเวลา) และ deep ไม่เคยแย่กว่า auto
   */
  const MAX_WAYS = 120;
  const BAL_OPS = 300000, BAL_NODES = 60000, BAL_EXACT_N = 14;
  function phaseSolver(items, lim, base) {
    const n = items.length;
    let tot = base[0] + base[1] + base[2];
    for (const it of items) tot += it.va;
    const avg = tot / 3;
    const tol = 1e-9 * Math.max(1, Math.abs(avg));
    const tol2 = 1e-9 * Math.max(1, avg * avg);
    const cost3 = (a, b, c) => { const x = a - avg, y = b - avg, z = c - avg; return [Math.max(Math.abs(x), Math.abs(y), Math.abs(z)), x * x + y * y + z * z]; };
    const better = (p, q) => p[0] < q[0] - tol || (Math.abs(p[0] - q[0]) <= tol && p[1] < q[1] - tol2);
    const costOf = (s) => cost3(s.ld[0], s.ld[1], s.ld[2]);
    const newState = () => ({ ph: new Array(n).fill(-1), cnt: lim.map(() => [0, 0, 0]), ld: base.slice() });
    const cloneState = (s) => ({ ph: s.ph.slice(), cnt: s.cnt.map((a) => a.slice()), ld: s.ld.slice() });
    const put = (s, i, p) => { s.ph[i] = p; s.cnt[items[i].grp][p]++; s.ld[p] += items[i].va; };
    const room = (s, g, p) => s.cnt[g][p] < lim[g].hi[p];
    let ops = 0;

    const fixed = (i) => items[i].fix != null;
    const putFixed = (s) => { for (let i = 0; i < n; i++) if (fixed(i)) put(s, i, items[i].fix); };
    function greedyTri(order) { // สามชุด: วงจรเรียงกันทีละ 3 ตัวลงคนละเฟส (ตัวใหญ่ลงเฟสที่เบาสุด)
      const s = newState();
      putFixed(s);
      const byG = lim.map(() => []);
      order.forEach((i) => { if (!fixed(i)) byG[items[i].grp].push(i); });
      for (let g = 0; g < lim.length; g++) {
        const L = byG[g];
        for (let q = 0; q < L.length; q += 3) {
          const chunk = L.slice(q, q + 3).sort((a, b) => items[b].va - items[a].va || a - b);
          const used = [false, false, false];
          for (const i of chunk) {
            let cand = [0, 1, 2].filter((p) => room(s, g, p) && !used[p]);
            if (!cand.length) cand = [0, 1, 2].filter((p) => room(s, g, p));
            if (!cand.length) cand = [0, 1, 2];
            cand.sort((a, b) => s.ld[a] - s.ld[b] || a - b);
            used[cand[0]] = true; put(s, i, cand[0]);
          }
        }
      }
      return s;
    }
    function greedyLpt(order) { // วงจรใหญ่ก่อน ลงเฟสที่เบาสุดที่ยังมีช่อง
      const s = newState();
      putFixed(s);
      for (const i of order) {
        if (fixed(i)) continue;
        const g = items[i].grp;
        let cand = [0, 1, 2].filter((p) => room(s, g, p));
        if (!cand.length) cand = [0, 1, 2];
        cand.sort((a, b) => s.ld[a] - s.ld[b] || a - b);
        put(s, i, cand[0]);
      }
      return s;
    }
    function feasible(s, changes) {
      const d = {};
      for (const [i, q] of changes) {
        const g = items[i].grp, kp = g * 3 + s.ph[i], kq = g * 3 + q;
        d[kp] = (d[kp] || 0) - 1; d[kq] = (d[kq] || 0) + 1;
      }
      for (const k of Object.keys(d)) {
        const g = Math.floor(k / 3), p = k % 3, c = s.cnt[g][p] + d[k];
        if (c > lim[g].hi[p] || c < lim[g].lo[p]) return false;
      }
      return true;
    }
    function apply(s, changes) {
      for (const [i] of changes) { const p = s.ph[i]; s.cnt[items[i].grp][p]--; s.ld[p] -= items[i].va; }
      for (const [i, q] of changes) { s.ph[i] = q; s.cnt[items[i].grp][q]++; s.ld[q] += items[i].va; }
    }
    // ปรับปรุงทีละขั้น (เลือกขั้นที่ดีที่สุดในแต่ละรอบ) จนไม่ดีขึ้น
    function improve(s, o) {
      const sc = [0, 0, 0];
      for (let iter = 0; iter < o.maxIter && ops < BAL_OPS; iter++) {
        let best = null, bc = costOf(s);
        for (let i = 0; i < n; i++) {
          if (fixed(i)) continue;
          const pi = s.ph[i], vi = items[i].va;
          if (o.moves) {
            for (let q = 0; q < 3; q++) {
              if (q === pi) continue;
              ops++;
              sc[0] = s.ld[0]; sc[1] = s.ld[1]; sc[2] = s.ld[2]; sc[pi] -= vi; sc[q] += vi;
              const c = cost3(sc[0], sc[1], sc[2]);
              if (better(c, bc) && feasible(s, [[i, q]])) { best = [[i, q]]; bc = c; }
            }
          }
          for (let j = i + 1; j < n; j++) {
            const pj = s.ph[j], vj = items[j].va;
            if (pj === pi || vi === vj || fixed(j)) continue;
            if (o.sameCat && items[i].ord !== items[j].ord) continue;
            ops++;
            sc[0] = s.ld[0]; sc[1] = s.ld[1]; sc[2] = s.ld[2]; sc[pi] += vj - vi; sc[pj] += vi - vj;
            const c = cost3(sc[0], sc[1], sc[2]);
            if (better(c, bc) && feasible(s, [[i, pj], [j, pi]])) { best = [[i, pj], [j, pi]]; bc = c; }
          }
        }
        if (o.cycles) {
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            const pi = s.ph[i], pj = s.ph[j];
            if (pi === pj || fixed(i) || fixed(j)) continue;
            for (let k = j + 1; k < n; k++) {
              const pk = s.ph[k];
              if (pk === pi || pk === pj || fixed(k)) continue;
              const vi = items[i].va, vj = items[j].va, vk = items[k].va;
              ops += 2;
              // i->pj, j->pk, k->pi
              sc[0] = s.ld[0]; sc[1] = s.ld[1]; sc[2] = s.ld[2]; sc[pi] += vk - vi; sc[pj] += vi - vj; sc[pk] += vj - vk;
              let c = cost3(sc[0], sc[1], sc[2]);
              if (better(c, bc) && feasible(s, [[i, pj], [j, pk], [k, pi]])) { best = [[i, pj], [j, pk], [k, pi]]; bc = c; }
              // i->pk, j->pi, k->pj
              sc[0] = s.ld[0]; sc[1] = s.ld[1]; sc[2] = s.ld[2]; sc[pi] += vj - vi; sc[pj] += vk - vj; sc[pk] += vi - vk;
              c = cost3(sc[0], sc[1], sc[2]);
              if (better(c, bc) && feasible(s, [[i, pk], [j, pi], [k, pj]])) { best = [[i, pk], [j, pi], [k, pj]]; bc = c; }
            }
          }
        }
        if (!best) break;
        apply(s, best);
      }
    }
    // ค้นหาแบบ branch-and-bound (จำนวนโหนดจำกัด) เริ่มจากคำตอบที่มีอยู่ — ได้ค่าที่ดีที่สุดจริงเมื่อวงจรไม่มาก
    function exact(init) {
      let best = cloneState(init), bc = costOf(best);
      if (bc[0] <= tol) return best;
      const order = items.map((_, i) => i).sort((a, b) => items[b].va - items[a].va || a - b);
      const suf = new Array(n + 1).fill(0);
      const remG = [];
      for (let k = 0; k <= n; k++) remG.push(lim.map(() => 0));
      for (let k = n - 1; k >= 0; k--) {
        suf[k] = suf[k + 1] + items[order[k]].va;
        for (let g = 0; g < lim.length; g++) remG[k][g] = remG[k + 1][g];
        remG[k][items[order[k]].grp]++;
      }
      const cnt = lim.map(() => [0, 0, 0]), ld = base.slice(), ph = new Array(n).fill(-1);
      let nodes = 0, stop = false;
      const lowOk = (k) => {
        for (let g = 0; g < lim.length; g++) {
          let need = 0;
          for (let p = 0; p < 3; p++) need += Math.max(0, lim[g].lo[p] - cnt[g][p]);
          if (need > remG[k][g]) return false;
        }
        return true;
      };
      (function rec(k) {
        if (stop) return;
        if (++nodes > BAL_NODES) { stop = true; return; }
        if (k === n) {
          const c = cost3(ld[0], ld[1], ld[2]);
          if (better(c, bc)) { bc = c; best = { ph: ph.slice(), cnt: cnt.map((a) => a.slice()), ld: ld.slice() }; if (bc[0] <= tol) stop = true; }
          return;
        }
        const i = order[k], it = items[i], g = it.grp;
        const lim0 = bc[0] - tol; // ต้องดีกว่าคำตอบปัจจุบัน
        const ps = it.fix != null ? [it.fix] : [0, 1, 2].sort((a, b) => ld[a] - ld[b] || a - b);
        for (const p of ps) {
          if (cnt[g][p] >= lim[g].hi[p]) continue;
          if (ld[p] + it.va - avg > lim0) continue;
          cnt[g][p]++; ld[p] += it.va; ph[i] = p;
          let ok = lowOk(k + 1);
          if (ok) {
            let need = 0;
            for (let q = 0; q < 3; q++) need += Math.max(0, avg - lim0 - ld[q]);
            if (need > suf[k + 1] + tol) ok = false;
          }
          if (ok) rec(k + 1);
          cnt[g][p]--; ld[p] -= it.va; ph[i] = -1;
          if (stop) return;
        }
      })(0);
      return best;
    }
    const idx = items.map((_, i) => i);
    return {
      auto(style) {
        ops = 0;
        const s = style === 'tri' ? greedyTri(idx) : greedyLpt(idx);
        const moves = style !== 'tri';
        improve(s, { sameCat: true, moves, cycles: false, maxIter: 40 });
        if (costOf(s)[0] / Math.max(avg, 1e-9) > 0.10) improve(s, { sameCat: false, moves, cycles: false, maxIter: 40 });
        return s;
      },
      deep(autoS, style) {
        ops = 0;
        const byVa = idx.slice().sort((a, b) => items[b].va - items[a].va || a - b);
        const starts = [cloneState(autoS), greedyLpt(byVa), greedyLpt(byVa.slice().reverse())];
        if (style === 'tri') starts.push(greedyTri(byVa));
        let best = null;
        for (const st of starts) {
          improve(st, { sameCat: false, moves: true, cycles: n <= 40, maxIter: 200 });
          if (!best || better(costOf(st), costOf(best))) best = st;
        }
        if (n <= BAL_EXACT_N) best = exact(best);
        return best;
      }
    };
  }

  // ตรึงเฟสได้ไม่เกินจำนวนช่องของเฟสนั้นในกลุ่ม (hi) — ตัวที่เกิน (ตามลำดับ) ปลดการตรึงแล้วติดธง phDenied ไว้เตือน
  function pinsFor(list, grpOf, lim) {
    const used = lim.map(() => [0, 0, 0]);
    return list.map((c, i) => {
      if (c.phForce == null) return null;
      const g = grpOf(i), p = c.phForce;
      if (used[g][p] < lim[g].hi[p]) { used[g][p]++; return p; }
      c.phDenied = p + 1;
      return null;
    });
  }
  const side0 = (idx) => idx % 2 === 0;
  function autoSpareObj(i, phase, cbAt, meta) {
    const cb = Object.assign(breaker(cbAt, 'MCB'), { poles: 1, ic: meta.branchIC });
    return { auto: true, cat: 'spare', phases: 1, va: 0, desc: 'SPARE', slotNos: [i + 1], phase, cb, warn: [] };
  }

  // วางแบบ seq: 3P ก่อน (ตาม meta.threePole) -> 1P ตามหมวดลงช่องว่างต่ำสุดต่อเนื่อง (เฟสตามเลขช่อง) -> Spare ท้ายสุด
  function placeSeq(circuits, w, threeP, meta, panel, opt, reserveSp3) {
    const slots = new Array(w).fill(null);
    const live3 = sortCircuits(circuits.filter((c) => c.phases === 3 && c.cat !== 'spare'));
    const sp3 = sortCircuits(circuits.filter((c) => c.phases === 3 && c.cat === 'spare'));
    const live1 = sortCircuits(circuits.filter((c) => c.phases !== 3 && c.cat !== 'spare'));
    const sp1 = sortCircuits(circuits.filter((c) => c.phases !== 3 && c.cat === 'spare'));
    if ((live3.length || sp3.length) && !threeP) return null;
    // consecutive: 3P ใช้ 3 เลขติดกัน เริ่มที่ช่องซึ่งหารด้วย 3 ลงตัว (1-2-3, 4-5-6, ...) → เฟส A-B-C ในแต่ละวงจร
    // column: 3P ใช้ช่อง i, i+2, i+4 (คอลัมน์เดียวกัน ตามตำแหน่งบัสของแผง 2 คอลัมน์)
    const consec = meta.threePole !== 'column';
    const put3 = (c, from) => {
      if (consec) {
        for (let i = Math.ceil(Math.max(0, from) / 3) * 3; i + 2 < w; i += 3) {
          if (!slots[i] && !slots[i + 1] && !slots[i + 2]) {
            slots[i] = c; slots[i + 1] = { ref: c }; slots[i + 2] = { ref: c };
            c.slotNos = [i + 1, i + 2, i + 3]; c.phase = null;
            return true;
          }
        }
        return false;
      }
      for (let i = Math.max(0, from); i + 4 < w; i++) {
        if (!slots[i] && !slots[i + 2] && !slots[i + 4]) {
          slots[i] = c; slots[i + 2] = { ref: c }; slots[i + 4] = { ref: c };
          c.slotNos = [i + 1, i + 3, i + 5]; c.phase = null;
          return true;
        }
      }
      return false;
    };
    for (const c of live3) if (!put3(c, 0)) return null;
    let maxLive3 = -1;
    slots.forEach((s, i) => { if (s) maxLive3 = i; });
    if (reserveSp3) { // แผงแน่น: จอง Spare 3 เฟสไว้ท้ายแผงก่อน (วงจร 1 เฟสเติมช่องที่เหลือ)
      for (const c of sp3) {
        let ok = false;
        if (consec) {
          for (let i = Math.floor((w - 3) / 3) * 3; i >= 0 && !ok; i -= 3) {
            if (!slots[i] && !slots[i + 1] && !slots[i + 2]) { slots[i] = c; slots[i + 1] = { ref: c }; slots[i + 2] = { ref: c }; c.slotNos = [i + 1, i + 2, i + 3]; c.phase = null; ok = true; }
          }
        } else {
          for (let i = w - 5; i >= 0 && !ok; i--) {
            if (!slots[i] && !slots[i + 2] && !slots[i + 4]) { slots[i] = c; slots[i + 2] = { ref: c }; slots[i + 4] = { ref: c }; c.slotNos = [i + 1, i + 3, i + 5]; c.phase = null; ok = true; }
          }
        }
        if (!ok) return null;
      }
    }
    const free = [];
    for (let i = 0; i < w; i++) if (!slots[i]) free.push(i);
    const k1 = live1.length, k2 = sp1.length;
    if (k1 + k2 > free.length) return null;
    const liveSlots = free.slice(0, k1);
    const afterLive = Math.max(maxLive3, k1 ? liveSlots[k1 - 1] : -1);
    const rest = free.slice(k1);
    // Spare จาก item: ต่อท้ายวงจรใช้งาน (ช่องว่างแทรกกลาง 3P ใช้ทีหลังสุด)
    const spSlots = rest.filter((i) => i > afterLive).concat(rest.filter((i) => i < afterLive).reverse()).slice(0, k2).sort((a, b) => a - b);   // ช่องแทรกกลางใช้เลขสูงสุดก่อน (กฎ R2)
    const phOf = (i) => slotPhase(i, 'seq', threeP);
    const cardOf = (arr) => { const a = [0, 0, 0]; arr.forEach((i) => a[phOf(i)]++); return a; };
    const base = (opt.base || [0, 0, 0]).slice();
    for (const c of live3.concat(sp3)) for (let k = 0; k < 3; k++) base[k] += c.va / 3;
    const lim = [{ lo: cardOf(liveSlots), hi: cardOf(liveSlots) }, { lo: cardOf(spSlots), hi: cardOf(spSlots) }];
    const all1 = live1.concat(sp1);
    const pins = threeP ? pinsFor(all1, (i) => (i < k1 ? 0 : 1), lim) : all1.map(() => null);
    const items = all1.map((c, idx) => ({ va: c.va, grp: idx < k1 ? 0 : 1, ord: ordOf(c), fix: pins[idx] }));
    let ph = new Array(items.length).fill(0), bal = null;
    if (threeP && items.length) {
      const S = phaseSolver(items, lim, base);
      const a = S.auto('tri');
      let chosen = a;
      if (k1 >= 2) {
        const d = S.deep(a, 'tri');
        bal = { auto: unbOf(a.ld), deep: unbOf(d.ld) };
        if (panel.balance === 'deep') chosen = d;
      }
      ph = chosen.ph;
    }
    const byPhase = (arr) => [0, 1, 2].map((p) => arr.filter((i) => phOf(i) === p));
    const lp = byPhase(liveSlots), sp = byPhase(spSlots);
    const nl = [0, 0, 0], ns = [0, 0, 0];
    live1.forEach((c, idx) => { const p = ph[idx]; const i = lp[p][nl[p]++]; slots[i] = c; c.slotNos = [i + 1]; c.phase = phOf(i); });
    sp1.forEach((c, idx) => { const p = ph[k1 + idx]; const i = sp[p][ns[p]++]; slots[i] = c; c.slotNos = [i + 1]; c.phase = phOf(i); });
    let lastSp = Math.max(afterLive, spSlots.length ? spSlots[spSlots.length - 1] : -1);
    if (!reserveSp3) for (const c of sp3) { if (!put3(c, lastSp + 1) && !put3(c, 0)) return null; lastSp = Math.max(lastSp, c.slotNos[2] - 1); }
    return { slots, rows: w / 2, bal, live1 };
  }

  // วางแบบ pair (เดิม): 3P เป็นกลุ่มแถวละ 3 ; 1P แยกเฟสแบบ LPT + สลับ/ย้าย ; แสงสว่างฝั่งซ้าย ที่เหลือฝั่งขวา ; Spare วางต่อท้ายทีหลัง
  function placePair(circuits, w, threeP, meta, panel, opt) {
    const rows = w / 2;
    const slots = new Array(w).fill(null);
    const prefSide = (c) => (c.cat === 'light' ? 0 : 1);
    const three = sortCircuits(circuits.filter((c) => c.phases === 3));
    const one = sortCircuits(circuits.filter((c) => c.phases !== 3));
    if (three.length && !threeP) return null;
    for (const c of three) {
      let placed = false;
      const sides = prefSide(c) === 0 ? [0, 1] : [1, 0];
      for (const side of sides) {
        for (let b = 0; b + 2 < rows && !placed; b += 3) {
          const idx = [0, 1, 2].map((k) => (b + k) * 2 + side);
          if (idx.every((i) => !slots[i])) {
            idx.forEach((i, k) => { slots[i] = k === 0 ? c : { ref: c }; });
            c.slotNos = idx.map((i) => i + 1); c.phase = null;
            placed = true;
          }
        }
        if (placed) break;
      }
      if (!placed) return null;
    }
    const base = (opt.base || [0, 0, 0]).slice();
    for (const c of three) for (let k = 0; k < 3; k++) base[k] += c.va / 3;
    const freeOf = (ph) => { const f = []; for (let i = 0; i < w; i++) if (!slots[i] && slotPhase(i, 'pair', threeP) === ph) f.push(i); return f; };
    const cap = threeP ? [0, 1, 2].map((p) => freeOf(p).length) : [freeOf(0).length, 0, 0];
    if (one.length > cap[0] + cap[1] + cap[2]) return null;

    let assign = new Array(one.length).fill(0), bal = null;
    const liveCount = one.filter((c) => c.cat !== 'spare').length;
    if (threeP && one.length) {
      const lim = [{ lo: [0, 0, 0], hi: cap }];
      const pins = pinsFor(one, () => 0, lim);
      const items = one.map((c, i) => ({ va: c.va, grp: 0, ord: ordOf(c), fix: pins[i] }));
      const S = phaseSolver(items, lim, base);
      const a = S.auto('lpt');
      let chosen = a;
      if (liveCount >= 2) {
        const d = S.deep(a, 'lpt');
        bal = { auto: unbOf(a.ld), deep: unbOf(d.ld) };
        if (panel.balance === 'deep') chosen = d;
      }
      assign = chosen.ph;
    }
    const pendingSpare = [];
    for (let k = 0; k < one.length; k++) {
      const c = one[k], ph = assign[k];
      const free = freeOf(ph);
      const ps = prefSide(c);
      free.sort((a, b) => {
        const sa = a % 2 === ps ? 0 : 1, sb = b % 2 === ps ? 0 : 1;
        return (sa - sb) || (a - b);
      });
      const i = free[0];
      if (i == null) return null;
      if (c.cat === 'spare') { pendingSpare.push([c, ph]); continue; }
      slots[i] = c; c.slotNos = [i + 1]; c.phase = slotPhase(i, 'pair', threeP);
    }
    for (const [c, ph] of pendingSpare) {
      const i = firstFreeAfterUsed(slots, rows, c.va > 0 ? ph : null, threeP);   // SPARE ที่ไม่มีโหลด: ต่อท้ายวงจรจริงของแต่ละคอลัมน์ติดกัน ไม่เว้นช่องตามเฟส (มี VA ต้องตามเฟสที่จัดไว้)
      if (i == null) return null;
      slots[i] = c; c.slotNos = [i + 1]; c.phase = slotPhase(i, 'pair', threeP);
    }
    return { slots, rows, bal, live1: one.filter((c) => c.cat !== 'spare') };
  }

  // ช่องว่างแรกถัดจากวงจรที่ใช้งานแล้ว (pair: ให้ spare อยู่ต่อท้าย ไม่แทรกบนสุด)
  function firstFreeAfterUsed(slots, rows, ph, threeP) {
    let best = null;
    for (const side of [0, 1]) {
      let last = -1;
      for (let r = 0; r < rows; r++) if (slots[r * 2 + side]) last = r;
      for (let r = last + 1; r < rows; r++) {
        if (threeP && ph != null && slotPhase(r * 2 + side, 'pair', true) !== ph) continue;
        const i = r * 2 + side;
        if (!slots[i]) { if (best == null || r < Math.floor(best / 2)) best = i; break; }
      }
    }
    if (best == null) { for (let i = 0; i < slots.length; i++) if (!slots[i] && (!threeP || ph == null || slotPhase(i, 'pair', true) === ph)) return i; }
    return best;
  }

  const loadOfSlots = (res, circuits, base) => {
    const ld = (base || [0, 0, 0]).slice();
    for (const c of circuits) { if (c.phases === 3) for (let k = 0; k < 3; k++) ld[k] += c.va / 3; else ld[c.phase || 0] += c.va; }
    return ld;
  };

  /*
   * กฎการวางช่อง (แผงแบบ seq — LAYOUT RULES) ใช้ทั้งโหลดจริงและ SPARE ; มีเทสต์ tests/layout-rules.test.js และสรุปใน docs/LAYOUT-RULES.md
   *  R0 ตำแหน่ง 3 เฟสคงที่ตามบัส: วงจร 3P ใช้ช่อง i, i+2, i+4 (คอลัมน์เดียวกัน) เสมอ ไม่ย้ายเพื่อให้เลขสวย
   *  R1 โหลดจริงมาก่อน: 3P ลงเลขต่ำสุดก่อน แล้ว 1P ตามหมวด ใช้ช่องว่างเลขต่ำสุดต่อเนื่อง (เฟสไล่ A-B-C ตามเลขช่อง)
   *  R2 SPARE อยู่ท้าย: วางต่อท้ายวงจรจริงก่อน ; ถ้าท้ายแผงไม่เหลือที่ ให้ใช้ช่องว่างที่แทรกอยู่ใน "เลขสูงสุดก่อน"
   *     ช่องที่เหลือเลขต่ำเป็น SPACE (ไม่ใช้) ไม่ใช่ SPARE — SPARE จึงไม่มาคั่นกลางระหว่างโหลดจริง
   */
  // Spare อัตโนมัติ (seq): เติมช่องว่างของ "สามชุดสุดท้ายที่ไม่เต็ม" (เฟสเบาสุดก่อน) แล้วต่อด้วยเลขถัดไปตามลำดับ A-B-C
  function autosSeq(res, k, threeP, cbAt, meta, ld) {
    const slots = res.slots, w = slots.length;
    let last = -1;
    slots.forEach((s, i) => { if (s) last = i; });
    let remaining = k, placed = 0, scan = last + 1;
    const put = (i) => { slots[i] = autoSpareObj(i, slotPhase(i, 'seq', threeP), cbAt, meta); remaining--; placed++; };
    if (threeP && last >= 0 && remaining > 0 && (last % 3) !== 2) {
      const end = Math.min(w - 1, Math.floor(last / 3) * 3 + 2);
      const gaps = [];
      for (let i = last + 1; i <= end; i++) if (!slots[i]) gaps.push(i);
      gaps.sort((a, b) => ld[a % 3] - ld[b % 3] || a - b);
      for (const i of gaps) { if (!remaining) break; put(i); }
      scan = end + 1;
    }
    for (let i = scan; i < w && remaining > 0; i++) if (!slots[i]) put(i);
    // ท้ายแผงเต็มแล้ว: ใช้ช่องว่างแทรกระหว่าง Spare 3 เฟสที่อยู่หลังวงจรใช้งานก่อน แล้วค่อยใช้ช่องคั่นก่อนวงจรใช้งาน (เลี่ยงไม่ได้)
    let liveTop = -1;
    slots.forEach((sl, i) => { const o = sl && (sl.ref || sl); if (o && o.cat !== 'spare' && !o.auto) liveTop = i; });
    for (let i = liveTop + 1; i < w && remaining > 0; i++) if (!slots[i]) put(i);
    for (let i = liveTop; i >= 0 && remaining > 0; i--) if (!slots[i]) put(i);   // กฎ R2: ช่องแทรกกลางใช้เลขสูงสุดก่อน เหลือช่องเลขต่ำเป็น SPACE
    return placed;
  }
  // Spare อัตโนมัติ (pair): เฟสที่โหลดน้อยก่อน วางต่อท้ายวงจรที่ใช้แล้ว
  function autosPair(res, k, threeP, meta, ld) {
    let placed = 0;
    for (let n = 0; n < k; n++) {
      // เฟสที่เบาสุดก่อน (วนตามลำดับ) ถ้าเฟสนั้นไม่มีช่องว่างเหลือ ลองเฟสถัดไป
      let idx = null;
      idx = firstFreeAfterUsed(res.slots, res.rows, null, threeP);   // ต่อท้ายวงจรจริงติดกัน (ไม่เลือกตามเฟส เพราะ SPARE ไม่มีโหลด)
      if (idx == null) break;
      const cbAt = side0(idx) ? meta.cbLight : meta.cbRec;
      res.slots[idx] = autoSpareObj(idx, slotPhase(idx, 'pair', threeP), cbAt, meta);
      placed++;
    }
    return placed;
  }

  // จัดวงจรลงช่อง: คืน { layout, bal } ; circuit ที่วางแล้วได้ c.slotNos / c.phase (1 เฟส 0|1|2, 3 เฟส null)
  function layoutPanel(circuits, panel, meta, opt) {
    opt = opt || {};
    const threeP = panel.phases === 3;
    const pattern = patternOf(meta);
    const spares = circuits.filter((c) => c.cat === 'spare');
    const n3 = circuits.filter((c) => c.phases === 3).length;
    const need = n3 * 3 + (circuits.length - n3);
    const scRaw = panel.spareCount;
    const scNum = isBlank(scRaw) ? NaN : Number(scRaw);
    const spareFixed = Number.isFinite(scNum) && scNum >= 0 ? Math.floor(scNum) : null;
    const autoCount = (w) => (spareFixed != null ? spareFixed : Math.max(0, Math.max(1, Math.round(w * meta.spareRatio)) - spares.length));

    let ways = Number(panel.ways) || 0;
    if (!Number.isFinite(ways)) ways = 0;
    ways = ways > 0 ? Math.min(MAX_WAYS, 2 * Math.ceil(ways / 2)) : 0; // จำกัดจำนวนช่องที่กำหนดเอง (กันค่าผิดปกติทำให้หน่วยความจำหมด)
    let candidates;
    if (ways) candidates = [ways];
    else {
      const byRatio = D.PANEL_WAYS.filter((w) => w >= Math.ceil(need / meta.activeRatio));
      candidates = spareFixed != null ? byRatio.filter((w) => w >= need + spareFixed) : byRatio;
      if (!candidates.length) candidates = byRatio;
      if (!candidates.length) candidates = [42];
    }
    const slotPhases = (w) => Array.from({ length: w }, (_, i) => slotPhase(i, pattern, threeP));
    const reset = () => circuits.forEach((c) => { delete c.slotNos; delete c.phase; delete c.phDenied; });

    for (const w of candidates) {
      reset();
      let res = pattern === 'pair' ? placePair(circuits, w, threeP, meta, panel, opt) : placeSeq(circuits, w, threeP, meta, panel, opt, false);
      if (!res && pattern !== 'pair' && circuits.some((c) => c.phases === 3 && c.cat === 'spare')) { reset(); res = placeSeq(circuits, w, threeP, meta, panel, opt, true); }
      if (!res) continue;
      const used = res.slots.filter(Boolean).length;
      const k = autoCount(w);
      const ld = loadOfSlots(res, circuits, opt.base);
      let placed;
      if (pattern === 'pair') placed = autosPair(res, k, threeP, meta, ld);
      else {
        const lightN = res.live1.filter((c) => c.cat === 'light').length;
        const cbAt = lightN * 2 >= res.live1.length && res.live1.length ? meta.cbLight : (res.live1.length ? meta.cbRec : meta.cbLight);
        placed = autosSeq(res, k, threeP, cbAt, meta, ld);
      }
      if (spareFixed != null && placed < k && opt.warn) opt.warn(`ใส่ Spare อัตโนมัติได้ ${placed} จาก ${k} ช่อง (แผง ${w} ช่องไม่พอ)`);
      return { layout: { slots: res.slots, rows: w / 2, load: ld, ways: w, used, overflow: false, slotPhase: slotPhases(w), pattern }, bal: res.bal };
    }
    reset();
    return { layout: { ways: 42, slots: [], rows: 21, overflow: true, slotPhase: slotPhases(42), pattern }, bal: null };
  }

  // หมายเลขวงจรตามรูปแบบแผงจริง: ซ้าย 1,3,5... ขวา 2,4,6...
  function cctNo(slotIndex) { const row = Math.floor(slotIndex / 2), side = slotIndex % 2; return side === 0 ? row * 2 + 1 : row * 2 + 2; }

  // โหลดแต่ละเฟสจากวงจรของแผงเอง (ไม่รวมแผงลูก): ใช้ c.phase ที่จัดแล้ว ; ยังไม่ได้จัด (แผงสวิตช์/ล้นช่อง) ประมาณแบบ LPT แล้วบันทึก c.phase
  function ownPhaseVA(pr) {
    const v = [0, 0, 0];
    if (pr.board.phases !== 3) { pr.circuits.forEach((c) => { c.phase = 0; v[0] += c.va; }); return v; }
    const rest = [];
    for (const c of pr.circuits) {
      if (c.slotNos) { if (c.phases === 3) for (let k = 0; k < 3; k++) v[k] += c.va / 3; else v[c.phase] += c.va; } else rest.push(c);
    }
    rest.filter((c) => c.phases === 3).forEach((c) => { c.phase = null; for (let k = 0; k < 3; k++) v[k] += c.va / 3; });
    rest.filter((c) => c.phases !== 3).map((c, i) => ({ c, i })).sort((a, b) => (b.c.va - a.c.va) || (a.i - b.i)).forEach(({ c }) => {
      const p = v.indexOf(Math.min(v[0], v[1], v[2]));
      c.phase = p; v[p] += c.va;
    });
    return v;
  }

  /* ===================== demand ===================== */
  function demandOf(circuits, meta, opts) {
    // อาคารชุด: โหลดในห้องชุดคิดตามหลักที่อยู่อาศัย ; ตัวคูณโหลดพร้อมกันของห้องชุดใช้ตอนรวมที่ SDB/MDB (condoDemand)
    const bt = meta.buildingType === 'condo' ? 'residential' : meta.buildingType;
    const byCat = {};
    for (const c of circuits) {
      if (!byCat[c.cat]) byCat[c.cat] = { va: 0, list: [] };
      byCat[c.cat].va += c.va; byCat[c.cat].list.push(c);
    }
    const res = { cats: {}, total: 0, connected: 0, steps: [] };
    const add = (cat, conn, dem, why, ref) => {
      res.cats[cat] = { connected: conn, demand: dem, df: conn ? dem / conn : 1, why, ref };
      res.total += dem; res.connected += conn;
    };
    for (const cat of Object.keys(byCat)) {
      const conn = byCat[cat].va, list = byCat[cat].list;
      if (cat === 'light') {
        if (meta.lightingDF) {
          const rows = D.DF_LIGHT[bt] || D.DF_LIGHT.other;
          let rem = conn, prev = 0, dem = 0; const parts = [];
          for (const [lim, df] of rows) { const seg = Math.min(rem, lim - prev); if (seg <= 0) break; dem += seg * df; parts.push(`${fmt(seg, 0)}×${df}`); rem -= seg; prev = lim; }
          add(cat, conn, dem, parts.join(' + '), 'ตาราง 6.10');
        } else add(cat, conn, conn, 'แสงสว่างคิด 100% (ตาราง 6.10 ถูกยกเลิกในเอกสารอ้างอิง)', 'ตาราง 6.10');
      } else if (cat === 'rec') {
        if (bt === 'residential') add(cat, conn, conn, 'ที่อยู่อาศัย คิดเต้ารับ 100%', 'หัวข้อ 6.4.1');
        else { const dem = Math.min(conn, 10000) + Math.max(0, conn - 10000) * 0.5; add(cat, conn, dem, conn > 10000 ? `10,000 + (${fmt(conn - 10000, 0)} × 0.5)` : 'ไม่เกิน 10 kVA คิด 100%', 'ตาราง 6.11'); }
      } else if (cat === 'ac' || cat === 'chiller') {
        const df = bt === 'hotel' && cat === 'ac' ? 0.75 : 1;
        add(cat, conn, conn * df, df === 1 ? 'เครื่องปรับอากาศ 100%' : 'โรงแรม แอร์แยกแต่ละห้อง 75%', 'ตาราง 6.12');
      } else if (cat === 'heater') {
        const v = list.map((c) => c.va).sort((a, b) => b - a);
        const dem = v.slice(0, 2).reduce((s, x) => s + x, 0) + v.slice(2).reduce((s, x) => s + x, 0) * 0.25;
        add(cat, conn, dem, v.length > 2 ? '2 ตัวแรก 100% + ที่เหลือ 25%' : '100%', 'ตาราง 6.12');
      } else if (cat === 'cook') {
        const v = list.map((c) => c.va).sort((a, b) => b - a);
        let dem;
        if (bt === 'residential') { const I = conn / V1; dem = (I <= 10 ? I : 10 + 0.3 * (I - 10)) * V1; add(cat, conn, dem, 'ที่อยู่อาศัย 10 A + 30% ของส่วนที่เกิน 10 A', 'ตาราง 6.12'); }
        else { dem = (v[0] || 0) + (v[1] || 0) * 0.8 + v.slice(2).reduce((s, x) => s + x, 0) * 0.6; add(cat, conn, dem, 'ตัวใหญ่สุด 100% + ตัวรอง 80% + ที่เหลือ 60%', 'ตาราง 6.12'); }
      } else if (cat === 'motor' || cat === 'lift' || cat === 'esc') {
        add(cat, conn, conn, 'มอเตอร์ 100% (บวก 25% ของตัวใหญ่สุดภายหลัง)', 'สมการ 8-6');
      } else if (cat === 'ev') {
        add(cat, conn, conn, 'ที่ชาร์จรถไฟฟ้า 100% (ไม่คิดตัวคูณการใช้งานพร้อมกัน)', 'IEC 60364-7-722');
      } else if (cat === 'spare') {
        add(cat, conn, conn, 'วงจรสำรองที่กำหนด VA', '-');
      } else add(cat, conn, conn, '100%', '-');
    }
    // มอเตอร์ตัวใหญ่สุด: +25% ใช้คิด "ขนาดตัวนำ" เท่านั้น (สมการ 8-2/8-6/8-7) — ไม่บวกเข้าดีมานด์ (kVA)
    // ตัวอย่างในตำรา (เช่น 9.3.4(ง)) เลือกหม้อแปลงจากดีมานด์โดยไม่บวก 25% → ดีมานด์ไม่เกินโหลดติดตั้ง
    const motors = circuits.filter((c) => c.motor);
    if (motors.length) {
      const big = motors.reduce((a, b) => (b.va > a.va ? b : a));
      res.motorExtra = big.va * 0.25;
      res.bigMotor = big;
    }
    return res;
  }

  // ตัวคูณโหลดพร้อมกันของห้องชุด (ตาราง 9.3 พักอาศัย / 9.4 พาณิชย์) คิด "เป็นขั้น" ตามตัวอย่าง 9.3.3, 9.3.4 ในตำรา:
  // เรียงห้องจากโหลดมากไปน้อย ห้องที่ 1–10 × 0.9, 11–20 × 0.8, 21–30 × 0.7, 31–40 × 0.6, 41+ × 0.5 (พาณิชย์ 1–10 × 1.0, 11+ × 0.85)
  // → ดีมานด์ไม่ลดลงเมื่อเพิ่มห้อง ; ห้องเดียว = 1 ; คืน { va: ดีมานด์หลังคูณ, f: ตัวคูณเฉลี่ย, bands: [[จากห้อง, ถึงห้อง, ตัวคูณ, VA]] }
  function condoDemand(list, kind) {
    const v = list.slice().sort((a, b) => b - a), n = v.length, tot = v.reduce((s, x) => s + x, 0);
    if (n <= 1) return { va: tot, f: 1, bands: [] };
    const rows = kind === 'com' ? D.CONDO_COINCIDENCE_COM : D.CONDO_COINCIDENCE_RES;
    let dem = 0, from = 1; const bands = [];
    for (const [lim, f] of rows) {
      const to = Math.min(n, lim);
      if (to < from) break;
      const seg = v.slice(from - 1, to).reduce((s, x) => s + x, 0);
      dem += seg * f; bands.push([from, to, f, seg]); from = to + 1;
    }
    return { va: dem, f: tot ? dem / tot : 1, bands };
  }
  // ชนิดห้องชุดของแผง: board.unit = 'res' | 'com' | 'none' ; ไม่ระบุ = แผงย่อย (LP) 1 เฟส ถือเป็นห้องชุดพักอาศัย
  function unitKind(b) {
    if (b.unit === 'res' || b.unit === 'com') return b.unit;
    if (b.unit === 'none') return null;
    return b.kind === 'LP' && b.phases === 1 ? 'res' : null;
  }

  /* ===================== feeder ===================== */
  // ความยาวสายป้อนรวมแนวดิ่ง (แผนแม่บท 2.5 ข้อ 3): L = L_ราบ + |ΔFloor| × floorHeight + 2 m (หัวตู้)
  // ใช้เมื่อ "แผงและแผงแม่ระบุ floor เป็นตัวเลขทั้งคู่" ; ไม่ระบุ/ว่าง/ไม่ใช่ตัวเลข = ระยะราบเดิม (โครงการเก่าไม่เปลี่ยนผล)
  function riserOf(board, parent, meta) {
    const horiz = clamp(num(board.feederLength, 0), 0, 1e5);
    const fl = (v) => {
      if (isBlank(v) || typeof v === 'boolean') return null;
      if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 2) / 2 : null;   // ขั้นละครึ่งชั้น (ชั้นลอย 1.5)
      const s = String(v).trim().toUpperCase();
      if (/^B\d+$/.test(s)) return -parseInt(s.slice(1), 10);
      if (s === 'G' || s === 'GROUND') return 1;
      if (s === 'M' || s === 'MEZZ' || s === 'MEZZANINE') return 1.5;   // ชั้นลอย = ครึ่งชั้นเหนือชั้น 1 (ไม่ใช่ชั้น 2)
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
    };
    const a = fl(board.floor), b = parent ? fl(parent.floor) : null;
    if (a === null || b === null) return { length: horiz, riser: null };
    // อาคารไม่มีชั้น 0 (G = 1, B1 = −1): ข้ามระหว่างบนดิน/ใต้ดินต้องหัก 1 ชั้นที่ไม่มีอยู่จริง (G → B1 = 1 ชั้น ไม่ใช่ 2)
    const H = clamp(num(meta.floorHeight, 3.6), 1, 20), extra = 2;
    const dFloor = (a > 0 && b < 0) || (a < 0 && b > 0) ? Math.abs(a - b) - 1 : Math.abs(a - b);
    const total = r2(horiz + dFloor * H + extra);
    return { length: total, riser: { horiz, dFloor, floorHeight: H, extra, total } };
  }

  function designFeeder(o, meta) {
    // o: {name, phases, demandVA, nonMotorVA, motors:[{im, cbAt}], length, spec, maxPhaseVA, useMaxPhase, phaseReason, nonlinear, vdLimit, maxBranchAt, maxKidFeederAt, parentAt, autoSelectivity}
    const steps = [], warn = [];
    // Auto-Selectivity (แผนแม่บท 2.2): ICB,F ≥ ratioMin × max(CB วงจรย่อยใหญ่สุด, CB สายป้อนแผงลูกใหญ่สุด) ; selNeed = 0 เมื่อปิดหรือไม่มีทั้งสองอย่าง
    const brMax = num(o.maxBranchAt, 0), kidMax = num(o.maxKidFeederAt, 0), maxBr = Math.max(brMax, kidMax);
    // ไม่ดันเกิน CB ต้นทาง (o.parentAt) — CB แผงย่อยที่ใหญ่กว่าต้นทางตัดไม่ทันก่อนและทำให้สายใหญ่ขึ้นโดยเปล่าประโยชน์ ; ส่วนที่ยังไม่เลือกตัดให้ตัวตรวจแนะนำขยายเมนต้นทาง
    const parentCap = num(o.parentAt, 0);
    const selWant = o.autoSelectivity !== false && maxBr > 0 ? D.SELECTIVITY.ratioMin * maxBr : 0;
    const selNeed = parentCap > 0 ? Math.min(selWant, parentCap) : selWant;
    const fc = wiringOf(o.spec || meta.feeder, wiringOf(meta.feeder));
    const ph = o.phases === 1 ? 1 : 3;
    const L = clamp(num(o.length, 0), 0, 1e5);
    if (o.riser) steps.push({ t: 'ความยาวสายป้อนแนวดิ่ง (Riser)', f: `L = ${fmt(o.riser.horiz, 1)} + |${o.riser.dFloor}| × ${o.riser.floorHeight} + ${o.riser.extra} = ${fmt(L, 1)} m (ระยะราบ + ชั้น × ความสูงชั้น + หัวตู้)`, ref: 'แผนแม่บท 2.5 ข้อ 3' });
    const I_F = ph === 3 ? o.demandVA / (SQ3 * V3) : o.demandVA / V1;
    const I_nm = ph === 3 ? o.nonMotorVA / (SQ3 * V3) : o.nonMotorVA / V1;
    let Ic, at, cbOver = false, coord = null;   // coord = CB ถูกขยับขึ้นเพราะประสานการเลือกตัดกับสายป้อนแผงลูก (แสดงแท็กในตาราง/รายการคำนวณ)
    const motors = (o.motors || []).slice().sort((a, b) => b.im - a.im);
    steps.push({ t: 'กระแสโหลดสูงสุดของสายป้อน', f: ph === 3 ? `IF = ${fmt(o.demandVA, 0)} / (√3 × 400) = ${fmt(I_F)} A` : `IF = ${fmt(o.demandVA, 0)} / 230 = ${fmt(I_F)} A`, ref: 'หัวข้อ 6.4.2' });
    // กระแสเฟสสูงสุด: โหลดแต่ละเฟสไม่เท่ากัน (ตามผลจัดวงจรจริง) -> คิดขนาด CB/สายจากเฟสที่หนักสุด
    const useMax = o.useMaxPhase !== undefined ? !!o.useMaxPhase : !!meta.useMaxPhase;
    let Ibase = I_F;
    if (ph === 3 && o.maxPhaseVA && useMax) {
      const Imx = o.maxPhaseVA / VPH;
      if (Imx > I_F) {
        Ibase = Imx;
        steps.push({ t: 'ใช้กระแสเฟสสูงสุด', f: `Imax,phase = ${fmt(o.maxPhaseVA, 0)} / 230.94 = ${fmt(Imx)} A > IF ${fmt(I_F)} A (${o.phaseReason || 'โหลดแต่ละเฟสไม่เท่ากัน'}) → ใช้ ${fmt(Imx)} A คิดขนาด CB และสาย`, ref: 'หัวข้อ 6.4.2' });
      }
    }
    const Ibase_nm = Ibase > I_F && I_F > 0 ? I_nm * (Ibase / I_F) : I_nm;
    const list = cbList('MCCB');
    // o.atList = ขนาดที่รุ่น/ซีรีส์ตามยี่ห้อมีขาย: ใช้กฎเดิมกับรายการนั้น ; ไม่มีขนาดที่พอ = คงค่าทั่วไป
    const bl = Array.isArray(o.atList) && o.atList.length ? o.atList : null;
    let genAt = null, snap = null;
    const toBrand = (a2) => { if (a2 && a2 !== at) { genAt = at; if (!bl.includes(at)) snap = { from: at, to: a2 }; at = a2; cbOver = false; } };
    if (motors.length) {
      const m1 = motors[0], rest = motors.slice(1);
      const sumRest = rest.reduce((s, m) => s + m.im, 0);
      Ic = 1.25 * m1.im + sumRest + Ibase_nm;
      const cbMax = m1.cbAt + sumRest + Ibase_nm;
      at = lastDown(list, cbMax);
      if (!at || at < Ic) { const pk = pickUp(list, Ic); at = pk.at; cbOver = pk.over; }
      if (bl) { let a2 = lastDown(bl, cbMax); if (!a2 || a2 < Ic) { const p2 = pickUp(bl, Ic); a2 = p2.over ? null : p2.at; } toBrand(a2); }
      steps.push({ t: 'ขนาดตัวนำ (มีมอเตอร์)', f: `Ifeeder ≥ 1.25×${fmt(m1.im)} + ${fmt(sumRest)} + ${fmt(Ibase_nm)} = ${fmt(Ic)} A`, ref: 'สมการ 8-7' });
      steps.push({ t: 'CB สายป้อน (มีมอเตอร์)', f: `ICB,F ≤ ${m1.cbAt} + ${fmt(sumRest)} + ${fmt(Ibase_nm)} = ${fmt(cbMax)} A → ${at} A`, ref: 'สมการ 8-5' });
    } else {
      const ff = meta.feederFactor;
      Ic = Ibase * ff;
      const need = Math.max(Ic, selNeed);
      const pk = pickUp(list, need); at = pk.at; cbOver = pk.over;
      if (bl) { const p2 = pickUp(bl, need); toBrand(p2.over ? null : p2.at); }
      const atLoad = pickUp(list, Ic).at;
      steps.push({ t: 'เลือก CB สายป้อน', f: `${ff !== 1 ? `${Ibase > I_F ? 'Imax,phase' : 'IF'} × ${ff} = ${fmt(Ic)} A → ` : ''}ICB,F ≥ ${fmt(Ic)} A → ${atLoad} AT`, ref: 'สมการ 6-4, ตาราง MCCB หน้า 1' });
      if (selNeed > Ic + 1e-9 && atLoad < (genAt || at)) {
        const fin = genAt || at, capped = selWant > selNeed + 1e-9;
        if (kidMax > brMax) coord = { by: 'kid', ratio: D.SELECTIVITY.ratioMin, kidAt: kidMax };
        steps.push({ t: 'ประสานการเลือกตัด (Auto-Selectivity)', tag: coord ? `${coord.ratio}× Coord` : undefined, f: `ICB,F ≥ ${D.SELECTIVITY.ratioMin} × ${maxBr} A (${kidMax > brMax ? 'CB สายป้อนแผงลูกใหญ่สุด' : 'CB วงจรย่อยใหญ่สุด'}) = ${fmt(selWant)} A${capped ? ` แต่จำกัดไม่เกิน CB ต้นทาง ${parentCap} A` : ''} → ${fin} AT (อัตราส่วน ${fmt(fin / maxBr, 2)}${fin / maxBr >= D.SELECTIVITY.ratioMin - 1e-9 ? ` ≥ ${D.SELECTIVITY.ratioMin}` : ` < ${D.SELECTIVITY.ratioMin} — ต้องขยายเมนต้นทางหรือลด CB ย่อย`}) ; สายป้อนต้องรับ ≥ CB`, ref: kidMax > brMax ? 'แผนแม่บท 2.2 (ประสานสายป้อนหลายชั้น), IEC 60947-2 ภาค A' : 'แผนแม่บท 2.2, IEC 60947-2 ภาค A' });
      }
    }
    // มอเตอร์อยู่ในแผงลูก: ตัวนำต้องรับ +25% ของมอเตอร์ตัวใหญ่สุดหนึ่งครั้ง (สมการ 8-7) — ดีมานด์ไม่ได้รวมไว้แล้ว
    const bigIm = num(o.bigIm, 0);
    if (bigIm > 0 && (!motors.length || bigIm > motors[0].im)) {
      const Imin = Ibase + 0.25 * bigIm;
      if (Imin > Ic + 1e-9) {
        Ic = Imin;
        const pk = pickUp(list, Ic); if (pk.at > at) { at = pk.at; cbOver = pk.over; }
        steps.push({ t: 'เผื่อมอเตอร์ตัวใหญ่สุด', f: `I ≥ ${fmt(Ibase)} + 0.25 × ${fmt(bigIm)} = ${fmt(Ic)} A → CB ${at} A`, ref: 'สมการ 8-7' });
      }
    }
    if (genAt) steps.push(brandStep(genAt, at, bl));
    const cb = breaker(at, 'MCCB');
    cb.poles = ph === 3 ? 3 : 2;
    if (snap) cb.brSnap = snap;
    // ค่าปรับตั้ง Ir (overload) ที่แนะนำ: ≥ กระแสออกแบบและอยู่ในช่วงปรับ 0.7–1.0 × AT (IEC 60947-2) — ข้อมูลอ้างอิงในรายงาน ไม่กระทบการเลือก AT/สาย
    cb.ir = Math.min(at, Math.max(Math.ceil(Ic), Math.round(at * 0.7)));
    steps.push({ t: 'ค่าปรับตั้ง Ir (โอเวอร์โหลด)', f: `Ir ≥ ${fmt(Ic)} A และอยู่ในช่วงปรับ 0.7–1.0 × ${at} AT → ตั้ง Ir = ${cb.ir} A`, ref: 'IEC 60947-2' });
    if (cbOver) { cb.oversize = true; warn.push(`CB ที่ต้องการ ${fmt(Ic)} A เกินตารางเบรกเกอร์ (สูงสุด ${at} A) — แบ่งเป็นหลายสายป้อน หรือใช้บัสดักท์`); }
    const Ireq = motors.length ? Ic : Math.max(at, Ic);
    const ncc = ph === 3 ? 3 : 2;
    const minSize = pos(o.minSize, 0) || meta.minFeeder;
    const maxSingle = Math.max(pos(meta.maxParallelSize, 300), minSize);
    const MAXSETS = 8;
    // สายเดินควบ: ต่อชุดไม่เล็กกว่า PARALLEL_MIN_SIZE (ไม่เกินขนาดสูงสุดต่อชุดที่ตั้งไว้)
    const minFor = (s) => (s > 1 ? Math.min(Math.max(minSize, PARALLEL_MIN_SIZE), maxSingle) : minSize);
    const pickFor = (s) => pickConductor({ cable: fc.cable, method: fc.method, ncc, Ireq: Ireq / s, minSize: minFor(s), maxSize: maxSingle, meta, groups: s });

    // จำนวนชุดขนาน (ตามกระแส)
    const pick1 = pickFor(1);   // ขนาดตามกระแสแบบชุดเดียว — ฐานของสัดส่วนสายดิน
    let sets = 1, pick = pick1;
    while (!pick.ok && sets < MAXSETS) { sets++; pick = pickFor(sets); }
    steps.push({
      t: 'ขนาดสายเฟส', f: (sets > 1 ? `แบ่ง ${sets} ชุดขนาน: ${fmt(Ireq)} / ${sets} = ${fmt(Ireq / sets)} A ต่อชุด, Fg ${pick.fg.f} (${pick.fg.ref}); ` : '') +
        `ต้องการ ≥ ${fmt(Ireq / sets)} A → ${pick.size} mm² รับได้ ${pick.base} × ${r2(pick.ft.f * pick.fg.f)} = ${fmt(pick.derated)} A`,
      ref: `${ampRef(fc.cable, fc.method)}, ${pick.ft.ref} ${pick.ft.t}°C, ขั้นต่ำ ${minSize} mm²`
    });
    let size = pick.size;
    // แรงดันตก: เพิ่มขนาดภายใน maxParallelSize ก่อน ถ้ายังไม่ผ่านจึงเพิ่มจำนวนชุดขนาน
    let vd = vdPercent(fc.cable, fc.method, ph, size, I_F, L, sets);
    const lim = o.vdLimit != null ? o.vdLimit : meta.vdFeeder;
    if (vd.pct > lim) {
      const tbl = D.AMPACITY[pick.key];
      let found = false, bs = sets, bz = size, bv = vd;
      outer: for (let s = sets; s <= MAXSETS; s++) {
        const pk = s === sets ? pick : pickFor(s);
        for (const z of D.SIZES.filter((z) => z >= pk.size && tbl[z] != null && z <= maxSingle)) {
          const v = vdPercent(fc.cable, fc.method, ph, z, I_F, L, s);
          bs = s; bz = z; bv = v;
          if (v.pct <= lim) { found = true; break outer; }
        }
      }
      const was = `${sets > 1 ? sets + '×' : ''}${size}`;
      sets = bs; size = bz; vd = bv;
      steps.push({ t: 'แรงดันตก', f: `เกิน ${lim}% → ${sets > 1 ? `ขนาน ${sets} ชุด ` : ''}ขนาด ${size} mm² (จาก ${was}${found ? '' : ', สูงสุดที่ยอมให้แล้ว'}): VD = ${vd.mv} × ${fmt(I_F)} × ${L} / 1000${sets > 1 ? ` / ${sets}` : ''} = ${fmt(vd.volt)} V (${fmt(vd.pct)}%)`, ref: vd.ref });
    } else {
      steps.push({ t: 'แรงดันตก', f: `VD = ${vd.mv} × ${fmt(I_F)} × ${L} / 1000${sets > 1 ? ` / ${sets}` : ''} = ${fmt(vd.volt)} V = ${fmt(vd.pct)}% ≤ ${lim}%`, ref: vd.ref });
    }
    if (vd.pct > lim) warn.push(`แรงดันตกสายป้อน ${fmt(vd.pct)}% เกิน ${lim}%`);
    const amp = ampOf(fc.cable, fc.method, ncc, size, meta, sets) * sets;
    if (amp + 1e-9 < Ireq) warn.push(`สายป้อนรับกระแสได้ ${fmt(amp, 0)} A น้อยกว่าที่ต้องการ ${fmt(Ireq, 0)} A แม้ขนาน ${sets} ชุด × ${size} mm² (สูงสุดที่ตั้งไว้) — แบ่งเป็นหลายสายป้อน หรือใช้บัสดักท์`);

    // นิวทรัล
    let nSize = null, nNote = '';
    if (ph === 3 && !o.noNeutral) {
      if (I_F <= 200 || o.nonlinear) { nSize = size; nNote = o.nonlinear ? 'โหลด non-linear → full neutral' : 'IF ≤ 200 A → นิวทรัลเท่าสายเฟส'; }
      else {
        const IN = 200 + 0.7 * (I_F - 200);
        const p = pickConductor({ cable: fc.cable, method: fc.method, ncc, Ireq: IN / sets, minSize: minFor(sets), meta, groups: sets });
        nSize = Math.min(size, p.size);
        nNote = `IN = 200 + 0.7 × (${fmt(I_F)} − 200) = ${fmt(IN)} A → ${nSize} mm²`;
      }
      steps.push({ t: 'สายนิวทรัล', f: nNote, ref: 'สมการ 6-5' });
    }
    let g = groundFor(at), egcNote = '';
    if (meta.egcProportional === true && size > pick1.size) { const g2 = Math.min(scaleEGC(g, pick1.size, size), size); if (g2 > g) { egcNote = ` (สายเฟสขยาย ${pick1.size} → ${size} mm² สายดินขยายตามสัดส่วน ${g} × ${size}/${pick1.size})`; g = g2; } }
    if (g > size) g = size;
    steps.push({ t: 'สายดินบริภัณฑ์', f: `CB ${at} AT → G ${g} mm²${egcNote}`, ref: 'ตาราง 4.2' });

    // ช่องเดินสาย
    let raceway = '-', racewayDetail = null;
    const mth = methodOf(fc.method);
    const wires = [{ size, count: ph === 3 ? 3 : 2 }];
    if (nSize && ph === 3) wires.push({ size: nSize, count: 1 });
    wires.push({ size: g, count: 1 });
    if (mth.raceway === 'conduit') {
      const cd = pickConduit(fc.cable, wires);
      raceway = cd.conduit ? `${cd.conduit.inch}" ${fc.conduit}` : 'เกิน 6"';
      racewayDetail = cd;
      steps.push({ t: 'ท่อร้อยสาย (ต่อชุด)', f: `พื้นที่ ${fmt(cd.area, 1)} mm², ${cd.n} เส้น fill 40% → ${raceway}${sets > 1 ? ` จำนวน ${sets} ท่อ` : ''}`, ref: 'ตาราง 5.1–5.3' });
    } else if (mth.raceway === 'tray') {
      const tot = wires.reduce((s, w) => s + cableArea(fc.cable, w.size, 1) * w.count, 0) * sets;
      const ww = pickWireway(tot);
      raceway = ww ? `Tray/Wireway ${ww.w}×${ww.h} mm` : 'Cable tray';
      steps.push({ t: 'รางเดินสาย', f: `พื้นที่สายรวม ${fmt(tot, 0)} mm² ≤ 20% ของหน้าตัดราง → ${raceway}`, ref: 'ตาราง 5.9' });
    } else raceway = mth.label.split('—')[1] ? mth.label.split('—')[1].trim() : '-';

    const live = ph === 3 ? 3 : 2;
    const fullN = nSize && ph === 3 && nSize === size;
    const text4 = (sets > 1 ? `${sets}×(` : '') + `${live + (fullN ? 1 : 0)}-${size}` +
      (nSize && ph === 3 && !fullN ? `, 1-${nSize}` : '') + `/G-${g}` + (sets > 1 ? ')' : '');

    return {
      I_F, Ic, cb, sets, size, nSize, ground: g, vd, raceway, racewayDetail, cable: fc.cable, method: fc.method, conduitType: fc.conduit,
      length: L, riser: o.riser || null, coord: coord ? Object.assign(coord, { at }) : null,
      text: text4, amp, steps, warn
    };
  }

  /* ===================== short circuit (IEC 60909 แบบย่อ) ===================== */
  function cableZ(size, L, sets) {
    let z = D.CABLE_Z[size];
    if (!z) { const ks = Object.keys(D.CABLE_Z).map(Number).sort((a, b) => a - b); const k = ks.filter((s) => s <= size).pop(); z = D.CABLE_Z[k === undefined ? ks[0] : k]; }
    return { R: z[0] * L / 1000 / (sets || 1), X: z[1] * L / 1000 / (sets || 1) }; // Ω (ค่าในตารางเป็น mΩ/m)
  }
  function iscFrom(Z) {
    const c = 1.05, Un = V3;
    const mag = Math.max(Math.sqrt(Z.R * Z.R + Z.X * Z.X), 1e-6);
    const Ik = c * Un / (SQ3 * mag) / 1000; // kA
    const kappa = 1.02 + 0.98 * Math.exp(-3 * (Z.R / (Z.X || 1e-9)));
    return { Ik, ip: kappa * Math.SQRT2 * Ik, kappa, Z: mag, R: Z.R, X: Z.X };
  }

  /* ===================== meta ที่ผ่านการตรวจ ===================== */
  // ช่วงที่ยอมรับของตัวเลขใน meta (นอกช่วง/ไม่ใช่ตัวเลข = ปรับและเตือน)
  const META_RANGE = {
    hvKV: [3, 500], ambientAir: [-20, 90], ambientGround: [-20, 90], recVA: [1, 5000], recPerCircuit: [1, 100], lightMaxLoading: [0.1, 1],
    branchFactor: [1, 3], feederFactor: [1, 3], vdBranch: [0.1, 30], vdFeeder: [0.1, 30], vdTotal: [0.1, 50],
    minLight: [0.5, 500], minRec: [0.5, 500], minOther: [0.5, 500], minFeeder: [1, 500], cbLight: [6, 100], cbRec: [6, 100], branchIC: [1, 100],
    sourceKA: [0, 1000], serviceKA: [1, 1000], growth: [0, 300], spareRatio: [0, 0.5], activeRatio: [0.3, 1], pfNow: [0.3, 1], pfTarget: [0.5, 1],
    maxParallelSize: [1.5, 500], mccbICMin: [1, 100], floorHeight: [1, 20]
  };
  function buildMeta(pm, warnings) {
    pm = pm && typeof pm === 'object' ? pm : {};
    const def = defaultMeta();
    const meta = Object.assign({}, def, pm);
    ['branch', 'feeder', 'main', 'hv'].forEach((k) => { meta[k] = Object.assign({}, def[k], pm[k] && typeof pm[k] === 'object' ? pm[k] : {}); });
    const fix = (obj, key, lo, hi, label) => {
      const raw = obj[key], v = Number(raw);
      if (!Number.isFinite(v) || isBlank(raw)) { if (!isBlank(raw) && warnings) warnings.push(`ตั้งค่า ${label} "${raw}" ไม่ถูกต้อง — ใช้ค่าเริ่มต้น ${def[label] !== undefined ? def[label] : ''}`); obj[key] = key in def ? def[key] : (key === 'length' ? 15 : 300); return; }
      const c = clamp(v, lo, hi);
      if (c !== v && warnings) warnings.push(`ตั้งค่า ${label} = ${raw} อยู่นอกช่วง ${lo}–${hi} — ใช้ ${c}`);
      obj[key] = c;
    };
    for (const k of Object.keys(META_RANGE)) fix(meta, k, META_RANGE[k][0], META_RANGE[k][1], k);
    const fixSub = (sub, key, lo, hi, d) => {
      const raw = meta[sub][key], v = Number(raw);
      if (!Number.isFinite(v) || isBlank(raw)) { meta[sub][key] = d; if (!isBlank(raw) && warnings) warnings.push(`ตั้งค่า ${sub}.${key} "${raw}" ไม่ถูกต้อง — ใช้ ${d}`); return; }
      const c = clamp(v, lo, hi);
      if (c !== v && warnings) warnings.push(`ตั้งค่า ${sub}.${key} = ${raw} อยู่นอกช่วง ${lo}–${hi} — ใช้ ${c}`);
      meta[sub][key] = c;
    };
    fixSub('main', 'length', 0, 2000, def.main.length); fixSub('main', 'maxSize', 1.5, 500, def.main.maxSize); fixSub('hv', 'length', 0, 2000, def.hv.length);
    for (const k of ['branch', 'feeder', 'main']) {
      const w = meta[k];
      if (!D.CABLES[w.cable]) { if (warnings) warnings.push(`ชนิดสาย "${w.cable}" ใน ${k} ไม่รู้จัก — ใช้ ${def[k].cable}`); w.cable = def[k].cable; }
      else if (D.CABLES[w.cable].fire) { if (warnings) warnings.push(`สายทนไฟ ${w.cable} ใช้ได้เฉพาะวงจรปั๊มดับเพลิง — ${k} ใช้ ${def[k].cable} แทน`); w.cable = def[k].cable; }
      if (!D.METHODS[w.method]) { if (warnings) warnings.push(`วิธีเดินสาย "${w.method}" ใน ${k} ไม่รู้จัก — ใช้ ${def[k].method}`); w.method = def[k].method; }
      if (!D.CONDUIT_TYPES.includes(w.conduit)) { if (warnings) warnings.push(`ชนิดท่อ "${w.conduit}" ใน ${k} ไม่รู้จัก — ใช้ ${def[k].conduit}`); w.conduit = def[k].conduit; }
    }
    if (meta.supply !== 'transformer' && meta.supply !== 'lv') { if (warnings) warnings.push(`ระบบรับไฟ "${meta.supply}" ไม่รู้จัก — ใช้หม้อแปลง`); meta.supply = 'transformer'; }
    if (meta.utility !== 'PEA' && meta.utility !== 'MEA') { if (warnings) warnings.push(`การไฟฟ้า "${meta.utility}" ไม่รู้จัก — ใช้ กฟภ.`); meta.utility = 'PEA'; }
    meta.phasePattern = meta.phasePattern === 'seq' ? 'seq' : 'pair';
    meta.threePole = meta.threePole === 'column' ? 'column' : 'consecutive';
    return meta;
  }

  const ITEM_TYPES = ['light', 'rec', 'ac', 'heater', 'cook', 'motor', 'fire_pump', 'lift', 'esc', 'chiller', 'ev', 'custom', 'spare'];

  /* ===================== main ===================== */
  function calculate(project) {
    try { return calculateAll(project); } finally { BCTX = null; }
  }
  function calculateAll(project) {
    project = project && typeof project === 'object' ? project : {};
    const warnings = [];
    const meta = buildMeta(project.meta, warnings);
    BCTX = BR ? BR.context(meta, project) : null;

    /* ---------- แผง: ตรวจ id / เฟส / MDB ---------- */
    const boards = [];
    const seenId = new Set();
    (Array.isArray(project.panels) ? project.panels : []).forEach((p, i) => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) { warnings.push(`แผงลำดับที่ ${i + 1} อ่านไม่ได้ — ข้าม`); return; }
      if (isBlank(p.id)) { warnings.push(`แผง "${p.name || i + 1}" ไม่มี id — ข้าม`); return; }
      const id = String(p.id);
      if (seenId.has(id)) { warnings.push(`id แผง "${id}" ซ้ำ — ข้ามแผงที่ซ้ำ`); return; }
      seenId.add(id);
      const b = Object.assign({ kind: 'LP', feederLength: 20 }, p);
      b.id = id;
      b.name = isBlank(b.name) ? id : String(b.name);
      b.phases = phasesOf(b.phases, 3);
      b.emergency = b.emergency === true || b.emergency === 'true' || b.emergency === 1; // แผงฉุกเฉิน (รับไฟผ่าน ATS)
      boards.push(b);
    });
    // MDB เป็นราก ถ้ายังไม่มีให้สร้าง
    let mdb = boards.find((b) => b.kind === 'MDB');
    if (!mdb) {
      let id = 'MDB';
      while (seenId.has(id)) id += '_';
      mdb = { id, name: 'MDB', kind: 'MDB', phases: 3, parent: null };
      boards.unshift(mdb);
    }
    mdb.parent = null;
    const byId = new Map(boards.map((b) => [b.id, b]));

    /* ---------- โครงสร้างการรับไฟ: ตรวจแม่ที่ไม่มี / วนกลับ ---------- */
    const parentOf = new Map();
    for (const b of boards) {
      if (b === mdb) { parentOf.set(b.id, null); continue; }
      const raw = b.parent === undefined ? mdb.id : (b.parent === null || b.parent === '' ? null : String(b.parent));
      parentOf.set(b.id, raw != null && raw !== b.id && byId.has(raw) ? raw : null);
    }
    const state = new Map();
    for (const b of boards) {
      if (state.get(b.id)) continue;
      const path = [];
      let cur = b;
      while (cur && !state.get(cur.id)) {
        state.set(cur.id, 1); path.push(cur);
        const pid = parentOf.get(cur.id);
        cur = pid ? byId.get(pid) : null;
      }
      if (cur && state.get(cur.id) === 1) parentOf.set(cur.id, null); // วนกลับ: ตัดที่แผงนี้
      path.forEach((x) => state.set(x.id, 2));
    }
    // ต่อก่อนเมนสวิตช์ (NFPA 20 — ตัวเลือกปิดไว้): board.tap = 'ahead_of_main' ใช้ได้เฉพาะแผงที่รับไฟตรงจาก MDB ; ค่าอื่น/ตำแหน่งอื่นถูกตัดทิ้งพร้อมคำเตือน
    for (const b of boards) {
      const raw = b.tap;
      delete b.tap;
      if (raw === undefined || raw === null || raw === '' || raw === false) continue;
      if (typeof raw !== 'string' || raw.trim().toLowerCase() !== 'ahead_of_main') { warnings.push(`${b.name}: tap "${String(raw).slice(0, 30)}" ไม่รู้จัก (ใช้ได้เฉพาะ "ahead_of_main") — ไม่ใช้`); continue; }
      if (b === mdb) { warnings.push(`${b.name}: MDB ใช้ tap ahead of main ไม่ได้ (ใช้ได้เฉพาะแผงที่รับไฟตรงจาก MDB) — ไม่ใช้`); continue; }
      if (parentOf.get(b.id) !== mdb.id) { warnings.push(`${b.name}: tap ahead of main ใช้ได้เฉพาะแผงที่รับไฟตรงจาก MDB — แผงนี้รับไฟจากแผงอื่น/ไม่ได้เชื่อมกับ MDB จึงไม่ใช้`); continue; }
      b.tap = 'ahead_of_main';
    }
    const kidsOf = new Map(boards.map((b) => [b.id, []]));
    for (const b of boards) { const pid = parentOf.get(b.id); if (pid) kidsOf.get(pid).push(b); }
    const children = (id) => kidsOf.get(id);
    const roots = [mdb].concat(boards.filter((b) => b !== mdb && parentOf.get(b.id) == null));
    const postOrder = (root) => { // ต้นไม้ -> ลูกก่อนแม่ (ไม่ใช้ recursion)
      const out = [], st = [[root, 0]];
      while (st.length) {
        const top = st[st.length - 1], kids = children(top[0].id);
        if (top[1] < kids.length) st.push([kids[top[1]++], 0]); else { out.push(top[0].id); st.pop(); }
      }
      return out;
    };
    const preOrder = (root) => { const out = [], st = [root]; while (st.length) { const b = st.pop(); out.push(b.id); const k = children(b.id); for (let i = k.length - 1; i >= 0; i--) st.push(k[i]); } return out; };
    const order = [];
    const pre = [];
    roots.forEach((r) => { postOrder(r).forEach((id) => order.push(id)); preOrder(r).forEach((id) => pre.push(id)); });
    const reachable = new Set(preOrder(mdb));
    for (const b of boards) if (!reachable.has(b.id)) warnings.push(`${b.name}: ไม่ได้เชื่อมกับ MDB (ตรวจช่อง "รับไฟจาก") — ออกแบบโดยสมมติรับไฟจาก MDB และไม่นับรวมในโหลดรวมของอาคาร`);

    /* ---------- วงจรย่อยของทุกแผง ---------- */
    const itemsBy = new Map(boards.map((b) => [b.id, []]));
    (Array.isArray(project.items) ? project.items : []).forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const label = it.name || it.id || it.type || `#${i + 1}`;
      const pid = isBlank(it.panelId) ? null : String(it.panelId);
      if (pid == null || !itemsBy.has(pid)) { warnings.push(`รายการ "${label}" ชี้ไปยังแผง "${isBlank(it.panelId) ? '(ไม่ระบุ)' : it.panelId}" — ไม่พบแผงนี้ จึงไม่ถูกนับในการคำนวณ`); return; }
      if (!ITEM_TYPES.includes(it.type)) { warnings.push(`รายการ "${label}" ชนิดอุปกรณ์ "${it.type}" ไม่รู้จัก — ข้าม`); return; }
      itemsBy.get(pid).push(it);
    });
    const service = { steps: [] };
    const panelRes = new Map();
    for (const b of boards) {
      let circuits = [];
      itemsBy.get(b.id).forEach((it) => {
        // cbOv = { "<ลำดับวงจรในอุปกรณ์>": AT } — ผู้ออกแบบกำหนดขนาด CB ของวงจรนั้นเอง (ลากวาง/เลือกจาก dropdown)
        const ov = it.cbOv && typeof it.cbOv === 'object' ? it.cbOv : null;
        // phOv = { "<ลำดับวงจรในอุปกรณ์>": 0|1|2 } — ตรึงวงจร 1 เฟสไว้ที่เฟส A/B/C (ลากวาง/เลือกเฟส) ตัวจัดเฟสจัดวงจรอื่นรอบ ๆ
        const po = it.phOv && typeof it.phOv === 'object' ? it.phOv : null;
        const ex = expandItem(it, meta);
        ex.forEach((c, i) => {
          c.cIdx = i + 1;
          const f = ov ? Number(ov[i + 1]) : NaN; if (D.MCB_AT.includes(f)) c.cbForce = f;
          // ยี่ห้อ: ชนิดแผง/ชนิด CB ที่ผู้ออกแบบเลือก/รุ่นที่กำหนดรายตัว (item.brOv) — ใช้ตอนเลือก AT ที่รุ่นมีขาย
          if (BCTX) { c.brLP = b.kind === 'LP'; c.brType = it.cbType || ''; const bo = it.brOv && typeof it.brOv === 'object' ? it.brOv[i + 1] : null; if (typeof bo === 'string') c.brOv = bo; }
          const ph = po && po[i + 1] !== undefined && po[i + 1] !== null && po[i + 1] !== '' ? Number(po[i + 1]) : NaN;
          if (b.phases === 3 && c.phases !== 3 && c.cat !== 'spare' && (ph === 0 || ph === 1 || ph === 2)) c.phForce = ph;   // แผง 1 เฟสมีเฟสเดียว / Spare ไม่ตรึง
        });
        circuits = circuits.concat(ex);
      });
      if (b.phases !== 3 && circuits.some((c) => c.phases === 3)) warnings.push(`${b.name}: มีอุปกรณ์ 3 เฟสในแผง 1 เฟส`);
      panelRes.set(b.id, { board: b, circuits });
    }
    // board.phase ของแผง 1 เฟส: 0|1|2 (หรือ 'A'|'B'|'C') ; ค่าอื่น = ให้ระบบกระจายให้
    const fixedPhase = (b) => { const v = b.phase; if (typeof v === 'boolean' || Array.isArray(v)) return null; const p = v === 'A' ? 0 : v === 'B' ? 1 : v === 'C' ? 2 : (isBlank(v) ? NaN : Number(v)); return p === 0 || p === 1 || p === 2 ? p : null; };

    /* ---------- ดีมานด์ + จัดวงจรลงช่อง + โหลดแต่ละเฟส (ลูกก่อนแม่) ---------- */
    const condo = meta.buildingType === 'condo';
    for (const id of order) {
      const pr = panelRes.get(id);
      const b = pr.board;
      const isLP = b.kind === 'LP';
      const threeP = b.phases === 3;
      pr.circuits.forEach((c) => { c.desc = c.desc || ''; });
      const dem = demandOf(pr.circuits, meta);
      pr.demandLocal = dem;
      const kids = children(id);
      let kidDemand = 0, kidConnected = 0;
      kids.forEach((k) => { const kr = panelRes.get(k.id); kidDemand += kr.demand; kidConnected += kr.connected; });
      pr.kids = kids.map((k) => k.id);
      pr.demand = dem.total + kidDemand;
      pr.connected = dem.connected + kidConnected;
      if (condo) {
        // แยกดีมานด์ห้องชุด (ก่อนคูณ) ออกจากโหลดส่วนกลาง แล้วคูณตัวคูณตามจำนวนห้องชุดทั้งหมดใต้แผงนี้
        const uk = id === mdb.id ? null : unitKind(b);
        const u = { res: { n: 0, va: 0, list: [] }, com: { n: 0, va: 0, list: [] } };
        let common = dem.total;
        kids.forEach((k) => { const kr = panelRes.get(k.id); common += kr.unitCommon; ['res', 'com'].forEach((t) => { u[t].n += kr.units[t].n; u[t].va += kr.units[t].va; u[t].list = u[t].list.concat(kr.units[t].list); }); });
        if (uk) {
          const va = common + kids.reduce((s, k) => s + panelRes.get(k.id).units.res.va + panelRes.get(k.id).units.com.va, 0);
          u.res = { n: 0, va: 0, list: [] }; u.com = { n: 0, va: 0, list: [] }; u[uk] = { n: 1, va, list: [va] }; common = 0;
        }
        pr.units = u; pr.unitCommon = common;
        if (!uk && (u.res.n + u.com.n)) {
          const dr = condoDemand(u.res.list, 'res'), dc = condoDemand(u.com.list, 'com');
          const cf = { res: { n: u.res.n, va: u.res.va, f: dr.f, bands: dr.bands, demand: dr.va }, com: { n: u.com.n, va: u.com.va, f: dc.f, bands: dc.bands, demand: dc.va }, common };
          pr.demand = common + dr.va + dc.va;
          pr.condo = cf;
        }
      }
      // โหลดที่ไม่ใช่มอเตอร์ (ใช้ในสมการ 8-5/8-7)
      const localMotorVA = pr.circuits.filter((c) => c.motor).reduce((s, c) => s + c.va, 0);
      pr.nonMotorVA = pr.demand - localMotorVA;
      pr.motors = pr.circuits.filter((c) => c.motor);
      // กระแสพิกัดมอเตอร์ตัวใหญ่สุดในแผงนี้และแผงลูกทั้งหมด (ใช้ +25% ครั้งเดียวในสายป้อนต้นทาง)
      pr.bigIm = Math.max(0, ...pr.motors.map((c) => num(c.motor.im, 0)), ...kids.map((k) => panelRes.get(k.id).bigIm || 0));

      // โหลดต่อเฟสของแผงลูก: 3 เฟส = phaseVA ของตัวเอง ; 1 เฟส = ทั้งหมดอยู่เฟสเดียว (board.phase หรือกระจายใหญ่สุดก่อนลงเฟสที่เบาสุด)
      const kidPh = [0, 0, 0];
      const freeKids = [];
      for (const k of kids) {
        const kr = panelRes.get(k.id);
        if (!threeP) { kidPh[0] += kr.connected; kr.feedPhase = k.phases === 3 ? null : 0; continue; }
        if (k.phases === 3) { for (let q = 0; q < 3; q++) kidPh[q] += kr.phaseVA[q]; kr.feedPhase = null; continue; }
        const fp = fixedPhase(k);
        if (fp != null) { kidPh[fp] += kr.connected; kr.feedPhase = fp; } else freeKids.push(k);
      }
      let layout = null, bal = null;
      if (isLP) {
        const L = layoutPanel(pr.circuits, b, meta, { base: kidPh, warn: (m) => warnings.push(`${b.name}: ${m}`) });
        layout = L.layout; bal = L.bal;
        if (layout.overflow) warnings.push(`${b.name}: จำนวนวงจรเกิน 42 ช่อง — แบ่งเป็น 2 แผง`);
        pr.circuits.filter((c) => c.phDenied).forEach((c) => warnings.push(`${b.name}: ตรึง "${c.desc}"${c.slotNos ? ` (วงจร ${c.slotNos[0]})` : ''} ไว้เฟส ${'ABC'[c.phDenied - 1]} ไม่ได้ (ช่องของเฟสนั้นเต็ม) — จัดเฟสให้อัตโนมัติ`));
      }
      const own = ownPhaseVA(pr);
      if (threeP && freeKids.length) {
        const cur = [own[0] + kidPh[0], own[1] + kidPh[1], own[2] + kidPh[2]];
        freeKids.map((k, i) => ({ k, i })).sort((a, c) => (panelRes.get(c.k.id).connected - panelRes.get(a.k.id).connected) || (a.i - c.i)).forEach(({ k }) => {
          const kr = panelRes.get(k.id);
          const p = cur.indexOf(Math.min(cur[0], cur[1], cur[2]));
          cur[p] += kr.connected; kidPh[p] += kr.connected; kr.feedPhase = p;
        });
      }
      pr.phaseKidVA = kidPh;
      pr.phaseVA = [own[0] + kidPh[0], own[1] + kidPh[1], own[2] + kidPh[2]];
      pr.unbalance = unbOf(pr.phaseVA);
      pr.layout = layout;
      pr.bal = bal;
      pr.has1PKids = kids.some((k) => k.phases !== 3);
    }

    /* ---------- ระบบประธาน + กระแสลัดวงจรต้นทาง ---------- */
    const mdbRes = panelRes.get(mdb.id);
    const totalDemand = mdbRes.demand;
    const kvaDemand = totalDemand / 1000;
    service.demandKVA = kvaDemand;
    // รับไฟแรงต่ำ + MDB 1 เฟส (บ้าน/ทาวน์เฮาส์) → กระแส 1 เฟส ที่ 230 V และเลือกมิเตอร์ 1 เฟส
    const svcPh = meta.supply !== 'transformer' && mdb.phases === 1 ? 1 : 3;
    service.phases = svcPh;
    service.demandI = svcPh === 1 ? totalDemand / V1 : totalDemand / (SQ3 * V3);
    // แผง tap ahead of main (NFPA 20): CB ประธานคิดจากดีมานด์ที่ไม่รวมแผง tap ; หม้อแปลง/มิเตอร์/สายประธาน/เครื่องกำเนิดไฟฟ้า/Ik" ใช้ดีมานด์รวม (service.demandKVA / demandI)
    const tapBoards = boards.filter((b) => b.tap === 'ahead_of_main');
    const tappedVA = Math.min(totalDemand, tapBoards.reduce((s, b) => s + panelRes.get(b.id).demand, 0));
    const mainDemandI = svcPh === 1 ? (totalDemand - tappedVA) / V1 : (totalDemand - tappedVA) / (SQ3 * V3);
    if (tapBoards.length) {
      service.tap = { panels: tapBoards.map((b) => b.id), names: tapBoards.map((b) => b.name), tappedVA, tappedKVA: tappedVA / 1000, mainDemandVA: totalDemand - tappedVA, mainDemandI };
      tapBoards.forEach((b) => {
        if (!preOrder(b).some((id) => panelRes.get(id).circuits.some((c) => c.firePump))) warnings.push(`${b.name}: tap ahead of main ใช้กับแผงปั๊มดับเพลิง (NFPA 20) — แผงนี้ไม่มีวงจรปั๊มดับเพลิง โหลดอื่นที่ต่อก่อน CB ประธานจะปลดด้วย CB ประธานไม่ได้`);
      });
    }
    if (condo) {
      const cf = mdbRes.condo;
      service.condo = cf || null;
      if (cf) {
        const part = (t, label, ref) => (cf[t].n ? `${label} ${cf[t].n} ห้อง ${fmt(cf[t].va / 1000, 2)} kVA → ${cf[t].bands.length ? cf[t].bands.map(([a, b, f]) => `ห้อง ${a}–${b} × ${f}`).join(', ') : '× 1'} = ${fmt(cf[t].demand / 1000, 2)} kVA (${ref})` : '');
        service.steps.push({ t: 'ตัวคูณโหลดพร้อมกันห้องชุด', f: [part('res', 'ห้องชุดพักอาศัย', 'ตาราง 9.3'), part('com', 'ห้องชุดพาณิชย์', 'ตาราง 9.4'), `ส่วนกลาง ${fmt(cf.common / 1000, 2)} kVA × 1`].filter(Boolean).join(' + ') + ` = ${fmt(kvaDemand, 2)} kVA`, ref: 'ตาราง 9.1–9.4' });
      } else warnings.push('อาคารชุด: ไม่พบแผงห้องชุด (แผงย่อย 1 เฟส หรือแผงที่ตั้ง "ห้องชุด") — ยังไม่ได้ใช้ตัวคูณโหลดพร้อมกัน');
    }
    const growth = meta.growth;
    let Zsrc = { R: 0, X: 0 };
    let mainFeederMin = 0;

    if (meta.supply === 'transformer') {
      const need = kvaDemand * (1 + growth / 100);
      let tr = D.TRANSFORMERS.find((t) => t.kva >= need);
      if (!tr) {
        tr = D.TRANSFORMERS[D.TRANSFORMERS.length - 1];
        service.trafoOver = true;
        warnings.push(`ดีมานด์ ${fmt(need, 0)} kVA เกินหม้อแปลงมาตรฐานสูงสุด ${tr.kva} kVA (ตาราง 7.1) — ต้องแบ่งเป็นหลายหม้อแปลง/หลายระบบประธาน`);
      }
      // ถ้าไม่มีขนาด CB ประธานมาตรฐานที่อยู่ระหว่าง Idemand ถึง ILV (ช่องว่างของตารางขนาด เช่น Idemand 419 A / ILV 455 A) → ขยับหม้อแปลงขึ้นอีกขั้น
      // แทนที่จะปล่อย CB ประธานใหญ่กว่า ILV (ไม่ปลอดภัยต่อหม้อแปลงและเตือนซ้ำทุกโครงการ)
      if (!service.trafoOver) {
        const cbAll = cbList('MCCB');
        const fits = (t) => { const a = lastDown(cbAll, t.kva * 1000 / (SQ3 * V3)); return !!a && a >= mainDemandI; };
        if (!fits(tr)) {
          const up = D.TRANSFORMERS.find((t) => t.kva > tr.kva && fits(t));
          if (up) { service.trafoUpsized = { from: tr.kva, to: up.kva }; tr = up; }
        }
      }
      service.trafo = tr;
      service.steps.push({ t: 'โหลดสูงสุดทั้งอาคาร', f: `${fmt(kvaDemand, 2)} kVA${growth ? ` × (1 + ${growth}%) = ${fmt(need, 2)} kVA` : ''}` });
      service.steps.push({ t: 'เลือกหม้อแปลง', f: `ขนาดมาตรฐานถัดไปที่ ≥ ${fmt(need, 1)} kVA → ${tr.kva} kVA, %Z = ${tr.z}%${service.trafoOver ? ' (เกินตาราง ใช้ขนาดสูงสุด)' : ''}${service.trafoUpsized ? ` (ขยับจาก ${service.trafoUpsized.from} kVA — ไม่มี CB ประธานมาตรฐานระหว่าง Idemand ถึง ILV)` : ''}`, ref: 'ตาราง 7.1' });
      const Ihv = tr.kva / (SQ3 * meta.hvKV);
      const fuseStd = [6.3, 10, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200];
      const fuseMax = 3 * Ihv;
      const fuse = lastDown(fuseStd, fuseMax) || fuseStd[0];
      const hvCable = Object.keys(D.HV_CABLE_TRAY).map(Number).find((s) => D.HV_CABLE_TRAY[s] >= Ihv) || 50;
      service.hv = { I: Ihv, fuse, fuseMax, cbMax: 6 * Ihv, cable: hvCable };
      service.steps.push({ t: 'กระแสด้านแรงสูง', f: `IHV = ${tr.kva} / (√3 × ${meta.hvKV}) = ${fmt(Ihv)} A` });
      service.steps.push({ t: 'ฟิวส์แรงสูง', f: `≤ 300% × ${fmt(Ihv)} = ${fmt(fuseMax)} A → HV fuse ${fuse} A (หรือ CB ≤ 600% = ${fmt(6 * Ihv)} A)`, ref: 'ตาราง 7.2 (%Z ≤ 6%)' });
      service.steps.push({ t: 'สายแรงสูง', f: `CV/XLPE 1/C ${meta.hvKV} kV บนรางเคเบิลแบบบันได: ${hvCable} mm² รับ ${D.HV_CABLE_TRAY[hvCable]} A ≥ ${fmt(Ihv)} A`, ref: 'ตาราง 5-36' });

      const Ilv = tr.kva * 1000 / (SQ3 * V3);
      const list = cbList('MCCB');
      let mainAt = lastDown(list, Ilv), mainOver = false;
      if (!mainAt || mainAt < mainDemandI) {
        const pk = pickUp(list, mainDemandI); mainAt = pk.at; mainOver = pk.over;
        warnings.push('CB ประธานใหญ่กว่ากระแสพิกัดหม้อแปลง — พิจารณาหม้อแปลงขนาดใหญ่ขึ้น');
        if (mainOver) warnings.push(`กระแสดีมานด์ ${fmt(mainDemandI, 0)} A เกินตารางเบรกเกอร์ (สูงสุด ${mainAt} A) — ต้องแบ่งเป็นหลายระบบประธาน`);
      }
      const mbl = BCTX && !mainOver ? BCTX.list('MCCB', 3, BCTX.mainOv) : null;   // ยี่ห้อ: กฎเดิมกับขนาดที่รุ่นมีขาย
      if (mbl) { let a2 = lastDown(mbl, Ilv); if (!a2 || a2 < mainDemandI) a2 = nextUp(mbl, mainDemandI); if (a2 && a2 !== mainAt) { service.mainSnap = { from: mainAt, to: a2, list: mbl }; mainAt = a2; } }
      service.mainCB = breaker(mainAt, 'MCCB');
      if (mainOver) service.mainCB.oversize = true;
      service.Ilv = Ilv;
      service.steps.push({ t: 'กระแสพิกัดด้านแรงต่ำ', f: `ILV = ${tr.kva}k / (√3 × 400) = ${fmt(Ilv)} A; Idemand = ${fmt(service.demandI)} A` });
      service.steps.push({ t: 'CB ประธานแรงต่ำ', f: `ไม่เกิน 100% ของ ILV และไม่ต่ำกว่า Idemand${service.tap ? ` (ไม่รวมแผง tap ahead of main ${service.tap.names.join(', ')}: ${fmt(mainDemandI)} A)` : ''} → ${service.mainCB.label}`, ref: 'ตาราง 7.2' });

      // อิมพีแดนซ์หม้อแปลง
      const U = V3, S = tr.kva * 1000;
      const Zt = tr.z / 100 * U * U / S;
      const Rt = tr.ll / (3 * Ilv * Ilv);
      const Xt = Math.sqrt(Math.max(Zt * Zt - Rt * Rt, 0));
      const xT = Xt / (U * U / S);
      const KT = 0.95 * 1.05 / (1 + 0.6 * xT);
      Zsrc = { R: Rt * KT, X: Xt * KT };
      if (meta.sourceKA > 0) { const ZQ = 1.1 * meta.hvKV * 1000 / (SQ3 * meta.sourceKA * 1000) * (U / (meta.hvKV * 1000)) ** 2; Zsrc.X += 0.995 * ZQ; Zsrc.R += 0.0995 * ZQ; }
      service.trafoZ = { Zt, Rt, Xt, KT };
      const scT = iscFrom(Zsrc);
      service.scTrafo = scT;
      service.steps.push({ t: 'อิมพีแดนซ์หม้อแปลง', f: `ZT = ${tr.z}% × 400²/${tr.kva}k = ${fmt(Zt * 1000, 3)} mΩ, RT = ${tr.ll}/(3×${fmt(Ilv, 1)}²) = ${fmt(Rt * 1000, 3)} mΩ, KT = ${fmt(KT, 3)}`, ref: 'หน้า 67' });
      service.steps.push({ t: 'ลัดวงจรที่ขั้วหม้อแปลง', f: `Ik" = 1.05 × 400 / (√3 × ${fmt(scT.Z * 1000, 3)} mΩ) = ${fmt(scT.Ik, 2)} kA (${meta.sourceKA > 0 ? 'รวมอิมพีแดนซ์ระบบ' : 'infinite bus'})`, ref: 'IEC 60909' });
    } else {
      // รับไฟแรงต่ำ: เลือกมิเตอร์
      const tbl = meta.utility === 'MEA' ? D.METER_MEA : D.METER_PEA;
      const I = service.demandI * meta.feederFactor;
      let row;
      if (meta.utility === 'MEA') row = tbl.find((r) => r[1] === svcPh && r[3] >= service.demandI && r[2] >= I);
      else row = tbl.find((r) => r[1] === svcPh && r[2] >= I);
      const over = !row;
      if (over && svcPh === 1) {
        row = tbl.filter((r) => r[1] === 1).pop();
        warnings.push(`กระแสดีมานด์ 1 เฟส ${fmt(service.demandI, 0)} A (× ${meta.feederFactor} = ${fmt(I, 0)} A) เกินมิเตอร์ 1 เฟสใหญ่สุดของ${meta.utility === 'MEA' ? ' กฟน.' : ' กฟภ.'} (${row[0]}, CB สูงสุด ${row[2]} A) — ควรขอมิเตอร์ 3 เฟส (ตั้ง MDB เป็น 3 เฟส)`);
      } else if (over) {
        row = tbl[tbl.length - 1];
        warnings.push(`กระแสดีมานด์ ${fmt(service.demandI, 0)} A (× ${meta.feederFactor} = ${fmt(I, 0)} A) เกินพิกัดมิเตอร์สูงสุดของ${meta.utility === 'MEA' ? ' กฟน.' : ' กฟภ.'} (${row[0]}, CB สูงสุด ${row[2]} A) — ควรรับไฟแรงสูงและติดตั้งหม้อแปลงของผู้ใช้ไฟเอง (ตั้งระบบรับไฟเป็น "หม้อแปลง")`);
      }
      const cbs = cbList('MCCB');
      const at = lastDown(cbs.filter((a) => a <= row[2]), row[2]);
      const Im = mainDemandI * meta.feederFactor;   // CB ประธาน: ไม่รวมแผง tap ahead of main (มิเตอร์ยังเลือกจากดีมานด์รวม)
      const up = nextUp(cbs, Im);
      let mainAt = up !== undefined && up <= row[2] ? up : at;
      const mbl = BCTX ? BCTX.list('MCCB', svcPh === 1 ? 2 : 3, BCTX.mainOv) : null;   // ยี่ห้อ: กฎเดิมกับขนาดที่รุ่นมีขาย
      if (mbl) { const u2 = nextUp(mbl, Im), a2 = u2 !== undefined && u2 <= row[2] ? u2 : lastDown(mbl.filter((a) => a <= row[2]), row[2]); if (a2 && a2 !== mainAt) { service.mainSnap = { from: mainAt, to: a2, list: mbl }; mainAt = a2; } }
      service.meter = { size: row[0], phases: row[1], cbMax: row[2], extra: row[3], utility: meta.utility, over };
      service.mainCB = breaker(mainAt, 'MCCB');
      if (svcPh === 1) service.mainCB.poles = 2;
      service.steps.push({ t: 'โหลดสูงสุดทั้งอาคาร', f: `${fmt(kvaDemand, 2)} kVA → I = ${fmt(service.demandI)} A` });
      service.steps.push({ t: 'ขนาดเครื่องวัดฯ', f: `${meta.utility === 'MEA' ? 'กฟน.' : 'กฟภ.'} ${svcPh} เฟส → ${row[0]} (CB สูงสุด ${row[2]} A${meta.utility === 'MEA' ? `, โหลดสูงสุด ${row[3]} A` : `, สายทองแดงขั้นต่ำ ${row[3]} mm²`})${over ? ' — เกินพิกัดมิเตอร์ ใช้แถวสุดท้าย' : ''}`, ref: meta.utility === 'MEA' ? 'ตาราง 7.3' : 'ตาราง 7.4' });
      service.steps.push({ t: 'CB ประธาน', f: `${service.tap ? `${fmt(mainDemandI)} A (ไม่รวมแผง tap ahead of main ${service.tap.names.join(', ')})` : fmt(service.demandI)} × ${meta.feederFactor} = ${fmt(Im)} A → ${service.mainCB.label}` });
      if (meta.utility === 'PEA') mainFeederMin = row[3];
      const ZQ = 1.05 * V3 / (SQ3 * meta.serviceKA * 1000);
      Zsrc = { R: 0.0995 * ZQ, X: 0.995 * ZQ };
    }
    const mainSpec = wiringOf(meta.main, wiringOf(defaultMeta().main));
    // สายประธาน : ปกติคิดจาก CB ประธาน ; มีแผง tap ahead of main → CB ประธานไม่ได้ป้องกันช่วงก่อนจุด tap สายต้องรับดีมานด์ทั้งอาคาร (ไม่เล็กกว่ากรณีไม่ tap)
    let svcAt = service.mainCB.at;
    if (service.tap) {
      const Ifull = service.demandI * (meta.supply === 'transformer' ? 1 : meta.feederFactor);
      svcAt = Math.max(svcAt, pickUp(cbList('MCCB'), Ifull).at);
      service.steps.push({ t: 'สายประธาน (มีแผง tap ahead of main)', f: `CB ประธาน ${service.mainCB.at} AT ไม่ป้องกันช่วงสายก่อนจุด tap (${service.tap.names.join(', ')} ${fmt(service.tap.tappedKVA, 2)} kVA) → สายประธานรับดีมานด์รวม ${fmt(service.demandI)} A${meta.supply === 'transformer' ? '' : ` × ${meta.feederFactor}`} = ${fmt(Ifull)} A → ใช้ ${svcAt} A เป็นฐานเลือกสาย (ไม่เล็กกว่ากรณีไม่ tap)`, ref: 'NFPA 20 บทที่ 9 (ตีความตามโครงการ/การไฟฟ้า)' });
    }
    const mainF = designMain(svcAt, meta, mainSpec, { minSize: mainFeederMin });
    service.mainFeeder = mainF;
    mainF.warn.forEach((w) => warnings.push(w));
    const zc = cableZ(mainF.size, meta.main.length, mainF.sets);
    Zsrc = { R: Zsrc.R + zc.R, X: Zsrc.X + zc.X };
    service.mainFeeder.vd = vdPercent(mainSpec.cable, mainSpec.method, svcPh, mainF.size, service.demandI, meta.main.length, mainF.sets);
    const eq = mainF.size * mainF.sets;
    service.gec = lookupRange(D.GROUND_ELECTRODE, eq)[1];
    service.steps.push({ t: 'สายต่อหลักดิน', f: meta.supply === 'transformer' ? `ตัวนำประธานเทียบเท่า ${mainF.sets}×${mainF.size} = ${eq} mm² → ${service.gec} mm²` : `ตัวนำประธาน ${mainF.sets}×${mainF.size} mm² → ${service.gec} mm²`, ref: 'ตาราง 4.1' });
    const sbb = pickUp(D.BUSBAR_A, service.mainCB.af || service.mainCB.at);
    service.busbar = sbb.at;
    if (sbb.over) warnings.push(`MDB: บัสบาร์ต้องการ ≥ ${fmt(service.mainCB.af || service.mainCB.at, 0)} A เกินตารางสูงสุด ${sbb.at} A — ต้องออกแบบบัสบาร์พิเศษ`);
    const scMDB = iscFrom(Zsrc);
    service.scMDB = scMDB;
    service.mainCB.ic = Math.max(meta.mccbICMin || 0, icStd(scMDB.Ik));
    if (BCTX) {
      if (service.mainSnap) service.steps.push(brandStep(service.mainSnap.from, service.mainSnap.to, service.mainSnap.list));
      brandOne(service.mainCB, 'MCCB', svcPh === 1 ? 2 : 3, scMDB.Ik, BCTX.mainOv, { snap: service.mainSnap }, (w) => warnings.push(`${mdb.name}: CB ประธาน — ${w}`), service.steps);
    }
    service.steps.push({ t: 'ลัดวงจรที่ MDB', f: `รวมสายประธาน ${meta.main.length} m → Ik" = ${fmt(scMDB.Ik, 2)} kA, ip = ${fmt(scMDB.ip, 2)} kA → IC ≥ ${service.mainCB.ic} kA`, ref: 'IEC 60909 / ตาราง 10.2' });

    // PF correction: บีบ pf เข้าช่วง และไม่ติดลบ (pf ปัจจุบัน ≥ เป้าหมาย = ไม่ต้องติดตั้ง)
    const pfNow = meta.pfNow, pfTarget = meta.pfTarget;
    const P = kvaDemand * pfNow;
    const tan = (pf) => Math.tan(Math.acos(pf));
    const Kc = Math.max(0, tan(pfNow) - tan(pfTarget));
    const kvar = P * Kc;
    // ผู้ใช้ไฟรายเล็กรับไฟแรงต่ำ (บ้าน 1 เฟส หรือดีมานด์ < 30 kW) การไฟฟ้าไม่เก็บค่าตัวประกอบกำลัง → ไม่แนะนำตู้คาปาซิเตอร์
    const smallLV = meta.supply === 'lv' && (svcPh === 1 || P < 30);
    service.pfc = { P, Kc, kvar, bank: smallLV ? 0 : Math.max(0, Math.ceil(kvar / 25 - 1e-9)) * 25, pfNow, pfTarget, smallLV };
    service.steps.push({
      t: 'ปรับปรุงตัวประกอบกำลัง',
      f: smallLV ? `ผู้ใช้ไฟรายเล็กรับไฟแรงต่ำ (${svcPh === 1 ? '1 เฟส' : `P = ${fmt(P)} kW < 30 kW`}) — การไฟฟ้าไม่คิดค่าตัวประกอบกำลัง จึงไม่ต้องติดตั้งตู้คาปาซิเตอร์`
        : pfNow >= pfTarget ? `pf ปัจจุบัน ${pfNow} ≥ เป้าหมาย ${pfTarget} → ไม่ต้องติดตั้งตู้คาปาซิเตอร์ (Qc = 0)` : `P = ${fmt(kvaDemand)} × ${pfNow} = ${fmt(P)} kW; Kc(${pfNow}→${pfTarget}) = ${fmt(Kc, 3)} → Qc = ${fmt(kvar)} kVAR (ตู้ ${service.pfc.bank} kVAR)`,
      ref: 'ตาราง 12.2'
    });

    /* ---------- สายป้อนแผงจากบนลงล่าง + IC ของ CB ทุกตัว ---------- */
    const warnIK100 = new Set();
    const finishIC = (pr, Ik) => {
      const ic = branchICFor(meta, Ik);
      // ชนิด CB ของวงจรกำหนดที่นี่ครั้งเดียว แล้วตาราง Feeder / SLD / BOM / selectivity ใช้ object เดียวกัน:
      // แผงย่อย (LP) = MCB ; โหลดต่อตรงที่ MDB/SDB: มอเตอร์/ลิฟต์/ชิลเลอร์, 3 เฟส หรือ > 63 A = MCCB, ที่เหลือ = MCB — ผู้ออกแบบเลือกเองได้ (item.cbType)
      const mccbIC = Math.max(meta.mccbICMin || 0, icStd(Ik));
      const isLPb = pr.board.kind === 'LP';
      const itemOf = new Map((itemsBy.get(pr.board.id) || []).map((it) => [it.id, it]));
      pr.circuits.forEach((c) => {
        if (!c.cb) return;
        if (!isLPb && c.cb.at > 0 && !c.firePump) {   // ปั๊มดับเพลิงคง MCCB Mag-only เสมอ (ไม่ตามชนิด CB ของรายการ)
          const it = itemOf.get(c.itemId);
          const big = c.motor || c.phases === 3 || c.cb.at > 63 || ['lift', 'esc', 'chiller'].includes(c.cat);
          const want = it && (it.cbType === 'MCB' || it.cbType === 'MCCB') ? it.cbType : (big ? 'MCCB' : 'MCB');
          const kind = want === 'MCB' && c.cb.at <= 100 ? 'MCB' : (want === 'MCCB' ? 'MCCB' : c.cb.type);
          if (c.cb.type !== kind) { const nb = breaker(c.cb.at, kind); nb.poles = c.cb.poles; nb.rcd = c.cb.rcd; if (c.cb.oversize) nb.oversize = true; c.cb = nb; }
        }
        c.cb.ic = c.cb.type === 'MCCB' ? mccbIC : ic;
        // Mag-only ไม่มีในแคตตาล็อก thermal-magnetic ของยี่ห้อ → ไม่ผูกรุ่น
        if (BCTX && !c.cb.magOnly) { c.warn = c.warn || []; brandOne(c.cb, c.cb.type, c.cb.poles || (c.phases === 3 ? 3 : 1), Ik, c.brOv, { ev: c.ev, snap: c.brSnap }, (w) => c.warn.push(w), c.steps); }
      });
      if (pr.layout) pr.layout.slots.forEach((s) => { if (s && s.auto) { s.cb.ic = ic; if (BCTX) brandOne(s.cb, 'MCB', s.cb.poles || 1, Ik, null, null, () => {}, null); } });
      if (Ik > IC_MAX && !warnIK100.has(pr.board.id)) { warnIK100.add(pr.board.id); warnings.push(`${pr.board.name}: Ik" ${fmt(Ik, 1)} kA เกิน IC สูงสุดในตาราง (${IC_MAX} kA) — ต้องใช้ CB จำกัดกระแส/เพิ่มอิมพีแดนซ์`); }
    };
    const safe = (label, fn) => { try { fn(); } catch (e) { warnings.push(`ข้อผิดพลาดภายใน (${label}): ${e && e.message ? e.message : e}`); } };
    mdbRes.sc = scMDB; mdbRes.Z = Zsrc; mdbRes.vdUp = service.mainFeeder.vd ? service.mainFeeder.vd.pct : 0;
    mdbRes.feeder = null;
    // สายป้อนแผงลูก: ออกแบบ CB/สายของทุกแผงก่อน (ไม่ต้องรู้ Z/Ik) แล้วค่อยคำนวณ Z/Ik/IC/vdUp บนลงล่างจากสายแม่ที่ final (designKid/down)
    //   1) ฐาน (บนลงล่าง) : ประสานการเลือกตัดกับวงจรย่อยของแผงตัวเอง ไม่ดันเกิน CB สายป้อนของแม่ (พฤติกรรมเดิมเมื่อไม่มีการประสานสายป้อนลูก)
    //   2) meta.coordinateKidFeeders (ลูกก่อนแม่) : เมนแม่ ≥ max(Ic, min(1.6 × max(CB วงจรย่อย, CB สายป้อนลูก), CB ประธาน)) ; ลูกถูกออกแบบเสร็จก่อนแม่เสมอ จึงเรียงต่อกันขึ้นไปได้หลายชั้น
    //      ข้ามแผงที่มีมอเตอร์ในแผงหรือใต้แผง (เพดานสมการ 8-5 : ICB,F ≤ CB มอเตอร์ + กระแสโหลดอื่น) และเมื่อปิด autoSelectivity
    const kidPlan = new Map();
    const feederOf = (pl, maxKidFeederAt, parentAt) => designFeeder({
      name: pl.kb.name, phases: pl.ph, demandVA: pl.kr.demand, nonMotorVA: pl.kr.nonMotorVA, motors: pl.motorsDirect,
      length: pl.rl.length, riser: pl.rl.riser, spec: pl.spec, maxPhaseVA: pl.maxPhaseVA, useMaxPhase: pl.useMaxPhase, bigIm: pl.kr.bigIm,
      phaseReason: pl.phaseReason, nonlinear: !!pl.kb.nonlinear, vdLimit: meta.vdFeeder,
      maxBranchAt: pl.maxBranchAt, maxKidFeederAt, autoSelectivity: meta.autoSelectivity !== false, parentAt,
      atList: BCTX ? BCTX.list('MCCB', pl.ph === 3 ? 3 : 2, pl.kb.brOv) : null
    }, meta);
    const planKidFeeders = () => {
      for (const id of pre) {
        if (id === mdb.id) continue;
        const kb = byId.get(id), kr = panelRes.get(id), pr = panelRes.get(parentOf.get(id) || mdb.id);   // แผงกำพร้า: สมมติรับไฟจาก MDB
        safe(`วงจรย่อย ${kb.name}`, () => kr.circuits.forEach((c) => designBranch(c, meta, 0)));
        // มอเตอร์ที่อยู่ในแผงนั้นโดยตรง (แผงลูกของลูกถูกรวมเป็นกระแส)
        // CB ที่ผู้ออกแบบกำหนดเองใหญ่กว่าที่ระบบเลือกจะไม่ไปขยายเพดาน CB สายป้อน (สมการ 8-5) — ใช้ค่าที่เล็กกว่า
        const motorsDirect = kr.circuits.filter((c) => c.motor && c.cb).map((c) => ({ im: c.motor.im, cbAt: c.cbAuto ? Math.min(c.cb.at, c.cbAuto) : c.cb.at }));
        const ratio = kr.connected ? kr.demand / kr.connected : 1;
        const ph = kb.phases === 3 ? 3 : 1;
        // CB วงจรย่อยใหญ่สุด (ไม่นับ SPARE) — ใช้ประสานการเลือกตัดกับ CB สายป้อน ; แผงที่มีมอเตอร์ถูกจำกัดด้วยเพดานสมการ 8-5 อยู่แล้ว
        const maxBranchAt = kr.circuits.reduce((m, c) => (c.cb && c.cat !== 'spare' && !c.firePump && c.cb.at > m ? c.cb.at : m), 0);
        // โหลดไม่สมดุลมาก (เช่น EV 7.4 kW เฟสเดียวในแผง 3 เฟส): คิดจากกระแสเฟสเฉลี่ยจะได้ CB/สายเล็กเกินกระแสจริงของเฟสนั้น
        const phAvg = (kr.phaseVA[0] + kr.phaseVA[1] + kr.phaseVA[2]) / 3;
        const unbal = ph === 3 && phAvg > 0 ? Math.max(...kr.phaseVA) / phAvg - 1 : 0;
        const pl = {
          kb, kr, ph, motorsDirect, maxBranchAt, rl: riserOf(kb, pr.board, meta),
          spec: kb.feederSpec && typeof kb.feederSpec === 'object' ? Object.assign({}, meta.feeder, kb.feederSpec) : meta.feeder,
          maxPhaseVA: Math.max(...kr.phaseVA) * ratio, useMaxPhase: !!meta.useMaxPhase || kr.has1PKids || unbal > UNBAL_AUTO,
          phaseReason: kr.has1PKids ? 'มีแผง 1 เฟสต่ออยู่ โหลดแต่ละเฟสไม่เท่ากัน' : unbal > UNBAL_AUTO ? `เฟสสูงสุดเกินค่าเฉลี่ย ${fmt(unbal * 100, 0)}% (> ${UNBAL_AUTO * 100}%) — ใช้เฟสสูงสุดอัตโนมัติ` : 'ตามผลจัดวงจรลงช่องจริง',
          parentAt: kb.tap === 'ahead_of_main' ? 0 : pr.feeder ? pr.feeder.cb.at : (service.mainCB ? service.mainCB.at : 0)   // แผง tap อยู่ก่อน CB ประธาน : ไม่มีเพดาน
        };
        kidPlan.set(id, pl);
        safe(`สายป้อน ${kb.name}`, () => { kr.feeder = feederOf(pl, 0, pl.parentAt); });
      }
    };
    const coordinateKidFeeders = () => {
      // เพดานของแต่ละแผง = ขยับขึ้นได้ถึงแม่ที่ขยับตามได้ต่อเนื่องจนถึง CB ประธาน ; แม่ที่ขยับไม่ได้ (มีมอเตอร์ใต้แผง) ล็อกเพดานไว้ที่ CB สายป้อนของแม่เอง (ลูกต้องไม่ใหญ่กว่าแม่)
      const top = service.mainCB ? service.mainCB.at : 0;
      const fixed = (pl) => !pl || !pl.kr.feeder || pl.kr.bigIm > 0;
      const ceil = new Map();
      for (const id of pre) {
        if (id === mdb.id) continue;
        const q = parentOf.get(id) || mdb.id, ql = kidPlan.get(q);
        ceil.set(id, byId.get(id).tap === 'ahead_of_main' ? 0 : q === mdb.id ? top : fixed(ql) ? (ql && ql.kr.feeder ? ql.kr.feeder.cb.at : top) : ceil.get(q));
      }
      for (const id of order) {   // ลูกก่อนแม่
        const pl = kidPlan.get(id);
        if (fixed(pl)) continue;
        const maxKidFeederAt = children(id).reduce((m, k) => { const f = panelRes.get(k.id).feeder; return f && f.cb && f.cb.at > m ? f.cb.at : m; }, 0);
        const needUp = maxKidFeederAt > pl.maxBranchAt || maxKidFeederAt > pl.kr.feeder.cb.at;
        if (!needUp) continue;
        safe(`ประสานสายป้อนแผงลูก ${pl.kb.name}`, () => {
          const base = pl.kr.feeder, nf = feederOf(pl, maxKidFeederAt, Math.max(pl.parentAt, ceil.get(id)));
          if (nf.coord) nf.coord.base = { size: base.size, sets: base.sets, at: base.cb.at };   // สายก่อนประสาน — ใช้บอกผลต่อ Ik" ใน designKid
          pl.kr.feeder = nf;
        });
      }
    };
    const designKid = (kb, pr) => {
      const pl = kidPlan.get(kb.id), kr = pl.kr;
      if (kr.feeder) safe(`สายป้อน ${kb.name}`, () => {
        const ic = Math.max(meta.mccbICMin || 0, icStd(pr.sc.Ik));
        kr.feeder.cb.ic = ic;
        if (BCTX) brandOne(kr.feeder.cb, 'MCCB', pl.ph === 3 ? 3 : 2, pr.sc.Ik, kb.brOv, { snap: kr.feeder.cb.brSnap }, (w) => kr.feeder.warn.push(w), kr.feeder.steps);
        const zc2 = cableZ(kr.feeder.size, pl.rl.length, kr.feeder.sets);
        kr.Z = { R: pr.Z.R + zc2.R, X: pr.Z.X + zc2.X };
        kr.sc = iscFrom(kr.Z);
        kr.vdUp = pr.vdUp + kr.feeder.vd.pct;
        kr.feeder.steps.push({ t: 'IC ของ CB สายป้อน', f: `Ik" ที่ ${pr.board.name} = ${fmt(pr.sc.Ik, 2)} kA → IC ≥ ${ic} kA` });
        if (kb.tap === 'ahead_of_main') kr.feeder.steps.push({ t: 'Tap ahead of main (NFPA 20)', f: `ต่อจากสายประธานก่อน CB ประธาน ${service.mainCB.at} AT (ไม่ผ่านเมนสวิตช์) : Ik" ที่จุดต่อ = Ik" ที่ ${pr.board.name} ด้านเข้า = ${fmt(pr.sc.Ik, 2)} kA ; CB สายป้อนไม่ถูกจำกัดด้วย CB ประธาน และไม่คิดเลือกตัดกับ CB ประธาน`, ref: 'NFPA 20 บทที่ 9 (ตีความตามโครงการ/การไฟฟ้า)' });
        kr.feeder.steps.push({ t: 'ลัดวงจรที่ปลายสาย', f: `Ik" ที่ ${kb.name} = ${fmt(kr.sc.Ik, 2)} kA (สาย ${kr.feeder.size} mm² ยาว ${fmt(pl.rl.length, 1)} m)`, ref: 'ตาราง 10.2' });
        // สายถูกขยับตามการประสานสายป้อนลูก → สายแม่ใหญ่ขึ้น Z ลดลง Ik" สูงขึ้น (ผลต่อ IC ของ CB ปลายทาง) — แสดงเทียบค่าถ้าไม่ประสานให้ผู้ตรวจเห็นต้นทุน
        const cd = kr.feeder.coord;
        if (cd && cd.base && (cd.base.size !== kr.feeder.size || cd.base.sets !== kr.feeder.sets)) {
          const zb = cableZ(cd.base.size, pl.rl.length, cd.base.sets), ikBase = iscFrom({ R: pr.Z.R + zb.R, X: pr.Z.X + zb.X }).Ik;
          const txt = (z, n) => `${n > 1 ? n + '×' : ''}${z}`;
          kr.feeder.steps.push({ t: 'ผลต่อกระแสลัดวงจร', f: `สาย ${txt(cd.base.size, cd.base.sets)} → ${txt(kr.feeder.size, kr.feeder.sets)} mm² ตามเมนที่ขยับ : Ik" ที่ ${kb.name} = ${fmt(kr.sc.Ik, 2)} kA (ถ้าไม่ประสานสายป้อนลูก ≈ ${fmt(ikBase, 2)} kA) — Ik" ของแผงนี้และแผงลูกสูงขึ้น ตรวจ IC ของ CB ปลายทาง`, ref: 'IEC 60909, ตาราง 10.2' });
        }
      });
      if (!kr.sc) { kr.Z = pr.Z; kr.sc = pr.sc; kr.vdUp = pr.vdUp; }
      down(kb);
    };
    function down(b) {
      const pr = panelRes.get(b.id);
      if (b === mdb) {
        safe('วงจรย่อย MDB', () => pr.circuits.forEach((c) => designBranch(c, meta, 0)));
        planKidFeeders();
        if (meta.coordinateKidFeeders !== false && meta.autoSelectivity !== false) coordinateKidFeeders();
      }
      finishIC(pr, pr.sc.Ik);
      for (const kid of children(b.id)) designKid(kid, pr);
      if (b === mdb) for (const r of roots) if (r !== mdb) designKid(r, pr); // แผงกำพร้า: ออกแบบโดยสมมติรับไฟจาก MDB
    }
    down(mdb);

    /* ---------- สรุปแต่ละแผง ---------- */
    const panelsOut = [];
    for (const id of order) {
      const pr = panelRes.get(id);
      const b = pr.board;
      const isLP = b.kind === 'LP';
      const layout = pr.layout;
      const phaseVA = pr.phaseVA, unbalance = pr.unbalance;
      if (b.phases === 3 && unbalance > 20 && pr.connected > 0) {
        const hint = pr.bal && b.balance !== 'deep' && pr.bal.deep < unbalance - 0.05 ? ` — โหมดจัดเฟสแบบ Deep ลดได้เหลือ ${fmt(pr.bal.deep, 1)}%` : '';
        warnings.push(`${b.name}: โหลดไม่สมดุล ${fmt(unbalance, 1)}% (ควรไม่เกิน 20%)${hint}`);
      }
      // ปั๊มดับเพลิงต้องต่อเข้าตู้/แผงฉุกเฉิน (แผงนี้หรือแผงแม่ตัวใดตัวหนึ่งเป็นแผงฉุกเฉิน)
      if (pr.circuits.some((c) => c.firePump)) {
        let onEm = false;
        for (let x = b; x && !onEm; x = byId.get(parentOf.get(x.id))) onEm = !!x.emergency;
        if (!onEm) pr.circuits.filter((c) => c.firePump).forEach((c) => c.warn.push('ปั๊มดับเพลิงต้องต่อเข้าตู้/แผงฉุกเฉิน (รับไฟผ่าน ATS จากเครื่องกำเนิดไฟฟ้า) — ตั้งแผงนี้หรือแผงแม่เป็น "แผงฉุกเฉิน"'));
      }
      pr.circuits.forEach((c) => (c.warn || []).forEach((w) => warnings.push(`${b.name} · ${c.desc}: ${w}`)));
      if (pr.feeder) pr.feeder.warn.forEach((w) => warnings.push(`${b.name}: ${w}`));
      const vdTotalMax = pr.vdUp + Math.max(0, ...pr.circuits.map((c) => (c.vd ? c.vd.pct : 0)));
      if (vdTotalMax > meta.vdTotal) warnings.push(`${b.name}: แรงดันตกรวมถึงปลายวงจร ${fmt(vdTotalMax)}% เกิน ${meta.vdTotal}%`);

      // main CB / busbar ของแผง
      const feederAt = pr.feeder ? pr.feeder.cb.at : (id === mdb.id ? service.mainCB.at : 0);
      const mainAf = pr.feeder ? (pr.feeder.cb.af || pr.feeder.cb.at) : (service.mainCB.af || service.mainCB.at);
      const bb = pickUp(isLP ? [100, 200, 250].concat(D.BUSBAR_A.filter((x) => x > 250)) : D.BUSBAR_A, mainAf);
      const busbar = bb.at;
      if (bb.over) warnings.push(`${b.name}: บัสบาร์ต้องการ ≥ ${fmt(mainAf, 0)} A เกินตารางสูงสุด ${bb.at} A — ต้องออกแบบบัสบาร์พิเศษ/แยกแผง`);
      const balance = pr.bal ? { mode: b.balance === 'deep' ? 'deep' : 'auto', unbalance, autoUnbalance: pr.bal.auto, deepUnbalance: pr.bal.deep } : null;
      panelsOut.push({
        id, board: b, isLP, circuits: pr.circuits, layout, phaseVA, phaseKidVA: pr.phaseKidVA, unbalance, balance,
        feedPhase: pr.feedPhase === undefined ? null : pr.feedPhase,
        connected: pr.connected, demand: pr.demand, demandLocal: pr.demandLocal, kids: pr.kids, condo: pr.condo || null,
        feeder: pr.feeder, sc: pr.sc, vdUp: pr.vdUp, vdTotalMax, busbar, busbarOver: bb.over,
        main: { at: feederAt, af: mainAf, ic: pr.feeder ? pr.feeder.cb.ic : (id === mdb.id ? service.mainCB.ic : null) }
      });
    }

    safe('selectivity', () => checkSelectivity(panelsOut, service, mdb.id, warnings, meta));
    panelsOut.sort((a, b) => (pre.indexOf(a.id) + 1 || 999) - (pre.indexOf(b.id) + 1 || 999));
    // ระบบไฟฟ้าฉุกเฉิน: แผงฉุกเฉินชั้นบนสุด (แม่ไม่ใช่แผงฉุกเฉิน) + มอเตอร์ทุกตัวในแผงลูก
    service.generator = null;
    safe('เครื่องกำเนิดไฟฟ้า', () => {
      const emOf = (b) => { for (let pid = parentOf.get(b.id); pid; pid = parentOf.get(pid)) if (byId.get(pid).emergency) return false; return true; };
      const em = boards.filter((b) => b.emergency && emOf(b)).map((b) => {
        const motors = [];
        preOrder(b).forEach((id) => panelRes.get(id).circuits.forEach((c) => { if (c.motor) motors.push(c); }));
        return { id: b.id, name: b.name, phases: b.phases, demandVA: panelRes.get(b.id).demand, motors };
      });
      service.generator = designGenerator(em, meta, warnings);
    });
    const bom = buildBOM(panelsOut, service, meta);
    // Ik" > IC ของ CB (เบรกเกอร์ระเบิด — ความปลอดภัยต่อชีวิต): ตรวจจากผลจริงของ CB ทุกตัว ณ บัสที่ติดตั้ง ; UI ใช้ขับแถบเตือนสีแดง
    const icViolations = [];
    // ความร้อนลัดวงจรของสายป้อน (ทางเลือก): Smin = Ik" × 1000 × √t / k เทียบหน้าตัดรวมของสายเฟสทุกชุด
    const adiabaticOf = (p, ik) => {
      const f = p.feeder, A = D.ADIABATIC, k = A.k[(D.CABLES[f.cable] || {}).insul] || A.k.PVC;
      const smin = ik * 1000 * Math.sqrt(A.t) / k, S = f.size * f.sets, ok = S + 1e-9 >= smin;
      f.adia = { smin: r2(smin), k, t: A.t, ik: r2(ik), S, ok };
      f.steps.push({ t: 'ตรวจความร้อนลัดวงจร (Adiabatic)', f: `Smin = ${fmt(ik, 2)} kA × 1000 × √${A.t} / ${k} = ${fmt(smin, 1)} mm² ${ok ? '≤' : '>'} ${f.sets > 1 ? f.sets + '×' : ''}${f.size} = ${fmt(S, 0)} mm²`, ref: 'IEC 60364-4-43' });
      if (!ok) { const w = `${p.board.name}: สายป้อน ${f.sets > 1 ? f.sets + '×' : ''}${f.size} mm² ไม่ผ่านความร้อนลัดวงจรแบบ Adiabatic (ต้อง ≥ ${fmt(smin, 1)} mm² ที่ Ik" ${fmt(ik, 2)} kA, t = ${A.t} s) — ตรวจ I²t ผ่านตัวจริงของ CB หรือเพิ่มขนาดสาย`; f.warn.push(w); warnings.push(w); }
    };
    safe('ตรวจ Ik/IC', () => {
      const ikOf = new Map(panelsOut.map((p) => [p.id, num(p.sc && p.sc.Ik, 0)]));
      const chk = (kind, where, cb, ik, label) => { if (cb && cb.ic > 0 && ik > cb.ic + 1e-9) icViolations.push({ kind, where, cb: label || cb.label || `${cb.at}A`, at: cb.at, ic: cb.ic, ik: r2(ik) }); };
      chk('main', mdb.name, service.mainCB, num(service.scMDB && service.scMDB.Ik, 0));
      for (const p of panelsOut) {
        const up = parentOf.get(p.id);
        if (p.feeder && up) chk('feeder', byId.get(up).name, p.feeder.cb, ikOf.get(up), `${p.board.name}: ${p.feeder.cb.label}`);
        if (meta.adiabaticCheck === true && p.feeder && up) adiabaticOf(p, ikOf.get(up));
        p.circuits.forEach((c) => { if (c.cat !== 'spare') chk('branch', p.board.name, c.cb, ikOf.get(p.id), c.desc); });
      }
    });
    return { meta, panels: panelsOut, service, warnings: [...new Set(warnings)], icViolations, bom, totals: { connected: mdbRes.connected, demand: totalDemand } };
  }

  // Selectivity (การเลือกตัด) — ประเมินเบื้องต้นแบบกฎ D.SELECTIVITY (ไม่มีเส้นโค้งผู้ผลิต)
  // ต้นทาง = CB เข้าแผง (MDB = CB ประธาน) ; ปลายทาง = CB วงจรย่อย (จัดกลุ่มตามขนาด) + CB สายป้อนแผงลูก
  // Ik ที่ใช้ = Ik" ที่บัสของแผงต้นทาง (ลัดวงจรหลัง CB ปลายทางทันที = กรณีแย่สุด)
  // ผล: panel.selectivity = [{ up, down, ratio, limitKA, ikKA, status: 'total'|'partial'|'none', note, count, marginal }]
  // Selective Coordination Guard: วงจรย่อยที่ In ต้นทาง/ปลายทาง < เกณฑ์ → แนะนำ CB ย่อยขนาดใหญ่สุดที่ ≤ In ต้นทาง / เกณฑ์ และยังรับกระแสออกแบบได้
  // (จากขนาดที่ยี่ห้อ/รุ่นนั้นมีขายเมื่อเลือกยี่ห้อ) ; ไม่มีขนาดที่ได้ → แนะนำขยายเมนแผงเป็นขนาดมาตรฐานถัดไปที่ ≥ CB ย่อยเล็กสุดที่ใช้ได้ × เกณฑ์
  const ratioTxt = (x) => String(Math.round(x * 100) / 100);
  function guardAdvice(g, up, p, warnings) {
    const c = g.rep, rMin = g.rMin;
    const need = Math.max(g.maxId, g.minCB);
    const sizes = (c && brandATFor(c, c.cb.at)) || D.MCB_AT;
    const fit = sizes.filter((a) => a + 1e-9 >= need && a * rMin <= up.at + 1e-9);
    const at = fit.length ? Math.max(...fit) : null;
    let enlargeMain = null;
    if (at === null) { const s0 = pickUp(sizes, need).at; const pk = pickUp(cbList('MCCB'), s0 * rMin); enlargeMain = pk.at; }
    g.rec = { at, enlargeMain };
    const head = `คำเตือนการเลือกตัด: วงจรย่อยใช้ CB ${g.rep.cb.at} A เทียบกับเมนแผง ${up.at} A (อัตราส่วน ${ratioTxt(g.ratio)} < ${ratioTxt(rMin)}) — หากเกิดลัดวงจร เมนแผงอาจตัดพร้อมกัน`;
    g.warn = at !== null ? `${head} แนะนำให้ใช้ ${at} A` : `${head} ไม่มีขนาด CB ย่อยที่รับโหลดได้และเลือกตัดได้ — แนะนำให้ขยายเมนแผงเป็น ${enlargeMain} A`;
    warnings.push(`${p.board.name}: ${g.warn}${g.count > 1 ? ` (${g.count} วงจร)` : ''}`);
  }
  function checkSelectivity(panels, service, mdbId, warnings, meta) {
    const S = D.SELECTIVITY;
    const genKA = (cb) => { const k = S.instMult[cb.type] === undefined ? S.instMult.MCCB : S.instMult[cb.type]; return k == null ? S.acbIcwKA : k * cb.at / 1000; };
    const cbName = (cb) => (cb.bm ? `${cb.at}A ${cb.bm.brandShort} ${cb.bm.model}` : `${cb.at}A ${cb.type || ''}`.trim());
    const byId = new Map(panels.map((p) => [p.id, p]));
    const parentOf = (q) => panels.find((p) => (p.kids || []).includes(q.id)) || byId.get(mdbId);
    // ยี่ห้อ: CB ต้นทางมีข้อมูลรุ่น → ค่าตัดทันทีจริง (Ii_Default_Mult × In, ไม่ต่ำกว่า Min_Ii_Amp_Num), trip อิเล็กทรอนิกส์ใช้อัตราส่วน 1.25 (TM 1.6),
    // MCB ปลายทางยี่ห้อเดียวกัน → เลือกตัดได้ถึง Max_Selectivity_vs_MCB_kA (ค่าสูงสุดโดยประมาณ) ; ยี่ห้อต่างกัน → เกณฑ์ทั่วไป
    const pair = (up, down, ikKA) => {
      const ub = up.bm, db = down.bm;
      const mixed = !!(ub && db && ub.brandShort !== db.brandShort);
      const useB = !!ub && !mixed;
      const rMin = useB && ub.electronic ? 1.25 : S.ratioMin, rTot = useB ? rMin : S.ratioTotal;
      const ratio = up.at / down.at;
      let lim = useB ? BR.instKA(up) : genKA(up), byMCB = false;
      if (useB && db && db.type !== 'MCCB' && ub.selMCB > lim) { lim = ub.selMCB; byMCB = true; }
      const limTxt = byMCB ? `ขีดจำกัด selectivity กับ MCB ${ub.brandShort} ≈ ${fmt(lim, 2)} kA` : `ค่าตัดทันทีต้นทาง ≈ ${fmt(lim, 2)} kA`;
      const o = { up: cbName(up), down: cbName(down), ratio, rMin, limitKA: null, ikKA, status: 'total', note: '', marginal: false };
      if (BCTX) { o.src = useB ? BR.SRC_BRAND : BR.SRC_GENERIC; if (mixed) { o.mixed = true; o.downBrand = db.brandShort; } }
      if (!(ratio >= rMin)) { o.status = 'none'; o.note = `In ต้นทาง/ปลายทาง = ${fmt(ratio, 2)} < ${rMin} — CB ต้นทางอาจตัดพร้อมกัน`; }
      else if (ikKA > lim) { o.status = 'partial'; o.limitKA = lim; o.note = `Ik" ${fmt(ikKA, 2)} kA > ${limTxt} — เลือกตัดได้ถึง ${fmt(lim, 2)} kA`; }
      else if (ratio < rTot) { o.status = 'partial'; o.marginal = true; o.note = `In ต้นทาง/ปลายทาง = ${fmt(ratio, 2)} < ${rTot} — เลือกตัดได้ในช่วงโหลดเกิน ช่วงลัดวงจรไม่รับประกัน`; }
      else { o.limitKA = lim; o.note = `Ik" ${fmt(ikKA, 2)} kA ≤ ${limTxt}`; }
      return o;
    };
    const outs = new Map(panels.map((p) => [p.id, []]));
    for (const q of panels) if (q.feeder && q.feeder.cb && q.id !== mdbId && q.board.tap !== 'ahead_of_main') { const p = parentOf(q); if (p && p !== q) outs.get(p.id).push(q); }   // แผง tap ahead of main อยู่ก่อน CB ประธาน : ไม่เป็นคู่เลือกตัดกับ CB ประธาน
    for (const p of panels) {
      const up = p.feeder ? p.feeder.cb : (p.id === mdbId ? service.mainCB : null);
      p.selectivity = [];
      if (!up || !(up.at > 0)) continue;
      const ikKA = num(p.sc && p.sc.Ik, 0);
      const groups = new Map();
      for (const c of p.circuits) {
        if (!c.cb || !(c.cb.at > 0) || c.cat === 'spare' || c.firePump) continue;   // ปั๊มดับเพลิง: CB Mag-only ห้ามตัดก่อนเวลา — ไม่ประสานเลือกตัดแบบวงจรทั่วไป
        const k = `${c.cb.type}|${c.cb.at}${c.cb.bm ? '|' + c.cb.bm.id : ''}`;
        // กระแสออกแบบสูงสุดในกลุ่ม (มอเตอร์ = 1.25 Im) และ CB ขั้นต่ำตามชนิดโหลด — ใช้แนะนำขนาดที่ทั้งรับโหลดได้และเลือกตัดได้
        const Id = c.motor ? 1.25 * num(c.motor.im, 0) : num(c.Id, c.I || 0);
        const minCB = c.motor ? 0 : c.minCB > 0 ? c.minCB : c.cat === 'light' ? num(meta && meta.cbLight, 16) : c.cat === 'rec' ? num(meta && meta.cbRec, 16) : 16;
        const g = groups.get(k);
        if (g) { g.count++; g.maxId = Math.max(g.maxId, Id); g.minCB = Math.max(g.minCB, minCB); }
        else groups.set(k, Object.assign(pair(up, c.cb, ikKA), { count: 1, kind: 'branch', maxId: Id, minCB, rep: c }));
      }
      for (const g of groups.values()) { if (g.status === 'none') guardAdvice(g, up, p, warnings); delete g.rep; }
      const list = [...groups.values()].sort((a, b) => a.ratio - b.ratio);
      for (const q of outs.get(p.id)) list.push(Object.assign(pair(up, q.feeder.cb, ikKA), { count: 1, kind: 'feeder', down: `${cbName(q.feeder.cb)} → ${q.board.name}`, to: q.id }));
      p.selectivity = list;
      // วงจรย่อยที่ไม่เลือกตัดมีคำเตือนรายกลุ่มพร้อมขนาดแนะนำแล้ว (guardAdvice) — บรรทัดสรุปนับเฉพาะสายป้อนที่ไม่เลือกตัด
      const nNone = list.filter((s) => s.status === 'none' && s.kind !== 'branch').reduce((s, x) => s + x.count, 0);
      const nPart = list.filter((s) => s.status === 'partial').reduce((s, x) => s + x.count, 0);
      const allB = list.length && list.every((s) => s.src === (BR && BR.SRC_BRAND));
      if (nNone || nPart) warnings.push(`${p.board.name}: selectivity กับ ${cbName(up)} ต้นทาง — ${[nNone ? `ไม่เลือกตัด ${nNone} วงจร` : '', nPart ? `เลือกตัดบางส่วน ${nPart} วงจร` : ''].filter(Boolean).join(', ')} (${allB ? `${BR.SRC_BRAND}` : 'ประเมินเบื้องต้น — ยืนยันด้วยตาราง selectivity ของผู้ผลิต'})`);
      const mix = list.filter((s) => s.mixed);
      if (mix.length) warnings.push(`${p.board.name}: ยี่ห้อ CB ต้นทาง (${up.bm.brandShort}) ต่างจากปลายทาง ${mix.reduce((s, x) => s + x.count, 0)} วงจร (${[...new Set(mix.map((s) => s.downBrand))].join(', ')}) — selectivity ใช้เกณฑ์ทั่วไป ตารางผู้ผลิตใช้ได้เฉพาะยี่ห้อเดียวกัน`);
    }
  }

  /* ===================== ระบบไฟฟ้าฉุกเฉิน: เครื่องกำเนิดไฟฟ้า + ATS ===================== */
  // em = [{ id, name, phases, demandVA, motors:[วงจรมอเตอร์] }] แผงฉุกเฉินชั้นบนสุด (ดีมานด์รวมแผงลูกแล้ว) ; ไม่มีแผงฉุกเฉิน → null
  // ค่าคงที่ทั้งหมดอยู่ใน D.GEN — เป็นสมมติฐาน (เอกสาร วสท. ที่อ้างอิงไม่มีหัวข้อเครื่องกำเนิดไฟฟ้า)
  function designGenerator(em, meta, warnings) {
    if (!em.length) {
      if (meta.buildingType === 'hospital' || meta.buildingType === 'hotel') warnings.push(`ข้อมูล: ${meta.buildingType === 'hospital' ? 'โรงพยาบาล' : 'โรงแรม'}ต้องมีระบบไฟฟ้าฉุกเฉิน (ไฟทางหนีไฟ ปั๊มดับเพลิง ลิฟต์ดับเพลิง${meta.buildingType === 'hospital' ? ' ห้องผ่าตัด/ICU' : ''}) — ยังไม่ได้ตั้งแผงใดเป็น "แผงฉุกเฉิน (รับไฟผ่าน ATS)" จึงยังไม่คำนวณเครื่องกำเนิดไฟฟ้า`);
      return null;
    }
    const G = D.GEN, steps = [], warn = [];
    const ref = 'สมมติฐาน (ไม่มีในเอกสาร วสท.)';
    const threeP = em.some((e) => e.phases === 3);
    const Vf = threeP ? SQ3 * V3 : V1;
    const demandVA = em.reduce((s, e) => s + e.demandVA, 0);
    const demandKVA = demandVA / 1000;
    const I = demandVA / Vf;
    steps.push({ t: 'โหลดฉุกเฉิน', f: `${em.map((e) => `${e.name} ${fmt(e.demandVA / 1000, 2)} kVA`).join(' + ')} = ${fmt(demandKVA, 2)} kVA → I = ${fmt(demandKVA, 2)}k / (${threeP ? '√3 × 400' : '230'}) = ${fmt(I)} A`, ref: 'ดีมานด์ของแผงฉุกเฉิน (รวมแผงลูก)' });

    // ATS: ≥ 1.25 × I ; 3 เฟส = 4 ขั้ว (สลับนิวทรัลด้วย), 1 เฟส = 2 ขั้ว
    const poles = threeP ? 4 : 2;
    const atsOf = (Ireq) => { const pk = pickUp(D.ATS_AT, Ireq * G.atsFactor); return { at: pk.at, over: pk.over, poles, I: Ireq, label: `ATS ${pk.at}A ${poles}P` }; };
    const ats = atsOf(I);
    steps.push({ t: 'ATS', f: `${G.atsFactor} × ${fmt(I)} = ${fmt(I * G.atsFactor)} A → ${ats.label}${ats.over ? ' (เกินตาราง ใช้ขนาดสูงสุด)' : ''}`, ref });
    if (ats.over) warn.push(`ATS ต้องการ ≥ ${fmt(I * G.atsFactor, 0)} A เกินพิกัดมาตรฐานสูงสุด ${ats.at} A — แบ่งโหลดฉุกเฉินเป็นหลายชุด ATS`);
    const panels = em.map((e) => { const Ie = e.demandVA / (e.phases === 3 ? SQ3 * V3 : V1); return { id: e.id, name: e.name, demandKVA: e.demandVA / 1000, I: Ie, ats: atsOf(Ie) }; });
    if (panels.length > 1) steps.push({ t: 'ATS แยกแต่ละแผง', f: panels.map((p) => `${p.name}: ${G.atsFactor} × ${fmt(p.I)} A → ${p.ats.label}`).join(' ; '), ref });

    // มอเตอร์ที่เริ่มเดินแล้วกินกำลังมากที่สุด (DOL 6×Im, Y-Δ 2×Im, ลิฟต์/บันไดเลื่อนสำเร็จรูป 2×Im)
    let big = null;
    em.forEach((e) => e.motors.forEach((c) => {
      const kind = c.motor.packaged ? 'packaged' : (c.motor.start === 'YD' ? 'YD' : 'DOL');
      const mult = G.start[kind];
      const v = c.phases === 3 ? SQ3 * V3 : V1;
      const startKVA = mult * c.motor.im * v / 1000;
      if (!big || startKVA > big.startKVA) big = { desc: c.desc, kind, mult, im: c.motor.im, phases: c.phases, startKVA, runKVA: c.va / 1000, panel: e.name };
    }));
    const kindTh = { DOL: 'DOL', YD: 'Y-Δ', packaged: 'VVVF/สำเร็จรูป' };
    const c1 = demandKVA / G.loading;
    steps.push({ t: 'เกณฑ์ 1: โหลดต่อเนื่อง', f: `${fmt(demandKVA, 2)} / ${G.loading} = ${fmt(c1, 2)} kVA (ใช้งานไม่เกิน ${G.loading * 100}% ของพิกัด)`, ref });
    let c2 = 0, c3 = 0;
    if (big) {
      c2 = Math.max(0, demandKVA - big.runKVA) + big.startKVA;
      c3 = big.startKVA * G.xd * (1 - G.dip) / G.dip;
      steps.push({ t: 'มอเตอร์ที่กระแสเริ่มเดินสูงสุด', f: `${big.desc} (${big.panel}) ${kindTh[big.kind]}: ${big.mult} × ${fmt(big.im)} A × ${big.phases === 3 ? '√3 × 400' : '230'} = ${fmt(big.startKVA, 2)} kVA`, ref });
      steps.push({ t: 'เกณฑ์ 2: โหลดอื่นเดินอยู่ + เริ่มเดินมอเตอร์', f: `(${fmt(demandKVA, 2)} − ${fmt(big.runKVA, 2)}) + ${fmt(big.startKVA, 2)} = ${fmt(c2, 2)} kVA`, ref });
      steps.push({ t: 'เกณฑ์ 3: แรงดันตกขณะเริ่มเดิน', f: `ΔV = Xd"·Sm / (Sg + Xd"·Sm) ≤ ${G.dip * 100}% → Sg ≥ ${fmt(big.startKVA, 2)} × ${G.xd} × (1 − ${G.dip}) / ${G.dip} = ${fmt(c3, 2)} kVA (Xd" = ${G.xd} pu)`, ref });
    } else steps.push({ t: 'มอเตอร์', f: 'ไม่มีมอเตอร์ในแผงฉุกเฉิน — ไม่ต้องตรวจกระแสเริ่มเดิน' });
    const base = Math.max(c1, c2, c3);
    const growth = meta.growth || 0;
    const need = base * (1 + growth / 100);
    const pk = pickUp(D.GEN_KVA, need);
    const kva = pk.at;
    steps.push({ t: 'เลือกเครื่องกำเนิดไฟฟ้า', f: `max(${fmt(c1, 1)}, ${fmt(c2, 1)}, ${fmt(c3, 1)}) = ${fmt(base, 2)} kVA${growth ? ` × (1 + ${growth}%) = ${fmt(need, 2)} kVA` : ''} → ${kva} kVA Standby (Prime ≈ ${fmt(kva * G.prime, 0)} kVA)${pk.over ? ' — เกินตาราง ใช้ขนาดสูงสุด' : ''}`, ref });
    if (pk.over) warn.push(`เครื่องกำเนิดไฟฟ้าต้องการ ≥ ${fmt(need, 0)} kVA เกินขนาดมาตรฐานสูงสุด ${kva} kVA — ใช้หลายเครื่องขนาน (synchronizing)`);
    const Ig = kva * 1000 / (SQ3 * V3);
    const cb = breaker(pickUp(cbList('MCCB'), Ig).at, 'MCCB');
    cb.ic = icStd(Ig / G.xd / 1000);
    steps.push({ t: 'CB ขาออกเครื่องกำเนิดไฟฟ้า', f: `Ig = ${kva}k / (√3 × 400) = ${fmt(Ig)} A → ${cb.label}; Ik ≈ Ig / Xd" = ${fmt(Ig / G.xd / 1000, 2)} kA → IC ≥ ${cb.ic} kA`, ref });
    warn.forEach((w) => warnings.push(w));
    return { kva, primeKVA: kva * G.prime, over: pk.over, need, demandKVA, I, startKVA: big ? big.startKVA : 0, bigMotor: big, criteria: { load: c1, start: c2, dip: c3 }, Ig, cb, ats, panels, phases: threeP ? 3 : 1, steps };
  }

  // สายประธานแรงต่ำ (หม้อแปลง/มิเตอร์ → MDB) ตามตัวอย่าง 7.3.2 ; opt.minSize = ขนาดต่ำสุดตามตารางมิเตอร์ (กฟภ. ตาราง 7.4)
  function designMain(at, meta, spec, opt) {
    opt = opt || {};
    const steps = [], warn = [];
    const minSize = Math.max(16, opt.minSize || 0);
    const maxS = Math.max(pos(meta.main.maxSize, 300), minSize);
    const MAXSETS = 10;
    const pickFor = (s) => pickConductor({ cable: spec.cable, method: spec.method, ncc: 3, Ireq: at / s, minSize, maxSize: maxS, meta, groups: s });
    let sets = 1, pick = pickFor(1);
    while (!pick.ok && sets < MAXSETS) { sets++; pick = pickFor(sets); }
    const capacity = pick.derated * sets;
    if (!pick.ok) warn.push(`สายประธาน ${sets}×${pick.size} mm² รับกระแสได้ ${fmt(capacity, 0)} A น้อยกว่า CB ${at} A แม้ขนานสูงสุด ${MAXSETS} ชุด — เพิ่มจำนวนระบบประธาน/ใช้บัสดักท์`);
    const g = Math.min(groundFor(at), pick.size);
    steps.push({ t: 'สายประธานแรงต่ำ', f: `CB ${at} AT แบ่ง ${sets} ชุด → ${fmt(at / sets)} A/ชุด, ÷ (Ft ${pick.ft.f} × Fg ${pick.fg.f}) = ${fmt(at / sets / (pick.ft.f * pick.fg.f))} A → ${pick.size} mm² (${pick.base} A)${opt.minSize ? `; ขนาดต่ำสุดตามตารางมิเตอร์ ${opt.minSize} mm²` : ''}${pick.ok ? '' : ' — รับกระแสไม่พอ'}`, ref: `${ampRef(spec.cable, spec.method)}, ${pick.fg.ref}${opt.minSize ? ', ตาราง 7.4' : ''}` });
    steps.push({ t: 'สายดิน', f: `CB ${at} AT → G ${g} mm²`, ref: 'ตาราง 4.2' });
    let raceway = '-';
    if (methodOf(spec.method).raceway === 'conduit') {
      const cd = pickConduit(spec.cable, [{ size: pick.size, count: 4 }, { size: g, count: 1 }]);
      raceway = cd.conduit ? `${sets}×${cd.conduit.inch}" ${spec.conduit}` : 'เกิน 6"';
      steps.push({ t: 'ท่อ', f: `ต่อชุด 4×${pick.size} + G${g}: ${fmt(cd.area, 0)} mm² → ${raceway}`, ref: 'ตาราง 5.2–5.3' });
    } else if (methodOf(spec.method).raceway === 'tray') raceway = 'Cable tray';
    return { sets, size: pick.size, ground: g, steps, raceway, cable: spec.cable, ok: pick.ok, capacity, warn, text: `${sets > 1 ? sets + '×' : ''}(4×${pick.size}) + G-${g} ${cableOf(spec.cable).label}` };
  }

  /* ===================== BOM ===================== */
  function buildBOM(panels, service, meta) {
    const cables = {}, conduits = {}, cbs = {}, boards = [];
    const addCable = (type, size, len) => { if (!size || !len) return; const k = `${type}|${size}`; cables[k] = (cables[k] || 0) + len; };
    const addConduit = (type, inch, len) => { if (!inch || inch === '-' || !len) return; const k = `${type}|${inch}`; conduits[k] = (conduits[k] || 0) + len; };
    const cbBrand = {};   // ยี่ห้อ/รุ่น (เฉพาะ CB ที่เลือกยี่ห้อ) → BOM จัดกลุ่มตามยี่ห้อ/รุ่น
    const addCB = (label, poles, ic, rcd, bm) => { const k = `${label}|${poles}P|${ic || '-'}kA${rcd ? '|RCBO 30mA' : ''}`; cbs[k] = (cbs[k] || 0) + 1; if (bm) cbBrand[k] = { brand: bm.brandShort, model: bm.model, ref: bm.ref }; };
    for (const p of panels) {
      for (const c of p.circuits) {
        if (!c.cb) continue;
        addCB(c.cb.type === 'MCB' ? (c.cb.bm ? `${c.cb.bm.type === 'RCBO' ? 'RCBO' : 'MCB'} ${c.cb.label}` : `MCB ${c.cb.at}A`) : `MCCB ${c.cb.label}`, c.cb.poles, c.cb.ic, c.cb.rcd, c.cb.bm);
        if (!c.cond) continue;
        const L = c.L * 1.1; // เผื่อ 10%
        addCable(c.cond.cable, c.cond.size, L * c.cond.n);
        if (c.cond.ground) addCable(c.cond.cable, c.cond.ground, L);
        addConduit(c.conduit.type, c.conduit.inch, L);
      }
      if (p.layout) p.layout.slots.forEach((s) => { if (s && s.auto) addCB(s.cb.bm ? `MCB ${s.cb.label}` : `MCB ${s.cb.at}A`, 1, s.cb.ic, false, s.cb.bm); });
      if (p.feeder) {
        const f = p.feeder, L = clamp(num(f.length != null ? f.length : p.board.feederLength, 0), 0, 1e5) * 1.1;   // f.length = ระยะราบ + ริเซอร์
        addCB(`MCCB ${f.cb.label}`, f.cb.poles, f.cb.ic, false, f.cb.bm);
        addCable(f.cable, f.size, L * f.sets * (p.board.phases === 3 ? 3 : 2));
        if (f.nSize) addCable(f.cable, f.nSize, L * f.sets);
        addCable(f.cable, f.ground, L * f.sets);
        if (f.racewayDetail && f.racewayDetail.conduit) addConduit(f.conduitType, f.racewayDetail.conduit.inch, L * f.sets);
      }
      boards.push({ name: p.board.name, kind: p.board.kind, ways: p.layout ? p.layout.ways : null, busbar: p.busbar, main: p.feeder ? p.feeder.cb.label : (service.mainCB ? service.mainCB.label : '') });
    }
    const svc1 = service.phases === 1;   // บ้าน 1 เฟส: CB ประธาน 2P, สายประธาน L+N
    if (service.mainCB) addCB(`${service.mainCB.type} ${service.mainCB.label}`, svc1 ? 2 : 3, service.mainCB.ic, false, service.mainCB.bm);
    if (service.mainFeeder) { const m = service.mainFeeder, L = meta.main.length * 1.1; addCable(m.cable, m.size, L * (svc1 ? 2 : 4) * m.sets); addCable(m.cable, m.ground, L * m.sets); }
    // ระบบไฟฟ้าฉุกเฉิน: เครื่องกำเนิดไฟฟ้า + CB ขาออก + ATS (แผงเดียว = ATS รวม, หลายแผง = ATS แยกแต่ละแผง)
    const equipment = [];
    const gen = service.generator;
    if (gen) {
      equipment.push({ label: `เครื่องกำเนิดไฟฟ้า ${gen.kva} kVA Standby 400/230 V`, qty: 1 });
      addCB(`${gen.cb.type} ${gen.cb.label}`, 3, gen.cb.ic);
      const atsN = {};
      (gen.panels.length > 1 ? gen.panels.map((p) => p.ats) : [gen.ats]).forEach((a) => { atsN[a.label] = (atsN[a.label] || 0) + 1; });
      Object.entries(atsN).forEach(([label, qty]) => equipment.push({ label, qty }));
    }
    const toRows = (o, f) => Object.entries(o).map(([k, v]) => f(k.split('|'), v));
    return {
      equipment,
      cables: toRows(cables, ([t, s], v) => ({ type: (D.CABLES[t] || {}).label || t, size: Number(s), length: Math.ceil(v) })).sort((a, b) => a.type.localeCompare(b.type) || a.size - b.size),
      conduits: toRows(conduits, ([t, s], v) => ({ type: t, size: s, length: Math.ceil(v) })),
      breakers: Object.entries(cbs).map(([k, v]) => { const [l, p, ic, r] = k.split('|'); return Object.assign({ label: l, poles: p, ic, rcd: r || '', qty: v }, cbBrand[k] || {}); })
        .sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || (a.model || '').localeCompare(b.model || '', 'en', { numeric: true }) || a.label.localeCompare(b.label, 'en', { numeric: true })),
      boards
    };
  }

  /* ===================== ทำความสะอาดโครงการเก่า/เสีย ===================== */
  // normalizeProject(p) -> { project, notes[] } : เติมค่าเริ่มต้นของ meta (deep-merge branch/feeder/main/hv), ซ่อมแผง/รายการเสีย
  // (id ซ้ำ/ไม่มี, แม่ที่ไม่มี/วนกลับ, ไม่มี MDB, รายการชนิดแปลก/ชี้แผงที่ไม่มี) ; ไม่แก้ข้อมูลเข้า ; ทำซ้ำได้ผลเดิม
  function normalizeProject(raw) {
    const notes = [];
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const src = isObj(raw) ? JSON.parse(JSON.stringify(raw)) : {};
    const def = defaultMeta();
    const sm = isObj(src.meta) ? src.meta : {};
    const meta = Object.assign({}, def, sm);
    ['branch', 'feeder', 'main', 'hv'].forEach((k) => { meta[k] = Object.assign({}, def[k], isObj(sm[k]) ? sm[k] : {}); });
    if (meta.phasePattern !== 'seq' && meta.phasePattern !== 'pair') meta.phasePattern = 'pair';
    if (meta.threePole !== 'column') meta.threePole = 'consecutive';

    const used = new Set();
    const uniq = (id, fallback) => { let base = isBlank(id) ? fallback : String(id), u = base, k = 2; while (used.has(u)) u = `${base}_${k++}`; used.add(u); return u; };
    let renamed = 0, dropped = 0, fixedParent = 0;
    const panels = [];
    (Array.isArray(src.panels) ? src.panels : []).forEach((p, i) => {
      if (!isObj(p)) { dropped++; return; }
      const id = uniq(p.id, `P${i + 1}`);
      if (String(p.id) !== id) renamed++;
      const q = Object.assign({}, p, { id });
      if (isBlank(q.name)) q.name = id;
      if (q.kind !== 'MDB' && q.kind !== 'SDB' && q.kind !== 'LP') q.kind = 'LP';
      if (q.phases !== 1 && q.phases !== 3) q.phases = phasesOf(q.phases, 3);
      if (q.emergency !== undefined) q.emergency = q.emergency === true || q.emergency === 'true' || q.emergency === 1;
      panels.push(q);
    });
    let mdb = panels.find((p) => p.kind === 'MDB');
    panels.forEach((p) => { if (p.kind === 'MDB' && p !== mdb) { p.kind = 'SDB'; notes.push(`พบ MDB มากกว่า 1 แผง — ${p.name} ถูกเปลี่ยนเป็นแผงสวิตช์รอง`); } });
    if (!mdb) { mdb = { id: uniq('MDB', 'MDB'), name: 'MDB', kind: 'MDB', phases: 3, parent: null }; panels.unshift(mdb); notes.push('ไม่พบแผงสวิตช์ประธาน (MDB) — สร้างให้ใหม่ 1 แผง'); }
    if (mdb.parent !== null) mdb.parent = null;
    const ids = new Set(panels.map((p) => p.id));
    for (const p of panels) {
      if (p === mdb) continue;
      if (p.parent === undefined) p.parent = mdb.id; // ไม่ระบุ = รับไฟจาก MDB
      else if (p.parent === null || p.parent === '' || String(p.parent) === p.id || !ids.has(String(p.parent))) { p.parent = mdb.id; fixedParent++; }
      else p.parent = String(p.parent);
    }
    const byId = new Map(panels.map((p) => [p.id, p]));
    for (const p of panels) { // ตัดวงวน: เดินขึ้นไปจนถึง MDB
      const seen = new Set();
      let cur = p;
      while (cur && cur !== mdb) {
        if (seen.has(cur.id)) { cur.parent = mdb.id; fixedParent++; break; }
        seen.add(cur.id);
        cur = byId.get(cur.parent);
      }
    }
    const usedItems = new Set();
    let ghost = 0, weird = 0, reid = 0;
    const items = [];
    (Array.isArray(src.items) ? src.items : []).forEach((it, i) => {
      if (!isObj(it) || !ITEM_TYPES.includes(it.type)) { weird++; return; }
      if (isBlank(it.panelId) || !ids.has(String(it.panelId))) { ghost++; return; }
      let id = isBlank(it.id) ? `i${i + 1}` : String(it.id);
      const base = id; let k = 2;
      while (usedItems.has(id)) id = `${base}_${k++}`;
      usedItems.add(id);
      if (id !== it.id) reid++;
      items.push(Object.assign({}, it, { id, panelId: String(it.panelId) }));
    });
    if (renamed) notes.push(`แก้ id แผงที่ซ้ำ/ว่าง ${renamed} แผง`);
    if (dropped) notes.push(`ตัดแผงที่อ่านไม่ได้ ${dropped} รายการ`);
    if (fixedParent) notes.push(`ซ่อมการรับไฟของแผง ${fixedParent} แผง (แม่ไม่มี/ชี้ตัวเอง/วนกลับ) — ย้ายไปรับไฟจาก MDB`);
    if (reid) notes.push(`แก้ id รายการอุปกรณ์ที่ซ้ำ/ว่าง ${reid} รายการ`);
    if (ghost) notes.push(`ตัดอุปกรณ์ที่ชี้ไปแผงที่ไม่มีอยู่ ${ghost} รายการ`);
    if (weird) notes.push(`ตัดรายการที่อ่านไม่ได้/ชนิดอุปกรณ์ไม่รู้จัก ${weird} รายการ`);
    return { project: Object.assign({}, src, { version: src.version == null ? 1 : src.version, meta, panels, items }), notes };
  }

  function balance(items, lim, base, mode) {
    const S = phaseSolver(items, lim, base);
    const a = S.auto('tri');
    if (mode === 'deep') return S.deep(a, 'tri');
    return a;
  }

  const API = {
    designGenerator, calculate, defaultMeta, expandItem, designBranch, designFeeder,
    pickConductor, pickCable: pickConductor, pickConduit, pickUp, vdPercent, motorFLC, acKVA, lampById,
    cctNo, breaker, icStd, branchICFor, fmt, D, slotPhase, normalizeProject,
    buildBOM, riserOf, tempFactor, groupFactor, layoutPanel, demandOf, condoDemand,
    ownPhaseVA, cableZ, iscFrom, phaseSolver, unbOf, balance
  };
  root.LoadEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
