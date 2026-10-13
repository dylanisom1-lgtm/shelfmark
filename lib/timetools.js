// Timestamps and date arithmetic, for the timestamp converter and date math widgets. No DOM.
//
// Instants are BigInt nanoseconds since 1970-01-01 UTC, so 18- and 19-digit values such as
// Active Directory times keep their precision. Calendar dates are whole day numbers
// (days since 1970-01-01), which keeps date math clear of time zones and daylight saving.

const NS = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n };
// 100-nanosecond intervals between 1601-01-01 (Windows) and 1970-01-01 (Unix)
const FILETIME_OFFSET = 116_444_736_000_000_000n;
// Microseconds between the same two dates (Chrome and WebKit count from 1601 in microseconds)
const WEBKIT_OFFSET = 11_644_473_600_000_000n;
const AD_NEVER = 9_223_372_036_854_775_807n; // Active Directory's "never" (0x7FFFFFFFFFFFFFFF)
const MAX_MS = 8.64e15; // the furthest a JavaScript date reaches either way

export const READS = {
  unix: 'Unix seconds',
  unixms: 'Unix milliseconds',
  unixus: 'Unix microseconds',
  unixns: 'Unix nanoseconds',
  filetime: 'AD / Windows FILETIME',
  webkit: 'Chrome / WebKit time',
  ldap: 'LDAP generalized time',
};
export const READ_ORDER = ['unix', 'unixms', 'unixus', 'unixns', 'filetime', 'webkit', 'ldap'];

const floorDiv = (a, b) => {
  const q = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
};

// --- reading what was typed ---------------------------------------------------------
const LDAP_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,7}))?(Z|[+-]\d{4})?$/i;
const ISOISH_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i;

function validParts(y, mo, d, h = 0, mi = 0, s = 0) {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && h < 24 && mi < 60 && s < 60;
}

function zoneOffsetMinutes(z) {
  if (!z || /^(z|utc|gmt)$/i.test(z)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(z);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function fromParts(y, mo, d, h, mi, s, fracDigits, zone) {
  const frac = BigInt(((fracDigits || '') + '000000000').slice(0, 9));
  if (zone === undefined) {
    // No zone given: read it in this computer's time zone.
    const ms = new Date(y, mo - 1, d, h, mi, s).getTime();
    return BigInt(ms) * NS.ms + frac;
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, s) - zoneOffsetMinutes(zone) * 60000;
  return BigInt(ms) * NS.ms + frac;
}

function parseLdap(s) {
  const m = LDAP_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number);
  if (!validParts(y, mo, d, h, mi, sec)) return null;
  const frac = m[7] ? (m[7] + '0000000').slice(0, 7) + '00' : '';
  return fromParts(y, mo, d, h, mi, sec, frac, m[8] || 'Z');
}

function localZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  } catch {
    return 'your time zone';
  }
}

// Returns null for empty input; otherwise { ns, read, note?, never?, numeric } or { error }.
// `read` forces how a plain number is read; 'auto' picks by its number of digits.
export function parseTimestamp(input, read = 'auto') {
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  if (/^now$/i.test(s)) return { ns: BigInt(Date.now()) * NS.ms, read: 'now', numeric: false };

  const clean = s.replace(/[,_]/g, '');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(clean)) return parseNumber(clean, read);

  const ldap = /^\d{14}/.test(s) ? parseLdap(s) : null;
  if (ldap !== null) return { ns: ldap, read: 'ldap', numeric: false };

  const m = ISOISH_RE.exec(s);
  if (m) {
    const [y, mo, d] = m.slice(1, 4).map(Number);
    const h = Number(m[4] || 0), mi = Number(m[5] || 0), sec = Number(m[6] || 0);
    if (!validParts(y, mo, d, h, mi, sec)) return { error: 'That date doesn’t exist.' };
    const ns = fromParts(y, mo, d, h, mi, sec, m[7], m[8] === undefined ? undefined : m[8]);
    return { ns, read: 'text', numeric: false, note: m[8] ? '' : `Read in your time zone (${localZoneName()}). Add Z for UTC.` };
  }

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return { error: 'Type a Unix or Active Directory time, or a date like 2026-10-13 15:30.' };
  const hasZone = /(?:\bZ|UTC|GMT|[+-]\d{2}:?\d{2}|\b[ECMP][SD]T)\s*$/i.test(s);
  return { ns: BigInt(ms) * NS.ms, read: 'text', numeric: false, note: hasZone ? '' : `Read in your time zone (${localZoneName()}).` };
}

