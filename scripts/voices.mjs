#!/usr/bin/env node
// THE KEEPING — character voice generator (ElevenLabs, designed voices only). Node 22, no dependencies.
//
//   node scripts/voices.mjs --dry-run                  validate src/shared/voice-script.json, estimate credits (no network)
//   node scripts/voices.mjs design [--speaker ada]     Voice Design: 3 previews per speaker → voices/previews/
//   node scripts/voices.mjs create [--speaker ada] [--pick 2]
//                                                      save the picked preview as a voice → src/shared/voices.json
//   node scripts/voices.mjs speak [--speaker ada] [--line id] [--force] [--limit N]
//                                                      TTS with timestamps → public/assets/voice/<clip>.mp3 + .json,
//                                                      loudnorm ≈ -16 LUFS, rebuilds public/assets/voice/index.json
//   node scripts/voices.mjs index                      rebuild index.json from the files on disk
//   (--script <path> reads another script file, e.g. a test fixture)
//
// Clip naming (the ONE place it is defined): take 1 → "<lineId>.mp3", take k≥2 → "<lineId>_v<k>.mp3"; the word
// timing sidecar has the same stem with ".json". The runtime never guesses names: it reads index.json.
//
// Key: ELEVENLABS_API_KEY from the environment or .env.local (parsed here, never printed, never VITE_-prefixed).
// Requests are cached by content hash in voices/cache.json, so re-runs cost zero credits.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  script: join(ROOT, 'src/shared/voice-script.json'),
  voices: join(ROOT, 'src/shared/voices.json'),
  previews: join(ROOT, 'voices/previews'),
  cache: join(ROOT, 'voices/cache.json'),
  out: join(ROOT, 'public/assets/voice'),
  env: join(ROOT, '.env.local'),
};
const API = 'https://api.elevenlabs.io';

export const SPEAKERS = ['driver', 'harlan', 'ada', 'traveler2'];
export const CHAINS = ['in_head', 'whisper_in_head', 'sack', 'through_floor', 'revenant', 'memory', 'clean'];
export const KINDS = ['line', 'vocal', 'reading'];
const MAX_TTS_CHARS = 3000; // conservative per-request limit (eleven_v3 accepts up to 3k characters)

// ------------------------------------------------------------------------------------------------ pure helpers

export function clipFileName(lineId, take) {
  return take <= 1 ? `${lineId}.mp3` : `${lineId}_v${take}.mp3`;
}

export function sha(obj) {
  return createHash('sha256').update(typeof obj === 'string' ? obj : JSON.stringify(obj)).digest('hex').slice(0, 20);
}

