import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // React va empaquetado adentro (no está en `external`). En modo librería Vite
  // no reemplaza esto solo, y sin el reemplazo React se queda con el build de desarrollo.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // No vaciar dist/ en cada rebuild del --watch: ahí viven los .d.ts que emite tsc.
    // El build completo lo limpia con `rm -rf dist`.
    emptyOutDir: false,
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // Una sola copia del store: core se pide como dependencia, no se empaqueta.
      external: ['@ui-recorder/core'],
    },
  },
})
