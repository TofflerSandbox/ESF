/* Value from onset to delivery, and the partnership after transition.

   - Every gate decision freezes the value case and what the project has cost (value_snapshot), so the promise can be traced
     from Gate 0 to Gate 4 and then against what is actually delivered ("promise drift" and forecast accuracy).
   - Passing Gate 4 freezes the baseline the Realized ROI view tracks, and schedules realization reviews at 6, 12 and 24 months.
   - Each month the operational owner (the sponsor) reports the benefit delivered; J8 validates it.
   - Realization reviews record an outcome and owned actions: R&D, the sponsor, J8 or J1. R&D's role doesn't end at transition. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { z } from 'zod';
import { audit } from './db/db.js';
import { AS_OF } from './config.js';
import { roiData, REAL_STATUS } from './roi.js';

type Q = PGlite | Transaction;
/** Share of full annual value expected in each of the first six months after go-live; full value from month seven. */
export const RAMP = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
export const REVIEW_MONTHS = [6, 12, 24];
export const OUTCOME: Record<string, { l: string; c: string }> = {
  ON_TRACK: { l: 'On track', c: '#2F7D5C' }, CORRECTIVE_ACTION: { l: 'Corrective action', c: '#C9A961' },
  REBASELINE: { l: 'Rebaseline', c: '#D9822B' }, CLOSE_TRACKING: { l: 'Value proven; tracking closed', c: '#1F6E4A' },
};
export const ACTION_OWNER: Record<string, string> = { 'R&D': 'R&D (J68 and the PM)', SPONSOR: 'Sponsor / operational owner', J8: 'J8 Finance', J1: 'J1 Human Capital' };

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const addMonths = (d: string, m: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return iso(x); };
const monthIndex = (transitioned: string, period: string) => {
  const t = new Date(transitioned + 'T00:00:00Z'), p = new Date(period + 'T00:00:00Z');
  return (p.getUTCFullYear() - t.getUTCFullYear()) * 12 + p.getUTCMonth() - t.getUTCMonth() - 1;   // 0 = first full month after transition
};
export const plannedFor = (annual: number, i: number) => Math.round((annual / 12) * (RAMP[i] ?? 1));

