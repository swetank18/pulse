// PULSE push API handler core (contracts/push_api.md).
// Platform-independent: storage and the expected token are injected, so this runs under
// `node --test` with an in-memory store and in Forge with KVS (see index.js).
//
// Phase 0 scope: token check, routing, size limit, JSON parse, schema_version and run_id
// checks, immutable storage with duplicate detection.
// TODO(Phase 2): full evidence.schema.json + semantic validation, verdict computation on
// ingest, POST /requirements.

import { createHash, timingSafeEqual } from 'node:crypto';

export const SCHEMA_VERSION = '1.0';
export const MAX_BODY_BYTES = 128 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(payload),
});
const reject = (statusCode, error, detail) =>
  respond(statusCode, detail ? { accepted: false, error, detail } : { accepted: false, error });

/** Case-insensitive header lookup. Forge passes header values as string arrays. */
export function getHeader(request, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function tokenMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length === 0) return false;
  // Hash both sides so timingSafeEqual always compares equal-length buffers.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** JSON with object keys sorted, so equal values serialise identically. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const runKey = (runId) => `run:${runId}`;

/**
 * @param {object} request Forge web trigger request: { method, userPath, headers, body }
 * @param {{ store: { get(k): Promise<any>, set(k, v): Promise<void> }, expectedToken: string|undefined, now?: () => Date }} deps
 */
export async function handlePush(request, deps) {
  const method = (request.method ?? '').toUpperCase();
  const path = (request.userPath ?? '').replace(/\/+$/, '');

  if (!tokenMatches(getHeader(request, 'X-PULSE-Token'), deps.expectedToken)) {
    return reject(401, 'unauthorized');
  }

  if (method === 'GET' && path === '/health') {
    return respond(200, { ok: true, schema_version: SCHEMA_VERSION });
  }
  if (method === 'POST' && path === '/evidence') {
    return ingestEvidence(request.body ?? '', deps);
  }
  if (method === 'POST' && path === '/requirements') {
    return reject(501, 'not_implemented', 'POST /requirements arrives in Phase 2');
  }
  return reject(404, 'not_found');
}

async function ingestEvidence(body, deps) {
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return reject(413, 'too_large');

  let evidence;
  try {
    evidence = JSON.parse(body);
  } catch (err) {
    return reject(400, 'invalid_json', err.message);
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || evidence.schema_version !== SCHEMA_VERSION) {
    return reject(400, 'unsupported_schema_version', `expected schema_version "${SCHEMA_VERSION}"`);
  }
  if (typeof evidence.run_id !== 'string' || !ID_PATTERN.test(evidence.run_id)) {
    return reject(400, 'schema_invalid', 'run_id: missing or does not match the id pattern');
  }

  const hash = createHash('sha256').update(canonicalJson(evidence)).digest('hex');
  const key = runKey(evidence.run_id);
  const existing = await deps.store.get(key);
  if (existing) {
    if (existing.hash === hash) return respond(200, { accepted: true, run_id: evidence.run_id, duplicate: true });
    return reject(409, 'run_exists', `run_id ${evidence.run_id} is already stored with different content`);
  }

  const receivedAt = (deps.now?.() ?? new Date()).toISOString();
  await deps.store.set(key, { hash, received_at: receivedAt, evidence });
  return respond(200, { accepted: true, run_id: evidence.run_id, duplicate: false });
}
