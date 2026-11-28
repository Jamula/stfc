import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCache,
  createHashedEmbedder,
  loadInputs,
  readCache,
} from "../../src/crew/knowledge.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.join(root, "docs", "stfc-knowledge", "community-reference-sheet");
const source = "https://docs.google.com/spreadsheets/d/19gxHFoje5GGRWSmE9BtSp97j_zOnMY4jBP9gFr1zi90/edit";
const tabs = [
  ["01-intro.md", "1563749702"],
  ["02-sf-academy-building.md", "556376347"],
  ["03-refinery.md", "508132113"],
  ["04-athena.md", "1243592063"],
  ["05-duo-wave-defense.md", "119341188"],
  ["06-system-map.md", "1549666316"],
  ["07-credit-calculator.md", "744753634"],
  ["08-crews-academy-drones.md", "1770071728"],
  ["09-independent-archives-m91.md", "1778790882"],
  ["10-g5-scrapping-guide.md", "1369248894"],
  ["11-critical-damage-mitigation.md", "1179953085"],
] as const;

async function snapshot() {
  return Promise.all((await readdir(directory)).sort().map(async (name) => [
    name,
    await readFile(path.join(directory, name), "utf8"),
  ]));
}

describe("community sheet source links (#402)", () => {
  it("preserves every former tab path and its original gid without redistributed data", async () => {
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["README.md", ...tabs.map(([file]) => file)].sort(),
      "the link-only directory must not contain additional mirrored artifacts",
    );
    const index = await readFile(path.join(directory, "README.md"), "utf8");
    assert.match(index, /Redistribution permission has not been established/);
    assert.match(index, /Previous mirrors remain in Git history/);

    for (const [file, gid] of tabs) {
      const content = (await readFile(path.join(directory, file), "utf8")).replace(/\r\n/g, "\n");
      const url = `${source}#gid=${gid}`;
      assert.ok(index.includes(`(./${file})`), `${file}: missing local index link`);
      assert.ok(index.includes(url), `${file}: missing original source in index`);
      assert.ok(content.includes(`| **Source URL** | <${url}> |`), `${file}: wrong original gid`);
      assert.match(content, /JulesVern; Quasel; BlueMandalorian; STFC Officer Tool Discord/);
      assert.match(content, /Redistribution permission has not been established/);
      assert.match(content, /No local CSV data is available/);
      const fields = Array.from(content.matchAll(/^\| \*\*([^*]+)\*\* \|/gm), (m) => m[1]);
      assert.deepEqual(fields, [
        "Source URL", "Source name", "Author(s) / contributors", "Captured on",
        "License / attribution requirements", "Refresh strategy",
      ], `${file}: only lineage metadata is allowed`);

      const prose = content.split("\n").filter((line) =>
        line !== "" && !line.startsWith("#") && !line.startsWith("|"));
      assert.deepEqual(prose, [
        "Open the **Source URL** for the tab's content. No local CSV data is available.",
        "See the [source index](./README.md) for the replacement rationale and limitations.",
      ], `${file}: unexpected content outside link metadata`);
      assert.doesNotMatch(content, /```|## Data|gviz\/tq/, `${file}: must not contain a CSV mirror`);
    }
  });

  it("rejects the former refresh command before any fetch or write, leaving links intact", async () => {
    const before = await snapshot();
    const guard = [
      'import { promises as fs } from "node:fs";',
      'globalThis.fetch = async () => { throw new Error("UNEXPECTED_FETCH"); };',
      'fs.mkdir = fs.writeFile = async () => { throw new Error("UNEXPECTED_WRITE"); };',
    ].join("\n");
    const result = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(guard)}`,
      path.join(root, "scripts", "fetch-community-sheet.ts"),
    ], { cwd: root, encoding: "utf8", timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Community sheet mirroring is disabled \(#402\)/);
    assert.match(result.stderr, /redistribution permission has not been established/);
    assert.ok(result.stderr.includes(source), "error must point callers to the original source");
    assert.match(result.stderr, /no data was fetched or written/);
    assert.doesNotMatch(result.stderr, /UNEXPECTED_FETCH|UNEXPECTED_WRITE/);
    assert.deepEqual(await snapshot(), before, "retired command must not overwrite the link stubs");
  });

  it("ships a rebuilt retrieval cache with current source links, not obsolete mirror instructions", async () => {
    const inputs = await loadInputs();
    // Compare the committed portable artifact, independent of checkout CRLF
    // and Windows path separators. This does not change runtime loading.
    for (const file of [inputs.knowledgeDoc, inputs.officers, ...inputs.tasks]) {
      file.source = file.source.replaceAll("\\", "/");
      file.content = file.content.replace(/\r\n/g, "\n");
    }
    const cache = await readCache(path.join(root, "data", "crew", "knowledge-embeddings.json"));
    assert.ok(cache, "committed cache must exist");
    const expected = await buildCache(inputs, {
      modelId: cache.model,
      embedder: createHashedEmbedder(),
    });
    assert.deepEqual(cache, expected, "cache must match current source text, citations, and embeddings");
    const text = cache.chunks.map((chunk) => chunk.text).join("\n");
    assert.match(text, /there is no local sheet dataset/);
    assert.doesNotMatch(text, /community mirror|read-only mirror|node scripts\/fetch-community-sheet\.mjs/);
  });
});
