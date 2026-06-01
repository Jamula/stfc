#!/usr/bin/env node
/**
 * Bundle-budget gate: verifies that the sum of all gzipped JS files in
 * web/dist/ does not exceed the budget in web/bundle-budget.json.
 *
 * Excludes web/dist/rag-index.json (Phase 6 RAG index — excluded by spec).
 *
 * Exit 0 — under budget.
 * Exit 1 — over budget (prints per-file breakdown).
 */

import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = process.env['BUNDLE_BUDGET_DIST_DIR'] ?? join(ROOT, 'web', 'dist');
const BUDGET_FILE = process.env['BUNDLE_BUDGET_FILE'] ?? join(ROOT, 'web', 'bundle-budget.json');

/** Measure the gzipped byte length of a file without writing to disk. */
async function gzippedSize(filePath) {
  let total = 0;
  const counter = new Writable({
    write(chunk, _enc, cb) {
      total += chunk.length;
      cb();
    },
  });
  await pipeline(createReadStream(filePath), createGzip({ level: 9 }), counter);
  return total;
}

/** Recursively collect all .js files under a directory. */
async function collectJsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  const budget = JSON.parse(await readFile(BUDGET_FILE, 'utf8'));
  const maxBytes = budget.max_gzipped_js_bytes;

  try {
    await stat(DIST_DIR);
  } catch {
    console.error(`[bundle-budget] ERROR: ${DIST_DIR} not found. Run 'npm run build:web' first.`);
    process.exit(1);
  }

  const jsPaths = await collectJsFiles(DIST_DIR);

  /** @type {{ file: string; bytes: number }[]} */
  const measured = [];
  for (const filePath of jsPaths) {
    const relName = filePath.slice(DIST_DIR.length + 1);
    const bytes = await gzippedSize(filePath);
    measured.push({ file: relName, bytes });
  }

  const total = measured.reduce((sum, r) => sum + r.bytes, 0);

  // Pretty-print breakdown
  const pad = (s, n) => s.padEnd(n);
  const fmt = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(10);

  console.log('\n[bundle-budget] Gzipped JS breakdown:');
  console.log(`  ${'File'.padEnd(50)} ${'Gzipped'.padStart(10)}`);
  console.log(`  ${'-'.repeat(62)}`);
  for (const r of measured.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`  ${pad(r.file, 50)} ${fmt(r.bytes)}`);
  }
  console.log(`  ${'-'.repeat(62)}`);
  console.log(`  ${'TOTAL'.padEnd(50)} ${fmt(total)}`);
  console.log(`  ${'BUDGET'.padEnd(50)} ${fmt(maxBytes)}`);

  if (total > maxBytes) {
    console.error(`\n[bundle-budget] ❌ FAIL — ${(total / 1024).toFixed(1)} KB > ${(maxBytes / 1024).toFixed(0)} KB budget`);
    process.exit(1);
  }

  console.log(`\n[bundle-budget] ✅ PASS — ${(total / 1024).toFixed(1)} KB ≤ ${(maxBytes / 1024).toFixed(0)} KB budget`);
}

main().catch((err) => {
  console.error('[bundle-budget] Fatal:', err);
  process.exit(1);
});
