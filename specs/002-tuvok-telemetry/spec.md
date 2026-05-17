# Feature Specification: Tuvok Token-Usage Telemetry

**Feature Branch**: `002-tuvok-telemetry`  
**Created**: 2025-07-16  
**Status**: Draft  
**Input**: User description: "Enhance Tuvok (Process Auditor / Editorial Specialist) to collect token-usage telemetry after each session/workstream/merge, so the data can drive evidence-based improvements to model selection, agent routing, and prompt design over time."
**Issue**: #15

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Collect Token-Usage Data After Agent Sessions (Priority: P1)

After an agent completes a session (e.g., implementing a task, reviewing code, clarifying a spec), Tuvok automatically extracts token-usage telemetry from the cloud session store and records a structured summary. The operator never has to manually track which model was used, how many tokens were consumed, or how long a task took — Tuvok captures this transparently in the background.

**Why this priority**: Without data collection, no downstream analysis or model-selection improvement is possible. This is the foundational capability that every other story depends on.

**Independent Test**: Can be fully tested by providing a mock session store with known event data, verifying that Tuvok extracts the correct fields (input/output tokens, model, agent name, task category, outcome, wall-clock duration), writes a structured record, and exits cleanly.

**Acceptance Scenarios**:

1. **Given** an agent session has completed with events recorded in the cloud session store, **When** Tuvok runs its telemetry collection, **Then** a structured telemetry record is created containing: input tokens, output tokens, model used, model tier, agent name, task category, outcome (success/failure), and wall-clock duration.
2. **Given** a session where events are missing optional fields (e.g., no `usage_model` on some events), **When** Tuvok collects telemetry, **Then** missing fields are recorded as null/unknown rather than causing a collection failure.
3. **Given** a session that was interrupted mid-flight (no clean completion event), **When** Tuvok collects telemetry, **Then** the record is marked with a partial/incomplete status and whatever data is available is still captured.
4. **Given** Tuvok has already collected telemetry for a specific session, **When** collection is triggered again for the same session, **Then** the existing record is not duplicated (idempotent collection).

---

### User Story 2 — Generate Telemetry Summary Reports (Priority: P2)

An operator (or Tuvok itself during its auditor role) can generate a summary report from collected telemetry data, showing aggregate token usage broken down by model, agent, task category, and time period. This report provides the evidence base for model-selection and prompt-design decisions.

**Why this priority**: Raw data without summarisation is not actionable. Reports transform collected telemetry into insights that inform decisions. This is the first step toward closing the feedback loop.

**Independent Test**: Can be fully tested by seeding a telemetry store with known records covering multiple models and agents, generating a report, and verifying that totals, averages, and breakdowns match expected values.

**Acceptance Scenarios**:

1. **Given** telemetry records exist for at least two different models across multiple sessions, **When** a summary report is generated, **Then** the report shows per-model totals for input tokens, output tokens, and session count.
2. **Given** telemetry records span multiple agents (e.g., Scotty, Kirk, Picard), **When** a summary report is generated, **Then** the report includes per-agent breakdowns with average tokens per session and average wall-clock duration.
3. **Given** telemetry records include both successful and failed outcomes, **When** a summary report is generated, **Then** the report shows success/failure rates per model and per agent.
4. **Given** no telemetry records exist, **When** a summary report is requested, **Then** the report clearly states that no data is available rather than producing empty or misleading output.

---

### User Story 3 — Surface Model-Selection Recommendations (Priority: P3)

Based on accumulated telemetry, Tuvok produces actionable recommendations for model selection — for example, identifying that a particular agent consistently uses fewer tokens on a cheaper model with equivalent outcomes, or that a specific task category would benefit from a higher-tier model due to high failure rates.

**Why this priority**: This closes the feedback loop from data to decision. Without recommendations, the operator must manually interpret reports. However, it depends on having sufficient collected data (Story 1) and summarisation (Story 2).

**Independent Test**: Can be tested by seeding telemetry with patterns that should trigger specific recommendations (e.g., Agent X fails 60% of tasks on Model A but succeeds 95% on Model B) and verifying the correct recommendations are produced.

**Acceptance Scenarios**:

1. **Given** telemetry shows Agent X achieves similar success rates on a lower-tier model at 40% fewer tokens, **When** recommendations are generated, **Then** a recommendation to consider the lower-tier model for Agent X is produced with supporting data.
2. **Given** telemetry shows a task category has a failure rate above 50% on a specific model, **When** recommendations are generated, **Then** a recommendation to evaluate a higher-tier model for that category is produced.
3. **Given** insufficient data for a meaningful recommendation (fewer than a configurable minimum number of sessions), **When** recommendations are generated, **Then** those agents/models are excluded from recommendations with a note explaining insufficient data.

---

### User Story 4 — Tuvok Audit Trail Integration (Priority: P3)

Tuvok's telemetry collection integrates with the existing Squad audit workflow. Telemetry summaries and recommendations appear in Tuvok's session history and can be referenced in squad decisions, so the team has a traceable record of why model or routing changes were made.

**Why this priority**: Governance and traceability are core to the Squad workflow. Without audit integration, telemetry-driven decisions lack the provenance trail that Picard and the Coordinator expect.

**Independent Test**: Can be tested by running a telemetry collection and report cycle, then verifying that the outputs are referenced in the expected audit locations.

**Acceptance Scenarios**:

