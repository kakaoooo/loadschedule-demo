// ตั้งธีม (สว่าง/มืด) ก่อนวาดหน้า กันภาพกะพริบ — โหลดใน <head> แบบ blocking ; CSP ไม่อนุญาต inline script จึงเป็นไฟล์แยก
// ตรรกะเดียวกับ UIKit.resolveTheme (uikit.js) : ค่าที่ผู้ใช้เลือกไว้ใน localStorage ('ls-theme') ชนะ ไม่มี = ตามระบบ
(function () {
  var stored = null;
  try { stored = localStorage.getItem('ls-theme'); } catch (e) { /* โหมดส่วนตัว/ปิด storage */ }
  var dark = false;
  try { dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { /* ignore */ }
  var t = stored === 'dark' || stored === 'light' ? stored : (dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', t);
})();
