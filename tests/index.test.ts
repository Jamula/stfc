// Bootstrap that imports every test suite. Pre-baked so adding a new test
// suite means appending a single import line.
//
// Run with: npm test
import "./lib/jwt.test.ts";
import "./lib/accounts.test.ts";
import "./lib/outcomes.test.ts";
import "./lib/promoCodes.test.ts";
import "./lib/summary.test.ts";
import "./lib/redact.test.ts";
import "./api/client.test.ts";
import "./skills/runAll.test.ts";
import "./discord/schemas.test.ts";
import "./discord/state.test.ts";
import "./discord/client.test.ts";
import "./discord/extractor.test.ts";
import "./discord/classifier.test.ts";
import "./discord/dedup.test.ts";
import "./discord/cooldown.test.ts";
import "./discord/moderation.test.ts";
import "./discord/ingest.test.ts";
import "./digest/digest.test.ts";
import "./skills/discordMonitor.test.ts";
