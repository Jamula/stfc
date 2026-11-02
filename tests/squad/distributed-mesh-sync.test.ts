import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("shell mesh sync passes opaque source, output path, and bearer header as data", (t) => {
  const bash = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if ((bash.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    t.skip("bash is unavailable");
    return;
  }
  assert.equal(bash.status, 0, bash.stderr);

  const dir = mkdtempSync(join(process.cwd(), ".mesh-sync-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const jq = join(bin, "jq");
  writeFileSync(jq, `#!/bin/bash
[ "$1" = -r ] && shift
node -e '
const fs = require("node:fs");
const [query, file] = process.argv.slice(1);
const squads = JSON.parse(fs.readFileSync(file, "utf8")).squads;
if (query.includes("remote-trusted")) process.exit(0);
if (query.includes("remote-opaque")) { console.log("partner-fraud"); process.exit(0); }
const key = query.match(/\\.(source|sync_to|auth)/)[1];
console.log(squads["partner-fraud"][key] || "");
' "$1" "$2"
`);
  const curl = join(bin, "curl");
  writeFileSync(curl, `#!/bin/bash
printf '%s\\0' "$@" > args.bin
[ "\${FAIL_CURL:-}" = 1 ] && exit 1
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then printf 'remote contract\\n' > "$2"; break; fi
  shift
done
`);
  chmodSync(jq, 0o755);
  chmodSync(curl, 0o755);

  const source = "https://example.test/contract?a=1&b=2; touch INJECTED; #";
  const target = "output directory; touch TARGET_INJECTED; #";
  const token = 'fake token"; touch HEADER_INJECTED; #';
  writeFileSync(join(dir, "mesh.json"), JSON.stringify({
    squads: { "partner-fraud": { zone: "remote-opaque", source, sync_to: target, auth: "bearer" } },
  }));
  const env = { ...process.env, PARTNER_FRAUD_TOKEN: token };
  const run = (extraEnv: Record<string, string> = {}) => spawnSync(
    "bash",
    ["-c", 'export PATH="$PWD/bin:$PATH"; exec bash "$@"', "--",
      resolve(".squad", "templates", "skills", "distributed-mesh", "sync-mesh.sh"), "mesh.json"],
    { cwd: dir, env: { ...env, ...extraEnv }, encoding: "utf8" },
  );
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.ok(existsSync(join(dir, "args.bin")), `curl was not called: ${success.stdout}\n${success.stderr}`);
  assert.deepEqual(readFileSync(join(dir, "args.bin"), "utf8").split("\0").slice(0, -1), [
    "--silent", "--fail", "--header", `Authorization: Bearer ${token}`,
    "-o", `${target}/SUMMARY.md`, "--", source,
  ]);
  assert.equal(readFileSync(join(dir, target, "SUMMARY.md"), "utf8"), "remote contract\n");
  for (const marker of ["INJECTED", "TARGET_INJECTED", "HEADER_INJECTED"]) {
    assert.equal(existsSync(join(dir, marker)), false, `${marker} must not be executed`);
  }

  const failure = run({ PARTNER_FRAUD_TOKEN: "", FAIL_CURL: "1" });
  assert.equal(failure.status, 0, failure.stderr);
  assert.deepEqual(readFileSync(join(dir, "args.bin"), "utf8").split("\0").slice(0, -1), [
    "--silent", "--fail", "-o", `${target}/SUMMARY.md`, "--", source,
  ]);
  assert.match(readFileSync(join(dir, target, "SUMMARY.md"), "utf8"), /^# partner-fraud — unavailable \(/);
});
