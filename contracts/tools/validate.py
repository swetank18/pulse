#!/usr/bin/env python3
"""Validate PULSE contract files.

Usage:
  python3 contracts/tools/validate.py evidence FILE...      # evidence records
  python3 contracts/tools/validate.py requirement FILE...   # requirement records (object or list)
  python3 contracts/tools/validate.py vectors [DIR]         # test vector files (default: contracts/test_vectors)

Evidence checks follow verdict_rules.md section 1, in order, and print the first error code.
Vector checks confirm each file is well formed: verdict cases carry valid evidence and
requirements; rejection cases fail with exactly the expected error code. This tool does NOT
compute verdicts. Each implementation (collector, Forge backend) runs the vectors itself.

Needs: pip install jsonschema   (4.x)
Exit code: 0 if everything is valid, 1 otherwise.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, RefResolver
except ImportError:  # pragma: no cover
    sys.exit("validate.py needs jsonschema: pip install jsonschema")

CONTRACTS = Path(__file__).resolve().parent.parent
SCHEMAS = {
    "evidence": CONTRACTS / "evidence.schema.json",
    "requirement": CONTRACTS / "requirement.schema.json",
    "vector": CONTRACTS / "test_vectors" / "vector.schema.json",
}
_loaded = {name: json.loads(path.read_text()) for name, path in SCHEMAS.items()}
_store = {schema["$id"]: schema for schema in _loaded.values()}


def _validator(name):
    schema = _loaded[name]
    return Draft202012Validator(schema, resolver=RefResolver(schema["$id"], schema, store=_store))


VALIDATORS = {name: _validator(name) for name in _loaded}


def _first_schema_error(name, doc):
    errors = sorted(VALIDATORS[name].iter_errors(doc), key=lambda e: list(e.absolute_path))
    if not errors:
        return None
    err = errors[0]
    where = "/".join(str(p) for p in err.absolute_path) or "(root)"
    return f"{where}: {err.message}"


def _is_rfc3339_utc(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
        return True
    except ValueError:
        return False


def check_evidence(doc):
    """Return (error_code, detail) or (None, None). Order matches verdict_rules.md section 1."""
    if not isinstance(doc, dict) or doc.get("schema_version") != "1.0":
        return "unsupported_schema_version", f"schema_version={doc.get('schema_version') if isinstance(doc, dict) else None!r}"
    detail = _first_schema_error("evidence", doc)
    if detail:
        return "schema_invalid", detail
    if not _is_rfc3339_utc(doc["started_at"]):
        return "schema_invalid", "started_at: must be an ISO 8601 UTC timestamp ending in Z"

    task_ids = [t["task_id"] for t in doc["tasks"]]
    seen = set()
    for tid in task_ids:
        if tid in seen:
            return "duplicate_task_id", tid
        seen.add(tid)
    for t in doc["tasks"]:
        lat = t["latency_us"]
        if t["samples"] == 0:
            if lat is not None or t["jitter_us"] != 0:
                return "latency_samples_mismatch", f"{t['task_id']}: samples 0 needs latency_us null and jitter_us 0"
        elif lat is None:
            return "latency_samples_mismatch", f"{t['task_id']}: samples > 0 needs a latency_us object"
    for t in doc["tasks"]:
        lat = t["latency_us"]
        if lat is not None and not (lat["min"] <= lat["p50"] <= lat["p99"] <= lat["max"]):
            return "latency_order", f"{t['task_id']}: {lat}"
    for a in doc["anomalies"]:
        if a["task_id"] not in seen:
            return "anomaly_unknown_task", a["task_id"]
    for tid in doc.get("trace", {}).get("task_ids", []):
        if tid not in seen:
            return "trace_unknown_task", tid
    return None, None


def check_requirement(doc):
    return _first_schema_error("requirement", doc)


def check_vector(doc):
    """Return a list of problems with one vector file."""
    detail = _first_schema_error("vector", doc)
    if detail:
        return [f"vector shape: {detail}"]
    problems = []
    code, detail = check_evidence(doc["evidence"])
    if "expected_error" in doc:
        if code != doc["expected_error"]:
            problems.append(f"expected error {doc['expected_error']}, validator says {code} ({detail})")
        return problems
    if code:
        problems.append(f"evidence invalid: {code} ({detail})")
    req_ids = [r["req_id"] for r in doc["requirements"]]
    if len(set(req_ids)) != len(req_ids):
        problems.append("duplicate req_id in requirements")
    if sorted(e["req_id"] for e in doc["expected"]) != sorted(req_ids):
        problems.append("expected must list exactly one entry per requirement")
    return problems


def _load(path):
    try:
        return json.loads(Path(path).read_text()), None
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"invalid_json ({exc})"


def main(argv):
    if len(argv) < 2 or argv[1] not in ("evidence", "requirement", "vectors"):
        print(__doc__)
        return 2
    mode, args = argv[1], argv[2:]
    failed = 0

    if mode == "vectors":
        folder = Path(args[0]) if args else CONTRACTS / "test_vectors"
        files = sorted(p for p in folder.glob("*.json") if p.name != "vector.schema.json")
        for path in files:
            doc, err = _load(path)
            problems = [err] if err else check_vector(doc)
            status = "ok  " if not problems else "FAIL"
            print(f"{status} {path.name}" + "".join(f"\n       {p}" for p in problems))
            failed += bool(problems)
        print(f"\n{len(files) - failed}/{len(files)} vector files valid")
        return 1 if failed or not files else 0

    for path in args:
        doc, err = _load(path)
        if err:
            print(f"FAIL {path}: {err}")
            failed += 1
            continue
        if mode == "evidence":
            code, detail = check_evidence(doc)
            msg = f"{code}: {detail}" if code else None
        else:
            items = doc if isinstance(doc, list) else [doc]
            msg = next((f"[{i}] {d}" for i, d in enumerate(map(check_requirement, items)) if d), None)
        print(f"FAIL {path}: {msg}" if msg else f"ok   {path}")
        failed += bool(msg)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
