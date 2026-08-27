import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        // `electron` must stay external. It is not a library: the npm package is a shim whose
        // module.exports is the path to the binary, and bundling it drags in a spawnSync of
        // install.js that fails at runtime with a misleading "Electron failed to install".
        // Node builtins stay external for the same reason - the main process is a Node process.
        external: ['electron', /^node:/],
      },
    },
  },
  preload: {
    build: {
      lib: { entry: 'src/preload/index.ts', formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
  },
});
