/* Portfolio return on investment, in two lenses.

   PROSPECTIVE — the active portfolio (active or on hold, not yet at scale). Value comes from each project's
   value cases (annual value by path), risk-adjusted by the chance a project in its current phase reaches scale,
   taken from the portfolio's own gate pass rates. Measured against what those projects have cost so far.

   REALIZED — projects in the enterprise (at scale). At Gate 4 the value case is frozen as a baseline; each month the
   sponsor reports the benefit actually delivered and J8 validates it quarterly. Realized ROI = benefit delivered to
   date ÷ what the project cost. Realization = delivered ÷ planned (the baseline on its adoption ramp).

   Cost is every funding line recorded: J68 R&D and sponsor money, all years. Exits are reported on their own:
   their cost is the price of the portfolio's learning, and the whole-program view carries it. */
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';

const PATHS = ['COST', 'RISK', 'PERFORMANCE', 'REVENUE'] as const;
const ACTIVE = ['ACTIVE', 'HOLD'];
const MONTH = 30.44 * 864e5;
const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

/** Realized status from the share of planned benefit delivered and whether the sponsor is still reporting. */
export const REAL_STATUS: Record<string, { l: string; c: string }> = {
  EXCEEDING: { l: 'Exceeding plan', c: '#1F6E4A' },
  ON_TRACK: { l: 'On track', c: '#2F7D5C' },
  BEHIND: { l: 'Behind plan', c: '#C9A961' },
  AT_RISK: { l: 'At risk', c: '#CE0F3E' },
  SILENT: { l: 'Not reporting', c: '#8A8378' },
  NEW: { l: 'Too early to tell', c: '#7FA7D6' },
};

