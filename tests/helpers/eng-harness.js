// ตัวช่วยทดสอบของ engine (แบบเดียวกับ tests/test.js): บรรทัดขึ้นต้น PASS / FAIL, exit code ≠ 0 ถ้ามีข้อใดไม่ผ่าน
let fails = 0, passes = 0;

function report(ok, name, detail) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? (ok ? ': ' : '  ') + String(detail).split('\n')[0].slice(0, 300) : ''}`);
}
// test(name, fn): fn โยน Error = ไม่ผ่าน; ถ้า fn คืนข้อความ จะแสดงต่อท้ายชื่อ
function test(name, fn) {
  try { const r = fn(); report(true, name, typeof r === 'string' ? r : ''); }
  catch (e) { report(false, name, e && e.message ? e.message : e); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${msg ? msg + ': ' : ''}ได้ ${a} (ต้องได้ ${b})`);
}
function near(got, want, tol, msg) {
  if (!(Math.abs(got - want) <= (tol == null ? 1e-6 : tol))) throw new Error(`${msg ? msg + ': ' : ''}ได้ ${got} (ต้องได้ ${want} ± ${tol == null ? 1e-6 : tol})`);
}
function done() {
  console.log(fails ? `\n${fails} รายการไม่ผ่าน (ผ่าน ${passes})` : `\nผ่านทั้งหมด (${passes})`);
  process.exit(fails ? 1 : 0);
}
module.exports = { test, assert, eq, near, done, report, counts: () => ({ passes, fails }) };
