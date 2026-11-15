# PULSE architecture (owner: Dev 3)

## Components and data flow

```
            QNX 8.0 target (QEMU or Raspberry Pi 5)
 ┌──────────────────────────────────────────────────────┐
 │  pulse-core (Dev 3)            pulse-load (Dev 2)    │
 │  SCHED_FIFO tasks, timer       CPU hogs, rogue       │
 │  pulses, ClockCycles(),        tasks, interrupt      │
 │  kernel event trace            storms                │
 │            └──► evidence JSON per run                │
 └────────────────────────┬─────────────────────────────┘
                          │ file copy or network
                          ▼
            Host collector (Dev 2)
 ┌──────────────────────────────────────────────────────┐
 │  validate ► local verdict ► anomaly detector         │
 │  ► terminal report ► OPTIONAL push                   │
 └────────────────────────┬─────────────────────────────┘
                          │ HTTPS POST {base}/evidence, X-PULSE-Token
                          ▼
            Forge app (Atlassian Cloud)
 ┌──────────────────────────────────────────────────────┐
 │  webtrigger pulse-ingest ─► KVS (runs, reqs, verdicts)│
 │                                   │                  │
 │  action modules (Rovo) ◄──────────┤                  │
 │   ├─ used by rovo:agent "PULSE timing assistant"     │
 │   └─ exposed as MCP tools by rovo:mcp                │
 │  graph:connector ─► Teamwork Graph (builds, runs)    │
 │  resolvers ─► UI (Dev 1): issue panel, macro, dash   │
 └──────────────────────────────────────────────────────┘
```

Contracts: `contracts/` (schemas, verdict rules, push API, test vectors).

## Phase 0 platform findings (risk check, 2026-11-14)

Source: current Forge developer docs (links below). **Not yet proven on a real site.** Each item
is closed by a spike on the dev site.

| Plan said | Docs say | Impact on PULSE |
|---|---|---|
| Web trigger receives the HTTPS POST | Supported. `response.type: dynamic` returns our own status, headers and body. The request has `method`, `userPath`, `headers` (string arrays, casing not guaranteed), `body` (string). The URL is per installation (`urlFormat: v2`). **The platform does no auth.** | Push API v1 as written. Token check in the handler, with case-insensitive header lookup. URL shown to users on an admin page (Phase 2). |
| — | Only **static** web triggers qualify for "Runs on Atlassian". Adding the first dynamic trigger is a major version change. | Decide before Phase 2 whether the RoA badge matters for Codegeist. The dynamic trigger ships in v1, so judges never see a later re-consent. |
| `rovo:agent` + `rovo:action` | The modules are `rovo:agent` (name ≤ 30 chars, `prompt`, `actions: [keys]`) and **`action`** (key, `function`, `actionVerb` GET/CREATE/UPDATE/DELETE/TRIGGER, `description`, typed `inputs`: string/integer/number/boolean). Data limit is 5 MB per action. `rovo:skill` is in Preview. | All read actions use `actionVerb: GET`. Authorise with `context.accountId`, never with inputs (the model can invent inputs). |
| Separate MCP server | **`rovo:mcp` (Preview)** exposes existing `action` keys as MCP tools at `https://mcp.atlassian.com/forge/<appId>` (OAuth 2.1, user permissions). At most one module and 50 tools. **Off by default; a site admin enables it per installation.** | No separate server to build. The four queries (`listRegressions`, `getOwner`, `explainRun`, `getRequirementStatus`) are written once as `action` modules and listed in both `rovo:agent.actions` and `rovo:mcp.tools`. Judges must enable MCP, so add that to the setup steps. Not yet confirmed whether it works in the `development` environment. |
| Write and read Teamwork Graph links | **`graph:connector`** module with `@forge/teamwork-graph` (`setObjects`, `setRelationships`). Relationships come from `associations` (for example `issueIdOrKeys`), `owners`, `parentKey` and `containerKey`. Reading uses the **Teamwork Graph API (Preview)** through **persisted** Cypher queries; raw `cypherQuery` is not available to new apps. There is **no "requirement" type**. Test run/execution types exist but are **not queryable**. Build, Deployment, Document and Work item are queryable. Missing read scopes return empty results silently. | **Highest-risk bonus.** Proposed mapping: requirement = Jira work item (already in the graph), evidence run = `atlassian:build`-style object linked to the requirement work items and the owner. Read back: "work items linked to the same builds as REQ-X". Run a spike on the dev site **before Phase 3**. If persisted queries or the connector need enrolment we cannot get, drop this bonus first (the agent and MCP bonuses remain). |
| Node runtime | Node 20 reached end of life in April 2026. | Forge runtime `nodejs22.x`. Use Node 22 locally for the Forge CLI. |

Docs:
[web trigger module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/) ·
[web trigger runtime](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger/) ·
[web trigger URL API](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger-api/) ·
[rovo:agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/) ·
[action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/) ·
[rovo:skill](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-skill/) ·
[rovo:mcp](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/) ·
[graph:connector](https://developer.atlassian.com/platform/forge/manifest-reference/modules/teamwork-graph-connector/) ·
[querying ingested data](https://developer.atlassian.com/platform/teamwork-graph/querying-ingested-data/) ·
[relationships](https://developer.atlassian.com/platform/teamwork-graph/create-relationships/)
