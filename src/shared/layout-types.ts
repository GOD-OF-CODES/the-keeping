// Schema of src/shared/level-layout.json — the single source of truth for the house.
// Consumers: blender/house/*.py (geometry, UV2, lightmaps, collision export), src/world (level binding,
// culling, interactables), src/ai (node graph, hearing), src/audio (reverb, occlusion), src/cutscenes.
// All coordinates are PLAN space (metres, Z-up, x=east, y=north) — see src/shared/coords.ts.
// Rect = [x0, y0, x1, y1] with x0 < x1 and y0 < y1.

export type Rect = [number, number, number, number];
export type P2 = [number, number];
export type P3 = [number, number, number];

export type FloorId = 'exterior' | 'ground' | 'upper' | 'car';

export interface LevelLayout {
  version: 1;
  meta: { title: string; date: string; notes: string[] };
  floors: FloorDef[];
  rooms: RoomDef[];
  walls: WallDef[];
  doors: DoorDef[];
  stairs: StairDef[];
  roof: RoofDef;
  props: PropPlacement[];
  hides: HideDef[];
  lights: LightDef[];
  surfaces: SurfaceZone[];
  creakers: Creaker[];
  roomLinks: RoomLink[];
  aiNodes: AiNode[];
  aiEdges: AiEdge[];
  cameras: FixedCamera[];
  spawns: SpawnPoint[];
  triggers: TriggerVolume[];
  atlases: LightmapAtlasDef[];
}

export interface FloorDef {
  id: FloorId;
  /** Elevation of the finished floor surface (m). Exterior grade is 0. */
  elevation: number;
  /** Structural slab thickness under this floor (m). */
  slabThickness: number;
}

export type AcousticSurface =
  | 'runner' | 'bare_wood' | 'porch_wood' | 'stair_wood' | 'tile' | 'linoleum'
  | 'gravel' | 'mud' | 'asphalt' | 'grass' | 'carpet' | 'car';

export interface RoomDef {
  id: string; // e.g. 'EXT1', 'EXT2', 'G1', 'G2', 'G3', 'G3P' (back passage), 'U1'…'U4', 'CLOSET', 'CAR'
  name: string;
  floor: FloorId;
  kind: 'interior' | 'exterior' | 'set';
  /** Clear interior rectangle (walls sit outside it). Exterior rooms: the walkable/visible area. */
  rect: Rect;
  /** Clear ceiling height above the room's floor elevation (interior only). */
  ceiling: number;
  floorMat: string;
  wallMat: string;
  ceilingMat: string;
  trimMat: string;
  wainscot?: { height: number; mat: string };
  /** Holes cut in this room's floor / ceiling (stairwells, the parlor floor grate). */
  floorHoles: Rect[];
  ceilingHoles: Rect[];
  /** Procedural convolution-reverb parameters. */
  reverb: { size: number; damping: number; wet: number };
  /** Rooms whose geometry must be visible from inside this one (culling). Include self. */
  visibleRooms: string[];
  /** Lightmap atlas this room's static geometry bakes into. */
  atlas: string;
  /** false = never free-roamed (e.g. the parlor, seen only from fixed cameras). */
  playable: boolean;
  milestone: 'M1' | 'M2';
}

export type WallSideRef = string | 'exterior' | 'void';

export interface WallDef {
  id: string;
  floor: FloorId;
  /** Centre-line endpoints in plan xy. */
  a: P2;
  b: P2;
  /** Base z (usually the floor elevation) and height of the wall. */
  base: number;
  height: number;
  thickness: number;
  /** Room on the LEFT of a→b (looking from a toward b) and on the RIGHT. */
  left: WallSideRef;
  right: WallSideRef;
  leftMat: string;
  rightMat: string;
  openings: WallOpening[];
  /** Exterior clapboard facade detail level. 'hero' = the front facade and porch; 'fog' = dissolves into fog. */
  facadeDetail?: 'hero' | 'fog';
}

export interface WallOpening {
  id: string;
  kind: 'door' | 'window' | 'arch' | 'passthrough';
  /** Distance from wall point a to the opening's centre, along a→b (m). */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the opening above the wall base (0 for doors). */
  sill: number;
  doorId?: string;
  window?: {
    state: 'nailed' | 'shuttered' | 'nailed_shuttered' | 'clear';
    sashes: 1 | 2;
    broken: boolean;
    /** Emits sky light during lightning bakes / flashes. */
    skyPortal: boolean;
  };
}

export type DoorStyle =
  | 'front' // rope-bolted front door with fanlight, knocker, bell-pull knob
  | 'panel' // ordinary 4-panel interior door
  | 'boarded' // Ada's door: panel door + 3 nailed planks
  | 'passage_bolted' // hall ↔ back passage, bolt on the passage side
  | 'closet' // under-stair closet slatted door
  | 'wardrobe_back'; // loose back boards of Ada's wardrobe → servants' stair

