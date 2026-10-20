/*
 * นำเข้าแบบ/รายการโหลดจากข้อความ แล้วจัดประเภท + จัดวางแผงอัตโนมัติ
 *
 * parseText(text)  -> { rows, warnings, info }   rows: [{key, floor, room, area, type, ...spec, qty, src, est}]
 *                     info.sourceKind = 'text' | 'table' | 'schedule' | 'mixed' | 'empty'
 * parseTable(text) -> เหมือน parseText แต่บังคับอ่านเป็นตาราง CSV/TSV (เดาตัวคั่น , ; tab)
 * buildLayout(rows, project, {mode, floorHeight}) -> { panels, items, log, warnings, placement }
 *     ชั้น 1: LP-1, LA-1 จาก MDB / ชั้น ≥ 2: SDB-n → LP-n, LA-n / โหลดส่วนกลาง (ชั้น ≤ 0 หรือ 'C') → PB
 *     แถวมี row.dest = { floor: เลข | 'C' | undefined, panel: ชื่อแผง | undefined } เพื่อกำหนดปลายทางเอง (ชนะค่าอัตโนมัติ)
 *
 * ทุกแถวมี row.key = `${src ทำให้เป็นมาตรฐาน}#${n}` (n = ลำดับของ src ซ้ำ เริ่ม 0) ให้ UI ผูกค่ากำหนดเองได้แม้แก้ข้อความแล้ว parse ใหม่
 */
