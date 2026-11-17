/* Duplication and lineage.

   A similarity index over every project (title weighted twice, description, and the concept features from the portfolio
   search: "augmented reality" and "HoloLens" count as the same topic). Each project's nearest neighbours are flagged as
   possible overlaps until someone links them (follow-on, duplicate, related) or dismisses them (not related).
   The Hub checks the ESF's Gate 0 criterion "No disqualifying duplication": it can be met only when every strong overlap
   is resolved, so a new start is checked against what the portfolio has already done. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { z } from 'zod';
import { audit } from './db/db.js';
import { CONCEPTS, GENERIC, STOP, norm, stem } from './assist.js';
import { titleStem } from './domain.js';

type Q = PGlite | Transaction;
export const STRONG = 0.42;       // a likely overlap: must be resolved before Gate 0
export const POSSIBLE = 0.28;     // worth a look
export const OVERLAP_CRIT = { gate: 0, ord: 5 };
export const LINK_KIND: Record<string, { l: string; d: string }> = {
  FOLLOW_ON: { l: 'Follow-on', d: 'Continues the earlier effort' },
  DUPLICATE: { l: 'Duplicate record', d: 'The same effort recorded twice' },
  RELATED: { l: 'Related', d: 'Overlapping work; distinct efforts that should know about each other' },
  NOT_RELATED: { l: 'Not related', d: 'Reviewed: similar wording, different work' },
};

type Doc = { id: number; esh_id: string; title: string; description: string; program_code: string | null; esf_phase: number | null; esf_status: string | null; first_fy: number | null; stem: string };
type Vec = Map<string, number>;
let cache: { key: string; docs: Doc[]; vecs: Vec[]; display: Map<string, string>; nn: Map<number, { j: number; s: number; why: string[]; sameName: boolean }[]> } | null = null;

const words = (s: string) => (s.toLowerCase().replace(/[’']/g, '').match(/[a-z][a-z0-9]+/g) ?? []).filter(w => w.length > 2 && !STOP.has(w));
const conceptTriggers = CONCEPTS.map(c => ({ name: c.name, trig: c.triggers.map(norm) }));

function vectorize(text: { title: string; description: string }, display: Map<string, string>) {
  const tf = new Map<string, number>();
  const add = (k: string, w: number) => tf.set(k, (tf.get(k) ?? 0) + w);
  for (const [s, w] of [[text.title, 2], [text.description, 1]] as const)
    for (const raw of words(s)) { const k = stem(raw); if (GENERIC.has(k) || GENERIC.has(raw)) continue; add(k, w); if (!display.has(k)) display.set(k, raw); }
  const n = norm(text.title + ' ' + text.description);
  for (const c of conceptTriggers) if (c.trig.some(t => n.includes(t))) { add('§' + c.name, 2); display.set('§' + c.name, c.name); }
  return tf;
}

/** Build (or reuse) the index; rebuilt whenever any project's text changes. */
async function index(q: Q) {
  const key = (await q.query<any>(`SELECT count(*)::int n, coalesce(sum(length(title) + length(coalesce(description, ''))), 0)::int len, max(updated_at)::text u FROM project`)).rows[0];
  const k = `${key.n}:${key.len}:${key.u}`;
  if (cache?.key === k) return cache;
  const docs: Doc[] = (await q.query<any>(`SELECT id, esh_id, title, coalesce(description, '') description, program_code, esf_phase, esf_status, first_fy FROM project ORDER BY id`)).rows
    .map((d: any) => ({ ...d, stem: titleStem(d.title) }));
  const display = new Map<string, string>();
  const tfs = docs.map(d => vectorize(d, display));
  const df = new Map<string, number>();
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const vecs = tfs.map(tf => {
    const v: Vec = new Map();
    for (const [t, c] of tf) { const d = df.get(t)!; if (d > N * 0.25) continue; v.set(t, (1 + Math.log(c)) * Math.log(1 + N / d)); }
    const len = Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;
    for (const [t, x] of v) v.set(t, x / len);
    return v;
  });
  // inverted index → cosine for every pair that shares a term
  const post = new Map<string, number[]>();
  vecs.forEach((v, i) => { for (const t of v.keys()) (post.get(t) ?? post.set(t, []).get(t)!).push(i); });
  const nn = new Map<number, { j: number; s: number; why: string[]; sameName: boolean }[]>();
  vecs.forEach((v, i) => {
    const acc = new Map<number, number>();
    for (const [t, x] of v) for (const j of post.get(t)!) if (j !== i) acc.set(j, (acc.get(j) ?? 0) + x * vecs[j].get(t)!);
    const sameStem = docs[i].stem.split(' ').length >= 2;
    const list = [...acc.entries()].map(([j, s]) => {
      const same = sameStem && docs[j].stem === docs[i].stem;
      return { j, s: same ? Math.max(s, 0.75) : s, sameName: same };
    }).filter(x => x.s >= 0.18).sort((a, b) => b.s - a.s).slice(0, 12)
      .map(x => ({ ...x, why: [...v.keys()].filter(t => vecs[x.j].has(t)).sort((a, b) => v.get(b)! * vecs[x.j].get(b)! - v.get(a)! * vecs[x.j].get(a)!).slice(0, 5).map(t => display.get(t) ?? t) }));
    nn.set(i, list);
  });
  cache = { key: k, docs, vecs, display, nn };
  return cache;
}

