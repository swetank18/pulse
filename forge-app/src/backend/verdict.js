// PULSE verdict engine. Implements contracts/verdict_rules.md section 3 exactly.
// Pure functions, no Forge imports, so the same code runs in Forge and in `node --test`.

export const SEVERITY = Object.freeze({ pass: 0, at_risk: 1, fail: 2 });

/**
 * Run verdict for one requirement against one (already validated) evidence record.
 * @returns {{req_id:string, run_id:string, build_id:string, status:string, reasons:string[]}}
 */
export function runVerdict(requirement, evidence) {
  const result = (status, reasons) => ({
    req_id: requirement.req_id,
    run_id: evidence.run_id,
    build_id: evidence.build_id,
    status,
    reasons,
  });

  const task = evidence.tasks.find((t) => t.task_id === requirement.task_id);
  if (!task) return result('no_data', ['task_missing']);

  const failReasons = [];
  if (task.samples === 0) failReasons.push('no_samples');
  if (task.samples > 0 && task.latency_us.max > requirement.max_latency_us) failReasons.push('latency_exceeded');
  if (task.deadline_misses > requirement.max_deadline_misses) failReasons.push('deadline_misses_exceeded');
  if (failReasons.length) return result('fail', failReasons);

  // Integer-only comparison, so JS and Python agree at every boundary.
  const riskReasons = [];
  if (task.latency_us.max * 100 >= requirement.max_latency_us * (100 - requirement.at_risk_margin_pct)) {
    riskReasons.push('near_limit');
  }
  if (evidence.anomalies.some((a) => a.task_id === requirement.task_id)) riskReasons.push('anomaly');
  if (riskReasons.length) return result('at_risk', riskReasons);

  return result('pass', []);
}
