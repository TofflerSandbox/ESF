/* Inventory gap analysis and synthetic gap fill.

   The real workbooks leave fields blank on many projects (status, PoP, sponsor, alignment, …).
   `inventoryGaps` measures them across the whole portfolio; `fillInventory` fills each gap with a value
   drawn from the project's own context (its program, element, first data call, title) and records every
   filled field in `project_fill`, so the UI can tag it SYNTHETIC and `--remove` can put the blank back. */
import type { Transaction } from '@electric-sql/pglite';
import { add, iso, rngFor } from './util.js';
import { PROGRAMS } from '../domain.js';

/** Scalar project columns we check and fill. */
const COLS = ['status_code', 'pop_start', 'pop_end', 'description', 'program_code', 'element_code', 'pm_id', 'transition_type', 'transition_phase', 'charter'] as const;
type Col = (typeof COLS)[number];
export const FIELD_LABEL: Record<string, string> = {
  status_code: 'status', pop_start: 'PoP start', pop_end: 'PoP end', description: 'description', program_code: 'program', element_code: 'element',
  pm_id: 'program manager', transition_type: 'transition type', transition_phase: 'transition phase', charter: 'charter',
  sponsor: 'sponsor', contract: 'contract number', priority: 'priority alignment', transition_partner: 'transition partner', stakeholder: 'stakeholders',
};

export async function inventoryGaps(tx: Transaction) {
  const total = (await tx.query<{ n: number }>('SELECT count(*)::int n FROM project')).rows[0].n;
  const counts: Record<string, number> = {};
  for (const c of COLS) counts[c] = (await tx.query<{ n: number }>(`SELECT count(*)::int n FROM project WHERE ${c} IS NULL ${c === 'description' || c === 'charter' ? `OR trim(${c}) = ''` : ''}`)).rows[0].n;
  const rel = async (sql: string) => (await tx.query<{ n: number }>(sql)).rows[0].n;
  counts.sponsor = await rel(`SELECT count(*)::int n FROM project p WHERE NOT EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'SPONSOR')`);
  counts.stakeholder = await rel(`SELECT count(*)::int n FROM project p WHERE NOT EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'STAKEHOLDER')`);
  counts.transition_partner = await rel(`SELECT count(*)::int n FROM project p WHERE NOT EXISTS (SELECT 1 FROM project_org po WHERE po.project_id = p.id AND po.role = 'TRANSITION_PARTNER')`);
  // "N" / "A" / "MIPR" fragments left by splitting "N/A" are not contract numbers: a real one has digits
  counts.contract = await rel(`SELECT count(*)::int n FROM project p WHERE NOT EXISTS (SELECT 1 FROM project_contract c WHERE c.project_id = p.id AND c.number ~ '[0-9]')`);
  counts.priority = await rel(`SELECT count(*)::int n FROM project p WHERE p.last_fy IN (SELECT fy FROM priority)
    AND NOT EXISTS (SELECT 1 FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = p.last_fy WHERE pp.project_id = p.id)`);
  const samples = (await tx.query<{ number: string }>('SELECT number FROM project_contract ORDER BY random() LIMIT 12')).rows.map(r => r.number);
  return { total, counts, contractSamples: samples };
}

export async function removeFill(tx: Transaction) {
  const fills = (await tx.query<{ project_id: number; field: string }>('SELECT project_id, field FROM project_fill')).rows;
  for (const f of fills) if ((COLS as readonly string[]).includes(f.field)) await tx.query(`UPDATE project SET ${f.field} = NULL WHERE id = $1`, [f.project_id]);
  await tx.exec(`DELETE FROM project_fill; DELETE FROM project_org WHERE synthetic; DELETE FROM project_contract WHERE synthetic; DELETE FROM project_priority WHERE synthetic;`);
  return fills.length;
}

