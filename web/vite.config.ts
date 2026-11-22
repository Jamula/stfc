import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:7071',
    changeOrigin: true,
  },
};

export default defineConfig({
  base: '/',
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    outDir: 'dist',
    target: 'es2022',
    minify: 'esbuild',
    emptyOutDir: true,
    // No inline scripts — required by CSP (no 'unsafe-inline')
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Keep Lit runtime in a separate chunk so browsers can cache it
        manualChunks: (id) => {
          if (id.includes('node_modules/lit') || id.includes('node_modules/@lit')) {
            return 'lit';
          }
        },
      },
    },
  },
});
