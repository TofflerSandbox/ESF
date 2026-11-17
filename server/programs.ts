/* The portfolio by program (SUBNET, AM, BATTNET …): one page per program, same layout for all, built from the same
   calculations as the portfolio-wide pages (ROI lenses, gate readiness, transition readiness, exits). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { EXIT_REASONS, PHASES } from './domain.js';
import { roiData } from './roi.js';
import { gatesData } from './analysis.js';
import { transitionReadiness } from './ownership.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
const PATHS = ['COST', 'RISK', 'PERFORMANCE', 'REVENUE'] as const;
const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);

async function base(db: PGlite) {
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);
  const [programs, projects, funding, exits, sponsors] = await Promise.all([
    q(`SELECT pr.code, pr.name, pr.element_code FROM program pr ORDER BY pr.code`),
    q(`SELECT p.id, p.esh_id, p.title, p.program_code, p.element_code, p.esf_phase, p.esf_status, p.esf_source, p.status_code, p.pop_end, pe.name pm,
         (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsor_list
       FROM project p LEFT JOIN person pe ON pe.id = p.pm_id`),
    q(`SELECT f.project_id, f.fy, (f.source ILIKE 'J68%') j68, f.amount::float amount FROM funding_line f`),
    q(`SELECT g.project_id, g.gate, g.exit_reason FROM gate_decision g WHERE g.outcome IN ('SUNSET','DESCOPE')`),
    q(`SELECT po.project_id, o.id, o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.role = 'SPONSOR'`),
  ]);
  const [roi, gates, trans] = await Promise.all([roiData(db, 5), gatesData(db), transitionReadiness(db)]);
  return { programs, projects, funding, exits, sponsors, roi, gates, trans };
}

/** One program's numbers, from the shared datasets. */
function summarize(B: Awaited<ReturnType<typeof base>>, code: string) {
  const ps = B.projects.filter((p: any) => p.program_code === code);
  const ids = new Set(ps.map((p: any) => p.id)), eshs = new Set(ps.map((p: any) => p.esh_id));
  const live = ps.filter((p: any) => ['ACTIVE', 'HOLD'].includes(p.esf_status));
  const scale = ps.filter((p: any) => p.esf_status === 'AT_SCALE');
  const exited = ps.filter((p: any) => ['SUNSET', 'DESCOPED'].includes(p.esf_status));
  const fund = B.funding.filter((f: any) => ids.has(f.project_id));
  const pros = B.roi.projects.filter((r: any) => r.program_code === code);
  const real = B.roi.realized.projects.filter((r: any) => r.program_code === code);
  const pCost = sum(pros, 'cost'), pRisk = sum(pros, 'riskAdj'), pCtc = sum(pros, 'ctc');
  const rCost = sum(real, 'cost'), rGot = sum(real, 'realized'), rPlan = sum(real, 'planned');
  const gp = B.gates.gates.map((g: any) => g.projects.filter((x: any) => eshs.has(x.esh_id)));
  return {
    ps, live, scale, exited, fund, pros, real,
    row: {
      code, projects: ps.length, live: live.length, atScale: scale.length, exits: exited.length,
      invested: sum(fund, 'amount'), j68: sum(fund.filter((f: any) => f.j68), 'amount'),
      annual: sum(pros, 'annual'), riskAdj: pRisk, multiple: pCost ? pRisk / pCost : null, fullMultiple: pCost + pCtc ? pRisk / (pCost + pCtc) : null,
      realized: rGot, planned: rPlan, realization: rPlan ? rGot / rPlan : null, backPerDollar: rCost ? rGot / rCost : null,
      ready: gp.reduce((a: number, xs: any[]) => a + xs.filter((x: any) => x.ready).length, 0),
      unconfirmed: ps.filter((p: any) => p.esf_source === 'SUGGESTED').length,
    },
    gp,
  };
}

