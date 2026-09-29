// scripts/voices.mjs: script validation, credit estimate, alignment, clip naming, env parsing, key redaction,
// and the CLI's no-network paths (dry-run with a fixture, missing script, missing key).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const cp = (await import('node:' + 'child_process')) as any;
const fs = (await import('node:' + 'fs')) as any;
const os = (await import('node:' + 'os')) as any;
const path = (await import('node:' + 'path')) as any;
const V = (await import('../scripts/' + 'voices.mjs')) as any;
const proc = (globalThis as any).process;

import { alignmentToWords as tsAlign } from '../src/audio/voice-timing.ts';

function fixture(): any {
  return {
    version: 1,
    model: 'eleven_v3',
    designModel: 'eleven_ttv_v3',
    outputFormat: 'mp3_44100_128',
    speakers: [
      {
        id: 'ada',
        displayName: 'Ada',
        voiceDescription: 'A woman in her late twenties, rural American, warm but exhausted.',
        previewText: 'x'.repeat(120),
        seed: 11,
        settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, speed: 0.95, use_speaker_boost: true },
        defaultChain: 'revenant',
      },
    ],
    lines: [
      { id: 'ada_look', speaker: 'ada', text: '[whispers] …Harlan?', subtitle: '…Harlan?', beat: 'B05', trigger: 'ai:look', kind: 'line', variants: 3, priority: 2, milestone: 'M1' },
      { id: 'ada_gurgle', speaker: 'ada', text: '[a low gurgle] Ghhh…', subtitle: '', caption: '(gurgling)', beat: 'B05', trigger: 'ai:near', kind: 'vocal', variants: 1, priority: 1, milestone: 'M1' },
    ],
  };
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const run = (args: string[], env: Record<string, string> = {}) =>
  cp.spawnSync(proc.execPath, [path.join(ROOT, 'scripts/voices.mjs'), ...args], {
    encoding: 'utf8',
    env: { PATH: proc.env.PATH, HOME: proc.env.HOME, ...env },
    cwd: ROOT,
  });

test('valid fixture passes', () => {
  const { errors } = V.validateScript(fixture());
  assert.deepEqual(errors, []);
});

test('validation catches the common mistakes', () => {
  const s = fixture();
  s.lines[0].subtitle = '[whispers] Harlan?';
  s.lines[1].speaker = 'nobody';
  s.lines.push({ ...s.lines[0], subtitle: 'ok' }); // duplicate id
  s.speakers[0].previewText = 'too short';
  s.speakers[0].settings.speed = 3;
  s.lines[0].chain = 'robot';
  s.lines[0].variants = 0;
  const { errors } = V.validateScript(s);
  const all = errors.join('\n');
  for (const needle of ['must not contain [audio tags]', "speaker 'nobody'", 'duplicate line id', 'previewText', 'speed', "chain 'robot'", 'variants']) {
    assert.ok(all.includes(needle), `expected an error about ${needle}\n${all}`);
  }
  assert.ok(V.validateScript(null).errors.length > 0);
  assert.ok(V.validateScript({ version: 2 }).errors.length > 0);
});

test('credit estimate counts every take', () => {
  const s = fixture();
  const e = V.estimateCredits(s);
  assert.equal(e.ttsChars, s.lines[0].text.length * 3 + s.lines[1].text.length);
  assert.equal(e.takes, 4);
  assert.equal(e.rate, 1);
  assert.equal(V.estimateCredits({ ...s, model: 'eleven_flash_v2_5' }).rate, 0.5);
});

test('clip naming and deterministic seeds', () => {
  assert.equal(V.clipFileName('ada_look', 1), 'ada_look.mp3');
  assert.equal(V.clipFileName('ada_look', 3), 'ada_look_v3.mp3');
  assert.equal(V.takeSeed(11, 'x', 1), V.takeSeed(11, 'x', 1));
  assert.notEqual(V.takeSeed(11, 'x', 1), V.takeSeed(11, 'x', 2));
  const a = V.ttsCacheKey({ text: 'a', voiceId: 'v', model: 'm', settings: {}, seed: 1, outputFormat: 'o' });
  assert.equal(a, V.ttsCacheKey({ text: 'a', voiceId: 'v', model: 'm', settings: {}, seed: 1, outputFormat: 'o' }));
  assert.notEqual(a, V.ttsCacheKey({ text: 'b', voiceId: 'v', model: 'm', settings: {}, seed: 1, outputFormat: 'o' }));
});

test('alignment → words matches the runtime implementation', () => {
  const text = '[sighs] Forty-eight miles… to anything.';
  const chars = [...text];
  const a = { characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => i / 10 + 0.1) };
  assert.deepEqual(V.alignmentToWords(a), tsAlign(a));
  assert.deepEqual(V.alignmentToWords(a).map((w: any) => w.text), ['Forty-eight', 'miles…', 'to', 'anything.']);
});

test('env parsing and key redaction', () => {
  const env = V.parseEnv('# c\nexport ELEVENLABS_API_KEY="sk_abc123"\nOTHER=1 # note\nBAD LINE\n');
  assert.equal(env.ELEVENLABS_API_KEY, 'sk_abc123');
  assert.equal(env.OTHER, '1');
  assert.equal(V.redact('failed for sk_abc123 twice sk_abc123', 'sk_abc123'), 'failed for [REDACTED] twice [REDACTED]');
  assert.equal(V.getApiKey({ ELEVENLABS_API_KEY: ' k ' }, '/nonexistent'), 'k');
  assert.equal(V.getApiKey({}, '/nonexistent'), null);
});

test('CLI: dry-run on a fixture (no key, no network), missing script, missing key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-voices-'));
  const f = path.join(dir, 'script.json');
  fs.writeFileSync(f, JSON.stringify(fixture()));
  const ok = run(['--dry-run', '--script', f]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /voice-script OK/);
  assert.match(ok.stdout, /No network calls were made/);
  const missing = run(['--dry-run', '--script', path.join(dir, 'nope.json')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /not found/);
  const bad = fixture();
  bad.lines[0].subtitle = '[x] y';
  fs.writeFileSync(f, JSON.stringify(bad));
  const invalid = run(['--dry-run', '--script', f]);
  assert.equal(invalid.status, 1);
  fs.writeFileSync(f, JSON.stringify(fixture()));
  // design without a key: clear message, exit 3 (HOME/cwd .env.local may exist — only assert when no key is configured)
  if (!V.getApiKey()) {
    const nokey = run(['design', '--script', f]);
    assert.equal(nokey.status, 3);
    assert.match(nokey.stderr, /ELEVENLABS_API_KEY is not set/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('index is built from the clips on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-voice-out-'));
  fs.writeFileSync(path.join(dir, 'ada_look.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'ada_look_v3.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'ada_look_v3.json'), JSON.stringify({ id: 'ada_look', durationSec: 1.25, words: [] }));
  const idx = V.buildIndex(fixture(), dir);
  assert.deepEqual(idx.clips.ada_look.files, ['ada_look.mp3', 'ada_look_v3.mp3']);
  assert.deepEqual(idx.clips.ada_look.durations, [0, 1.25]);
  assert.equal(idx.clips.ada_gurgle, undefined);
  assert.ok(fs.existsSync(path.join(dir, 'index.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});
