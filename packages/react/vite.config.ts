import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // Do not empty dist/ on every --watch rebuild: the .d.ts files emitted by tsc live there.
    // The full build cleans it with `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // Everything outside: react is provided by the host app and ui is a dependency.
      external: ['react', 'react/jsx-runtime', '@ui-recorder/ui'],
    },
  },
})