export async function roiData(db: PGlite, horizon: number) {
  const q = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);
  const [projects, funding, values, gates, baselines, measures] = await Promise.all([
    q(`SELECT p.id, p.esh_id, p.title, p.program_code, pr.name program_name, p.element_code, p.esf_phase, p.esf_status, pe.name pm,
         (SELECT string_agg(o.name, ' · ' ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsors
       FROM project p LEFT JOIN person pe ON pe.id = p.pm_id LEFT JOIN program pr ON pr.code = p.program_code`),
    q(`SELECT project_id, (source ILIKE 'J68%') j68, sum(amount)::float amt FROM funding_line GROUP BY 1, 2`),
    q(`SELECT project_id, path, is_primary, annual_value::float v, j8_certified, synthetic FROM value_case`),
    q(`SELECT gate, outcome, count(*)::int n FROM gate_decision GROUP BY 1, 2`),
    q(`SELECT b.project_id, b.transitioned_on, b.annual_value::float annual, b.path, b.metric, o.id owner_id, o.name owner, b.synthetic
       FROM benefit_baseline b LEFT JOIN org o ON o.id = b.owner_org_id`),
    q(`SELECT project_id, period, planned::float planned, realized::float realized, method, note FROM benefit_measure ORDER BY project_id, period`),
  ]);

  /* chance of reaching scale from each phase = product of the remaining gates' pass rates */
  const rate = (g: number) => {
    const n = (o: string) => gates.find((x: any) => x.gate === g && x.outcome === o)?.n ?? 0;
    const pass = n('PASS'), stop = n('SUNSET') + n('DESCOPE');
    return pass + stop ? pass / (pass + stop) : 1;
  };
  const gateRates = [0, 1, 2, 3, 4].map(rate);
  const pScale = [0, 1, 2, 3, 4, 5].map(ph => gateRates.slice(ph).reduce((a, r) => a * r, 1));

  const costOf = new Map<number, { j68: number; sponsor: number }>();
  for (const f of funding) { const c = costOf.get(f.project_id) ?? { j68: 0, sponsor: 0 }; f.j68 ? (c.j68 += f.amt) : (c.sponsor += f.amt); costOf.set(f.project_id, c); }
  const valOf = new Map<number, { annual: number; certified: number; path: string | null; synthetic: boolean }>();
  for (const v of values) {
    const x = valOf.get(v.project_id) ?? { annual: 0, certified: 0, path: null, synthetic: false };
    x.annual += v.v ?? 0; if (v.j8_certified) x.certified += v.v ?? 0; if (v.is_primary || !x.path) x.path = v.path; x.synthetic ||= v.synthetic;
    valOf.set(v.project_id, x);
  }
  const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);
  const base = (p: any) => {
    const c = costOf.get(p.id) ?? { j68: 0, sponsor: 0 };
    return { esh_id: p.esh_id, title: p.title, program_code: p.program_code, program_name: p.program_name, element_code: p.element_code, pm: p.pm, sponsors: p.sponsors,
      status: p.esf_status, j68: c.j68, sponsor: c.sponsor, cost: c.j68 + c.sponsor };
  };

  /* ── prospective: the active portfolio ── */
  const prospective = projects.filter((p: any) => ACTIVE.includes(p.esf_status)).map((p: any) => {
    const b = base(p), v = valOf.get(p.id), annual = v?.annual ?? 0, prob = pScale[p.esf_phase ?? 0];
    const value = annual * horizon, riskAdj = value * prob;
    return { ...b, phase: p.esf_phase, path: v?.path ?? null, annual, certified: v?.certified ?? 0, value, prob, riskAdj,
      net: riskAdj - b.cost, multiple: b.cost ? riskAdj / b.cost : null, synthetic: !!v?.synthetic };
  });
  const exited = projects.filter((p: any) => ['SUNSET', 'DESCOPED'].includes(p.esf_status)).map(base);
  const pCost = sum(prospective, 'cost'), pValue = sum(prospective, 'value'), pRisk = sum(prospective, 'riskAdj'), pAnnual = sum(prospective, 'annual');
  const summary = {
    horizon, totalCost: pCost, j68: sum(prospective, 'j68'), sponsor: sum(prospective, 'sponsor'),
    exitCost: sum(exited, 'cost'), exits: exited.length,
    annual: pAnnual, certifiedAnnual: sum(prospective, 'certified'), value: pValue, riskAdj: pRisk,
    multiple: pCost ? pValue / pCost : null, riskMultiple: pCost ? pRisk / pCost : null,
    net: pRisk - pCost, withValue: prospective.filter(r => r.annual > 0).length, liveCount: prospective.length,
  };
  const byPath = PATHS.map(path => {
    const rs = prospective.filter(r => r.path === path), cost = sum(rs, 'cost');
    return { path, n: rs.length, annual: sum(rs, 'annual'), value: sum(rs, 'value'), riskAdj: sum(rs, 'riskAdj'), cost, certified: sum(rs, 'certified'),
      multiple: cost ? sum(rs, 'riskAdj') / cost : null };
  });
  const byPhase = [0, 1, 2, 3, 4].map(ph => {
    const rs = prospective.filter(r => r.phase === ph);
    return { phase: ph, n: rs.length, cost: sum(rs, 'cost'), value: sum(rs, 'value'), riskAdj: sum(rs, 'riskAdj'), prob: pScale[ph] };
  });

  /* ── realized: projects in the enterprise ── */
  const asOfMonth = new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth(), 1));
  const byProj = new Map<number, any[]>();
  for (const m of measures) { m.period = iso(m.period); (byProj.get(m.project_id) ?? byProj.set(m.project_id, []).get(m.project_id)!).push(m); }
  const pById = new Map(projects.map((p: any) => [p.id, p]));
  const realized = baselines.filter((b: any) => pById.has(b.project_id)).map((bl: any) => {
    const p = pById.get(bl.project_id), b = base(p), ms = byProj.get(bl.project_id) ?? [];
    const planned = sum(ms, 'planned'), got = sum(ms, 'realized');
    const last = ms[ms.length - 1];
    const silentMonths = last ? Math.round((asOfMonth.getTime() - new Date(last.period).getTime()) / MONTH) - 1 : null;
    const recent = ms.slice(-3), runRate = recent.length ? 12 * sum(recent, 'realized') / recent.length : 0;
    const realization = planned ? got / planned : null;
    const months = Math.max(0, Math.round((AS_OF.getTime() - new Date(bl.transitioned_on).getTime()) / MONTH));
    const status = !ms.length ? (months <= 2 ? 'NEW' : 'SILENT')
      : (silentMonths ?? 0) >= 3 ? 'SILENT'
      : ms.length < 3 ? 'NEW'
      : realization! >= 1.1 ? 'EXCEEDING' : realization! >= 0.9 ? 'ON_TRACK' : realization! >= 0.6 ? 'BEHIND' : 'AT_RISK';
    const validated = sum(ms.filter((m: any) => m.method === 'J8'), 'realized');
    return {
      ...b, path: bl.path, metric: bl.metric, owner: bl.owner, owner_id: bl.owner_id, transitioned_on: iso(bl.transitioned_on), months,
      baselineAnnual: bl.annual, planned, realized: got, realization, runRate, reports: ms.length, lastReport: last?.period ?? null, silentMonths,
      validatedShare: got ? validated / got : null, roi: b.cost ? got / b.cost : null, net: got - b.cost,
      payback: got >= b.cost ? 0 : runRate ? (b.cost - got) / runRate : null,
      status, note: [...ms].reverse().find((m: any) => m.note)?.note ?? null,
      series: ms.map((m: any) => ({ m: m.period.slice(0, 7), planned: m.planned, realized: m.realized, method: m.method })),
      synthetic: bl.synthetic,
    };
  });
  // the enterprise ledger, month by month over the last two years
  const months: string[] = [];
  for (let i = 23; i >= 0; i--) months.push(new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
  let cumP = 0, cumR = 0;
  const before = measures.filter((m: any) => m.period.slice(0, 7) < months[0]);
  cumP = sum(before, 'planned'); cumR = sum(before, 'realized');
  const ledger = months.map(m => {
    const ms = measures.filter((x: any) => x.period.slice(0, 7) === m);
    cumP += sum(ms, 'planned'); cumR += sum(ms, 'realized');
    return { m, planned: sum(ms, 'planned'), realized: sum(ms, 'realized'), cumPlanned: cumP, cumRealized: cumR, reporting: ms.length };
  });
  const rCost = sum(realized, 'cost'), rGot = sum(realized, 'realized'), rPlan = sum(realized, 'planned');
  const statusCount = Object.fromEntries(Object.keys(REAL_STATUS).map(k => [k, realized.filter(r => r.status === k).length]));
  const allCost = sum(projects.map(base), 'cost');
  const realizedSummary = {
    n: realized.length, cost: rCost, realized: rGot, planned: rPlan, realization: rPlan ? rGot / rPlan : null,
    roi: rCost ? rGot / rCost : null, runRate: sum(realized, 'runRate'), baselineAnnual: sum(realized, 'baselineAnnual'),
    validatedShare: rGot ? sum(realized.map(r => ({ v: (r.validatedShare ?? 0) * r.realized })), 'v') / rGot : null,
    status: statusCount, paidBack: realized.filter(r => r.payback === 0).length,
    programCost: allCost, programRoi: allCost ? rGot / allCost : null,
  };
  const realizedByPath = PATHS.map(path => {
    const rs = realized.filter(r => r.path === path);
    return { path, n: rs.length, realized: sum(rs, 'realized'), planned: sum(rs, 'planned'), cost: sum(rs, 'cost'), runRate: sum(rs, 'runRate') };
  });

  return {
    asOf: AS_OF.toISOString().slice(0, 10), horizon,
    summary, byPath, byPhase, gateRates, pScale,
    projects: prospective.sort((a, b) => b.net - a.net),
    exited: { n: exited.length, cost: summary.exitCost },
    realized: { summary: realizedSummary, byPath: realizedByPath, ledger, projects: realized.sort((a, b) => b.realized - a.realized), status: REAL_STATUS },
    synthetic: prospective.some(r => r.synthetic) || realized.some(r => r.synthetic),
  };
}