/** Minimal .env parser: KEY=VALUE, optional quotes, # comments, `export ` prefix. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function redact(text, key) {
  if (!key) return String(text);
  return String(text).split(key).join('[REDACTED]');
}

const TAG_RE = /\[[^\]]*\]/g;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Validate a VoiceScript (schema: src/shared/voice-types.ts). Returns { errors, warnings }. */
export function validateScript(s) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  if (!isObj(s)) return { errors: ['script is not a JSON object'], warnings };
  if (s.version !== 1) err(`version must be 1 (got ${JSON.stringify(s.version)})`);
  for (const k of ['model', 'designModel', 'outputFormat']) if (typeof s[k] !== 'string' || !s[k]) err(`${k} must be a non-empty string`);
  if (typeof s.outputFormat === 'string' && !/^(mp3|pcm|opus|ulaw|alaw)_\d+(_\d+)?$/.test(s.outputFormat)) err(`outputFormat '${s.outputFormat}' is not codec_samplerate[_bitrate]`);
  if (typeof s.outputFormat === 'string' && !s.outputFormat.startsWith('mp3_')) warnings.push(`outputFormat '${s.outputFormat}' is not mp3: the runtime expects .mp3 clips`);
  if (!Array.isArray(s.speakers)) err('speakers must be an array');
  if (!Array.isArray(s.lines)) err('lines must be an array');
  if (errors.length) return { errors, warnings };

  const speakerIds = new Set();
  s.speakers.forEach((sp, i) => {
    const at = `speakers[${i}]${sp?.id ? ` (${sp.id})` : ''}`;
    if (!isObj(sp)) return err(`${at} is not an object`);
    if (!SPEAKERS.includes(sp.id)) err(`${at}.id must be one of ${SPEAKERS.join(', ')}`);
    if (speakerIds.has(sp.id)) err(`${at}: duplicate speaker id`);
    speakerIds.add(sp.id);
    if (typeof sp.displayName !== 'string' || !sp.displayName) err(`${at}.displayName missing`);
    if (typeof sp.voiceDescription !== 'string' || sp.voiceDescription.length < 20) err(`${at}.voiceDescription must be ≥ 20 characters`);
    else if (sp.voiceDescription.length > 1000) err(`${at}.voiceDescription must be ≤ 1000 characters`);
    if (typeof sp.previewText !== 'string' || sp.previewText.length < 100 || sp.previewText.length > 1000) err(`${at}.previewText must be 100–1000 characters (got ${sp.previewText?.length ?? 'none'})`);
    if (!Number.isInteger(sp.seed) || sp.seed < 0) err(`${at}.seed must be a non-negative integer`);
    const st = sp.settings;
    if (!isObj(st)) err(`${at}.settings missing`);
    else {
      for (const k of ['stability', 'similarity_boost', 'style']) if (!isNum(st[k]) || st[k] < 0 || st[k] > 1) err(`${at}.settings.${k} must be 0..1`);
      if (!isNum(st.speed) || st.speed < 0.7 || st.speed > 1.2) err(`${at}.settings.speed must be 0.7..1.2`);
      if (typeof st.use_speaker_boost !== 'boolean') err(`${at}.settings.use_speaker_boost must be boolean`);
    }
    if (!CHAINS.includes(sp.defaultChain)) err(`${at}.defaultChain must be one of ${CHAINS.join(', ')}`);
  });

  const lineIds = new Set();
  s.lines.forEach((l, i) => {
    const at = `lines[${i}]${l?.id ? ` (${l.id})` : ''}`;
    if (!isObj(l)) return err(`${at} is not an object`);
    if (typeof l.id !== 'string' || !/^[a-z0-9][a-z0-9_]*$/.test(l.id)) err(`${at}.id must be lower_snake_case`);
    else if (lineIds.has(l.id)) err(`${at}: duplicate line id`);
    lineIds.add(l.id);
    if (!speakerIds.has(l.speaker)) err(`${at}.speaker '${l.speaker}' is not defined in speakers`);
    if (typeof l.text !== 'string' || !l.text.replace(TAG_RE, '').trim() && l.kind !== 'vocal') err(`${at}.text is empty`);
    if (typeof l.text === 'string' && l.text.length > MAX_TTS_CHARS) err(`${at}.text exceeds ${MAX_TTS_CHARS} characters`);
    if (typeof l.text === 'string' && /\[[^\]]*$/.test(l.text)) err(`${at}.text has an unclosed [audio tag`);
    if (typeof l.subtitle !== 'string') err(`${at}.subtitle must be a string ('' for vocals)`);
    else if (TAG_RE.test(l.subtitle)) err(`${at}.subtitle must not contain [audio tags]`);
    TAG_RE.lastIndex = 0;
    if (l.subtitle === '' && !l.caption) warnings.push(`${at}: no subtitle and no caption (inaccessible)`);
    if (l.caption !== undefined && typeof l.caption !== 'string') err(`${at}.caption must be a string`);
    if (typeof l.beat !== 'string' || !l.beat) err(`${at}.beat missing`);
    if (typeof l.trigger !== 'string' || !l.trigger) err(`${at}.trigger missing`);
    if (l.chain !== undefined && !CHAINS.includes(l.chain)) err(`${at}.chain '${l.chain}' is not a VoiceChain`);
    if (!KINDS.includes(l.kind)) err(`${at}.kind must be one of ${KINDS.join(', ')}`);
    if (!Number.isInteger(l.variants) || l.variants < 1 || l.variants > 8) err(`${at}.variants must be an integer 1..8`);
    if (!isNum(l.priority)) err(`${at}.priority must be a number`);
    if (l.milestone !== 'M1' && l.milestone !== 'M2') err(`${at}.milestone must be M1 or M2`);
    for (const k of ['previousText', 'nextText']) if (l[k] !== undefined && typeof l[k] !== 'string') err(`${at}.${k} must be a string`);
  });
  for (const id of speakerIds) if (!s.lines.some((l) => l.speaker === id)) warnings.push(`speaker '${id}' has no lines`);
  return { errors, warnings };
}

