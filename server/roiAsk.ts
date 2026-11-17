/* "Ask about ROI": plain-English questions over the two ROI lenses, answered on this machine.
   A question is read for
     lens      prospective (active portfolio) or realized (in the enterprise), or both
     filters   value path, realized status, program, sponsor, and a topic ("inventory", "batteries") via the portfolio search
     shape     group by program / path / phase / sponsor, or rank (top / worst N by a metric)
   then the matching projects are summed and the answer is written from the numbers. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import { roiData, REAL_STATUS } from './roi.js';
import { runAssist } from './assist.js';
import { PHASES } from './domain.js';

type Lens = 'prospective' | 'realized' | 'both';
const PATH_L: Record<string, string> = { COST: 'cost savings', RISK: 'risk reduction', PERFORMANCE: 'performance', REVENUE: 'revenue' };

const $ = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3)}K` : `${s}$${Math.round(a)}`;
};
const pc = (v: number | null) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const xx = (v: number | null) => (v == null ? '—' : `${v.toFixed(v >= 10 ? 0 : 2)}×`);
/** A return under 1× reads better as cents per dollar. */
const back = (v: number | null) => (v == null ? '—' : v < 1 ? `${Math.round(100 * v)}¢ back per dollar` : `$${v.toFixed(2)} back per dollar`);
const mon = (p: string | null) => (p ? new Date(p.slice(0, 7) + '-15').toLocaleString('en-US', { month: 'short', year: 'numeric' }) : 'never');
const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);

/** Words that are about ROI itself, not a topic; removed before the topic search. */
const ROI_WORDS = ('roi return returns returned returning investment investments invested value valued benefit benefits money dollar dollars '
  + 'portfolio portfolios project projects program programs what whats which how much many is are was were did do does have has been our the a an of in on for to from by with and or '
  + 'show me tell give list top best worst highest lowest biggest largest smallest most least weakest strongest overall total so far to date since '
  + 'realized realised actual actually delivered delivering achieved fielded transitioned enterprise scale production tracking tracked track '
  + 'projected expected forecast forecasted potential prospective pipeline active future risk adjusted riskadjusted multiple multiples payback paid back '
  + 'getting got make making made generate generating generated performing perform doing compared against plan planned vs versus each per across '
  + 'year years yearly annual annually month months now today currently current where who why when should could would will going we us it its this that these those').split(/\s+/);

