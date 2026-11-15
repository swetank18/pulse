# Push API (contract v1.0)

Owner: Dev 3. Client: host collector (Dev 2). Server: Forge web trigger `pulse-ingest`
(Dev 3, `forge-app/src/backend/`).

Pushing is **optional**. The QNX side and the collector must work fully without it.

## Base URL and token

* **Base URL.** Each Forge installation has its own web trigger URL (`urlFormat: v2`), shaped
  like `https://<uuid>.webtrigger.atlassian.app/public/<id>`. Never hard-code it.
  * Development: `forge webtrigger create` (choose the installation) prints it.
  * Judges and other sites: the PULSE admin page shows it (Phase 2; see open item 2).
* **Token.** Shared secret sent in the `X-PULSE-Token` header.
  * Phase 0: one value per Forge environment, set with
    `forge variables set --encrypt PULSE_TOKEN <value>`.
  * Phase 2: a random token per installation, made on install and shown on the admin page.
    `PULSE_TOKEN` keeps working as an override in development.
* The collector reads both from its own config or environment (`PULSE_PUSH_URL`,
  `PULSE_PUSH_TOKEN`) and must never log the token.

The platform does not authenticate web trigger calls. Without the token check, anyone with the
URL could write data, so the server rejects every request without a valid token.

## Common rules

* Body: UTF-8 JSON, at most **128 KiB** (Forge KVS caps one stored value at about 240 KiB). Send `Content-Type: application/json`.
* Header names are case-insensitive. The server matches them that way.
* Every response body is JSON. Errors look like this:

```json
{ "accepted": false, "error": "schema_invalid", "detail": "tasks[0].latency_us.max: required" }
```

* `detail` is for humans. Clients branch on `error` only.

## Endpoints

### `GET {base}/health`

Checks connectivity and the token. Changes nothing.

`200` → `{ "ok": true, "schema_version": "1.0" }`

### `POST {base}/evidence`

Body: one evidence record (`evidence.schema.json`), with `anomalies` already filled in by the
collector.

| Status | Body | Meaning |
|---|---|---|
| `200` | `{ "accepted": true, "run_id": "run-0007", "duplicate": false }` | Stored. Verdicts computed. |
| `200` | `{ "accepted": true, "run_id": "run-0007", "duplicate": true }` | Same run already stored with identical content. Nothing changed. Safe to retry. |
| `400` | `error`: `invalid_json`, `schema_invalid`, `unsupported_schema_version`, or a semantic code from `verdict_rules.md` section 1 | Fix the record. Do not retry. |
| `401` | `error`: `unauthorized` | Missing or wrong token. |
| `409` | `error`: `run_exists` | A **different** record with this `run_id` is already stored. Evidence is immutable, so use a new `run_id`. |
| `413` | `error`: `too_large` | Body over 128 KiB. |
| `5xx` | any | Server or platform problem. Retry with backoff, at most 3 attempts. |

"Identical content" means equal JSON values (object key order and whitespace are ignored).

### `POST {base}/requirements`

Body: `{ "requirements": [ <requirement>, ... ] }`, at most 200 items. Each item must pass
`requirement.schema.json`. An item **replaces** the stored requirement with the same
`req_id`, or is created if none exists. Requirements missing from the list are left alone.
The call is all or nothing: one invalid item rejects the whole request.

| Status | Body |
|---|---|
| `200` | `{ "accepted": true, "upserted": 5 }` |
| `400` | `invalid_json`, `schema_invalid` (detail names the item index) |
| `401` / `413` / `5xx` | as above |

Any other method or path → `404` `{ "accepted": false, "error": "not_found" }`.

## Open items (resolve by end of Phase 0 / start of Phase 2)

1. **Static vs dynamic response.** This API needs a `dynamic` web trigger response to return
   the status codes above. Forge docs say only `static` web triggers qualify for "Runs on
   Atlassian." If the Codegeist rules or a bonus need that badge, this changes: the server
   returns a fixed `200`, and the collector confirms storage some other way. Dev 3 decides
   and announces this.
2. **Getting the URL on a judge's site.** Needs an admin page module (a manifest request from
   Dev 1) that calls the backend for `webTrigger.getUrl("pulse-ingest")` and the per-install
   token. Agree on it at the start of Phase 2.

## Example

```bash
curl -sS -X POST "$PULSE_PUSH_URL/evidence" \
  -H "Content-Type: application/json" \
  -H "X-PULSE-Token: $PULSE_PUSH_TOKEN" \
  --data-binary @run-0007.json
```
