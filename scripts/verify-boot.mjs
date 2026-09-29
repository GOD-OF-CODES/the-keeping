#!/usr/bin/env node
// Post-build guard (runs after `vite build`): the boot page must not load three.js or game code before the
// player picks a graphics preset, and the boot payload must stay small.
//
// Checks on dist/index.html:
//   1. No <link rel="modulepreload"> at all (vite.config.ts strips them for the HTML host).
//   2. Every chunk statically reachable from the HTML entry (following `import … from` / `export … from` /
//      bare `import "…"` edges, but NOT dynamic `import()`) is free of three.js and game-runtime markers.
//   3. gzip(HTML + reachable JS + CSS) <= 25 KB.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve, posix } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const LIMIT_BYTES = 25 * 1024;
// Markers that only exist in three.js builds or in our game runtime (src/game/main.ts defines GAME_CHUNK_MARKER).
const THREE_MARKERS = [/three\.js r\d+/, /WebGPURenderer/, /REVISION\s*=\s*['"]1\d\d/, /isWebGLBackend/];
const GAME_MARKERS = [/the-keeping:game-runtime/];

const fail = (msg) => {
  console.error(`verify-boot: FAIL — ${msg}`);
  process.exitCode = 1;
};

const htmlPath = join(DIST, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`verify-boot: ${htmlPath} not found (run vite build first)`);
  process.exit(1);
}
const html = readFileSync(htmlPath, 'utf8');

const attr = (tag, name) => {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
  return m ? m[1] : null;
};
const tags = (name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];

const entryScripts = tags('script')
  .filter((t) => /type\s*=\s*["']module["']/i.test(t))
  .map((t) => attr(t, 'src'))
  .filter(Boolean);
const links = tags('link');
const preloads = links.filter((t) => /rel\s*=\s*["']modulepreload["']/i.test(t)).map((t) => attr(t, 'href'));
const styles = links.filter((t) => /rel\s*=\s*["']stylesheet["']/i.test(t)).map((t) => attr(t, 'href'));

if (entryScripts.length === 0) fail('no module <script> in dist/index.html');
if (preloads.length > 0) fail(`index.html has modulepreload links: ${preloads.join(', ')}`);

const toFile = (url, fromFile) => {
  if (/^https?:/i.test(url)) return null;
  if (url.startsWith('/')) return join(DIST, url.slice(1));
  return resolve(dirname(fromFile), url);
};

// Static import edges only. Dynamic `import(` is skipped because the lookahead demands a quote or identifier.
const STATIC_EDGE = /(?:^|[\s;})])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+\.m?js)["']/g;

const seen = new Map(); // file -> contents
const queue = entryScripts.map((u) => toFile(u, htmlPath)).filter(Boolean);
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  if (!existsSync(file)) {
    fail(`referenced chunk missing: ${file}`);
    continue;
  }
  const src = readFileSync(file, 'utf8');
  seen.set(file, src);
  for (const m of src.matchAll(STATIC_EDGE)) {
    const next = toFile(m[1], file);
    if (next && !seen.has(next)) queue.push(next);
  }
}

for (const [file, src] of seen) {
  const rel = posix.normalize(file.slice(DIST.length + 1));
  for (const re of THREE_MARKERS) if (re.test(src)) fail(`boot chunk ${rel} contains three.js code (${re})`);
  for (const re of GAME_MARKERS) if (re.test(src)) fail(`boot chunk ${rel} contains game runtime code (${re})`);
}

let total = gzipSync(html).length;
const rows = [['index.html', html.length, total]];
for (const [file, src] of seen) {
  const gz = gzipSync(src).length;
  total += gz;
  rows.push([file.slice(DIST.length + 1), src.length, gz]);
}
for (const href of styles) {
  const file = toFile(href, htmlPath);
  if (!file || !existsSync(file)) continue;
  const src = readFileSync(file);
  const gz = gzipSync(src).length;
  total += gz;
  rows.push([file.slice(DIST.length + 1), src.length, gz]);
}

console.log('verify-boot: boot payload (loaded before the preset choice)');
for (const [name, raw, gz] of rows) console.log(`  ${name.padEnd(44)} ${String(raw).padStart(8)} B  ${String(gz).padStart(7)} B gz`);
console.log(`  ${'total'.padEnd(44)} ${''.padStart(8)}    ${String(total).padStart(7)} B gz (limit ${LIMIT_BYTES})`);
if (total > LIMIT_BYTES) fail(`boot payload ${total} B gz exceeds ${LIMIT_BYTES} B`);

if (process.exitCode) process.exit(process.exitCode);
console.log(`verify-boot: OK — ${seen.size} boot chunk(s), no three.js / game code, no modulepreload`);
