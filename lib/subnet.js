// Subnet math for the subnet calculator widget. IPv4 with plain 32-bit integers,
// IPv6 with BigInt. No DOM here.
//
// Accepts:  10.20.0.0/22   192.168.1.10 255.255.255.0   192.168.1.10/255.255.255.0
//           172.16.5.4 0.0.0.255 (a wildcard mask)      2001:db8::/48   fe80::1%eth0
// A bare address is treated as a single address (/32 or /128).

// --- IPv4 -------------------------------------------------------------------------
function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function v4ToString(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

const maskOf = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

function bitCount(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

// A mask like 255.255.252.0, or a wildcard like 0.0.3.255. Returns the prefix length or null.
function prefixFromMask(m) {
  const inv = ~m >>> 0;
  if ((inv & (inv + 1)) === 0) return 32 - bitCount(inv); // contiguous ones from the left
  if (((m & (m + 1)) >>> 0) === 0) return 32 - bitCount(m); // a wildcard mask
  return null;
}

const V4_KINDS = [
  ['0.0.0.0', 8, 'This network (0.0.0.0/8)'],
  ['10.0.0.0', 8, 'Private (RFC 1918)'],
  ['100.64.0.0', 10, 'Shared address space for carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0', 8, 'Loopback'],
  ['169.254.0.0', 16, 'Link-local (APIPA)'],
  ['172.16.0.0', 12, 'Private (RFC 1918)'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'Documentation (TEST-NET-1)'],
  ['192.168.0.0', 16, 'Private (RFC 1918)'],
  ['198.18.0.0', 15, 'Benchmark testing (RFC 2544)'],
  ['198.51.100.0', 24, 'Documentation (TEST-NET-2)'],
  ['203.0.113.0', 24, 'Documentation (TEST-NET-3)'],
  ['224.0.0.0', 4, 'Multicast'],
  ['255.255.255.255', 32, 'Limited broadcast'],
  ['240.0.0.0', 4, 'Reserved'],
].map(([a, p, label]) => [parseV4(a), p, label]);

function v4Kind(addr, prefix) {
  if (prefix === 0) return 'Every IPv4 address (default route)';
  for (const [net, p, label] of V4_KINDS) {
    if (((addr & maskOf(p)) >>> 0) === net) return label;
  }
  return 'Public';
}

function calcV4(addr, prefix, input) {
  const mask = maskOf(prefix);
  const network = (addr & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  let first, last, usable, note = '';
  if (prefix === 32) {
    first = last = network;
    usable = 1;
    note = 'A single address.';
  } else if (prefix === 31) {
    first = network;
    last = broadcast;
    usable = 2;
    note = 'A point-to-point link: both addresses are usable and there’s no broadcast (RFC 3021).';
  } else {
    first = network + 1;
    last = broadcast - 1;
    usable = total - 2;
  }
  return {
    version: 4,
    input,
    prefix,
    cidr: `${v4ToString(network)}/${prefix}`,
    address: v4ToString(addr),
    isNetworkAddress: addr === network,
    network: v4ToString(network),
    mask: v4ToString(mask),
    wildcard: v4ToString(~mask >>> 0),
    broadcast: prefix >= 31 ? null : v4ToString(broadcast),
    first: v4ToString(first),
    last: v4ToString(last),
    usable,
    total,
    kind: v4Kind(addr, prefix),
    note,
  };
}

// --- IPv6 -------------------------------------------------------------------------
const FULL128 = (1n << 128n) - 1n;

function parseV6(s) {
  s = s.replace(/%[\w.-]+$/, ''); // zone id, as in fe80::1%eth0
  if (!/^[0-9a-f:.]+$/i.test(s) || s.includes(':::')) return null;
  let tail = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    tail = [n >>> 16, n & 0xffff];
    s = s.slice(0, -v4[1].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part) => (part ? part.split(':') : []);
  const head = toGroups(halves[0]);
  const back = halves.length === 2 ? toGroups(halves[1]) : [];
  if ([...head, ...back].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = head.length + back.length + tail.length;
  let groups;
  if (halves.length === 2) {
    if (known > 7) return null;
    groups = [...head.map((g) => parseInt(g, 16)), ...Array(8 - known).fill(0), ...back.map((g) => parseInt(g, 16)), ...tail];
  } else {
    if (known !== 8) return null;
    groups = [...head.map((g) => parseInt(g, 16)), ...tail];
  }
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

function groupsOf(n) {
  const out = [];
  for (let i = 7; i >= 0; i--) out.push(Number((n >> BigInt(i * 16)) & 0xffffn));
  return out;
}

export function v6Expanded(n) {
  return groupsOf(n).map((g) => g.toString(16).padStart(4, '0')).join(':');
}

// RFC 5952: lowercase, no leading zeros, the longest run of two or more zero groups as "::".
export function v6ToString(n) {
  const g = groupsOf(n);
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

const v6Mask = (prefix) => (prefix === 0 ? 0n : (FULL128 << BigInt(128 - prefix)) & FULL128);

const V6_KINDS = [
  ['::1', 128, 'Loopback'],
  ['::', 128, 'Unspecified address'],
  ['::ffff:0:0', 96, 'IPv4-mapped address'],
  ['64:ff9b::', 96, 'IPv4/IPv6 translation (NAT64)'],
  ['2001::', 32, 'Teredo tunnelling'],
  ['2001:db8::', 32, 'Documentation'],
  ['2002::', 16, '6to4'],
  ['fc00::', 7, 'Unique local address (private)'],
  ['fe80::', 10, 'Link-local'],
  ['ff00::', 8, 'Multicast'],
  ['2000::', 3, 'Global unicast (public)'],
].map(([a, p, label]) => [parseV6(a), p, label]);

function v6Kind(addr, prefix) {
  if (prefix === 0) return 'Every IPv6 address (default route)';
  for (const [net, p, label] of V6_KINDS) {
    if ((addr & v6Mask(p)) === net) return label;
  }
  return 'Reserved';
}

// 2^n as an exact number when it's readable, otherwise as a power with an approximation.
export function powerOfTwo(n) {
  if (n <= 64) return { exact: (1n << BigInt(n)).toLocaleString(), power: `2^${n}` };
  const approx = (2 ** n).toExponential(2).split('e');
  return { exact: null, power: `2^${n}`, approx: `about ${approx[0]} × 10^${Number(approx[1])}` };
}

function calcV6(addr, prefix, input) {
  const mask = v6Mask(prefix);
  const network = addr & mask;
  const last = network | (~mask & FULL128);
  return {
    version: 6,
    input,
    prefix,
    cidr: `${v6ToString(network)}/${prefix}`,
    address: v6ToString(addr),
    isNetworkAddress: addr === network,
    expanded: v6Expanded(addr),
    network: v6ToString(network),
    first: v6ToString(network),
    last: v6ToString(last),
    total: powerOfTwo(128 - prefix),
    subnets64: prefix <= 64 ? powerOfTwo(64 - prefix) : null,
    kind: v6Kind(addr, prefix),
    note: prefix === 128 ? 'A single address.' : '',
  };
}

// --- entry point ----------------------------------------------------------------
// Returns null for empty input, { error } when it can't be read, or the details.
export function parseSubnet(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const s = raw.replace(/\s*\/\s*/, '/').replace(/\s+/g, ' ');

  const [addrPart, rest] = s.includes('/') ? s.split('/', 2) : s.split(' ', 2);
  if (addrPart.includes(':')) {
    const addr = parseV6(addrPart);
    if (addr === null) return { error: 'That isn’t a valid IPv6 address.' };
    let prefix = 128;
    if (rest !== undefined) {
      if (!/^\d{1,3}$/.test(rest) || Number(rest) > 128) return { error: 'An IPv6 prefix is a number from 0 to 128, as in 2001:db8::/48.' };
      prefix = Number(rest);
    }
    return calcV6(addr, prefix, raw);
  }

  const addr = parseV4(addrPart);
  if (addr === null) {
    return { error: /^[\d.]+$/.test(addrPart) ? 'An IPv4 address has four numbers from 0 to 255, as in 192.168.1.10.' : 'Type an address with a prefix, like 10.20.0.0/22 or 192.168.1.10 255.255.255.0.' };
  }
  let prefix = 32;
  if (rest !== undefined && rest !== '') {
    if (/^\d{1,2}$/.test(rest)) {
      prefix = Number(rest);
      if (prefix > 32) return { error: 'An IPv4 prefix is a number from 0 to 32, as in /24.' };
    } else {
      const m = parseV4(rest);
      const p = m === null ? null : prefixFromMask(m);
      if (p === null) return { error: m === null ? 'After the address, put a prefix like /24 or a mask like 255.255.255.0.' : `${rest} isn’t a valid subnet mask.` };
      prefix = p;
    }
  }
  return calcV4(addr, prefix, raw);
}