/** Freeze the value case and cost at a gate decision. */
export async function snapshotValue(q: Q, projectId: number, gate: number, decisionId: number | null, outcome: string, date: string, synthetic = false) {
  const v = (await q.query<any>(`SELECT sum(annual_value)::float annual, bool_or(j8_certified) cert,
      (SELECT path FROM value_case x WHERE x.project_id = $1 ORDER BY is_primary DESC, id LIMIT 1) path,
      (SELECT metric FROM value_case x WHERE x.project_id = $1 ORDER BY is_primary DESC, id LIMIT 1) metric
    FROM value_case WHERE project_id = $1`, [projectId])).rows[0];
  const fy = new Date(date + 'T00:00:00Z').getUTCMonth() >= 9 ? new Date(date + 'T00:00:00Z').getUTCFullYear() + 1 : new Date(date + 'T00:00:00Z').getUTCFullYear();
  const cost = (await q.query<any>(`SELECT coalesce(sum(amount),0)::float c FROM funding_line WHERE project_id = $1 AND fy <= $2`, [projectId, fy])).rows[0].c;
  const ctc = (await q.query<any>(`SELECT cost_to_complete::float c FROM project WHERE id = $1`, [projectId])).rows[0]?.c ?? null;
  await q.query(`INSERT INTO value_snapshot (project_id, gate, decision_id, outcome, taken_at, annual_value, path, metric, j8_certified, cost_to_date, cost_to_complete, synthetic)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [projectId, gate, decisionId, outcome, date, v.annual, v.path, v.metric, !!v.cert, cost, ctc, synthetic]);
}

/** Passing Gate 4: freeze the baseline the Realized view tracks and schedule the realization reviews. */
export async function onGate4Pass(q: Q, projectId: number, date: string, synthetic = false) {
  const v = (await q.query<any>(`SELECT sum(annual_value)::float annual,
      (SELECT path FROM value_case x WHERE x.project_id = $1 ORDER BY is_primary DESC, id LIMIT 1) path,
      (SELECT metric FROM value_case x WHERE x.project_id = $1 ORDER BY is_primary DESC, id LIMIT 1) metric,
      coalesce((SELECT receiver_org_id FROM transition_pathway t WHERE t.project_id = $1 AND t.receiver_org_id IS NOT NULL ORDER BY CASE t.status WHEN 'ACTIVE' THEN 0 ELSE 1 END LIMIT 1),
               (SELECT org_id FROM project_org po WHERE po.project_id = $1 AND po.role = 'SPONSOR' ORDER BY org_id LIMIT 1)) owner
    FROM value_case WHERE project_id = $1`, [projectId])).rows[0];
  if (v.annual && v.path)
    await q.query(`INSERT INTO benefit_baseline (project_id, transitioned_on, annual_value, path, metric, owner_org_id, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (project_id) DO NOTHING`, [projectId, date, v.annual, v.path, v.metric, v.owner, synthetic]);
  for (const m of REVIEW_MONTHS)
    await q.query(`INSERT INTO realization_review (project_id, months, due_on, synthetic) VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, months) DO NOTHING`, [projectId, m, addMonths(date, m), synthetic]);
  return { baseline: !!(v.annual && v.path) };
}

type Deps = {
  wrap: (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
  requireRole: (u: any, ...roles: any[]) => void; canEdit: (u: any, p: any) => boolean;
  projectByEsh: (q: Q, esh: string) => Promise<Record<string, any>>; HttpError: new (s: number, m: string) => Error;
};

export function registerRealization(app: FastifyInstance, db: PGlite, h: Deps) {
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);
  /** The sponsor seat of the project's sponsoring organization or of the baseline's owner (or the admin). */
  const isOwner = async (x: Q, u: any, projectId: number) => u.role === 'ADMIN' || (u.role === 'SPONSOR' && u.org_id != null && (await x.query(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM project_org WHERE project_id=$1 AND org_id=$2 AND role='SPONSOR') OR EXISTS (SELECT 1 FROM benefit_baseline WHERE project_id=$1 AND owner_org_id=$2)`,
    [projectId, u.org_id])).rows.length > 0);
  const requireOwner = async (x: Q, u: any, p: any) => { if (!(await isOwner(x, u, p.id))) throw new h.HttpError(403, `Only ${p.esh_id}'s operational owner (sponsor seat) or the admin can do this`); };

  /* ── one project's realization record ── */
  app.get('/api/projects/:esh/realization', h.wrap(async (req, me) => {
    const p = await h.projectByEsh(db, (req.params as any).esh);
    const [baseline, measures, reviews, actions, snaps] = await Promise.all([
      q(`SELECT b.*, b.annual_value::float annual, o.name owner FROM benefit_baseline b LEFT JOIN org o ON o.id = b.owner_org_id WHERE b.project_id = $1`, [p.id]),
      q(`SELECT period, planned::float planned, realized::float realized, method, note, synthetic FROM benefit_measure WHERE project_id = $1 ORDER BY period`, [p.id]),
      q(`SELECT * FROM realization_review WHERE project_id = $1 ORDER BY months`, [p.id]),
      q(`SELECT a.* FROM realization_action a JOIN realization_review r ON r.id = a.review_id WHERE r.project_id = $1 ORDER BY a.due_on`, [p.id]),
      q(`SELECT gate, outcome, taken_at, annual_value::float annual, path, metric, j8_certified, cost_to_date::float cost, cost_to_complete::float ctc, synthetic FROM value_snapshot WHERE project_id = $1 ORDER BY taken_at, id`, [p.id]),
    ]);
    const b = baseline[0] ?? null;
    const asOfMonth = iso(new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth(), 1)));
    let nextPeriod: string | null = null;
    if (b) {
      const reported = new Set(measures.map((m: any) => iso(m.period)));
      for (let k = 1; k < 120; k++) { const per = addMonths(iso(b.transitioned_on).slice(0, 7) + '-01', k); if (per >= asOfMonth) break; if (!reported.has(per)) { nextPeriod = per; break; } }
    }
    const owner = await isOwner(db, me, p.id);
    return {
      baseline: b && { ...b, transitioned_on: iso(b.transitioned_on) }, nextPeriod,
      measures: measures.map((m: any) => ({ ...m, period: iso(m.period) })),
      reviews: reviews.map((r: any) => ({ ...r, due_on: iso(r.due_on), held_on: r.held_on ? iso(r.held_on) : null, actions: actions.filter((a: any) => a.review_id === r.id).map((a: any) => ({ ...a, due_on: iso(a.due_on), done_on: a.done_on ? iso(a.done_on) : null })) })),
      snapshots: snaps.map((s: any) => ({ ...s, taken_at: iso(s.taken_at) })),
      costToComplete: p.cost_to_complete != null ? Number(p.cost_to_complete) : null, costToCompleteSynthetic: p.cost_to_complete_synthetic,
      canReport: owner, canReview: owner, canValidate: ['ADMIN', 'AUTHORITY'].includes(me.role), canEditCost: h.canEdit(me, p),
      canAct: owner || h.canEdit(me, p) || me.role === 'J1', outcomes: OUTCOME, owners: ACTION_OWNER, asOf: iso(AS_OF),
    };
  }));

  /* ── the operational owner's monthly benefit report ── */
  const Report = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), realized: z.number().nonnegative().max(1e10), method: z.enum(['SYSTEM', 'SPONSOR']), note: z.string().max(1000).nullable().optional() }).strict();
  app.post('/api/projects/:esh/benefits', h.wrap(async (req, me) => {
    const b = Report.parse(req.body);
    return db.transaction(async tx => {
      const p = await h.projectByEsh(tx, (req.params as any).esh);
      await requireOwner(tx, me, p);
      const bl = (await tx.query<any>(`SELECT transitioned_on, annual_value::float annual FROM benefit_baseline WHERE project_id = $1`, [p.id])).rows[0];
      if (!bl) throw new h.HttpError(409, 'No Gate 4 baseline yet: benefit is reported after the project transitions');
      const period = b.period + '-01', i = monthIndex(iso(bl.transitioned_on), period);
      if (i < 0) throw new h.HttpError(400, `Reports start the month after transition (${iso(bl.transitioned_on).slice(0, 7)})`);
      if (period >= iso(new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth(), 1)))) throw new h.HttpError(400, 'A month can be reported once it has ended');
      const prior = (await tx.query<any>(`SELECT method, realized FROM benefit_measure WHERE project_id = $1 AND period = $2`, [p.id, period])).rows[0];
      if (prior?.method === 'J8') throw new h.HttpError(409, 'J8 has validated this month; it can no longer be changed');
      const planned = plannedFor(bl.annual, i);
      await tx.query(`INSERT INTO benefit_measure (project_id, period, planned, realized, method, note) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (project_id, period) DO UPDATE SET realized = EXCLUDED.realized, method = EXCLUDED.method, note = EXCLUDED.note, synthetic = false`,
        [p.id, period, planned, b.realized, b.method, b.note ?? null]);
      await audit(tx, me.name, 'project', p.esh_id, 'BENEFIT_REPORT', prior ?? null, { period: b.period, planned, realized: b.realized, method: b.method });
      return { ok: true, planned };
    });
  }));
  // J8 validation (recorded by the admin or a gate authority until J8 has its own seat)
  app.post('/api/projects/:esh/benefits/:period/validate', h.wrap(async (req, me) => {
    h.requireRole(me, 'ADMIN', 'AUTHORITY');
    return db.transaction(async tx => {
      const p = await h.projectByEsh(tx, (req.params as any).esh);
      const period = String((req.params as any).period).slice(0, 7) + '-01';
      const r = await tx.query(`UPDATE benefit_measure SET method = 'J8' WHERE project_id = $1 AND period = $2 AND method <> 'J8'`, [p.id, period]);
      if (!r.affectedRows) throw new h.HttpError(404, 'No unvalidated report for that month');
      await audit(tx, me.name, 'project', p.esh_id, 'BENEFIT_VALIDATE', null, { period: period.slice(0, 7) });
      return { ok: true };
    });
  }));

  /* ── realization reviews and their actions ── */
  const Hold = z.object({
    outcome: z.enum(['ON_TRACK', 'CORRECTIVE_ACTION', 'REBASELINE', 'CLOSE_TRACKING']), summary: z.string().min(3).max(4000),
    actions: z.array(z.object({ owner: z.enum(['R&D', 'SPONSOR', 'J8', 'J1']), text: z.string().min(3).max(500), due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()).max(10).default([]),
  }).strict();
  app.post('/api/projects/:esh/reviews/:id/hold', h.wrap(async (req, me) => {
    const b = Hold.parse(req.body);
    return db.transaction(async tx => {
      const p = await h.projectByEsh(tx, (req.params as any).esh);
      await requireOwner(tx, me, p);
      const r = (await tx.query<any>(`SELECT * FROM realization_review WHERE id = $1 AND project_id = $2`, [Number((req.params as any).id), p.id])).rows[0];
      if (!r) throw new h.HttpError(404, 'No such review');
      if (r.status === 'HELD') throw new h.HttpError(409, 'This review has already been held');
      if ((b.outcome === 'CORRECTIVE_ACTION' || b.outcome === 'REBASELINE') && !b.actions.length) throw new h.HttpError(400, 'Corrective action or a rebaseline needs at least one owned action');
      const m = (await tx.query<any>(`SELECT sum(planned)::float pl, sum(realized)::float re FROM benefit_measure WHERE project_id = $1`, [p.id])).rows[0];
      const today = iso(new Date());
      await tx.query(`UPDATE realization_review SET status='HELD', held_on=$2, outcome=$3, summary=$4, realization=$5, recorded_by=$6 WHERE id=$1`,
        [r.id, today, b.outcome, b.summary, m.pl ? m.re / m.pl : null, me.name]);
      for (const a of b.actions) await tx.query(`INSERT INTO realization_action (review_id, owner, text, due_on) VALUES ($1,$2,$3,$4)`, [r.id, a.owner, a.text, a.due_on]);
      if (b.outcome === 'CLOSE_TRACKING') await tx.query(`DELETE FROM realization_review WHERE project_id = $1 AND status = 'SCHEDULED' AND months > $2`, [p.id, r.months]);
      await audit(tx, me.name, 'project', p.esh_id, 'REALIZATION_REVIEW', null, { months: r.months, outcome: b.outcome, actions: b.actions.length });
      return { ok: true };
    });
  }));
  app.post('/api/actions/:id/done', h.wrap(async (req, me) => {
    return db.transaction(async tx => {
      const a = (await tx.query<any>(`SELECT a.*, p.esh_id FROM realization_action a JOIN realization_review r ON r.id = a.review_id JOIN project p ON p.id = r.project_id WHERE a.id = $1`, [Number((req.params as any).id)])).rows[0];
      if (!a) throw new h.HttpError(404, 'No such action');
      const p = await h.projectByEsh(tx, a.esh_id);
      const ok = me.role === 'ADMIN' || (a.owner === 'J1' && me.role === 'J1') || (a.owner === 'R&D' && h.canEdit(me, p)) || ((a.owner === 'SPONSOR' || a.owner === 'J8') && await isOwner(tx, me, p.id));
      if (!ok) throw new h.HttpError(403, `This action belongs to ${ACTION_OWNER[a.owner]}`);
      await tx.query(`UPDATE realization_action SET status='DONE', done_on=$2 WHERE id=$1`, [a.id, iso(new Date())]);
      await audit(tx, me.name, 'project', p.esh_id, 'REALIZATION_ACTION_DONE', { status: a.status }, { action: a.text, owner: a.owner });
      return { ok: true };
    });
  }));

  /* ── cost to complete (PM's estimate) ── */
  app.put('/api/projects/:esh/cost-to-complete', h.wrap(async (req, me) => {
    const b = z.object({ amount: z.number().nonnegative().max(1e10).nullable() }).strict().parse(req.body);
    return db.transaction(async tx => {
      const p = await h.projectByEsh(tx, (req.params as any).esh);
      if (!h.canEdit(me, p)) throw new h.HttpError(403, `${me.name} cannot edit ${p.esh_id}`);
      await tx.query(`UPDATE project SET cost_to_complete = $2, cost_to_complete_synthetic = false WHERE id = $1`, [p.id, b.amount]);
      await audit(tx, me.name, 'project', p.esh_id, 'COST_TO_COMPLETE', { cost_to_complete: p.cost_to_complete }, b);
      return { ok: true };
    });
  }));

  /* ── the realization page: reviews due, outcomes, actions by owner ── */
  app.get('/api/realization', h.wrap(async () => {
    const roi = await roiData(db, 5);
    const [reviews, actions] = await Promise.all([
      q(`SELECT r.*, p.esh_id, p.title, p.program_code, o.name owner FROM realization_review r JOIN project p ON p.id = r.project_id
         LEFT JOIN benefit_baseline b ON b.project_id = p.id LEFT JOIN org o ON o.id = b.owner_org_id ORDER BY r.due_on`),
      q(`SELECT a.*, r.months, p.esh_id, p.title, o.name org FROM realization_action a JOIN realization_review r ON r.id = a.review_id JOIN project p ON p.id = r.project_id
         LEFT JOIN benefit_baseline b ON b.project_id = p.id LEFT JOIN org o ON o.id = b.owner_org_id ORDER BY a.due_on`),
    ]);
    const today = iso(AS_OF), soon = iso(new Date(AS_OF.getTime() + 90 * 864e5));
    const rv = reviews.map((r: any) => ({ ...r, due_on: iso(r.due_on), held_on: r.held_on ? iso(r.held_on) : null, realization: r.realization != null ? Number(r.realization) : null }));
    const ac = actions.map((a: any) => ({ ...a, due_on: iso(a.due_on), done_on: a.done_on ? iso(a.done_on) : null, overdue: a.status === 'OPEN' && iso(a.due_on) < today }));
    const fielded = roi.realized.projects;
    const lastMonth = iso(new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth() - 1, 1))).slice(0, 7);
    return {
      asOf: today, outcomes: OUTCOME, owners: ACTION_OWNER, status: REAL_STATUS,
      overdue: rv.filter((r: any) => r.status === 'SCHEDULED' && r.due_on < today),
      upcoming: rv.filter((r: any) => r.status === 'SCHEDULED' && r.due_on >= today && r.due_on <= soon),
      held: rv.filter((r: any) => r.status === 'HELD').sort((a: any, b: any) => b.held_on.localeCompare(a.held_on)),
      actions: ac.filter((a: any) => a.status === 'OPEN'),
      actionsDone: ac.filter((a: any) => a.status === 'DONE').length,
      totals: {
        fielded: fielded.length, reportedLastMonth: fielded.filter((f: any) => (f.lastReport ?? '').slice(0, 7) === lastMonth).length,
        outcomes: Object.fromEntries(Object.keys(OUTCOME).map(k => [k, rv.filter((r: any) => r.outcome === k).length])),
        openByOwner: Object.fromEntries(Object.keys(ACTION_OWNER).map(k => [k, ac.filter((a: any) => a.status === 'OPEN' && a.owner === k).length])),
        overdueActions: ac.filter((a: any) => a.overdue).length,
      },
    };
  }));

  /* ── Stage 5, the enterprise view: who runs each fielded capability now, how it is paid for, whether it delivers, whether people use it ── */
  app.get('/api/enterprise', h.wrap(async () => {
    const roi = await roiData(db, 5);
    const [ps, paths, adoption, reviews, actions, workforce] = await Promise.all([
      q(`SELECT p.id, p.esh_id, p.title, p.program_code, p.element_code, p.esf_phase, p.esf_status, p.esf_source,
           (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsor_list,
           b.transitioned_on, b.owner_org_id, bo.name baseline_owner
         FROM project p LEFT JOIN benefit_baseline b ON b.project_id = p.id LEFT JOIN org bo ON bo.id = b.owner_org_id
         WHERE p.esf_status = 'AT_SCALE'`),
      q(`SELECT DISTINCT ON (t.project_id) t.project_id, t.path, t.status, t.funding_line, t.pom_fy, t.receiver_org_id, o.name receiver
         FROM transition_pathway t LEFT JOIN org o ON o.id = t.receiver_org_id ORDER BY t.project_id, CASE t.status WHEN 'ACTIVE' THEN 0 WHEN 'COMMITTED' THEN 1 ELSE 2 END`),
      q(`SELECT DISTINCT ON (project_id) project_id, day, adoption_pct FROM adoption_measure ORDER BY project_id, day DESC`),
      q(`SELECT project_id, months, due_on FROM realization_review WHERE status = 'SCHEDULED' ORDER BY due_on`),
      q(`SELECT r.project_id, count(*)::int n, count(*) FILTER (WHERE a.due_on < $1)::int overdue FROM realization_action a JOIN realization_review r ON r.id = a.review_id WHERE a.status = 'OPEN' GROUP BY 1`, [iso(AS_OF)]),
      q(`SELECT project_id, sum(headcount)::int people FROM workforce_impact GROUP BY 1`),
    ]);
    const by = <T,>(rows: any[], k = 'project_id') => new Map<number, T>(rows.map((r: any) => [r[k], r]));
    const pathOf = by<any>(paths), adoptOf = by<any>(adoption), actOf = by<any>(actions), peopleOf = by<any>(workforce);
    const nextOf = new Map<number, any>(); for (const r of reviews) if (!nextOf.has(r.project_id)) nextOf.set(r.project_id, r);
    const realOf = new Map(roi.realized.projects.map((r: any) => [r.esh_id, r]));
    const today = iso(AS_OF);
    const rows = ps.map((p: any) => {
      const t = pathOf.get(p.id), r: any = realOf.get(p.esh_id), a = adoptOf.get(p.id), nx = nextOf.get(p.id), ac = actOf.get(p.id);
      // who runs it now: the first organization outside R&D named as the pathway's receiver, the baseline's owner, or a sponsor; J68 only if nobody else is
      const rd = (n: string | null | undefined) => !!n && /J68/.test(n);
      const cands = [t?.receiver_org_id ? { id: t.receiver_org_id, name: t.receiver } : null, p.owner_org_id ? { id: p.owner_org_id, name: p.baseline_owner } : null, ...(p.sponsor_list ?? [])].filter(Boolean) as { id: number; name: string }[];
      const op = cands.find(c => !rd(c.name)) ?? cands[0] ?? null;
      const since = p.transitioned_on ? iso(p.transitioned_on) : null;
      return {
        esh_id: p.esh_id, title: p.title, program_code: p.program_code, element_code: p.element_code, esf_phase: p.esf_phase, esf_status: p.esf_status, esf_source: p.esf_source,
        operator: op, since, months: since ? Math.max(0, Math.round((AS_OF.getTime() - new Date(since).getTime()) / (30.44 * 864e5))) : null,
        path: t?.path ?? null, funding_line: t?.funding_line ?? null, pom_fy: t?.pom_fy ?? null,
        valuePath: r?.path ?? null, baselineAnnual: r?.baselineAnnual ?? null, realized: r?.realized ?? null, planned: r?.planned ?? null, realization: r?.realization ?? null,
        runRate: r?.runRate ?? null, status: r?.status ?? null, lastReport: r?.lastReport ?? null, note: r?.note ?? null,
        adoption: a ? { day: a.day, pct: a.adoption_pct } : null, people: peopleOf.get(p.id)?.people ?? null,
        nextReview: nx ? { months: nx.months, due: iso(nx.due_on), overdue: iso(nx.due_on) < today } : null,
        openActions: ac?.n ?? 0, overdueActions: ac?.overdue ?? 0,
      };
    });
    const sum = (xs: any[], k: string) => xs.reduce((s, x) => s + (x[k] ?? 0), 0);
    const opMap = new Map<number, any>();
    for (const r of rows) if (r.operator) {
      const o = opMap.get(r.operator.id) ?? opMap.set(r.operator.id, { id: r.operator.id, name: r.operator.name, n: 0, realized: 0, planned: 0, runRate: 0, atRisk: 0 }).get(r.operator.id)!;
      o.n++; o.realized += r.realized ?? 0; o.planned += r.planned ?? 0; o.runRate += r.runRate ?? 0; if (['AT_RISK', 'SILENT'].includes(r.status)) o.atRisk++;
    }
    const adopt = rows.filter(r => r.adoption).map(r => r.adoption!.pct).sort((a, b) => a - b);
    const soon = iso(new Date(AS_OF.getTime() + 90 * 864e5));
    return {
      asOf: today, rows, status: REAL_STATUS,
      operators: [...opMap.values()].map(o => ({ ...o, realization: o.planned ? o.realized / o.planned : null })).sort((a, b) => b.n - a.n),
      funding: { WCF: rows.filter(r => r.path === 'A_WCF').length, POM: rows.filter(r => r.path === 'B_POM').length, NONE: rows.filter(r => !r.path).length },
      totals: {
        n: rows.length, operators: opMap.size, realized: sum(rows, 'realized'), planned: sum(rows, 'planned'), runRate: sum(rows, 'runRate'), baseline: sum(rows, 'baselineAnnual'),
        medianAdoption: adopt.length ? adopt[adopt.length >> 1] : null, measured: adopt.length, people: sum(rows, 'people'),
        attention: rows.filter(r => ['AT_RISK', 'SILENT'].includes(r.status ?? '') || r.nextReview?.overdue || r.overdueActions).length,
        reviewsDue: rows.filter(r => r.nextReview && r.nextReview.due <= soon).length,
      },
    };
  }));

  /* ── promise drift: how each project's value claim moved from gate to gate, and against delivery ── */
  app.get('/api/value-drift', h.wrap(async () => {
    const roi = await roiData(db, 5);
    const snaps = await q(`SELECT s.project_id, p.esh_id, p.title, p.program_code, s.gate, s.annual_value::float annual, s.taken_at FROM value_snapshot s JOIN project p ON p.id = s.project_id
      WHERE s.annual_value IS NOT NULL ORDER BY s.project_id, s.taken_at, s.id`);
    const byP = new Map<string, any>();
    for (const s of snaps) { const x = byP.get(s.esh_id) ?? byP.set(s.esh_id, { esh_id: s.esh_id, title: s.title, program_code: s.program_code, gates: {} as Record<number, number> }).get(s.esh_id)!; x.gates[s.gate] = s.annual; }
    const real = new Map(roi.realized.projects.map((r: any) => [r.esh_id, r]));
    const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    // fielded projects: Gate 2 promise → Gate 4 baseline → run rate today (only where three months of reports exist)
    const fielded = [...byP.values()].filter(x => real.has(x.esh_id) && x.gates[2] != null).map(x => {
      const r: any = real.get(x.esh_id);
      const run = r.reports >= 3 && r.months >= 9 ? r.runRate : null;   // only once the last three months are past the adoption ramp
      return { ...x, promise: x.gates[2], baseline: r.baselineAnnual, runRate: run, owner: r.owner, status: r.status,
        promiseToBaseline: x.gates[2] ? r.baselineAnnual / x.gates[2] : null, accuracy: run != null && x.gates[2] ? run / x.gates[2] : null };
    });
    const ratios = (k: string) => fielded.map((f: any) => f[k]).filter((v: any) => v != null) as number[];
    // every project: the first claim against the latest
    const all = [...byP.values()].map(x => { const gs = Object.keys(x.gates).map(Number).sort((a, b) => a - b); const first = x.gates[gs[0]], last = x.gates[gs[gs.length - 1]];
      return { ...x, firstGate: gs[0], lastGate: gs[gs.length - 1], first, last, drift: first ? last / first : null }; }).filter(x => x.firstGate !== x.lastGate);
    const byGate = [0, 1, 2, 3, 4].map(g => { const xs = [...byP.values()].filter(x => x.gates[g] != null && x.gates[4] != null && real.has(x.esh_id)).map(x => x.gates[g] / x.gates[4]); return { gate: g, n: xs.length, vsBaseline: median(xs) }; });
    const groupBy = (key: (f: any) => string | null) => {
      const m = new Map<string, any[]>(); for (const f of fielded) { const k = key(f); if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(f); }
      return [...m.entries()].map(([k, fs]) => {
        const withRun = fs.filter(f => f.runRate != null);
        const promise = withRun.reduce((a, f) => a + f.promise, 0), run = withRun.reduce((a, f) => a + f.runRate, 0);
        return { k, n: fs.length, promise: fs.reduce((a, f) => a + f.promise, 0), baseline: fs.reduce((a, f) => a + f.baseline, 0), runRate: run, accuracy: promise ? run / promise : null };
      }).sort((a, b) => b.promise - a.promise);
    };
    return {
      fielded: fielded.sort((a, b) => (a.accuracy ?? 9) - (b.accuracy ?? 9)),
      totals: {
        n: fielded.length, promise: fielded.reduce((a, f) => a + f.promise, 0), baseline: fielded.reduce((a, f) => a + f.baseline, 0),
        runRate: fielded.reduce((a, f) => a + (f.runRate ?? 0), 0), promiseWithRun: fielded.filter(f => f.runRate != null).reduce((a, f) => a + f.promise, 0),
        medianPromiseToBaseline: median(ratios('promiseToBaseline')), medianAccuracy: median(ratios('accuracy')),
        medianDrift: median(all.map(x => x.drift).filter((v): v is number => v != null)), tracked: all.length,
      },
      byGate, byOwner: groupBy(f => f.owner), byProgram: groupBy(f => f.program_code),
    };
  }));
}
