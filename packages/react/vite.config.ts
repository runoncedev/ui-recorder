import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // No vaciar dist/ en cada rebuild del --watch: ahí viven los .d.ts que emite tsc.
    // El build completo lo limpia con `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // Todo afuera: react lo pone la app anfitriona y ui es una dependencia.
      external: ['react', 'react/jsx-runtime', '@ui-recorder/ui'],
    },
  },
})
