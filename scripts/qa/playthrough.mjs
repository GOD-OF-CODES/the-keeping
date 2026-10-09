// QA playthrough bot for THE KEEPING — plays the WHOLE game (B01 → C7 → title card) on the real renderer.
//
//   node scripts/shot.mjs --scenario scripts/qa/playthrough.mjs --preset medium --wait 2 --width 960 --height 600 \
//        --out scratch/qa --name play --timeout 2400
//
// (--timeout: a full run is ~15–20 min of game time stepped at 1/30 s with a real render every frame; shot.mjs's
//  default 240 s deadline is far too short for it.)
//
// How it plays: the rAF loop is stopped and the game is stepped with window.__game.advance(1, 1/30, heldKeys), so
// cutscenes, the Director, Ada's brain and the triggers all run on simulated time. A goal-driven scripted player
// (a port of tests/story-sim.ts decide()/act()) walks the same waypoint graph by teleport-stepping the player at
// walking speed (1.6 m/s, 3.6 m/s when fleeing), opens unlocked doors on its route, uses the game's own interactables
// (window.__game.interact.items[id].use()), hides with the real HideSystem, holds Space for breath, holds E for the
// C6 pour gate / taps E for the key gate, raises the lit locket (Mouse2 held + torch on) in B11, and closes reading
// pages with E. Ada's per-frame output is captured by wrapping director.update (page side only; src is untouched).
//
// Asserts: beats arrive in order B01 … B13, every Director cutscene C1/C2/C3/C5/C6/C7 plays, and the run ends on the
// title card. Records per-beat game + wall time, deaths, gates, hints and 8 hero screenshots.
//
// Gate modes (ROADMAP round E ruling a): STRICT is the default — any bot UNSTICK teleport fails the run (QA_STRICT=0 opts
// out). QA_CARELESS=1: torch always on, never sneaks, runs away when chased, and in B05/B06/B09/B10 sweeps the lit beam
// onto her body from 6–9.5 m (a short same-floor detour, ≤ 3 s of aiming per beat; asserted for B05 + one more
// upstairs beat; caught at most once). QA_TORCH_ON=1: the stealth
// route with the torch never switched off (informative).

const PW = {
  gate: [1.8, -27.4, 0], drive: [1.8, -12, 0], drive_e: [8, -6, 0], car: [13.4, -1.6, 0], porch: [1.8, -1.5, 0],
  // gameplay-d review: off the porch only by its steps (x 1.8 ± 0.8) — the old porch→drive_e line crossed the rail (B12 unstick)
  porch_step: [1.8, -3.6, 0],
  hall_s: [1.8, 0.6, 0.6], threshold: [3.1, 1.5, 0.6], stair_foot: [0.6, 3.3, 0.6], hall_mid: [2.3, 5.0, 0.6],
  hall_n: [2.4, 8.2, 0.6], hall_pdoor: [2.5, 8.75, 0.6], stair_top: [0.55, 8.1, 4.1], u_landing: [1.6, 8.4, 4.1],
  u_ada: [2.9, 8.0, 4.1], u_runner_n: [2.4, 6.3, 4.1], u_armoire: [2.55, 4.2, 4.1], u_hdoor: [3.15, 3.0, 4.1],
  u_runner_s: [2.4, 1.9, 4.1], u_ddoor: [3.15, 0.8, 4.1], u2_hdoor: [4.4, 3.0, 4.1], u2_ddoor: [4.4, 0.8, 4.1],
  u2_mid: [5.6, 2.6, 4.1], u2_ledger: [6.3, 3.8, 4.1], u2_bell: [6.1, 4.0, 4.1], u2_hammer: [8.2, 1.3, 4.1],
  u2_coats: [4.75, 1.9, 4.1], u2_west: [5.2, 3.6, 4.1], u3_door: [4.3, 8.2, 4.1], u3_mid: [6.0, 6.2, 4.1], u3_letter: [7.0, 8.0, 4.1],
  u3_dress: [7.4, 6.7, 4.1] /* round E: in front of the form, SW of the rebuilt (wider, exact-collider) skirt — 7.7,7.0 is against the cloth */, u3_wardrobe: [5.0, 8.1, 4.1], u4t_top: [5.0, 9.8, 4.1], u4t_turn: [5.0, 11.2, 4.1],
  u4_foot: [8.35, 11.35, 1.1], k_door: [8.45, 9.95, 0.6], k_mid: [7.6, 9.75, 0.6], k_center: [6.3, 9.0, 0.6], k_cans: [4.4, 8.5, 0.6],
  k_west: [4.35, 9.95, 0.6], p_east: [3.2, 9.95, 0.6], p_door: [2.5, 9.55, 0.6],
};
const PE = [
  ['gate', 'drive'], ['drive', 'porch'], ['drive', 'drive_e'], ['drive_e', 'car'], ['porch', 'porch_step'], ['porch_step', 'drive_e'],
  ['porch', 'hall_s', 'D_FRONT'], ['hall_s', 'threshold'], ['hall_s', 'stair_foot'], ['threshold', 'hall_mid'],
  ['stair_foot', 'hall_mid'], ['hall_mid', 'hall_n'], ['hall_n', 'hall_pdoor'], ['hall_pdoor', 'p_door', 'D_PASSAGE'],
  ['p_door', 'p_east'], ['p_east', 'k_west'], ['k_west', 'k_cans'], ['k_west', 'k_center'], ['k_cans', 'k_center'],
  // round E (ruling d): with P_KITCHEN_CHAIR_2 out of the doorway lane the back-stair doorway opens straight into the
  // kitchen (scripts/qa/backstair-lane.mjs: ≥ 0.98 m lane, door open) — no close-behind, no northern detour
  ['k_center', 'k_mid'], ['k_mid', 'k_door'], ['k_door', 'u4_foot', 'D_BACKSTAIR'], ['u4_foot', 'u4t_turn'], ['u4t_turn', 'u4t_top'],
  ['u4t_top', 'u3_wardrobe', 'D_WARDROBE_BACK'], ['stair_foot', 'stair_top'], ['stair_top', 'u_landing'],
  ['u_landing', 'u_ada'], ['u_landing', 'u_runner_n'], ['u_ada', 'u_runner_n'], ['u_runner_n', 'u_armoire'],
  ['u_armoire', 'u_hdoor'], ['u_armoire', 'u_runner_s'], ['u_runner_s', 'u_ddoor'], ['u_hdoor', 'u2_hdoor', 'D_HARLAN'],
  ['u_ddoor', 'u2_ddoor', 'D_DRESSING'], ['u2_hdoor', 'u2_mid'], ['u2_ddoor', 'u2_mid'], ['u2_hdoor', 'u2_coats'],
  ['u2_ddoor', 'u2_coats'], ['u2_mid', 'u2_west'], ['u2_west', 'u2_ledger'], ['u2_ledger', 'u2_bell'], ['u2_mid', 'u2_hammer'],
  ['u_ada', 'u3_door', 'D_ADA'], ['u3_door', 'u3_wardrobe'], ['u3_door', 'u3_mid'], ['u3_wardrobe', 'u3_mid'],
  ['u3_mid', 'u3_letter'], ['u3_letter', 'u3_dress'], ['u3_mid', 'u3_dress'],
];