function guessRead(intDigits, intPart) {
  if (intDigits <= 11) return 'unix';
  if (intDigits <= 14) return intDigits === 14 && parseLdap(intPart) !== null ? 'ldap' : 'unixms';
  if (intDigits <= 16) return 'unixus';
  if (intDigits === 17) return 'webkit';
  if (intDigits === 18) return 'filetime';
  return 'unixns';
}

function parseNumber(clean, read) {
  const neg = clean.startsWith('-');
  const unsigned = clean.replace(/^[+-]/, '');
  const [intPart, frac = ''] = unsigned.split('.');
  const intDigits = intPart.replace(/^0+(?=\d)/, '').length;
  const whole = BigInt(intPart) * (neg ? -1n : 1n);
  const kind = read && read !== 'auto' && READS[read] ? read : guessRead(intDigits, intPart);
  const scaled = (unit) => {
    const fracPart = frac ? (BigInt((frac + '000000000').slice(0, 9)) * unit) / NS.s : 0n;
    return whole * unit + (neg ? -fracPart : fracPart);
  };
  const base = { read: kind, numeric: true, guessed: !read || read === 'auto' };

  if ((kind === 'filetime' || base.guessed) && whole === AD_NEVER) {
    return { ...base, read: 'filetime', never: 'Never. 9223372036854775807 is how Active Directory says an account never expires.' };
  }
  if (kind === 'filetime' && whole === 0n) {
    return { ...base, never: 'Never, or not set. Active Directory uses 0 for times that haven’t happened, such as a first logon.' };
  }

  let ns;
  switch (kind) {
    case 'unix': ns = scaled(NS.s); break;
    case 'unixms': ns = scaled(NS.ms); break;
    case 'unixus': ns = scaled(NS.us); break;
    case 'unixns': ns = whole; break;
    case 'filetime': ns = (whole - FILETIME_OFFSET) * 100n; break;
    case 'webkit': ns = (whole - WEBKIT_OFFSET) * 1000n; break;
    case 'ldap': {
      const v = parseLdap(intPart);
      if (v === null) return { error: 'LDAP time is 14 digits: year, month, day, hour, minute, second.' };
      ns = v;
      break;
    }
    default: return { error: 'Unknown kind of timestamp.' };
  }
  return { ...base, ns };
}

// --- writing it out ---------------------------------------------------------------
const pad = (n, w = 2) => String(n).padStart(w, '0');

