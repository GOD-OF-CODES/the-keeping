import { defineConfig } from 'vite';

// The boot entry (index.html → src/boot/main.ts) must never statically import three.js or game code.
// Game code is reached only through a dynamic import() after the player picks a graphics preset,
// so nothing but the boot chunk downloads before that choice. scripts/verify-boot.mjs asserts this.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    modulePreload: {
      // Never let the HTML preload anything but the boot chunk itself.
      resolveDependencies: (_file, deps, ctx) => (ctx.hostType === 'html' ? [] : deps),
    },
  },
  assetsInclude: ['**/*.glb', '**/*.exr'],
  resolve: {
    // three/addons (GLTFLoader, Octree, Capsule …) import the bare 'three' specifier. Map it onto the WebGPU build
    // so the game ships ONE copy of three (three.webgpu.js re-exports every core class those addons use).
    // Anchored: 'three/tsl', 'three/webgpu' and 'three/addons/*' are untouched.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
});
