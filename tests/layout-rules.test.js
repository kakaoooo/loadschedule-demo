// กฎการวางช่องของตารางโหลด (แผง 3 เฟส แบบ seq): R0 3P = 3 เลขติดกัน (consecutive, ค่าเริ่มต้น) หรือคอลัมน์เดียวกัน (column) · R1 โหลดจริงมาก่อน · R2 SPARE อยู่ท้าย/ช่องแทรกใช้เลขสูงสุดก่อน
// รัน: node tests/layout-rules.test.js
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const E = require('../public/js/engine.js');

const proj = (items, extra, meta) => ({ version: 1, meta: Object.assign(E.defaultMeta(), meta || {}), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, Object.assign({ id: 'LP', name: 'LP', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 20 }, extra || {})], items: items.map((it, i) => Object.assign({ id: 'i' + i, panelId: 'LP', length: 20 }, it)) });
const slotsOf = (p) => E.calculate(p).panels.find((x) => x.id === 'LP').layout.slots;
const kind = (s) => (!s ? 'SPACE' : s.ref ? 'cont' : (s.cat === 'spare' || s.auto) ? 'SPARE' : 'live');

const COL = { threePole: 'column' };

test('LR1 (consecutive, ค่าเริ่มต้น) ลิฟต์ 3 ตัว 12 ช่อง: 1-2-3 / 4-5-6 / 7-8-9 เฟส A-B-C ทุกตัว · SPARE 10,11 ต่อท้าย (12 = SPACE ท้ายสุด ไม่มีช่องว่างคั่นกลาง)', () => {
  const r = E.calculate(proj([{ type: 'lift', preset: 20, qty: 3, name: 'ลิฟต์' }], { ways: 12 }));
  const po = r.panels.find((x) => x.id === 'LP');
  eq(po.layout.slots.map(kind), ['live', 'cont', 'cont', 'live', 'cont', 'cont', 'live', 'cont', 'cont', 'SPARE', 'SPARE', 'SPACE']);
  eq(po.circuits.filter((c) => c.phases === 3).map((c) => c.slotNos), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  po.circuits.filter((c) => c.phases === 3).forEach((c) => eq(c.slotNos.map((n) => po.layout.slotPhase[n - 1]), [0, 1, 2]));
});

test('LR1b (column) ตัวอย่างเดิม: ลิฟต์ 1,3,5 / 2,4,6 / 7,9,11 · SPARE ช่อง 10 และ 12 · ช่อง 8 เป็น SPACE', () => {
  const s = slotsOf(proj([{ type: 'lift', preset: 20, qty: 3, name: 'ลิฟต์' }], { ways: 12 }, COL));
  eq(s.map(kind), ['live', 'live', 'cont', 'cont', 'cont', 'cont', 'live', 'SPACE', 'cont', 'SPARE', 'cont', 'SPARE']);
});

test('LR2 R0: consecutive = i,i+1,i+2 เริ่มที่เลขหาร 3 ลงตัวเสมอ · column = i,i+2,i+4', () => {
  const circs = (meta) => E.calculate(proj([{ type: 'lift', preset: 20, qty: 3 }, { type: 'light', fixtures: 5, perFixture: 2, lamp: 'led-t8-18', qty: 1 }], { ways: 18 }, meta)).panels.find((x) => x.id === 'LP').circuits.filter((c) => c.phases === 3);
  circs({}).forEach((c) => { eq(c.slotNos.map((n, k) => n - c.slotNos[0] - k), [0, 0, 0]); eq((c.slotNos[0] - 1) % 3, 0); });
  circs(COL).forEach((c) => eq(c.slotNos.map((n, k) => n - c.slotNos[0] - 2 * k), [0, 0, 0]));
});

test('LR3 R2 (SPARE จาก item) column: ช่องแทรกในกลุ่ม 3P ใช้เลขสูงสุดก่อน · consecutive: SPARE ต่อท้ายตรง ๆ', () => {
  const its = [{ type: 'lift', preset: 20, qty: 3 }, { type: 'spare', qty: 2, cb: 16 }];
  eq(slotsOf(proj(its, { ways: 12, spareCount: 0 }, COL)).map(kind), ['live', 'live', 'cont', 'cont', 'cont', 'cont', 'live', 'SPACE', 'cont', 'SPARE', 'cont', 'SPARE']);
  eq(slotsOf(proj(its, { ways: 12, spareCount: 0 })).map(kind), ['live', 'cont', 'cont', 'live', 'cont', 'cont', 'live', 'cont', 'cont', 'SPARE', 'SPARE', 'SPACE']);
});

test('LR4 R2: ถ้าท้ายแผงมีที่ SPARE ต่อท้ายโหลดจริงเลย (ไม่ข้ามไปแทรกกลาง)', () => {
  const s = slotsOf(proj([{ type: 'light', fixtures: 6, perFixture: 2, lamp: 'led-t8-18', qty: 1, name: 'ไฟ' }, { type: 'rec', points: 6, qty: 1, name: 'ปลั๊ก' }], { ways: 24 }));
  const k = s.map(kind), lastLive = k.lastIndexOf('live'), firstSpare = k.indexOf('SPARE');
  assert(firstSpare === lastLive + 1 || firstSpare > lastLive, 'SPARE ต้องอยู่หลังโหลดจริง: ' + k.join());
});

// property: สุ่มโครงการ 200 แบบ (ผลคงที่จาก seed) — ตรวจ R1 และ R2 ทุกแผงที่วางได้
for (const [label, meta] of [['consecutive', {}], ['column', COL]]) test('LR5 (' + label + ') สุ่ม 200 โครงการ: SPARE ทุกช่องอยู่เลขสูงกว่าโหลด 1P ทุกช่อง (R1) และช่องแทรกในแถบโหลดจริง SPARE ถูกใช้ที่เลขสูงสุดก่อน (R2)', () => {
  let seed = 20260101; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let checked = 0;
  for (let n = 0; n < 200; n++) {
    const items = [];
    const m = 1 + Math.floor(rnd() * 6);
    for (let j = 0; j < m; j++) {
      const t = pick(['light', 'rec', 'lift', 'motor', 'spare']);
      if (t === 'light') items.push({ type: 'light', fixtures: 1 + Math.floor(rnd() * 30), perFixture: 2, lamp: 'led-t8-18', qty: 1 + Math.floor(rnd() * 3) });
      else if (t === 'rec') items.push({ type: 'rec', points: 1 + Math.floor(rnd() * 20), qty: 1 + Math.floor(rnd() * 3) });
      else if (t === 'lift') items.push({ type: 'lift', preset: 20, qty: 1 + Math.floor(rnd() * 3) });
      else if (t === 'motor') items.push({ type: 'motor', kw: 7.5, phases: 3, qty: 1 + Math.floor(rnd() * 2) });
      else items.push({ type: 'spare', qty: 1 + Math.floor(rnd() * 2), cb: 16 });
    }
    let s;
    try { s = slotsOf(proj(items, rnd() < 0.5 ? { ways: pick([12, 18, 24]) } : {}, meta)); } catch (e) { continue; }
    if (!s || !s.length) continue;
    const k = s.map(kind);
    let liveTop = -1; k.forEach((x, i) => { if (x === 'live' || x === 'cont') liveTop = i; });
    const live1Max = Math.max(-1, ...s.map((x, i) => (x && !x.ref && x.cat !== 'spare' && !x.auto && x.phases !== 3 ? i : -1)));
    k.forEach((x, i) => { if (x === 'SPARE') assert(i > live1Max, `R1: SPARE ที่ช่อง ${i + 1} อยู่ก่อนโหลด 1P ช่อง ${live1Max + 1} (โครงการ ${n})`); });
    for (let i = 0; i < liveTop; i++) if (k[i] === 'SPARE') for (let e = i + 1; e < liveTop; e++) assert(k[e] !== 'SPACE', `R2: SPARE ช่อง ${i + 1} แต่มี SPACE ช่อง ${e + 1} เลขสูงกว่าในแถบโหลดจริง (โครงการ ${n}): ${k.join()}`);
    checked++;
  }
  assert(checked > 100, 'ตรวจได้น้อยเกินไป: ' + checked);
  return 'ตรวจ ' + checked + ' โครงการ';
});
done();