// ------------------------------------------------------------------------------------------------ page side
// Serialized into the page with Function.prototype.toString — must be self-contained.
function installBot(cfg) {
  const g = window.__game;
  const DT = cfg.dt;
  const { PW, PE } = cfg;
  const HIDES = Object.fromEntries(g.level.layout.hides.map((h) => [h.id, h]));
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const BEATS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13'];

  // Ada's output, captured per Director update
  let adaOut = null;
  const dir = g.director;
  const origUpdate = dir.update.bind(dir);
  dir.update = (dt) => {
    const o = origUpdate(dt);
    if (o) adaOut = o;
    return o;
  };

  // Ada's stimuli (page-side wrappers, src untouched): every investigate stimulus with its cause (heard noise or the
  // torch beam landing near her) and every lure start — the evidence for "she never answers the bell" stalls.
  const stims = [];
  {
    const br = g.brain;
    let via = null;
    const oHeard = br.onHeard?.bind(br);
    const oStim = br.stimulus?.bind(br);
    const oLure = br.startLure?.bind(br);
    const f1 = (v) => v.toFixed(1);
    if (oHeard && oStim && oLure) {
      br.onHeard = (n, p, m) => {
        via = `noise:${n.source} r${n.radius} @${n.pos.map(f1)} ${n.room}`;
        try {
          return oHeard(n, p, m);
        } finally {
          via = null;
        }
      };
      br.stimulus = (p, room, listen) => {
        stims.push(`${(window.__bot?.t ?? 0).toFixed(1)} ${beat()} stim @${p.map(f1)} ${room} via ${via ?? 'beam'} | ada ${br.nav?.pos?.map(f1)} ${br.nav?.room}`);
        if (stims.length > 200) stims.shift();
        return oStim(p, room, listen);
      };
      br.startLure = () => {
        stims.push(`${(window.__bot?.t ?? 0).toFixed(1)} ${beat()} LURE start | ada ${br.nav?.pos?.map(f1)} ${br.nav?.room}`);
        return oLure();
      };
    }
  }

  // console.info lines the game prints (triggers, hints) are useful evidence
  const log = [];
  const L = (m) => {
    log.push(`[${bot.t.toFixed(1)}s ${beat()}] ${m}`);
    if (log.length > 400) log.shift();
  };

  const st = () => g.storyState();
  const beat = () => g.director.story.beat;
  const flags = () => ({ ...st().flags, ...g.flags() });
  const doorLock = (id) => g.doors.doors.get(id)?.lock ?? null;
  const pos = () => g.pos();
  const cs = g.cutscenes;
  const csActive = () => (cs?.player?.active ?? null) || (cs?.hem?.current ?? null);
  const hidden = () => g.hides.active?.id ?? null;
  const reading = () => {
    for (const el of document.body.children) {
      if (el.tagName === 'DIV' && el.style.display === 'block' && el.querySelector('canvas') && el.textContent.includes('close')) return true;
    }
    return false;
  };
  // story-runtime end(): a body-level DIV whose text is 'THE KEEPING' + (since the credits commit) the byline + 'Esc  menu'.
  const endCard = () => [...document.body.children].some((el) => el.tagName === 'DIV' && /^THE KEEPING/.test(el.textContent ?? '') && /Esc\s+menu$/.test(el.textContent ?? ''));

  // waypoint graph
  const adj = new Map();
  for (const [a, b, door] of PE) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, door });
    adj.get(b).push({ to: a, door });
  }
  const nearestWp = (p = pos()) => {
    let best = null;
    let bd = Infinity;
    for (const [k, w] of Object.entries(PW)) {
      const d = d2(p, w) + Math.abs(p[2] - w[2]) * 3;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  };
  const route = (from, to) => {
    // Dijkstra over the waypoint graph; a locked door is impassable
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const open = new Set([from]);
    while (open.size) {
      let u = null;
      for (const n of open) if (u === null || dist.get(n) < dist.get(u)) u = n;
      open.delete(u);
      if (u === to) break;
      for (const e of adj.get(u) ?? []) {
        if (e.door && doorLock(e.door)) continue;
        const nd = dist.get(u) + d3(PW[u], PW[e.to]);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, u);
          open.add(e.to);
        }
      }
    }
    if (!dist.has(to)) return null;
    const path = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0]));
    return path;
  };
  const doorOf = (a, b) => PE.find((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))?.[2];

  // ---- bot state
  const bot = {
    t: 0,
    wallT0: performance.now(),
    path: [],
    pathTo: null,
    heldKeys: new Set(),
    // C2-ESCAPE QA: input held during C2/C2c (must be none), the handover at control, her first appearance in B05
    escape: { csInput: [], handover: null, b05T0: null, firstSeen: null },
    beats: [],
    checkpoints: [],
    cutscenes: [],
    gates: [],
    deaths: [],
    waitUntil: new Map(),
    lastPull: -1e9,
    holding: false,
    breathHeld: 0,
    beamOn: false,
    locket: false,
    task: '',
    stuckSince: 0,
    lastBeat: null,
    lastCs: null,
    lastGate: null,
    keyTapped: false,
    strikes: 0,
    log,
    shotsTaken: new Set(),
    unsticks: [],
    states: {},
    errors: [],
    patchedLmClone: false,
    trace: [],
    lastP: null,
    lastMoveT: 0,
    want: null,
    ended: false,
    // round E (ruling a): careless glances — per beat, frames her body was in the lit beam at ≥ 6 m (+ nearest such range)
    beamHits: {},
    glance: null,
    glanceT0: {},
    aimAdaUntil: -1,
    aimT: {},
    flee: null,
  };
  window.__bot = bot;
  // her own verdict that the beam is on her body: a beam LOOK started while the holder is ≥ 6 m away
  {
    const br = g.brain;
    const o = br.startLook?.bind(br);
    if (o)
      br.startLook = (reason, ...rest) => {
        if (reason === 'beam') {
          const a = br.nav.pos;
          const p = pos();
          const dd = Math.hypot(a[0] - p[0], a[1] - p[1]);
          const b = st().beat;
          const h = (bot.beamHits[b] ??= { frames: 0, minD: 99 });
          h.beamLooks = (h.beamLooks ?? 0) + (dd >= 6 ? 1 : 0);
          h.beamLookD = Math.max(h.beamLookD ?? 0, +dd.toFixed(2));
        }
        return o(reason, ...rest);
      };
  }

  const interact = (id, action) => {
    const it = g.interact.items.find((i) => i.id === id);
    if (it) {
      L(`use ${id}${action ? ':' + action : ''}`);
      it.use(false);
    } else {
      L(`no interactable ${id} — emitting interact ${action}`);
      g.ctx.events.emit('interact', { id, action });
    }
  };
  const press = (code) => {
    g.input.pressed?.add(code);
  };

  // Walk along the waypoint graph toward `to` with the REAL controller (look + held W / Shift / C, so collision, step-up,
  // footstep noise and stamina are the game's own). Returns true on arrival. If the player makes no progress for 1.5 s
  // the bot teleports onto the next waypoint and records an "unstick" (each one is a possible collision bug).
  const moveTo = (to, speed) => {
    const p = pos();
    if (bot.pathTo !== to || !bot.path.length) {
      const from = nearestWp(p);
      const r = route(from, to);
      if (!r) {
        L(`no route ${from} → ${to}`);
        bot.path = [];
        bot.pathTo = null;
        return false;
      }
      bot.path = r;
      bot.pathTo = to;
      // skip the first node when we are already past it toward the second
      if (r.length > 1 && d2(p, PW[r[1]]) < d2(PW[r[0]], PW[r[1]])) bot.path.shift();
      bot.lastP = null;
    }
    const near = (w, last) => d2(p, w) < (last ? 0.22 : 0.35) && Math.abs(p[2] - w[2]) < 0.75;
    while (bot.path.length && near(PW[bot.path[0]], bot.path.length === 1)) {
      const prevName = bot.path.shift();
      bot.lastP = null;
      // gameplay review: off the back stair into the kitchen, close D_BACKSTAIR behind you — its open leaf (west jamb)
      // walls the doorway pocket off from the kitchen (table + tipped chair south, pump sink south-east)
      if (cfg.closeBackstair && prevName === 'k_door' && bot.lastDoor === 'D_BACKSTAIR' && bot.path[0] === 'k_mid') {
        L('close D_BACKSTAIR behind');
        g.closeDoor('D_BACKSTAIR');
        bot.lastMoveT = bot.t + 1.5; // the leaf takes ~1.2 s to swing shut across the westward line
      }
      bot.lastDoor = null;
      if (bot.path.length) {
        const door = doorOf(prevName, bot.path[0]);
        if (door) bot.lastDoor = door;
        if (door && !doorLock(door)) {
          const dd = g.doors.doors.get(door);
          if (dd && Math.abs(dd.angle) < 30 && Math.abs(dd.target) < 30) {
            L(`open ${door}`);
            g.openDoor(door);
          }
        }
      }
    }
    if (!bot.path.length) return d2(p, PW[to]) < 0.3;
    const w = PW[bot.path[0]];
    const hd = Math.atan2(w[1] - p[1], w[0] - p[0]);
    g.look(hd, 0);
    bot.heldKeys.add('KeyW');
    if (speed >= 3) bot.heldKeys.add('ShiftLeft');
    else if (speed <= 1) bot.heldKeys.add('KeyC');
    if (!bot.lastP || d2(p, bot.lastP) > 0.12) {
      bot.lastP = p;
      bot.lastMoveT = bot.t;
    } else if (bot.t - bot.lastMoveT > 1.5) {
      L(`UNSTICK at ${p.map((v) => v.toFixed(2))} → ${bot.path[0]} (room ${g.room()})`);
      bot.unsticks.push({ beat: beat(), at: p.map((v) => +v.toFixed(2)), to: bot.path[0], room: g.room(), game: +bot.t.toFixed(1) });
      g.goto(w[0], w[1], w[2], hd, 0);
      bot.lastP = null;
    }
    return false;
  };
  const go = (to, then, label = to, speed = 1.6) => ({ kind: 'go', to, then, label, speed });
  const wait = (label) => ({ kind: 'wait', label });

  // round E (ruling a): the careless player sweeps the lit torch across her at mid range. In the glance beats, until
  // the beam has been on her body (≥ 6 m) for 0.5 s, it walks to a waypoint on her floor 6–9.5 m from her with a
  // clear line to her chest and points the torch at her (budget 60 s per beat; a beat with no such vantage — B10:
  // the player is sealed in the kitchen side while she patrols upstairs — is reported, not faked).
  const GLANCE_BEATS = ['B05', 'B06', 'B09', 'B10'];
  const chestOf = (a) => [a[0], a[1], a[2] + 1.3];
  const glanceDone = (b) => (bot.beamHits[b]?.frames ?? 0) >= 15 || (bot.beamHits[b]?.beamLooks ?? 0) >= 1;
  // a careless player glances from where it already is, not on an expedition: the vantage is on its own floor, within
  // 10 m of walking, and never through the wardrobe's back (a one-way push-through)
  const routeLen = (r) => r.slice(1).reduce((n, k, i) => n + d2(PW[r[i]], PW[k]), 0);
  const vantage = (ada) => {
    const c = chestOf(ada.pos);
    const me = pos();
    if (Math.abs(ada.pos[2] - me[2]) > 1.2) return null;
    let best = null;
    for (const [k, w] of Object.entries(PW)) {
      if (Math.abs(w[2] - me[2]) > 1.2) continue;
      const d = d2(w, ada.pos);
      if (d < 6.2 || d > 9.5) continue;
      if (!g.brain.world.lineOfSight([w[0], w[1], w[2] + 1.55], c)) continue;
      const r = route(nearestWp(), k);
      if (!r || routeLen(r) > 10 || r.some((n, i) => i && ((n === 'u4t_top' && r[i - 1] === 'u3_wardrobe') || (n === 'u3_wardrobe' && r[i - 1] === 'u4t_top')))) continue;
      const dm = routeLen(r);
      if (!best || dm < best.dm) best = { k, dm };
    }
    return best?.k ?? null;
  };
  const carelessGlance = (b) => {
    if (!cfg.careless || !GLANCE_BEATS.includes(b) || glanceDone(b) || hidden()) return null;
    const ada = adaOut;
    if (!ada?.visible || !ada.pos || ['CHASE', 'CATCH', 'SCRIPTED', 'LURED'].includes(ada.state)) return null;
    bot.glanceT0[b] ??= bot.t;
    if (bot.t - bot.glanceT0[b] > 60) return null;
    // a sweep, not a stare: at most 3 s of aiming per beat, then it carries on with what it was doing
    if ((bot.aimT[b] ?? 0) > 3) return null;
    // already in the right spot (6–9.5 m, clear line): stop and put the beam on her now
    {
      const me = pos();
      const d = d2(me, ada.pos);
      if (Math.abs(ada.pos[2] - me[2]) < 1.2 && d >= 6.2 && d <= 9.5 && g.brain.world.lineOfSight([me[0], me[1], me[2] + 1.55], chestOf(ada.pos))) return wait('careless glance (aim)');
    }
    if (!bot.glance || bot.glance.beat !== b || bot.t > bot.glance.until) {
      const k = vantage(ada);
      bot.glance = { beat: b, k, until: bot.t + (k ? 8 : 2) };
      L(`careless glance ${b}: ${k ? 'vantage ' + k : 'no vantage'} (she is ${ada.state} at ${ada.pos.map((v) => v.toFixed(1))})`);
    }
    if (!bot.glance?.k) return null;
    return go(bot.glance.k, () => {
      bot.aimAdaUntil = bot.t + 2;
    }, 'careless glance');
  };

  const decide = () => {
    const s = st();
    const b = s.beat;
    const f = flags();
    if (s.dead || csActive()) return wait('cutscene');
    const ada = adaOut;
    const lured = ada?.state === 'LURED';
    // round E: a chased player runs AWAY (not on along its errand into a dead-end room): the waypoint on her floor
    // that is farthest from her, reachable, preferring ones not behind her (bot keeps the choice 3 s)
    if (b !== 'B11' && ada?.state === 'CHASE' && ada.pos && !hidden() && Math.abs(ada.pos[2] - pos()[2]) < 1.2 && d2(ada.pos, pos()) < 8) {
      if (!bot.flee || bot.t > bot.flee.until) {
        const me = pos();
        let best = null;
        for (const [k, w] of Object.entries(PW)) {
          if (Math.abs(w[2] - me[2]) > 1.2) continue;
          const score = d2(w, ada.pos) - 0.3 * d2(w, me);
          // never through her: the first leg must not head toward her
          const r = route(nearestWp(), k);
          if (!r || r.length < 2) continue;
          const first = PW[r[1]];
          if (d2(first, ada.pos) < d2(me, ada.pos) - 0.2) continue;
          if (!best || score > best.score) best = { k, score };
        }
        bot.flee = best ? { k: best.k, until: bot.t + 3 } : null;
        if (best) L(`flee → ${best.k} (she is ${d2(ada.pos, me).toFixed(1)} m away)`);
      }
      if (bot.flee) return go(bot.flee.k, undefined, 'flee', 3.6);
    } else bot.flee = null;
    {
      const gl = carelessGlance(b);
      if (gl) return gl;
    }
    switch (b) {
      case 'B01':
        return wait('C1');
      case 'B02':
        if (f.front_door_open) return go('hall_s');
        if (!f.knocked) return go('porch', () => interact('P_KNOCKER', 'knock'), 'knock');
        if (!f.rang_front_bell) return go('porch', () => interact('P_BELL_KNOB', 'ring_bell'), 'ring');
        return wait('door opening');
      case 'B03':
        return go('threshold');
      case 'B04':
        return wait('C2c'); // C2-ESCAPE: B04 is the C2c cutscene only (no chase)
      case 'B05':
        if (hidden()) return f.first_hide_done ? wait('unhide') : wait('slats');
        // C2-ESCAPE §4.5: control at the stair top; the lightning showed the armoire ajar — walk there and hide
        if (!f.first_hide_done) return go('u_armoire', () => g.hides.enter('H_ARMOIRE'), 'to the armoire', 1.6);
        return go('u2_mid', undefined, 'sneak to U2', 1.6);
      case 'B06':
        if (!f.ledger_read || s.ledgerPages < 3) return go('u2_ledger', () => interact('P_LEDGER', 'read_ledger'), 'ledger');
        return go('u2_hammer', () => interact('P_HAMMER', 'take_hammer'), 'hammer');
      case 'B07':
        return wait('C3');
      case 'B08': {
        // a player who has read the hint plays B08 dark: the torch draws her (beam within 6 m in her sight → INVESTIGATE,
        // beam on her body → LOOK); with it on by the bell she walks straight up to the pull instead of answering it
        bot.beamOn = false;
        if (f.ada_boards_pried) return go('u3_mid');
        const lureOk = lured && ada.phase === 'scrape';
        if (!lureOk) {
          if (bot.t - bot.lastPull < 25) return hidden() ? wait('lie low') : go('u2_bell', undefined, 'wait by the bell');
          return go('u2_bell', () => {
            bot.lastPull = bot.t;
            interact('P_BELL_PULL', 'pull_bell');
          }, 'pull the bell');
        }
        return go('u_ada', undefined, 'boards');
      }
      case 'B09':
        if (!f.letter_read) return go('u3_letter', () => interact('P_LETTER', 'read_letter'), 'letter');
        if (!f.has_shears) return go('u3_letter', () => interact('P_SHEARS', 'take_shears'), 'shears');
        if (!f.hem_cut) return go('u3_dress', () => interact('P_DRESS', 'cut_hem'), 'hem');
        if (!f.has_locket && !f.locket_given) return go('u3_dress', () => interact('P_LOCKET', 'take_locket'), 'locket');
        if (!f.dress_visit_done) return hidden() ? wait('dress visit') : go('u3_wardrobe', () => g.hides.enter('H_ADA_WARDROBE'), 'hide for the dress visit');
        // gameplay-d review: leave the way a player does — hold S in the wardrobe ("push through the back", m2-world.ts);
        // walking u3_wardrobe → u4t_top went through the wardrobe body (B09 unstick)
        // careless: out of the wardrobe into the sewing room first and light her up as she walks off down the hall
        if (cfg.careless && hidden() === 'H_ADA_WARDROBE' && !glanceDone('B09') && bot.t - (bot.glanceT0.B09 ??= bot.t) < 60) return wait('unhide');
        if (hidden() === 'H_ADA_WARDROBE') return wait('push through');
        if (hidden()) return wait('unhide');
        // round E: still in the sewing room after the visit (e.g. respawned at CP6) — out through the wardrobe's back,
        // as a player does (get in, push through), never by walking through the wardrobe body
        if (g.room() === 'U3') return go('u3_wardrobe', () => g.hides.enter('H_ADA_WARDROBE'), 'into the wardrobe to leave');
        bot.locket = false;
        bot.beamOn = false;
        return go('u4_foot', undefined, 'servants stair');
      case 'B10':
        if (!f.has_can) return go('k_cans', () => interact('P_JERRY_10', 'take_can'), 'can');
        if (!f.passage_unbolted) return go('p_east', () => interact('D_PASSAGE', 'rattle_bolted'), 'unbolt');
        return go('p_door');
      case 'B11':
        if (f.locket_given) return go('hall_n', undefined, 'wait for C5');
        {
          // torch + raised locket once she is down on our floor (a lit beam that hits the stair or the hall below
          // her pins her upstairs: docs/QA.md bug "B11 beam through the floor")
          const sameFloor = !!adaOut && adaOut.visible && Math.abs(adaOut.pos[2] - pos()[2]) < 1;
          bot.beamOn = sameFloor;
          bot.locket = sameFloor;
        }
        return go('hall_n', undefined, 'let her look');
      case 'B12':
        bot.beamOn = false;
        bot.locket = false;
        if (!f.has_can) return go('k_cans', () => interact('P_JERRY_10', 'take_can'), 'can (after C5)');
        if (!f.passage_unbolted && g.room() !== 'G1' && g.room() !== 'EXT2') return go('p_east', () => interact('D_PASSAGE', 'rattle_bolted'), 'unbolt');
        return go('car', () => interact('P_CAR_ROW', 'car'), 'car');
      default:
        return wait('sting');
    }
  };

  // one simulated frame of the scripted player (before advance)
  const act = () => {
    bot.heldKeys.clear();
    const s = st();
    // reading page open → E closes it (uiPressed)
    if (reading()) {
      press('KeyE');
      return;
    }
    // cutscene gates
    const gate = cs?.player?.waitingGate ?? null;
    if (gate !== bot.lastGate) {
      if (gate) bot.gates.push({ id: gate, t0: bot.t, t1: null });
      else if (bot.gates.length && bot.gates[bot.gates.length - 1].t1 === null) bot.gates[bot.gates.length - 1].t1 = bot.t;
      if (gate) L(`gate ${gate}`);
      bot.lastGate = gate;
    }
    if (gate) {
      if (gate === 'key') {
        if (!bot.keyTapped) {
          press('KeyE');
          bot.heldKeys.add('KeyE');
          bot.keyTapped = true;
        }
      } else if (/breath/.test(gate)) bot.heldKeys.add('Space');
      else bot.heldKeys.add('KeyE'); // pour and any hold gate
      return;
    }
    bot.keyTapped = false;
    // C4 hem overlay asks for the breath on its own prompt too
    if (cs?.hem?.current && /breath/i.test(String(cs.hem.current))) bot.heldKeys.add('Space');

    // breath policy while hidden (as the sim: hold while her head lifts near the slats, ≤ 7 s)
    const h = hidden();
    if (h) {
      const he = HIDES[h].entry;
      const near = adaOut && adaOut.visible && d3(adaOut.pos, he) < 3 && (adaOut.head === 'lifting' || adaOut.head === 'lifted');
      if (near && !bot.holding && bot.breathHeld === 0) {
        bot.holding = true;
        L('hold breath');
      }
      if (bot.holding) {
        bot.breathHeld += DT;
        if (!near || bot.breathHeld >= 6.5) bot.holding = false;
      } else if (!near) bot.breathHeld = 0;
      if (bot.holding) bot.heldKeys.add('Space');
    } else {
      bot.holding = false;
      bot.breathHeld = 0;
    }

    const task = decide();
    bot.task = task.label;
    // torch + locket
    // stealth rule (design hint "Flashlight off near her"): in the upstairs stealth beats the torch goes off while she is
    // on our floor within 8 m and not answering the bell — the beam draws her (INVESTIGATE / LOOK) wherever props sit
    // QA_TORCH_ON=1: the careless player (pre-b08 torch policy: the torch is never switched off for stealth) — keeps
    // the e2e exercising Ada's light senses (beam-near / beam-on-body), which the stealth rules below sidestep
    let dark = false;
    if (!cfg.torchOn && ['B05', 'B06', 'B07', 'B09', 'B10'].includes(s.beat) && adaOut?.pos && adaOut.state !== 'LURED') {
      const p = pos();
      dark = Math.abs(adaOut.pos[2] - p[2]) < 1.2 && Math.hypot(adaOut.pos[0] - p[0], adaOut.pos[1] - p[1]) < 8;
    }
    // QA_CARELESS=1 (difficulty gate, ROADMAP "Difficulty"): the torch stays on everywhere (B11 keeps its locket policy)
    const wantOn = cfg.careless && s.beat !== 'B11' ? true : bot.beamOn && !dark;
    if (!h && g.rig.on !== wantOn && !csActive() && (wantOn || dark || (s.beat === 'B08' && !cfg.torchOn) || s.beat === 'B11' || s.beat === 'B12')) g.rig.setOn(wantOn);
    if (bot.locket) bot.heldKeys.add('Mouse2');

    if (task.kind === 'wait') {
      if (task.label === 'careless glance (aim)' && adaOut?.pos) {
        bot.aimT[s.beat] = (bot.aimT[s.beat] ?? 0) + DT;
        const p = pos();
        const c = chestOf(adaOut.pos);
        g.look(Math.atan2(c[1] - p[1], c[0] - p[0]), Math.atan2(c[2] - (p[2] + 1.55), d2(c, p)));
      }
      if (task.label === 'push through') bot.heldKeys.add('KeyS');
      if (task.label === 'unhide' && h) {
        L(`unhide ${h}`);
        g.hides.exit();
      }
      return;
    }
    if (h && task.label !== 'hide for the dress visit') {
      L(`unhide ${h}`);
      g.hides.exit();
    }
    // B08: pry the next board inside a thunder roll
    if (s.beat === 'B08' && task.label === 'boards' && d2(pos(), PW.u_ada) < 0.3) {
      if (g.brain.isMasked()) {
        const next = [1, 2, 3].find((k) => !flags()[`ada_board_${k}`]);
        const key = `pry${next}`;
        if (next && (bot.waitUntil.get(key) ?? 0) <= bot.t) {
          bot.waitUntil.set(key, bot.t + 3);
          interact(`board_${next}`, 'pry');
        }
      } else if ((bot.waitUntil.get('strike') ?? 0) <= bot.t) {
        // the storm strikes every ~35 s on its own; a player would wait — after 20 s at the boards, nudge it
        if (!bot.waitUntil.has('atBoards')) bot.waitUntil.set('atBoards', bot.t);
        if (bot.t - bot.waitUntil.get('atBoards') > 20) {
          bot.strikes++;
          L('lightning.strike() (waited 20 s at the boards)');
          g.lightning.strike();
          bot.waitUntil.set('strike', bot.t + 12);
          bot.waitUntil.set('atBoards', bot.t);
        }
      }
      return;
    }
    // stealth rule (asset/route independent): in the upstairs stealth beats, sneak (crouch) whenever she is on our floor
    // within 4 m and not answering the bell / chasing — footsteps are what give a walker away at that range
    let speed = task.speed;
    // any player runs once she is coming for them (the careless one included: careless ≠ suicidal)
    if (adaOut?.state === 'CHASE' && adaOut.pos && Math.abs(adaOut.pos[2] - pos()[2]) < 1.2) speed = Math.max(speed, 3.6);
    // QA_CARELESS=1 never sneaks: it walks everywhere and only hides where the story asks for it
    if (!cfg.careless && ['B05', 'B06', 'B08', 'B09', 'B10'].includes(s.beat) && adaOut?.pos && speed < 3) {
      const p = pos();
      const near = Math.abs(adaOut.pos[2] - p[2]) < 1.2 && Math.hypot(adaOut.pos[0] - p[0], adaOut.pos[1] - p[1]) < 5;
      if (near && !['LURED', 'CHASE', 'CATCH'].includes(adaOut.state)) {
        speed = Math.min(speed, 0.9);
        // the crouch ramps in: a step taken before it lands is a full bare-wood footstep (4 m) — crouch first, then go
        bot.crouchSince ??= bot.t;
        if (bot.t - bot.crouchSince < 0.6) {
          bot.heldKeys.add('KeyC');
          return;
        }
      } else bot.crouchSince = null;
    } else bot.crouchSince = null;
    const arrived = moveTo(task.to, speed);
    // B11 "let her look": face her when she is on our floor; otherwise keep the beam on the hall floor in front of us.
    // (Pointing the lit torch down the hall at the front door pins her upstairs — see docs/QA.md bug "B11 beam
    // through the floor"; a player who faces the stair, as the design intends, is not affected.)
    if (arrived && task.label === 'careless glance' && adaOut?.pos) {
      bot.aimT[s.beat] = (bot.aimT[s.beat] ?? 0) + DT;
      const p = pos();
      const c = chestOf(adaOut.pos);
      g.look(Math.atan2(c[1] - p[1], c[0] - p[0]), Math.atan2(c[2] - (p[2] + 1.55), d2(c, p)));
    }
    if (arrived && s.beat === 'B11') {
      const p = pos();
      if (adaOut && adaOut.visible && Math.abs(adaOut.pos[2] - p[2]) < 1) g.look(Math.atan2(adaOut.pos[1] - p[1], adaOut.pos[0] - p[0]), 0.02);
      else g.look(Math.atan2(PW.stair_foot[1] - p[1], PW.stair_foot[0] - p[0]), -0.5);
    }
    if (arrived && task.then && (bot.waitUntil.get(task.label) ?? 0) <= bot.t) {
      bot.waitUntil.set(task.label, bot.t + 1);
      task.then();
    }
  };

  // book-keeping after a frame
  const after = () => {
    const s = st();
    if (g.rig.on && adaOut?.visible && adaOut.pos && !hidden()) {
      const pv = g.director.host?.player?.();
      const bm = pv?.beam;
      if (bm?.on) {
        const c = chestOf(adaOut.pos);
        const v = [c[0] - bm.origin[0], c[1] - bm.origin[1], c[2] - bm.origin[2]];
        const dl = Math.hypot(...v);
        const bl = Math.hypot(...bm.dir) || 1;
        const cos = (v[0] * bm.dir[0] + v[1] * bm.dir[1] + v[2] * bm.dir[2]) / (dl * bl);
        if (dl >= 6 && dl <= bm.range && Math.acos(Math.min(1, cos)) <= bm.halfAngle + Math.atan(0.35 / dl) && g.brain.world.lineOfSight(bm.origin, c)) {
          const h = (bot.beamHits[s.beat] ??= { frames: 0, minD: 99 });
          h.frames++;
          h.minD = Math.min(h.minD, +dl.toFixed(2));
        }
      }
    }
    if (s.beat !== bot.lastBeat) {
      bot.beats.push({ beat: s.beat, game: +bot.t.toFixed(2), wall: +((performance.now() - bot.wallT0) / 1000).toFixed(1), builds: g.builds?.() ?? null, programs: g.memory?.()?.programs ?? null }); // builds: running node-builder count (src/render/perf.ts) — a jump between beats = shader variants compiled during play
      L(`beat → ${s.beat}`);
      bot.lastBeat = s.beat;
      bot.stuckSince = bot.t;
    }
    if (s.checkpoint && bot.checkpoints[bot.checkpoints.length - 1] !== s.checkpoint) bot.checkpoints.push(s.checkpoint);
    const c = csActive();
    if (c !== bot.lastCs) {
      if (c) {
        bot.cutscenes.push({ id: c, game: +bot.t.toFixed(2) });
        L(`cutscene ${c}`);
      }
      bot.lastCs = c;
    }
    if (s.deathsTotal > bot.deaths.length) {
      bot.deaths.push({ beat: s.beat, cp: s.checkpoint, game: +bot.t.toFixed(2), adaState: adaOut?.state ?? null });
      L(`DEATH at ${s.checkpoint}`);
    }
    if (endCard()) bot.ended = true;
    // Ada trace every 2 s of game time (state / phase / room / position) — evidence for stalls
    if (adaOut && bot.t - (bot.lastTrace ?? -9) >= 2) {
      bot.lastTrace = bot.t;
      bot.trace.push(`${bot.t.toFixed(0)} ${s.beat} ${adaOut.state}/${adaOut.phase ?? ''} ${adaOut.room ?? '?'} [${adaOut.pos.map((v) => v.toFixed(1))}] head=${adaOut.head ?? ''} vis=${adaOut.visible ? 1 : 0} dirCs=${g.director.cutscene ?? '-'} brain=${g.brain.state}/${g.brain.look ? g.brain.look.phase + ':' + g.brain.look.t.toFixed(1) : '-'} | torch=${g.rig.on ? 1 : 0} me ${g.room()} [${pos().map((v) => v.toFixed(1))}]`);
      if (bot.trace.length > 80) bot.trace.shift();
    }
  };

  // hero-shot opportunities (each once); returns a name when the frame just rendered is worth a picture
  const heroCheck = () => {
    const s = st();
    const c = csActive();
    const once = (k, cond) => {
      if (cond && !bot.shotsTaken.has(k)) {
        bot.shotsTaken.add(k);
        return k;
      }
      return null;
    };
    const csT = c ? bot.t - (bot.cutscenes[bot.cutscenes.length - 1]?.game ?? bot.t) : 0;
    return (
      once('c1-car', c === 'C1' && csT > 6) ||
      once('c2-parlor', c === 'C2' && csT > 5) ||
      once('c5-shadowplay', c === 'C5' && csT > 7) ||
      once('c6-dawn-drive', c === 'C6' && csT > 20) ||
      once('armoire-slats', hidden() === 'H_ARMOIRE' && adaOut?.visible && adaOut && d3(adaOut.pos, HIDES.H_ARMOIRE.entry) < 3.5) ||
      once('harlan-bedroom', !c && g.room() === 'U2' && s.beat === 'B06' && bot.task === 'ledger') ||
      once('upper-hall-ada', !c && !hidden() && g.room() === 'U1' && adaOut?.visible && adaOut.room === 'U1' && d3(adaOut.pos, pos()) > 2.5 && d3(adaOut.pos, pos()) < 9) ||
      null
    );
  };

  /** Runs up to `sec` game seconds; returns early for a hero shot, a beat change, the end, or a stall. */
  bot.run = async (sec) => {
    const tEnd = bot.t + sec;
    let n = 0;
    const startBeat = beat();
    while (bot.t < tEnd && !bot.ended) {
      act();
      {
        const E = bot.escape;
        const cNow = csActive();
        if ((cNow === 'C2' || cNow === 'C2c') && bot.heldKeys.size) E.csInput.push({ cs: cNow, t: +bot.t.toFixed(2), keys: [...bot.heldKeys] });
        const sb = st().beat;
        if (sb === 'B05' && E.b05T0 === null && !cNow) {
          E.b05T0 = bot.t;
          E.handover = { pos: pos().map((v) => +v.toFixed(2)), yaw: +(g.ctx?.player?.yaw ?? NaN).toFixed?.(3), t: +bot.t.toFixed(2) };
        }
        if (sb === 'B05' && E.b05T0 !== null && E.firstSeen === null && adaOut?.visible) E.firstSeen = +(bot.t - E.b05T0).toFixed(2);
      }
      try {
        await g.advance(1, DT, [...bot.heldKeys]);
      } catch (e) {
        // A frame threw inside the game's own update. Record it (it is a bug), apply a page-side workaround for the
        // known one so the rest of the game can still be verified, and give up after a handful.
        const msg = String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ');
        bot.errors.push({ beat: beat(), cs: csActive(), game: +bot.t.toFixed(2), msg });
        L(`FRAME THREW: ${msg.slice(0, 200)}`);
        if (/reading 'base'/.test(msg) && !bot.patchedLmClone) {
          // LightmapMaterial.clone() → new LightmapMaterial() with no lightmap options → TypeError (C7 car_trim).
          // Patch the car-interior materials' clone() so the sting can finish.
          bot.patchedLmClone = true;
          g.level.prop('P_CAR_INTERIOR')?.traverse((n) => {
            const m = n.material;
            if (!n.isMesh || !m?.isLightmapMaterial) return;
            m.clone = function () {
              return new this.constructor({}, { base: this.lmBase, flash: this.lmFlash, flipV: this.lmFlipV, multiplier: this.lmMultiplier }).copy(this);
            };
          });
          L('workaround: patched LightmapMaterial.clone on P_CAR_INTERIOR');
        }
        if (bot.errors.length > 5) throw e;
      }
      bot.t += DT;
      // gameplay review: game-seconds per beat × brain state (+ LOOK phase) — shows whether she still hunts a careless player
      if (g.brain?.state) { const k = st().beat + ':' + g.brain.state + (g.brain.look ? '/' + g.brain.look.phase : ''); bot.states[k] = (bot.states[k] ?? 0) + DT; }
      after();
      if (++n % 15 === 0) await new Promise((r) => setTimeout(r, 0));
      const hero = heroCheck();
      if (hero) {
        bot.want = hero;
        break;
      }
      if (beat() !== startBeat) break;
      if (bot.t - bot.stuckSince > cfg.stallSec) {
        L(`STALL: ${cfg.stallSec}s in ${beat()} (task ${bot.task})`);
        bot.stuckSince = bot.t;
        bot.stalled = true;
        break;
      }
    }
    return bot.status();
  };

  /** Aim the camera (heading CCW from east, pitch) — the player stays put. */
  bot.aim = (target, pitch = 0) => {
    const p = pos();
    g.look(Math.atan2(target[1] - p[1], target[0] - p[0]), pitch);
  };

  bot.status = () => {
    const s = st();
    const want = bot.want;
    bot.want = null;
    const stalled = !!bot.stalled;
    bot.stalled = false;
    return {
      t: +bot.t.toFixed(2),
      wall: +((performance.now() - bot.wallT0) / 1000).toFixed(1),
      beat: s.beat,
      cp: s.checkpoint,
      task: bot.task,
      cs: csActive(),
      hidden: hidden(),
      room: g.room(),
      pos: pos().map((v) => +v.toFixed(2)),
      ada: adaOut ? { state: adaOut.state, phase: adaOut.phase, room: adaOut.room, visible: adaOut.visible, pos: adaOut.pos.map((v) => +v.toFixed(2)) } : null,
      deaths: s.deathsTotal,
      want,
      stalled,
      ended: bot.ended,
    };
  };
  bot.summary = () => ({ beats: bot.beats, checkpoints: bot.checkpoints, cutscenes: bot.cutscenes, gates: bot.gates, deaths: bot.deaths, unsticks: bot.unsticks, frameErrors: bot.errors, adaTrace: bot.trace.slice(-40), strikes: bot.strikes, hints: st().hintsGiven, stimuli: stims.slice(-80), log: bot.log.slice(-60), states: Object.fromEntries(Object.entries(bot.states).map(([k, v]) => [k, +v.toFixed(1)])), beamHits: bot.beamHits, escape: bot.escape });
  return true;
}

