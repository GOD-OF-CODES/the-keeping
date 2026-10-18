// LIGHTING lane (REALISM-BACKLOG item 17) — Ada's skin, hair and contact shadow.
//
// Skin (material userData.sss): was a plain MeshStandard at roughness 0.7 with a tiny cold emissive lift.
//  - wrap diffuse (w = 0.3): light reaches past the terminator by scattering under the skin; the EXTRA wrapped light
//    is tinted [0.6, 0.25, 0.2] (blood-red/orange mean free path — the drowned-pale skin's subsurface colour),
//    the Lambert part stays the albedo's: diffuse = albedo/π · E · (max(0, N·L) + tint · (wrap − max(0, N·L))).
//  - the wet film: she is drowned and wet (skin_ada wetness 0.8). The backlog asks for "sheen 0.2"; three's sheen
//    is the Charlie velvet lobe (retro-reflective fibres), which is not what water on skin does — a water film is
//    a smooth dielectric layer: clearcoat 0.5 (F0 0.02 ≈ water n 1.33), roughness 0.12. (Deviation, physics.)
// Hair (hair_wet_black, alpha-hashed cards): was one GGX lobe at roughness 0.25, then two GGX lobes on the normal
//  (a black shell). Round 3: strand lobes R / TRT / TT on the per-card strand tangent (see HairLightingModel).
// Contact shadow (presets without GTAO: Medium, Low): Ada had none on the lightmapped floor. A multiply-blended
// quad under her feet darkens the floor by ≤ 60 % within 0.3 m of each foot (fading as the foot lifts) and a
// wider, fainter pelvis term — the ambient occlusion a standing body casts on the floor.

