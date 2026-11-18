import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { config } from './config.js';
import { roiData } from './roi.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
const SNAP = 'demo_snapshot';

/**
 * Demo support.
 * - Baseline and reset: a copy of every table, kept inside the database, so a live demo can be undone in one step.
 *   Created automatically the first time the server starts; an admin can save the current state as the new baseline.
 * - The demo story: the projects and seats the guided tour opens. The flagship comes from the git-ignored local config,
 *   so no project title is written into the code.
 */
export function registerDemo(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap; requireRole: (u: any, ...r: string[]) => void }) {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];
  const tables = async () => (await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map(r => r.t as string);
  const status = async () => {
    const r = (await q(`SELECT obj_description(oid, 'pg_namespace') note FROM pg_namespace WHERE nspname = $1`, [SNAP]))[0];
    return r ? { baseline: true, savedAt: r.note ?? null } : { baseline: false, savedAt: null };
  };

  async function saveBaseline() {
    const ts = await tables(), at = new Date().toISOString();
    await db.transaction(async tx => {
      await tx.exec(`DROP SCHEMA IF EXISTS ${SNAP} CASCADE; CREATE SCHEMA ${SNAP};`);
      for (const t of ts) await tx.exec(`CREATE TABLE ${SNAP}."${t}" AS SELECT * FROM public."${t}";`);
      await tx.exec(`COMMENT ON SCHEMA ${SNAP} IS '${at}';`);
    });
    return at;
  }

  async function reset() {
    if (!(await status()).baseline) throw new Error('No demo baseline has been saved yet.');
    const saved = new Set((await q(`SELECT table_name t FROM information_schema.tables WHERE table_schema = $1`, [SNAP])).map(r => r.t));
    const ts = (await tables()).filter(t => saved.has(t));
    // serial id columns, found up front: a failed lookup inside the transaction would abort it
    const seqs = new Map((await q(`SELECT c.table_name t, pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) s FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.column_name = 'id' AND c.column_default LIKE 'nextval%'`)).map(r => [r.t as string, r.s as string]));
    await db.transaction(async tx => {
      await tx.exec(`SET LOCAL session_replication_role = replica;`);   // restore in any order: foreign keys are checked by the copy itself
      for (const t of ts) {
        const cols = (await tx.query<any>(`SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) cols
          FROM information_schema.columns c JOIN information_schema.columns s ON s.table_schema = $2 AND s.table_name = c.table_name AND s.column_name = c.column_name
          WHERE c.table_schema = 'public' AND c.table_name = $1`, [t, SNAP])).rows[0].cols;
        await tx.exec(`DELETE FROM public."${t}"; INSERT INTO public."${t}" (${cols}) SELECT ${cols} FROM ${SNAP}."${t}";`);
        const seq = seqs.get(t);
        if (seq) await tx.query(`SELECT setval($1, coalesce((SELECT max(id) FROM public."${t}"), 0) + 1, false)`, [seq]);
      }
      await tx.exec(`UPDATE app_user SET seen_at = NULL, prev_seen_at = NULL;`);   // everyone's "What's new" starts fresh
    });
  }

  // first start: keep today's state as the baseline
  void status().then(s => (s.baseline ? null : saveBaseline())).catch(e => console.warn('Demo baseline not saved:', e.message));

  app.get('/api/demo/status', deps.wrap(async () => status()));
  app.post('/api/demo/baseline', deps.wrap(async (_req, me) => { deps.requireRole(me, 'ADMIN'); return { ok: true, savedAt: await saveBaseline() }; }));
  app.post('/api/demo/reset', deps.wrap(async (_req, me) => { deps.requireRole(me, 'ADMIN'); await reset(); return { ok: true, ...(await status()) }; }));

  /** The projects and seats the demo script uses. */
  app.get('/api/demo/story', deps.wrap(async () => {
    const byTitle = async (t?: string) => (t ? (await q(`SELECT id, esh_id, title, esf_phase, esf_status FROM project WHERE lower(title) = lower($1)`, [t.trim()]))[0] ?? null : null);
    const flagship = await byTitle(config.demo?.gate3Flagship), predecessor = await byTitle(config.demo?.gate3Predecessor);
    const sponsorOrg = flagship ? (await q(`SELECT o.id, o.name FROM project_org po JOIN org o ON o.id = po.org_id
      WHERE po.project_id = $1 AND po.role = 'SPONSOR' AND o.name NOT ILIKE '%J68%' ORDER BY o.name LIMIT 1`, [flagship.id]))[0] ?? null : null;
    const seat = async (role: string, org?: number | null) => (await q(`SELECT id, name FROM app_user WHERE role = $1 ${org ? 'AND org_id = $2' : ''} ORDER BY id LIMIT 1`, org ? [role, org] : [role]))[0] ?? null;
    const roi = await roiData(db, 5);
    const behind = roi.realized.projects.filter((p: any) => ['AT_RISK', 'BEHIND'].includes(p.status)).sort((a: any, b: any) => (a.realization ?? 1) - (b.realization ?? 1))[0] ?? null;
    const dup = (await q(`SELECT a.esh_id a, b.esh_id b FROM project_link l JOIN project a ON a.id = l.a_id JOIN project b ON b.id = l.b_id WHERE l.kind = 'DUPLICATE' ORDER BY l.id LIMIT 1`))[0] ?? null;
    const words = flagship ? flagship.title.replace(/\(.*?\)/g, '').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3).join(' ').toLowerCase() : null;
    return {
      flagship: flagship && { esh_id: flagship.esh_id, title: flagship.title, phase: flagship.esf_phase, status: flagship.esf_status },
      predecessor: predecessor && { esh_id: predecessor.esh_id, title: predecessor.title },
      sponsor: sponsorOrg && { org_id: sponsorOrg.id, org: sponsorOrg.name, user: await seat('SPONSOR', sponsorOrg.id) },
      seats: { admin: await seat('ADMIN'), authority: await seat('AUTHORITY'), j1: await seat('J1'), pm: await seat('PM') },
      fielded: behind && { esh_id: behind.esh_id, title: behind.title, status: behind.status, realization: behind.realization },
      duplicate: dup, intakeIdea: words,
      ...(await status()),
    };
  }));
}