(function (root) {
  'use strict';
  const D = root.LS_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);

  const LIMITS = { text: 2 * 1024 * 1024, line: 1500, qty: 5000, rows: 100000 };

  /* ---------------- ตัวช่วย regex ---------------- */
  // ขอบคำภาษาลาติน: ไม่ติดกับตัวอักษร a-z (ติดกับตัวเลข/ภาษาไทยได้) — \b ของ JS ใช้กับภาษาไทยไม่ได้
  const lat = (src) => '(?:^|[^A-Za-z])(?:' + src + ')(?![A-Za-z])';
  const NUMPRE = '(^|[^\\d.,])';
  // ตัวเลข: 1,234 / 1,234.5 / 12.5 / 12,5 (ทศนิยมแบบคอมมา) — จำกัดความยาวทุกกลุ่ม กัน regex บวม
  const NUM = '(\\d{1,3}(?:,\\d{3}){1,4}(?:\\.\\d{1,6})?|\\d{1,9}(?:[.,]\\d{1,6})?)';
  const nrx = (tail, flags) => new RegExp(NUMPRE + NUM + tail, flags || 'i');
  const toNum = (s) => {
    s = String(s);
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
    if (/^\d+,\d{1,6}$/.test(s)) return Number(s.replace(',', '.'));
    return Number(s.replace(/,/g, ''));
  };
  // หน่วย (ต่อท้ายตัวเลข)
  const NB = '(?:(?![A-Za-z0-9])|(?=[x×*]\\s{0,3}-?\\d))';   // ท้ายหน่วย: ไม่ติดตัวอักษร/ตัวเลข หรือตามด้วย x2
  const U_W = '\\s{0,3}(?:w|watts?|วัตต์?)' + NB;
  const U_KW = '\\s{0,3}(?:kw|kilowatts?|กิโลวัตต์?)' + NB;
  const U_KVA = '\\s{0,3}(?:kva|กิโลโวลต์แอมป์?|เควีเอ)' + NB;
  const U_VA = '\\s{0,3}(?:va|โวลต์แอมป์?)' + NB;
  const U_BTU = '\\s{0,2}(k)?\\s{0,2}(?:btu(?:\\s{0,2}/?\\s{0,2}h(?:r|our)?)?|บีทียู)' + NB;
  const U_HP = '\\s{0,3}(?:hp|แรงม้า|แรงม้ำ)' + NB;
  const U_TR = '\\s{0,3}(?:tr|ตัน|tons?)' + NB;
  const U_KG = '\\s{0,3}(?:kgs?|กก\\.?|กิโลกรัม)' + NB;
  const AREA_UNIT = '\\s{0,3}(?:ตร\\.?\\s{0,2}ม\\.?|ตารางเมตร|ตร\\.?เมตร|m2|m²|sq\\.?\\s{0,2}m|sqm|㎡)(?![A-Za-z0-9])';
  const AREA_RE = nrx(AREA_UNIT);
  const LEN_RE = new RegExp('(^|[^A-Za-z])(?:ยาว|ระยะ|length|l\\s{0,2}=)\\s{0,3}' + NUM + '\\s{0,3}(?:m|ม\\.?|เมตร)(?![A-Za-z0-9])', 'i');
  const PF_RE = new RegExp('(^|[^A-Za-z])(?:pf|p\\.f\\.?|power\\s{0,2}factor|cos\\s{0,2}(?:φ|phi)?|เพาเวอร์\\s{0,2}แฟค?เตอร์)\\s{0,3}[:=]?\\s{0,3}(0?\\.\\d{1,3}|1(?:\\.0{1,3})?|\\d{2,3}\\s{0,2}%)', 'i');

  /* ---------------- ปรับตัวอักษรให้เป็นมาตรฐาน ---------------- */
  // เลขไทย/เลขเต็มความกว้าง/วรรคตอนเต็มความกว้าง/NBSP/ตัวอักษรกว้างศูนย์ — ทำก่อน parse เสมอ (เป็น regex เชิงเส้นทั้งหมด)
  function normalizeText(s) {
    return String(s)
      .replace(/[\u0000\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u0E50-\u0E59]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0E50 + 48))
      .replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3001/g, ',').replace(/[\u201C\u201D\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u2212/g, '-');
  }
  const splitLines = (s) => s.split(/\r\n|\r|\n|\u2028|\u2029|\u0085|\v|\f/);

  /* ---------------- คำสำคัญ ---------------- */
  const KW_SRC = {
    lift: 'ลิฟ[ต์ท]|' + lat('lifts?|elevators?'),
    esc: 'บันไดเลื่อน|' + lat('escalators?'),
    chiller: 'ชิลเลอ|' + lat('chillers?'),
    ev: 'ชาร์จรถ|ชาร์จไฟรถ|ชาร์จ\\s{0,2}ev|อัดประจุ|' + lat('ev\\s{0,2}(?:chargers?|charging|stations?)|evse|wall\\s{0,2}box(?:es)?|charging\\s{0,2}stations?'),
    ac: 'แอร์|เครื่องปรับอากาศ|ปรับอากาศ|' + lat('air\\s{0,2}con(?:ditioner|ditioning)?s?|a/c|fcus?|acs?|split\\s{0,2}type|btu|vrf|vrv'),
    heater: 'น้ำอุ่น|น้ำร้อน|' + lat('water\\s{0,2}heaters?|heaters?'),
    cook: 'เตา|หุงต้ม|ไมโครเวฟ|กาต้มน้ำ|' + lat('microwaves?|ovens?|cookers?|induction|kettles?|hot\\s{0,2}plates?'),
    motor: 'ปั๊ม|ปั้ม|มอเตอร์(?!ไซ)|พัดลมระบาย|พัดลมดูด|คอมเพรสเซอ|โบลเวอร์|' + lat('pumps?|motors?|ahus?|exhaust\\s{0,2}fans?|blowers?|compressors?'),
    rec: 'เต้ารับ|รับไฟ|ปลั๊ก|' + lat('receptacles?|outlets?|sockets?|duplex|power\\s{0,2}plugs?'),
    // "ไฟ" เดี่ยว ๆ นับเป็นโคมไฟเฉพาะเมื่อขึ้นต้นคำ และไม่ใช่ ไฟฟ้า/ไฟไหม้/ไฟล์/ไฟเบอร์ ...
    light: 'โคม|หลอด|ดาวน์?ไลท์|ดาวไลท์|ดาวน์ไลต์|แสงสว่าง|ส่องสว่าง|ฟลูออ|สป[อ็]ร?[ตท]ไล[ทต]์|ฟลัดไล[ทต]์|ป้ายทางออก|ป้ายหนีไฟ|ป้ายไฟ|(?:^|[\\s(\\[,;:/|-])ไฟ(?!ฟ้า|ไหม้|ล์|เบอร์|แช็ก|แชค|ฉาย|ฟ)|' +
      lat('leds?|t8|t5|fluorescents?|lamps?|lights?|lighting|luminaires?|bulbs?|spot\\s{0,2}lights?|downlights?|floodlights?|hps|metal\\s{0,2}halide|sodium|exit\\s{0,2}signs?|emergency\\s{0,2}lights?'),
    custom: 'ตู้เย็น|ตู้แช่|เครื่องซักผ้า|เครื่องถ่ายเอกสาร|ทีวี|คอมพิวเตอร์|อุปกรณ์|' + lat('ups|servers?|copiers?|printers?|tv|computers?|equipments?|loads?|refrigerators?|fridges?|freezers?|washing\\s{0,2}machines?')
  };
  const KW = {};
  Object.keys(KW_SRC).forEach((k) => { KW[k] = new RegExp(KW_SRC[k], 'i'); });
  const ORDER = ['lift', 'esc', 'chiller', 'ev', 'ac', 'heater', 'cook', 'motor', 'rec', 'light', 'custom'];
  const CENTRAL = new RegExp('ส่วนกลาง|ดาดฟ้า|ใต้ดิน|ห้องปั๊ม|' + lat('central|common|roof(?:top)?|basement|pump\\s{0,2}room'), 'i');
  const CENTRAL_SECT_G = new RegExp('ส่วนกลาง|ดาดฟ้า|ใต้ดิน|' + lat('central|common|roof(?:top)?|basement'), 'gi');
  const ROOMNOUN = new RegExp('ห้อง|โซน|พื้นที่|โถง|ล็อบบี้|ร้าน|ครัว|ส้วม|ลาน|จอดรถ|ทางเดิน|ชั้น|บันได|ระเบียง|หลังคา|ดาดฟ้า|ใต้ดิน|อาคาร|ตึก|โรงงาน|โกดัง|คลัง|สวน|สำนักงาน|' +
    lat('rooms?|zones?|areas?|halls?|lobby|offices?|shops?|kitchens?|toilets?|garage|parking|corridors?|floors?|stairs?|balcony|roof|basement|buildings?|factory|warehouse|garden|dock|store|storage|plant|yard|deck'), 'i');

  const ROOM_RULES = [
    { re: new RegExp('ห้องน้ำ|ส้วม|สุขา|' + lat('toilets?|wc|restrooms?|lavator(?:y|ies)|bath(?:room)?s?|washrooms?'), 'i'), kind: 'toilet', wpm: 3.5, rec: 0, wet: 1, ac: false },
    { re: new RegExp('ทางเดิน|โถงทางเดิน|ระเบียง|บันได|' + lat('corridors?|hall\\s{0,2}ways?|stair(?:s|way|case)?|passage'), 'i'), kind: 'corridor', wpm: 4, rec: 20, ac: false },
    { re: new RegExp('เก็บของ|ห้องไฟฟ้า|ห้องเครื่อง|ปั๊ม|จอดรถ|ขยะ|โกดัง|คลัง|' + lat('stor(?:e|es|age)|electrical|parking|garage|warehouse|garbage|mechanical|plant\\s{0,2}room'), 'i'), kind: 'service', wpm: 4, rec: 30, ac: false },
    { re: new RegExp('ครัว|แพนทรี|' + lat('kitchens?|pantry'), 'i'), kind: 'kitchen', wpm: 7, rec: 6, wet: 2, ac: false },
    { re: new RegExp('ห้องคอม|เซิร์ฟเวอร์|เซิฟเวอร์|' + lat('servers?|data\\s{0,2}cent(?:er|re)'), 'i'), kind: 'server', wpm: 7, rec: 5, ac: true, btuK: 1200 },
    { re: new RegExp('ประชุม|สัมมนา|อบรม|' + lat('meeting|conference|training|seminar'), 'i'), kind: 'meeting', wpm: 7, rec: 12, ac: true, btuK: 1000 },
    { re: new RegExp('ล็อบบี้|ต้อนรับ|โถง|' + lat('lobby|reception|hall'), 'i'), kind: 'lobby', wpm: 7, rec: 15, ac: true, btuK: 800 },
    { re: /[\s\S]*/, kind: 'room', wpm: 7, rec: 10, ac: true, btuK: 900 }
  ];

  const SPEC_FALLBACK = nrx('\\s{0,3}(?:w|watts?|วัตต์?|kw|กิโลวัตต์?|kva|va)' + NB);
  const SPEC_ANY = new RegExp('\\d\\s{0,3}(?:w|watts?|วัตต์?|kw|kva|va|btu|hp|แรงม้า|tr|ตัน|tons?|kg|กก|โคม|ดวง|ชุด|จุด|ตัว|เครื่อง|หลอด|ช่อง|units?|pcs?|sets?|points?|fixtures?)(?![A-Za-z0-9])|[x×*]\\s{0,3}\\d|(?:จำนวน|qty)', 'i');

  function classifyKW(seg) {
    for (const k of ORDER) if (KW[k].test(seg)) return k;
    return null;
  }
  function classify(seg) {
    seg = String(seg == null ? '' : seg);
    if (seg.length > LIMITS.line) seg = seg.slice(0, LIMITS.line);
    return classifyKW(seg) || (SPEC_FALLBACK.test(seg) ? 'custom' : null);
  }

  /* ---------------- เครื่องมือตัดข้อความทีละส่วน ---------------- */
  // take: regex ต้องมีกลุ่ม 1 = ตัวคั่นนำหน้า (เก็บไว้) — ตัดส่วนที่เหลือของ match ออกจาก st.s แล้วคืน match
  function take(st, re) {
    const m = re.exec(st.s);
    if (!m) return null;
    const start = m.index + (m[1] || '').length, end = m.index + m[0].length;
    st.s = st.s.slice(0, start) + ' ' + st.s.slice(end);
    return m;
  }
  const mask = (st, re) => { st.s = st.s.replace(re, (m, p) => (typeof p === 'string' ? p : '') + ' '); };

  /* ---------------- เฟส / แรงดัน ---------------- */
  const PH_RES = [
    [new RegExp('(^|[^A-Za-z0-9.,])([13])\\s{0,2}-?\\s{0,2}(?:เฟส|phases?|ph|φ|p)\\s{0,2}-?\\s{0,2}[234]\\s{0,2}(?:w|wires?|สาย)(?![A-Za-z0-9])', 'i'), 2],
    [new RegExp('(^|[^A-Za-z0-9.,])([13])\\s{0,2}-?\\s{0,2}(?:เฟส|phases?|ph|φ|p)(?![A-Za-z0-9])', 'i'), 2],
    [/(^|[^A-Za-z])(single|one)[\s-]{0,2}phase(?![A-Za-z])/i, 1],
    [/(^|[^A-Za-z])(three)[\s-]{0,2}phase(?![A-Za-z])/i, 3],
    [/(^|[^A-Za-z0-9])()เฟสเดียว/, 1],
    [/(^|[^A-Za-z0-9])()สามเฟส/, 3],
    [new RegExp('(^|[^\\d.,])(\\d{3})\\s{0,2}/\\s{0,2}\\d{3}\\s{0,2}v(?![A-Za-z0-9])', 'i'), 3],
    [new RegExp('(^|[^\\d.,])(380|400|415)\\s{0,2}v(?![A-Za-z0-9])', 'i'), 3],
    [new RegExp('(^|[^\\d.,])(220|230|240)\\s{0,2}v(?![A-Za-z0-9])', 'i'), 1]
  ];
  // คืน 1 | 3 | null และตัดโทเค็นเฟส/แรงดันทั้งหมดออก (ไม่ให้เป็นจำนวน)
  function extractPhase(st) {
    let found = null;
    for (const [re, g] of PH_RES) {
      for (let guard = 0; guard < 6; guard++) {
        const m = take(st, re);
        if (!m) break;
        if (found == null) found = typeof g === 'number' && g > 3 ? Number(m[g]) : (g === 2 ? Number(m[2]) : g);
      }
    }
    return found === 1 || found === 3 ? found : null;
  }

  /* ---------------- จำนวน ---------------- */
  const TH_UNITS = 'โคม|ดวง|ชุด|จุด|ตัว|เครื่อง|หลอด|ช่อง|อัน|แห่ง|ตำแหน่ง|ชิ้น|คู่|ใบ|ลูก|ตู้|ต้น|หัวจ่าย';
  const EN_UNITS = 'pcs?|pieces?|sets?|nos?|ea|units?|points?|pts?|fixtures?|lamps?|tubes?|bulbs?|outlets?|sockets?|receptacles?|fans?';
  const UNIT_TAIL = '(?:\\s{0,3}(?:' + TH_UNITS + '|ที่)|\\s{0,3}(?:' + EN_UNITS + ')(?![A-Za-z0-9]))?';
  const Q_LABEL = new RegExp("(^|[^A-Za-z])(?:จำนวน|qty|quantity|q'ty|amount)\\s{0,3}[:=]?\\s{0,3}(-?)" + NUM + UNIT_TAIL, 'i');
  const Q_X1 = new RegExp('(^|[\\s)\\]])[x×*]\\s{0,3}(-?)' + NUM + '(?![A-Za-z0-9])' + UNIT_TAIL, 'i');
  const Q_X2 = new RegExp('(\\d\\s{0,2}(?:w|va|btu|hp|tr|kg|v)|[\\u0E00-\\u0E7F)])[x×*](-?)' + NUM + '(?![A-Za-z0-9])' + UNIT_TAIL, 'i');
  const Q_PRE = new RegExp(NUMPRE + NUM + '\\s{0,3}[x×*]\\s{0,3}(?=[^\\d\\s.,]|$)', 'i');
  const unitRx = (th, en) => new RegExp(NUMPRE + NUM + '\\s{0,3}(?:(?:' + th + ')|(?:' + en + ')(?![A-Za-z0-9]))', 'i');
  const Q_UNIT = unitRx(TH_UNITS, EN_UNITS);
  const Q_UNIT_REC = unitRx(TH_UNITS + '|ที่', EN_UNITS);
  const Q_FIX = unitRx('โคม|ดวง|ชุด|จุด|ตัว|ชิ้น|ใบ|ลูก|ต้น', 'fixtures?|sets?|pcs?|pieces?|ea|units?|nos?');
  const Q_LAMP = unitRx('หลอด', 'lamps?|tubes?|bulbs?');
  const Q_LONE = new RegExp('(?:^|\\s)(\\d{1,5})\\s*$');
  const Q_SPEC_MASKS = [
    // ป้ายห้อง/โซน/เลขที่ + ตัวเลข ไม่ใช่จำนวน
    new RegExp('(^|[^A-Za-z])(?:ห้อง(?:ที่)?|โซน|zone|room|rm\\.?|no\\.?|number|เลขที่|หมายเลข|ลำดับที่|ชุดที่|หน่วยที่|ตัวที่|แผง|panel|bldg|building|อาคาร|ตึก)\\s{0,3}[A-Za-z]?-?\\d{1,6}[A-Za-z]?(?![A-Za-z0-9])', 'gi'),
    /#\s{0,2}\d{1,6}/g,
    /ชั้น(?:ที่)?\s{0,3}[A-Za-z]?\d{1,3}(?:\s{0,3}[-–~]\s{0,3}\d{1,3})?/g,
    /\d{1,3}\s{0,3}ชั้น/g,
    /(^|[^A-Za-z])(?:floors?|fl\.?|level|lvl)\s{0,3}\d{1,3}/gi,
    /\d{1,3}\s{0,2}(?:st|nd|rd|th)\s{0,2}floors?/gi,
    // รหัสอุปกรณ์ เช่น FCU-2, P-101 (ไม่ใช่ตัวเลขที่ตามด้วยจุดทศนิยม/หน่วย)
    /(^|[^A-Za-z0-9])[A-Za-z]{1,6}[-_/]\d{1,6}[A-Za-z]?(?![A-Za-z0-9.,])/g,
    // ตัวเลขที่มีหน่วยซึ่งไม่ใช่จำนวน
    new RegExp(NUMPRE + '\\d{1,6}(?:[.,]\\d{1,3})?\\s{0,2}(?:lux|lm|lumens?|ลักซ์|นิ้ว|inch(?:es)?|cm|mm|ซม\\.?|มม\\.?|เมตร|m/min|m/s|ม\\.|hz|เฮิรตซ์|volts?|โวลต์|amps?|แอมป์|at|af|ka|ปี|วัน|ชม\\.?|hrs?|ชั่วโมง|ip\\d*|v|a|k|m|%|"|\u2033)(?![A-Za-z0-9])', 'gi')
  ];
  const DIM_RE = new RegExp(NUMPRE + '\\d{1,4}\\s{0,2}[x×*]\\s{0,2}\\d{1,4}\\s{0,2}(?:cm|mm|ซม\\.?|มม\\.?|นิ้ว|"|m)(?![A-Za-z0-9])', 'gi');

  // คืน { n, explicit } หรือ null — n อาจ ≤ 0 (ผู้เรียกจะตัดแถว) ; units = regex หน่วยนับของชนิดนั้น
  function findQty(st, unitRe, lone) {
    let m = take(st, Q_LABEL);
    if (m) return { n: toNum(m[3]) * (m[2] ? -1 : 1), explicit: true };
    m = take(st, Q_X1) || take(st, Q_X2);
    if (m) return { n: toNum(m[3]) * (m[2] ? -1 : 1), explicit: true };
    m = take(st, Q_PRE);
    if (m) return { n: toNum(m[2]), explicit: true };
    if (unitRe) { m = take(st, unitRe); if (m) return { n: toNum(m[2]), explicit: true }; }
    if (lone !== false) {
      st.s = st.s.replace(/[\s,;:)\]]+$/, '');
      m = Q_LONE.exec(st.s);
      if (m) { st.s = st.s.slice(0, m.index) + ' '; return { n: Number(m[1]), explicit: false }; }
    }
    return null;
  }
  // ตรวจจำนวน: คืนจำนวนเต็มที่ใช้ได้ หรือ null (= ตัดแถว) พร้อมคำเตือน
  function checkQty(n, what, warn) {
    if (n == null) return 1;
    if (!isFinite(n) || n <= 0) { warn(`จำนวน${what ? ' ' + what : ''} เป็น ${isFinite(n) ? n : '?'} — ข้ามรายการนี้`); return null; }
    n = Math.round(n);
    if (n < 1) n = 1;
    if (n > LIMITS.qty) { warn(`จำนวน${what ? ' ' + what : ''} ${n.toLocaleString('en-US')} มากเกินไป — จำกัดที่ ${LIMITS.qty.toLocaleString('en-US')}`); return LIMITS.qty; }
    return n;
  }

  /* ---------------- ชั้น ---------------- */
  const FL = '(?:ชั้น(?:ที่)?\\s{0,3}(\\d{1,3})(?:\\s{0,3}[-–~]\\s{0,3}(\\d{1,3}))?|ชั้น\\s{0,3}([Gg])(?![A-Za-z0-9])|(ชั้นล่าง|ชั้นลอย|ชั้นใต้ดิน)|ชั้น\\s{0,3}[Bb](\\d{1,2})(?![A-Za-z0-9])|(?:floor|fl\\.?|level|lvl)\\s{0,3}(\\d{1,3})(?![A-Za-z0-9])|(\\d{1,3})\\s{0,2}(?:st|nd|rd|th)\\s{0,3}(?:floor|fl\\.?)|(ground\\s{0,2}floor|mezzanine|basement))';
  const FLOOR_START = new RegExp('^\\s*' + FL, 'i');
  const FLOOR_ANY = new RegExp('(^|[^A-Za-z0-9])' + FL, 'i');
  const FLOOR_COMPACT = /^\s*(?:(\d{1,3})\s{0,2}\/?\s{0,2}f|(?:f|fl|l|lvl)\s{0,2}[-.]?\s{0,2}(\d{1,3})|(g)\s{0,2}\/?\s{0,2}f?|b(\d{1,2}))\s*$/i;
  const FLOOR_COMPACT_HEAD = /^\s*(?:(\d{1,3})\s{0,2}\/?\s{0,2}f|(?:f|fl|l|lvl)\s{0,2}[-.]?\s{0,2}(\d{1,3})|(g)\s{0,2}\/?\s{0,2}f|b(\d{1,2}))\s{0,2}(?=[:\uFF1A|]|\s-\s|\s–\s)/i;
  // กลุ่มจับของ FL: 1,2=ชั้น N(-M) 3=ชั้น G 4=คำ 5=ชั้น Bn 6=floor N 7=Nth floor 8=คำอังกฤษ
  function floorFromMatch(m, off) {
    const g = (i) => m[off + i];
    if (g(1)) return { floor: Number(g(1)), range: g(2) ? Number(g(2)) : null };
    if (g(3)) return { floor: 1 };
    if (g(4)) return { floor: /ใต้ดิน/.test(g(4)) ? -1 : 1 };
    if (g(5)) return { floor: -Number(g(5)) };
    if (g(6)) return { floor: Number(g(6)) };
    if (g(7)) return { floor: Number(g(7)) };
    if (g(8)) return { floor: /basement/i.test(g(8)) ? -1 : 1 };
    return null;
  }
  function compactFloor(m) {
    if (m[1]) return Number(m[1]);
    if (m[2]) return Number(m[2]);
    if (m[3]) return 1;
    if (m[4]) return -Number(m[4]);
    return null;
  }
  // เซลล์/ข้อความที่เป็น "ชั้น" ล้วน ๆ → เลขชั้น หรือ null
  function parseFloorToken(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    if (/^-?\d{1,3}$/.test(s)) return Number(s);
    let m = FLOOR_COMPACT.exec(s);
    if (m) return compactFloor(m);
    m = new RegExp('^\\s*' + FL + '\\s*$', 'i').exec(s);
    if (m) { const r = floorFromMatch(m, 0); return r ? r.floor : null; }
    return null;
  }
  // ส่วนหัวชั้นของบรรทัด: ต้นบรรทัด หรือส่วนหัวก่อนเครื่องหมาย ":" ; คืน { floor, rest, range } หรือ null
  function floorHeader(line) {
    let m = FLOOR_COMPACT.exec(line);
    if (m) return { floor: compactFloor(m), rest: '' };
    m = FLOOR_COMPACT_HEAD.exec(line);
    if (m) return { floor: compactFloor(m), rest: line.slice(m[0].length).replace(/^[\s:\uFF1A\-–|,]+/, '').trim() };
    m = FLOOR_START.exec(line);
    if (m && m[8] && /^basement$/i.test(m[8]) && /^\s*[A-Za-z0-9\u0E00-\u0E7F]/.test(line.slice(m[0].length))) m = null;   // "Basement parking: ..." = ห้อง ไม่ใช่หัวชั้น
    if (m) { const r = floorFromMatch(m, 0); return { floor: r.floor, range: r.range, rest: line.slice(m[0].length).replace(/^[\s:\uFF1A\-–|,.]+/, '').trim() }; }
    const ci = line.search(/[:\uFF1A]/);
    if (ci > 0) {
      const head = line.slice(0, ci);
      m = FLOOR_ANY.exec(head);
      if (m && (m[5] || (m[9] && /basement/i.test(m[9])) || (m[4] && /ใต้ดิน/.test(m[4])))) m = null;   // ใต้ดิน/basement ในชื่อห้อง = ห้องส่วนกลาง ไม่เปลี่ยนชั้นถาวร
      if (m) {
        const r = floorFromMatch(m, 1);
        const cut = head.slice(0, m.index + m[1].length) + ' ' + head.slice(m.index + m[0].length);
        const left = cut.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s+/g, ' ').trim();
        return { floor: r.floor, range: r.range, rest: (left ? left + ':' : '') + line.slice(ci + 1).trim(), headCut: true };
      }
    }
    return null;
  }

  /* ---------------- ชนิดหลอด ---------------- */
  function lampPools(text) {
    const t = text.toLowerCase();
    const by = (p) => D.LAMPS.filter((l) => l.id.startsWith(p));
    if (/hps|โซเดียม|sodium/.test(t)) return [by('hps')];
    if (/metal\s*halide|เมทัล/.test(t)) return [by('mh')];
    if (/mercury|แสงจันทร์/.test(t)) return [by('mv')];
    const fluor = /fluorescent|ฟลูออ|นีออน|neon/.test(t);
    if (fluor && /t5/.test(t)) return [by('t5')];
    if (/(^|[^a-z])t5(?![a-z])/.test(t) && !/led/.test(t)) return [by('t5')];
    if (fluor) return [by('t8-')];
    if (/circ|กลม/.test(t)) return [by('circ')];
    if (/cfl|ตะเกียบ/.test(t)) return [by('cfl')];
    if (/(^|[^a-z])pl(?![a-z])/.test(t)) return [by('pl-')];
    if (/bulb|downlight|ดาวน์?ไลท์|ดาวน์ไลต์|กระเปาะ|spot/.test(t)) return [by('led-bulb-')];
    const led = [by('led-t8'), by('led-bulb-'), by('led-bulbh-')];
    if (/(^|[^a-z])t8(?![a-z])|tube|หลอดยาว/.test(t)) return [by('led-t8'), by('t8-')];
    return /led/.test(t) ? led : led.concat([by('t8-'), by('t5-')]);
  }
  // เลือกหลอดที่ใกล้ที่สุด: ตรงเป๊ะก่อน → ปัดขึ้นไม่เกิน 1.5 เท่า+3W → ปัดลงไม่ต่ำกว่า 80% → ไม่มี (null)
  function pickLamp(pools, w) {
    const all = [].concat(...pools);
    // ไม่ระบุวัตต์: หลอดยาวใช้ 18 W, หลอดกลม/ดาวน์ไลท์ใช้ขนาดที่ใกล้ 10 W ที่สุด (ไม่ใช่ตัวเล็กสุดในตาราง)
    if (!w) { for (const p of pools) { const l = p.find((x) => x.w === 18) || p.slice().sort((a, b) => Math.abs(a.w - 10) - Math.abs(b.w - 10))[0]; if (l) return l; } return null; }
    const exact = all.find((l) => Math.abs(l.w - w) < 0.01);
    if (exact) return exact;
    const up = all.filter((l) => l.w > w && l.w <= w * 1.5 + 3).sort((a, b) => a.w - b.w)[0];
    if (up) return up;
    const down = all.filter((l) => l.w < w && l.w >= w * 0.8).sort((a, b) => b.w - a.w)[0];
    return down || null;
  }
  function lampFor(text, w) { return pickLamp(lampPools(text), w); }

  /* ---------------- แอร์ / มอเตอร์ / ลิฟต์ ---------------- */
  function snapAC(btu, phase) {
    let ph = phase === 1 || phase === 3 ? phase : (btu >= 36000 ? 3 : 1);
    if (ph === 1 && btu > 40000) ph = 3;
    if (ph === 3 && btu < 35999) ph = 1;   // ตาราง 6.5 (3 เฟส) เริ่มที่ 36,000 BTU — เล็กกว่านั้นไม่ปัดขึ้นเป็นแอร์ 3 เฟส
    const tbl = ph === 3 ? D.AC_3P : D.AC_1P;
    const hit = tbl.find((r) => r[0] >= btu - 1);
    return { btu: (hit || tbl[tbl.length - 1])[0], phases: ph, over: !hit };
  }
  const BTU_RE = nrx(U_BTU);
  // เศษส่วนแรงม้า: "1 1/2 HP" / "1/2 HP" → ทศนิยม (ก่อนหาค่า HP)
  function fixFractions(st) {
    st.s = st.s.replace(new RegExp('(^|[^\\d.,/])(?:(\\d{1,2})\\s{1,3})?(\\d{1,2})\\s{0,2}/\\s{0,2}(\\d{1,2})(?=\\s{0,3}(?:hp|แรงม้า|แรงม้ำ))', 'gi'), (m, p, w, a, b) => (b > 0 ? p + String(Math.round(((w ? Number(w) : 0) + a / b) * 1000) / 1000) : m));
  }
  function btuFrom(st) {
    let m = take(st, BTU_RE);
    if (m) {
      let v = toNum(m[2]);
      if (m[3]) v *= 1000;
      else if (/^\d{1,3}\.\d{3}$/.test(m[2])) v = Number(m[2].replace('.', ''));   // OCR: "24.000" = 24,000
      return v;
    }
    m = take(st, nrx(U_TR));
    if (m) return toNum(m[2]) * 12000;
    m = take(st, nrx(U_HP));
    if (m) return { hp: toNum(m[2]) * 9000 };
    return null;
  }

  /* ---------------- แยกรายการ (1 segment = 1 แถว) ---------------- */
  function trimPunct(s) { return s.replace(/^[\s,;:()\[\]\-–|/.]+|[\s,;:()\[\]\-–|/.]+$/g, ''); }

  function parseSegment(seg, ctx, warn) {
    const src = String(seg).trim();
    const type = classify(src);
    if (!type) return null;
    warn = warn || (() => {});
    const st = { s: src };
    const row = { type, floor: ctx.floor, room: ctx.room, area: ctx.area, src, name: '' };
    if (ctx.central) row.central = true;
    const why = [];
    const A = take(st, AREA_RE); if (A) row.area = toNum(A[2]);
    const ph = extractPhase(st);
    st.s = st.s.replace(DIM_RE, (m, p) => (p || '') + ' ');
    const L = take(st, LEN_RE); if (L) row.length = toNum(L[2]);
    fixFractions(st);
    const num = (tail) => { const m = take(st, nrx(tail)); return m ? toNum(m[2]) : null; };
    const premask = () => { for (const re of Q_SPEC_MASKS) mask(st, re); };

    if (type === 'light') {
      const ratio = take(st, /(^|[^\d.,])(\d{1,2})\s{0,3}หลอด\s{0,3}(?:\/|ต่อ)\s{0,3}(?:\d{1,2}\s{0,3})?โคม/);
      let per = ratio ? Number(ratio[2]) : null, w = 0, combo = null;
      const cm = take(st, new RegExp(NUMPRE + '(\\d{1,4})\\s{0,3}[x×*]\\s{0,3}' + NUM + '\\s{0,3}(?:w|watts?|วัตต์?)(?![A-Za-z0-9])', 'i'));
      if (cm) { combo = Number(cm[2]); w = toNum(cm[3]); } else { const v = num(U_W); if (v != null) w = v; }
      let fixtures = null, lamps = null;
      premask();
      const g = findQty(st, null, false);
      if (g) fixtures = g.n;
      if (fixtures == null) { const f = take(st, Q_FIX); if (f) fixtures = toNum(f[2]); }
      const lm = take(st, Q_LAMP); if (lm) lamps = toNum(lm[2]);
      if (fixtures == null && lamps == null) { const l = findQty(st, null, true); if (l) fixtures = l.n; }
      if (combo != null) {
        if (fixtures != null || lamps != null) per = per || combo;
        else if (combo >= 5) { fixtures = combo; per = per || 1; }
        else per = per || combo;
      }
      if (lamps != null && fixtures != null) per = per || lamps;
      else if (lamps != null && fixtures == null) { fixtures = lamps; per = per || 1; }
      per = per || 1;
      fixtures = checkQty(fixtures, 'โคม', warn);
      if (fixtures == null) return dropped(row, warn);
      per = Math.max(1, Math.min(per, 12));
      const lamp = lampFor(src, w);
      if (lamp) Object.assign(row, { lamp: lamp.id, perFixture: per, fixtures, lampLabel: lamp.label });
      else {
        // ไม่มีหลอดขนาดนี้ในตาราง → โหลดกำหนดเอง หมวดแสงสว่าง (ไม่ปัดเป็นหลอดเล็กผิดขนาด)
        Object.assign(row, { type: 'custom', cat: 'light', watt: w * per, pf: /hps|mh|metal|sodium|mercury|โซเดียม/i.test(src) ? 0.85 : 0.9, phases: 1, qty: fixtures });
        why.push(`หลอด ${w} W ไม่มีในตาราง 6.1–6.3 — ใช้เป็นโหลดกำหนดเอง ${w * per} W/โคม`);
      }
    } else {
      const q = (unitRe) => { premask(); const r = findQty(st, unitRe); return r ? r.n : null; };
      if (type === 'rec') {
        const pv = take(st, nrx('\\s{0,3}(?:va|w|วัตต์?)\\s{0,3}(?:/|ต่อ)\\s{0,3}(?:จุด|ช่อง|points?|pts?|ที่)(?![A-Za-z0-9])'));
        if (pv) row.vaPerPoint = toNum(pv[2]);
        // "เต้ารับ 2 ช่อง 4 จุด" / "2-gang 6 points": จำนวนช่องต่อเต้ารับไม่ใช่จำนวนจุด เมื่อมีจำนวนจุดระบุไว้ด้วย
        if (/\d\s{0,3}(?:จุด|ที่|ชุด|ตัว|points?|pts?|nos?|sets?|pcs?)(?![A-Za-z0-9])/i.test(st.s)) mask(st, new RegExp(NUMPRE + '\\d{1,2}\\s{0,3}(?:ช่อง|-?\\s{0,2}gangs?)(?![A-Za-z0-9])', 'gi'));
        const pts = checkQty(q(Q_UNIT_REC), 'เต้ารับ', warn);
        if (pts == null) return dropped(row, warn);
        row.points = pts;
        row.wet = /ห้องน้ำ|ครัว|เปียก|ภายนอก|ใต้ดิน|(?:^|[^A-Za-z])(?:outdoors?|toilets?|kitchens?|wet|bath(?:room)?s?)(?![A-Za-z])/i.test(src + ' ' + (ctx.room || ''));
      } else if (type === 'ac') {
        const b = btuFrom(st);
        const hp = b && typeof b === 'object' ? b.hp : null;
        const btu = hp != null ? hp : (b == null ? null : b);
        mask(st, new RegExp(NUMPRE + '\\d{1,4}\\s{0,2}(?:hp|แรงม้า)(?![A-Za-z0-9])', 'gi'));
        const n = checkQty(q(Q_UNIT), 'เครื่อง', warn);
        if (n == null) return dropped(row, warn);
        const s = snapAC(btu != null ? btu : (row.area ? row.area * 900 : 12000), ph);
        Object.assign(row, { btu: s.btu, qty: n, est: btu == null || hp != null, phases: s.phases });
        if (btu == null) why.push(row.area ? `${row.area} ตร.ม. × 900 BTU/ตร.ม.` : 'ไม่ระบุ BTU — ใช้ 12,000 BTU โดยประมาณ');
        else if (hp != null) why.push(`${hp / 9000} HP × 9,000 BTU/HP (ประมาณ)`);
        if (s.over) row.flag = 'BTU เกินตาราง 6.5 — ใช้ค่าสูงสุดในตาราง';
      } else if (type === 'heater' || type === 'cook') {
        const kw = num(U_KW);
        const w = kw != null ? kw * 1000 : num(U_W);
        const n = checkQty(q(Q_UNIT), 'เครื่อง', warn);
        if (n == null) return dropped(row, warn);
        const watt = w != null ? w : (type === 'heater' ? 3500 : 2000);
        if (w == null) { row.est = true; why.push(`ไม่ระบุกำลัง — ใช้ ${watt} W โดยประมาณ`); }
        Object.assign(row, { watt, qty: n });
        if (ph === 3) {
          if (type === 'cook') row.phases = 3;
          else Object.assign(row, { type: 'custom', cat: 'heater', pf: 1, phases: 3, rcd: true });
        }
        if (row.type === 'heater' && ph === 1) row.phases = 1;
      } else if (type === 'motor') {
        const kw = num(U_KW);
        const hp = kw != null ? null : num(U_HP);
        const wv = kw != null || hp != null ? null : num(U_W);
        let k = kw != null ? kw : hp != null ? hp * 0.746 : wv != null ? wv / 1000 : 2.2;
        if (kw == null && hp == null && wv == null) { row.est = true; why.push('ไม่ระบุกำลัง — ใช้ 2.2 kW โดยประมาณ'); }
        const n = checkQty(q(Q_UNIT), 'ตัว', warn);
        if (n == null) return dropped(row, warn);
        // พัดลมเล็ก (≤ 250 W) ไม่ใช่มอเตอร์ที่ต้องมีวงจรมอเตอร์ — เป็นโหลดกำหนดเอง 1 เฟส ตามกำลังจริง (ไม่ปัดขึ้นเป็น 0.37 kW 3 เฟส)
        if (!ph && wv != null && wv <= 250 && /พัดลม|(?:^|[^A-Za-z])fans?(?![A-Za-z])/i.test(src)) {
          Object.assign(row, { type: 'custom', cat: 'motor', watt: wv, va: '', pf: 0.8, phases: 1, qty: n });
          row.name = itemName(st.s, ctx.room) || src.slice(0, 40);
          return row;
        }
        // ไม่ระบุเฟส: มอเตอร์ไม่เกิน 0.75 kW (≤ 1 HP — ปั๊มบ้าน) ถือเป็น 1 เฟส นอกนั้น 3 เฟส
        const phases = ph || (k <= 0.75 + 1e-9 && D.MOTOR_1P.some((r) => r[0] >= k - 0.01) ? 1 : 3);
        const tbl = phases === 3 ? D.MOTOR_3P : D.MOTOR_1P;
        const hit = tbl.find((r) => r[0] >= k - 0.01);
        k = hit ? hit[0] : k;   // เกินตาราง → คงค่าเดิม (engine คำนวณนอกตารางเอง)
        Object.assign(row, { kw: k, phases, start: /(?:^|[^A-Za-z])(?:star[\s-]?delta|star|y[-/]?d|y-?delta)(?![A-Za-z])|สตาร์-?เดลต้า|y-?Δ/i.test(src) ? 'YD' : 'DOL', qty: n });
      } else if (type === 'lift') {
        const kgm = take(st, nrx(U_KG));
        const pm = take(st, nrx('\\s{0,3}(?:คน|persons?|pax|people)(?![A-Za-z0-9])'));
        const kvam = take(st, nrx(U_KVA));
        mask(st, new RegExp(NUMPRE + '\\d{1,3}\\s{0,3}(?:stops?|landings?|floors?)(?![A-Za-z0-9])', 'gi'));
        const kg = kgm ? toNum(kgm[2]) : null, p = pm ? toNum(pm[2]) : null;
        const n = checkQty(q(Q_UNIT), 'ลิฟต์', warn);
        if (n == null) return dropped(row, warn);
        let preset = 20, kva = kvam ? toNum(kvam[2]) : '';
        if (kg != null || p != null) {
          const i = D.LIFTS.findIndex((l) => (kg != null ? l[0] >= kg : l[1] >= p));
          if (i >= 0) preset = i;
          else if (!kvam) {
            // เกินตาราง 6.8: ประมาณ kVA ตามสัดส่วนของรุ่นใหญ่สุด + แจ้งเตือน
            const big = D.LIFTS[D.LIFTS.length - 1];
            kva = Math.round(big[3] * (kg != null ? kg / big[0] : p / big[1]) * 10) / 10;
            row.flag = `ลิฟต์ ${kg != null ? kg + ' kg' : p + ' คน'} เกินตาราง 6.8 (สูงสุด ${big[0]} kg) — ประมาณ ${kva} kVA ตามสัดส่วน`;
            preset = D.LIFTS.length - 1;
          }
        }
        Object.assign(row, { preset, kva, qty: n });
      } else if (type === 'esc') {
        const kvam = take(st, nrx(U_KVA));
        const n = checkQty(q(Q_UNIT), 'บันไดเลื่อน', warn);
        if (n == null) return dropped(row, warn);
        Object.assign(row, { preset: 0, kva: kvam ? toNum(kvam[2]) : '', qty: n });
      } else if (type === 'chiller') {
        const tr = take(st, nrx(U_TR));
        const kvam = take(st, nrx(U_KVA));
        const n = checkQty(q(Q_UNIT), 'เครื่อง', warn);
        if (n == null) return dropped(row, warn);
        const air = /air[\s-]{0,2}cool|ระบายความร้อนด้วยอากาศ|(?:^|[^A-Za-z])air(?![A-Za-z])/i.test(src) && !/water[\s-]{0,2}cool/i.test(src);
        const tbl = air ? D.CHILLER_AIR : D.CHILLER_WATER;
        let preset = 0, kva = kvam ? toNum(kvam[2]) : '';
        if (tr) {
          const v = toNum(tr[2]);
          const i = tbl.findIndex((c) => c[0] >= v);
          if (i >= 0) preset = i;
          else if (!kvam) {
            const big = tbl[tbl.length - 1];
            kva = Math.round(big[1] * v / big[0] * 10) / 10;
            row.flag = `ชิลเลอร์ ${v} TR เกินตาราง ${air ? '6.7' : '6.6'} (สูงสุด ${big[0]} TR) — ประมาณ ${kva} kVA ตามสัดส่วน`;
            preset = tbl.length - 1;
          }
        }
        Object.assign(row, { cooling: air ? 'air' : 'water', preset, kva, qty: n });
      } else if (type === 'ev') {
        // ที่ชาร์จรถไฟฟ้า: kW ตรงกับรุ่นมาตรฐาน (7.4 / 11 / 22) → preset ; ไม่ตรง → kW กำหนดเอง ; ไม่ระบุ → 7.4 kW
        const kw = num(U_KW);
        const n = checkQty(q(Q_UNIT), 'เครื่อง', warn);
        if (n == null) return dropped(row, warn);
        const i = kw == null ? 0 : D.EV_CHARGERS.findIndex((e) => Math.abs(e[0] - kw) < 0.05 && (!ph || e[1] === ph));
        if (kw == null) { row.est = true; why.push(`ไม่ระบุกำลัง — ใช้ ${D.EV_CHARGERS[0][0]} kW 1 เฟส โดยประมาณ`); }
        if (i >= 0) Object.assign(row, { preset: i, kw: '', phases: D.EV_CHARGERS[i][1], qty: n });
        else Object.assign(row, { preset: 0, kw, phases: ph || (kw > 7.4 ? 3 : 1), qty: n });
      } else {
        // custom: kW / kVA / VA / W / pf / เฟส
        const kvam = take(st, nrx(U_KVA));
        const kw = num(U_KW);
        const vam = take(st, nrx(U_VA));
        const w = num(U_W);
        const pfm = take(st, PF_RE);
        const n = checkQty(q(Q_UNIT), '', warn);
        if (n == null) return dropped(row, warn);
        let pf = 1;
        if (pfm) { pf = /%/.test(pfm[2]) ? parseFloat(pfm[2]) / 100 : parseFloat(pfm[2]); if (!(pf > 0.3 && pf <= 1)) pf = 1; }
        const watt = kw != null ? kw * 1000 : w != null ? w : '';
        const va = kvam ? toNum(kvam[2]) * 1000 : vam ? toNum(vam[2]) : (kw != null || w != null ? '' : 1000);
        if (va === 1000 && watt === '') { row.est = true; why.push('ไม่ระบุกำลัง — ใช้ 1,000 VA โดยประมาณ'); }
        Object.assign(row, { watt, va, pf, phases: ph === 3 ? 3 : 1, qty: n });
      }
    }
    if (why.length) row.why = why.join(' ; ');
    mask(st, new RegExp(NUMPRE + '\\d{1,3}\\s{0,2}(?:สาย|wires?)(?![A-Za-z0-9])', 'gi'));
    row.name = itemName(st.s, ctx.room) || src.slice(0, 40);
    return row;
  }
  function dropped(row, warn) { return { dropped: true, src: row.src }; }

  function itemName(rest, room) {
    const o = { s: rest };
    for (const re of Q_SPEC_MASKS) mask(o, re);
    rest = o.s.replace(/[:\uFF1A]/g, ' ');
    let n = trimPunct(rest.replace(/(?:^|\s)[x×*](?=\s|$)/gi, ' ').replace(/\s+/g, ' '));
    if (n.length > 40) n = n.slice(0, 40) + '…';
    return room ? (n && n !== room ? `${room} · ${n}` : room) : n;
  }

  // ประมาณโหลดจากพื้นที่ห้อง (ข้อกำหนดออกแบบ 67: 7 W/ตร.ม., ทางเดิน 3–5, ห้องน้ำ 3–4; แอร์ 800–1,000 BTU/ตร.ม.)
  function estimateRoom(ctx) {
    const A = Number(ctx.area);
    if (!(A > 0) || !isFinite(A)) return [];
    const rule = ROOM_RULES.find((r) => r.re.test(ctx.room || ''));
    const rows = [];
    const small = A < 10 || ['toilet', 'corridor', 'service'].includes(rule.kind);
    const lamp = small ? D.LAMPS.find((l) => l.id === 'led-t8-9') : D.LAMPS.find((l) => l.id === 'led-t8-18');
    const per = small ? 1 : 2;
    const fixtures = Math.min(LIMITS.qty, Math.max(1, Math.ceil(A * rule.wpm / (lamp.w * per))));
    const base = { floor: ctx.floor, room: ctx.room, area: A, est: true, src: `${ctx.room} ${A} ตร.ม. (ประมาณจากพื้นที่)` };
    if (ctx.central) base.central = true;
    rows.push(Object.assign({}, base, { type: 'light', name: ctx.room, lamp: lamp.id, perFixture: per, fixtures, lampLabel: lamp.label, why: `${A} ตร.ม. × ${rule.wpm} W/ตร.ม. ÷ (${lamp.w} W × ${per})` }));
    const recPts = rule.rec ? Math.min(LIMITS.qty, Math.max(1, Math.ceil(A / rule.rec))) : 0;
    if (recPts) rows.push(Object.assign({}, base, { type: 'rec', name: ctx.room, points: recPts, wet: rule.kind === 'kitchen', why: `1 จุด ต่อ ${rule.rec} ตร.ม.` }));
    if (rule.wet && rule.kind === 'toilet') rows.push(Object.assign({}, base, { type: 'rec', name: ctx.room + ' (เปียก)', points: rule.wet, wet: true, why: 'เต้ารับห้องน้ำ + RCBO' }));
    if (rule.ac && A >= 9) {
      const need = A * (rule.btuK || 900);
      const s = snapAC(need);
      let qty = 1, btu = s.btu;
      if (need > 60000) { qty = Math.min(LIMITS.qty, Math.ceil(need / 36000)); btu = snapAC(need / qty).btu; }
      rows.push(Object.assign({}, base, { type: 'ac', name: ctx.room, btu, qty, why: `${A} ตร.ม. × ${rule.btuK || 900} BTU/ตร.ม. ≈ ${Math.round(need).toLocaleString('en-US')} BTU` }));
    }
    return rows;
  }

  /* ---------------- ตารางโหลดแบบ Panel Board Schedule ----------------
   * แถวตาราง:  <เลขวงจร> <รายการ> <ขั้ว> <AT> <MCB|RCBO|MCCB> <IC> <สาย> <ชนิดสาย> <ท่อ> <ชนิดท่อ> <VA…>
   * ไม่สนใจคอลัมน์ตรงกลาง (OCR มักเพี้ยน) ใช้แค่: คำอธิบาย + ขั้ว + ชนิด CB + ตัวเลขหลังชนิดท่อ (VA)
   */
  const SUMMARY_LINE = /^\s*(LIGHTING|RECEPTACLE|PUMP|WATER\s{0,3}HEATER|A\/C|OTHER|SPARE|PHASE\s{0,3}[ABC]|UNBALANCE|MAX\s{0,3}DEMAND|I\s{0,3}F)(?![A-Za-z])\s{0,3}[=:]\s{0,3}[-–]?\s{0,3}[\d,.]{0,20}\s{0,3}(?:VA|%|A)?\s*$/i;
  const HEADER_LINE = /^\s*(PANEL\s{0,3}NO|CAPACITY|PROJECT|FROM(?![A-Za-z])|MAIN\s{0,3}(?:BUS|CIRCUIT)|LOCATION|MOUNTING|IC\s{0,3}(?:>|≥|=)|CKT|DESCRIPTION|FEEDER\s{0,3}(?:CABLE|CB)|NOTE|TOTAL\s{0,3}CONNECTED|\d{2,3}\/\d{2,3}\s{0,3}V.{0,60}SCHEDULE|.{0,80}PANEL\s{0,3}BOARD\s{0,3}SCHEDULE)/i;
  const CAT_OF = { light: 'light', rec: 'rec', ac: 'ac', heater: 'heater', cook: 'cook', motor: 'motor' };
  const CKT_NO = '(\\d{1,3}(?:\\s{0,2}[,\\-–&]\\s{0,2}\\d{1,3}){0,5})';
  const SCHED_ROW = new RegExp('^\\s*' + CKT_NO + '[\\s.|)]{1,6}(.{1,1400})$');
  const CB_RE = /(^|[\s|])(MCB|RCBO|MCCB|RCD|ELCB|ACB)(?![A-Za-z])/i;
  const WIRE_RE = /(^|[\s|])(?:\d{1,2}\s{0,2}x\s{0,2}\d|IEC\s{0,2}0?1|THW|NYY|CV(?![A-Za-z])|EMT(?![A-Za-z])|IMC(?![A-Za-z])|RSC(?![A-Za-z])|PVC(?![A-Za-z])|HDPE)/i;
  const CD_RE = /(^|[\s|"'])(EMT|IMC|RSC|PVC|HDPE|GI)(?![A-Za-z])/i;
  const SPARE_DESC = /^(spare|space|ว่าง)(?![A-Za-z0-9ก-\u0E59])/i;

  function scheduleRow(o) {
    const type = o.type || classify(o.name) || 'custom';
    const r = {
      type, sched: true, floor: o.floor, room: o.panelName || '', name: o.name, panelName: o.panelName || '', va: o.va, qty: 1,
      cat: CAT_OF[type] || 'other', phases: o.poles === 3 ? 3 : 1, rcd: !!o.rcd, at: o.at || null, src: o.src || o.name
    };
    if (o.ckt) r.ckt = o.ckt;
    if (o.why) r.why = o.why;
    return r;
  }
  function parseScheduleRow(line, ctx, warn, info) {
    const m = SCHED_ROW.exec(line);
    if (!m) return null;
    const ckt = m[1].replace(/\s+/g, '');
    const rest = m[2];
    const cb = CB_RE.exec(rest);
    let anchor = -1, cbLen = 0;
    if (cb) { anchor = cb.index + cb[1].length; cbLen = cb[2].length; }
    else if (info.schedMode) { const w = WIRE_RE.exec(rest); if (w) anchor = w.index + w[1].length; }
    if (anchor < 0) return null;
    const pre = rest.slice(0, anchor).replace(/[\s|]+$/, '');
    const pm = (cb ? /^(.*?)[\s|]+([1-4])[\s|]+(\d{1,4})$/ : /^(.*?)[\s|]+([1-4])[\s|]+(\d{1,4})(?:[\s|]+\d{1,3})?$/).exec(pre);
    if (!pm) return null;
    const desc = pm[1].trim().replace(/^[|\s]+|[|\s]+$/g, '');
    const poles = Number(pm[2]);
    if (/^↳/.test(desc) || /\(3P\)\s*$/.test(desc)) return { skip: true };
    if (SPARE_DESC.test(desc)) return { skip: true };
    const post = rest.slice(anchor + cbLen);
    const cd = CD_RE.exec(post);
    let nums;
    if (cd) nums = (post.slice(cd.index + cd[0].length).match(/\d[\d,]{0,12}(?:\.\d{1,4})?/g) || []).map((x) => Number(x.replace(/,/g, '')));
    else { const all = post.match(/\d[\d,]{0,12}(?:\.\d{1,4})?/g) || []; nums = all.length ? [Number(all[all.length - 1].replace(/,/g, ''))] : []; }
    nums = nums.filter((v) => v >= 10);
    if (!nums.length) { warn(`วงจร ${ckt} "${desc.slice(0, 40)}": อ่านค่า VA ไม่ได้ — ข้ามแถวนี้ (ตรวจแถวนี้ในตาราง)`); return { skip: true, warned: true }; }
    const va = nums.reduce((a, b) => a + b, 0);
    let why = '';
    if (poles === 3 && nums.length === 1) why = `3 ขั้วแต่ตารางมีค่า VA เดียว (${va.toLocaleString('en-US')}) — ถือเป็น VA รวมของเบรกเกอร์`;
    else if (poles === 3 && nums.length >= 2) why = `3 ขั้ว รวม VA ทุกเฟส (${nums.map((x) => x.toLocaleString('en-US')).join(' + ')})`;
    return scheduleRow({ name: desc, va, poles, ckt, why, rcd: /RCBO|RCD|ELCB/i.test(cb ? cb[2] : ''), floor: ctx.floor, panelName: ctx.panelName, src: line.trim() });
  }
  // บรรทัดหัวตาราง/สรุปท้ายตาราง: ดึงชื่อแผง ชื่อโครงการ ชั้น ยอดรวม แล้วข้าม
  const HDR_TOKENS = /(?:^|[^A-Za-z])(POLE|TYPE|SIZE|CONDUIT|WIRE|DESCRIPTION|CKT|CONNECTED\s{0,3}LOAD)(?![A-Za-z])/gi;
  const SUM_TOKENS = /(?:^|[^A-Za-z])(RECEPTACLE|LIGHTING|WATER\s{0,3}HEATER|UNBALANCE|MAX\s{0,3}DEMAND|PHASE\s{0,3}[ABC]|FEEDER\s{0,3}C(?:ABLE|B))(?![A-Za-z])/i;
  function headerInfo(line, info) {
    let x;
    if ((x = /PANEL\s{0,3}NO\.?\s{0,3}[:\uFF1A]?\s{0,3}([A-Za-z0-9][A-Za-z0-9\-_/]{0,40})/i.exec(line))) info.panel = x[1];
    if ((x = /PROJECT\s{0,3}[:\uFF1A]?\s{0,3}(.{1,200}?)(?=\s+(?:LOCATION|MOUNTING|CAPACITY|FROM|MAIN|ประเภท)(?![A-Za-z])|$)/i.exec(line))) info.project = x[1].trim();
    if ((x = /LOCATION\s{0,3}[:\uFF1A]?\s{0,3}(.{1,200}?)(?=\s+(?:PROJECT|MOUNTING|CAPACITY|FROM|MAIN)(?![A-Za-z])|$)/i.exec(line))) { info.location = x[1].trim(); const fh = floorHeader(x[1].trim()); if (fh) info.floor = fh.floor; }
    if ((x = /TOTAL\s{0,3}CONNECTED\s{0,3}LOAD\s{0,3}[:\uFF1A]?\s{0,3}([\d,]{1,15})/i.exec(line))) info.total = Number(x[1].replace(/,/g, ''));
    // บรรทัดหัว/สรุปของตาราง (ไม่ใช่รายการโหลด) — OCR มักรวมหลายคอลัมน์ไว้บรรทัดเดียว จึงเช็กหลายแบบ
    const hdrCount = (line.match(HDR_TOKENS) || []).length;
    if (hdrCount >= 2 || /PANEL\s{0,3}NO|PANEL\s{0,3}BOARD\s{0,3}SCHEDULE/i.test(line)) info.schedMode = true;
    return HEADER_LINE.test(line) || SUMMARY_LINE.test(line) || hdrCount >= 2 || (info.schedMode && SUM_TOKENS.test(line) && /[=:]|(?:^|[^A-Za-z])VA(?![A-Za-z])/.test(line));
  }

  /* ---------------- แก้ OCR ภาษาไทย ---------------- */
  // สระอำ/ไม้โท หาย, W อ่านเป็น หป ฯลฯ — ทุก regex เป็นเชิงเส้น (ไม่มี \s+ ตามด้วย lookahead)
  function ocrFix(t) {
    let s = String(t == null ? '' : t);
    if (s.length > LIMITS.text) s = s.slice(0, LIMITS.text);
    return s
      .replace(/\u0000/g, '')
      .replace(/(\d{1,3}),[Oo]{3}(?![A-Za-z0-9])/g, '$1,000')
      .replace(/[ \t]{2,}/g, ' ').replace(/ (?=[ัำ-ฺ็-๎])/g, '')
      .replace(/ํา/g, 'ำ')
      .replace(/ชัน(?=[ \t]{0,3}(?:ที่[ \t]{0,3})?\d)/g, 'ชั้น')   // PDF/OCR มักทำไม้โทหาย: "ชัน 2" → "ชั้น 2" (เฉพาะที่ตามด้วยเลข)
      .replace(/(^|[^ห])น้า(?!ที่|ต่าง)/g, '$1น้ำ').replace(/นํ้า|นำ้/g, 'น้ำ')
      .replace(/ทํา|ทำา/g, 'ทำ').replace(/ปั[ม]+(?=\s{0,3}น้ำ)/g, 'ปั๊ม').replace(/ปัม(?!ป)/g, 'ปั๊ม')
      .replace(/(\d)[ \t]{0,3}(?:หป|ห[ \t]{0,3}ป|VV|vv)(?=[ \t]|$|,)/gm, '$1W')
      .replace(/(\d)[ \t]{0,3}(?:am|aw|จด)(?=[ \t]|,|$)/gm, '$1 จุด')
      .replace(/(\d)[ \t]{0,2}(?:8TU|BTV|B7U|BIU|8tu)(?![A-Za-z])/g, '$1 BTU')
      .replace(/(\d)[ \t]{0,2}(?:KVV|kVV|KW(?=[ \t]|,|$))/gm, '$1 kW')
      .replace(/(\d)[ \t]{0,2}(?:KVA|kVa|KVa)(?![A-Za-z])/g, '$1 kVA')
      .replace(/(^|[^A-Za-z])LEO(?![A-Za-z])/g, '$1LED')
      .replace(/ตร[ \t]{0,3}\.[ \t]{0,3}ม[ \t]{0,3}\./g, 'ตร.ม.')
      .replace(/ห้องนำ(?!เสนอ|ทาง|เข้า|เที่ยว|พา|ชม)/g, 'ห้องน้ำ').replace(/นำ(?=อุ่น|ร้อน|ดี|ทิ้ง|ประปา)/g, 'น้ำ').replace(/ปั๊?มนำ/g, 'ปั๊มน้ำ').replace(/เครือง/g, 'เครื่อง').replace(/ลิฟท์?/g, 'ลิฟต์');
  }

  const PAGE_MARKER = /^[-–—=_~*#\s]*(?:(?:หน้า|หน้ำ|page|pg\.?|p\.)\s{0,3}\d{1,4}(?:\s{0,3}(?:\/|of|จาก)\s{0,3}\d{1,4})?)?[-–—=_~*#\s]*$/i;
  const isPageMarker = (line) => PAGE_MARKER.test(line) && (/[-–—=_~*#]{2,}/.test(line) || /^\s*(?:หน้า|หน้ำ|page|pg\.?)\s{0,3}\d{1,4}(?:\s{0,3}(?:\/|of|จาก)\s{0,3}\d{1,4})?\s*$/i.test(line));

  /* ---------------- ตัวอ่านทีละบรรทัด/ทีละเซลล์ (ใช้ร่วมกันทั้งข้อความและตาราง) ---------------- */
  function Parser(warnings) {
    const rows = [];
    const S = { floor: 1, room: '', area: null, roomHasItems: true, roomCentral: false, sect: false };
    const warn = (m) => warnings.push(m);
    const central = () => S.sect || S.roomCentral;
    const ctx = () => ({ floor: S.roomCentral ? 0 : S.floor, room: S.room, area: S.area, central: central() });
    const P = {
      rows, S,
      flush() {
        if (S.room && !S.roomHasItems) {
          if (S.area) rows.push(...estimateRoom({ floor: S.roomCentral ? 0 : S.floor, room: S.room, area: S.area, central: central() }));
          else warn(`"${S.room.slice(0, 50)}" ไม่มีรายการโหลดและไม่ระบุพื้นที่ — ข้าม (อ่านไม่ออกหรือเป็นหัวข้อ?)`);
        }
        S.room = ''; S.area = null; S.roomHasItems = true; S.roomCentral = false;
      },
      setFloor(f) { P.flush(); S.floor = f; S.sect = f <= 0; S.room = ''; S.area = null; S.roomHasItems = true; S.roomCentral = false; },
      setSection() { P.flush(); S.sect = true; S.floor = 0; S.room = 'ส่วนกลาง'; S.area = null; S.roomHasItems = true; S.roomCentral = false; },
      setRoom(name, area) { P.flush(); S.room = name; S.area = area || null; S.roomHasItems = false; S.roomCentral = CENTRAL.test(name); },
      setArea(a) { S.area = a; },
      hasRoom() { return !!S.room; },
      room() { return S.room; },
      // เพิ่มรายการจาก segment — คืน true ถ้าเป็นรายการโหลด
      addSegment(seg, wrap) {
        const w = wrap || warn;
        const r = parseSegment(seg, ctx(), w);
        S.roomHasItems = true;
        if (!r) return false;
        if (r.dropped) return true;
        rows.push(r);
        return true;
      },
      add(r) { rows.push(r); S.roomHasItems = true; }
    };
    return P;
  }

  // เลขหัวข้อหลายระดับ "1.1 ล็อบบี้" (ไม่ตัดเลขทศนิยมที่นำหน้าหน่วย เช่น "5.5 kW")
  const LIST_NO = /^\d{1,2}(?:\.\d{1,2}){1,2}[.)]?\s+(?=[A-Za-zก-๙])(?!(?:kw|kva|va|w|hp|btu|tr|kg|ton|ตัน|แรงม้า|วัตต์|ตร|เมตร)(?![A-Za-z]))/i;
  const CLEAN_BULLET =/^(?:[•●▪■◆○◦·]|[-–—*])\s+/;
  const SEG_SPLIT = /\s*,\s*|\s*[;|]\s*|\s+และ\s+|\s+\+\s+/;
  // คอมมาที่เป็นตัวคั่นหลักพัน (24,000) ไม่ใช่ตัวคั่นรายการ
  function splitSegments(body) {
    const prot = body.replace(/(\d),(?=\d{3}(?!\d))/g, '$1\u0001').replace(/(\d),(?=\d{1,2}\s{0,3}(?:kw|kva|va|w|วัตต์|hp|btu|ตร|m2|tr|ตัน|kg)(?![A-Za-z]))/gi, '$1\u0002');
    const segs = prot.split(SEG_SPLIT).map((x) => x.replace(/\u0001/g, ',').replace(/\u0002/g, '.').trim()).filter(Boolean);
    const out = [];
    for (const sg of segs) {
      const bare = new RegExp('^(\\d{1,5})(?:\\s{0,3}(?:' + TH_UNITS + '|' + EN_UNITS + ')\\.?)?$', 'i').exec(sg);
      if (bare && out.length && classifyKW(out[out.length - 1]) && !/จำนวน|qty/i.test(out[out.length - 1])) out[out.length - 1] += ' จำนวน ' + bare[1];   // "โคม LED 18W,10" / "โคม LED 18W, 2 ชุด" = รายการ,จำนวน
      else out.push(...splitRun(sg));
    }
    // "แอร์ 9000 BTU, 12000 BTU อย่างละ 2 เครื่อง" → จำนวนเดียวกันทุกรายการในบรรทัด
    // ใช้กับรายการตั้งแต่ต้นบรรทัดถึงส่วนที่มีคำว่า "อย่างละ" (รายการหลังจากนั้นไม่เกี่ยว) และไม่ทับรายการที่ระบุจำนวนเองแล้ว
    const ei = out.findIndex((x) => EACH_RE.test(x));
    if (ei >= 0) {
      const m = EACH_RE.exec(out[ei]);
      out[ei] = (out[ei].slice(0, m.index) + ' ' + out[ei].slice(m.index + m[0].length)).trim();
      for (let i = 0; i <= ei; i++) if (i === ei || !HAS_COUNT.test(out[i])) out[i] += ' จำนวน ' + m[1];
    }
    // ส่วนที่มีแต่สเปก ("+ 18000 BTU 1 เครื่อง") ใช้ชื่ออุปกรณ์ของรายการก่อนหน้า
    for (let i = 1; i < out.length; i++) {
      if (!/^\d/.test(out[i]) || !SPEC_UNIT_RE.test(out[i])) continue;
      const prev = out[i - 1], name = /^[^\d]{2,40}?(?=\s{0,3}\d)/.exec(prev);
      if (name && classifyKW(name[0])) out[i] = name[0].trim() + ' ' + out[i];
    }
    return out;
  }
  const EACH_RE = /(?:อย่างละ|ชนิดละ|ขนาดละ|(?:^|\s)each\s{0,2}(?:qty)?)\s{0,3}(\d{1,4})(?:\s{0,3}(?:เครื่อง|ตัว|ชุด|จุด|โคม|ดวง|units?|sets?|nos?|pcs?)(?![A-Za-z0-9]))?/i;
  const HAS_COUNT = new RegExp('\\d\\s{0,3}(?:' + TH_UNITS + '|' + EN_UNITS + ')(?![A-Za-z0-9])|[x×*]\\s{0,3}\\d|จำนวน|qty', 'i');
  const SPEC_UNIT_RE = /^\d[\d.,]{0,12}\s{0,3}(?:k\s{0,2})?(?:w|watts?|วัตต์|kw|kva|va|btu|hp|แรงม้า|tr|ตัน)(?![A-Za-z0-9])/i;
  // รายการหลายตัวในส่วนเดียวที่ไม่มีคอมมาคั่น: "โคม 18W 2 ชุด เครื่องทำน้ำอุ่น 4500W 1 เครื่อง" → ตัดหลัง "<จำนวน> <หน่วยนับ>"
  // เมื่อข้อความต่อไปขึ้นต้นด้วยตัวอักษร เป็นคำอุปกรณ์ มีตัวเลข และไม่ใช่ชื่อห้อง
  const RUN_CUT = new RegExp('\\d\\s{0,3}(?:' + TH_UNITS + '|' + EN_UNITS + ')(?![A-Za-z0-9\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E])\\.?\\s+(?=[^\\d\\s,.;:]|\\d[\\d.,]{0,12}\\s{0,3}(?:k\\s{0,2})?(?:w|watts?|วัตต์|kw|kva|va|btu|hp|แรงม้า|tr|ตัน)(?![A-Za-z0-9]))', 'gi');
  const RIGHT_QTY = new RegExp('\\d\\s{0,3}(?:' + TH_UNITS + '|' + EN_UNITS + ')(?![A-Za-z0-9])', 'i');
  function splitRun(sg) {
    if (sg.length > 400) return [sg];
    const parts = [];
    let from = 0, m;
    RUN_CUT.lastIndex = 0;
    while ((m = RUN_CUT.exec(sg))) {
      const cut = m.index + m[0].length;
      const left = sg.slice(from, cut).trim(), right = sg.slice(cut);
      const nextCut = new RegExp(RUN_CUT.source, 'gi'); nextCut.lastIndex = 0;
      const rm = nextCut.exec(right), rightItem = rm ? right.slice(0, rm.index + rm[0].length) : right;
      // ตัดเมื่อส่วนขวามีจำนวน+หน่วยนับของตัวเอง (ไม่งั้น "แอร์ 1 เครื่อง BTU 12000" / "โคม 10 ดวง LED 18W" คือสเปกของรายการเดิม)
      // และเป็นรายการ (มีคำอุปกรณ์ หรือขึ้นต้นด้วยสเปก เช่น "18000 BTU 2 เครื่อง" — ชื่อรับจากรายการก่อนหน้า)
      const rt = rightItem.trim();
      const isItem = classifyKW(rightItem) || SPEC_UNIT_RE.test(rt);
      if (classifyKW(left) && isItem && RIGHT_QTY.test(rightItem) && !/^(?:ห้อง|โซน|ต่อ|ละ|per|each|room|zone|[x×*/])/i.test(rt)) { parts.push(left); from = cut; }
    }
    parts.push(sg.slice(from).trim());
    return parts.filter(Boolean);
  }
  const hasArea = (s) => AREA_RE.test(s);
  const stripArea = (s) => s.replace(AREA_RE, (m, p) => (p || '') + ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const areaOf = (s) => { const m = AREA_RE.exec(s); return m ? toNum(m[2]) : null; };

  // ชนิดของ segment: 'item' (รายการโหลด) | 'room' (ชื่อห้อง/พื้นที่) | 'text'
  function segKind(s) {
    const kw = classifyKW(s);
    if (hasArea(s)) {
      const rest = stripArea(s);
      if (!SPEC_ANY.test(rest) && (!kw || ROOMNOUN.test(rest))) return 'room';
    }
    // ชื่อห้องที่มีคำอุปกรณ์อยู่ในชื่อ แต่ไม่มีตัวเลข/สเปกเลย (เช่น "ห้องปั๊ม", "Pump room") = ห้อง ไม่ใช่รายการ
    if (kw && !/\d/.test(s) && /^\s*(?:ห้อง|โซน)|(?:^|[^A-Za-z])(?:rooms?|zones?)\s*$/i.test(s)) return 'room';
    if (kw || classify(s)) return 'item';
    return 'text';
  }

  function feedLine(P, line, warnings) {
    const fh = floorHeader(line);
    if (fh) {
      if (fh.range != null && fh.range !== fh.floor) warnings.push(`ชั้น ${fh.floor}-${fh.range}: ใช้ชั้น ${fh.floor} (ระบุทีละชั้นเพื่อความแม่นยำ)`);
      P.setFloor(fh.floor);
      line = fh.rest;
      if (!line) return;
    }
    // หัวข้อโหลดส่วนกลางล้วน ๆ (ส่วนกลาง / Roof / ดาดฟ้า) → สลับไปโหมดส่วนกลางจนกว่าจะขึ้นชั้นใหม่
    if (/^[\s:\uFF1A\-–|,.()]*$/.test(line.replace(CENTRAL_SECT_G, ' ').replace(/โหลด|โซน|ส่วน(?!กลาง)|บริเวณ|พื้นที่|ชั้น|(?:^|[^A-Za-z])(?:zone|area|load|loads|floor|the|of)(?![A-Za-z])/gi, ' '))) { P.setSection(); return; }

    let head = '', body = line;
    const colon = /^([^:\uFF1A]{1,80})[:\uFF1A](.*)$/.exec(line);
    if (colon) { head = colon[1].trim(); body = colon[2].trim(); }
    else {
      const dash = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(line);
      if (dash && !classifyKW(dash[1]) && classify(dash[2])) { head = dash[1].trim(); body = dash[2].trim(); }
    }
    const segs = splitSegments(body);

    if (head) {
      const itemHead = classifyKW(head) && !ROOMNOUN.test(head) && !hasArea(head) && segs.length && segs.every((s) => !classifyKW(s) && !hasArea(s));
      if (itemHead) { segs.forEach((s) => P.addSegment(`${head} ${s}`)); return; }
      // หัวข้อห้อง
      let a = areaOf(head);
      const name = stripArea(head);
      const rest = [];
      for (const s of segs) {
        if (segKind(s) === 'room' && a == null) { a = areaOf(s); }
        else rest.push(s);
      }
      P.setRoom(name || head, a);
      for (const s of rest) { const k = segKind(s); if (k === 'item') P.addSegment(s); else if (k !== 'room') warnings.push(`อ่านไม่ออก: "${s.slice(0, 60)}"`); }   // 'room' ซ้ำ = พื้นที่ซ้ำ ข้ามได้
      return;
    }

    if (segs.length === 1) {
      const s = segs[0];
      const k = segKind(s);
      if (k === 'room') { P.setRoom(stripArea(s) || s, areaOf(s)); return; }
      if (k === 'item') {
        // "ห้องประชุม 40 ตร.ม. โคม LED 18W x 10" : ชื่อห้อง + พื้นที่ นำหน้ารายการ
        const am = AREA_RE.exec(s);
        if (am) {
          const left = s.slice(0, am.index + am[1].length).trim();
          const right = s.slice(am.index + am[0].length).trim();
          if (left && !classifyKW(left) && right && classify(right)) { P.setRoom(left, toNum(am[2])); P.addSegment(right); return; }
        }
        P.addSegment(s);
        return;
      }
      P.setRoom(s, null);
      return;
    }
    // หลายส่วนคั่นด้วยคอมมา: ส่วนแรกที่ไม่ใช่รายการ = ชื่อห้อง
    const kinds = segs.map(segKind);
    let start = 0;
    if (kinds[0] !== 'item' && kinds.some((k) => k === 'item')) {
      P.setRoom(stripArea(segs[0]) || segs[0], areaOf(segs[0]));
      start = 1;
    } else if (!kinds.some((k) => k === 'item')) {
      P.setRoom(line, areaOf(line));
      return;
    }
    for (let i = start; i < segs.length; i++) {
      if (kinds[i] === 'item') P.addSegment(segs[i]);
      else if (kinds[i] === 'room') { if (start === 1) P.setArea(areaOf(segs[i])); }
      else warnings.push(`อ่านไม่ออก: "${segs[i].slice(0, 60)}"`);
    }
  }

  /* ---------------- ตาราง CSV / TSV ---------------- */
  const HEADER_ROLES = {
    floor: ['ชั้น', 'ชั้นที่', 'floor', 'level', 'fl', 'flr', 'storey', 'story', 'floor no'],
    room: ['ห้อง', 'พื้นที่ใช้งาน', 'ห้อง พื้นที่', 'ห้อง โซน', 'ชื่อห้อง', 'พื้นที่ใช้สอย', 'บริเวณ', 'room', 'room name', 'zone', 'space', 'โซน', 'area name', 'location'],
    item: ['รายการ', 'อุปกรณ์', 'รายการอุปกรณ์', 'รายการโหลด', 'ชื่ออุปกรณ์', 'ชื่อรายการ', 'รายละเอียด', 'item', 'items', 'description', 'desc', 'name', 'equipment', 'load', 'item name'],
    qty: ['จำนวน', 'จำนวนเครื่อง', 'จำนวนชุด', 'จำนวนจุด', 'qty', 'quantity', 'q ty', 'amount', 'pcs', 'nos', 'no of units', 'จำนวนหน่วย'],
    watt: ['วัตต์', 'watt', 'watts', 'w', 'กำลัง', 'กำลังไฟ', 'กำลังไฟฟ้า', 'power'],
    va: ['va', 'โวลต์แอมป์'], kva: ['kva', 'เควีเอ'], kw: ['kw', 'กิโลวัตต์'], btu: ['btu', 'บีทียู'], hp: ['hp', 'แรงม้า'],
    pole: ['ขั้ว', 'pole', 'poles', 'phase', 'phases', 'เฟส', 'ph'],
    area: ['พื้นที่', 'ตร ม', 'ตรม', 'area', 'm2', 'sqm', 'ตารางเมตร', 'พื้นที่ ตร ม'],
    pf: ['pf', 'power factor', 'เพาเวอร์แฟคเตอร์'],
    perFixture: ['หลอด โคม', 'หลอดต่อโคม', 'lamps per fixture', 'lamps fixture', 'lamps', 'หลอด/โคม'],
    panel: ['แผง', 'ชื่อแผง', 'panel', 'panel no', 'panel name'],
    cat: ['ประเภท', 'ชนิด', 'type', 'category', 'หมวด'],
    note: ['หมายเหตุ', 'remark', 'remarks', 'note', 'notes', 'comment', 'ลำดับ', 'no', 'item no', '#', 'ที่']
  };
  const ROLE_LOOKUP = {};
  Object.keys(HEADER_ROLES).forEach((r) => HEADER_ROLES[r].forEach((w) => { if (!ROLE_LOOKUP[w]) ROLE_LOOKUP[w] = r; }));
  function headerRole(cell) {
    const raw = String(cell == null ? '' : cell).toLowerCase().trim();
    if (!raw || raw.length > 60) return null;
    const unit = (/\(([^)]{1,20})\)|\[([^\]]{1,20})\]/.exec(raw) || [])[1] || (/\[([^\]]{1,20})\]/.exec(raw) || [])[1] || '';
    const n = raw.replace(/\([^)]{0,30}\)|\[[^\]]{0,30}\]/g, ' ').replace(/[._:*\\\-/,]+/g, ' ').replace(/\s+/g, ' ').trim();
    let role = ROLE_LOOKUP[n] || ROLE_LOOKUP[n.replace(/ /g, '')] || null;
    if (!role) return null;
    const u = unit.toLowerCase().replace(/[\s.]/g, '');
    if (role === 'watt' && /^kw|กิโลวัตต์/.test(u)) role = 'kw';
    else if (role === 'watt' && /^va$/.test(u)) role = 'va';
    else if (role === 'watt' && /^kva/.test(u)) role = 'kva';
    if (role === 'area' && n === 'พื้นที่' && !/ตร|m2|sq|เมตร|m²/.test(u)) role = 'areaOrRoom';
    return role;
  }
  function detectHeader(rec) {
    const roles = rec.map(headerRole);
    const n = roles.filter(Boolean).length;
    const useful = roles.some((r) => r && r !== 'note');
    return n >= 2 && useful && rec.filter((c) => c).length >= 2 ? { roles, n } : null;
  }

  // RFC-4180: เครื่องหมายคำพูดครอบฟิลด์, "" = ", ขึ้นบรรทัดใหม่ในเครื่องหมายคำพูดได้
  function parseDelimited(text, delim, maxRecords) {
    const recs = []; let rec = [], cell = '', q = false, i = 0;
    const n = text.length, lim = maxRecords || LIMITS.rows;
    const pushCell = () => { rec.push((cell.length > LIMITS.line ? cell.slice(0, LIMITS.line) : cell).replace(/\s*[\r\n]+\s*/g, ' ')); cell = ''; };
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        if (cell.length <= LIMITS.line + 2) cell += c;
        i++; continue;
      }
      if (c === '"' && cell === '') { q = true; i++; continue; }
      if (c === delim) { pushCell(); i++; continue; }
      if (c === '\r' || c === '\n' || c === '\u2028' || c === '\u2029') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        pushCell(); recs.push(rec.map((x) => x.trim())); rec = [];
        if (recs.length >= lim) return recs;
        i++; continue;
      }
      if (cell.length <= LIMITS.line + 2) cell += c;
      i++;
    }
    if (cell !== '' || rec.length) { pushCell(); recs.push(rec.map((x) => x.trim())); }
    return recs;
  }
  const nonEmptyRec = (r) => r.some((c) => c !== '');

  // เดาตัวคั่นและหัวตาราง — คืน { delim, header, roles } หรือ null (ไม่ใช่ตาราง)
  function sniffTable(text) {
    const head = text.length > 30000 ? text.slice(0, 30000) : text;
    const first40 = splitLines(head).slice(0, 40).join('\n');
    if (/PANEL\s{0,3}NO|CKT\.?\s{0,3}NO|BOARD\s{0,3}SCHEDULE/i.test(first40)) return null;   // ตารางโหลดแผง ไม่ใช่ตาราง CSV
    const delims = ['\t', ';', ','];
    for (const d of delims) {
      if (head.indexOf(d) < 0) continue;
      const recs = parseDelimited(head, d, 200).filter(nonEmptyRec);
      if (!recs.length) continue;
      const hdr = detectHeader(recs[0]);
      if (hdr) return { delim: d, header: true, roles: hdr.roles };
    }
    for (const d of delims) {
      if (head.indexOf(d) < 0) continue;
      if (d === ',' && /(^|[^"\d.])\d{1,3},\d{3}(?!\d)/.test(head)) continue;
      const recs = parseDelimited(head, d, 200).filter(nonEmptyRec).slice(0, 60);
      if (!recs.length) continue;
      const w = recs.map((r) => r.length);
      const cnt = {}; w.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
      const mode = Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]);
      if (mode < 3 || cnt[mode] / recs.length < 0.7) continue;
      const roles = inferRoles(recs.filter((r) => r.length === mode), mode);
      if (roles) return { delim: d, header: false, roles };
    }
    return null;
  }
  function inferRoles(recs, cols) {
    const colVals = (c) => recs.map((r) => r[c]).filter((v) => v !== undefined && v !== '');
    const isInt = (c) => { const v = colVals(c); return v.length > 0 && v.every((x) => /^\d{1,5}$/.test(x)); };
    const kwScore = (c) => { const v = colVals(c); return v.length ? v.filter((x) => classify(x)).length / v.length : 0; };
    let itemCol = -1, best = 0.5;
    for (let c = 0; c < cols; c++) if (!isInt(c) && kwScore(c) >= best) { itemCol = c; best = kwScore(c); }
    if (itemCol < 0) return null;
    const roles = new Array(cols).fill(null);
    roles[itemCol] = 'item';
    let qtyCol = -1, floorCol = -1;
    for (let c = cols - 1; c > itemCol; c--) if (isInt(c)) { qtyCol = c; break; }
    if (isInt(0) && 0 < itemCol && colVals(0).every((x) => Number(x) <= 200)) floorCol = 0;
    if (qtyCol < 0 && floorCol < 0) return null;
    if (qtyCol >= 0) roles[qtyCol] = 'qty';
    if (floorCol >= 0) roles[floorCol] = 'floor';
    for (let c = 0; c < itemCol; c++) if (roles[c] == null && !isInt(c)) { roles[c] = 'room'; break; }
    return roles;
  }

  const cellNum = (c) => { const s = String(c == null ? '' : c).replace(/[\s,]/g, ''); return /^\d+(?:\.\d+)?$/.test(s) ? s : null; };
  function parseTableCore(text, spec, warnings, info) {
    const recs = parseDelimited(text, spec.delim).filter((r) => r.length);
    const P = Parser(warnings);
    let roles = spec.roles, start = 0;
    if (spec.header) {
      start = recs.findIndex(nonEmptyRec);
      if (start < 0) return [];
      roles = recs[start].map(headerRole);
      start++;
      if (!roles.includes('item') && !roles.includes('room')) { warnings.push('ไม่พบคอลัมน์ "รายการ" หรือ "ห้อง" ในแถวหัวตาราง — อ่านเป็นตารางไม่ได้'); return []; }
    }
    if (roles.includes('areaOrRoom')) {
      const c = roles.indexOf('areaOrRoom');
      const vals = recs.slice(start, start + 30).map((r) => r[c]).filter(Boolean);
      roles[c] = vals.length && vals.every((v) => cellNum(v) != null) ? 'area' : (roles.includes('room') ? 'note' : 'room');
    }
    const col = (r) => roles.indexOf(r);
    const cIdx = {}; ['floor', 'room', 'item', 'qty', 'watt', 'va', 'kva', 'kw', 'btu', 'hp', 'pole', 'area', 'pf', 'perFixture', 'panel', 'cat'].forEach((k) => { cIdx[k] = col(k); });
    const get = (rec, k) => (cIdx[k] >= 0 && rec[cIdx[k]] != null ? String(rec[cIdx[k]]).trim() : '');
    for (let ri = start; ri < recs.length; ri++) {
      const rec = recs[ri];
      if (!nonEmptyRec(rec)) continue;
      const rowNo = ri + 1;
      const wrap = (m) => warnings.push(`แถวที่ ${rowNo}: ${m}`);
      if (rec.length === 1 && isPageMarker(rec[0])) continue;
      const fc = get(rec, 'floor');
      if (fc) {
        const f = parseFloorToken(fc) != null ? parseFloorToken(fc) : (floorHeader(fc) || {}).floor;
        if (f != null && f !== undefined) { if (f !== P.S.floor || P.S.sect !== (f <= 0)) P.setFloor(f); }
        else wrap(`อ่านชั้น "${fc.slice(0, 20)}" ไม่ออก — ใช้ชั้นเดิม`);
      }
      const rc = get(rec, 'room'), ac = cellNum(get(rec, 'area'));
      if (rc && rc !== P.room()) P.setRoom(rc, ac != null ? Number(ac) : null);
      else if (ac != null && P.hasRoom()) P.setArea(Number(ac));
      else if (!rc && ac != null && !P.hasRoom()) P.setRoom('พื้นที่', Number(ac));
      const itemText = get(rec, 'item');
      if (!itemText) continue;
      const cat = get(rec, 'cat');
      let seg = itemText;
      if (cat && !classifyKW(itemText)) seg = `${cat} ${itemText}`;
      const isRec = classifyKW(seg) === 'rec';
      const put = (k, f) => { const v = get(rec, k); if (!v) return; const n = cellNum(v); seg += ' ' + (n != null ? f(n) : v); };
      put('watt', (n) => (isRec ? `${n}VA/จุด` : `${n}W`));
      put('kw', (n) => `${n}kW`); put('va', (n) => (isRec ? `${n}VA/จุด` : `${n}VA`)); put('kva', (n) => `${n}kVA`); put('btu', (n) => `${n}BTU`); put('hp', (n) => `${n}HP`);
      put('pf', (n) => `pf ${n}`);
      put('perFixture', (n) => `${n} หลอด/โคม`);
      const pv = get(rec, 'pole');
      if (pv) { const pn = cellNum(pv); seg += ' ' + (pn === '1' || pn === '3' ? `${pn} เฟส` : pn != null ? '' : pv); }
      const qv = get(rec, 'qty');
      if (qv) { const n = cellNum(qv); seg += ' ' + (n != null ? `จำนวน ${n}` : /\d/.test(qv) ? `จำนวน ${qv}` : qv); }
      const okSeg = classify(seg);
      if (!okSeg) { wrap(`อ่านรายการ "${itemText.slice(0, 40)}" ไม่ออก — ข้าม`); P.S.roomHasItems = true; continue; }
      const before = P.rows.length;
      P.addSegment(seg, wrap);
      const pn = get(rec, 'panel');
      if (pn) for (let k = before; k < P.rows.length; k++) P.rows[k].panelName = pn;
    }
    P.flush();
    return P.rows;
  }

  /* ---------------- parse ข้อความทั้งก้อน ---------------- */
  const newInfo = () => ({ panel: '', project: '', location: '', floor: null, total: null, sourceKind: 'empty' });
  function finishRows(rows, info, kindHint) {
    rows.forEach((r) => {
      if (['lift', 'esc', 'chiller'].includes(r.type) || (r.type === 'motor' && !r.sched && r.floor !== 0 && /ปั๊ม|pump/i.test(r.src))) r.central = true;
      if (r.floor <= 0) r.central = true;
    });
    if (rows.some((r) => r.sched)) rows.forEach((r) => { if (r.sched && !(r.floor <= 0)) r.central = false; });
    assignKeys(rows);
    const hasS = rows.some((r) => r.sched), hasO = rows.some((r) => !r.sched);
    info.sourceKind = !rows.length ? 'empty' : hasS && hasO ? 'mixed' : hasS ? 'schedule' : (kindHint || 'text');
    return rows;
  }
  function assignKeys(rows) {
    const seen = new Map();
    rows.forEach((r) => {
      const base = String(r.src == null ? '' : r.src).toLowerCase().replace(/\s+/g, ' ').trim();
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      r.key = `${base}#${n}`;
    });
  }
  // คำเตือนไม่เกิน 200 ข้อ (ข้อความขยะจำนวนมากไม่ท่วมหน้าจอ) — คำเตือนภาพรวมอยู่หน้าสุด
  function capWarnings(w, head) {
    const all = (head || []).concat(w);
    if (all.length <= 200) return all;
    return all.slice(0, 200).concat([`มีคำเตือนอีก ${(all.length - 200).toLocaleString('en-US')} ข้อ (ไม่แสดง) — ตรวจข้อความต้นฉบับ`]);
  }
  function prepare(text, warnings) {
    let raw = String(text == null ? '' : typeof text === 'string' ? text : (typeof text === 'object' ? '' : text));
    if (raw.length > LIMITS.text) { raw = raw.slice(0, LIMITS.text); warnings.push('ข้อความยาวเกิน 2 MB — อ่านเฉพาะส่วนแรก 2 MB'); }
    return normalizeText(ocrFix(raw));
  }

  function parseTextOne(text) {
    const warnings = [], info = newInfo();
    let src = prepare(text, warnings);
    const spec = sniffTable(src);
    if (spec) {
      const rows = parseTableCore(src, spec, warnings, info);
      finishRows(rows, info, 'table');
      return { rows, warnings: capWarnings(warnings), info };
    }
    const P = Parser(warnings);
    let sinceTotal = 0, inFooter = false, longLines = 0;
    for (const rawLine of splitLines(src)) {
      let line = rawLine;
      if (line.length > LIMITS.line) { line = line.slice(0, LIMITS.line); longLines++; }
      line = line.replace(/\t/g, ' | ').trim();
      if (!line) continue;
      if (isPageMarker(line)) continue;
      // ตารางโหลด (Panel Board Schedule): หัวตาราง / แถววงจร / สรุปท้ายตาราง
      info.total = null;
      const noise = headerInfo(line, info);
      if (/^\s*FEEDER\s{0,3}CABLE(?![A-Za-z])/i.test(line) && info.schedMode) inFooter = true;   // ท้ายตาราง: กล่อง Feeder + สรุปหมวด ปนกันหลายคอลัมน์
      if (/PANEL\s{0,3}NO/i.test(line)) inFooter = false;
      if (noise || inFooter) {
        if (info.floor != null) { P.setFloor(info.floor); info.floor = null; }
        if (info.total != null && sinceTotal) {
          const sum = P.rows.slice(-sinceTotal).reduce((s, r) => s + (r.va || 0), 0);
          if (Math.abs(sum - info.total) > Math.max(5, info.total * 0.01)) warnings.push(`ผลรวม VA ที่อ่านได้ ${Math.round(sum).toLocaleString('en-US')} ไม่ตรงกับ TOTAL ในตาราง ${info.total.toLocaleString('en-US')} — ตรวจแถวที่อ่านผิด`);
          else info.verified = true;
          sinceTotal = 0;
        }
        if (info.total != null) inFooter = false;
        continue;
      }
      if (/^[\s|\[(]{0,6}\d{1,3}[\s.|)]{1,6}(?:ว่าง|spare|space)(?![A-Za-z0-9ก-\u0E59])/i.test(line)) continue;   // แถวว่างในตาราง
      const sr = parseScheduleRow(line.replace(/^[\s|\[\]()!._:;]+/, ''), { floor: P.S.floor, panelName: info.panel }, (m) => warnings.push(m), info);
      if (sr) { if (!sr.skip) { P.add(sr); sinceTotal++; } continue; }
      line = line.replace(CLEAN_BULLET, '').replace(LIST_NO, '').replace(/^\d{1,3}[.)]\s+(?=\S)/, '').trim();
      if (!line) continue;
      feedLine(P, line, warnings);
    }
    P.flush();
    finishRows(P.rows, info, 'text');
    return { rows: P.rows, warnings: capWarnings(warnings, longLines ? [`มี ${longLines} บรรทัดยาวเกิน ${LIMITS.line.toLocaleString('en-US')} ตัวอักษร — ตัดทอนเหลือ ${LIMITS.line.toLocaleString('en-US')}`] : []), info };
  }

  // บังคับอ่านเป็นตาราง (CSV/TSV) — ถ้าเดาตัวคั่นไม่ได้ ลองลูกน้ำ
  // เส้นแบ่งไฟล์ (UI ใส่ให้ตอนนำเข้าหลายไฟล์): แต่ละไฟล์อ่านแยกกัน ชั้น/ห้อง/ตารางไม่ไหลข้ามไฟล์
  const FILE_BREAK_LINE = '=== ไฟล์ใหม่ ===';
  const FILE_BREAK = /^[ \t]*={3}[ \t]*(?:ไฟล์ใหม่|new[ \t]+file)[ \t]*={3}[ \t]*$/im;
  function parseText(text) {
    const raw = String(text == null ? '' : typeof text === 'string' ? text : (typeof text === 'object' ? '' : text));
    if (!FILE_BREAK.test(raw)) return parseTextOne(text);
    const parts = raw.split(new RegExp(FILE_BREAK.source, 'gim')).filter((x) => x.trim());
    const rs = parts.map((x) => parseTextOne(x));
    const rows = [], warnings = [], info = newInfo();
    rs.forEach((r) => {
      rows.push(...r.rows); warnings.push(...r.warnings);
      ['panel', 'project', 'location', 'floor', 'total'].forEach((k) => { if (!info[k] && info[k] !== 0 && r.info && r.info[k]) info[k] = r.info[k]; });
      if (r.info && r.info.verified) info.verified = true;
    });
    assignKeys(rows);
    const hasS = rows.some((r) => r.sched), hasO = rows.some((r) => !r.sched);
    info.sourceKind = !rows.length ? 'empty' : hasS && hasO ? 'mixed' : hasS ? 'schedule' : (rs[0] && rs[0].info && rs[0].info.sourceKind) || 'text';
    return { rows, warnings: capWarnings(warnings), info };
  }
  function parseTable(text, opts) {
    const warnings = [], info = newInfo();
    const src = prepare(text, warnings);
    let spec = opts && opts.delimiter ? { delim: opts.delimiter, header: true } : sniffTable(src);
    if (!spec) {
      const d = ['\t', ';', ','].find((x) => src.indexOf(x) >= 0);
      if (!d) { warnings.push('ไม่พบตัวคั่นตาราง (, ; หรือ Tab) — ไม่ได้อ่านเป็นตาราง'); info.sourceKind = 'empty'; return { rows: [], warnings, info }; }
      spec = { delim: d, header: true };
    }
    const rows = parseTableCore(src, spec, warnings, info);
    finishRows(rows, info, 'table');
    if (!rows.length) info.sourceKind = 'table';
    return { rows, warnings: capWarnings(warnings), info };
  }

  /* ---------------- แถว → รายการของ engine ---------------- */
  let idCounter = 0;
  function rowToItem(r, panelId, id) {
    const it = { id: id || `imp${(++idCounter).toString(36)}`, panelId, type: r.type, name: r.name || r.room || '', qty: r.qty || 1, length: r.length || 20 };
    if (r.sched) {
      // แถวจากตารางโหลด: เก็บเป็น "กำหนดเอง" พร้อมหมวดเดิม เพื่อให้ VA ตรงกับตารางต้นทาง
      Object.assign(it, { type: 'custom', cat: r.cat, va: r.va, phases: r.phases || 1, rcd: !!r.rcd, continuous: !['rec', 'cook'].includes(r.cat) });
      return it;
    }
    const keys = { light: ['lamp', 'perFixture', 'fixtures'], rec: ['points', 'wet', 'vaPerPoint'], ac: ['btu'], heater: ['watt'], cook: ['watt', 'phases'], motor: ['kw', 'phases', 'start'], lift: ['preset', 'kva'], esc: ['preset', 'kva'], chiller: ['cooling', 'preset', 'kva'], ev: ['preset', 'kw', 'phases'], custom: ['watt', 'va', 'pf', 'phases', 'cat', 'rcd', 'continuous'] }[r.type] || [];
    keys.forEach((k) => { if (r[k] !== undefined) it[k] = r[k]; });
    if (r.type === 'ac') it.phases = '';
    return it;
  }

  /* ---------------- จัดวางแผงอัตโนมัติ ---------------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const letters = (k) => { let s = ''; k = k + 1; while (k > 0) { const r = (k - 1) % 26; s = String.fromCharCode(65 + r) + s; k = Math.floor((k - 1) / 26); } return s; };
  const sfx = (base, k) => (/\d$/.test(base) ? base : base + '-') + letters(k);
  const QTY_FIELD = (r) => (r.type === 'light' ? 'fixtures' : r.type === 'rec' ? 'points' : 'qty');
  const balanced = (Q, p) => Array.from({ length: p }, (_, i) => Math.floor(Q / p) + (i < Q % p ? 1 : 0));
  let panelCounter = 0, itemCounter = 0;

  function effectiveFloor(r) {
    const d = r && r.dest && typeof r.dest === 'object' ? r.dest : null;
    const cl = (n) => (n <= 0 ? 0 : Math.min(200, Math.max(1, Math.round(n))));
    if (d && d.floor !== undefined && d.floor !== null && d.floor !== '') {
      if (typeof d.floor === 'string' && /^\s*c/i.test(d.floor)) return 0;
      const n = Number(d.floor);
      if (isFinite(n)) return cl(n);
    }
    if (r.central) return 0;
    if (typeof r.floor === 'string' && /^\s*c/i.test(r.floor)) return 0;
    const n = Number(r.floor);
    if (r.floor === undefined || r.floor === null || r.floor === '' || !isFinite(n)) return 1;
    return cl(n);
  }

  function buildLayout(rows, project, opt) {
    const E = root.LoadEngine;
    rows = Array.isArray(rows) ? rows : [];
    project = project || {};
    const meta = Object.assign(E.defaultMeta(), project.meta || {});
    const mode = opt && opt.mode === 'append' ? 'append' : 'replace';
    const height = Number(opt && opt.floorHeight) > 0 ? Number(opt.floorHeight) : 3.6;
    const ratio = Number(meta.activeRatio) > 0 && Number(meta.activeRatio) <= 1 ? Number(meta.activeRatio) : 0.8;
    const cap = Math.max(1, Math.floor(Math.max(...D.PANEL_WAYS) * ratio + 1e-9));   // เช่น 42 × 0.8 = 33 ช่อง
    const panels = mode === 'append' ? clone(project.panels || []) : [];
    const items = mode === 'append' ? clone(project.items || []) : [];
    const warnings = [], log = [];
    const usedIds = new Set();
    panels.forEach((p) => usedIds.add(p.id)); items.forEach((i) => usedIds.add(i.id));
    const stamp = Date.now().toString(36);
    const uid = (prefix, counterName) => {
      let id;
      do { id = prefix + stamp + ((counterName === 'p' ? ++panelCounter : ++itemCounter)).toString(36); } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    };

    // ดัชนีแผง
    const byId = new Map(), byNameAll = new Map(), byKey = new Map();
    const reg = (p) => { byId.set(p.id, p); byNameAll.set(p.name, p); byKey.set(p.parent + '\u0001' + p.name, p); };
    panels.forEach(reg);
    let mdb = panels.find((p) => p.kind === 'MDB') || panels.find((p) => !p.parent);
    if (!mdb) {
      mdb = { id: usedIds.has('MDB') ? uid('P', 'p') : 'MDB', name: 'MDB', kind: 'MDB', phases: 3, parent: null, location: 'ห้องไฟฟ้า ชั้น 1' };
      usedIds.add(mdb.id); panels.unshift(mdb); reg(mdb);
    }
    // ช่องที่ใช้ไปแล้วของแผงเดิม (นับจากรายการเดิมในโปรเจกต์)
    const slotUsed = new Map();
    const sumSlots = (cs) => cs.reduce((a, c) => a + (c.phases === 3 ? 3 : 1), 0);
    // จำนวนช่องของรายการ: ชนิดที่ "ต่อหน่วย = 1 วงจร" คิดจากช่องต่อ 1 หน่วย (cache) × จำนวน — เรียก engine ถูกมาก ไม่ขึ้นกับการตัดจำนวนต่อรายการของ engine
    //   ส่วนแสงสว่าง/เต้ารับ (จำนวนวงจรขึ้นกับยอดรวม) ถามจาก engine ตรง ๆ แต่เป็นชิ้นเล็ก (เต้ารับตัดทีละ 1,000 จุด)
    const unitCache = new Map();
    const slotsOfItem = (it) => {
      if (it.type === 'light') return sumSlots(E.expandItem(it, meta));
      if (it.type === 'rec') {
        const P = Math.max(1, Math.round(Number(it.points) || 1));
        let s = 0;
        for (let done = 0; done < P; done += 1000) s += sumSlots(E.expandItem(Object.assign({}, it, { points: Math.min(1000, P - done) }), meta));
        return s;
      }
      const o = Object.assign({}, it); delete o.id; delete o.panelId; delete o.name; delete o.qty; delete o.length; delete o.room;
      const key = JSON.stringify(o);
      let u = unitCache.get(key);
      if (u === undefined) { u = sumSlots(E.expandItem(Object.assign({}, it, { qty: 1 }), meta)); unitCache.set(key, u); }
      return u * Math.max(1, Math.round(Number(it.qty) || 1));
    };
    items.forEach((it) => { slotUsed.set(it.panelId, (slotUsed.get(it.panelId) || 0) + slotsOfItem(it)); });
    const uniqueName = (name, floorLabel) => {
      if (!byNameAll.has(name)) return name;
      let n = floorLabel != null ? `${name} (ชั้น ${floorLabel})` : name;
      for (let k = 2; byNameAll.has(n); k++) n = `${floorLabel != null ? `${name} (ชั้น ${floorLabel})` : name} (${k})`;
      return n;
    };
    // หาแผงตาม (แม่, ชื่อ) ถ้าไม่มีสร้างใหม่ — ชื่อซ้ำกับแผงอื่นที่ต่างแม่จะได้ชื่อใหม่เช่น "CU (ชั้น 2)"
    const ensure = (name, kind, parent, extra, floorLabel) => {
      const hit = byKey.get(parent.id + '\u0001' + name);
      if (hit && hit.kind === kind) return hit;
      const p = Object.assign({ id: uid('P', 'p'), name: uniqueName(name, floorLabel), kind, phases: 3, parent: parent.id, feederLength: 20, location: '', mounting: 'SURFACE' }, extra);
      panels.push(p); reg(p);
      return p;
    };
    const rowCache = new Map();
    const slotsOfRow = (r) => { if (!rowCache.has(r)) rowCache.set(r, slotsOfItem(rowToItem(r, 'x', 'x'))); return rowCache.get(r); };

    // ---- เตรียมแต่ละแถว
    const entries = rows.map((r, i) => {
      if (!r || typeof r !== 'object') return null;
      const d = r.dest && typeof r.dest === 'object' ? r.dest : {};
      const dp = typeof d.panel === 'string' && d.panel.trim() ? d.panel.trim() : '';
      return { i, row: r, floor: effectiveFloor(r), destPanel: dp, named: !dp && typeof r.panelName === 'string' && r.panelName.trim() ? r.panelName.trim() : '', slots: 0 };
    });
    entries.forEach((e) => { if (e) e.slots = slotsOfRow(e.row); });
    const placement = new Array(rows.length).fill(null);
    const parts = new Map();   // row index -> [{panelId, panelName, qty}]
    const note = (e, panel, qty) => { if (!parts.has(e.i)) parts.set(e.i, []); parts.get(e.i).push({ panelId: panel.id, panelName: panel.name, qty }); };

    const sdbOf = (f) => (f === 1 ? mdb : ensure(`SDB-${f}`, 'SDB', mdb, { location: `ชั้น ${f} ห้องไฟฟ้า`, feederLength: Math.round(15 + height * (f - 1)) }, f));
    let pbPanel = null;
    const pb = () => pbPanel || (pbPanel = ensure('PB', 'SDB', mdb, { location: 'ใกล้ MDB ชั้น 1', feederLength: 10 }));
    const parentOf = (f) => (f === 0 ? pb() : sdbOf(f));
    const lpExtra = (f) => (f === 0 ? { location: 'ส่วนกลาง', feederLength: 8 } : { location: `ชั้น ${f}`, feederLength: f === 1 ? 15 : 6 });

    // ใส่แถวเป็นรายการในแผง — จำนวนมากเกิน 1,000 ต่อรายการ (engine ตัดที่ 2,000) แยกเป็นหลายรายการ VA รวมเท่าเดิม
    const pushItem = (e, row, panel, slots) => {
      const f = QTY_FIELD(row);
      const Q = row[f] != null ? Math.max(1, Math.round(Number(row[f]) || 1)) : 1;
      const maxItem = row.type === 'light' ? 20000 : 1000;
      const n = Q > maxItem ? Math.ceil(Q / maxItem) : 1;
      const qs = n > 1 ? balanced(Q, n) : null;
      for (let k = 0; k < n; k++) items.push(rowToItem(qs ? Object.assign({}, row, { [f]: qs[k] }) : row, panel.id, uid('imp', 'i')));
      slotUsed.set(panel.id, (slotUsed.get(panel.id) || 0) + (slots != null ? slots : slotsOfRow(row)));
      note(e, panel, Q);
    };
    // แบ่งแถวที่ใหญ่เกินความจุ 1 แผงออกเป็นหลายส่วน (VA รวมเท่าเดิม)
    const splitEntry = (e) => {
      const f = QTY_FIELD(e.row);
      const Q = Math.max(1, Math.round(Number(e.row[f]) || 1));
      let p = Math.max(2, Math.ceil(e.slots / cap));
      for (; p <= Q; p++) {
        const qs = balanced(Q, p);
        const pieces = qs.map((q) => Object.assign({}, e.row, { [f]: q }));
        const sl = pieces.map((pc) => slotsOfRow(pc));
        if (sl.every((s) => s <= cap)) return pieces.map((pc, k) => ({ i: e.i, row: pc, slots: sl[k], part: true }));
      }
      return [e];
    };
    // วางกลุ่มรายการลงชุดแผง (series) ตามความจุ — ไม่สร้างแผงว่าง
    const placeSeries = (list, S) => {
      if (!list.length) return [];
      const atoms = [];
      list.forEach((e) => { if (e.slots > cap) atoms.push(...splitEntry(e)); else atoms.push(e); });
      atoms.sort((a, b) => (b.slots - a.slots) || (a.i - b.i));
      const pat = new RegExp('^' + escRe(/\d$/.test(S.base) ? S.base : S.base + '-') + '[A-Z]{1,2}$');
      const existing = mode === 'append' || byKey.size ? panels.filter((p) => p.parent === S.parent.id && p.kind === 'LP' && (p.name === S.base || pat.test(p.name))) : [];
      const bins = existing.map((p) => ({ panel: p, free: cap - (slotUsed.get(p.id) || 0), list: [] }));
      let rest = [];
      for (const a of atoms) {
        const b = bins.find((x) => x.free >= a.slots);
        if (b) { b.free -= a.slots; b.list.push(a); } else rest.push(a);
      }
      const total = rest.reduce((s, a) => s + a.slots, 0);
      const nb = [];
      for (let k = Math.max(rest.length ? 1 : 0, Math.ceil(total / cap)); k > 0; k--) nb.push({ load: 0, list: [] });
      for (const a of rest) {
        let best = null;
        for (const b of nb) if (b.load + a.slots <= cap && (!best || b.load < best.load)) best = b;
        if (!best) { best = { load: 0, list: [] }; nb.push(best); }
        best.load += a.slots; best.list.push(a);
      }
      const fresh = nb.filter((b) => b.list.length);
      const taken = new Set(existing.map((p) => p.name));
      const names = [];
      if (fresh.length) {
        if (!existing.length) { if (fresh.length === 1) names.push(S.base); else for (let k = 0; k < fresh.length; k++) names.push(sfx(S.base, k)); }
        else for (let k = taken.has(S.base) ? 1 : 0; names.length < fresh.length; k++) { const n = sfx(S.base, k); if (!taken.has(n) && !byNameAll.has(n)) names.push(n); }
      }
      const out = [];
      const emit = (panel, lst, why) => {
        lst.sort((a, b) => a.i - b.i);
        lst.forEach((a) => pushItem(entries[a.i], a.row, panel, a.slots));
        out.push(panel);
        log.push(`${panel.name}: ${why} ${lst.length} รายการ (~${lst.reduce((s, a) => s + a.slots, 0)} ช่อง)`);
      };
      bins.forEach((b) => { if (b.list.length) emit(b.panel, b.list, S.why + ' (เพิ่มในแผงเดิม)'); });
      fresh.forEach((b, k) => {
        const panel = ensure(names[k], 'LP', S.parent, S.extra, S.floorLabel);
        emit(panel, b.list, S.why);
      });
      return out;
    };

    const auto = entries.filter((e) => e && !e.destPanel);
    const floorsSet = [...new Set(auto.map((e) => e.floor))].filter((f) => f >= 1).sort((a, b) => a - b);
    for (const f of floorsSet) {
      const fr = auto.filter((e) => e.floor === f);
      const named = fr.filter((e) => e.named);
      const plain = fr.filter((e) => !e.named);
      const acRows = plain.filter((e) => e.row.type === 'ac' || e.row.type === 'chiller');
      const motorRows = plain.filter((e) => ['motor', 'lift', 'esc'].includes(e.row.type));
      const lpRows = plain.filter((e) => !acRows.includes(e) && !motorRows.includes(e));
      const parent = sdbOf(f);
      const extra = lpExtra(f);
      [...new Set(named.map((e) => e.named))].forEach((pn) => {
        placeSeries(named.filter((e) => e.named === pn), { parent, base: pn, extra, floorLabel: f, why: 'ตามชื่อแผงในตาราง' });
      });
      const acSlots = acRows.reduce((s, e) => s + e.slots, 0);
      const laBase = `LA-${f}`;
      const laExists = panels.some((p) => p.parent === parent.id && (p.name === laBase || p.name.startsWith(laBase)) && p.kind === 'LP');
      if (acRows.length && acSlots <= 2 && lpRows.length && !laExists) {
        placeSeries(lpRows.concat(acRows), { parent, base: `LP-${f}`, extra, floorLabel: f, why: 'แสงสว่าง/เต้ารับ/อื่น ๆ + แอร์น้อย (ไม่แยกแผง)' });
      } else {
        placeSeries(lpRows, { parent, base: `LP-${f}`, extra, floorLabel: f, why: 'แสงสว่าง/เต้ารับ/อื่น ๆ' });
        placeSeries(acRows, { parent, base: laBase, extra, floorLabel: f, why: 'เครื่องปรับอากาศ' });
      }
      placeSeries(motorRows, { parent, base: `PP-${f}`, extra, floorLabel: f, why: 'มอเตอร์/ปั๊ม' });
    }
    // ส่วนกลาง (ชั้น ≤ 0 หรือ 'C') → PB
    const cen = auto.filter((e) => e.floor === 0);
    if (cen.length) {
      const parent = pb();
      const extra = lpExtra(0);
      const named = cen.filter((e) => e.named);
      [...new Set(named.map((e) => e.named))].forEach((pn) => placeSeries(named.filter((e) => e.named === pn), { parent, base: pn, extra, floorLabel: 'C', why: 'ตามชื่อแผงในตาราง' }));
      const plain = cen.filter((e) => !e.named);
      const smallT = ['light', 'rec', 'custom', 'heater', 'cook'];
      const small = plain.filter((e) => smallT.includes(e.row.type));
      const big = plain.filter((e) => !smallT.includes(e.row.type));
      big.forEach((e) => pushItem(e, e.row, parent, e.slots));
      placeSeries(small, { parent, base: 'LP-C', extra, floorLabel: 'C', why: 'โหลดส่วนกลาง' });
      if (plain.length) log.push(`PB: โหลดส่วนกลาง ${plain.length} รายการ (ลิฟต์ ปั๊ม ชิลเลอร์ จ่ายจาก PB ข้าง MDB ตามข้อกำหนด)`);
    }
    // ปลายทางที่ผู้ใช้เลือกแผงเอง (dest.panel) — ทำท้ายสุด เพื่อให้เลือกแผงที่เพิ่งสร้างจากแถวอื่นได้
    const manual = entries.filter((e) => e && e.destPanel);
    for (const e of manual) {
      const want = e.destPanel.toLowerCase();
      let panel = panels.find((p) => p.name.toLowerCase() === want);
      if (!panel) panel = ensure(e.destPanel, 'LP', parentOf(e.floor), lpExtra(e.floor), e.floor === 0 ? 'C' : e.floor);
      pushItem(e, e.row, panel, e.slots);
      log.push(`${panel.name}: ตามที่เลือกเอง 1 รายการ`);
      if (panel.kind === 'LP' && (slotUsed.get(panel.id) || 0) > cap) warnings.push(`${panel.name}: เกินความจุ ${cap} ช่อง (ใช้ ${slotUsed.get(panel.id)} ช่อง) เพราะเลือกแผงปลายทางเอง`);
    }
    entries.forEach((e) => {
      if (!e) return;
      const ps = parts.get(e.i);
      if (!ps) return;
      const pl = { panelId: ps[0].panelId, panelName: ps[0].panelName, floor: e.floor };
      if (ps.length > 1) pl.split = ps.map((p) => ({ panelId: p.panelId, panelName: p.panelName, qty: p.qty }));
      placement[e.i] = pl;
    });
    return { panels, items, log, warnings, placement };
  }

  const API = { parseText, FILE_BREAK_LINE, parseTable, sniffTable, buildLayout, rowToItem, estimateRoom, classify, ocrFix, normalizeText, parseFloorToken };
  root.Importer = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
