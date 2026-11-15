import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handlePush, MAX_BODY_BYTES } from '../src/backend/ingest.js';

const TOKEN = 'test-token';
const sample = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'contracts', 'test_vectors', 'v001_pass_clean.json'), 'utf8'),
).evidence;

function memoryStore() {
  const data = new Map();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
}

const call = async (deps, { method = 'POST', userPath = '/evidence', token = TOKEN, headerName = 'x-pulse-token', body } = {}) => {
  const headers = { 'content-type': ['application/json'] };
  if (token !== null) headers[headerName] = [token];
  const res = await handlePush({ method, userPath, headers, body }, deps);
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

test('rejects missing and wrong tokens, and an unconfigured server token', async () => {
  const store = memoryStore();
  assert.equal((await call({ store, expectedToken: TOKEN }, { token: null })).status, 401);
  assert.equal((await call({ store, expectedToken: TOKEN }, { token: 'nope' })).status, 401);
  assert.equal((await call({ store, expectedToken: undefined }, { token: '' })).status, 401);
  assert.equal(store.data.size, 0);
});

test('token header name is case-insensitive', async () => {
  const res = await call({ store: memoryStore(), expectedToken: TOKEN }, { method: 'GET', userPath: '/health', headerName: 'X-PULSE-Token' });
  assert.deepEqual(res, { status: 200, json: { ok: true, schema_version: '1.0' } });
});

test('stores evidence, then reports identical re-posts as duplicates', async () => {
  const deps = { store: memoryStore(), expectedToken: TOKEN };
  const first = await call(deps, { body: JSON.stringify(sample) });
  assert.deepEqual(first, { status: 200, json: { accepted: true, run_id: 'run-0007', duplicate: false } });
  assert.equal(deps.store.data.get('run:run-0007').evidence.run_id, 'run-0007');

  // Same value, different key order and whitespace: still a duplicate.
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(sample).reverse()), null, 2);
  const again = await call(deps, { body: reordered });
  assert.deepEqual(again, { status: 200, json: { accepted: true, run_id: 'run-0007', duplicate: true } });
});

test('rejects a different record under an existing run_id', async () => {
  const deps = { store: memoryStore(), expectedToken: TOKEN };
  await call(deps, { body: JSON.stringify(sample) });
  const changed = { ...sample, duration_s: 61 };
  const res = await call(deps, { body: JSON.stringify(changed) });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'run_exists');
});

test('rejects bad bodies with the contract error codes', async () => {
  const deps = { store: memoryStore(), expectedToken: TOKEN };
  assert.equal((await call(deps, { body: '{nope' })).json.error, 'invalid_json');
  assert.equal((await call(deps, { body: JSON.stringify({ ...sample, schema_version: '2.0' }) })).json.error, 'unsupported_schema_version');
  assert.equal((await call(deps, { body: JSON.stringify({ ...sample, run_id: '../etc' }) })).json.error, 'schema_invalid');
  const big = await call(deps, { body: ' '.repeat(MAX_BODY_BYTES + 1) });
  assert.deepEqual([big.status, big.json.error], [413, 'too_large']);
  assert.equal(deps.store.data.size, 0);
});

test('unknown routes return 404', async () => {
  const res = await call({ store: memoryStore(), expectedToken: TOKEN }, { method: 'DELETE', userPath: '/evidence' });
  assert.deepEqual([res.status, res.json.error], [404, 'not_found']);
});
