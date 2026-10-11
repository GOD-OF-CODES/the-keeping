// PERF G fix round 4 (#132, the Max B05 hand-back major GC): allocation-free uniform update ranges.
//
// Measured (scratch/pgr5/allocp.mjs: allocation sampling over C2 → C2c → B05 on Max with minor-GC garbage EXCLUDED, i.e.
// what survives scavenges and fills the old generation): 110 of 122 MB came from three r186's per-frame uniform update
// ranges — UniformsGroup.addUniformUpdateRange (three.webgpu.js ≈ 66085) adds every changed uniform's index to a Set
// `_addedIndices` that clearUpdateRanges() clears after each upload (73.7 MB: V8's Set.clear/add re-allocate the hash
// table every frame, for thousands of groups), and pushes into `updateRanges`, an Array emptied with `length = 0` (V8
// drops the backing store; the next push re-allocates it — 35.8 MB). Those tables are reachable from long-lived groups
// when a scavenge runs, so they are promoted: ≈ 3 MB/s of old-generation growth → a ~0.4 s major GC every ≈ 36 s on a
// 1.1–1.4 GB heap, which lands on the C2c → B05 hand-back on Max.
//
// The patch keeps three's exact semantics and range order: a range is added once per upload generation (a counter
// bumped by clearUpdateRanges replaces the Set), and the group's `updateRanges` becomes a RangeList — an array-like that
// keeps its storage across clears and always reads `undefined` one past its end (three's WebGPU/WebGL updateBinding read
// `updateRanges[i + 1]` to merge contiguous ranges). Readers only use `.length`, `[i]` and `.push` (verified against
// node_modules/three/build/three.webgpu.js r186: lines ≈ 33705, 34017, 66104, 75936–76017, 84865–84915).

/** Array-like of update ranges that never releases its storage; `this[length]` is always undefined. */
export class RangeList {
  [i: number]: any;
  private n = 0;
  constructor() {
    this[0] = undefined;
  }
  get length(): number {
    return this.n;
  }
  set length(v: number) {
    // only ever cleared (three sets 0); a general shrink also clears the slot past the end
    this.n = v;
    this[v] = undefined;
  }
  push(...items: any[]): number {
    for (let i = 0; i < items.length; i++) this[this.n++] = items[i];
    this[this.n] = undefined;
    return this.n;
  }
  *[Symbol.iterator](): Iterator<any> {
    for (let i = 0; i < this.n; i++) yield this[i];
  }
}

/** Finds three's (webgpu) UniformsGroup prototype from a live render object's bindings and patches it once.
 *  Returns 'patched' | 'already' | 'not-found' (three internals moved: nothing is changed). `?urpatch=0` disables it. */
export function installUniformRangePatch(renderer: any): string {
  try {
    if (new URLSearchParams(location.search).get('urpatch') === '0') return 'disabled';
  } catch {
    /* no location (tests) */
  }
  const set = renderer?._objects?._renderObjects as Set<any> | undefined;
  if (!(set instanceof Set)) return 'not-found';
  let proto: any = null;
  for (const ro of set) {
    const groups = ro?._bindings;
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const b of g?.bindings ?? []) {
        if (typeof b?.addUniformUpdateRange !== 'function' || !(b._updateRangeCache instanceof Map) || !(b._addedIndices instanceof Set)) continue;
        let p = Object.getPrototypeOf(b);
        while (p && !Object.prototype.hasOwnProperty.call(p, 'addUniformUpdateRange')) p = Object.getPrototypeOf(p);
        if (p) proto = p;
        break;
      }
      if (proto) break;
    }
    if (proto) break;
  }
  if (!proto) return 'not-found';
  if (proto.__rangePatch) return 'already';
  const baseClear = Object.getPrototypeOf(proto)?.clearUpdateRanges; // Buffer/UniformBuffer: updateRanges.length = 0
  if (typeof baseClear !== 'function' || !Object.prototype.hasOwnProperty.call(proto, 'clearUpdateRanges')) return 'not-found';
  proto.__rangePatch = true;
  proto.addUniformUpdateRange = function (this: any, uniform: any): void {
    const index = uniform.index;
    let range = this._updateRangeCache.get(index);
    if (range === undefined) {
      range = { start: 0, count: 0, gen: -1 };
      this._updateRangeCache.set(index, range);
    }
    const gen = this.__rangeGen | 0;
    if (range.gen === gen) return; // already queued in this upload (was: _addedIndices.has)
    range.gen = gen;
    range.start = uniform.offset;
    range.count = uniform.itemSize;
    let list = this._updateRanges;
    if (!(list instanceof RangeList)) {
      const old = list;
      list = this._updateRanges = new RangeList();
      if (old && old.length) list.push(...old);
    }
    list.push(range);
  };
  proto.clearUpdateRanges = function (this: any): void {
    this.__rangeGen = (this.__rangeGen | 0) + 1;
    baseClear.call(this);
  };
  return 'patched';
}
