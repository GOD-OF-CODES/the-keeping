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
});