function parse(q: string) {
  const s = ' ' + q.toLowerCase().replace(/[’']/g, '').replace(/[?.,!]/g, ' ') + ' ';
  const has = (re: RegExp) => re.test(s);
  const realizedHit = has(/\b(realized|realised|actual(ly)?|deliver(ed|ing)|achiev(ed|ing)|fielded|transitioned|in the enterprise|at scale|in production|tracking|paid (back|for itself)|broke even|reporting|on track|behind|exceed|under-?deliver|underperform|ahead of plan|so far|to date|since transition)\b/);
  const prospectiveHit = has(/\b(projected|expected|forecast(ed)?|potential|prospective|pipeline|active portfolio|active projects|will (return|deliver)|future|risk[- ]?adjusted|in development|in the pipeline)\b/);
  const lens: Lens = realizedHit && !prospectiveHit ? 'realized' : prospectiveHit && !realizedHit ? 'prospective' : 'both';

  let status: string[] | null = null, statusL = '';
  if (has(/\b(not reporting|stopped reporting|silent|missing reports?|no reports?|stale|gone quiet)\b/)) { status = ['SILENT']; statusL = 'not reporting'; }
  else if (has(/\b(at risk|failing|in trouble)\b/)) { status = ['AT_RISK']; statusL = 'at risk'; }
  else if (has(/\b(behind|under-?deliver\w*|underperform\w*|short of|shortfall|lagging|missing (its|their) (plan|target)s?|not delivering)\b/)) { status = ['BEHIND', 'AT_RISK']; statusL = 'behind plan'; }
  else if (has(/\b(exceed\w*|beat\w*|ahead of plan|over-?deliver\w*|outperform\w*)\b/)) { status = ['EXCEEDING']; statusL = 'exceeding plan'; }
  else if (has(/\bon track\b/)) { status = ['ON_TRACK']; statusL = 'on track'; }
  const paidBack = has(/\b(paid (back|for itself|for themselves)|broke even|break[- ]even|recouped)\b/);

  let path: string | null = null;
  if (has(/\b(cost (savings?|avoidance|reduction)|savings|save money|saved money|cheaper|cost path)\b/)) path = 'COST';
  else if (has(/\b(risk reduction|reduc(e|ed|ing) risk|lower risk|risk path)\b/)) path = 'RISK';
  else if (has(/\b(readiness|throughput|performance)\b/)) path = 'PERFORMANCE';
  else if (has(/\b(revenue|income)\b/)) path = 'REVENUE';

  const group = has(/\b(by|per|each|across) (program|programs)\b/) ? 'program'
    : has(/\b(by|per|each) (value )?(path|type of value)\b/) || has(/\bvalue paths?\b/) ? 'path'
    : has(/\b(by|per|each) phase\b/) ? 'phase'
    : has(/\b(by|per|each) (sponsor|owner|msc|customer)s?\b/) ? 'sponsor' : null;

  const nM = s.match(/\b(top|bottom|worst|best|first) (\d{1,2})\b/);
  const n = nM ? Number(nM[2]) : 5;
  const asc = has(/\b(worst|lowest|least|weakest|bottom|smallest|poorest)\b/);
  const rank = asc || has(/\b(top|best|highest|biggest|largest|most|strongest|leading)\b/);
  const metric = has(/\b(roi|return on|multiple|per dollar|bang for)\b/) ? 'ratio'
    : has(/\b(realization|against plan|vs plan|versus plan|of plan)\b/) ? 'realization'
    : has(/\bpayback\b/) ? 'payback'
    : has(/\b(cost|spent|spend|invested|expensive)\b/) && !path ? 'cost' : 'value';
  return { s, lens, status, statusL, paidBack, path, group, n, asc, rank, metric };
}

export async function askRoi(db: PGlite, q: string, horizon: number) {
  const d = await roiData(db, horizon);
  const P = parse(q);
  const chips: string[] = [];

  /* program and sponsor named in the question */
  const progs = (await db.query<any>('SELECT code, name FROM program')).rows;
  const prog = progs.find((p: any) => new RegExp(`\\b${p.name.toLowerCase().replace(/[—-]/g, '.').replace(/[()&]/g, '.')}\\b`).test(P.s))
    ?? progs.find((p: any) => new RegExp(`(^|[^A-Za-z])${p.code.replace('-', '\\-')}([^A-Za-z]|$)`).test(' ' + q + ' ') && (p.code.length > 2 || q.includes(p.code)));
  const orgNames = [...new Set([...d.projects, ...d.realized.projects].flatMap((r: any) => [r.owner, ...(r.sponsors ?? '').split(' · ')]).filter(Boolean))] as string[];
  const sponsor = orgNames.map(o => ({ o, k: o.toLowerCase().replace(/^dla /, '').replace(/[()]/g, '').trim() }))
    .filter(x => x.k.length > 3 && P.s.includes(' ' + x.k + ' ')).sort((a, b) => b.k.length - a.k.length)[0]?.o ?? null;

  /* topic: whatever is left once the ROI words, filters and names are removed */
  let rest = P.s;
  if (prog) rest = rest.replace(prog.name.toLowerCase(), ' ').replace(new RegExp(`\\b${prog.code.toLowerCase()}\\b`), ' ');
  if (sponsor) rest = rest.replace(sponsor.toLowerCase().replace(/^dla /, ''), ' ');
  rest = rest.replace(/\b(not reporting|stopped reporting|at risk|behind plan|on track|ahead of plan|paid back|break even|broke even|cost savings?|cost avoidance|risk reduction|by (program|path|phase|sponsor|owner)s?|value paths?|top \d+|in the enterprise|at scale|savings|readiness|throughput|performance|revenue|income|exceed\w*|behind|underperform\w*|under-?deliver\w*|lagging|failing|silent|stale)\b/g, ' ');
  const content = rest.split(/\s+/).filter(w => w.length > 1 && !ROI_WORDS.includes(w));
  let topicIds: Set<string> | null = null, topic = '';
  if (content.length) {
    const a: any = await runAssist(db, content.join(' '));
    topic = a.topic || content.join(' ');
    topicIds = new Set(a.ids);
    chips.push(`About ${topic}`);
  }
  if (prog) chips.push(`${prog.code} · ${prog.name}`);
  if (sponsor) chips.push(`Sponsor: ${sponsor}`);
  if (P.path) chips.push(PATH_L[P.path]);
  if (P.status) chips.push(P.statusL);
  if (P.paidBack) chips.push('paid back');

  const keep = (r: any, realized: boolean) => (!topicIds || topicIds.has(r.esh_id)) && (!prog || r.program_code === prog.code)
    && (!sponsor || r.owner === sponsor || (r.sponsors ?? '').split(' · ').includes(sponsor)) && (!P.path || r.path === P.path)
    && (!realized || ((!P.status || P.status.includes(r.status)) && (!P.paidBack || r.payback === 0)));
  // status or payback questions only make sense for the realized lens
  const lens: Lens = P.status || P.paidBack ? 'realized' : P.lens;
  const pros = lens === 'realized' ? [] : d.projects.filter((r: any) => keep(r, false));
  const real = lens === 'prospective' ? [] : d.realized.projects.filter((r: any) => keep(r, true));
  const scope = chips.length ? ` (${chips.join(', ')})` : '';

  /* ── the numbers ── */
  const pS = { n: pros.length, cost: sum(pros, 'cost'), annual: sum(pros, 'annual'), value: sum(pros, 'value'), riskAdj: sum(pros, 'riskAdj') };
  const pMult = pS.cost ? pS.riskAdj / pS.cost : null;
  const rS = { n: real.length, cost: sum(real, 'cost'), realized: sum(real, 'realized'), planned: sum(real, 'planned'), runRate: sum(real, 'runRate') };
  const rRoi = rS.cost ? rS.realized / rS.cost : null, rRate = rS.planned ? rS.realized / rS.planned : null;
  const rPay = rS.realized >= rS.cost ? 0 : rS.runRate ? (rS.cost - rS.realized) / rS.runRate : null;
  const statusLine = (rs: any[]) => Object.entries(REAL_STATUS).map(([k, v]) => [v.l.toLowerCase(), rs.filter(r => r.status === k).length] as [string, number]).filter(x => x[1]).map(([l, n]) => `${n} ${l}`).join(', ');

  const parts: string[] = [];
  if (lens !== 'realized') {
    parts.push(pS.n
      ? `**Prospective.** ${pS.n} active project${pS.n === 1 ? '' : 's'}${lens === 'prospective' ? scope : ''} have ${$(pS.cost)} invested so far and are projected to return ${$(pS.value)} over ${horizon} years, ${$(pS.riskAdj)} after allowing for the ones that won't reach scale: ${xx(pMult)} the money in.`
      : `**Prospective.** No active projects match${lens === 'prospective' ? scope : ''}.`);
  }
  if (lens !== 'prospective') {
    parts.push(rS.n
      ? `**Realized.** ${rS.n} project${rS.n === 1 ? ' is' : 's are'} in the enterprise${lens === 'realized' ? scope : ''}. Since transition they have delivered ${$(rS.realized)} against ${$(rS.planned)} planned (${pc(rRate)} of plan) on ${$(rS.cost)} invested: ${back(rRoi)} so far.`
        + (rPay === 0 ? ' Together they have already paid back.' : rPay != null ? ` At today's run rate of ${$(rS.runRate)} a year they pay back in about ${rPay.toFixed(1)} more years.` : '')
        + (real.length > 1 ? ` Status: ${statusLine(real)}.` : '')
      : `**Realized.** No projects in the enterprise match${lens === 'realized' ? scope : ''}.`);
  }
  if (lens === 'both' && chips.length) parts[0] = parts[0].replace('**Prospective.** ', `**Prospective${scope}.** `);

  /* ── shape: group or rank ── */
  let groups: any[] | null = null, groupBy: string | null = null;
  if (P.group) {
    groupBy = P.group;
    const keyOf = (r: any) => P.group === 'program' ? r.program_code ?? '—' : P.group === 'path' ? r.path ?? '—' : P.group === 'phase' ? (r.phase != null ? PHASES[r.phase].short : '—')
      : (r.owner ?? (r.sponsors ?? '').split(' · ')[0]) || '—';
    const keys = [...new Set([...pros, ...real].map(keyOf))];
    groups = keys.map(k => {
      const ps = pros.filter(r => keyOf(r) === k), rs = real.filter(r => keyOf(r) === k);
      const label = k === '—' ? (P.group === 'path' ? 'no value case' : 'unassigned') : P.group === 'path' && PATH_L[k] ? PATH_L[k] : P.group === 'program' ? `${k}${progs.find((p: any) => p.code === k) ? ' · ' + progs.find((p: any) => p.code === k).name : ''}` : k;
      return { k, label, pN: ps.length, pCost: sum(ps, 'cost'), pRisk: sum(ps, 'riskAdj'), pMult: sum(ps, 'cost') ? sum(ps, 'riskAdj') / sum(ps, 'cost') : null,
        rN: rs.length, rCost: sum(rs, 'cost'), rRealized: sum(rs, 'realized'), rPlanned: sum(rs, 'planned'), rRoi: sum(rs, 'cost') ? sum(rs, 'realized') / sum(rs, 'cost') : null,
        rRate: sum(rs, 'planned') ? sum(rs, 'realized') / sum(rs, 'planned') : null };
    }).sort((a, b) => (lens === 'realized' ? b.rRealized - a.rRealized : b.pRisk - a.pRisk));
    const top = groups.slice(0, 4).map(g => lens === 'realized'
      ? `${g.label.split(' · ')[0]} ${$(g.rRealized)} (${pc(g.rRate)} of plan)`
      : `${g.label.split(' · ')[0]} ${$(g.pRisk)} risk-adjusted (${xx(g.pMult)})`);
    parts.push(`By ${P.group}: ${top.join('; ')}${groups.length > 4 ? `; and ${groups.length - 4} more` : ''}.`);
  }

  // ranked list, lens-specific metric
  const realKey: Record<string, (r: any) => number | null> = { ratio: r => r.roi, realization: r => r.realization, payback: r => r.payback, cost: r => r.cost, value: r => r.realized };
  const prosKey: Record<string, (r: any) => number | null> = { ratio: r => r.multiple, realization: r => r.multiple, payback: r => r.multiple, cost: r => r.cost, value: r => r.riskAdj };
  const order = (rs: any[], key: (r: any) => number | null, asc: boolean) => [...rs].filter(r => key(r) != null).sort((a, b) => (asc ? 1 : -1) * ((key(a) as number) - (key(b) as number)));
  // a status question with no ranking asked: worst first (lowest share of plan; longest silence for 'not reporting')
  if (P.status && !P.rank) { P.rank = true; P.metric = 'realization'; P.asc = P.status[0] !== 'EXCEEDING'; }
  const asc = P.asc !== (P.metric === 'payback');
  const realSorted = order(real, realKey[P.metric], P.rank ? asc : false).concat(real.filter(r => realKey[P.metric](r) == null));
  const prosSorted = order(pros, prosKey[P.metric], P.rank ? asc : false).concat(pros.filter(r => prosKey[P.metric](r) == null));
  const metricL = (realizedLens: boolean) => ({ ratio: realizedLens ? 'realized ROI' : 'risk-adjusted multiple', realization: realizedLens ? 'share of plan delivered' : 'risk-adjusted multiple',
    payback: realizedLens ? 'payback' : 'risk-adjusted multiple', cost: 'cost', value: realizedLens ? 'benefit delivered' : 'risk-adjusted value' } as Record<string, string>)[P.metric];
  const fmtR = (r: any) => P.metric === 'ratio' ? xx(r.roi) : P.metric === 'realization' ? pc(r.realization) : P.metric === 'payback' ? (r.payback === 0 ? 'paid back' : r.payback != null ? `${r.payback.toFixed(1)} yrs` : '—') : P.metric === 'cost' ? $(r.cost) : $(r.realized);
  const fmtP = (r: any) => P.metric === 'cost' ? $(r.cost) : P.metric === 'value' ? $(r.riskAdj) : xx(r.multiple);
  if (P.rank && !P.group && !P.status) {
    if (lens !== 'prospective' && real.length) parts.push(`${P.asc ? 'Lowest' : 'Highest'} by ${metricL(true)}: ${realSorted.slice(0, P.n).map(r => `“${r.title}” ${fmtR(r)}`).join('; ')}.`);
    if (lens !== 'realized' && pros.length) parts.push(`${P.asc ? 'Lowest' : 'Highest'} by ${metricL(false)}: ${prosSorted.slice(0, P.n).map(r => `“${r.title}” ${fmtP(r)}`).join('; ')}.`);
  } else if (P.status && real.length) {
    const silent = P.status[0] === 'SILENT';
    const list = silent ? [...real].sort((a, b) => (a.lastReport ?? '').localeCompare(b.lastReport ?? '')) : realSorted;
    parts.push(list.slice(0, 3).map(r => silent
      ? `“${r.title}” ${r.lastReport ? `last reported ${mon(r.lastReport)}` : `has not reported since it transitioned in ${mon(r.transitioned_on)}`}${r.owner ? ` (owner: ${r.owner})` : ''}`
      : `“${r.title}” is at ${pc(r.realization)} of plan${r.note ? `: ${r.note.replace(/\.$/, '')}` : ''}`).join('. ') + '.');
  }

  const lite = (r: any, realized: boolean) => realized
    ? { esh_id: r.esh_id, title: r.title, program_code: r.program_code, path: r.path, owner: r.owner, cost: r.cost, realized: r.realized, planned: r.planned, realization: r.realization,
        roi: r.roi, runRate: r.runRate, payback: r.payback, status: r.status, months: r.months, note: r.note, lastReport: r.lastReport }
    : { esh_id: r.esh_id, title: r.title, program_code: r.program_code, path: r.path, phase: r.phase, status: r.status, cost: r.cost, annual: r.annual, riskAdj: r.riskAdj, prob: r.prob, multiple: r.multiple, net: r.net };
  return {
    q, lens, chips, answer: parts.join('\n\n'), horizon,
    prospective: lens === 'realized' ? null : { ...pS, multiple: pMult, rows: prosSorted.slice(0, 40).map(r => lite(r, false)) },
    realized: lens === 'prospective' ? null : { ...rS, roi: rRoi, realization: rRate, payback: rPay, rows: realSorted.slice(0, 40).map(r => lite(r, true)) },
    groups, groupBy, metric: P.metric, status: REAL_STATUS,
    engine: 'local',
  };
}

export function registerRoiAsk(app: FastifyInstance, db: PGlite, deps: { wrap: (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any }) {
  app.post('/api/roi/ask', deps.wrap(async req => {
    const b = z.object({ q: z.string().trim().min(1).max(500), horizon: z.number().int().min(1).max(10).default(5) }).parse(req.body);
    return askRoi(db, b.q, b.horizon);
  }));
}
