// PERF #132 (fix round 4): the allocation-free uniform update ranges must queue exactly what three r186's
// UniformsGroup.addUniformUpdateRange / clearUpdateRanges queue (same ranges, same order, once per upload), and the
// RangeList must read undefined one past its end (three merges contiguous ranges by reading updateRanges[i + 1]).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { RangeList, installUniformRangePatch } from '../src/render/uniform-ranges.ts';

// mirrors of three.webgpu.js r186 Buffer (≈ 65780) and UniformsGroup (≈ 66085) — the code paths the patch replaces
function makeClasses() {
  class Buffer {
    _updateRanges: any = [];
    get updateRanges() {
      return this._updateRanges;
    }
    addUpdateRange(start: number, count: number) {
      this.updateRanges.push({ start, count });
    }
    clearUpdateRanges() {
      this.updateRanges.length = 0;
    }
  }
  class UniformBuffer extends Buffer {}
  class UniformsGroup extends UniformBuffer {
    _updateRangeCache = new Map();
    _addedIndices = new Set();
    addUniformUpdateRange(uniform: any) {
      const index = uniform.index;
      if (this._addedIndices.has(index)) return;
      let range = this._updateRangeCache.get(index);
      if (range === undefined) {
        range = { start: 0, count: 0 };
        this._updateRangeCache.set(index, range);
      }
      range.start = uniform.offset;
      range.count = uniform.itemSize;
      this._addedIndices.add(index);
      this.updateRanges.push(range);
    }
    clearUpdateRanges() {
      this._addedIndices.clear();
      super.clearUpdateRanges();
    }
  }
  class NodeUniformsGroup extends UniformsGroup {}
  return NodeUniformsGroup;
}

const snap = (l: any) => {
  const a: string[] = [];
  for (let i = 0; i < l.length; i++) a.push(`${l[i].start}+${l[i].count}`);
  return a.join(',') + '|' + String(l[l.length]);
};

test('RangeList: length, index, push, clear, past-the-end undefined, iteration', () => {
  const l = new RangeList();
  assert.equal(l.length, 0);
  assert.equal(l[0], undefined);
  l.push({ start: 1, count: 2 }, { start: 3, count: 1 });
  assert.equal(l.length, 2);
  assert.equal(l[1].start, 3);
  assert.equal(l[2], undefined);
  l.length = 0;
  assert.equal(l[0], undefined);
  l.push({ start: 9, count: 4 });
  assert.equal(l[0].start, 9);
  assert.equal(l[1], undefined);
  assert.deepEqual([...l].map((r: any) => r.start), [9]);
});

test('patched UniformsGroup queues the same ranges in the same order as three r186', () => {
  const Ref = makeClasses();
  const Pat = makeClasses();
  const ref = new Ref();
  const pat = new Pat();
  const fake = { _objects: { _renderObjects: new Set([{ _bindings: [{ bindings: [pat] }] }]) } };
  assert.equal(installUniformRangePatch(fake), 'patched');
  assert.equal(installUniformRangePatch(fake), 'already');
  let s = 12345;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const uniforms = Array.from({ length: 24 }, (_, i) => ({ index: i, offset: i * 4, itemSize: 1 + (i % 4) }));
  for (let frame = 0; frame < 300; frame++) {
    const n = Math.floor(r() * 40);
    for (let k = 0; k < n; k++) {
      const u = uniforms[Math.floor(r() * uniforms.length)];
      if (r() < 0.05) u.offset = Math.floor(r() * 96); // a re-layout
      ref.addUniformUpdateRange(u);
      pat.addUniformUpdateRange(u);
      if (r() < 0.02) {
        ref.addUpdateRange(7, 3);
        pat.addUpdateRange(7, 3);
      }
    }
    assert.equal(snap(pat.updateRanges).split('|')[0], snap(ref.updateRanges).split('|')[0], `frame ${frame}`);
    assert.equal(pat.updateRanges[pat.updateRanges.length], undefined);
    if (pat.updateRanges.length > 0 || r() < 0.5) {
      ref.clearUpdateRanges();
      pat.clearUpdateRanges();
    }
  }
  assert.ok(pat.updateRanges instanceof RangeList);
});
