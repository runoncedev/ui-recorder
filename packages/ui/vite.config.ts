import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // React is bundled inside (it is not in `external`). In library mode Vite does not
  // replace this by itself, and without the replacement React keeps its development build.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // Do not empty dist/ on every --watch rebuild: the .d.ts files emitted by tsc live there.
    // The full build cleans it with `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // A single copy of the store: core is requested as a dependency, it is not bundled.
      external: ['@ui-recorder/core'],
    },
  },
})