export function relativeTime(ms, now = Date.now()) {
  const diff = ms - now;
  const a = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (a < 45e3) return diff < 0 && a > 5e3 ? rtf.format(-Math.round(a / 1e3), 'second') : 'now';
  if (a < 45 * 60e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (a < 22 * 3600e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  if (a < 26 * 86400e3) return rtf.format(Math.round(diff / 86400e3), 'day');
  if (a < 320 * 86400e3) return rtf.format(Math.round(diff / (30.4375 * 86400e3)), 'month');
  return rtf.format(Math.round(diff / (365.25 * 86400e3)), 'year');
}

// Every form the converter shows, from one instant. Returns { error } if a browser can't show it.
export function describeInstant(ns, now = Date.now()) {
  const ms = Number(floorDiv(ns, NS.ms));
  if (!(Math.abs(ms) <= MAX_MS)) return { error: 'That’s further from today than a browser can show (about 270,000 years).' };
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const ymd = `${y < 0 ? '-' + pad(-y, 4) : pad(y, 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hms = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const fileTime = floorDiv(ns, 100n) + FILETIME_OFFSET;
  return {
    ms,
    local: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(d),
    utc: `${ymd} ${hms} UTC`,
    iso: d.toISOString(),
    unix: floorDiv(ns, NS.s).toString(),
    unixms: floorDiv(ns, NS.ms).toString(),
    filetime: fileTime >= 0n ? fileTime.toString() : null,
    ldap: y >= 0 && y <= 9999 ? `${ymd.replace(/-/g, '')}${hms.replace(/:/g, '')}.0Z` : null,
    relative: relativeTime(ms, now),
  };
}

// --- calendar dates ------------------------------------------------------------------
const DAY_MS = 86_400_000;

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const dayNum = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

export function partsOf(n) {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday.
export const dow = (n) => (((n % 7) + 7 + 4) % 7);
const isWeekday = (n) => {
  const w = dow(n);
  return w !== 0 && w !== 6;
};

export function today(now = new Date()) {
  return dayNum(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function fromInput(v) {
  const m = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return dayNum(y, mo, d);
}

export function toInput(n) {
  const p = partsOf(n);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

export function formatDay(n, style = 'full') {
  const opts = style === 'full' ? { dateStyle: 'full' } : style === 'short' ? { weekday: 'short', month: 'short', day: 'numeric' } : { dateStyle: style };
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(n * DAY_MS));
}

export function addMonths(n, k) {
  const p = partsOf(n);
  const total = p.y * 12 + (p.m - 1) + k;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return dayNum(y, m, Math.min(p.d, daysInMonth(y, m))); // Jan 31 + 1 month = Feb 28 (or 29)
}

function addWeekdays(n, k) {
  const step = k >= 0 ? 1 : -1;
  let left = Math.abs(k);
  // Skip whole weeks first; the last few days are walked so weekends are stepped over.
  const weeks = left > 0 ? Math.floor((left - 1) / 5) : 0;
  n += weeks * 7 * step;
  left -= weeks * 5;
  while (left > 0) {
    n += step;
    if (isWeekday(n)) left--;
  }
  return n;
}

export const UNITS = ['days', 'weeks', 'months', 'years', 'weekdays'];

export function addToDate(n, amount, unit) {
  const k = Math.trunc(amount);
  switch (unit) {
    case 'weeks': return n + 7 * k;
    case 'months': return addMonths(n, k);
    case 'years': return addMonths(n, 12 * k);
    case 'weekdays': return addWeekdays(n, k);
    default: return n + k;
  }
}

function weekdaysIn(first, last) {
  if (last < first) return 0;
  const span = last - first + 1;
  const full = Math.floor(span / 7);
  let count = full * 5;
  for (let i = first + full * 7; i <= last; i++) if (isWeekday(i)) count++;
  return count;
}

// Whole months from a to b (a <= b), then the days left over.
function monthsAndDays(a, b) {
  const pa = partsOf(a);
  const pb = partsOf(b);
  let k = (pb.y - pa.y) * 12 + (pb.m - pa.m);
  while (k > 0 && addMonths(a, k) > b) k--;
  return { years: Math.floor(k / 12), months: k % 12, restDays: b - addMonths(a, k) };
}

// The span from a to b. Without `inclusive`, it's the difference (Mon to Fri = 4 days);
// with it, both dates count (Mon to Fri = 5 days). Weekdays follow the same rule.
export function between(a, b, { inclusive = false } = {}) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const end = inclusive ? hi + 1 : hi;
  const days = end - lo;
  return {
    days,
    backwards: b < a,
    weeks: Math.floor(days / 7),
    weekRest: days % 7,
    ...monthsAndDays(lo, end),
    weekdays: weekdaysIn(inclusive ? lo : lo + 1, hi),
  };
}

export function isoWeek(n) {
  const w = dow(n) || 7; // Monday 1 ... Sunday 7
  const thursday = n - w + 4;
  const year = partsOf(thursday).y;
  return { week: Math.floor((thursday - dayNum(year, 1, 1)) / 7) + 1, year };
}

export function dayOfYear(n) {
  const { y } = partsOf(n);
  return { day: n - dayNum(y, 1, 1) + 1, of: dayNum(y + 1, 1, 1) - dayNum(y, 1, 1) };
}