export interface DoorDef {
  id: string;
  openingId: string;
  style: DoorStyle;
  /** Hinge side as seen from the room the leaf swings into. */
  hinge: 'left' | 'right';
  swingInto: string;
  initial: 'closed' | 'ajar' | 'open' | 'locked' | 'bolted' | 'boarded';
  /** Story flag that unlocks it (see src/story). Absent = never locked. */
  unlockFlag?: string;
  interactive: boolean;
}

export interface StairDef {
  id: string;
  from: FloorId;
  to: FloorId;
  /** Plan xy of the centre of the first riser's nosing line. */
  start: P2;
  direction: 'N' | 'S' | 'E' | 'W';
  width: number;
  risers: number;
  riserHeight: number;
  treadDepth: number;
  winder?: { atStep: number; turn: 'left' | 'right' };
  balustrade: 'left' | 'right' | 'both' | 'none';
  enclosed: boolean;
  /** 1-based step indices that creak loudly. */
  creakySteps: number[];
  rooms: string[];
}

export interface RoofDef {
  kind: 'gable';
  ridgeAxis: 'x' | 'y';
  eaveZ: number;
  ridgeZ: number;
  overhang: number;
  mat: string;
  chimney?: { pos: P2; size: P2; top: number; mat: string };
}

export interface PropPlacement {
  id: string;
  /** Generator id in blender/props (and a runtime binding if dynamic), e.g. 'armoire', 'rocking_chair'. */
  type: string;
  room: string;
  /** Plan xyz of the prop's base centre. */
  pos: P3;
  /** Radians CCW about +z. Convention: every generator builds its prop with its FRONT facing -y (south) at yaw 0. */
  yaw: number;
  params?: Record<string, number | string | boolean>;
  /** 'static' bakes into the lightmap; 'dynamic' is probe-lit (doors, items you take, characters' props). */
  lighting: 'static' | 'dynamic';
  collider: 'box' | 'mesh' | 'none';
  /** Interaction id wired in src/world/interactables.ts, if any. */
  interaction?: string;
  milestone: 'M1' | 'M2';
}

export interface HideDef {
  id: string;
  propId: string;
  room: string;
  kind: 'armoire' | 'wardrobe' | 'closet';
  /** Where the player stands to enter, and the in-hide eye position looking out through the slats. */
  entry: P3;
  eye: P3;
  eyeYaw: number;
  unfailable?: boolean;
}

export interface LightDef {
  id: string;
  room: string;
  role: 'candle' | 'lamp' | 'lantern' | 'moon' | 'sky' | 'lightning' | 'headlight' | 'dashboard' | 'flame' | 'other';
  type: 'point' | 'spot' | 'area' | 'sun';
  pos: P3;
  target?: P3;
  /** Blender power in watts. Runtime intensity (candela-like) = watts / (4π) — see plan §2.1. */
  watts: number;
  kelvin: number;
  radius: number;
  /** How the light is realised: baked into the base lightmap, into the lightning-flash lightmap, runtime only, or baked + small runtime flicker light. */
  mode: 'bake' | 'flash' | 'runtime' | 'bake_flicker';
}

export interface SurfaceZone {
  room: string;
  rect: Rect;
  surface: AcousticSurface;
}

export interface Creaker {
  id: string;
  room: string;
  pos: P2;
  radius: number;
}

/** Sound / hearing graph between rooms. attenuation multiplies noise radius (closed door 0.5, floor 0.4, open 1). */
export interface RoomLink {
  a: string;
  b: string;
  via: 'door' | 'arch' | 'stairwell' | 'floor' | 'grate' | 'wall';
  doorId?: string;
  /** Multiplier when the link is 'closed' (doors) or always (floors, walls). */
  attenuation: number;
  /** Multiplier when the door is open. */
  openAttenuation?: number;
}

export type AiNodeTag = 'vigil' | 'look' | 'patrol' | 'door' | 'stair' | 'hide_check' | 'lure' | 'anchor' | 'window';

export interface AiNode {
  id: string;
  room: string;
  pos: P3;
  tags: AiNodeTag[];
  lookYaw?: number;
}

export interface AiEdge {
  a: string;
  b: string;
  kind: 'walk' | 'door' | 'stair';
  doorId?: string;
  stairId?: string;
  /** Named patrol loops this edge belongs to, e.g. 'upper', 'ground_finale'. */
  loops: string[];
}

export interface FixedCamera {
  id: string; // e.g. 'parlor_threshold', 'parlor_wide', 'parlor_grate', 'porch_approach'
  pos: P3;
  target: P3;
  fovDeg: number;
  note: string;
}

export interface SpawnPoint {
  id: string; // 'CP1'…'CP8', 'debug_*'
  room: string;
  pos: P3; // eye position
  yaw: number;
  pitch: number;
  note: string;
}

export interface TriggerVolume {
  id: string;
  room: string;
  rect: Rect;
  zMin: number;
  zMax: number;
  /** Story event fired on enter, e.g. 'b03:threshold'. */
  event: string;
}

export interface LightmapAtlasDef {
  id: string;
  rooms: string[];
  /** Resolution of the Max-tier bake; lower tiers are downsampled. */
  maxResolution: 1024 | 2048 | 4096;
  flash: boolean;
}
