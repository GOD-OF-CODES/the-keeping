// three@0.186.1 ships no TypeScript declarations and the project allows no extra npm packages
// (no @types/three), so three's entry points are typed as `any`. Verify APIs against the sources in
// node_modules/three (src/, examples/jsm/) — they are the ground truth for r186.
declare module 'three';
declare module 'three/webgpu';
declare module 'three/tsl';
declare module 'three/addons/*';
declare module 'three/examples/jsm/*';
