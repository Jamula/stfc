import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react-swc';
import { defineConfig, PluginOption } from 'vite';
import { resolve } from 'path';
import createIconImportProxy from "@github/spark/vitePhosphorIconProxyPlugin";

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    createIconImportProxy() as PluginOption,
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, './src'),
    },
  },
  build: {
    outDir: 'extension/dist',
    rollupOptions: {
      input: {
        popup: resolve(projectRoot, 'extension/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'popup.css') {
            return 'popup.css';
          }
          return '[name].[ext]';
        }
      }
    }
  }
});
