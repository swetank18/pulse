// Forge entry points for the PULSE backend. Keep platform wiring here and logic in
// sibling modules so it stays testable with `node --test`.

import { kvs } from '@forge/kvs';
import { handlePush } from './ingest.js';

/** Web trigger `pulse-ingest` (manifest.yml). See contracts/push_api.md. */
export async function ingest(request) {
  try {
    return await handlePush(request, {
      store: kvs,
      // Phase 0: one token per Forge environment (forge variables set --encrypt PULSE_TOKEN ...).
      // Phase 2: per-installation token from kvs.getSecret, with PULSE_TOKEN as a dev override.
      expectedToken: process.env.PULSE_TOKEN,
    });
  } catch (err) {
    console.error('pulse-ingest failed', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': ['application/json'] },
      body: JSON.stringify({ accepted: false, error: 'internal' }),
    };
  }
}
