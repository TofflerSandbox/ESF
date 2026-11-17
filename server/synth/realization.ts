/* Value from onset to delivery, and the partnership after transition (synthetic).
   - A value snapshot at every gate decision: most projects promise more early on and converge by Gate 3, some under-promise.
   - Cost to complete for active projects, by phase.
   - Realization reviews at 6, 12 and 24 months for fielded projects, with outcomes that follow what was actually delivered,
     and owned actions (R&D, sponsor, J8, J1), some overdue. */
import type { Transaction } from '@electric-sql/pglite';
import { rngFor, iso } from './util.js';

const DAY = 864e5;
const HUB_LIVE = new Date(Date.UTC(2026, 6, 1));   // realization reviews are a Hub proposal, practised from the Hub's go-live
export async function removeRealization(tx: Transaction) {
  await tx.exec(`DELETE FROM realization_review WHERE synthetic; DELETE FROM value_snapshot WHERE synthetic;
    UPDATE project SET cost_to_complete = NULL, cost_to_complete_synthetic = false WHERE cost_to_complete_synthetic;`);
}

const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };
const fyOf = (d: Date) => d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 1 : 0);
const round5k = (v: number) => Math.round(v / 5000) * 5000;
const SUMMARY: Record<string, string[]> = {
  ON_TRACK: ['Delivering to plan at {pct} of baseline. Adoption is broad and the benefit is in the owner\'s system data.', 'At {pct} of plan; no corrective action needed. Next review as scheduled.'],
  CORRECTIVE_ACTION: ['At {pct} of plan. The capability works, but adoption has stalled at some sites; actions assigned to close the gap.', 'Benefit at {pct} of plan. Owner and R&D agreed fixes and a recovery date.'],
  REBASELINE: ['At {pct} of plan. The Gate 4 baseline assumed adoption that is not happening; J8 to rebaseline against the observed curve.', 'Delivery at {pct} of plan; the value case overstated volume. Rebaseline and keep tracking.'],
  CLOSE_TRACKING: ['Value proven at {pct} of plan over two years; tracking closed and the result filed with the portfolio record.'],
  NO_REPORTS: ['No benefit reported since transition. The owner will start monthly reports from system data before the next review.'],
};
const ACTIONS: Record<string, string[]> = {
  SPONSOR: ['Roll out to the remaining sites on the agreed schedule', 'Retire the legacy process still running in parallel', 'Start monthly benefit reports from system data', 'Name a site lead at each lagging location'],
  'R&D': ['Scope a fix for the adoption blocker (contract mod or follow-on)', 'Deliver user retraining material with J1', 'Retune the model on current data', 'Fix the interface defect users reported at the 6-month review'],
  J8: ['Rebaseline the value case to the observed adoption curve', 'Validate the last two quarters of reported benefit'],
  J1: ['Targeted training at the lagging sites', 'Confirm workforce absorption at the second site'],
};

