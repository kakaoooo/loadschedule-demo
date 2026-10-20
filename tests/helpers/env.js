// โหลดโมดูลของแอปเข้า global แบบเดียวกับ tests/test.js + ตัวช่วยสร้างข้อมูลทดสอบ
const path = require('path');
const fs = require('fs');
global.self = global;
const ROOT = path.join(__dirname, '..', '..');
const D = require(path.join(ROOT, 'public/js/data.js'));
global.LS_DATA = D;
const E = require(path.join(ROOT, 'public/js/engine.js'));
global.LoadEngine = E;
const I = require(path.join(ROOT, 'public/js/importer.js'));
require(path.join(ROOT, 'public/js/sample.js'));   // global.SAMPLE_PROJECT

let Reader = null, readerError = null;
try { Reader = require(path.join(ROOT, 'public/js/reader.js')); } catch (e) { readerError = e.message; }

const clone = (o) => JSON.parse(JSON.stringify(o));
const P = (t) => I.parseText(t);
const R = (t) => I.parseText(t).rows;
const first = (t) => R(t)[0] || {};
const meta = () => E.defaultMeta();
const proj0 = () => ({ meta: meta(), panels: [], items: [] });
const sampleProject = () => global.SAMPLE_PROJECT();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// VA ของรายการ/แถว คำนวณด้วย engine (ไม่ขึ้นกับการจัดวาง)
function vaOfItems(items, m) { let s = 0; items.forEach((it) => E.expandItem(it, m).forEach((c) => { s += c.va; })); return s; }
// VA ของแถวทั้งหมด — แบ่งจำนวนเป็นชิ้นเล็กก่อนถาม engine (engine ตัดจำนวนต่อรายการที่ 2,000) จึงไม่ขึ้นกับเพดานของ engine
function vaOfRows(rows, m) {
  let s = 0;
  rows.forEach((r) => {
    const f = r.type === 'light' ? 'fixtures' : r.type === 'rec' ? 'points' : 'qty';
    const Q = Math.max(1, Math.round(Number(r[f]) || 1)), chunk = r.type === 'light' ? 2000 : 200;
    for (let done = 0; done < Q; done += chunk) s += vaOfItems([I.rowToItem(Object.assign({}, r, { [f]: Math.min(chunk, Q - done) }), 'x')], m);
  });
  return s;
}

// ตรวจผลลัพธ์ของ buildLayout ตามสัญญา (ไม่ซ้ำ/ไม่กำพร้า/ไม่ NaN/VA รวมตรง)
function auditLayout(rows, project, opt, existing) {
  const L = I.buildLayout(rows, project, opt || {});
  const m = Object.assign(meta(), project.meta || {});
  const res = E.calculate({ meta: m, panels: L.panels, items: L.items });
  const dup = (a) => a.length - new Set(a).size;
  const pids = L.panels.map((p) => p.id);
  const idsAll = L.items.map((i) => i.id);
  const orphanItems = L.items.filter((it) => !L.panels.some((p) => p.id === it.panelId));
  const unlinked = L.panels.filter((p) => p.parent && !L.panels.some((q) => q.id === p.parent));
  const mdbIds = L.panels.filter((p) => p.kind === 'MDB').map((p) => p.id);
  const hasChild = (p) => L.panels.some((q) => q.parent === p.id);
  const hasItem = (p) => L.items.some((it) => it.panelId === p.id);
  const keep = existing || { panels: new Set(), items: new Set() };
  const emptyNew = L.panels.filter((p) => !keep.panels.has(p.id) && p.kind !== 'MDB' && !hasChild(p) && !hasItem(p));
  let nan = 0;
  res.panels.forEach((p) => p.circuits.forEach((c) => { if (!isFinite(c.va) || (c.cb && !isFinite(c.cb.at))) nan++; }));
  const expectVA = vaOfRows(rows, m) + (opt && opt.mode === 'append' ? vaOfItems(project.items || [], m) : 0);
  return {
    L, res, expectVA, gotVA: res.totals.connected,
    dupItemIds: dup(idsAll), dupPanelIds: dup(pids), dupPanelNames: dup(L.panels.map((p) => p.name)),
    orphanItems: orphanItems.length, unlinked: unlinked.length, emptyNew: emptyNew.map((p) => p.name), nan,
    rootCount: mdbIds.length
  };
}
const slotsIn = (L, panelId, m) => L.items.filter((i) => i.panelId === panelId).reduce((s, i) => s + E.expandItem(i, m || meta()).reduce((a, c) => a + (c.phases === 3 ? 3 : 1), 0), 0);

// ตัวสุ่มแบบกำหนด seed ได้ (ผลซ้ำได้)
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

module.exports = { ROOT, D, E, I, Reader, readerError, clone, P, R, first, meta, proj0, sampleProject, read, vaOfItems, vaOfRows, auditLayout, slotsIn, rng };
