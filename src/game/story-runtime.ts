// The playable game on top of the level: the Director (src/story/director.ts: Ada's brain + the beat machine),
// the characters (src/characters), voices + subtitles, documents, prompts, hints, death fades and the lightning /
// storm cadence. Created by main.ts's startLevel after the level, player, hides and audio exist; docs/INTEGRATION.md
// describes the wiring. Update order (per frame): player → director.update → characters → (world, audio, render).

import * as THREE from 'three/webgpu';
import type { GameContext } from './context.ts';
import type { Input } from '../core/input.ts';
import type { Level } from '../world/level.ts';
import type { PlayerController } from '../player/controller.ts';
import type { HideSystem } from '../world/hides.ts';
import type { FlashlightRig } from '../player/flashlight-rig.ts';
import type { Inventory, Journal } from '../player/inventory.ts';
import type { Interactables } from '../world/interactables.ts';
import type { AdaOutput, BeamView, PlayerView } from '../ai/types.ts';
import type { P3 } from '../shared/layout-types.ts';
import type { StoryDocument } from '../story/documents.ts';
import type { BeatId } from '../story/escape-state.ts';
import { planToWorld, worldToPlan } from '../shared/coords.ts';
import { headingToCameraYaw } from '../world/rooms.ts';
import { AdaCharacter } from '../characters/ada.ts';
import { HarlanCharacter } from '../characters/harlan.ts';
import { FpArms } from '../characters/arms.ts';
import { loadCharacter } from '../characters/loader.ts';
import { CharacterBank } from '../characters/bank.ts';
import { drawDocumentPage } from '../player/inventory.ts';
import { createM2World, ITEM_PROPS } from './m2-world.ts';
import { createCutsceneFx } from '../world/cutscene-fx.ts';
import { END_CARD_Z, harlanHeldAtTable } from './staging.ts';
import { createBodyControl, FadeState } from './body-control.ts';

/** What main.ts's lightning controller offers the story (strike + storm cadence). */
export interface LightningControl {
  strike(): void;
  setStorm(intervalSec: number, rumbleScale: number): void;
  /** Current flash level 0..1 (C5's shadow-play light follows it). */
  readonly level?: number;
}

export interface StoryDeps {
  ctx: GameContext;
  input: Input;
  level: Level;
  player: PlayerController;
  hides: HideSystem;
  rig: FlashlightRig;
  inventory: Inventory;
  journal: Journal;
  interact: Interactables;
  audio: any | null;
  toast(text: string): void;
  params: URLSearchParams;
}

/** Story sfx the beats emit without a position: where they happen. */
const SFX_AT: Record<string, { prop: string; room: string }> = {
  bell_pull: { prop: 'P_BELL_PULL', room: 'U2' },
  fabric_tear: { prop: 'P_DRESS', room: 'U3' },
};

const BEATS: BeatId[] = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13'];
const beatIdx = (b: string | null | undefined) => (b ? BEATS.indexOf(b as BeatId) : -1);
/** Movement keys that close a reading page (and are consumed with it). */
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

