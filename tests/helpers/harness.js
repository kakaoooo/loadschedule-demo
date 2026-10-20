// ตัวช่วยทดสอบเล็ก ๆ — พิมพ์ PASS/FAIL ตามแบบ tests/test.js (run-all.js นับบรรทัดที่ขึ้นต้นด้วย PASS / FAIL)
function createHarness() {
  let n = 0, fail = 0;
  const failed = [];

  // t(id, label, fn): fn คืน true / {ok, info} — info แสดงเมื่อไม่ผ่าน
  function t(id, label, fn) {
    n++;
    let ok = false, got;
    try {
      got = fn();
      ok = got === true || !!(got && got.ok === true);
      if (got && typeof got === 'object' && 'info' in got) got = got.info;
    } catch (e) { got = 'THROW ' + (e && e.message); }
    if (!ok) { fail++; failed.push(id); }
    let detail = '';
    if (!ok) { try { detail = '   -> ' + JSON.stringify(got); } catch (e) { detail = '   -> ' + String(got); } }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail.length > 400 ? detail.slice(0, 400) + '…' : detail}`);
    return ok;
  }
  // ta(id, label, asyncFn): ทดสอบแบบ async — done() จะรอให้เสร็จก่อนสรุปผล
  const pending = [];
  function ta(id, label, fn) {
    pending.push(Promise.resolve().then(fn).then((got) => got, (e) => 'THROW ' + (e && e.message)).then((got) => {
      n++;
      const pass = got === true || !!(got && got.ok === true);
      if (!pass) { fail++; failed.push(id); }
      let info = got && typeof got === 'object' && 'info' in got ? got.info : got, detail = '';
      if (!pass) { try { detail = '   -> ' + JSON.stringify(info); } catch (e) { detail = '   -> ' + String(info); } }
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail.length > 400 ? detail.slice(0, 400) + '…' : detail}`);
    }));
  }
  const ok = (c, info) => ({ ok: !!c, info });
  // eq(id, label, got, want): เทียบแบบ JSON
  function eq(id, label, got, want) {
    const same = JSON.stringify(got) === JSON.stringify(want);
    return t(id, label, () => ({ ok: same, info: { got, want } }));
  }
  function done(title) {
    Promise.all(pending).then(() => {
      console.log(`\n${n - fail}/${n} pass, ${fail} FAIL${title ? ' — ' + title : ''}`);
      process.exit(fail ? 1 : 0);
    });
  }
  return { t, ta, ok, eq, done, stats: () => ({ n, fail, failed }) };
}
module.exports = { createHarness };
