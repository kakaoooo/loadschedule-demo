// กฎการวางช่องของตารางโหลด — ส่วนแรกแบบ seq (ระบุ phasePattern: 'seq' ชัดเจน) · ส่วน PR* คือค่าเริ่มต้นใหม่ pair (1-3-5 / 2-4-6 เฟส A-B-C): R0 3P = 3 เลขติดกัน (consecutive, ค่าเริ่มต้น) หรือคอลัมน์เดียวกัน (column) · R1 โหลดจริงมาก่อน · R2 SPARE อยู่ท้าย/ช่องแทรกใช้เลขสูงสุดก่อน
// รัน: node tests/layout-rules.test.js
const fs = require('fs');
const path = require('path');
const { test, assert, eq, done } = require('./helpers/eng-harness.js');
const E = require('../public/js/engine.js');

const proj = (items, extra, meta) => ({ version: 1, meta: Object.assign(E.defaultMeta(), { phasePattern: 'seq' }, meta || {}), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, Object.assign({ id: 'LP', name: 'LP', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 20 }, extra || {})], items: items.map((it, i) => Object.assign({ id: 'i' + i, panelId: 'LP', length: 20 }, it)) });
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

/* ---------- ค่าเริ่มต้น pair: 1-3-5 / 2-4-6 ครึ่งบนคี่ ครึ่งล่างคู่ เฟส A-B-C ---------- */
const projP = (items, extra) => ({ version: 1, meta: E.defaultMeta(), panels: [{ id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null }, Object.assign({ id: 'LP', name: 'LP', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 20 }, extra || {})], items: items.map((it, i) => Object.assign({ id: 'i' + i, panelId: 'LP', length: 20 }, it)) });
const calcP = (p) => E.calculate(p).panels.find((x) => x.id === 'LP');
const PH = 'ABC';

test('PR1 ค่าเริ่มต้นของโครงการใหม่ = pair และโครงการที่ไม่ระบุก็เป็น pair', () => {
  eq(E.defaultMeta().phasePattern, 'pair');
  const p = projP([{ type: 'lift', preset: 20, qty: 1 }]); delete p.meta.phasePattern;
  eq(calcP(p).layout.pattern, 'pair');
});

test('PR2 ลิฟต์ 3 ตัว: 1-3-5 / 2-4-6 / 8-10-12 (ตัวที่ 3 เริ่มแถวที่ 4 ฝั่งคู่) และแต่ละตัวเฟส A-B-C เรียงลงมา', () => {
  const po = calcP(projP([{ type: 'lift', preset: 20, qty: 3 }], { ways: 12 }));
  const c3 = po.circuits.filter((c) => c.phases === 3).map((c) => c.slotNos).sort((a, b) => a[0] - b[0]);
  eq(c3, [[1, 3, 5], [2, 4, 6], [8, 10, 12]]);
  c3.forEach((n) => eq(n.map((x) => PH[po.layout.slotPhase[x - 1]]).join(''), 'ABC', 'เฟสของ ' + n));
});

test('PR3 ทุกวงจร 3 เฟส (สุ่ม 150 โครงการ): คอลัมน์เดียวกัน ห่างกัน 2 และเฟสเรียง A,B,C ตามลำดับช่อง', () => {
  let seed = 7771; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let n3 = 0;
  for (let n = 0; n < 150; n++) {
    const items = [{ type: 'lift', preset: 20, qty: 1 + Math.floor(rnd() * 4) }, { type: 'motor', kw: 7.5, phases: 3, qty: Math.floor(rnd() * 3) }, { type: 'light', fixtures: 3 + Math.floor(rnd() * 20), perFixture: 2, lamp: 'led-t8-18', qty: 1 + Math.floor(rnd() * 3) }, { type: 'rec', points: 2 + Math.floor(rnd() * 12), qty: 1 + Math.floor(rnd() * 3) }].filter((i) => i.qty > 0);
    let po; try { po = calcP(projP(items, rnd() < 0.5 ? { ways: [12, 18, 24][Math.floor(rnd() * 3)] } : {})); } catch (e) { continue; }
    if (!po.layout.slots.length) continue;
    po.circuits.filter((c) => c.phases === 3).forEach((c) => {
      const s = c.slotNos; n3++;
      assert(s[1] - s[0] === 2 && s[2] - s[1] === 2, 'ช่อง ' + s);
      eq(s.map((x) => PH[po.layout.slotPhase[x - 1]]).join(''), 'ABC', 'โครงการ ' + n + ' ช่อง ' + s);
    });
  }
  assert(n3 > 50, 'วงจร 3 เฟสน้อยเกินไป: ' + n3);
  return n3 + ' วงจร';
});

test('PR4 ตารางโหลดบนหน้าจอ: ครึ่งบนเป็นเลขคี่ (1,3,5,…) ครึ่งล่างเป็นเลขคู่ (2,4,6,…) ในโค้ดแสดงผล', () => {
  const x = fs.readFileSync(path.join(__dirname, '..', 'public/js/export.js'), 'utf8');
  assert(x.includes("L.pattern === 'pair'") && x.includes('r.no % 2 === 1') && x.includes('odd.concat(even)'), 'ขาดการเรียงครึ่งบน/ล่าง');
  assert(x.includes('half-top'), 'เส้นคั่นครึ่ง');
});

test('PR5 pair: SPARE ต่อท้ายโหลดจริงของแต่ละคอลัมน์ติดกัน (ไม่มี SPACE คั่นระหว่างโหลดจริงกับ SPARE) สุ่ม 150 โครงการ', () => {
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let checked = 0;
  for (let n = 0; n < 150; n++) {
    const items = [{ type: 'light', fixtures: 3 + Math.floor(rnd() * 25), perFixture: 2, lamp: 'led-t8-18', qty: 1 + Math.floor(rnd() * 3) }, { type: 'rec', points: 2 + Math.floor(rnd() * 12), qty: 1 + Math.floor(rnd() * 4) }, { type: 'lift', preset: 20, qty: Math.floor(rnd() * 3) }].filter((i) => i.qty > 0);
    let po; try { po = calcP(projP(items, rnd() < 0.5 ? { ways: [18, 24, 30][Math.floor(rnd() * 3)] } : {})); } catch (e) { continue; }
    const sl = po.layout.slots; if (!sl.length) continue;
    [0, 1].forEach((side) => {
      const col = sl.filter((_, i) => i % 2 === side).map(kind);
      const lastLive = Math.max(col.lastIndexOf('live'), col.lastIndexOf('cont'));
      const firstSpare = col.indexOf('SPARE');
      if (firstSpare >= 0 && lastLive >= 0 && firstSpare > lastLive) assert(firstSpare === lastLive + 1, `คอลัมน์ ${side ? 'คู่' : 'คี่'} โครงการ ${n}: ${col.join('')}`);
      // หลัง SPARE ตัวแรกต้องเป็น SPARE ต่อกันก่อนถึง SPACE
      if (firstSpare >= 0) { const after = col.slice(firstSpare); const gap = after.indexOf('SPACE'); if (gap >= 0) assert(!after.slice(gap).includes('SPARE'), `มี SPACE คั่น SPARE คอลัมน์ ${side ? 'คู่' : 'คี่'} โครงการ ${n}: ${col.join('')}`); }
    });
    checked++;
  }
  assert(checked > 80, 'ตรวจน้อยเกินไป ' + checked);
  return 'ตรวจ ' + checked + ' โครงการ';
});
done();
