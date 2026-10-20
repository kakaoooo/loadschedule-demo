/*
 * เทียบโครงการ 2 ฉบับ (เวอร์ชันเก่า ↔ ปัจจุบัน, แปลน A ↔ แปลน B) — ฟังก์ชันล้วน ไม่แตะ DOM
 * diffProjects(a, b) -> { meta: [{k, a, b}], panels: {added, removed, changed}, items: {added, removed, changed}, count, same }
 *   panels/items จับคู่ด้วย id ; changed[i] = { id, label, fields: [{k, a, b}] }
 */
(function (root) {
  'use strict';
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const same = (x, y) => JSON.stringify(x === undefined ? null : x) === JSON.stringify(y === undefined ? null : y);

  // meta ซ้อนกันหลายชั้น (branch.cable ...) → คีย์แบบมีจุด
  function flat(o, pre, out) {
    out = out || {};
    if (!isObj(o)) return out;
    for (const k of Object.keys(o)) {
      const key = pre ? pre + '.' + k : k;
      if (isObj(o[k])) flat(o[k], key, out); else out[key] = o[k];
    }
    return out;
  }
  function fieldDiff(a, b, skip) {
    a = a || {}; b = b || {};
    const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter((k) => !skip.includes(k)).sort();
    return keys.filter((k) => !same(a[k], b[k])).map((k) => ({ k, a: a[k], b: b[k] }));
  }
  const listOf = (p, key) => (isObj(p) && Array.isArray(p[key]) ? p[key].filter(isObj) : []);
  function byId(list) { const m = new Map(); list.forEach((x) => { if (x.id != null && !m.has(String(x.id))) m.set(String(x.id), x); }); return m; }

  function diffList(la, lb, labelA, labelB, skip) {
    const A = byId(la), B = byId(lb);
    const added = [], removed = [], changed = [];
    B.forEach((x, id) => { if (!A.has(id)) added.push({ id, label: labelB(x), x }); });
    A.forEach((x, id) => {
      if (!B.has(id)) { removed.push({ id, label: labelA(x), x }); return; }
      const fields = fieldDiff(x, B.get(id), skip);
      if (fields.length) changed.push({ id, label: labelB(B.get(id)), fields });
    });
    return { added, removed, changed };
  }

  function diffProjects(a, b) {
    const panelName = (p, id) => { const x = listOf(p, 'panels').find((q) => String(q.id) === String(id)); return x ? String(x.name || x.id) : String(id == null ? '-' : id); };
    const panelLabel = (x) => String(x.name || x.id);
    const itemLabel = (p) => (x) => `${x.name ? String(x.name) : String(x.type || 'รายการ')} · ${panelName(p, x.panelId)}`;
    const meta = fieldDiff(flat(isObj(a) ? a.meta : null), flat(isObj(b) ? b.meta : null), []);
    const panels = diffList(listOf(a, 'panels'), listOf(b, 'panels'), panelLabel, panelLabel, ['id']);
    const items = diffList(listOf(a, 'items'), listOf(b, 'items'), itemLabel(a), itemLabel(b), ['id']);
    const count = meta.length + panels.added.length + panels.removed.length + panels.changed.length + items.added.length + items.removed.length + items.changed.length;
    return { meta, panels, items, count, same: count === 0 };
  }

  const API = { diffProjects, flat };
  root.PlanDiff = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