1. **Given** Tuvok completes a telemetry collection and generates a report, **When** the audit trail is reviewed, **Then** the collection event and report are traceable in Tuvok's history.
2. **Given** a model-selection recommendation is acted upon, **When** a squad decision is recorded, **Then** the decision references the telemetry data that informed it.

---

### Edge Cases

- What happens when the cloud session store is unreachable or returns errors during collection? Tuvok logs the failure and retries on the next trigger cycle without losing previously collected data.
- How does the system handle sessions with zero token usage (e.g., a session that only read files)? These are recorded with zero-value token fields; they are valid data points for duration and outcome analysis.
- What happens when session data is incomplete or schema changes in the session store? Tuvok uses defensive parsing — unknown fields are ignored, missing expected fields are recorded as null, and a warning is logged.
- How does the system handle very large backlogs of uncollected sessions? Collection processes sessions in batches with configurable batch size, oldest first, to avoid timeout.
- What happens if the same session appears in both local and cloud session stores? Deduplication is by session ID; the cloud record takes precedence if both exist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Tuvok MUST extract token-usage telemetry from the cloud session store after each agent session completes.
- **FR-002**: Each telemetry record MUST include: input tokens, output tokens, model identifier, model tier, agent name, task category, outcome (success/failure/partial), and wall-clock duration.
- **FR-003**: Tuvok MUST store collected telemetry records in a local, append-only data file within the repository's `data/` directory.
- **FR-004**: Telemetry collection MUST be idempotent — re-running collection for an already-processed session MUST NOT create duplicate records.
- **FR-005**: Tuvok MUST be able to generate summary reports showing aggregate token usage broken down by model, agent, task category, outcome, and time period.
- **FR-006**: Tuvok MUST be able to produce model-selection recommendations based on accumulated telemetry, comparing success rates and token efficiency across models and agents.
- **FR-007**: Recommendations MUST only be generated when sufficient data exists (configurable minimum session count per agent/model combination).
- **FR-008**: Telemetry collection MUST handle missing or partial session data gracefully — null fields rather than failures.
- **FR-009**: Tuvok MUST NOT collect or store any content from user messages or assistant responses — only aggregate usage metadata (token counts, model names, durations, outcomes).
- **FR-010**: All telemetry records MUST use `<REDACTED>` placeholders for any session identifiers that could be traced back to specific user interactions, consistent with Principle VII (Artifact Hygiene).
- **FR-011**: Telemetry reports and recommendations MUST be human-readable and require human review before any model-selection or routing changes are made.
- **FR-012**: Tuvok MUST log each collection run (timestamp, sessions processed, errors encountered) for auditability.

### Key Entities

- **TelemetryRecord**: A single observation of resource usage for one agent session. Key attributes: session timestamp, input token count, output token count, model identifier, model tier, agent name, task category, outcome status, wall-clock duration in seconds.
- **TelemetrySummary**: An aggregated view over multiple TelemetryRecords, grouped by one or more dimensions (model, agent, task category, time period). Key attributes: group key, total input tokens, total output tokens, session count, average duration, success rate.
- **ModelRecommendation**: An actionable suggestion derived from TelemetrySummary data. Key attributes: target agent/task, current model, recommended model, supporting evidence (token savings, success rate delta), confidence level, minimum data threshold met.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After any agent session, telemetry is collected and stored within the next Tuvok audit cycle with no manual operator intervention.
- **SC-002**: Telemetry records capture 100% of sessions that have usage data in the cloud session store — no sessions are silently dropped.
- **SC-003**: Summary reports can be generated covering any time period and are delivered in under 30 seconds for up to 1,000 sessions.
- **SC-004**: Model-selection recommendations correctly identify at least one cost-saving or quality-improving opportunity within the first 50 collected sessions (when such an opportunity exists in the data).
- **SC-005**: Zero user message content or assistant response content is present in any telemetry record, report, or recommendation — only aggregate metadata.
- **SC-006**: The operator can trace any model-selection change back to the specific telemetry data and recommendation that informed it.
- **SC-007**: Collection of telemetry for a single session completes in under 5 seconds under normal conditions.

## Out of Scope

- Real-time dashboards or live-updating visualisations of token usage
- Automatic model-selection changes without human review and approval
- Cross-repository aggregation of telemetry data
- Integration with third-party analytics platforms or external telemetry services
- Billing or cost-estimation features (telemetry captures usage, not cost)
- Changes to agent behaviour based on telemetry — only reporting and recommendations

## Assumptions

- The cloud session store (`session_store_sql`) is available and contains the `events` table with `usage_input_tokens`, `usage_output_tokens`, and `usage_model` columns as documented.
- Tuvok operates within the existing Squad agent framework and follows the same dispatch/commit conventions (Rule 2 — Scribe-only `.squad/` commits).
- Telemetry data will be stored as committed files in the repository (under `data/`), following the existing pattern for durable data (e.g., `data/discord/`).
- The constitution (currently v1.3.0) may need amendment to v1.4.0 if new durable inputs are added to `data/`; this will be evaluated during planning.
- Model tier classification (e.g., "standard", "high", "extra-high") is derived from model identifiers using a maintained mapping, not from external pricing APIs.
- The minimum session count threshold for generating recommendations defaults to 10 sessions per agent/model combination, configurable by the operator.
- All telemetry processing happens locally within the repository's CI environment — no data leaves the runner (consistent with existing privacy constraints in the constitution).
