// Cutscene prewarm registry (CUTSCENES-PLAN §5 "Prewarm", M-A). PURE (no three.js import): cutscene-only meshes that
// are hidden at load (drops, mist, the match flare …) register here; the load warm-up (src/game/main.ts afterCompile,
// step 'cs-prewarm') hangs them in front of the camera, visible, for one compile + render, then puts them back — so
// their first cutscene frame never compiles a pipeline (a 30–200 ms stall on the M1). Lights are not handled here:
// a light added or shown mid-game re-keys every material's LightsNode (keep cutscene lights at intensity 0 from load).

export const CS_PREWARM: any[] = [];

export function registerPrewarm(...objs: any[]): void {
  for (const o of objs) if (o && !CS_PREWARM.includes(o)) CS_PREWARM.push(o);
}
