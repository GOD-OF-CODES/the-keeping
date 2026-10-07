// Overlay input blocking (src/core/input.ts): while the journal / a reading page / the pause menu is open, gameplay
// sees no keys, no mouse look and no presses, and a key pressed under the overlay stays swallowed until released —
// ← / → turning journal pages must never strafe. Runs on a stub DOM (EventTarget document/window).

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

export {};

const g = globalThis as any;
const doc = new EventTarget() as any;
doc.pointerLockElement = null;
g.document ??= doc;
g.window ??= new EventTarget();
const { Input } = await import('../src/core/input.ts');

const target = {} as any;
const fire = (type: string, props: Record<string, unknown>) => g.document.dispatchEvent(Object.assign(new Event(type), props));
const key = (type: 'keydown' | 'keyup', code: string) => fire(type, { code, repeat: false });

test('input: an open overlay blocks movement, look and presses; keys pressed under it stay swallowed until released', () => {
  const input = new Input(target);
  let journal = false;
  const off = input.addBlocker(() => journal);
  input.locked = true;

  // plain gameplay
  key('keydown', 'KeyD');
  assert.ok(input.isDown('KeyD') && input.wasPressed('KeyD'));
  key('keyup', 'KeyD');
  input.endFrame();

  // W held when the journal opens: no walking under it
  key('keydown', 'KeyW');
  input.endFrame();
  journal = true;
  assert.ok(input.blocked);
  assert.ok(!input.isDown('KeyW'), 'movement blocked under the overlay');

  // ← turns a page: the overlay sees the press, gameplay never does
  key('keydown', 'ArrowLeft');
  assert.ok(input.uiPressed('ArrowLeft'), 'the overlay reads its key');
  assert.ok(!input.isDown('ArrowLeft') && !input.wasPressed('ArrowLeft'), 'no strafe');
  key('keydown', 'KeyE');
  assert.ok(!input.wasPressed('KeyE'), 'no interaction behind the page');
  journal = false; // the overlay closes mid-frame (E / Tab): later gameplay this frame must not see that press
  assert.ok(!input.wasPressed('KeyE') && input.uiPressed('KeyE'), 'the closing press is not an interaction');
  journal = true;

  // mouse look is drained, not deferred
  fire('mousemove', { movementX: 40, movementY: -12 });
  assert.deepEqual(input.consumeMouse(), { dx: 0, dy: 0 });
  input.endFrame();

  // close the journal with ← still held: still no strafe until it is released and pressed again
  journal = false;
  assert.ok(!input.blocked);
  assert.ok(!input.isDown('ArrowLeft'), 'the page-turn key stays consumed after closing');
  assert.ok(input.isDown('KeyW'), 'a key held from before the overlay acts again');
  assert.deepEqual(input.consumeMouse(), { dx: 0, dy: 0 }, 'no look jump from motion under the overlay');
  key('keyup', 'ArrowLeft');
  key('keydown', 'ArrowLeft');
  assert.ok(input.isDown('ArrowLeft'), 'a fresh press strafes again');

  // mouse buttons pressed under an overlay (RMB raises the locket) are swallowed the same way
  journal = true;
  fire('mousedown', { button: 2 });
  journal = false;
  assert.ok(!input.isDown('Mouse2'));
  fire('mouseup', { button: 2 });
  fire('mousedown', { button: 2 });
  assert.ok(input.isDown('Mouse2'));

  off();
  input.dispose();
});

test('input: several blockers (journal, page, pause) — blocked while any is open', () => {
  const input = new Input(target);
  let page = false;
  let paused = false;
  input.addBlocker(() => page);
  const offPause = input.addBlocker(() => paused);
  assert.ok(!input.blocked);
  page = true;
  assert.ok(input.blocked);
  page = false;
  paused = true;
  assert.ok(input.blocked);
  offPause();
  assert.ok(!input.blocked, 'a removed blocker no longer blocks');
  input.dispose();
});
