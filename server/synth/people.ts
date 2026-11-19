/* Synthetic J1 workforce & change layer and organization contacts, built on top of the (real + synthetic) lifecycle data.

   - Workforce impact: who each change reaches (org × occupational series), training timing, union notice, go-live
   - Adoption after go-live (30 / 90 / 180 days)
   - Senior leader readiness by Kotter's 8 Accelerators, stored per assessment but only ever shown in aggregate
   - R&D focal points (1–5 declared POCs per DLA organization) and project POCs for sponsors, co-sponsors and transition partners

   People here are invented: names are drawn from common-name lists, emails use the reserved .example domain and
   phone numbers the fictional 555-01xx range. Every row is flagged synthetic. */
import type { Transaction } from '@electric-sql/pglite';
import { add, iso, rngFor, type R } from './util.js';

const SERIES: Record<string, string> = {
  '2010': 'Inventory Management Specialist', '2005': 'Supply Technician', '0346': 'Logistics Management Specialist', '1102': 'Contract Specialist',
  '2210': 'IT Specialist', '0343': 'Management and Program Analyst', '1515': 'Operations Research Analyst', '1910': 'Quality Assurance Specialist',
  '0801': 'General Engineer', '1550': 'Computer Scientist',
};
const MSCS = ['DLA Aviation', 'DLA Land & Maritime', 'DLA Troop Support', 'DLA Distribution', 'DLA Energy', 'DLA Disposition Services'];
const AI = /gen ?ai|\bllm\b|language model|machine learning|\bai\b|artificial intelligence|chatbot|\bnlp\b/i;
function seriesFor(title: string): string[] {
  if (AI.test(title)) return ['0343', '2010', '1102'];
  if (/inventory|supply|warehouse|distribut|requisition|stock|demand|forecast|parts/i.test(title)) return ['2010', '2005'];
  if (/contract|procure|acquisition|purchas|vendor|sourcing|solicit/i.test(title)) return ['1102'];
  if (/data|analytic|automat|digital|software|cyber|cloud|dashboard|model/i.test(title)) return ['0343', '2210'];
  if (/additive|manufactur|casting|forg|weld|quality|inspect|test|batter|microcircuit/i.test(title)) return ['1910', '0801'];
  if (/fuel|energy/i.test(title)) return ['0346'];
  if (/workforce|training|toolkit|skill/i.test(title)) return ['0346', '1910'];
  return ['0346'];
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* invented people */
const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer', 'William', 'Elizabeth', 'Richard', 'Barbara', 'Joseph', 'Susan', 'Thomas',
  'Jessica', 'Christopher', 'Sarah', 'Daniel', 'Karen', 'Matthew', 'Nancy', 'Anthony', 'Lisa', 'Mark', 'Angela', 'Steven', 'Michelle', 'Andrew', 'Kimberly', 'Kevin',
  'Denise', 'Brian', 'Tanya', 'Jorge', 'Mei', 'Rahul', 'Aisha', 'Carlos', 'Nicole', 'Terrence', 'Priya', 'Gregory', 'Monica', 'Dwayne', 'Rosa', 'Hiroshi', 'Keisha'];
const LAST = ['Alvarez', 'Bennett', 'Coleman', 'Dawson', 'Ellison', 'Fletcher', 'Garrison', 'Holloway', 'Iverson', 'Jennings', 'Kowalski', 'Lindqvist', 'Mendoza', 'Nakamura',
  'Okafor', 'Patel', 'Quinlan', 'Ramirez', 'Sorensen', 'Thibodeaux', 'Underwood', 'Vasquez', 'Whitaker', 'Yamamoto', 'Zielinski', 'Abernathy', 'Brennan', 'Castellano',
  'Delgado', 'Eastman', 'Faulkner', 'Gallagher', 'Hargrove', 'Ingram', 'Jaworski', 'Kimura', 'Lockhart', 'McAllister', 'Nguyen', 'Osei', 'Pruitt', 'Reyes', 'Stanton', 'Tran'];
