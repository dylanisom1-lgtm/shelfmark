// Packages Shelfmark as one zip that works in Chrome, Edge and Firefox.
// No dependencies; needs Node 18+.
//
//   node tools/build.mjs                  → ../shelfmark-builds/shelfmark-<version>.zip
//   node tools/build.mjs --out dist       → dist/shelfmark-<version>.zip
//   node tools/build.mjs --chrome-store   → also shelfmark-<version>-chrome-store.zip,
//                                           without Firefox's manifest section, in case the
//                                           Chrome Web Store objects to it
//
// The manifest lists both background types: Chrome and Edge use the service worker and
// ignore "scripts" (Chrome 121+); Firefox uses "scripts" and ignores "service_worker".
// Firefox's ID and settings live under browser_specific_settings, which Chromium ignores.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] || true : null;
};
const out = resolve(typeof arg('--out') === 'string' ? arg('--out') : join(root, '..', 'shelfmark-builds'));
const SKIP = new Set(['tools', 'node_modules', 'Thumbs.db']);

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (resolve(p) === out) continue;
    if (statSync(p).isDirectory()) files.push(...listFiles(p));
    else files.push(p);
  }
  return files;
}

// --- minimal ZIP writer (deflate) ---------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
function zip(entries) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// --- build --------------------------------------------------------------------
const manifestText = readFileSync(join(root, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const version = manifest.version;
const entries = listFiles(root).map((p) => ({ name: relative(root, p).split(sep).join('/'), data: readFileSync(p) }));

mkdirSync(out, { recursive: true });
const mainZip = join(out, `shelfmark-${version}.zip`);
writeFileSync(mainZip, zip(entries));
console.log(`Shelfmark ${version}: ${entries.length} files`);
console.log(`  All browsers: ${mainZip}`);

if (arg('--chrome-store')) {
  const m = JSON.parse(manifestText);
  delete m.browser_specific_settings;
  m.background = { service_worker: m.background.service_worker, type: m.background.type };
  const storeEntries = entries.map((e) => (e.name === 'manifest.json' ? { name: e.name, data: Buffer.from(JSON.stringify(m, null, 2) + '\n') } : e));
  const storeZip = join(out, `shelfmark-${version}-chrome-store.zip`);
  writeFileSync(storeZip, zip(storeEntries));
  console.log(`  Chrome Web Store: ${storeZip}`);
}