export function registerPrograms(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap; HttpError: new (s: number, m: string) => Error }) {
  app.get('/api/programs', deps.wrap(async () => {
    const B = await base(db);
    const rows = B.programs.map((pr: any) => ({ ...summarize(B, pr.code).row, name: pr.name, element_code: pr.element_code })).filter((r: any) => r.projects > 0);
    const none = B.projects.filter((p: any) => !p.program_code).length;
    return { rows, unassigned: none };
  }));

  app.get('/api/programs/:code', deps.wrap(async req => {
    const code = String((req.params as any).code).toUpperCase();
    const B = await base(db);
    const pr = B.programs.find((p: any) => p.code === code);
    if (!pr) throw new deps.HttpError(404, `No program ${code}`);
    const S = summarize(B, code);
    const all = B.programs.map((p: any) => summarize(B, p.code).row).filter((r: any) => r.projects > 0);
    const rank = (k: string) => { const xs = all.filter((r: any) => r[k] != null).sort((a: any, b: any) => b[k] - a[k]); const i = xs.findIndex((r: any) => r.code === code); return i < 0 ? null : { pos: i + 1, of: xs.length }; };

    const phases = [0, 1, 2, 3, 4, 5].map(ph => ({ phase: ph, name: PHASES[ph].short,
      n: ph === 5 ? S.scale.length : S.live.filter((p: any) => p.esf_phase === ph).length }));
    const fys = [...new Set(S.fund.map((f: any) => f.fy))].sort() as number[];
    const byFy = fys.map(fy => ({ fy, j68: sum(S.fund.filter((f: any) => f.fy === fy && f.j68), 'amount'), sponsor: sum(S.fund.filter((f: any) => f.fy === fy && !f.j68), 'amount') }));
    const byPath = PATHS.map(path => {
      const rs = S.pros.filter((r: any) => r.path === path), re = S.real.filter((r: any) => r.path === path);
      return { path, n: rs.length, annual: sum(rs, 'annual'), riskAdj: sum(rs, 'riskAdj'), cost: sum(rs, 'cost'), realized: sum(re, 'realized'), planned: sum(re, 'planned'), fielded: re.length };
    });
    const STAGES = ['preparing', 'nearly', 'ready', 'hold'];
    const gateRows = B.gates.gates.map((g: any, i: number) => ({ gate: g.gate, name: g.name, from_name: g.from_name, to_name: g.to_name,
      ...Object.fromEntries(STAGES.map(s => [s, S.gp[i].filter((x: any) => x.stage === s).length])), late: S.gp[i].filter((x: any) => x.late).length, working: S.gp[i].length }));
    const trans = B.trans.rows.filter((r: any) => r.program_code === code);
    const readiness = Object.keys(B.trans.readiness).map(k => ({ k, ...B.trans.readiness[k], n: trans.filter((r: any) => r.readiness === k).length }));
    const spons = new Map<number, any>();
    for (const s of B.sponsors) if (S.ps.some((p: any) => p.id === s.project_id)) {
      const p = S.ps.find((x: any) => x.id === s.project_id);
      const o = spons.get(s.id) ?? spons.set(s.id, { id: s.id, name: s.name, live: 0, atScale: 0, all: 0 }).get(s.id)!;
      o.all++; if (['ACTIVE', 'HOLD'].includes(p.esf_status)) o.live++; if (p.esf_status === 'AT_SCALE') o.atScale++;
    }
    const exitReasons = Object.entries(EXIT_REASONS).map(([k, l]) => ({ k, l, n: B.exits.filter((e: any) => e.exit_reason === k && S.ps.some((p: any) => p.id === e.project_id)).length })).filter(x => x.n);
    const valueOf = new Map(S.pros.map((r: any) => [r.esh_id, r]));
    const realOf = new Map(S.real.map((r: any) => [r.esh_id, r]));
    const transOf = new Map(trans.map((r: any) => [r.esh_id, r]));
    const stageOf = new Map<string, any>(); B.gates.gates.forEach((g: any, i: number) => S.gp[i].forEach((x: any) => stageOf.set(x.esh_id, { gate: g.gate, ...x })));
    return {
      program: pr, row: S.row, rank: { live: rank('live'), riskAdj: rank('riskAdj'), realization: rank('realization') },
      phases, byFy, byPath, gates: gateRows, readiness, sponsors: [...spons.values()].sort((a, b) => b.live - a.live || b.all - a.all), exitReasons,
      realizedStatus: Object.fromEntries(Object.keys(B.roi.realized.status).map(k => [k, S.real.filter((r: any) => r.status === k).length])), statusMap: B.roi.realized.status,
      projects: S.ps.map((p: any) => {
        const v: any = valueOf.get(p.esh_id), r: any = realOf.get(p.esh_id), t: any = transOf.get(p.esh_id), g: any = stageOf.get(p.esh_id);
        return { esh_id: p.esh_id, title: p.title, esf_phase: p.esf_phase, esf_status: p.esf_status, esf_source: p.esf_source, status_code: p.status_code, pm: p.pm, sponsor_list: p.sponsor_list,
          annual: v?.annual ?? null, multiple: v?.multiple ?? null, realization: r?.realization ?? null, realStatus: r?.status ?? null,
          readiness: t?.readiness ?? null, gateStage: g ? { gate: g.gate, stage: g.stage, done: g.done, total: g.total } : null };
      }),
    };
  }));
}
