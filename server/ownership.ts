/* Enterprise ownership of R&D: who sponsors what, what they have signed, whether transitions are really committed,
   and whether what was fielded is delivering. Answers the organizational assessment's "it's J68's portfolio" finding
   by putting each sponsoring organization's record side by side for the DCG.

   /api/scorecard          one row per sponsoring organization
   /api/transition         every project in Phase II–IV with its pathway, receiver, funding line and POM year
   /api/orgs/:id/ownership one organization's scorecard row and its to-do list (commitments to sign, pathways to commit, benefit reports owed) */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { PATHWAY_CRIT, PHASES } from './domain.js';
import { roiData } from './roi.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
const LIVE = ['ACTIVE', 'HOLD'];

/** A pathway's state for transition readiness: none → declared → committed (but incomplete) → committed → active. */
export const READINESS: Record<string, { l: string; c: string; d: string }> = {
  NONE: { l: 'No pathway', c: '#CE0F3E', d: 'No transition pathway declared' },
  DECLARED: { l: 'Declared only', c: '#C9A961', d: 'A path is named, but no organization has committed to receive and fund it' },
  INCOMPLETE: { l: 'Committed, incomplete', c: '#D9822B', d: 'Committed, but missing the receiving organization, funding line or POM year' },
  COMMITTED: { l: 'Committed', c: '#2F7D5C', d: 'Committed with a named receiver, funding line and (Path B) POM year' },
  ACTIVE: { l: 'Running', c: '#1F6E4A', d: 'The receiving organization is funding and running it' },
};

async function load(db: PGlite) {
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);
  const [projects, sponsors, paths, crits, funding, seats] = await Promise.all([
    q(`SELECT p.id, p.esh_id, p.title, p.program_code, p.esf_phase, p.esf_status, p.esf_source, pe.name pm FROM project p LEFT JOIN person pe ON pe.id = p.pm_id`),
    q(`SELECT po.project_id, o.id, o.name, o.kind FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.role = 'SPONSOR'`),
    q(`SELECT t.id, t.project_id, t.path, t.status, t.mechanism, t.receiver_org_id, o.name receiver, t.funding_line, t.pom_fy, t.committed_at
       FROM transition_pathway t LEFT JOIN org o ON o.id = t.receiver_org_id ORDER BY t.project_id, CASE t.status WHEN 'ACTIVE' THEN 0 WHEN 'COMMITTED' THEN 1 ELSE 2 END, t.id`),
    q(`SELECT d.id, d.gate, d.ord, d.text, d.owner, d.proposal, d.non_waivable, s.project_id, coalesce(s.status, 'PENDING') status, s.updated_by, s.evidence
       FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id`),
    q(`SELECT f.project_id, f.source, f.amount::float amount FROM funding_line f`),
    q(`SELECT org_id, id FROM app_user WHERE role = 'SPONSOR'`),
  ]);
  const defs = new Map<number, any>();
  const status = new Map<string, any>();
  for (const c of crits) { defs.set(c.id, c); if (c.project_id != null) status.set(`${c.project_id}:${c.id}`, c); }
  const defList = [...defs.values()];
  const sponsorsOf = new Map<number, any[]>();
  for (const s of sponsors) (sponsorsOf.get(s.project_id) ?? sponsorsOf.set(s.project_id, []).get(s.project_id)!).push(s);
  const pathOf = new Map<number, any>();
  for (const t of paths) if (!pathOf.has(t.project_id)) pathOf.set(t.project_id, t);
  const readiness = (t: any) => !t ? 'NONE' : t.status === 'ACTIVE' ? 'ACTIVE' : t.status === 'DECLARED' ? 'DECLARED'
    : t.receiver_org_id && t.funding_line && (t.path === 'A_WCF' || t.pom_fy) ? 'COMMITTED' : 'INCOMPLETE';
  const closed = (pid: number, d: any) => { const s = status.get(`${pid}:${d.id}`)?.status; return s === 'MET' || (s === 'WAIVED' && !d.non_waivable); };
  /** The sponsor-owned criteria at the gate a live project is working toward, with whether everything else there is already closed. */
  const sponsorAsks = (p: any) => {
    if (!LIVE.includes(p.esf_status) || p.esf_source !== 'CONFIRMED') return [];
    const gate = Math.min(p.esf_phase ?? 0, 4);
    const at = defList.filter(d => d.gate === gate);
    const others = at.filter(d => d.owner !== 'SPONSOR').every(d => closed(p.id, d));
    return at.filter(d => d.owner === 'SPONSOR').map(d => ({ id: d.id, gate, ord: d.ord, text: d.text, proposal: d.proposal, signed: closed(p.id, d),
      by: status.get(`${p.id}:${d.id}`)?.updated_by ?? null, othersClosed: others }));
  };
  return { projects, sponsorsOf, pathOf, readiness, sponsorAsks, funding, seats: new Set(seats.map((s: any) => s.org_id)), defList, status };
}

