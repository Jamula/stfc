# Session Init Reference

Procedures the coordinator runs at session start, in order. Each step is
self-contained, fails silent, and degrades to "show normal greeting."

---

## Step 1: Update Check

Check whether a newer Squad version exists for the user's channel. Append to
the greeting if a newer version is found. Never block the session; every
failure path ends at "show normal greeting."

### 1.1 Kill Switch

If the environment variable `SQUAD_NO_UPDATE_CHECK` is set to `1`, **skip
Step 1 entirely** and show the normal greeting. This is the same kill switch
as the upstream CLI banner — one opt-out disables both.

### 1.2 Channel Detection

Read the stamped version from the `<!-- version: X -->` HTML comment at the
top of `squad.agent.md` (or from the `- **Version:** X` identity line as
fallback). Classify the channel:

| Stamped version contains | Channel   |
|--------------------------|-----------|
| `-insider`               | `insider` |
| `-preview`               | `preview` |
| (neither)                | `latest`  |

Store the stamped version as `currentVersion` and the detected channel.

### 1.3 Hybrid Cache Strategy

The strategy differs by channel to avoid redundant network calls for the
common (`latest`) case.

#### For `latest` channel — read upstream OS-specific cache

The upstream Squad CLI (`self-update.ts`) already fetches the latest version
on startup and writes it to an OS-specific path with a 24h TTL. Read that
cache instead of making a new npm call.

**One-liner to read the upstream cache:**
```
node -e "const p=require('path'),o=require('os');const b=process.env.APPDATA||(process.platform==='darwin'?p.join(o.homedir(),'Library','Application Support'):p.join(o.homedir(),'.config'));const f=p.join(b,'squad-cli','update-check.json');try{const d=JSON.parse(require('fs').readFileSync(f,'utf8'));const age=Date.now()-d.checkedAt;if(age<86400000)console.log(JSON.stringify(d));else console.log('STALE')}catch{console.log('MISS')}"
```

Output semantics:
- Valid JSON `{"latestVersion":"X.Y.Z","checkedAt":N}` → cache hit; use `latestVersion`
- `STALE` → cache expired (older than 24h); treat as no data
- `MISS` → cache missing or corrupt; treat as no data

On `STALE` or `MISS`, show the normal greeting (no notice). Do **not** make an
independent npm call for `latest`-channel users — the upstream CLI will refresh
the cache on its next run.

**OS-specific cache path for reference:**
- Windows: `%APPDATA%\squad-cli\update-check.json`
- Linux: `~/.config/squad-cli/update-check.json`
- macOS: `~/Library/Application Support/squad-cli/update-check.json`

#### For `insider` / `preview` channels — own probe with repo-local cache

The upstream cache only stores the `latest` dist-tag and is not useful for
pre-release channels. Use a separate probe.

**Step A — Check repo-local cache:**

Read `.squad/.cache/version-check.json`. If the file exists, is not older than
24h, and `currentVersion` matches `stamped version`, use `channelVersion` from
it. Skip the npm probe.

**Repo-local cache schema:**
```json
{
  "checkedAt": "2026-05-26T14:13:28.492Z",
  "currentVersion": "0.9.6-insider.2",
  "channel": "insider",
  "channelVersion": "0.9.7-insider.1"
}
```

**Step B — npm probe (on cache miss / stale / version mismatch):**

```
npm view @bradygaster/squad-cli dist-tags --json
```

- Timeout: **5 seconds.** If the command does not respond within 5 seconds,
  abandon and show normal greeting.
- On success: extract `dist-tags[channel]` (e.g., `dist-tags["insider"]`).
  Write `.squad/.cache/version-check.json` with the schema above.
  Create `.squad/.cache/` if it does not exist.
- On any error (network failure, registry unreachable, parse error): show
  normal greeting.

### 1.4 Comparison

Compare `currentVersion` against the resolved `latestVersionForChannel` using
semver ordering (pre-release suffixes sort lower than their release counterpart,
e.g., `0.9.5-insider.1 < 0.9.5`).

- `latestVersionForChannel > currentVersion` → update available
- Equal or older → no notice

### 1.5 Greeting Append

When an update is available, append to the normal greeting (on the same line,
separated by ` · `):

```
 · 🆕 v{latestVersionForChannel} available — say "upgrade squad"
```

Example complete greeting line:
```
Squad v0.9.4-insider.1 · 🆕 v0.9.7-insider.1 available — say "upgrade squad"
```

Do not mention the update check, the cache, or the mechanism. Just the notice.

### 1.6 Upgrade Flow

**Trigger phrases** (case-insensitive, match anywhere in user message):
- "upgrade squad"
- "update squad"
- "what's new" *(when a version notice has been shown in this session)*
- "install the update"
- "yes upgrade"

**Flow:**

1. **Stop before an in-place upgrade.** Do not run `squad upgrade` in this repository.
   The pinned CLI replaces the customized coordinator contract and
   managed instructions and can add automatic issue and PR workflows.
2. Delegate evaluation of the requested version in an isolated disposable clone,
   not the main checkout. Compare its generated coordinator, instructions, skills,
   and workflow set with this project's operating contract and inactive-by-default
   automation policy. Do not publish state or enable workflows during evaluation.
3. If the update is compatible, have the accountable specialist port and test the
   intended changes in a reviewed PR without enabling unauthorized workflows.
   If it is not compatible or cannot be evaluated safely, report the blocker.
   Do not claim that an upgrade occurred or ask for a restart until the reviewed
   changes are actually applied.

### 1.7 Failure Modes

Every failure path ends at "show normal greeting." The update check never
interrupts or delays the session.

| Failure | Behavior |
|---------|----------|
| `node` not on PATH | `MISS` → normal greeting |
| Upstream cache missing / corrupt | `MISS` → normal greeting |
| Upstream cache stale (`latest` channel) | Normal greeting (no npm call) |
| npm probe timeout (5s) | Normal greeting |
| npm probe network error | Normal greeting |
| npm probe parse error | Normal greeting |
| `.squad/.cache/` write error | Normal greeting (skip cache write) |
| `gh` not available / unauthenticated | Upgrade flow: link to releases page |
| Isolated upgrade exits non-zero | Report error, stop flow |
| Any unexpected exception | Report the error; use the configured state bridge for any log |

---

## (Future steps reserved)

- Step 2: \<reserved\> — e.g., dependency drift check
- Step 3: \<reserved\> — e.g., repo policy / state-backend audit
