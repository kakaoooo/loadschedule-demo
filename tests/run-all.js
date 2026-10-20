// รันทดสอบทุกไฟล์: tests/test.js + tests/*.test.js — ใช้: npm test
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = ['test.js', ...fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()];
const only = process.argv[2];
let failed = 0;
for (const f of files) {
  if (only && !f.includes(only)) continue;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: path.join(dir, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const bad = lines.filter((l) => /^FAIL\b/.test(l));
  const ok = r.status === 0 && !bad.length;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${f}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${lines.filter((l) => /^PASS\b/.test(l)).length} pass, ${bad.length} fail)`);
  if (!ok) { bad.slice(0, 25).forEach((l) => console.log('      ' + l)); if (!bad.length) console.log(out.split('\n').slice(-15).map((l) => '      ' + l).join('\n')); }
}
console.log(failed ? `\n${failed} ไฟล์ไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
