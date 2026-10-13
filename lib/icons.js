// Inline SVG icons, 16px grid, drawn with currentColor.

const svg = (body, extra = '') =>
  `<svg class="ic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  // open modes
  tab: svg(`<path ${stroke} d="M2.5 13.25V4.25h4.25l1.25 1.5h5.5v7.5z"/>`),
  background: svg(`<path ${stroke} d="M5 11.5V3.5h3.5l1 1.25H13v6.75z"/><path ${stroke} d="M3 6v7.5h8"/>`),
  current: svg(`<path ${stroke} d="M3 3.5v4a3 3 0 0 0 3 3h7"/><path ${stroke} d="M10.25 7.75 13 10.5l-2.75 2.75"/>`),
  window: svg(`<rect ${stroke} x="2" y="3" width="12" height="10" rx="1.75"/><path ${stroke} d="M2 6.25h12"/>`),
  private: svg(`<path fill="currentColor" fill-rule="evenodd" d="M1.5 7.6C1.5 5.9 2.7 5 4.6 5h6.8c1.9 0 3.1.9 3.1 2.6 0 1.9-1.3 3.4-3.1 3.4-1.5 0-2.1-1.1-3.4-1.1S6.1 11 4.6 11C2.8 11 1.5 9.5 1.5 7.6Zm3.4-.9c-.9 0-1.5.4-1.5 1 0 .7.6 1.1 1.4 1.1.8 0 1.4-.5 1.4-1.1 0-.6-.5-1-1.3-1Zm6.2 0c-.8 0-1.3.4-1.3 1 0 .6.6 1.1 1.4 1.1.8 0 1.4-.4 1.4-1.1 0-.6-.6-1-1.5-1Z"/>`),
  app: svg(`<rect ${stroke} x="2" y="2.5" width="12" height="11" rx="2.5"/><rect fill="currentColor" x="5" y="5.5" width="2.5" height="2.5" rx=".6"/><rect fill="currentColor" x="8.5" y="5.5" width="2.5" height="2.5" rx=".6"/><rect fill="currentColor" x="5" y="9" width="2.5" height="2.5" rx=".6"/><rect fill="currentColor" x="8.5" y="9" width="2.5" height="2.5" rx=".6"/>`),
  reuse: svg(`<path ${stroke} d="M12.75 7.25A4.75 4.75 0 0 0 4 5"/><path ${stroke} d="M3.25 8.75A4.75 4.75 0 0 0 12 11"/><path ${stroke} d="M4 2.25V5h2.75"/><path ${stroke} d="M12 13.75V11H9.25"/>`),

  // actions
  openAll: svg(`<path ${stroke} d="M7 3H3.75A1.25 1.25 0 0 0 2.5 4.25v8A1.25 1.25 0 0 0 3.75 13.5h8A1.25 1.25 0 0 0 13 12.25V9"/><path ${stroke} d="M9.5 2.5h4v4"/><path ${stroke} d="M13.25 2.75 7.5 8.5"/>`),
  edit: svg(`<path ${stroke} d="M10.5 2.75a1.6 1.6 0 0 1 2.25 2.25L5.5 12.25 2.5 13l.75-3z"/><path ${stroke} d="M9.25 4 12 6.75"/>`),
  more: svg(`<circle fill="currentColor" cx="3.5" cy="8" r="1.3"/><circle fill="currentColor" cx="8" cy="8" r="1.3"/><circle fill="currentColor" cx="12.5" cy="8" r="1.3"/>`),
  plus: svg(`<path ${stroke} d="M8 3v10M3 8h10"/>`),
  search: svg(`<circle ${stroke} cx="7" cy="7" r="4.25"/><path ${stroke} d="m10.25 10.25 3.25 3.25"/>`),
  grip: svg(`<circle fill="currentColor" cx="6" cy="4" r="1.1"/><circle fill="currentColor" cx="10" cy="4" r="1.1"/><circle fill="currentColor" cx="6" cy="8" r="1.1"/><circle fill="currentColor" cx="10" cy="8" r="1.1"/><circle fill="currentColor" cx="6" cy="12" r="1.1"/><circle fill="currentColor" cx="10" cy="12" r="1.1"/>`),
  close: svg(`<path ${stroke} d="m4 4 8 8M12 4l-8 8"/>`),
  chevron: svg(`<path ${stroke} d="m5.5 6.25 2.5 2.5 2.5-2.5"/>`),
  enter: svg(`<path ${stroke} d="M12.5 3.5v4a2 2 0 0 1-2 2h-7"/><path ${stroke} d="M6 7 3.5 9.5 6 12"/>`),
  check: svg(`<path ${stroke} d="m3.5 8.5 3 3 6-7"/>`),
  warn: svg(`<path ${stroke} d="M8 2.75 14 13.25H2z"/><path ${stroke} d="M8 6.5v3"/><circle fill="currentColor" cx="8" cy="11.4" r=".8"/>`),
};