/** Credit estimate (characters billed). v3 / multilingual bill 1 credit per character; flash/turbo 0.5. */
export function estimateCredits(s) {
  const rate = /flash|turbo/.test(s.model) ? 0.5 : 1;
  const perSpeaker = {};
  let ttsChars = 0;
  for (const l of s.lines) {
    const c = l.text.length * l.variants;
    ttsChars += c;
    perSpeaker[l.speaker] = (perSpeaker[l.speaker] ?? 0) + c;
  }
  const designChars = s.speakers.reduce((a, sp) => a + sp.previewText.length, 0);
  const takes = s.lines.reduce((a, l) => a + l.variants, 0);
  return { ttsChars, designChars, takes, rate, ttsCredits: Math.ceil(ttsChars * rate), perSpeaker };
}

/** ElevenLabs character alignment → words (tags removed). Mirrors src/audio/voice-timing.ts alignmentToWords. */
export function alignmentToWords(a) {
  const out = [];
  let cur = null;
  let inTag = false;
  const chars = a?.characters ?? [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '[') { inTag = true; continue; }
    if (inTag) { if (ch === ']') inTag = false; continue; }
    if (/\s/.test(ch)) { if (cur) out.push(cur); cur = null; continue; }
    const s = a.character_start_times_seconds[i];
    const e = a.character_end_times_seconds[i];
    if (!cur) cur = { text: ch, start: s, end: e };
    else { cur.text += ch; cur.end = e; }
  }
  if (cur) out.push(cur);
  return out;
}

export function ttsCacheKey({ text, voiceId, model, settings, seed, outputFormat, previousText, nextText }) {
  return sha({ v: 2, text, voiceId, model, settings, seed, outputFormat, previousText: previousText ?? null, nextText: nextText ?? null });
}

/** Deterministic per-take seed. */
export function takeSeed(speakerSeed, lineId, take) {
  const h = parseInt(sha(`${lineId}#${take}`).slice(0, 8), 16);
  return (speakerSeed + h) % 4294967295;
}

// ------------------------------------------------------------------------------------------------ io helpers