// ------------------------------------------------------------------------------------------------ node side
export default async function (qa) {
  const MAX_GAME_S = 2400;
  const strict = process.env.QA_STRICT !== '0';
  const cfg = { dt: 1 / 30, PW, PE: process.env.QA_GRATE ? [...PE, ['u2_mid', 'u2_ledger']] : PE, stallSec: Number(process.env.QA_STALL_S ?? 240), torchOn: !!process.env.QA_TORCH_ON || !!process.env.QA_CARELESS, careless: !!process.env.QA_CARELESS };
  qa.report.playthrough = { ok: false };
  await qa.game('loop.stop()'); // the scenario owns time from here: every frame is an advance()
  await qa.eval(`(${installBot.toString()})(${JSON.stringify(cfg)})`);
  const wall0 = Date.now();
  let s = await qa.eval('__bot.status()');
  qa.log(`start beat=${s.beat} room=${s.room}`);
  const heroDone = new Set();
  let facadeDone = false;
  let lastBeat = s.beat;
  let stalls = 0;

  while (!s.ended && s.t < MAX_GAME_S) {
    s = await qa.eval('__bot.run(30)');
    if (s.beat !== lastBeat) {
      qa.log(`beat ${s.beat} @ game ${s.t}s wall ${((Date.now() - wall0) / 1000).toFixed(0)}s (room ${s.room}, deaths ${s.deaths})`);
      lastBeat = s.beat;
    }
    // the facade from the gate, in a lightning flash (B02 opens at the gate)
    if (!facadeDone && s.beat === 'B02' && !s.cs) {
      facadeDone = true;
      await qa.eval(`(() => { const g = window.__game; g.goto(1.8, -26.5, 0, Math.PI / 2, 0.16); g.lightning.strike(); return true; })()`);
      // the first strike pulse peaks ~0.1–0.3 s in: step until lightning.level is high
      for (let i = 0; i < 20; i++) {
        const lv = await qa.eval(`window.__game.advance(1, 1/60).then(() => window.__game.lightning.level)`);
        if (lv > 0.6) break;
      }
      await qa.shot('facade-gate-flash');
      heroDone.add('facade');
    }
    if (s.want) {
      if (s.want === 'upper-hall-ada') await qa.eval(`(() => { const p = window.__bot; const a = ${JSON.stringify(s.ada?.pos ?? null)}; if (a) p.aim(a, -0.05); return window.__game.advance(1, 1/30); })()`);
      if (s.want === 'harlan-bedroom') await qa.eval(`(() => { window.__bot.aim([8.2, 2.6, 4.1], -0.08); return window.__game.advance(1, 1/30); })()`);
      await qa.shot(s.want);
      heroDone.add(s.want);
      qa.log(`shot ${s.want} @ ${s.t}s`);
    }
    if (s.stalled) {
      stalls++;
      qa.log(`STALL in ${s.beat}: task=${s.task} room=${s.room} pos=${s.pos} ada=${JSON.stringify(s.ada)}`);
      if (stalls >= 2) break;
    }
  }

  const sum = await qa.eval('__bot.summary()');
  const order = sum.beats.map((b) => b.beat);
  const want = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13'];
  const firsts = want.map((b) => order.indexOf(b));
  const inOrder = firsts.every((i, k) => i >= 0 && (k === 0 || i > firsts[k - 1]));
  const csIds = new Set(sum.cutscenes.map((c) => c.id));
  qa.assert(inOrder, `beats B01…B13 in order (got ${order.join(' ')})`);
  for (const c of ['C1', 'C2', 'C3', 'C5', 'C6', 'C7']) qa.assert(csIds.has(c), `cutscene ${c} played`);
  // C2-ESCAPE gate: no input through C2 + C2c, control at the stair top (CP2), her return ≥ 10 s after control, no
  // death from B03 to the end of B05 (C2/C2c cannot catch; the first hide cannot be failed)
  const E = sum.escape ?? {};
  qa.log('escape: ' + JSON.stringify(E));
  qa.assert((E.csInput ?? []).length === 0, `no input held during C2/C2c (${JSON.stringify((E.csInput ?? []).slice(0, 3))})`);
  const cp2 = await qa.eval(`(() => { const s = window.__game.ctx.layout.spawns.find((x) => x.id === 'CP2'); return s ? s.pos : null; })()`);
  if (cp2 && E.handover) qa.assert(Math.hypot(E.handover.pos[0] - cp2[0], E.handover.pos[1] - cp2[1]) < 0.6 && Math.abs(E.handover.pos[2] - (cp2[2] - 1.65)) < 0.3, `B05 control at the stair top CP2 (${E.handover.pos} vs ${cp2})`);
  qa.assert(E.firstSeen === null || E.firstSeen >= 9.9, `her return is ≥ 10 s after control (first seen +${E.firstSeen} s)`);
  qa.assert(!sum.deaths.some((d) => ['B03', 'B04', 'B05'].includes(d.beat)), `no death in B03–B05 (${JSON.stringify(sum.deaths)})`);
  qa.assert(s.ended, `reached the title card (ended=${s.ended}, beat ${s.beat}, game ${s.t}s)`);
  // difficulty gate (ROADMAP "Difficulty", 2026-10-08): the stealth bot is never caught; the careless bot (QA_CARELESS:
  // walks, torch on, hides only where the story asks) at most once; QA_TORCH_ON is informative only
  if (cfg.careless) qa.assert(sum.deaths.length <= 1, `careless player caught at most once (deaths ${sum.deaths.length})`);
  // round E (ruling a): the careless bot really shone the lit torch on her at ≥ 6 m in B05 and B09 (B10/B06 reported)
  if (cfg.careless) {
    qa.log('careless beam on her at ≥ 6 m (frames / nearest m): ' + JSON.stringify(sum.beamHits));
    // B05 always offers the shot (she stands at her vigil down the hall); B09/B10 rarely do — B10 never (the player is
    // sealed on the kitchen side while she patrols upstairs), B09 only as she walks off after the dress visit — so the
    // gate asks for B05 plus one more upstairs beat, and the summary reports every beat
    const lit = (b) => (sum.beamHits[b]?.frames ?? 0) >= 15 || (sum.beamHits[b]?.beamLooks ?? 0) >= 1;
    const show = (b) => `${b} ${sum.beamHits[b]?.frames ?? 0} cone frames / ${sum.beamHits[b]?.beamLooks ?? 0} beam LOOKs`;
    qa.assert(lit('B05'), `careless: lit beam on her at ≥ 6 m in B05 (${show('B05')})`);
    qa.assert(['B06', 'B09', 'B10'].some(lit), `careless: lit beam on her at ≥ 6 m in another upstairs beat (${['B06', 'B09', 'B10'].map(show).join(', ')})`);
  }
  // gameplay review: an UNSTICK teleport is the bot bailing the player out (a stuck real player). Round E ruling (a):
  // strict is the DEFAULT gate (QA_STRICT=0 opts out)
  if (strict) qa.assert(sum.unsticks.length === 0, `no unstick rescues (${sum.unsticks.length}: ${sum.unsticks.map((u) => u.beat + '@' + u.at).join(' ')})`);
  if (!cfg.torchOn) qa.assert(sum.deaths.length === 0, `stealth player never caught (deaths ${sum.deaths.length})`);
  qa.assert(sum.frameErrors.length === 0, `no frame threw inside the game (${sum.frameErrors.length}: ${sum.frameErrors.map((e) => `${e.beat}/${e.cs}: ${e.msg.slice(0, 120)}`).join(' ; ')})`);
  // per-beat timing: game / wall seconds spent in each beat (first entry → next beat's first entry or the end) + deaths
  const beatTimes = [];
  for (let i = 0; i < sum.beats.length; i++) {
    const b = sum.beats[i], nx = sum.beats[i + 1];
    const g1 = nx ? nx.game : +s.t, w1 = nx ? nx.wall : (Date.now() - wall0) / 1000;
    const deaths = sum.deaths.filter((d) => (d.beat ?? null) === b.beat).length;
    beatTimes.push({ beat: b.beat, gameS: +(g1 - b.game).toFixed(1), wallS: +(w1 - b.wall).toFixed(1), deaths });
  }
  qa.log('beat times (game s / wall s / deaths): ' + beatTimes.map((b) => `${b.beat} ${b.gameS}/${b.wallS}/${b.deaths}`).join(' · '));
  qa.report.playthrough = { ok: inOrder && s.ended, final: s, wallS: (Date.now() - wall0) / 1000, ...sum, heroShots: [...heroDone], beatTimes };
  qa.log(`done: ended=${s.ended} beat=${s.beat} game=${s.t}s wall=${((Date.now() - wall0) / 1000).toFixed(0)}s deaths=${sum.deaths.length}`);
}