const AREA = ['571', '703', '804', '614', '215', '717', '269', '801', '910', '559'];
const slug = (s: string) => s.toLowerCase().replace(/^dla\s+/, 'dla-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const OFFICE_DLA = ['Strategic Plans & Programs', 'Innovation Office', 'Business Process Support', 'Engineering & Technical Support', 'Customer Operations', 'Supply Chain Integration'];

type Impact = { pid: number; org: string; series: string; headcount: number; change: 'NEW_TOOL' | 'PROCESS' | 'ROLE_REDESIGN'; course: string; tpct: number; timing: string; union: string; go: Date | null };

export async function removePeople(tx: Transaction) {
  await tx.exec(`DELETE FROM project_contact WHERE synthetic; DELETE FROM org_person WHERE synthetic;
    DELETE FROM project_sponsor_leader WHERE leader_id IN (SELECT id FROM senior_leader WHERE synthetic);
    DELETE FROM senior_leader WHERE synthetic; DELETE FROM adoption_measure WHERE synthetic; DELETE FROM workforce_impact WHERE synthetic; DELETE FROM change_screen WHERE synthetic;`);
}

export async function seedPeople(tx: Transaction, seed: number, asOf: Date, scenarioIds: Set<number>) {
  const projects = (await tx.query<any>(`
    SELECT p.id, p.esh_id, p.title, p.esf_phase, p.esf_status,
      (SELECT o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR'
         AND o.kind IN ('DLA_MSC','DLA_JCODE') AND o.name NOT ILIKE '%J68%' ORDER BY (o.kind = 'DLA_MSC') DESC, o.name LIMIT 1) sponsor,
      (SELECT max(entered_at) FROM phase_record r WHERE r.project_id = p.id AND r.phase = 5) scale_at
    FROM project p
    WHERE p.esf_status IN ('ACTIVE','HOLD','AT_SCALE')
      AND p.id IN (SELECT project_id FROM project_snapshot WHERE fy >= (SELECT max(fy) - 1 FROM data_call WHERE status = 'CLOSED'))
    ORDER BY p.esh_id`)).rows;
  // the J1 walkthrough project is the one run.ts scripted as the J1 scenario
  const flagshipEsh = (await tx.query<{ esh_id: string }>(`SELECT esh_id FROM demo_scenario WHERE track = 'J1' ORDER BY ord LIMIT 1`)).rows[0]?.esh_id;
  const flagship = projects.find(p => p.esh_id === flagshipEsh);

  /* ── 1. workforce impact (who the change reaches) ── */
  const impacts: Impact[] = [];
  for (const p of projects) {
    const phase = p.esf_phase ?? 0;
    if (phase < 2) continue;
    const r = rngFor(seed, 'impact:' + p.esh_id);
    if (p.id !== flagship?.id && !scenarioIds.has(p.id) && !r.chance(0.75)) continue;
    const go = phase === 5 ? (p.scale_at ? new Date(p.scale_at) : null) : add(asOf, phase === 2 ? r.between(180, 450) : phase === 3 ? r.between(45, 270) : r.between(20, 180));
    const sers = seriesFor(p.title);
    const rows: { org: string; series: string; hc: number }[] = p.id === flagship?.id
      ? [{ org: 'DLA enterprise (all MSCs)', series: '0343', hc: 1850 }, { org: 'DLA enterprise (all MSCs)', series: '2010', hc: 2400 }, { org: 'DLA enterprise (all MSCs)', series: '1102', hc: 1100 }, { org: 'DLA J6', series: '2210', hc: 140 }]
      : sers.slice(0, r.int(1, Math.min(2, sers.length))).map(series => ({ org: p.sponsor ?? r.pick(MSCS), series, hc: Math.round(Math.exp(r.between(Math.log(6), Math.log(700)))) }));
    for (const x of rows) {
      const change = AI.test(p.title) || /tool|software|app\b|digital|platform|dashboard/i.test(p.title) ? 'NEW_TOOL'
        : (x.series === '2010' || x.series === '2005') && x.hc > 100 && r.chance(0.35) ? 'ROLE_REDESIGN'
        : /process|workflow|automat|moderniz/i.test(p.title) ? 'PROCESS' : r.pick(['NEW_TOOL', 'PROCESS'] as const);
      const timing = phase === 5 ? r.pick(['BEFORE_GO_LIVE', 'BEFORE_GO_LIVE', 'AT_GO_LIVE', 'AFTER_GO_LIVE']) : r.chance(0.85) ? 'BEFORE_GO_LIVE' : 'AT_GO_LIVE';
      const tpct = Math.round(phase === 5 ? (timing === 'BEFORE_GO_LIVE' ? r.between(85, 99) : timing === 'AT_GO_LIVE' ? r.between(65, 90) : r.between(40, 75))
        : phase === 4 ? r.between(30, 80) : phase === 3 ? r.between(10, 45) : r.between(0, 10));
      const needsUnion = change === 'ROLE_REDESIGN' || (change === 'PROCESS' && x.hc >= 50);
      const union = !needsUnion ? 'NOT_REQUIRED' : phase === 5 || (phase === 4 && r.chance(0.6)) ? 'COMPLETE' : 'PENDING';
      const tool = p.title.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 48);
      impacts.push({ pid: p.id, org: x.org, series: x.series, headcount: x.hc, change, course: `LMS: ${tool} for ${SERIES[x.series]}s`, tpct, timing, union, go });
    }
  }
  if (flagship) for (const i of impacts.filter(i => i.pid === flagship.id)) { i.course = 'LMS: Responsible use of Gen AI at DLA'; i.tpct = i.series === '2210' ? 64 : 21; i.timing = 'BEFORE_GO_LIVE'; }

  /* ── 1b. change-impact screens at intake (most new projects; some older ones screened when the Hub started) ── */
  const band = (n: number) => (n < 10 ? 'UNDER_10' : n < 100 ? '10_99' : n < 1000 ? '100_999' : '1000_PLUS');
  const screens: any[] = [];
  for (const p of projects) {
    const phase = p.esf_phase ?? 0;
    if (p.esf_status === 'AT_SCALE' || phase > 3) continue;
    const r = rngFor(seed, 'screen:' + p.esh_id);
    if (p.id !== flagship?.id && !r.chance(phase <= 1 ? 0.85 : 0.45)) continue;
    const mine = impacts.filter(i => i.pid === p.id);
    const toolish = AI.test(p.title) || /tool|software|app\b|digital|platform|dashboard|system|automat/i.test(p.title);
    const works = mine.length || p.id === flagship?.id ? 'YES' : toolish ? (r.chance(0.75) ? 'YES' : 'UNSURE') : r.pick(['YES', 'UNSURE', 'UNSURE', 'NO', 'NO'] as const);
    const types = works === 'NO' ? [] : mine.length ? [...new Set(mine.map(i => i.change))] : [toolish ? 'NEW_TOOL' : r.pick(['PROCESS', 'NEW_TOOL'] as const), ...(r.chance(0.2) ? ['PROCESS'] : [])].filter((x, k, a) => a.indexOf(x) === k);
    const total = mine.reduce((a, i) => a + i.headcount, 0);
    const sers = seriesFor(p.title).slice(0, 2).map(s => SERIES[s] + 's').join(' and ');
    const beyond = p.id === flagship?.id ? 'YES' : works === 'NO' ? 'NO' : r.pick(['YES', 'NO', 'NO', 'UNSURE'] as const);
    const read = r.chance(phase === 0 ? 0.35 : 0.8);
    const pb = works === 'NO' ? 'UNKNOWN' : mine.length ? band(total) : r.pick(['UNDER_10', '10_99', '10_99', '100_999', 'UNKNOWN'] as const);
    screens.push({
      pid: p.id, works, types, pb, beyond,
      who: works === 'NO' ? null : p.id === flagship?.id ? 'Analysts, inventory managers and contract specialists across every MSC; J6 for support' : `${sers} in ${p.sponsor ?? r.pick(MSCS)}${beyond === 'YES' ? ', and at least one other organization' : ''}`,
      training: works === 'NO' ? 'NO' : types.includes('NEW_TOOL') ? 'YES' : r.pick(['YES', 'UNSURE'] as const),
      bu: works === 'NO' ? 'NO' : types.includes('ROLE_REDESIGN') ? 'YES' : types.includes('PROCESS') ? 'UNSURE' : r.pick(['NO', 'UNSURE'] as const),
      at: add(asOf, phase <= 1 ? -r.between(5, 75) : -r.between(120, 420)),
      read: !read || works === 'NO' ? null : pb === '1000_PLUS' || beyond === 'YES' ? 'ENGAGE' : pb === 'UNDER_10' ? 'NONE' : 'MONITOR',
    });
  }

  /* ── 2. senior leader readiness (Kotter) — one assessment per sponsoring position; shown only in aggregate ── */
  const sponsorOrgs = [...new Set(projects.filter(p => p.sponsor).map(p => p.sponsor as string))].sort();
  const leaders = sponsorOrgs.map(org => {
    const r = rngFor(seed, 'leader:' + org);
    const base = r.between(2.2, 4.2), adj = [0.4, 0.3, 0.2, -0.1, -0.2, 0, -0.4, -0.5];
    const scores = adj.map(a => clamp(Math.round(base + a + r.between(-0.7, 0.7)), 1, 5));
    return { org, position: `Senior Executive (SES), ${org}`, scores, prior: scores.map(s => clamp(s + r.pick([-1, 0, 0, 0, 1]), 1, 5)), assessed: add(asOf, -r.between(10, 75)) };
  });

  /* ── 3. adoption after go-live ── */
  const adoption = new Map<number, number[]>();
  for (const p of projects) {
    if (p.esf_status !== 'AT_SCALE' || !impacts.some(i => i.pid === p.id)) continue;
    const t = impacts.filter(i => i.pid === p.id);
    const timing = t.some(i => i.timing === 'AFTER_GO_LIVE') ? 'AFTER' : t.some(i => i.timing === 'AT_GO_LIVE') ? 'AT' : 'BEFORE';
    const ld = leaders.find(l => l.org === p.sponsor);
    const lead = ld ? (ld.scores[0] + ld.scores[6] - 6) * 3 : 0;   // urgency + sustain acceleration
    const r = rngFor(seed, 'adopt:' + p.id);
    adoption.set(p.id, { BEFORE: [60, 80, 88], AT: [50, 70, 80], AFTER: [30, 45, 55] }[timing].map(c => clamp(Math.round(c + lead + r.between(-6, 6)), 5, 98)));
  }

  /* ── 4. the two rollout stories J1 asked for ── */
  const eligible = projects.filter(p => p.esf_status === 'AT_SCALE' && !scenarioIds.has(p.id) && p.sponsor && p.scale_at && new Date(p.scale_at) <= add(asOf, -200) && impacts.some(i => i.pid === p.id));
  const fit = (p: any) => -((impacts.some(i => i.pid === p.id && (i.series === '2010' || i.series === '2005')) ? 1 : 0)
    + (/system|software|tool|automat|digital|data|analytic|platform|predict|\bai\b|model|visibility|process|portal|app\b/i.test(p.title) ? 2 : 0));
  const scaled = [...eligible].sort((a, b) => fit(a) - fit(b) || a.esh_id.localeCompare(b.esh_id));
  const bad = scaled[0], good = scaled.find(p => p.sponsor !== bad?.sponsor);
  const stories: { ord: number; p: any; title: string; story: string; look: string }[] = [];
  if (bad) {
    for (const i of impacts.filter(i => i.pid === bad.id)) { i.timing = 'AFTER_GO_LIVE'; i.tpct = 52; }
    adoption.set(bad.id, [28, 41, 47]);
    const ld = leaders.find(l => l.org === bad.sponsor)!; ld.scores[0] = 2; ld.scores[1] = 2; ld.scores[6] = 1; ld.scores[7] = 1;
    stories.push({ ord: 12, p: bad, title: 'A rollout that went badly',
      story: `Went live ${iso(new Date(bad.scale_at))} with training scheduled after go-live and no J1 readiness check at Gate 2. Adoption reached only 47% at 180 days. This is the pattern J1's Gate 2 readiness check is meant to catch.`,
      look: 'Workforce card: training AFTER go-live · Gate 2 J1 check not assessed · adoption 28 → 41 → 47%' });
  }
  if (good) {
    for (const i of impacts.filter(i => i.pid === good.id)) { i.timing = 'BEFORE_GO_LIVE'; i.tpct = 96; }
    adoption.set(good.id, [64, 83, 91]);
    const ld = leaders.find(l => l.org === good.sponsor)!; ld.scores = ld.scores.map((s, k) => (k === 0 || k === 6 ? 5 : Math.max(s, 4)));
    stories.push({ ord: 13, p: good, title: 'A rollout that went well',
      story: `Went live ${iso(new Date(good.scale_at))} after 96% of affected staff finished training, and the SES sponsor kept the message going after launch. Adoption reached 91% at 180 days.`,
      look: 'Workforce card: training BEFORE go-live at 96% · adoption 64 → 83 → 91%' });
  }

  /* ── 5. organization contacts: R&D focal points and project POCs ── */
  const orgs = (await tx.query<any>(`SELECT o.id, o.name, o.kind, count(DISTINCT po.project_id)::int n FROM org o JOIN project_org po ON po.org_id = o.id
    WHERE po.role IN ('SPONSOR','TRANSITION_PARTNER','STAKEHOLDER') GROUP BY o.id ORDER BY o.name`)).rows;
  const usedNames = new Set<string>();
  const person = (r: R, org: any, title: string, office: string | null, focal: number | null) => {
    let name = '';
    for (let i = 0; i < 20 && (!name || usedNames.has(name)); i++) name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
    usedNames.add(name);
    const [f, l] = name.toLowerCase().split(' ');
    return { org_id: org.id, name, title, office, email: `${f}.${l}@${slug(org.name)}.example`, phone: `(${r.pick(AREA)}) 555-01${String(r.int(0, 99)).padStart(2, '0')}`, focal };
  };
  const people: ReturnType<typeof person>[] = [];
  const byOrg = new Map<number, number[]>();   // org_id -> indexes into people
  for (const o of orgs) {
    const r = rngFor(seed, 'org:' + o.name);
    const isDla = o.kind === 'DLA_MSC' || o.kind === 'DLA_JCODE';
    const idx: number[] = [];
    if (isDla) {   // declared R&D focal points
      const n = clamp(1 + Math.floor(o.n / 12) + r.int(0, 1), 1, 5);
      for (let k = 1; k <= n; k++) { idx.push(people.length); people.push(person(r, o, k === 1 ? 'R&D Focal Point (Primary)' : 'R&D Focal Point', `${o.name} — ${r.pick(OFFICE_DLA)}`, k)); }
    }
    byOrg.set(o.id, idx);
  }
  const roleRows = (await tx.query<any>(`SELECT po.project_id, po.org_id, po.role FROM project_org po
    WHERE po.role IN ('SPONSOR','TRANSITION_PARTNER') ORDER BY po.project_id, po.role, po.org_id`)).rows;
  const contacts: { pid: number; person: number; role: string }[] = [];
  const firstSponsor = new Map<number, number>();
  for (const x of roleRows) {
    const o = orgs.find(z => z.id === x.org_id); if (!o) continue;
    const r = rngFor(seed, `poc:${x.project_id}:${x.org_id}:${x.role}`);
    const role = x.role === 'SPONSOR' ? (firstSponsor.has(x.project_id) ? 'CO_SPONSOR' : 'SPONSOR') : 'TRANSITION_PARTNER';
    if (role === 'SPONSOR') firstSponsor.set(x.project_id, x.org_id);
    if (role === 'TRANSITION_PARTNER' && contacts.some(c => c.pid === x.project_id && c.role === 'TRANSITION_PARTNER')) continue;
    const pool = byOrg.get(o.id)!;
    const nonFocal = pool.filter(i => people[i].focal == null);
    let pi: number;
    if (pool.length && r.chance(0.35)) pi = r.pick(pool.filter(i => people[i].focal != null).length ? pool.filter(i => people[i].focal != null) : pool);
    else if (nonFocal.length >= 6 || (nonFocal.length && r.chance(0.5))) pi = r.pick(nonFocal);
    else {
      const title = role === 'TRANSITION_PARTNER' ? r.pick(['Program Office Lead', 'Engineering Lead', 'Logistics Lead', 'Product Support Manager'])
        : r.pick(['Program Manager', 'Branch Chief', 'Division Chief', 'Deputy Director', 'Business Process Owner']);
      pi = people.length; people.push(person(r, o, title, null, null)); pool.push(pi);
    }
    contacts.push({ pid: x.project_id, person: pi, role });
  }

  /* ── write ── */
  for (const i of impacts)
    await tx.query(`INSERT INTO workforce_impact (project_id, org, series, series_title, headcount, change_type, training_course, training_pct, training_timing, union_notice, go_live, synthetic)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`, [i.pid, i.org, i.series, SERIES[i.series], i.headcount, i.change, i.course, i.tpct, i.timing, i.union, i.go ? iso(i.go) : null]);
  for (const s of screens)
    await tx.query(`INSERT INTO change_screen (project_id, works_differently, change_types, who, people_band, beyond_one_org, training, bargaining_unit, notes, screened_by, screened_at, j1_read, j1_note, j1_by, j1_at, synthetic)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'PM (at intake)',$9,$10,NULL,$11,$12,true)`,
      [s.pid, s.works, s.types, s.who, s.pb, s.beyond, s.training, s.bu, iso(s.at), s.read, s.read ? 'J1 Human Capital Transformation' : null, s.read ? iso(add(s.at, 6)) : null]);
  for (const [pid, pcts] of adoption) {
    const p = projects.find(x => x.id === pid);
    const since = p?.scale_at ? (asOf.getTime() - new Date(p.scale_at).getTime()) / 864e5 : 0;
    for (const [k, day] of [30, 90, 180].entries()) if (since >= day)
      await tx.query('INSERT INTO adoption_measure (project_id, day, adoption_pct, synthetic) VALUES ($1,$2,$3,true)', [pid, day, pcts[k]]);
  }
  for (const l of leaders) {
    const id = (await tx.query<{ id: number }>('INSERT INTO senior_leader (position, org, synthetic) VALUES ($1,$2,true) RETURNING id', [l.position, l.org])).rows[0].id;
    for (let a = 0; a < 8; a++)
      await tx.query('INSERT INTO leader_readiness (leader_id, accelerator, score, prior_score, assessed_at, synthetic) VALUES ($1,$2,$3,$4,$5,true)', [id, a + 1, l.scores[a], l.prior[a], iso(l.assessed)]);
  }
  const pid: number[] = [];
  for (const x of people)
    pid.push((await tx.query<{ id: number }>('INSERT INTO org_person (org_id, name, title, office, email, phone, focal_rank, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING id',
      [x.org_id, x.name, x.title, x.office, x.email, x.phone, x.focal])).rows[0].id);
  for (const c of contacts)
    await tx.query('INSERT INTO project_contact (project_id, org_person_id, role, synthetic) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING', [c.pid, pid[c.person], c.role]);
  for (const s of stories)
    await tx.query('INSERT INTO demo_scenario (ord, esh_id, title, story, look_for, track) VALUES ($1,$2,$3,$4,$5,\'J1\')', [s.ord, s.p.esh_id, s.title, s.story, s.look]);

  console.log(`J1 layer: ${screens.length} intake change-impact screens, ${impacts.length} workforce-impact rows,${leaders.length} readiness assessments (aggregate only), ${adoption.size} projects with adoption measures.`);
  console.log(`Contacts: ${people.filter(p => p.focal != null).length} R&D focal points, ${people.length} people, ${contacts.length} project POC links.`);
  for (const s of stories) console.log(`J1 story ${s.ord} · ${s.title}: ${s.p.esh_id} ${s.p.title}`);
}