const LIVE = ['ACTIVE', 'HOLD'];
async function linksOf(q: Q, ids?: number[]) {
  const rows = (await q.query<any>(`SELECT l.*, a.esh_id a_esh, b.esh_id b_esh FROM project_link l JOIN project a ON a.id = l.a_id JOIN project b ON b.id = l.b_id
    ${ids ? 'WHERE l.a_id = ANY($1) OR l.b_id = ANY($1)' : ''}`, ids ? [ids] : [])).rows;
  const pair = new Map<string, any>();
  for (const l of rows) pair.set(`${Math.min(l.a_id, l.b_id)}:${Math.max(l.a_id, l.b_id)}`, l);
  return { rows, pair, get: (x: number, y: number) => pair.get(`${Math.min(x, y)}:${Math.max(x, y)}`) };
}

/** A project's likely overlaps and whether each has been resolved. */
export async function overlapsFor(q: Q, projectId: number) {
  const I = await index(q);
  const i = I.docs.findIndex(d => d.id === projectId);
  if (i < 0) return { candidates: [], unresolvedStrong: [] as any[] };
  const L = await linksOf(q, [projectId]);
  const candidates = (I.nn.get(i) ?? []).filter(n => n.s >= POSSIBLE || n.sameName).map(n => {
    const o = I.docs[n.j], link = L.get(projectId, o.id);
    return { id: o.id, esh_id: o.esh_id, title: o.title, program_code: o.program_code, esf_phase: o.esf_phase, esf_status: o.esf_status, first_fy: o.first_fy,
      score: Math.round(n.s * 100) / 100, strong: n.s >= STRONG, sameName: n.sameName, why: n.why, link: link ? { id: link.id, kind: link.kind } : null };
  });
  return { candidates, unresolvedStrong: candidates.filter(c => c.strong && !c.link) };
}

/** Every pair at or above a score, once each (for seeding and reports). */
export async function pairsAbove(q: Q, min: number) {
  const I = await index(q);
  const seen = new Set<string>(), out: { a: Doc; b: Doc; s: number; sameName: boolean }[] = [];
  I.nn.forEach((list, i) => list.forEach(n => {
    if (n.s < min) return;
    const k = `${Math.min(I.docs[i].id, I.docs[n.j].id)}:${Math.max(I.docs[i].id, I.docs[n.j].id)}`;
    if (seen.has(k)) return; seen.add(k);
    out.push({ a: I.docs[i], b: I.docs[n.j], s: n.s, sameName: n.sameName });
  }));
  return out.sort((x, y) => y.s - x.s);
}

/** The follow-on chain through a project, earliest first. */
async function lineage(q: Q, projectId: number) {
  const fl = (await q.query<any>(`SELECT l.a_id, l.b_id FROM project_link l WHERE l.kind = 'FOLLOW_ON'`)).rows;
  const prev = new Map(fl.map((l: any) => [l.b_id, l.a_id])), next = new Map(fl.map((l: any) => [l.a_id, l.b_id]));
  const chain = [projectId];
  for (let x = projectId, k = 0; prev.has(x) && k < 8; k++) { x = prev.get(x)!; chain.unshift(x); }
  for (let x = projectId, k = 0; next.has(x) && k < 8; k++) { x = next.get(x)!; chain.push(x); }
  if (chain.length < 2) return [];
  const rows = (await q.query<any>(`SELECT id, esh_id, title, esf_phase, esf_status, first_fy FROM project WHERE id = ANY($1)`, [chain])).rows;
  return chain.map(id => rows.find((r: any) => r.id === id));
}