const readJson = (p, fallback) => {
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${e.message}`);
  }
};
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};

function loadScriptOrExit() {
  if (!existsSync(PATHS.script)) {
    console.error(`voices: ${rel(PATHS.script)} not found — nothing to validate or generate yet.`);
    console.error('        (The script is authored by the lead; see src/shared/voice-types.ts for the schema.)');
    process.exit(2);
  }
  let s;
  try {
    s = JSON.parse(readFileSync(PATHS.script, 'utf8'));
  } catch (e) {
    console.error(`voices: ${rel(PATHS.script)} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  const { errors, warnings } = validateScript(s);
  for (const w of warnings) console.warn(`  warn: ${w}`);
  if (errors.length) {
    console.error(`voices: ${errors.length} error(s) in ${rel(PATHS.script)}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  return s;
}

const rel = (p) => p.replace(ROOT + '/', '');

export function getApiKey(env = process.env, envFile = PATHS.env) {
  if (env.ELEVENLABS_API_KEY) return env.ELEVENLABS_API_KEY.trim();
  if (existsSync(envFile)) {
    const v = parseEnv(readFileSync(envFile, 'utf8')).ELEVENLABS_API_KEY;
    if (v) return v.trim();
  }
  return null;
}

function requireKey() {
  const key = getApiKey();
  if (!key) {
    console.error('voices: ELEVENLABS_API_KEY is not set.');
    console.error('        Put it in .env.local (git-ignored) as  ELEVENLABS_API_KEY=...  or export it in your shell.');
    console.error('        The game works without it: lines play as timed subtitles.');
    process.exit(3);
  }
  return key;
}

async function api(key, method, path, body, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(redact(`network error calling ${path}: ${e.message}`, key));
    }
    if (res.ok) return res.json();
    const text = redact(await res.text().catch(() => ''), key);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt;
      console.warn(`  ${res.status} from ${path}, retrying in ${(wait / 1000).toFixed(1)} s`);
      await sleep(wait);
      continue;
    }
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        o[k] = next;
        i++;
      } else o[k] = true;
    } else o._.push(a);
  }
  return o;
}

function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/** Loudness-normalise to ≈ -16 LUFS (dialogue), true peak -1.5 dBTP, mp3 44.1 kHz 128 kb/s. Returns false if ffmpeg failed. */
function loudnorm(inPath, outPath) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', outPath], { encoding: 'utf8' });
  if (r.status !== 0) console.warn(`  ffmpeg loudnorm failed: ${r.stderr?.trim().slice(0, 300)}`);
  return r.status === 0;
}

function probeDuration(p) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : null;
}

// ------------------------------------------------------------------------------------------------ commands

function dryRun() {
  const s = loadScriptOrExit();
  const est = estimateCredits(s);
  const voices = readJson(PATHS.voices, { version: 1, voices: {} });
  const cache = readJson(PATHS.cache, { tts: {} });
  let cachedChars = 0;
  for (const l of s.lines) {
    const sp = s.speakers.find((x) => x.id === l.speaker);
    const voiceId = voices.voices?.[l.speaker]?.voiceId;
    if (!voiceId) continue;
    for (let k = 1; k <= l.variants; k++) {
      const key = ttsCacheKey({ text: l.text, voiceId, model: s.model, settings: sp.settings, seed: takeSeed(sp.seed, l.id, k), outputFormat: s.outputFormat, previousText: l.previousText, nextText: l.nextText });
      if (cache.tts?.[key] && existsSync(join(PATHS.out, clipFileName(l.id, k)))) cachedChars += l.text.length;
    }
  }
  console.log(`voice-script OK: ${s.speakers.length} speakers, ${s.lines.length} lines, ${est.takes} takes (model ${s.model}, design ${s.designModel}, ${s.outputFormat})`);
  for (const [sp, c] of Object.entries(est.perSpeaker)) console.log(`  ${sp.padEnd(10)} ${String(c).padStart(6)} chars${voices.voices?.[sp]?.voiceId ? '' : '  (voice not created yet)'}`);
  console.log(`TTS: ${est.ttsChars} characters ≈ ${est.ttsCredits} credits at ${est.rate}/char (${Math.ceil(cachedChars * est.rate)} already cached)`);
  console.log(`Design previews: ${s.speakers.length} speakers × 3 previews (${est.designChars} preview-text chars; billed per design call)`);
  console.log(`API key: ${getApiKey() ? 'present' : 'absent (fine for --dry-run; required for design/create/speak)'}; ffmpeg: ${hasFfmpeg() ? 'yes' : 'NO (clips would not be loudness-normalised)'}`);
  console.log('No network calls were made.');
}

async function design(o) {
  const s = loadScriptOrExit();
  const key = requireKey();
  const list = s.speakers.filter((sp) => !o.speaker || sp.id === o.speaker);
  if (!list.length) return fail(`no speaker '${o.speaker}'`);
  mkdirSync(PATHS.previews, { recursive: true });
  for (const sp of list) {
    const metaPath = join(PATHS.previews, `${sp.id}.json`);
    const reqHash = sha({ d: sp.voiceDescription, t: sp.previewText, m: s.designModel, seed: sp.seed });
    const prev = readJson(metaPath, null);
    if (prev?.requestHash === reqHash && !o.force) {
      console.log(`${sp.id}: previews up to date (voices/previews/${sp.id}_1..${prev.previews.length}.mp3) — use --force to redo`);
      continue;
    }
    console.log(`${sp.id}: designing (${s.designModel}, seed ${sp.seed})…`);
    const res = await api(key, 'POST', '/v1/text-to-voice/design?output_format=mp3_44100_128', {
      voice_description: sp.voiceDescription,
      model_id: s.designModel,
      text: sp.previewText,
      seed: sp.seed,
    });
    const previews = (res.previews ?? []).map((p, i) => {
      const file = `${sp.id}_${i + 1}.mp3`;
      writeFileSync(join(PATHS.previews, file), Buffer.from(p.audio_base_64 ?? p.audio_base64 ?? '', 'base64'));
      return { file, generatedVoiceId: p.generated_voice_id, durationSecs: p.duration_secs ?? null };
    });
    writeJson(metaPath, { speaker: sp.id, requestHash: reqHash, model: s.designModel, seed: sp.seed, createdAt: new Date().toISOString(), previews });
    console.log(`  wrote ${previews.length} previews → voices/previews/${sp.id}_*.mp3 (audition, then: create --speaker ${sp.id} --pick N)`);
  }
}

async function create(o) {
  const s = loadScriptOrExit();
  const key = requireKey();
  const voices = readJson(PATHS.voices, { version: 1, voices: {} });
  const list = s.speakers.filter((sp) => !o.speaker || sp.id === o.speaker);
  if (!list.length) return fail(`no speaker '${o.speaker}'`);
  for (const sp of list) {
    const meta = readJson(join(PATHS.previews, `${sp.id}.json`), null);
    if (!meta?.previews?.length) {
      console.warn(`${sp.id}: no previews yet — run: design --speaker ${sp.id}`);
      continue;
    }
    const pick = Math.max(1, Math.min(meta.previews.length, parseInt(o.pick ?? '1', 10) || 1));
    const chosen = meta.previews[pick - 1];
    if (voices.voices[sp.id]?.generatedVoiceId === chosen.generatedVoiceId && !o.force) {
      console.log(`${sp.id}: already created from preview ${pick} (voice ${voices.voices[sp.id].voiceId})`);
      continue;
    }
    const name = `THE KEEPING — ${sp.displayName}`;
    const res = await api(key, 'POST', '/v1/text-to-voice', {
      voice_name: name,
      voice_description: sp.voiceDescription,
      generated_voice_id: chosen.generatedVoiceId,
      played_not_selected_voice_ids: meta.previews.filter((p) => p !== chosen).map((p) => p.generatedVoiceId),
    });
    if (!res.voice_id) return fail(`${sp.id}: create returned no voice_id`);
    voices.voices[sp.id] = { voiceId: res.voice_id, name, generatedVoiceId: chosen.generatedVoiceId, preview: pick, createdAt: new Date().toISOString() };
    writeJson(PATHS.voices, voices);
    console.log(`${sp.id}: created voice from preview ${pick} → src/shared/voices.json`);
  }
}

async function speak(o) {
  const s = loadScriptOrExit();
  const key = requireKey();
  const voices = readJson(PATHS.voices, { version: 1, voices: {} });
  const cache = readJson(PATHS.cache, { tts: {} });
  cache.tts ??= {};
  const ff = hasFfmpeg();
  if (!ff) console.warn('ffmpeg not found: clips will be written without loudness normalisation.');
  mkdirSync(PATHS.out, { recursive: true });
  const tmp = join(ROOT, 'voices/tmp');
  mkdirSync(tmp, { recursive: true });
  let lines = s.lines.filter((l) => (!o.speaker || l.speaker === o.speaker) && (!o.line || l.id === o.line));
  if (o.milestone) lines = lines.filter((l) => l.milestone === o.milestone);
  const limit = o.limit ? parseInt(o.limit, 10) : Infinity;
  let made = 0;
  let skipped = 0;
  let chars = 0;
  for (const l of lines) {
    const sp = s.speakers.find((x) => x.id === l.speaker);
    const voiceId = voices.voices?.[l.speaker]?.voiceId;
    if (!voiceId) {
      console.warn(`${l.id}: no voice for '${l.speaker}' yet (design + create first) — skipped`);
      continue;
    }
    for (let k = 1; k <= l.variants; k++) {
      if (made >= limit) break;
      const file = clipFileName(l.id, k);
      const seed = takeSeed(sp.seed, l.id, k);
      const ck = ttsCacheKey({ text: l.text, voiceId, model: s.model, settings: sp.settings, seed, outputFormat: s.outputFormat, previousText: l.previousText, nextText: l.nextText });
      if (!o.force && cache.tts[ck]?.file === file && existsSync(join(PATHS.out, file))) {
        skipped++;
        continue;
      }
      const body = { text: l.text, model_id: s.model, voice_settings: sp.settings, seed };
      if (l.previousText) body.previous_text = l.previousText;
      if (l.nextText) body.next_text = l.nextText;
      let res;
      try {
        res = await api(key, 'POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(s.outputFormat)}`, body);
      } catch (e) {
        if (e.status === 400 && /previous_text|next_text/i.test(e.body ?? '') && (body.previous_text || body.next_text)) {
          delete body.previous_text;
          delete body.next_text;
          console.warn(`  ${l.id}: model rejected previous/next text — retrying without`);
          res = await api(key, 'POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(s.outputFormat)}`, body);
        } else throw e;
      }
      const raw = join(tmp, `${l.id}_${k}.raw.mp3`);
      writeFileSync(raw, Buffer.from(res.audio_base64 ?? '', 'base64'));
      const outPath = join(PATHS.out, file);
      if (!(ff && loudnorm(raw, outPath))) writeFileSync(outPath, readFileSync(raw));
      rmSync(raw, { force: true });
      const words = alignmentToWords(res.alignment ?? res.normalized_alignment);
      const duration = probeDuration(outPath) ?? (words.length ? words[words.length - 1].end : 0);
      writeJson(join(PATHS.out, file.replace(/\.mp3$/, '.json')), { id: l.id, durationSec: duration, words });
      cache.tts[ck] = { file, at: new Date().toISOString(), chars: l.text.length };
      writeJson(PATHS.cache, cache);
      made++;
      chars += l.text.length;
      console.log(`  ${file}  ${duration.toFixed(2)} s  ${words.length} words`);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  const idx = buildIndex(s);
  console.log(`speak: ${made} generated (${chars} chars), ${skipped} cached; index lists ${Object.keys(idx.clips).length} lines`);
}

/** index.json: every line with at least one clip on disk (takes in order). */
export function buildIndex(s, outDir = PATHS.out) {
  const clips = {};
  const present = existsSync(outDir) ? new Set(readdirSync(outDir)) : new Set();
  for (const l of s.lines) {
    const files = [];
    const durations = [];
    for (let k = 1; k <= l.variants; k++) {
      const f = clipFileName(l.id, k);
      if (!present.has(f)) continue;
      files.push(f);
      const t = readJson(join(outDir, f.replace(/\.mp3$/, '.json')), null);
      durations.push(t?.durationSec ?? 0);
    }
    if (files.length) clips[l.id] = { files, durations };
  }
  const idx = { version: 1, generatedAt: new Date().toISOString(), clips };
  if (existsSync(outDir) || Object.keys(clips).length) writeJson(join(outDir, 'index.json'), idx);
  return idx;
}

function fail(msg) {
  console.error(`voices: ${msg}`);
  process.exit(1);
}

function help() {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

export async function main(argv) {
  const o = args(argv);
  if (typeof o.script === 'string') PATHS.script = resolve(o.script);
  const cmd = o['dry-run'] ? 'dry-run' : o._[0] ?? 'help';
  const key = getApiKey();
  try {
    switch (cmd) {
      case 'dry-run':
        return dryRun();
      case 'design':
        return await design(o);
      case 'create':
        return await create(o);
      case 'speak':
        return await speak(o);
      case 'index':
        return void buildIndex(loadScriptOrExit());
      case 'help':
      default:
        return help();
    }
  } catch (e) {
    console.error(`voices: ${redact(e?.message ?? e, key)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
