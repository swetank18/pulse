// Runs every verdict case in contracts/test_vectors/ against the Forge verdict engine.
// Rejection cases (x*.json) need the Phase 2 evidence validator and are skipped until then.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runVerdict } from '../src/backend/verdict.js';

const VECTORS = join(import.meta.dirname, '..', '..', 'contracts', 'test_vectors');
const files = readdirSync(VECTORS).filter((f) => f.endsWith('.json') && f !== 'vector.schema.json').sort();

for (const file of files) {
  const vector = JSON.parse(readFileSync(join(VECTORS, file), 'utf8'));
  if ('expected_error' in vector) {
    test(`${vector.name} (rejection)`, { skip: 'evidence validator lands in Phase 2' }, () => {});
    continue;
  }
  test(vector.name, () => {
    for (const expected of vector.expected) {
      const requirement = vector.requirements.find((r) => r.req_id === expected.req_id);
      const got = runVerdict(requirement, vector.evidence);
      assert.deepEqual(
        { status: got.status, reasons: got.reasons },
        { status: expected.status, reasons: expected.reasons },
        `${file}: ${expected.req_id}`,
      );
    }
  });
}
