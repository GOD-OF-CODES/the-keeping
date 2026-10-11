// Audio lane, fix round 4 (ruling x): RECORD the real in-game mix (master bus AFTER the limiter) of B03's doorway
// approach → C2 → C2c → the first 10 s of B05 in real time, and log the picture clock against the audio clock.
//   node scripts/shot.mjs --scenario scripts/qa/c2-listen.mjs --beat B03 --preset medium --dist <dir> --timeout 2400
// Output: scratch/listen/c2-c2c.raw.wav (context rate, 16-bit stereo) + scratch/listen/c2-listen.json (frame log,
// sfx play log, chunk map). scripts/qa/c2-listen-post.mjs turns them into the 48 kHz WAVs and the sync report.
// The tap is an AudioWorklet: `currentTime` inside process() is the exact context time of the quantum's first sample.
import { writeFileSync, mkdirSync } from 'node:fs';

const B05_TAIL_S = Number(process.env.LISTEN_B05_S ?? 10);
const OUT = process.env.LISTEN_OUT ?? 'scratch/listen'; // e.g. LISTEN_OUT=scratch/listen/max for a --preset max run

export default async function (qa) {
  mkdirSync(OUT, { recursive: true });
  const setup = await qa.eval(`(async () => {
    const g = window.__game; const a = g.audio; const c = a.ctx;
    if (c.state !== 'running') { try { await c.resume(); } catch {} }
    const src = \`class TkTap extends AudioWorkletProcessor {
      constructor() { super(); this.N = 4800; this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); this.n = 0; this.t0 = 0; this.on = true;
        this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; }
      process(inputs) {
        if (!this.on) return false;
        const i = inputs[0]; const l = i && i[0]; const r = i && (i[1] || i[0]);
        for (let k = 0; k < 128; k++) {
          if (this.n === 0) this.t0 = currentTime + k / sampleRate;
          this.L[this.n] = l ? l[k] : 0; this.R[this.n] = r ? r[k] : 0; this.n++;
          if (this.n === this.N) { this.port.postMessage({ t: this.t0, L: this.L, R: this.R }, [this.L.buffer, this.R.buffer]);
            this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); this.n = 0; }
        }
        return true;
      } }
      registerProcessor('tk-tap', TkTap);\`;
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    await c.audioWorklet.addModule(url);
    const tap = new AudioWorkletNode(c, 'tk-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const sink = c.createGain(); sink.gain.value = 0;
    a.limiter.connect(tap); tap.connect(sink).connect(c.destination);
    const L = window.__listen = { chunks: [], frames: [], plays: [], t0: c.currentTime, done: false, tap, sink };
    tap.port.onmessage = (e) => L.chunks.push(e.data);
    // sfx log: what the engine was asked to play, when, and whether a buffer existed (null = dropped)
    const play0 = a.play.bind(a);
    a.play = (id, o = {}) => { const h = play0(id, o); L.plays.push([+c.currentTime.toFixed(4), id, o.when != null ? +o.when.toFixed(4) : null, h ? 1 : 0, o.bus ?? null]); return h; };
    // heartbeat LAYER beats bypass play(): wrap LiveLayers.fire to log the scheduled beat times
    // (the layer's beats are routed through one extra unity GainNode so they can be metered on their own: 'heart')
    const heartNode = c.createGain(); heartNode.connect(a.buses.player);
    if (a.layers && a.layers.fire) { const f0 = a.layers.fire.bind(a.layers); a.layers.fire = (b, when, dest, gain, rate) => { if (dest === a.buses.player) { L.plays.push([+c.currentTime.toFixed(4), 'L:heart', +when.toFixed(4), 1, 'player']); return f0(b, when, heartNode, gain, rate); } return f0(b, when, dest, gain, rate); }; }
    const revSum = c.createGain(); for (const r of a.reverbs?.values?.() ?? []) r.output.connect(revSum);
    // per-bus K-weighted (≈ BS.1770: +4 dB shelf 1.5 kHz, HP 38 Hz) mean square in 100 ms windows, POST-duck
    L.bus = {};
    for (const bn of ['ambience', 'weather', 'sfx', 'creature', 'player', 'score', 'voice', 'heart', 'reverb', 'master']) {
      const node = bn === 'heart' ? heartNode : bn === 'reverb' ? revSum : bn === 'master' ? a.master : (a.duck?.[bn] ?? a.buses[bn]); if (!node) continue;
      const hs = c.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1500; hs.gain.value = 4;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
      const sp = c.createScriptProcessor(1024, 2, 1); const rec = L.bus[bn] = { t0: null, ms: [] }; let acc = 0, n = 0; const W = Math.round(0.1 * c.sampleRate);
      sp.onaudioprocess = (e) => { if (rec.t0 === null) rec.t0 = e.playbackTime; const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
        for (let k = 0; k < l.length; k++) { acc += (l[k] * l[k] + r[k] * r[k]) / 2; if (++n >= W) { rec.ms.push(acc / n); acc = 0; n = 0; } } };
      node.connect(hs); hs.connect(hp); hp.connect(sp); sp.connect(sink);
    }
    // picture log: every rAF → [rafTs ms, ctx.currentTime, outTs.contextTime, outTs.performanceTime, beat, cs id, cs time]
    const st = () => g.director.story.beat;
    const raf = (ts) => {
      const o = c.getOutputTimestamp ? c.getOutputTimestamp() : {};
      const p = g.cutscenes?.player;
      L.frames.push([+ts.toFixed(2), +c.currentTime.toFixed(4), +(o.contextTime ?? 0).toFixed(4), +(o.performanceTime ?? 0).toFixed(2), st(), p?.active ?? null, p?.active ? +p.time.toFixed(4) : null]);
      if (!L.done) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    return { sr: c.sampleRate, state: c.state, base: c.baseLatency, outLat: c.outputLatency, beat: st(), cs: g.cutscenes?.player?.active ?? null };
  })()`);
  qa.log('setup ' + JSON.stringify(setup));

  // real-time walk to the threshold (input.down + yaw steering every 33 ms), then let C2 → C2c → B05 play
  const run = await qa.eval(`(async () => {
    const g = window.__game; const L = window.__listen; const c = g.audio.ctx;
    const cs = () => g.cutscenes?.player?.active ?? null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let w = 0; while (cs() && cs() !== 'C2' && w++ < 600) await sleep(50); // any intro cut first (real time, recorded)
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
    let k = 0; const tw = performance.now();
    while (!cs() && performance.now() - tw < 40000) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      const d = Math.hypot(p[0] - to[0], p[1] - to[1]);
      if (k < legs.length - 1 && d < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      if (d > 0.2) g.input.down.add('KeyW'); else g.input.down.delete('KeyW');
      await sleep(33);
    }
    g.input.down.delete('KeyW');
    const walkS = (performance.now() - tw) / 1000; const c2At = c.currentTime;
    let seenB05 = null;
    const tc = performance.now();
    while (performance.now() - tc < 90000) {
      const b = g.director.story.beat;
      if (!cs() && b === 'B05' && seenB05 === null) seenB05 = c.currentTime;
      // QA subtitle flag proof: while "Go on, then." (C2 17.3) is on, is the subtitle element hidden?
      if (!L.subs && cs() === 'C2' && g.cutscenes.player.time > 17.6) { const el = document.querySelector('.tk-subs'); L.subs = { text: el?.textContent ?? null, visibility: el ? getComputedStyle(el).visibility : null, flag: typeof window.__tkHideSubs }; }
      if (seenB05 !== null && c.currentTime - seenB05 >= ${B05_TAIL_S}) break;
      await sleep(50);
    }
    L.tap.port.postMessage('stop'); await sleep(300); L.done = true;
    return { subs: L.subs, walkS: +walkS.toFixed(2), c2At: +(c2At - L.t0).toFixed(3), b05At: seenB05 && +(seenB05 - L.t0).toFixed(3), endBeat: g.director.story.beat, chunks: L.chunks.length, frames: L.frames.length, plays: L.plays.length };
  })()`);
  qa.log('run ' + JSON.stringify(run));

  // pull PCM out in 5 s groups as base64 int16 interleaved
  const n = run.chunks; const pcm = []; const chunkT = []; let floatPeak = 0;
  for (let i = 0; i < n; i += 50) {
    const part = await qa.eval(`(() => {
      const ch = window.__listen.chunks.slice(${i}, ${i + 50}); let len = 0; for (const x of ch) len += x.L.length;
      const out = new Int16Array(len * 2); let o = 0; const ts = []; let fpk = 0;
      for (const x of ch) { ts.push(x.t); for (let s = 0; s < x.L.length; s++) { fpk = Math.max(fpk, Math.abs(x.L[s]), Math.abs(x.R[s]));
        out[o++] = Math.max(-32768, Math.min(32767, Math.round(x.L[s] * 32767)));
        out[o++] = Math.max(-32768, Math.min(32767, Math.round(x.R[s] * 32767))); } }
      const u8 = new Uint8Array(out.buffer); let bin = ''; for (let s = 0; s < u8.length; s += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(s, s + 0x8000));
      return { b64: btoa(bin), ts, fpk };
    })()`);
    pcm.push(Buffer.from(part.b64, 'base64')); chunkT.push(...part.ts); floatPeak = Math.max(floatPeak, part.fpk);
  }
  const data = Buffer.concat(pcm);
  const sr = setup.sr;
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  writeFileSync(`${OUT}/c2-c2c.raw.wav`, Buffer.concat([hdr, data]));
  const meta = await qa.eval(`(() => { const L = window.__listen; return { t0: L.t0, frames: L.frames, plays: L.plays, bus: Object.fromEntries(Object.entries(L.bus).map(([k, v]) => [k, { t0: v.t0, db: v.ms.map((m) => +(10 * Math.log10(m + 1e-12) - 0.691).toFixed(1)) }])) }; })()`);
  // gaps between chunk timestamps (should be exactly N/sr apart)
  let maxGap = 0; for (let i = 1; i < chunkT.length; i++) maxGap = Math.max(maxGap, Math.abs(chunkT[i] - chunkT[i - 1] - 4800 / sr));
  writeFileSync(`${OUT}/c2-listen.json`, JSON.stringify({ setup, run, sr, wavT0: chunkT[0], chunkMaxJitter: maxGap, chunkT, floatPeakDb: +(20 * Math.log10(floatPeak + 1e-9)).toFixed(2), ...meta }));
  qa.log(`wav ${(data.length / 4 / sr).toFixed(2)} s @ ${sr} Hz, chunk jitter ${maxGap.toExponential(2)} s`);
  qa.assert(run.b05At != null, 'reached B05 and recorded its first ' + B05_TAIL_S + ' s');
}
