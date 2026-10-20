// โครงการตัวอย่าง: อาคารสำนักงาน 2 ชั้น (ใช้ตอนเปิดครั้งแรก / ปุ่ม "โหลดตัวอย่าง")
(function (root) {
  root.SAMPLE_PROJECT = function () {
    const E = root.LoadEngine;
    const meta = Object.assign(E.defaultMeta(), {
      name: 'อาคารสำนักงานตัวอย่าง 2 ชั้น', owner: 'บริษัท ตัวอย่าง จำกัด', location: 'จ.นนทบุรี (พื้นที่ กฟภ.)',
      designer: '', buildingType: 'office', utility: 'PEA', supply: 'transformer', recVA: 200, growth: 25
    });
    const panels = [
      { id: 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null, location: 'ห้องไฟฟ้า ชั้น 1' },
      { id: 'LP1', name: 'LP-1', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 15, location: 'ชั้น 1 โถงบันได', mounting: 'SURFACE' },
      { id: 'AC1', name: 'LA-1', kind: 'LP', phases: 3, parent: 'MDB', feederLength: 18, location: 'ชั้น 1 โถงบันได', mounting: 'SURFACE' },
      { id: 'SDB2', name: 'SDB-2', kind: 'SDB', phases: 3, parent: 'MDB', feederLength: 25, location: 'ชั้น 2 ห้องไฟฟ้า' },
      { id: 'LP2', name: 'LP-2', kind: 'LP', phases: 3, parent: 'SDB2', feederLength: 6, location: 'ชั้น 2', mounting: 'SURFACE' },
      { id: 'AC2', name: 'LA-2', kind: 'LP', phases: 3, parent: 'SDB2', feederLength: 6, location: 'ชั้น 2', mounting: 'SURFACE' },
      { id: 'PB', name: 'PB', kind: 'SDB', phases: 3, parent: 'MDB', feederLength: 10, location: 'ข้าง MDB' }
    ];
    let n = 0;
    const it = (panelId, o) => Object.assign({ id: 'i' + (++n), panelId, qty: 1, length: 20 }, o);
    const items = [
      it('LP1', { type: 'light', name: 'โถง/ต้อนรับ', lamp: 'led-t8-18', perFixture: 2, fixtures: 24, length: 25 }),
      it('LP1', { type: 'light', name: 'สำนักงาน ชั้น 1', lamp: 'led-t8-18', perFixture: 3, fixtures: 30, length: 30 }),
      it('LP1', { type: 'light', name: 'ห้องน้ำ/ทางเดิน', lamp: 'led-bulb-11', perFixture: 1, fixtures: 16, length: 20 }),
      it('LP1', { type: 'rec', name: 'เต้ารับสำนักงาน', points: 36, length: 25 }),
      it('LP1', { type: 'rec', name: 'เต้ารับห้องน้ำ/ครัว', points: 6, wet: true, length: 20 }),
      it('LP1', { type: 'heater', name: 'เครื่องทำน้ำอุ่นห้องผู้บริหาร', watt: 3500, length: 18 }),
      it('LP1', { type: 'spare', cb: 16, qty: 1 }),
      it('AC1', { type: 'ac', name: 'แอร์สำนักงาน', btu: 24000, qty: 4, length: 20 }),
      it('AC1', { type: 'ac', name: 'แอร์ห้องประชุม', btu: 36000, qty: 1, length: 22 }),
      it('AC1', { type: 'ac', name: 'แอร์ห้องผู้บริหาร', btu: 18000, qty: 2, length: 15 }),
      it('LP2', { type: 'light', name: 'สำนักงาน ชั้น 2', lamp: 'led-t8-18', perFixture: 3, fixtures: 40, length: 30 }),
      it('LP2', { type: 'light', name: 'ทางเดิน/บันได', lamp: 'led-t8-9', perFixture: 1, fixtures: 20, length: 25 }),
      it('LP2', { type: 'rec', name: 'เต้ารับสำนักงาน', points: 44, length: 25 }),
      it('LP2', { type: 'custom', name: 'เครื่องถ่ายเอกสาร', watt: 1800, pf: 0.9, phases: 1, length: 15 }),
      it('AC2', { type: 'ac', name: 'แอร์สำนักงาน ชั้น 2', btu: 30000, qty: 3, length: 20 }),
      it('AC2', { type: 'ac', name: 'แอร์ห้อง Server', btu: 12000, qty: 3, length: 12 }),
      it('PB', { type: 'motor', name: 'ปั๊มน้ำดี', kw: 5.5, phases: 3, qty: 2, length: 15 }),
      it('PB', { type: 'motor', name: 'ปั๊มน้ำทิ้ง', kw: 2.2, phases: 3, qty: 1, length: 25 }),
      it('PB', { type: 'lift', name: 'ลิฟต์โดยสาร', preset: 3, qty: 1, length: 30 })
    ];
    return { version: 1, meta, panels, items };
  };
})(typeof self !== 'undefined' ? self : this);
