import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // Do not empty dist/ on every --watch rebuild: the .d.ts files emitted by tsc live there.
    // The full build cleans it with `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
  },
})
