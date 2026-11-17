/* Import the DLA R&D master project workbook (2025–2027 lists + alignments) into ESH.
   Usage:  npm run import            (refuses if data already exists)
           npm run import -- --reset (wipes ALL ESH data, including ESF edits, and re-imports) */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, closeDb, syncReference } from '../db/db.js';
import { config, ROOT, AS_OF } from '../config.js';
import { loadWorkbook, type Sheet } from './workbook.js';
import {
  ELEMENTS, PROGRAMS, ORG_SEEDS, NULLISH, orgKey, jcode, splitOrgs, programCode, elementCode,
  parsePriorityHeader, statusCode, suggestPhase, personName,
} from '../domain.js';

const reset = process.argv.includes('--reset');
const titleKey = (t: string) => t.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s: string | undefined) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t && !NULLISH.has(t.toLowerCase()) ? t : null; };
const yn = (s: string | undefined) => { const t = (s ?? '').trim().toLowerCase(); return t === 'yes' || t === 'y' ? true : t === 'no' || t === 'n' ? false : null; };
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type Fields = ReturnType<typeof fieldMap>;
function fieldMap(sheet: Sheet, fy: number) {
  const keys = sheet.headers.map(h => h.key);
  const find = (...tests: (string | RegExp)[]) => keys.find(k => tests.some(t => (typeof t === 'string' ? k === t : t.test(k)))) ?? null;
  return {
    pm: find(/^programmanager/),
    element: fy === 2025 ? find('programname') : find('element'),   // 2025 sheet has these two columns swapped
    program: fy === 2025 ? find('element') : find('program', 'column1'),
    title: find(/^projecttitle/),
    desc: find(/^projectdescription/),
    it: find('it', /^itcapability/),
    artet: find('inartet'),
    spm: find(/^spmnumber/),
    cats: find('catsid'),
    sponsor: find(/^sponsor/),
    bpo: find(/^mscjcodebusinessprocessowner/),
    environment: find('environment'),
    stakeholders: find(/^stakeholders/),
    charter: find(/^chartername/),
    contract: find(/^contractnumber/),
    status: find('projectstatus', 'active'),
    popStart: find(/^popstart/),
    popEnd: find(/^popend/),
    okrs: find(/^okrs?$/),
    academia: find(/^academiapartners/),
    military: find(/^militaryservicespartners/),
    osdmii: find(/^osdmii/),
    vendor: find(/^primaryvendor/),
    transitionPhase: find('transitionphase'),
    transitionType: find('transitiontype'),
    transitionPartner: find('transitionpartner'),
    dbx: find(/^dbxmodernization/),
    taxonomy: find('taxonomy'),
    capability: find('capability'),
  };
}

