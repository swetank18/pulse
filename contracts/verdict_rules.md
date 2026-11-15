# Verdict rules (contract v1.0)

Owner: Dev 3. Implemented twice: the host collector (Python, Dev 2) and the Forge backend
(JavaScript, Dev 3). Both must return identical `status` **and** `reasons` for every file in
`test_vectors/`. When this document and an implementation disagree, this document wins.

## 1. Validity (checked before any verdict)

A record is rejected, not judged, if any check fails. Run the checks in this order and report
the first error code:

1. Not valid JSON → `invalid_json`
2. `schema_version` missing or not `"1.0"` → `unsupported_schema_version`
3. Fails `evidence.schema.json` → `schema_invalid`
4. The semantic rules below, in table order (the schema cannot express these):

| Rule | Error code |
|---|---|
| `task_id` values in `tasks` are unique | `duplicate_task_id` |
| When `samples` is 0, `latency_us` is `null` and `jitter_us` is 0. When `samples` > 0, `latency_us` is an object | `latency_samples_mismatch` |
| `latency_us.min <= p50 <= p99 <= max` | `latency_order` |
| Every `anomalies[].task_id` appears in `tasks` | `anomaly_unknown_task` |
| If `trace` is present, every `trace.task_ids` entry appears in `tasks` | `trace_unknown_task` |

A requirement is rejected if it fails `requirement.schema.json`.

## 2. Statuses

| Status | Severity | Meaning |
|---|---|---|
| `pass` | 0 | Within limits, with margin to spare, and no anomaly |
| `at_risk` | 1 | Within limits, but close to the limit or flagged by the anomaly detector |
| `fail` | 2 | Limit broken |
| `no_data` | (none) | The run has no measurements for this requirement's task |

`no_data` has no severity. It never counts as better or worse than another status.

## 3. Run verdict: one requirement R against one evidence record E

Let `T` be the entry in `E.tasks` with `T.task_id == R.task_id`.

```
if T does not exist:
    return no_data, [task_missing]

fail_reasons = []
if T.samples == 0:                                   fail_reasons += no_samples
if T.samples > 0 and T.latency_us.max > R.max_latency_us:
                                                     fail_reasons += latency_exceeded
if T.deadline_misses > R.max_deadline_misses:       fail_reasons += deadline_misses_exceeded
if fail_reasons: return fail, fail_reasons

risk_reasons = []
if T.latency_us.max * 100 >= R.max_latency_us * (100 - R.at_risk_margin_pct):
                                                     risk_reasons += near_limit
if any(a.task_id == R.task_id for a in E.anomalies): risk_reasons += anomaly
if risk_reasons: return at_risk, risk_reasons

return pass, []
```

Notes:

* **Integer arithmetic only.** Every operand is an integer, so the `near_limit` test is exact in
  every language. Do not rewrite it as `max >= limit * 0.8`.
* **Boundaries.** `max == max_latency_us` is not a failure (it is `at_risk` through
  `near_limit`). With limit 2000 and margin 20, `max` 1600 is `at_risk` and `max` 1599 is
  `pass`. With margin 0, `near_limit` applies only when `max == max_latency_us`.
* **`reasons` lists only the reasons for the returned status**, in the order the rules above
  are written. A failing task that also has an anomaly reports `[latency_exceeded]`, not
  `[latency_exceeded, anomaly]`.
* `priority`, `period_us`, `deadline_us`, `jitter_us`, `faults_injected` and the other
  `latency_us` fields do not affect the verdict. They are shown as context.

### Reason codes (closed list for v1.0)

| Code | Status | UI text (suggested) |
|---|---|---|
| `task_missing` | `no_data` | Task not measured in this run |
| `no_samples` | `fail` | Task never completed a job during the run |
| `latency_exceeded` | `fail` | Worst case latency above the limit |
| `deadline_misses_exceeded` | `fail` | Too many deadline misses |
| `near_limit` | `at_risk` | Worst case latency within the safety margin |
| `anomaly` | `at_risk` | Anomaly detector flagged timing drift |

## 4. Verdict output shape

Both implementations produce, per requirement per run:

```json
{ "req_id": "REQ-BRK-001", "run_id": "run-0007", "build_id": "a1b2c3d",
  "status": "at_risk", "reasons": ["near_limit"] }
```

## 5. Build verdict: one requirement R across all runs of build B

1. Compute the run verdict for every run whose `build_id == B`.
2. Drop `no_data` verdicts. If nothing is left, the build verdict is `no_data, [task_missing]`.
3. The build status is the highest severity left.
4. The build reasons are the union of reasons from the runs that have that status, in the
   order of section 3.

## 6. Build order, current status and regressions

* **Build time** is the earliest `started_at` among the build's runs.
* **Build order** sorts builds by build time, then by `build_id` (byte order) to break ties.
* **Current status** of a requirement is its build verdict for the latest build in build
  order whose verdict is not `no_data`. A requirement with no data in any build is `no_data`.
* **Regression.** Requirement R regressed in build B when
  `severity(build verdict of B) > severity(build verdict of P)`. P is the closest build before
  B, in build order, whose verdict for R is not `no_data`. If no such P exists, B is the first
  data for R and is not a regression. A `no_data` verdict in B is never a regression.