export async function createStoryRuntime(d: StoryDeps) {
  const { ctx, input, level, player, hides, rig, inventory, journal, interact, audio } = d;
  const { camera, scene, layout } = ctx;
  const P = (v: any): P3 => worldToPlan([v.x, v.y, v.z]) as P3;

  // ---------------------------------------------------------------- characters (tolerate missing assets)
  // Characters see the probe lights AND the candles' / lamp's runtime flicker lights: the tableau (C2, C5, C7) and
  // the kitchen / bedroom encounters get a flickering warm key instead of reading as flat silhouettes.
  const { lights: lightsOf } = await import('three/tsl');
  const flickerLights = level.lights.flickers.map((f) => f.light);
  const charLights = lightsOf([...(level.houseLights?.length ? level.houseLights : level.probeLights), ...flickerLights]); // round D perf: no CAR/RC9 spots
  const lopt = { presetId: ctx.presetId, preset: ctx.preset, lightsNode: charLights };
  const [adaC, harlanC, armsC] = await Promise.all(
    (['ada', 'harlan', 'arms'] as const).map((id) =>
      loadCharacter(id, lopt).catch((e) => {
        console.warn(`[story] ${id} failed to load:`, e);
        return null;
      }),
    ),
  );
  const ada = adaC ? new AdaCharacter(adaC) : null;
  const harlan = harlanC ? new HarlanCharacter(harlanC) : null;
  const arms = armsC ? new FpArms(armsC, rig.rig) : null;
  let armsCar = false;
  let setArmsCar = (_car: boolean): void => {};
  if (armsC) {
    // The SpotLight sits INSIDE the torch head: the arms must not see it (the bezel lit up like a ring from
    // behind). They keep the probes, lightning and runtime lights.
    const armLights = lightsOf([...level.probeLights.filter((l) => l !== rig.flashlight.light), ...flickerLights]);
    // runtime lane D perf: in the house the arms drop the opening's CAR/RC9 spots (L_DOME / L_TRUCK_HI_L shadows,
    // cookies) — 23 → 18 lights per arm pixel. The full list comes back only while the interior is mounted (C0/C1
    // gloves on the wheel). Two fixed LightsNodes, switched at the mount (both warmed at load: rc9-road step).
    const house = level.houseLights?.length ? level.houseLights : level.probeLights;
    const armHouse = lightsOf([...house.filter((l) => l !== rig.flashlight.light), ...flickerLights]);
    // runtime lane E (item 3, surgical): a fixed material set per LightsNode (FpArms.setLightSets) — the old
    // lightsNode switch + needsUpdate rebuilt the arms' shaders at C0's first live cut (0.17–0.42 s)
    arms!.setLightSets(armHouse, armLights);
    setArmsCar = (car: boolean) => {
      if (car === armsCar) return;
      armsCar = car;
      arms!.useCarLights(car);
    };
  }
  if (ada) {
    scene.add(ada.group);
    ada.roomVisible = (room) => !level.cullingEnabled || level.visible.has(room);
  }
  if (harlan) (level.roomGroups.get('G2') ?? scene).add(harlan.group);
  /** The cutscene lane's CharacterDirector (structural match of src/cutscenes/host.ts). */
  const characters = new CharacterBank(ada, harlan, arms);
  characters.propSource = (id) => level.prop(id);
  characters.lightsNode = charLights;
  /** The cutscene lane plugs its CutscenePlayer.playCutscene in here (setCutscenePlayer); null = director fallback. */
  let cutscenePlayer: ((id: string, done: (skipped: boolean) => void) => boolean) | null = null;
  let stormNow = { interval: 35, rumble: 1 };
  let stormAutoOn = true;
  const fxWarned = new Set<string>();
  let pipelineRef: any = null;
  let lightning: LightningControl | null = null;
  let camHeldByCutscene = false;
  const fxw = createCutsceneFx({
    level,
    camera,
    characters,
    pipeline: () => pipelineRef,
    lightningLevel: () => lightning?.level ?? 0,
    cameraHeld: () => camHeldByCutscene,
    preset: ctx.preset, // opening: lamp/dome shadow tiers
  });
  /** Cutscene fx (docs/CUTSCENES.md fx table): src/world/cutscene-fx.ts; unknown ones are logged once. */
  const cutsceneFx = (id: string, p: Record<string, number | string | boolean>) => {
    if (id === 'can_in_hand') {
      if (!p.on) {
        m2?.canAtFiller(false);
        armsProp(null);
      }
      return;
    }
    if (fxw.fx(id, p)) return;
    if (!fxWarned.has(id)) {
      fxWarned.add(id);
      console.info(`[story] cutscene fx '${id}' has no world implementation yet (${JSON.stringify(p)})`);
    }
  };
  let tableauOn = false;

  // ---------------------------------------------------------------- M2 world (props from flags, hem, bell pull, wardrobe back, locket)
  let locketForced = false;
  const locketUp = () => inventory.has('locket') && (input.isDown('Mouse2') || locketForced);
  const m2 = createM2World({ ctx, input, level, player, hides, rig, inventory, audio, arms, locketRaised: locketUp });
  /** A prop in the first-person right hand (arms `prop_r` socket): the hammer while prying, the shears, the can. */
  const heldProps = new Map<string, any>();
  const armsProp = (propId: string | null) => {
    for (const [id, o] of heldProps) o.visible = id === propId;
    if (!propId || heldProps.has(propId) || !arms) return;
    const sock = arms.c.bones.get('prop_r');
    const src = level.prop(propId);
    if (!sock || !src) return;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.traverse((n: any) => {
      n.visible = true;
      n.matrixAutoUpdate = true;
      n.frustumCulled = false;
      if (n.isMesh) {
        n.castShadow = false;
        n.renderOrder = 5;
      }
    });
    sock.add(c);
    heldProps.set(propId, c);
  };

  // ---------------------------------------------------------------- voices + subtitles
  let voice: any = null;
  let script: any = null;
  let voiceIdx: any = null;
  const voiceMod = await import('../story/voice-cues.ts');
  try {
    const [{ VoicePlayer, loadVoiceScript }, { Subtitles }] = await Promise.all([import('../audio/voice.ts'), import('../ui/subtitles.ts')]);
    const subs = new Subtitles();
    subs.attach(ctx.events);
    script = await loadVoiceScript();
    if (script) {
      voice = new VoicePlayer({ engine: audio, script, events: ctx.events, subtitles: subs, settings: ctx.settings });
      await voice.load();
      voiceIdx = voiceMod.buildTriggerIndex(script.lines ?? []);
    }
  } catch (e) {
    console.warn('[story] voices unavailable:', e);
  }
  const speakerOf = (lineId: string): string | null => script?.lines?.find((l: any) => l.id === lineId)?.speaker ?? null;

  // ---------------------------------------------------------------- tableau (pre-C2): Ada on the sawbuck table, Harlan over her
  const tableau = computeTableau(level);

  // ---------------------------------------------------------------- UI: fade, prompt, reading overlay, end card
  const ui = makeUi();
  input.addBlocker(() => ui.reading); // a page on screen: no walking / looking / interacting under it

  // ---------------------------------------------------------------- per-frame player sampling
  void ITEM_PROPS;
  const lensW = new THREE.Vector3();
  const tgtW = new THREE.Vector3();
  const dirW = new THREE.Vector3();
  const eyeW = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpD = new THREE.Vector3();
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  let lastOut: AdaOutput | null = null;

  const los = (a: P3, b: P3): boolean => {
    tmpA.set(...planToWorld(a));
    tmpB.set(...planToWorld(b));
    const len = tmpD.subVectors(tmpB, tmpA).length();
    if (len < 1e-3) return true;
    tmpD.normalize();
    return level.collision.sightDistance(tmpA, tmpD, len) >= len - 0.05;
  };

  const beamView = (): BeamView => {
    const L = rig.flashlight.light;
    L.getWorldPosition(lensW);
    L.target.getWorldPosition(tgtW);
    dirW.subVectors(tgtW, lensW).normalize();
    const range = 14;
    const hitD = level.collision.rayDistance(lensW, dirW, range);
    const hit = Number.isFinite(hitD) ? P(tmpA.copy(lensW).addScaledVector(dirW, hitD)) : null;
    // LIGHTING lane (REALISM-BACKLOG item 11): the torch is no longer dimmed near walls (the old `gain` "pupil"
    // here) — the camera's eye adaptation (src/render/exposure.ts) meters the hot spot instead.
    const dp = worldToPlan([dirW.x, dirW.y, dirW.z]) as P3;
    return { on: rig.on, origin: P(lensW), dir: dp, range, halfAngle: L.angle, hit };
  };

  const playerView = (): PlayerView => {
    camera.getWorldPosition(eyeW);
    const rmb = input.isDown('Mouse2');
    if (rmb) locketForced = false;
    const hasLocket = inventory.has('locket') && !hides.active;
    return {
      pos: player.planFeet() as P3,
      eye: P(eyeW),
      room: level.room,
      crouched: player.crouch > 0.5,
      running: player.running,
      speed: player.speed,
      hiddenIn: hides.active?.id ?? null,
      holdingBreath: player.holdingBreath,
      beam: beamView(),
      locketRaised: hasLocket && (rmb || locketForced),
    };
  };

  const playerCanSee = (p: P3): boolean => {
    if (ui.black) return false;
    camera.updateMatrixWorld();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const head: P3 = [p[0], p[1], p[2] + 1.4];
    const mid: P3 = [p[0], p[1], p[2] + 0.8];
    camera.getWorldPosition(eyeW);
    const eye = P(eyeW);
    const see = (q: P3) => frustum.containsPoint(tmpB.set(...planToWorld(q))) && los(eye, q);
    return see(head) || see(mid);
  };

  // ---------------------------------------------------------------- Ada audio (drip, tells, loops, footfalls)
  let dripStarted = false;
  let loopHandle: any = null;
  let loopKind: string | null = null;
  let stride = 0;
  const lastAdaPos = new THREE.Vector3();
  const adaAudio = (out: AdaOutput) => {
    if (!audio) return;
    const w = planToWorld(out.pos);
    if (!out.visible) {
      if (dripStarted) {
        audio.layers.stopDrip(false);
        dripStarted = false;
      }
      if (loopHandle) {
        loopHandle.stop(0.4);
        loopHandle = null;
        loopKind = null;
      }
      return;
    }
    if (!dripStarted) {
      audio.layers.startDrip(out.tells.dripRate || 1);
      dripStarted = true;
    }
    audio.layers.setDripPosition(w[0], w[1] + 1.2, w[2], out.room);
    audio.layers.setDripRate(out.tells.dripRate);
    if (out.tells.dripStopped) audio.layers.stopDrip(false);
    else if (out.state !== 'LISTEN') audio.layers.resumeDrip();
    if (out.tells.crack) audio.play('ada_bone_crack', { pos: [w[0], w[1] + 1.45, w[2]], room: out.room });
    if (out.tells.gurgle) audio.play('ada_gurgle', { pos: [w[0], w[1] + 1.4, w[2]], room: out.room });
    // looping foley
    const want = out.tells.loop === 'scrape_wood' ? 'ada_scrape_wood' : out.tells.loop === 'nails_plaster' ? 'ada_nails_plaster' : null;
    if (want !== loopKind) {
      loopHandle?.stop(0.5);
      loopHandle = want ? audio.play(want, { pos: [w[0], w[1] + 1.5, w[2]], room: out.room, loop: true, gain: 0.8, fadeIn: 0.4 }) : null;
      loopKind = want;
    } else loopHandle?.setPosition(w[0], w[1] + 1.5, w[2], out.room);
    // wet footfalls (slaps) by distance travelled
    tmpA.set(w[0], w[1], w[2]);
    const moved = lastAdaPos.distanceTo(tmpA);
    lastAdaPos.copy(tmpA);
    if (moved < 1) {
      stride += moved;
      const step = out.state === 'CHASE' ? 0.9 : 0.55;
      if (stride > step) {
        stride = 0;
        audio.play(Math.random() < 0.7 ? 'ada_slap' : 'ada_gown_slap', { pos: [w[0], w[1] + 0.05, w[2]], room: out.room, gain: out.state === 'CHASE' ? 1 : 0.7 });
      }
    }
  };

  // ---------------------------------------------------------------- the Director
  const { Director } = await import('../story/director.ts');
  const hintMarkers: any[] = [];
  const director = new Director({
    layout,
    events: ctx.events,
    flags: ctx.flags,
    seed: 1976,
    host: {
      player: playerView,
      doorState: (id) => {
        const dd = level.doors.doors.get(id);
        return !dd ? 'closed' : dd.lock ? 'locked' : Math.abs(dd.angle) > 10 ? 'open' : 'closed';
      },
      lineOfSight: los,
      playerCanSee,
      pushDoor: (id, fast) => level.doors.open(id, fast, true),
      door: (id, a) => {
        if (a === 'rope_open') level.doors.ropeOpen();
        else if (a === 'rope_close') level.doors.ropeClose();
        else level.doors.setLock(id, a === 'lock' ? 'locked' : null);
      },
      // The cutscene lane plugs in via setCutscenePlayer (docs/INTEGRATION.md); until then the director times out.
      playCutscene: (id, done) => (cutscenePlayer ? cutscenePlayer(id, done) : false),
      voice: (t) => {
        if (!voice || !voiceIdx) return;
        for (const id of voiceMod.linesForTrigger(voiceIdx, t)) {
          const sp = speakerOf(id);
          if (sp === 'ada' && ada && lastOut?.visible) {
            const h = ada.headWorld(new THREE.Vector3());
            void voice.play(id, { pos: [h.x, h.y, h.z], room: lastOut.room });
          } else if (sp === 'harlan' && harlan?.visible) {
            const h = harlan.group.getWorldPosition(new THREE.Vector3());
            void voice.play(id, { pos: [h.x, h.y + 1.7, h.z], room: 'G2' });
          } else void voice.play(id);
        }
      },
      sfx: (id, pos, room) => {
        if (!audio) return;
        if (id === 'spring_bell_loop') {
          const bell = level.prop('P_SPRING_BELL');
          const bp = bell ? bell.getWorldPosition(new THREE.Vector3()) : null;
          nonstopBell?.stop(0.2);
          nonstopBell = audio.play(id, bp ? { pos: [bp.x, bp.y, bp.z], room: 'G2', loop: true } : { loop: true });
          return;
        }
        if (id === 'bolt_slide') return; // the passage door's own bolt plays it, positionally (doors.ts)
        if (!pos && SFX_AT[id]) {
          const o = level.prop(SFX_AT[id].prop);
          if (o) {
            const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
            audio.play(id, { pos: [c.x, c.y, c.z], room: SFX_AT[id].room });
            return;
          }
        }
        audio.play(id, pos ? { pos: planToWorld(pos), room } : {});
      },
      lightning: () => lightning?.strike(),
      storm: (interval, rumble) => {
        stormNow = { interval, rumble };
        if (stormAutoOn) lightning?.setStorm(interval, rumble);
      },
      hint: (target) => {
        lightning?.strike();
        const obj = target.startsWith('board_') ? level.doors.doors.get('D_ADA')?.boards.find((b: any) => `board_${b.userData?.board}` === target) : (level.prop(target) ?? level.doors.doors.get(target)?.group);
        if (!obj) return;
        const box = new THREE.Box3().setFromObject(obj);
        const helper = new THREE.Box3Helper(box, 0xd8cfb8);
        scene.add(helper);
        hintMarkers.push({ helper, t: 1.4 });
      },
      toast: (t) => d.toast(t),
      prompt: (t) => ui.prompt(t),
      document: (doc) => {
        journal.add({ id: doc.id === 'guest_book_sting' ? 'guest_book' : doc.id, title: doc.title, text: doc.text, lines: doc.lines });
        ui.read(doc);
        interact.enabled = false;
      },
      removeItem: (id) => inventory.remove(id),
      setPropVisible: (id, v) => {
        const o = level.prop(id);
        if (o) o.visible = v;
      },
      teleport: (_id, pos, yaw, pitch) => {
        if (hides.active) hides.exit();
        player.teleport(planToWorld(pos), headingToCameraYaw(yaw), pitch);
        rig.snap();
        const pf = player.planFeet();
        level.setViewer(pf[0], pf[1], pf[2]);
      },
      raiseLocket: () => {
        locketForced = true;
        rig.setOn(true);
      },
      end: () => ui.end(),
      ada: (out) => {
        lastOut = out;
        ada?.apply(out);
        adaAudio(out);
        const pf = player.planFeet();
        const dist = out.visible ? Math.hypot(out.pos[0] - pf[0], out.pos[1] - pf[1], (out.pos[2] - pf[2]) * 2) : 99;
        rig.tremble = Math.max(0, Math.min(1, 1 - dist / 6));
      },
    },
  });
  let nonstopBell: any = null;

  // ---------------------------------------------------------------- cutscenes (src/cutscenes, docs/CUTSCENES.md)
  let cs: any = null;
  try {
    const [{ createCutsceneSystem }, { setGuestBookState }] = await Promise.all([import('../cutscenes/bindings.ts'), import('../world/decals.ts')]);
    cs = createCutsceneSystem({
      ctx,
      camera,
      level,
      player,
      rig,
      audio,
      characters,
      pipeline: () => pipelineRef,
      sayTrigger: (t: string) => {
        if (!voice || !voiceIdx) return;
        for (const id of voiceMod.linesForTrigger(voiceIdx, t)) void voice.play(id);
      },
      canvas: ctx.renderer.domElement,
      hooks: {
        lightning: () => lightning?.strike(),
        stormAuto: (on: boolean) => {
          stormAutoOn = on;
          lightning?.setStorm(on ? stormNow.interval : 0, stormNow.rumble);
        },
        runtimeLight: (id: string) => level.runtimeLight(id),
        fx: (id: string, p: Record<string, number | string | boolean>) => cutsceneFx(id, p),
        dressing: (set: string, on: boolean) => {
          if (set === 'sting') {
            setGuestBookState(level.root, on ? 'sting' : 'tonight_blank');
            fxw.setSting(on);
          }
        },
      },
    });
    cutscenePlayer = cs.player.playCutscene;
  } catch (e) {
    console.warn('[story] cutscenes unavailable (director fallbacks):', e);
  }

  // ---------------------------------------------------------------- bus reactions (controls, fades, arms, harlan)
  // who owns the body (enable flags, interact / hide / breath gating) and the black fade: src/game/body-control.ts
  // (pure, so tests/e2e-playthrough.test.ts drives the same rules). Registered here, after the Director's own
  // cutscene:end listener, as before the extraction; the visual reactions below run right after it.
  const body = createBodyControl({
    events: ctx.events,
    player,
    interact,
    hides,
    hasCutscenePlayer: () => !!cutscenePlayer,
    fade: (to, sec) => ui.fade(to, sec),
    snapBlackAfter: (sec) => ui.snapBlackAfter(sec),
  });
  ctx.events.on('cutscene:start', ({ id }) => {
    if (id === 'C6') {
      // you drive YOUR car away: the vehicle track moves the gate sedan to the row — the row copy steps aside
      level.prop('P_CAR_ROW') && (level.prop('P_CAR_ROW').visible = false);
      if (arms?.has('arms_pour_can')) armsProp('P_JERRY_10');
      else m2.canAtFiller(true);
    }
    if (id === 'C2' && !cutscenePlayer) {
      arms?.play('arms_freeze');
      // fallback staging: she slides off the table, he releases the rope
      if (tableau && ada) ada.override({ clip: 'ada_rise', pos: tableau.ada.pos, yaw: tableau.ada.yaw, loop: false });
      if (tableau && harlan) harlan.play({ clip: 'harlan_opening', pos: tableau.harlan.pos, yaw: tableau.harlan.yaw, time: 12.2 });
    }
  });
  ctx.events.on('cutscene:end', ({ id }) => {
    if (id === 'C5') {
      fxw.resetSilhouette();
      characters.attach('ada', 'locket', null);
    }
    if (id === 'C6') {
      m2.canAtFiller(false);
      armsProp(null);
    }
    if ((id === 'C2' || id === 'C2_replay') && !characters.acquired.has('ada')) {
      tableauOn = false;
      ada?.release();
    }
  });
  ctx.events.on('player:death', () => {
    audio?.play('grab_hit', { gain: 0.9 });
  });
  let restoring = false;
  ctx.events.on('flag', ({ name, value }) => {
    if (name === 'bell_nonstop' && !value) {
      nonstopBell?.stop(1);
      nonstopBell = null;
    }
    if (name === 'bell_nonstop' && value && !nonstopBell && audio) {
      // a debug start / restore at B10–B11 has the flag but never heard the story's sfx: ring it here
      const bell = level.prop('P_SPRING_BELL');
      const bp = bell ? bell.getWorldPosition(new THREE.Vector3()) : null;
      nonstopBell = audio.play('spring_bell_loop', bp ? { pos: [bp.x, bp.y, bp.z], room: 'G2', loop: true } : { loop: true });
    }
    if (name === 'rang_front_bell' && value) whetstone?.stop(0.6);
    if (name === 'harlan_taken' && value) {
      fxw.fx('blue_hour', { mist: 1, rain: 0 }); // B12: the storm is over
      if (harlan) harlan.visible = false; // C5 took him (also a debug / restore start at B12+)
    }
    if (name === 'locket_given' && value && !restoring) {
      // FINALE take: her left fist closes on it (ada_finale_take: prop_l reaches the lens at 0.45 s of the clip ×1.25)
      setTimeout(() => characters.attach('ada', 'locket', 'prop_l'), 360);
    }
    m2.syncFlag(name, value);
  });
  const inKitchenSide = () => level.room === 'G3P' || level.room === 'G3';
  ctx.events.on('interact', ({ id, action }) => {
    m2.onInteract(id, action);
    if (!arms) return;
    if (action === 'knock') arms.play('arms_knock');
    else if (action === 'ring_bell' || action === 'pull_bell') arms.play('arms_bell_pull');
    else if (id === 'D_PASSAGE' && action.startsWith('rattle_') && inKitchenSide()) arms.play(arms.has('arms_slide_bolt') ? 'arms_slide_bolt' : 'arms_door_rattle');
    else if (action === 'rattle_front_door' || action.startsWith('rattle_')) arms.play('arms_door_rattle');
    else if (action.startsWith('take_') || action.startsWith('read_') || action.startsWith('examine_')) arms.play('arms_pickup_read');
  });
  // hold interactions: the hands work while E is held (pry with the hammer, cut with the shears)
  interact.onHold = (it, phase) => {
    const act = it.action ?? '';
    if (phase === 'start') {
      if (act === 'pry') {
        armsProp('P_HAMMER');
        arms?.play('arms_pry_board', 0.12);
        const b = new THREE.Box3().setFromObject(it.object).getCenter(new THREE.Vector3());
        audio?.play('pry_bite', { pos: [b.x, b.y, b.z], room: 'U1', gain: 0.8 });
      } else if (act === 'cut_hem') {
        armsProp('P_SHEARS');
        arms?.loop('arms_cut_hem', 0.12);
        const b = new THREE.Box3().setFromObject(it.object).getCenter(new THREE.Vector3());
        audio?.play('shears', { pos: [b.x, b.y - 0.5, b.z], room: 'U3', gain: 0.8 });
      }
      return;
    }
    // done / cancel: hands back to the torch
    armsProp(null);
    if (act === 'cut_hem') arms?.loop('arms_idle', 0.25);
    else if (phase === 'cancel') arms?.cancelOneShot();
  };
  ctx.events.on('player:hide', ({ inside }) => {
    // the hide camera sits at the slats: the hands would fill the view (and clip the doors) — lower them
    if (arms) arms.visible = !inside;
    if (!inside) arms?.play('arms_hide_push');
  });
  ctx.events.on('player:breath', ({ holding }) => arms?.loop(holding ? 'arms_breath_hold' : 'arms_idle', 0.3));

  // Harlan sharpens the cleaver in the parlor until the bell (B02: the rasp stops when you ring).
  let whetstone: any = null;

  // ---------------------------------------------------------------- start (after lightning is attached)
  let started = false;
  const startBeat = (d.params.get('beat') ?? '').toUpperCase();
  const start = () => {
    started = true;
    fxw.setWarm(false); // the fx meshes were visible only for the load-time shader compile
    restoring = true;
    m2.restore(() => startDirector());
    m2.syncAll();
    restoring = false;
    // B02–B03: the parlor door "stands ajar and candlelit" (doors.glb ships it at 70°). C2 shuts it.
    const parlor = level.doors.doors.get('D_PARLOR');
    if (parlor && !parlor.lock && Math.abs(parlor.angle) < 30 && beatIdx(director.story.beat) <= 2) {
      parlor.target = 70;
      parlor.angle = 69.9;
      parlor.speed = 1000;
    } else if (parlor && parlor.lock && Math.abs(parlor.angle) > 0) {
      // debug starts after C2: the parlor is shut and locked, as C2 leaves it
      parlor.angle = 0.1;
      parlor.target = 0;
    }
    if (audio && beatIdx(director.story.beat) <= 1 && tableau) {
      const p = tableau.harlan.pos;
      whetstone = audio.play('whetstone', { pos: [p[0], p[1] + 1.1, p[2]], room: 'G2', loop: true, gain: 0.9 });
    }
  };
  const startDirector = () => {
    if (BEATS.includes(startBeat as BeatId) && startBeat !== 'B01') {
      const b = startBeat === 'B05' ? 'B04' : (startBeat as BeatId);
      director.startAt(b);
      if (startBeat === 'B05') {
        // straight into the first hide: the story moves to B05 and she comes to the slats (hide_demo)
        const h = layout.hides.find((x) => x.id === 'H_ARMOIRE') ?? layout.hides[0];
        if (h) {
          player.teleport(planToWorld([h.entry[0], h.entry[1], h.entry[2] + 1.65]), headingToCameraYaw(h.eyeYaw + Math.PI), 0);
          rig.snap();
          hides.enter(h.id);
        }
      }
    } else director.start();
  };

  // ---------------------------------------------------------------- per frame
  const update = (dt: number, paused: boolean) => {
    if (!started) return;
    ui.update(dt);
    // the page blocks gameplay input (input.addBlocker below): it closes on E / Esc / click or a movement key, and
    // that press is consumed (a key pressed under the page stays swallowed until it is released)
    if (ui.reading && (input.uiPressed('KeyE') || input.uiPressed('Escape') || input.uiPressed('Mouse0') || MOVE_KEYS.some((k) => input.uiPressed(k)))) {
      ui.closeReading();
      // the E that closed the page must not read it again this frame (the ledger would turn a page and re-voice)
      input.consume('KeyE');
      input.consume('Mouse0');
      interact.enabled = true;
    }
    if (!paused && dt > 0) director.update(dt);
    if (cs) {
      cs.update(paused ? 0 : dt, {
        skipHeld: input.isDown('Space') || input.isDown('Enter'),
        interactHeld: input.isDown('KeyE'),
        interactPressed: input.wasPressed('KeyE'),
        breathHeld: player.holdingBreath,
      });
      cs.hem.update(lastOut, hides.active?.id ?? null);
      camHeldByCutscene = !!cs.cameraHeld;
    }
    // interact / hide / breath gating on the cutscene lock (Space is skip AND breath): src/game/body-control.ts
    body.frame(cs ? cs.lock : null, ui.reading);
    m2.update(paused ? 0 : dt);
    fxw.update(paused ? 0 : dt);
    const beat = director.story.beat;
    // pre-C2 tableau (the cutscene lane replaces this with C2 proper)
    if (tableau && !body.cutscene && beatIdx(beat) <= 2 && !characters.acquired.has('ada')) {
      if (ada && !ada.overridden) {
        ada.override({ clip: 'ada_table', pos: tableau.ada.pos, yaw: tableau.ada.yaw, loop: true });
        tableauOn = true;
      }
      if (harlan && !harlan.visible) harlan.play({ clip: 'harlan_opening', pos: tableau.harlan.pos, yaw: tableau.harlan.yaw, time: 0.5, timeScale: 0 });
    } else if (tableau && harlan && !harlan.visible && harlanHeldAtTable(beatIdx(beat), body.cutscene, !!ctx.flags.get('harlan_taken'))) {
      // after C2 he stays in the locked parlor (never re-shown under a cutscene's own hide cues, nor once C5 took him)
      harlan.play({ clip: 'harlan_opening', pos: tableau.harlan.pos, yaw: tableau.harlan.yaw, time: 14.9, timeScale: 0 });
    }
    const cdt = paused ? 0 : dt;
    ada?.update(cdt);
    if (ada && tableauOn && ada.overridden) ada.group.visible = !level.cullingEnabled || level.visible.has('G2');
    harlan?.update(cdt);
    characters.update();
    setArmsCar(!!fxw.mounted?.());
    // runtime review: in the driver's POV the gloves ride the car (stay on the wheel while the head turns) — FpArms.anchorTo
    const da = fxw.driverAnchor?.() ?? null;
    arms?.anchorTo(da ? da.obj : null, da ? da.eye : undefined);
    if (arms) arms.update(cdt, rig.flashlight.light, rig.flashlight.beam, rig.on, rig.on ? rig.flashlight.light.intensity / rig.flashlight.intensity : 0);
    for (let i = hintMarkers.length - 1; i >= 0; i--) {
      const h = hintMarkers[i];
      h.t -= dt;
      if (h.t <= 0) {
        scene.remove(h.helper);
        h.helper.dispose?.();
        hintMarkers.splice(i, 1);
      }
    }
  };

  const attachLightning = (l: LightningControl) => {
    lightning = l;
    if (!started) start();
  };

  return {
    director,
    characters,
    /** Plug the cutscene lane's CutscenePlayer.playCutscene (null → the director's fallback timeouts). */
    setCutscenePlayer: (fn: typeof cutscenePlayer) => {
      cutscenePlayer = fn;
    },
    /** The cutscene system (null if src/cutscenes failed to load). */
    cutscenes: cs,
    setPipeline: (p: any) => {
      pipelineRef = p;
    },
    /** C6 blue hour: 0 storm night … 1 pale dawn (main.ts tints sky + fog). */
    skyTint: () => fxw.blueHour(),
    /** Blue-hour mist (0 … 1.5): main.ts thickens the exterior fog. */
    mist: () => fxw.mist(),
    /** Rain on the weather bed: the storm is over after C5 (B12) until the sting brings it back. */
    rain: () => (fxw.blueHour() > 0.5 ? 0 : 1),
    /** After the level's light update (overrides that must win over the flicker loop). */
    lateUpdate: () => fxw.lateUpdate(),
    fx: {
      ...fxw,
      // runtime lane D: the road warm-up mounts the interior — compile the arms with the CAR list there too
      warmRoad: (on: boolean, at?: number) => {
        setArmsCar(on);
        return fxw.warmRoad(on, at);
      },
    },
    m2,
    /** Load warm-up (C2/C5 candle shadow on the characters): show Ada + Harlan at the tableau, or hide them again. */
    warmTableau: (on: boolean) => {
      if (!tableau) return;
      if (on) {
        ada?.override({ clip: 'ada_table', pos: tableau.ada.pos, yaw: tableau.ada.yaw, loop: true });
        if (ada) ada.forceVisible = true;
        harlan?.play({ clip: 'harlan_opening', pos: tableau.harlan.pos, yaw: tableau.harlan.yaw, time: 0.5, timeScale: 0 });
        ada?.update(0);
        harlan?.update(0);
        // the props her hands will carry compile with her (C5 cleaver + locket, C7 sack)
        characters.attach('ada', 'cleaver', 'prop_r');
        characters.attach('ada', 'locket', 'prop_l');
        characters.attach('ada', 'sting_sack', 'prop_r');
        characters.update();
      } else {
        for (const pr of ['cleaver', 'locket', 'sting_sack']) characters.attach('ada', pr, null);
        if (ada) ada.forceVisible = null;
        ada?.release();
        if (harlan) harlan.visible = false;
      }
    },
    playerView,
    ada,
    harlan,
    arms,
    voice,
    tableau,
    update,
    attachLightning,
    /**
     * A cutscene owns the body (any lock, or any Director cutscene incl. the death cutaway): gameplay verbs outside
     * the controller (F torch, Tab journal) must not act — they would fight the cutscene's light / arms cues.
     */
    inputLocked: (): boolean => body.inputLocked(cs ? cs.lock : null),
    /** Debug: current beat, Ada's state. */
    whereText: () => {
      const o = lastOut;
      const cutscene = body.cutscene;
      return `${director.story.beat}${cutscene ? ` · ${cutscene}` : ''} · Ada ${o ? `${o.state}/${o.anim}${o.visible ? '' : ' (off)'} @${o.room}` : '-'}`;
    },
  };
}

