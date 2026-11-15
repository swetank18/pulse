# contracts/ (owner: Dev 3)

The only surface the three parts of PULSE share. **Only Dev 3 changes these files**, and every
change is announced in the daily sync the same day.

| File | What | Consumers |
|---|---|---|
| `evidence.schema.json` | One record per run | pulse-core (writes), sim/generator (writes), host-collector (reads, fills `anomalies`), Forge backend (stores) |
| `requirement.schema.json` | One timing requirement | research/demo-data (writes), collector, Forge |
| `verdict_rules.md` | Validity checks, run/build verdicts, regressions | collector, Forge backend |
| `push_api.md` | Collector → Forge web trigger | collector, Forge backend |
| `test_vectors/` | Verdict cases (`v*.json`) and rejection cases (`x*.json`) | collector and Forge must both pass all |
| `resolvers.md` | Forge resolver API for the UI | written at the start of Phase 2 |
| `tools/validate.py` | Validates evidence, requirements and vector files | everyone (`pip install jsonschema`) |

```bash
python3 contracts/tools/validate.py vectors                     # all vector files well formed
python3 contracts/tools/validate.py evidence demo-data/sample_runs/*.json
python3 contracts/tools/validate.py requirement demo-data/requirements.json
(cd forge-app && npm test)                                      # Forge verdict engine vs vectors
```

## Test vectors: who adds what

* `v001`–`v099`, `x001`–`x099`: seed boundary cases (Dev 3).
* `v100`+, `x100`+: Dev 2 proposes these in a PR (realistic cases from the generator and the
  research). Dev 3 reviews and merges.
* Every vector must pass `validate.py vectors` before review.

## Version

**v1.0, draft for freeze.** It is frozen after the Phase 0 daily sync where it is announced.
After the freeze, any change bumps `schema_version` and is announced.

### What v1.0 adds to or pins down from `PULSE_full_context.md` §7 (announce these)

1. **`origin`** (`device` | `synthetic`), required in evidence. The UI labels synthetic data so
   the demo stays honest.
2. **Latency definition:** completion time minus *scheduled* release time, as integer µs rounded
   **up**. `jitter_us` is the population standard deviation of the latency samples.
3. **Starvation:** `samples` may be 0. `latency_us` is then `null` and the verdict is `fail` /
   `no_samples`. `deadline_misses` also counts jobs still unfinished when the run ends.
4. **Anomaly shape:** `{task_id, kind, message, score?, detector?}`. Any anomaly on a task makes
   that task's requirements `at_risk` unless they already fail.
5. Optional evidence fields `trace` (kernel trace file + traced tasks) and `producer`.
6. **Requirement:** `owner` may be `null`, with `owner_name` as a display fallback (demo sites
   have no real owners). `jira_issue` may be `null`.
7. **Status `no_data`** when a run has no measurements for the requirement's task. Reason codes
   form a closed list (`verdict_rules.md` §3).
8. **Exact boundaries:** `max == limit` is `at_risk`, not `fail`. The margin test uses integer
   math and includes the boundary value.
9. **Build verdict, current status and regression** are defined (§5–6), so the dashboard and the
   Rovo `listRegressions` action agree.
10. **Push API paths:** `GET /health`, `POST /evidence` and `POST /requirements`. Identical
    re-posts are idempotent, a different record under the same `run_id` gets `409`, and the body
    limit is 128 KiB.
11. **Validation order and error codes** (`verdict_rules.md` §1), with rejection vectors.
