import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { DECISIONS } from './esfContent.js';

const fd = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
export type Change = { kind: string; at: string; esh_id: string | null; title: string; what: string; by: string | null; href: string; tone?: 'warn' | 'good' };

/** A new session starts after 30 minutes away; the previous session's end is where "new" begins. */
const SESSION_GAP = 30 * 60 * 1000;
/** With no previous visit on record, show the two weeks before the data's as-of date. */
const FIRST_LOOK_DAYS = 14;

export const CHANGE_KIND: Record<string, string> = {
  GATE: 'Gate decisions', INTAKE: 'New projects', CRITERION: 'Criteria closed', PATHWAY: 'Pathways committed', DOCUMENT: 'Documents filed',
  REVIEW: 'Realization reviews held', LINK: 'Overlaps reviewed', DECISION: 'Senior leader decisions', DATACALL: 'Data call updates', BOARD: 'Gate boards scheduled', FUNDING: 'Funding lines',
};
const CHANGE_ONE: Record<string, string> = {
  GATE: 'Gate decision', INTAKE: 'New project', CRITERION: 'Criterion closed', PATHWAY: 'Pathway committed', DOCUMENT: 'Document filed',
  REVIEW: 'Realization review held', LINK: 'Overlap reviewed', DECISION: 'Senior leader decision', DATACALL: 'Data call update', BOARD: 'Gate board scheduled', FUNDING: 'Funding line',
};
const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const OUT: Record<string, string> = { PASS: 'passed', HOLD: 'put on hold', SUNSET: 'sunset', DESCOPE: 'descoped' };

/**
 * "What's new": everything that changed since the user's previous visit, from the records themselves
 * (gate decisions, criteria, pathways, documents, reviews, links, decisions, data call) and the audit log.
 * The user's own actions are left out. PMs and sponsors see their own projects; other roles see the portfolio.
 */
