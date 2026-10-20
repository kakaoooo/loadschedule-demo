/*
 * AutoCAD DXF — เวอร์ชันสาธิต (Public Demo)
 * ตัวสร้างไฟล์ DXF ถูกถอดออกจากซอร์สของเวอร์ชันนี้ทั้งหมด: เรียก build() จะแสดงหน้าต่าง "Ver.DEMO" และไม่คืนข้อมูลใด ๆ
 * เวอร์ชันเต็ม (ส่งออก DXF ได้) ใช้งานในเครื่องของเจ้าของผลงานเท่านั้น
 */
(function (root) {
  'use strict';
  const build = () => { const g = root.DemoGuard; if (g) g.interceptExport('AutoCAD DXF (.dxf)'); return ''; };
  const API = { build, esc: (s) => String(s == null ? '' : s), LAYERS: [] };
  root.SldDXF = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