import * as THREE from 'three/webgpu';
import { Fn, normalMap, texture, normalGeometry, fwidth, mix, property, dFdx, dFdy, diffuseColor, float, max, mx_noise_float, normalView, positionGeometry, select, pow, positionView, positionViewDirection, positionWorld, normalWorld, sign, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';

const SKIN_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('skin') === '0';
export const uSkinWrap = uniform(0.3);
// fix round 2 (ruling j / lane A: the salmon is RUNTIME, the bake is grey-blue): the wrap term is the light that
// scatters past the terminator. In living skin it is red (perfused dermis); in a drowned body 2 h dead the blood has
// settled to the dependent side (livor) and the waterlogged epidermis scatters near-neutral → (0.6, 0.25, 0.2) → (0.4, 0.31, 0.29)
export const uSkinTint = uniform(new THREE.Vector3(0.4, 0.31, 0.29));
/** 1 = the hair veil in front of the severed head's face is gone (see applySkinOrHair; driven by ada.ts). */
export const uHairVeilClear = uniform(0);
/** M-A: 1 = the severed head has lain in its pool — the smeared blood film on the down side of the face (skin.ts). */
export const uHeadSmear = uniform(0);
/** 1 = severed: blood film on the skin around the cut (head stub + body neck; see applySkinOrHair). */
export const uNeckBlood = uniform(0);
/** Fix round 2 (ruling i, the eye insert): the floor's bounce under the severed head held at his face height —
 *  irradiance (linear, lamp units) arriving from BELOW on the head piece only; set by cutscene-fx 'faceFill'. */
export const uFaceFill = uniform(new THREE.Vector3(0, 0, 0));

// ---- C2-ESCAPE B13 (#17 runtime side): the wet cotton nightgown. Water fills the air gaps between the fibres, so
// a soaked cotton sheet scatters far less: it darkens and lets light THROUGH (translucent / see-through where wet).
// A thin sheet: light arriving from behind (N·L < 0 on the viewer's side) is transmitted diffusely, tinted by the
// cloth and by the grey-blue drowned skin it lies on. T = translucencyWet × wetness (material-spec nightgown_silt:
// 0.4 × 0.9 = 0.36) — the fraction of back irradiance re-emitted diffusely on the front. Cotton's forward-scattering
// wrap (w 0.5) keeps the terminator soft like fabric, not plastic.
export const uGownTrans = uniform(0.36);
export const uGownWrap = uniform(0.5);
/** Mean colour of what the wet sheet transmits: the cloth's own albedo × the skin under it (skin_ada tone 0.33/0.35/0.37). */
export const uGownTransTint = uniform(new THREE.Vector3(0.85, 0.88, 0.95));

export class GownLightingModel extends (THREE as any).PhysicalLightingModel {
  direct(input: any, builder: any): void {
    super.direct(input, builder);
    const dotNL = normalView.dot(input.lightDirection);
    const lam = dotNL.clamp(0, 1);
    const wrap = dotNL.add(uGownWrap).div(uGownWrap.add(1)).clamp(0, 1);
    const back = dotNL.negate().clamp(0, 1);
    const extra = wrap.sub(lam).max(0).add(back.mul(uGownTrans).mul(uGownTransTint));
    input.reflectedLight.directDiffuse.addAssign(input.lightColor.mul(extra).mul(diffuseColor.rgb).mul(1 / Math.PI));
  }
}

// ---- C2-ESCAPE B14: the player's gloves in the rain. Porous leather wets darker (water fills the pores: ≈ −25 %
// albedo at full wetness) and smoother (the film fills the grain: roughness × 0.55); on Max a water film lobe
// (clearcoat, F0 0.02 ≈ water n 1.33, roughness 0.12) sits on top. Wetness 0.6: he walked up the drive in the storm.
export const uGloveWet = uniform(0.6);

export class SkinLightingModel extends (THREE as any).PhysicalLightingModel {
  direct(input: any, builder: any): void {
    super.direct(input, builder);
    const dotNL = normalView.dot(input.lightDirection);
    const lam = dotNL.clamp(0, 1);
    const wrap = dotNL.add(uSkinWrap).div(uSkinWrap.add(1)).clamp(0, 1);
    const extra = wrap.sub(lam).max(0);
    input.reflectedLight.directDiffuse.addAssign(input.lightColor.mul(extra).mul(uSkinTint).mul(diffuseColor.rgb).mul(1 / Math.PI));
  }
}

/**
 * Strand tangent (view space) from the card UVs: hair.py lays v ALONG the strand (u across), so dP/dv from the
 * screen-space derivatives of position and UV (dP = Pu·du + Pv·dv solved on dFdx/dFdy) is the strand direction —
 * per card, no tangent attribute needed (the r6/r7 Kajiya-Kay used one constant fallback tangent for every card and
 * lit the whole head grey-white). Orthogonalised against the shading normal.
 */
const strandTangent = Fn(() => {
  const p = positionView;
  const t = uv();
  const dp1 = dFdx(p);
  const dp2 = dFdy(p);
  const du1 = dFdx(t);
  const du2 = dFdy(t);
  const det = du1.x.mul(du2.y).sub(du1.y.mul(du2.x));
  const pv = dp2.mul(du1.x).sub(dp1.mul(du2.x)).mul(sign(det));
  const n = normalView;
  return pv.sub(n.mul(n.dot(pv))).add(vec3(1e-6, 2e-6, 0)).normalize();
});

/**
 * Wet black hair as strands (round 3, item 17 — it read as a solid black shell): the Marschner R / TRT / TT lobes in
 * Karis's real-time form (UE4 "Physically Based Hair Shading", 2016) on the per-card strand tangent T. Longitudinal
 * M = normalised Gaussian in (sinθL + sinθV − α) of width β = roughness² (R β, TT β/2, TRT 2β; cuticle tilt α = −2s,
 * s, 4s, s = 0.035 rad); azimuthal N: R cos(φ/2)/4 (untinted, F(n 1.55)), TRT exp(17cosφ − 16.78) tinted by the
 * absorption colour^(0.8/cosθd), TT exp(−3.65cosφ − 3.98) (only through the back-lit strands → the edge glow).
 * Attempt 2 used Kajiya-Kay with a Phong (n+2)/2π normalisation: that is a 2-D lobe's — on a 1-D strand lobe it
 * over-counts ~40× and, with a coaxial torch (H ≈ V ⟂ every strand), lit the whole head white. Wet hair: R
 * roughness 0.3 (water-smoothed cuticle), TRT wider. Diffuse: a soft wrap (strands are cylinders).
 */
// runtime lane E (item 8): rR 0.3 → 0.22 — a water film over the cuticle narrows the R lobe toward β ≈ 5° (Marschner 2003: 5–10°)
export const HAIR = { rR: uniform(0.22), rTRT: uniform(0.45), shiftR: uniform(-0.07), shiftTRT: uniform(0.14), tt: uniform(1), spec: uniform(0.5) };

/** The strand tangent as a fragment property: assigned once in setupVariants (top level of the fragment stage —
 *  WGSL needs derivatives in uniform control flow), read by every light's direct(). */
const hairT = property('vec3', 'HairT');
/** runtime lane E (item 8): per-strand longitudinal shift jitter (rad-ish, in the lobe's sin units). One card carries
 *  ~60 strands across u; real fibres' cuticle tilt and clumping vary strand to strand, which breaks the R highlight of a
 *  bowed wet crown under a coaxial torch into strands — a single tangent per card made it one glowing disc. */
const hairJ = property('float', 'HairJ');
const strandJitter = Fn(() => {
  const k = uv().x.mul(60).floor();
  return k.mul(12.9898).sin().mul(43758.5453).fract().sub(0.5).mul(0.12);
});

export class HairLightingModel extends (THREE as any).PhysicalLightingModel {
  direct(input: any, builder: any): void {
    const { lightDirection: L, lightColor, reflectedLight } = input;
    const T = hairT;
    const N = normalView;
    const V = positionViewDirection;
    const dotNL = N.dot(L);
    const wrap = dotNL.add(0.5).div(1.5).clamp(0, 1);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(wrap).mul(diffuseColor.rgb).mul(1 / Math.PI));
    const sinL = T.dot(L).clamp(-1, 1);
    const sinV = T.dot(V).clamp(-1, 1);
    // cos θd = cos((θV − θL)/2) = √((1 + cosθV·cosθL + sinθV·sinθL)/2) — no asin/cos per light (R2-2)
    const cosThD = float(1).sub(sinV.mul(sinV)).max(0).sqrt().mul(float(1).sub(sinL.mul(sinL)).max(0).sqrt()).add(sinV.mul(sinL)).add(1).mul(0.5).max(0.0025).sqrt();
    const Lp = L.sub(T.mul(sinL));
    const Vp = V.sub(T.mul(sinV));
    const cosPhi = Lp.dot(Vp).mul(Lp.dot(Lp).mul(Vp.dot(Vp)).add(1e-4).inverseSqrt());
    const cosHalfPhi = cosPhi.mul(0.5).add(0.5).clamp(0, 1).sqrt();
    const g = (B: any, x: any) => x.mul(x).mul(-0.5).div(B.mul(B)).exp().div(B.mul(Math.sqrt(2 * Math.PI)));
    const fres = (c: any) => float(1).sub(c.clamp(0, 1)).pow(5).mul(1 - 0.046).add(0.046);
    const bR = HAIR.rR.mul(HAIR.rR).max(0.004);
    const bT = HAIR.rTRT.mul(HAIR.rTRT).max(0.004);
    const VoL = V.dot(L);
    // R: off the cuticle, untinted
    const R = g(bR.mul(Math.SQRT2).mul(cosHalfPhi).max(0.004), sinL.add(sinV).sub(HAIR.shiftR.add(hairJ))).mul(cosHalfPhi.mul(0.25)).mul(fres(VoL.mul(0.5).add(0.5).clamp(0, 1).sqrt()));
    // TRT: in through the cortex, off the back wall, out — tinted by the absorption
    const fT = fres(cosThD.mul(0.5));
    const absorb = pow(diffuseColor.rgb.max(1e-4), float(0.8).div(cosThD));
    const TRT = g(bT, sinL.add(sinV).sub(HAIR.shiftTRT.add(hairJ.mul(1.5)))).mul(cosPhi.mul(17).sub(16.78).exp()).mul(float(1).sub(fT).pow(2).mul(fT)).mul(absorb);
    // TT: straight through the strand toward the eye — only when lit from behind (the rim glow of back-lit wet hair)
    const h = cosHalfPhi.mul(cosPhi.mul(-0.8).add(0.6).mul(1 / 1.55).add(1));
    const fTT = fres(cosThD.mul(float(1).sub(h.mul(h)).clamp(0, 1).sqrt()));
    const absorbTT = pow(diffuseColor.rgb.max(1e-4), float(1).sub(h.mul(h).mul(1 / (1.55 * 1.55))).clamp(0, 1).sqrt().mul(0.5).div(cosThD));
    const TT = g(bR.mul(0.5).max(0.004), sinL.add(sinV).sub(HAIR.shiftR.mul(-0.5))).mul(cosPhi.mul(-3.65).sub(3.98).exp()).mul(float(1).sub(fTT).pow(2)).mul(absorbTT).mul(HAIR.tt);
    const lit = smoothstep(-0.15, 0.25, dotNL); // the head shadows the far side (TT is the light that got through)
    const spec = R.mul(HAIR.spec).add(TRT).mul(lit);
    reflectedLight.directSpecular.addAssign(lightColor.mul(spec.add(TT)));
  }
}

