import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
  build: { outDir: 'dist/renderer' },
});
