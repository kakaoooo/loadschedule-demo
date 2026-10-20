// ไอคอนลายเส้น (วาดเอง ใช้ currentColor)
(function (root) {
  const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  root.ICON = {
    light: s('<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v2M19 13v2M7 10.5h10"/><path d="M8 17l-1 3M12 17v3M16 17l1 3" stroke-dasharray="1.5 2"/>'),
    rec: s('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M9.5 8v3M14.5 8v3"/><path d="M10.5 15.5a1.5 1.5 0 0 1 3 0v1h-3z"/>'),
    ac: s('<rect x="2.5" y="5" width="19" height="8" rx="2"/><path d="M5 10.5h14M8 16c0 1.5-1 2-1 3.5M12 16c0 1.5-1 2-1 3.5M16 16c0 1.5-1 2-1 3.5"/>'),
    heater: s('<path d="M12 3.5c3 4 5 6.6 5 9.5a5 5 0 0 1-10 0c0-2.9 2-5.5 5-9.5z"/><path d="M9.5 13.5c.8.6 1.6.6 2.5 0s1.7-.6 2.5 0"/>'),
    cook: s('<path d="M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2 10h20M9 6c0-1 1-1 1-2M13 6c0-1 1-1 1-2"/>'),
    motor: s('<circle cx="12" cy="12" r="8.5"/><path d="M8 15.5V8.5l4 4.5 4-4.5v7"/>'),
    fire_pump: s('<path d="M12 2.5c2 2.4 3 3.9 3 5.6a3 3 0 0 1-6 0c0-1.7 1-3.2 3-5.6z"/><circle cx="12" cy="15.5" r="5.5"/><path d="M9 15.5h6M12 12.5v6" opacity=".55"/><path d="M4 21h16"/>'),
    lift: s('<rect x="5" y="2.5" width="14" height="19" rx="1"/><path d="M12 2.5v19M8.5 9l1.5-2 1.5 2M12.5 15l1.5 2 1.5-2"/>'),
    esc: s('<path d="M3 19h4l9-10h5"/><path d="M3 15h3l9-10h6" opacity=".45"/><circle cx="8.5" cy="9" r="1.3"/>'),
    chiller: s('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>'),
    ev: s('<rect x="4" y="3" width="10" height="18" rx="1.5"/><path d="M9.5 7 7.5 11h3l-2 4"/><path d="M14 10h2.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V8l-2-2"/>'),
    custom: s('<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>'),
    spare: s('<rect x="7" y="3" width="10" height="18" rx="1.5" stroke-dasharray="2.5 2"/><path d="M12 7v4M10 14h4"/>'),
    board: s('<rect x="4" y="2.5" width="16" height="19" rx="1"/><path d="M8 7h8M8 10h8M8 13h8M8 16h5"/>'),
    sdb: s('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v6M7 9h10M7 9v5M12 9v5M17 9v5"/>'),
    undo: s('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: s('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    trash: s('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    copy: s('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>'),
    close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
    file: s('<path d="M6 2.5h8l4 4v15H6z"/><path d="M14 2.5v4h4M9 13h6M9 16.5h6"/>'),
    down: s('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
    up: s('<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>'),
    print: s('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>'),
    check: s('<path d="M4.5 12.5 9.5 17 19.5 7"/>'),
    bolt: s('<path d="M13 2.5 5.5 13.5h5L9.5 21.5 18.5 10h-5.5z"/>'),
    balance: s('<path d="M12 3.5v16M7 20.5h10M4.5 7h15"/><path d="M4.5 7 2 13.5a3 3 0 0 0 5 0zM19.5 7 17 13.5a3 3 0 0 0 5 0z"/>'),
    minus: s('<path d="M5 12h14"/>'),
    wand: s('<path d="M4 20 15 9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z"/>')
  };
  // โลโก้: สัญลักษณ์เบรกเกอร์ในกรอบ
  root.LOGO = `<svg viewBox="0 0 32 32" fill="none"><rect x="1.5" y="1.5" width="29" height="29" rx="3" stroke="#d24a0f" stroke-width="2"/><path d="M16 4v6M16 22v6" stroke="#efe9dc" stroke-width="2"/><path d="M11 10.5c0 0 2-1 5-.5s5 4 5 6-2 4.5-5 5.5" stroke="#efe9dc" stroke-width="2" fill="none"/><circle cx="16" cy="10" r="1.6" fill="#efe9dc"/><circle cx="16" cy="22" r="1.6" fill="#efe9dc"/></svg>`;
})(typeof self !== 'undefined' ? self : this);
