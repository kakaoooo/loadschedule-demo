// ทดสอบการแก้ UI/UX รอบนี้ — รัน: node tests/ui-fixes.test.js
const { createHarness } = require('./helpers/harness');
const H = require('./helpers/env');
const { I } = H;
const { t, ok, done } = createHarness();

const A = 'ชั้น 3\nห้องประชุม: โคม LED 18W x 10';
const B = 'ห้องทำงาน: โคม LED 18W x 5';
const BRK = I.FILE_BREAK_LINE;

t('MF1', 'without a break, floor context leaks into the next file (baseline)', () => {
  const r = I.parseText(A + '\n\n' + B).rows;
  return ok(r.length === 2 && r[1].floor === 3, r.map((x) => x.floor));
});
t('MF2', 'with FILE_BREAK_LINE the second file restarts at default floor 1', () => {
  const r = I.parseText(A + '\n\n' + BRK + '\n\n' + B).rows;
  return ok(r.length === 2 && r[0].floor === 3 && r[1].floor === 1, r.map((x) => x.floor));
});
t('MF3', 'row keys stay unique across files with identical lines', () => {
  const r = I.parseText(B + '\n' + BRK + '\n' + B).rows;
  return ok(r.length === 2 && new Set(r.map((x) => x.key)).size === 2, r.map((x) => x.key));
});
t('MF4', 'no break marker: result identical to single-chunk parse', () => {
  const x = I.parseText(A), y = I.parseText(A + '\n');
  return ok(x.rows.length === y.rows.length && x.rows[0].floor === 3, x.rows.length);
});
t('MF5', 'break line itself produces no rows/warnings', () => {
  const r = I.parseText(BRK + '\n' + A);
  return ok(r.rows.length === 1 && r.warnings.length === 0, r.warnings);
});
done();