export async function fillInventory(tx: Transaction, seed: number, asOf: Date) {
  const ps = (await tx.query<any>(`SELECT p.*, (SELECT max(fy) FROM project_snapshot s WHERE s.project_id = p.id) snap_fy FROM project p ORDER BY p.esh_id`)).rows;
  const fills: { pid: number; field: string }[] = [];
  const set = async (p: any, col: Col, v: unknown) => { await tx.query(`UPDATE project SET ${col} = $2 WHERE id = $1`, [p.id, v]); p[col] = v; fills.push({ pid: p.id, field: col }); };

  /* context the fills draw on: what similar real projects look like */
  const progElement = new Map((await tx.query<any>('SELECT code, element_code FROM program')).rows.map(r => [r.code, r.element_code]));
  const byProgram = <K extends string>(col: K) => {
    const m = new Map<string, any[]>();
    for (const p of ps) if (p[col] != null && p.program_code) { const a = m.get(p.program_code) ?? []; a.push(p[col]); m.set(p.program_code, a); }
    return m;
  };
  const pmsByProg = byProgram('pm_id'), ttByProg = byProgram('transition_type');
  const allTT = ps.map(p => p.transition_type).filter(Boolean);
  const sponsorsByProg = new Map<string, number[]>(), stakeByProg = new Map<string, number[]>(), tpByProg = new Map<string, number[]>();
  for (const r of (await tx.query<any>(`SELECT p.program_code, po.org_id, po.role FROM project_org po JOIN project p ON p.id = po.project_id WHERE p.program_code IS NOT NULL`)).rows) {
    const m = r.role === 'SPONSOR' ? sponsorsByProg : r.role === 'STAKEHOLDER' ? stakeByProg : r.role === 'TRANSITION_PARTNER' ? tpByProg : null;
    if (m) { const a = m.get(r.program_code) ?? []; a.push(r.org_id); m.set(r.program_code, a); }
  }
  const allSponsors = [...sponsorsByProg.values()].flat(), allStake = [...stakeByProg.values()].flat(), allTp = [...tpByProg.values()].flat();
  const prioByProgFy = new Map<string, number[]>();
  for (const r of (await tx.query<any>(`SELECT p.program_code, pri.fy, pp.priority_id FROM project_priority pp JOIN project p ON p.id = pp.project_id JOIN priority pri ON pri.id = pp.priority_id`)).rows) {
    const k = `${r.program_code}:${r.fy}`; const a = prioByProgFy.get(k) ?? []; a.push(r.priority_id); prioByProgFy.set(k, a);
  }
  const prioByFy = new Map<number, number[]>();
  for (const r of (await tx.query<any>('SELECT id, fy FROM priority')).rows) { const a = prioByFy.get(r.fy) ?? []; a.push(r.id); prioByFy.set(r.fy, a); }
  const progName = (c: string | null) => (c ? PROGRAMS[c] ?? c : 'R&D');
  let contractSeq = 0;

  for (const p of ps) {
    const r = rngFor(seed, 'fill:' + p.esh_id);
    const prog = p.program_code as string | null;

    if (!p.program_code) {
      const guess = /sbir|phase (i|ii|iii)\b/i.test(p.title) ? 'SBIR' : /cast/i.test(p.title) ? 'CASTING' : /forg/i.test(p.title) ? 'FORGING' : /additive|\bam\b/i.test(p.title) ? 'AM' : 'LTR';
      await set(p, 'program_code', guess);
    }
    if (!p.element_code) await set(p, 'element_code', progElement.get(p.program_code) ?? (p.program_code === 'SBIR' ? 'SBIR' : 'LOG R&D'));
    if (!p.pm_id) { const pool = pmsByProg.get(p.program_code) ?? [...pmsByProg.values()].flat(); if (pool.length) await set(p, 'pm_id', r.pick(pool)); }

    /* PoP: anchored on the first data call the project appeared in */
    const months = p.element_code === 'SBIR' ? (/phase\s*(i|1)\b(?!i)/i.test(p.title) ? r.between(6, 12) : r.between(18, 30)) : p.element_code === 'MANTECH' ? r.between(24, 48) : r.between(18, 36);
    if (!p.pop_start) {
      const start = p.pop_end ? add(new Date(p.pop_end), -months * 30.44) : add(new Date(Date.UTC(p.first_fy - 1, 9, 1)), r.between(0, 150));
      await set(p, 'pop_start', iso(start));
    }
    if (!p.pop_end) await set(p, 'pop_end', iso(add(new Date(p.pop_start), months * 30.44)));

    /* status: what the dates and transition say */
    if (!p.status_code) {
      const start = new Date(p.pop_start), end = new Date(p.pop_end);
      const st = /complete/i.test(p.transition_phase ?? '') ? 'E' : end < add(asOf, -90) ? r.pick(['D', 'E']) : end < asOf ? 'D'
        : start > add(asOf, -200) ? 'A' : r.chance(0.12) ? 'C' : 'B';
      await set(p, 'status_code', st);
    }
    if (!p.transition_type) { const pool = ttByProg.get(p.program_code) ?? allTT; if (pool.length) await set(p, 'transition_type', r.pick(pool)); }
    // finished work mostly ends in a report, not a fielded capability — keep the at-scale share realistic
    if (!p.transition_phase) await set(p, 'transition_phase', p.status_code === 'E' ? (r.chance(0.3) ? 'Complete' : 'DTIC-Strategy Document/Report Published') : 'In Development');
    if (!p.description || !String(p.description).trim()) {
      const verbs = ['Develops and evaluates', 'Prototypes and tests', 'Investigates and demonstrates', 'Matures and validates'];
      await set(p, 'description', `${r.pick(verbs)} ${p.title.replace(/\s*\(.*?\)\s*$/, '')} for DLA ${p.element_code === 'SBIR' ? 'through a small-business innovation award' : 'operations'}. `
        + `${progName(p.program_code)} portfolio; scope, success measures and transition approach to be confirmed with the sponsor.`);
    }
    if (!p.charter || !String(p.charter).trim()) await set(p, 'charter', `${progName(p.program_code)} R&D charter, FY${String(p.first_fy).slice(2)}`);

    /* relationships */
    const has = async (role: string) => (await tx.query<{ n: number }>('SELECT count(*)::int n FROM project_org WHERE project_id=$1 AND role=$2', [p.id, role])).rows[0].n > 0;
    const addOrg = async (role: string, pool: number[], field: string) => {
      if (!pool.length || await has(role)) return;
      await tx.query('INSERT INTO project_org (project_id, org_id, role, synthetic) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING', [p.id, r.pick(pool), role]);
      fills.push({ pid: p.id, field });
    };
    await addOrg('SPONSOR', sponsorsByProg.get(p.program_code) ?? allSponsors, 'sponsor');
    await addOrg('STAKEHOLDER', stakeByProg.get(p.program_code) ?? allStake, 'stakeholder');
    // a project that ends in a DTIC report has no one to transition to, so it gets no transition partner
    const reportOnly = /dtic/i.test(p.transition_type ?? '') || /dtic/i.test(p.transition_phase ?? '');
    if (!reportOnly) await addOrg('TRANSITION_PARTNER', tpByProg.get(p.program_code) ?? allTp, 'transition_partner');

    if ((await tx.query<{ n: number }>(`SELECT count(*)::int n FROM project_contract WHERE project_id=$1 AND number ~ '[0-9]'`, [p.id])).rows[0].n === 0) {
      const yy = String(new Date(p.pop_start).getUTCFullYear()).slice(2);
      const num = p.element_code === 'SBIR' ? `SP4701-${yy}-C-${String(8000 + ++contractSeq).padStart(4, '0')}` : `SP4701-${yy}-${r.pick(['C', 'D', 'P'])}-${String(1000 + ++contractSeq).padStart(4, '0')}`;
      await tx.query('INSERT INTO project_contract (project_id, number, synthetic) VALUES ($1,$2,true) ON CONFLICT DO NOTHING', [p.id, num]);
      fills.push({ pid: p.id, field: 'contract' });
    }

    /* priority alignment in the project's latest data call, from what its program usually aligns to */
    const fy = p.last_fy;
    if (prioByFy.has(fy)) {
      const aligned = (await tx.query<{ n: number }>('SELECT count(*)::int n FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $2 WHERE pp.project_id = $1', [p.id, fy])).rows[0].n;
      if (!aligned) {
        const pool = prioByProgFy.get(`${p.program_code}:${fy}`) ?? prioByFy.get(fy)!;
        const picks = new Set([r.pick(pool), ...(r.chance(0.4) ? [r.pick(pool)] : [])]);
        for (const id of picks) await tx.query('INSERT INTO project_priority (project_id, priority_id, synthetic) VALUES ($1,$2,true) ON CONFLICT DO NOTHING', [p.id, id]);
        fills.push({ pid: p.id, field: 'priority' });
      }
    }
  }

  for (const f of fills) await tx.query('INSERT INTO project_fill (project_id, field) VALUES ($1,$2) ON CONFLICT DO NOTHING', [f.pid, f.field]);
  const byField: Record<string, number> = {};
  for (const f of fills) byField[f.field] = (byField[f.field] ?? 0) + 1;
  return { filled: fills.length, projects: new Set(fills.map(f => f.pid)).size, byField };
}
