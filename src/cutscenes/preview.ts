// Cutscene preview harness: ?scene=cutscene&id=C2 (ids: C1 C2 C2_replay C3 C4 C5 C6 C7 death).
// Loads with the real level (the level runtime still boots as usual), takes the frame over and plays one cutscene
// through the real bindings — real camera, doors, lights, audio, voices/subtitles, DOF — with stand-in characters
// unless the runtime exposes a real CharacterDirector as `expose.characters`.
//
// The ONE line src/game/main.ts needs (after createPipeline, before loop.start — `rt` is the scene runtime):
//   if (sceneParam === 'cutscene') await (await import('../cutscenes/preview.ts')).installCutscenePreview(rt, { ctx, pipeline, params, input, canvas, lightning });
// (place it right after `const lightning = createLightning(...)`; `?scene=cutscene` otherwise boots the level as usual).
//
// Keys: R replay · N / P next / previous · K skip (always allowed here) · E resolve a gate (pour/key) · 1–9 pick.
// Look-lock cutscenes (C3, C4) keep the mouse (click the canvas for pointer lock first).

import { createCutsceneSystem, type CutsceneSystem } from './bindings.ts';
import { memorySeenStore } from './host.ts';
import { CUTSCENES } from './index.ts';
import { StubCharacters } from './stub-characters.ts';
import { SPAWN, WARDROBE_EYE } from './stage.ts';
import type { P3 } from './types.ts';

export const PREVIEW_IDS = ['C1', 'C2', 'C2_replay', 'C3', 'C4', 'C5', 'C6', 'C7', 'death'] as const;

/** Where the player stands when each cutscene starts (eye, PLAN; heading CCW from east). */
export const PREVIEW_START: Record<string, { eye: P3; heading: number; pitch?: number; ada?: P3; hide?: string }> = {
  C1: { eye: SPAWN.CP1.pos, heading: SPAWN.CP1.heading },
  C2: { eye: [3.1, 1.5, 2.25], heading: 0.35 },
  C2_replay: { eye: SPAWN.CP2.pos, heading: SPAWN.CP2.heading },
  C3: { eye: [8.1, 1.3, 5.75], heading: 0.1 },
  C4: { eye: WARDROBE_EYE, heading: -1.571 },
  C5: { eye: [2.3, 4.6, 2.25], heading: -1.2, ada: [3.2, 1.5, 0.6] },
  C6: { eye: [11.9, -4.2, 1.65], heading: 1.0 },
  C7: { eye: SPAWN.CP1.pos, heading: SPAWN.CP1.heading },
  death: { eye: [2.4, 6.2, 5.75], heading: -1.571, ada: [2.4, 5.2, 4.1] },
};

interface RuntimeLike {
  update(dt: number, now: number, paused: boolean, lightning: number): void;
  step(dt: number, t: number, lightning: number): void;
  expose: Record<string, any>;
}

