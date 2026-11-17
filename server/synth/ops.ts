/* Synthetic operations data: an open data call run in the Hub, gate boards (held and scheduled),
   status on the 11 senior leader decisions, and a document record behind each piece of gate evidence. */
import type { Transaction } from '@electric-sql/pglite';
import { DOC_TYPES } from '../esfContent.js';
import { add, iso, rngFor } from './util.js';

const FIELDS = ['status_code', 'pop_start', 'pop_end', 'transition_phase', 'transition_type', 'description', 'charter'] as const;
const d = (v: any) => (v instanceof Date ? iso(v) : v ?? null);

export async function removeOps(tx: Transaction) {
  await tx.exec(`DELETE FROM document WHERE synthetic; DELETE FROM senior_decision WHERE synthetic; DELETE FROM gate_board WHERE synthetic;
    DELETE FROM data_call_response WHERE synthetic;
    DELETE FROM project_snapshot WHERE fy IN (SELECT fy FROM data_call WHERE synthetic);
    DELETE FROM data_call_response WHERE fy IN (SELECT fy FROM data_call WHERE synthetic);
    DELETE FROM data_call WHERE synthetic;`);
}

export async function seedOps(tx: Transaction, seed: number, asOf: Date) {
  const latest = (await tx.query<{ fy: number }>(`SELECT max(fy) fy FROM data_call WHERE status = 'CLOSED'`)).rows[0].fy;

  /* ── 1. FY+1 data call, open in the Hub ── */
  const fy = latest + 1, opens = new Date(Date.UTC(asOf.getUTCFullYear(), 9, 15)), due = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 15));
  await tx.query(`INSERT INTO data_call (fy, name, status, opens_at, due_at, source, synthetic) VALUES ($1,$2,'OPEN',$3,$4,'HUB',true)`, [fy, `FY${fy} R&D alignment data call`, iso(opens), iso(due)]);
  const live = (await tx.query<any>(`SELECT p.id, p.esh_id, p.pm_id, pe.name pm, ${FIELDS.map(f => 'p.' + f).join(', ')} FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
    WHERE p.esf_status IN ('ACTIVE','HOLD','AT_SCALE') AND p.id IN (SELECT project_id FROM project_snapshot WHERE fy = $1)`, [latest])).rows;
  const pmPace = new Map<string, number>();
  let n = 0;
  for (const p of live) {
    const r = rngFor(seed, 'dc:' + p.esh_id);
    const pmKey = p.pm ?? '-';
    if (!pmPace.has(pmKey)) pmPace.set(pmKey, rngFor(seed, 'pace:' + pmKey).between(0.15, 0.95));   // some PMs are quicker than others
    const pace = pmPace.get(pmKey)!, x = r.next();
    const status = x < pace * 0.35 ? 'APPROVED' : x < pace * 0.7 ? 'SUBMITTED' : x < pace * 0.75 ? 'RETURNED' : x < pace + 0.12 ? 'IN_PROGRESS' : 'NOT_STARTED';
    const baseline = Object.fromEntries(FIELDS.map(f => [f, d(p[f])]));
    const payload: Record<string, unknown> = { ...baseline };
    if (status !== 'NOT_STARTED') {
      const end = p.pop_end ? new Date(p.pop_end) : null;
      if (end && end < asOf && ['A', 'B'].includes(p.status_code)) {   // the data-call hygiene fix the dashboard flags
        if (r.chance(0.55)) payload.pop_end = iso(add(end, r.int(180, 540))); else payload.status_code = r.pick(['D', 'E']);
      }
      if (p.status_code === 'A' && r.chance(0.7)) payload.status_code = 'B';
      if (r.chance(0.2)) payload.transition_phase = r.pick(['In Development', 'Complete']);
    }
    const touched = add(opens, r.between(2, (asOf.getTime() - opens.getTime()) / 864e5 - 1));
    await tx.query(`INSERT INTO data_call_response (fy, project_id, status, payload, baseline, note, updated_by, updated_at, submitted_at, reviewed_by, reviewed_at, synthetic)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
      [fy, p.id, status, JSON.stringify(payload), JSON.stringify(baseline),
        status === 'RETURNED' ? r.pick(['PoP end date conflicts with the contract record — please confirm with J7.', 'Status says Ongoing but the contract has ended. Update status or the new PoP.', 'Transition type missing — name the transition partner.']) : null,
        status === 'NOT_STARTED' ? null : p.pm ?? 'J68 Portfolio Admin', status === 'NOT_STARTED' ? null : touched.toISOString(),
        ['SUBMITTED', 'APPROVED', 'RETURNED'].includes(status) ? touched.toISOString() : null,
        ['APPROVED', 'RETURNED'].includes(status) ? 'J68 Portfolio Admin' : null,
        ['APPROVED', 'RETURNED'].includes(status) ? add(touched, r.between(1, 6)).toISOString() : null]);
    n++;
  }

  /* ── 2. gate boards: one per month and authority for the last 6 months, plus the next two scheduled ── */
  const decisions = (await tx.query<any>(`SELECT g.project_id, g.gate, g.outcome, g.decided_at, g.rationale FROM gate_decision g
    WHERE g.synthetic AND g.decided_at > $1::date ORDER BY g.decided_at`, [iso(add(asOf, -183))])).rows;
  const groups = new Map<string, any[]>();
  for (const x of decisions) {
    const dt = new Date(x.decided_at), kind = x.gate >= 3 ? 'DCG' : 'J68';
    const k = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}:${kind}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  let boards = 0;
  for (const [k, items] of [...groups.entries()].sort()) {
    const [ym, kind] = k.split(':'), r = rngFor(seed, 'board:' + k);
    // the standing board day, but never after today for a board that has already been held
    const date = new Date(Math.min(new Date(`${ym}-${kind === 'DCG' ? '22' : '14'}T00:00:00Z`).getTime(), add(asOf, -1).getTime()));
    const tally = (o: string) => items.filter(i => i.outcome === o).length;
    const minutes = `${items.length} project${items.length === 1 ? '' : 's'} reviewed. ${tally('PASS')} passed, ${tally('HOLD')} held, ${tally('SUNSET') + tally('DESCOPE')} stopped. ` +
      (tally('HOLD') ? 'Holds are awaiting non-waivable criteria; owners named in the actions below. ' : '') + 'Next board scheduled per the standing calendar.';
    const id = (await tx.query<{ id: number }>(`INSERT INTO gate_board (title, board_date, authority, location, status, minutes, synthetic) VALUES ($1,$2,$3,$4,'HELD',$5,true) RETURNING id`,
      [`${kind === 'DCG' ? 'DCG Senior Investment Review' : 'J68 Portfolio Review Board'} — ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        iso(date), kind === 'DCG' ? 'Gate Authority (DCG)' : 'J68 Director', kind === 'DCG' ? 'HQ DLA, McNamara Headquarters Complex' : 'J68 conference room / Teams', minutes])).rows[0].id;
    for (const [i, x] of items.entries()) {
      await tx.query(`INSERT INTO gate_board_item (board_id, project_id, gate, ord, outcome, note) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [id, x.project_id, x.gate, i + 1, x.outcome, x.rationale]);
      if (x.outcome === 'HOLD') await tx.query(`INSERT INTO gate_board_action (board_id, project_id, text, owner, due, done) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, x.project_id, 'Close the outstanding non-waivable criterion and return to the board', r.pick(['Co-sponsor (SES)', 'J8 Finance', 'Program manager']), iso(add(date, 45)), add(date, 45) < asOf && r.chance(0.5)]);
    }
    if (r.chance(0.6)) await tx.query(`INSERT INTO gate_board_action (board_id, text, owner, due, done) VALUES ($1,$2,$3,$4,$5)`,
      [id, r.pick(['Circulate updated Gate 3 commitment template to co-sponsors', 'Confirm POM window dates with J8 for Path B projects', 'Brief J6 on ATO pipeline for projects entering Phase III']), 'J68 Portfolio Admin', iso(add(date, 30)), add(date, 30) < asOf]);
    boards++;
  }
  const ready = (await tx.query<any>(`SELECT p.id, LEAST(p.esf_phase, 4) gate FROM project p
    WHERE p.esf_status = 'ACTIVE' AND p.esf_source = 'CONFIRMED' AND p.esf_phase < 5 AND NOT EXISTS (
      SELECT 1 FROM criterion_def dd LEFT JOIN criterion_status s ON s.criterion_id = dd.id AND s.project_id = p.id
      WHERE dd.gate = LEAST(p.esf_phase, 4) AND (s.status IS NULL OR s.status = 'PENDING' OR (dd.non_waivable AND s.status <> 'MET')))`)).rows;
  for (const [kind, gates, offset] of [['J68', [0, 1, 2], 7], ['DCG', [3, 4], 21]] as const) {
    const date = add(asOf, offset);
    const id = (await tx.query<{ id: number }>(`INSERT INTO gate_board (title, board_date, authority, location, status, synthetic) VALUES ($1,$2,$3,$4,'SCHEDULED',true) RETURNING id`,
      [`${kind === 'DCG' ? 'DCG Senior Investment Review' : 'J68 Portfolio Review Board'} — ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
        iso(date), kind === 'DCG' ? 'Gate Authority (DCG)' : 'J68 Director', kind === 'DCG' ? 'HQ DLA, McNamara Headquarters Complex' : 'J68 conference room / Teams'])).rows[0].id;
    const items = ready.filter((x: any) => (gates as readonly number[]).includes(x.gate));
    for (const [i, x] of items.entries()) await tx.query(`INSERT INTO gate_board_item (board_id, project_id, gate, ord) VALUES ($1,$2,$3,$4)`, [id, x.id, x.gate, i + 1]);
    boards++;
  }

  /* ── 3. senior leader decisions: where each one stands ── */
  const st: [number, string, string, string | null, string | null, string | null][] = [
    [1, 'DECIDED', 'DLA Deputy Director', 'B', '2026-08-20', 'J68 keeps Gates 0–2; a cross-directorate Senior Investment Review Board, chaired by the DCG, governs Gates 3–4.'],
    [2, 'IN_REVIEW', "DLA Director's office", null, null, 'Draft charter memo in staffing; J68 operating under Option B until signed.'],
    [3, 'IN_REVIEW', 'DLA OGC', null, null, 'OGC reviewing a standard commitment instrument; opinion expected Q2 FY27.'],
    [4, 'OPEN', 'J8 Finance', null, null, null],
    [5, 'DECIDED', 'DLA OGC + J8 Finance', 'A', '2026-06-30', 'Phase III bridge limited to RDT&E-eligible integration and validation, capped at 12 months; operational costs move to co-funding.'],
    [6, 'OPEN', 'J68 Director', null, null, null],
    [7, 'IN_REVIEW', 'DLA Deputy Director', null, null, 'Option A (10–20% Phase II cost-share) under discussion with MSC commanders.'],
    [8, 'DEFERRED', 'J68 Director', null, null, 'Deferred until the first cohort reaches Gate 4.'],
    [9, 'DECIDED', 'J6 CIO', 'A', '2026-09-15', 'J6 joins as a required participant from Gate 1; no Phase III entry without an approved ATO plan.'],
    [10, 'DECIDED', 'DLA Deputy Director', 'C', '2026-07-10', 'Tiered rollout: existing projects at their next natural gate, plus all new intake.'],
    [11, 'OPEN', 'J68 Director', null, null, null],
  ];
  for (const [ord, status, owner, opt, at, why] of st)   // a decision someone has already recorded for real is left alone
    await tx.query(`INSERT INTO senior_decision (ord, status, owner, due, decided_option, decided_at, rationale, updated_by, updated_at, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,'J68 Portfolio Admin',now(),true) ON CONFLICT (ord) DO NOTHING`,
      [ord, status, owner, status === 'DECIDED' ? null : iso(add(asOf, 30 + ord * 9)), opt, at, why]);

  /* ── 4. a document record behind each piece of gate evidence ── */
  const byCrit = new Map<string, string>();
  for (const [k, v] of Object.entries(DOC_TYPES)) for (const [g, o] of v.crit) byCrit.set(`${g}:${o}`, k);
  const ev = (await tx.query<any>(`SELECT s.project_id, s.criterion_id, s.evidence, s.updated_by, s.updated_at, dd.gate, dd.ord, p.esh_id
    FROM criterion_status s JOIN criterion_def dd ON dd.id = s.criterion_id JOIN project p ON p.id = s.project_id WHERE s.synthetic AND s.status = 'MET'`)).rows;
  let docs = 0;
  for (const e of ev) {
    const type = byCrit.get(`${e.gate}:${e.ord}`); if (!type) continue;
    const r = rngFor(seed, `doc:${e.project_id}:${e.criterion_id}`);
    if (r.chance(0.11)) continue;   // evidence cited on the scorecard but the file never filed — what the completeness check exists to catch
    await tx.query(`INSERT INTO document (project_id, doc_type, title, criterion_id, file_name, mime, size, uploaded_by, uploaded_at, synthetic) VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,$8,true)`,
      [e.project_id, type, e.evidence ?? DOC_TYPES[type].l, e.criterion_id, `${e.esh_id}_${type}.pdf`, r.int(80e3, 2.4e6), e.updated_by, e.updated_at]);
    docs++;
  }
  console.log(`Ops: FY${fy} data call with ${n} responses, ${boards} gate boards, 11 senior decisions, ${docs} documents.`);
}
