import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
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
