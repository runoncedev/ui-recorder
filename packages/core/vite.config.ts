import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // No vaciar dist/ en cada rebuild del --watch: ahí viven los .d.ts que emite tsc.
    // El build completo lo limpia con `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
  },
})
