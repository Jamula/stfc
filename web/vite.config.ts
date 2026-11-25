import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

function publishDocumentation(): Plugin {
  const docsRoot = fileURLToPath(new URL("../docs/", import.meta.url));
  return {
    name: "publish-documentation",
    apply: "build",
    async generateBundle() {
      const files: string[] = [];
      async function visit(relative: string): Promise<void> {
        const entries = await readdir(join(docsRoot, relative), { withFileTypes: true });
        for (const entry of entries) {
          const next = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isSymbolicLink()) throw new Error(`Documentation symlink is not supported: ${next}`);
          if (entry.isDirectory()) await visit(next);
          else if (entry.isFile() && entry.name.endsWith(".md")) files.push(next);
        }
      }

      await visit("");
      files.sort();
      for (const file of files) {
        this.emitFile({ type: "asset", fileName: `docs/${file}`, source: await readFile(join(docsRoot, file)) });
      }
      const links = files.map((file) => {
        const href = file.split("/").map(encodeURIComponent).join("/");
        const label = file.replace(/[&<>"']/g, (char) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
        );
        return `<li><a href="/docs/${href}">${label}</a></li>`;
      });
      this.emitFile({
        type: "asset",
        fileName: "docs/index.html",
        source: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Documentation</title></head><body><h1>Documentation</h1><ul>${links.join("")}</ul></body></html>`,
      });
      this.emitFile({
        type: "asset",
        fileName: "staticwebapp.config.json",
        source: await readFile(fileURLToPath(new URL("../staticwebapp.config.json", import.meta.url))),
      });
    },
  };
}

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:7071",
    changeOrigin: true,
  },
};

export default defineConfig({
  base: "/",
  plugins: [publishDocumentation()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    outDir: "dist",
    target: "es2022",
    minify: "esbuild",
    emptyOutDir: true,
    // No inline scripts — required by CSP (no 'unsafe-inline')
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Keep Lit runtime in a separate chunk so browsers can cache it
        manualChunks: (id) => {
          if (id.includes("node_modules/lit") || id.includes("node_modules/@lit")) {
            return "lit";
          }
        },
      },
    },
  },
});