export async function seedRealization(tx: Transaction, seed: number, asOf: Date) {
  const q = <T = any>(sql: string, p: unknown[] = []) => tx.query<T>(sql, p).then(r => r.rows);

  /* ── 1. value snapshots at every synthetic gate decision ── */
  const decisions = await q(`SELECT g.id, g.project_id, g.gate, g.outcome, g.decided_at, p.esh_id,
      coalesce((SELECT sum(annual_value)::float FROM value_case v WHERE v.project_id = p.id), (SELECT annual_value::float FROM benefit_baseline b WHERE b.project_id = p.id)) annual,
      coalesce((SELECT path FROM value_case v WHERE v.project_id = p.id ORDER BY is_primary DESC, id LIMIT 1), (SELECT path FROM benefit_baseline b WHERE b.project_id = p.id)) path,
      coalesce((SELECT metric FROM value_case v WHERE v.project_id = p.id ORDER BY is_primary DESC, id LIMIT 1), (SELECT metric FROM benefit_baseline b WHERE b.project_id = p.id)) metric
    FROM gate_decision g JOIN project p ON p.id = g.project_id WHERE g.synthetic ORDER BY g.project_id, g.decided_at, g.id`);
  const funding = await q(`SELECT project_id, fy, amount::float amount FROM funding_line`);
  const fundBy = new Map<number, any[]>();
  for (const f of funding) (fundBy.get(f.project_id) ?? fundBy.set(f.project_id, []).get(f.project_id)!).push(f);
  const optimism = new Map<string, number>();
  let snaps = 0;
  for (const d of decisions) {
    if (!d.annual) continue;
    if (!optimism.has(d.esh_id)) {
      const r = rngFor(seed, 'promise:' + d.esh_id);
      const k = r.weighted([55, 30, 15]);
      optimism.set(d.esh_id, k === 0 ? r.between(1.15, 2.2) : k === 1 ? r.between(0.92, 1.12) : r.between(0.6, 0.9));
    }
    const o = optimism.get(d.esh_id)!, r = rngFor(seed, `snap:${d.esh_id}:${d.gate}:${d.id}`);
    const mult = d.gate >= 4 ? 1 : (1 + (o - 1) * Math.max(0, (3 - d.gate) / 3)) * (d.gate === 3 ? r.between(0.97, 1.03) : r.between(0.93, 1.07));
    const at = new Date(d.decided_at);
    const cost = (fundBy.get(d.project_id) ?? []).filter(f => f.fy <= fyOf(at)).reduce((a, f) => a + f.amount, 0);
    await tx.query(`INSERT INTO value_snapshot (project_id, gate, decision_id, outcome, taken_at, annual_value, path, metric, j8_certified, cost_to_date, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
      [d.project_id, d.gate, d.id, d.outcome, iso(at), Math.round(d.annual * mult / 1000) * 1000, d.path, d.metric, d.gate >= 2, cost]);
    snaps++;
  }

  /* ── 2. cost to complete for active projects ── */
  const active = await q(`SELECT p.id, p.esh_id, p.esf_phase, coalesce((SELECT sum(annual_value)::float FROM value_case v WHERE v.project_id = p.id), 0) annual,
      coalesce((SELECT sum(amount)::float FROM funding_line f WHERE f.project_id = p.id), 0) cost
    FROM project p WHERE p.esf_synthetic AND p.esf_status IN ('ACTIVE','HOLD') AND p.esf_phase < 5`);
  const FACTOR = [2.2, 1.6, 1.0, 0.55, 0.25];
  for (const p of active) {
    const r = rngFor(seed, 'ctc:' + p.esh_id);
    const ctc = round5k(Math.max(p.cost, p.annual * 0.3, 150e3) * FACTOR[p.esf_phase ?? 0] * r.between(0.7, 1.3));
    await tx.query(`UPDATE project SET cost_to_complete = $2, cost_to_complete_synthetic = true WHERE id = $1`, [p.id, ctc]);
  }

  /* ── 3. realization reviews and actions ── */
  const base = await q(`SELECT b.project_id, b.transitioned_on, p.esh_id FROM benefit_baseline b JOIN project p ON p.id = b.project_id WHERE b.synthetic`);
  const meas = await q(`SELECT project_id, period, planned::float planned, realized::float realized FROM benefit_measure`);
  let held = 0, overdue = 0, actions = 0;
  for (const b of base) {
    const t = new Date(b.transitioned_on), ms = meas.filter((m: any) => m.project_id === b.project_id);
    for (const months of [6, 12, 24]) {
      const r = rngFor(seed, `review:${b.esh_id}:${months}`);
      const due = addMonths(t, months);
      if (due.getTime() < HUB_LIVE.getTime()) continue;   // reviews began with the Hub; earlier milestones weren't missed, they didn't exist
      if (due.getTime() > asOf.getTime() || (due.getTime() > asOf.getTime() - 21 * DAY) || r.chance(0.12)) {
        if (due.getTime() <= asOf.getTime()) overdue++;
        await tx.query(`INSERT INTO realization_review (project_id, months, due_on, synthetic) VALUES ($1,$2,$3,true)`, [b.project_id, months, iso(due)]);
        continue;
      }
      const heldOn = new Date(Math.min(due.getTime() + r.int(0, 20) * DAY, asOf.getTime() - DAY));
      const upTo = ms.filter((m: any) => new Date(m.period) < due);
      const pl = upTo.reduce((a: number, m: any) => a + m.planned, 0), re = upTo.reduce((a: number, m: any) => a + m.realized, 0);
      const ratio = pl ? re / pl : null;
      const outcome = ratio == null ? 'CORRECTIVE_ACTION' : months === 24 && ratio >= 1.05 ? 'CLOSE_TRACKING' : ratio >= 0.9 ? 'ON_TRACK' : ratio >= 0.6 ? 'CORRECTIVE_ACTION' : r.chance(0.45) ? 'REBASELINE' : 'CORRECTIVE_ACTION';
      const summary = r.pick(ratio == null ? SUMMARY.NO_REPORTS : SUMMARY[outcome]).replace('{pct}', ratio == null ? '—' : `${Math.round(100 * ratio)}%`);
      const id = (await q(`INSERT INTO realization_review (project_id, months, due_on, held_on, status, outcome, realization, summary, recorded_by, synthetic) VALUES ($1,$2,$3,$4,'HELD',$5,$6,$7,$8,true) RETURNING id`,
        [b.project_id, months, iso(due), iso(heldOn), outcome, ratio, summary, 'J68 Portfolio Admin']))[0].id;
      held++;
      const owners = ratio == null ? ['SPONSOR'] : outcome === 'REBASELINE' ? ['J8', 'SPONSOR', ...(r.chance(0.5) ? ['R&D'] : [])] : outcome === 'CORRECTIVE_ACTION' ? ['SPONSOR', r.chance(0.6) ? 'R&D' : 'J1'] : [];
      for (const owner of owners) {
        const text = ratio == null && owner === 'SPONSOR' ? 'Start monthly benefit reports from system data' : r.pick(ACTIONS[owner]);
        const dueOn = new Date(heldOn.getTime() + r.int(45, 120) * DAY);
        const done = dueOn.getTime() < asOf.getTime() ? r.chance(0.55) : r.chance(0.15);
        const doneOn = done ? new Date(Math.min(dueOn.getTime() + r.int(-20, 25) * DAY, asOf.getTime() - DAY)) : null;
        await tx.query(`INSERT INTO realization_action (review_id, owner, text, due_on, status, done_on, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)`,
          [id, owner, text, iso(dueOn), done ? 'DONE' : 'OPEN', doneOn ? iso(doneOn) : null]);
        actions++;
      }
      if (outcome === 'CLOSE_TRACKING') break;
    }
  }
  console.log({ value_snapshots: snaps, cost_to_complete: active.length, reviews_held: held, reviews_overdue: overdue, review_actions: actions });
}