export async function installCutscenePreview(
  rt: RuntimeLike,
  o: { ctx: any; pipeline: any; params: URLSearchParams; input?: any; canvas?: HTMLElement | null; lightning?: { strike(): void } | null },
): Promise<{ system: CutsceneSystem; play(id: string): void }> {
  const x = rt.expose;
  const { ctx } = o;
  const scene = ctx.scene;
  const stubs = x.characters ? null : new StubCharacters(scene);
  const characters = x.characters ?? stubs;

  // voices + subtitles from the audio / UI lanes (subtitle-only without generated clips)
  let voice: any = null;
  let voiceIndex: Map<string, string[]> | undefined;
  try {
    const [{ VoicePlayer, loadVoiceScript }, { Subtitles }, { buildTriggerIndex }] = await Promise.all([
      import('../audio/voice.ts'),
      import('../ui/subtitles.ts'),
      import('../story/voice-cues.ts'),
    ]);
    const script = await loadVoiceScript();
    if (script) {
      const subs = new Subtitles();
      subs.attach(ctx.events);
      voice = new VoicePlayer({ engine: x.audio ?? null, script, events: ctx.events, subtitles: subs, settings: ctx.settings });
      await voice.load();
      voiceIndex = buildTriggerIndex(script.lines);
    }
  } catch (e) {
    console.warn('[cutscene preview] voices unavailable:', e);
  }

  const seenAll = memorySeenStore([...PREVIEW_IDS, 'C2']);
  const system = createCutsceneSystem({
    ctx,
    camera: ctx.camera,
    pipeline: () => o.pipeline,
    level: x.level,
    player: x.player,
    rig: x.rig,
    audio: x.audio,
    voice,
    voiceIndex,
    characters,
    seen: seenAll,
    canvas: o.canvas ?? ctx.renderer?.domElement ?? null,
    hooks: {
      lightning: () => (o.lightning ?? x.lightning)?.strike?.(),
    },
  });

  // HUD
  const hud = document.createElement('div');
  Object.assign(hud.style, { position: 'fixed', left: '16px', top: '16px', zIndex: '50', color: '#cfc8bb', font: '500 12px/1.5 ui-monospace, Menlo, monospace', background: 'rgba(0,0,0,.45)', padding: '6px 10px', borderRadius: '4px', pointerEvents: 'none', whiteSpace: 'pre' } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(hud);

  let idx = Math.max(0, PREVIEW_IDS.indexOf((o.params.get('id') ?? 'C1') as (typeof PREVIEW_IDS)[number]));
  let restartIn = -1;
  const input = o.input ?? x.input ?? null;

  const play = (id: string) => {
    system.player.cancel();
    const st = PREVIEW_START[id] ?? PREVIEW_START.C1;
    system.deps.world?.placePlayer?.(st.eye, st.heading, st.pitch ?? 0);
    if (st.ada) characters?.place?.('ada', st.ada, st.heading + Math.PI);
    ctx.flags.set('preview', true);
    const ok = system.player.play(id, (skipped) => {
      console.info(`[cutscene preview] ${id} done${skipped ? ' (skipped)' : ''}`);
      restartIn = 2.5;
    });
    if (!ok) console.warn(`[cutscene preview] unknown id ${id}`);
  };

  rt.update = (dt, now, paused, lightning) => {
    const d = paused ? 0 : dt;
    const id = PREVIEW_IDS[idx];
    const pressed = (k: string) => !!input?.wasPressed?.(k);
    if (pressed('KeyR')) play(id);
    if (pressed('KeyN') || pressed('KeyP')) {
      idx = (idx + (pressed('KeyN') ? 1 : PREVIEW_IDS.length - 1)) % PREVIEW_IDS.length;
      play(PREVIEW_IDS[idx]);
    }
    for (let k = 1; k <= 9; k++)
      if (pressed(`Digit${k}`) && PREVIEW_IDS[k - 1]) {
        idx = k - 1;
        play(PREVIEW_IDS[idx]);
      }
    if (pressed('KeyK')) system.player.skip(true);
    if (!paused) x.player?.update?.(d, now); // look-lock cutscenes: mouse look (body stays disabled by the lock)
    system.update(d, { interactHeld: !!input?.isDown?.('KeyE'), interactPressed: pressed('KeyE'), skipHeld: false, breathHeld: !!input?.isDown?.('Space') });
    stubs?.update(d);
    if (restartIn > 0) {
      restartIn -= d;
      if (restartIn <= 0) play(PREVIEW_IDS[idx]);
    }
    rt.step(d, now, lightning); // world: culling from the camera, doors, lights, flashlight rig
    x.audio?.update?.(d, ctx);
    x.interact?.update?.(0, false);
    hud.textContent = `cutscene preview  ${PREVIEW_IDS[idx]}  t=${system.player.time.toFixed(2)}${system.player.waitingGate ? `  [gate ${system.player.waitingGate}: E]` : ''}\nR replay · N/P next/prev · 1–9 pick · K skip${stubs ? ' · stub characters' : ''}`;
  };
  // first frame
  play(PREVIEW_IDS[idx]);
  x.cutscenes = system;
  x.previewPlay = play;
  return { system, play };
}