// ================================================================================================ staging

export interface Tableau {
  ada: { pos: [number, number, number]; yaw: number };
  harlan: { pos: [number, number, number]; yaw: number };
}

/**
 * C2 staging from the real props: Ada's root sits 0.33 m back from the sawbuck's centre line (the table spans
 * 0.03…0.63 m in front of her, long axis along her local X), facing across it; Harlan 1.08 m in front of her, yawed
 * 180°. Of the two mirror placements, the one with the parlor threshold on her LEFT (+X) is used (docs/CHARACTERS.md).
 */
export function computeTableau(level: Level): Tableau | null {
  const table = level.prop('P_SAWBUCK');
  if (!table) return null;
  table.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(table);
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const trig = level.layout.triggers.find((t) => t.id === 'T_B03_THRESHOLD');
  const door = trig ? new THREE.Vector3(...planToWorld([(trig.rect[0] + trig.rect[2]) / 2, (trig.rect[1] + trig.rect[3]) / 2, 0.6])) : new THREE.Vector3(c.x - 3, c.y, c.z);
  const cands = size.x >= size.z ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
  let yaw = cands[0];
  let best = -Infinity;
  for (const y of cands) {
    const lx = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y)); // her local +X in world
    const s = lx.dot(new THREE.Vector3().subVectors(door, c));
    if (s > best) {
      best = s;
      yaw = y;
    }
  }
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const floorY = box.min.y;
  const adaPos = new THREE.Vector3(c.x, floorY, c.z).addScaledVector(fwd, -0.33);
  const harlanPos = adaPos.clone().addScaledVector(fwd, 1.08).addScaledVector(side, 0.02);
  return {
    ada: { pos: [adaPos.x, adaPos.y, adaPos.z], yaw },
    harlan: { pos: [harlanPos.x, harlanPos.y, harlanPos.z], yaw: yaw + Math.PI },
  };
}