type Deps = { wrap: (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any; canEdit: (u: any, p: any) => boolean; projectByEsh: (q: Q, esh: string) => Promise<Record<string, any>>; HttpError: new (s: number, m: string) => Error };

export function registerOverlap(app: FastifyInstance, db: PGlite, h: Deps) {
  const canLink = (me: any, a: any, b: any) => me.role === 'ADMIN' || h.canEdit(me, a) || h.canEdit(me, b);

  app.get('/api/projects/:esh/overlaps', h.wrap(async (req, me) => {
    const p = await h.projectByEsh(db, (req.params as any).esh);
    const o = await overlapsFor(db, p.id);
    const L = await linksOf(db, [p.id]);
    const others = (await db.query<any>(`SELECT id, esh_id, title, esf_phase, esf_status, program_code FROM project WHERE id = ANY($1)`, [L.rows.map((l: any) => (l.a_id === p.id ? l.b_id : l.a_id))])).rows;
    const links = L.rows.map((l: any) => {
      const otherId = l.a_id === p.id ? l.b_id : l.a_id, other = others.find((x: any) => x.id === otherId);
      const role = l.kind === 'FOLLOW_ON' ? (l.a_id === p.id ? 'continued by' : 'continues') : LINK_KIND[l.kind].l.toLowerCase();
      const at = l.created_at instanceof Date ? l.created_at.toISOString().slice(0, 10) : String(l.created_at).slice(0, 10);
      return { id: l.id, kind: l.kind, role, note: l.note, created_by: l.created_by, created_at: at, synthetic: l.synthetic, other };
    });
    return { ...o, links, lineage: await lineage(db, p.id), kinds: LINK_KIND, strong: STRONG, canLink: me.role === 'ADMIN' || h.canEdit(me, p) };
  }));

  const Link = z.object({ other: z.string().regex(/^ESH-\d{4}$/), kind: z.enum(['FOLLOW_ON', 'DUPLICATE', 'RELATED', 'NOT_RELATED']),
    direction: z.enum(['THIS_CONTINUES', 'THIS_IS_CONTINUED']).optional(), note: z.string().max(1000).nullable().optional() }).strict();
  app.post('/api/projects/:esh/links', h.wrap(async (req, me) => {
    const b = Link.parse(req.body);
    return db.transaction(async tx => {
      const p = await h.projectByEsh(tx, (req.params as any).esh), o = await h.projectByEsh(tx, b.other);
      if (p.id === o.id) throw new h.HttpError(400, 'A project cannot be linked to itself');
      if (!canLink(me, p, o)) throw new h.HttpError(403, `Only the PM of ${p.esh_id} or ${o.esh_id}, or the admin, can link them`);
      if (b.kind === 'FOLLOW_ON' && !b.direction) throw new h.HttpError(400, 'Say which project continues which');
      if ((b.kind === 'NOT_RELATED' || b.kind === 'DUPLICATE') && !b.note?.trim()) throw new h.HttpError(400, `Say why: a ${LINK_KIND[b.kind].l.toLowerCase()} decision needs a reason on record`);
      const [a, bb] = b.kind === 'FOLLOW_ON' ? (b.direction === 'THIS_CONTINUES' ? [o.id, p.id] : [p.id, o.id]) : [Math.min(p.id, o.id), Math.max(p.id, o.id)];
      const prior = (await tx.query<any>(`SELECT * FROM project_link WHERE LEAST(a_id,b_id) = $1 AND GREATEST(a_id,b_id) = $2`, [Math.min(p.id, o.id), Math.max(p.id, o.id)])).rows[0];
      if (prior) await tx.query(`DELETE FROM project_link WHERE id = $1`, [prior.id]);
      await tx.query(`INSERT INTO project_link (a_id, b_id, kind, note, created_by) VALUES ($1,$2,$3,$4,$5)`, [a, bb, b.kind, b.note ?? null, me.name]);
      for (const x of [p, o]) await audit(tx, me.name, 'project', x.esh_id, 'LINK', prior ? { kind: prior.kind } : null, { kind: b.kind, with: x === p ? o.esh_id : p.esh_id, note: b.note ?? null });
      return { ok: true };
    });
  }));
  app.delete('/api/links/:id', h.wrap(async (req, me) => {
    return db.transaction(async tx => {
      const l = (await tx.query<any>(`SELECT l.*, a.esh_id a_esh, b.esh_id b_esh FROM project_link l JOIN project a ON a.id = l.a_id JOIN project b ON b.id = l.b_id WHERE l.id = $1`, [Number((req.params as any).id)])).rows[0];
      if (!l) throw new h.HttpError(404, 'No such link');
      const a = await h.projectByEsh(tx, l.a_esh), b = await h.projectByEsh(tx, l.b_esh);
      if (!canLink(me, a, b)) throw new h.HttpError(403, 'Only the PM of either project, or the admin, can remove this link');
      await tx.query(`DELETE FROM project_link WHERE id = $1`, [l.id]);
      for (const x of [a, b]) await audit(tx, me.name, 'project', x.esh_id, 'UNLINK', { kind: l.kind }, null);
      return { ok: true };
    });
  }));

  /* ── the portfolio view: unresolved overlaps, live duplication risk vs prior work to build on ── */
  app.get('/api/overlaps', h.wrap(async () => {
    const I = await index(db);
    const L = await linksOf(db);
    const seen = new Set<string>(), pairs: any[] = [];
    I.nn.forEach((list, i) => list.forEach(n => {
      if (n.s < POSSIBLE && !n.sameName) return;
      const a = I.docs[i], b = I.docs[n.j], k = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
      if (seen.has(k)) return; seen.add(k);
      const liveA = LIVE.includes(a.esf_status ?? ''), liveB = LIVE.includes(b.esf_status ?? '');
      if (!liveA && !liveB) return;
      const link = L.get(a.id, b.id);
      const [x, y] = liveA && !liveB ? [a, b] : !liveA && liveB ? [b, a] : a.id < b.id ? [a, b] : [b, a];
      pairs.push({ key: k, score: Math.round(n.s * 100) / 100, strong: n.s >= STRONG, sameName: n.sameName, why: n.why, kind: liveA && liveB ? 'LIVE' : 'PRIOR',
        link: link ? { id: link.id, kind: link.kind } : null,
        a: { esh_id: x.esh_id, title: x.title, program_code: x.program_code, esf_phase: x.esf_phase, esf_status: x.esf_status, first_fy: x.first_fy },
        b: { esh_id: y.esh_id, title: y.title, program_code: y.program_code, esf_phase: y.esf_phase, esf_status: y.esf_status, first_fy: y.first_fy } });
    }));
    pairs.sort((p, q) => q.score - p.score);
    const open = pairs.filter(p => !p.link);
    const crossProgram = open.filter(p => p.a.program_code && p.b.program_code && p.a.program_code !== p.b.program_code);
    return {
      pairs: pairs.slice(0, 400), kinds: LINK_KIND, thresholds: { strong: STRONG, possible: POSSIBLE },
      totals: {
        liveOpen: open.filter(p => p.kind === 'LIVE').length, liveStrong: open.filter(p => p.kind === 'LIVE' && p.strong).length,
        priorOpen: open.filter(p => p.kind === 'PRIOR').length, crossProgram: crossProgram.length,
        resolved: Object.fromEntries(Object.keys(LINK_KIND).map(k => [k, L.rows.filter((l: any) => l.kind === k).length])),
      },
    };
  }));

  /* ── intake check: describe the work you want to start, see what the portfolio has already done ── */
  app.post('/api/overlaps/check', h.wrap(async req => {
    const b = z.object({ title: z.string().trim().min(3).max(300), description: z.string().max(4000).optional().default('') }).strict().parse(req.body);
    const I = await index(db);
    const display = new Map(I.display);
    const tf = vectorize(b, display);
    const N = I.docs.length, df = new Map<string, number>();
    for (const v of I.vecs) for (const t of v.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, c] of tf) { const d = df.get(t); if (!d) continue; v.set(t, (1 + Math.log(c)) * Math.log(1 + N / d)); }
    const len = Math.sqrt([...v.values()].reduce((a, x) => a + x * x, 0)) || 1;
    for (const [t, x] of v) v.set(t, x / len);
    const stemQ = titleStem(b.title);
    const hits = I.docs.map((d, j) => {
      let s = 0; for (const [t, x] of v) s += x * (I.vecs[j].get(t) ?? 0);
      const same = stemQ.split(' ').length >= 2 && d.stem === stemQ;
      return { d, s: same ? Math.max(s, 0.75) : s, same, why: [...v.keys()].filter(t => I.vecs[j].has(t)).slice(0, 5).map(t => display.get(t) ?? t) };
    }).filter(x => x.s >= 0.22).sort((a, b) => b.s - a.s).slice(0, 10);
    return { results: hits.map(x => ({ esh_id: x.d.esh_id, title: x.d.title, program_code: x.d.program_code, esf_phase: x.d.esf_phase, esf_status: x.d.esf_status, first_fy: x.d.first_fy,
      score: Math.round(x.s * 100) / 100, strong: x.s >= STRONG, sameName: x.same, why: x.why })), thresholds: { strong: STRONG, possible: POSSIBLE } };
  }));
}
