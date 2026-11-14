import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/',
  publicDir: fileURLToPath(new URL('./pwa-demo/public', import.meta.url)),
  build: {
    outDir: 'dist-demo',
    target: 'es2022',
    rollupOptions: {
      input: fileURLToPath(new URL('./pwa-demo/index.html', import.meta.url)),
    },
  },
});
