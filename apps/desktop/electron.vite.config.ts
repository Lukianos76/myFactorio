import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts' } },
      // Workspace packages are consumed as source (ADR-0004), so they are bundled, not externalised.
      commonjsOptions: { include: [/node_modules/] },
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
