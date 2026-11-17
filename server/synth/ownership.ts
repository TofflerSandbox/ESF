/* Enterprise ownership (synthetic): sponsor signatures, committed-pathway details, the Gate 3 Hub proposal, and a local
   Gate 3 flagship story. Realistic gaps on purpose: commitments made without a receiver or POM year, pathways never committed,
   sponsor signatures still outstanding, so the scorecard has something to find. */
import type { Transaction } from '@electric-sql/pglite';
import { config } from '../config.js';
import { PATHWAY_CRIT } from '../domain.js';
import { rngFor, iso } from './util.js';

const ADMIN = 'J68 Portfolio Admin';
const HUB_LIVE = '2026-07-01';               // signatures after this date were made in the Hub

export async function seedOwnership(tx: Transaction, seed: number, asOf: Date) {
  const q = <T = any>(sql: string, p: unknown[] = []) => tx.query<T>(sql, p).then(r => r.rows);
  const seats = new Map<number, string>((await q(`SELECT org_id, name FROM app_user WHERE role = 'SPONSOR'`)).map((u: any) => [u.org_id, u.name]));
  const orgs = await q(`SELECT id, name FROM org`);
  const orgByName = (n: string) => orgs.find((o: any) => n.toLowerCase().includes(o.name.toLowerCase()) && o.name.length > 6);
  const docketed = new Set((await q(`SELECT i.project_id FROM gate_board_item i JOIN gate_board b ON b.id = i.board_id WHERE b.status = 'SCHEDULED' AND i.gate = 3`)).map((r: any) => r.project_id));
  const crit7 = (await q(`SELECT id FROM criterion_def WHERE gate = $1 AND ord = $2`, [PATHWAY_CRIT.gate, PATHWAY_CRIT.ord]))[0].id;

  /* ── 1. pathway details: receiver, funding line, POM year, with gaps ── */
  const paths = await q(`SELECT t.id, t.project_id, t.path, t.status, t.mechanism, p.esh_id, p.esf_phase, p.esf_status, p.program_code,
      (SELECT o.id FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1) sponsor_id,
      (SELECT o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1) sponsor
    FROM transition_pathway t JOIN project p ON p.id = t.project_id WHERE t.synthetic`);
  let complete = 0, gaps = 0, uncommitted = 0;
  for (const t of paths) {
    const r = rngFor(seed, 'pathway:' + t.esh_id);
    const named = t.path === 'A_WCF' ? orgByName(t.mechanism ?? '') : null;
    const receiverId = named?.id ?? t.sponsor_id ?? null, receiver = named?.name ?? t.sponsor ?? null;
    const line = t.path === 'A_WCF' ? `WCF cost recovery — ${receiver ?? 'DLA'} supply chain` : `O&M, ${receiver ?? 'sponsor'} — ${t.program_code ?? 'R&D'} sustainment line`;
    const pom = Number((t.mechanism ?? '').match(/POM FY(\d\d)/)?.[1] ?? 0) ? 2000 + Number((t.mechanism ?? '').match(/POM FY(\d\d)/)![1]) : 2028 + r.int(0, 2);
    let set = { receiver: receiverId, line: line as string | null, pom: t.path === 'B_POM' ? pom as number | null : null }, status = t.status;
    if (t.status === 'COMMITTED' && !docketed.has(t.project_id)) {
      const k = r.weighted([52, 20, 14, 14]);   // complete | no POM year / line | no receiver | never actually committed
      if (k === 1) { if (t.path === 'B_POM') set.pom = null; else set.line = null; }
      if (k === 2) set.receiver = null;
      if (k === 3) { status = 'DECLARED'; uncommitted++; }
    }
    if (t.status === 'DECLARED') { if (!r.chance(0.4)) set = { receiver: null, line: null, pom: null }; else set.line = null; }
    if (status === 'COMMITTED' && set.receiver && set.line && (t.path === 'A_WCF' || set.pom)) complete++; else if (status === 'COMMITTED') gaps++;
    await tx.query(`UPDATE transition_pathway SET receiver_org_id=$2, funding_line=$3, pom_fy=$4, status=$5, committed_at=CASE WHEN $5='DECLARED' THEN NULL ELSE committed_at END WHERE id=$1`,
      [t.id, set.receiver, set.line, set.pom, status]);
  }

  /* ── 2. the Gate 3 Hub proposal: met only with a complete commitment; decisions before it existed are marked not assessed ── */
  await tx.query(`DELETE FROM criterion_status WHERE criterion_id = $1 AND synthetic`, [crit7]);
  const g3 = await q(`SELECT p.id, p.esh_id, p.esf_phase, p.esf_status,
      (SELECT max(decided_at) FROM gate_decision g WHERE g.project_id = p.id AND g.gate = 3 AND g.outcome = 'PASS') passed,
      (SELECT o.id FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1) sponsor_id,
      t.status pstatus, t.receiver_org_id, t.funding_line, t.pom_fy, t.path, ro.name receiver
    FROM project p LEFT JOIN LATERAL (SELECT * FROM transition_pathway x WHERE x.project_id = p.id ORDER BY CASE x.status WHEN 'ACTIVE' THEN 0 WHEN 'COMMITTED' THEN 1 ELSE 2 END LIMIT 1) t ON true
    LEFT JOIN org ro ON ro.id = t.receiver_org_id
    WHERE p.esf_synthetic AND ((p.esf_phase = 3 AND p.esf_status IN ('ACTIVE','HOLD')) OR p.esf_phase >= 4)`);
  for (const p of g3) {
    if (p.esf_phase >= 4 && p.passed) {
      await tx.query(`INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by, updated_at, synthetic) VALUES ($1,$2,'WAIVED',$3,$4,$5,true)`,
        [p.id, crit7, 'Not assessed — Gate 3 decided before this Hub proposal (Nov 2026)', ADMIN, iso(new Date(p.passed))]);
    } else if (p.esf_phase === 3 && ['COMMITTED', 'ACTIVE'].includes(p.pstatus) && p.receiver_org_id && p.funding_line && (p.path === 'A_WCF' || p.pom_fy)) {
      const r = rngFor(seed, 'crit7:' + p.esh_id);
      const at = new Date(asOf.getTime() - r.int(3, 40) * 864e5);
      await tx.query(`INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by, updated_at, synthetic) VALUES ($1,$2,'MET',$3,$4,$5,true)`,
        [p.id, crit7, `Pathway committed: ${p.receiver} · ${p.funding_line}${p.pom_fy ? ` · POM FY${p.pom_fy}` : ''}`, seats.get(p.sponsor_id) ?? ADMIN, iso(at)]);
    }
  }

  /* ── 3. sponsor-owned criteria signed since the Hub went live carry the sponsor seat's name ── */
  const signed = await tx.query(`UPDATE criterion_status s SET updated_by = u.name, evidence = 'Signed in the Hub: ' || s.evidence
    FROM criterion_def d, project_org po, app_user u
    WHERE d.id = s.criterion_id AND d.owner = 'SPONSOR' AND NOT d.proposal AND s.synthetic AND s.status = 'MET' AND s.updated_at >= $1
      AND po.project_id = s.project_id AND po.role = 'SPONSOR' AND u.role = 'SPONSOR' AND u.org_id = po.org_id`, [HUB_LIVE]);

  const flag = await flagship(tx, seed, seats);
  console.log({ pathways_complete: complete, pathways_committed_with_gaps: gaps, commitments_never_made: uncommitted, sponsor_signatures_in_hub: signed.affectedRows ?? 0, flagship: flag });
}

