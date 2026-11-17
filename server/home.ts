/* Director's home and data health.

   Built from the dashboard red team: answer three questions in five seconds — is the portfolio healthy,
   what needs my decision, is R&D paying off — with a few KPIs that carry a target and a trend, the pipeline
   funnel as the hero, investment against strategic priorities, the funding handoff, and a short owner-assigned
   decision list. Data hygiene moves to its own page, grouped by PM. */
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { PHASES } from './domain.js';

const MONTH = 30.44 * 864e5;
const DESIGN = PHASES.map(p => p.design as readonly number[]);   // months [min, max]
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? Math.round(100 * a / b) : null);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Ready = { esh_id: string; title: string; gate: number }[];

export async function homeData(db: PGlite, fy: number, ready: Ready) {
  const q = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);
  const asOf = iso(AS_OF);
  const inFy = (f: number) => `p.id IN (SELECT project_id FROM project_snapshot WHERE fy = ${Number(f)})`;
  const yearAgo = iso(new Date(AS_OF.getTime() - 365 * 864e5));

  const [yieldRows, rows, ago, gates, funding, values, paths, prios, fills, holds] = await Promise.all([
    // transition yield per data call, from the snapshots exactly as reported (real data)
    q(`SELECT fy, count(*) FILTER (WHERE status_code IN ('D','E'))::int done,
         count(*) FILTER (WHERE status_code IN ('D','E') AND transition_phase ILIKE 'complete%')::int transitioned
       FROM project_snapshot GROUP BY fy ORDER BY fy`),
    q(`SELECT p.id, p.esh_id, p.title, p.esf_phase, p.esf_status, p.esf_source, p.pop_end, p.program_code, p.element_code, p.pm_id, pe.name pm,
         (SELECT max(entered_at) FROM phase_record r WHERE r.project_id = p.id AND r.exited_at IS NULL) entered,
         EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'SPONSOR') has_sponsor,
         EXISTS (SELECT 1 FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1 WHERE pp.project_id = p.id) aligned
       FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
       WHERE ${inFy(fy)} AND p.esf_status IN ('ACTIVE','HOLD','AT_SCALE')`, [fy]),
    q(`SELECT r.phase, count(DISTINCT r.project_id)::int n FROM phase_record r
       WHERE r.entered_at <= $1::date AND (r.exited_at IS NULL OR r.exited_at > $1::date) GROUP BY r.phase`, [yearAgo]),
    q(`SELECT gate, outcome, count(*)::int n FROM gate_decision GROUP BY 1, 2`),
    q(`SELECT f.fy, f.project_id, (f.source ILIKE 'J68%') j68, sum(f.amount)::float amt FROM funding_line f GROUP BY 1, 2, 3`),
    q(`SELECT v.project_id, sum(v.annual_value)::float total, sum(v.annual_value) FILTER (WHERE v.j8_certified)::float cert FROM value_case v GROUP BY 1`),
    q(`SELECT project_id, path, status FROM transition_pathway`),
    q(`SELECT pri.id, pri.owner, pri.label, pri.ord, coalesce(array_agg(pp.project_id) FILTER (WHERE pp.project_id IS NOT NULL), '{}') pids
       FROM priority pri LEFT JOIN project_priority pp ON pp.priority_id = pri.id WHERE pri.fy = $1 GROUP BY pri.id ORDER BY pri.owner, pri.ord`, [fy]),
    q(`SELECT project_id, count(*)::int n FROM project_fill GROUP BY 1`),
    q(`SELECT DISTINCT ON (g.project_id) g.project_id, g.gate, g.decided_at, g.rationale FROM gate_decision g JOIN project p ON p.id = g.project_id AND p.esf_status = 'HOLD'
       WHERE g.outcome = 'HOLD' ORDER BY g.project_id, g.decided_at DESC`),
  ]);

  const liveRows = rows.filter((r: any) => r.esf_status !== 'AT_SCALE');
  const months = (r: any) => (r.entered ? (AS_OF.getTime() - new Date(r.entered).getTime()) / MONTH : null);
  const ids = new Set(rows.map((r: any) => r.id));
  const pathOf = new Map<number, any>(); for (const p of paths) if (!pathOf.has(p.project_id) || p.status !== 'DECLARED') pathOf.set(p.project_id, p);
  const readySet = new Set(ready.map(r => r.esh_id));

  /* ── funnel ── */
  const conv = (g: number) => {
    const n = (o: string) => gates.find((x: any) => x.gate === g && x.outcome === o)?.n ?? 0;
    const pass = n('PASS'), exits = n('SUNSET') + n('DESCOPE');
    return { pass, exits, rate: pct(pass, pass + exits) };
  };
  const funnel = [0, 1, 2, 3, 4, 5].map(ph => {
    const inPh = rows.filter((r: any) => (ph === 5 ? r.esf_status === 'AT_SCALE' : r.esf_phase === ph && r.esf_status !== 'AT_SCALE'));
    const ms = inPh.map(months).filter((m: number | null): m is number => m != null && m >= 0);
    const [lo, hi] = DESIGN[ph];
    const over = ph < 5 ? inPh.filter((r: any) => (months(r) ?? 0) > hi).length : 0;
    return {
      phase: ph, n: inPh.length, yearAgo: ago.find((a: any) => a.phase === ph)?.n ?? 0,
      medianMonths: median(ms), design: ph < 5 ? [lo, hi] : null, over, overPct: pct(over, inPh.length),
      hold: inPh.filter((r: any) => r.esf_status === 'HOLD').length, ready: inPh.filter((r: any) => readySet.has(r.esh_id)).length,
      gate: ph < 5 ? conv(ph) : null,
    };
  });

  /* ── KPIs ── */
  const yNow = yieldRows.find((y: any) => y.fy === fy), yPrev = yieldRows.find((y: any) => y.fy === fy - 1);
  const yieldPct = (y: any) => (y ? pct(y.transitioned, y.done) : null);
  const within = liveRows.filter((r: any) => (months(r) ?? 0) <= DESIGN[r.esf_phase ?? 0][1]).length;
  const handoff = (f: number) => {
    const fl = funding.filter((x: any) => x.fy === f && ids.has(x.project_id) && (rows.find((r: any) => r.id === x.project_id)?.esf_phase ?? 0) >= 3);
    const total = fl.reduce((a: number, x: any) => a + x.amt, 0), spon = fl.filter((x: any) => !x.j68).reduce((a: number, x: any) => a + x.amt, 0);
    return { pct: pct(spon, total), total, spon };
  };
  const hNow = handoff(fy), hPrev = handoff(fy - 1);
  const vals = values.filter((v: any) => ids.has(v.project_id));
  const vTotal = vals.reduce((a: number, v: any) => a + (v.total ?? 0), 0), vCert = vals.reduce((a: number, v: any) => a + (v.cert ?? 0), 0);
  const designMaxDate = (r: any) => (r.entered ? new Date(new Date(r.entered).getTime() + DESIGN[r.esf_phase ?? 0][1] * MONTH) : null);
  const in90 = new Date(AS_OF.getTime() + 90 * 864e5);
  const dueRows = liveRows.filter((r: any) => r.esf_status === 'ACTIVE' && r.esf_source === 'CONFIRMED' && !readySet.has(r.esh_id) && (designMaxDate(r) ?? in90) <= in90 && (designMaxDate(r) ?? AS_OF) >= AS_OF);
  const overdueRows = liveRows.filter((r: any) => r.esf_status === 'ACTIVE' && r.esf_source === 'CONFIRMED' && !readySet.has(r.esh_id) && (designMaxDate(r) ?? AS_OF) < AS_OF);
  const readyHere = ready.filter(r => rows.some((x: any) => x.esh_id === r.esh_id));

  const kpis = [
    { key: 'yield', label: 'Handed to an owner', value: yieldPct(yNow), unit: '%', prev: yieldPct(yPrev), target: 40, better: 'up', source: 'real',
      sub: yNow ? `${yNow.transitioned} of ${yNow.done} projects that finished this year were taken over by an operational owner` : 'No finished projects', link: `#/projects?fy=${fy}&status=E` },
    { key: 'time', label: 'On schedule', value: pct(within, liveRows.length), unit: '%', prev: null, target: 80, better: 'up', source: 'real',
      sub: `${within} of ${liveRows.length} active projects are within the time planned for their phase`, link: '#/board' },
    { key: 'handoff', label: 'Paid by sponsors', value: hNow.pct, unit: '%', prev: hPrev.pct, target: 50, better: 'up', source: 'accrues',
      sub: `Share of later-phase funding that comes from sponsors rather than J68 R&D`, link: '#/phase/3' },
    { key: 'value', label: 'Expected yearly value', value: vTotal, unit: '$', prev: null, target: null, better: 'up', source: 'accrues',
      sub: `From ${vals.length} projects; ${pct(vCert, vTotal) ?? 0}% of it checked by J8 Finance`, link: '#/projects' },
    { key: 'decisions', label: 'Decisions needed', value: readyHere.length + dueRows.length, unit: '', prev: null, target: null, better: 'none', source: 'accrues',
      sub: `${readyHere.length} ready now, ${dueRows.length} more in the next 90 days`, link: '#decisions' },
  ];

  /* ── investment by priority ── */
  const fundOf = (pid: number) => funding.filter((x: any) => x.fy === fy && x.project_id === pid).reduce((a: number, x: any) => a + x.amt, 0);
  const coverage = prios.map((p: any) => {
    const live = (p.pids as number[]).filter(id => ids.has(id));
    return { id: p.id, owner: p.owner, label: p.label, live: live.length, funding: live.reduce((a, id) => a + fundOf(id), 0) };
  });

  /* ── funding by phase: J68 vs sponsor ── */
  const fundingByPhase = [1, 2, 3, 4, 5].map(ph => {
    const pids = new Set(rows.filter((r: any) => (ph === 5 ? r.esf_status === 'AT_SCALE' : r.esf_phase === ph && r.esf_status !== 'AT_SCALE')).map((r: any) => r.id));
    const fl = funding.filter((x: any) => x.fy === fy && pids.has(x.project_id));
    return { phase: ph, j68: fl.filter((x: any) => x.j68).reduce((a: number, x: any) => a + x.amt, 0), sponsor: fl.filter((x: any) => !x.j68).reduce((a: number, x: any) => a + x.amt, 0) };
  });

  /* ── decisions & commitments (owner-assigned, short) ── */
  const nextPom = (() => { const y = AS_OF.getUTCMonth() >= 6 ? AS_OF.getUTCFullYear() + 1 : AS_OF.getUTCFullYear(); return new Date(Date.UTC(y, 6, 1)); })();
  const pomRows = liveRows.filter((r: any) => r.esf_phase === 2 && pathOf.get(r.id)?.path === 'B_POM');
  const endingRows = liveRows.filter((r: any) => r.pop_end && new Date(r.pop_end) >= AS_OF && new Date(r.pop_end) <= in90 && !['COMMITTED', 'ACTIVE'].includes(pathOf.get(r.id)?.status));
  const byTitle = (r: any) => ({ esh_id: r.esh_id, title: r.title });
  const decisions = [
    ...readyHere.slice(0, 5).map(r => ({ kind: 'READY', when: asOf, owner: r.gate >= 3 ? 'Gate authority (DCG)' : r.gate === 2 ? 'J68 Director + J8' : 'J68 Director',
      text: `Gate ${r.gate} decision — every criterion is closed`, link: '#/p/' + r.esh_id, ...r })),
    ...(readyHere.length > 5 ? [{ kind: 'READY', when: asOf, owner: 'Gate authorities', text: `${readyHere.length - 5} more projects are ready for a gate decision`, link: '#/board', esh_id: null, title: null }] : []),
    ...(holds.length ? [{ kind: 'HOLD', when: asOf, owner: 'Sponsors + J8', text: `${holds.length} project${holds.length === 1 ? ' is' : 's are'} on HOLD awaiting a non-waivable criterion`,
      link: '#/projects?esfStatus=HOLD', esh_id: null, title: null, items: holds.slice(0, 6).map((h: any) => byTitle(rows.find((r: any) => r.id === h.project_id) ?? { esh_id: '', title: '' })).filter((x: any) => x.esh_id) }] : []),
    { kind: 'POM', when: iso(nextPom), owner: 'Co-sponsors + J8',
      text: `POM window opens ${iso(nextPom)}: ${pomRows.length} Path B project${pomRows.length === 1 ? '' : 's'} in Phase II must clear PRR (Gate 2) first`,
      link: '#/phase/2', esh_id: null, title: null, items: pomRows.slice(0, 6).map(byTitle) },
    ...(endingRows.length ? [{ kind: 'POP', when: iso(in90), owner: 'Program managers', text: `${endingRows.length} contract${endingRows.length === 1 ? '' : 's'} end within 90 days with no committed transition`,
      link: `#/projects?fy=${fy}`, esh_id: null, title: null, items: endingRows.slice(0, 6).map(byTitle) }] : []),
    ...(overdueRows.length ? [{ kind: 'OVERDUE', when: asOf, owner: 'Program managers', text: `${overdueRows.length} confirmed project${overdueRows.length === 1 ? ' is' : 's are'} past the design window for their phase with no gate scheduled`,
      link: '#/board', esh_id: null, title: null }] : []),
  ];

  /* ── data health (one score; detail lives on the Data health page) ── */
  const flagged = liveRows.filter((r: any) => (r.pop_end && new Date(r.pop_end) < AS_OF) || !r.has_sponsor || !r.aligned).length;
  const filledProjects = rows.filter((r: any) => fills.some((f: any) => f.project_id === r.id)).length;
  const health = { score: pct(liveRows.length - flagged, liveRows.length), flagged, live: liveRows.length, filledProjects };

  /* ── live portfolio by program (kept from the old page) ── */
  const programs = Object.entries(liveRows.reduce((a: Record<string, { n: number; el: string | null }>, r: any) => {
    const k = r.program_code ?? '?'; a[k] = a[k] ?? { n: 0, el: r.element_code }; a[k].n++; return a; }, {}))
    .map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n);

  /* ── the takeaway sentence ── */
  // two different facts: where the work piles up (largest stock) and where it runs slowest (largest share past design)
  const stages = funnel.filter(f => f.phase >= 1 && f.phase <= 4);
  const biggest = [...stages].sort((a, b) => b.n - a.n)[0];
  const slowest = [...stages].filter(f => f.n >= 5).sort((a, b) => (b.overPct ?? 0) - (a.overPct ?? 0))[0];
  const uncovered = coverage.filter(c => c.live === 0);
  const takeaway = [
    biggest ? `Most projects are in ${PHASES[biggest.phase].short} (${biggest.n}${biggest.yearAgo ? `, ${biggest.n >= biggest.yearAgo ? 'up' : 'down'} from ${biggest.yearAgo} last year` : ''}).` : '',
    slowest && (slowest.overPct ?? 0) > 0
      ? `${PHASES[slowest.phase].short} is the slowest: ${slowest.over} of its ${slowest.n} projects are taking longer than the ${slowest.design![0]}–${slowest.design![1]} months planned.`
      : 'Every phase is moving on schedule.',
    readyHere.length ? `${readyHere.length} project${readyHere.length === 1 ? ' is' : 's are'} ready for a decision.` : 'No project is waiting on a decision.',
    uncovered.length ? `${uncovered.length} of this year's ${coverage.length} priorities have no project working on them.` : 'Every priority has at least one project working on it.',
  ].join(' ');

  return { fy, asOf, takeaway, kpis, funnel, coverage, fundingByPhase, decisions, health, programs, yieldTrend: yieldRows.map((y: any) => ({ fy: y.fy, pct: yieldPct(y) })) };
}