async function main() {
  const db = await getDb();
  const existing = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM project')).rows[0].n;
  if (existing > 0 && !reset) {
    console.error(`ESH already holds ${existing} projects. Re-run with --reset to wipe and re-import (this also erases ESF triage, gates and audit history).`);
    process.exit(1);
  }

  const listSheets = Object.entries(config.sheets.lists).map(([fy, name]) => ({ fy: +fy, name })).sort((a, b) => a.fy - b.fy);
  const alignSheets = Object.entries(config.sheets.alignments).map(([fy, name]) => ({ fy: +fy, name })).sort((a, b) => a.fy - b.fy);
  console.log('Reading workbook…');
  const wb = await loadWorkbook(config.workbook, [...listSheets.map(s => s.name), ...alignSheets.map(s => s.name)]);

  const report: Record<string, unknown> = { source: config.workbook, years: {} as Record<number, unknown> };
  const newOrgs = new Map<string, number>();
  const issues: { fy: number; sheet: string; row: number; issue: string }[] = [];

  await db.transaction(async tx => {
    if (reset) {
      await tx.exec(`TRUNCATE project_link, realization_action, realization_review, value_snapshot, benefit_measure, benefit_baseline, document, senior_decision, gate_board_action, gate_board_item, gate_board, data_call_response, project_fill, project_contact, org_person, project_sponsor_leader, leader_readiness, senior_leader, adoption_measure, workforce_impact,
        demo_scenario, audit_event, import_run, app_user, transition_pathway, value_case, funding_line, criterion_status,
        criterion_def, gate_decision, phase_record, project_priority, priority, project_snapshot, data_call, project_org,
        project_contract, project_external_id, project, person, org_alias, org, program, element RESTART IDENTITY CASCADE`);
    }

    /* reference data */
    for (const [code, name] of Object.entries(ELEMENTS)) await tx.query('INSERT INTO element VALUES ($1,$2)', [code, name]);
    await syncReference(tx);   // gate criteria, including J1's
    for (const s of listSheets) await tx.query('INSERT INTO data_call (fy, name, status) VALUES ($1,$2,$3)', [s.fy, `FY${s.fy} R&D alignment data call`, 'CLOSED']);

    const aliasToOrg = new Map<string, number>();
    for (const o of ORG_SEEDS) {
      const id = (await tx.query<{ id: number }>('INSERT INTO org (name, kind) VALUES ($1,$2) RETURNING id', [o.name, o.kind])).rows[0].id;
      for (const a of [o.name, ...o.aliases]) aliasToOrg.set(orgKey(a), id);
    }
    const orgId = async (raw: string): Promise<number> => {
      const k = orgKey(raw);
      if (aliasToOrg.has(k)) { await tx.query('INSERT INTO org_alias VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [k, raw, aliasToOrg.get(k)]); return aliasToOrg.get(k)!; }
      const jc = jcode(raw);
      const name = jc ?? raw;
      const kind = jc ? 'DLA_JCODE' : /universit|college|institute|school of/i.test(raw) ? 'ACADEMIA' : /^dla\b/i.test(raw) ? 'DLA_MSC'
        : /\b(inc|llc|corp|corporation|ltd|technolog|systems|solutions|labs?)\b/i.test(raw) ? 'INDUSTRY' : 'OTHER';
      let id = (await tx.query<{ id: number }>('SELECT id FROM org WHERE name = $1', [name])).rows[0]?.id;
      if (!id) {
        id = (await tx.query<{ id: number }>('INSERT INTO org (name, kind) VALUES ($1,$2) RETURNING id', [name, kind])).rows[0].id;
        if (!jc) newOrgs.set(name, 0);
      }
      aliasToOrg.set(k, id);
      await tx.query('INSERT INTO org_alias VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [k, raw, id]);
      return id;
    };
    const linkOrgs = async (pid: number, cell: string | undefined, role: string) => {
      for (const name of splitOrgs(cell ?? null)) {
        const id = await orgId(name);
        if (newOrgs.has(name)) newOrgs.set(name, newOrgs.get(name)! + 1);
        await tx.query('INSERT INTO project_org VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, id, role]);
      }
    };

    const ensureProgram = async (code: string, element: string | null) => {
      await tx.query(`INSERT INTO program (code, name, element_code) VALUES ($1,$2,$3)
        ON CONFLICT (code) DO UPDATE SET element_code = COALESCE(program.element_code, EXCLUDED.element_code)`,
        [code, PROGRAMS[code] ?? code, element && ELEMENTS[element] ? element : null]);
    };
    const personId = async (name: string | null) => {
      if (!name) return null;
      return (await tx.query<{ id: number }>('INSERT INTO person (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id', [name])).rows[0].id;
    };

    /* project lists, oldest year first so the latest data call wins */
    let seq = 0;
    for (const { fy, name } of listSheets) {
      const sheet = wb[name];
      const f = fieldMap(sheet, fy);
      const matchedThisYear = new Set<number>();
      let created = 0, matched = 0, skipped = 0;
      for (const row of sheet.rows) {
        const get = (k: keyof Fields) => (f[k] ? row.cells[f[k]!] : '');
        const date = (k: keyof Fields) => (f[k] ? row.dates[f[k]!] : null);
        const title = clean(get('title'));
        if (!title) { skipped++; issues.push({ fy, sheet: name, row: row.rowNumber, issue: 'no project title — row skipped' }); continue; }
        const tkey = titleKey(title);
        const el = elementCode(clean(get('element')));
        const prog = programCode(clean(get('program')));
        if (prog) await ensureProgram(prog, el);
        if (el && !ELEMENTS[el]) issues.push({ fy, sheet: name, row: row.rowNumber, issue: `unknown element "${el}"` });
        const pm = await personId(personName(clean(get('pm'))));
        const st = statusCode(clean(get('status')));
        if (!st) issues.push({ fy, sheet: name, row: row.rowNumber, issue: `no/unknown status "${get('status')}"` });

        const cand = (await tx.query<{ id: number }>('SELECT id FROM project WHERE title_key = $1 ORDER BY id', [tkey])).rows.find(r => !matchedThisYear.has(r.id));
        const vals = {
          title, description: clean(get('desc')), element_code: el && ELEMENTS[el] ? el : null, program_code: prog, pm_id: pm,
          is_it: yn(get('it')), in_artet: yn(get('artet')), environment: clean(get('environment')), charter: clean(get('charter')),
          status_code: st, pop_start: iso(date('popStart')), pop_end: iso(date('popEnd')), okrs: clean(get('okrs')),
          transition_phase: clean(get('transitionPhase')), transition_type: clean(get('transitionType')),
          dbx_type: clean(get('dbx')), taxonomy: clean(get('taxonomy')), capability: clean(get('capability')),
        };
        let pid: number;
        if (cand) {
          pid = cand.id; matched++;
          // latest year wins, but never overwrite a known value with a blank
          const sets = Object.keys(vals).map((k, i) => `${k} = COALESCE($${i + 2}, ${k})`).join(', ');
          await tx.query(`UPDATE project SET ${sets}, last_fy = $${Object.keys(vals).length + 2} WHERE id = $1`, [pid, ...Object.values(vals), fy]);
        } else {
          created++;
          const esh = 'ESH-' + String(++seq).padStart(4, '0');
          const cols = ['esh_id', 'title_key', 'first_fy', 'last_fy', ...Object.keys(vals)];
          pid = (await tx.query<{ id: number }>(
            `INSERT INTO project (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`,
            [esh, tkey, fy, fy, ...Object.values(vals)])).rows[0].id;
        }
        matchedThisYear.add(pid);

        await tx.query(`INSERT INTO project_snapshot (project_id, fy, source_sheet, source_row, status_code, transition_phase, pm_name, raw)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [pid, fy, name, row.rowNumber, st, vals.transition_phase, clean(get('pm')), JSON.stringify(row.raw)]);

        // drop "N/A"-style cells before splitting on "/", and keep only tokens that look like contract numbers (contain a digit)
        const contractCell = (get('contract') ?? '').trim();
        if (!NULLISH.has(contractCell.toLowerCase())) for (const c of contractCell.split(/[\/,;\n]|\s+and\s+/i).map(s => s.trim()).filter(s => s && /\d/.test(s) && !NULLISH.has(s.toLowerCase())))
          await tx.query('INSERT INTO project_contract VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, c]);
        for (const m of (get('spm') ?? '').match(/\b[A-Z]{2,8}\d{5,}\b/gi) ?? [])
          await tx.query('INSERT INTO project_external_id VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, 'SPM', m.toUpperCase()]);
        const cats = clean(get('cats'));
        if (cats) await tx.query('INSERT INTO project_external_id VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, 'CATS', cats]);

        await linkOrgs(pid, get('sponsor'), 'SPONSOR');
        await linkOrgs(pid, get('bpo'), 'SPONSOR');
        await linkOrgs(pid, get('stakeholders'), 'STAKEHOLDER');
        await linkOrgs(pid, get('transitionPartner'), 'TRANSITION_PARTNER');
        await linkOrgs(pid, get('academia'), 'ACADEMIA');
        await linkOrgs(pid, get('military'), 'MILITARY');
        if (!/^in development$/i.test(get('osdmii') ?? '')) await linkOrgs(pid, get('osdmii'), 'OSD_MII');
        await linkOrgs(pid, get('vendor'), 'VENDOR');
      }
      (report.years as Record<number, unknown>)[fy] = { sheet: name, rows: sheet.rows.length, created, matchedPriorYear: matched, skipped,
        unmappedHeaders: sheet.headers.filter(h => !Object.values(f).includes(h.key)).map(h => h.raw) };
      console.log(`FY${fy}: ${sheet.rows.length} rows → ${created} new, ${matched} matched to earlier years, ${skipped} skipped`);
    }

    /* priority alignment */
    const alignReport: Record<number, unknown> = {};
    for (const { fy, name } of alignSheets) {
      const sheet = wb[name];
      const pcols: { key: string; id: number }[] = [];
      let ord = 0;
      for (const h of sheet.headers) {
        const p = parsePriorityHeader(h.raw);
        if (!p) continue;
        const id = (await tx.query<{ id: number }>('INSERT INTO priority (fy, owner, label, raw_header, ord) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fy, raw_header) DO UPDATE SET ord = EXCLUDED.ord RETURNING id',
          [fy, p.owner, p.label, h.raw, ++ord])).rows[0].id;
        pcols.push({ key: h.key, id });
      }
      const titleCol = sheet.headers.find(h => /^projecttitle/.test(h.key))!.key;
      const used = new Set<number>();
      let linked = 0, unmatched: string[] = [], marks = 0;
      for (const row of sheet.rows) {
        const t = clean(row.cells[titleCol]);
        if (!t) continue;
        const cands = (await tx.query<{ id: number }>(
          'SELECT p.id FROM project p JOIN project_snapshot s ON s.project_id = p.id AND s.fy = $2 WHERE p.title_key = $1 ORDER BY p.id', [titleKey(t), fy])).rows;
        const any = cands.length ? cands : (await tx.query<{ id: number }>('SELECT id FROM project WHERE title_key = $1 ORDER BY id', [titleKey(t)])).rows;
        const hit = any.find(r => !used.has(r.id));
        if (!hit) { unmatched.push(t); continue; }
        used.add(hit.id); linked++;
        for (const c of pcols) if (row.cells[c.key]?.trim()) {
          marks++;
          await tx.query('INSERT INTO project_priority VALUES ($1,$2) ON CONFLICT DO NOTHING', [hit.id, c.id]);
        }
      }
      alignReport[fy] = { sheet: name, priorities: pcols.length, rows: sheet.rows.length, linked, marks, unmatched };
      console.log(`FY${fy} alignment: ${pcols.length} priorities, ${linked} rows linked, ${marks} marks, ${unmatched.length} unmatched titles`);
    }
    report.alignment = alignReport;

    /* ESF phase suggestion */
    const projects = (await tx.query<{ id: number; status_code: string | null; transition_phase: string | null; transition_type: string | null; title: string; element_code: string | null; pop_start: Date | null; pop_end: Date | null; first_fy: number }>(
      'SELECT id, status_code, transition_phase, transition_type, title, element_code, pop_start, pop_end, first_fy FROM project')).rows;
    const tally: Record<string, number> = {};
    for (const p of projects) {
      const s = suggestPhase(p, AS_OF);
      tally[`${s.status}:${s.phase}`] = (tally[`${s.status}:${s.phase}`] ?? 0) + 1;
      await tx.query('UPDATE project SET esf_phase=$2, esf_status=$3, esf_source=$4, esf_reason=$5 WHERE id=$1', [p.id, s.phase, s.status, 'SUGGESTED', s.reason]);
      const entered = p.pop_start ?? new Date(Date.UTC(p.first_fy - 1, 9, 1));
      await tx.query('INSERT INTO phase_record (project_id, phase, entered_at, exited_at) VALUES ($1,$2,$3,$4)',
        [p.id, s.phase, iso(entered), s.status === 'ACTIVE' || s.status === 'HOLD' || s.status === 'AT_SCALE' ? null : iso(p.pop_end)]);
    }
    report.esfSuggestion = tally;

    /* demo users (stand-in for IdP groups) */
    await tx.query(`INSERT INTO app_user (name, role) VALUES ('J68 Portfolio Admin','ADMIN'), ('Gate Authority (DCG)','AUTHORITY'), ('J1 Human Capital Transformation','J1'), ('Read-only Viewer','VIEWER')`);
    await tx.query(`INSERT INTO app_user (name, role, person_id)
      SELECT DISTINCT pe.name, 'PM', pe.id FROM person pe JOIN project p ON p.pm_id = pe.id ORDER BY pe.name`);

    await tx.query("INSERT INTO audit_event (actor, entity, entity_id, action, after) VALUES ('importer','import','*','IMPORT',$1)",
      [JSON.stringify({ projects: projects.length, source: config.workbook })]);

    report.newOrgsNotInSeedList = [...newOrgs.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ name: n, uses: c }));
    report.issues = issues;
    report.totals = {
      projects: projects.length,
      orgs: (await tx.query<{ n: number }>('SELECT count(*)::int n FROM org')).rows[0].n,
      people: (await tx.query<{ n: number }>('SELECT count(*)::int n FROM person')).rows[0].n,
      contracts: (await tx.query<{ n: number }>('SELECT count(*)::int n FROM project_contract')).rows[0].n,
    };
    await tx.query('INSERT INTO import_run (source, report) VALUES ($1,$2)', [config.workbook, JSON.stringify(report)]);
  });

  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  writeFileSync(resolve(ROOT, 'data/import-report.json'), JSON.stringify(report, null, 2));
  console.log('Totals:', report.totals, '\nESF suggestions:', report.esfSuggestion, `\nIssues: ${issues.length} · new orgs to review: ${newOrgs.size}`);
  console.log('Full report: data/import-report.json');
  await closeDb();
}

main().catch(async e => { console.error(e); await closeDb(); process.exit(1); });
