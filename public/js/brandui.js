/*
 * หน้าจอ "เบรกเกอร์ตามยี่ห้อ" (ใช้คู่กับ brandcb.js / ตัวคำนวณ)
 *  - การ์ดในแท็บตั้งค่า: ยี่ห้อ + ซีรีส์ของ MCB/RCBO (วงจรย่อย) และ MCCB (สายป้อน/ประธาน), รุ่น CB ประธาน
 *  - ชี้เมาส์ที่ช่อง [data-brcb] = tooltip ข้อมูลรุ่น ; คลิก = popover ยี่ห้อ → ซีรีส์ (รุ่น) → เฟรม AF
 *    กรองตาม AT ที่ต้องใช้ / Icu ≥ Ik ที่แผง / จำนวนขั้ว — รุ่นที่ไม่ผ่านเป็นสีเทาพร้อมเหตุผล ; ↺ กลับไปใช้ค่าโครงการ
 *  - ทุกการเปลี่ยนแปลงบันทึกใน Log และเลิกทำได้ (toast "เลิกทำ")
 * app.js เรียก BrandUI.init({ project, result, recalc, logEvent, toast, toastUndo, esc, fmt }) ครั้งเดียว
 */
(function (root) {
  'use strict';
  const BR = root.LS_BRANDCB;
  let A = null, tip = null, pop = null, popKey = null, popSel = null;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const esc = (s) => (A ? A.esc(s) : String(s));
  const fmt = (x, d) => (A ? A.fmt(x, d) : String(x));

  /* ---------- ค่าที่เก็บในโครงการ ---------- */
  function snapshot() { const p = A.project(); return JSON.stringify({ brands: p.meta.brands, panels: p.panels, items: p.items }); }
  function restore(s) { const p = A.project(), o = JSON.parse(s); if (o.brands) p.meta.brands = o.brands; else delete p.meta.brands; p.panels = o.panels; p.items = o.items; A.recalc(true); }
  const brandsOf = (p) => (isObj(p.meta.brands) ? p.meta.brands : {});
  function setBrands(p, b) { const keep = {}; ['mcb', 'mccb'].forEach((k) => { if (isObj(b[k]) && b[k].brand) keep[k] = b[k]; }); if (b.main) keep.main = b.main; if (Object.keys(keep).length) p.meta.brands = keep; else delete p.meta.brands; }
  function countOv(p) {
    let n = 0;
    p.items.forEach((it) => { if (isObj(it.brOv)) n += Object.keys(it.brOv).length; });
    p.panels.forEach((b) => { if (b.brOv) n++; });
    return n + (brandsOf(p).main ? 1 : 0);
  }

  /* ---------- การ์ดตั้งค่าโครงการ ---------- */
  function settingsHTML(meta) {
    if (!BR || !BR.data) return '';
    const b = isObj(meta.brands) ? meta.brands : {};
    const opt = (v, t, cur) => `<option value="${esc(v)}" ${String(v) === String(cur || '') ? 'selected' : ''}>${esc(t)}</option>`;
    const part = (key, title, type, hint) => {
      const s = isObj(b[key]) ? b[key] : {}, list = BR.brands(type), cur = list.find((x) => x.brand === s.brand);
      return `<h4>${title}</h4><div class="row2">
        <label class="field"><span>ยี่ห้อ</span><select data-brand-set="${key}.brand">${opt('', BR.GENERIC_NAME, s.brand)}${list.map((x) => opt(x.brand, x.name, s.brand)).join('')}</select></label>
        <label class="field"><span>ซีรีส์</span><select data-brand-set="${key}.series" ${cur ? '' : 'disabled'}>${opt('', cur ? 'ทุกซีรีส์ของยี่ห้อ (เลือกรุ่นที่พอดีให้)' : '—', s.series)}${cur ? cur.series.map((x) => opt(x, x, s.series)).join('') : ''}</select></label></div>
        <div class="hint tiny muted">${hint}</div>`;
    };
    const mccbSel = isObj(b.mccb) && b.mccb.brand ? b.mccb : null;
    const mains = mccbSel ? BR.pool('MCCB', mccbSel) : [];
    const mainM = BR.find(b.main);
    const n = A ? countOv(A.project()) : 0;
    const meta2 = BR.data.meta;
    return `<div class="card br-card"><div class="card-h"><h3>เบรกเกอร์ตามยี่ห้อ</h3><span class="tag">${esc(meta2.counts.mccb)} MCCB · ${esc(meta2.counts.mcb)} MCB · ${esc(meta2.counts.rcbo)} RCBO</span></div><div class="card-b">
      <p class="tiny muted">ค่าเริ่มต้น "${BR.GENERIC_NAME}" = ผลคำนวณเดิมทุกอย่าง · เลือกยี่ห้อแล้ว AT จะขยับเป็นขนาดที่รุ่นมีขาย, AF = เฟรมของรุ่น, IC = Icu (MCB ใช้ Icn) และ selectivity ใช้ค่าตัดทันทีของรุ่น</p>
      ${part('mcb', 'MCB / RCBO (วงจรย่อย)', 'MCB', 'วงจรที่ต้องมี RCD ใช้ RCBO ของยี่ห้อเดียวกัน (ไม่มี RCBO 3 เฟสในฐานข้อมูล → MCB + RCD แยก)')}
      ${part('mccb', 'MCCB (สายป้อน / ประธาน / โหลดต่อตรงที่แผงสวิตช์)', 'MCCB', 'ระบบเลือกเฟรมเล็กสุดที่มี AT ที่ต้องใช้และ Icu ≥ Ik ที่แผง')}
      <label class="field"><span>รุ่น CB ประธาน</span><select data-brand-set="main">${opt('', mccbSel ? 'ตามค่าโครงการ (เลือกให้อัตโนมัติ)' : 'ตามค่าโครงการ', mainM ? b.main : '')}${mains.map((m) => opt(m.id, `${m.model} · ${m.af}AF · Icu ${m.icu} kA`, b.main)).join('')}${mainM && !mains.includes(mainM) ? opt(mainM.id, BR.nameOf(mainM), b.main) : ''}</select><span class="hint">หรือคลิกที่ช่อง CB ในตาราง Feeder / ตารางโหลดเพื่อเลือกรุ่นรายตัว</span></label>
      <div class="br-ov">กำหนดรุ่นรายตัวไว้ <b class="num">${n}</b> ตัว ${n ? '<button class="btn ghost sm" type="button" data-brand-clear="1">↺ ล้างทั้งหมด (ใช้ค่าโครงการ)</button>' : ''}</div>
      <details class="tiny muted"><summary>แหล่งข้อมูล · ข้อสังเกต ${esc(meta2.issues.length)} รายการ</summary><p>${esc(meta2.source)} · สร้างเมื่อ ${esc(meta2.generatedAt)} จาก ${esc(meta2.files.join(', '))} (อัปเดต: วาง CSV ใหม่แล้วรัน <code>node tools/import-brands.js</code>)</p><ul>${meta2.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
    </div></div>`;
  }
  function onSettingChange(el) {
    const p = A.project(), path = el.dataset.brandSet, v = el.value;
    const snap = snapshot();
    const b = JSON.parse(JSON.stringify(brandsOf(p)));
    let label;
    if (path === 'main') { if (v) b.main = v; else delete b.main; label = `รุ่น CB ประธาน → ${v ? BR.nameOf(BR.find(v)) : 'ตามค่าโครงการ'}`; }
    else {
      const [k, f] = path.split('.');
      b[k] = Object.assign({ brand: '', series: '' }, b[k]);
      b[k][f] = v;
      if (f === 'brand') { b[k].series = ''; if (k === 'mccb') delete b.main; }
      label = `${k === 'mcb' ? 'ยี่ห้อ MCB/RCBO' : 'ยี่ห้อ MCCB'} → ${BR.selName(b[k].brand ? b[k] : null)}`;
    }
    setBrands(p, b);
    A.recalc(true);
    A.logEvent('setting', `ตั้งค่า ${label}`);
    A.toastUndo(label, () => { restore(snap); A.logEvent('setting', `เลิกทำ: ${label}`); });
  }
  function clearAll() {
    const p = A.project(), snap = snapshot(), n = countOv(p);
    p.items.forEach((it) => { delete it.brOv; });
    p.panels.forEach((b) => { delete b.brOv; });
    const b = brandsOf(p); delete b.main; setBrands(p, b);
    A.recalc(true);
    A.logEvent('breaker', `ล้างรุ่น CB ที่กำหนดรายตัว ${n} ตัว — ใช้ค่าโครงการ`);
    A.toastUndo(`ล้างรุ่น CB รายตัว ${n} ตัว`, () => { restore(snap); A.logEvent('breaker', 'เลิกทำ: ล้างรุ่น CB รายตัว'); });
  }

  /* ---------- หา CB จากคีย์ data-brcb ---------- */
  // c|แผง|อุปกรณ์|ลำดับวงจร  f|แผงที่รับไฟ  main
  function locate(key) {
    const r = A.result(), p = A.project();
    if (!r || !key) return null;
    const parts = String(key).split('|');
    if (parts[0] === 'main') {
      const cb = r.service.mainCB, mdb = r.panels.find((x) => x.board.kind === 'MDB');
      return cb && { cb, ik: r.service.scMDB ? r.service.scMDB.Ik : 0, type: 'MCCB', poles: cb.poles || (r.service.phases === 1 ? 2 : 3), need: r.service.mainSnap ? r.service.mainSnap.from : cb.at, desc: `${mdb ? mdb.board.name : 'MDB'} · CB ประธาน`, ov: brandsOf(p).main || null };
    }
    if (parts[0] === 'f') {
      const kp = r.panels.find((x) => x.id === parts[1]);
      if (!kp || !kp.feeder) return null;
      const par = r.panels.find((x) => (x.kids || []).includes(kp.id)) || r.panels.find((x) => x.board.kind === 'MDB');
      const cb = kp.feeder.cb, board = p.panels.find((b) => b.id === kp.id);
      return { cb, ik: par && par.sc ? par.sc.Ik : 0, type: 'MCCB', poles: cb.poles || 3, need: cb.brSnap ? cb.brSnap.from : cb.at, desc: `CB สายป้อน → ${kp.board.name}`, ov: board ? board.brOv || null : null };
    }
    if (parts[0] === 'c') {
      const po = r.panels.find((x) => x.id === parts[1]);
      const c = po && po.circuits.find((x) => x.itemId === parts[2] && String(x.cIdx) === parts[3]);
      if (!c || !c.cb) return null;
      const it = p.items.find((x) => x.id === parts[2]);
      return { cb: c.cb, c, ik: po.sc ? po.sc.Ik : 0, type: c.cb.type === 'MCCB' ? 'MCCB' : (c.cb.rcd ? 'RCBO' : 'MCB'), poles: c.cb.poles || (c.phases === 3 ? 3 : 1), need: c.brSnap ? c.brSnap.from : c.cb.at, desc: `${po.board.name} · ${c.desc}`, ov: it && isObj(it.brOv) ? it.brOv[c.cIdx] || null : null, ev: !!c.ev };
    }
    return null;
  }
  function store(key, id) {
    const p = A.project(), parts = String(key).split('|');
    if (parts[0] === 'main') { const b = brandsOf(p); if (id) b.main = id; else delete b.main; setBrands(p, b); return true; }
    if (parts[0] === 'f') { const b = p.panels.find((x) => x.id === parts[1]); if (!b) return false; if (id) b.brOv = id; else delete b.brOv; return true; }
    if (parts[0] === 'c') {
      const it = p.items.find((x) => x.id === parts[2]), idx = Number(parts[3]);
      if (!it || !(idx >= 1 && idx <= 500)) return false;
      const ov = Object.assign({}, it.brOv);
      if (id) ov[idx] = id; else delete ov[idx];
      if (Object.keys(ov).length) it.brOv = ov; else delete it.brOv;
      return true;
    }
    return false;
  }

  /* ---------- tooltip ---------- */
  function tipHTML(L) {
    const cb = L.cb, m = cb.bm;
    if (!m) return `<b>${esc(cb.label || cb.at + ' A')}</b> · ${esc(cb.type || '')}<div>${BR.GENERIC_NAME} · IC ${esc(cb.ic)} kA</div><div class="muted">Ik" ที่แผง ${fmt(L.ik, 2)} kA</div><div class="br-hint">คลิกเพื่อเลือกยี่ห้อ/รุ่น</div>`;
    const ii = m.type === 'MCCB' ? `${fmt(Math.max((m.iiMult || 10) * cb.at, m.iiMin || 0), 0)} A (${m.iiMult}×In, ขั้นต่ำ ${m.iiMin} A${m.iiText ? ` · ผู้ผลิต: ${m.iiText}` : ''})` : (m.magMin ? `${m.magMin}–${m.magMax}× In = ${fmt(m.magMin * cb.at, 0)}–${fmt(m.magMax * cb.at, 0)} A` : '-');
    return `<b>${esc(m.brand)} ${esc(m.model)}</b> <span class="muted">${esc(m.series)}</span>
      <div class="num">${esc(cb.at)} AT${m.af ? ` / ${esc(m.af)} AF` : ''} · ${esc(cb.poles || '')}P${m.pinned ? ' · <i>กำหนดรายตัว</i>' : ''}</div>
      <div>${m.type === 'MCCB' ? `Icu ${esc(m.icu)} kA · Ics ${esc(m.ics)} kA (${esc(m.icsPct)}%)` : `Icn ${esc(m.icn)} kA (IEC 60898) · ${m.icu != null ? `Icu ${esc(m.icu)} kA (IEC 60947-2)` : 'Icu ไม่ระบุในแคตตาล็อก'}`} · Ik" ${fmt(L.ik, 2)} kA</div>
      <div>ค่าตัดทันที: ${esc(ii)}</div>
      <div>Trip: ${esc(m.trip)}${m.util ? ` · ${esc(m.util)}` : ''}${m.selMCB != null ? ` · selectivity กับ MCB ${esc(m.brandShort)} ≈ ${esc(m.selMCB)} kA` : ''}</div>
      ${m.type === 'RCBO' ? `<div>RCD ${esc(m.rcdMA)} mA · Type ${esc(m.rcdTypes.join(' / '))}${m.rcdNote ? ` — ${esc(m.rcdNote)}` : ''}</div>` : ''}
      ${m.verified ? `<div class="br-ver">✔ ยืนยันกับแคตตาล็อก ${esc(m.srcDoc)} หน้า ${esc(m.srcPages.join(', '))}</div>` : '<div class="muted">รวบรวมจากเว็บ — ยังไม่ผูกแคตตาล็อก</div>'}
      <div class="muted">แคตตาล็อก: ${esc(m.ref)}</div><div class="br-src">${esc(m.src)}</div><div class="br-hint">คลิกเพื่อเปลี่ยนรุ่น</div>`;
  }
  function place(el, box) {
    const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    let y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    box.style.left = x + 'px'; box.style.top = y + 'px';
  }
  function showTip(el) {
    if (pop && !pop.hidden) return;
    const L = locate(el.dataset.brcb);
    if (!L) return;
    if (!tip) { tip = document.createElement('div'); tip.id = 'brTip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.innerHTML = tipHTML(L);
    tip.hidden = false;
    place(el, tip);
  }
  const hideTip = () => { if (tip) tip.hidden = true; };

  /* ---------- popover เลือกรุ่น ---------- */
  // รุ่นผ่าน/ไม่ผ่าน: ต้องมีขนาดตั้งแต่ AT ที่ต้องใช้ (ไม่ใหญ่เกินเฟรม), ขั้วพอ, IC ≥ Ik ที่แผง, EV ต้อง RCD Type A/B
  function judge(m, L) {
    const why = [];
    if (!BR.polesOk(m, L.poles)) why.push(`มีเฉพาะ ${m.poles.join('/')}P${m.withN ? '+N' : ''} (ต้องการ ${L.poles}P)`);
    const at = m.at.find((a) => a >= L.need - 1e-9);
    if (at === undefined) why.push(`สูงสุด ${m.at[m.at.length - 1]} A < ${L.need} A`);
    else if (at !== L.need && m.at[0] > L.need) why.push(`เล็กสุด ${m.at[0]} A (ต้องการ ${L.need} A)`);
    const r = BR.ratingOf(m);
    if (r < L.ik - 1e-9) why.push(`${BR.ratingName(m)} ${r} < Ik" ${fmt(L.ik, 2)} kA`);
    if (L.ev && m.type === 'RCBO' && !m.rcdTypes.some((t) => t === 'A' || t === 'B')) why.push('Type AC ใช้กับที่ชาร์จ EV ไม่ได้');
    return { ok: !why.length, why, at };
  }
  function brandList(type) {
    if (type !== 'RCBO') return BR.brands(type);
    const out = new Map();
    BR.rowsOf('RCBO').forEach((m) => { if (!out.has(m.brandShort)) out.set(m.brandShort, { brand: m.brandShort, name: m.brand, series: [] }); const s = out.get(m.brandShort).series; if (!s.includes(m.series)) s.push(m.series); });
    return [...out.values()];
  }
  function popHTML(L) {
    const brands = brandList(L.type);
    const proj = brandsOf(A.project())[L.type === 'MCCB' ? 'mccb' : 'mcb'];
    const cur = BR.find(L.ov) || (L.cb.bm ? BR.find(L.cb.bm.id) : null);
    if (!popSel || popSel.key !== popKey) {
      const brand = (cur && cur.brandShort) || (proj && proj.brand) || (brands[0] && brands[0].brand);
      const b0 = brands.find((x) => x.brand === brand) || brands[0];
      const series = cur && cur.brandShort === b0.brand && b0.series.includes(cur.series) ? cur.series : (proj && proj.brand === b0.brand && b0.series.includes(proj.series) ? proj.series : b0.series[0]);
      popSel = { key: popKey, brand: b0.brand, series };
    }
    const b = brands.find((x) => x.brand === popSel.brand) || brands[0];
    const rows = BR.rowsOf(L.type).filter((m) => m.brandShort === b.brand && m.series === popSel.series).sort((x, y) => (x.af || 0) - (y.af || 0) || BR.ratingOf(x) - BR.ratingOf(y));
    const nOk = BR.rowsOf(L.type).filter((m) => m.brandShort === b.brand && judge(m, L).ok).length;
    const opt = (v, t, c) => `<option value="${esc(v)}" ${v === c ? 'selected' : ''}>${esc(t)}</option>`;
    return `<div class="br-pop-h"><b>${esc(L.desc)}</b><button type="button" class="btn ghost sm" data-brpop="close" aria-label="ปิด">✕</button></div>
      <div class="tiny muted">ตอนนี้: ${esc(L.cb.label)} · IC ${esc(L.cb.ic)} kA · ต้องการ ≥ ${esc(L.need)} A · Ik" ${fmt(L.ik, 2)} kA · ${esc(L.poles)}P${L.ov ? ' · <b>กำหนดรายตัว</b>' : ''}</div>
      <div class="row2"><label class="field"><span>1. ยี่ห้อ</span><select data-brpop="brand">${brands.map((x) => opt(x.brand, x.name, b.brand)).join('')}</select></label>
      <label class="field"><span>2. รุ่น (ซีรีส์)</span><select data-brpop="series">${b.series.map((x) => opt(x, x, popSel.series)).join('')}</select></label></div>
      <div class="label">3. เฟรม AF <span class="tiny muted">(ยี่ห้อนี้ผ่านเกณฑ์ ${nOk} รุ่น)</span></div>
      <div class="br-list" role="listbox">${rows.map((m) => {
        const j = judge(m, L), on = cur && cur.id === m.id;
        return `<button type="button" class="br-opt ${on ? 'on' : ''}" data-brpop-pick="${esc(m.id)}" ${j.ok ? '' : 'disabled'} aria-label="${esc(`${m.model}${m.af ? ' ' + m.af + 'AF' : ''} ${BR.ratingName(m)} ${BR.ratingOf(m)} kA${j.ok ? '' : ' — ' + j.why.join(', ')}`)}" title="${esc(m.ref)}">
          <span class="nm">${m.verified ? '✔ ' : ''}${esc(m.model)}</span><span class="num">${m.af ? esc(m.af) + 'AF · ' : ''}${esc(BR.ratingName(m))} ${esc(BR.ratingOf(m))} kA${m.ics != null ? ` · Ics ${esc(m.icsPct)}%` : ''}</span>
          <span class="tiny">${j.ok ? `${esc(m.at[0])}–${esc(m.at[m.at.length - 1])} A${j.at !== L.need ? ` · ใช้ ${esc(j.at)} A` : ''} · ${esc(m.trip || `${m.curve}${m.rcdTypes && m.rcdTypes.length ? ` · RCD Type ${m.rcdTypes.join('/')}` : ''}`)}` : esc(j.why.join(' · '))}</span></button>`;
      }).join('') || '<div class="empty tiny">ไม่มีรุ่นในซีรีส์นี้</div>'}</div>
      ${cur && cur.verified && cur.src ? `<div class="tiny br-ver-l">ที่มาของรุ่นที่เลือก: <a href="${esc(cur.src.url)}" target="_blank" rel="noopener noreferrer">${esc(cur.src.doc)}</a> หน้า ${esc(cur.src.pages.join(', '))}</div>` : ''}
      <div class="br-pop-f">${L.ov ? '<button type="button" class="btn sm" data-brpop="reset">↺ ใช้ค่าโครงการ</button>' : `<span class="tiny muted">ค่าโครงการ: ${esc(BR.selName(proj && proj.brand ? proj : null))}</span>`}<span class="tiny muted">${BR.SRC_BRAND}</span></div>`;
  }
  function openPop(el) {
    const L = locate(el.dataset.brcb);
    if (!L) return;
    hideTip();
    if (L.cb.type === 'ACB') { A.toast('CB นี้เป็น ACB — ฐานข้อมูลยี่ห้อมีถึง MCCB 1600 AF'); return; }
    popKey = el.dataset.brcb;
    if (!pop) { pop = document.createElement('div'); pop.id = 'brPop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'เลือกยี่ห้อ/รุ่นเบรกเกอร์'); document.body.appendChild(pop); }
    pop.innerHTML = popHTML(L);
    pop.hidden = false;
    pop._anchor = el;
    place(el, pop);
    const f = pop.querySelector('select'); if (f) f.focus();
  }
  function closePop() { if (pop) pop.hidden = true; popKey = null; }
  function refreshPop() { const L = locate(popKey); if (!L) { closePop(); return; } pop.innerHTML = popHTML(L); }
  function pick(id) {
    const L = locate(popKey);
    if (!L) return;
    const key = popKey, old = L.ov, snap = snapshot();
    if ((old || null) === (id || null)) { closePop(); return; }
    if (!store(key, id)) { A.toast('บันทึกรุ่นไม่ได้ — CB นี้ไม่ได้มาจากอุปกรณ์ในรายการ'); return; }
    const name = id ? BR.nameOf(BR.find(id)) : 'ค่าโครงการ';
    const label = `${L.desc}: รุ่น CB ${old ? BR.nameOf(BR.find(old)) : 'ตามค่าโครงการ'} → ${name}`;
    closePop();
    A.recalc(true);
    A.logEvent('breaker', label);
    A.toastUndo(label, () => { restore(snap); A.logEvent('breaker', `เลิกทำ: ${label}`); });
  }

  function init(hooks) {
    A = hooks;
    if (!BR || !BR.data) return;
    const onPopSel = (e) => {
      const el = e.target;
      if (!el.dataset || !popSel) return;
      if (el.dataset.brpop === 'brand' && el.value !== popSel.brand) { popSel.brand = el.value; const b = brandList(locate(popKey).type).find((x) => x.brand === el.value); popSel.series = b ? b.series[0] : ''; refreshPop(); }
      else if (el.dataset.brpop === 'series' && el.value !== popSel.series) { popSel.series = el.value; refreshPop(); }
    };
    document.addEventListener('input', onPopSel, true);
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset) return;
      if (el.dataset.brandSet) { e.stopPropagation(); onSettingChange(el); return; }
      if (el.dataset.brpop) { e.stopPropagation(); onPopSel(e); }
    }, true);
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest) return;
      if (t.closest('[data-brand-clear]')) { clearAll(); return; }
      const pk = t.closest('[data-brpop-pick]');
      if (pk) { pick(pk.dataset.brpopPick); return; }
      const act = t.closest('[data-brpop]');
      if (act && act.tagName === 'BUTTON') { if (act.dataset.brpop === 'close') closePop(); else if (act.dataset.brpop === 'reset') pick(null); return; }
      if (pop && !pop.hidden && t.closest('#brPop')) return;
      const cell = t.closest('[data-brcb]');
      if (cell && !t.closest('select, button, input, .cb-grip')) { openPop(cell); return; }
      if (pop && !pop.hidden) closePop();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pop && !pop.hidden) { e.stopPropagation(); const a = pop._anchor; closePop(); if (a && a.isConnected) a.focus(); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.brcb) { e.preventDefault(); openPop(e.target); }
    }, true);
    document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('[data-brcb]'); if (el) showTip(el); });
    document.addEventListener('pointerout', (e) => { const el = e.target.closest && e.target.closest('[data-brcb]'); if (el && !el.contains(e.relatedTarget)) hideTip(); });
    document.addEventListener('focusin', (e) => { if (e.target.dataset && e.target.dataset.brcb) showTip(e.target); });
    document.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.brcb) hideTip(); });
    window.addEventListener('scroll', () => { hideTip(); if (pop && !pop.hidden && pop._anchor && pop._anchor.isConnected) place(pop._anchor, pop); }, true);
  }
  // หลังวาดหน้าใหม่ (ผลคำนวณเปลี่ยน) ช่องเดิมถูกแทนที่ → ปิด tooltip/popover ที่ค้าง
  function afterRender() { hideTip(); if (pop && !pop.hidden && !(pop._anchor && pop._anchor.isConnected)) closePop(); }

  root.BrandUI = { init, settingsHTML, afterRender, locate, judge };
})(typeof self !== 'undefined' ? self : this);