/* ── 4. the local Gate 3 flagship (title from esh.config.local.json → demo.gate3Flagship; predecessor from demo.gate3Predecessor) ── */
async function flagship(tx: Transaction, seed: number, seats: Map<number, string>) {
  const title = config.demo?.gate3Flagship?.trim();
  if (!title) return null;
  const q = <T = any>(sql: string, p: unknown[] = []) => tx.query<T>(sql, p).then(r => r.rows);
  const p = (await q(`SELECT * FROM project WHERE lower(title) = lower($1)`, [title]))[0];
  if (!p) return `not found: ${title}`;
  const pred = config.demo?.gate3Predecessor ? (await q(`SELECT * FROM project WHERE lower(title) = lower($1)`, [config.demo.gate3Predecessor.trim()]))[0] : null;
  const sp = (await q(`SELECT o.id, o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = $1 AND po.role = 'SPONSOR' ORDER BY o.name LIMIT 1`, [p.id]))[0];
  const seat = sp ? seats.get(sp.id) ?? ADMIN : ADMIN;
  const pm = (await q(`SELECT name FROM person WHERE id = $1`, [p.pm_id]))[0]?.name ?? ADMIN;
  const defs = await q(`SELECT id, gate, ord, owner, proposal FROM criterion_def`);
  const def = (g: number, o: number) => defs.find((d: any) => d.gate === g && d.ord === o)!;
  const wipe = async (id: number) => {
    for (const t of ['gate_decision', 'phase_record', 'criterion_status', 'transition_pathway']) await tx.query(`DELETE FROM ${t} WHERE project_id = $1`, [id]);
    await tx.query(`DELETE FROM audit_event WHERE entity = 'project' AND entity_id = (SELECT esh_id FROM project WHERE id = $1) AND synthetic`, [id]);
  };
  const crit = (id: number, g: number, o: number, status: string, evidence: string, by: string, at: string) =>
    tx.query(`INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by, updated_at, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)`, [id, def(g, o).id, status, evidence, by, at]);
  const gate = (id: number, g: number, outcome: string, at: string, authority: string, rationale: string, extra: [string | null, string | null] = [null, null]) =>
    tx.query(`INSERT INTO gate_decision (project_id, gate, outcome, decided_at, authority, rationale, recorded_by, exit_reason, technical_result, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [id, g, outcome, at, authority, rationale, ADMIN, extra[0], extra[1]]);
  const phase = (id: number, ph: number, from: string, to: string | null) =>
    tx.query(`INSERT INTO phase_record (project_id, phase, entered_at, exited_at, synthetic) VALUES ($1,$2,$3,$4,true)`, [id, ph, from, to]);
  const ev = (g: number, o: number, at: string) => `Gate ${g} criterion ${o} evidence on file ${at}`;

  /* predecessor: Stage 0 and Phase I, then continued as the flagship */
  if (pred) {
    await wipe(pred.id);
    await phase(pred.id, 0, '2024-10-07', '2024-12-12'); await phase(pred.id, 1, '2024-12-12', '2025-08-21'); await phase(pred.id, 2, '2025-08-21', '2025-10-01');
    await gate(pred.id, 0, 'PASS', '2024-12-12', 'J68 R&D Portfolio Board', 'Real ITV gap confirmed with COCOM partners; DLA Troop Support signed the LOI.');
    await gate(pred.id, 1, 'PASS', '2025-08-21', 'J68 R&D Portfolio Board', 'Tamper-evident custody record proven on live shipments; value hypothesis holds on DLA data.');
    await gate(pred.id, 2, 'DESCOPE', '2025-10-01', 'J68 Director', `Continued as ${p.title} (${p.esh_id}) with the full COCOM partner set; this record closes.`, ['FOLLOW_ON', 'MET']);
    for (const [g, n, at] of [[0, 6, '2024-12-05'], [1, 5, '2025-08-14']] as const)
      for (let o = 1; o <= n; o++) await crit(pred.id, g, o, g === 0 && o === 6 ? 'WAIVED' : 'MET',
        g === 0 && o === 6 ? 'Not assessed — gate decided before J1 criteria were added to the ESF (FY26)' : ev(g, o, at), g === 0 && o === 6 ? ADMIN : pm, at);
    await tx.query(`UPDATE project SET esf_phase=2, esf_status='DESCOPED', esf_source='CONFIRMED', esf_synthetic=true, esf_reason=$2 WHERE id=$1`,
      [pred.id, `Continued as ${p.esh_id} (local demo story)`]);
  }

  /* the flagship: Phase II from FY26, Gate 2 in June 2026, ready for Gate 3 at the December DCG board */
  await wipe(p.id);
  await phase(p.id, 2, '2025-10-01', '2026-06-18'); await phase(p.id, 3, '2026-06-18', null);
  await gate(p.id, 2, 'PASS', '2026-06-18', 'J68 Director', 'Prototype met custody and security thresholds across three partner nodes; J8 certified the ROI; pathway declared.');
  for (let o = 1; o <= 6; o++) await crit(p.id, 2, o, 'MET', o === 4 ? `Signed in the Hub: ${sp?.name ?? 'Sponsor'} written reaffirmation 2026-06-02` : o === 6 ? 'CM Impact Assessment filed 2026-06-05' : ev(2, o, '2026-06-10'),
    o === 4 ? seat : o === 6 ? 'J1 Human Capital Transformation' : pm, '2026-06-10');
  const g3ev: Record<number, [string, string, string]> = {
    1: [`Signed in the Hub: SES funding commitment, ${sp?.name ?? 'sponsor'}, POM FY28 O&M`, seat, '2026-11-06'],
    2: ['Live at two distribution nodes and one COCOM partner since Sep 2026', pm, '2026-10-14'],
    3: ['J6 ATO plan approved 2026-09-30', pm, '2026-09-30'],
    4: ['J6 sandbox connectivity test passed 2026-08-21', pm, '2026-08-21'],
    5: ['OGC/J7 bridge eligibility memo 2026-10-02', pm, '2026-10-02'],
    6: ['Change management statement drafted for the DCG brief', 'J1 Human Capital Transformation', '2026-11-04'],
    7: [`Pathway committed: ${sp?.name ?? 'sponsor'} · O&M, ${sp?.name ?? 'sponsor'} — in-transit visibility sustainment line · POM FY2028`, seat, '2026-11-06'],
  };
  for (const [o, [e, by, at]] of Object.entries(g3ev)) await crit(p.id, 3, Number(o), 'MET', e, by, at);
  await tx.query(`INSERT INTO transition_pathway (project_id, path, mechanism, status, committed_at, receiver_org_id, funding_line, pom_fy, synthetic) VALUES ($1,'B_POM',$2,'COMMITTED','2026-11-06',$3,$4,2028,true)`,
    [p.id, `POM FY28 program line — ${sp?.name ?? 'sponsor'} (in-transit visibility)`, sp?.id ?? null, `O&M, ${sp?.name ?? 'sponsor'} — in-transit visibility sustainment line`]);
  await tx.query(`UPDATE project SET esf_phase=3, esf_status='ACTIVE', esf_source='CONFIRMED', esf_synthetic=true, esf_reason=$2 WHERE id=$1`,
    [p.id, pred ? `Follow-on to ${pred.esh_id}, which carried Stage 0 and Phase I (local demo story)` : 'Local demo story']);
  if (!(await q(`SELECT 1 FROM value_case WHERE project_id = $1`, [p.id])).length)
    await tx.query(`INSERT INTO value_case (project_id, path, is_primary, metric, baseline, projected, annual_value, narrative, j8_certified, synthetic) VALUES ($1,'PERFORMANCE',true,$2,$3,$4,4200000,$5,true,true)`,
      [p.id, 'Shipments with a trusted, shared custody record end to end', 'Custody records split across carriers and nodes; gaps found after the fact',
        'One tamper-evident record shared by DLA, carriers and COCOM partners', 'Fewer lost and frustrated shipments, faster discrepancy resolution, and evidence for audit.']);
  if (!(await q(`SELECT 1 FROM funding_line WHERE project_id = $1`, [p.id])).length)
    for (const [fy, app, src, amt] of [[2026, 'RDT&E BA3', 'J68 R&D', 1.4e6], [2027, 'RDT&E BA3', 'J68 R&D', 1.15e6], [2027, 'O&M', sp?.name ?? 'Sponsor', 6e5]] as const)
      await tx.query(`INSERT INTO funding_line (project_id, fy, appropriation, source, amount, synthetic) VALUES ($1,$2,$3,$4,$5,true)`, [p.id, fy, app, src, amt]);
  const board = (await q(`SELECT b.id FROM gate_board b WHERE b.status = 'SCHEDULED' AND EXISTS (SELECT 1 FROM gate_board_item i WHERE i.board_id = b.id AND i.gate = 3) ORDER BY b.board_date LIMIT 1`))[0];
  if (board) await tx.query(`INSERT INTO gate_board_item (board_id, project_id, gate, ord) VALUES ($1,$2,3,(SELECT coalesce(max(ord),0)+1 FROM gate_board_item WHERE board_id=$1)) ON CONFLICT DO NOTHING`, [board.id, p.id]);
  const audits: [string, string, string, unknown][] = [
    ['2026-06-18', ADMIN, 'GATE_DECISION', { gate: 2, outcome: 'PASS' }],
    ['2026-11-06', seat, 'CRITERION', { gate: 3, criterion: 'Signed funding commitment — SES level', status: 'MET' }],
    ['2026-11-06', seat, 'PATHWAY_ADVANCE', { status: 'COMMITTED', funding_line: 'in-transit visibility sustainment line', pom_fy: 2028 }],
  ];
  for (const [at, actor, action, after] of audits)
    await tx.query(`INSERT INTO audit_event (at, actor, entity, entity_id, action, before, after, synthetic) VALUES ($1,$2,'project',$3,$4,null,$5,true)`, [at + 'T15:00:00Z', actor, p.esh_id, action, JSON.stringify(after)]);
  const ord = (await q(`SELECT coalesce(max(ord),0)+1 n FROM demo_scenario`))[0].n;
  await tx.query(`INSERT INTO demo_scenario (ord, esh_id, title, story, look_for, track) VALUES ($1,$2,$3,$4,$5,'ESF')`, [ord, p.esh_id, 'A Gate 3 decision the enterprise owns',
    `${pred ? `Started as ${pred.esh_id}, continued as a follow-on. ` : ''}Ready for Gate 3 at the DCG board: ${sp?.name ?? 'the sponsor'} signed the SES funding commitment in the Hub and committed the transition pathway with a receiver, funding line and POM year.`,
    'Gate 3 criteria: the sponsor-signed commitment and the Hub proposal. The pathway card. The DCG board docket.']);
  return `${p.esh_id}${pred ? ` (predecessor ${pred.esh_id})` : ''} → Gate 3 ready, docketed`;
}
