/* Operational features: funding & transition, the data call, gate boards, stakeholder obligations,
   senior leader decisions, and documents & evidence. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit } from './db/db.js';
import { AS_OF, ROOT } from './config.js';
import { DECISIONS, DOC_TYPES, MATRIX } from './esfContent.js';
import { EXIT_REASONS, GATES, PHASES } from './domain.js';
import type { HttpError as HttpErrorT, User } from './api.js';

type Q = PGlite | Transaction;
type H = {
  wrap: (fn: (req: FastifyRequest, u: User) => Promise<unknown>) => any;
  requireRole: (u: User, ...roles: User['role'][]) => void;
  requireEdit: (u: User, p: Record<string, any>) => void;
  canEdit: (u: User, p: Record<string, any>) => boolean;
  projectByEsh: (q: Q, esh: string) => Promise<Record<string, any>>;
  recordGate: (tx: Q, me: User, p: Record<string, any>, b: any) => Promise<any>;
  Gate: z.ZodTypeAny;
  HttpError: typeof HttpErrorT;
  latestFy: () => Promise<number>;
};

const DC_FIELDS = ['status_code', 'pop_start', 'pop_end', 'transition_phase', 'transition_type', 'description', 'charter'] as const;
const FILES = resolve(ROOT, 'data/files');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? Math.round(100 * a / b) : null);
const MONTH = 30.44 * 864e5;

export function registerOps(app: FastifyInstance, db: PGlite, h: H) {
  const { wrap, requireRole, requireEdit, canEdit, projectByEsh, HttpError } = h;
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);

  /* ═════════ 1. funding & transition ═════════ */
  app.get('/api/funding', wrap(async () => {
    const fy = await h.latestFy();
    const asOf = AS_OF;
    const [rows, paths, lines, crits, g4] = await Promise.all([
      q(`SELECT p.id, p.esh_id, p.title, p.program_code, p.esf_phase, p.esf_status, pe.name pm,
           (SELECT o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1) sponsor
         FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
         WHERE p.esf_status IN ('ACTIVE','HOLD','AT_SCALE') AND p.esf_source = 'CONFIRMED'`),
      q(`SELECT DISTINCT ON (project_id) project_id, path, status, mechanism, committed_at FROM transition_pathway
         ORDER BY project_id, CASE status WHEN 'ACTIVE' THEN 0 WHEN 'COMMITTED' THEN 1 ELSE 2 END`),
      q(`SELECT project_id, fy, appropriation, (source ILIKE 'J68%') j68, amount::float amount, pop_end FROM funding_line`),
      q(`SELECT s.project_id, count(*)::int done FROM criterion_status s JOIN criterion_def d ON d.id = s.criterion_id AND d.gate = 2
         WHERE s.status IN ('MET','WAIVED') GROUP BY 1`),
      q(`SELECT project_id, max(decided_at) decided_at FROM gate_decision WHERE gate = 4 AND outcome = 'PASS' GROUP BY 1`),
    ]);
    const g2total = (await q(`SELECT count(*)::int n FROM criterion_def WHERE gate = 2`))[0].n;
    const pathOf = new Map(paths.map((x: any) => [x.project_id, x]));
    const phaseOf = (r: any) => (r.esf_status === 'AT_SCALE' ? 5 : r.esf_phase);
    const withPath = rows.map((r: any) => ({ ...r, phase: phaseOf(r), path: pathOf.get(r.id)?.path ?? null, pstatus: pathOf.get(r.id)?.status ?? null, mechanism: pathOf.get(r.id)?.mechanism ?? null }));

    // pathway pipeline by path × status
    const pipeline = ['A_WCF', 'B_POM'].map(path => ({ path, DECLARED: 0, COMMITTED: 0, ACTIVE: 0, ...Object.fromEntries(['DECLARED', 'COMMITTED', 'ACTIVE'].map(s => [s, withPath.filter((r: any) => r.path === path && r.pstatus === s).length])) }));
    const noPath = withPath.filter((r: any) => r.phase >= 2 && r.phase <= 4 && !r.path);

    // PPBE: next POM window (Jul 1 – Aug 31) and the Path B projects that must clear Gate 2 (PRR) before it
    const y = asOf.getUTCMonth() >= 6 ? asOf.getUTCFullYear() + 1 : asOf.getUTCFullYear();
    const pomOpen = new Date(Date.UTC(y, 6, 1)), pomClose = new Date(Date.UTC(y, 7, 31));
    const daysToPom = Math.round((pomOpen.getTime() - asOf.getTime()) / 864e5);
    const pom = withPath.filter((r: any) => r.path === 'B_POM' && r.phase === 2).map((r: any) => {
      const done = crits.find((c: any) => c.project_id === r.id)?.done ?? 0;
      return { ...r, g2done: done, g2total, risk: done / g2total < 0.5 ? 'HIGH' : done < g2total ? 'MEDIUM' : 'READY' };
    }).sort((a: any, b: any) => a.g2done - b.g2done);

    // funding by FY: J68 R&D vs sponsor money
    const fys = [...new Set(lines.map((l: any) => l.fy))].sort() as number[];
    const byFy = fys.map(f => ({ fy: f, j68: lines.filter((l: any) => l.fy === f && l.j68).reduce((a: number, l: any) => a + l.amount, 0), sponsor: lines.filter((l: any) => l.fy === f && !l.j68).reduce((a: number, l: any) => a + l.amount, 0) }));

    // fiscal-law risk register
    const risks: any[] = [];
    const lineFy = (pid: number, f: number) => lines.filter((l: any) => l.project_id === pid && l.fy === f);
    for (const r of withPath) {
      const g4d = g4.find((x: any) => x.project_id === r.id)?.decided_at;
      for (const l of lines.filter((l: any) => l.project_id === r.id && l.j68 && /RDT/.test(l.appropriation)))
        if (g4d && l.pop_end && new Date(l.pop_end) > new Date(g4d)) risks.push({ ...r, kind: 'ADA', severity: 'Critical', amount: l.amount,
          text: `J68 RDT&E (FY${String(l.fy).slice(2)}) runs past the Gate 4 handoff on ${iso(new Date(g4d))} — Anti-Deficiency exposure.` });
      const now = lineFy(r.id, fy), j68 = now.filter((l: any) => l.j68).reduce((a: number, l: any) => a + l.amount, 0), spon = now.filter((l: any) => !l.j68).reduce((a: number, l: any) => a + l.amount, 0);
      if (r.phase === 3 && j68 > 0 && spon === 0) risks.push({ ...r, kind: 'OPS_ON_RDTE', severity: 'High', amount: j68,
        text: 'Limited deployment funded entirely by J68 RDT&E with no sponsor co-funding — operational costs on R&D money are a fiscal-law risk.' });
      if (r.phase >= 4 && j68 > 0 && !risks.some(x => x.id === r.id && x.kind === 'ADA')) risks.push({ ...r, kind: 'RDTE_AFTER_TRANSITION', severity: 'High', amount: j68,
        text: `New J68 RDT&E in FY${String(fy).slice(2)} after the project entered ${PHASES[r.phase].short} — the ESF allows none.` });
      if (r.phase === 3 && r.path === 'B_POM' && r.pstatus === 'DECLARED') risks.push({ ...r, kind: 'NO_POM_COMMIT', severity: 'Medium', amount: null,
        text: 'In limited deployment on Path B, but the POM line is only declared, not committed.' });
    }
    for (const r of noPath.filter((x: any) => x.phase >= 3)) risks.push({ ...r, kind: 'NO_PATH', severity: 'Medium', amount: null, text: `In ${PHASES[r.phase].short} with no named transition path — "no named path = Gate 2 is not cleared".` });
    const order = { Critical: 0, High: 1, Medium: 2 } as Record<string, number>;
    risks.sort((a, b) => order[a.severity] - order[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));

    const latest = byFy.find(x => x.fy === fy);
    return {
      fy, asOf: iso(asOf), pipeline, noPath: noPath.length, pom: { open: iso(pomOpen), close: iso(pomClose), days: daysToPom, projects: pom },
      wcf: withPath.filter((r: any) => r.path === 'A_WCF').sort((a: any, b: any) => b.phase - a.phase),
      byFy, risks,
      kpis: { pathA: withPath.filter((r: any) => r.path === 'A_WCF').length, pathB: withPath.filter((r: any) => r.path === 'B_POM').length, noPath: noPath.length,
        sponsorShare: latest ? pct(latest.sponsor, latest.j68 + latest.sponsor) : null, risks: risks.length, critical: risks.filter(r => r.severity === 'Critical').length, daysToPom },
    };
  }));

  /* ═════════ 2. data call ═════════ */
  const callRow = async (fy: number) => { const c = (await q('SELECT * FROM data_call WHERE fy=$1', [fy]))[0]; if (!c) throw new HttpError(404, `No FY${fy} data call`); return c; };
  app.get('/api/datacalls', wrap(async () => ({ rows: await q(`SELECT c.fy, c.name, c.status, c.source, c.opens_at, c.due_at, c.closed_at, c.synthetic,
      (SELECT count(*)::int FROM data_call_response r WHERE r.fy = c.fy) responses,
      (SELECT count(*)::int FROM data_call_response r WHERE r.fy = c.fy AND r.status IN ('SUBMITTED','APPROVED')) submitted,
      (SELECT count(*)::int FROM project_snapshot s WHERE s.fy = c.fy) projects
    FROM data_call c ORDER BY c.fy DESC`) })));

  app.get('/api/datacalls/:fy', wrap(async (req, me) => {
    const fy = Number((req.params as any).fy), call = await callRow(fy);
    const rows = await q(`SELECT r.*, p.esh_id, p.title, p.program_code, p.pm_id, coalesce(pe.name, '(no PM)') pm, p.esf_phase, p.esf_status
      FROM data_call_response r JOIN project p ON p.id = r.project_id LEFT JOIN person pe ON pe.id = p.pm_id WHERE r.fy = $1 ORDER BY p.esh_id`, [fy]);
    const out = rows.map((r: any) => ({ ...r, changed: DC_FIELDS.filter(f => JSON.stringify(r.payload?.[f] ?? null) !== JSON.stringify(r.baseline?.[f] ?? null)),
      mine: me.role === 'PM' && me.person_id === r.pm_id, canEdit: call.status === 'OPEN' && r.status !== 'APPROVED' && (me.role === 'ADMIN' || (me.role === 'PM' && me.person_id === r.pm_id)) }));
    const count = (s: string) => out.filter((r: any) => r.status === s).length;
    const byPm = Object.values(out.reduce((a: Record<string, any>, r: any) => {
      const x = a[r.pm] ?? { pm: r.pm, total: 0, NOT_STARTED: 0, IN_PROGRESS: 0, SUBMITTED: 0, APPROVED: 0, RETURNED: 0 }; x.total++; x[r.status]++; a[r.pm] = x; return a;
    }, {})).map((x: any) => ({ ...x, done: pct(x.SUBMITTED + x.APPROVED, x.total) })).sort((a: any, b: any) => (a.done ?? 0) - (b.done ?? 0));
    const daysLeft = call.due_at ? Math.round((new Date(call.due_at).getTime() - AS_OF.getTime()) / 864e5) : null;
    return { call, rows: out, byPm, fields: DC_FIELDS, daysLeft,
      counts: { total: out.length, NOT_STARTED: count('NOT_STARTED'), IN_PROGRESS: count('IN_PROGRESS'), SUBMITTED: count('SUBMITTED'), APPROVED: count('APPROVED'), RETURNED: count('RETURNED') } };
  }));

  const DcEdit = z.object({ payload: z.record(z.string(), z.union([z.string(), z.null()])), submit: z.boolean().optional() }).strict();
  app.put('/api/datacalls/:fy/:esh', wrap(async (req, me) => {
    const b = DcEdit.parse(req.body), fy = Number((req.params as any).fy);
    return db.transaction(async tx => {
      const call = (await tx.query<any>('SELECT * FROM data_call WHERE fy=$1', [fy])).rows[0];
      if (!call || call.status !== 'OPEN') throw new HttpError(409, 'This data call is not open');
      const p = await projectByEsh(tx, (req.params as any).esh); requireEdit(me, p);
      const r = (await tx.query<any>('SELECT * FROM data_call_response WHERE fy=$1 AND project_id=$2', [fy, p.id])).rows[0];
      if (!r) throw new HttpError(404, 'This project is not in the data call');
      if (r.status === 'APPROVED') throw new HttpError(409, 'Already approved');
      const payload = { ...r.payload, ...Object.fromEntries(Object.entries(b.payload).filter(([k]) => (DC_FIELDS as readonly string[]).includes(k))) };
      if (payload.status_code && !['A', 'B', 'C', 'D', 'E'].includes(String(payload.status_code))) throw new HttpError(400, 'Status must be A–E');
      for (const k of ['pop_start', 'pop_end']) if (payload[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(payload[k]))) throw new HttpError(400, `${k} must be YYYY-MM-DD`);
      const status = b.submit ? 'SUBMITTED' : 'IN_PROGRESS';
      await tx.query(`UPDATE data_call_response SET payload=$3, status=$4, updated_by=$5, updated_at=now(), submitted_at=CASE WHEN $4='SUBMITTED' THEN now() ELSE submitted_at END, synthetic=false WHERE fy=$1 AND project_id=$2`,
        [fy, p.id, JSON.stringify(payload), status, me.name]);
      await audit(tx, me.name, 'project', p.esh_id, b.submit ? 'DATACALL_SUBMIT' : 'DATACALL_SAVE', { status: r.status }, { fy, status });
      return { ok: true, status };
    });
  }));

  const DcReview = z.object({ action: z.enum(['APPROVE', 'RETURN']), note: z.string().max(2000).optional() }).strict();
  app.post('/api/datacalls/:fy/:esh/review', wrap(async (req, me) => {
    requireRole(me, 'ADMIN'); const b = DcReview.parse(req.body), fy = Number((req.params as any).fy);
    if (b.action === 'RETURN' && !b.note?.trim()) throw new HttpError(400, 'Say what needs fixing when returning a response');
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, (req.params as any).esh);
      const r = (await tx.query<any>('SELECT status FROM data_call_response WHERE fy=$1 AND project_id=$2', [fy, p.id])).rows[0];
      if (!r || r.status !== 'SUBMITTED') throw new HttpError(409, 'Only submitted responses can be reviewed');
      const status = b.action === 'APPROVE' ? 'APPROVED' : 'RETURNED';
      await tx.query('UPDATE data_call_response SET status=$3, note=$4, reviewed_by=$5, reviewed_at=now() WHERE fy=$1 AND project_id=$2', [fy, p.id, status, b.note ?? null, me.name]);
      await audit(tx, me.name, 'project', p.esh_id, 'DATACALL_' + b.action, { status: r.status }, { fy, status, note: b.note });
      return { ok: true, status };
    });
  }));

  const DcOpen = z.object({ fy: z.number().int(), due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
  app.post('/api/datacalls', wrap(async (req, me) => {
    requireRole(me, 'ADMIN'); const b = DcOpen.parse(req.body);
    return db.transaction(async tx => {
      if ((await tx.query<any>(`SELECT 1 FROM data_call WHERE status = 'OPEN'`)).rows.length) throw new HttpError(409, 'Close the open data call first');
      if ((await tx.query<any>('SELECT 1 FROM data_call WHERE fy=$1', [b.fy])).rows.length) throw new HttpError(409, `FY${b.fy} already has a data call`);
      const prev = (await tx.query<{ fy: number }>(`SELECT max(fy) fy FROM data_call WHERE status = 'CLOSED'`)).rows[0].fy;
      await tx.query(`INSERT INTO data_call (fy, name, status, opens_at, due_at, source) VALUES ($1,$2,'OPEN',$3,$4,'HUB')`, [b.fy, `FY${b.fy} R&D alignment data call`, iso(new Date()), b.due_at]);
      const ps = (await tx.query<any>(`SELECT p.id, ${DC_FIELDS.map(f => 'p.' + f).join(', ')} FROM project p WHERE p.esf_status IN ('ACTIVE','HOLD','AT_SCALE')
        AND p.id IN (SELECT project_id FROM project_snapshot WHERE fy = $1)`, [prev])).rows;
      for (const p of ps) {
        const base = Object.fromEntries(DC_FIELDS.map(f => [f, p[f] instanceof Date ? iso(p[f]) : p[f] ?? null]));
        await tx.query('INSERT INTO data_call_response (fy, project_id, baseline, payload) VALUES ($1,$2,$3,$3)', [b.fy, p.id, JSON.stringify(base)]);
      }
      await audit(tx, me.name, 'data_call', String(b.fy), 'DATACALL_OPEN', null, { fy: b.fy, due_at: b.due_at, projects: ps.length });
      return { ok: true, projects: ps.length };
    });
  }));

  app.post('/api/datacalls/:fy/close', wrap(async (req, me) => {
    requireRole(me, 'ADMIN'); const fy = Number((req.params as any).fy);
    return db.transaction(async tx => {
      const call = (await tx.query<any>('SELECT * FROM data_call WHERE fy=$1', [fy])).rows[0];
      if (!call || call.status !== 'OPEN') throw new HttpError(409, 'This data call is not open');
      const approved = (await tx.query<any>(`SELECT r.*, p.esh_id FROM data_call_response r JOIN project p ON p.id = r.project_id WHERE r.fy=$1 AND r.status='APPROVED'`, [fy])).rows;
      for (const r of approved) {
        const keys = DC_FIELDS.filter(f => JSON.stringify(r.payload[f] ?? null) !== JSON.stringify(r.baseline[f] ?? null));
        if (keys.length) await tx.query(`UPDATE project SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, last_fy=GREATEST(last_fy, $${keys.length + 2}), updated_at=now() WHERE id=$1`,
          [r.project_id, ...keys.map(k => r.payload[k]), fy]);
        else await tx.query('UPDATE project SET last_fy=GREATEST(last_fy, $2) WHERE id=$1', [r.project_id, fy]);
        await tx.query(`INSERT INTO project_snapshot (project_id, fy, source_sheet, source_row, status_code, transition_phase, pm_name, raw) VALUES ($1,$2,'ESH data call',0,$3,$4,NULL,$5)
          ON CONFLICT (project_id, fy) DO NOTHING`, [r.project_id, fy, r.payload.status_code ?? null, r.payload.transition_phase ?? null, JSON.stringify(r.payload)]);
        if (keys.length) await audit(tx, me.name, 'project', r.esh_id, 'DATACALL_APPLY', Object.fromEntries(keys.map(k => [k, r.baseline[k]])), Object.fromEntries(keys.map(k => [k, r.payload[k]])));
      }
      await tx.query(`UPDATE data_call SET status='CLOSED', closed_at=$2 WHERE fy=$1`, [fy, iso(new Date())]);
      await audit(tx, me.name, 'data_call', String(fy), 'DATACALL_CLOSE', null, { fy, applied: approved.length });
      return { ok: true, applied: approved.length };
    });
  }));

  /* ═════════ 3. gate boards ═════════ */
  const readyIds = async () => (await q(`SELECT p.id FROM project p WHERE p.esf_status = 'ACTIVE' AND p.esf_source = 'CONFIRMED' AND p.esf_phase < 5 AND NOT EXISTS (
      SELECT 1 FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = p.id
      WHERE d.gate = LEAST(p.esf_phase, 4) AND (s.status IS NULL OR s.status = 'PENDING' OR (d.non_waivable AND s.status <> 'MET')))`)).map((r: any) => r.id);

  app.get('/api/boards', wrap(async () => ({ rows: await q(`SELECT b.*, (SELECT count(*)::int FROM gate_board_item i WHERE i.board_id = b.id) items,
      (SELECT count(*)::int FROM gate_board_item i WHERE i.board_id = b.id AND i.outcome IS NOT NULL) decided,
      (SELECT count(*)::int FROM gate_board_action a WHERE a.board_id = b.id AND NOT a.done) open_actions,
      (SELECT json_object_agg(o, n) FROM (SELECT i.outcome o, count(*)::int n FROM gate_board_item i WHERE i.board_id = b.id AND i.outcome IS NOT NULL GROUP BY 1) t) outcomes
    FROM gate_board b ORDER BY b.board_date DESC`), asOf: iso(AS_OF) })));

  app.get('/api/boards/:id', wrap(async (req, me) => {
    const id = Number((req.params as any).id);
    const board = (await q('SELECT * FROM gate_board WHERE id=$1', [id]))[0]; if (!board) throw new HttpError(404, 'No such board');
    const ready = new Set(await readyIds());
    const items = await q(`SELECT i.*, p.esh_id, p.title, p.program_code, p.esf_phase, p.esf_status, p.esf_source, pe.name pm,
        (SELECT o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1) sponsor,
        (SELECT count(*)::int FROM criterion_def d JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = p.id AND s.status IN ('MET','WAIVED') WHERE d.gate = i.gate) done,
        (SELECT count(*)::int FROM criterion_def d WHERE d.gate = i.gate) total
      FROM gate_board_item i JOIN project p ON p.id = i.project_id LEFT JOIN person pe ON pe.id = p.pm_id WHERE i.board_id = $1 ORDER BY i.ord`, [id]);
    const actions = await q(`SELECT a.*, p.esh_id, p.title FROM gate_board_action a LEFT JOIN project p ON p.id = a.project_id WHERE a.board_id = $1 ORDER BY a.done, a.due NULLS LAST, a.id`, [id]);
    const candidates = board.status === 'SCHEDULED' ? await q(`SELECT p.esh_id, p.title, LEAST(p.esf_phase, 4) gate, p.esf_status FROM project p
        WHERE p.id = ANY($1) AND p.id NOT IN (SELECT project_id FROM gate_board_item WHERE board_id = $2) ORDER BY p.esh_id`, [[...ready], id]) : [];
    return { board, items: items.map((x: any) => ({ ...x, ready: ready.has(x.project_id) })), actions, candidates,
      canRun: me.role === 'ADMIN' || me.role === 'AUTHORITY', exitReasons: EXIT_REASONS };
  }));

  const BoardNew = z.object({ title: z.string().min(3).max(200), board_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), authority: z.string().min(2).max(120), location: z.string().max(200).optional(), gates: z.array(z.number().int().min(0).max(4)) }).strict();
  app.post('/api/boards', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY'); const b = BoardNew.parse(req.body);
    // read before opening the transaction: the embedded database has one connection, so a query outside the transaction would wait on it forever
    const ready = await readyIds();
    return db.transaction(async tx => {
      const id = (await tx.query<{ id: number }>(`INSERT INTO gate_board (title, board_date, authority, location) VALUES ($1,$2,$3,$4) RETURNING id`, [b.title, b.board_date, b.authority, b.location ?? null])).rows[0].id;
      const ps = (await tx.query<any>(`SELECT id, LEAST(esf_phase, 4) gate FROM project WHERE id = ANY($1) AND LEAST(esf_phase, 4) = ANY($2) ORDER BY esh_id`, [ready, b.gates])).rows;
      for (const [i, p] of ps.entries()) await tx.query('INSERT INTO gate_board_item (board_id, project_id, gate, ord) VALUES ($1,$2,$3,$4)', [id, p.id, p.gate, i + 1]);
      await audit(tx, me.name, 'board', String(id), 'BOARD_CREATE', null, { ...b, items: ps.length });
      return { ok: true, id, items: ps.length };
    });
  }));

  app.post('/api/boards/:id/items', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY'); const id = Number((req.params as any).id), esh = String((req.body as any)?.esh ?? '');
    return db.transaction(async tx => {
      const p = await projectByEsh(tx, esh);
      const ord = (await tx.query<{ n: number }>('SELECT coalesce(max(ord), 0)::int + 1 n FROM gate_board_item WHERE board_id=$1', [id])).rows[0].n;
      await tx.query('INSERT INTO gate_board_item (board_id, project_id, gate, ord) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, p.id, Math.min(p.esf_phase ?? 0, 4), ord]);
      return { ok: true };
    });
  }));
  app.delete('/api/boards/:id/items/:esh', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY');
    const p = await projectByEsh(db, (req.params as any).esh);
    await db.query('DELETE FROM gate_board_item WHERE board_id=$1 AND project_id=$2 AND outcome IS NULL', [Number((req.params as any).id), p.id]);
    return { ok: true };
  }));

  app.post('/api/boards/:id/decide', wrap(async (req, me) => {
    requireRole(me, 'AUTHORITY', 'ADMIN');
    const id = Number((req.params as any).id), body = req.body as any;
    const b = h.Gate.parse({ outcome: body?.outcome, rationale: body?.rationale, ...(body?.exit_reason ? { exit_reason: body.exit_reason } : {}), ...(body?.technical_result ? { technical_result: body.technical_result } : {}) });
    return db.transaction(async tx => {
      const board = (await tx.query<any>('SELECT * FROM gate_board WHERE id=$1', [id])).rows[0];
      if (!board) throw new HttpError(404, 'No such board');
      const p = await projectByEsh(tx, String(body?.esh ?? ''));
      const item = (await tx.query<any>('SELECT * FROM gate_board_item WHERE board_id=$1 AND project_id=$2', [id, p.id])).rows[0];
      if (!item) throw new HttpError(404, 'Project is not on this board');
      if (item.outcome) throw new HttpError(409, 'Already decided at this board');
      const res = await h.recordGate(tx, me, p, { ...b, decided_at: iso(new Date(board.board_date)) < iso(new Date()) ? iso(new Date(board.board_date)) : undefined });
      await tx.query('UPDATE gate_board_item SET outcome=$3, note=$4 WHERE board_id=$1 AND project_id=$2', [id, p.id, b.outcome, b.rationale]);
      return res;
    });
  }));

  const BoardUpd = z.object({ minutes: z.string().max(20000).optional(), status: z.enum(['SCHEDULED', 'HELD', 'CANCELLED']).optional() }).strict();
  app.put('/api/boards/:id', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY'); const b = BoardUpd.parse(req.body), id = Number((req.params as any).id);
    await db.query(`UPDATE gate_board SET minutes=coalesce($2, minutes), status=coalesce($3, status), synthetic=false WHERE id=$1`, [id, b.minutes ?? null, b.status ?? null]);
    await audit(db, me.name, 'board', String(id), 'BOARD_UPDATE', null, b);
    return { ok: true };
  }));
  const ActionNew = z.object({ text: z.string().min(3).max(500), owner: z.string().min(2).max(120), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), esh: z.string().optional() }).strict();
  app.post('/api/boards/:id/actions', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY'); const b = ActionNew.parse(req.body), id = Number((req.params as any).id);
    const p = b.esh ? await projectByEsh(db, b.esh) : null;
    await db.query('INSERT INTO gate_board_action (board_id, project_id, text, owner, due) VALUES ($1,$2,$3,$4,$5)', [id, p?.id ?? null, b.text, b.owner, b.due ?? null]);
    return { ok: true };
  }));
  app.put('/api/boards/actions/:aid', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY');
    await db.query('UPDATE gate_board_action SET done=$2 WHERE id=$1', [Number((req.params as any).aid), !!(req.body as any)?.done]);
    return { ok: true };
  }));

  /* ═════════ 4. stakeholder obligations ═════════ */
  app.get('/api/obligations', wrap(async () => {
    const [working, defs, status, ready, exits] = await Promise.all([
      q(`SELECT p.id, p.esh_id, p.title, LEAST(p.esf_phase, 4) gate, pe.name pm, p.esf_status,
           (SELECT json_agg(json_build_object('id', o.id, 'name', o.name)) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsors
         FROM project p LEFT JOIN person pe ON pe.id = p.pm_id WHERE p.esf_status IN ('ACTIVE','HOLD') AND p.esf_source = 'CONFIRMED'`),
      q(`SELECT id, gate, ord, text, non_waivable FROM criterion_def`),
      q(`SELECT project_id, criterion_id, status FROM criterion_status`),
      readyIds(),
      q(`SELECT g.exit_reason, g.gate, p.id FROM gate_decision g JOIN project p ON p.id = g.project_id WHERE g.outcome IN ('SUNSET','DESCOPE')`),
    ]);
    const st = new Map(status.map((s: any) => [`${s.project_id}:${s.criterion_id}`, s.status]));
    const def = (g: number, o: number) => defs.find((d: any) => d.gate === g && d.ord === o);
    const closed = (pid: number, g: number, o: number) => { const d = def(g, o); if (!d) return true; const v = st.get(`${pid}:${d.id}`); return v === 'MET' || (!d.non_waivable && v === 'WAIVED'); };
    const readySet = new Set(ready);
    /* Stage 5 (after Gate 4): Hub-proposed obligations, tracked from the realization record */
    const asOf = AS_OF.toISOString().slice(0, 10);
    const lastMonth = new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
    const sixAgo = new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth() - 6, 1)).toISOString().slice(0, 10);
    const [fielded, dueReviews, rdActions, adoption] = await Promise.all([
      q(`SELECT p.id, p.esh_id, p.title, pe.name pm, o.name owner, b.transitioned_on,
           (SELECT max(period) FROM benefit_measure m WHERE m.project_id = p.id) last_report,
           (SELECT max(period) FROM benefit_measure m WHERE m.project_id = p.id AND m.method = 'J8') last_j8
         FROM benefit_baseline b JOIN project p ON p.id = b.project_id LEFT JOIN person pe ON pe.id = p.pm_id LEFT JOIN org o ON o.id = b.owner_org_id`),
      q(`SELECT r.*, p.esh_id, p.title FROM realization_review r JOIN project p ON p.id = r.project_id WHERE r.due_on <= $1`, [asOf]),
      q(`SELECT a.*, p.esh_id, p.title FROM realization_action a JOIN realization_review r ON r.id = a.review_id JOIN project p ON p.id = r.project_id WHERE a.owner = 'R&D'`),
      q(`SELECT project_id, count(*)::int n FROM adoption_measure GROUP BY 1`),
    ]);
    const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
    const adopted = new Map(adoption.map((x: any) => [x.project_id, x.n]));
    const post = (t: string) => {
      const row = (x: any, owes: string) => ({ esh_id: x.esh_id, title: x.title, pm: x.pm ?? null, sponsor: x.owner ?? null, owes });
      if (t === 'REPORTING') { const open = fielded.filter((f: any) => !f.last_report || iso(f.last_report) < lastMonth); return { working: fielded.length, met: fielded.length - open.length, open: open.map((f: any) => row(f, f.last_report ? `No benefit report since ${iso(f.last_report).slice(0, 7)}` : 'No benefit report yet')), evidence: ['A monthly benefit report within the last two months'] }; }
      if (t === 'J8_VALIDATE') { const due = fielded.filter((f: any) => f.last_report); const open = due.filter((f: any) => !f.last_j8 || iso(f.last_j8) < sixAgo); return { working: due.length, met: due.length - open.length, open: open.map((f: any) => row(f, 'No J8-validated month in the last two quarters')), evidence: ['A J8-validated benefit report within six months'] }; }
      if (t === 'REVIEWS') { const open = dueReviews.filter((r: any) => r.status !== 'HELD'); return { working: dueReviews.length, met: dueReviews.length - open.length, open: open.map((r: any) => row(r, `${r.months}-month realization review due ${iso(r.due_on)} not held`)), evidence: ['Realization reviews held when due (6, 12, 24 months)'] }; }
      if (t === 'RD_ACTIONS') { const open = rdActions.filter((a: any) => a.status === 'OPEN' && iso(a.due_on) < asOf); return { working: rdActions.length, met: rdActions.length - open.length, open: open.map((a: any) => row(a, `Overdue since ${iso(a.due_on)}: ${a.text}`)), evidence: ['R&D actions from realization reviews closed by their due date'] }; }
      const due = fielded.filter((f: any) => iso(f.transitioned_on) <= new Date(AS_OF.getTime() - 200 * 864e5).toISOString().slice(0, 10));
      const open = due.filter((f: any) => (adopted.get(f.id) ?? 0) < 3);
      return { working: due.length, met: due.length - open.length, open: open.map((f: any) => row(f, 'Adoption not measured at 30, 90 and 180 days')), evidence: ['Adoption measured at 30, 90 and 180 days after go-live'] };
    };
    const rows = MATRIX.map(a => ({
      key: a.key, actor: a.actor, hub: !!a.hub,
      cells: a.cells.map(([code, tip], g) => {
        const base = { code, tip, gate: g, tracked: false as boolean, working: 0, met: 0, pct: null as number | null, open: [] as any[], evidence: [] as string[], proposal: false, esf: null as null | [string, string] };
        if (g === 5 && a.post && a.postTrack) {
          const t = post(a.postTrack);
          return { ...base, code: a.post[0], tip: a.post[1], proposal: true, esf: [code, tip] as [string, string], tracked: true, ...t, pct: pct(t.met, t.working) };
        }
        if (g > 4 || code === '—') return base;
        const ws = working.filter((w: any) => w.gate === g);
        if (a.decides) {
          const owed = ws.filter((w: any) => readySet.has(w.id));
          return { ...base, tracked: true, working: owed.length, met: 0, pct: null, open: owed.map((w: any) => ({ esh_id: w.esh_id, title: w.title, pm: w.pm, sponsor: w.sponsors?.[0]?.name ?? null, owes: 'A gate decision — every criterion is closed' })), evidence: ['Recording the gate decision'] };
        }
        const ords = a.crit?.[g]; if (!ords) return base;
        const open = ws.filter((w: any) => ords.some(o => !closed(w.id, g, o)));
        return { ...base, tracked: true, working: ws.length, met: ws.length - open.length, pct: pct(ws.length - open.length, ws.length), evidence: ords.map(o => def(g, o)?.text ?? `#${o}`),
          open: open.map((w: any) => ({ esh_id: w.esh_id, title: w.title, pm: w.pm, sponsor: w.sponsors?.[0]?.name ?? null, owes: ords.filter(o => !closed(w.id, g, o)).map(o => def(g, o)?.text).join('; ') })) };
      }),
    }));
    // co-sponsor accountability by organization: what each sponsoring organization owes right now, and how often it walked away at Gate 3
    const co = MATRIX.find(a => a.key === 'COSPONSOR')!;
    const orgs = new Map<string, any>();
    for (const w of working) for (const s of (w.sponsors ?? [])) {
      const o = orgs.get(s.name) ?? { id: s.id, name: s.name, projects: 0, owed: 0, delivered: 0, declined: 0 };
      o.projects++;
      const ords = co.crit?.[w.gate] ?? [];
      if (ords.length) { if (ords.some(x => !closed(w.id, w.gate, x))) o.owed++; else o.delivered++; }
      orgs.set(s.name, o);
    }
    const sponsorsOf = new Map<number, string[]>();
    for (const r of await q(`SELECT po.project_id, o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.role = 'SPONSOR'`)) sponsorsOf.set(r.project_id, [...(sponsorsOf.get(r.project_id) ?? []), r.name]);
    for (const e of exits.filter((x: any) => x.gate === 3 && ['SPONSOR', 'NO_OWNER'].includes(x.exit_reason)))
      for (const n of sponsorsOf.get(e.id) ?? []) { const o = orgs.get(n); if (o) o.declined++; }
    const byOrg = [...orgs.values()].map(o => ({ ...o, pct: pct(o.delivered, o.delivered + o.owed) })).sort((a, b) => b.owed - a.owed || b.projects - a.projects);
    return { rows, gates: GATES.map(g => g.name), byOrg, legend: { K: 'Key decision — cannot be delegated', R: 'Required participation', O: 'Optional / recommended', 'O*': 'Optional; Director-level escalation only', '—': 'Not applicable' } };
  }));

  /* ═════════ 5. senior leader decisions ═════════ */
  app.get('/api/decisions', wrap(async (_req, me) => {
    const st = await q('SELECT * FROM senior_decision');
    return { rows: DECISIONS.map(dd => ({ ...dd, state: st.find((s: any) => s.ord === dd.ord) ?? { status: 'OPEN' } })), canEdit: me.role === 'ADMIN' || me.role === 'AUTHORITY', asOf: iso(AS_OF) };
  }));
  const DecUpd = z.object({ status: z.enum(['OPEN', 'IN_REVIEW', 'DECIDED', 'DEFERRED']), owner: z.string().max(120).nullable().optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    decided_option: z.string().max(2).nullable().optional(), rationale: z.string().max(4000).nullable().optional() }).strict();
  app.put('/api/decisions/:ord', wrap(async (req, me) => {
    requireRole(me, 'ADMIN', 'AUTHORITY'); const b = DecUpd.parse(req.body), ord = Number((req.params as any).ord);
    if (!DECISIONS.some(x => x.ord === ord)) throw new HttpError(404, 'No such decision');
    if (b.status === 'DECIDED' && !b.decided_option) throw new HttpError(400, 'Name the option chosen');
    const before = (await q('SELECT * FROM senior_decision WHERE ord=$1', [ord]))[0] ?? null;
    await db.query(`INSERT INTO senior_decision (ord, status, owner, due, decided_option, decided_at, rationale, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
      ON CONFLICT (ord) DO UPDATE SET status=EXCLUDED.status, owner=EXCLUDED.owner, due=EXCLUDED.due, decided_option=EXCLUDED.decided_option, decided_at=EXCLUDED.decided_at,
        rationale=EXCLUDED.rationale, updated_by=EXCLUDED.updated_by, updated_at=now(), synthetic=false`,
      [ord, b.status, b.owner ?? null, b.due ?? null, b.status === 'DECIDED' ? b.decided_option : null, b.status === 'DECIDED' ? iso(new Date()) : null, b.rationale ?? null, me.name]);
    await audit(db, me.name, 'decision', String(ord), 'SENIOR_DECISION', before, b);
    return { ok: true };
  }));

  /* ═════════ 6. documents & evidence ═════════ */
  app.get('/api/documents', wrap(async () => {
    const [rows, required, waived] = await Promise.all([
      q(`SELECT d.id, d.doc_type, d.title, d.file_name, d.size, d.uploaded_by, d.uploaded_at, d.synthetic, (d.storage_key IS NOT NULL) has_file,
           p.esh_id, p.title project_title, p.program_code, c.gate, c.ord, c.text criterion
         FROM document d JOIN project p ON p.id = d.project_id LEFT JOIN criterion_def c ON c.id = d.criterion_id ORDER BY d.uploaded_at DESC`),
      // for each gate a project has passed, which required document types are on file
      q(`SELECT p.id, p.esh_id, p.title, g.gate, array_remove(array_agg(DISTINCT d.doc_type), NULL) types
         FROM gate_decision g JOIN project p ON p.id = g.project_id LEFT JOIN document d ON d.project_id = p.id
         WHERE g.outcome = 'PASS' GROUP BY p.id, g.gate`),
      q(`SELECT s.project_id, d.gate, d.ord FROM criterion_status s JOIN criterion_def d ON d.id = s.criterion_id WHERE s.status = 'WAIVED'`),
    ]);
    const waivedSet = new Set(waived.map((w: any) => `${w.project_id}:${w.gate}:${w.ord}`));
    // a waived criterion needs no document (e.g. J1 checks on gates decided before J1 joined the ESF)
    const needs = (pid: number, t: string) => !DOC_TYPES[t].crit.every(([g, o]) => waivedSet.has(`${pid}:${g}:${o}`));
    const types = Object.entries(DOC_TYPES).map(([k, v]) => ({ key: k, label: v.l, gate: v.gate, n: rows.filter((r: any) => r.doc_type === k).length }));
    const completeness = GATES.map(G => {
      const req = Object.entries(DOC_TYPES).filter(([, v]) => v.gate === G.gate).map(([k]) => k);
      const ps = required.filter((r: any) => r.gate === G.gate);
      const lacks = (r: any) => req.filter(t => needs(r.id, t) && !r.types.includes(t));
      const complete = ps.filter((r: any) => !lacks(r).length);
      return { gate: G.gate, name: G.name, passed: ps.length, complete: complete.length, pct: pct(complete.length, ps.length),
        required: req.map(k => { const due = ps.filter((r: any) => needs(r.id, k)); return { key: k, label: DOC_TYPES[k].l, due: due.length, have: due.filter((r: any) => r.types.includes(k)).length }; }),
        missing: ps.filter((r: any) => lacks(r).length).slice(0, 25).map((r: any) => ({ esh_id: r.esh_id, title: r.title, missing: lacks(r).map(t => DOC_TYPES[t].l) })) };
    });
    return { rows, types, completeness, docTypes: DOC_TYPES };
  }));

  const DocNew = z.object({ doc_type: z.string().refine(k => k in DOC_TYPES, 'Unknown document type'), title: z.string().min(2).max(300), criterion_id: z.number().int().nullable().optional(),
    file_name: z.string().min(1).max(200), mime: z.string().max(120).optional(), data: z.string().max(14_000_000) }).strict();
  app.post('/api/projects/:esh/documents', { bodyLimit: 15 * 1024 * 1024 }, wrap(async (req, me) => {
    const b = DocNew.parse(req.body);
    const p = await projectByEsh(db, (req.params as any).esh);
    const j1Doc = ['STAFFING', 'CM_IMPACT', 'CM_STATEMENT'].includes(b.doc_type);
    if (!(canEdit(me, p) || (j1Doc && me.role === 'J1'))) throw new HttpError(403, `${me.name} cannot add documents to ${p.esh_id}`);
    const buf = Buffer.from(b.data, 'base64');
    if (buf.length > 10 * 1024 * 1024) throw new HttpError(413, 'Files are limited to 10 MB');
    mkdirSync(FILES, { recursive: true });
    const key = randomUUID();
    writeFileSync(resolve(FILES, key), buf);
    const crit = b.criterion_id ?? (await db.query<any>(`SELECT id FROM criterion_def WHERE (gate, ord) IN (${DOC_TYPES[b.doc_type].crit.map(([g, o]) => `(${g},${o})`).join(',') || '(-1,-1)'}) LIMIT 1`)).rows[0]?.id ?? null;
    const row = (await db.query<any>(`INSERT INTO document (project_id, doc_type, title, criterion_id, file_name, mime, size, storage_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.id, b.doc_type, b.title, crit, b.file_name, b.mime ?? 'application/octet-stream', buf.length, key, me.name])).rows[0];
    await audit(db, me.name, 'project', p.esh_id, 'DOCUMENT_ADD', null, { doc_type: b.doc_type, title: b.title, file_name: b.file_name, size: buf.length });
    return { ok: true, id: row.id };
  }));

  app.get('/api/documents/:id/file', async (req, reply) => {
    const d = (await db.query<any>('SELECT d.*, p.esh_id FROM document d JOIN project p ON p.id = d.project_id WHERE d.id=$1', [Number((req.params as any).id)])).rows[0];
    if (!d) return reply.code(404).send({ error: 'No such document' });
    const safe = (d.file_name ?? 'document').replace(/[^\w.\- ]+/g, '_');
    if (!d.storage_key || !existsSync(resolve(FILES, d.storage_key))) {
      // a synthetic record: no file was ever uploaded, so serve a plain note instead
      return reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `inline; filename="${safe}.txt"`)
        .send(`SYNTHETIC DEMO RECORD — no file attached.\n\n${DOC_TYPES[d.doc_type]?.l ?? d.doc_type}\nProject: ${d.esh_id}\nTitle: ${d.title}\nRecorded by: ${d.uploaded_by} on ${new Date(d.uploaded_at).toISOString().slice(0, 10)}\n`);
    }
    return reply.header('content-type', d.mime ?? 'application/octet-stream').header('content-disposition', `attachment; filename="${safe}"`).send(readFileSync(resolve(FILES, d.storage_key)));
  });

  app.delete('/api/documents/:id', wrap(async (req, me) => {
    const d = (await q('SELECT d.*, p.esh_id, p.pm_id FROM document d JOIN project p ON p.id = d.project_id WHERE d.id=$1', [Number((req.params as any).id)]))[0];
    if (!d) throw new HttpError(404, 'No such document');
    if (!(me.role === 'ADMIN' || d.uploaded_by === me.name)) throw new HttpError(403, 'Only the uploader or an admin can remove a document');
    await db.query('DELETE FROM document WHERE id=$1', [d.id]);
    if (d.storage_key && existsSync(resolve(FILES, d.storage_key))) unlinkSync(resolve(FILES, d.storage_key));
    await audit(db, me.name, 'project', d.esh_id, 'DOCUMENT_REMOVE', { doc_type: d.doc_type, title: d.title }, null);
    return { ok: true };
  }));

  void MONTH;
}
