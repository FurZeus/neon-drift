import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5195, strictPort: true },
  preview: { port: 5196 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