export async function scorecard(db: PGlite) {
  const L = await load(db);
  const roi = await roiData(db, 5);
  const orgs = new Map<number, any>();
  const row = (s: any) => orgs.get(s.id) ?? orgs.set(s.id, {
    id: s.id, name: s.name, kind: s.kind, seat: L.seats.has(s.id), active: 0, atScale: 0, phase2plus: 0,
    funded: 0, sponsorFunded: 0, asks: 0, signed: 0, pathOk: 0, pathGaps: 0, gate3Ready: 0,
    realized: 0, planned: 0, fielded: 0, silent: 0, atRisk: 0,
  }).get(s.id)!;
  const fundBy = new Map<number, any[]>();
  for (const f of L.funding) (fundBy.get(f.project_id) ?? fundBy.set(f.project_id, []).get(f.project_id)!).push(f);
  for (const p of L.projects) {
    const ss = L.sponsorsOf.get(p.id) ?? [];
    if (!ss.length || !['ACTIVE', 'HOLD', 'AT_SCALE'].includes(p.esf_status)) continue;
    const asks = L.sponsorAsks(p), r = L.readiness(L.pathOf.get(p.id));
    for (const s of ss) {
      const o = row(s);
      if (p.esf_status === 'AT_SCALE') o.atScale++; else o.active++;
      const fs = fundBy.get(p.id) ?? [];
      o.funded += fs.reduce((a, f) => a + f.amount, 0);
      o.sponsorFunded += fs.filter(f => f.source === s.name).reduce((a, f) => a + f.amount, 0);
      o.asks += asks.length; o.signed += asks.filter(a => a.signed).length;
      if (LIVE.includes(p.esf_status) && (p.esf_phase ?? 0) >= 2) {
        o.phase2plus++;
        if (r === 'COMMITTED' || r === 'ACTIVE') o.pathOk++; else if ((p.esf_phase ?? 0) >= 3) o.pathGaps++;
      }
      if (p.esf_phase === 3 && asks.some(a => !a.signed && a.othersClosed)) o.gate3Ready++;
    }
  }
  for (const r of roi.realized.projects) {
    const o = r.owner_id != null ? orgs.get(r.owner_id) : null;
    if (!o) continue;
    o.fielded++; o.realized += r.realized; o.planned += r.planned;
    if (r.status === 'SILENT') o.silent++;
    if (r.status === 'AT_RISK') o.atRisk++;
  }
  const rows = [...orgs.values()].map(o => ({
    ...o,
    cofundShare: o.funded ? o.sponsorFunded / o.funded : null,
    signedShare: o.asks ? o.signed / o.asks : null,
    pathShare: o.phase2plus ? o.pathOk / o.phase2plus : null,
    realization: o.planned ? o.realized / o.planned : null,
    attention: (o.asks - o.signed) + o.pathGaps + o.silent + o.atRisk,
  })).filter(o => o.active + o.atScale > 0)
    .sort((a, b) => Number(b.seat) - Number(a.seat) || (b.active + b.atScale) - (a.active + a.atScale));
  const sum = (k: string) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  return {
    rows,
    totals: { orgs: rows.length, seats: rows.filter(r => r.seat).length, funded: sum('funded'), sponsorFunded: sum('sponsorFunded'),
      asks: sum('asks'), signed: sum('signed'), phase2plus: sum('phase2plus'), pathOk: sum('pathOk'), pathGaps: sum('pathGaps'),
      realized: sum('realized'), planned: sum('planned'), silent: sum('silent'), atRisk: sum('atRisk') },
  };
}

