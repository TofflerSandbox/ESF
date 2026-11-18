import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { z } from 'zod';
import { audit } from './db/db.js';
import { AS_OF } from './config.js';
import { EXIT_REASONS, KOTTER, PATHWAY_CRIT, PHASES, STATUS_LABEL, TECH_RESULTS } from './domain.js';
import { healthData, homeData } from './home.js';
import { roiData } from './roi.js';
import { exitsData, gatesData } from './analysis.js';
import { registerOps } from './ops.js';
import { registerAssist } from './assist.js';
import { registerRoiAsk } from './roiAsk.js';
import { registerOwnership } from './ownership.js';
import { registerPrograms } from './programs.js';
import { OVERLAP_CRIT, overlapsFor, registerOverlap } from './overlap.js';
import { onGate4Pass, registerRealization, snapshotValue } from './realization.js';
import { DOC_TYPES } from './esfContent.js';
import { registerMyWork } from './mywork.js';
import { registerChanges } from './changes.js';

type User = { id: number; name: string; role: 'ADMIN' | 'PM' | 'AUTHORITY' | 'VIEWER' | 'J1' | 'SPONSOR'; person_id: number | null; org_id: number | null };

/** Kotter readiness is only ever reported in aggregate: per accelerator, across all sponsoring senior leaders assessed. */
async function kotterAggregate(db: PGlite) {
  const rows = (await db.query<any>(`SELECT r.accelerator a, count(*)::int n, avg(r.score)::float mean, avg(r.prior_score)::float prior,
      count(*) FILTER (WHERE r.score = 1)::int s1, count(*) FILTER (WHERE r.score = 2)::int s2, count(*) FILTER (WHERE r.score = 3)::int s3,
      count(*) FILTER (WHERE r.score = 4)::int s4, count(*) FILTER (WHERE r.score = 5)::int s5, max(r.assessed_at) assessed_at, bool_or(r.synthetic) synthetic
    FROM leader_readiness r GROUP BY r.accelerator ORDER BY r.accelerator`)).rows;
  return rows.map(r => ({ ...r, name: KOTTER[r.a - 1], dist: [r.s1, r.s2, r.s3, r.s4, r.s5] }));
}
type Q = PGlite | Transaction;

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export type { User };
const today = () => new Date().toISOString().slice(0, 10);