export function registerChanges(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap }) {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];

  /** Advances the user's visit markers and returns where "new" begins. */
  async function sinceFor(me: any) {
    const u = (await q('SELECT seen_at, prev_seen_at FROM app_user WHERE id = $1', [me.id]))[0] ?? {};
    const now = new Date();
    const seen = u.seen_at ? new Date(u.seen_at) : null;
    let prev = u.prev_seen_at ? new Date(u.prev_seen_at) : null;
    if (!seen || now.getTime() - seen.getTime() > SESSION_GAP) prev = seen;   // a new session: the last one ended at `seen`
    await q('UPDATE app_user SET seen_at = $2, prev_seen_at = $3 WHERE id = $1', [me.id, now, prev]);
    return { since: prev ?? new Date(AS_OF.getTime() - FIRST_LOOK_DAYS * 864e5), first: !prev };
  }

  async function changes(me: any, since: Date) {
    const s = since.toISOString(), sd = s.slice(0, 10), who = me.name;
    // the projects this user follows: PMs their own, sponsors their organization's, everyone else the whole portfolio
    const scope = me.role === 'PM' && me.person_id ? { sql: 'p.pm_id = $3', v: me.person_id }
      : me.role === 'SPONSOR' && me.org_id ? { sql: `EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.org_id = $3)`, v: me.org_id } : null;
    const W = scope ? ` AND ${scope.sql}` : '';
    const P = (extra: unknown[] = []) => (scope ? [s, who, scope.v, ...extra] : [s, who, ...extra]);
    const Pd = (extra: unknown[] = []) => (scope ? [sd, who, scope.v, ...extra] : [sd, who, ...extra]);
    const out: Change[] = [];
    const pj = (r: any) => ({ esh_id: r.esh_id, title: r.title, href: '#/p/' + r.esh_id });

    for (const r of await q(`SELECT g.*, p.esh_id, p.title FROM gate_decision g JOIN project p ON p.id = g.project_id
        WHERE g.decided_at >= $1::date AND g.recorded_by <> $2${W} ORDER BY g.decided_at DESC`, Pd()))
      out.push({ kind: 'GATE', at: iso(r.decided_at).slice(0, 10), ...pj(r), what: `Gate ${r.gate} ${OUT[r.outcome] ?? r.outcome} by ${r.authority}`, by: r.recorded_by,
        tone: r.outcome === 'PASS' ? 'good' : 'warn', href: '#/p/' + r.esh_id + '/history' });

    for (const r of await q(`SELECT ph.entered_at, p.esh_id, p.title FROM phase_record ph JOIN project p ON p.id = ph.project_id
        WHERE ph.phase = 0 AND ph.entered_at >= $1::date AND $2::text IS NOT NULL${W}`, Pd()))
      out.push({ kind: 'INTAKE', at: iso(r.entered_at).slice(0, 10), ...pj(r), what: 'Entered Stage 0 (intake)', by: null });

    // criteria: one line per project and gate, not one per criterion
    for (const r of await q(`SELECT p.esh_id, p.title, d.gate, max(c.updated_at) at, count(*)::int n, bool_or(c.status = 'WAIVED') waived,
          string_agg(DISTINCT c.updated_by, ', ') by
        FROM criterion_status c JOIN criterion_def d ON d.id = c.criterion_id JOIN project p ON p.id = c.project_id
        WHERE c.updated_at >= $1 AND c.status <> 'PENDING' AND c.updated_by <> $2${W} GROUP BY p.esh_id, p.title, d.gate`, P()))
      out.push({ kind: 'CRITERION', at: iso(r.at), ...pj(r), what: `${r.n} Gate ${r.gate} criteri${r.n === 1 ? 'on' : 'a'} closed${r.waived ? ' (incl. a waiver)' : ''}`, by: r.by, href: '#/p/' + r.esh_id + '/gate' });

    for (const r of await q(`SELECT t.path, t.status, t.committed_at, o.name receiver, p.esh_id, p.title FROM transition_pathway t JOIN project p ON p.id = t.project_id
        LEFT JOIN org o ON o.id = t.receiver_org_id WHERE t.committed_at >= $1::date AND $2::text IS NOT NULL${W}`, Pd()))
      out.push({ kind: 'PATHWAY', at: iso(r.committed_at).slice(0, 10), ...pj(r), what: `${r.path === 'A_WCF' ? 'Path A (WCF)' : 'Path B (POM)'} committed${r.receiver ? `: ${r.receiver} receives it` : ''}`, by: null, tone: 'good', href: '#/p/' + r.esh_id + '/funding' });

    for (const r of await q(`SELECT d.title doc, d.doc_type, d.uploaded_at, d.uploaded_by, p.esh_id, p.title FROM document d JOIN project p ON p.id = d.project_id
        WHERE d.uploaded_at >= $1 AND d.uploaded_by <> $2${W}`, P()))
      out.push({ kind: 'DOCUMENT', at: iso(r.uploaded_at), ...pj(r), what: `Filed: ${r.doc}`, by: r.uploaded_by, href: '#/p/' + r.esh_id + '/documents' });

    for (const r of await q(`SELECT rv.months, rv.held_on, rv.outcome, rv.recorded_by, p.esh_id, p.title FROM realization_review rv JOIN project p ON p.id = rv.project_id
        WHERE rv.status = 'HELD' AND rv.held_on >= $1::date AND coalesce(rv.recorded_by, '') <> $2${W}`, Pd()))
      out.push({ kind: 'REVIEW', at: iso(r.held_on).slice(0, 10), ...pj(r), what: `${r.months}-month realization review held${r.outcome ? ': ' + r.outcome.toLowerCase().replace(/_/g, ' ') : ''}`, by: r.recorded_by,
        tone: r.outcome === 'CORRECTIVE_ACTION' || r.outcome === 'REBASELINE' ? 'warn' : undefined });

    for (const r of await q(`SELECT l.kind, l.created_at, l.created_by, p.esh_id, p.title, b.esh_id b_esh, b.title b_title FROM project_link l
        JOIN project p ON p.id = l.a_id JOIN project b ON b.id = l.b_id WHERE l.created_at >= $1::date AND l.created_by <> $2${W}`, Pd()))
      out.push({ kind: 'LINK', at: iso(r.created_at).slice(0, 10), ...pj(r), what: `${r.kind === 'NOT_RELATED' ? 'Dismissed overlap with' : `Linked as ${r.kind.toLowerCase().replace('_', '-')} of`} ${r.b_esh}`, by: r.created_by,
        tone: r.kind === 'DUPLICATE' ? 'warn' : undefined });

    if (!scope) {
      for (const r of await q(`SELECT ord, status, decided_option, updated_at, updated_by FROM senior_decision WHERE updated_at >= $1 AND coalesce(updated_by, '') <> $2`, [s, who]))
        out.push({ kind: 'DECISION', at: iso(r.updated_at), esh_id: null, title: `#${r.ord} ${DECISIONS.find(d => d.ord === r.ord)?.title ?? 'Senior leader decision'}`, what: r.status === 'DECIDED' ? `Decided${r.decided_option ? ': ' + r.decided_option : ''}` : `Now ${r.status.toLowerCase().replace('_', ' ')}`, by: r.updated_by, href: '#/decisions', tone: r.status === 'DECIDED' ? 'good' : undefined });
      for (const r of await q(`SELECT at, actor, after FROM audit_event WHERE action = 'BOARD_CREATE' AND at >= $1 AND actor <> $2`, [s, who]))
        out.push({ kind: 'BOARD', at: iso(r.at), esh_id: null, title: r.after?.title ?? 'Gate board', what: `Scheduled for ${r.after?.board_date ? fd(r.after.board_date) : 'a new date'} ·${r.after?.items ?? 0} projects on the docket`, by: r.actor, href: '#/boards' });
    }

    // data call: submissions and reviews, rolled up by day so a busy week stays readable
    for (const r of await q(`SELECT date_trunc('day', coalesce(r.reviewed_at, r.submitted_at)) AS on_day, r.fy, r.status, count(*)::int n FROM data_call_response r JOIN project p ON p.id = r.project_id
        WHERE coalesce(r.reviewed_at, r.submitted_at) >= $1 AND coalesce(r.reviewed_by, r.updated_by, '') <> $2 AND r.status IN ('SUBMITTED','APPROVED','RETURNED')${W} GROUP BY 1, 2, 3`, P()))
      out.push({ kind: 'DATACALL', at: iso(r.on_day), esh_id: null, title: `FY${r.fy} data call`, what: `${r.n} response${r.n === 1 ? '' : 's'} ${r.status === 'SUBMITTED' ? 'submitted' : r.status === 'APPROVED' ? 'approved' : 'returned for changes'}`, by: null, href: '#/datacall', tone: r.status === 'RETURNED' ? 'warn' : undefined });

    out.sort((a, b) => b.at.localeCompare(a.at));
    const counts = Object.fromEntries(Object.keys(CHANGE_KIND).map(k => [k, out.filter(c => c.kind === k).length]).filter(([, n]) => n));
    return { items: out, counts, projects: [...new Set(out.map(c => c.esh_id).filter(Boolean))] as string[], scope: scope ? (me.role === 'PM' ? 'your projects' : 'your organization’s projects') : 'the portfolio' };
  }

  app.get('/api/me/changes', deps.wrap(async (_req, me) => {
    const { since, first } = await sinceFor(me);
    const c = await changes(me, since);
    return { since: since.toISOString(), first, kinds: CHANGE_KIND, kinds1: CHANGE_ONE, total: c.items.length, ...c, items: c.items.slice(0, 80) };
  }));

  /** "Mark all as seen": the next visit starts counting from now. */
  app.post('/api/me/seen', deps.wrap(async (_req, me) => {
    const now = new Date();
    await q('UPDATE app_user SET seen_at = $2, prev_seen_at = $2 WHERE id = $1', [me.id, now]);
    return { ok: true, since: now.toISOString() };
  }));
}
