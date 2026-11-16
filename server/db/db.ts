import { PGlite } from '@electric-sql/pglite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config, ROOT } from '../config.js';
import { CRITERIA } from '../domain.js';

let db: PGlite | null = null;

/** Open (and migrate) the embedded Postgres database. One process at a time may hold it. */
export async function getDb(): Promise<PGlite> {
  if (db) return db;
  const dir = resolve(ROOT, config.dataDir);
  mkdirSync(dirname(dir), { recursive: true });
  db = new PGlite(dir);
  await db.exec(readFileSync(resolve(ROOT, 'server/db/schema.sql'), 'utf8'));
  await syncReference(db);
  return db;
}

/** Keep gate criteria and built-in users in step with domain.ts (adds J1's criteria to an existing database). */
export async function syncReference(q: { query: PGlite['query'] }) {
  for (const [g, list] of Object.entries(CRITERIA))
    for (const [i, c] of list.entries())
      await q.query(`INSERT INTO criterion_def (gate, ord, text, non_waivable, owner) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (gate, ord) DO UPDATE SET text = EXCLUDED.text, non_waivable = EXCLUDED.non_waivable, owner = EXCLUDED.owner`,
        [+g, i + 1, c.t, !!c.hard, c.owner ?? 'J68']);
  const hasUsers = (await q.query<{ n: number }>('SELECT count(*)::int n FROM app_user')).rows[0].n > 0;
  if (hasUsers) await q.query(`INSERT INTO app_user (name, role) VALUES ('J1 Human Capital Transformation','J1') ON CONFLICT (name) DO NOTHING`);
}

export async function closeDb() {
  if (db) { await db.close(); db = null; }
}

/** Append-only audit record. Call inside the same transaction as the change. */
export async function audit(
  q: { query: PGlite['query'] },
  actor: string, entity: string, entityId: string, action: string,
  before: unknown, after: unknown,
) {
  await q.query(
    'INSERT INTO audit_event (actor, entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}
