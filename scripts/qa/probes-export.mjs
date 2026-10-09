#!/usr/bin/env node
// Probe-grid export (docs/PERF-PLAN.md P1-4): bakes the LightProbeGrids once per tier in headless Chrome (real GPU,
// through scripts/shot.mjs and its lock) and writes public/assets/<tier>/probes.bin, which the level then loads
// instead of baking (1 140–2 352 cube-face renders: 3–5 s on WebGPU, ~70 s on WebGL2).
//
//   npm run probes                         # all tiers (low, medium, max), build once into scratch/dist-probes
//   npm run probes -- medium               # one tier
//   npm run probes -- --dist scratch/x     # another build dir (parallel lanes never share one)
//
// Re-run after anything the bake sees changes: level GLBs / lightmaps (npm run assets), level-layout.json,
// material-spec.json (those three are in the file's key — the game then falls back to the runtime bake and logs
// "shipped probes are stale"), and after material/lighting CODE changes (not in the key: re-run by hand).
// Then `npm run assets -- --manifest` so the manifests list the new file (kind "probes").
//
// The same file is the shot.mjs scenario (default export): loads with ?probes=bake, reads the baked atlases back
// (window.__game.exportProbes) and writes the file.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function (qa) {
  const tier = await qa.eval('window.__game.ctx.presetId');
  const r = await qa.eval('window.__game.exportProbes()');
  qa.assert(r && r.base64 && r.bytes > 0, `probe export returned data (${tier})`);
  if (!r?.base64) return;
  const file = join(ROOT, 'public', 'assets', tier, 'probes.bin');
  writeFileSync(file, Buffer.from(r.base64, 'base64'));
  qa.report.probes = { tier, key: r.key, bytes: r.bytes, grids: r.grids, file };
  qa.log(`wrote ${file} (${r.bytes} bytes, key ${r.key}, ${r.grids.join(', ')})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dist');
  const dist = di >= 0 ? args[di + 1] : 'scratch/dist-probes';
  const tiers = args.filter((a, i) => !a.startsWith('--') && (di < 0 || i !== di + 1));
  let first = true;
  let failed = 0;
  for (const tier of tiers.length ? tiers : ['low', 'medium', 'max']) {
    const cmd = ['scripts/shot.mjs', '--scenario', 'scripts/qa/probes-export.mjs', '--preset', tier, '--query', 'probes=bake',
      '--wait', '1', '--shots', '0', '--dist', dist, '--out', 'scratch/probes', '--name', `probes-${tier}`, '--timeout', '1800'];
    if (!first) cmd.push('--no-build');
    first = false;
    console.log(`[probes] ${tier}: node ${cmd.join(' ')}`);
    const r = spawnSync(process.execPath, cmd, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      failed++;
      console.error(`[probes] ${tier}: shot.mjs exited ${r.status}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