// ================================================================================================ UI

function makeUi() {
  const fadeEl = document.createElement('div');
  Object.assign(fadeEl.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', zIndex: '30' } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(fadeEl);
  const promptEl = document.createElement('div');
  Object.assign(promptEl.style, {
    position: 'fixed',
    left: '50%',
    top: '18%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(560px, calc(100% - 32px))',
    color: '#e6dfcf',
    font: '15px/1.45 system-ui, sans-serif',
    letterSpacing: '0.03em',
    textAlign: 'center',
    textShadow: '0 1px 4px #000',
    opacity: '0',
    transition: 'opacity .4s',
    pointerEvents: 'none',
    zIndex: '22',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(promptEl);
  const readEl = document.createElement('div');
  Object.assign(readEl.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'none',
    zIndex: '26',
    pointerEvents: 'none',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);
  const readCanvas = document.createElement('canvas');
  Object.assign(readCanvas.style, { width: 'min(460px, calc(100vw - 32px))', height: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,.7)' } as Partial<CSSStyleDeclaration>);
  const readHint = document.createElement('div');
  readHint.textContent = 'E  close';
  Object.assign(readHint.style, { marginTop: '10px', color: 'rgba(230,223,207,.6)', font: '12px system-ui, sans-serif', letterSpacing: '.12em' } as Partial<CSSStyleDeclaration>);
  readEl.append(readCanvas, readHint);
  document.body.appendChild(readEl);

  // the fade maths is pure (src/game/body-control.ts FadeState); this element just shows fade.opacity
  const fade = new FadeState();
  let promptT = 0;
  const api = {
    get black() {
      return fade.black;
    },
    reading: false,
    fade(to: number, sec: number) {
      fade.fade(to, sec);
    },
    /** After the death cutaway's own fade: hold black (our overlay) until the respawn fade-in. */
    snapBlackAfter(sec: number) {
      fade.snapBlackAfter(sec); // counted down in update() on game time (a paused game doesn't go black behind the menu)
    },
    prompt(text: string) {
      promptEl.textContent = text;
      promptEl.style.opacity = '1';
      promptT = 6;
    },
    read(doc: StoryDocument) {
      const W = 720;
      const H = 960;
      readCanvas.width = W;
      readCanvas.height = H;
      drawDocumentPage(readCanvas.getContext('2d')!, W, H, doc);
      readEl.style.display = 'block';
      api.reading = true;
    },
    closeReading() {
      readEl.style.display = 'none';
      api.reading = false;
    },
    /** The end: C7 already cut to black on its own title — hold black and keep the title up (no fade, no flicker).
     * The card sits under the pause menu (z 40) so 'Esc  menu' opens a menu the player can actually click. */
    end() {
      fade.hold();
      fadeEl.style.opacity = '1';
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: String(END_CARD_Z), pointerEvents: 'none', color: '#d9d2c3', font: '400 clamp(28px,5vw,64px)/1.1 ui-serif, Georgia, "Times New Roman", serif', letterSpacing: '.32em', textAlign: 'center', padding: '0 16px', background: '#000' } as Partial<CSSStyleDeclaration>);
      const t = document.createElement('div');
      t.textContent = 'THE KEEPING';
      const by = document.createElement('div');
      by.textContent = 'a game by Raj Vardhan Singh';
      Object.assign(by.style, { marginTop: '22px', font: 'italic 400 clamp(13px,1.4vw,18px)/1.4 ui-serif, Georgia, "Times New Roman", serif', letterSpacing: '.18em', color: 'rgba(217,210,195,.8)', opacity: '0', transition: 'opacity 2s 1.5s' } as Partial<CSSStyleDeclaration>);
      const sub = document.createElement('div');
      sub.textContent = 'Esc  menu';
      Object.assign(sub.style, { marginTop: '28px', font: '12px system-ui, sans-serif', letterSpacing: '.2em', color: 'rgba(217,210,195,.45)', opacity: '0', transition: 'opacity 2s 3s' } as Partial<CSSStyleDeclaration>);
      el.append(t, by, sub);
      document.body.appendChild(el);
      requestAnimationFrame(() => {
        by.style.opacity = '1';
        sub.style.opacity = '1';
      });
    },
    update(dt: number) {
      if (fade.update(dt)) fadeEl.style.opacity = String(fade.opacity);
      if (promptT > 0) {
        promptT -= dt;
        if (promptT <= 0) promptEl.style.opacity = '0';
      }
    },
  };
  return api;
}
