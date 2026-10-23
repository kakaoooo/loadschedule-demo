/* หน้าจอหลัก */
(function () {
  'use strict';
  const E = window.LoadEngine, D = window.LS_DATA, R = window.Report, I = window.ICON, SAN = window.Sanitize;
  const fmt = E.fmt, esc = R.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const STORE = 'load-schedule-project-v1';
  // โทเค็นต่อการรันของเซิร์ฟเวอร์ (กันเว็บอื่นยิง API มาที่ localhost) — เซิร์ฟเวอร์ใส่ใน <meta name="ls-token">
  const TOKEN = (document.querySelector('meta[name="ls-token"]') || {}).content || '';
  // เวอร์ชันสาธิต (DemoGuard.isDemo()): ไม่มีการส่งออกไฟล์/พิมพ์ และไม่คุยกับ server.js (ใช้ localStorage + Supabase เท่านั้น)
  const DEMO = () => !!(window.DemoGuard && window.DemoGuard.isDemo && window.DemoGuard.isDemo());
  // ป้าย CB บนหน้าจอ: ถ้าเลือกยี่ห้อ ต่อท้ายรุ่นด้วยสเปกในวงเล็บ (รายงาน/ตาราง generic ไม่ใช้)
  const cbShow = (cb) => (cb && cb.bm && window.LS_BRANDCB && window.LS_BRANDCB.labelSpec ? window.LS_BRANDCB.labelSpec(cb) : (cb ? cb.label : ''));
  const demoBlock = (fmtName) => { if (!DEMO()) return false; window.DemoGuard.interceptExport(fmtName, typeof project !== 'undefined' && project && project.meta ? project.meta.name : ''); return true; };
  const api = (url, opts = {}) => fetch(url, Object.assign({}, opts, { headers: Object.assign({ 'x-ls-token': TOKEN }, opts.headers || {}) }));

  /* ================= state ================= */
  const loaded = load();
  let project = loaded || window.SAMPLE_PROJECT();
  let result = null;
  let tab = 'dash';
  let selected = firstSelectable(project);
  let logView = { scope: 'all', type: '' };      // ตัวกรองบันทึกกิจกรรมในแท็บ "ภาพรวม"
  let warnView = { cat: '' };                    // ตัวกรองหมวดคำเตือน
  const cmpSel = { a: null, b: null };           // แปลนที่เลือกเปรียบเทียบ (id)
  let drawerState = null;
  const seen = new Set();   // id ที่เคยแสดงแล้ว — ใช้เล่นแอนิเมชันเฉพาะของใหม่

  function firstSelectable(p) { return (p.panels.find((x) => x.kind === 'LP') || p.panels[0]).id; }
  // อ่านจาก localStorage แล้วผ่านตัวล้างข้อมูลเสมอ — ข้อมูลเสียจะถูกสำรองไว้ที่คีย์ -bad แล้วเริ่มด้วยโครงการตัวอย่าง
  function load() {
    let s = null;
    try {
      s = localStorage.getItem(STORE);
      return s ? SAN.project(JSON.parse(s)).project : null;
    } catch (e) {
      try { if (s) localStorage.setItem(STORE + '-bad', s); localStorage.removeItem(STORE); } catch (e2) { /* ignore */ }
      return null;
    }
  }
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);

  /* ================= ห้องสมุดแปลน + บันทึกกิจกรรม (จำไว้ในเบราว์เซอร์) =================
   * library = แปลน (โครงการ) ทั้งหมดที่เคยเปิด — บันทึกอัตโนมัติทุกครั้งที่คำนวณผ่าน, สลับ/ทำสำเนา/ลบได้จากแท็บ "ภาพรวม"
   * logs    = ประวัติการแก้ไข (ใคร/อะไร/เมื่อไร) ล่าสุดก่อน เก็บสูงสุด MAX_LOG รายการ */
  const LIB = 'load-schedule-library-v1', LOGK = 'load-schedule-log-v1', ACTIVE = 'load-schedule-active-v1';
  const MAX_PLANS = 30, MAX_LOG = 800;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const readList = (k) => { try { const v = JSON.parse(lsGet(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const PLAN_ID = /^[A-Za-z0-9_-]{1,40}$/;
  const LOG_TYPES = { plan: 'แปลน', item: 'อุปกรณ์', panel: 'แผง', circuit: 'วงจร', breaker: 'เบรกเกอร์', balance: 'Balance', setting: 'ตั้งค่า', file: 'ไฟล์', import: 'นำเข้า' };
  const okPlan = (x) => x && typeof x === 'object' && PLAN_ID.test(String(x.id)) && x.project && typeof x.project === 'object' && typeof x.updated === 'number';
  const okLog = (x) => x && typeof x === 'object' && typeof x.t === 'number' && typeof x.msg === 'string' && Object.prototype.hasOwnProperty.call(LOG_TYPES, x.type);
  const readLib = () => readList(LIB).filter(okPlan);
  const readLogs = () => readList(LOGK).filter(okLog);
  let library = readLib();
  let logs = readLogs().slice(0, MAX_LOG);
  let planId = lsGet(ACTIVE);
  // โครงการหลัก (STORE) หาย/เสีย → เริ่มจากตัวอย่างด้วย id ใหม่ ห้ามทับแปลนเดิมในห้องสมุด
  if (!loaded || !planId || !PLAN_ID.test(planId)) planId = uid('plan-');
  const planSig = new Map();         // id → JSON ล่าสุดที่บันทึก (ไว้เทียบว่า "แก้จริง" ก่อนอัปเดตเวลา)
  const sumCache = new Map();        // `${id}|${updated}` → สรุปผลคำนวณของแปลนที่ไม่ได้เปิดอยู่
  const deletedIds = new Set();      // แปลนที่ลบในแท็บนี้ — ไม่ดึงกลับมาจากข้อมูลของแท็บอื่น
  let quotaWarned = false;
  const warnQuota = () => { if (!quotaWarned) { quotaWarned = true; toast('พื้นที่จัดเก็บในเบราว์เซอร์เต็ม — ลบแปลนเก่าที่แท็บ "ภาพรวม" หรือกด "บันทึก" เก็บเป็นไฟล์'); } };

  /* เขียนห้องสมุดแบบ "รวมกับที่อยู่ในเครื่อง" ก่อน — เปิดหลายแท็บพร้อมกันแล้วแปลนที่อีกแท็บสร้าง/แก้จะไม่หาย
   * ใช้ของแท็บนี้เมื่อใหม่กว่าหรือเป็นแปลนที่เปิดอยู่, รับแปลนที่มีแต่ในเครื่อง (ยกเว้นที่แท็บนี้ลบ) */
  function mergeLib() {
    const mine = new Map(library.map((x) => [x.id, x]));
    const out = library.slice();
    readLib().forEach((d) => {
      const m = mine.get(d.id);
      if (!m) { if (!deletedIds.has(d.id) && out.length < MAX_PLANS) out.push(d); return; }
      if (d.id !== planId && d.updated > m.updated) out[out.indexOf(m)] = d;
    });
    library = out;
  }
  function writeLib() { mergeLib(); const ok = lsSet(LIB, JSON.stringify(library)); if (!ok) warnQuota(); queuePlans(); return ok; }
  const canAddPlan = () => { if (library.length < MAX_PLANS) return true; toast(`ห้องสมุดเต็ม (${MAX_PLANS} แปลน) — ลบแปลนที่ไม่ใช้ในแท็บ "ภาพรวม" ก่อน`); return false; };

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(project)); } catch (e) { /* ignore */ }
    savePlan();
  }
  // บันทึกแปลนที่เปิดอยู่ลงห้องสมุด — เขียนลงเครื่องเฉพาะเมื่อมีการเปลี่ยนจริง (ไม่ต้อง serialize ทุกแปลนทุกครั้งที่พิมพ์)
  function savePlan() {
    const sig = JSON.stringify(project), name = String(project.meta.name || 'ไม่มีชื่อ').slice(0, 100);
    let e = library.find((x) => x.id === planId), dirty = false;
    if (!e) { e = { id: planId, name, updated: Date.now(), project }; library.unshift(e); dirty = true; }
    else {
      const prev = planSig.has(planId) ? planSig.get(planId) : JSON.stringify(e.project);
      if (prev !== sig) { e.updated = Date.now(); dirty = true; }
      if (e.name !== name) { e.name = name; dirty = true; }
      e.project = project;
    }
    planSig.set(planId, sig);
    if (dirty) { writeLib(); maybeAutoSnap(); }
    if (lsGet(ACTIVE) !== planId) lsSet(ACTIVE, planId);
  }

  function logEvent(type, msg, plan) {
    const rec = { t: Date.now(), type: LOG_TYPES[type] ? type : 'setting', msg: String(msg).slice(0, 300), pid: plan ? plan.id : planId, pn: String(plan ? plan.name : project.meta.name || '').slice(0, 100) };
    const last = logs[0];
    if (last && last.type === rec.type && last.msg === rec.msg && last.pid === rec.pid && rec.t - last.t < 2500) return;
    // รวมกับบันทึกที่แท็บอื่นเขียนไว้ก่อน แล้วเรียงใหม่ล่าสุดก่อน
    const seen = new Set(), key = (l) => l.t + '|' + l.pid + '|' + l.msg;
    logs = [rec].concat(logs, readLogs()).filter((l) => { const k = key(l); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.t - a.t).slice(0, MAX_LOG);
    if (!lsSet(LOGK, JSON.stringify(logs))) warnQuota();
    if (disk.on) { disk.logQ.push(rec); if (disk.logQ.length > MAX_LOG) disk.logQ.splice(0, disk.logQ.length - MAX_LOG); diskFlushSoon(); }
  }
  // อีกแท็บแก้ห้องสมุด/บันทึก → อัปเดตหน้าภาพรวมของแท็บนี้
  window.addEventListener('storage', (ev) => {
    if (ev.key === LIB) { mergeLib(); sumCache.clear(); if (tab === 'dash' && result) render(); }
    else if (ev.key === LOGK) { logs = readLogs().slice(0, MAX_LOG); if (tab === 'dash') refreshLog(); }
  });

  /* ================= เก็บลงดิสก์ผ่านเซิร์ฟเวอร์ (projects/library/) =================
   * localStorage ยังเป็นที่พักหลัก (ใช้ได้แม้เซิร์ฟเวอร์ปิด) — ทุกการเปลี่ยนจะถูกส่งไปเขียนไฟล์ตามหลังแบบหน่วงสั้น ๆ
   * เปิดแอปครั้งแรก: ดึงห้องสมุด/บันทึกจากดิสก์มารวม แล้วส่งของที่มีแต่ในเบราว์เซอร์ (หรือใหม่กว่า) กลับขึ้นไป
   * ลบแปลน: เซิร์ฟเวอร์จดป้ายลบไว้ — เบราว์เซอร์อื่นที่ยังมีสำเนาเก่าจะไม่ดึงกลับมา */
  const DELQ = 'load-schedule-disk-del-v1';
  const disk = {
    on: !!TOKEN && !DEMO() && /^https?:$/.test(location.protocol) && location.hash !== '#print',
    ok: null,                 // null = ยังไม่รู้, true = เขียนลงดิสก์ได้, false = เซิร์ฟเวอร์ไม่ตอบ, 'auth' = เซิร์ฟเวอร์ถูกเปิดใหม่ (โทเค็นเปลี่ยน)
    synced: false,            // ดึงข้อมูลจากดิสก์ครั้งแรกแล้ว (ก่อนหน้านั้นยังไม่ส่งอะไรขึ้นไป กันทับของใหม่กว่า)
    pushed: new Map(),        // id → updated ที่ดิสก์มีแล้ว
    pending: new Set(),       // id ที่รอส่ง
    dels: new Set(readList(DELQ).filter((x) => PLAN_ID.test(String(x)))), // ลบแล้วแต่ยังไม่ได้แจ้งเซิร์ฟเวอร์
    logQ: [], timer: null, busy: false, again: false, fails: 0
  };
  const saveDelQ = () => lsSet(DELQ, JSON.stringify([...disk.dels]));
  function queuePlans() {
    if (!disk.on) return;
    library.forEach((e) => { if (disk.pushed.get(e.id) !== e.updated) disk.pending.add(e.id); });
    diskFlushSoon();
  }
  function diskFlushSoon(ms) {
    if (!disk.on || !disk.synced) return;
    clearTimeout(disk.timer);
    disk.timer = setTimeout(diskFlush, ms == null ? 600 : ms);
  }
  const jsonReq = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const httpErr = (r) => Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  // 403 = โทเค็นของหน้านี้ใช้ไม่ได้แล้ว (ปิดแล้วเปิด node server.js ใหม่) — ลองซ้ำไปก็ไม่ผ่าน ต้องรีเฟรชหน้า
  const diskFailState = (err) => (err && err.status === 403 ? 'auth' : false);
  async function diskFlush() {
    if (disk.busy) { disk.again = true; return; }
    if (disk.ok === 'auth') return;
    disk.busy = true; disk.again = false;
    let ok = true;
    try {
      for (const id of [...disk.dels]) {
        const r = await api('api/library/' + id, { method: 'DELETE' });
        if (!r.ok) throw httpErr(r);
        disk.dels.delete(id); disk.pushed.delete(id); saveDelQ();
      }
      for (const id of [...disk.pending]) {
        const e = library.find((x) => x.id === id);
        disk.pending.delete(id);
        if (!e) continue;
        const snap = { id: e.id, name: e.name, updated: e.updated, project: e.project };
        const r = await api('api/library/' + id, jsonReq('PUT', snap));
        if (!r.ok) { disk.pending.add(id); throw httpErr(r); }
        const j = await r.json().catch(() => ({}));
        if (j.stored === false) {          // เซิร์ฟเวอร์ไม่รับ: ถูกลบไปแล้ว หรือไฟล์บนดิสก์ใหม่กว่า — แจ้งให้เห็น ไม่เงียบ
          toast(j.deleted ? `แปลน "${e.name}" ถูกลบบนดิสก์ไปแล้ว — ไม่ได้บันทึกซ้ำ` : `ไฟล์บนดิสก์ของ "${e.name}" ใหม่กว่า — ไม่ได้ทับ`);
        }
        disk.pushed.set(id, snap.updated);
      }
      if (disk.logQ.length) {
        const batch = disk.logQ.splice(0, 500);
        const r = await api('api/logs', jsonReq('POST', { logs: batch }));
        if (!r.ok) { disk.logQ.unshift(...batch); throw httpErr(r); }
        if (disk.logQ.length) disk.again = true;
      }
    } catch (err) { ok = diskFailState(err); }
    disk.busy = false;
    setDiskOk(ok);
    if (ok === 'auth') return;
    if (!ok) { disk.fails++; diskFlushSoon(Math.min(60000, 3000 * 2 ** Math.min(disk.fails, 5))); }   // ลองใหม่แบบทิ้งช่วงห่างขึ้น
    else { disk.fails = 0; if (disk.again || disk.pending.size || disk.dels.size) diskFlushSoon(50); }
  }
  function setDiskOk(v) { if (disk.ok === v) return; disk.ok = v; const el = $('#diskState'); if (el) el.outerHTML = diskStateHTML(); }
  function diskStateHTML() {
    const [cls, txt, tip] = !disk.on ? ['', 'จดจำในเบราว์เซอร์นี้', 'เปิดผ่าน node server.js เพื่อเก็บลงโฟลเดอร์ projects/library']
      : disk.ok === 'auth' ? ['warn-t', 'เซิร์ฟเวอร์ถูกเปิดใหม่ — รีเฟรชหน้าเพื่อบันทึกลงดิสก์ต่อ', 'ข้อมูลยังอยู่ครบในเบราว์เซอร์ รีเฟรชแล้วจะส่งขึ้นดิสก์ให้อัตโนมัติ']
      : disk.ok === false ? ['warn-t', 'เซิร์ฟเวอร์ไม่ตอบ — เก็บในเบราว์เซอร์ไว้ก่อน', 'จะส่งขึ้นดิสก์อัตโนมัติเมื่อเซิร์ฟเวอร์กลับมา']
        : disk.ok ? ['ok-t', 'บันทึกลงดิสก์ projects/library ✓', 'ห้องสมุดแปลนและบันทึกกิจกรรมถูกเขียนเป็นไฟล์ในโฟลเดอร์ projects/library']
          : ['', 'กำลังเชื่อมดิสก์…', ''];
    return `<span id="diskState" class="tiny ${cls}" title="${esc(tip)}">${esc(txt)}</span>`;
  }

  /* ================= ประวัติเวอร์ชัน (projects/library/history/<id>/) =================
   * บันทึกอัตโนมัติเมื่อมีการแก้ห่างจากเวอร์ชันล่าสุดเกิน SNAP_EVERY, ก่อนกู้คืน และกดบันทึกเองพร้อมหมายเหตุ */
  const SNAP_EVERY = 10 * 60 * 1000;
  const snapLast = new Map();                       // planId → เวลาเวอร์ชันล่าสุดที่รู้
  const snapBusy = new Set();                       // planId ที่กำลังส่งเวอร์ชัน — กันส่งซ้อนระหว่างรอ
  let hist = { id: null, list: null, loading: false, err: '', diff: null };
  async function snapVersion(note, auto) {
    if (!disk.on || disk.ok === 'auth') return false;
    const id = planId, body = { name: String(project.meta.name || '').slice(0, 100), note: note || '', auto: !!auto, project };
    if (snapBusy.has(id)) return false;
    snapBusy.add(id);
    try {
      const r = await api('api/history/' + id, jsonReq('POST', body));
      if (!r.ok) return false;
      snapLast.set(id, Date.now());
      if (hist.id === id) histLoad(true);
      return true;
    } catch (e) { return false; } finally { snapBusy.delete(id); }
  }
  function maybeAutoSnap() {
    if (!disk.on || !disk.synced || disk.ok !== true) return;
    const last = snapLast.get(planId);
    if (last != null && Date.now() - last < SNAP_EVERY) return;
    snapVersion('', true);
  }
  async function histLoad(force) {
    if (!disk.on) { hist = { id: planId, list: [], loading: false, err: 'off', diff: null }; refreshHist(); return; }
    if (!force && hist.id === planId && (hist.list || hist.loading)) return;
    const id = planId;
    if (hist.id !== id) hist = { id, list: null, loading: true, err: '', diff: null }; else hist.loading = true;
    refreshHist();
    try {
      const r = await api('api/history/' + id);
      const j = await r.json();
      if (hist.id !== id) return;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      hist.list = Array.isArray(j.versions) ? j.versions : []; hist.err = '';
      if (hist.list[0] && !snapLast.has(id)) snapLast.set(id, hist.list[0].t);
    } catch (e) { if (hist.id === id) { hist.list = hist.list || []; hist.err = r403(e) ? 'auth' : 'load'; } }
    if (hist.id === id) { hist.loading = false; refreshHist(); }
  }
  const r403 = (e) => /403/.test(String(e && e.message));
  async function histFetch(id, v) {
    const r = await api(`api/history/${id}/${v}`);
    const j = await r.json();
    if (!r.ok || !j.version) throw new Error(j.error || 'อ่านเวอร์ชันไม่ได้');
    return j.version;
  }
  async function histDiff(v) {
    const id = planId;
    try {
      const ver = await histFetch(id, v);
      if (planId !== id) return;                    // เปลี่ยนแปลนระหว่างรอ — ทิ้งผล ไม่เอาไปเทียบกับแปลนอื่น
      const old = SAN.project(ver.project).project;
      let smOld = null; try { smOld = summarize(old, E.calculate(old)); } catch (e) { smOld = null; }
      hist.diff = { v, t: ver.t, note: ver.note, d: window.PlanDiff.diffProjects(old, project), smOld, smNow: result ? summarize(project, result) : null };
    } catch (e) { toast('เปิดเวอร์ชันไม่ได้: ' + (e.message || e)); return; }
    refreshHist();
    const box = $('#dash-hist'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function histRestore(v) {
    const pid = planId;
    let ver, p;
    try { ver = await histFetch(pid, v); p = SAN.project(ver.project).project; } catch (e) { toast('กู้คืนไม่ได้: ' + (e.message || e)); return; }
    if (planId !== pid) return;
    if (!(await askConfirm({ title: `กู้คืนเวอร์ชัน ${stamp(ver.t)}?`, body: 'แปลนที่เปิดอยู่จะถูกแทนด้วยเวอร์ชันนี้ — ระบบบันทึกสถานะปัจจุบันเป็นเวอร์ชันใหม่ไว้ก่อน (กู้กลับได้) และกด "เลิกทำ" ได้ทันที', ok: 'กู้คืน' }))) return;
    if (planId !== pid) return;
    const before = JSON.stringify(project);
    await snapVersion('ก่อนกู้คืนเวอร์ชัน ' + stamp(ver.t), true);
    if (planId !== pid) return;
    project = p; lastGood = null; selected = firstSelectable(p); hist.diff = null;
    $('#projName') && ($('#projName').value = project.meta.name);
    recalc(true);
    logEvent('plan', `กู้คืนเวอร์ชัน ${stamp(ver.t)}${ver.note ? ' (' + ver.note + ')' : ''}`);
    toastUndo(`กู้คืนเวอร์ชัน ${stamp(ver.t)} แล้ว`, () => { if (planId !== pid) return; project = JSON.parse(before); lastGood = null; selected = firstSelectable(project); recalc(true); logEvent('plan', 'เลิกทำการกู้คืนเวอร์ชัน'); });
  }
  function refreshHist() { const box = $('#histBox'); if (box) box.innerHTML = histHTML(); }
  const FIELD_TH = { name: 'ชื่อ', qty: 'จำนวน', fixtures: 'จำนวนโคม', perFixture: 'หลอด/โคม', points: 'จุด', btu: 'BTU', kw: 'kW', watt: 'W', va: 'VA', panelId: 'แผง', parent: 'รับไฟจาก', phases: 'เฟส', cbOv: 'CB กำหนดเอง', phOv: 'ตรึงเฟส', kind: 'ชนิดแผง', location: 'ที่ตั้ง', lamp: 'หลอด', type: 'ชนิด', length: 'ระยะสาย', balance: 'Balance', ways: 'จำนวนช่อง', spareCount: 'Spare' };
  const dv = (x, k) => {
    if (x === undefined || x === null || x === '') return '–';
    if ((k === 'cbOv' || k === 'phOv') && typeof x === 'object') return Object.entries(x).map(([n, v]) => `วงจร ${n}: ${k === 'cbOv' ? v + ' A' : 'เฟส ' + ('ABC'[v] || v)}`).join(', ') || '–';
    const t = typeof x === 'object' ? JSON.stringify(x) : String(x);
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  };
  function diffHTML(h) {
    const d = h.d, L = 25;
    const fields = (f) => f.slice(0, 6).map((x) => `<span class="dfield">${esc(FIELD_TH[x.k] || x.k)}: <s>${esc(dv(x.a, x.k))}</s> → <b>${esc(dv(x.b, x.k))}</b></span>`).join(' ');
    const sec = (title, part) => {
      const n = part.added.length + part.removed.length + part.changed.length;
      if (!n) return '';
      return `<div class="dsec"><div class="label">${title} · ${n}</div><ul class="dlist">${part.added.slice(0, L).map((x) => `<li class="add">+ ${esc(x.label)}</li>`).join('')}${part.removed.slice(0, L).map((x) => `<li class="del">− ${esc(x.label)}</li>`).join('')}${part.changed.slice(0, L).map((x) => `<li class="chg">~ ${esc(x.label)} ${fields(x.fields)}</li>`).join('')}</ul></div>`;
    };
    const a = h.smOld, b = h.smNow;
    const kpi = a && b && !a.error ? `<div class="dkpi">${[['Demand', a.dem, b.dem, 'kVA', 2], ['Connected', a.conn, b.conn, 'kVA', 2], ['คำเตือน', a.nWarn, b.nWarn, '', 0]].map(([l, x, y, u, dec]) => `<span>${l} <b class="num">${fmt(x, dec)}</b> → <b class="num">${fmt(y, dec)}</b>${u ? ' ' + u : ''}</span>`).join('')}<span>Main CB <b>${esc(a.mainCB)}</b> → <b>${esc(b.mainCB)}</b></span></div>` : '';
    return `<div class="hdiff"><div class="hdiff-h"><b>เทียบเวอร์ชัน ${esc(stamp(h.t))} → ปัจจุบัน</b>${h.note ? `<span class="muted tiny">${esc(h.note)}</span>` : ''}<span class="spacer"></span><button class="btn sm accent" data-hist-restore="${h.v}">กู้คืนเวอร์ชันนี้</button><button class="btn ghost sm" data-hist-close="1" aria-label="ปิด">${I.close}</button></div>
      ${kpi}${d.same ? '<div class="muted">ไม่มีอะไรเปลี่ยน</div>' : `${d.meta.length ? `<div class="dsec"><div class="label">ตั้งค่าโครงการ · ${d.meta.length}</div><div>${d.meta.slice(0, 12).map((x) => `<span class="dfield">${esc(x.k)}: <s>${esc(dv(x.a))}</s> → <b>${esc(dv(x.b))}</b></span>`).join(' ')}</div></div>` : ''}${sec('แผง', d.panels)}${sec('อุปกรณ์', d.items)}`}</div>`;
  }
  function histHTML() {
    if (!disk.on || hist.err === 'off') return '<div class="muted tiny">ประวัติเวอร์ชันเก็บเป็นไฟล์ใน projects/library/history — เปิดโปรแกรมผ่าน node server.js เพื่อใช้งาน</div>';
    if (hist.id !== planId || (!hist.list && hist.loading)) return '<div class="muted tiny">กำลังโหลดประวัติ…</div>';
    const list = hist.list || [];
    const bar = `<div class="hist-bar"><input type="text" id="histNote" maxlength="200" placeholder="หมายเหตุ เช่น ก่อนเปลี่ยนหม้อแปลง (ไม่บังคับ)" aria-label="หมายเหตุเวอร์ชัน"><button class="btn sm accent" data-hist-save="1">บันทึกเวอร์ชันตอนนี้</button><button class="btn ghost sm" data-hist-reload="1" title="โหลดใหม่" aria-label="โหลดรายการใหม่">↻</button></div>`;
    const err = hist.err === 'auth' ? '<div class="warn-t tiny">เซิร์ฟเวอร์ถูกเปิดใหม่ — รีเฟรชหน้าเพื่อดูประวัติ</div>' : hist.err ? '<div class="warn-t tiny">โหลดประวัติไม่ได้</div>' : '';
    const rows = list.slice(0, 40).map((x, i) => `<li class="${hist.diff && hist.diff.v === x.v ? 'on' : ''}"><span class="num">${esc(stamp(x.t))}</span><span class="tag ${x.auto ? '' : 'live'}">${x.auto ? 'อัตโนมัติ' : 'บันทึกเอง'}</span><span class="hn" title="${esc(x.note || x.name)}">${esc(x.note || x.name || '')}</span><span class="spacer"></span><button class="btn ghost sm" data-hist-diff="${x.v}">เทียบ</button><button class="btn ghost sm" data-hist-restore="${x.v}">กู้คืน</button></li>`).join('');
    return `${bar}${err}${hist.diff ? diffHTML(hist.diff) : ''}${list.length ? `<ul class="hist-list">${rows}</ul>` : '<div class="muted tiny" style="margin-top:6px">ยังไม่มีเวอร์ชัน — จะบันทึกอัตโนมัติเมื่อแก้แปลน หรือกด "บันทึกเวอร์ชันตอนนี้"</div>'}`;
  }

  // เปิดแอป: รวมห้องสมุด/บันทึกจากดิสก์กับของในเบราว์เซอร์
  async function diskSync() {
    if (!disk.on) return;
    const bootSig = JSON.stringify(project);
    let L, G;
    try {
      const get = (u) => api(u).then((r) => (r.ok ? r.json() : Promise.reject(httpErr(r))));
      [L, G] = await Promise.all([get('api/library'), get('api/logs')]);
    } catch (err) {   // ยังไม่รู้ว่าบนดิสก์มีอะไร — ห้ามส่งขึ้นไปก่อน (อาจดึงแปลนที่ถูกลบจากที่อื่นกลับมา) ลองดึงใหม่ทีหลัง
      setDiskOk(diskFailState(err)); disk.fails++;
      if (disk.ok !== 'auth') setTimeout(diskSync, Math.min(60000, 3000 * 2 ** Math.min(disk.fails, 5)));
      return;
    }
    disk.fails = 0;
    const tombs = L && typeof L.deleted === 'object' && L.deleted ? L.deleted : {};
    let adopt = null;
    (Array.isArray(L.plans) ? L.plans : []).filter(okPlan).forEach((sp) => {
      if (disk.dels.has(sp.id)) return;                       // ลบไว้ตอนออฟไลน์ — เดี๋ยวแจ้งเซิร์ฟเวอร์
      disk.pushed.set(sp.id, sp.updated);
      const m = library.find((x) => x.id === sp.id);
      if (!m) { if (!deletedIds.has(sp.id)) library.push(sp); }
      else if (sp.updated > m.updated) { if (sp.id === planId) adopt = sp; else library[library.indexOf(m)] = sp; }
    });
    // แปลนที่ถูกลบจากที่อื่นหลังจากแก้ครั้งล่าสุด → เอาออก (ยกเว้นแปลนที่เปิดอยู่ ให้คงไว้และส่งขึ้นไปใหม่)
    library = library.filter((x) => {
      const t = Number(tombs[x.id]);
      if (x.id === planId || !(t >= x.updated) || disk.pushed.has(x.id)) return true;
      deletedIds.add(x.id); return false;
    });
    if (library.length > MAX_PLANS) library = library.sort((a, b) => (a.id === planId ? -1 : b.id === planId ? 1 : b.updated - a.updated)).slice(0, MAX_PLANS);
    // แปลนที่เปิดอยู่มีฉบับใหม่กว่าบนดิสก์ (แก้จากเครื่อง/เบราว์เซอร์อื่น) และยังไม่ได้แก้อะไรในแท็บนี้ → ใช้ฉบับบนดิสก์
    if (adopt && JSON.stringify(project) === bootSig) {
      try {
        const p = SAN.project(adopt.project).project;
        const e = library.find((x) => x.id === planId);
        if (e) Object.assign(e, adopt, { project: p });
        project = p; selected = firstSelectable(p); lastGood = null; planSig.set(planId, JSON.stringify(p));
        undoHist.reset(); updateUndoUI();   // รับฉบับจากดิสก์ = เริ่มประวัติใหม่ (ไม่ให้ Ctrl+Z กู้สำเนาเก่าในเบราว์เซอร์มาทับ)
        lsSet(STORE, JSON.stringify(p));
        shell(); recalc(true);
      } catch (err) { /* ฉบับบนดิสก์เสีย — ใช้ของในเบราว์เซอร์ต่อ แล้วส่งทับขึ้นไป */ disk.pushed.delete(planId); }
    }
    // บันทึกกิจกรรม: รวมสองฝั่ง แล้วส่งรายการที่มีแต่ในเบราว์เซอร์ขึ้นไป
    const key = (l) => l.t + '|' + l.pid + '|' + l.msg;
    const srv = (Array.isArray(G.logs) ? G.logs : []).filter(okLog), have = new Set(srv.map(key));
    disk.logQ = logs.filter((l) => !have.has(key(l))).concat(disk.logQ.filter((l) => !have.has(key(l))));
    const seenK = new Set();
    logs = srv.concat(logs).filter((l) => { const k = key(l); if (seenK.has(k)) return false; seenK.add(k); return true; }).sort((a, b) => b.t - a.t).slice(0, MAX_LOG);
    lsSet(LOGK, JSON.stringify(logs));
    disk.synced = true;
    sumCache.clear();
    writeLib();            // เขียนลงเบราว์เซอร์ + จัดคิวแปลนที่ดิสก์ยังไม่มี/เก่ากว่า
    setDiskOk(true);
    diskFlushSoon(0);
    if (tab === 'dash' && result && !adopt) render();
  }

  /* ================= Undo/Redo · ค้นหาแผง · ธีมมืด · แถบเตือน Ik" > IC ================= */
  const UK = window.UIKit;
  const undoHist = UK.createHistory(30);     // snapshot โครงการสูงสุด 30 สเต็ป (ในหน่วยความจำ ไม่เก็บโลโก้)
  let panelQuery = '';
  function updateUndoUI() {
    const c = undoHist.counts();
    const set = (sel, n, name, key, none) => $$(sel).forEach((b) => {
      b.disabled = !n;
      b.title = `${name} (${key})${n ? ` · ${name === 'ย้อนกลับ' ? 'ย้อนได้' : 'ทำซ้ำได้'} ${n} ขั้น` : ` · ${none}`}`;
      b.setAttribute('aria-label', `${name}${n ? ` (${n} ขั้น)` : ''}`);
      const cnt = b.querySelector('.cnt'); if (cnt) cnt.textContent = n ? String(n) : '';
    });
    set('[data-action="undo"]', c.undo, 'ย้อนกลับ', 'Ctrl+Z', 'ยังไม่มีขั้นให้ย้อน');
    set('[data-action="redo"]', c.redo, 'ทำซ้ำ', 'Ctrl+Y', 'ยังไม่มีขั้นให้ทำซ้ำ');
  }
  function restoreSnapshot(snap) {
    const logo = project.meta && project.meta.logo;
    if (drawerState) closeDrawer();
    clearTimeout(debounce);
    try { project = JSON.parse(snap); } catch (e) { toast('กู้ประวัติไม่สำเร็จ'); return false; }
    if (logo) project.meta.logo = logo;      // โลโก้ไม่อยู่ในประวัติ — คงของปัจจุบันไว้
    if (!boardOf(selected)) selected = firstSelectable(project);
    shell(); recalc(true);                   // onResult จะ record สถานะที่เพิ่งกู้ซึ่งตรงกับ current → ไม่เพิ่มประวัติ
    return true;
  }
  function stepHistory(dir) {
    // มีการแก้ที่ยังไม่ถูกบันทึกเป็นประวัติ (รอ debounce / worker กำลังคำนวณ): Ctrl+Z ครั้งแรก = ยกเลิกการแก้นั้นกลับสถานะที่บันทึกล่าสุด (ไม่ข้ามไปย้อนอีกขั้น)
    if (dir < 0) {
      const cur = undoHist.current();
      if (cur !== null && UK.stripLogo(JSON.stringify(project)) !== cur) { if (restoreSnapshot(cur)) toast('ยกเลิกการแก้ที่ยังไม่ได้บันทึกในประวัติ'); return; }
    }
    const snap = dir < 0 ? undoHist.undo() : undoHist.redo();
    if (snap === null) { toast(dir < 0 ? 'ไม่มีขั้นให้ย้อนกลับ' : 'ไม่มีขั้นให้ทำซ้ำ'); return; }
    if (!restoreSnapshot(snap)) return;
    const c = undoHist.counts();
    toast(`${dir < 0 ? 'ย้อนกลับ' : 'ทำซ้ำ'} 1 ขั้น · เหลือย้อนได้ ${c.undo} / ทำซ้ำได้ ${c.redo}`);
    updateUndoUI();
  }
  function applyTheme(t, remember) {
    document.documentElement.setAttribute('data-theme', t);
    const ic = $('#themeIcon'); if (ic) ic.innerHTML = t === 'dark' ? I.sun : I.moon;
    const b = $('[data-action="toggle-theme"]');
    if (b) { b.setAttribute('aria-pressed', String(t === 'dark')); b.title = t === 'dark' ? 'สลับเป็นธีมสว่าง' : 'สลับเป็นธีมมืด (สบายตาสำหรับงาน CAD)'; }
    if (remember) { try { localStorage.setItem('ls-theme', t); } catch (e) { /* ไม่มี storage: ใช้ได้เฉพาะรอบนี้ */ } }
  }
  (function initTheme() {
    let stored = null; try { stored = localStorage.getItem('ls-theme'); } catch (e) { /* ignore */ }
    applyTheme(UK.resolveTheme(stored, !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)), false);
  })();
  // โครงการเก่าที่ปิด Auto-Selectivity/ประสานสายป้อนไว้: แจ้งให้เปิด (ไม่เปลี่ยนเอง) · "คงไว้" และการปรับเองจำต่อแปลนใน localStorage
  const selNoticeKey = () => 'ls-sel-notice-' + planId;
  function updateSelNotice() {
    const el = $('#selNotice'); if (!el) return;
    const n = UK.selectivityNotice(project && project.meta, lsGet(selNoticeKey()) === '1');
    if (!n) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span>${esc(n.headline)}</span><button class="btn sm accent" type="button" data-action="sel-enable">${esc(n.enable)}</button><button class="btn sm" type="button" data-action="sel-keep">${esc(n.keep)}</button>`;
  }
  function updateIkBanner() {
    const el = $('#ikBanner'); if (!el) return;
    const b = UK.icBanner(result && result.icViolations, window.LS_DATA && window.LS_DATA.IC_KA, window.LS_BRANDS);
    if (!b) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `${esc(b.headline)}<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${b.more ? `<span class="more">และอีก ${b.more} จุด — ดูช่อง IC สีแดงในตารางโหลด</span>` : ''}<div class="advice">${esc(b.advice)}</div>`;
  }
  const searchBoards = () => project.panels.map((b) => ({ id: b.id, name: b.name, kind: b.kind, location: b.location, floor: b.floor }));
  function refreshTree() { const box = $('#treeBox'); if (box) box.innerHTML = treeHTML(); }
  function focusPanelSearch() {
    if (tab !== 'design') { tab = 'design'; render(); }
    const el = $('#panelSearch'); if (el) { el.focus(); el.select(); }
  }
  // โลโก้บริษัท: ย่อให้พอดีกรอบ ≤ 320×120 แล้วลดต่อจนข้อมูล ≤ 150,000 อักขระ (เพดานเดียวกับ sanitize.js) ; รับเฉพาะ PNG/JPEG/WebP
  function loadLogo(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('โลโก้ต้องเป็นไฟล์ PNG / JPEG / WebP'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('ไฟล์โลโก้ใหญ่เกินไป (> 8 MB)'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let scale = Math.min(1, 320 / img.width, 120 / img.height), out = '';
      for (let i = 0; i < 6 && !out; i++) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
        let d = c.toDataURL('image/png');
        if (d.length > 150000) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); d = c.toDataURL('image/jpeg', 0.85); }
        if (d.length <= 150000) out = d; else scale *= 0.7;
      }
      if (!out) { toast('ย่อโลโก้ให้เล็กพอไม่สำเร็จ — ลองรูปที่เรียบง่ายกว่านี้'); return; }
      project.meta.logo = out; logEvent('setting', 'ตั้งโลโก้บริษัท'); recalc(true); toast('ตั้งโลโก้แล้ว');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('อ่านไฟล์โลโก้ไม่ได้'); };
    img.src = url;
  }

  /* ================= คำนวณเบื้องหลัง ================= */
  // บันทึกลง localStorage "หลังคำนวณสำเร็จเท่านั้น" และจำสถานะล่าสุดที่คำนวณผ่านไว้ย้อนกลับเมื่อมีการแก้ที่ทำให้คำนวณพัง
  let worker = null, reqId = 0, debounce = null, lastGood = null, failing = false, afterCalc = null, sentJSON = null;
  try { if (location.hash !== '#print') worker = new Worker('js/worker.js'); } catch (e) { worker = null; }
  if (worker) worker.onmessage = (e) => {
    if (e.data.id !== reqId) return;
    if (!e.data.ok) { console.error(e.data.error); calcFailed(String(e.data.error).split('\n')[0]); return; }
    onResult(e.data.result, e.data.ms);
  };
  if (worker) worker.onerror = () => { worker = null; recalc(true); };

  function recalc(now) {
    clearTimeout(debounce);
    chip('กำลังคำนวณ…', true);
    const run = () => {
      reqId++;
      sentJSON = JSON.stringify(project);
      if (worker) worker.postMessage({ id: reqId, project });
      else { const t0 = performance.now(); try { onResult(E.calculate(project), performance.now() - t0); } catch (err) { console.error(err); calcFailed(String(err.message || err)); } }
    };
    if (now) run(); else debounce = setTimeout(run, 160);
  }
  function calcFailed(msg) {
    chip('ผิดพลาด', false);
    if (failing) { toast('คำนวณไม่สำเร็จ: ' + msg); return; }   // ย้อนกลับแล้วยังพัง → ไม่วนซ้ำ
    failing = true;
    if (drawerState) closeDrawer();
    if (lastGood) {
      project = JSON.parse(lastGood);
      toast('คำนวณไม่สำเร็จ จึงย้อนกลับการแก้ไขล่าสุด — ' + msg);
    } else {
      try { localStorage.setItem(STORE + '-bad', JSON.stringify(project)); localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      project = window.SAMPLE_PROJECT(); planId = uid('plan-'); undoHist.reset();       // อย่าทับแปลนเดิมในห้องสมุด — เก็บไว้เป็นสำรอง
      toast('โครงการที่บันทึกไว้คำนวณไม่ได้ — เปิดโครงการตัวอย่างแทน (สำรองข้อมูลเดิมไว้แล้ว)');
    }
    if (!boardOf(selected)) selected = firstSelectable(project);
    shell(); recalc(true);
  }
  function onResult(res, ms) {
    failing = false;
    result = res;
    lastGood = sentJSON || JSON.stringify(project);    // สถานะที่คำนวณผ่านจริง (ไม่ใช่ที่แก้ต่อระหว่างรอผล)
    undoHist.record(lastGood); updateUndoUI(); updateIkBanner(); updateSelNotice();
    persist();
    chip(`คำนวณแล้ว · ${ms < 1 ? '<1' : Math.round(ms)} ms`, false);
    render();
    // #print = เตรียมรายงานไว้เลย (ใช้กับการสั่งพิมพ์จาก command line เช่น msedge --print-to-pdf)
    if (location.hash === '#print' && !DEMO()) { $('#report').innerHTML = R.reportHTML(result); fitPrintPages(); }
    const cb = afterCalc; afterCalc = null;      // งานที่ต้องรอผลคำนวณรอบนี้ (เช่น แจ้งผลก่อน→หลังของ Balance Load)
    if (cb) cb();
  }
  function chip(text, busy) {
    const c = $('#calcChip');
    c.classList.toggle('busy', !!busy);
    document.body.classList.toggle('calculating', !!busy);
    $('span', c).textContent = text;
  }

  /* ================= shell ================= */
  const TABS = [
    ['dash', 'ภาพรวม'], ['design', 'ออกแบบ'], ['schedule', 'ตารางโหลด'], ['feeder', 'สายป้อน & ระบบประธาน'], ['sld', 'ผังเส้นเดียว'],
    ['method', 'วิธีคำนวณ'], ['bom', 'รายการวัสดุ'], ['settings', 'ตั้งค่าโครงการ']
  ];
  function shell() {
    $('#logo').innerHTML = `${window.LOGO}<div><b>ตารางโหลดสำเร็จรูป</b><small>Load schedule · Feeder · Service</small></div>`;
    $$('[data-icon]').forEach((el) => { el.outerHTML = I[el.dataset.icon]; });
    $('#tabs').innerHTML = TABS.map(([k, t], i) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}"${k === tab ? ' aria-current="page"' : ''}><span class="no">${String(i + 1).padStart(2, '0')}</span>${t}</button>`).join('');
    $('#projName').value = project.meta.name;
  }

  // ---- FLIP: ตอน Balance / ลบวงจร ให้แถวเลื่อนจากตำแหน่งเดิมไปตำแหน่งใหม่ และแถวที่เปลี่ยนเฟสกะพริบ ----
  function captureRows(main) {
    const m = new Map();
    $$('tr[data-ck]', main).forEach((tr) => { const sh = tr.closest('.sheet'); m.set(((sh && sh.dataset.sid) || '') + '|' + tr.dataset.ck, { top: tr.getBoundingClientRect().top, ph: tr.dataset.ph }); });
    return m;
  }
  function playFlip(main, old) {
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('tr[data-ck]', main).forEach((tr) => {
      const sh = tr.closest('.sheet'), o = old.get(((sh && sh.dataset.sid) || '') + '|' + tr.dataset.ck);
      if (!o) return;
      const dy = o.top - tr.getBoundingClientRect().top;
      if (!calm && Math.abs(dy) > 1 && tr.animate) tr.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.2,.7,.2,1)' });
      if (!calm && o.ph && o.ph !== tr.dataset.ph) tr.classList.add('rephased');
    });
  }

  function render() {
    if (!result) return;
    $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('on', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    const main = $('#main');
    const keepScroll = window.scrollY;
    let html = '';
    switch (tab) {
      case 'dash': html = viewDash(); break;
      case 'design': html = viewDesign(); break;
      case 'schedule': html = viewSchedule(); break;
      case 'feeder': html = viewFeeder(); break;
      case 'sld': html = viewSLD(); break;
      case 'method': html = viewMethod(); break;
      case 'bom': html = viewBOM(); break;
      case 'settings': html = viewSettings(); break;
    }
    const prevTab = main.dataset.view;
    const flipOld = tab === 'schedule' && prevTab === 'schedule' ? captureRows(main) : null;
    // จำช่องที่กำลังพิมพ์อยู่ แล้วคืน focus หลังวาดใหม่
    const ae = document.activeElement;
    let focusSel = null, caret = null, typed = null;
    if (ae && main.contains(ae)) {
      for (const k of ['m', 'board']) if (ae.dataset[k]) focusSel = `[data-${k}="${ae.dataset[k].replace(/["\\]/g, '\\$&')}"]`;
      if (ae.id === 'panelSearch') focusSel = '#panelSearch';
      try { caret = [ae.selectionStart, ae.selectionEnd]; } catch (e) { caret = null; }
      if (ae.type !== 'checkbox') typed = ae.value;   // ค่าที่กำลังพิมพ์ (เช่น ช่องว่างตอนลบเพื่อพิมพ์ใหม่) ต้องไม่ถูกทับด้วยค่าจากโมเดล
    }
    // เปิดอยู่: details ที่ผู้ใช้กางไว้
    const openDet = $$('details.acc[open] > summary', main).map((s) => s.textContent);
    main.innerHTML = `<div class="${prevTab === tab ? 'calm' : 'view'}">${html}</div>`;
    main.dataset.view = tab;
    // ที่จับขนาดเบรกเกอร์/เฟส: บอกวิธีใช้คีย์บอร์ดเป็นภาษาไทยใน aria-label (ข้อความหลักมาจาก export.js)
    $$('[data-cb-grip]', main).forEach((g) => { const l = g.getAttribute('aria-label') || 'ปรับขนาดเบรกเกอร์'; if (!/ใช้ลูกศรขึ้น\/ลง/.test(l)) g.setAttribute('aria-label', l.replace(/\s*\(กด[^)]*\)\s*$/, '') + ' — ใช้ลูกศรขึ้น/ลง'); });
    $$('[data-ph-grip]', main).forEach((g) => { const l = g.getAttribute('aria-label') || 'ย้ายเฟส'; if (!/Delete = อัตโนมัติ/.test(l)) g.setAttribute('aria-label', l.replace(/\s*\(ลาก[^)]*\)\s*$/, '') + ' — ใช้ลูกศรซ้าย/ขวา, Delete = อัตโนมัติ'); });
    $$('[data-edit]', main).forEach((el) => seen.add(el.dataset.edit));
    $$('[data-select]', main).forEach((el) => seen.add('n' + el.dataset.select));
    $$('details.acc > summary', main).forEach((s) => { if (openDet.includes(s.textContent)) s.parentElement.open = true; });
    if (focusSel) {
      const el = $(focusSel, main);
      if (el) {
        if (typed != null && el.type !== 'checkbox' && el.value !== typed) el.value = typed;
        el.focus({ preventScroll: true });
        try { if (caret && caret[0] != null) el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* number input: เคอร์เซอร์อยู่ท้ายค่าเดิม */ }
      }
    }
    // ปุ่มลูกศรบนที่จับ CB/เฟส: คืน focus ให้วงจรเดิม (ตามรหัสวงจร data-ck เพราะเลขช่องอาจเปลี่ยนหลังจัดเฟสใหม่)
    if (keepFocus) {
      const row = $$('tr[data-ck]', main).find((r) => r.dataset.ck === keepFocus.ck);
      const el = row && $({ ph: '[data-ph-grip]', cb: '[data-cb-grip]', phsel: '[data-ph-set]', cbsel: '[data-cb-set]' }[keepFocus.kind], row);
      if (el) el.focus({ preventScroll: true });
      keepFocus = null;
    }
    window.scrollTo(0, keepScroll);
    if (flipOld) playFlip(main, flipOld);
    afterRender();
    if (tab === 'dash') histLoad();
  }
  let keepFocus = null;

  // แถบเฟสเริ่มจากค่าเดิมของแผงนั้น (ครั้งแรกเริ่มที่ 0) แล้วค่อยเลื่อนไปค่าใหม่ — ไม่กระตุกกลับไป 0 ทุกครั้งที่คำนวณใหม่
  const lastBars = {};
  function afterRender() {
    const fills = $$('.pbar .fill'), bkey = selected + '|' + tab, prev = lastBars[bkey] || [];
    fills.forEach((f, i) => { f.style.transition = 'none'; f.style.width = (prev[i] != null ? prev[i] : 0) + '%'; });
    void document.body.offsetWidth;
    requestAnimationFrame(() => { fills.forEach((f) => { f.style.transition = ''; f.style.width = f.dataset.w + '%'; }); lastBars[bkey] = fills.map((f) => Number(f.dataset.w)); });
    // ตัวเลขนับขึ้น
    $$('[data-count]').forEach((el) => countUp(el, Number(el.dataset.count), Number(el.dataset.dec || 0)));
    if (window.BrandUI) BrandUI.afterRender();
  }
  const lastCount = new Map();
  function countUp(el, to, dec) {
    const key = el.dataset.key || el.textContent;
    const from = lastCount.has(key) ? lastCount.get(key) : 0;
    lastCount.set(key, to);
    if (from === to) { el.textContent = fmt(to, dec); return; }
    const t0 = performance.now(), dur = 600;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e, dec);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ================= จัดการแปลน (สร้าง/สลับ/ทำสำเนา/ลบ) ================= */
  const blankProject = () => ({ version: 1, meta: Object.assign(E.defaultMeta(), { name: 'โครงการใหม่' }), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, { id: 'LP1', name: 'LP-1', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 20 }], items: [] });
  const uniqueName = (base) => {
    const names = new Set(library.map((x) => x.name));
    if (!names.has(base)) return base;
    let n = 2; while (names.has(`${base} (${n})`)) n++;
    return `${base} (${n})`;
  };
  // สลับไปแปลนอื่น: เก็บแปลนเดิมไว้ในห้องสมุดก่อนเสมอ (ไม่มีอะไรหาย) แล้วคำนวณแปลนใหม่
  function enterPlan(proj, id, toTab) {
    if (result) savePlan();
    if (drawerState) closeDrawer();
    project = proj; planId = id; lastGood = null; failing = false; afterCalc = null; selected = firstSelectable(proj);
    undoHist.reset(); updateUndoUI(); panelQuery = '';     // ประวัติ Undo/Redo เป็นของแปลนนี้เท่านั้น
    hist = { id: null, list: null, loading: false, err: '', diff: null };
    if (toTab) tab = toTab;
    $$('#toasts .toast.has-undo').forEach((t) => t.remove());      // เลิกทำของแปลนเดิมใช้กับแปลนใหม่ไม่ได้
    shell(); recalc(true);
  }
  function newPlan(kind) {
    if (!canAddPlan()) return;
    const p = kind === 'sample' ? window.SAMPLE_PROJECT() : blankProject();
    p.meta.name = uniqueName(p.meta.name);
    enterPlan(p, uid('plan-'), kind === 'sample' ? 'dash' : 'design');
    logEvent('plan', `สร้างแปลน "${p.meta.name}"${kind === 'sample' ? ' (จากโครงการตัวอย่าง)' : ''}`);
    toast(`สร้างแปลน "${p.meta.name}" แล้ว — แปลนเดิมยังอยู่ในแท็บ "ภาพรวม"`);
  }
  function openPlan(id) {
    const e = library.find((x) => x.id === id);
    if (!e) return;
    if (id === planId) { tab = 'design'; render(); return; }
    let p;
    try { p = SAN.project(e.project).project; } catch (err) { toast('เปิดแปลนนี้ไม่ได้: ' + (err.message || err)); return; }
    enterPlan(p, id, 'dash');
    logEvent('plan', `เปิดแปลน "${p.meta.name}"`);
    toast(`เปิดแปลน "${p.meta.name}"`);
  }
  function dupPlan(id) {
    if (id === planId && result) savePlan();
    const e = library.find((x) => x.id === id);
    if (!e || !canAddPlan()) return;
    const copy = JSON.parse(JSON.stringify(e.project));
    copy.meta = Object.assign({}, copy.meta, { name: uniqueName(`${e.name} (สำเนา)`) });
    library.unshift({ id: uid('plan-'), name: copy.meta.name, updated: Date.now(), project: copy });
    writeLib();
    logEvent('plan', `ทำสำเนาแปลน "${e.name}" → "${copy.meta.name}"`);
    toast(`ทำสำเนาเป็น "${copy.meta.name}" แล้ว`);
    render();
  }
  async function deletePlan(id) {
    const e = library.find((x) => x.id === id);
    if (!e) return;
    const isCur = id === planId;
    if (!(await askConfirm({ title: `ลบแปลน "${e.name}"?`, body: isCur ? 'แปลนที่เปิดอยู่จะถูกลบออกจากห้องสมุด และสลับไปแปลนอื่นแทน (กด "เลิกทำ" ได้ภายใน 6 วินาที)' : `จะลบออกจากห้องสมุด${disk.on ? ' (ทั้งในเบราว์เซอร์และไฟล์ใน projects/library)' : 'ในเบราว์เซอร์นี้'} (กด "เลิกทำ" ได้ภายใน 6 วินาที)`, ok: 'ลบแปลน', danger: true }))) return;
    const idx = library.indexOf(e);
    if (isCur) {
      const other = library.find((x) => x.id !== id);
      let p = null;
      if (other) { try { p = SAN.project(other.project).project; } catch (err) { p = null; } }
      enterPlan(p || blankProject(), p ? other.id : uid('plan-'), 'dash');
    }
    library = library.filter((x) => x.id !== id);
    deletedIds.add(id);
    if (disk.on) { disk.pending.delete(id); disk.dels.add(id); saveDelQ(); }
    sumCache.clear();
    writeLib();
    logEvent('plan', `ลบแปลน "${e.name}"`, { id, name: e.name });
    if (!isCur) render();
    pushToast(`ลบแปลน "${e.name}" แล้ว`, 6000, () => {             // เลิกทำระดับห้องสมุด ใช้ได้แม้สลับแปลนแล้ว
      deletedIds.delete(e.id);
      // ส่งกลับขึ้นดิสก์ใหม่: เวลาแก้ต้องใหม่กว่าเวลาลบ ไม่งั้นเซิร์ฟเวอร์ถือว่าเป็นฉบับค้างและไม่กู้ให้
      if (disk.on) { e.updated = Date.now(); disk.dels.delete(e.id); disk.pushed.delete(e.id); saveDelQ(); }
      if (!library.some((x) => x.id === e.id)) library.splice(Math.min(idx, library.length), 0, e);
      writeLib();
      logEvent('plan', `เลิกทำการลบแปลน "${e.name}"`, { id, name: e.name });
      if (tab === 'dash') render();
    });
  }

  /* ================= view: ภาพรวม (Dashboard) ================= */
  const ago = (t) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'เมื่อสักครู่';
    if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
    if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว';
    return Math.floor(s / 86400) + ' วันที่แล้ว';
  };
  const stamp = (t) => { try { return new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' }); } catch (e) { return new Date(t).toISOString(); } };
  const utilClass = (u) => (u >= 100 ? 'bad' : u >= 85 ? 'warn' : 'ok');

  // สรุปตัวเลขสำคัญของแปลนหนึ่ง ๆ (ใช้ทั้งการ์ดแปลนและส่วนหัวของแปลนที่เปิด)
  function summarize(proj, res) {
    const s = res.service, t = res.totals, m = res.meta;
    let nCct = 0, nSpare = 0, nForced = 0;
    res.panels.forEach((p) => {
      p.circuits.forEach((c) => { if (c.cat === 'spare') nSpare++; else nCct++; if (c.cbForce && c.cbAuto !== c.cbForce) nForced++; });
      if (p.layout) nSpare += p.layout.slots.filter((x) => x && x.auto).length;
    });
    return {
      name: proj.meta.name, owner: proj.meta.owner || '', location: proj.meta.location || '',
      conn: t.connected / 1000, dem: t.demand / 1000, trafo: s.trafo ? s.trafo.kva : 0, z: s.trafo ? s.trafo.z : 0,
      util: s.trafo ? t.demand / 10 / s.trafo.kva : 0, meter: s.meter ? s.meter.size : '', utility: m.utility, hvKV: m.hvKV,
      mainCB: s.mainCB ? s.mainCB.label : '-', ic: s.mainCB ? s.mainCB.ic : 0, busbar: s.busbar || 0, I: s.demandI || 0,
      nPanels: proj.panels.length, nLP: res.panels.filter((p) => p.isLP).length, nCct, nSpare, nForced, nWarn: res.warnings.length,
      warns: res.warnings.slice(0, 300),
      panels: res.panels.map((p) => ({ name: p.board.name, kind: p.board.kind, conn: p.connected / 1000, dem: p.demand / 1000, unb: p.board.phases === 3 ? p.unbalance : null }))
    };
  }
  function planSummary(e) {
    if (e.id === planId && result) return summarize(project, result);
    const key = e.id + '|' + e.updated;
    if (sumCache.has(key)) return sumCache.get(key);
    let sm;
    try { const p = SAN.project(e.project).project; sm = summarize(p, E.calculate(p)); } catch (err) { sm = { error: String(err.message || err) }; }
    sumCache.set(key, sm);
    return sm;
  }

  function planCardHTML(e) {
    const act = e.id === planId, sm = planSummary(e);
    const head = `<div class="plan-h"><b title="${esc(e.name)}">${esc(e.name)}</b>${act ? '<span class="tag live">กำลังเปิด</span>' : ''}</div>`;
    const acts = `<div class="plan-act">${act ? `<button class="btn sm dark" data-plan-open="${e.id}">ไปที่หน้าออกแบบ</button>` : `<button class="btn sm accent" data-plan-open="${e.id}">เปิดแปลนนี้</button>`}
      <button class="btn sm" data-plan-dup="${e.id}" title="ทำสำเนา">${I.copy}สำเนา</button><span class="spacer"></span><button class="btn ghost sm danger" data-plan-del="${e.id}" title="ลบแปลน" aria-label="ลบแปลน ${esc(e.name)}">${I.trash}</button></div>`;
    if (sm.error) return `<div class="plan bad" data-plan="${e.id}">${head}<div class="plan-sub">คำนวณแปลนนี้ไม่ได้: ${esc(sm.error)}</div>${acts}</div>`;
    const supply = sm.trafo
      ? `<div class="plan-trafo"><span>หม้อแปลง <b class="num">${sm.trafo}</b> kVA <span class="muted tiny">${sm.hvKV} kV · %Z ${sm.z}</span></span><span class="num ${utilClass(sm.util)}-t">ใช้ ${fmt(sm.util, 0)}%</span></div><div class="gauge ${utilClass(sm.util)}"><i style="width:${Math.min(100, sm.util).toFixed(1)}%"></i></div>`
      : `<div class="plan-trafo"><span>รับไฟแรงต่ำ · มิเตอร์ <b class="num">${esc(sm.meter)}</b> <span class="muted tiny">${sm.utility === 'MEA' ? 'กฟน.' : 'กฟภ.'}</span></span><span class="num">${fmt(sm.I, 0)} A</span></div>`;
    return `<div class="plan ${act ? 'on' : ''}" data-plan="${e.id}">${head}
      <div class="plan-sub">${esc([sm.owner, sm.location].filter(Boolean).join(' · ') || 'ยังไม่ระบุเจ้าของ/สถานที่')} · แก้ไข${ago(e.updated)}</div>
      <div class="plan-kv"><div><span class="label">Connected</span><div class="v num">${fmt(sm.conn, 1)}<small>kVA</small></div></div><div><span class="label">Demand</span><div class="v num">${fmt(sm.dem, 1)}<small>kVA</small></div></div></div>
      ${supply}
      <div class="plan-meta"><span>Main CB <b class="num">${esc(sm.mainCB)}</b></span><span>Busbar <b class="num">${sm.busbar}</b> A</span><span>${sm.nPanels} แผง · ${sm.nCct} วงจร</span>${sm.nForced ? `<span class="forced-t">CB กำหนดเอง ${sm.nForced}</span>` : ''}${sm.nWarn ? `<span class="warn-t">เตือน ${sm.nWarn}</span>` : '<span class="ok-t">ไม่มีคำเตือน</span>'}</div>
      ${acts}</div>`;
  }

  function panelCardHTML(p) {
    const b = p.board, f = p.feeder, s = result.service;
    const nCct = p.circuits.filter((c) => c.cat !== 'spare').length;
    const nSp = p.circuits.length - nCct + (p.layout ? p.layout.slots.filter((x) => x && x.auto).length : 0);
    const nForced = p.circuits.filter((c) => c.cbForce && c.cbAuto !== c.cbForce).length;
    const share = result.totals.connected ? p.connected / result.totals.connected * 100 : 0;
    const pv = p.phaseVA, three = b.phases !== 1;
    const warnN = result.warnings.filter((w) => w.startsWith(b.name + ':') || w.startsWith(b.name + ' ·')).length;
    const par = boardOf(b.parent);
    const mainTxt = f ? `${cbShow(f.cb)} · IC ${f.cb.ic} kA` : `${cbShow(s.mainCB)} · IC ${s.mainCB.ic} kA`;
    return `<div class="pcard ${b.id === selected ? 'sel' : ''}" data-pid="${esc(b.id)}">
      <div class="pc-h"><b>${esc(b.name)}</b><span class="tag ${b.kind.toLowerCase()}">${b.kind}</span>${three ? '' : '<span class="tag">1φ</span>'}<span class="spacer"></span>${warnN ? `<span class="warn-t" title="คำเตือน">⚠ ${warnN}</span>` : ''}</div>
      <div class="pc-sub">${esc(b.location || '—')}${par ? ` · รับไฟจาก ${esc(par.name)}` : ''}</div>
      <div class="pc-kv"><div><span class="label">Connected</span><b class="num">${fmt(p.connected / 1000, 2)}</b><small>kVA</small></div><div><span class="label">Demand</span><b class="num">${fmt(p.demand / 1000, 2)}</b><small>kVA</small></div><div><span class="label">I feeder</span><b class="num">${fmt(f ? f.I_F : s.demandI, 1)}</b><small>A</small></div></div>
      <div class="share" title="สัดส่วน Connected ของแผงนี้เทียบทั้งแปลน ${fmt(share, 0)}%"><i style="width:${Math.min(100, share).toFixed(1)}%"></i></div>
      ${three ? `<div class="ph3" title="เฟส A ${fmt(pv[0], 0)} · B ${fmt(pv[1], 0)} · C ${fmt(pv[2], 0)} VA"><i class="a" style="flex:${Math.max(pv[0], 1)}"></i><i class="b" style="flex:${Math.max(pv[1], 1)}"></i><i class="c" style="flex:${Math.max(pv[2], 1)}"></i></div><div class="tiny muted">ไม่สมดุลเฟส <span class="unb ${unbClass(p.unbalance)}">${fmt(p.unbalance, 1)}%</span></div>` : ''}
      <dl class="pc-spec"><dt>CB ป้อน</dt><dd>${esc(mainTxt)}</dd>${f ? `<dt>สายป้อน</dt><dd>${esc(f.text)} ${R.cableShort(f.cable)}</dd>` : `<dt>สายประธาน</dt><dd>${esc(s.mainFeeder.text)}</dd>`}<dt>Busbar</dt><dd>${p.busbar || '-'} A${p.layout ? ` · ${p.layout.ways} ช่อง` : ''}</dd><dt>วงจร</dt><dd>${nCct} ใช้งาน · ${nSp} สำรอง${nForced ? ` · <span class="forced-t">CB กำหนดเอง ${nForced}</span>` : ''}</dd></dl>
      <div class="pc-act"><button class="btn sm" data-select-go="${esc(b.id)}">แก้ไข</button>${p.layout ? `<button class="btn sm" data-sched-go="${esc(b.id)}">ตารางโหลด</button>` : ''}</div></div>`;
  }

  function logHTML() {
    const pool = logs.filter((l) => logView.scope === 'all' || l.pid === planId);
    const types = Object.keys(LOG_TYPES).filter((k) => pool.some((l) => l.type === k));
    const shown = pool.filter((l) => !logView.type || l.type === logView.type);
    const rows = shown.slice(0, 200).map((l) => `<tr><td class="num nowrap">${esc(stamp(l.t))}</td><td class="pn" title="${esc(l.pn)}">${esc(l.pn || '—')}</td><td><span class="lg lg-${l.type}">${LOG_TYPES[l.type]}</span></td><td>${esc(l.msg)}</td></tr>`).join('');
    return `<div class="log-bar">
        <div class="seg"><button class="${logView.scope === 'all' ? 'on' : ''}" data-log-scope="all">ทุกแปลน</button><button class="${logView.scope === 'plan' ? 'on' : ''}" data-log-scope="plan">แปลนนี้</button></div>
        <div class="chips"><button class="chip ${logView.type ? '' : 'on'}" data-log-type="">ทั้งหมด ${pool.length}</button>${types.map((k) => `<button class="chip lg-${k} ${logView.type === k ? 'on' : ''}" data-log-type="${k}">${LOG_TYPES[k]} ${pool.filter((l) => l.type === k).length}</button>`).join('')}</div>
        <span class="spacer"></span>
        <button class="btn sm" data-log-csv="1" ${shown.length ? '' : 'disabled'}>${I.file}ส่งออก CSV</button><button class="btn ghost sm danger" data-log-clear="1" ${logs.length ? '' : 'disabled'}>${I.trash}ล้างบันทึก</button></div>
      ${shown.length ? `<div class="log-wrap"><table class="dt log-tbl"><thead><tr><th>เวลา</th><th>แปลน</th><th>ประเภท</th><th>รายละเอียด</th></tr></thead><tbody>${rows}</tbody></table></div>${shown.length > 200 ? `<div class="tiny muted" style="margin-top:6px">แสดง 200 รายการล่าสุดจาก ${shown.length} (ส่งออก CSV เพื่อดูทั้งหมด)</div>` : ''}`
        : `<div class="empty">${I.bolt}ยังไม่มีบันทึก — ทุกครั้งที่เพิ่ม/แก้/ลบอุปกรณ์ แผง วงจร หรือเปลี่ยนเบรกเกอร์ จะถูกจดไว้ที่นี่</div>`}`;
  }

  function viewDash() {
    const s = result.service, cur = summarize(project, result);
    const plans = library.slice().sort((a, b) => (a.id === planId ? -1 : b.id === planId ? 1 : b.updated - a.updated));
    const totalKVA = plans.reduce((n, e) => { const sm = planSummary(e); return n + (sm.error ? 0 : sm.dem); }, 0);
    const kinds = [['MDB', 'ระบบประธาน (MDB)'], ['SDB', 'แผงสวิตช์รอง (SDB)'], ['LP', 'แผงย่อย (LP)']];
    const groups = kinds.map(([k, title]) => {
      const ps = result.panels.filter((p) => p.board.kind === k);
      if (!ps.length) return '';
      return `<div class="dash-group"><div class="dash-gh"><span class="tag ${k.toLowerCase()}">${k}</span><b>${title}</b><span class="muted tiny">${ps.length} แผง · Connected ${fmt(ps.reduce((n, p) => n + p.connected, 0) / 1000, 2)} kVA</span></div><div class="pcards">${ps.map(panelCardHTML).join('')}</div></div>`;
    }).join('');
    const utilTxt = s.trafo ? `${fmt(cur.util, 0)}% ของพิกัด ${s.trafo.kva} kVA` : 'รับไฟแรงต่ำ ไม่มีหม้อแปลง';
    return `<div class="dash">
      <div class="dash-nav"><span class="label">ไปที่</span><button class="chip" data-jump="dash-plans">แปลนทั้งหมด</button><button class="chip" data-jump="dash-now">แปลนที่เปิดอยู่</button><button class="chip" data-jump="dash-panels">แผงไฟ</button><button class="chip" data-jump="dash-warn">คำเตือน${result.warnings.length ? ` <b>${result.warnings.length}</b>` : ''}</button><button class="chip" data-jump="dash-cmp">เปรียบเทียบ</button><button class="chip" data-jump="dash-log">บันทึกกิจกรรม</button>
        <span class="spacer"></span>${diskStateHTML()}<span class="muted tiny">${library.length} แปลน · ${logs.length} บันทึก</span></div>

      <section id="dash-plans" class="dash-sec"><div class="sec-h"><span class="sec-no">A</span><h2>แปลนทั้งหมด</h2><span class="muted tiny">รวม Demand ทุกแปลน ${fmt(totalKVA, 1)} kVA</span><span class="spacer"></span>
        <button class="btn sm" data-plan-new="sample">${I.copy}เพิ่มแปลนตัวอย่าง</button><button class="btn sm accent" data-plan-new="blank">${I.plus}แปลนใหม่</button></div>
        <div class="plans">${plans.map(planCardHTML).join('')}</div></section>

      <section id="dash-now" class="dash-sec"><div class="sec-h"><span class="sec-no">B</span><h2>${esc(project.meta.name)}</h2><span class="muted tiny">ภาพรวมแปลนที่เปิดอยู่</span></div>
        <div class="bigstats">
          <div class="bigstat"><div class="label">Connected load</div><div class="v"><span data-count="${cur.conn.toFixed(2)}" data-dec="2" data-key="dc">0</span><small>kVA</small></div><div class="s">รวมทุกแผง</div></div>
          <div class="bigstat"><div class="label">Maximum demand</div><div class="v"><span data-count="${cur.dem.toFixed(2)}" data-dec="2" data-key="dd">0</span><small>kVA</small></div><div class="s">${fmt(cur.I)} A ที่ 400 V</div></div>
          <div class="bigstat"><div class="label">${s.trafo ? 'หม้อแปลง' : 'เครื่องวัดฯ'}</div><div class="v">${s.trafo ? `${s.trafo.kva}<small>kVA</small>` : esc(s.meter.size)}</div><div class="s">${utilTxt}</div></div>
          <div class="bigstat"><div class="label">Main CB</div><div class="v" style="font-size:20px">${esc(cbShow(s.mainCB))}</div><div class="s">IC ${s.mainCB.ic} kA · Busbar ${s.busbar} A</div></div>
        </div>
        <div class="grid2">
          <div class="card"><div class="card-h"><h3>สเปกระบบประธาน</h3><span class="spacer" style="flex:1"></span><button class="btn sm" data-goto="feeder">รายละเอียด →</button></div><div class="card-b">${R.serviceHTML(result)}</div></div>
          <div class="card"><div class="card-h"><h3>สัดส่วนโหลดแต่ละแผง</h3><span class="muted tiny">Connected kVA</span></div><div class="card-b">${shareBarsHTML()}${s.trafo ? `<div class="util-line">การใช้งานหม้อแปลง<div class="gauge ${utilClass(cur.util)}"><i style="width:${Math.min(100, cur.util).toFixed(1)}%"></i></div><span class="num">${fmt(cur.dem, 1)} / ${s.trafo.kva} kVA</span></div>` : ''}</div></div>
        </div>
        <div class="card hist-card" id="dash-hist"><div class="card-h"><h3>ประวัติเวอร์ชันของแปลนนี้</h3><span class="muted tiny">บันทึกอัตโนมัติทุก ${SNAP_EVERY / 60000} นาทีที่มีการแก้ · กดเทียบเพื่อดูว่าอะไรเปลี่ยน · กู้คืนได้</span></div><div class="card-b" id="histBox">${histHTML()}</div></div></section>

      <section id="dash-panels" class="dash-sec"><div class="sec-h"><span class="sec-no">C</span><h2>แผงไฟในแปลน</h2><span class="muted tiny">แบ่งตามระดับ — กด "แก้ไข" หรือ "ตารางโหลด" เพื่อไปจัดการ/ลากเปลี่ยนเบรกเกอร์ย่อย</span></div>${groups}</section>

      <section id="dash-warn" class="dash-sec"><div class="sec-h"><span class="sec-no">D</span><h2>คำเตือนรวม</h2><span class="muted tiny">จัดหมวดคำเตือนจากการคำนวณ — แปลนที่เปิดอยู่ละเอียดรายแผง และจำนวนคำเตือนของทุกแปลน</span></div>${warnSectionHTML(plans)}</section>

      <section id="dash-cmp" class="dash-sec"><div class="sec-h"><span class="sec-no">E</span><h2>เปรียบเทียบแปลน</h2><span class="muted tiny">เลือก 2 แปลน ดูตัวเลขสำคัญคู่กัน (ผลต่าง = B − A) และโหลดรายแผงที่ชื่อตรงกัน</span></div>${compareHTML(plans)}</section>

      <section id="dash-log" class="dash-sec"><div class="sec-h"><span class="sec-no">F</span><h2>บันทึกกิจกรรม (Log)</h2><span class="muted tiny">ประวัติการแก้ไขทุกแปลน เก็บล่าสุด ${MAX_LOG} รายการ</span></div><div class="card"><div class="card-b" id="logBox">${logHTML()}</div></div></section>
    </div>`;
  }
  /* ---------- คำเตือนรวม ---------- */
  const WARN_CATS = [
    ['brand', 'เบรกเกอร์ตามยี่ห้อ', /ยี่ห้อ/], // ก่อน 'selectivity'/'cb' — ข้อความเตือนจาก brandcb.js มีคำว่า "ยี่ห้อ" ทุกข้อ
    ['selectivity', 'Selectivity', /selectivity|เลือกตัด/i], // ก่อน 'cb' เพราะข้อความมีคำว่า CB
    ['vd', 'แรงดันตก', /แรงดันตก|VD|%\s?VD/i],
    ['phase', 'เฟส/สมดุล', /เฟส|ไม่สมดุล|unbalance/i],
    ['cb', 'เบรกเกอร์/สาย', /CB|เบรกเกอร์|สาย|IC|MCCB|MCB|2\.5Im/i],
    ['cap', 'พิกัด/ช่อง', /เกิน|ช่อง|พิกัด|เต็ม/],
    ['data', 'ข้อมูล/ตั้งค่า', /ตั้งค่า|ไม่รู้จัก|ไม่พบ|ข้าม|อ่านไม่ได้|ซ้ำ|เชื่อม/]
  ];
  const warnCat = (w) => (WARN_CATS.find((c) => c[2].test(w)) || ['other'])[0];
  const WARN_NAME = Object.fromEntries(WARN_CATS.map((c) => [c[0], c[1]]).concat([['other', 'อื่น ๆ']]));
  function warnSectionHTML(plans) {
    // แผงเจ้าของคำเตือน: ชื่อแผงที่ยาวที่สุดที่ขึ้นต้นข้อความแล้วตามด้วย ":" หรือ " ·" (เหมือนการ์ดแผง)
    const byLen = project.panels.slice().sort((a, b) => String(b.name).length - String(a.name).length);
    const ws = result.warnings.map((w) => {
      const b = byLen.find((x) => x.name && (w.startsWith(x.name + ':') || w.startsWith(x.name + ' ·')));
      return { w, cat: warnCat(w), board: b || null, msg: b ? w.slice(b.name.length).replace(/^\s*[:·]\s*/, '') : w };
    });
    const cnt = {}; ws.forEach((x) => { cnt[x.cat] = (cnt[x.cat] || 0) + 1; });
    const shown = ws.filter((x) => !warnView.cat || x.cat === warnView.cat);
    const chips = `<div class="chips"><button class="chip ${warnView.cat ? '' : 'on'}" data-warn-cat="">ทั้งหมด ${ws.length}</button>${Object.keys(WARN_NAME).filter((k) => cnt[k]).map((k) => `<button class="chip wc-${k} ${warnView.cat === k ? 'on' : ''}" data-warn-cat="${k}">${WARN_NAME[k]} ${cnt[k]}</button>`).join('')}</div>`;
    const rows = shown.slice(0, 150).map((x) => `<tr><td class="nowrap">${x.board ? `<b>${esc(x.board.name)}</b>` : '<span class="muted">ทั้งแปลน</span>'}</td><td><span class="wtag wc-${x.cat}">${WARN_NAME[x.cat]}</span></td><td>${esc(x.msg)}</td><td class="r">${x.board ? `<button class="btn ghost sm" data-select-go="${esc(x.board.id)}">ไปที่แผง →</button>` : ''}</td></tr>`).join('');
    const others = plans.filter((e) => e.id !== planId).map((e) => ({ e, sm: planSummary(e) }));
    const otherHTML = others.length ? `<div class="wplans">${others.map(({ e, sm }) => `<div class="wplan ${sm.error ? 'bad' : sm.nWarn ? 'warn' : 'ok'}"><b title="${esc(e.name)}">${esc(e.name)}</b><span class="num">${sm.error ? 'คำนวณไม่ได้' : sm.nWarn ? `${sm.nWarn} คำเตือน` : 'ไม่มีคำเตือน'}</span>${sm.warns && sm.warns.length ? `<span class="tiny muted">${Object.entries(sm.warns.reduce((m, w) => { const k = warnCat(w); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${WARN_NAME[k]} ${n}`).join(' · ')}</span>` : ''}<button class="btn ghost sm" data-plan-open="${e.id}">เปิด</button></div>`).join('')}</div>` : '';
    return `<div class="card"><div class="card-b">${ws.length ? `${chips}<div class="log-wrap" style="margin-top:8px"><table class="dt warn-tbl"><thead><tr><th>แผง</th><th>หมวด</th><th>รายละเอียด</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${shown.length > 150 ? `<div class="tiny muted">แสดง 150 จาก ${shown.length}</div>` : ''}` : `<div class="empty">${I.bolt}แปลนที่เปิดอยู่ไม่มีคำเตือน</div>`}
      ${otherHTML ? `<div class="label" style="margin:14px 0 6px">แปลนอื่น ๆ</div>${otherHTML}` : ''}</div></div>`;
  }

  /* ---------- เปรียบเทียบแปลน ---------- */
  function compareHTML(plans) {
    if (plans.length < 2) return `<div class="card"><div class="card-b"><div class="empty">${I.copy}ต้องมีอย่างน้อย 2 แปลน — กด "สำเนา" ที่การ์ดแปลน แล้วลองแก้เพื่อเทียบทางเลือก</div></div></div>`;
    const ids = plans.map((e) => e.id);
    if (!ids.includes(cmpSel.a)) cmpSel.a = planId;
    if (!ids.includes(cmpSel.b) || cmpSel.b === cmpSel.a) cmpSel.b = (plans.find((e) => e.id !== cmpSel.a) || {}).id;
    const ea = plans.find((e) => e.id === cmpSel.a), eb = plans.find((e) => e.id === cmpSel.b);
    const A = planSummary(ea), B = planSummary(eb);
    const sel = (k) => `<select data-cmp="${k}" aria-label="แปลน ${k.toUpperCase()}">${plans.map((e) => `<option value="${e.id}" ${e.id === cmpSel[k] ? 'selected' : ''}>${esc(e.name)}${e.id === planId ? ' (เปิดอยู่)' : ''}</option>`).join('')}</select>`;
    const head = `<div class="cmp-bar"><span class="tag">A</span>${sel('a')}<button class="btn ghost sm" data-cmp-swap="1" title="สลับ A/B" aria-label="สลับ A กับ B">⇄</button><span class="tag">B</span>${sel('b')}</div>`;
    if (A.error || B.error) return `<div class="card"><div class="card-b">${head}<div class="empty">คำนวณแปลน${A.error ? ' A' : ''}${B.error ? ' B' : ''} ไม่ได้</div></div></div>`;
    const dl = (a, b, dec, unit, lowerBetter) => {
      if (typeof a !== 'number' || typeof b !== 'number') return a === b ? '<span class="muted">=</span>' : '<span class="muted">ต่าง</span>';
      const d = b - a; if (Math.abs(d) < Math.pow(10, -dec) / 2) return '<span class="muted">=</span>';
      const cls = lowerBetter == null ? '' : (d < 0) === lowerBetter ? 'ok-t' : 'warn-t';
      return `<span class="num ${cls}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d), dec)}${unit ? ' ' + unit : ''}</span>`;
    };
    const M = [
      ['Connected load', A.conn, B.conn, 2, 'kVA', null], ['Maximum demand', A.dem, B.dem, 2, 'kVA', null],
      ['หม้อแปลง', A.trafo || '-', B.trafo || '-', 0, 'kVA', null], ['การใช้งานหม้อแปลง', A.trafo ? A.util : '-', B.trafo ? B.util : '-', 0, '%', true],
      ['กระแสโหลดรวม', A.I, B.I, 1, 'A', true], ['Main CB', A.mainCB, B.mainCB], ['Busbar', A.busbar, B.busbar, 0, 'A', null],
      ['จำนวนแผง', A.nPanels, B.nPanels, 0, '', null], ['วงจรใช้งาน', A.nCct, B.nCct, 0, '', null], ['CB กำหนดเอง', A.nForced, B.nForced, 0, '', null], ['คำเตือน', A.nWarn, B.nWarn, 0, '', true]
    ];
    const v = (x, dec) => (typeof x === 'number' ? fmt(x, dec || 0) : esc(String(x)));
    const rows = M.map(([lab, a, b, dec, unit, lb]) => `<tr><td>${lab}</td><td class="r num">${v(a, dec)}${unit && typeof a === 'number' ? ` <small>${unit}</small>` : ''}</td><td class="r num">${v(b, dec)}${unit && typeof b === 'number' ? ` <small>${unit}</small>` : ''}</td><td class="r">${dl(a, b, dec || 0, unit, lb)}</td></tr>`).join('');
    const names = [...new Set(A.panels.map((p) => p.name).concat(B.panels.map((p) => p.name)))];
    const pa = new Map(A.panels.map((p) => [p.name, p])), pb = new Map(B.panels.map((p) => [p.name, p]));
    const prow = names.slice(0, 80).map((n) => { const x = pa.get(n), y = pb.get(n); return `<tr><td><b>${esc(n)}</b> <span class="tag ${((x || y).kind || '').toLowerCase()}">${esc((x || y).kind)}</span></td><td class="r num">${x ? fmt(x.conn, 2) : '<span class="muted">ไม่มี</span>'}</td><td class="r num">${y ? fmt(y.conn, 2) : '<span class="muted">ไม่มี</span>'}</td><td class="r">${x && y ? dl(x.conn, y.conn, 2, 'kVA', null) : `<span class="tag">${x ? 'เฉพาะ A' : 'เฉพาะ B'}</span>`}</td></tr>`; }).join('');
    return `<div class="card"><div class="card-b">${head}<div class="grid2 cmp-grid">
      <table class="dt cmp-tbl"><thead><tr><th>ตัวเลขสำคัญ</th><th class="r">A</th><th class="r">B</th><th class="r">ผลต่าง</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="log-wrap"><table class="dt cmp-tbl"><thead><tr><th>แผง (Connected kVA)</th><th class="r">A</th><th class="r">B</th><th class="r">ผลต่าง</th></tr></thead><tbody>${prow}</tbody></table></div></div></div></div>`;
  }

  function shareBarsHTML() {
    const rows = result.panels.filter((p) => p.board.kind !== 'MDB' && p.connected > 0).sort((a, b) => b.connected - a.connected);
    if (!rows.length) return '<div class="muted tiny">ยังไม่มีโหลดในแผงใด</div>';
    const max = rows[0].connected;
    return `<div class="sbars">${rows.slice(0, 12).map((p) => `<div class="sbar"><span class="nm">${esc(p.board.name)}</span><div class="track"><i style="width:${(p.connected / max * 100).toFixed(1)}%"></i></div><span class="num">${fmt(p.connected / 1000, 2)}</span></div>`).join('')}</div>`;
  }

  /* ================= view: ออกแบบ ================= */
  const panelOut = (id) => result.panels.find((p) => p.id === id);
  const boardOf = (id) => project.panels.find((p) => p.id === id);

  function treeHTML() {
    const kids = (id) => project.panels.filter((p) => p.parent === id && p.id !== id);
    // ค้นหาแผงด่วน: แผงที่ตรง = hit, บรรพบุรุษ = dim (คงไว้เพื่อให้เห็นเส้นทาง), ที่เหลือซ่อน
    const q = panelQuery.trim();
    const hit = q ? new Set(UK.filterPanels(searchBoards(), q)) : null;
    const keep = new Set();
    if (hit) hit.forEach((id) => { for (let x = boardOf(id), n = 0; x && n < 50; x = boardOf(x.parent), n++) keep.add(x.id); });
    if (hit && !hit.size) return `<div class="tree-empty">ไม่พบแผงที่ตรงกับ "${esc(q)}"</div>`;
    const node = (b, depth) => {
      if (hit && !keep.has(b.id)) return '';
      const po = panelOut(b.id);
      const chHTML = kids(b.id).map((c) => node(c, depth + 1)).join('');
      return `<li role="none"><div role="treeitem" aria-selected="${b.id === selected}"aria-level="${depth + 1}" class="node ${b.id === selected ? 'on' : ''} ${seen.has('n' + b.id) ? '' : 'fresh'}${hit ? (hit.has(b.id) ? ' hit' : ' dim') : ''}" data-select="${b.id}" style="animation-delay:${depth * 40}ms">
          ${b.kind === 'LP' ? I.board : I.sdb}<span class="nm">${esc(b.name)}</span><span class="tag ${b.kind.toLowerCase()}">${b.kind}</span>${b.emergency ? '<span class="tag em" title="แผงฉุกเฉิน (รับไฟผ่าน ATS)">EM</span>' : ''}${b.tap === 'ahead_of_main' ? '<span class="tag em" title="ต่อก่อนเมนสวิตช์ (Tap ahead of main — NFPA 20)">TAP</span>' : ''}
          <span class="kva">${po ? fmt(po.demand / 1000, 1) : '-'}</span></div>
          ${chHTML ? `<ul role="group">${chHTML}</ul>` : ''}</li>`;
    };
    const root = project.panels.find((p) => p.kind === 'MDB');
    const orphans = project.panels.filter((p) => p.kind !== 'MDB' && !boardOf(p.parent));
    return `<ul class="tree" role="tree" aria-label="โครงสร้างแผงไฟ">${root ? node(root, 0) : ''}${orphans.map((o) => node(o, 0)).join('')}</ul>`;
  }

  const TYPES = [
    ['light', 'แสงสว่าง', 'โคม LED/ฟลูออเรสเซนต์/HID'], ['rec', 'เต้ารับ', 'จุดใช้งานทั่วไป'], ['ac', 'แอร์ Split', '1 เฟส / 3 เฟส ตาม BTU'],
    ['heater', 'น้ำอุ่น/น้ำร้อน', 'วงจรเฉพาะ + RCBO'], ['cook', 'เครื่องหุงต้ม', 'เตา ไมโครเวฟ'], ['motor', 'มอเตอร์/ปั๊ม', 'คิด FLC ตาราง 8.2'], ['fire_pump', 'ปั๊มดับเพลิง', 'NFPA 20 · Mag-only · สาย FRC'],
    ['lift', 'ลิฟต์', 'ตาราง 6.8'], ['esc', 'บันไดเลื่อน', 'ตาราง 6.9'], ['chiller', 'ชิลเลอร์', 'ตาราง 6.6–6.7'],
    ['ev', 'ที่ชาร์จรถไฟฟ้า', '7.4 / 11 / 22 kW + RCD'], ['custom', 'กำหนดเอง', 'ใส่ W/VA เอง'], ['spare', 'วงจรสำรอง', 'Spare มี CB']
  ];
  const TYPE_NAME = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));

  function itemSummary(it) {
    switch (it.type) {
      case 'light': { const l = E.lampById(it.lamp); return `${it.fixtures} โคม × ${it.perFixture || 1} หลอด ${l.label}`; }
      case 'rec': return `${it.points} จุด × ${it.vaPerPoint || (it.duty === 'heavy' ? D.REC_DUTY.heavy.vaPerPoint : project.meta.recVA)} VA${it.duty === 'heavy' ? ' · ใช้งานหนัก 20 A RCBO' : ''}${it.wet && it.duty !== 'heavy' ? ' · พื้นที่เปียก (RCBO)' : ''}`;
      case 'ac': return `${fmt(it.btu, 0)} BTU × ${it.qty || 1} เครื่อง`;
      case 'heater': return `${fmt(it.watt, 0)} W × ${it.qty || 1}`;
      case 'cook': return `${fmt(it.watt, 0)} W × ${it.qty || 1}`;
      case 'motor': return `${it.kw} kW ${it.phases || 3}φ ${it.start === 'YD' ? 'Y-Δ' : 'DOL'} × ${it.qty || 1}`;
      case 'fire_pump': return `${it.kw} kW ${it.phases || 3}φ · Mag-only · FRC · ไม่มี RCD × ${it.qty || 1}`;
      case 'lift': return it.kva ? `${it.kva} kVA` : (() => { const l = D.LIFTS[it.preset || 0]; return `${l[0]} kg ${l[1]} คน ${l[2]} m/min → ${l[3]} kVA`; })();
      case 'esc': return it.kva ? `${it.kva} kVA` : `${D.ESCALATORS[it.preset || 0][2]} kVA`;
      case 'chiller': return it.kva ? `${it.kva} kVA` : (() => { const t = it.cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER; const c = t[it.preset || 0]; return `${c[0]} TR → ${c[1]} kVA`; })();
      case 'ev': return it.kw ? `${it.kw} kW ${it.phases || (it.kw > 7.4 ? 3 : 1)}φ × ${it.qty || 1} · RCD` : (() => { const e = D.EV_CHARGERS[it.preset || 0] || D.EV_CHARGERS[0]; return `${e[0]} kW ${e[1]}φ ${e[2]} A × ${it.qty || 1} · RCD`; })();
      case 'custom': return it.watt ? `${fmt(it.watt, 0)} W pf ${it.pf || 1} · ${it.phases || 1}φ` : `${fmt(it.va, 0)} VA · ${it.phases || 1}φ`;
      case 'spare': return `CB ${it.cb || 16} A × ${it.qty || 1}`;
    }
    return '';
  }

  function viewDesign() {
    const b = boardOf(selected) || project.panels[0];
    selected = b.id;
    const po = panelOut(b.id);
    const items = project.items.filter((i) => i.panelId === b.id);
    const parents = project.panels.filter((p) => p.id !== b.id && p.kind !== 'LP' && !isDescendant(p.id, b.id));
    const circuitsOfItem = (id) => po ? po.circuits.filter((c) => c.itemId === id) : [];

    const itemsHTML = items.length ? items.map((it, i) => {
      const cs = circuitsOfItem(it.id);
      const va = cs.reduce((s, c) => s + c.va, 0);
      return `<div class="item ${seen.has(it.id) ? '' : 'fresh'}" data-edit="${it.id}" style="animation-delay:${i * 25}ms">
        <div class="ic">${I[it.type] || I.custom}</div>
        <div class="t"><b>${esc(it.name || TYPE_NAME[it.type])}</b><div>${esc(itemSummary(it))}</div></div>
        <div class="va">${fmt(Math.round(va), 0)} VA<small>${cs.length} วงจร · ${cs.map((c) => c.cb ? c.cb.at + 'A' : '').filter(Boolean).slice(0, 3).join(' ')}${cs.length > 3 ? '…' : ''}</small></div>
        <div style="display:flex;gap:2px"><button class="btn ghost sm" data-dup="${it.id}" title="ทำซ้ำ">${I.copy}</button><button class="btn ghost sm danger" data-del="${it.id}" title="ลบ">${I.trash}</button></div>
      </div>`;
    }).join('') : `<div class="empty">${I.bolt}ยังไม่มีอุปกรณ์ในแผงนี้ — เลือกจากด้านล่างเพื่อเพิ่ม<div style="margin-top:10px"><button class="btn accent sm" data-action="open-importer">${I.bolt}หรือนำเข้าจากแบบ/รายการโหลด</button></div></div>`;

    const isRoot = b.kind === 'MDB';
    const allowed = b.kind === 'LP' ? TYPES : TYPES.filter((t) => ['motor', 'fire_pump', 'lift', 'esc', 'chiller', 'ac', 'ev', 'custom'].includes(t[0]));

    return `<div class="design">
      <aside class="card">
        <div class="card-h"><span class="label">ผังแผงไฟ</span><span class="tiny muted" style="margin-left:auto" title="ลากแผงไปวางบนแผงสวิตช์ (MDB/SDB) ที่จะเป็นต้นทางจ่ายไฟให้">ลากแผงไปวางบนต้นทางเพื่อย้าย ⇅</span></div>
        <div class="tree-search"><input type="search" id="panelSearch" value="${esc(panelQuery)}" placeholder="ค้นหาแผง (ชื่อ / ชั้น / ที่ตั้ง)" aria-label="ค้นหาแผงด่วน" autocomplete="off" spellcheck="false"><span class="kbd" title="คีย์ลัด Ctrl+K หรือ /">Ctrl K</span></div>
        <div id="treeBox">${treeHTML()}</div>
        <div class="tree-actions"><button class="btn sm" data-add-board="LP">${I.plus}แผงย่อย</button><button class="btn sm" data-add-board="SDB">${I.plus}แผงสวิตช์รอง</button></div>
      </aside>

      <section style="display:flex;flex-direction:column;gap:16px;min-width:0">
        <div class="card"><div class="card-b">
          <div class="board-title"><input data-board="name" value="${esc(b.name)}" aria-label="ชื่อแผง"><span class="tag ${b.kind.toLowerCase()}">${R.KIND_TH[b.kind]}</span>
            <span class="spacer"></span>${isRoot ? '' : `<button class="btn ghost sm danger" data-del-board="${b.id}">${I.trash}ลบแผง</button>`}</div>
          <div class="board-head">
            <label class="field"><span>ตำแหน่งติดตั้ง</span><input type="text" data-board="location" value="${esc(b.location || '')}" placeholder="เช่น ชั้น 2 ห้องไฟฟ้า"></label>
            ${isRoot ? '' : `<label class="field"><span>รับไฟจาก</span><select data-board="parent">${parents.map((p) => `<option value="${p.id}" ${p.id === b.parent ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`}
            <label class="field"><span>ระบบ</span><select data-board="phases" ${isRoot ? 'disabled' : ''}><option value="3" ${b.phases !== 1 ? 'selected' : ''}>3 เฟส 4 สาย</option><option value="1" ${b.phases === 1 ? 'selected' : ''}>1 เฟส 2 สาย</option></select></label>
            ${isRoot ? '' : `<label class="field"><span>ความยาวสายป้อน (m)</span><input type="number" min="0" step="1" data-board="feederLength" value="${Number(b.feederLength) || 0}"></label>`}
            <label class="field"><span>ชั้นที่ติดตั้ง (Riser)</span><input type="number" step="1" min="-20" max="200" data-board="floor" value="${b.floor == null || b.floor === '' ? '' : Number(b.floor)}" placeholder="เช่น 1, 2, -1"><span class="hint">ระบุทั้งแผงนี้และแผงแม่ → บวกสายแนวดิ่ง |Δชั้น| × ${project.meta.floorHeight} m + 2 m</span></label>
            ${b.phases === 1 && !isRoot ? `<label class="field"><span>ต่อเข้าเฟส</span><select data-board="phase"><option value="" ${b.phase == null || b.phase === '' ? 'selected' : ''}>อัตโนมัติ (กระจาย A/B/C)</option>${['A', 'B', 'C'].map((k, i) => `<option value="${i}" ${Number(b.phase) === i && b.phase !== '' && b.phase != null ? 'selected' : ''}>เฟส ${k}</option>`).join('')}</select><span class="hint">แผง 1 เฟสใต้แผง 3 เฟส</span></label>` : ''}
            ${!isRoot && project.meta.buildingType === 'condo' ? `<label class="field"><span>ห้องชุด (ตาราง 9.1–9.4)</span><select data-board="unit"><option value="" ${!b.unit ? 'selected' : ''}>อัตโนมัติ (${b.kind === 'LP' && b.phases === 1 ? 'ห้องชุดพักอาศัย' : 'ไม่ใช่ห้องชุด'})</option><option value="res" ${b.unit === 'res' ? 'selected' : ''}>ห้องชุดพักอาศัย</option><option value="com" ${b.unit === 'com' ? 'selected' : ''}>ห้องชุดพาณิชย์</option><option value="none" ${b.unit === 'none' ? 'selected' : ''}>ส่วนกลาง (ไม่ใช่ห้องชุด)</option></select><span class="hint">ใช้ตัวคูณโหลดพร้อมกันที่ SDB/MDB</span></label>` : ''}
            ${b.kind === 'LP' ? `<label class="field"><span>ขนาดแผง</span><select data-board="ways"><option value="">อัตโนมัติ</option>${D.PANEL_WAYS.map((w) => `<option value="${w}" ${Number(b.ways) === w ? 'selected' : ''}>${w} ช่อง</option>`).join('')}</select></label>` : ''}
          </div>
          ${b.kind === 'LP' ? `<div class="row2"><label class="check"><input type="checkbox" data-board="nonlinear" ${b.nonlinear ? 'checked' : ''}>มีโหลด non-linear มาก (คอมพิวเตอร์/LED driver) → ใช้ full neutral</label>
            <label class="field" style="margin:0"><span>การติดตั้งตู้</span><select data-board="mounting"><option ${b.mounting !== 'FLUSH' ? 'selected' : ''}>SURFACE</option><option ${b.mounting === 'FLUSH' ? 'selected' : ''}>FLUSH</option></select></label></div>` : ''}
          <div class="row2"><label class="check"><input type="checkbox" data-board="emergency" ${b.emergency ? 'checked' : ''}>แผงฉุกเฉิน (รับไฟผ่าน ATS)</label><span class="hint">ดีมานด์ของแผงนี้รวมแผงลูกใช้คำนวณ ATS + เครื่องกำเนิดไฟฟ้า</span></div>
          ${isRoot ? '' : `<div class="row2"><label class="check"><input type="checkbox" data-board="tap" ${b.tap === 'ahead_of_main' ? 'checked' : ''}>ต่อก่อนเมนสวิตช์ (Tap ahead of main — ปั๊มดับเพลิง NFPA 20)</label><span class="hint">ใช้ได้เฉพาะแผงที่รับไฟตรงจาก MDB : CB ประธานไม่รวมโหลดแผงนี้ แต่หม้อแปลง/สายประธาน/เครื่องกำเนิดไฟฟ้า/Ik" ยังคิดรวม · การตีความขึ้นกับโครงการและการไฟฟ้า (หลายแห่งใช้ ATS จากเครื่องกำเนิดไฟฟ้า) จึงปิดไว้เป็นค่าเริ่มต้น</span></div>`}
        </div></div>

        <div class="card">
          <div class="card-h"><h3>อุปกรณ์ในแผงนี้</h3><span class="muted tiny">${items.length} รายการ${po ? ` · ${po.circuits.length} วงจร` : ''}</span><span class="spacer" style="flex:1"></span>
            ${b.kind === 'LP' && po && po.layout ? `<button class="btn sm" data-goto="schedule">ดูตารางโหลด →</button>` : ''}</div>
          <div class="card-b"><div class="items">${itemsHTML}</div></div>
        </div>

        <div class="card">
          <div class="card-h"><h3>เพิ่มอุปกรณ์</h3><span class="muted tiny">${b.kind === 'LP' ? 'กดเลือกชนิด แล้วกรอกข้อมูลทางขวา' : 'แผงสวิตช์: ต่อโหลดขนาดใหญ่โดยตรงได้ (มอเตอร์ ลิฟต์ ชิลเลอร์ ฯลฯ) หรือเพิ่มแผงลูกจากผังด้านซ้าย'}</span></div>
          <div class="card-b"><div class="palette">${allowed.map(([k, t, s]) => `<button class="tile" data-new="${k}">${I[k]}<b>${t}</b><small>${s}</small></button>`).join('')}</div></div>
        </div>
      </section>

      ${summaryHTML(po)}
    </div>`;
  }

  // ลบอุปกรณ์: เล่นแอนิเมชันหุบแถว (≈220 ms) แล้วค่อยลบจริง — เลิกทำได้ทั้งก่อนและหลังลบ และกลับที่ตำแหน่งเดิม
  function deleteItem(id, row) {
    const idx = project.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const removed = project.items[idx];
    const pid = planId;
    let done = false, cancelled = false;
    const commit = () => { if (cancelled || planId !== pid) return; done = true; project.items = project.items.filter((x) => x.id !== id); logEvent('item', `ลบ ${removed.name || TYPE_NAME[removed.type]} ออกจาก ${(boardOf(removed.panelId) || {}).name || 'แผง'}`); recalc(true); };
    if (row) { row.classList.add('removing'); setTimeout(commit, 220); } else commit();
    toastUndo(`ลบ ${removed.name || TYPE_NAME[removed.type]} แล้ว`, () => {
      if (!done) { cancelled = true; if (row) row.classList.remove('removing'); return; }
      if (planId !== pid) return;
      project.items.splice(Math.min(idx, project.items.length), 0, removed); logEvent('item', `เลิกทำการลบ ${removed.name || TYPE_NAME[removed.type]}`); recalc(true);
    });
  }

  /* ---- ลบ/ปรับวงจรทีละวงจร ----
   * วงจรไม่ได้ถูกเก็บแยก (สร้างใหม่จากอุปกรณ์ทุกครั้ง) จึงลบโดย "ตัดส่วนของวงจรนั้นออกจากอุปกรณ์เจ้าของ":
   * ไฟ → ลดจำนวนโคมของวงจรนั้นและลดจำนวนวงจรลง 1, เต้ารับ → ลดจำนวนจุด, แอร์/มอเตอร์/อื่น ๆ → ลดจำนวนเครื่อง 1,
   * อุปกรณ์ที่เหลือวงจรเดียว → ลบอุปกรณ์, SPARE ที่ระบบเติมเอง → ลดจำนวน SPARE ของแผงนั้น  (เลิกทำได้ทุกกรณี) */
  function snapshotProject() { return JSON.stringify({ panels: project.panels, items: project.items }); }
  function restoreSnapshot(snap) { Object.assign(project, JSON.parse(snap)); if (!boardOf(selected)) selected = firstSelectable(project); recalc(true); }

  function deleteCircuit(panelId, no) {
    const po = panelOut(panelId), b = boardOf(panelId);
    if (!po || !b || !po.layout) return;
    const c = po.layout.slots[no - 1];
    if (!c || c.ref) { toast('วงจรนี้เป็นส่วนต่อของเบรกเกอร์ 3 ขั้ว — ลบที่ขั้วแรกของวงจร'); return; }
    const snap = snapshotProject();
    const label = `วงจรที่ ${no} · ${c.desc || 'SPARE'}`;
    if (c.auto) {
      const autoN = po.layout.slots.filter((s) => s && s.auto).length;
      b.spareCount = Math.max(0, autoN - 1);
    } else {
      const it = project.items.find((x) => x.id === c.itemId);
      if (!it) { toast('ไม่พบอุปกรณ์เจ้าของวงจรนี้'); return; }
      const sibling = po.circuits.filter((x) => x.itemId === it.id).length;     // จำนวนวงจรทั้งหมดของอุปกรณ์นี้
      const sh = c.share || { field: 'qty', n: 1 };
      shiftCbOv(it, c.cIdx);
      if (sibling <= 1) project.items = project.items.filter((x) => x !== it);
      else if (sh.field === 'fixtures') { it.fixtures = Math.max(1, (Number(it.fixtures) || 1) - sh.n); it.circuits = sibling - 1; }
      else if (sh.field === 'points') it.points = Math.max(1, (Number(it.points) || 1) - sh.n);
      else it.qty = Math.max(1, (Number(it.qty) || 1) - (sh.n || 1));
    }
    recalc(true);
    logEvent('circuit', `ลบ ${b.name} ${label}`);
    toastUndo(`ลบ ${label} แล้ว`, () => { restoreSnapshot(snap); logEvent('circuit', `เลิกทำการลบ ${b.name} ${label}`); });
  }
  function adjustSpare(panelId, delta) {
    const po = panelOut(panelId), b = boardOf(panelId);
    if (!po || !b || !po.layout) return;
    const autoN = po.layout.slots.filter((s) => s && s.auto).length;
    const free = po.layout.slots.filter((s) => !s).length;
    if (delta > 0 && !free) { toast('แผงเต็มแล้ว — เพิ่มขนาดแผงที่หน้า "ออกแบบ" ก่อน'); return; }
    if (delta < 0 && !autoN) { toast('ไม่มี SPARE ที่ระบบเติมให้แล้ว (SPARE ที่เพิ่มเองลบที่ตารางด้านล่างได้)'); return; }
    b.spareCount = Math.max(0, autoN + delta);
    logEvent('circuit', `${b.name}: SPARE ${autoN} → ${b.spareCount}`);
    recalc(true);
  }

  /* ---- Balance Load: จัดเฟส A/B/C ภายในแต่ละแผงให้ต่างกันน้อยที่สุด (เปิดโหมดจัดเฟสเข้มของแผง) ---- */
  function balanceBoards(ids) {
    const targets = ids.map(boardOf).filter((b) => b && b.kind === 'LP' && b.phases !== 1);
    if (!targets.length) { toast('ไม่มีแผง 3 เฟสให้จัดสมดุล'); return; }
    if (targets.length === 1 && targets[0].balance === 'deep') {          // กดซ้ำ = ปิด กลับโหมดจัดเฟสอัตโนมัติ
      const b = targets[0]; delete b.balance; logEvent('balance', `ปิด Balance Load ของ ${b.name}`); recalc(true);
      toastUndo(`ปิด Balance Load ของ ${b.name} (กลับโหมดอัตโนมัติ)`, () => { b.balance = 'deep'; recalc(true); });
      return;
    }
    const before = {};
    targets.forEach((b) => { const po = panelOut(b.id); before[b.id] = { un: po ? po.unbalance : 0, bal: b.balance }; });
    targets.forEach((b) => { b.balance = 'deep'; });
    logEvent('balance', `Balance Load: ${targets.map((b) => b.name).join(', ')}`);
    afterCalc = () => {
      const parts = targets.map((b) => { const po = panelOut(b.id); return po ? { name: b.name, a: before[b.id].un, z: po.unbalance } : null; }).filter(Boolean);
      const changed = parts.filter((x) => Math.abs(x.a - x.z) >= 0.05);
      if (!changed.length) { toast(`สมดุลดีที่สุดแล้ว — ไม่สมดุล ${fmt(Math.max(...parts.map((x) => x.z)), 1)}%`); return; }
      const txt = changed.slice(0, 3).map((x) => `${x.name} ${fmt(x.a, 1)}% → ${fmt(x.z, 1)}%`).join(' · ') + (changed.length > 3 ? ` (+${changed.length - 3} แผง)` : '');
      toastUndo('Balance Load: ' + txt, () => { targets.forEach((b) => { if (before[b.id].bal) b.balance = before[b.id].bal; else delete b.balance; }); recalc(true); });
      $$('.pbar .fill, .sheet .unb').forEach((el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
    };
    recalc(true);
  }

  function isDescendant(id, ancestor) {
    let cur = boardOf(id);
    const seen = new Set();
    while (cur && cur.parent && !seen.has(cur.id)) { seen.add(cur.id); if (cur.parent === ancestor) return true; cur = boardOf(cur.parent); }
    return false;
  }

  function summaryHTML(po) {
    if (!po) return '<aside class="side-r"></aside>';
    const pv = po.phaseVA;
    const max = Math.max(...pv, 1);
    const f = po.feeder;
    const warnsAll = result.warnings.filter((w) => w.startsWith(po.board.name + ':') || w.startsWith(po.board.name + ' ·'));
    const s = result.service;
    const mini = po.layout ? R.panelRows(po).filter((r) => r.kind === 'load').sort((a, b) => a.no - b.no).slice(0, 14) : [];
    return `<aside class="side-r">
      <div class="kpis">
        <div class="kpi"><div class="label">Connected</div><div class="v"><span data-count="${(po.connected / 1000).toFixed(2)}" data-dec="2" data-key="c-${po.id}">0</span><small>kVA</small></div></div>
        <div class="kpi"><div class="label">Demand</div><div class="v"><span data-count="${(po.demand / 1000).toFixed(2)}" data-dec="2" data-key="d-${po.id}">0</span><small>kVA</small></div></div>
        <div class="kpi"><div class="label">I feeder</div><div class="v"><span data-count="${(f ? f.I_F : s.demandI).toFixed(1)}" data-dec="1" data-key="i-${po.id}">0</span><small>A</small></div></div>
        <div class="kpi"><div class="label">Ik" ที่แผง</div><div class="v"><span data-count="${po.sc ? po.sc.Ik.toFixed(1) : 0}" data-dec="1" data-key="k-${po.id}">0</span><small>kA</small></div></div>
      </div>
      <div class="card"><div class="card-b">
        <div class="phase-h"><div class="label">โหลดแต่ละเฟส ${po.board.phases === 3 ? `· ไม่สมดุล <span class="unb ${unbClass(po.unbalance)}">${fmt(po.unbalance, 1)}%</span>` : ''}</div>
          ${po.board.phases !== 1 && po.balance ? `<button class="btn sm ${po.balance.mode === 'deep' ? 'on' : ''}" data-balance="${po.id}" title="จัดเฟส A/B/C ให้ต่างกันน้อยที่สุด">${I.balance}Balance Load${po.balance.mode === 'deep' ? ' ✓' : ''}</button>` : ''}</div>
        <div class="phasebars">${['A', 'B', 'C'].map((k, i) => `<div class="pbar"><span class="k">${k}</span><div class="track"><div class="fill" data-w="${(pv[i] / max * 100).toFixed(1)}" style="background:var(--ph${k})"></div></div><span class="v">${fmt(Math.round(pv[i]), 0)} VA</span></div>`).join('')}</div>
      </div></div>
      ${f ? `<dl class="feeder-chip"><dt>Feeder CB</dt><dd>${esc(cbShow(f.cb))} · ${f.cb.ic}kA${f.coord ? R.coordTag(f.coord) : ''}</dd><dt>สายป้อน</dt><dd>${esc(f.text)} ${R.cableShort(f.cable)}</dd><dt>ช่องเดินสาย</dt><dd>${esc(f.raceway)}</dd><dt>VD สะสม</dt><dd>${fmt(po.vdUp)}% (ถึงปลายวงจร ${fmt(po.vdTotalMax)}%)</dd></dl>`
        : `<dl class="feeder-chip"><dt>${s.trafo ? 'หม้อแปลง' : 'มิเตอร์'}</dt><dd>${s.trafo ? s.trafo.kva + ' kVA' : esc(s.meter.size)}</dd><dt>Main CB</dt><dd>${esc(s.mainCB.label)} · ${s.mainCB.ic}kA</dd><dt>สายประธาน</dt><dd>${esc(s.mainFeeder.text)}</dd><dt>Busbar</dt><dd>${s.busbar} A</dd></dl>`}
      ${mini.length ? `<div class="card"><div class="card-b" style="padding:10px 12px"><div class="label" style="margin-bottom:6px">วงจรในแผง</div><table class="mini-sched">${mini.map((r) => `<tr${r.c.itemId && r.c.cIdx ? ` data-cbrow="${esc(po.id)}|${r.no}"` : ''}><td class="n">${r.no}</td><td><span class="dot ${['A', 'B', 'C'][r.ph]}"></span>${esc(r.c.desc)}</td>${r.c.itemId && r.c.cIdx ? R.cbCell(po.id, r.no, r.c, { grip: false }) : `<td class="r">${r.c.cb.at}A</td>`}<td class="r">${esc(r.c.cond.text)}</td><td class="x"><button class="row-x" type="button" data-del-circuit="${esc(po.id)}|${r.no}" title="ลบวงจรที่ ${r.no}" aria-label="ลบวงจรที่ ${r.no}">×</button></td></tr>`).join('')}</table></div></div>` : ''}
      ${warnsAll.length ? `<ul class="warns">${warnsAll.map((w) => `<li>${esc(w.replace(po.board.name + ': ', '').replace(po.board.name + ' · ', ''))}</li>`).join('')}</ul>` : (po.connected ? `<div class="okline">${I.check} ผ่านเกณฑ์ที่ตั้งไว้ทั้งหมด</div>` : '')}
    </aside>`;
  }

  /* ================= drawer (ฟอร์มอุปกรณ์) ================= */
  function openDrawer(type, item) {
    const isNew = !item;
    const m = project.meta;
    const it = item ? JSON.parse(JSON.stringify(item)) : Object.assign({ id: uid('i'), panelId: selected, type, qty: 1, length: 20 }, defaultsFor(type));
    drawerState = { it, isNew };
    const dr = $('#drawer');
    dr.innerHTML = `<div class="drawer-h">${I[type]}<h3>${isNew ? 'เพิ่ม' : 'แก้ไข'}${TYPE_NAME[type]}</h3><button class="btn ghost sm" data-action="close-drawer">${I.close}</button></div>
      <div class="drawer-b" id="drawerBody">${formFor(it, m)}</div>
      <div class="drawer-f"><button class="btn dark" data-action="save-item">${isNew ? 'เพิ่มลงแผง' : 'บันทึก'}</button>${isNew ? '<button class="btn" data-action="save-item-more">เพิ่มแล้วเพิ่มต่อ</button>' : ''}<span style="flex:1"></span><button class="btn ghost" data-action="close-drawer">ยกเลิก</button></div>`;
    dr.classList.add('on'); $('#scrim').classList.add('on'); dr.setAttribute('aria-hidden', 'false');
    updatePreview();
    setTimeout(() => { const f = $('#drawerBody input, #drawerBody select'); if (f) f.focus(); }, 380);
  }
  function closeDrawer() {
    $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true');
    drawerState = null;
  }
  function defaultsFor(t) {
    return {
      light: { name: '', lamp: 'led-t8-18', perFixture: 2, fixtures: 10, circuits: 0 },
      rec: { name: '', duty: 'general', points: 8, vaPerPoint: '', perCircuit: '', wet: false },
      ac: { name: '', btu: 18000, phases: '' },
      heater: { name: '', watt: 3500 },
      cook: { name: '', watt: 2000, phases: 1 },
      motor: { name: '', kw: 2.2, phases: 3, start: 'DOL' },
      fire_pump: { name: 'ปั๊มดับเพลิง', kw: 15, phases: 3 },
      lift: { name: '', preset: 20, kva: '' },
      esc: { name: '', preset: 0, kva: '' },
      chiller: { name: '', cooling: 'water', preset: 0, kva: '' },
      ev: { name: '', preset: 0, kw: '', phases: '' },
      custom: { name: '', watt: 1000, pf: 1, va: '', phases: 1, continuous: true, rcd: false },
      spare: { cb: 16, va: '', phases: 1 }
    }[t] || {};
  }

  const fld = (label, inner, hint) => `<label class="field"><span>${label}</span>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const inp = (k, v, attrs = '') => `<input ${attrs.includes('type=') ? '' : 'type="number"'} data-f="${k}" value="${esc(v)}" ${attrs}>`;
  const sel = (k, opts, v) => `<select data-f="${k}">${opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const chk = (k, v, t) => `<label class="check"><input type="checkbox" data-f="${k}" ${v ? 'checked' : ''}>${t}</label>`;
  const nameF = (it, ph) => fld('ชื่อ / พื้นที่', inp('name', it.name || '', `type="text" placeholder="${ph}"`));
  const lenF = (it) => fld('ความยาวสายจากแผงถึงจุดไกลสุด (m)', inp('length', it.length, 'min="1" step="1"'), 'ใช้คำนวณแรงดันตกและปริมาณสาย');
  const qtyF = (it, t = 'จำนวน') => fld(t, inp('qty', it.qty || 1, 'min="1" step="1"'));

  function formFor(it, m) {
    // โหลดต่อตรงที่ MDB/SDB: เลือกชนิด CB ได้ (อัตโนมัติ = มอเตอร์/ลิฟต์/3 เฟส/> 63 A ใช้ MCCB) — ตาราง Feeder, SLD, BOM ใช้ค่าเดียวกัน
    const bd = boardOf(it.panelId);
    const cbT = bd && bd.kind !== 'LP' && it.type !== 'spare' && it.type !== 'fire_pump'
      ? fld('ชนิด CB (โหลดต่อตรงที่แผงสวิตช์)', sel('cbType', [['', 'อัตโนมัติ'], ['MCB', 'MCB'], ['MCCB', 'MCCB']], it.cbType || ''), 'MCB ใช้ได้ถึง 100 A') : '';
    const pv = cbT + '<div class="preview" id="preview"></div>';
    switch (it.type) {
      case 'light': {
        const groups = [...new Set(D.LAMPS.map((l) => l.group))];
        const lampSel = `<select data-f="lamp">${groups.map((g) => `<optgroup label="${g}">${D.LAMPS.filter((l) => l.group === g).map((l) => `<option value="${l.id}" ${l.id === it.lamp ? 'selected' : ''}>${l.label} — ${l.va} VA</option>`).join('')}</optgroup>`).join('')}</select>`;
        return `${nameF(it, 'เช่น สำนักงาน ชั้น 1')}
          ${fld('ชนิดหลอด (ค่า VA ตามตาราง 6.1–6.3)', lampSel)}
          <div class="row2">${fld('หลอดต่อโคม', inp('perFixture', it.perFixture, 'min="1" step="1"'))}${fld('จำนวนโคม', inp('fixtures', it.fixtures, 'min="1" step="1"'))}</div>
          <details class="helper"><summary>ไม่รู้จำนวนโคม? ประมาณจากพื้นที่</summary>
            <div class="row2">${fld('พื้นที่ (ตร.ม.)', `<input type="number" id="hArea" value="60" min="1">`)}${fld('W/ตร.ม.', `<select id="hWpm"><option value="7">7 — ห้องทั่วไป/พื้นที่กว้าง</option><option value="4">4 — ทางเดิน/ห้องเล็ก</option><option value="3.5">3.5 — ห้องน้ำ</option></select>`)}</div>
            <button class="btn sm" data-action="estimate-light" type="button">คำนวณจำนวนโคม</button></details>
          ${fld('จำนวนวงจร', inp('circuits', it.circuits || 0, 'min="0" step="1"'), `0 = แบ่งอัตโนมัติ (ไม่เกิน ${Math.round(m.lightMaxLoading * 100)}% ของ CB ${m.cbLight} A ≈ ${fmt(m.cbLight * 230 * m.lightMaxLoading, 0)} VA/วงจร)`)}
          ${lenF(it)}${pv}`;
      }
      case 'rec':
        return `${nameF(it, 'เช่น เต้ารับสำนักงาน')}
          <div class="row2">${fld('จำนวนจุด', inp('points', it.points, 'min="1" step="1"'))}${fld('VA ต่อจุด', sel('vaPerPoint', [['', `ค่าโครงการ (${m.recVA})`], [180, '180 — เดี่ยว/คู่/สาม'], [200, '200 — ตามข้อกำหนด'], [360, '360 — ตั้งแต่ 4 เต้าขึ้นไป']], it.vaPerPoint))}</div>
          ${fld('ประเภทเต้ารับ', sel('duty', [['general', 'ทั่วไป — 16 A · 2.5 mm²'], ['heavy', 'ใช้งานหนัก — 20 A · ≥ 4 mm² · RCBO 30 mA']], it.duty === 'heavy' ? 'heavy' : 'general'), 'เต้ารับ มอก. 166-2549 รับได้ 16 A — ห้ามใช้ CB 32 A กับเต้ารับบ้าน (เกิน 20 A ต้องใช้ปลั๊กอุตสาหกรรม IEC 60309)')}
          ${fld('จุดต่อวงจรสูงสุด', inp('perCircuit', it.perCircuit || '', `min="1" step="1" placeholder="ค่าโครงการ ${m.recPerCircuit}${it.duty === 'heavy' ? ' · ใช้งานหนัก ' + D.REC_DUTY.heavy.perCircuit : ''}"`))}
          ${chk('wet', it.wet, 'พื้นที่เปียก — ห้องน้ำ ครัว ภายนอกอาคาร ชั้นใต้ดิน (ใส่ RCBO 30 mA)')}
          ${lenF(it)}${pv}`;
      case 'ac': {
        const ph = Number(it.phases) || (it.btu >= 36000 ? 3 : 1);
        const tbl = ph === 3 ? D.AC_3P : D.AC_1P;
        return `${nameF(it, 'เช่น แอร์ห้องประชุม')}
          ${fld('ระบบไฟ', sel('phases', [['', 'อัตโนมัติ (≥ 36,000 BTU = 3 เฟส)'], [1, '1 เฟส'], [3, '3 เฟส']], it.phases))}
          ${fld('ขนาด (BTU/h)', sel('btu', tbl.map(([b, k]) => [b, `${fmt(b, 0)} BTU — ${k} kVA`]), it.btu), ph === 3 ? 'ตาราง 6.5' : 'ตาราง 6.4')}
          <details class="helper"><summary>ประมาณ BTU จากพื้นที่ห้อง</summary>
            <div class="row2">${fld('พื้นที่ห้อง (ตร.ม.)', `<input type="number" id="hAcArea" value="30" min="1">`)}${fld('BTU/ตร.ม.', `<select id="hAcK"><option value="800">800 — ห้องทั่วไป</option><option value="900">900</option><option value="1000">1,000 — โดนแดด/คนเยอะ</option></select>`)}</div>
            <button class="btn sm" data-action="estimate-ac" type="button">เลือกขนาดให้</button></details>
          <div class="row2">${qtyF(it, 'จำนวนเครื่อง')}${lenF(it)}</div>${pv}`;
      }
      case 'heater':
        return `${nameF(it, 'เช่น เครื่องทำน้ำอุ่นห้องน้ำ')}
          <div class="row2">${fld('กำลังไฟ (W)', inp('watt', it.watt, 'min="100" step="100"'))}${qtyF(it)}</div>${lenF(it)}${pv}`;
      case 'cook':
        return `${nameF(it, 'เช่น เตาไฟฟ้าห้องครัว')}
          <div class="row3">${fld('กำลังไฟ (W)', inp('watt', it.watt, 'min="100" step="100"'))}${fld('ระบบ', sel('phases', [[1, '1 เฟส'], [3, '3 เฟส']], it.phases))}${qtyF(it)}</div>${lenF(it)}${pv}`;
      case 'motor': {
        const ph = Number(it.phases) || 3;
        const tbl = ph === 3 ? D.MOTOR_3P : D.MOTOR_1P;
        return `${nameF(it, 'เช่น ปั๊มน้ำดี')}
          <div class="row2">${fld('ระบบ', sel('phases', [[3, '3 เฟส 400 V'], [1, '1 เฟส 230 V']], ph))}${fld('การสตาร์ท', sel('start', [['DOL', 'DOL'], ['YD', 'Star-Delta']], it.start))}</div>
          ${fld('ขนาดมอเตอร์', sel('kw', tbl.map(([k, a]) => [k, `${k} kW — ${a} A`]), it.kw), 'กระแสพิกัดจากตาราง 8.2')}
          <div class="row2">${qtyF(it, 'จำนวนตัว')}${lenF(it)}</div>${pv}`;
      }
      case 'fire_pump': {
        const ph = Number(it.phases) || 3;
        const tbl = ph === 3 ? D.MOTOR_3P : D.MOTOR_1P;
        return `${nameF(it, 'เช่น ปั๊มดับเพลิงหลัก (Electric Fire Pump)')}
          ${fld('ระบบ', sel('phases', [[3, '3 เฟส 400 V'], [1, '1 เฟส 230 V']], ph))}
          ${fld('ขนาดมอเตอร์', sel('kw', tbl.map(([k, a]) => [k, `${k} kW — ${a} A`]), it.kw), `FLA จากตาราง 8.2 · LRC ≈ ${D.FIRE_PUMP.lrcMult} × FLA`)}
          <div class="row2">${qtyF(it, 'จำนวนตัว')}${lenF(it)}</div>
          <p class="hint">NFPA 20 / วสท. บทที่ 10: CB แบบ Magnetic-only (ไม่ตัดจาก overload) ขนาด ≈ ${D.FIRE_PUMP.cbMin}–${D.FIRE_PUMP.cbMax} × FLA · สาย FRC (BS 6387 CWZ) · ห้ามมี RCD · ต้องต่อเข้าแผงฉุกเฉิน (ATS + เครื่องกำเนิดไฟฟ้า)</p>${pv}`;
      }
      case 'lift':
        return `${nameF(it, 'เช่น ลิฟต์โดยสาร')}
          ${fld('รุ่น (ตาราง 6.8)', sel('preset', D.LIFTS.map((l, i) => [i, `${l[0]} kg · ${l[1]} คน · ${l[2]} m/min — ${l[3]} kVA`]), it.preset))}
          ${fld('หรือระบุ kVA เอง', inp('kva', it.kva || '', 'min="0" step="0.5" placeholder="ว่าง = ใช้ค่าจากตาราง"'))}
          <div class="row2">${qtyF(it, 'จำนวนตัว')}${lenF(it)}</div>${pv}`;
      case 'esc':
        return `${nameF(it, 'เช่น บันไดเลื่อน')}
          ${fld('ขนาด (ตาราง 6.9)', sel('preset', D.ESCALATORS.map((e, i) => [i, `กว้าง ${e[0]} mm ระยะขึ้นถึง ${e[1]} mm — ${e[2]} kVA`]), it.preset))}
          ${fld('หรือระบุ kVA เอง', inp('kva', it.kva || '', 'min="0" step="0.5"'))}
          <div class="row2">${qtyF(it)}${lenF(it)}</div>${pv}`;
      case 'chiller': {
        const t = it.cooling === 'air' ? D.CHILLER_AIR : D.CHILLER_WATER;
        return `${nameF(it, 'เช่น Chiller CH-1')}
          ${fld('ชนิด', sel('cooling', [['water', 'Water-cooled (ตาราง 6.6)'], ['air', 'Air-cooled (ตาราง 6.7)']], it.cooling))}
          ${fld('ขนาด', sel('preset', t.map((c, i) => [i, `${c[0]} TR — ${c[1]} kVA`]), it.preset))}
          ${fld('หรือระบุ kVA เอง', inp('kva', it.kva || '', 'min="0" step="1"'))}
          <div class="row2">${qtyF(it)}${lenF(it)}</div>${pv}`;
      }
      case 'ev':
        return `${nameF(it, 'เช่น ที่ชาร์จรถไฟฟ้า ลานจอดรถ')}
          ${fld('รุ่น (AC Mode 3)', sel('preset', D.EV_CHARGERS.map((e, i) => [i, `${e[0]} kW · ${e[1]} เฟส · ${e[2]} A`]), it.preset))}
          <div class="row2">${fld('หรือระบุ kW เอง', inp('kw', it.kw || '', 'min="0" step="0.1" placeholder="ว่าง = ใช้รุ่นที่เลือก"'))}${fld('ระบบ (เมื่อระบุ kW เอง)', sel('phases', [['', 'อัตโนมัติ (> 7.4 kW = 3 เฟส)'], [1, '1 เฟส'], [3, '3 เฟส']], it.phases))}</div>
          <div class="row2">${qtyF(it, 'จำนวนเครื่อง (1 เครื่อง/วงจร)')}${lenF(it)}</div>
          <p class="hint">โหลดต่อเนื่อง (CB ≥ 1.25 × I) · ดีมานด์ 100% · RCD 30 mA ทุกวงจร: RCD Type A + 6 mA DC detection or Type B</p>${pv}`;
      case 'custom':
        return `${nameF(it, 'เช่น ตู้แช่ / UPS / เครื่องถ่ายเอกสาร')}
          <div class="row3">${fld('กำลังไฟ (W)', inp('watt', it.watt || '', 'min="0" step="10"'))}${fld('PF', inp('pf', it.pf || 1, 'min="0.3" max="1" step="0.01"'))}${fld('หรือ VA', inp('va', it.va || '', 'min="0" step="10"'))}</div>
          <div class="row2">${fld('ระบบ', sel('phases', [[1, '1 เฟส'], [3, '3 เฟส']], it.phases))}${qtyF(it)}</div>
          ${chk('continuous', it.continuous !== false, 'โหลดต่อเนื่อง (ใช้งาน ≥ 3 ชม.) — คูณ 1.25 ตอนเลือก CB')}
          ${chk('rcd', it.rcd, 'ต้องมีเครื่องตัดไฟรั่ว (RCBO 30 mA)')}
          ${lenF(it)}${pv}`;
      case 'spare':
        return `<div class="row3">${fld('ขนาด CB (A)', sel('cb', D.MCB_AT.map((a) => [a, a + ' A']), it.cb))}${fld('ระบบ', sel('phases', [[1, '1 เฟส'], [3, '3 เฟส']], it.phases))}${qtyF(it)}</div>
          ${fld('จองโหลดไว้ (VA)', inp('va', it.va || '', 'min="0" step="100" placeholder="ว่าง = ไม่คิดโหลด"'), 'ถ้าใส่ VA จะถูกรวมในโหลดของแผงด้วย')}${pv}`;
    }
    return pv;
  }

  function readForm() {
    const it = drawerState.it;
    $$('#drawerBody [data-f]').forEach((el) => {
      const k = el.dataset.f;
      if (el.type === 'checkbox') it[k] = el.checked;
      else if (el.type === 'number') it[k] = el.value === '' ? '' : Number(el.value);
      else if (el.tagName === 'SELECT') it[k] = el.value === '' ? '' : (isNaN(Number(el.value)) ? el.value : Number(el.value));
      else it[k] = el.value;
    });
    return it;
  }
  function updatePreview() {
    if (!drawerState) return;
    const it = readForm();
    const pv = $('#preview');
    if (!pv) return;
    try {
      const meta = Object.assign(E.defaultMeta(), project.meta);
      const cs = E.expandItem(it, meta);
      cs.forEach((c) => E.designBranch(c, meta, 0));
      const va = cs.reduce((s, c) => s + c.va, 0);
      const first = cs[0];
      pv.innerHTML = `รวม <span class="num">${fmt(Math.round(va), 0)}</span> VA → <span class="num">${cs.length}</span> วงจร` +
        (first && first.cb ? `<br>วงจรแรก: I = <span class="num">${fmt(first.I)}</span> A · CB <span class="num">${first.cb.at}A ${first.cb.poles}P</span>${first.cond ? ` · สาย <span class="num">${first.cond.text}</span> · VD <span class="num">${fmt(first.vd.pct)}%</span>` : ''}${first.cb.rcd ? ' · RCBO' : ''}` : '') +
        (first && first.motor && first.motor.ol ? `<br>OL ${first.motor.ol} A · DM ${first.motor.dm} A` : '');
    } catch (e) { pv.textContent = '—'; }
  }
  function saveItem(more) {
    const it = readForm();
    pruneCbOv(it);
    const idx = project.items.findIndex((x) => x.id === it.id);
    if (idx >= 0) project.items[idx] = it; else project.items.push(it);
    const type = it.type;
    toast(`${drawerState.isNew ? 'เพิ่ม' : 'บันทึก'} ${it.name || TYPE_NAME[type]} แล้ว`);
    logEvent('item', `${drawerState.isNew ? 'เพิ่ม' : 'แก้ไข'} ${it.name || TYPE_NAME[type]} (${itemSummary(it)}) ใน ${(boardOf(it.panelId) || {}).name || 'แผง'}`);
    closeDrawer();
    recalc(true);
    if (more) setTimeout(() => openDrawer(type), 420);
  }

  /* ================= views อื่น ๆ ================= */
  function viewSchedule() {
    const fnum = R.feederNumbers(result);
    const lps = result.panels.filter((p) => p.isLP);
    if (!lps.length) return `<div class="empty">ยังไม่มีแผงย่อย (LP)</div>`;
    const balanceable = lps.filter((p) => p.board.phases !== 1 && p.balance);
    const worst = balanceable.reduce((m, p) => Math.max(m, p.unbalance), 0);
    const top = balanceable.length ? `<div class="sched-top"><div><b>${lps.length} แผงย่อย</b><span class="muted tiny"> · ไม่สมดุลสูงสุด <span class="unb ${unbClass(worst)}">${fmt(worst, 1)}%</span> · เลขวงจรเรียงเฟส ${result.meta.phasePattern === 'pair' ? 'AA-BB-CC' : 'A-B-C ต่อเนื่อง'}</span></div>
      <button class="btn accent sm" data-balance-all="1">${I.balance}Balance Load ทุกแผง</button></div>` : '';
    const tray = `<div class="cb-tray"><span class="label">ถาดเบรกเกอร์</span><div class="chips">${D.MCB_AT.map((a) => `<span class="cb-chip" data-cb-chip="${a}" title="ลากไปวางที่แถววงจรเพื่อเปลี่ยนขนาด ${a} A">${a}<small>A</small></span>`).join('')}</div>
      <span class="tiny muted">ลากขนาดไปวางที่แถววงจร · หรือจับ <b>⋮⋮</b> ในช่อง AT ลากขึ้น/ลง (คีย์บอร์ด ↑ ↓) · ย้ายเฟส: ลากป้าย <b>A/B/C</b> หน้าเลขวงจรไปวางแถวเฟสอื่นหรือปุ่มเฟส (คีย์บอร์ด ← →) · • = ค่าที่ระบบเลือก · Esc ยกเลิกตอนลาก</span></div>`;
    return `${top}${tray}<div class="sched-wrap">${lps.map((p) => {
      const three = p.board.phases !== 1;
      const nAuto = p.layout ? p.layout.slots.filter((s) => s && s.auto).length : 0;
      const bal = three && p.balance
        ? `<button class="btn sm ${p.balance.mode === 'deep' ? 'on' : ''}" data-balance="${p.id}" title="จัดเฟส A/B/C ให้ต่างกันน้อยที่สุด">${I.balance}Balance Load${p.balance.mode === 'deep' ? ' ✓' : ''}</button>` : '';
      return `<div class="sheet" data-sid="${esc(p.id)}">
      <div class="sheet-tools"><h3>${esc(p.board.name)} <span class="muted tiny">${esc(p.board.location || '')}</span></h3>
        ${three ? `<span class="unb ${unbClass(p.unbalance)}" title="ส่วนเบี่ยงเบนสูงสุดของเฟสจากค่าเฉลี่ย (ควรไม่เกิน 20%)">ไม่สมดุล ${fmt(p.unbalance, 1)}%</span>${phBucketsHTML(p)}` : ''}
        <span class="muted tiny">Connected ${fmt(p.connected / 1000, 2)} kVA · Demand ${fmt(p.demand / 1000, 2)} kVA</span><span class="spacer"></span>
        <span class="spare-ctl" title="SPARE ที่ระบบเติมให้ท้ายตาราง"><button class="btn ghost sm" type="button" data-spare="${p.id}|-1" aria-label="ลด SPARE">${I.minus}</button><b class="num">${nAuto}</b><span class="tiny muted">SPARE</span><button class="btn ghost sm" type="button" data-spare="${p.id}|1" aria-label="เพิ่ม SPARE">${I.plus}</button></span>
        ${bal}<button class="btn sm" data-panel-csv="${p.id}">${I.file}CSV แผงนี้</button><button class="btn sm" data-select-go="${p.id}">แก้ไข</button></div>
      <div style="overflow:auto">${R.panelScheduleHTML(p, result, fnum, { edit: true })}</div></div>`;
    }).join('')}</div>`;
  }
  const unbClass = (v) => (v >= 20 ? 'bad' : v >= 10 ? 'warn' : 'ok');
  // ปุ่มเฟส A/B/C ของแผง (เป้าหมายตอนลากย้ายเฟส) แสดงโหลดแต่ละเฟสเป็นแถบ
  function phBucketsHTML(p) {
    const pv = p.phaseVA, mx = Math.max(1, ...pv);
    return `<span class="ph-buckets" role="group" aria-label="โหลดแต่ละเฟสของ ${esc(p.board.name)}">${[0, 1, 2].map((k) => `<span class="ph-b ph${'ABC'[k]}" data-ph-drop="${esc(p.id)}|${k}" title="เฟส ${'ABC'[k]} ${fmt(Math.round(pv[k]), 0)} VA — วางวงจรที่นี่เพื่อย้ายมาเฟสนี้"><b>${'ABC'[k]}</b><i style="width:${(pv[k] / mx * 100).toFixed(0)}%"></i><small class="num">${fmt(pv[k] / 1000, 1)}k</small></span>`).join('')}</span>`;
  }

  function viewFeeder() {
    const fnum = R.feederNumbers(result);
    const s = result.service, m = result.meta;
    const boards = result.panels.filter((p) => !p.isLP);
    const sc = result.panels.map((p) => `<tr><td>${esc(p.board.name)}</td><td class="r num">${p.sc ? fmt(p.sc.Ik, 2) : '-'}</td><td class="r num">${p.sc ? fmt(p.sc.ip, 2) : '-'}</td><td class="r num">${p.main.ic || '-'}</td><td class="r num">${fmt(p.vdUp)}</td></tr>`).join('');
    return `
      <div class="bigstats">
        <div class="bigstat"><div class="label">Connected load</div><div class="v"><span data-count="${(result.totals.connected / 1000).toFixed(2)}" data-dec="2" data-key="tc">0</span><small>kVA</small></div><div class="s">รวมทุกแผง</div></div>
        <div class="bigstat"><div class="label">Maximum demand</div><div class="v"><span data-count="${(result.totals.demand / 1000).toFixed(2)}" data-dec="2" data-key="td">0</span><small>kVA</small></div><div class="s">${fmt(s.demandI)} A ที่ 400 V</div></div>
        <div class="bigstat"><div class="label">${s.trafo ? 'หม้อแปลง' : 'เครื่องวัดฯ'}</div><div class="v">${s.trafo ? `${s.trafo.kva}<small>kVA</small>` : esc(s.meter.size)}</div><div class="s">${s.trafo ? `ใช้งาน ${fmt(result.totals.demand / 10 / s.trafo.kva, 0)}% ของพิกัด` : (m.utility === 'MEA' ? 'การไฟฟ้านครหลวง' : 'การไฟฟ้าส่วนภูมิภาค')}</div></div>
        <div class="bigstat"><div class="label">Main CB</div><div class="v" style="font-size:20px">${esc(cbShow(s.mainCB))}</div><div class="s">IC ${s.mainCB.ic} kA · Busbar ${s.busbar} A</div></div>
      </div>
      <div class="grid2" style="margin-bottom:16px">
        <div class="card"><div class="card-h"><h3>ระบบประธาน</h3></div><div class="card-b">${R.serviceHTML(result)}</div></div>
        <div class="card"><div class="card-h"><h3>วิธีคำนวณระบบประธาน</h3></div><div class="card-b">${R.stepsHTML(s.steps.concat(s.mainFeeder.steps))}</div></div>
        ${s.generator ? `<div class="card"><div class="card-h"><h3>วิธีคำนวณเครื่องกำเนิดไฟฟ้า + ATS</h3><span class="muted tiny">ค่าคงที่เป็นสมมติฐาน (ไม่มีในเอกสาร วสท.)</span></div><div class="card-b">${R.stepsHTML(s.generator.steps)}</div></div>` : ''}
      </div>
      ${boards.map((p) => `<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>ตาราง Feeder — ${esc(p.board.name)}</h3><span class="tag ${p.board.kind.toLowerCase()}">${p.board.kind}</span></div>
        <div class="card-b" style="overflow:auto">${R.feederScheduleHTML(p, result, fnum)}</div></div>`).join('')}
      <div class="card"><div class="card-h"><h3>กระแสลัดวงจรและแรงดันตกสะสม</h3><span class="muted tiny">IEC 60909 แบบย่อ · c = 1.05 · อิมพีแดนซ์สายจากตาราง 10.2</span></div>
        <div class="card-b"><table class="dt"><thead><tr><th>แผง</th><th class="r">Ik" (kA)</th><th class="r">ip (kA)</th><th class="r">IC ขั้นต่ำ (kA)</th><th class="r">VD สะสมถึงแผง (%)</th></tr></thead><tbody>${sc}</tbody></table></div></div>
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Selectivity — การเลือกตัดของเบรกเกอร์</h3><span class="muted tiny">ประเมินเบื้องต้น — ยืนยันด้วยตาราง selectivity ของผู้ผลิต</span></div>
        <div class="card-b" style="overflow:auto">${R.selectivityHTML(result)}</div></div>`;
  }

  function viewSLD() {
    return `<div class="card"><div class="card-h"><h3>ผังเส้นเดียว (Single line diagram)</h3><span class="muted tiny">สร้างจากผลคำนวณอัตโนมัติ — ใช้เป็นแนวทางเขียนแบบจริง</span><button class="btn sm" data-action="export-dxf" title="ส่งออกผังเส้นเดียวเป็น DXF">DXF</button></div>
      <div class="card-b"><div class="sld-wrap">${R.sldSVG(result, R.feederNumbers(result))}</div></div></div>`;
  }

  function viewMethod() {
    const m = result.meta;
    const rules = `<ul class="rules">
      <li><b>โหลดแสงสว่าง</b> ใช้ VA ของหลอดจากตาราง 6.1–6.3 (รวมบัลลาสต์/ไดรเวอร์แล้ว) คูณจำนวนหลอด แบ่งวงจรให้ไม่เกิน ${Math.round(m.lightMaxLoading * 100)}% ของ CB ${m.cbLight} A</li>
      <li><b>เต้ารับ</b> คิด ${m.recVA} VA/จุด (หัวข้อ 6.2.2 / ข้อกำหนดโครงการ) ไม่เกิน ${m.recPerCircuit} จุดต่อวงจร ใช้ CB ${m.cbRec} A; พื้นที่เปียกใส่ RCBO 30 mA (หัวข้อ 6.3.3)</li>
      <li><b>แอร์</b> ใช้ kVA ตามตาราง 6.4/6.5; ≥ 36,000 BTU ใช้ 3 เฟสตามข้อกำหนด; 1 เครื่อง 1 วงจร</li>
      <li><b>มอเตอร์</b> FLC จากตาราง 8.2; OL ≤ Im (ตาราง 8.3); DM ≥ 1.15Im; CB ≤ 2.5Im (ตาราง 8.5); สาย ≥ 1.25Im; Y-Δ หลัง controller ≥ 0.906Im</li>
      <li><b>CB วงจรย่อย</b> I<sub>CB</sub> ≥ I<sub>load</sub> (สมการ 6-1) โหลดต่อเนื่องคูณ ${m.branchFactor} ตามข้อแนะนำ บทที่ 6</li>
      <li><b>ขนาดสาย</b> I<sub>cable</sub> × Ft × Fg ≥ I<sub>CB</sub> (สมการ 6-2) จากตาราง 5-20/5-27 ตามวิธีเดินสาย (ตาราง 5-47) ไม่เล็กกว่า 2.5 mm² (วงจรย่อย) และ 4 mm² (สายป้อน)</li>
      <li><b>อุณหภูมิ</b> ตัวคูณ Ft จากตาราง 5-43 (อากาศ ฐาน 40°C) และ 5-44 (ใต้ดิน ฐาน 30°C)</li>
      <li><b>แรงดันตก</b> VD = mV/A/m × I × L / 1000 จากตาราง ฐ.1–ฐ.4; วงจรย่อย ≤ ${m.vdBranch}%, สายป้อน ≤ ${m.vdFeeder}%, รวม ≤ ${m.vdTotal}% — ถ้าเกินจะเพิ่มขนาดสายอัตโนมัติ</li>
      <li><b>สายดิน</b> ตามพิกัด CB ตาราง 4.2 (มอเตอร์ใช้ค่า OL) ไม่ใหญ่กว่าสายเฟส; สายต่อหลักดินตาราง 4.1</li>
      <li><b>ท่อ</b> พื้นที่สายรวม (ตาราง 5.3) ≤ 53/31/40% ของพื้นที่ท่อ (ตาราง 5.1, 5.2)</li>
      <li><b>จัดเฟส</b> ${m.phasePattern === 'pair' ? 'เลขวงจรทีละแถว (1-2 = A, 3-4 = B, 5-6 = C …)' : 'เลขวงจรไล่เฟส A-B-C-A-B-C ต่อเนื่อง (1 = A, 2 = B, 3 = C, 4 = A …) แต่ละเฟสมีจำนวนวงจรต่างกันไม่เกิน 1'} เบรกเกอร์ 3 ขั้วใช้ ${m.phasePattern !== 'pair' && m.threePole !== 'column' ? '3 เลขติดกัน (1-2-3 / 4-5-6)' : '3 ช่องฝั่งเดียวกัน (1-3-5 / 7-9-11)'} · วงจร 1 เฟสสลับให้ VA ของเฟสต่างกันน้อยสุด (ปุ่ม Balance Load ใช้ตัวค้นหาที่ละเอียดกว่า) · Spare ~${Math.round(m.spareRatio * 100)}% อยู่ต่อท้ายวงจรใช้งานทั้งหมด ที่เหลือเป็น Space</li>
      <li><b>ดีมานด์</b> แสงสว่าง ${m.lightingDF ? 'ตามตาราง 6.10' : '100% (ตาราง 6.10 ถูกยกเลิก)'}; เต้ารับ 10 kVA แรก 100% ส่วนเกิน 50% (ตาราง 6.11); น้ำร้อน/หุงต้ม/แอร์ตามตาราง 6.12; มอเตอร์ +25% ตัวใหญ่สุด</li>
      <li><b>สายป้อน</b> I<sub>F</sub> = Demand/(√3×400); CB ≥ I<sub>F</sub>×${m.feederFactor}; มีมอเตอร์: CB ≤ CB<sub>1</sub> + ΣIm + I<sub>L</sub> และสาย ≥ 1.25Im<sub>1</sub> + ΣIm + I<sub>L</sub> (สมการ 8-5, 8-7); นิวทรัล > 200 A ลดได้ตามสมการ 6-5</li>
      <li><b>หม้อแปลง</b> ขนาดมาตรฐานถัดไปที่ ≥ ดีมานด์ (ตาราง 7.1); ฟิวส์ HV ≤ 300% (ตาราง 7.2); CB แรงต่ำ ≤ 100% ของกระแสพิกัด; สายประธานแบ่งชุดขนานพร้อม Fg (ตาราง 5-8)</li>
      <li><b>ลัดวงจร</b> Ik" = c·Un/(√3·|Z|) รวม Z หม้อแปลง (K<sub>T</sub>) + สาย (ตาราง 10.2); ใช้เลือก IC ของ CB แต่ละแผง</li>
      <li><b>ตัวเก็บประจุ</b> Qc = P × (tanφ1 − tanφ2) ตรงกับค่า Kc ตาราง 12.2</li></ul>`;
    const panels = result.panels.map((p) => `<details class="acc"><summary><b>${esc(p.board.name)}</b><span class="tag ${p.board.kind.toLowerCase()}">${p.board.kind}</span><span class="muted tiny">${p.circuits.length} วงจร · Demand ${fmt(p.demand / 1000, 2)} kVA</span></summary><div>
      <h4>ดีมานด์ของแผง</h4>${R.demandStepsHTML(p)}
      ${p.feeder ? `<h4>สายป้อนเข้าแผง</h4>${R.stepsHTML(p.feeder.steps)}` : ''}
      ${p.circuits.filter((c) => c.cat !== 'spare').map((c) => `<details class="acc" style="margin-top:8px"><summary>CCT ${(c.slotNos || []).join(',') || '-'} · ${esc(c.desc)} <span class="muted tiny">${c.cb ? c.cb.at + 'A' : ''} ${c.cond ? c.cond.text : ''}</span></summary><div>${R.stepsHTML(c.steps)}</div></details>`).join('')}
    </div></details>`).join('');
    return `<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>หลักการที่ใช้เลือก (ตามมาตรฐานการติดตั้งทางไฟฟ้าสำหรับประเทศไทย วสท. บทที่ 6–10)</h3></div><div class="card-b">${rules}</div></div>${panels}`;
  }

  function viewBOM() {
    return `<div class="card"><div class="card-h"><h3>รายการวัสดุโดยประมาณ</h3><span class="muted tiny">ความยาว = ระยะที่กรอก × จำนวนเส้น + เผื่อ 10% (รวมสายแนวดิ่งเมื่อระบุ "ชั้นที่ติดตั้ง" ของแผงและแผงแม่)</span></div>
      <div class="card-b">${R.bomHTML(result)}</div></div>`;
  }

  function viewSettings() {
    const m = project.meta;
    const opt = (o, v) => Object.entries(o).map(([k, t]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${t}</option>`).join('');
    const cables = Object.fromEntries(Object.entries(D.CABLES).filter(([, c]) => !c.fire).map(([k, c]) => [k, c.label]));   // FRC ใช้เฉพาะวงจรปั๊มดับเพลิง
    const methods = Object.fromEntries(Object.entries(D.METHODS).map(([k, c]) => [k, c.label]));
    const conduits = Object.fromEntries(D.CONDUIT_TYPES.map((c) => [c, c]));
    const s = (path, label, inner, hint) => `<label class="field"><span>${label}</span>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const n = (path, v, a = '') => `<input type="number" data-m="${path}" value="${v}" ${a}>`;
    const t = (path, v) => `<input type="text" data-m="${path}" value="${esc(v || '')}">`;
    const se = (path, o, v) => `<select data-m="${path}">${opt(o, v)}</select>`;
    const ck = (path, v, label, off) => `<label class="check${off ? ' dim' : ''}"><input type="checkbox" data-m="${path}" ${v ? 'checked' : ''} ${off ? 'disabled' : ''}>${label}</label>`;
    const wiring = (k, title) => `<h4>${title}</h4><div class="row2">${s('', 'ชนิดสาย', se(`${k}.cable`, cables, m[k].cable))}${s('', 'ท่อ', se(`${k}.conduit`, conduits, m[k].conduit))}</div>${s('', 'วิธีเดินสาย (ตาราง 5-47)', se(`${k}.method`, methods, m[k].method))}`;
    return `<div class="settings">
      ${window.BrandUI ? BrandUI.settingsHTML(m) : ''}
      <div class="card"><div class="card-h"><h3>ข้อมูลโครงการ</h3></div><div class="card-b">
        ${s('', 'ชื่อโครงการ', t('name', m.name))}${s('', 'เจ้าของ', t('owner', m.owner))}${s('', 'สถานที่', t('location', m.location))}
        <div class="row2">${s('', 'ผู้ออกแบบ', t('designer', m.designer))}${s('', 'วันที่', `<input type="date" data-m="date" value="${m.date}">`)}</div>
        <div class="row2">${s('', 'ระดับใบอนุญาต กว.', se('licenseTier', { '': '— ไม่ระบุ —', 'ภฟก.': 'ภฟก. (ภาคีวิศวกร)', 'สฟก.': 'สฟก. (สามัญวิศวกร)', 'วฟก.': 'วฟก. (วุฒิวิศวกร)' }, m.licenseTier || ''))}${s('', 'เลขที่ใบอนุญาต กว. ผู้ออกแบบ', t('designerLicense', m.designerLicense))}</div>
        <div class="row2">${s('', 'ผู้ตรวจ', t('checker', m.checker))}${s('', 'เลขที่ใบอนุญาต กว. ผู้ตรวจ', t('checkerLicense', m.checkerLicense))}</div>
        ${s('', 'โลโก้บริษัท (Title Block)', `<div class="logo-box"><div class="logo-prev">${m.logo ? `<img src="${esc(m.logo)}" alt="โลโก้บริษัท">` : '<span class="muted tiny">LOGO</span>'}</div><input type="file" accept="image/png,image/jpeg,image/webp" data-logo-file aria-label="เลือกไฟล์โลโก้">${m.logo ? '<button class="btn sm" type="button" data-action="logo-clear">ลบโลโก้</button>' : ''}</div>`, 'ย่อให้อัตโนมัติ ≤ 150 KB · ไม่นับในประวัติ Undo')}
        ${s('', 'ประเภทอาคาร (ใช้เลือกดีมานด์แฟกเตอร์)', se('buildingType', R.BT_TH, m.buildingType))}
        <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm" data-action="load-sample">เพิ่มแปลนตัวอย่าง</button><button class="btn sm" data-action="new-project">สร้างแปลนใหม่</button></div>
      </div></div>

      <div class="card"><div class="card-h"><h3>แหล่งจ่ายไฟ</h3></div><div class="card-b">
        <div class="row2">${s('', 'การไฟฟ้า', se('utility', { PEA: 'กฟภ. (PEA)', MEA: 'กฟน. (MEA)' }, m.utility))}${s('', 'รูปแบบรับไฟ', se('supply', { transformer: 'มีหม้อแปลงของตัวเอง', lv: 'รับไฟแรงต่ำ (มิเตอร์)' }, m.supply))}</div>
        ${m.supply === 'transformer' ? `<div class="row2">${s('', 'แรงดันระบบแรงสูง (kV)', se('hvKV', { 22: '22 kV', 24: '24 kV', 33: '33 kV', 12: '12 kV' }, m.hvKV))}${s('', 'เผื่อขยายโหลด (%)', n('growth', m.growth, 'min="0" step="5"'))}</div>
          ${s('', 'กำลังลัดวงจรของระบบ (kA ด้าน HV)', n('sourceKA', m.sourceKA, 'min="0" step="1"'), '0 = infinite bus ตามข้อกำหนด (คิดเฉพาะหม้อแปลง)')}` :
          s('', 'กระแสลัดวงจรที่จุดต่อไฟ (kA)', n('serviceKA', m.serviceKA, 'min="1" step="1"'))}
        <h4>สายประธานแรงต่ำ (หม้อแปลง/มิเตอร์ → MDB)</h4>
        <div class="row2">${s('', 'ชนิดสาย', se('main.cable', cables, m.main.cable))}${s('', 'ท่อ', se('main.conduit', conduits, m.main.conduit))}</div>
        ${s('', 'วิธีเดินสาย', se('main.method', methods, m.main.method))}
        <div class="row2">${s('', 'ความยาว (m)', n('main.length', m.main.length, 'min="1"'))}${s('', 'ขนาดสายใหญ่สุดต่อชุด (mm²)', se('main.maxSize', { 185: '185', 240: '240', 300: '300', 400: '400' }, m.main.maxSize))}</div>
        <h4>ตัวประกอบกำลัง</h4><div class="row2">${s('', 'pf ปัจจุบัน', n('pfNow', m.pfNow, 'min="0.6" max="1" step="0.01"'))}${s('', 'pf เป้าหมาย', n('pfTarget', m.pfTarget, 'min="0.8" max="1" step="0.01"'))}</div>
      </div></div>

      <div class="card"><div class="card-h"><h3>วิธีเดินสาย</h3></div><div class="card-b">
        ${wiring('branch', 'วงจรย่อย')}${wiring('feeder', 'สายป้อน')}
        <div class="row2">${s('', 'อุณหภูมิอากาศ (°C)', n('ambientAir', m.ambientAir, 'min="10" max="60"'))}${s('', 'อุณหภูมิดิน (°C)', n('ambientGround', m.ambientGround, 'min="10" max="60"'))}</div>
      </div></div>

      <div class="card"><div class="card-h"><h3>เกณฑ์ออกแบบ</h3></div><div class="card-b">
        <div class="row3">${s('', 'VD วงจรย่อย %', n('vdBranch', m.vdBranch, 'min="0.5" step="0.5"'))}${s('', 'VD สายป้อน %', n('vdFeeder', m.vdFeeder, 'min="0.5" step="0.5"'))}${s('', 'VD รวม %', n('vdTotal', m.vdTotal, 'min="1" step="0.5"'))}</div>
        <div class="row3">${s('', 'เต้ารับ VA/จุด', n('recVA', m.recVA, 'step="10"'))}${s('', 'จุด/วงจร', n('recPerCircuit', m.recPerCircuit, 'min="1"'))}${s('', 'CB เต้ารับ', se('cbRec', { 16: '16 A', 20: '20 A' }, m.cbRec))}</div>
        <div class="row3">${s('', 'CB แสงสว่าง', se('cbLight', { 10: '10 A', 16: '16 A', 20: '20 A' }, m.cbLight))}${s('', 'โหลดสูงสุด/วงจรไฟ', se('lightMaxLoading', { 0.6: '60%', 0.7: '70%', 0.8: '80%', 1: '100%' }, m.lightMaxLoading))}${s('', 'IC ของ MCB (kA)', se('branchIC', { 6: '6', 10: '10' }, m.branchIC))}</div>
        <div class="row3">${s('', 'IC ขั้นต่ำ MCCB (kA)', se('mccbICMin', { 6: '6', 10: '10', 18: '18', 25: '25', 36: '36' }, m.mccbICMin))}${s('', 'ขนาดสายป้อนใหญ่สุด/ชุด (mm²)', se('maxParallelSize', { 185: '185', 240: '240', 300: '300' }, m.maxParallelSize))}</div>
        <div class="row3">${s('', 'สายขั้นต่ำ ไฟ', se('minLight', { 1.5: '1.5', 2.5: '2.5', 4: '4' }, m.minLight))}${s('', 'สายขั้นต่ำ เต้ารับ', se('minRec', { 2.5: '2.5', 4: '4' }, m.minRec))}${s('', 'สายป้อนขั้นต่ำ', se('minFeeder', { 4: '4', 6: '6', 10: '10' }, m.minFeeder))}</div>
        <div class="row2">${s('', 'ตัวคูณโหลดต่อเนื่อง วงจรย่อย', se('branchFactor', { 1: '1.00', 1.25: '1.25' }, m.branchFactor))}${s('', 'ตัวคูณ สายป้อน', se('feederFactor', { 1: '1.00', 1.25: '1.25' }, m.feederFactor))}</div>
        ${s('', 'การเรียงเฟสในตารางโหลด', se('phasePattern', { seq: 'A-B-C-A-B-C ต่อเนื่องตามเลขวงจร (ค่าเริ่มต้น)', pair: 'AA-BB-CC ทีละแถวซ้าย/ขวา (แบบ NEMA เดิม)' }, m.phasePattern), 'แบบ pair ใช้ 3 ช่องฝั่งเดียวกัน (เช่น 1-3-5) · SPARE อยู่ท้ายสุดเสมอ')}
        ${s('', 'การวางเบรกเกอร์ 3 ขั้ว (เมื่อเลือก A-B-C ต่อเนื่อง)', se('threePole', { consecutive: '3 เลขติดกัน 1-2-3, 4-5-6 (ค่าเริ่มต้น)', column: '3 ช่องคอลัมน์เดียวกัน 1-3-5, 2-4-6' }, m.threePole), 'แบบ 3 เลขติดกันอ่านง่ายและเฟสเป็น A-B-C ทุกวงจร ส่วนแบบคอลัมน์ตรงกับตำแหน่งบัสของแผง 2 คอลัมน์จริง')}
        <div class="row2">${s('', 'Spare ต่อแผง', se('spareRatio', { 0.1: '10%', 0.15: '15%', 0.2: '20%' }, m.spareRatio))}${s('', 'วงจรใช้งานสูงสุด', se('activeRatio', { 0.6: '60%', 0.7: '70%', 0.8: '80%' }, m.activeRatio))}</div>
        ${ck('lightingDF', m.lightingDF, 'ใช้ดีมานด์แฟกเตอร์แสงสว่าง ตาราง 6.10 (ในเอกสารถูกขีดยกเลิก)')}
        ${ck('lightingGround', m.lightingGround, 'เดินสายดินในวงจรแสงสว่างด้วย')}
        ${ck('useMaxPhase', m.useMaxPhase, 'ใช้กระแสเฟสสูงสุดแทนกระแสเฉลี่ยในการเลือกสายป้อน (ปลอดภัยกว่า)')}
        ${ck('egcProportional', m.egcProportional === true, 'สายดินบริภัณฑ์ขยายตามสัดส่วนสายเฟสที่ถูกขยายเพื่อลดแรงดันตก (ค่าเริ่มต้นปิด = สายดินตามตาราง 4.2 ตาม CB เหมือนตัวอย่างในตำรา)')}
        ${ck('adiabaticCheck', m.adiabaticCheck === true, 'ตรวจความร้อนลัดวงจรของสายป้อน (Adiabatic: S ≥ Ik" × √0.01 / k) แล้วเตือน — ค่าเริ่มต้นปิด (ไม่คิด I²t ผ่านตัวจริงของ CB จำกัดกระแส จึงอาจเตือนเกินจริง)')}
        ${ck('autoSelectivity', m.autoSelectivity !== false, 'Auto-Selectivity: ปรับ CB สายป้อนให้ ≥ 1.6 × CB วงจรย่อยใหญ่สุด (สายป้อนต้องรับ ≥ CB) เพื่อให้เลือกตัด')}
        ${ck('coordinateKidFeeders', m.coordinateKidFeeders !== false, 'ประสานสายป้อนหลายชั้น (Multilevel Feeder Coordination: ลูกก่อนแม่) — เมนแผงแม่ ≥ 1.6 × CB สายป้อนแผงลูก (ป้องกันการทริปข้ามชั้น) · ต้องเปิด Auto-Selectivity ด้วย', m.autoSelectivity === false)}
        <div class="row2">${s('', 'ความสูงต่อชั้น (m) — สายป้อนแนวดิ่ง', n('floorHeight', m.floorHeight, 'min="1" max="20" step="0.1"'), 'ใช้เมื่อระบุ "ชั้นที่ติดตั้ง" ของแผงและแผงแม่')}</div>
      </div></div>
    </div>`;
  }

  /* ================= events ================= */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-select],[data-select-go],[data-new],[data-edit],[data-del],[data-dup],[data-add-board],[data-del-board],[data-action],[data-goto],[data-panel-csv],[data-del-circuit],[data-edit-circuit],[data-balance],[data-balance-all],[data-spare],[data-plan-open],[data-plan-dup],[data-plan-del],[data-plan-new],[data-sched-go],[data-jump],[data-log-scope],[data-log-type],[data-log-csv],[data-log-clear],[data-cb-reset],[data-warn-cat],[data-cmp-swap],[data-hist-save],[data-hist-diff],[data-hist-restore],[data-hist-close],[data-hist-reload]');
    if (!t) return;
    if (dashClick(t, e)) return;
    if (t.dataset.delCircuit) { e.stopPropagation(); const [pid, no] = t.dataset.delCircuit.split('|'); deleteCircuit(pid, Number(no)); return; }
    if (t.dataset.editCircuit) { const it = project.items.find((x) => x.id === t.dataset.editCircuit); if (it) openDrawer(it.type, it); return; }
    if (t.dataset.balance) { balanceBoards([t.dataset.balance]); return; }
    if (t.dataset.balanceAll) { balanceBoards(project.panels.filter((p) => p.kind === 'LP' && p.phases !== 1).map((p) => p.id)); return; }
    if (t.dataset.spare) { const [pid, d] = t.dataset.spare.split('|'); adjustSpare(pid, Number(d)); return; }
    if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (t.dataset.goto) { tab = t.dataset.goto; render(); return; }
    if (t.dataset.select) { selected = t.dataset.select; render(); return; }
    if (t.dataset.selectGo) { selected = t.dataset.selectGo; tab = 'design'; render(); return; }
    if (t.dataset.new) { openDrawer(t.dataset.new); return; }
    if (t.dataset.dup) { e.stopPropagation(); const it = project.items.find((x) => x.id === t.dataset.dup); const cp = Object.assign(JSON.parse(JSON.stringify(it)), { id: uid('i'), name: (it.name || '') + ' (สำเนา)' }); project.items.splice(project.items.indexOf(it) + 1, 0, cp); logEvent('item', `ทำสำเนา ${it.name || TYPE_NAME[it.type]}`); recalc(true); toast('ทำสำเนาแล้ว'); return; }
    if (t.dataset.del) { e.stopPropagation(); deleteItem(t.dataset.del, t.closest('.item')); return; }
    if (t.dataset.edit) { const it = project.items.find((x) => x.id === t.dataset.edit); openDrawer(it.type, it); return; }
    if (t.dataset.addBoard) { addBoard(t.dataset.addBoard); return; }
    if (t.dataset.delBoard) { delBoard(t.dataset.delBoard); return; }
    if (t.dataset.panelCsv) { if (demoBlock('CSV')) return; const p = result.panels.find((x) => x.id === t.dataset.panelCsv); download(`${p.board.name}.csv`, R.panelCSV(p, result), 'text/csv;charset=utf-8'); return; }
    switch (t.dataset.action) {
      case 'close-drawer': closeDrawer(); if (imp) closeImporter(); break;
      case 'open-importer': openImporter(); break;
      case 'close-importer': closeImporter(); break;
      case 'imp-example': $('#impText').value = imp.text = SAMPLE_TEXT; reparse(); break;
      case 'imp-apply': impApply(); break;
      case 'save-item': saveItem(false); break;
      case 'save-item-more': saveItem(true); break;
      case 'estimate-light': {
        const it = readForm(); const l = E.lampById(it.lamp);
        const w = Number($('#hArea').value) * Number($('#hWpm').value);
        const n = Math.max(1, Math.ceil(w / (l.w * (it.perFixture || 1))));
        $('[data-f="fixtures"]').value = n; updatePreview(); toast(`${fmt(w, 0)} W ÷ (${l.w} W × ${it.perFixture || 1}) ≈ ${n} โคม`);
        break;
      }
      case 'estimate-ac': {
        const need = Number($('#hAcArea').value) * Number($('#hAcK').value);
        const it = readForm();
        const ph = Number(it.phases) || (need >= 36000 ? 3 : 1);
        const tbl = ph === 3 ? D.AC_3P : D.AC_1P;
        const pick = (tbl.find((r) => r[0] >= need) || tbl[tbl.length - 1])[0];
        drawerState.it.btu = pick; if (!it.phases && pick >= 36000) drawerState.it.phases = '';
        $('#drawerBody').innerHTML = formFor(Object.assign(readForm(), { btu: pick }), project.meta); updatePreview();
        toast(`ต้องการ ~${fmt(need, 0)} BTU → เลือก ${fmt(pick, 0)} BTU`);
        break;
      }
      case 'save-file': saveFile(); break;
      case 'open-file': $('#fileInput').click(); break;
      case 'export-csv': if (demoBlock('CSV')) break; logEvent('file', 'ส่งออก CSV ทุกแผง'); download(`${project.meta.name || 'load-schedule'}.csv`, R.allCSV(result), 'text/csv;charset=utf-8'); toast('ส่งออก CSV แล้ว (เปิดด้วย Excel ได้ทันที)'); break;
      case 'export-xlsx':
        if (demoBlock('Excel (.xlsx)')) break;
        try { download(`${project.meta.name || 'load-schedule'}.xlsx`, window.XlsxIO.exportXlsx(result), window.XlsxIO.MIME); logEvent('file', 'ส่งออก Excel (.xlsx) ทุกตาราง'); toast('ส่งออก Excel แล้ว — ชีตละตาราง'); }
        catch (e) { toast('ส่งออก Excel ไม่สำเร็จ: ' + (e.message || e)); }
        break;
      case 'export-dxf':
        if (demoBlock('AutoCAD DXF (.dxf)')) break;
        try { download(`${project.meta.name || 'load-schedule'}-SLD.dxf`, window.SldDXF.build(result), 'application/dxf'); logEvent('file', 'ส่งออกผังเส้นเดียว DXF'); toast('ส่งออก DXF แล้ว — เปิดด้วย AutoCAD/โปรแกรม CAD ได้'); }
        catch (e) { toast('ส่งออก DXF ไม่สำเร็จ: ' + (e.message || e)); }
        break;
      case 'export-pdf': exportPDF(); break;
      case 'load-sample': newPlan('sample'); break;
      case 'new-project': newPlan('blank'); break;
      case 'undo': stepHistory(-1); break;
      case 'redo': stepHistory(1); break;
      case 'toggle-theme': applyTheme(UK.nextTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'), true); break;
      case 'logo-clear': project.meta.logo = ''; logEvent('setting', 'ลบโลโก้บริษัท'); recalc(true); break;
      case 'sel-enable': project.meta.autoSelectivity = true; project.meta.coordinateKidFeeders = true; logEvent('setting', 'เปิด Auto-Selectivity และประสานสายป้อนหลายชั้น (จากแถบแจ้ง)'); toast('เปิด Auto-Selectivity และประสานสายป้อนแล้ว — คำนวณใหม่'); recalc(true); break;
      case 'sel-keep': lsSet(selNoticeKey(), '1'); updateSelNotice(); break;
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'panelSearch') { panelQuery = el.value; refreshTree(); return; }
    if (el.closest('#drawerBody')) {
      // เปลี่ยนชนิดเฟส/ชนิดชิลเลอร์ ต้องวาดฟอร์มใหม่เพราะตัวเลือกเปลี่ยน
      if (['phases', 'cooling'].includes(el.dataset.f) && ['ac', 'motor', 'fire_pump', 'chiller'].includes(drawerState.it.type)) {
        const it = readForm();
        if (it.type === 'motor' || it.type === 'fire_pump') { const tbl = Number(it.phases) === 1 ? D.MOTOR_1P : D.MOTOR_3P; if (!tbl.find((r) => r[0] === Number(it.kw))) it.kw = tbl[Math.min(4, tbl.length - 1)][0]; }
        if (it.type === 'ac') { const tbl = Number(it.phases) === 3 ? D.AC_3P : D.AC_1P; if (!tbl.find((r) => r[0] === Number(it.btu)) && it.phases) it.btu = tbl[0][0]; }
        if (it.type === 'chiller') it.preset = 0;
        $('#drawerBody').innerHTML = formFor(it, project.meta);
      }
      updatePreview();
      return;
    }
    if (el.dataset.board) { updateBoard(el); return; }
    if (el.dataset.m) { updateMeta(el); return; }
    if (el.id === 'projName') { project.meta.name = el.value; persist(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'fileInput') { openFile(el.files[0]); el.value = ''; return; }
    if (el.dataset && el.dataset.logoFile !== undefined) { loadLogo(el.files[0]); el.value = ''; return; }
    if (el.dataset.cmp) { cmpSel[el.dataset.cmp] = el.value; render(); return; }
    if (el.dataset.cbSet) { keepFocus = { kind: 'cbsel', ck: (el.closest('tr') || { dataset: {} }).dataset.ck }; const [pid, no] = el.dataset.cbSet.split('|'); setCircuitCB(pid, Number(no), Number(el.value)); return; }
    if (el.dataset.phSet) { keepFocus = { kind: 'phsel', ck: (el.closest('tr') || { dataset: {} }).dataset.ck }; const [pid, no] = el.dataset.phSet.split('|'); setCircuitPhase(pid, Number(no), el.value === 'auto' ? 'auto' : Number(el.value)); return; }
    if (el.dataset.m && (el.tagName === 'SELECT' || el.type === 'checkbox')) { updateMeta(el, true); }
    if (el.id === 'projName') { logEvent('plan', `เปลี่ยนชื่อแปลนเป็น "${el.value}"`); recalc(); }
    else if (el.dataset.board) logEvent('panel', `แก้ ${fieldLabel(el)} ของ ${(boardOf(selected) || {}).name || 'แผง'} → ${valueLabel(el)}`);
    else if (el.dataset.m) logEvent('setting', `ตั้งค่า ${fieldLabel(el)} → ${valueLabel(el)}`);
  });
  document.addEventListener('keydown', (e) => {
    // ค้นหาแผงด่วน: Enter = ไปแผงแรกที่ตรง, Esc = ล้างคำค้น
    if (e.target && e.target.id === 'panelSearch') {
      if (e.key === 'Escape') { e.preventDefault(); panelQuery = ''; e.target.value = ''; refreshTree(); e.target.blur(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const ids = UK.filterPanels(searchBoards(), panelQuery); if (ids.length) { selected = ids[0]; panelQuery = ''; render(); } return; }
    }
    // คีย์ลัดส่วนกลาง (ใช้ e.code → คีย์บอร์ดไทยใช้ได้) : Ctrl+K / "/" ค้นหาแผง · Ctrl+Z ย้อน · Ctrl+Y ทำซ้ำ
    const sc = UK.shortcut(e);
    if (sc === 'search') { e.preventDefault(); focusPanelSearch(); return; }
    if ((sc === 'undo' || sc === 'redo') && !drawerState && !imp && !($('#modal') && $('#modal').classList.contains('on'))) { e.preventDefault(); stepHistory(sc === 'undo' ? -1 : 1); return; }
    if (e.key === 'Escape' && drawerState) closeDrawer(); else if (e.key === 'Escape' && imp) closeImporter();
    // Enter ในช่องของ "ตัวช่วยประมาณ" (พื้นที่/BTU) ไม่ควรบันทึกอุปกรณ์ทั้งที่ยังไม่ได้กดคำนวณ
    if (e.key === 'Enter' && drawerState && !e.target.closest('#importer') && !e.target.closest('.helper') && e.target.tagName === 'INPUT' && !e.target.hasAttribute('list') && e.target.type !== 'checkbox') { e.preventDefault(); saveItem(false); }
    // ใช้ e.code (ตำแหน่งแป้น) เพราะแป้นพิมพ์ไทย e.key ของปุ่ม S ไม่ใช่ 's'
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) { e.preventDefault(); saveFile(); }
  });

  function updateBoard(el) {
    const b = boardOf(selected);
    const k = el.dataset.board;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['phases', 'feederLength', 'ways', 'floor'].includes(k)) v = v === '' ? '' : Number(v);
    if (k === 'floor') { if (v === '' || !Number.isFinite(v)) delete b.floor; else b.floor = Math.round(v); return recalc(); }
    if (k === 'tap') { if (v) b.tap = 'ahead_of_main'; else delete b.tap; return recalc(true); }   // ต่อก่อนเมนสวิตช์ (NFPA 20) — ตัวเลือกปิดไว้
    if (k === 'phase') { if (v === '') { delete b.phase; } else v = Number(v); }
    if (k === 'unit' && v === '') { delete b.unit; return recalc(true); }
    if (k === 'phase' && v === '') { /* อัตโนมัติ */ } else b[k] = v;
    if (k === 'name') { $$(`.node[data-select="${b.id}"] .nm`).forEach((n) => { n.textContent = v; }); }
    recalc(k === 'parent' || el.tagName === 'SELECT');
  }
  function updateMeta(el, structural) {
    const path = el.dataset.m.split('.');
    if (path.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || (el.tagName === 'SELECT' && v !== '' && !isNaN(Number(v)))) v = Number(v);
    let o = project.meta;
    for (let i = 0; i < path.length - 1; i++) {
      if (!Object.prototype.hasOwnProperty.call(o, path[i]) || typeof o[path[i]] !== 'object' || o[path[i]] === null) {
        o[path[i]] = {};
      }
      o = o[path[i]];
    }
    o[path[path.length - 1]] = v;
    if (path[0] === 'name') $('#projName').value = v;
    if (path[0] === 'autoSelectivity' || path[0] === 'coordinateKidFeeders') lsSet(selNoticeKey(), '1');   // ผู้ใช้ตัดสินใจเองแล้ว ไม่ถามซ้ำ
    // เปลี่ยนรูปแบบรับไฟ → ฟอร์มเปลี่ยน ต้องวาดใหม่
    recalc(structural);
  }

  function addBoard(kind) {
    const cur = boardOf(selected);
    const parent = cur && cur.kind !== 'LP' ? cur.id : (cur ? cur.parent : 'MDB') || 'MDB';
    // ตั้งชื่อเลขถัดไปที่ยังไม่ซ้ำ (ลบแผงกลางทางแล้วชื่อไม่ชนกัน)
    const prefix = kind === 'LP' ? 'LP' : 'SDB';
    let count = 1;
    while (project.panels.some((p) => p.name === `${prefix}-${count}`)) count++;
    const b = { id: uid('P'), name: `${prefix}-${count}`, kind, phases: 3, parent, feederLength: 20, location: '', mounting: 'SURFACE' };
    project.panels.push(b);
    selected = b.id;
    tab = 'design';
    recalc(true);
    logEvent('panel', `เพิ่มแผง ${b.name} (${kind}) รับไฟจาก ${boardOf(parent).name}`);
    toast(`เพิ่ม ${b.name} (รับไฟจาก ${boardOf(parent).name})`);
  }
  async function delBoard(id) {
    const b = boardOf(id);
    if (!b || b.kind === 'MDB') return;
    const kids = project.panels.filter((p) => p.parent === id);
    const nItems = project.items.filter((i) => i.panelId === id).length;
    const parentName = (boardOf(b.parent) || { name: 'MDB' }).name;
    const lines = [nItems ? `อุปกรณ์ ${nItems} รายการในแผงนี้จะถูกลบด้วย` : 'แผงนี้ยังไม่มีอุปกรณ์', kids.length ? `แผงลูก ${kids.length} แผง (${kids.map((k) => k.name).join(', ')}) จะย้ายไปรับไฟจาก ${parentName}` : ''].filter(Boolean);
    if (!(await askConfirm({ title: `ลบแผง ${b.name}?`, body: lines.join('\n'), ok: 'ลบแผง', danger: true }))) return;
    // เก็บสถานะก่อนลบไว้ให้กด "เลิกทำ"
    const snap = JSON.stringify({ panels: project.panels, items: project.items });
    kids.forEach((k) => { k.parent = b.parent; });
    project.panels = project.panels.filter((p) => p.id !== id);
    project.items = project.items.filter((i) => i.panelId !== id);
    selected = boardOf(b.parent) ? b.parent : (project.panels.find((p) => p.kind === 'MDB') || project.panels[0]).id;
    recalc(true);
    logEvent('panel', `ลบแผง ${b.name}${nItems ? ` พร้อมอุปกรณ์ ${nItems} รายการ` : ''}`);
    toastUndo(`ลบ ${b.name} แล้ว`, () => { Object.assign(project, JSON.parse(snap)); selected = id; logEvent('panel', `เลิกทำการลบแผง ${b.name}`); recalc(true); });
  }

  /* กล่องยืนยันในโปรแกรม — ไม่ใช้ window.confirm เพราะบางหน้าต่าง (เช่น เบราว์เซอร์ฝังในแอป) บล็อก dialog แล้วปุ่มจะ "ไม่ทำงาน" เงียบ ๆ */
  function askConfirm({ title, body, ok = 'ตกลง', danger = false }) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = `<div class="modal-box" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(body || '').replace(/\n/g, '<br>')}</p>
        <div class="modal-f"><button class="btn" data-m-cancel>ยกเลิก</button><button class="btn ${danger ? 'danger-solid' : 'dark'}" data-m-ok>${esc(ok)}</button></div></div>`;
      m.classList.add('on');
      const done = (v) => { m.classList.remove('on'); m.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onClick = (e) => { if (e.target.closest('[data-m-ok]')) done(true); else if (e.target.closest('[data-m-cancel]') || e.target === m) done(false); };
      // Enter = ยืนยัน ยกเว้นตอนโฟกัสอยู่ที่ปุ่ม "ยกเลิก" (ต้องเป็นยกเลิก ไม่ใช่ลบ)
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(!(document.activeElement && document.activeElement.closest('[data-m-cancel]'))); }
        else if (e.key === 'Tab') {           // วนโฟกัสอยู่ในกล่องยืนยัน
          const bs = $$('button', m); if (!bs.length) return;
          const first = bs[0], last = bs[bs.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      m.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);
      setTimeout(() => { const b = $('[data-m-ok]', m); if (b) b.focus(); }, 30);
    });
  }

  /* ================= คลิกในแท็บภาพรวม ================= */
  function dashClick(t, e) {
    const d = t.dataset;
    if (d.planOpen) { openPlan(d.planOpen); return true; }
    if (d.planDup) { dupPlan(d.planDup); return true; }
    if (d.planDel) { deletePlan(d.planDel); return true; }
    if (d.planNew) { newPlan(d.planNew); return true; }
    if (d.warnCat !== undefined) { warnView.cat = d.warnCat; render(); return true; }
    if (d.cmpSwap) { const a = cmpSel.a; cmpSel.a = cmpSel.b; cmpSel.b = a; render(); return true; }
    if (d.histSave) { const n = $('#histNote'); snapVersion(n ? n.value.trim().slice(0, 200) : '', false).then((ok) => toast(ok ? 'บันทึกเวอร์ชันแล้ว' : !disk.on ? 'บันทึกเวอร์ชันได้เมื่อเปิดผ่าน node server.js' : disk.ok === 'auth' ? 'เซิร์ฟเวอร์ถูกเปิดใหม่ — รีเฟรชหน้าแล้วลองอีกครั้ง' : 'บันทึกเวอร์ชันไม่สำเร็จ — เซิร์ฟเวอร์ไม่ตอบ ลองใหม่ภายหลัง')); return true; }
    if (d.histReload) { histLoad(true); return true; }
    if (d.histDiff) { histDiff(Number(d.histDiff)); return true; }
    if (d.histRestore) { histRestore(Number(d.histRestore)); return true; }
    if (d.histClose) { hist.diff = null; refreshHist(); return true; }
    if (d.jump) { const el = document.getElementById(d.jump); if (el) { const y = el.getBoundingClientRect().top + window.scrollY - 110; window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); } return true; }
    if (d.schedGo) {
      selected = d.schedGo; tab = 'schedule'; render();
      const sh = $(`.sheet[data-sid="${d.schedGo.replace(/["\\]/g, '\\$&')}"]`);
      if (sh) window.scrollTo({ top: sh.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
      return true;
    }
    if (d.logScope !== undefined) { logView.scope = d.logScope === 'plan' ? 'plan' : 'all'; logView.type = ''; refreshLog(); return true; }
    if (d.logType !== undefined) { logView.type = d.logType; refreshLog(); return true; }
    if (d.logCsv) { exportLogCSV(); return true; }
    if (d.logClear) {
      askConfirm({ title: 'ล้างบันทึกกิจกรรมทั้งหมด?', body: `จะลบบันทึก ${logs.length} รายการของทุกแปลน (แปลนและข้อมูลโครงการไม่ถูกลบ)`, ok: 'ล้างบันทึก', danger: true }).then((y) => {
        if (!y) return;
        logs = []; lsSet(LOGK, '[]'); logView.type = ''; refreshLog();
        if (!disk.on) { toast('ล้างบันทึกกิจกรรมแล้ว'); return; }
        disk.logQ = [];
        api('api/logs', { method: 'DELETE' }).then((r) => toast(r.ok ? 'ล้างบันทึกกิจกรรมแล้ว (รวมไฟล์ใน projects/library)' : 'ล้างในเบราว์เซอร์แล้ว แต่ล้างไฟล์บนดิสก์ไม่สำเร็จ'))
          .catch(() => toast('ล้างในเบราว์เซอร์แล้ว แต่เซิร์ฟเวอร์ไม่ตอบ — ไฟล์บนดิสก์ยังอยู่'));
      });
      return true;
    }
    if (d.cbReset) { const [pid, no] = d.cbReset.split('|'); setCircuitCB(pid, Number(no), 'auto'); return true; }
    return false;
  }
  function refreshLog() { const box = $('#logBox'); if (box) { box.innerHTML = logHTML(); $$('[data-icon]', box).forEach((el) => { el.outerHTML = I[el.dataset.icon]; }); } }
  function exportLogCSV() {
    const q = R.csvCell;
    const rows = logs.filter((l) => (logView.scope === 'all' || l.pid === planId) && (!logView.type || l.type === logView.type));
    const csv = '\ufeff' + ['เวลา,แปลน,ประเภท,รายละเอียด'].concat(rows.map((l) => [q(new Date(l.t).toISOString()), q(l.pn), q(LOG_TYPES[l.type]), q(l.msg)].join(','))).join('\r\n');
    download(`activity-log-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    toast(`ส่งออกบันทึก ${rows.length} รายการแล้ว`);
  }
  // ข้อความอ่านง่ายของช่องที่ผู้ใช้แก้ (ไว้เขียน log)
  function fieldLabel(el) { const l = el.closest('label'); const sp = l && $('span', l); return (sp ? sp.textContent : (el.dataset.board || el.dataset.m || 'ค่า')).trim(); }
  function valueLabel(el) {
    if (el.type === 'checkbox') return el.checked ? 'เปิด' : 'ปิด';
    if (el.tagName === 'SELECT') return (el.options[el.selectedIndex] || {}).text || el.value;
    return String(el.value).slice(0, 60);
  }

  /* ================= เปลี่ยนเบรกเกอร์ย่อยรายวงจร (dropdown / ลากวาง / ลากเลื่อนขนาด) =================
   * ค่าที่กำหนดเก็บที่อุปกรณ์เจ้าของวงจร: item.cbOv = { "ลำดับวงจรในอุปกรณ์": AT } — เลือกขนาดเท่าที่ระบบเลือกเอง = ลบค่าที่กำหนด
   * เอนจินจะเลือกสาย/ท่อ/แรงดันตกใหม่ให้ตาม CB ที่กำหนด และเตือนถ้าเล็กกว่ากระแสโหลด */
  function setCircuitCB(panelId, no, at) {
    const po = panelOut(panelId);
    if (!po || !po.layout) return;
    const c = po.layout.slots[no - 1];
    if (!c || c.ref) return;
    if (!c.itemId || !c.cIdx) { toast('SPARE ที่ระบบเติมให้เปลี่ยนขนาดตรงนี้ไม่ได้ — ใช้ปุ่ม SPARE เพิ่มของตัวเอง หรือเพิ่มอุปกรณ์ "วงจรสำรอง" แล้วกำหนดขนาด'); return; }
    const it = project.items.find((x) => x.id === c.itemId);
    if (!it) return;
    const cur = c.cb.at, auto = c.cbForce ? c.cbAuto : c.cb.at;
    const next = at === 'auto' ? auto : Number(at);
    if (next === cur) { render(); return; }
    // คืนค่าอัตโนมัติได้เสมอ (แม้เป็น MCCB > 100 A); กำหนดเองได้เฉพาะขนาด MCB มาตรฐาน
    if (next !== auto && !D.MCB_AT.includes(next)) { toast('ขนาด CB ไม่อยู่ในรายการมาตรฐาน'); return; }
    if (next !== auto && c.cIdx > 500) { toast('กำหนด CB เองได้ถึงวงจรที่ 500 ของอุปกรณ์ — แบ่งอุปกรณ์เป็นหลายรายการ'); return; }
    const snap = snapshotProject();
    const ov = Object.assign({}, it.cbOv);
    if (next === auto) delete ov[c.cIdx]; else ov[c.cIdx] = next;
    if (Object.keys(ov).length) it.cbOv = ov; else delete it.cbOv;
    const label = `${po.board.name} วงจร ${no} · ${c.desc || 'SPARE'}`;
    afterCalc = () => {
      const c2 = (panelOut(panelId) || {}).layout && panelOut(panelId).layout.slots[no - 1];
      const w = c2 && c2.warn && c2.warn.find((x) => /CB ที่กำหนด/.test(x));
      if (w) toast('คำเตือน: ' + w);
    };
    recalc(true);
    logEvent('breaker', `${label}: CB ${cur} A → ${next} A${next === auto ? ' (ตามที่ระบบเลือก)' : ' (กำหนดเอง)'}`);
    toastUndo(`${label}: CB ${cur} → ${next} A`, () => { restoreSnapshot(snap); logEvent('breaker', `เลิกทำ: ${label} กลับเป็น ${cur} A`); });
  }
  /* ---- ย้ายเฟสวงจร (ลากวาง / dropdown / ปุ่มลูกศร): item.phOv = { "ลำดับวงจรในอุปกรณ์": 0|1|2 } ----
   * ตรึงวงจรนั้นไว้เฟสที่เลือก แล้วตัวจัดเฟสจัดวงจรอื่นรอบ ๆ ใหม่ ; เลือก "•" (อัตโนมัติ) = ปลดการตรึง */
  function phaseTarget(pid, no) {
    const po = panelOut(pid);
    if (!po || !po.layout || po.board.phases === 1) return null;
    const c = po.layout.slots[no - 1];
    if (!c || c.ref || !c.itemId || !c.cIdx || c.phases === 3 || c.cat === 'spare') return null;
    return { po, c, it: project.items.find((x) => x.id === c.itemId) };
  }
  // ประมาณผลก่อนวาง: ย้ายโหลดของวงจรนี้ไปเฟสใหม่ (วงจรอื่นอยู่ที่เดิม) — หลังวางจริงตัวจัดเฟสอาจปรับวงจรอื่นให้ดีขึ้นอีก
  function phasePreview(po, c, to) {
    const pv = po.phaseVA.slice(); pv[c.phase] -= c.va; pv[to] += c.va;
    const a = (pv[0] + pv[1] + pv[2]) / 3;
    return a ? Math.max(...pv.map((v) => Math.abs(v - a))) / a * 100 : 0;
  }
  function setCircuitPhase(pid, no, ph) {
    const t = phaseTarget(pid, no);
    if (!t || !t.it) { toast('ย้ายเฟสได้เฉพาะวงจร 1 เฟสของอุปกรณ์ในแผง 3 เฟส'); render(); return; }
    const { po, c, it } = t;
    const cur = c.phForce == null ? 'auto' : c.phForce;
    if (ph === cur || (ph !== 'auto' && !(ph === 0 || ph === 1 || ph === 2))) { render(); return; }
    if (ph !== 'auto' && c.cIdx > 500) { toast('ตรึงเฟสได้ถึงวงจรที่ 500 ของอุปกรณ์'); return; }
    const snap = snapshotProject(), before = po.unbalance, fromPh = 'ABC'[c.phase];
    const pv = Object.assign({}, it.phOv);
    if (ph === 'auto') delete pv[c.cIdx]; else pv[c.cIdx] = ph;
    if (Object.keys(pv).length) it.phOv = pv; else delete it.phOv;
    const label = `${po.board.name} วงจร ${no} · ${c.desc}`, toTxt = ph === 'auto' ? 'อัตโนมัติ' : 'เฟส ' + 'ABC'[ph];
    afterCalc = () => {
      const p2 = panelOut(pid); if (!p2) return;
      const denied = result.warnings.find((w) => w.startsWith(p2.board.name + ': ตรึง') && w.includes(c.desc));
      toast(denied ? 'คำเตือน: ' + denied.split(': ').slice(1).join(': ') : `${label}: ${toTxt} · ไม่สมดุล ${fmt(before, 1)}% → ${fmt(p2.unbalance, 1)}%`);
    };
    recalc(true);
    logEvent('circuit', `${label}: เฟส ${fromPh} → ${toTxt}`);
    toastUndo(`${label}: ${fromPh} → ${toTxt}`, () => { restoreSnapshot(snap); logEvent('circuit', `เลิกทำ: ${label} กลับเป็นเฟส ${fromPh}`); });
  }

  // แก้จำนวนเครื่อง/โคม/จุดแล้ววงจรลดลง → ตัด CB/เฟสที่กำหนดของวงจรที่ไม่มีแล้ว (ไม่งั้นเพิ่มกลับจะได้ค่าเก่าแบบเงียบ ๆ)
  const OV_KEYS = ['cbOv', 'phOv'];
  function pruneCbOv(it) {
    if (!it || !OV_KEYS.some((k) => it[k])) return;
    let n = 0;
    try { n = E.expandItem(it, Object.assign(E.defaultMeta(), project.meta)).length; } catch (e) { n = 0; }
    OV_KEYS.forEach((key) => {
      if (!it[key]) return;
      Object.keys(it[key]).forEach((k) => { if (Number(k) > n) delete it[key][k]; });
      if (!Object.keys(it[key]).length) delete it[key];
    });
  }
  // ลบวงจรแล้วลำดับวงจรของอุปกรณ์เลื่อน — เลื่อนค่า CB/เฟสที่กำหนดตามไปด้วย
  function shiftCbOv(it, idx) {
    if (!it) return;
    OV_KEYS.forEach((key) => {
      if (!it[key]) return;
      const o = {};
      Object.keys(it[key]).forEach((k) => { const n = Number(k); if (n < idx) o[n] = it[key][k]; else if (n > idx) o[n - 1] = it[key][k]; });
      if (Object.keys(o).length) it[key] = o; else delete it[key];
    });
  }

  let cbDrag = null;
  function cbRowAt(x, y) { const el = document.elementFromPoint(x, y); return el ? el.closest('[data-cbrow]') : null; }
  function cbDragEnd(apply) {
    const d = cbDrag; if (!d) return;
    cbDrag = null;
    document.removeEventListener('pointermove', cbDragMove); document.removeEventListener('pointerup', cbDragUp); document.removeEventListener('pointercancel', cbDragCancel); document.removeEventListener('keydown', cbDragKey, true);
    cancelAnimationFrame(d.raf);
    if (d.ghost) d.ghost.remove();
    if (d.over) d.over.classList.remove('cb-over');
    document.body.classList.remove('cb-dragging');
    if (!apply) return;
    if (d.mode === 'chip' && d.target) { const [pid, no] = d.target.split('|'); setCircuitCB(pid, Number(no), d.at); }
    else if (d.mode === 'scrub' && d.moved && d.value != null) setCircuitCB(d.pid, d.no, d.value);
    else if (d.mode === 'phase' && d.moved && d.to != null && d.to !== d.from) setCircuitPhase(d.pid, d.no, d.to);
  }
  // เป้าหมายตอนลากย้ายเฟส: ปุ่มเฟสของแผงเดียวกัน หรือแถวใดก็ได้ของแผงเดียวกัน (ใช้เฟสของแถวนั้น)
  function phDropAt(d) {
    const el = document.elementFromPoint(d.x, d.y);
    if (!el) return null;
    const b = el.closest('[data-ph-drop]');
    if (b) { const [pid, k] = b.dataset.phDrop.split('|'); return pid === d.pid ? { el: b, to: Number(k) } : null; }
    const tr = el.closest('tr[data-phrow]');
    if (tr && tr.dataset.phrow === d.pid && tr.dataset.ph) return { el: tr, to: 'ABC'.indexOf(tr.dataset.ph) };
    return null;
  }
  function cbDragMove(e) {
    const d = cbDrag; if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) > 4) d.moved = true;
    if (!d.moved) return;
    const g = d.ghost;
    if (d.mode === 'phase') {
      const hit = phDropAt(d);
      if (d.over && (!hit || d.over !== hit.el)) d.over.classList.remove('cb-over');
      d.over = hit ? hit.el : null; d.to = hit ? hit.to : null;
      if (hit) hit.el.classList.add('cb-over');
      g.textContent = hit && hit.to !== d.from ? `→ เฟส ${'ABC'[hit.to]} · ไม่สมดุล ${fmt(d.po.unbalance, 1)}% → ~${fmt(phasePreview(d.po, d.c, hit.to), 1)}%` : `เฟส ${'ABC'[d.from]} · ${fmt(Math.round(d.c.va), 0)} VA`;
      g.classList.toggle('ok', !!hit && hit.to !== d.from);
    } else if (d.mode === 'chip') {
      const row = cbRowAt(d.x, d.y);
      if (d.over && d.over !== row) d.over.classList.remove('cb-over');
      d.over = row; d.target = row ? row.dataset.cbrow : null;
      if (row) row.classList.add('cb-over');
      g.textContent = row ? `${d.at} A → ${row.dataset.cbrow.split('|')[1]}` : `${d.at} A`;
      g.classList.toggle('ok', !!row);
    } else {
      const steps = Math.round((d.y0 - d.y) / 14);                     // ลากขึ้น = ขนาดใหญ่ขึ้น
      const i = Math.max(0, Math.min(D.MCB_AT.length - 1, d.i0 + steps));
      d.value = D.MCB_AT[i];
      g.textContent = `${d.value} A`;
      g.classList.toggle('ok', d.value !== d.start);
    }
    g.style.transform = `translate(${d.x + 14}px, ${d.y + 12}px)`;
    // เลื่อนหน้าเองเมื่อลากไปใกล้ขอบจอ (ตารางโหลดยาวหลายแผง)
    const edge = d.y < 130 ? -14 : d.y > window.innerHeight - 60 ? 14 : 0;
    cancelAnimationFrame(d.raf);
    if (edge) { const tick = () => { if (cbDrag !== d) return; window.scrollBy(0, edge); if (d.mode === 'phase') { const hit = phDropAt(d); if (d.over && (!hit || d.over !== hit.el)) d.over.classList.remove('cb-over'); d.over = hit ? hit.el : null; d.to = hit ? hit.to : null; if (hit) hit.el.classList.add('cb-over'); } else if (d.mode === 'chip') { const row = cbRowAt(d.x, d.y); if (d.over && d.over !== row) d.over.classList.remove('cb-over'); d.over = row; d.target = row ? row.dataset.cbrow : null; if (row) row.classList.add('cb-over'); } d.raf = requestAnimationFrame(tick); }; d.raf = requestAnimationFrame(tick); }
  }
  function cbDragUp(e) { if (cbDrag && e.pointerId === cbDrag.id) cbDragEnd(true); }
  function cbDragCancel(e) { if (cbDrag && e.pointerId === cbDrag.id) cbDragEnd(false); }
  function cbDragKey(e) { if (e.key === 'Escape') { e.stopPropagation(); cbDragEnd(false); } }
  document.addEventListener('pointerdown', (e) => {
    if (cbDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const chip = e.target.closest('[data-cb-chip]'), grip = e.target.closest('[data-cb-grip]'), phg = e.target.closest('[data-ph-grip]');
    if (!chip && !grip && !phg) return;
    e.preventDefault();
    const d = { mode: chip ? 'chip' : phg ? 'phase' : 'scrub', id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, over: null, target: null, raf: 0, value: null };
    if (chip) d.at = Number(chip.dataset.cbChip);
    else if (phg) {
      const [pid, no] = phg.dataset.phGrip.split('|');
      const t = phaseTarget(pid, Number(no));
      if (!t) return;
      Object.assign(d, { pid, no: Number(no), po: t.po, c: t.c, from: t.c.phase, to: null });
    } else {
      const [pid, no] = grip.dataset.cbGrip.split('|');
      const po = panelOut(pid), c = po && po.layout && po.layout.slots[Number(no) - 1];
      if (!c || !c.cb) return;
      d.pid = pid; d.no = Number(no); d.start = c.cb.at;
      const i0 = D.MCB_AT.findIndex((a) => a >= c.cb.at);
      d.i0 = i0 < 0 ? D.MCB_AT.length - 1 : i0;
    }
    const g = document.createElement('div');
    g.className = 'cb-ghost'; g.textContent = chip ? `${d.at} A` : phg ? `เฟส ${'ABC'[d.from]} · ${fmt(Math.round(d.c.va), 0)} VA` : `${d.start} A`;
    g.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    document.body.appendChild(g); d.ghost = g;
    document.body.classList.add('cb-dragging');
    cbDrag = d;
    document.addEventListener('pointermove', cbDragMove); document.addEventListener('pointerup', cbDragUp); document.addEventListener('pointercancel', cbDragCancel); document.addEventListener('keydown', cbDragKey, true);
  });

  // ทางเลือกแทนการลากด้วยคีย์บอร์ด: ที่จับ ⋮⋮ ช่อง AT ↑/↓ = ขนาดถัดไป ; ป้ายเฟส ←/→ = เฟสก่อน/ถัดไป, Delete/Backspace = กลับเป็นอัตโนมัติ
  document.addEventListener('keydown', (e) => {
    const cg = e.target.closest && e.target.closest('[data-cb-grip]'), pg = e.target.closest && e.target.closest('[data-ph-grip]');
    if (cg && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const [pid, no] = cg.dataset.cbGrip.split('|');
      const po = panelOut(pid), c = po && po.layout && po.layout.slots[Number(no) - 1];
      if (!c || !c.cb) return;
      const i0 = D.MCB_AT.findIndex((a) => a >= c.cb.at), i = Math.max(0, Math.min(D.MCB_AT.length - 1, (i0 < 0 ? D.MCB_AT.length - 1 : i0) + (e.key === 'ArrowUp' ? 1 : -1)));
      keepFocus = { kind: 'cb', ck: (cg.closest('tr') || { dataset: {} }).dataset.ck };
      setCircuitCB(pid, Number(no), D.MCB_AT[i]);
    } else if (pg && ['ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      const [pid, no] = pg.dataset.phGrip.split('|');
      const t = phaseTarget(pid, Number(no));
      if (!t) return;
      keepFocus = { kind: 'ph', ck: (pg.closest('tr') || { dataset: {} }).dataset.ck };
      if (e.key === 'Delete' || e.key === 'Backspace') setCircuitPhase(pid, Number(no), 'auto');
      else setCircuitPhase(pid, Number(no), (t.c.phase + (e.key === 'ArrowRight' ? 1 : 2)) % 3);
    }
  });

  /* ---- ลากแผงในผังแผงไฟ เพื่อเปลี่ยนว่า "รับไฟจาก" แผงไหน (ทำเป็น subset ของแผงที่วางลง) ----
   * ต้นทางต้องเป็น MDB/SDB (LP จ่ายไฟต่อไม่ได้), ห้ามวางลงตัวเองหรือแผงลูกหลานของตัวเอง (จะวนกลับ), MDB ย้ายไม่ได้ */
  let treeDrag = null, suppressClick = false;
  const treeTargetOk = (dragId, tid) => { const t = boardOf(tid), b = boardOf(dragId); return !!t && !!b && t.kind !== 'LP' && tid !== dragId && !isDescendant(tid, dragId); };
  function treeDragEnd(apply) {
    const d = treeDrag; if (!d) return;
    treeDrag = null;
    document.removeEventListener('pointermove', treeDragMove); document.removeEventListener('pointerup', treeDragUp); document.removeEventListener('pointercancel', treeDragCancel); document.removeEventListener('keydown', treeDragKey, true);
    if (d.ghost) d.ghost.remove();
    $$('.node.drop-ok, .node.drop-bad, .node.dragging').forEach((n) => n.classList.remove('drop-ok', 'drop-bad', 'dragging'));
    document.body.classList.remove('cb-dragging');
    if (!d.moved) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (apply && d.target) moveBoard(d.id, d.target);
  }
  function moveBoard(id, to) {
    const b = boardOf(id), t = boardOf(to);
    if (!b || !t || b.parent === to || !treeTargetOk(id, to)) return;
    const old = (boardOf(b.parent) || { name: '—' }).name, snap = snapshotProject();
    b.parent = to; selected = id;
    logEvent('panel', `ย้ายแผง ${b.name}: รับไฟจาก ${old} → ${t.name}`);
    recalc(true);
    toastUndo(`ย้าย ${b.name} ไปรับไฟจาก ${t.name}`, () => { restoreSnapshot(snap); logEvent('panel', `เลิกทำการย้ายแผง ${b.name} (กลับไปรับไฟจาก ${old})`); });
  }
  function treeDragMove(e) {
    const d = treeDrag; if (!d || e.pointerId !== d.pid) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      d.moved = true;
      const g = document.createElement('div'); g.className = 'cb-ghost'; document.body.appendChild(g); d.ghost = g;
      document.body.classList.add('cb-dragging');
      const n = $(`.node[data-select="${d.id.replace(/["\\]/g, '\\$&')}"]`); if (n) n.classList.add('dragging');
    }
    const el = document.elementFromPoint(e.clientX, e.clientY), node = el && el.closest('.node[data-select]');
    $$('.node.drop-ok, .node.drop-bad').forEach((n) => n.classList.remove('drop-ok', 'drop-bad'));
    d.target = null;
    const name = (boardOf(d.id) || {}).name;
    let txt = name;
    if (node && node.dataset.select !== d.id) {
      const tid = node.dataset.select, ok = treeTargetOk(d.id, tid);
      node.classList.add(ok ? 'drop-ok' : 'drop-bad');
      if (ok) { d.target = tid; txt = `${name} → รับไฟจาก ${boardOf(tid).name}`; } else txt = boardOf(tid).kind === 'LP' ? `${boardOf(tid).name} เป็นแผงย่อย จ่ายไฟต่อไม่ได้` : `วางลง ${boardOf(tid).name} ไม่ได้ (วนกลับ)`;
    }
    d.ghost.textContent = txt; d.ghost.classList.toggle('ok', !!d.target);
    d.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
  }
  function treeDragUp(e) { if (treeDrag && e.pointerId === treeDrag.pid) treeDragEnd(true); }
  function treeDragCancel(e) { if (treeDrag && e.pointerId === treeDrag.pid) treeDragEnd(false); }
  function treeDragKey(e) { if (e.key === 'Escape') { e.stopPropagation(); treeDragEnd(false); } }
  document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
  document.addEventListener('pointerdown', (e) => {
    if (treeDrag || cbDrag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const node = e.target.closest('.tree .node[data-select]');
    if (!node) return;
    const b = boardOf(node.dataset.select);
    if (!b || b.kind === 'MDB') return;
    treeDrag = { id: b.id, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, target: null, ghost: null };
    document.addEventListener('pointermove', treeDragMove); document.addEventListener('pointerup', treeDragUp); document.addEventListener('pointercancel', treeDragCancel); document.addEventListener('keydown', treeDragKey, true);
  });

  /* ================= files ================= */
  function download(name, content, type) {
    // ด่านสุดท้ายของเวอร์ชันสาธิต: ไฟล์ทุกชนิดที่แอปสร้างต้องผ่านฟังก์ชันนี้ — ไม่มีการดาวน์โหลดจริง
    if (demoBlock(String((String(name).match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || 'FILE').toUpperCase())) return;
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function saveFile() {
    if (!(window.DemoGuard && window.DemoGuard.config && window.DemoGuard.config.allowProjectJson) && demoBlock('JSON (บันทึกโครงการ)')) return;
    logEvent('file', `บันทึกไฟล์โครงการ "${project.meta.name}"`);
    download(`${project.meta.name || 'project'}.json`, JSON.stringify(project, null, 2), 'application/json');
    // เก็บสำเนาไว้ในโฟลเดอร์ projects/ ของโปรแกรมด้วย (ถ้ารันผ่าน server.js)
    try { const r = await api('api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }); if (r.ok) { const j = await r.json(); toast(`บันทึกแล้ว · projects/${j.file}`); return; } } catch (e) { /* ignore */ }
    toast('ดาวน์โหลดไฟล์โครงการแล้ว');
  }
  // เปิดไฟล์: ตรวจ+ล้างข้อมูลก่อน "แล้วค่อย" แทนโครงการปัจจุบัน (ไฟล์เสียจะไม่ทำให้ได้โครงการครึ่ง ๆ กลาง ๆ)
  function openFile(file) {
    if (!file) return;
    if (file.size > 20e6) { toast('ไฟล์ใหญ่เกิน 20 MB — ไม่ใช่ไฟล์โครงการ'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const { project: p, notes } = SAN.project(JSON.parse(rd.result));
        if (applyProject(p) === false) return;
        toast(`เปิด ${p.meta.name} แล้ว${notes.length ? ' · ' + notes[0] + (notes.length > 1 ? ` (+${notes.length - 1} หมายเหตุ)` : '') : ''}`);
      } catch (e) { toast('เปิดไฟล์ไม่ได้: ' + e.message); }
    };
    rd.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ');
    rd.readAsText(file, 'utf-8');
  }
  function applyProject(p) {
    if (!canAddPlan()) return false;
    p.meta.name = uniqueName(p.meta.name || 'โครงการจากไฟล์');
    enterPlan(p, uid('plan-'), 'design');
    logEvent('file', `เปิดไฟล์โครงการ "${p.meta.name}" เป็นแปลนใหม่`);
  }
  // ย่อเนื้อหาแผ่นที่ยาวเกินกระดาษให้พอดี 1 หน้า (กัน title block ตกไปหน้าถัดไป)
  function fitPrintPages() {
    // วัดด้วยกฎ print.css จริง (link.media='all' + #report กว้างเท่ากระดาษ) แล้วย่อ .page-b ของแต่ละแผ่นให้พอดี "ภายในหน้าเดียว"
    // แผ่นมีความสูงคงที่ (print.css) → เนื้อหาล้น = scrollHeight/scrollWidth > client ; ย่อ (zoom) จนพอดี ; ย่อถึง 40% แล้วยังไม่พอ → .flow (ไหลข้ามหน้า ไม่ตัดเนื้อหาทิ้ง)
    const link = document.querySelector('link[href*="print.css"]');
    const rep = $('#report');
    if (!link || !rep) return 0;
    let fitted = 0;
    const oldMedia = link.media, oldStyle = rep.getAttribute('style');
    try {
      link.media = 'all';
      rep.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:190mm';
      rep.querySelectorAll('.page:not(.calc)').forEach((pg) => {
        const land = pg.classList.contains('land');
        rep.style.width = land ? '277mm' : '190mm';
        const b = pg.querySelector('.page-b');
        if (!b) return;
        pg.classList.remove('flow'); b.style.zoom = '';
        const over = () => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1;
        if (!over()) return;
        let z = Math.max(0.4, Math.min(1, (b.clientHeight / Math.max(1, b.scrollHeight)) * 0.99));
        b.style.zoom = z.toFixed(3);
        for (let k = 0; k < 16 && over() && z > 0.4; k++) { z = Math.max(0.4, z - 0.02); b.style.zoom = z.toFixed(3); }
        if (over()) { b.style.zoom = ''; pg.classList.add('flow'); } else fitted++;
      });
    } finally {
      link.media = oldMedia;
      if (oldStyle == null) rep.removeAttribute('style'); else rep.setAttribute('style', oldStyle);
    }
    return fitted;
  }
  function exportPDF() {
    if (demoBlock('PDF')) return;
    if (!result) return;
    logEvent('file', 'สร้างรายงาน PDF');
    $('#report').innerHTML = R.reportHTML(result);
    const nFit = fitPrintPages();
    const old = document.title;
    document.title = `${project.meta.name} - ตารางโหลด`;
    toast('ปลายทางเลือก "บันทึกเป็น PDF" ขนาด A4'+(nFit ? ` · ย่อ ${nFit} แผ่นให้พอดีหน้า` : '')+' — ห้ามเลือก "Microsoft Print to PDF"');
    setTimeout(() => { window.print(); document.title = old; }, 350);
  }

  /* ================= toast ================= */
  // toast ซ้อนกันได้ (ไม่แย่งที่กัน) — แต่ละอันมีตัวนับเวลาของตัวเอง ปุ่ม "เลิกทำ" จึงไม่หายเมื่อมีแจ้งเตือนอื่นเข้ามา
  function pushToast(msg, ms, undo) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (undo ? ' has-undo' : '');
    el.innerHTML = `<span class="msg">${esc(msg)}</span>${undo ? '<button class="btn sm undo-btn" type="button">เลิกทำ</button>' : ''}<i class="life" style="animation-duration:${ms}ms"></i>`;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    let gone = false;
    const kill = () => { if (gone) return; gone = true; el.classList.remove('on'); el.classList.add('out'); setTimeout(() => el.remove(), 380); };
    const tm = setTimeout(kill, ms);
    if (undo) $('.undo-btn', el).addEventListener('click', () => { if (gone) return; clearTimeout(tm); kill(); undo(); }, { once: true });
    return el;
  }
  function toast(msg) { pushToast(msg, 2800); }
  // เลิกทำผูกกับแปลนที่ทำรายการ — สลับแปลนแล้วจะไม่เอา snapshot ไปทับแปลนอื่น
  function toastUndo(msg, undo) {
    const pid = planId;
    // snapshot เก่าจะทับการแก้ไขที่ทำต่อจากนั้น → มีรายการใหม่เมื่อไหร่ ปุ่ม "เลิกทำ" ของแก้ไขก่อนหน้าถูกปิด เหลือแค่อันล่าสุด
    $$('#toasts .toast.plan-undo .undo-btn').forEach((b) => { b.disabled = true; b.title = 'มีการแก้ไขใหม่กว่านี้แล้ว'; b.closest('.toast').classList.add('stale'); });
    const el = pushToast(msg, 6000, () => { if (pid !== planId) { toast('เลิกทำไม่ได้ — สลับไปแปลนอื่นแล้ว'); return; } undo(); });
    el.classList.add('plan-undo');
  }

  /* ================= นำเข้าแบบ / รายการโหลด ================= */
  const SAMPLE_TEXT = `ชั้น 1
ล็อบบี้ 80 ตร.ม.
ห้องประชุม: โคม LED 2x18W 12 ชุด, เต้ารับ 8 จุด, แอร์ 24,000 BTU 2 เครื่อง
ห้องน้ำชาย 15 ตร.ม.
ร้านกาแฟ: ดาวน์ไลท์ LED 9W x 20, เต้ารับ 10 จุด, เครื่องทำน้ำอุ่น 4500W, ไมโครเวฟ 1200W
ชั้น 2
สำนักงาน 150 ตร.ม.
ห้องผู้จัดการ 25 ตร.ม.
ทางเดิน 40 ตร.ม.
Server room: แอร์ 18000 BTU x 2, UPS 3 kVA
ส่วนกลาง
ปั๊มน้ำดี 5.5 kW 2 ตัว
ลิฟต์โดยสาร 1000 kg`;
  const TYPE_COLOR = { light: '#c78a12', rec: '#1f5d94', ac: '#2b8a9e', heater: '#c2410c', cook: '#9a3412', motor: '#4b5563', lift: '#6d28d9', esc: '#6d28d9', chiller: '#0e7490', ev: '#15803d', fire_pump: '#b3261e', custom: '#57534e' };
  let imp = null;

  /* ---- สถานะของหน้านำเข้า ----
   * parsed = แถวที่อ่านได้จากไฟล์/ข้อความ (เปลี่ยนเมื่ออ่านใหม่)   over[key] = สิ่งที่ผู้ใช้แก้ (จำนวน / ลบ / ชั้น / แผง) — เก็บแยก
   * แล้วใส่ทับทุกครั้งที่อ่านใหม่ จึงไม่หายเมื่อแก้ข้อความด้านซ้าย   rows = parsed + over (ใช้จริง) */
  const newImp = () => ({
    text: '', parsed: [], rows: [], warnings: [], info: null, source: 'text', mode: project.items.length ? 'append' : 'replace',
    busy: null, working: false, fileName: '', floorHeight: 3.6, over: {}, sel: new Set(), balance: true, layout: null, stats: null,
    applied: false
  });
  const impKeyOf = (r, i) => r.key || `${r.src || r.name || ''}#${i}`;
  const isLightRow = (r) => !r.sched && r.type === 'light';
  const isRecRow = (r) => !r.sched && r.type === 'rec';
  const rowQty = (r) => (isLightRow(r) ? r.fixtures : isRecRow(r) ? r.points : (r.qty || 1));
  const setRowQty = (r, v) => { if (isLightRow(r)) r.fixtures = v; else if (isRecRow(r)) r.points = v; else r.qty = v; };
  // ชั้นที่อ่านได้ตามธรรมชาติ ('C' = ส่วนกลาง) และชั้นที่ใช้จริงหลังผู้ใช้ย้าย
  const defFloor = (r) => (r.central || r.floor === 0 || r.floor < 0 ? 'C' : (r.floor || 1));
  const effFloor = (r) => (r.dest && r.dest.floor != null ? r.dest.floor : defFloor(r));
  const floorLabel = (f) => (f === 'C' ? 'ส่วนกลาง (จ่ายจาก PB)' : `ชั้น ${f}`);

  function rebuildRows() {
    const out = [];
    imp.parsed.forEach((p, i) => {
      const k = impKeyOf(p, i), o = imp.over[k];
      if (o && o.del) return;
      const r = Object.assign({}, p, { key: k });
      if (o && o.qty != null) setRowQty(r, o.qty);
      if (o && o.dest) r.dest = Object.assign({}, o.dest);
      out.push(r);
    });
    imp.rows = out;
    const keys = new Set(out.map((r) => r.key));
    imp.sel = new Set([...imp.sel].filter((k) => keys.has(k)));
  }
  const overOf = (k) => (imp.over[k] = imp.over[k] || {});

  function openImporter() {
    if (!imp || imp.applied) imp = newImp();        // งานที่นำเข้าไปแล้วไม่ค้างมาปนกับงานใหม่ แต่ร่างที่ยังไม่ได้ใช้จะอยู่ต่อ
    imp.mode = imp.rows.length ? imp.mode : (project.items.length ? 'append' : 'replace');
    const m = $('#importer');
    m.innerHTML = importerHTML();
    m.classList.add('on'); $('#scrim').classList.add('on');
    renderImpRows();
  }
  function closeImporter() { $('#importer').classList.remove('on'); if (!drawerState) $('#scrim').classList.remove('on'); }
  const importerOpen = () => $('#importer').classList.contains('on');

  function importerHTML() {
    try { sessionStorage.removeItem('ls-ai-key'); localStorage.removeItem('ls-ai-key'); } catch (e) { /* ล้าง API key ที่โหมด AI รุ่นเก่าเคยเก็บไว้ */ }
    return `<div class="imp-h">${I.up}<div><h3>นำเข้าแบบ / รายการโหลด</h3><div class="muted tiny">อัปโหลดรูปแบบ, PDF, ไฟล์ข้อความ/CSV (ลากวางที่ไหนในหน้าก็ได้) หรือพิมพ์รายการเอง — เลือกได้ว่าแต่ละรายการลงชั้นไหน/แผงไหน</div></div><span style="flex:1"></span><button class="btn ghost sm" data-action="close-importer" aria-label="ปิด">${I.close}</button></div>
      <div class="imp-b">
        <div class="imp-l">
          <label class="drop" id="drop"><input type="file" id="impFile" accept=".txt,.csv,.tsv,.md,.xlsx,.xlsm,.pdf,image/*" multiple hidden>
            <div class="drop-ic">${I.up}</div><b>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</b><span class="muted tiny">รูปแบบไฟฟ้า/สถาปัตย์ (.jpg .png) · PDF · รายการโหลด Excel .xlsx / .csv / .txt (เลือกหลายไฟล์ได้)</span>
            ${imp.fileName ? `<span class="tag" style="margin-top:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(imp.fileName)}</span>` : ''}</label>
          <div class="muted tiny" style="margin:2px 0 10px">อ่านตัวอักษรจาก PDF/รูปด้วย OCR ในเครื่อง (ไม่ส่งไฟล์ออกนอกเครื่อง) เหมาะกับรายการโหลด ตารางโหลด ตารางห้อง หรือแบบที่มีข้อความ — นับสัญลักษณ์ในแบบไม่ได้</div>
          <div class="imp-progress ${imp.busy ? 'on' : ''}"><div class="bar"><i style="width:${imp.busy ? Math.round(imp.busy.p * 100) : 0}%"></i></div><span>${imp.busy ? esc(imp.busy.msg) : ''}</span></div>
          <div class="imp-text-h"><span class="label">ข้อความที่อ่านได้ (แก้ไขได้ — ที่คุณย้าย/แก้จำนวนไว้จะไม่หาย)</span><span style="flex:1"></span><button class="btn ghost sm" data-action="imp-example">ใส่ตัวอย่าง</button></div>
          <textarea id="impText" spellcheck="false" maxlength="2000000" placeholder="พิมพ์ได้ เช่น&#10;ชั้น 1&#10;ห้องประชุม: โคม LED 2x18W 12 ชุด, เต้ารับ 8 จุด, แอร์ 24000 BTU 2 เครื่อง&#10;สำนักงาน 120 ตร.ม.   ← ใส่แค่พื้นที่ ระบบประมาณโหลดให้">${esc(imp.text)}</textarea>
        </div>
        <div class="imp-r" id="impRows"></div>
      </div>
      <div class="imp-f">
        <div class="seg"><button class="${imp.mode === 'replace' ? 'on' : ''}" data-imp-mode="replace">สร้างผังแผงใหม่ทั้งหมด</button><button class="${imp.mode === 'append' ? 'on' : ''}" data-imp-mode="append">เพิ่มเข้าโครงการเดิม</button></div>
        <label class="tiny muted" style="display:flex;align-items:center;gap:6px">ความสูงชั้น <input type="number" id="impH" value="${imp.floorHeight}" step="0.1" min="2" max="10" style="width:70px"> m</label>
        <label class="check imp-bal" style="margin:0" title="หลังจัดวางแล้วจัดเฟส A/B/C ในแต่ละแผงให้ต่างกันน้อยที่สุด"><input type="checkbox" id="impBalance" ${imp.balance ? 'checked' : ''}>${I.balance}Balance Load หลังนำเข้า</label>
        <span style="flex:1"></span><button class="btn ghost" data-action="close-importer">ยกเลิก</button><button class="btn accent" data-action="imp-apply" ${imp.rows.length ? '' : 'disabled'}>${I.bolt}จัดวางลงแผงอัตโนมัติ</button>
      </div>
      <datalist id="impPanels"></datalist>`;
  }

  /* ---- ฝั่งขวา: รายการที่อ่านได้ (เลือกชั้น/แผงต่อแถว) + แผงที่จะสร้าง ---- */
  function layoutNow() {
    try { imp.layout = window.Importer.buildLayout(imp.rows, project, { mode: imp.mode, floorHeight: imp.floorHeight }); imp.layoutErr = ''; }
    catch (e) { imp.layout = null; imp.layoutErr = e.message || String(e); }
  }
  function renderImpRows() {
    const box = $('#impRows'); if (!box) return;
    const rows = imp.rows;
    const ap = $('[data-action="imp-apply"]'); if (ap) ap.disabled = !rows.length;
    if (!rows.length) { box.innerHTML = `<div class="empty" style="margin-top:30px">${I.board}ยังไม่มีรายการ — อัปโหลดไฟล์ หรือพิมพ์ข้อความด้านซ้าย</div>`; return; }
    layoutNow();
    const place = (imp.layout && imp.layout.placement) || [];
    const counts = {}; rows.forEach((r) => { counts[r.type] = (counts[r.type] || 0) + 1; });
    const groups = new Map();
    rows.forEach((r, i) => { const f = effFloor(r); (groups.get(f) || groups.set(f, []).get(f)).push(i); });
    const order = [...groups.keys()].sort((a, b) => (a === 'C' ? 1 : b === 'C' ? -1 : a - b));
    const maxF = Math.max(3, ...order.filter((f) => f !== 'C'));
    const floorOpts = (cur) => [...Array.from({ length: maxF + 1 }, (_, k) => k + 1), 'C'].map((f) => `<option value="${f}" ${String(f) === String(cur) ? 'selected' : ''}>${f === 'C' ? 'ส่วนกลาง' : 'ชั้น ' + f}</option>`).join('');
    const panelNames = [...new Set([...project.panels.filter((p) => p.kind === 'LP').map((p) => p.name), ...(imp.layout ? imp.layout.panels.filter((p) => p.kind === 'LP').map((p) => p.name) : [])])];
    const dl = $('#impPanels'); if (dl) dl.innerHTML = panelNames.map((n) => `<option value="${esc(n)}"></option>`).join('');
    const bulk = imp.sel.size ? `<div class="imp-bulk"><b>${imp.sel.size}</b> รายการที่เลือก → <select id="impBulkFloor">${floorOpts('')}</select><input type="text" id="impBulkPanel" list="impPanels" placeholder="แผง (ว่าง = อัตโนมัติ)" maxlength="40">
        <button class="btn sm dark" data-imp-bulk="apply">ย้าย</button><button class="btn ghost sm" data-imp-bulk="clear">ล้างการเลือก</button></div>` : '';
    box.innerHTML = `<div class="imp-chips">${Object.entries(counts).map(([k, v]) => `<span class="chip" style="--c:${TYPE_COLOR[k]}">${esc(TYPE_NAME[k] || k)} <b>${v}</b></span>`).join('')}</div>${bulk}
      ${order.map((f) => { const idx = groups.get(f); const allSel = idx.every((i) => imp.sel.has(rows[i].key));
        return `<div class="imp-group"><div class="imp-group-h"><label class="check" style="margin:0"><input type="checkbox" data-imp-gsel="${esc(f)}" ${allSel ? 'checked' : ''}><span class="label">${esc(floorLabel(f))}</span></label><span class="muted tiny">${idx.length} รายการ</span></div>
        ${idx.map((i, n) => { const r = rows[i]; const pn = place[i] && place[i].panelName; const manual = r.dest && (r.dest.floor != null || r.dest.panel);
          return `<div class="imp-row ${imp.sel.has(r.key) ? 'sel' : ''} ${manual ? 'moved' : ''}" style="animation-delay:${Math.min(n * 16, 360)}ms">
          <input type="checkbox" class="ck" data-imp-sel="${i}" ${imp.sel.has(r.key) ? 'checked' : ''} aria-label="เลือกแถว">
          <span class="chip sm" style="--c:${TYPE_COLOR[r.type]}">${I[r.type] || ''}${esc(TYPE_NAME[r.type] || r.type)}</span>
          <div class="t"><b>${esc(r.name || r.room || '-')}</b><div>${esc(r.sched ? `${fmt(Math.round(r.va), 0)} VA${r.at ? ' · CB ' + r.at + ' A' : ''} · จากตารางโหลด` : itemSummary(Object.assign({ qty: 1 }, r)))}${r.est ? ` <span class="est" title="${esc(r.why || '')}">ประมาณจากพื้นที่</span>` : ''}${r.conf != null && r.conf < 0.6 ? ' <span class="est warn">ไม่แน่ใจ</span>' : ''}${r.flag ? ` <span class="est warn" title="${esc(r.flag)}">ตรวจสอบ</span>` : ''}</div></div>
          <input type="number" min="1" max="5000" value="${rowQty(r)}" data-imp-qty="${i}" title="จำนวน" aria-label="จำนวน">
          <div class="imp-dest"><select class="imp-fl" data-imp-floor="${i}" title="ชั้นที่จะลง" aria-label="ชั้น">${floorOpts(f)}</select>
          <input type="text" class="imp-pn" data-imp-panel="${i}" list="impPanels" maxlength="40" value="${esc((r.dest && r.dest.panel) || '')}" placeholder="${esc(pn ? 'แผง: ' + pn : 'แผง: อัตโนมัติ')}" title="ชื่อแผงที่จะลง (ว่าง = อัตโนมัติ, พิมพ์ชื่อใหม่ = สร้างแผงใหม่)" aria-label="แผง"></div>
          <button class="btn ghost sm danger" data-imp-del="${i}" title="ตัดออก" aria-label="ตัดออก">${I.close}</button></div>`; }).join('')}</div>`; }).join('')}
      <div class="imp-group" id="impPanelsPrev"></div>
      ${imp.warnings.length ? `<ul class="warns" style="margin-top:10px">${imp.warnings.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
    clearTimeout(imp.pt); imp.pt = setTimeout(renderImpPanels, 220);
    renderImpPanels(true);
  }
  // แผงที่จะสร้าง: ใช้ผลจาก buildLayout ทันที ส่วน kVA / เฟส A-B-C คำนวณจริงแบบหน่วงเวลา (รายการเยอะจะข้ามเพื่อไม่ให้หน้าค้าง)
  function renderImpPanels(quick) {
    const box = $('#impPanelsPrev'); if (!box || !imp) return;
    if (!imp.layout) { box.innerHTML = imp.layoutErr ? `<ul class="warns"><li>จัดวางไม่ได้: ${esc(imp.layoutErr)}</li></ul>` : ''; return; }
    const L = imp.layout, place = L.placement || [];
    if (!quick) {
      imp.stats = null;
      if (imp.rows.length <= 500) {
        try {
          const proj = JSON.parse(JSON.stringify({ version: 1, meta: project.meta, panels: L.panels, items: L.items }));
          if (imp.balance) proj.panels.forEach((p) => { if (p.kind === 'LP' && p.phases !== 1) p.balance = 'deep'; });
          const res = E.calculate(proj);
          imp.stats = Object.fromEntries(res.panels.map((p) => [p.board.id, p]));
          imp.calcWarn = res.warnings.length;
        } catch (e) { imp.stats = null; }
      }
    }
    const old = new Set(project.panels.map((p) => p.id));
    const cnt = {}; place.forEach((x) => { if (x) cnt[x.panelId] = (cnt[x.panelId] || 0) + 1; });
    const lps = L.panels.filter((p) => p.kind === 'LP');
    box.innerHTML = `<div class="label" style="margin:6px 0">แผงที่จะสร้าง / ใช้ ${lps.length ? `· ${lps.length} แผงย่อย` : ''}</div>
      ${lps.map((p) => { const st = imp.stats && imp.stats[p.id]; const isNew = imp.mode === 'replace' || !old.has(p.id);
        const pv = st ? st.phaseVA : null, mx = pv ? Math.max(...pv, 1) : 1;
        const bal = st && st.balance && imp.balance && st.balance.autoUnbalance != null && Math.abs(st.balance.autoUnbalance - st.unbalance) >= 0.05 ? ` <span class="muted">(${fmt(st.balance.autoUnbalance, 1)}% → ${fmt(st.unbalance, 1)}%)</span>` : '';
        return `<div class="imp-panel"><div class="imp-panel-h"><b>${esc(p.name)}</b><span class="tag ${isNew ? 'sdb' : ''}">${isNew ? 'ใหม่' : 'เดิม'}</span><span class="muted tiny">${esc(p.location || '')} · ${cnt[p.id] || 0} แถว${st ? ` · ${st.layout ? st.layout.ways : '-'} ช่อง · ${fmt(st.connected / 1000, 1)} kVA` : ''}</span></div>
          ${st && p.phases !== 1 ? `<div class="pmini">${['A', 'B', 'C'].map((k, i) => `<i style="width:${(pv[i] / mx * 100).toFixed(0)}%;background:var(--ph${k})" title="เฟส ${k}: ${fmt(Math.round(pv[i]), 0)} VA"></i>`).join('')}<span class="tiny unb ${unbClass(st.unbalance)}">${fmt(st.unbalance, 1)}%${bal}</span></div>` : ''}</div>`; }).join('')}
      <ul class="imp-log">${L.log.map((l) => `<li>${esc(l)}</li>`).join('')}${(L.warnings || []).map((w) => `<li class="w">${esc(w)}</li>`).join('')}</ul>`;
  }
  function impProgress(msg, p) {
    imp.busy = { msg, p };
    const pr = $('.imp-progress'); if (!pr) return;
    pr.classList.add('on'); $('i', pr).style.width = Math.round(p * 100) + '%'; $('span', pr).textContent = msg;
  }
  function impDone() { imp.busy = null; imp.working = false; const pr = $('.imp-progress'); if (pr) setTimeout(() => { if (!imp.busy) pr.classList.remove('on'); }, 600); }

  function reparse() {
    let r;
    try { r = window.Importer.parseText(imp.text); } catch (e) { r = { rows: [], warnings: ['อ่านข้อความไม่ได้: ' + (e.message || e)], info: null }; }
    imp.parsed = r.rows; imp.warnings = r.warnings; imp.info = r.info || null; imp.source = 'text';
    rebuildRows(); renderImpRows();
  }

  // อ่านไฟล์ (หลายไฟล์ได้ในโหมดออฟไลน์) — กันอ่านซ้อน: ระหว่างอ่านอยู่จะไม่รับไฟล์ใหม่
  async function impHandleFiles(list) {
    const files = [...(list || [])].filter(Boolean);
    if (!files.length || !imp) return;
    if (imp.working) { toast('กำลังอ่านไฟล์อื่นอยู่ — รอสักครู่'); return; }
    imp.working = true;
    imp.fileName = files.map((f) => f.name).join(', ');
    const d = $('#drop'); if (d) d.classList.add('got');
    try {
      const texts = []; let scanned = 0, lowQ = false;
      for (let n = 0; n < files.length; n++) {
        const r = await window.Reader.readFile(files[n], (m, p) => impProgress(files.length > 1 ? `(${n + 1}/${files.length}) ${m}` : m, (n + p) / files.length));
        texts.push((r.kind === 'text' ? r.text : window.Importer.ocrFix(r.text) || '').trim());
        scanned += r.scanned || 0;
        if ((r.kind === 'image' && r.conf < 70) || (r.scanned && r.conf != null && r.conf < 70)) lowQ = true;
      }
      imp.text = texts.filter(Boolean).join('\n\n' + window.Importer.FILE_BREAK_LINE + '\n\n');   // เส้นแบ่งไฟล์: ชั้น/ห้อง/ตารางไม่ไหลข้ามไฟล์
      const ta = $('#impText'); if (ta) ta.value = imp.text;
      reparse();
      impProgress(`อ่านได้ ${imp.rows.length} รายการ${scanned ? ` (OCR ${scanned} หน้า)` : ''}`, 1);
      if (lowQ || !imp.rows.length) {
        imp.warnings.unshift(lowQ
          ? 'OCR อ่านภาพนี้ได้ไม่ชัด — ภาพความละเอียดต่ำหรือตัวอักษรเล็ก ลองสแกน/ถ่ายให้ใหญ่และคมกว่านี้ (≥ 300 dpi) แล้วตรวจข้อความด้านซ้ายก่อนจัดวาง'
          : 'อ่านข้อความได้แต่ไม่พบรายการโหลด — แก้ข้อความด้านซ้ายเอง (เช่น "ห้องประชุม: โคม LED 12 ชุด, เต้ารับ 8 จุด") หรือกด "ใส่ตัวอย่าง" ดูรูปแบบ');
        toast(lowQ ? 'OCR อ่านได้ไม่ชัด — ตรวจข้อความก่อนจัดวาง' : 'ไม่พบรายการโหลดในข้อความ');
      }
      renderImpRows();
    } catch (e) {
      toast('อ่านไฟล์ไม่สำเร็จ: ' + (e.message || e));
      impProgress('ไม่สำเร็จ: ' + (e.message || e), 0);
    } finally { impDone(); }
  }
  /* ---- นำเข้าจริง: ถามก่อนถ้าจะทับโครงการเดิม + เลิกทำได้ ---- */
  function impApply() {
    if (!imp || !imp.rows.length) return;
    imp.floorHeight = Math.min(10, Math.max(2, Number(($('#impH') || {}).value) || 3.6));
    let L;
    try { L = window.Importer.buildLayout(imp.rows, project, { mode: imp.mode, floorHeight: imp.floorHeight }); }
    catch (e) { toast('จัดวางไม่ได้: ' + (e.message || e)); return; }
    const prevIds = new Set(project.panels.map((p) => p.id));
    const info = imp.info, mode = imp.mode, balance = imp.balance;
    const go = () => {
      snapVersion('ก่อนนำเข้าแบบ', true);            // เก็บสถานะก่อนนำเข้าเป็นเวอร์ชัน (ย้อนกลับได้แม้พ้นเวลาเลิกทำ)
      const snap = JSON.stringify(project);
      const meta = Object.assign({}, project.meta);
      if (mode === 'replace' && info && info.project) meta.name = String(info.project).slice(0, 100);
      let cleaned;
      try { cleaned = SAN.project({ version: 1, meta, panels: L.panels, items: L.items }); } catch (e) { toast('นำเข้าไม่ได้: ' + e.message); return; }
      const p2 = cleaned.project;
      if (balance) p2.panels.forEach((p) => { if (p.kind === 'LP' && p.phases !== 1 && (mode === 'replace' || !prevIds.has(p.id))) p.balance = 'deep'; });
      project = p2;
      imp.applied = true;
      logEvent('import', `นำเข้าแบบ (${mode === 'replace' ? 'แทนที่' : 'เพิ่มเข้า'}) → ${p2.panels.length} แผง · ${p2.items.length} รายการ${imp.fileName ? ' จาก ' + imp.fileName : ''}`);
      selected = firstSelectable(project);
      tab = 'design';
      closeImporter();
      $('#projName').value = project.meta.name;
      recalc(true);
      toastUndo(`นำเข้าแล้ว ${project.panels.length} แผง · ${project.items.length} รายการ${balance ? ' · จัดสมดุลเฟสแล้ว' : ''}`, () => {
        project = JSON.parse(snap); selected = firstSelectable(project); shell(); recalc(true);
      });
    };
    if (mode === 'replace' && project.items.length) {
      askConfirm({ title: 'แทนที่โครงการเดิมทั้งหมด?', body: `แผง ${project.panels.length} แผง และอุปกรณ์ ${project.items.length} รายการเดิมจะถูกแทนที่ด้วยผลนำเข้า (กด "เลิกทำ" ได้หลังนำเข้า)\nต้องการเก็บของเดิมไว้ ให้เลือก "เพิ่มเข้าโครงการเดิม"`, ok: 'แทนที่', danger: true }).then((y) => { if (y) go(); });
    } else go();
  }

  /* ---- ตัวจัดการเหตุการณ์ของหน้านำเข้า ---- */
  const impRow = (el) => imp.rows[Number(el.dataset.impSel != null ? el.dataset.impSel : el.dataset.impFloor != null ? el.dataset.impFloor : el.dataset.impPanel != null ? el.dataset.impPanel : el.dataset.impQty != null ? el.dataset.impQty : el.dataset.impDel)];
  document.addEventListener('click', (e) => {
    if (!imp) return;
    const t = e.target.closest('[data-imp-mode],[data-imp-del],[data-imp-bulk]');
    if (!t) return;
    if (t.dataset.impMode) { imp.mode = t.dataset.impMode; $$('[data-imp-mode]').forEach((b) => b.classList.toggle('on', b === t)); renderImpRows(); return; }
    if (t.dataset.impDel != null) { const r = impRow(t); if (r) { overOf(r.key).del = true; rebuildRows(); renderImpRows(); } return; }
    if (t.dataset.impBulk === 'clear') { imp.sel.clear(); renderImpRows(); return; }
    if (t.dataset.impBulk === 'apply') {
      const f = $('#impBulkFloor').value, pn = $('#impBulkPanel').value.trim().slice(0, 40);
      imp.sel.forEach((k) => {
        const row = imp.rows.find((r) => r.key === k); if (!row) return;
        const o = overOf(k); o.dest = Object.assign({}, o.dest);
        o.dest.floor = f === 'C' ? 'C' : Number(f);
        if (String(o.dest.floor) === String(defFloor(row))) delete o.dest.floor;
        if (pn) o.dest.panel = pn; else delete o.dest.panel;
      });
      const n = imp.sel.size; imp.sel.clear(); rebuildRows(); renderImpRows(); toast(`ย้าย ${n} รายการแล้ว`);
    }
  });
  document.addEventListener('change', (e) => {
    if (!imp) return;
    const el = e.target;
    if (el.id === 'impFile') { impHandleFiles(el.files); el.value = ''; return; }
    if (el.id === 'impBalance') { imp.balance = el.checked; renderImpRows(); return; }
    if (el.dataset.impSel != null) { const r = impRow(el); if (r) { if (el.checked) imp.sel.add(r.key); else imp.sel.delete(r.key); renderImpRows(); } return; }
    if (el.dataset.impGsel != null) {
      const f = el.dataset.impGsel === 'C' ? 'C' : Number(el.dataset.impGsel);
      imp.rows.forEach((r) => { if (effFloor(r) === f) { if (el.checked) imp.sel.add(r.key); else imp.sel.delete(r.key); } });
      renderImpRows(); return;
    }
    if (el.dataset.impFloor != null) {
      const r = impRow(el); if (!r) return;
      const o = overOf(r.key); o.dest = Object.assign({}, o.dest);
      const v = el.value === 'C' ? 'C' : Number(el.value);
      if (String(v) === String(defFloor(r))) delete o.dest.floor; else o.dest.floor = v;
      rebuildRows(); renderImpRows(); return;
    }
    if (el.dataset.impPanel != null) {
      const r = impRow(el); if (!r) return;
      const o = overOf(r.key); o.dest = Object.assign({}, o.dest);
      const v = el.value.trim().slice(0, 40);
      if (v) o.dest.panel = v; else delete o.dest.panel;
      rebuildRows(); renderImpRows();
    }
  });
  document.addEventListener('input', (e) => {
    if (!imp) return;
    const el = e.target;
    if (el.id === 'impText') { imp.text = el.value; clearTimeout(imp.t); imp.t = setTimeout(reparse, 300); return; }
    if (el.id === 'impH') { imp.floorHeight = Math.min(10, Math.max(2, Number(el.value) || 3.6)); clearTimeout(imp.pt); imp.pt = setTimeout(() => { layoutNow(); renderImpPanels(); }, 250); return; }
    if (el.dataset && el.dataset.impQty != null) {
      const r = impRow(el); if (!r) return;
      const v = Math.min(5000, Math.max(1, Math.round(Number(el.value)) || 1));
      overOf(r.key).qty = v; setRowQty(r, v);
      clearTimeout(imp.pt); imp.pt = setTimeout(() => { layoutNow(); renderImpPanels(); }, 250);
    }
  });
  // วางไฟล์ที่ไหนในหน้าก็ได้: ไม่ให้เบราว์เซอร์เปิดไฟล์ทิ้งหน้าไป — .json = เปิดโครงการ, อื่น ๆ = เปิดหน้านำเข้าแล้วอ่านให้
  const hasFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const d = $('#drop'); if (d) d.classList.toggle('over', !!(e.target.closest && e.target.closest('#drop'))); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { document.body.classList.remove('dragging'); const d = $('#drop'); if (d) d.classList.remove('over'); } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const d = $('#drop'); if (d) d.classList.remove('over');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (!importerOpen() && files.length === 1 && /\.json$/i.test(files[0].name)) { openFile(files[0]); return; }
    if (!importerOpen()) openImporter();
    impHandleFiles(files);
  });
  window.addEventListener('paste', (e) => {
    const fs = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!fs.length) return;
    if (!importerOpen()) openImporter();     // วางรูป/ไฟล์ตอนปิดตัวนำเข้าอยู่: เปิดให้ก่อนแล้วอ่านต่อ (เหมือนลากวาง)
    if (!imp) return;
    e.preventDefault(); impHandleFiles(fs);
  });


  /* ================= start ================= */
  // เติมค่าเริ่มต้นที่อาจขาดในไฟล์รุ่นเก่า
  project.meta = Object.assign(E.defaultMeta(), project.meta || {});
  ['branch', 'feeder', 'main', 'hv'].forEach((k) => { project.meta[k] = Object.assign({}, E.defaultMeta()[k], project.meta[k] || {}); });
  shell();
  // เบรกเกอร์ตามยี่ห้อ: tooltip/popover/การ์ดตั้งค่า (brandui.js) — แก้ค่าแล้วคำนวณใหม่ + Log + เลิกทำ แบบเดียวกับการแก้ไขอื่น
  if (window.BrandUI) BrandUI.init({ project: () => project, result: () => result, recalc, logEvent, toast, toastUndo, esc, fmt });
  // เวอร์ชันสาธิต: จุดเชื่อมให้ demo-ui.js (โหลดตัวอย่าง/แชร์ลิงก์) — เปิดเผยเฉพาะที่จำเป็น (ผ่าน SAN.project เสมอ)
  if (DEMO()) window.DemoHooks = { apply: (raw) => applyProject(SAN.project(raw).project), current: () => JSON.parse(JSON.stringify(project)), toast };
  recalc(true);
  diskSync();
})();
