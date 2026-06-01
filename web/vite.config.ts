import { defineConfig } from 'vite';

// Populated by Wave 3 (Scotty, issue #119).
// Minimal config — output to dist/ which swa-deploy.yml reads via output_location: dist.
export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    emptyOutDir: true,
  },
});
