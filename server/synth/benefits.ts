/* Realized benefit after transition (synthetic).
   For every project at scale: freeze its value case as the Gate 4 baseline, then report each month since —
   planned benefit on a standard adoption ramp against what was realized. Projects get a performance profile
   (on track, exceeding, under-delivering, failing) and some stop reporting, so tracking has something to find.
   At-scale projects with no value case get a synthetic baseline sized from what they cost. */
import type { Transaction } from '@electric-sql/pglite';
import { rngFor, iso } from './util.js';

const RAMP = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];   // share of full value in the first six months after go-live
const PROFILES = [
  { k: 'on track', w: 40, lo: 0.88, hi: 1.12 },
  { k: 'exceeding', w: 18, lo: 1.15, hi: 1.55 },
  { k: 'under', w: 30, lo: 0.5, hi: 0.84 },
  { k: 'failing', w: 12, lo: 0.12, hi: 0.42 },
];
const UNDER = [
  'Adoption slower than planned at two of five sites.',
  'Legacy process still running in parallel; savings only partly captured.',
  'Unit cost higher than the value case assumed.',
  'Sustainment funding gap delayed the full rollout.',
  'Benefit partly counted by another program; reported net.',
  'Workforce retraining took longer than planned.',
];
const OVER = [
  'Adopted by an additional MSC beyond the plan.',
  'Usage above plan after the policy change.',
  'Savings compounding with a related process change.',
];
const METRIC: Record<string, string> = {
  COST: 'Annual cost avoided', RISK: 'Annual risk exposure reduced', PERFORMANCE: 'Readiness / throughput gain (valued)', REVENUE: 'Annual WCF revenue enabled',
};

export async function removeBenefits(tx: Transaction) {
  await tx.exec('DELETE FROM benefit_measure WHERE synthetic; DELETE FROM benefit_baseline WHERE synthetic;');
}

const mStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextM = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

export async function seedBenefits(tx: Transaction, seed: number, asOf: Date) {
  const rows = (await tx.query<any>(`
    SELECT p.id, p.esh_id,
      (SELECT max(decided_at) FROM gate_decision g WHERE g.project_id = p.id AND g.gate = 4 AND g.outcome = 'PASS') g4,
      (SELECT max(entered_at) FROM phase_record r WHERE r.project_id = p.id AND r.phase = 5) entered5,
      (SELECT sum(annual_value)::float FROM value_case v WHERE v.project_id = p.id) annual,
      (SELECT path FROM value_case v WHERE v.project_id = p.id ORDER BY is_primary DESC, id LIMIT 1) path,
      (SELECT metric FROM value_case v WHERE v.project_id = p.id ORDER BY is_primary DESC, id LIMIT 1) metric,
      (SELECT sum(amount)::float FROM funding_line f WHERE f.project_id = p.id) cost,
      (SELECT po.org_id FROM project_org po WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY po.org_id LIMIT 1) owner
    FROM project p WHERE p.esf_status = 'AT_SCALE'`)).rows;
  const current = mStart(asOf);            // the current month isn't reported yet
  let base = 0, meas = 0;
  for (const p of rows) {
    const r = rngFor(seed, 'benefit:' + p.esh_id);
    let annual = p.annual, path = p.path, metric = p.metric;
    if (!annual || !path) {
      path = ['COST', 'PERFORMANCE', 'RISK', 'REVENUE'][r.weighted([45, 25, 20, 10])];
      annual = Math.round((p.cost ? p.cost * r.between(0.2, 0.7) : r.between(2e5, 2.5e6)) / 1000) * 1000;
      metric = METRIC[path];
    }
    const t = p.g4 ? new Date(p.g4) : p.entered5 ? new Date(p.entered5) : new Date(asOf.getTime() - r.int(200, 900) * 864e5);
    if (!p.cost) {
      // no funding on record: the R&D that got it to scale, in the two or three fiscal years before transition
      const fy0 = t.getUTCFullYear() + (t.getUTCMonth() >= 9 ? 1 : 0), years = r.int(2, 3), total = annual * r.between(0.9, 2.6);
      for (let i = years; i >= 1; i--) {
        const amt = Math.round(total / years * r.between(0.7, 1.3) / 5000) * 5000;
        await tx.query(`INSERT INTO funding_line (project_id, fy, appropriation, source, amount, synthetic) VALUES ($1,$2,$3,'J68 R&D',$4,true)`, [p.id, fy0 - i, i > 1 ? 'RDT&E BA3' : 'RDT&E BA6', amt]);
      }
    }
    await tx.query(`INSERT INTO benefit_baseline (project_id, transitioned_on, annual_value, path, metric, owner_org_id, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [p.id, iso(t), annual, path, metric, p.owner]);
    base++;
    const prof = PROFILES[r.weighted(PROFILES.map(x => x.w))];
    const factor = r.between(prof.lo, prof.hi);
    const silent = r.chance(0.13) ? r.int(3, 6) : 0;       // months without a report before as-of
    const months: Date[] = [];
    for (let m = nextM(mStart(t)); m < current; m = nextM(m)) months.push(m);
    const reported = silent ? months.slice(0, Math.max(0, months.length - silent)) : months;
    for (let i = 0; i < reported.length; i++) {
      const planned = (annual / 12) * (RAMP[i] ?? 1);
      const drift = prof.k === 'failing' ? Math.max(0.5, 1 - 0.02 * i) : prof.k === 'exceeding' ? Math.min(1.2, 1 + 0.008 * i) : 1;
      const realized = Math.max(0, planned * factor * drift * r.between(0.88, 1.12));
      const age = reported.length - i;                     // J8 validates a quarter after the fact
      const method = age > 3 ? (r.chance(0.65) ? 'J8' : r.chance(0.5) ? 'SYSTEM' : 'SPONSOR') : (r.chance(0.4) ? 'SYSTEM' : 'SPONSOR');
      const note = i === reported.length - 1 ? (prof.k === 'under' || prof.k === 'failing' ? r.pick(UNDER) : prof.k === 'exceeding' ? r.pick(OVER) : null) : null;
      await tx.query(`INSERT INTO benefit_measure (project_id, period, planned, realized, method, note, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [p.id, iso(reported[i]), Math.round(planned), Math.round(realized), method, note]);
      meas++;
    }
  }
  console.log({ benefit_baselines: base, benefit_measures: meas });
}