export async function transitionReadiness(db: PGlite) {
  const L = await load(db);
  const rows = L.projects.filter((p: any) => LIVE.includes(p.esf_status) && p.esf_source === 'CONFIRMED' && (p.esf_phase ?? 0) >= 2 && (p.esf_phase ?? 0) <= 4).map((p: any) => {
    const t = L.pathOf.get(p.id), r = L.readiness(t), asks = L.sponsorAsks(p);
    const ses = p.esf_phase === 3 ? asks.find(a => a.ord === 1) : null;
    const prop = p.esf_phase === 3 ? asks.find(a => a.gate === PATHWAY_CRIT.gate && a.ord === PATHWAY_CRIT.ord) : null;
    return {
      esh_id: p.esh_id, title: p.title, program_code: p.program_code, phase: p.esf_phase, status: p.esf_status, pm: p.pm,
      sponsors: (L.sponsorsOf.get(p.id) ?? []).map((s: any) => s.name), readiness: r,
      path: t?.path ?? null, mechanism: t?.mechanism ?? null, receiver: t?.receiver ?? null, funding_line: t?.funding_line ?? null, pom_fy: t?.pom_fy ?? null,
      missing: t && r === 'INCOMPLETE' ? [!t.receiver_org_id && 'receiver', !t.funding_line && 'funding line', t.path === 'B_POM' && !t.pom_fy && 'POM year'].filter(Boolean) : [],
      sesSigned: ses ? ses.signed : null, proposalMet: prop ? prop.signed : null,
    };
  });
  const byPhase = [2, 3, 4].map(ph => ({ phase: ph, name: PHASES[ph].short, ...Object.fromEntries(Object.keys(READINESS).map(k => [k, rows.filter(r => r.phase === ph && r.readiness === k).length])) }));
  return { rows, byPhase, readiness: READINESS };
}

export async function orgOwnership(db: PGlite, orgId: number) {
  const L = await load(db);
  const sc = await scorecard(db);
  const roi = await roiData(db, 5);
  const mine = L.projects.filter((p: any) => (L.sponsorsOf.get(p.id) ?? []).some((s: any) => s.id === orgId));
  const toSign = mine.flatMap((p: any) => L.sponsorAsks(p).filter(a => !a.signed).map(a => ({ esh_id: p.esh_id, title: p.title, phase: p.esf_phase, ...a })))
    .sort((a, b) => Number(b.othersClosed) - Number(a.othersClosed) || b.gate - a.gate);
  const toCommit = mine.filter((p: any) => LIVE.includes(p.esf_status) && (p.esf_phase ?? 0) >= 2)
    .map((p: any) => { const t = L.pathOf.get(p.id); return { esh_id: p.esh_id, title: p.title, phase: p.esf_phase, readiness: L.readiness(t), path: t?.path ?? null,
      missing: t ? [!t.receiver_org_id && 'receiver', !t.funding_line && 'funding line', t.path === 'B_POM' && !t.pom_fy && 'POM year'].filter(Boolean) : [] }; })
    .filter(x => !['COMMITTED', 'ACTIVE'].includes(x.readiness)).sort((a, b) => b.phase - a.phase);
  const reports = roi.realized.projects.filter((r: any) => r.owner_id === orgId && ['SILENT', 'AT_RISK', 'BEHIND'].includes(r.status))
    .map((r: any) => ({ esh_id: r.esh_id, title: r.title, status: r.status, realization: r.realization, lastReport: r.lastReport, note: r.note }));
  return { row: sc.rows.find(r => r.id === orgId) ?? null, toSign, toCommit, reports, readiness: READINESS, status: roi.realized.status };
}

export function registerOwnership(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap }) {
  app.get('/api/scorecard', deps.wrap(async () => scorecard(db)));
  app.get('/api/transition', deps.wrap(async () => transitionReadiness(db)));
  app.get('/api/orgs/:id/ownership', deps.wrap(async req => orgOwnership(db, Number((req.params as any).id))));
}
