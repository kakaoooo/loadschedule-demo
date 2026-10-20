// คำนวณเบื้องหลังใน Web Worker เพื่อไม่ให้หน้าจอกระตุกระหว่างพิมพ์
importScripts('data.js', 'brands.js', 'brandcb.js', 'engine.js');
self.onmessage = (e) => {
  const { id, project } = e.data;
  const t0 = performance.now();
  try {
    const result = self.LoadEngine.calculate(project);
    self.postMessage({ id, ok: true, result, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err), ms: performance.now() - t0 });
  }
};