/** Data hygiene grouped by program manager: the flags that used to fill the dashboard's attention queue. */
export async function healthData(db: PGlite, fy: number) {
  const rows = (await db.query<any>(`
    SELECT p.esh_id, p.title, p.pop_end, p.status_code, p.esf_phase, p.esf_status, p.esf_source, p.pm_id, coalesce(pe.name, '(no PM)') pm,
      NOT EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'SPONSOR') no_sponsor,
      NOT EXISTS (SELECT 1 FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1 WHERE pp.project_id = p.id) no_align,
      NOT EXISTS (SELECT 1 FROM transition_pathway t WHERE t.project_id = p.id AND t.status IN ('COMMITTED','ACTIVE')) no_path,
      (SELECT count(*)::int FROM project_fill f WHERE f.project_id = p.id) filled
    FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
    WHERE p.id IN (SELECT project_id FROM project_snapshot WHERE fy = $1) AND p.esf_status IN ('ACTIVE','HOLD')
    ORDER BY pm, p.esh_id`, [fy])).rows;
  const in180 = new Date(AS_OF.getTime() + 180 * 864e5);
  const projects = rows.map((r: any) => {
    const end = r.pop_end ? new Date(r.pop_end) : null;
    const flags = [
      end && end < AS_OF && ['A', 'B', 'C'].includes(r.status_code) && 'PoP lapsed, still live',
      end && end >= AS_OF && end <= in180 && r.no_path && 'PoP ends ≤ 6 months, no committed transition',
      r.no_sponsor && 'No sponsor',
      r.no_align && `Not aligned to an FY${String(fy).slice(2)} priority`,
      r.esf_source === 'SUGGESTED' && 'ESF phase not confirmed',
    ].filter(Boolean) as string[];
    return { ...r, flags };
  });
  const byPm = Object.values(projects.reduce((a: Record<string, any>, p: any) => {
    const k = p.pm; a[k] = a[k] ?? { pm: k, pm_id: p.pm_id, live: 0, clean: 0, lapsed: 0, ending: 0, sponsor: 0, align: 0, unconfirmed: 0, filled: 0 };
    const x = a[k]; x.live++; if (!p.flags.length) x.clean++;
    for (const f of p.flags) { if (f.startsWith('PoP lapsed')) x.lapsed++; else if (f.startsWith('PoP ends')) x.ending++; else if (f === 'No sponsor') x.sponsor++; else if (f.startsWith('Not aligned')) x.align++; else if (f.startsWith('ESF')) x.unconfirmed++; }
    if (p.filled) x.filled++;
    return a;
  }, {})).map((x: any) => ({ ...x, score: pct(x.clean, x.live) })).sort((a: any, b: any) => (a.score ?? 0) - (b.score ?? 0) || b.live - a.live);
  const clean = projects.filter((p: any) => !p.flags.length).length;
  return { fy, asOf: iso(AS_OF), score: pct(clean, projects.length), live: projects.length, clean, byPm, projects: projects.filter((p: any) => p.flags.length) };
}
