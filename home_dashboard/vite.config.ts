import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the UI works under Home Assistant's ingress path.
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { proxy: { '/api': 'http://localhost:8099' } },
});
