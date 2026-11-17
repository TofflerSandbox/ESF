/* Duplication and lineage (synthetic): some review history so the Overlaps page has resolved and open work.
   - Follow-on links where the real titles show successive phases of one effort (most confirmed, some left for review).
   - The local Gate 3 flagship and its predecessor, linked as a follow-on.
   - A share of strong overlaps reviewed: duplicates confirmed, related work linked, false alarms dismissed; the rest open.
   - The Gate 0 duplication check: active Stage 0 projects pass it only when their strong overlaps are resolved. */
import type { Transaction } from '@electric-sql/pglite';
import { config } from '../config.js';
import { followOns } from '../domain.js';
import { OVERLAP_CRIT, STRONG, overlapsFor, pairsAbove } from '../overlap.js';
import { rngFor, iso } from './util.js';

const ADMIN = 'J68 Portfolio Admin';
const LIVE = ['ACTIVE', 'HOLD'];

export async function removeOverlap(tx: Transaction) {
  await tx.exec('DELETE FROM project_link WHERE synthetic;');
}

export async function seedOverlap(tx: Transaction, seed: number, asOf: Date) {
  const q = <T = any>(sql: string, p: unknown[] = []) => tx.query<T>(sql, p).then(r => r.rows);
  const linked = new Set<string>();
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const when = (r: ReturnType<typeof rngFor>) => iso(new Date(asOf.getTime() - r.int(5, 140) * 864e5));
  const link = async (a: number, b: number, kind: string, note: string | null, at: string) => {
    if (linked.has(key(a, b))) return false;
    linked.add(key(a, b));
    await tx.query(`INSERT INTO project_link (a_id, b_id, kind, note, created_by, created_at, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`, [a, b, kind, note, ADMIN, at]);
    return true;
  };
  const n = { follow: 0, duplicate: 0, related: 0, dismissed: 0 };

  /* the local flagship's lineage */
  const fl = config.demo?.gate3Flagship?.trim(), pr = config.demo?.gate3Predecessor?.trim();
  if (fl && pr) {
    const [a] = await q(`SELECT id FROM project WHERE lower(title) = lower($1)`, [pr]), [b] = await q(`SELECT id FROM project WHERE lower(title) = lower($1)`, [fl]);
    if (a && b && await link(a.id, b.id, 'FOLLOW_ON', 'Continued with the full COCOM partner set after Phase I', '2025-10-01')) n.follow++;
  }

  /* follow-ons visible in the real titles */
  const ps = await q(`SELECT id, title, coalesce(first_fy, 2025) first_fy FROM project`);
  for (const [id, later] of followOns(ps)) for (const o of later) {
    const r = rngFor(seed, `follow:${id}:${o.id}`);
    if (r.chance(0.75) && await link(id, o.id, 'FOLLOW_ON', null, when(r))) n.follow++;
  }

  /* a share of strong overlaps reviewed */
  for (const p of await pairsAbove(tx, STRONG)) {
    if (linked.has(key(p.a.id, p.b.id))) continue;
    const r = rngFor(seed, `overlap:${key(p.a.id, p.b.id)}`);
    const bothLive = LIVE.includes(p.a.esf_status ?? '') && LIVE.includes(p.b.esf_status ?? '');
    const [lo, hi] = p.a.id < p.b.id ? [p.a.id, p.b.id] : [p.b.id, p.a.id];
    const k = p.sameName && bothLive ? r.weighted([30, 25, 0, 45]) : r.weighted([4, 26, 20, 50]);   // duplicate | related | not related | still open
    if (k === 0 && await link(lo, hi, 'DUPLICATE', 'Same effort carried as two records across data calls; keep the later record', when(r))) n.duplicate++;
    if (k === 1 && await link(lo, hi, 'RELATED', r.pick(['Same supplier base; PMs to share test results', 'Overlapping scope; sponsors agreed to coordinate', 'Complementary: one builds the model, the other fields it']), when(r))) n.related++;
    if (k === 2 && await link(lo, hi, 'NOT_RELATED', r.pick(['Similar wording; different item and customer', 'Shared vendor only; unrelated work', 'Different commodity and process']), when(r))) n.dismissed++;
  }

  /* the Gate 0 duplication check for active Stage 0 projects */
  const crit = (await q(`SELECT id FROM criterion_def WHERE gate = $1 AND ord = $2`, [OVERLAP_CRIT.gate, OVERLAP_CRIT.ord]))[0].id;
  const intake = await q(`SELECT id, esh_id FROM project WHERE esf_synthetic AND esf_phase = 0 AND esf_status IN ('ACTIVE','HOLD')`);
  let pass = 0, blocked = 0;
  for (const p of intake) {
    await tx.query(`DELETE FROM criterion_status WHERE project_id = $1 AND criterion_id = $2 AND synthetic`, [p.id, crit]);
    const o = await overlapsFor(tx, p.id);
    if (o.unresolvedStrong.length) { blocked++; continue; }
    const r = rngFor(seed, 'g0dup:' + p.esh_id);
    await tx.query(`INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by, updated_at, synthetic) VALUES ($1,$2,'MET',$3,$4,$5,true)`,
      [p.id, crit, `Related-work review in the Hub: ${o.candidates.length} similar project${o.candidates.length === 1 ? '' : 's'} checked, ${o.candidates.filter(c => c.link).length} linked or dismissed, none disqualifying`, ADMIN, when(r)]);
    pass++;
  }
  console.log({ follow_on_links: n.follow, duplicates_confirmed: n.duplicate, related_links: n.related, dismissed: n.dismissed, stage0_duplication_check: { pass, blocked } });
}