/** Swaps a loaded character material to the skin / hair model (skin → MeshPhysical for the wet clearcoat). */
export function applySkinOrHair(m: any, ud: Record<string, unknown>, presetId: string): any {
  if (SKIN_OFF) return m; // debug A/B: ?skin=0 (pre item 17)
  if (ud.sss) {
    const p = new THREE.MeshPhysicalNodeMaterial();
    p.name = m.name;
    p.emissiveNode = m.emissiveNode;
    p.metalness = m.metalness;
    p.opacityNode = m.opacityNode;
    p.userData = m.userData;
    p.colorNode = m.colorNode;
    p.roughnessNode = m.roughnessNode;
    let ccRough: any = null; // fix round 3 LOOK: the film lobe's roughness on her cut (Max clearcoat)
    if (String(ud.material_id) === 'skin_ada' && m.colorNode && m.roughnessNode) {
      // C2-ESCAPE reviewer fix (cut faces read as flat salmon discs): the cut tissue lane A paints into the atlas
      // (muscle ≈ 0.17/0.07/0.06 linear, r/g ≈ 2.4; her grey-blue skin r/g ≈ 0.95, lividity ≲ 1.3) is fresh meat under
      // a blood film: whole blood absorbs green/blue in < 0.1 mm (Hb), so the film darkens and deepens it to
      // ≈ 0.09/0.016/0.014, and the plasma film is a smooth dielectric (roughness ≈ 0.08–0.12, F0 ≈ 0.02):
      // sharp glints of the lamp/torch instead of a matte disc. Bone/cartilage (low r/g) is left as painted.
      const c = m.colorNode;
      const cut0 = smoothstep(1.55, 2.1, c.r.div(c.g.max(1e-3)));
      // fix round 4 LOOK (lane A s2 request, ruling w): the cut FACE (axial geometric normal inside the neck radius, at
      // the measured cut plane) already carries lane A's baked whole-blood film (≈ 0.10/0.008/0.007) and its baked
      // roughness (0.95 in the open lumens) — every runtime darkening below took it to ~0.005 = black, so only the white
      // sheen was left (a grey lid). capK masks the face out of the cut tint, the neck film and the r3 fat tint.
      const pg = positionGeometry;
      const rad = vec2(pg.x, pg.z.add(0.012)).length();
      const near = float(1).sub(smoothstep(0.065, 0.088, rad));
      // cut plane measured from max/ada.glb (cap verts |n_y| > 0.9, r < 5 cm, both pieces): y = 1.393 − 0.57·z (bind)
      const dPlane = pg.y.sub(float(1.393).sub(pg.z.mul(0.57))).abs().mul(0.869); // ⊥ distance (cos 29.7°)
      const capK = smoothstep(0.55, 0.85, normalGeometry.y.abs()).mul(near).mul(float(1).sub(smoothstep(0.02, 0.03, dPlane)));
      const cut = cut0.mul(float(1).sub(capK));
      p.colorNode = c.mul(vec3(1).sub(vec3(0.58, 0.86, 0.86).mul(cut)));
      // fix round 2 (E4 look, 1.4 m: the cut face glinted gold in a cellular pattern = salami): the blood film fills the
      // tissue's relief, so the lamp's highlight is one broad sheen, not a sparkle per normal-map cell → 0.1 → 0.24
      p.roughnessNode = m.roughnessNode.mul(float(1).sub(cut)).add(cut.mul(0.24));
      // Escape fix-round review: once severed, the skin AROUND the cut carries blood (the head's neck stub fell into
      // and rolled through its pool; the carotid jets run down the body's neck). Without it the head's 8 cm neck stub
      // was a clean beige cylinder — a doll part. Bind space (Y-up, face +Z): the cut sits at y ≈ 1.35 on the neck
      // axis (x 0, z ≈ −0.012); the film covers the stub fully at the cut and breaks into run streaks up to 8 cm onto
      // the head side / 3.5 cm onto the body side, only within the neck's 8.5 cm radius (not the shoulders).
      // Whole-blood film over skin: albedo × (0.42, 0.06, 0.05) (Hb absorbs G/B within 0.1 mm), plasma-wet roughness 0.12.
      // (fix round 2: lane A's build 1b cut sits at y ≈ 1.39 (body cap top 1.396) — the film is FULL across 1.33–1.42 so
      // the cap's fat/tissue specks lie under it, then breaks into runs 8 cm up / 3.5 cm down)
      const dist = select(pg.y.greaterThan(1.42), pg.y.sub(1.42).div(0.08), select(pg.y.lessThan(1.33), float(1.33).sub(pg.y).div(0.035), float(0)));
      const band = float(1).sub(smoothstep(0.2, 1.0, dist));
      const n = mx_noise_float(vec3(pg.x.mul(55), pg.y.mul(9), pg.z.mul(55)));
      const film = smoothstep(0.35, 0.6, band.add(n.mul(0.4))).mul(near).mul(uNeckBlood);
      const filmS = film.mul(float(1).sub(capK)); // the stub skin only — the face's film is baked (fix round 4)
      p.colorNode = p.colorNode.mul(vec3(1).sub(vec3(0.58, 0.94, 0.95).mul(filmS)));
      // fix round 4 (lane A l2: bright beads along the rim = film-0.12 glints on the torn skin tags): within 6 mm of the
      // cut the film is clotting serum over torn tags (fibrin roughens it within seconds) → 0.25; the runs below stay 0.12.
      // (r2max-05: the beads survived 0.25 — the Max/Medium clearcoat film lobe at 0.12 was still a mirror there: the
      // lobe takes the same rim roughness below; 0.3 = a serum film over clot, its glints merge into one soft lip)
      const rimZ = float(1).sub(smoothstep(0.008, 0.012, dPlane));
      const rimF = filmS.max(rimZ.mul(near).mul(uNeckBlood).mul(float(1).sub(capK)));
      p.roughnessNode = p.roughnessNode.mul(float(1).sub(filmS)).add(filmS.mul(mix(float(0.12), float(0.3), rimZ)));
      p.roughnessNode = mix(p.roughnessNode, max(p.roughnessNode, float(0.3)), rimZ.mul(rimF));
      // review fix round 2 (E4 close-up: the head's cut face was a disc of hundreds of gold sparkles = 'salami' / a jar
      // lid): lane A's physical normal maps (bump distance fix) give the cut tissue mm-scale relief, and at the film's
      // roughness 0.12 every bump threw its own image of the flame. Liquid fills that relief: a whole-blood film
      // ≥ 0.2 mm thick (fresh cut, lying in its pool) has a surface set by surface tension, not by the tissue under it
      // (capillary length of blood ≈ 2 mm ≫ the relief) → the tangent-space detail is flattened × 0.15 where the film /
      // the cut is full: one broad wet sheen on the cut, the anatomy left as colour.
      // review d2 (A/B at 0.55 m: roughness 0.9 kills every gold sparkle, the flattened normal map does not): the
      // sparkles are the GEOMETRIC relief lane A sculpts into the cap (mm bumps, 1–5 px each) under a 0.12 film —
      // each bump a tiny mirror of the flame. A 3 s-old cut is not a polished film: serum + clotting blood + torn
      // fibres scatter → roughness ≈ 0.2 on the cut FACE (r4: 0.36 washed the whole disc cream at E4's near-mirror angle) (axial normal, inside the neck radius, in the cut band),
      // plus geometric specular AA (Kaplanyan–Hoffman: α² += 2·|fwidth n|²) so sub-pixel relief never sparkles.
      const nvar = fwidth(normalView).length();
      // fix round 4: on the face start from the BAKED roughness (lumens 0.95 survive via max), satin floor 0.135
      // (planar cap + 2.5 mm smooth dome now: one sharp flame highlight on near-black red, not a broad grey sheen)
      const capR = max(m.roughnessNode, float(0.135));
      const rIn = mix(p.roughnessNode, capR, capK);
      const rAA = rIn.mul(rIn).add(nvar.mul(nvar).mul(2)).sqrt().min(1);
      // fix round 3 LOOK (m6max-03 at the physical stop: the cut = a crumpled gold-foil disc, the brightest thing in frame):
      // on MAX the clearcoat film lobe (roughness 0.12, its own geometric normal) still mirrored the flame off every mm
      // facet of the cap — the base roughness above never reached it. A 3 s-old cut face is serum + clotting blood over
      // torn fibre ends: a SATIN film, not a mirror (the clot's fibrin mesh roughens it within seconds) — film lobe and
      // base ≥ 0.32 on the face (geometric AA kept): the facets merge into one broad wet sheen with the anatomy as colour.
      // fix round 4: the 0.32 satin floor (r3, for the faceted cap) is retired — rAA already carries the 0.135 floor
      p.roughnessNode = rAA;
      const ccAA = float(0.12 * 0.12).add(nvar.mul(nvar).mul(2)).sqrt().min(1);
      // the film lobe follows the face (no clearcoat glint inside a matte 0.95 lumen)
      ccRough = mix(mix(ccAA, max(ccAA, float(0.3)), rimZ.mul(rimF)), max(ccAA, capR.mul(capR).add(nvar.mul(nvar).mul(2)).sqrt().min(1)), capK);
      // r3 (the cap still read as a pale cream disc with red specks = pepperoni): the cut face of a neck is ≈ 85 %
      // muscle / vessels / trachea and only a 3–8 mm subcutaneous fat ring; 3 s after the cut, lying in its own pool,
      // the whole face is under a whole-blood film. Painted fat/cream texels on the FACE (not the stub's skin) are
      // taken to the filmed-tissue colour: albedo × (0.42, 0.06, 0.05) again (≈ 0.1 mm Hb film on fat ≈ 0.1/0.01/0.01).
      // fix round 4 (lane A s2 asked to drop ALL runtime tints on the face; measured r1-06 lamp-side close at 0.6 m: the
      // face then rendered as a pale salmon disc with cream rings ≈ the boards' brightness — the baked atlas texels are
      // the tissue, not the filmed tissue). Exactly ONE whole-blood film on the face: albedo × (0.42, 0.06, 0.05)
      // (Hb absorbs G/B within 0.1 mm; muscle 0.30/0.10/0.08 → 0.13/0.006/0.004, fat 0.4/0.3/0.2 → 0.17/0.018/0.01).
      // The double/triple darkening (cut tint × neck film × this) that made it black under a grey sheen stays retired.
      // r2max-05 (one film: the face dark red, but the carotid walls / fat ring / windpipe still pale pink rings = a salami
      // cross-section): a ≥ 0.2 mm whole-blood film is opaque in G/B and ~1–2 mm deep in red, so on a 3 s-old face lying
      // in its pool the anatomy shows only as faint relief/tone under the blood — 65 % of the face goes to the film's own
      // colour (whole blood 0.11/0.009/0.008, BLOOD_ALBEDO), 35 % keeps the filmed tissue's variation.
      const filmed = p.colorNode.mul(vec3(0.42, 0.06, 0.05));
      p.colorNode = mix(p.colorNode, mix(filmed, vec3(0.11, 0.009, 0.008), 0.65), capK.mul(uNeckBlood));
      // #142c (lead ruling (ao)): BEFORE the cut the two cap faces lie inside the seam the first stroke opened at the nape
      // (docs/C2-ESCAPE.md §2.1 S2: "a dark wet seam, not yet anatomy"); the raw baked tissue rings (pale fat, muscle) at the
      // seam read as an already-severed neck. Whole: clotting whole blood in a 1–2 cm wedge, ≈ 0.035 / 0.006 / 0.005.
      p.colorNode = mix(p.colorNode, vec3(0.035, 0.006, 0.005), capK.mul(float(1).sub(uNeckBlood)));
      // M-A C2 upgrades (ruling z5 item 1; ab1 10.5: the lit face-up face read as a clean pale MANNEQUIN): the head
      // landed face-down on its LEFT cheek in the landing splash (cutscene-fx landPose roll −65°, 15 mL at HEAD_LAND)
      // and the boot rolled it face-up through its pool — the down side of the face (left cheek, temple, the left of
      // the nose/lips/chin) carries a smeared whole-blood film, broken by the skin's relief and streaked along the
      // roll. Bind space (Y up, face +Z, her left +X); contact normal ≈ (0.72, −0.12, 0.68). Film = albedo × (0.42,
      // 0.06, 0.05) (Hb absorbs G/B within 0.1 mm), plasma-wet roughness 0.15. Driven by ada.ts (latched once the
      // severed head has lain loose; cleared when she is whole).
      const nB = normalGeometry;
      const contact = nB.x.mul(0.72).sub(nB.y.mul(0.12)).add(nB.z.mul(0.68));
      // (ab3: a clean half-face of uniform maroon read as a split mask) → the roll drags the film ACROSS the face
      // (streaks ⟂ the crown axis: noise stretched in x/z, fine in y), it is broken by the relief, and its thickness
      // varies (thin smears are translucent red over the skin, thick ones opaque maroon)
      const nS = mx_noise_float(vec3(pg.x.mul(22), pg.y.mul(95), pg.z.mul(22))).mul(0.55).add(mx_noise_float(vec3(pg.x.mul(150), pg.y.mul(150), pg.z.mul(150))).mul(0.2));
      const nT = mx_noise_float(vec3(pg.x.mul(60).add(3.1), pg.y.mul(60), pg.z.mul(60))).mul(0.5).add(0.5);
      const smear = smoothstep(0.3, 0.52, contact.add(nS.mul(0.6))).mul(smoothstep(1.4, 1.43, pg.y)).mul(float(1).sub(smoothstep(0.1, 0.13, pg.x.abs()))).mul(float(1).sub(capK)).mul(uHeadSmear); // the head only (not her bind-pose arms)
      const smearK = smear.mul(mix(float(0.45), float(1), nT));
      p.colorNode = p.colorNode.mul(vec3(1).sub(vec3(0.58, 0.94, 0.95).mul(smearK)));
      p.roughnessNode = mix(p.roughnessNode, float(0.15), smear);
      if (m.normalMap) {
        // the face: lane A moved its ±3 mm relief INTO the normal map — a 0.2 mm film rounds that relief (capillary length
        // 2.4 mm), it does not erase it: flatten the face only × 0.4 (its specular variation is what reads as tissue)
        const flat = max(max(cut, film).mul(float(1).sub(capK)), capK.mul(0.4 / 0.85));
        const ns = m.normalScale ?? new THREE.Vector2(1, 1);
        p.normalNode = normalMap(texture(m.normalMap), vec2(ns.x, ns.y).mul(float(1).sub(flat.mul(0.85))));
      }
      // fix round 2 (ruling i): the lamp-lit boards + the pool under the held head bounce light UP into the face (the
      // head piece only: bind y > 1.40, above the cut). Hemispherical: E(N) = E_up · (1 − N_y) / 2; Lambert → ρ/π.
      const headOnly = smoothstep(1.4, 1.44, pg.y);
      const hemi = float(0.5).sub(normalWorld.y.mul(0.5));
      const fill = p.colorNode.mul(uFaceFill).mul(hemi).mul(headOnly).mul(1 / Math.PI);
      p.emissiveNode = m.emissiveNode ? m.emissiveNode.add(fill) : fill;
    }
    p.normalMap = m.normalMap;
    p.normalScale = m.normalScale;
    p.side = m.side;
    p.lightsNode = m.lightsNode;
    if (presetId === 'max') {
      // the wet film's second lobe: Max only (× ~16 lights per character pixel; Medium keeps the wrap diffuse)
      p.clearcoat = 0.5;
      p.clearcoatRoughness = 0.12;
      if (ccRough) p.clearcoatRoughnessNode = ccRough;
    }
    p.setupLightingModel = function (this: any) {
      return new (SkinLightingModel as any)(this.useClearcoat === true || this.clearcoat > 0, false, false, false, false, false);
    };
    return p;
  }
  // the player's glove only: Harlan's boots/apron are leather_worn too, and MeshPhysical's extra binding pushed his
  // Max fragments to 17 samplers (> the 16 per stage an M1 offers → invalid pipelines, round 3 Max run)
  if (String(ud.material_id) === 'leather_worn' && String(m.name ?? '').startsWith('arms_')) {
    // Round 3 (R2-3): worn glove leather — GGX from the baked roughness (the A channel: worn knuckles smoother)
    // plus the soft grazing sheen of a napped/oiled hide (Charlie lobe), so the back of the hand catches the light
    // at its edges instead of reading as a flat black cut-out.
    const p = new THREE.MeshPhysicalNodeMaterial();
    p.name = m.name;
    p.userData = m.userData;
    // runtime lane E (item 6): the arms atlas paints the gloves at a mean linear albedo of 0.070 / 0.038 / 0.022
    // (scratch/re: brown texels of public/assets/medium/arms_albedo.webp) — 2× material-spec leather_worn
    // (0.035 / 0.022 / 0.015: dark brown driving-glove leather). Under the 2700 K dome, with the eye adapted to the
    // cream cabin, that read as a tanned bare hand (C1 20.5). Calibrated to the spec, like every generated material.
    p.colorNode = m.colorNode ? m.colorNode.mul(vec3(0.035 / 0.0704, 0.022 / 0.0376, 0.015 / 0.0217)).mul(float(1).sub(uGloveWet.mul(0.25))) : m.colorNode;
    // C2-ESCAPE B14: wet leather is smoother (the film fills the grain); floor 0.22 (a wet hide is never a mirror)
    p.roughnessNode = m.roughnessNode ? max(float(0.22), m.roughnessNode.mul(float(1).sub(uGloveWet.mul(0.45)))) : null;
    p.normalMap = m.normalMap;
    p.normalScale = m.normalScale;
    p.metalness = 0;
    p.side = m.side;
    p.lightsNode = m.lightsNode;
    if (presetId === 'max') {
      // R2-2: the Charlie lobe × every character light cost ≈ 1 ms on Medium (arms ≈ 10 % of the screen) — Max only;
      // Medium keeps the GGX from the baked roughness + the room/pool radiance (ArmsEnvNode) for the worn edges
      p.sheen = 1;
      p.sheenColor = new THREE.Color(0.16, 0.14, 0.12);
      p.sheenRoughness = 0.5;
      // B14: the water film on Max (the clearcoat lobe; no extra sampler — no clearcoat maps)
      p.clearcoat = 0.6;
      p.clearcoatRoughness = 0.12;
    }
    if (!p.roughnessNode) p.roughness = 0.55 * (1 - 0.45 * 0.6);
    return p;
  }
  if (String(ud.material_id) === 'nightgown_silt' && presetId !== 'low') {
    // C2-ESCAPE B13: wet-cotton translucency (see GownLightingModel)
    m.setupLightingModel = () => new GownLightingModel();
    return m;
  }
  // Escape fix-round review (art director): the severed head's FACE VEIL. 44 % of ada_hair (the scalp shell and the
  // front veil over the face) is skinned to head_root, so no chain physics can lift it: on the floor (face-up) and in
  // Harlan's fist the face stayed under an opaque hair ball and the head never read as a head (diag
  // scratch/escfix-review d1/d2). Physically, wet hair on a face-up head falls off the face to the boards, and hair
  // gathered in a fist is pulled off the face; so while uHairVeilClear = 1 (ada.ts: severed and not in her own hand)
  // the cards that hang IN FRONT of the face (bind space, Y-up, face +Z: cornea at (−0.03, 1.54, 0.06), head z
  // max 0.089, chin ≈ 1.39, hairline ≈ 1.60) are hashed out; the side curtains framing the cheeks stay.
  if (String(ud.material_id) === 'hair_wet_black' && m.opacityNode) {
    const pg = positionGeometry;
    const front = smoothstep(0.012, 0.035, pg.z);
    const below = float(1).sub(smoothstep(1.585, 1.61, pg.y)).mul(smoothstep(1.34, 1.37, pg.y));
    const across = float(1).sub(smoothstep(0.06, 0.085, pg.x.abs()));
    // (M-A rounds 3–4 tried keeping 30 % / 12 % of the veil as hashed strand bands across the face: bands of a card
    // sheet read as a vertical comb, not hair — dropped; the face smear (uHeadSmear) carries the 'wet, rolled' read)
    const veil = uHairVeilClear.mul(front).mul(below).mul(across);
    m.opacityNode = m.opacityNode.mul(float(1).sub(veil));
    // M-A C2 upgrades (ruling z5 item 1): the cleared cards must leave the lamp's cube too — the shadow pass ignores
    // opacityNode (Renderer._getShadowNodes reads map.a / colorNode.a / maskShadowNode only), so a veil hidden in the
    // view still shadowed the face-up face (10.5: face L 0.006; hair out of the cube 0.057). r186 maskShadowNode:
    // discarded where false.
    m.maskShadowNode = veil.lessThan(0.5);
  }
  if (String(ud.material_id) === 'hair_wet_black' && presetId !== 'low') {
    if (!m.roughnessNode) m.roughness = 0.3; // indirect (probe/env) specular of wet hair (the direct lobes: HAIR)
    m.setupLightingModel = () => new HairLightingModel();
    const base = m.setupVariants;
    m.setupVariants = function (this: any, builder: any) {
      base.call(this, builder);
      hairT.assign(strandTangent());
      hairJ.assign(strandJitter());
    };
  }
  return m;
}

