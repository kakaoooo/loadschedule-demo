'use strict';
// ทดสอบ API ห้องสมุดแปลน + บันทึกกิจกรรมที่เขียนลง projects/library/ — ใช้โฟลเดอร์ชั่วคราว ไม่แตะ projects/ จริง
// รัน: node tests/library.test.js
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../server.js');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); return; }
  fail++;
  console.log(`FAIL  ${name}${detail === undefined ? '' : '  → ' + JSON.stringify(detail).slice(0, 220)}`);
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-lib-'));
const ROOT = path.join(SANDBOX, 'public');
fs.mkdirSync(ROOT);
fs.writeFileSync(path.join(ROOT, 'index.html'), '<meta name="ls-token" content="__LS_TOKEN__">');
const TOKEN = 'cd34'.repeat(12);

async function start(projectsDir) {
  const server = S.createServer({ root: ROOT, token: TOKEN, projectsDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port, dir: projectsDir };
}
const stop = (h) => new Promise((r) => { h.server.closeAllConnections(); h.server.close(() => r()); });

function req(h, method, p, body, o = {}) {
  return new Promise((resolve) => {
    const headers = { 'x-ls-token': o.token === undefined ? TOKEN : o.token, Host: `127.0.0.1:${h.port}` };
    let buf;
    if (body !== undefined) { buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'); headers['Content-Type'] = o.ct || 'application/json'; headers['Content-Length'] = buf.length; }
    const r = http.request({ host: '127.0.0.1', port: h.port, method, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (e) { /* ignore */ }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (buf) r.write(buf);
    r.end();
  });
}

const proj = (name) => ({ meta: { name }, panels: [{ id: 'MDB', kind: 'MDB', name: 'MDB' }], items: [] });
const plan = (id, updated, name = 'แปลน ' + id) => ({ id, name, updated, project: proj(name) });

(async () => {
  const dir = path.join(SANDBOX, 'proj-a');
  let h = await start(dir);
  const lib = path.join(dir, 'library');

  /* ---------- ห้องสมุดแปลน ---------- */
  let r = await req(h, 'GET', '/api/library');
  eq('L1 ห้องสมุดว่างตอนเริ่ม', [r.status, r.json && r.json.plans, r.json && r.json.deleted], [200, [], {}]);

  r = await req(h, 'GET', '/api/library', undefined, { token: 'wrong' });
  eq('L2 โทเค็นผิด → 403', r.status, 403);

  r = await req(h, 'PUT', '/api/library/plan-a1', plan('plan-a1', 1000));
  eq('L3 PUT แปลนใหม่ → stored', [r.status, r.json && r.json.stored], [200, true]);
  ok('L3b เขียนไฟล์ <id>.plan.json', fs.existsSync(path.join(lib, 'plan-a1.plan.json')));

  r = await req(h, 'PUT', '/api/library/plan-a1', plan('plan-a1', 500, 'เก่ากว่า'));
  eq('L4 ฉบับเก่ากว่าไม่ทับ', [r.json.stored, r.json.updated], [false, 1000]);
  eq('L4b ไฟล์ยังเป็นฉบับเดิม', JSON.parse(fs.readFileSync(path.join(lib, 'plan-a1.plan.json'), 'utf8')).name, 'แปลน plan-a1');

  r = await req(h, 'PUT', '/api/library/plan-a1', plan('plan-a1', 2000, 'ใหม่กว่า'));
  eq('L5 ฉบับใหม่กว่าทับได้', r.json.stored, true);

  await req(h, 'PUT', '/api/library/plan-b2', plan('plan-b2', 3000));
  r = await req(h, 'GET', '/api/library');
  eq('L6 รายการเรียงใหม่สุดก่อน', r.json.plans.map((p) => [p.id, p.updated]), [['plan-b2', 3000], ['plan-a1', 2000]]);

  r = await req(h, 'PUT', '/api/library/plan-x', plan('plan-other', 1));
  eq('L7 id ใน body ไม่ตรง URL → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/library/..%2fevil', plan('../evil', 1));
  eq('L8 id มีอักขระแปลก → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/library/' + 'a'.repeat(41), plan('a'.repeat(41), 1));
  eq('L9 id ยาวเกิน 40 → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/library/plan-c', { id: 'plan-c', name: 'x', updated: 1, project: { meta: {}, panels: {}, items: [] } });
  eq('L10 project ผิดรูปแบบ → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/library/plan-c', { id: 'plan-c', name: 'x', updated: 'now', project: proj('x') });
  eq('L11 updated ไม่ใช่ตัวเลข → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/library/plan-c', plan('plan-c', 1), { ct: 'text/plain' });
  eq('L12 Content-Type ไม่ใช่ JSON → 415', r.status, 415);
  r = await req(h, 'PUT', '/api/library/plan-c', '{bad json');
  eq('L13 JSON เสีย → 400', r.status, 400);
  r = await req(h, 'POST', '/api/library/plan-c', plan('plan-c', 1));
  eq('L14 POST ที่ /library/:id → 405', r.status, 405);
  r = await req(h, 'PUT', '/api/library', plan('plan-c', 1));
  eq('L15 PUT ที่ /library → 405', r.status, 405);

  const long = plan('plan-n', 5); long.name = 'ก'.repeat(300);
  await req(h, 'PUT', '/api/library/plan-n', long);
  eq('L16 ตัดชื่อยาวเหลือ 100', JSON.parse(fs.readFileSync(path.join(lib, 'plan-n.plan.json'), 'utf8')).name.length, 100);

  r = await req(h, 'DELETE', '/api/library/plan-a1');
  ok('L17 DELETE → ok และไฟล์หาย', r.status === 200 && !fs.existsSync(path.join(lib, 'plan-a1.plan.json')), r.status);
  r = await req(h, 'GET', '/api/library');
  ok('L18 มีป้ายลบ (tombstone) และไม่อยู่ในรายการ', typeof r.json.deleted['plan-a1'] === 'number' && !r.json.plans.some((p) => p.id === 'plan-a1'), r.json.deleted);
  r = await req(h, 'DELETE', '/api/library/plan-none');
  eq('L19 ลบแปลนที่ไม่มีอยู่ ไม่พัง', r.status, 200);

  r = await req(h, 'PUT', '/api/library/plan-a1', plan('plan-a1', 2500, 'ฉบับค้างก่อนลบ'));
  eq('L19b ฉบับที่แก้ก่อนเวลาลบ (แท็บค้างคิว) ไม่ดึงแปลนที่ลบกลับมา', [r.json.stored, r.json.deleted], [false, true]);
  await req(h, 'PUT', '/api/library/plan-a1', plan('plan-a1', Date.now() + 1, 'กู้คืน'));
  r = await req(h, 'GET', '/api/library');
  ok('L20 PUT หลังลบ = กู้คืน (ล้างป้ายลบ)', r.json.deleted['plan-a1'] === undefined && r.json.plans.some((p) => p.id === 'plan-a1'), r.json.deleted);

  r = await req(h, 'PUT', '/api/library/plan-fut', plan('plan-fut', Date.now() + 1e12, 'อนาคต'));
  r = await req(h, 'PUT', '/api/library/plan-fut', plan('plan-fut', Date.now() + 10 * 60 * 1000, 'ปัจจุบัน'));
  eq('L20b เวลาจากอนาคตถูกจำกัด → เครื่องอื่นยังบันทึกทับได้', r.json.stored, true);
  await req(h, 'POST', '/api/history/plan-fut', { name: 'v', project: proj('v') });
  await req(h, 'DELETE', '/api/library/plan-fut');
  ok('L20c ลบแปลนแล้วลบประวัติเวอร์ชันด้วย', !fs.existsSync(path.join(lib, 'history', 'plan-fut')));
  // ไฟล์เสีย/ไฟล์แปลกในโฟลเดอร์ต้องไม่ทำให้รายการพัง
  fs.writeFileSync(path.join(lib, 'plan-bad.plan.json'), '{oops');
  fs.writeFileSync(path.join(lib, 'plan-mis.plan.json'), JSON.stringify(plan('plan-other', 9)));
  fs.writeFileSync(path.join(lib, 'deleted.json'), '[1,2');
  r = await req(h, 'GET', '/api/library');
  ok('L21 ข้ามไฟล์เสีย / ชื่อไฟล์ไม่ตรง id / deleted.json เสีย', r.status === 200 && !r.json.plans.some((p) => p.id === 'plan-bad' || p.id === 'plan-other') && JSON.stringify(r.json.deleted) === '{}', r.json.deleted);
  ok('L22 ไม่มีไฟล์ .tmp ค้าง', !fs.readdirSync(lib).some((f) => f.endsWith('.tmp')));

  // /api/projects (บันทึกเป็นไฟล์) ต้องไม่เห็นโฟลเดอร์ library
  r = await req(h, 'GET', '/api/projects');
  ok('L23 /api/projects ไม่รวมโฟลเดอร์ library', Array.isArray(r.json) && !r.json.some((x) => /library/.test(x.file)), r.json);

  /* ---------- บันทึกกิจกรรม ---------- */
  r = await req(h, 'GET', '/api/logs');
  eq('G1 บันทึกว่างตอนเริ่ม', [r.status, r.json.logs], [200, []]);
  const L = (t, msg, type = 'item') => ({ t, type, msg, pid: 'plan-a1', pn: 'แปลน A' });
  r = await req(h, 'POST', '/api/logs', { logs: [L(10, 'เพิ่ม'), L(20, 'แก้'), L(10, 'เพิ่ม')] });
  eq('G2 เพิ่มได้ ตัดซ้ำในชุดเดียว', r.json.added, 2);
  r = await req(h, 'POST', '/api/logs', { logs: [L(20, 'แก้'), L(15, 'ช้า'), { t: 1, type: 'evil', msg: 'x' }, { t: 'x', type: 'item', msg: 'y' }, null, L(30, 'ก'.repeat(500))] });
  eq('G3 ตัดซ้ำกับของเดิม + ข้ามรายการเสีย', r.json.added, 2);
  r = await req(h, 'GET', '/api/logs');
  eq('G4 เรียงล่าสุดก่อน', r.json.logs.map((l) => l.t), [30, 20, 15, 10]);
  eq('G5 ตัดข้อความยาวเหลือ 300', r.json.logs[0].msg.length, 300);
  await req(h, 'POST', '/api/logs', { logs: [{ t: 40, type: 'plan', msg: 'x', pid: '../../etc', pn: 5 }] });
  r = await req(h, 'GET', '/api/logs');
  eq('G6 pid/pn ผิดรูปแบบถูกล้างเป็นค่าว่าง', [r.json.logs[0].pid, r.json.logs[0].pn], ['', '']);
  r = await req(h, 'POST', '/api/logs', [L(1, 'a')]);
  eq('G7 body ไม่ใช่ {logs:[]} → 400', r.status, 400);
  r = await req(h, 'POST', '/api/logs', { logs: Array.from({ length: 1001 }, (_, i) => L(i, 'x')) });
  eq('G8 ส่งเกิน 1000 รายการต่อครั้ง → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/logs', { logs: [] });
  eq('G9 PUT /logs → 405', r.status, 405);

  // รีสตาร์ตเซิร์ฟเวอร์แล้วต้องอ่านกลับมาได้เหมือนเดิม (+ ข้ามบรรทัดเสียในไฟล์)
  fs.appendFileSync(path.join(lib, 'activity.jsonl'), 'not json\n{"t":5,"type":"nope","msg":"x"}\n{"t":6,"ty');   // บรรทัดสุดท้ายขาดกลางคัน
  await stop(h); h = await start(dir);
  await req(h, 'POST', '/api/logs', { logs: [L(40, 'หลังบรรทัดขาด')] });
  ok('G9b เขียนต่อจากบรรทัดที่ขาดกลางคันได้ (ขึ้นบรรทัดใหม่ก่อน)', fs.readFileSync(path.join(lib, 'activity.jsonl'), 'utf8').includes('"ty\n{'));
  await stop(h);
  h = await start(dir);
  r = await req(h, 'GET', '/api/logs');
  eq('G10 รีสตาร์ตแล้วอ่านไฟล์กลับมาได้ (ข้ามบรรทัดเสีย)', r.json.logs.map((l) => l.t), [40, 40, 30, 20, 15, 10]);
  r = await req(h, 'GET', '/api/library');
  ok('G11 รีสตาร์ตแล้วห้องสมุดยังอยู่', r.json.plans.some((p) => p.id === 'plan-b2'));

  // เพดาน 5000: ส่งเกินแล้วไฟล์ถูกตัดเหลือของล่าสุด
  for (let k = 0; k < 7; k++) await req(h, 'POST', '/api/logs', { logs: Array.from({ length: 1000 }, (_, i) => L(1000 + k * 1000 + i, 'bulk')) });
  r = await req(h, 'GET', '/api/logs');
  ok('G12 ส่งกลับไม่เกิน 800 รายการล่าสุด', r.json.logs.length === 800 && r.json.logs[0].t === 7999, [r.json.logs.length, r.json.logs[0].t]);
  const lines = fs.readFileSync(path.join(lib, 'activity.jsonl'), 'utf8').trim().split('\n').length;
  ok('G13 ไฟล์ถูกตัดไม่ให้โตเกินเพดาน', lines <= 6000, lines);

  /* ---------- ประวัติเวอร์ชัน ---------- */
  r = await req(h, 'GET', '/api/history/plan-a1');
  eq('V1 ยังไม่มีเวอร์ชัน', [r.status, r.json.versions], [200, []]);
  r = await req(h, 'POST', '/api/history/plan-a1', { name: 'A', note: 'ก่อนแก้\nบรรทัด', auto: false, project: proj('A') });
  ok('V2 บันทึกเวอร์ชัน → ได้รหัส v', r.status === 200 && typeof r.json.v === 'number', r.json);
  const v1 = r.json.v;
  r = await req(h, 'POST', '/api/history/plan-a1', { name: 'A2', auto: true, project: proj('A2') });
  const v2 = r.json.v;
  ok('V3 บันทึกติดกันได้รหัสไม่ซ้ำ', v2 > v1, [v1, v2]);
  r = await req(h, 'GET', '/api/history/plan-a1');
  eq('V4 รายการเวอร์ชันใหม่สุดก่อน ไม่มี project ในรายการ', r.json.versions.map((x) => [x.v, x.name, x.auto, 'project' in x]), [[v2, 'A2', true, false], [v1, 'A', false, false]]);
  eq('V5 note ตัดอักขระควบคุม', r.json.versions[1].note, 'ก่อนแก้ บรรทัด');
  r = await req(h, 'GET', '/api/history/plan-a1/' + v1);
  eq('V6 อ่านเวอร์ชันเต็มกลับได้', [r.status, r.json.version.project.meta.name], [200, 'A']);
  r = await req(h, 'GET', '/api/history/plan-a1/123');
  eq('V7 เวอร์ชันที่ไม่มี → 404', r.status, 404);
  r = await req(h, 'GET', '/api/history/plan-a1/..%2f..%2fx');
  eq('V8 รหัสเวอร์ชันแปลก → 400', r.status, 400);
  r = await req(h, 'GET', '/api/history/..%2fevil');
  eq('V9 รหัสแปลนแปลก → 400', r.status, 400);
  r = await req(h, 'POST', '/api/history/plan-a1', { project: { meta: {}, panels: 1, items: [] } });
  eq('V10 project ผิดรูปแบบ → 400', r.status, 400);
  r = await req(h, 'PUT', '/api/history/plan-a1', { project: proj('x') });
  eq('V11 PUT → 405', r.status, 405);
  for (let i = 0; i < 45; i++) await req(h, 'POST', '/api/history/plan-cap', { name: 'n' + i, project: proj('n' + i) });
  r = await req(h, 'GET', '/api/history/plan-cap');
  ok('V12 เก็บไม่เกิน 40 เวอร์ชัน (ลบเก่าสุด)', r.json.versions.length === 40 && r.json.versions[0].name === 'n44' && r.json.versions[39].name === 'n5', [r.json.versions.length, r.json.versions[0].name, r.json.versions[39] && r.json.versions[39].name]);
  r = await req(h, 'GET', '/api/library');
  ok('V13 โฟลเดอร์ history ไม่ปนในรายการแปลน', r.json.plans.every((p) => p.id !== 'history'));
  ok('V14 มี index.json สรุปเวอร์ชัน (รายการไม่ต้องอ่าน snapshot ทุกไฟล์)', JSON.parse(fs.readFileSync(path.join(lib, 'history', 'plan-cap', 'index.json'), 'utf8')).length === 40);
  fs.writeFileSync(path.join(lib, 'history', 'plan-cap', 'index.json'), '{broken');
  r = await req(h, 'GET', '/api/history/plan-cap');
  eq('V15 index.json เสีย → สร้างใหม่จากไฟล์', r.json.versions.length, 40);

  r = await req(h, 'DELETE', '/api/logs');
  eq('G14 ล้างบันทึก', r.status, 200);
  r = await req(h, 'GET', '/api/logs');
  eq('G15 หลังล้างว่าง', r.json.logs, []);
  await stop(h);
  h = await start(dir);
  r = await req(h, 'GET', '/api/logs');
  eq('G16 ล้างแล้วรีสตาร์ตยังว่าง', r.json.logs, []);
  await stop(h);

  fs.rmSync(SANDBOX, { recursive: true, force: true });
  console.log(fail ? `\n${fail} ไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  crashed ' + (e && e.stack)); process.exit(1); });
