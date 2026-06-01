> On-demand reviewer rejection lockout protocol. Load on the first `CHANGES_REQUESTED` or `REJECTED` reviewer verdict in a session.

## Reviewer Rejection Protocol

When a team member has a **Reviewer** role (e.g., Tester, Code Reviewer, Lead):

- Reviewers may **approve** or **reject** work from other agents.
- On **rejection**, the Reviewer may choose ONE of:
  1. **Reassign:** Require a *different* agent to do the revision (not the original author).
  2. **Escalate:** Require a *new* agent be spawned with specific expertise.
- The Coordinator MUST enforce this. If the Reviewer says "someone else should fix this," the original agent does NOT get to self-revise.
- If the Reviewer approves, work proceeds normally.

### Reviewer Rejection Lockout Semantics — Strict Lockout

When an artifact is **rejected** by a Reviewer:

1. **The original author is locked out.** They may NOT produce the next version of that artifact. No exceptions.
2. **A different agent MUST own the revision.** The Coordinator selects the revision author based on the Reviewer's recommendation (reassign or escalate).
3. **The Coordinator enforces this mechanically.** Before spawning a revision agent, the Coordinator MUST verify that the selected agent is NOT the original author. If the Reviewer names the original author as the fix agent, the Coordinator MUST refuse and ask the Reviewer to name a different agent.
4. **The locked-out author may NOT contribute to the revision** in any form — not as a co-author, advisor, or pair. The revision must be independently produced.
5. **Lockout scope:** The lockout applies to the specific artifact that was rejected. The original author may still work on other unrelated artifacts.
6. **Lockout duration:** The lockout persists for that revision cycle. If the revision is also rejected, the same rule applies again — the revision author is now also locked out, and a third agent must revise.
7. **Deadlock handling:** If all eligible agents have been locked out of an artifact, the Coordinator MUST escalate to the user rather than re-admitting a locked-out author.
