import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractRedditPromoCandidates,
  parseRedditAtomFeed,
  parseRedditListingJson,
} from "../../src/discord/redditFeed.ts";

describe("redditFeed — Atom/RSS and OAuth JSON promo discovery (#369)", () => {
  it("parses Atom entries, normalizes entities, and rejects non-Reddit permalinks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_abc123</id>
    <title>New webstore promo code: HONOR26</title>
    <link href="https://www.reddit.com/r/startrekfleetcommand/comments/abc123/new_webstore_promo_code/" />
    <updated>2026-11-20T12:00:00Z</updated>
    <author><name>/u/fleet_captain</name></author>
    <content type="html">&lt;div&gt;&lt;p&gt;Claim **HONOR26** in the web store!&lt;/p&gt;&lt;pre&gt;FAKECODE99&lt;/pre&gt;&lt;/div&gt;</content>
  </entry>
  <entry>
    <id>t3_badlink</id>
    <title>Promo code PHISH99</title>
    <link href="https://evil.example.com/r/startrekfleetcommand/comments/badlink/" />
    <updated>2026-11-20T13:00:00Z</updated>
    <content type="html">&lt;p&gt;PHISH99&lt;/p&gt;</content>
  </entry>
</feed>`;

    const posts = parseRedditAtomFeed(xml);
    assert.equal(posts.length, 1, "untrusted non-Reddit link origins must be discarded");
    assert.equal(posts[0]?.id, "t3_abc123");
    assert.equal(
      posts[0]?.permalink,
      "https://www.reddit.com/r/startrekfleetcommand/comments/abc123/new_webstore_promo_code/",
    );
    assert.equal(posts[0]?.author, "/u/fleet_captain");

    const discovery = extractRedditPromoCandidates(posts);
    assert.deepEqual(
      discovery.candidates.map((c) => c.code),
      ["HONOR26"],
      "fenced <pre> examples and stoplisted English words must not extract as promo codes",
    );
    assert.equal(discovery.candidates[0]?.extractionConfidence, 0.8);
  });

  it("parses OAuth listing JSON, skips general chatter, drops moderated posts, and preserves earliest provenance", () => {
    const listing = {
      kind: "Listing",
      data: {
        children: [
          {
            kind: "t3",
            data: {
              name: "t3_later",
              title: "Repost promo code NEXUS26",
              selftext: "Still working: NEXUS26",
              permalink: "/r/startrekfleetcommand/comments/later/repost_promo/",
              created_utc: 1763650800,
              author: "second_poster",
            },
          },
          {
            kind: "t3",
            data: {
              name: "t3_earlier",
              title: "Free webstore gift code NEXUS26",
              selftext: "Redeem ||NEXUS26|| on the STFC store.",
              permalink: "/r/startrekfleetcommand/comments/earlier/free_webstore_gift/",
              created_utc: 1763640000,
              author: "first_poster",
            },
          },
          {
            kind: "t3",
            data: {
              name: "t3_chatter",
              title: "Best Borg cube armada crew at Ops 46?",
              selftext: "Running 5OF9 captain with ENT3 ship.",
              permalink: "/r/startrekfleetcommand/comments/chatter/borg_cube/",
              created_utc: 1763630000,
              author: "crew_asker",
            },
          },
          {
            kind: "t3",
            data: {
              name: "t3_moderated",
              title: "Promo code RAIDCODE1",
              selftext: "@everyone claim RAIDCODE1 now",
              permalink: "/r/startrekfleetcommand/comments/mod/raid/",
              created_utc: 1763620000,
              author: "spammer",
            },
          },
        ],
      },
    };

    const posts = parseRedditListingJson(listing);
    assert.equal(posts.length, 4);

    const discovery = extractRedditPromoCandidates(posts);
    assert.equal(discovery.postsScanned, 4);
    assert.equal(discovery.droppedModeration, 1);
    assert.deepEqual(
      discovery.candidates.map((c) => c.code),
      ["NEXUS26"],
      "non-promo gameplay threads and moderated posts must not produce promo candidates",
    );
    assert.equal(discovery.candidates[0]?.postId, "t3_earlier");
    assert.equal(
      discovery.candidates[0]?.permalink,
      "https://www.reddit.com/r/startrekfleetcommand/comments/earlier/free_webstore_gift/",
    );
    assert.equal(discovery.candidates[0]?.author, "first_poster");
  });

  it("rejects newline/control-character permalinks, tolerates out-of-range numeric entities, and decodes nested HTML entities", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_nested</id>
    <title>Promo code warp26 &#x110000; drop</title>
    <link href="https://www.reddit.com/r/startrekfleetcommand/comments/nested/promo_(2026)/" />
    <updated>2026-11-21T10:00:00Z</updated>
    <content type="html">&lt;p&gt;Redeem WARP&amp;#8203;26 in the store&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>t3_mod_html</id>
    <title>Free promo code SPAM99</title>
    <link href="https://www.reddit.com/r/startrekfleetcommand/comments/mod_html/free_promo/" />
    <updated>2026-11-21T11:00:00Z</updated>
    <content type="html">&lt;p&gt;&amp;#64;every&amp;#8203;one claim SPAM99&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>t3_injected_href</id>
    <title>Promo code INJECT1</title>
    <link href="https://www.reddit.com/r/stfc/comments/2/&#10;[claim](https://evil.test)" />
    <updated>2026-11-21T12:00:00Z</updated>
    <content type="html">&lt;p&gt;Promo code INJECT1&lt;/p&gt;</content>
  </entry>
</feed>`;

    const posts = parseRedditAtomFeed(xml);
    assert.equal(posts.length, 2, "entry with newline-injected href must be rejected");
    assert.equal(
      posts[0]?.permalink,
      "https://www.reddit.com/r/startrekfleetcommand/comments/nested/promo_%282026%29/",
      "parentheses in permalinks must be percent-encoded against Markdown breakout",
    );

    const discovery = extractRedditPromoCandidates(posts);
    assert.equal(discovery.droppedModeration, 1, "zero-width-obfuscated @everyone must be caught");
    assert.deepEqual(discovery.candidates.map((c) => c.code), ["WARP26"]);
    assert.equal(discovery.candidates[0]?.matchedText, "WARP26");
  });
});