export function registerApi(app: FastifyInstance, db: PGlite) {
  /* ── auth stand-in: the UI sends x-esh-user (app_user.id). In production this comes from the OIDC token. ── */
  const userOf = async (req: FastifyRequest): Promise<User> => {
    const id = Number(req.headers['x-esh-user']);
    const u = id ? (await db.query<User>('SELECT id, name, role, person_id, org_id FROM app_user WHERE id=$1', [id])).rows[0] : undefined;
    return u ?? { id: 0, name: 'anonymous', role: 'VIEWER', person_id: null, org_id: null };
  };
  const projectByEsh = async (q: Q, esh: string) => {
    const p = (await q.query<Record<string, any>>('SELECT * FROM project WHERE esh_id=$1', [esh])).rows[0];
    if (!p) throw new HttpError(404, `No project ${esh}`);
    return p;
  };
  const canEdit = (u: User, p: Record<string, any>) => u.role === 'ADMIN' || (u.role === 'PM' && u.person_id != null && u.person_id === p.pm_id);
  const requireEdit = (u: User, p: Record<string, any>) => { if (!canEdit(u, p)) throw new HttpError(403, `${u.name} (${u.role}) cannot edit ${p.esh_id}`); };
  const requireRole = (u: User, ...roles: User['role'][]) => { if (!roles.includes(u.role)) throw new HttpError(403, `Requires role ${roles.join(' or ')}`); };
  /** A sponsor seat acts only for projects its organization sponsors; the admin can record on a sponsor's behalf. */
  const isSponsorOf = async (q: Q, u: User, projectId: number) => u.role === 'ADMIN' || (u.role === 'SPONSOR' && u.org_id != null
    && (await q.query(`SELECT 1 FROM project_org WHERE project_id=$1 AND org_id=$2 AND role='SPONSOR'`, [projectId, u.org_id])).rows.length > 0);
  const requireSponsor = async (q: Q, u: User, p: Record<string, any>) => {
    if (!(await isSponsorOf(q, u, p.id))) throw new HttpError(403, `Only ${p.esh_id}'s sponsoring organization (or the admin) can do this`);
  };
  const wrap = (fn: (req: FastifyRequest, u: User) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await fn(req, await userOf(req)); }
    catch (e) {
      if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: e.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
      req.log.error(e); return reply.code(500).send({ error: String((e as Error).message ?? e) });
    }
  };
  /** The latest data call with reported data — an open call in the Hub doesn't count until it closes. */
  const latestFy = async () => (await db.query<{ fy: number }>(`SELECT max(fy) fy FROM data_call WHERE status = 'CLOSED'`)).rows[0].fy;

  /* ── meta ── */
  app.get('/api/meta', wrap(async (_req, me) => {
    const fy = await latestFy();
    const [users, elements, programs, pms, criteria, priorities, fys, lastImport, synthetic, scenarios] = await Promise.all([
      db.query('SELECT id, name, role, person_id, org_id FROM app_user ORDER BY CASE role WHEN \'ADMIN\' THEN 0 WHEN \'AUTHORITY\' THEN 1 WHEN \'J1\' THEN 2 WHEN \'SPONSOR\' THEN 3 WHEN \'VIEWER\' THEN 4 ELSE 5 END, name'),
      db.query('SELECT * FROM element ORDER BY code'),
      db.query(`SELECT pr.code, pr.name, pr.element_code, count(p.id)::int AS n FROM program pr LEFT JOIN project p ON p.program_code = pr.code GROUP BY pr.code ORDER BY pr.code`),
      db.query('SELECT pe.id, pe.name, count(p.id)::int n FROM person pe JOIN project p ON p.pm_id = pe.id GROUP BY pe.id ORDER BY pe.name'),
      db.query('SELECT * FROM criterion_def ORDER BY gate, ord'),
      db.query('SELECT id, fy, owner, label, ord FROM priority ORDER BY fy, ord'),
      db.query(`SELECT fy, name, status FROM data_call WHERE status = 'CLOSED' ORDER BY fy`),
      db.query('SELECT at, report->\'totals\' totals FROM import_run ORDER BY id DESC LIMIT 1'),
      db.query<{ n: number }>('SELECT count(*)::int n FROM project WHERE esf_synthetic'),
      db.query('SELECT s.ord, s.esh_id, s.title, s.story, s.look_for, s.track, p.title AS project_title FROM demo_scenario s JOIN project p ON p.esh_id = s.esh_id ORDER BY s.ord'),
    ]);
    return { me, latestFy: fy, asOf: AS_OF.toISOString().slice(0, 10), phases: PHASES, statusLabels: STATUS_LABEL,
      users: users.rows, elements: elements.rows, programs: programs.rows, pms: pms.rows, criteria: criteria.rows,
      priorities: priorities.rows, fys: fys.rows, lastImport: lastImport.rows[0] ?? null,
      synthetic: { projects: synthetic.rows[0].n }, scenarios: scenarios.rows, kotter: KOTTER, exitReasons: EXIT_REASONS, techResults: TECH_RESULTS, docTypes: DOC_TYPES,
      openDataCall: (await db.query<any>(`SELECT fy, due_at FROM data_call WHERE status = 'OPEN' LIMIT 1`)).rows[0] ?? null,
      unconfirmed: (await db.query<{ n: number }>(`SELECT count(*)::int n FROM project WHERE esf_source = 'SUGGESTED'`)).rows[0].n };
  }));

  /* ── dashboard ── */
  app.get('/api/dashboard', wrap(async req => {
    const fy = Number((req.query as any).fy) || await latestFy();
    const asOf = AS_OF.toISOString().slice(0, 10);
    const inFy = `p.id IN (SELECT project_id FROM project_snapshot WHERE fy = ${fy})`;
    const live = `p.status_code IN ('A','B','C')`;
    const q = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);
    const [byYear, byStatus, byElement, byProgram, byTransition, esf, triage, heat, topPriorities, alertsRaw, ready] = await Promise.all([
      q(`SELECT fy, coalesce(status_code,'?') s, count(*)::int n FROM project_snapshot GROUP BY fy, s ORDER BY fy, s`),
      q(`SELECT coalesce(status_code,'?') s, count(*)::int n FROM project p WHERE ${inFy} GROUP BY s ORDER BY s`),
      q(`SELECT coalesce(element_code,'?') k, count(*)::int n, count(*) FILTER (WHERE ${live})::int live FROM project p WHERE ${inFy} GROUP BY k ORDER BY n DESC`),
      q(`SELECT coalesce(p.program_code,'?') k, pr.element_code el, count(*)::int n, count(*) FILTER (WHERE ${live})::int live FROM project p LEFT JOIN program pr ON pr.code = p.program_code WHERE ${inFy} GROUP BY k, el ORDER BY live DESC, n DESC`),
      q(`SELECT coalesce(transition_type,'(none)') k, count(*)::int n, count(*) FILTER (WHERE transition_phase ILIKE 'complete%')::int done FROM project p WHERE ${inFy} GROUP BY k ORDER BY n DESC`),
      q(`SELECT esf_status, esf_phase, esf_source, count(*)::int n FROM project p WHERE ${inFy} GROUP BY 1,2,3`),
      q(`SELECT esf_source, count(*)::int n FROM project p WHERE ${inFy} GROUP BY 1`),
      q(`SELECT coalesce(p.program_code,'?') program, pri.owner, count(DISTINCT p.id)::int n
         FROM project p JOIN project_priority pp ON pp.project_id = p.id JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1
         GROUP BY 1,2`, [fy]),
      q(`SELECT pri.id, pri.owner, pri.label, count(*)::int n FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1
         GROUP BY pri.id ORDER BY n DESC LIMIT 12`, [fy]),
      q(`SELECT p.esh_id, p.title, p.status_code, p.pop_end,
           (p.pop_end >= $1::date AND p.pop_end < $1::date + 180) AS ending,
           (p.pop_end < $1::date AND p.status_code IN ('A','B')) AS lapsed,
           NOT EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'SPONSOR') AS nosponsor,
           NOT EXISTS (SELECT 1 FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $2 WHERE pp.project_id = p.id) AS noalign,
           EXISTS (SELECT 1 FROM funding_line f JOIN gate_decision g ON g.project_id = p.id AND g.gate = 4 AND g.outcome = 'PASS'
                   WHERE f.project_id = p.id AND f.source ILIKE 'J68%' AND f.appropriation ILIKE 'RDT&E%' AND f.pop_end > g.decided_at) AS ada
         FROM project p WHERE ${inFy} AND (${live} OR EXISTS (SELECT 1 FROM funding_line f WHERE f.project_id = p.id))`, [asOf, fy]),
      readyProjects(db),
    ]);
    const alerts: { tag: string; esh_id: string; title: string; text: string }[] = [];
    for (const a of alertsRaw) {
      const d = a.pop_end ? new Date(a.pop_end).toISOString().slice(0, 10) : null;
      if (a.ada) alerts.push({ tag: 'ADA', esh_id: a.esh_id, title: a.title, text: 'J68 RDT&E period of performance extends beyond the Gate 4 decision — Anti-Deficiency exposure; J8/J7 review.' });
      if (a.lapsed) alerts.push({ tag: 'POP-LAPSED', esh_id: a.esh_id, title: a.title, text: `PoP ended ${d} but status is still ${STATUS_LABEL[a.status_code]} — data call needs an update.` });
      if (a.ending && ['A', 'B', 'C'].includes(a.status_code)) alerts.push({ tag: 'POP-END', esh_id: a.esh_id, title: a.title, text: `PoP ends ${d} (within 6 months) — confirm follow-on funding or transition.` });
      if (a.nosponsor && ['A', 'B'].includes(a.status_code)) alerts.push({ tag: 'NO-SPONSOR', esh_id: a.esh_id, title: a.title, text: 'No MSC / J-code sponsor on record.' });
      if (a.noalign && ['A', 'B'].includes(a.status_code)) alerts.push({ tag: 'NO-ALIGN', esh_id: a.esh_id, title: a.title, text: `Not aligned to any FY${fy} MSC/J-code priority.` });
    }
    for (const r of ready) alerts.unshift({ tag: 'READY', esh_id: r.esh_id, title: r.title, text: `All Gate ${r.gate} criteria met — ready for decision authority.` });
    const order = ['ADA', 'READY', 'POP-LAPSED', 'POP-END', 'NO-SPONSOR', 'NO-ALIGN'];
    alerts.sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag));
    const alertCounts = Object.fromEntries(order.map(t => [t, alerts.filter(a => a.tag === t).length]));
    return { fy, asOf, byYear, byStatus, byElement, byProgram, byTransition, esf, triage, heat, topPriorities, alerts, alertCounts, ready };
  }));

  /* ── director's home and data health ── */
  app.get('/api/home', wrap(async req => {
    const fy = Number((req.query as any).fy) || await latestFy();
    const [home, health] = await Promise.all([homeData(db, fy, await readyProjects(db)), healthData(db, fy)]);
    // one definition of data health: the Data health page's
    return { ...home, health: { score: health.score, live: health.live, clean: health.clean, flagged: health.projects.length, filledProjects: home.health.filledProjects } };
  }));
  app.get('/api/exits', wrap(async () => exitsData(db)));
  app.get('/api/gates', wrap(async () => gatesData(db)));
  app.get('/api/roi', wrap(async req => roiData(db, Math.min(10, Math.max(1, Number((req.query as any).horizon) || 5)))));
  app.get('/api/health', wrap(async req => healthData(db, Number((req.query as any).fy) || await latestFy())));

  /* ── phase dashboard: every project in one ESF phase + phase metrics ── */
  app.get('/api/phase/:ph', wrap(async req => {
    const ph = Number((req.params as any).ph);
    if (!Number.isInteger(ph) || ph < 0 || ph > 5) throw new HttpError(400, 'Phase must be 0–5');
    const fy = Number((req.query as any).fy) || await latestFy();
    const asOf = AS_OF.toISOString().slice(0, 10);
    const gate = Math.min(ph, 4);
    const q = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);
    const inFy = `p.id IN (SELECT project_id FROM project_snapshot WHERE fy = ${fy})`;
    const inPhase = ph === 5 ? `p.esf_status = 'AT_SCALE'` : `p.esf_phase = ${ph} AND p.esf_status IN ('ACTIVE','HOLD')`;
    const [rows, exits, criteria, moves] = await Promise.all([
      q(`SELECT p.esh_id, p.title, p.element_code, p.program_code, pe.name pm, p.status_code, p.pop_start, p.pop_end,
                p.esf_phase, p.esf_status, p.esf_source, p.esf_reason, p.transition_type, p.transition_phase,
                (SELECT string_agg(o.name, ' · ' ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsors,
                (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsor_list,
                (SELECT count(*)::int FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1 WHERE pp.project_id = p.id) npri,
                (SELECT max(entered_at) FROM phase_record r WHERE r.project_id = p.id AND r.exited_at IS NULL) entered_at,
                (SELECT count(*)::int FROM criterion_status s JOIN criterion_def d ON d.id = s.criterion_id AND d.gate = $2 WHERE s.project_id = p.id AND s.status IN ('MET','WAIVED')) crit_done,
                (SELECT coalesce(sum(amount),0)::float FROM funding_line f WHERE f.project_id = p.id) funding,
                (SELECT coalesce(sum(annual_value),0)::float FROM value_case v WHERE v.project_id = p.id) value,
                (p.pop_end IS NOT NULL AND p.pop_end < $3::date AND p.status_code IN ('A','B','C')) lapsed,
                (p.pop_end IS NOT NULL AND p.pop_end >= $3::date AND p.pop_end < $3::date + 180) ending
         FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
         WHERE ${inFy} AND ${inPhase} ORDER BY p.esh_id`, [fy, gate, asOf]),
      q(`SELECT p.esh_id, p.title, p.program_code, p.esf_status, p.esf_source FROM project p
         WHERE ${inFy} AND p.esf_phase = ${ph} AND p.esf_status IN ('SUNSET','DESCOPED') ORDER BY p.esh_id`),
      q(`SELECT d.id, d.ord, d.text, d.non_waivable,
                count(*) FILTER (WHERE s.status = 'MET')::int met, count(*) FILTER (WHERE s.status = 'WAIVED')::int waived
         FROM criterion_def d
         LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id IN (SELECT p.id FROM project p WHERE ${inFy} AND ${inPhase})
         WHERE d.gate = $1 GROUP BY d.id ORDER BY d.ord`, [gate]),
      q(`SELECT g.outcome, count(*)::int n FROM gate_decision g JOIN project p ON p.id = g.project_id WHERE g.gate = $1 AND ${inFy} GROUP BY 1`, [gate]),
    ]);
    const ready = (await readyProjects(db)).filter(r => rows.some((x: any) => x.esh_id === r.esh_id)).map(r => r.esh_id);
    return { fy, asOf, phase: ph, gate, rows, exits, criteria, gateDecisions: moves, ready };
  }));

  /* ── projects list ── */
  app.get('/api/projects', wrap(async req => {
    const f = req.query as Record<string, string | undefined>;
    const where: string[] = [], params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', '$' + params.length)); };
    if (f.q) add(`(p.title ILIKE ? OR p.esh_id ILIKE $${params.length + 1} OR p.description ILIKE $${params.length + 1} OR EXISTS (SELECT 1 FROM project_contract c WHERE c.project_id = p.id AND c.number ILIKE $${params.length + 1}) OR EXISTS (SELECT 1 FROM project_external_id x WHERE x.project_id = p.id AND x.value ILIKE $${params.length + 1}))`, `%${f.q}%`);
    if (f.fy) add('p.id IN (SELECT project_id FROM project_snapshot WHERE fy = ?)', Number(f.fy));
    if (f.element) add('p.element_code = ?', f.element);
    if (f.program) add('p.program_code = ?', f.program);
    if (f.pm) add('p.pm_id = ?', Number(f.pm));
    if (f.status) add('p.status_code = ?', f.status);
    if (f.esfStatus) add('p.esf_status = ?', f.esfStatus);
    if (f.phase) add('p.esf_phase = ?', Number(f.phase));
    if (f.source) add('p.esf_source = ?', f.source);
    if (f.org) add('EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.org_id = ?)', Number(f.org));
    if (f.priority) add('EXISTS (SELECT 1 FROM project_priority pp WHERE pp.project_id = p.id AND pp.priority_id = ?)', Number(f.priority));
    if (f.owner) add(`EXISTS (SELECT 1 FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id WHERE pp.project_id = p.id AND pri.owner = ? ${f.fy ? 'AND pri.fy = ' + Number(f.fy) : ''})`, f.owner);
    if (f.mine === '1') { const me = await userOf(req); add('p.pm_id = ?', me.person_id ?? -1); }
    const rows = (await db.query(`
      SELECT p.esh_id, p.title, p.element_code, p.program_code, pe.name pm, p.status_code, p.pop_start, p.pop_end,
             p.esf_phase, p.esf_status, p.esf_source, p.transition_type, p.transition_phase, p.first_fy, p.last_fy,
             (SELECT string_agg(o.name, ' · ' ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsors,
             (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsor_list,
             (SELECT array_agg(fy ORDER BY fy) FROM project_snapshot s WHERE s.project_id = p.id) fys,
             (SELECT count(*)::int FROM project_priority pp WHERE pp.project_id = p.id) npri
      FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.esh_id`, params)).rows;
    return { rows };
  }));

  /* ── project record ── */
  app.get('/api/projects/:esh', wrap(async (req, me) => {
    const p = await projectByEsh(db, (req.params as any).esh);
    const id = p.id;
    const q = (sql: string) => db.query<any>(sql, [id]).then(r => r.rows);
    const [pm, orgs, ext, contracts, snapshots, priorities, phases, gates, criteria, funding, values, paths, auditRows] = await Promise.all([
      p.pm_id ? db.query<any>('SELECT id, name FROM person WHERE id=$1', [p.pm_id]).then(r => r.rows[0]) : null,
      q('SELECT o.id, o.name, o.kind, po.role, po.synthetic FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id=$1 ORDER BY po.role, o.name'),
      q('SELECT system, value FROM project_external_id WHERE project_id=$1 ORDER BY system, value'),
      q(`SELECT number, synthetic FROM project_contract WHERE project_id=$1 AND number ~ '[0-9]' ORDER BY number`),
      q('SELECT fy, source_sheet, source_row, status_code, transition_phase, pm_name, raw FROM project_snapshot WHERE project_id=$1 ORDER BY fy'),
      q('SELECT pri.id, pri.fy, pri.owner, pri.label, pp.synthetic FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id WHERE pp.project_id=$1 ORDER BY pri.fy DESC, pri.ord'),
      q('SELECT * FROM phase_record WHERE project_id=$1 ORDER BY entered_at, id'),
      q('SELECT * FROM gate_decision WHERE project_id=$1 ORDER BY decided_at, id'),
      q(`SELECT d.id, d.gate, d.ord, d.text, d.non_waivable, d.owner, d.proposal, coalesce(s.status,'PENDING') status, s.evidence, s.updated_by, s.updated_at, coalesce(s.synthetic, false) synthetic
         FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id=$1 ORDER BY d.gate, d.ord`),
      q('SELECT * FROM funding_line WHERE project_id=$1 ORDER BY fy, id'),
      q('SELECT * FROM value_case WHERE project_id=$1 ORDER BY is_primary DESC, id'),
      q('SELECT t.*, o.name receiver FROM transition_pathway t LEFT JOIN org o ON o.id = t.receiver_org_id WHERE t.project_id=$1 ORDER BY t.id'),
      db.query<any>('SELECT * FROM audit_event WHERE entity=\'project\' AND entity_id=$1 ORDER BY at DESC, id DESC LIMIT 50', [p.esh_id]).then(r => r.rows),
    ]);
    const [impacts, adoption, contacts, fills, documents] = await Promise.all([
      q('SELECT * FROM workforce_impact WHERE project_id=$1 ORDER BY headcount DESC'),
      q('SELECT day, adoption_pct, synthetic FROM adoption_measure WHERE project_id=$1 ORDER BY day'),
      q(`SELECT pc.role, op.name, op.title, op.office, op.email, op.phone, op.focal_rank, op.synthetic, o.id org_id, o.name org
         FROM project_contact pc JOIN org_person op ON op.id = pc.org_person_id JOIN org o ON o.id = op.org_id
         WHERE pc.project_id=$1 ORDER BY CASE pc.role WHEN 'SPONSOR' THEN 0 WHEN 'CO_SPONSOR' THEN 1 WHEN 'TRANSITION_PARTNER' THEN 2 ELSE 3 END, o.name`),
      q('SELECT field FROM project_fill WHERE project_id=$1 ORDER BY field').then(rs => rs.map((x: any) => x.field)),
      q(`SELECT id, doc_type, title, criterion_id, file_name, size, uploaded_by, uploaded_at, synthetic, (storage_key IS NOT NULL) has_file
         FROM document WHERE project_id=$1 ORDER BY uploaded_at DESC`),
    ]);
    const workforce = { impacts, adoption };
    return { project: p, pm, orgs, ext, contracts, snapshots, priorities, phases, gates, criteria, funding, values, paths, audit: auditRows, workforce, contacts, fills, documents,
      canEdit: canEdit(me, p), canJ1: me.role === 'J1' || me.role === 'ADMIN', canDecide: me.role === 'ADMIN' || me.role === 'AUTHORITY', canTriage: me.role === 'ADMIN',
      canSponsor: me.role === 'ADMIN' || (me.role === 'SPONSOR' && orgs.some((o: any) => o.role === 'SPONSOR' && o.id === me.org_id)) };
  }));

  /* ── PM data-call edit ── */
  const ProjectPatch = z.object({
    description: z.string().max(4000).nullable(), status_code: z.enum(['A', 'B', 'C', 'D', 'E']),
    pop_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), pop_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    transition_phase: z.string().max(200).nullable(), transition_type: z.string().max(200).nullable(),
    environment: z.string().max(200).nullable(), charter: z.string().max(300).nullable(), okrs: z.string().max(200).nullable(),
  }).partial().strict();
  app.patch('/api/projects/:esh', wrap(async (req, me) => {
    const body = ProjectPatch.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      requireEdit(me, p);
      const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);
      const keys = (Object.keys(body) as (keyof typeof body)[]).filter(k => norm(p[k]) !== norm(body[k]));
      if (!keys.length) return { ok: true, changed: 0 };
      const before = Object.fromEntries(keys.map(k => [k, p[k]]));
      await tx.query(`UPDATE project SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [p.id, ...keys.map(k => body[k])]);
      await audit(tx, me.name, 'project', p.esh_id, 'EDIT', before, Object.fromEntries(keys.map(k => [k, body[k]])));
      return { ok: true, changed: keys.length };
    });
  }));

  /* ── ESF triage: confirm or correct the suggested phase ── */
  const Triage = z.object({ phase: z.number().int().min(0).max(5), status: z.enum(['ACTIVE', 'HOLD', 'AT_SCALE', 'SUNSET', 'DESCOPED']), note: z.string().max(1000).optional() }).strict();
  app.post('/api/projects/:esh/triage', wrap(async (req, me) => {
    requireRole(me, 'ADMIN');
    const b = Triage.parse(req.body);
    if (b.status === 'AT_SCALE' && b.phase !== 5) throw new HttpError(400, 'AT_SCALE requires phase 5');
    if (b.phase === 5 && b.status !== 'AT_SCALE') throw new HttpError(400, 'Phase 5 requires status AT_SCALE');
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      const before = { esf_phase: p.esf_phase, esf_status: p.esf_status, esf_source: p.esf_source };
      if (p.esf_phase !== b.phase) {
        await tx.query('UPDATE phase_record SET exited_at = $2 WHERE project_id = $1 AND exited_at IS NULL', [p.id, today()]);
        await tx.query('INSERT INTO phase_record (project_id, phase, entered_at) VALUES ($1,$2,$3)', [p.id, b.phase, today()]);
      }
      await tx.query(`UPDATE project SET esf_phase=$2, esf_status=$3, esf_source='CONFIRMED', esf_reason=$4, esf_synthetic=false, updated_at=now() WHERE id=$1`,
        [p.id, b.phase, b.status, b.note ? `Confirmed by ${me.name}: ${b.note}` : `Confirmed by ${me.name}`]);
      await audit(tx, me.name, 'project', p.esh_id, 'ESF_TRIAGE', before, { ...b, esf_source: 'CONFIRMED' });
      return { ok: true };
    });
  }));

  /* ── gate criteria ── */
  const Crit = z.object({ status: z.enum(['MET', 'PENDING', 'WAIVED']), evidence: z.string().max(2000).nullable().optional() }).strict();
  app.put('/api/projects/:esh/criteria/:cid', wrap(async (req, me) => {
    const b = Crit.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      const d = (await tx.query<any>('SELECT * FROM criterion_def WHERE id=$1', [Number((req.params as any).cid)])).rows[0];
      if (!d) throw new HttpError(404, 'No such criterion');
      // J1-owned criteria are closed by J1; sponsor-owned ones are signed by the sponsoring organization; everything else by the PM.
      // A sponsor's commitment or a Hub proposal can only be waived by a gate authority: nobody waives their own commitment.
      if (b.status === 'WAIVED' && (d.owner === 'SPONSOR' || d.proposal)) requireRole(me, 'AUTHORITY', 'ADMIN');
      else if (d.owner === 'J1') requireRole(me, 'J1', 'ADMIN');
      else if (d.owner === 'SPONSOR') await requireSponsor(tx, me, p);
      else requireEdit(me, p);
      // Hub check on the ESF's "No disqualifying duplication": every strong overlap must be linked or dismissed first
      if (d.gate === OVERLAP_CRIT.gate && d.ord === OVERLAP_CRIT.ord && b.status === 'MET') {
        const o = await overlapsFor(tx, p.id);
        if (o.unresolvedStrong.length) throw new HttpError(409, `Resolve the likely overlaps first (link or dismiss): ${o.unresolvedStrong.map(c => `${c.esh_id} ${c.title}`).join('; ')}`);
        const resolved = o.candidates.filter(c => c.link);
        b.evidence = b.evidence?.trim() || `Related-work review in the Hub: ${o.candidates.length} similar project${o.candidates.length === 1 ? '' : 's'} checked, ${resolved.length} linked or dismissed, none disqualifying`;
      }
      if (d.gate === PATHWAY_CRIT.gate && d.ord === PATHWAY_CRIT.ord && b.status === 'MET') {
        const t = (await tx.query<any>(`SELECT t.*, o.name receiver FROM transition_pathway t LEFT JOIN org o ON o.id = t.receiver_org_id
          WHERE t.project_id=$1 AND t.status IN ('COMMITTED','ACTIVE') AND t.receiver_org_id IS NOT NULL AND t.funding_line IS NOT NULL AND (t.path = 'A_WCF' OR t.pom_fy IS NOT NULL)
          ORDER BY t.id LIMIT 1`, [p.id])).rows[0];
        if (!t) throw new HttpError(409, 'Commit a transition pathway with a named receiving organization, funding line and (Path B) POM year first');
        b.evidence = b.evidence?.trim() || `Pathway committed: ${t.receiver} · ${t.funding_line}${t.pom_fy ? ` · POM FY${t.pom_fy}` : ''}`;
      }
      if (d.gate !== Math.min(p.esf_phase ?? 0, 4)) throw new HttpError(409, `Criterion belongs to Gate ${d.gate}; project is working toward Gate ${Math.min(p.esf_phase ?? 0, 4)}`);
      if (b.status === 'WAIVED' && d.non_waivable) throw new HttpError(409, 'This criterion is non-waivable');
      if (b.status === 'MET' && !b.evidence?.trim()) throw new HttpError(400, 'Evidence reference is required to mark a criterion MET');
      const before = (await tx.query<any>('SELECT status, evidence FROM criterion_status WHERE project_id=$1 AND criterion_id=$2', [p.id, d.id])).rows[0] ?? null;
      await tx.query(`INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (project_id, criterion_id) DO UPDATE SET status=EXCLUDED.status, evidence=EXCLUDED.evidence, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [p.id, d.id, b.status, b.evidence ?? null, me.name]);
      await audit(tx, me.name, 'project', p.esh_id, 'CRITERION', before, { gate: d.gate, criterion: d.text, ...b });
      return { ok: true };
    });
  }));

  /* ── gate decision ── */
  const Gate = z.object({
    outcome: z.enum(['PASS', 'SUNSET', 'DESCOPE', 'HOLD']), rationale: z.string().min(3).max(4000), decided_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // why it stopped — required for SUNSET / DESCOPE so exits can be analysed
    exit_reason: z.enum(Object.keys(EXIT_REASONS) as [keyof typeof EXIT_REASONS]).optional(),
    technical_result: z.enum(['MET', 'PARTIAL', 'NOT_MET']).optional(),
  }).strict();
  app.post('/api/projects/:esh/gates', wrap(async (req, me) => {
    requireRole(me, 'AUTHORITY', 'ADMIN');
    const b = Gate.parse(req.body);
    return db.transaction(async tx => recordGate(tx, me, await projectByEsh(tx, (req.params as any).esh), b));
  }));

  /** Record a gate decision with every rule enforced. Shared by the project page and gate boards. */
  async function recordGate(tx: Q, me: User, p: Record<string, any>, b: z.infer<typeof Gate>) {
    {
      if (p.esf_source !== 'CONFIRMED') throw new HttpError(409, 'Confirm the project\'s ESF phase (triage) before recording a gate decision');
      if (!['ACTIVE', 'HOLD'].includes(p.esf_status)) throw new HttpError(409, `Project is ${p.esf_status}; no gate pending`);
      const gate = Math.min(p.esf_phase, 4);
      const crit = (await tx.query<any>(`SELECT d.text, d.non_waivable, coalesce(s.status,'PENDING') status FROM criterion_def d
        LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = $1 WHERE d.gate = $2`, [p.id, gate])).rows;
      if (b.outcome === 'PASS') {
        const open = crit.filter(c => c.status === 'PENDING' || (c.non_waivable && c.status !== 'MET'));
        if (open.length) throw new HttpError(409, `Cannot PASS Gate ${gate}: open criteria — ${open.map(c => c.text).join('; ')}`);
      }
      const stop = b.outcome === 'SUNSET' || b.outcome === 'DESCOPE';
      if (stop && (!b.exit_reason || !b.technical_result)) throw new HttpError(400, 'A sunset or descope needs a reason and a technical result, so exits can be analysed');
      const date = b.decided_at ?? today();
      const dec = (await tx.query<any>('INSERT INTO gate_decision (project_id, gate, outcome, decided_at, authority, rationale, recorded_by, exit_reason, technical_result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [p.id, gate, b.outcome, date, me.role === 'AUTHORITY' ? me.name : 'Recorded by admin', b.rationale, me.name, stop ? b.exit_reason : null, stop ? b.technical_result : null])).rows[0];
      // freeze the value claim and cost at every decision; passing Gate 4 also freezes the realized-value baseline and schedules realization reviews
      await snapshotValue(tx, p.id, gate, dec.id, b.outcome, date);
      if (b.outcome === 'PASS' && gate === 4) await onGate4Pass(tx, p.id, date);
      let phase = p.esf_phase, status = p.esf_status;
      if (b.outcome === 'PASS') {
        phase = gate + 1; status = phase === 5 ? 'AT_SCALE' : 'ACTIVE';
        await tx.query('UPDATE phase_record SET exited_at=$2 WHERE project_id=$1 AND exited_at IS NULL', [p.id, date]);
        await tx.query('INSERT INTO phase_record (project_id, phase, entered_at) VALUES ($1,$2,$3)', [p.id, phase, date]);
      } else if (b.outcome === 'HOLD') {
        status = 'HOLD';
      } else {
        status = b.outcome === 'SUNSET' ? 'SUNSET' : 'DESCOPED';
        await tx.query('UPDATE phase_record SET exited_at=$2 WHERE project_id=$1 AND exited_at IS NULL', [p.id, date]);
      }
      await tx.query('UPDATE project SET esf_phase=$2, esf_status=$3, updated_at=now() WHERE id=$1', [p.id, phase, status]);
      await audit(tx, me.name, 'project', p.esh_id, 'GATE_DECISION', { esf_phase: p.esf_phase, esf_status: p.esf_status }, { gate, ...b, esf_phase: phase, esf_status: status });
      return { ok: true, gate, phase, status };
    }
  }

  registerOps(app, db, { wrap, requireRole, requireEdit, canEdit, projectByEsh, recordGate, Gate, HttpError, latestFy });
  registerAssist(app, db, { wrap });
  registerRoiAsk(app, db, { wrap });
  registerOwnership(app, db, { wrap });
  registerPrograms(app, db, { wrap, HttpError });
  registerOverlap(app, db, { wrap, canEdit, projectByEsh, HttpError });
  registerRealization(app, db, { wrap, requireRole, canEdit, projectByEsh, HttpError });
  registerMyWork(app, db, { wrap });
  registerChanges(app, db, { wrap });

  /* ── funding, value case, pathways ── */
  const Funding = z.object({ fy: z.number().int().min(2015).max(2040), appropriation: z.enum(['RDT&E BA3', 'RDT&E BA6', 'O&M', 'WCF', 'Procurement']),
    source: z.string().min(2).max(120), amount: z.number().nonnegative().max(1e10), pop_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict();
  app.post('/api/projects/:esh/funding', wrap(async (req, me) => {
    const b = Funding.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh); requireEdit(me, p);
      const r = (await tx.query<any>('INSERT INTO funding_line (project_id, fy, appropriation, source, amount, pop_end) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [p.id, b.fy, b.appropriation, b.source, b.amount, b.pop_end ?? null])).rows[0];
      await audit(tx, me.name, 'project', p.esh_id, 'FUNDING_ADD', null, b);
      return r;
    });
  }));

  const Value = z.object({ path: z.enum(['REVENUE', 'COST', 'RISK', 'PERFORMANCE']), is_primary: z.boolean(), metric: z.string().min(2).max(300),
    baseline: z.string().max(300).nullable().optional(), projected: z.string().max(300).nullable().optional(),
    annual_value: z.number().nonnegative().max(1e10).nullable().optional(), narrative: z.string().max(4000).nullable().optional() }).strict();
  app.post('/api/projects/:esh/value-cases', wrap(async (req, me) => {
    const b = Value.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh); requireEdit(me, p);
      if (b.is_primary) await tx.query('UPDATE value_case SET is_primary=false WHERE project_id=$1', [p.id]);
      const r = (await tx.query<any>('INSERT INTO value_case (project_id, path, is_primary, metric, baseline, projected, annual_value, narrative) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [p.id, b.path, b.is_primary, b.metric, b.baseline ?? null, b.projected ?? null, b.annual_value ?? null, b.narrative ?? null])).rows[0];
      await audit(tx, me.name, 'project', p.esh_id, 'VALUE_CASE_ADD', null, b);
      return r;
    });
  }));

  // The PM (or the sponsor) declares a pathway; only the sponsoring organization commits it, and a commitment must name
  // who receives it, the line that funds it, and (Path B) the POM year. Status only moves forward, and a commitment is locked.
  const PathDetail = { receiver_org_id: z.number().int().positive().nullable().optional(), funding_line: z.string().min(3).max(200).nullable().optional(),
    pom_fy: z.number().int().min(2026).max(2040).nullable().optional() };
  const Path = z.object({ path: z.enum(['A_WCF', 'B_POM']), mechanism: z.string().min(3).max(300), ...PathDetail }).strict();
  app.post('/api/projects/:esh/pathways', wrap(async (req, me) => {
    const b = Path.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      if (!canEdit(me, p)) await requireSponsor(tx, me, p);
      const r = (await tx.query<any>(`INSERT INTO transition_pathway (project_id, path, mechanism, status, receiver_org_id, funding_line, pom_fy) VALUES ($1,$2,$3,'DECLARED',$4,$5,$6) RETURNING id`,
        [p.id, b.path, b.mechanism, b.receiver_org_id ?? null, b.funding_line ?? null, b.pom_fy ?? null])).rows[0];
      await audit(tx, me.name, 'project', p.esh_id, 'PATHWAY_DECLARE', null, b);
      return r;
    });
  }));
  const PathStatus = z.object({ status: z.enum(['COMMITTED', 'ACTIVE']), ...PathDetail }).strict();
  app.post('/api/projects/:esh/pathways/:pid/advance', wrap(async (req, me) => {
    const b = PathStatus.parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      await requireSponsor(tx, me, p);
      const t = (await tx.query<any>('SELECT * FROM transition_pathway WHERE id=$1 AND project_id=$2', [Number((req.params as any).pid), p.id])).rows[0];
      if (!t) throw new HttpError(404, 'No such pathway');
      const order = ['DECLARED', 'COMMITTED', 'ACTIVE'];
      if (order.indexOf(b.status) !== order.indexOf(t.status) + 1) throw new HttpError(409, `Pathway is ${t.status}; can only advance one step, and a commitment is locked once made`);
      const next = { receiver_org_id: b.receiver_org_id ?? t.receiver_org_id, funding_line: b.funding_line ?? t.funding_line, pom_fy: t.path === 'B_POM' ? b.pom_fy ?? t.pom_fy : null };
      if (b.status === 'COMMITTED') {
        const missing = [!next.receiver_org_id && 'a receiving organization', !next.funding_line && 'a funding line', t.path === 'B_POM' && !next.pom_fy && 'a POM year'].filter(Boolean);
        if (missing.length) throw new HttpError(400, `A commitment needs ${missing.join(', ')}`);
      }
      await tx.query(`UPDATE transition_pathway SET status=$2, committed_at=coalesce(committed_at, CASE WHEN $2='COMMITTED' THEN $3::date END),
        receiver_org_id=$4, funding_line=$5, pom_fy=$6 WHERE id=$1`, [t.id, b.status, today(), next.receiver_org_id, next.funding_line, next.pom_fy]);
      await audit(tx, me.name, 'project', p.esh_id, 'PATHWAY_ADVANCE', { status: t.status }, { status: b.status, ...next });
      return { ok: true };
    });
  }));
  // A commitment made before the Hub asked for receiver, line and POM year can have its blanks filled in; filled fields stay locked.
  app.patch('/api/projects/:esh/pathways/:pid', wrap(async (req, me) => {
    const b = z.object(PathDetail).strict().parse(req.body);
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      await requireSponsor(tx, me, p);
      const t = (await tx.query<any>('SELECT * FROM transition_pathway WHERE id=$1 AND project_id=$2', [Number((req.params as any).pid), p.id])).rows[0];
      if (!t) throw new HttpError(404, 'No such pathway');
      if (b.pom_fy != null && t.path !== 'B_POM') throw new HttpError(400, 'A POM year applies only to Path B (POM); Path A recovers cost through a WCF rate');
      const locked = (Object.keys(b) as (keyof typeof b)[]).filter(k => t.status !== 'DECLARED' && t[k] != null && b[k] !== t[k]);
      if (locked.length) throw new HttpError(409, `Pathway is ${t.status}; ${locked.join(', ')} already committed and locked`);
      await tx.query('UPDATE transition_pathway SET receiver_org_id=coalesce($2, receiver_org_id), funding_line=coalesce($3, funding_line), pom_fy=coalesce($4, pom_fy) WHERE id=$1',
        [t.id, b.receiver_org_id ?? null, b.funding_line ?? null, b.pom_fy ?? null]);
      await audit(tx, me.name, 'project', p.esh_id, 'PATHWAY_DETAIL', { receiver_org_id: t.receiver_org_id, funding_line: t.funding_line, pom_fy: t.pom_fy }, b);
      return { ok: true };
    });
  }));

  /* ── J1: workforce & change ── */
  app.get('/api/j1', wrap(async () => {
    const asOf = AS_OF.toISOString().slice(0, 10);
    const q = (sql: string, params: unknown[] = []) => db.query<any>(sql, params).then(r => r.rows);
    const [coming, gates, waiting, kotter, sustain, anchors] = await Promise.all([
      q(`SELECT p.esh_id, p.title, p.esf_phase, p.esf_status, p.esf_source, min(w.go_live) go_live, sum(w.headcount)::int headcount,
           string_agg(DISTINCT w.org, ' · ') orgs, string_agg(DISTINCT w.series_title, ' · ') series, round(avg(w.training_pct))::int training_pct,
           bool_or(w.union_notice = 'PENDING') union_pending, bool_or(w.change_type = 'ROLE_REDESIGN') redesign
         FROM workforce_impact w JOIN project p ON p.id = w.project_id
         WHERE p.esf_status IN ('ACTIVE','HOLD') AND w.go_live >= $1::date AND w.go_live < $1::date + 540
         GROUP BY p.id ORDER BY min(w.go_live)`, [asOf]),
      q(`SELECT d.gate, d.ord, d.text,
           count(*) FILTER (WHERE LEAST(p.esf_phase, 4) = d.gate AND p.esf_status IN ('ACTIVE','HOLD') AND p.esf_source = 'CONFIRMED')::int at_gate,
           count(*) FILTER (WHERE LEAST(p.esf_phase, 4) = d.gate AND p.esf_status IN ('ACTIVE','HOLD') AND p.esf_source = 'CONFIRMED' AND s.status = 'MET')::int met_now,
           count(*) FILTER (WHERE s.status = 'MET')::int met_all,
           count(*) FILTER (WHERE s.status = 'WAIVED')::int waived_all
         FROM criterion_def d CROSS JOIN project p LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = p.id
         WHERE d.owner = 'J1' GROUP BY d.id ORDER BY d.gate`),
      q(`SELECT p.esh_id, p.title, LEAST(p.esf_phase, 4) gate, p.esf_phase, pe.name pm,
           (SELECT count(*)::int FROM criterion_def d2 JOIN criterion_status s2 ON s2.criterion_id = d2.id AND s2.project_id = p.id AND s2.status <> 'PENDING'
              WHERE d2.gate = LEAST(p.esf_phase, 4) AND d2.owner <> 'J1') others_closed,
           (SELECT count(*)::int FROM criterion_def d3 WHERE d3.gate = LEAST(p.esf_phase, 4) AND d3.owner <> 'J1') others
         FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
         JOIN criterion_def d ON d.owner = 'J1' AND d.gate = LEAST(p.esf_phase, 4)
         LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = p.id
         WHERE p.esf_status = 'ACTIVE' AND p.esf_source = 'CONFIRMED' AND coalesce(s.status, 'PENDING') = 'PENDING'
         ORDER BY others_closed DESC, p.esh_id`),
      kotterAggregate(db),
      q(`SELECT p.esh_id, p.title, min(w.go_live) go_live, sum(w.headcount)::int headcount, round(avg(w.training_pct))::int training_pct,
           string_agg(DISTINCT w.training_timing, ',') timing,
           (SELECT json_object_agg(m.day, m.adoption_pct) FROM adoption_measure m WHERE m.project_id = p.id) adoption
         FROM project p JOIN workforce_impact w ON w.project_id = p.id
         WHERE p.esf_status = 'AT_SCALE' AND EXISTS (SELECT 1 FROM adoption_measure m WHERE m.project_id = p.id)
         GROUP BY p.id ORDER BY min(w.go_live) DESC`),
      q(`SELECT DISTINCT ON (p.id) p.esh_id, p.title, p.program_code, p.esf_phase, p.esf_status, p.esf_source, pri.label, pri.fy
         FROM project p JOIN project_priority pp ON pp.project_id = p.id JOIN priority pri ON pri.id = pp.priority_id AND pri.owner = 'J1'
         ORDER BY p.id, pri.fy DESC`),
    ]);
    const in12 = coming.filter((c: any) => new Date(c.go_live).getTime() < AS_OF.getTime() + 365 * 864e5);
    const adopt180 = sustain.map((s: any) => s.adoption?.['180']).filter((x: any) => x != null).sort((a: number, b: number) => a - b);
    const leaders = kotter[0]?.n ?? 0;
    const kpis = {
      changes12: in12.length, people12: in12.reduce((a: number, c: any) => a + c.headcount, 0),
      waiting: waiting.length,
      unionPending: coming.filter((c: any) => c.union_pending).length,
      leaders,
      leaderAvg: kotter.length ? Math.round(10 * kotter.reduce((a: number, k: any) => a + k.mean, 0) / kotter.length) / 10 : null,
      adoption180: adopt180.length ? adopt180[Math.floor(adopt180.length / 2)] : null,
    };
    return { asOf, kpis, coming, gates, waiting, kotter, sustain, anchors };
  }));

  /** Aggregate senior leader readiness as a flat file — a feed for HCT's Enterprise Change Readiness Dashboard, not a replacement for it. */
  app.get('/api/j1/readiness.csv', async (_req, reply) => {
    const rows = await kotterAggregate(db);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['accelerator_no,accelerator,leaders_assessed,mean_score,prior_mean,score_1,score_2,score_3,score_4,score_5,latest_assessment,source',
      ...rows.map(r => [r.a, r.name, r.n, r.mean.toFixed(2), r.prior?.toFixed(2), ...r.dist, new Date(r.assessed_at).toISOString().slice(0, 10), r.synthetic ? 'SYNTHETIC demo data' : 'ESH'].map(esc).join(','))].join('\r\n');
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="esh-kotter-readiness-aggregate.csv"').send(csv);
  });

  /* ── organizations ── */
  const ROLES = ['SPONSOR', 'STAKEHOLDER', 'TRANSITION_PARTNER', 'ACADEMIA', 'MILITARY', 'OSD_MII', 'VENDOR'];
  const LIVE_P = `p.esf_status IN ('ACTIVE','HOLD','AT_SCALE')`;
  app.get('/api/org-index', wrap(async () => ({
    rows: (await db.query<any>(`SELECT o.id, o.name, o.kind,
        count(DISTINCT po.project_id)::int projects,
        count(DISTINCT po.project_id) FILTER (WHERE ${LIVE_P})::int live,
        count(DISTINCT po.project_id) FILTER (WHERE po.role = 'SPONSOR')::int sponsor,
        count(DISTINCT po.project_id) FILTER (WHERE po.role = 'STAKEHOLDER')::int stakeholder,
        count(DISTINCT po.project_id) FILTER (WHERE po.role = 'TRANSITION_PARTNER')::int transition,
        (SELECT count(*)::int FROM org_person op WHERE op.org_id = o.id AND op.focal_rank IS NOT NULL) focal
      FROM org o JOIN project_org po ON po.org_id = o.id JOIN project p ON p.id = po.project_id
      GROUP BY o.id ORDER BY live DESC, projects DESC, o.name`)).rows,
  })));

  app.get('/api/orgs/:id', wrap(async req => {
    const id = Number((req.params as any).id);
    const org = (await db.query<any>('SELECT * FROM org WHERE id=$1', [id])).rows[0];
    if (!org) throw new HttpError(404, 'No such organization');
    const q = (sql: string) => db.query<any>(sql, [id]).then(r => r.rows);
    const latestFyNow = await latestFy();
    const [projects, aliases, focal, pocs, workforce] = await Promise.all([
      q(`SELECT p.esh_id, p.title, p.program_code, p.element_code, p.status_code, p.esf_phase, p.esf_status, p.esf_source, p.pop_end, pe.name pm,
           array_agg(DISTINCT po.role) roles,
           (SELECT max(fy) FROM project_snapshot s WHERE s.project_id = p.id) last_fy
         FROM project_org po JOIN project p ON p.id = po.project_id LEFT JOIN person pe ON pe.id = p.pm_id
         WHERE po.org_id = $1 GROUP BY p.id, pe.name ORDER BY p.esh_id`),
      q('SELECT raw FROM org_alias WHERE org_id=$1 ORDER BY raw'),
      q('SELECT name, title, office, email, phone, focal_rank, synthetic FROM org_person WHERE org_id=$1 AND focal_rank IS NOT NULL ORDER BY focal_rank'),
      q(`SELECT op.name, op.title, op.email, op.phone, op.synthetic, pc.role, count(*)::int n, array_agg(p.esh_id ORDER BY p.esh_id) esh_ids
         FROM project_contact pc JOIN org_person op ON op.id = pc.org_person_id JOIN project p ON p.id = pc.project_id
         WHERE op.org_id = $1 GROUP BY op.id, pc.role ORDER BY n DESC, op.name`),
      q(`SELECT coalesce(sum(w.headcount), 0)::int headcount, count(DISTINCT w.project_id)::int projects
         FROM workforce_impact w JOIN project p ON p.id = w.project_id AND p.esf_status IN ('ACTIVE','HOLD')
         WHERE w.org = (SELECT name FROM org WHERE id = $1)`),
    ]);
    const live = (p: any) => ['ACTIVE', 'HOLD', 'AT_SCALE'].includes(p.esf_status);
    const byRole = Object.fromEntries(ROLES.map(r => [r, { total: projects.filter((p: any) => p.roles.includes(r)).length, live: projects.filter((p: any) => p.roles.includes(r) && live(p)).length }]));
    const phases = [0, 1, 2, 3, 4, 5].map(ph => projects.filter((p: any) => live(p) && (ph === 5 ? p.esf_status === 'AT_SCALE' : p.esf_phase === ph && p.esf_status !== 'AT_SCALE')).length);
    const programs = Object.entries(projects.filter(live).reduce((a: Record<string, number>, p: any) => { const k = p.program_code ?? '—'; a[k] = (a[k] ?? 0) + 1; return a; }, {}))
      .map(([k, n]) => ({ k, n })).sort((a, b) => (b.n as number) - (a.n as number));
    return { org, aliases: aliases.map((a: any) => a.raw), projects, byRole, phases, programs, focal, pocs, workforce: workforce[0], latestFy: latestFyNow,
      exits: projects.filter((p: any) => p.esf_status === 'SUNSET' || p.esf_status === 'DESCOPED').length };
  }));

  /* ── audit feed ── */
  app.get('/api/audit', wrap(async (_req, me) => { requireRole(me, 'ADMIN', 'AUTHORITY'); return { rows: (await db.query('SELECT * FROM audit_event ORDER BY at DESC, id DESC LIMIT 200')).rows }; }));

  /* ── org reference list ── */
  app.get('/api/orgs', wrap(async () => ({ rows: (await db.query(`SELECT o.id, o.name, o.kind, count(DISTINCT po.project_id)::int n,
      (SELECT array_agg(raw ORDER BY raw) FROM org_alias a WHERE a.org_id = o.id) aliases
      FROM org o LEFT JOIN project_org po ON po.org_id = o.id GROUP BY o.id ORDER BY n DESC, o.name`)).rows })));
}

/** Projects whose current gate has every criterion MET (non-waivable) or MET/WAIVED. */
async function readyProjects(db: PGlite) {
  return (await db.query<any>(`
    SELECT p.esh_id, p.title, LEAST(p.esf_phase, 4) gate FROM project p
    WHERE p.esf_status = 'ACTIVE' AND p.esf_source = 'CONFIRMED' AND p.esf_phase < 5
      AND NOT EXISTS (
        SELECT 1 FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = p.id
        WHERE d.gate = LEAST(p.esf_phase, 4)
          AND (s.status IS NULL OR s.status = 'PENDING' OR (d.non_waivable AND s.status <> 'MET')))
    ORDER BY p.esh_id`)).rows;
}
