/*
 * ตัวสร้างตาราง (HTML/SVG/CSV) ใช้ร่วมกันทั้งหน้าจอและรายงาน PDF
 */
(function (root) {
  'use strict';
  const E = root.LoadEngine;
  const D = root.LS_DATA;
  const fmt = E.fmt;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const PH = ['A', 'B', 'C'];
  const KIND_TH = { LP: 'แผงย่อย', SDB: 'แผงสวิตช์รอง', MDB: 'แผงสวิตช์ประธาน' };
  const BT_TH = { residential: 'ที่อยู่อาศัย', condo: 'อาคารชุด (คอนโด)', office: 'สำนักงาน/ร้านค้า', hotel: 'โรงแรม', hospital: 'โรงพยาบาล', warehouse: 'โรงเก็บพัสดุ', other: 'อาคารประเภทอื่น' };

  function cableShort(c) { return ({ IEC01: 'IEC01', NYY: 'NYY', CV: 'CV', NYY4C: 'NYY', CV4C: 'CV' })[c] || c; }

  // หมายเลข F ของสายป้อนที่ออกจากแผงแต่ละแผง
  function feederNumbers(result) {
    const map = {};
    for (const p of result.panels) {
      let k = 0;
      (p.kids || []).forEach((id) => { map[id] = `${p.board.name}-F${++k}`; });
      p.circuits.forEach((c) => { if (!p.isLP) c.fno = `F${++k}`; });
    }
    return map;
  }

  // ช่อง AT แบบแก้ได้ (หน้าจอเท่านั้น): dropdown เลือกขนาด + ที่จับลากขึ้น/ลง (grip) ; วงจรที่ผู้ออกแบบกำหนดเองมีกรอบส้ม + ปุ่มคืนค่า
  // SPARE ที่ระบบเติมเอง (ไม่มี itemId) แก้ที่ช่องนี้ไม่ได้ จึงแสดงตัวเลขเฉย ๆ
  function cbCell(pid, no, c, opts) {
    if (!c || !c.cb) return '<td></td>';
    if (c.firePump) return `<td>${c.cb.at}</td>`;   // CB ปั๊มดับเพลิง (Mag-only) ไม่ให้เปลี่ยนเป็น MCB ธรรมดา
    if (!c.itemId || !c.cIdx) return `<td>${c.cb.at}</td>`;
    const key = esc(pid) + '|' + no;
    const auto = c.cbForce ? c.cbAuto : c.cb.at;
    const forced = !!c.cbForce && c.cbForce !== auto;
    const list = D.MCB_AT.includes(c.cb.at) ? D.MCB_AT : D.MCB_AT.concat([c.cb.at]).sort((a, b) => a - b);
    const options = list.map((a) => `<option value="${a}" ${a === c.cb.at ? 'selected' : ''}>${a}${a === auto ? ' •' : ''}</option>`).join('');
    const grip = opts && opts.grip === false ? '' : `<span class="cb-grip" data-cb-grip="${key}" tabindex="0" role="button" aria-label="ขนาดเบรกเกอร์วงจรที่ ${no}: ${c.cb.at} A (กด ↑ ↓ เพื่อเปลี่ยน)" title="จับแล้วลากขึ้น/ลงเพื่อเปลี่ยนขนาดเบรกเกอร์ · คีย์บอร์ด ↑ ↓">⋮⋮</span>`;
    return `<td class="at-cell ${forced ? 'forced' : ''}">${grip}<select class="cb-sel" data-cb-set="${key}" aria-label="ขนาดเบรกเกอร์วงจรที่ ${no}" title="• = ขนาดที่ระบบเลือกให้">${options}</select>${forced ? `<button type="button" class="cb-reset" data-cb-reset="${key}" title="คืนเป็นขนาดที่ระบบเลือก (${auto} A)" aria-label="คืนค่าอัตโนมัติ">↺</button>` : ''}</td>`;
  }

  // ตัวเลือกเฟส (หน้าจอเท่านั้น, แผง 3 เฟส, วงจร 1 เฟสของอุปกรณ์): ที่จับลากไปวางแถวเฟสอื่น/ปุ่ม A B C + dropdown สำหรับคีย์บอร์ด
  // "•" = เฟสที่ตัวจัดเฟสเลือกให้ ; เลือก A/B/C = ตรึงวงจรไว้เฟสนั้น (แถวมีแถบสี)
  function phCtl(pid, r, on) {
    if (!on || r.kind !== 'load' || !r.c || !r.c.itemId || !r.c.cIdx || r.c.phases === 3) return '';
    const key = esc(pid) + '|' + r.no, pin = r.c.phForce;
    const opts = `<option value="auto" ${pin == null ? 'selected' : ''}>•</option>` + [0, 1, 2].map((k) => `<option value="${k}" ${pin === k ? 'selected' : ''}>${PH[k]}</option>`).join('');
    return `<span class="ph-grip ph${PH[r.ph]}" data-ph-grip="${key}" tabindex="0" role="button" aria-label="ย้ายเฟสวงจรที่ ${r.no} (ลาก หรือกดปุ่ม ← →)" title="ลากไปวางที่แถวของเฟสอื่น หรือที่ปุ่มเฟส A/B/C · คีย์บอร์ด ← →">${PH[r.ph]}</span><select class="ph-sel" data-ph-set="${key}" aria-label="เฟสของวงจรที่ ${r.no}" title="• = เฟสที่ระบบจัดให้ · เลือก A/B/C เพื่อตรึง">${opts}</select>`;
  }

  /* ---------- ตารางโหลดแผงย่อย: รูปแบบ Panel Board Schedule (ตามแบบ THE KOP ENGINEER) ---------- */
  // seq: แถวเรียงตามเลขวงจร 1,2,3,… · pair: ครึ่งบนเลขคี่ ครึ่งล่างเลขคู่ ; เฟสของแต่ละช่องมาจาก engine (layout.slotPhase)
  // รูปแบบ seq = A-B-C-A-B-C ตามเลขวงจร, pair = AA-BB-CC (แถวละคู่ ซ้าย/ขวา)
  function panelRows(p) {
    const L = p.layout;
    if (!L || !L.slots.length) return [];
    const rows = [];
    // รหัสประจำวงจร (ck) = id อุปกรณ์ + ลำดับในอุปกรณ์นั้น — คงเดิมแม้ตำแหน่งช่องเปลี่ยน (ใช้เล่นแอนิเมชันย้ายแถวตอน Balance)
    const ck = new Map(), seenItem = {};
    (p.circuits || []).forEach((c) => { const k = c.itemId || 'x'; seenItem[k] = (seenItem[k] || 0) + 1; ck.set(c, `${k}#${seenItem[k]}`); });
    for (let r = 0; r < L.rows; r++) {
      for (const side of [0, 1]) {
        const i = r * 2 + side;
        const s = L.slots[i];
        const ph = p.board.phases === 3 ? (L.slotPhase ? L.slotPhase[i] : r % 3) : 0;
        const no = i + 1;
        const row = { no, ph, kind: 'space', va: [null, null, null] };
        if (s && s.ref) {
          row.kind = 'cont'; row.c = s.ref; row.va[ph] = s.ref.va / 3; row.ck = ck.get(s.ref) + ':' + no;
        } else if (s) {
          row.c = s;
          row.kind = s.cat === 'spare' ? 'spare' : 'load';
          if (s.phases === 3) row.va[ph] = s.va / 3; else if (s.va) row.va[ph] = s.va;
          row.ck = ck.get(s) || `auto#${no}`;
        }
        rows.push(row);
      }
    }
    // pair (ค่าเริ่มต้น): ครึ่งบน = เลขคี่ 1,3,5,… ครึ่งล่าง = เลขคู่ 2,4,6,… → เบรกเกอร์ 3 ขั้วอ่านต่อกันเป็น 1-3-5 เฟส A-B-C ลงมาทั้งสองครึ่ง
    if (L.pattern === 'pair') {
      const odd = rows.filter((r) => r.no % 2 === 1), even = rows.filter((r) => r.no % 2 === 0);
      if (odd.length && even.length) even[0].half = true;
      return odd.concat(even);
    }
    return rows;
  }

  const wireNote = (t) => String(t || '').replace(/G-/g, 'G').replace(/(\d)-(\d)/g, '$1x$2');
  const wireText = (cond) => (cond ? `${cond.n}x${cond.size}${cond.ground ? '/G' + cond.ground : ''}` : '');
  const cableStd = (c) => (D.CABLES[c] ? D.CABLES[c].label.replace(/\s*\(.*?\)\s*/, ' ').trim() : c);
  const METHOD_TH = { g1: 'เดินสายร้อยท่อในฝ้า/ผนังฉนวนความร้อน (กลุ่มที่ 1)', g2: 'เดินสายร้อยท่อในอากาศ (กลุ่มที่ 2)', g3: 'เดินสายเกาะผนัง (กลุ่มที่ 3)', g5: 'เดินสายร้อยท่อฝังดิน (กลุ่มที่ 5)', g6: 'ฝังดินโดยตรง (กลุ่มที่ 6)', g7: 'เดินบนรางเคเบิล (กลุ่มที่ 7)' };
  const CAT_GROUP = { light: 'LIGHTING', rec: 'RECEPTACLE', motor: 'PUMP', fire_pump: 'PUMP', heater: 'WATER HEATER', ac: 'A/C', chiller: 'A/C', cook: 'OTHER', lift: 'OTHER', esc: 'OTHER', ev: 'OTHER', other: 'OTHER', spare: 'SPARE' };
  const SUM_ORDER = ['LIGHTING', 'RECEPTACLE', 'PUMP', 'WATER HEATER', 'A/C', 'OTHER', 'SPARE'];

  function catTotals(p) {
    const t = {}; SUM_ORDER.forEach((k) => { t[k] = 0; });
    p.circuits.forEach((c) => { t[CAT_GROUP[c.cat] || 'OTHER'] += c.va || 0; });
    return t;
  }
  const cbTypeOf = (c) => (c.cb.rcd ? 'RCBO' : (c.cb.type || 'MCB')) + (c.cb.magOnly ? ' Mag-only' : '');
  // เบรกเกอร์ตามยี่ห้อ: ชื่อรุ่นใต้ชนิด CB ; data-brcb = ช่องที่ชี้เมาส์ดูข้อมูลรุ่น/คลิกเลือกรุ่น (brandui.js) — c|แผง|อุปกรณ์|ลำดับวงจร, f|แผงที่รับไฟ, main
  const brKey = (pid, c) => (c && c.itemId && c.cIdx ? `c|${pid}|${c.itemId}|${c.cIdx}` : '');
  const brAttr = (key) => (key ? ` data-brcb="${esc(key)}" tabindex="0"` : '');
  const brSpec = (cb) => (root.LS_BRANDCB && root.LS_BRANDCB.specOf ? root.LS_BRANDCB.specOf(cb) : '');
  const brModel = (cb) => (cb && cb.bm ? `<div class="br-mdl">${esc(cb.bm.brandShort + ' ' + cb.bm.model)}${brSpec(cb) ? ` <span class="br-spec">(${esc(brSpec(cb))})</span>` : ''}</div>` : '');
  // ป้าย CB แบบ Generic (ตัดยี่ห้อ/รุ่นออก: "Schneider EZC100F 32AT/100AF" → "32AT/100AF") — โหมดรายงานต้องไม่ล็อกสเปก
  const genCB = (cb) => (cb && cb.label ? String(cb.label).replace(/^.*?(\d+(?:AT\/\d+AF|A)\b.*)$/, '$1') : '');

  // opts.edit = true (หน้าจอเท่านั้น): เพิ่มคอลัมน์ปุ่มลบวงจร และคลิกชื่อรายการเพื่อแก้อุปกรณ์เจ้าของวงจร — รายงาน PDF/CSV ไม่ใส่
  /* ---------- ลายน้ำ Ver.DEMO (เปิดเมื่อ DemoGuard.isDemo()) ---------- */
  const demoOn = () => !!(root.DemoGuard && root.DemoGuard.isDemo && root.DemoGuard.isDemo());
  const demoCfg = () => (root.DemoGuard && root.DemoGuard.config) || {};
  // ลายน้ำเฉียงบนผังเส้นเดียว (ฝังในเนื้อ SVG จึงติดไปกับการคัดลอก SVG/แคปหน้าจอ/พิมพ์) — ไม่รับคลิก
  function sldWatermark(width, height) {
    if (!demoOn()) return '';
    const c = demoCfg(), t1 = esc(c.watermarkText || 'Ver.DEMO'), t2 = esc(c.watermarkSubText || '');
    return `<defs><pattern id="sld-demo-wm" width="440" height="230" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
        <text x="20" y="90" fill="rgba(220,38,38,.17)" font-family="sans-serif" font-size="20" font-weight="700">${t1}</text>
        <text x="20" y="120" fill="rgba(100,116,139,.17)" font-family="monospace" font-size="12" font-weight="600">${t2}</text></pattern></defs>
      <g data-el="demo-watermark" pointer-events="none" style="user-select:none"><rect x="0" y="0" width="${width}" height="${height}" fill="url(#sld-demo-wm)"/>
        <rect x="10" y="10" width="${Math.min(width - 20, 470)}" height="30" rx="6" fill="rgba(220,38,38,.92)"/>
        <text x="${10 + Math.min(width - 20, 470) / 2}" y="30" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="14" font-weight="700">${t1}</text></g>`;
  }
  // แถบกำกับหัว/ท้ายตารางโหลดทุกแผง (data-el="schedule-watermark") + คลาส demo-wm ให้ CSS วาดลายน้ำเฉียงทับ
  function scheduleWatermark(html) {
    if (!demoOn()) return html;
    const t = esc(demoCfg().watermarkText || 'Ver.DEMO');
    const bar = `<div class="schedule-demo-banner" data-el="schedule-watermark">⚠ <strong>${t}</strong> — เอกสารสาธิต ห้ามนำไปใช้อ้างอิงก่อสร้างหรือยื่นขออนุญาต</div>`;
    return `<div class="demo-wm">${bar}${html}${bar}</div>`;
  }

  function panelScheduleHTML(p, result, fnum, opts) {
    const edit = !!(opts && opts.edit);
    const b = p.board, f = p.feeder, svc = result.service, m = result.meta;
    const three = b.phases === 3;
    const rows = panelRows(p);
    const pv = p.phaseVA.map((v) => Math.round(v));
    const parent = result.panels.find((x) => x.id === b.parent);
    const mainCB = f ? f.cb : svc.mainCB;
    const ic = mainCB && mainCB.ic;
    const cats = catTotals(p);
    const displayCB = (cb) => (edit ? (root.LS_BRANDCB && root.LS_BRANDCB.labelSpec && cb.bm ? root.LS_BRANDCB.labelSpec(cb) : cb.label) : genCB(cb));
    // Ik" > IC (ความปลอดภัยต่อชีวิต): เซลล์ IC ของ CB ที่พิกัดตัดกระแสต่ำกว่ากระแสลัดวงจรที่บัสแผงนี้ → สีแดง + ⚠️
    const ikP = Number(p.sc && p.sc.Ik) || 0;
    // คำแนะนำในตารางโหลดเป็นสเปกกลาง (ไม่ระบุยี่ห้อ) : IC มาตรฐานถัดไป + Cascading/Back-up ตาม IEC 60947-2
    const icNeed = (D.IC_KA || []).slice().sort((a, b) => a - b).find((x) => x + 1e-9 >= ikP);
    const icTip = icNeed === undefined ? ' — Ik" เกิน IC สูงสุดในตาราง: ใช้ CB จำกัดกระแส + Cascading/Back-up Protection ตาม IEC 60947-2' : ` — แนะนำ IC ≥ ${icNeed} kA หรืออ้างอิงตาราง Cascading/Back-up Protection ตาม IEC 60947-2`;
    const icCell = (ic) => (ic > 0 && ikP > ic + 1e-9 ? `<td class="ic-bad" title="Ik&quot; ${fmt(ikP, 2)} kA > IC ${ic} kA — เบรกเกอร์ระเบิด (Explosion Risk)${esc(icTip)}">${ic} ⚠️</td>` : `<td>${ic || ''}</td>`);
    const present = SUM_ORDER.filter((k) => cats[k] > 0 && k !== 'SPARE');
    const hasRCBO = p.circuits.some((c) => c.cb && c.cb.rcd);
    const volt = three ? '230/400 V. 3 PHASE 4 WIRE' : '230 V. 1 PHASE 2 WIRE';
    const fromTxt = parent ? `${esc(parent.board.name)}${fnum[b.id] ? ' (' + esc(fnum[b.id].split('-').pop()) + ')' : ''}` : (svc.meter ? 'METER' : 'TRANSFORMER');
    const mainTxt = mainCB ? `${mainCB.type === 'MCB' ? 'MCB' : 'MCCB'} ${mainCB.poles || (three ? 3 : 2)}P ${mainCB.at} AT${mainCB.af ? ' / ' + mainCB.af + ' AF' : ''}` : '-';

    const head = `<div class="pbs-title">${volt} PANEL BOARD SCHEDULE FOR ${esc(present.join(', ') || 'GENERAL')}</div>
      <div class="pbs-head">
        <div><b>PANEL NO.</b> <span>: ${esc(b.name)}</span></div><div><b>CAPACITY</b> <span>: ${p.layout ? p.layout.ways : '-'} CKT.</span></div><div><b>PROJECT</b> <span>: ${esc(m.name)}</span></div>
        <div><b>FROM</b> <span>: ${fromTxt}</span></div><div><b>MAIN BUSBAR</b> <span>: ${p.busbar || '-'} AMP</span></div><div><b>LOCATION</b> <span>: ${esc(b.location || '-')}</span></div>
        <div><b>MAIN CIRCUIT BREAKER</b> <span>: ${mainTxt}</span></div><div><b>IC ≥</b> <span>${ic ? ic + ' KA at ' + (three ? '400' : '230') + ' VAC' : '-'}</span></div><div><b>MOUNTING</b> <span>: ${esc(b.mounting === 'FLUSH' ? 'FLUSH (WALL RECESSED)' : 'WALL MOUNTED')}</span></div>
      </div>`;

    const loadHead = three ? '<th colspan="3">CONNECTED LOAD IN VA.</th>' : '<th rowspan="2">CONNECTED LOAD IN VA.</th>';
    const thead = `<thead>
      <tr><th rowspan="2" class="c-no">CKT.<br>NO.</th><th rowspan="2" class="c-desc">DESCRIPTION</th><th colspan="4">CB</th><th colspan="2">WIRE</th><th colspan="2">CONDUIT</th>${loadHead}${edit ? '<th rowspan="2" class="c-act"></th>' : ''}</tr>
      <tr><th>NO.POLE</th><th>AT</th><th>TYPE</th><th>IC&nbsp;&gt;=</th><th>SIZE</th><th>TYPE</th><th>SIZE</th><th>TYPE</th>${three ? '<th>A</th><th>B</th><th>C</th>' : ''}</tr></thead>`;

    const vaCells = (r) => {
      const cell = (v, k) => `<td class="num r">${v != null && v > 0 ? fmt(Math.round(v), 0) : ''}</td>`;
      if (!three) return cell(r.va[0], 0);
      return [0, 1, 2].map((k) => cell(r.va[k], k)).join('');
    };
    const body = rows.map((r) => {
      let mid;
      if (r.kind === 'load') {
        const c = r.c;
        const descCell = edit && c.itemId ? `<td class="l desc-click" data-edit-circuit="${esc(c.itemId)}" title="คลิกเพื่อแก้อุปกรณ์ของวงจรนี้">${esc(c.desc)}</td>` : `<td class="l">${esc(c.desc)}</td>`;
        mid = `${descCell}<td>${c.cb.poles}</td>${edit ? cbCell(b.id, r.no, c) : `<td>${c.cb.at}</td>`}<td${edit ? brAttr(brKey(b.id, c)) : ''}>${cbTypeOf(c)}${edit ? brModel(c.cb) : ''}</td>${icCell(c.cb.ic)}<td class="mono">${esc(wireText(c.cond))}</td><td>${esc(cableShort(c.cond.cable))}</td><td class="mono">${c.conduit.inch === '-' ? '' : esc(c.conduit.inch) + '"'}</td><td>${esc(c.conduit.type === '-' ? '' : c.conduit.type)}</td>`;
      } else if (r.kind === 'spare') {
        const c = r.c;
        mid = `<td class="l">SPARE</td><td>${c.cb.poles || 1}</td>${edit ? cbCell(b.id, r.no, c) : `<td>${c.cb.at}</td>`}<td${edit ? brAttr(brKey(b.id, c)) : ''}>${cbTypeOf(c)}${edit ? brModel(c.cb) : ''}</td>${icCell(c.cb.ic)}<td></td><td></td><td></td><td></td>`;
      } else if (r.kind === 'cont') {
        mid = `<td class="l muted">↳ ${esc(r.c.desc)} (3P)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
      } else mid = `<td class="l muted">SPACE</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
      // ปุ่มลบวงจร: แถวที่เป็นวงจรจริง/สำรองเท่านั้น (แถวต่อของ 3P และ SPACE ไม่มี)
      const act = !edit ? '' : (r.kind === 'load' || r.kind === 'spare')
        ? `<td class="c-act"><button class="row-x" type="button" data-del-circuit="${esc(b.id)}|${r.no}" title="ลบวงจรที่ ${r.no}" aria-label="ลบวงจรที่ ${r.no}">×</button></td>` : '<td class="c-act"></td>';
      const drop = (edit && (r.kind === 'load' || r.kind === 'spare') && r.c.itemId && r.c.cIdx ? ` data-cbrow="${esc(b.id)}|${r.no}"` : '') + (edit && three ? ` data-phrow="${esc(b.id)}"` : '');
      const pinned = r.c && r.c.phForce != null && r.kind === 'load';
      return `<tr class="${r.kind === 'space' ? 'space' : ''}${pinned ? ' ph-pinned' : ''}${r.half ? ' half-top' : ''}"${drop} data-ck="${esc(r.ck || 'space#' + r.no)}" data-no="${r.no}" data-ph="${three ? PH[r.ph] : ''}">${(() => { const pc = phCtl(b.id, r, edit && three); return pc ? `<td class="num ph-cell">${pc}<span class="no">${r.no}</span></td>` : `<td class="num"><span class="ph-dot ${three ? 'ph' + PH[r.ph] : ''}"></span>${r.no}</td>`; })()}${mid}${vaCells(r)}${act}</tr>`;
    }).join('');

    // ช่องสายป้อน (กรอบสีแดงเหมือนในแบบ)
    let feeder = '<div class="pbs-feeder-box">-</div>';
    if (f) {
      const inch = f.racewayDetail && f.racewayDetail.conduit ? f.racewayDetail.conduit.inch : null;
      const inTxt = inch ? `In ${esc(f.conduitType)} Dia ${esc(inch)}"` : `In ${esc(f.raceway)}`;
      feeder = `<div class="pbs-feeder-box"><div>${esc(cableStd(f.cable))}</div><div><b>${esc(wireNote(f.text))}</b> Sq.mm</div><div>${inTxt}</div><div class="th">${esc(METHOD_TH[f.method] || '')}</div></div>
        <div class="pbs-feeder-sub">FEEDER CB : <b>${esc(edit ? f.cb.label : genCB(f.cb))}</b> IC ${f.cb.ic} kA<br>I<sub>F</sub> = ${fmt(f.I_F)} A · VD = ${fmt(f.vd.pct)}%</div>`;
    }
    const sumRows = SUM_ORDER.map((k) => `<tr><td>${k}</td><td class="eq">=</td><td class="r num">${cats[k] > 0 ? fmt(Math.round(cats[k]), 0) : '-'}</td><td>VA</td></tr>`).join('');
    const phaseBox = three
      ? `<table class="pbs-sum"><tr><td>PHASE A</td><td class="eq">=</td><td class="r num">${fmt(pv[0], 0)}</td><td>VA</td></tr><tr><td>PHASE B</td><td class="eq">=</td><td class="r num">${fmt(pv[1], 0)}</td><td>VA</td></tr><tr><td>PHASE C</td><td class="eq">=</td><td class="r num">${fmt(pv[2], 0)}</td><td>VA</td></tr>
          <tr><td>UNBALANCE</td><td class="eq">=</td><td class="r num">${fmt(p.unbalance, 1)}</td><td>%</td></tr><tr><td>MAX DEMAND</td><td class="eq">=</td><td class="r num">${fmt(Math.round(p.demand), 0)}</td><td>VA</td></tr></table>`
      : `<table class="pbs-sum"><tr><td>MAX DEMAND</td><td class="eq">=</td><td class="r num">${fmt(Math.round(p.demand), 0)}</td><td>VA</td></tr><tr><td>I<sub>F</sub></td><td class="eq">=</td><td class="r num">${f ? fmt(f.I_F) : '-'}</td><td>A</td></tr></table>`;
    const note = `NOTE : ${hasRCBO ? 'RCBO = Residual Current Circuit Breakers with Overload protection, In = 30 mA' : `MCB IC ≥ ${m.branchIC} kA`}${p.layout ? '' : ''}`;

    return scheduleWatermark(`<div class="pbs">${head}<table class="pbt ${three ? 'p3' : 'p1'}">${thead}<tbody>${body}</tbody></table>
      <div class="pbs-foot"><div class="pbs-f1"><div class="pbs-fl">FEEDER CABLE :</div>${feeder}</div><div class="pbs-f2">${'<table class="pbs-sum">' + sumRows + '</table>'}</div><div class="pbs-f3">${phaseBox}</div></div>
      <div class="pbs-total"><div class="pbs-note">${esc(note)}</div><div class="pbs-tl">TOTAL CONNECTED LOAD :</div><div class="pbs-tv num">${fmt(Math.round(p.connected), 0)}</div><div class="pbs-tu">VA</div></div></div>`);
  }

  /* ---------- ตารางสายป้อน (รูปที่ 6.30) ---------- */
  function feederRows(p, result, fnum) {
    const rows = [];
    let k = 0;
    for (const id of p.kids || []) {
      const kp = result.panels.find((x) => x.id === id);
      const f = kp.feeder;
      rows.push({
        from: p.board.name, f: `F${++k}`, to: kp.board.name, va: kp.phaseVA, total: kp.connected, demand: kp.demand, I: f.I_F,
        cb: f.cb.label, coord: f.coord || null, ic: f.cb.ic, key: `f|${kp.id}`, cond: `${f.text}`, type: cableShort(f.cable), race: f.raceway, len: f.length != null ? f.length : kp.board.feederLength, vd: f.vd.pct
      });
    }
    for (const c of p.circuits) {
      const va = [0, 0, 0];
      if (c.phases === 3) va.fill(c.va / 3); else va[0] = c.va;
      const cb = c.cb || null;   // ชนิด CB (MCB/MCCB) ตามที่ตัวคำนวณกำหนด — ตรงกับ BOM และ selectivity
      rows.push({
        from: p.board.name, f: `F${++k}`, to: c.desc, va, total: c.va, demand: c.va, I: c.I,
        cb: cb ? cb.label : '-', ic: c.cb ? c.cb.ic : '-', key: brKey(p.id, c), cond: c.cond ? c.cond.text : '-', type: c.cond ? cableShort(c.cond.cable) : '-',
        race: c.conduit && c.conduit.inch !== '-' ? `${c.conduit.inch}" ${c.conduit.type}` : '-', len: c.L, vd: c.vd ? c.vd.pct : 0, direct: true, c
      });
    }
    return rows;
  }
  function feederScheduleHTML(p, result, fnum) {
    const rows = feederRows(p, result, fnum);
    if (!rows.length) return '<div class="empty">แผงนี้ยังไม่มีสายป้อนออก</div>';
    const Itot = p.demand / (Math.sqrt(3) * 400);
    return `<table class="dt"><thead><tr>
      <th>From</th><th>F</th><th>To</th><th class="r">A</th><th class="r">B</th><th class="r">C</th><th class="r">Total VA</th><th class="r">Demand VA</th><th class="r">I (A)</th>
      <th>CB AT/AF</th><th class="r">IC kA</th><th>Feeder (sq.mm.)</th><th>Type</th><th>Raceway</th><th class="r">ยาว m</th><th class="r">VD %</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr style="animation:rowIn .3s ${i * 30}ms both"><td>${esc(r.from)}</td><td class="num">${r.f}</td><td><b>${esc(r.to)}</b>${r.direct ? ' <span class="tag">โหลดตรง</span>' : ''}</td>
        ${r.va.map((v) => `<td class="r num">${fmt(Math.round(v), 0)}</td>`).join('')}<td class="r num">${fmt(Math.round(r.total), 0)}</td><td class="r num">${fmt(Math.round(r.demand), 0)}</td>
        <td class="r num">${fmt(r.I)}</td><td class="num"${brAttr(r.key)}>${esc(r.cb)}${r.coord ? coordTag(r.coord) : ''}</td><td class="r num">${esc(r.ic)}</td><td class="num">${esc(r.cond)}</td><td>${esc(r.type)}</td><td class="num">${esc(r.race)}</td>
        <td class="r num">${esc(r.len || '-')}</td><td class="r num">${fmt(r.vd)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">TOTAL ${esc(p.board.name)}</td>${p.phaseVA.map((v) => `<td class="r num">${fmt(Math.round(v), 0)}</td>`).join('')}
        <td class="r num">${fmt(Math.round(p.connected), 0)}</td><td class="r num">${fmt(Math.round(p.demand), 0)}</td><td class="r num">${fmt(Itot)}</td>
        <td class="num"${brAttr(p.feeder ? `f|${p.id}` : 'main')}>${p.feeder ? esc(p.feeder.cb.label) : esc(result.service.mainCB.label)}</td><td class="r num">${esc(p.feeder ? p.feeder.cb.ic : result.service.mainCB.ic)}</td>
        <td class="num">${p.feeder ? esc(p.feeder.text) : esc(result.service.mainFeeder.text)}</td><td></td><td class="num">${p.feeder ? esc(p.feeder.raceway) : esc(result.service.mainFeeder.raceway)}</td><td></td><td></td></tr></tfoot></table>`;
  }

  /* ---------- Selectivity (ประเมินเบื้องต้นแบบกฎ — engine checkSelectivity) ---------- */
  const SEL_ST = { total: ['ok', 'เลือกตัดสมบูรณ์'], partial: ['warn', 'บางส่วน'], none: ['bad', 'ไม่เลือกตัด'] };
  function selectivityHTML(result) {
    const rows = [];
    result.panels.forEach((p) => (p.selectivity || []).forEach((s) => rows.push({ p, s })));
    if (!rows.length) return '<div class="empty">ยังไม่มีคู่ CB ต้นทาง–ปลายทางให้ตรวจ</div>';
    const st = (s) => { const x = SEL_ST[s.status] || SEL_ST.none; return `<span class="unb ${x[0]}">${x[1]}${s.status === 'partial' && s.limitKA != null ? ` ≤ ${fmt(s.limitKA, 2)} kA` : ''}</span>`; };
    const S = D.SELECTIVITY;
    const anyB = rows.some(({ s }) => s.src && s.src !== 'ประเมินเบื้องต้น');
    return `${anyB ? '<p class="muted tiny"><b>CB ต้นทางที่เลือกยี่ห้อ</b> (ข้อมูลผู้ผลิต — ตรวจกับแคตตาล็อก): ค่าตัดทันที = Ii ของรุ่น × In ไม่ต่ำกว่า Ii ขั้นต่ำของรุ่น · trip อิเล็กทรอนิกส์ใช้อัตราส่วน ≥ 1.25 (thermal-magnetic ≥ 1.6) · MCB ปลายทางยี่ห้อเดียวกันเลือกตัดได้ถึงค่า selectivity สูงสุดของรุ่น (ค่าประมาณ ขึ้นกับขนาด MCB จริง) · ยี่ห้อต่างกันใช้เกณฑ์ทั่วไปด้านล่าง</p>' : ''}<p class="muted tiny">ประเมินเบื้องต้น — ยืนยันด้วยตาราง selectivity ของผู้ผลิต · เกณฑ์: In ต้นทาง/ปลายทาง ≥ ${S.ratioMin} (สมบูรณ์เมื่อ ≥ ${S.ratioTotal}) · ค่าตัดทันทีต้นทาง ≈ ${S.instMult.MCCB}×In (MCCB), ${S.instMult.MCB}×In (MCB type C), ACB ถึง Icw ${S.acbIcwKA} kA · Ik" ที่บัสแผงต้นทาง</p>
      <table class="dt"><thead><tr><th>แผง</th><th>CB ต้นทาง</th><th>CB ปลายทาง</th><th class="r">จำนวน</th><th class="r">In ต้น/ปลาย</th><th class="r">Ik" (kA)</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead><tbody>
      ${rows.map(({ p, s }) => `<tr><td><b>${esc(p.board.name)}</b></td><td class="num">${esc(s.up)}</td><td class="num">${esc(s.down)}</td><td class="r num">${s.count}</td><td class="r num">${fmt(s.ratio, 2)}</td><td class="r num">${fmt(s.ikKA, 2)}</td><td class="nowrap">${st(s)}</td><td class="tiny">${esc(s.note)}${s.warn ? `<div class="warn-t" style="color:var(--bad,#c0392b);margin-top:2px">${esc(s.warn)}</div>` : ''}${s.src ? ` <span class="tag">${esc(s.src)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
  }

  /* ---------- ขั้นตอนคำนวณ ---------- */
  // แท็กบอกที่มาของขนาด CB สายป้อนที่ถูกขยับขึ้นเพราะประสานการเลือกตัดกับสายป้อนแผงลูก (Multilevel Feeder Coordination)
  function coordTag(c) {
    return `<span class="tag coord" title="${esc(`CB สายป้อนถูกขยับเป็น ${c.at} A เพื่อเลือกตัดกับสายป้อนแผงลูก ${c.kidAt} A (≥ ${c.ratio} × ${c.kidAt} = ${fmt(c.ratio * c.kidAt)} A)`)}">[${esc(c.ratio)}× Coord]</span>`;
  }
  function stepsHTML(steps) {
    return `<ol class="steps">${(steps || []).map((s) => `<li><span class="t">${esc(s.t)}</span>${s.tag ? ` <span class="tag coord">[${esc(s.tag)}]</span>` : ''}${s.ref ? `<span class="ref">${esc(s.ref)}</span>` : ''}<div class="f">${esc(s.f)}</div></li>`).join('')}</ol>`;
  }
  function demandStepsHTML(p) {
    const d = p.demandLocal;
    const cats = { light: 'แสงสว่าง', rec: 'เต้ารับ', ac: 'เครื่องปรับอากาศ', heater: 'เครื่องทำน้ำร้อน', cook: 'เครื่องหุงต้ม', motor: 'มอเตอร์', fire_pump: 'ปั๊มดับเพลิง', lift: 'ลิฟต์', esc: 'บันไดเลื่อน', chiller: 'ชิลเลอร์', ev: 'ที่ชาร์จรถไฟฟ้า', other: 'อื่น ๆ', spare: 'สำรอง' };
    const rows = Object.entries(d.cats).map(([k, v]) => `<tr><td>${cats[k] || k}</td><td class="r num">${fmt(Math.round(v.connected), 0)}</td><td>${esc(v.why)}</td><td class="r num">${fmt(Math.round(v.demand), 0)}</td><td class="tiny" style="color:var(--accent)">${esc(v.ref)}</td></tr>`);
    if (d.motorExtra) rows.push(`<tr><td>+25% มอเตอร์ตัวใหญ่สุด</td><td></td><td>${esc(d.bigMotor.desc)}: 0.25 × ${fmt(Math.round(d.bigMotor.va), 0)} = ${fmt(Math.round(d.motorExtra), 0)} VA — ใช้คิดขนาดตัวนำสายป้อนเท่านั้น ไม่รวมในดีมานด์</td><td class="r num">–</td><td class="tiny" style="color:var(--accent)">สมการ 8-7</td></tr>`);
    const cf = p.condo;
    if (cf) {
      // อาคารชุด: ดีมานด์ห้องชุดใต้แผงนี้ × ตัวคูณโหลดพร้อมกัน + โหลดส่วนกลางของแผงลูก
      [['res', 'ห้องชุดพักอาศัย', 'ตาราง 9.3'], ['com', 'ห้องชุดพาณิชย์', 'ตาราง 9.4']].forEach(([t, label, ref]) => {
        if (cf[t].n) rows.push(`<tr><td>${label} ${cf[t].n} ห้อง</td><td></td><td>เรียงห้องจากโหลดมากไปน้อย: ${cf[t].bands.length ? cf[t].bands.map(([a, b, f, va]) => `ห้อง ${a}–${b} ${fmt(Math.round(va), 0)} × ${f}`).join(' + ') : `${fmt(Math.round(cf[t].va), 0)} × 1`} (เฉลี่ย ${fmt(cf[t].f, 3)})</td><td class="r num">${fmt(Math.round(cf[t].demand), 0)}</td><td class="tiny" style="color:var(--accent)">${ref}</td></tr>`);
      });
      const kidCommon = cf.common - d.total;
      if (kidCommon > 0.5) rows.push(`<tr><td>แผงลูก (ส่วนกลาง)</td><td></td><td>แผงที่ไม่ใช่ห้องชุด คิด 100%</td><td class="r num">${fmt(Math.round(kidCommon), 0)}</td><td></td></tr>`);
    } else (p.kids || []).length && rows.push(`<tr><td>แผงลูก</td><td></td><td>รวมดีมานด์ของแผงที่รับไฟจากแผงนี้</td><td class="r num">${fmt(Math.round(p.demand - d.total), 0)}</td><td></td></tr>`);
    return `<table class="dt"><thead><tr><th>ประเภทโหลด</th><th class="r">Connected VA</th><th>หลักการ</th><th class="r">Demand VA</th><th>อ้างอิง</th></tr></thead><tbody>${rows.join('')}</tbody>
      <tfoot><tr><td>รวม</td><td class="r num">${fmt(Math.round(p.connected), 0)}</td><td>DF รวม = ${fmt(p.connected ? p.demand / p.connected : 1, 3)}</td><td class="r num">${fmt(Math.round(p.demand), 0)}</td><td></td></tr></tfoot></table>`;
  }

  /* ---------- ผังเส้นเดียว ---------- */
  // ป้าย CB ในผังเส้นเดียว 2 บรรทัด (ช่องแคบ): ยี่ห้อ = "Schneider NSX100F" / "40AT/100AF 36kA" ; ทั่วไป = ป้ายเดิม / "36kA"
  const sldCB = (cb) => (cb.bm ? [`${cb.bm.brandShort} ${cb.bm.model}`.slice(0, 22), `${cb.bm.af ? `${cb.at}AT/${cb.af}AF` : `${cb.at}A`} ${cb.ic}kA`] : [cb.label, `${cb.ic}kA`]);
  // ชั้นตามแบบแปลน: 1 → "1st FL." ... ; 0 → "G FL." ; ติดลบ → "B1 FL." ; ไม่ระบุ → ''
  function floorLabel(v) {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return '';
    const x = Number(v);
    if (Number.isFinite(x) && x * 2 % 2 === 1 && x > 0) return Math.floor(x) === 1 ? 'M FL.' : `${Math.floor(x)}M FL.`;   // ชั้นลอย (ครึ่งชั้น): 1.5 = M, 2.5 = 2M
    const n = Math.round(x);
    if (!Number.isFinite(n)) return '';
    if (n === 0) return 'G FL.';
    if (n < 0) return `B${-n} FL.`;
    const k = n % 100, suf = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return `${n}${suf} FL.`;
  }
  const ctPrimary = (at) => D.CT_PRIMARY.find((x) => x >= at) || D.CT_PRIMARY[D.CT_PRIMARY.length - 1];
  // ลดฟอนต์ให้ข้อความ (monospace ≈ 0.6 em ต่ออักขระ) พอดีช่องว่างที่มี
  const fitFont = (str, avail, base) => { const need = String(str).length * base * 0.6; return need > avail ? Math.max(6.5, Math.round(base * avail / need * 10) / 10) : base; };

  // ผังเส้นเดียว 12 องค์ประกอบตามแบบมาตรฐาน (The Kop Engineer) — แผนแม่บท 2.4 ; แต่ละองค์ประกอบมี data-el เพื่อทดสอบ/จัดสไตล์
  //   banner · source(Y) · meter(kWh) · demarcation · pothead+cable · enclosure(MDP) · instrument(Fuse 3x6A/Pilot x3/DP) · ct(3xCT) · maincb · busbar · ground(MBJ/Test link/Rod) · vtext · loadblock
  // เรขาคณิตส่วนหัว/ตู้ MDP ใช้ตัวเลขชุดเดียวกับ dxf.js (แก้ที่หนึ่งต้องแก้อีกที่)
  function sldSVG(result, fnum) {
    const byId = Object.fromEntries(result.panels.map((p) => [p.id, p]));
    const root = result.panels.find((p) => p.board.kind === 'MDB');
    const W = 168, H = 64, VG = 250;
    // จำนวนใบของต้นไม้ (รวมโหลดตรงของ SDB/MDB)
    // แผง tap ahead of main (NFPA 20) ไม่แขวนจากบัสบาร์ MDB : วาดเป็นกิ่งแยกจากสายประธานเหนือ Main CB ทางซ้ายของผัง
    const tapIds = new Set(result.panels.filter((p) => p.board.tap === 'ahead_of_main' && p.feeder && p.board.kind !== 'MDB').map((p) => p.id));
    const hung = (p) => (p.kids || []).map((id) => byId[id]).filter((k) => k && !(p === root && tapIds.has(k.id)));
    const leaves = (p) => { const k = hung(p); const direct = p.isLP ? 0 : p.circuits.length; const s = k.reduce((a, c) => a + leaves(c), 0) + direct; return Math.max(1, s); };
    const taps = result.panels.filter((p) => tapIds.has(p.id));
    const TAP_LABEL = 'FIRE PUMP FEEDER (TAP AHEAD OF MAIN - MAG ONLY CB)';
    const tapSpans = taps.map((t) => Math.max(leaves(t) * W, 252));
    const ox = taps.length ? tapSpans.reduce((a, b) => a + b, 0) + 40 : 0;   // ระยะที่ดันผังหลักไปทางขวาเพื่อเว้นที่ให้กิ่ง tap
    const X0 = 40 + ox;
    let svg = '';
    const total = leaves(root);
    let maxDepth = 0;
    const s = result.service;
    const mcb = s.mainCB;
    const util = (s.meter && s.meter.utility) || (result.meta && result.meta.utility) || 'MEA';
    const volt = s.phases === 1 ? '1Φ 2W 230V' : '3Φ 4W 230/400V';
    const nph = s.phases === 1 ? 1 : 3;
    // ---- เรขาคณิต ----
    const cx = X0 + (total * W) / 2;
    const ENC_TOP = 224, TOPY = 356, ENC_BOT = TOPY + 114;
    const TAPY = 216, TAP_BOX_Y = TOPY + 40;   // จุดแยกอยู่บนสายประธานเหนือ Main CB (ใต้ข้อความสายประธาน เหนือกรอบตู้ MDB)
    const bwRoot = Math.min(total * W - 20, Math.max(240, total * W * 0.6));
    const xL = 44 + ox, xR = Math.max(X0 + total * W - 4, cx + 250, cx + bwRoot / 2 + 20), xG = xR + 60;
    const width = Math.max(ox + total * W + 80, 700, xG + 230);
    const left = Math.max(12, cx - 210), bcx = Math.max(cx, 182);
    const avail = VG - 126;   // ความยาวที่ใช้ได้ของข้อความสายแนวตั้ง (px)
    const vtx = (x, y, str, fill) => `<text data-el="vtext" class="mono" transform="rotate(-90 ${x} ${y})" x="${x}" y="${y}" font-size="${fitFont(str, avail, 9.5)}" fill="${fill || '#1f5d94'}">${esc(str)}</text>`;
    // ระบบไฟฟ้าฉุกเฉิน: ATS บนสายป้อนเข้าแผงฉุกเฉิน + เครื่องกำเนิดไฟฟ้า (G) ต่อเข้าอีกขาของ ATS ทางซ้าย ; ขนาดอยู่ในคำอธิบายด้านล่าง
    const gen = s.generator;
    const isEm = (p) => !!(gen && gen.panels.some((q) => q.id === p.id));
    const atsSym = (x, y0) => `<g class="n"><path class="wire em" d="M${x - 12} ${y0 + 6} H${x - 21}"/><rect class="box em" x="${x - 12}" y="${y0}" width="24" height="12" rx="2"/><text x="${x}" y="${y0 + 9}" text-anchor="middle" font-size="7.5" font-weight="700" class="em-t">ATS</text>
      <circle cx="${x - 30}" cy="${y0 + 6}" r="9" class="box em"/><text x="${x - 30}" y="${y0 + 10}" text-anchor="middle" font-size="10" font-weight="700" class="em-t">G</text></g>`;
    function draw(p, x0, depth, y) {
      maxDepth = Math.max(maxDepth, depth);
      const span = leaves(p) * W;
      const pcx = x0 + span / 2;
      const isRoot = p.board.kind === 'MDB';
      const bw = isRoot ? Math.min(span - 20, Math.max(240, span * 0.6)) : W - 26;
      if (isRoot) {
        svg += `<g class="n" style="animation-delay:${depth * 120}ms"><rect class="box${isEm(p) ? ' em' : ''}" x="${pcx - bw / 2}" y="${y}" width="${bw}" height="${H - 18}" rx="2"/>
        <text x="${pcx}" y="${y + 18}" text-anchor="middle" font-weight="600" font-size="13">${esc(p.board.name)}</text>
        <text x="${pcx}" y="${y + 34}" text-anchor="middle" font-size="10.5" class="mono" fill="#4f5b66">${fmt(p.demand / 1000, 1)} kVA${p.layout ? ` · ${p.layout.ways} ช่อง` : ` · bus ${p.busbar}A`}</text></g>`;
      } else {
        // โหลดปลายทาง = บล็อกสี่เหลี่ยมทึบสีดำ ระบุชื่อแผง + ชั้น (แผนแม่บท 2.4 ข้อ 12)
        const fl = floorLabel(p.board.floor);
        svg += `<g class="n" data-el="loadblock" style="animation-delay:${depth * 120}ms"><rect class="box load-block${p.board.kind === 'SDB' ? ' sdb' : ''}${isEm(p) ? ' em' : ''}" x="${pcx - bw / 2}" y="${y}" width="${bw}" height="${H - 18}" rx="2"/>
        <text class="lb-t" x="${pcx}" y="${y + (fl ? 14 : 19)}" text-anchor="middle" font-weight="700" font-size="12.5">${esc(p.board.name)}</text>
        ${fl ? `<text class="lb-t" x="${pcx}" y="${y + 28}" text-anchor="middle" font-size="10" font-weight="600">(${esc(fl)})</text>` : ''}
        <text class="lb-t" x="${pcx}" y="${y + (fl ? 41 : 35)}" text-anchor="middle" font-size="9.5">${fmt(p.demand / 1000, 1)} kVA${p.layout ? ` · ${p.layout.ways} ช่อง` : ` · bus ${p.busbar}A`}</text></g>`;
      }
      const kids = hung(p);
      const direct = p.isLP ? [] : p.circuits;
      const slots = [];
      let x = x0;
      kids.forEach((k) => { const sp = leaves(k) * W; slots.push({ k, x, cx: x + sp / 2 }); x += sp; });
      direct.forEach((c) => { slots.push({ c, x, cx: x + W / 2 }); x += W; });
      const busY = y + H + 8;
      if (isRoot) {
        // บัสบาร์ประธาน: เส้นหนา + ป้ายสเปก (แผนแม่บท 2.4 ข้อ 10)
        const bx1 = Math.min(pcx, slots.length ? slots[0].cx : pcx) - 24, bx2 = Math.max(pcx, slots.length ? slots[slots.length - 1].cx : pcx) + 24;
        svg += `<path class="wire" d="M${pcx} ${y + H - 18} V${busY}"/><path class="wire" d="M${bx1} ${busY} H${bx2}" style="stroke-width:3.4"/>
          <g class="n" data-el="busbar"><text x="${bx1}" y="${busY - 6}" font-size="9" class="mono">4x${esc(p.busbar || s.busbar)}A, Cu. BUSBAR W/GROUND BUS</text></g>`;
      }
      if (!slots.length) return;
      if (!isRoot) {
        svg += `<path class="wire" d="M${pcx} ${y + H - 18} V${busY}"/>`;
        if (slots.length > 1) svg += `<path class="wire" d="M${slots[0].cx} ${busY} H${slots[slots.length - 1].cx}" style="stroke-width:2.6"/>`;
      }
      slots.forEach((sl) => {
        const yc = busY, ny = y + VG;
        const cbY = yc + 22;
        // สัญลักษณ์เบรกเกอร์ (โค้ง)
        svg += `<path class="wire" d="M${sl.cx} ${yc} V${cbY - 8}"/><path class="wire" d="M${sl.cx} ${cbY - 8} q 9 8 0 16"/><circle cx="${sl.cx}" cy="${cbY - 8}" r="1.8" fill="#1d262f"/><circle cx="${sl.cx}" cy="${cbY + 8}" r="1.8" fill="#1d262f"/>`;
        if (sl.k) {
          const f = sl.k.feeder;
          const fl = sldCB(f.cb);
          svg += `<text x="${sl.cx + 13}" y="${cbY + 2}" font-size="10" class="mono">${esc(fl[0])}</text>
            <text x="${sl.cx + 13}" y="${cbY + 14}" font-size="9.5" class="mono" fill="#4f5b66">${esc(fl[1])}</text>
            <path class="wire" d="M${sl.cx} ${cbY + 8} V${ny}"/>
            ${vtx(sl.cx + 17, ny - 6, `${f.text} ${cableShort(f.cable)}`)}${vtx(sl.cx + 29, ny - 6, f.raceway)}`;
          if (isEm(sl.k)) svg += atsSym(sl.cx, cbY + 43); // ใต้ป้าย CB เหนือกล่องแผง
          draw(sl.k, sl.x, depth + 1, ny);
        } else {
          const c = sl.c;
          const cb = c.cb;
          const cl = sldCB(cb);
          svg += `<text x="${sl.cx + 13}" y="${cbY + 2}" font-size="10" class="mono">${esc(cl[0])}</text>${cb.bm ? `<text x="${sl.cx + 13}" y="${cbY + 14}" font-size="9.5" class="mono" fill="#4f5b66">${esc(cl[1])}</text>` : ''}
            <path class="wire" d="M${sl.cx} ${cbY + 8} V${ny + 8}"/>
            ${c.cond ? vtx(sl.cx + 17, ny - 6, `${c.cond.text} ${cableShort(c.cond.cable)}`) : ''}${c.conduit && c.conduit.inch !== '-' ? vtx(sl.cx + 29, ny - 6, `${c.conduit.inch}" ${c.conduit.type}`) : ''}
            <g class="n"><circle cx="${sl.cx}" cy="${ny + 24}" r="15" class="box"/><text x="${sl.cx}" y="${ny + 28.5}" text-anchor="middle" font-size="12" font-weight="600">${c.firePump ? 'FP' : c.motor ? 'M' : c.cat === 'chiller' ? 'CH' : 'L'}</text>
            <text x="${sl.cx}" y="${ny + 56}" text-anchor="middle" font-size="10.5">${esc(c.desc.slice(0, 22))}</text>
            <text x="${sl.cx}" y="${ny + 69}" text-anchor="middle" font-size="9.5" class="mono" fill="#4f5b66">${c.motor && c.motor.kw ? esc(c.motor.kw) + ' kW' : fmt(c.va / 1000, 1) + ' kVA'}</text></g>`;
          maxDepth = Math.max(maxDepth, depth + 1);
        }
      });
    }
    const G = (name, inner) => `<g class="n" data-el="${name}">${inner}</g>`;
    let head = '';
    // 1) ป้ายหัวผัง (แคปซูล)
    head += G('banner', `<rect class="box" x="${bcx - 170}" y="8" width="340" height="26" rx="13"/><text x="${bcx}" y="26" text-anchor="middle" font-size="13" font-weight="700">ELECTRICAL SINGLE LINE DIAGRAM</text>`);
    // 2) แหล่งจ่าย: สัญลักษณ์ Y + ระดับแรงดัน
    head += G('source', `<path class="wire" d="M${cx - 7} 44 L${cx} 56 L${cx + 7} 44 M${cx} 56 V92"/><text x="${cx + 14}" y="54" font-size="11" font-weight="600">${volt} FROM ${esc(util)}.</text>`);
    // 4) เส้นแบ่งเขตกรรมสิทธิ์ (เส้นประจุด)
    head += G('demarcation', `<path class="dem" d="M${left} 76 H${cx + 210}" fill="none" stroke="#1d262f" stroke-width="1.2" stroke-dasharray="12 3 2 3"/><text x="${left + 4}" y="71" font-size="9.5" font-weight="700">BY ${esc(util)}.</text><text x="${cx + 206}" y="89" text-anchor="end" font-size="9.5" font-weight="700">BY OWNER</text>`);
    // หม้อแปลง (ถ้าเจ้าของอาคารมีหม้อแปลงเอง)
    if (s.trafo) head += G('transformer', `<circle cx="${cx}" cy="108" r="14" class="box"/><circle cx="${cx}" cy="128" r="14" class="box"/>
      <text x="${cx + 24}" y="110" font-size="12" font-weight="600">TR ${esc(s.trafo.kva)} kVA</text>
      <text x="${cx + 24}" y="124" font-size="10" class="mono" fill="#4f5b66">${esc(s.trafo.z)}%Z · ${esc(result.meta.hvKV)}kV/230-400V · HV fuse ${esc(s.hv.fuse)}A</text>`);
    // 3) มิเตอร์การไฟฟ้า (วงกลม kWh ต่อขนาน)
    head += G('meter', `<path class="wire" d="M${cx} 152 H${cx - 50}"/><circle cx="${cx - 64}" cy="152" r="14" class="box"/><text x="${cx - 64}" y="156" text-anchor="middle" font-size="10" font-weight="600">kWh</text>
      <text x="${cx - 64}" y="178" text-anchor="middle" font-size="9.5" class="mono">${s.meter ? `${esc(s.meter.utility)} ${esc(s.meter.size)}` : `${esc(util)} CT METER`}</text>`);
    // 5) หัวต่อสาย (Pothead) + สายประธาน
    head += G('pothead', `<path class="wire" d="M${cx} 92 V170"/><path class="box" d="M${cx - 9} 170 H${cx + 9} L${cx} 186 Z"/><path class="wire" d="M${cx} 186 V244"/>
      <text x="${cx + 14}" y="180" font-size="9" class="mono">POTHEAD</text>
      <text x="${cx + 14}" y="196" font-size="9.5" class="mono" fill="#1f5d94">${esc(s.mainFeeder.text)} ${esc(cableShort(s.mainFeeder.cable))}</text><text x="${cx + 14}" y="208" font-size="9.5" class="mono" fill="#1f5d94">${esc(s.mainFeeder.raceway)}</text>`);
    // 6) กรอบตู้สวิตช์ประธาน MDP (เส้นประ) ระบุ IC
    head += G('enclosure', `<rect class="encl" x="${xL}" y="${ENC_TOP}" width="${xR - xL}" height="${ENC_BOT - ENC_TOP}" rx="3" fill="none" stroke="#1d262f" stroke-width="1.2" stroke-dasharray="8 4"/><text x="${xL + 8}" y="${ENC_TOP + 14}" font-size="10" font-weight="700">MDB ENCLOSURE · IC ≥ ${esc(mcb.ic)}kA.</text>`);
    // 9) เบรกเกอร์ประธาน
    head += G('maincb', `<path class="wire" d="M${cx} 244 q 9 8 0 16"/><circle cx="${cx}" cy="244" r="1.8" fill="#1d262f"/><circle cx="${cx}" cy="260" r="1.8" fill="#1d262f"/><path class="wire" d="M${cx} 260 V${TOPY}"/>
      <text x="${cx + 14}" y="248" font-size="10" class="mono">${esc(mcb.label)} ${esc(mcb.ic)}kA</text><text x="${cx + 14}" y="260" font-size="9.5" class="mono" fill="#4f5b66">${mcb.poles || (nph === 3 ? 3 : 2)}P</text>`);
    // 8) หม้อแปลงกระแส
    head += G('ct', `<circle cx="${cx - 8}" cy="286" r="5" class="instr"/><circle cx="${cx}" cy="286" r="5" class="instr"/><circle cx="${cx + 8}" cy="286" r="5" class="instr"/><text x="${cx + 18}" y="290" font-size="9.5" class="mono">${nph}xCT ${ctPrimary(mcb.at)}/5A</text>`);
    // 7) วงจรวัดหน้าตู้: Fuse 3x6A → Pilot Lamps (x3) → Digital Meter [DP]
    head += G('instrument', `<path class="wire" d="M${cx} 310 H${cx + 50} M${cx + 72} 310 H${cx + 96} M${cx + 149} 310 H${cx + 176}"/>
      <rect class="instr" x="${cx + 50}" y="304" width="22" height="12"/><text x="${cx + 50}" y="300" font-size="9" class="mono">Fuse 3x6A</text>
      <circle cx="${cx + 106}" cy="310" r="7" class="instr"/><circle cx="${cx + 124}" cy="310" r="7" class="instr"/><circle cx="${cx + 142}" cy="310" r="7" class="instr"/><text x="${cx + 96}" y="332" font-size="9" class="mono">Pilot Lamps (x3)</text>
      <rect class="instr" x="${cx + 176}" y="296" width="40" height="28"/><text x="${cx + 196}" y="314" text-anchor="middle" font-size="12" font-weight="700">DP</text><text x="${cx + 176}" y="338" font-size="9" class="mono">Digital Meter</text>`);
    // 11) ระบบต่อลงดิน: MBJ → Test Link → Ground Rod ≤ 5 Ω
    const gy = TOPY + 23, gEnd = gy + 180, bxr = cx + bwRoot / 2;
    const gtext = `1x${s.gec}-IEC01, ⌀20 PVC.`;
    head += G('ground', `<path class="wire gnd" d="M${bxr} ${gy} H${xG} V${gEnd}"/><text x="${bxr + 10}" y="${gy - 5}" font-size="9.5" font-weight="700">MBJ</text>
      <rect class="instr" x="${xG - 9}" y="${gy + 28}" width="18" height="14"/><text x="${xG + 14}" y="${gy + 39}" font-size="9" class="mono">TEST LINK</text>
      <path class="wire gnd" d="M${xG - 11} ${gEnd} h22 M${xG - 7} ${gEnd + 6} h14 M${xG - 3} ${gEnd + 12} h6"/>
      <text x="${xG + 16}" y="${gEnd + 6}" font-size="9.5" class="mono">GROUND ROD 5/8" x 10 FT</text><text x="${xG + 16}" y="${gEnd + 19}" font-size="9.5" class="mono">R ≤ 5 Ω</text>
      <text class="mono" transform="rotate(-90 ${xG - 7} ${gEnd - 6})" x="${xG - 7}" y="${gEnd - 6}" font-size="${fitFont(gtext, gEnd - 6 - (gy + 46), 9.5)}" fill="#1f5d94">${esc(gtext)}</text>`);
    draw(root, X0, 0, TOPY);
    let height = TOPY + (maxDepth + 1) * VG + 80;
    if (taps.length) {
      // กิ่ง tap ahead of main : จุดต่อบนสายประธาน (cx, TAPY) → เส้นแนวนอนไปทางซ้าย → CB (Mag-only) + สาย → บล็อกแผง ; กรอบประสีแดงมีป้ายกำกับ
      const m0 = maxDepth;
      const drops = [];
      let xs = 40, bottom = 0, tg = '', ats = '';
      taps.forEach((tp, i) => {
        const sub = leaves(tp) * W, x0 = xs + (tapSpans[i] - sub) / 2, tx = x0 + sub / 2, f = tp.feeder, fl = sldCB(f.cb), cbY = TAPY + 22;
        xs += tapSpans[i];
        drops.push(tx);
        tg += `<path class="wire em" d="M${tx} ${TAPY} V${cbY - 8}"/><path class="wire em" d="M${tx} ${cbY - 8} q 9 8 0 16"/><circle class="em-t" cx="${tx}" cy="${cbY - 8}" r="1.8"/><circle class="em-t" cx="${tx}" cy="${cbY + 8}" r="1.8"/>
          <text x="${tx + 13}" y="${cbY + 2}" font-size="10" class="mono">${esc(fl[0])}</text><text x="${tx + 13}" y="${cbY + 14}" font-size="9.5" class="mono" fill="#4f5b66">${esc(fl[1])}</text>
          <path class="wire em" d="M${tx} ${cbY + 8} V${TAP_BOX_Y}"/>${vtx(tx + 17, TAP_BOX_Y - 6, `${f.text} ${cableShort(f.cable)}`)}${vtx(tx + 29, TAP_BOX_Y - 6, f.raceway)}`;
        if (isEm(tp)) ats += atsSym(tx, cbY + 43);
        maxDepth = 0;
        draw(tp, x0, 1, TAP_BOX_Y);
        bottom = Math.max(bottom, TAP_BOX_Y + (maxDepth - 1) * VG + 88);
      });
      maxDepth = m0;
      const bx0 = 24, bw0 = ox - 16, by0 = TAPY - 26;
      svg += `<g class="n" data-el="tap-ahead"><path class="wire em" d="M${cx} ${TAPY} H${Math.min(...drops)}"/><circle class="em-t" cx="${cx}" cy="${TAPY}" r="2.4"/>${tg}
        <rect data-el="tap-box" class="encl em" x="${bx0}" y="${by0}" width="${bw0}" height="${bottom - by0}" rx="3" fill="none" stroke-width="1.2" stroke-dasharray="8 4"/>
        <text data-el="tap-label" class="mono em-t" x="${bx0 + 8}" y="${TAPY - 10}" font-size="${fitFont(TAP_LABEL, bw0 - 16, 9.5)}" font-weight="700">${esc(TAP_LABEL)}</text></g>${ats}`;
      height = Math.max(height, bottom + 60);
    }
    if (gen) svg += `<text x="40" y="${height - 14}" font-size="10.5" class="mono em-t">G = เครื่องกำเนิดไฟฟ้า ${esc(gen.kva)} kVA Standby · CB ${esc(gen.cb.label)} · ${gen.panels.map((q) => `${esc(q.name)}: ${esc(q.ats.label)}`).join(' · ')}</text>`;
    return `<svg class="sld" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${head}${svg}${sldWatermark(width, height)}</svg>`.replace(/class="wire/g, 'pathLength="1" class="wire');
  }

  /* ---------- CSV / รายงานพิมพ์ ---------- */
  // เวอร์ชันสาธิต: ตัวสร้างไฟล์ CSV และรายงาน PDF ถูกถอดออกจากซอร์สทั้งหมด (ไม่ใช่แค่ซ่อนปุ่ม) — เรียกแล้วได้แต่หน้าต่าง "Ver.DEMO"
  const blockedExport = (fmt) => () => { const g = root.DemoGuard; if (g) g.interceptExport(fmt); return ''; };
  const csvCell = (v) => (v == null ? '' : String(v));   // ใช้ในตัวแสดงผลบนหน้าจอเท่านั้น
  const panelCSVRows = () => [];
  const allCSV = blockedExport('CSV');
  const panelCSV = blockedExport('CSV');

  /* ---------- รายงานสำหรับพิมพ์ ---------- */
  // โลโก้บริษัท: ฝังได้เฉพาะ data URL รูปแรสเตอร์ (png/jpeg/webp) ขนาดจำกัด — กันสคริปต์/URL ภายนอก (เหมือนกฎใน sanitize.js)
  const logoSrc = (v) => (typeof v === 'string' && v.length <= 150000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : '');
  // เลขที่ใบอนุญาต กว.: "กว. <ระดับ ภฟก./สฟก./วฟก.> <เลขที่>"
  const licHTML = (tier, no) => (tier || no ? `<div class="tb-lic">กว. ${esc(tier || '')}${tier && no ? ' ' : ''}${esc(no || '')}</div>` : '');
  function titleBlock(m, sheet, title) {
    const logo = logoSrc(m.logo);
    return `<div class="tb"><div class="tb-logo">${logo ? `<img src="${esc(logo)}" alt="โลโก้ ${esc(m.owner || m.name || '')}">` : '<span class="tb-logo-ph">LOGO</span>'}</div>
      <div class="tb-l"><div class="tb-proj">${esc(m.name)}</div><div class="tb-sub">${esc(m.owner || '')} ${m.location ? '· ' + esc(m.location) : ''}</div></div>
      <div class="tb-c"><div class="tb-k">TITLE</div><div>${esc(title)}</div></div>
      <div class="tb-c"><div class="tb-k">DESIGN</div><div>${esc(m.designer || '-')}</div>${licHTML(m.licenseTier, m.designerLicense)}</div>
      <div class="tb-c"><div class="tb-k">CHECK</div><div>${esc(m.checker || '-')}</div>${licHTML('', m.checkerLicense)}</div>
      <div class="tb-c"><div class="tb-k">DATE</div><div>${esc(m.date)}</div></div>
      <div class="tb-c sheetno"><div class="tb-k">SHEET</div><div>${sheet}</div></div></div>`;
  }
  function serviceHTML(result) {
    const s = result.service, m = result.meta;
    const rows = [];
    if (s.trafo) {
      rows.push(['หม้อแปลง', `${s.trafo.kva} kVA, ${m.hvKV} kV/230-400 V, %Z ${s.trafo.z}`]);
      rows.push(['ด้านแรงสูง', `I = ${fmt(s.hv.I)} A · HV fuse ${s.hv.fuse} A · สาย CV ${s.hv.cable} mm² (${m.hvKV} kV)`]);
    } else rows.push(['เครื่องวัดฯ', `${s.meter.utility === 'MEA' ? 'กฟน.' : 'กฟภ.'} ${s.meter.size}`]);
    rows.push(['CB ประธาน', `${s.mainCB.label} · IC ${s.mainCB.ic} kA · Busbar ${s.busbar} A`]);
    rows.push(['สายประธานแรงต่ำ', `${s.mainFeeder.text} · ${s.mainFeeder.raceway} · ยาว ${m.main.length} m`]);
    rows.push(['สายต่อหลักดิน', `${s.gec} mm² (ตาราง 4.1)`]);
    rows.push(['กระแสลัดวงจร MDB', `Ik" = ${fmt(s.scMDB.Ik, 2)} kA · ip = ${fmt(s.scMDB.ip, 2)} kA`]);
    if (s.generator) {
      const g = s.generator;
      rows.push(['เครื่องกำเนิดไฟฟ้า', `${g.kva} kVA Standby (Prime ≈ ${fmt(g.primeKVA, 0)} kVA) · โหลดฉุกเฉิน ${fmt(g.demandKVA, 2)} kVA · CB ${g.cb.label}`]);
      rows.push(['ATS', `${g.ats.label} (≥ 1.25 × ${fmt(g.I)} A)${g.panels.length > 1 ? ' · แยกแผง: ' + g.panels.map((p) => `${p.name} ${p.ats.label}`).join(', ') : ''}`]);
    }
    rows.push(['ตัวเก็บประจุ', s.pfc.smallLV ? 'ไม่ต้องติดตั้ง (ผู้ใช้ไฟรายเล็กรับไฟแรงต่ำ การไฟฟ้าไม่คิดค่าตัวประกอบกำลัง)' : `${fmt(s.pfc.kvar, 1)} kVAR → ตู้ ${s.pfc.bank} kVAR (pf ${m.pfNow} → ${m.pfTarget})`]);
    return `<table class="dt">${rows.map((r) => `<tr><th style="width:170px">${r[0]}</th><td>${esc(r[1])}</td></tr>`).join('')}</table>`;
  }
  function bomHTML(result) {
    const b = result.bom;
    return `<div class="grid3">
      <div><div class="label">สายไฟ</div><table class="dt"><thead><tr><th>ชนิด</th><th class="r">mm²</th><th class="r">ยาว (m)</th></tr></thead><tbody>${b.cables.map((c) => `<tr><td>${esc(c.type)}</td><td class="r num">${esc(c.size)}</td><td class="r num">${fmt(c.length, 0)}</td></tr>`).join('')}</tbody></table></div>
      <div><div class="label">ท่อร้อยสาย</div><table class="dt"><thead><tr><th>ชนิด</th><th class="r">ขนาด</th><th class="r">ยาว (m)</th></tr></thead><tbody>${b.conduits.map((c) => `<tr><td>${esc(c.type)}</td><td class="r num">${esc(c.size)}"</td><td class="r num">${fmt(c.length, 0)}</td></tr>`).join('')}</tbody></table></div>
      <div><div class="label">เบรกเกอร์</div><table class="dt"><thead><tr><th>รายการ</th><th>ขั้ว</th><th>IC</th><th class="r">จำนวน</th></tr></thead><tbody>${b.breakers.map((c, i, a) => `${c.brand && (i === 0 || a[i - 1].brand !== c.brand || a[i - 1].model !== c.model) ? `<tr class="br-grp"><td colspan="4"><b>${esc(c.brand)} ${esc(c.model)}</b> <span class="muted tiny">${esc(c.ref || '')}</span></td></tr>` : ''}<tr><td>${esc(c.label)}${c.rcd ? ' <span class="rcd">RCBO</span>' : ''}</td><td>${esc(c.poles)}</td><td>${esc(c.ic)}</td><td class="r num">${esc(c.qty)}</td></tr>`).join('')}</tbody></table>${b.breakers.some((c) => c.brand) ? '<div class="tiny muted">รุ่นตามยี่ห้อ: ข้อมูลผู้ผลิตที่รวบรวมจากการค้นเว็บ — ตรวจกับแคตตาล็อกก่อนสั่งซื้อ</div>' : ''}
      <div class="label" style="margin-top:12px">ตู้/แผง</div><table class="dt"><tbody>${b.boards.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.ways ? esc(x.ways) + ' ช่อง' : esc(KIND_TH[x.kind])}</td><td class="num">bus ${esc(x.busbar)}A</td><td class="num">${esc(x.main)}</td></tr>`).join('')}</tbody></table>
      ${(b.equipment || []).length ? `<div class="label" style="margin-top:12px">ระบบไฟฟ้าฉุกเฉิน</div><table class="dt"><tbody>${b.equipment.map((x) => `<tr><td>${esc(x.label)}</td><td class="r num">${esc(x.qty)}</td></tr>`).join('')}</tbody></table>` : ''}</div></div>`;
  }

  // รุ่นเบรกเกอร์ตามยี่ห้อที่ใช้ในแปลน + แคตตาล็อกอ้างอิง (ภาคผนวกรายงาน) ; ไม่มี CB ที่เลือกยี่ห้อ = ''
  function brandRefsHTML(result) {
    const used = new Map();
    const add = (cb) => { if (!cb || !cb.bm) return; const u = used.get(cb.bm.id) || { bm: cb.bm, n: 0, at: new Set() }; u.n++; u.at.add(cb.at); used.set(cb.bm.id, u); };
    result.panels.forEach((p) => { p.circuits.forEach((c) => add(c.cb)); if (p.feeder) add(p.feeder.cb); if (p.layout) p.layout.slots.forEach((s) => { if (s && s.auto) add(s.cb); }); });
    add(result.service.mainCB);
    if (!used.size) return '';
    const rows = [...used.values()].sort((a, b) => a.bm.brandShort.localeCompare(b.bm.brandShort) || a.bm.model.localeCompare(b.bm.model, 'en', { numeric: true }));
    const anyV = rows.some(({ bm }) => bm.verified), anyU = rows.some(({ bm }) => !bm.verified);
    const docs = new Map();
    rows.forEach(({ bm }) => { if (bm.verified && !docs.has(bm.srcDoc)) docs.set(bm.srcDoc, bm.srcUrl); });
    const note = `${anyV ? 'รุ่นที่มีเครื่องหมาย ✔ อ่านค่า Icu/Ics/AT จากแคตตาล็อกฉบับทางการตามเลขหน้าที่ระบุ (ค่า Ii เป็นขอบล่างอนุรักษ์ ไม่ใช่ค่าตั้งของผู้ใช้)' : ''}${anyV && anyU ? ' · ' : ''}${anyU ? 'รุ่นที่ไม่มีเครื่องหมายรวบรวมจากการค้นเว็บ ยังไม่ผูกแคตตาล็อกรายแถว' : ''} — ตรวจค่า Icu/Ics/ค่าตัดทันที/ตาราง selectivity กับแคตตาล็อกฉบับล่าสุดก่อนใช้งานจริง`;
    return `<p class="muted">${esc(note)}</p>${docs.size ? `<p class="tiny">เอกสารต้นทาง: ${[...docs].map(([d, u]) => `${esc(d)} — ${esc(u)}`).join(' ; ')}</p>` : ''}
      <table class="dt"><thead><tr><th>ยี่ห้อ / ซีรีส์</th><th>รุ่น</th><th class="r">AF</th><th>AT ที่ใช้</th><th class="r">IC (kA)</th><th class="r">Ics</th><th>Trip unit / เส้นโค้ง</th><th class="r">จำนวน</th><th>แคตตาล็อกอ้างอิง</th></tr></thead><tbody>
      ${rows.map(({ bm, n, at }) => `<tr><td>${esc(bm.brand)} · ${esc(bm.series)}</td><td class="num"><b>${esc(bm.model)}</b></td><td class="r num">${esc(bm.af || '-')}</td><td class="num">${[...at].sort((x, y) => x - y).join(', ')}</td><td class="r num">${bm.type === 'MCCB' ? `Icu ${esc(bm.icu)}` : `Icn ${esc(bm.icn)}`}</td><td class="r num">${bm.ics != null ? `${esc(bm.ics)} (${esc(bm.icsPct)}%)` : '-'}</td><td class="tiny">${esc(bm.trip)}${bm.type === 'RCBO' ? ` · RCD ${esc(bm.rcdMA)} mA Type ${esc(bm.rcdTypes.join('/'))}` : ''}</td><td class="r num">${n}</td><td class="tiny">${bm.verified ? '✔ ' : ''}${esc(bm.ref)}${bm.verified ? ` — หน้า ${esc(bm.srcPages.join(', '))}` : ' (ยังไม่ผูกแคตตาล็อก)'}</td></tr>`).join('')}</tbody></table>`;
  }

  // รายงานสำหรับพิมพ์/PDF: ถอดออกจากเวอร์ชันสาธิต (ไม่มีตัวประกอบหน้า E-xx / ภาคผนวก C-xx ในซอร์ส)
  function reportHTML() {
    const g = root.DemoGuard; if (g) g.interceptExport('PDF');
    return '<div class="demo-blocked"><h1>Ver.DEMO</h1><p>การสร้างรายงาน PDF ปิดใช้งานในเวอร์ชันสาธิต</p></div>';
  }

  root.Report = { titleBlock, floorLabel, brandRefsHTML, panelScheduleHTML, feederScheduleHTML, selectivityHTML, feederRows, stepsHTML, coordTag, demandStepsHTML, sldSVG, serviceHTML, bomHTML, allCSV, panelCSV, reportHTML, feederNumbers, panelRows, esc, KIND_TH, BT_TH, cableShort, cbCell, csvCell, genCB };
})(typeof self !== 'undefined' ? self : this);