/** Multiply-blended floor occlusion under a standing character (presets without GTAO). */
export class ContactShadow {
  static enabled = !SKIN_OFF;
  readonly mesh: any;
  private readonly feet: any[];
  private readonly pelvis: any | null;
  private readonly uFeet = [uniform(new THREE.Vector3()), uniform(new THREE.Vector3())];
  private readonly uPelvis = uniform(new THREE.Vector3());
  private readonly uGround = uniform(0);
  private readonly tmp = new THREE.Vector3();
  private readonly root: any;

  constructor(root: any, feet: any[], pelvis: any | null) {
    this.root = root;
    this.feet = feet;
    this.pelvis = pelvis;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.ZeroFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.fog = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    const pw = vec2(positionWorld.x, positionWorld.z);
    let occ: any = float(0);
    for (const f of this.uFeet) {
      const d = pw.sub(vec2(f.x, f.z)).length();
      const lift = smoothstep(0.03, 0.45, f.y.sub(this.uGround));
      occ = occ.add(float(1).sub(smoothstep(0.0, 0.3, d)).mul(float(1).sub(lift)).mul(0.6));
    }
    const dp = pw.sub(vec2(this.uPelvis.x, this.uPelvis.z)).length();
    occ = occ.add(float(1).sub(smoothstep(0.05, 0.55, dp)).mul(0.25));
    m.colorNode = vec3(float(1).sub(max(occ, 0).min(0.6)));
    const g = new THREE.PlaneGeometry(1.4, 1.4);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'contact-shadow';
    this.mesh.renderOrder = 4;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    // a child of the character's root group: it shares her visibility (culling, cutscene hides) and her feet origin
    this.mesh.position.set(0, 0.004, 0);
    this.mesh.visible = ContactShadow.enabled;
    root.add(this.mesh);
  }

  update(): void {
    this.mesh.visible = ContactShadow.enabled;
    if (!ContactShadow.enabled || !this.root.visible) return;
    this.root.getWorldPosition(this.tmp);
    this.uGround.value = this.tmp.y;
    for (let i = 0; i < this.uFeet.length; i++) this.feet[i]?.getWorldPosition(this.uFeet[i].value);
    if (this.pelvis) this.pelvis.getWorldPosition(this.uPelvis.value);
    else this.uPelvis.value.copy(this.tmp);
  }
}
