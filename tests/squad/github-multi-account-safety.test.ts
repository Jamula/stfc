import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const skillPath = path.join(".squad", "templates", "skills", "github-multi-account", "SKILL.md");
const skill = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");

function powerShell(): string | undefined {
  for (const command of process.platform === "win32" ? ["pwsh", "powershell"] : ["pwsh"]) {
    const probe = spawnSync(command, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
      encoding: "utf8",
    });
    if (probe.error && "code" in probe.error && probe.error.code === "ENOENT") continue;
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, `${command} failed to start: ${probe.stderr}`);
    return command;
  }
  return undefined;
}

describe("GitHub multi-account skill", () => {
  it("uses the user's confirmed aliases instead of upstream account bindings", () => {
    assert.doesNotMatch(skill, /\b(?:bradygaster|bradyg_microsoft)\b/i, skillPath);
    assert.match(skill, /aliases configured from the user's confirmed account selection/i);
  });

  it("stops both documented PowerShell wrappers when switching accounts fails", (t) => {
    const shell = powerShell();
    if (!shell) {
      t.skip("PowerShell is not installed");
      return;
    }

    const profile = /\$block = @"\n([\s\S]*?)\n"@/.exec(skill)?.[1];
    const current = /# 5\. Load in current session\n([\s\S]*?)\n```/.exec(skill)?.[1];
    assert.ok(profile, "Missing documented PowerShell profile definitions");
    assert.ok(current, "Missing documented current-session definitions");

    const script = `
$personal = 'confirmed-personal'
$work = 'confirmed-work'
function gh {
    $script:calls += ,@($args)
    if ($args[0] -eq 'auth') { $global:LASTEXITCODE = $script:switchExit }
    else { $global:LASTEXITCODE = 0 }
}
$results = @()
foreach ($source in @('profile', 'current')) {
    if ($source -eq 'profile') {
        $block = @"
${profile}
"@
        Invoke-Expression $block
    } else {
${current}
    }
    foreach ($alias in @('gh-personal', 'gh-work')) {
        foreach ($switchExit in @(1, 0)) {
            $script:switchExit = $switchExit
            $script:calls = @()
            & $alias api user --jq '.login'
            $results += [PSCustomObject]@{
                source = $source; alias = $alias; switchExit = $switchExit
                exitCode = $LASTEXITCODE; calls = @($script:calls)
            }
        }
    }
}
ConvertTo-Json -InputObject @($results) -Depth 6 -Compress
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `PowerShell failed: ${result.stderr}`);
    const results = JSON.parse(result.stdout) as Array<{
      source: string;
      alias: string;
      switchExit: number;
      exitCode: number;
      calls: string[][];
    }>;
    assert.equal(results.length, 8);
    for (const row of results) {
      const account = row.alias === "gh-personal" ? "confirmed-personal" : "confirmed-work";
      const context = `${row.source} ${row.alias}, switch exit ${row.switchExit}`;
      const expected = [["auth", "switch", "--user", account]];
      if (row.switchExit === 0) expected.push(["api", "user", "--jq", ".login"]);
      assert.deepEqual(row.calls, expected, context);
      assert.equal(row.exitCode, row.switchExit, context);
    }
  });
});
