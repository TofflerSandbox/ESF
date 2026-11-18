import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { gatesData } from './analysis.js';
import { orgOwnership } from './ownership.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
/** One thing someone owes the process. `due` drives ordering; `tone` warn = overdue or blocking. */
type Item = { esh_id?: string | null; title: string; what: string; due?: string | null; href: string; tone?: 'warn' | 'good' };
type Section = { key: string; title: string; hint: string; items: Item[]; more?: { n: number; href: string } };

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
const LIMIT = 8;
const fd = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const mo = (s: string) => new Date(s.slice(0, 7) + '-15T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * "My work": each role's queue, assembled from the same data the rest of the Hub shows.
 * PM: own projects' open criteria, data call, contracts ending. Sponsor: signatures, pathways, benefit reports, actions.
 * Gate authority: decisions ready, boards, senior leader decisions. J1: workforce items. J68 admin: dockets, reviews, data call, R&D actions.
 */
export function registerMyWork(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap }) {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];
  // reuse existing endpoints as the acting user, so rules and figures match their pages exactly
  const get = async (url: string, me: any) => {
    const r = await app.inject({ method: 'GET', url, headers: { 'x-esh-user': String(me.id) } });
    if (r.statusCode >= 400) throw new Error(`${url}: ${r.statusCode}`);
    return r.json() as any;
  };

  app.get('/api/me/work', deps.wrap(async (_req, me) => {
    const today = iso(AS_OF), in30 = iso(new Date(AS_OF.getTime() + 30 * 864e5)), in90 = iso(new Date(AS_OF.getTime() + 90 * 864e5));
    const sections: Section[] = [];
    const add = (key: string, title: string, hint: string, items: Item[], moreHref?: string) => {
      if (!items.length) return;
      const sorted = [...items].sort((a, b) => Number(b.tone === 'warn') - Number(a.tone === 'warn') || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      sections.push({ key, title, hint, items: sorted.slice(0, LIMIT), more: sorted.length > LIMIT && moreHref ? { n: sorted.length - LIMIT, href: moreHref } : undefined });
    };
    const call = (await q(`SELECT fy, due_at FROM data_call WHERE status = 'OPEN' ORDER BY fy DESC LIMIT 1`))[0] ?? null;
    const callDue = call?.due_at ? iso(call.due_at) : null;
    const needsGates = ['PM', 'ADMIN', 'AUTHORITY'].includes(me.role);
    const G = needsGates ? await gatesData(db) : null;
    const allProjects = G ? G.gates.flatMap((g: any) => g.projects.map((p: any) => ({ ...p, gate: g.gate }))) : [];
    const real = ['ADMIN', 'SPONSOR', 'J1'].includes(me.role) ? await get('/api/realization', me) : null;
    const actionItems = (owner: string, filter: (a: any) => boolean = () => true) => (real?.actions ?? []).filter((a: any) => a.owner === owner && filter(a)).map((a: any): Item => ({
      esh_id: a.esh_id, title: a.title, what: `${a.months}-month review action: ${a.text}`, due: a.due_on, href: '#/p/' + a.esh_id, tone: a.overdue ? 'warn' : undefined,
    }));

    if (me.role === 'PM') {
      const myName = me.person_id ? (await q('SELECT name FROM person WHERE id = $1', [me.person_id]))[0]?.name : null;
      const mine = allProjects.filter((p: any) => myName && p.pm === myName);
      add('ready', 'Ready for a gate decision', 'Every criterion is closed. J68 puts these on a board docket.',
        mine.filter((p: any) => p.ready).map((p: any): Item => ({ esh_id: p.esh_id, title: p.title, what: p.board ? `Gate ${p.gate} · on the ${p.board.title} docket` : `Gate ${p.gate} · not yet on a board docket`, due: p.board?.date ?? null, href: '#/p/' + p.esh_id, tone: 'good' })));
      add('criteria', 'Criteria to close', 'Evidence still missing at each project’s current gate. Items owned by the sponsor or J1 are theirs to close.',
        mine.filter((p: any) => !p.ready && p.status !== 'HOLD').map((p: any): Item => {
          const own = p.open.filter((c: any) => c.owner === 'J68');
          return { esh_id: p.esh_id, title: p.title, what: `Gate ${p.gate} · ${p.done} of ${p.total} closed${own.length ? ` · next: ${own[0].text}` : ' · waiting on the sponsor or J1'}${p.late ? ' · past the time planned for its phase' : ''}`, href: '#/p/' + p.esh_id, tone: p.late ? 'warn' : undefined };
        }), '#/projects?mine=1');
      add('hold', 'On hold', 'A gate decision put these on HOLD until a non-waivable criterion is met.',
        mine.filter((p: any) => p.status === 'HOLD').map((p: any): Item => ({ esh_id: p.esh_id, title: p.title, what: p.hold_reason ? `On hold: ${p.hold_reason}` : `Gate ${p.gate} · on hold`, href: '#/p/' + p.esh_id, tone: 'warn' })));
      if (call) {
        const dc = await get(`/api/datacalls/${call.fy}`, me);
        add('datacall', `FY${call.fy} data call`, 'Your responses still to submit.',
          dc.rows.filter((r: any) => r.mine && ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED'].includes(r.status)).map((r: any): Item => ({
            esh_id: r.esh_id, title: r.title, what: r.status === 'RETURNED' ? `Returned by J68${r.note ? `: ${r.note}` : ' for changes'}` : r.status === 'IN_PROGRESS' ? 'Started, not submitted' : 'Not started',
            due: callDue, href: '#/datacall', tone: r.status === 'RETURNED' ? 'warn' : undefined })), '#/datacall');
      }
      if (myName) {
        const ending = await q(`SELECT p.esh_id, p.title, p.pop_end FROM project p JOIN person pe ON pe.id = p.pm_id
          WHERE pe.name = $1 AND p.esf_status IN ('ACTIVE','HOLD') AND p.pop_end BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM transition_pathway t WHERE t.project_id = p.id AND t.status IN ('COMMITTED','ACTIVE'))`, [myName, today, in90]);
        add('ending', 'Contracts ending without a committed transition', 'Within 90 days. Ask the sponsor to commit a pathway, or plan the exit.',
          ending.map((r: any): Item => ({ esh_id: r.esh_id, title: r.title, what: 'Contract ends; no receiving organization committed', due: iso(r.pop_end), href: '#/p/' + r.esh_id, tone: 'warn' })));
      }
    }

    if (me.role === 'SPONSOR' && me.org_id) {
      const o = await orgOwnership(db, me.org_id);
      const org = (await q('SELECT name FROM org WHERE id = $1', [me.org_id]))[0]?.name ?? '';
      add('sign', 'Waiting on your signature', 'Sponsor-owned gate criteria. Projects whose other criteria are all closed are blocked only by you.',
        o.toSign.map((a: any): Item => ({ esh_id: a.esh_id, title: a.title, what: `Gate ${a.gate} · ${a.text}${a.othersClosed ? ' · the only item left' : ''}`, href: '#/p/' + a.esh_id, tone: a.othersClosed ? 'warn' : undefined })), `#/org/${me.org_id}`);
      add('commit', 'Transition pathways to commit', 'Name the receiving organization, the funding line and (Path B) the POM year.',
        o.toCommit.map((x: any): Item => ({ esh_id: x.esh_id, title: x.title, what: x.readiness === 'NONE' ? 'No pathway declared' : `Missing: ${x.missing.length ? x.missing.join(', ') : 'your commitment'}`, href: '#/p/' + x.esh_id, tone: x.phase >= 3 ? 'warn' : undefined })), `#/org/${me.org_id}`);
      add('reports', 'Benefit reports', 'Fielded capabilities you own that are behind plan or not reporting.',
        o.reports.map((r: any): Item => ({ esh_id: r.esh_id, title: r.title, what: r.status === 'SILENT' ? `No benefit report${r.lastReport ? ` since ${mo(r.lastReport)}` : ' yet'}` : `${r.status === 'AT_RISK' ? 'At risk' : 'Behind plan'} · ${r.realization != null ? Math.round(100 * r.realization) + '% of plan delivered' : ''}`, href: '#/p/' + r.esh_id, tone: r.status === 'BEHIND' ? undefined : 'warn' })));
      add('actions', 'Review actions', 'Actions assigned to your organization at realization reviews.', actionItems('SPONSOR', (a: any) => a.org === org), '#/realization');
      add('reviews', 'Realization reviews coming up', 'Held with R&D at 6, 12 and 24 months after transition.',
        [...(real?.overdue ?? []), ...(real?.upcoming ?? [])].filter((r: any) => r.owner === org).map((r: any): Item => ({ esh_id: r.esh_id, title: r.title, what: `${r.months}-month realization review`, due: r.due_on, href: '#/p/' + r.esh_id, tone: r.due_on < today ? 'warn' : undefined })));
    }

    if (me.role === 'AUTHORITY') {
      const ready = allProjects.filter((p: any) => p.ready);
      add('decide', 'Ready for your decision', 'Every criterion is closed. Record the decision at the board or on the project page.',
        ready.map((p: any): Item => ({ esh_id: p.esh_id, title: p.title, what: p.board ? `Gate ${p.gate} · ${p.board.title}` : `Gate ${p.gate} · not yet docketed`, due: p.board?.date ?? null, href: '#/p/' + p.esh_id, tone: p.board ? undefined : 'warn' })), '#/gates');
      const boards = (G?.boards ?? []).filter((b: any) => b.board_date >= today && b.board_date <= in90);
      add('boards', 'Boards in the next 90 days', 'Open the board book to prepare.',
        boards.map((b: any): Item => ({ title: b.title, what: `${b.items} project${b.items === 1 ? '' : 's'} on the docket`, due: b.board_date, href: `#/boards/${b.id}` })));
      const dec = await get('/api/decisions', me);
      add('senior', 'Senior leader decisions', 'Policy, authority and resource questions open before the ESF can be formally implemented.',
        dec.rows.filter((r: any) => r.state.status !== 'DECIDED').map((r: any): Item => ({ title: `#${r.ord} ${r.title}`, what: `${r.state.status === 'IN_REVIEW' ? 'In review' : r.state.status === 'DEFERRED' ? 'Deferred' : 'Open'}${r.severity === 'Critical' ? ' · critical' : ''}`,
          due: r.state.due ? iso(r.state.due) : null, href: '#/decisions', tone: r.severity === 'Critical' ? 'warn' : undefined })), '#/decisions');
    }

    if (me.role === 'J1') {
      const j1 = await get('/api/j1', me);
      add('gate', 'J1 items holding a gate', 'A project cannot pass its gate while the J1 item is open. Those with every other criterion closed are waiting only on J1.',
        j1.waiting.map((w: any): Item => ({ esh_id: w.esh_id, title: w.title, what: `Gate ${w.gate} · ${w.others_closed} of ${w.others} other criteria closed`, href: '#/p/' + w.esh_id, tone: w.others_closed === w.others ? 'warn' : undefined })), '#/j1');
      add('golive', 'Going live in the next 90 days', 'Workforce readiness before people are affected.',
        j1.coming.filter((c: any) => iso(c.go_live) >= today && iso(c.go_live) <= in90).map((c: any): Item => ({ esh_id: c.esh_id, title: c.title, what: `${c.headcount < 10 ? '<10' : c.headcount.toLocaleString('en-US')} people affected${c.union_pending ? ' · union notice pending' : ''}`, due: iso(c.go_live), href: '#/p/' + c.esh_id, tone: c.union_pending ? 'warn' : undefined })), '#/j1');
      add('actions', 'Review actions', 'Actions assigned to J1 at realization reviews.', actionItems('J1'), '#/realization');
    }

    if (me.role === 'ADMIN') {
      add('docket', 'Ready, not on a board docket', 'Every criterion is closed. Add them to the next board for their gate.',
        allProjects.filter((p: any) => p.ready && !p.board).map((p: any): Item => ({ esh_id: p.esh_id, title: p.title, what: `Gate ${p.gate}${G?.gates[p.gate]?.nextBoard ? ` · next board ${fd(G.gates[p.gate].nextBoard.board_date)}` : ' · no board scheduled'}`, href: '#/boards', tone: G?.gates[p.gate]?.nextBoard ? undefined : 'warn' })), '#/gates');
      if (call) {
        const dc = await get(`/api/datacalls/${call.fy}`, me);
        add('review', `FY${call.fy} data call: responses to review`, 'Approve each response or return it to the PM with a note.',
          dc.rows.filter((r: any) => r.status === 'SUBMITTED').map((r: any): Item => ({ esh_id: r.esh_id, title: r.title, what: `Submitted by ${r.pm}${r.changed?.length ? ` · ${r.changed.length} field${r.changed.length === 1 ? '' : 's'} changed` : ' · no changes'}`, due: callDue, href: '#/datacall' })), '#/datacall');
      }
      add('reviews', 'Realization reviews', 'Overdue, or due in the next 30 days.',
        [...(real?.overdue ?? []), ...(real?.upcoming ?? []).filter((r: any) => r.due_on <= in30)].map((r: any): Item => ({ esh_id: r.esh_id, title: r.title, what: `${r.months}-month review with ${r.owner ?? 'the owner'}`, due: r.due_on, href: '#/p/' + r.esh_id, tone: r.due_on < today ? 'warn' : undefined })), '#/realization');
      add('actions', 'R&D review actions', 'Actions assigned to R&D at realization reviews.', actionItems('R&D'), '#/realization');
      const unconfirmed = (await q(`SELECT count(*)::int n FROM project WHERE esf_source = 'SUGGESTED' AND esf_status IN ('ACTIVE','HOLD')`))[0]?.n ?? 0;
      if (unconfirmed) add('triage', 'Phase review', 'Projects whose ESF phase is still a suggestion from the workbook.',
        [{ title: `${unconfirmed} project${unconfirmed === 1 ? '' : 's'} to confirm`, what: 'Confirm or correct the suggested phase so they count in gate figures', href: '#/triage' }]);
    }

    const all = sections.flatMap(s => s.items);
    return {
      role: me.role, asOf: today,
      totals: { items: sections.reduce((a, s) => a + s.items.length + (s.more?.n ?? 0), 0), overdue: all.filter(i => i.due && i.due < today).length, warn: all.filter(i => i.tone === 'warn').length, week: all.filter(i => i.due && i.due >= today && i.due <= iso(new Date(AS_OF.getTime() + 7 * 864e5))).length },
      sections,
    };
  }));
}
