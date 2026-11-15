#!/usr/bin/env bash
# Push one evidence record to the PULSE web trigger (contracts/push_api.md).
#
#   PULSE_PUSH_URL=https://<uuid>.webtrigger.atlassian.app/public/<id> \
#   PULSE_PUSH_TOKEN=... \
#   forge-app/scripts/push.sh path/to/evidence.json      # POST /evidence
#   forge-app/scripts/push.sh --health                   # GET  /health
set -euo pipefail

: "${PULSE_PUSH_URL:?set PULSE_PUSH_URL to the web trigger URL (forge webtrigger create)}"
: "${PULSE_PUSH_TOKEN:?set PULSE_PUSH_TOKEN to the value of the PULSE_TOKEN Forge variable}"
base="${PULSE_PUSH_URL%/}"

if [[ "${1:-}" == "--health" ]]; then
  curl -sS -w '\nHTTP %{http_code}\n' -H "X-PULSE-Token: ${PULSE_PUSH_TOKEN}" "${base}/health"
  exit
fi

file="${1:?usage: push.sh EVIDENCE.json | --health}"
curl -sS -w '\nHTTP %{http_code}\n' -X POST "${base}/evidence" \
  -H "Content-Type: application/json" \
  -H "X-PULSE-Token: ${PULSE_PUSH_TOKEN}" \
  --data-binary @"${file}"
