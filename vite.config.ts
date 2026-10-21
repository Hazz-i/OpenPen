import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  // `vite preview` otherwise inherits the dev proxy and turns a missing
  // optional backend into noisy 500s. Static preview stays fully offline.
  preview: {
    proxy: {},
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
