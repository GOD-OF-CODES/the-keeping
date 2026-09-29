// ~1.5 s zero-asset GPU micro-benchmark on raw WebGL2 (no three.js).
// An ALU-heavy fragment shader renders into an offscreen 512² RGBA8 FBO; each batch ends with a 1×1 readPixels,
// which blocks until the GPU finishes (no vsync, nothing is presented). Batches double until one takes ≥ 40 ms.
//
// Critic fix (research.critique "detect.js benchmark"): on fast GPUs the batch hits its size cap while still
// < 40 ms. The old loop kept `continue`-ing without recording or yielding, so it returned NaN after blocking
// the main thread. Here a batch at the cap is ALWAYS recorded, and every iteration yields.

export const BENCH_W = 512;
export const BENCH_H = 512;
export const BENCH_ITERS = 64;
const BATCH_TARGET_MS = 40;
const BATCH_CAP = 4096; // an M1 needs ~2700 draws to fill a 40 ms batch
const WARMUP_MS = 300;
const SLOW_DRAW_MS = 50; // a single draw slower than this: stop (stay far below the 2 s Windows TDR)

export interface BenchmarkLoopOptions {
  /** Runs n draws and blocks until they complete; returns elapsed ms. */
  runBatch(n: number): number;
  now(): number;
  yieldToEventLoop(): Promise<void>;
  isLost?(): boolean;
  budgetMs?: number;
}

export interface BenchmarkResult {
  /** Mpix·iterations per ms (median over samples), or null when no sample could be taken. Never NaN. */
  raw: number | null;
  samples: number;
  medianDrawMs: number | null;
  elapsedMs: number;
}

/** The batch-doubling measurement loop, independent of WebGL so it can be unit-tested. */
export async function measureLoop(o: BenchmarkLoopOptions): Promise<BenchmarkResult> {
  const budget = o.budgetMs ?? 1500;
  const t0 = o.now();
  const per: number[] = [];
  const warm: number[] = []; // samples inside the warm-up window, used only if nothing else was recorded
  const coarse: number[] = []; // growth batches ≥ 4 ms: last-resort estimate (e.g. throttled background tab)
  let n = 1;
  let lastYield = o.now();
  let iter = 0;
  o.runBatch(1); // shader compile + first draw: never measured
  while (o.now() - t0 < budget && !(o.isLost?.() ?? false)) {
    const dt = Math.max(0, o.runBatch(n));
    const perDraw = dt / n;
    if (perDraw > SLOW_DRAW_MS) {
      per.push(perDraw);
      break;
    }
    const atCap = n >= BATCH_CAP;
    if (dt >= BATCH_TARGET_MS || atCap) {
      // Record (a) batches long enough for ~1 ms timer precision, (b) any batch at the size cap.
      if (o.now() - t0 > WARMUP_MS) per.push(perDraw);
      else warm.push(perDraw);
    } else {
      if (dt >= 4) coarse.push(perDraw);
      n = Math.min(n * 2, BATCH_CAP);
    }
    // Yield at least every ~16 ms (keeps the boot UI responsive) but not after every short growth batch:
    // setTimeout is clamped (≥ 4 ms, ≥ 1 s in background tabs), which would starve the doubling phase.
    if (o.now() - lastYield >= 16 || ++iter % 32 === 0) {
      await o.yieldToEventLoop();
      lastYield = o.now();
    }
  }
  const pool = per.length ? per : warm.length ? warm : coarse;
  const elapsedMs = o.now() - t0;
  const valid = pool.filter((x) => Number.isFinite(x) && x > 0);
  if (!valid.length) {
    // Timer resolution can report 0 ms for a whole capped batch on an absurdly fast GPU: treat as "very fast".
    if (pool.length) return { raw: (BENCH_W * BENCH_H * BENCH_ITERS) / 1e6 / (1 / BATCH_CAP), samples: pool.length, medianDrawMs: 0, elapsedMs };
    return { raw: null, samples: 0, medianDrawMs: null, elapsedMs };
  }
  valid.sort((a, b) => a - b);
  const med = valid[valid.length >> 1];
  const raw = (BENCH_W * BENCH_H * BENCH_ITERS) / 1e6 / med;
  return { raw: Number.isFinite(raw) ? raw : null, samples: valid.length, medianDrawMs: med, elapsedMs };
}

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform float uSeed;
uniform int uIters;
out vec4 o;
void main() {
  vec3 a = vec3(gl_FragCoord.xy * 0.001, uSeed);
  for (int i = 0; i < uIters; i++) {
    a = fract(sin(a.yzx * 1.37 + a.zxy * 0.73 + float(i)) * 43758.5453);
    a += 0.5 * cos(a * 6.2831 + a.zxy);
  }
  o = vec4(a, 1.0);
}`;

/** Macrotask yield via MessageChannel: unlike setTimeout it is not clamped (4 ms, or ≥ 1 s in background tabs). */
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/** Runs the benchmark on an existing WebGL2 context (created with powerPreference 'high-performance'). */
export async function runBenchmark(gl: WebGL2RenderingContext, budgetMs = 1500): Promise<BenchmarkResult> {
  const fail: BenchmarkResult = { raw: null, samples: 0, medianDrawMs: null, elapsedMs: 0 };
  try {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram()!;
    const vs = sh(gl.VERTEX_SHADER, VS);
    const fs = sh(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return fail;
    gl.useProgram(p);
    const uSeed = gl.getUniformLocation(p, 'uSeed');
    gl.uniform1i(gl.getUniformLocation(p, 'uIters'), BENCH_ITERS);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, BENCH_W, BENCH_H);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return fail;
    gl.viewport(0, 0, BENCH_W, BENCH_H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const px = new Uint8Array(4);
    const result = await measureLoop({
      budgetMs,
      now: () => performance.now(),
      isLost: () => gl.isContextLost(),
      yieldToEventLoop: yieldMacrotask,
      runBatch: (n) => {
        const a = performance.now();
        for (let k = 0; k < n; k++) {
          gl.uniform1f(uSeed, Math.random());
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // blocks until the batch is done
        return performance.now() - a;
      },
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return result;
  } catch {
    return fail;
  }
}
