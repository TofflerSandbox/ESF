import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { PHASES } from './domain.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
type Section = { key: string; h: string; body: string; sources: string[]; status: 'filled' | 'partial' | 'gap' | 'owner' };

const CHANGE: Record<string, string> = { NEW_TOOL: 'a new tool to learn and use', PROCESS: 'a change to how work is done', ROLE_REDESIGN: 'a change to roles and responsibilities' };
const TIMING: Record<string, string> = { BEFORE_GO_LIVE: 'before go-live', AT_GO_LIVE: 'at go-live', AFTER_GO_LIVE: 'after go-live' };
const people = (n: number) => (n < 10 ? 'fewer than 10' : n.toLocaleString('en-US'));   // counts under 10 are suppressed
const BAND: Record<string, string> = { UNDER_10: 'fewer than 10', '10_99': '10 to 99', '100_999': '100 to 999', '1000_PLUS': '1,000 or more', UNKNOWN: 'an unknown number of' };
const YNU: Record<string, string> = { YES: 'yes', NO: 'no', UNSURE: 'not yet known' };
/** The PM's intake answer, in a sentence or two: an estimate, so it says where it came from. */
const screenText = (s: any) => [
  `From the change-impact screen at intake (${fd(s.screened_at)}, an estimate): ${s.works_differently === 'YES' ? 'people will work differently' : s.works_differently === 'UNSURE' ? 'people may work differently' : 'no one is expected to work differently'}.`,
  s.works_differently !== 'NO' && s.change_types?.length ? `Kind of change: ${s.change_types.map((t: string) => CHANGE[t] ?? t.toLowerCase()).join(', and ')}.` : null,
  s.works_differently !== 'NO' ? `Who: ${s.who ?? '[not stated]'}; about ${BAND[s.people_band]} people${s.beyond_one_org === 'YES' ? ', in more than one organization' : ''}.` : null,
  s.works_differently !== 'NO' ? `Training expected: ${YNU[s.training]}. Bargaining-unit employees affected: ${YNU[s.bargaining_unit]}.` : null,
].filter(Boolean).join('\n');
const fd = (d: any) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);

/**
 * Document drafts assembled from the project record. A draft is a starting point for its owner, never evidence by itself:
 * the criterion stays open until the owner edits, files and signs it. This prototype assembles text from the record with a
 * fixed template (no language model, nothing leaves the machine); each section lists the record fields it came from, and the
 * draft lists what the record is missing.
 */
export function registerDrafts(app: FastifyInstance, db: PGlite, deps: { wrap: Wrap; projectByEsh: (q: PGlite, esh: string) => Promise<any> }) {
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows as any[];

  /** Change Management Impact Assessment (Gate 2, J1's workforce readiness check). */
  app.get('/api/projects/:esh/drafts/cm-impact', deps.wrap(async (req) => {
    const p = await deps.projectByEsh(db, (req.params as any).esh);
    const [wf, orgs, adoption, gates, screens] = await Promise.all([
      q(`SELECT * FROM workforce_impact WHERE project_id = $1 ORDER BY headcount DESC`, [p.id]),
      q(`SELECT o.name, po.role FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = $1 ORDER BY po.role, o.name`, [p.id]),
      q(`SELECT day, adoption_pct FROM adoption_measure WHERE project_id = $1 ORDER BY day`, [p.id]),
      q(`SELECT d.ord, d.text, coalesce(s.status, 'PENDING') status FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = $1
         WHERE d.owner = 'J1' ORDER BY d.gate, d.ord`, [p.id]),
      q(`SELECT * FROM change_screen WHERE project_id = $1`, [p.id]),
    ]);
    const sc = screens[0] ?? null;   // the intake screen: the starting point when the record has no workforce impact yet
    const gaps: string[] = [];
    const sponsors = orgs.filter((o: any) => o.role === 'SPONSOR').map((o: any) => o.name);
    const partners = orgs.filter((o: any) => o.role === 'TRANSITION_PARTNER').map((o: any) => o.name);
    const total = wf.reduce((a: number, w: any) => a + w.headcount, 0);
    const orgSet = [...new Set(wf.map((w: any) => w.org))];
    const goLives = [...new Set(wf.map((w: any) => w.go_live && new Date(w.go_live).toISOString().slice(0, 10)).filter(Boolean))].sort() as string[];
    const types = [...new Set(wf.map((w: any) => w.change_type))] as string[];
    const sections: Section[] = [];

    // 1 · The change
    if (!p.description) gaps.push('The project has no description; the change summary is thin without one.');
    if (!goLives.length) gaps.push('No go-live date is recorded for any affected group.');
    sections.push({
      key: 'change', h: '1. The change', status: p.description && types.length ? 'filled' : 'partial',
      sources: ['Project description', 'ESF phase', 'Workforce impact: change type, go-live', ...(sc && !types.length ? ['Change-impact screen at intake'] : [])],
      body: [
        `${p.title} (${p.esh_id}) is in ${PHASES[p.esf_phase ?? 0]?.short ?? 'an early phase'}${p.program_code ? `, under the ${p.program_code} program` : ''}.`,
        p.description ? `What it does: ${p.description.trim().replace(/\s+/g, ' ')}` : '[Describe what the capability does, in plain language.]',
        types.length ? `For the workforce this is ${types.map(t => CHANGE[t] ?? t.toLowerCase()).join(', and ')}.`
          : sc?.change_types?.length ? `For the workforce this is expected to be ${sc.change_types.map((t: string) => CHANGE[t] ?? t.toLowerCase()).join(', and ')} (intake screen).`
          : '[State whether this is a new tool, a process change, or a change to roles.]',
        goLives.length ? `Planned go-live: ${goLives.map(fd).join(', ')}.` : '[Planned go-live date.]',
      ].join('\n'),
    });

    // 2 · Who is affected (the intake screen stands in, as an estimate, until the workforce impact is recorded)
    if (!wf.length) gaps.push(sc ? 'Workforce impact is not yet recorded by organization and job series; the draft uses the intake screen’s estimate.'
      : 'No workforce impact is recorded: which organizations and job series are affected, and how many people.');
    sections.push({
      key: 'who', h: '2. Who is affected', status: wf.length ? 'filled' : sc ? 'partial' : 'gap',
      sources: wf.length ? ['Workforce impact: organization, job series, headcount'] : sc ? ['Change-impact screen at intake'] : ['Workforce impact: organization, job series, headcount'],
      body: wf.length
        ? [`About ${people(total)} people in ${orgSet.length} organization${orgSet.length === 1 ? '' : 's'}:`,
           ...wf.map((w: any) => `• ${w.org}: ${w.series_title} (${w.series}), ${people(w.headcount)}`)].join('\n')
        : sc ? `${screenText(sc)}\n[Confirm each affected organization and job series, with an approximate headcount.]`
        : '[List each affected organization and job series, with an approximate headcount. Counts under 10 are shown as “fewer than 10”.]',
    });

    // 3 · Training
    const noCourse = wf.filter((w: any) => !w.training_course), noTiming = wf.filter((w: any) => !w.training_timing);
    const late = wf.filter((w: any) => w.training_timing === 'AFTER_GO_LIVE');
    if (wf.length && noCourse.length) gaps.push(`No training course is named for ${noCourse.length} affected group${noCourse.length === 1 ? '' : 's'}.`);
    if (wf.length && noTiming.length) gaps.push(`Training timing is not recorded for ${noTiming.length} affected group${noTiming.length === 1 ? '' : 's'}.`);
    sections.push({
      key: 'training', h: '3. Training', status: !wf.length ? 'gap' : noCourse.length || noTiming.length ? 'partial' : 'filled',
      sources: ['Workforce impact: training course, timing, share trained'],
      body: wf.length
        ? wf.map((w: any) => `• ${w.org}, ${w.series_title}: ${w.training_course ?? '[course to be named]'}, ${w.training_timing ? TIMING[w.training_timing] : '[timing]'}${w.training_pct != null ? `; ${w.training_pct}% trained so far` : ''}`).join('\n')
        : '[For each affected group: the course, when it happens relative to go-live, and progress so far.]',
    });

    // 4 · Labor relations
    const pending = wf.filter((w: any) => w.union_notice === 'PENDING'), done = wf.filter((w: any) => w.union_notice === 'COMPLETE');
    sections.push({
      key: 'labor', h: '4. Labor relations', status: wf.length ? 'filled' : 'gap',
      sources: ['Workforce impact: union notification status'],
      body: !wf.length ? '[Whether bargaining-unit employees are affected, and the status of any required notification.]'
        : pending.length ? `Union notification is pending for ${pending.map((w: any) => `${w.org} (${w.series_title})`).join('; ')}.${done.length ? ` It is complete for ${done.length} other group${done.length === 1 ? '' : 's'}.` : ''}`
        : done.length ? `Union notification is complete for every affected group that requires it.` : 'No union notification is required for the affected groups.',
    });

    // 5 · Risks to readiness (derived from the record)
    const soon = goLives.length && (new Date(goLives[0]).getTime() - AS_OF.getTime()) / 864e5 <= 120;
    const risks: string[] = [];
    if (late.length) risks.push(`Training happens after go-live for ${late.length} group${late.length === 1 ? '' : 's'}: people will start using the change before they are trained.`);
    if (pending.length) risks.push('Union notification is still pending; go-live may need to wait for it.');
    if (total >= 500) risks.push(`The change reaches about ${people(total)} people, which calls for a phased rollout and a communications plan.`);
    if (soon && wf.some((w: any) => (w.training_pct ?? 0) < 50)) risks.push('Go-live is within four months and some groups are less than half trained.');
    if (!sponsors.length) risks.push('No sponsoring organization is named to own the change with its people.');
    sections.push({
      key: 'risks', h: '5. Risks to readiness', status: wf.length ? 'filled' : 'gap', sources: ['Derived from sections 2–4', 'Sponsor on the record'],
      body: risks.length ? risks.map(r => `• ${r}`).join('\n') : wf.length ? 'No readiness risks stand out in the record.' : '[Risks to the workforce being ready at go-live.]',
    });

    // 6 · Recommended actions
    const acts: string[] = [];
    if (noCourse.length || noTiming.length) acts.push('Name the training course and timing for every affected group.');
    if (late.length) acts.push('Move training before go-live, or phase go-live behind training.');
    if (pending.length) acts.push('Complete union notification before go-live.');
    if (total >= 500) acts.push('Agree a phased rollout and a communications plan with the sponsor.');
    acts.push('Plan adoption measurement at 30, 90 and 180 days after go-live.');
    sections.push({ key: 'actions', h: '6. Recommended readiness actions', status: 'filled', sources: ['Derived from sections 3–5'], body: acts.map(a => `• ${a}`).join('\n') });

    // 7 · Who owns the change
    sections.push({
      key: 'owners', h: '7. Who owns the change', status: sponsors.length ? 'filled' : 'gap', sources: ['Sponsor and transition partners on the record'],
      body: [sponsors.length ? `Sponsoring organization: ${sponsors.join(', ')}.` : '[Sponsoring organization.]',
        partners.length ? `Transition partner${partners.length === 1 ? '' : 's'}: ${partners.join(', ')}.` : null,
        'The sponsor leads the change with its own people; J1 advises and confirms readiness at each gate.'].filter(Boolean).join('\n'),
    });

    // 8 · Status of J1's checkpoints, and adoption so far
    sections.push({
      key: 'checkpoints', h: '8. J1 checkpoints on this project', status: 'filled', sources: ['Gate criteria owned by J1', 'Adoption measures'],
      body: [...gates.map((g: any) => `• ${g.text}: ${g.status === 'PENDING' ? 'open' : g.status.toLowerCase()}`),
        adoption.length ? `Adoption so far: ${adoption.map((a: any) => `${a.adoption_pct}% at ${a.day} days`).join(', ')}.` : null].filter(Boolean).join('\n'),
    });

    // 9 · J1's determination (never drafted)
    sections.push({
      key: 'determination', h: '9. J1 determination', status: 'owner', sources: [],
      body: '[J1 to complete: Ready / Ready with conditions / Not ready, the conditions if any, and the reviewer’s office and date.]',
    });

    return {
      kind: 'CM_IMPACT', title: `Change Management Impact Assessment: ${p.title}`, esh_id: p.esh_id, assembledAt: new Date().toISOString(),
      note: 'Assembled from the project record. A draft for J1 to review, edit and sign; it does not close the criterion by itself.',
      ownerLabel: 'For J1 to complete', sections, gaps,
    };
  }));

  /**
   * Change management statement for the DCG decision brief (Gate 3, J1's). Standard HCT language that fits any project, then
   * what this project changes for the workforce, from the record: the CM Impact Assessment's workforce impact if recorded,
   * otherwise the intake screen's estimate. J1 tailors and approves it; filing it doesn't close the criterion.
   */
  app.get('/api/projects/:esh/drafts/cm-statement', deps.wrap(async (req) => {
    const p = await deps.projectByEsh(db, (req.params as any).esh);
    const [wf, orgs, crits, screens] = await Promise.all([
      q(`SELECT * FROM workforce_impact WHERE project_id = $1 ORDER BY headcount DESC`, [p.id]),
      q(`SELECT o.name, po.role FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = $1 AND po.role = 'SPONSOR' ORDER BY o.name`, [p.id]),
      q(`SELECT d.gate, d.text, coalesce(s.status, 'PENDING') status FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = $1
         WHERE d.owner = 'J1' ORDER BY d.gate, d.ord`, [p.id]),
      q(`SELECT * FROM change_screen WHERE project_id = $1`, [p.id]),
    ]);
    const sc = screens[0] ?? null;
    const gaps: string[] = [];
    const sections: Section[] = [];
    const sponsors = orgs.map((o: any) => o.name);
    const total = wf.reduce((a: number, w: any) => a + w.headcount, 0);
    const orgSet = [...new Set(wf.map((w: any) => w.org))] as string[];
    const types = [...new Set(wf.map((w: any) => w.change_type))] as string[];
    const goLives = [...new Set(wf.map((w: any) => w.go_live && new Date(w.go_live).toISOString().slice(0, 10)).filter(Boolean))].sort() as string[];
    const late = wf.filter((w: any) => w.training_timing === 'AFTER_GO_LIVE');
    const union = wf.filter((w: any) => w.union_notice === 'PENDING');
    const cmia = crits.find((c: any) => c.gate === 2);
    const noChange = !wf.length && sc?.works_differently === 'NO';

    // 1 · Standard statement: the same on every brief, whether or not J1 action is needed
    sections.push({
      key: 'standard', h: '1. Standard statement', status: 'filled', sources: ['J1 Human Capital Transformation standard language'],
      body: 'J1 Human Capital Transformation (HCT) has reviewed this project for its effect on the DLA workforce. Change management is part of the project from the start: '
        + 'HCT is engaged with the program manager and the sponsoring organization, and workforce readiness is checked at each Enterprise Scaling Framework gate before the project moves forward. '
        + 'The sponsoring senior leader owns the change with their people; J1 advises, and confirms readiness before go-live and after.',
    });

    // 2 · What this project changes for the workforce
    if (!wf.length && !sc) gaps.push('Neither a workforce impact nor an intake change-impact screen is recorded: the statement can only carry the standard language.');
    else if (!wf.length) gaps.push('The workforce impact is not recorded by organization and job series; this draft uses the intake screen’s estimate.');
    if (cmia?.status === 'PENDING') gaps.push('The Gate 2 CM Impact Assessment is still open.');
    sections.push({
      key: 'project', h: '2. What this project changes for the workforce', status: wf.length ? 'filled' : sc ? 'partial' : 'gap',
      sources: wf.length ? ['Workforce impact (CM Impact Assessment)', 'Sponsor'] : sc ? ['Change-impact screen at intake', 'Sponsor'] : [],
      body: wf.length
        ? [`${p.title} reaches ${total < 10 ? '' : 'about '}${people(total)} people in ${orgSet.length === 1 ? orgSet[0] : `${orgSet.length} organizations (${orgSet.join('; ')})`}.`,
           `For them it is ${types.map(t => CHANGE[t] ?? t.toLowerCase()).join(', and ')}${goLives.length ? `, with go-live planned from ${fd(goLives[0])}` : ''}.`,
           `Sponsoring organization: ${sponsors.length ? sponsors.join(', ') : '[name it]'}.`].join('\n')
        : noChange ? `The intake screen (${fd(sc.screened_at)}) expects no one to work differently. J1 action is limited to the standard checkpoints unless that changes.`
        : sc ? screenText(sc)
        : '[Who the change reaches, how many people, the kind of change, and when it goes live. Until it is known, the standard statement stands on its own.]',
    });

    // 3 · Readiness, as the record shows it today
    const ready: string[] = [];
    if (cmia) ready.push(`CM Impact Assessment (Gate 2): ${cmia.status === 'MET' ? 'complete' : cmia.status === 'WAIVED' ? 'not assessed (gate passed before J1 joined the ESF)' : 'open'}.`);
    if (wf.length) {
      ready.push(late.length ? `Training is planned after go-live for ${late.length} affected group${late.length === 1 ? '' : 's'}.` : 'Training is planned before or at go-live for every affected group.');
      if (union.length) ready.push(`Union notification is pending for ${union.length} group${union.length === 1 ? '' : 's'} (adds 30 to 60 days).`);
    } else if (sc && !noChange) {
      ready.push(`Training expected: ${YNU[sc.training]}. Bargaining-unit employees affected: ${YNU[sc.bargaining_unit]}.`);
    }
    ready.push('Adoption will be measured at 30, 90 and 180 days after go-live.');
    // the recorded workforce impact outranks the intake estimate
    const support = wf.length ? total >= 500 || late.length > 0 || union.length > 0 : sc?.people_band === '1000_PLUS' || sc?.beyond_one_org === 'YES';
    ready.push(!wf.length && !sc ? '[Whether J1 support is needed beyond the standard checkpoints.]'
      : support ? 'J1 support is planned beyond the standard checkpoints.' : 'No J1 action is needed beyond the standard checkpoints.');
    sections.push({ key: 'readiness', h: '3. Workforce readiness', status: wf.length || sc ? 'filled' : 'partial', sources: ['J1 gate criteria', 'Workforce impact', 'Intake screen'], body: ready.map(r => `• ${r}`).join('\n') });

    // 4 · J1 approval (never drafted)
    sections.push({
      key: 'approve', h: '4. J1 approval', status: 'owner', sources: [],
      body: '[J1 to complete: approved for the brief as written, or the changes needed; the approving office and date.]',
    });

    return {
      kind: 'CM_STATEMENT', title: `Change management statement: ${p.title}`, esh_id: p.esh_id, assembledAt: new Date().toISOString(),
      note: 'Standard HCT language, then what the record shows for this project. A draft for J1 to tailor and approve; it does not close the criterion by itself.',
      ownerLabel: 'For J1 to complete', sections, gaps,
    };
  }));

  /** Transition plan (Path A / B): drafted by the PM from the record; the sponsor commits. Files against Gate 2 "Transition path formally declared". */
  app.get('/api/projects/:esh/drafts/transition-plan', deps.wrap(async (req) => {
    const p = await deps.projectByEsh(db, (req.params as any).esh);
    const [paths, orgs, funding, crits, wf, values, baseline, reviews, phaseRec, board] = await Promise.all([
      q(`SELECT t.*, o.name receiver FROM transition_pathway t LEFT JOIN org o ON o.id = t.receiver_org_id WHERE t.project_id = $1
         ORDER BY CASE t.status WHEN 'ACTIVE' THEN 0 WHEN 'COMMITTED' THEN 1 ELSE 2 END, t.id`, [p.id]),
      q(`SELECT o.name, po.role FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = $1 ORDER BY po.role, o.name`, [p.id]),
      q(`SELECT fy, appropriation, source, amount FROM funding_line WHERE project_id = $1 ORDER BY fy, source`, [p.id]),
      q(`SELECT d.gate, d.ord, d.text, coalesce(s.status, 'PENDING') status FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = $1
         WHERE d.gate IN (3, 4) ORDER BY d.gate, d.ord`, [p.id]),
      q(`SELECT headcount, training_timing, union_notice FROM workforce_impact WHERE project_id = $1`, [p.id]),
      q(`SELECT path, annual_value, metric, j8_certified, is_primary FROM value_case WHERE project_id = $1 ORDER BY is_primary DESC, annual_value DESC NULLS LAST`, [p.id]),
      q(`SELECT b.*, o.name owner FROM benefit_baseline b LEFT JOIN org o ON o.id = b.owner_org_id WHERE b.project_id = $1`, [p.id]),
      q(`SELECT months, due_on, status FROM realization_review WHERE project_id = $1 ORDER BY months`, [p.id]),
      q(`SELECT phase, entered_at FROM phase_record WHERE project_id = $1 AND exited_at IS NULL ORDER BY entered_at DESC LIMIT 1`, [p.id]),
      q(`SELECT b.title, b.board_date FROM gate_board_item i JOIN gate_board b ON b.id = i.board_id WHERE i.project_id = $1 AND b.status = 'SCHEDULED' AND i.outcome IS NULL ORDER BY b.board_date LIMIT 1`, [p.id]),
    ]);
    const gaps: string[] = [];
    const sections: Section[] = [];
    const t = paths[0] ?? null;
    const sponsors = orgs.filter((o: any) => o.role === 'SPONSOR').map((o: any) => o.name);
    const money = (v: number) => (!v ? 'none' : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 2)}M` : `$${Math.round(v / 1e3)}K`);
    const ph = p.esf_status === 'AT_SCALE' ? 5 : p.esf_phase ?? 0;

    // 1 · What transitions, and to whom
    if (!t) gaps.push('No transition path is declared: Path A (working capital fund rate) or Path B (POM program line).');
    if (t && !t.receiver_org_id) gaps.push('No receiving organization is named for the pathway.');
    if (!sponsors.length) gaps.push('No sponsoring organization is named.');
    sections.push({
      key: 'what', h: '1. What transitions, and to whom', status: t?.receiver_org_id && sponsors.length ? 'filled' : t ? 'partial' : 'gap',
      sources: ['Project description', 'Sponsor', 'Pathway receiver'],
      body: [
        `${p.title} (${p.esh_id}), now in ${PHASES[ph]?.short ?? 'an early phase'}.`,
        p.description ? `The capability: ${p.description.trim().replace(/\s+/g, ' ')}` : '[Describe the capability that transitions.]',
        `Receiving organization: ${t?.receiver ?? '[name the organization that takes it on and pays to run it]'}.`,
        `Sponsor: ${sponsors.length ? sponsors.join(', ') : '[sponsoring organization]'}.`,
      ].join('\n'),
    });

    // 2 · How it is paid for
    if (t && !t.funding_line) gaps.push('No funding line is named for after transition.');
    if (t?.path === 'B_POM' && !t.pom_fy) gaps.push('Path B is declared, but no POM year is set.');
    const byFy = new Map<number, { rd: number; sp: number }>();
    for (const f of funding) {
      const x = byFy.get(f.fy) ?? { rd: 0, sp: 0 };
      if (/J68/i.test(f.source)) x.rd += Number(f.amount); else x.sp += Number(f.amount);
      byFy.set(f.fy, x);
    }
    if (!funding.length) gaps.push('No funding lines are recorded, by year and source.');
    sections.push({
      key: 'paid', h: '2. How it is paid for', status: t?.funding_line && (t.path !== 'B_POM' || t.pom_fy) ? 'filled' : t ? 'partial' : 'gap',
      sources: ['Pathway: path, mechanism, funding line, POM year, status', 'Funding lines by year and source'],
      body: [
        t ? `${t.path === 'A_WCF' ? 'Path A: a stabilized working capital fund rate recovers the cost from customers.' : 'Path B: a program line in the POM funds operation.'} Mechanism: ${t.mechanism}.` : '[Declare Path A (working capital fund rate) or Path B (POM program line), and the mechanism.]',
        t ? `Funding line after transition: ${t.funding_line ?? '[name it]'}${t.path === 'B_POM' ? `; POM year: ${t.pom_fy ? 'FY' + t.pom_fy : '[set it]'}` : ''}. Status: ${t.status === 'ACTIVE' ? 'active (the receiver is running it)' : t.status === 'COMMITTED' ? `committed${t.committed_at ? ' on ' + fd(t.committed_at) : ''}` : 'declared, not yet committed by the sponsor'}.` : null,
        byFy.size ? 'Funding by fiscal year:' : null,
        ...[...byFy.entries()].map(([fy, x]) => `• FY${String(fy).slice(2)}: R&D ${money(x.rd)}, sponsor ${money(x.sp)}`),
      ].filter(Boolean).join('\n'),
    });

    // 3 · Timeline
    const entered = phaseRec[0]?.entered_at ? new Date(phaseRec[0].entered_at) : null;
    const addM = (d: Date, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.round(m), d.getUTCDate()));
    const nextPom = new Date(Date.UTC(AS_OF.getUTCMonth() >= 6 ? AS_OF.getUTCFullYear() + 1 : AS_OF.getUTCFullYear(), 6, 1));
    const est: string[] = [];
    if (board[0] && ph >= 1 && ph <= 4) {
      // a scheduled board sets the next gate date; later gates follow from it
      let d = new Date(board[0].board_date);
      est.push(`Gate ${ph} decision scheduled: ${board[0].title}, ${fd(d)}.`);
      for (let g = ph + 1; g <= 4; g++) { d = addM(d, PHASES[g].design[1]); est.push(`Gate ${g} expected by about ${fd(d)}.`); }
    } else if (entered && ph >= 1 && ph <= 4) {
      let d = addM(entered, PHASES[ph].design[1]);
      est.push(`Gate ${ph} expected by about ${fd(d)} (end of the ${PHASES[ph].design[0]}–${PHASES[ph].design[1]} months planned for ${PHASES[ph].short})${d < AS_OF ? ': past the planned window' : ''}.`);
      if (d < AS_OF) d = new Date(AS_OF);   // already overdue: later gates count from today
      for (let g = ph + 1; g <= 4; g++) { d = addM(d, PHASES[g].design[1]); est.push(`Gate ${g} expected by about ${fd(d)}.`); }
    }
    sections.push({
      key: 'timeline', h: '3. Timeline', status: entered ? 'filled' : 'partial',
      sources: ['Current phase and entry date', 'Planned phase durations', 'Board docket', 'Budget calendar'],
      body: [
        `${PHASES[ph]?.short}${entered ? `, entered ${fd(entered)}` : ''}.`,
        ...est,
        t?.path === 'B_POM' && ph <= 2 ? `Path B: Gate 2 must be passed before the POM window opens ${fd(nextPom)}, or the line waits a year.` : null,
      ].filter(Boolean).join('\n'),
    });

    // 4 · Readiness to operate (Gate 3 technical and legal criteria)
    const g3 = crits.filter((c: any) => c.gate === 3 && [3, 4, 5].includes(c.ord));
    sections.push({
      key: 'operate', h: '4. Readiness to operate', status: 'filled', sources: ['Gate 3 criteria: ATO plan, connectivity, bridge eligibility'],
      body: g3.map((c: any) => `• ${c.text}: ${c.status === 'PENDING' ? 'open' : c.status.toLowerCase()}`).join('\n'),
    });

    // 5 · Workforce readiness (summary)
    const people = wf.reduce((a: number, w: any) => a + w.headcount, 0);
    sections.push({
      key: 'workforce', h: '5. Workforce readiness', status: wf.length ? 'filled' : 'gap', sources: ['Workforce impact', 'CM Impact Assessment (if filed)'],
      body: wf.length
        ? [`About ${people < 10 ? 'fewer than 10' : people.toLocaleString('en-US')} people are affected.`,
           wf.some((w: any) => w.training_timing === 'AFTER_GO_LIVE') ? 'Some training is planned after go-live.' : 'Training is planned before or at go-live.',
           wf.some((w: any) => w.union_notice === 'PENDING') ? 'Union notification is still pending for at least one group.' : null,
           'See the Change Management Impact Assessment for detail.'].filter(Boolean).join('\n')
        : '[Who is affected and how they will be ready; see the Change Management Impact Assessment.]',
    });
    if (!wf.length) gaps.push('No workforce impact is recorded.');

    // 6 · Handoff (Gate 4 criteria)
    const g4 = crits.filter((c: any) => c.gate === 4);
    sections.push({
      key: 'handoff', h: '6. Handoff', status: 'filled', sources: ['Gate 4 criteria'],
      body: ['At Gate 4 the operating organization takes the capability on. Status of what that requires:',
        ...g4.map((c: any) => `• ${c.text}: ${c.status === 'PENDING' ? 'open' : c.status.toLowerCase()}`)].join('\n'),
    });

    // 7 · Value after transition
    const v = values[0], b = baseline[0];
    if (!v) gaps.push('No value case is recorded.');
    sections.push({
      key: 'value', h: '7. Value after transition', status: v ? 'filled' : 'gap', sources: ['Value case', 'Benefit baseline', 'Realization reviews'],
      body: [
        v ? `Expected value: ${v.annual_value ? money(Number(v.annual_value)) + ' a year' : 'not yet quantified'} (${String(v.path).toLowerCase()}: ${v.metric})${v.j8_certified ? ', certified by J8' : ', not yet certified by J8'}.` : '[The value case: what it delivers each year, and the measure.]',
        b ? `Baseline set at Gate 4 on ${fd(b.transitioned_on)}: ${money(Number(b.annual_value))} a year, reported by ${b.owner ?? 'the operator'}.` : 'At Gate 4 the value case becomes the baseline the operator reports against monthly.',
        reviews.length ? `Realization reviews: ${reviews.map((r: any) => `${r.months}-month ${r.status === 'HELD' ? 'held' : 'due ' + fd(r.due_on)}`).join('; ')}.` : 'Realization reviews with the operator at 6, 12 and 24 months after Gate 4.',
      ].join('\n'),
    });

    // 8 · Risks and gaps (derived)
    const risks: string[] = [];
    const curFy = AS_OF.getUTCMonth() >= 9 ? AS_OF.getUTCFullYear() + 1 : AS_OF.getUTCFullYear();
    const rdNow = funding.filter((f: any) => f.fy >= curFy && /J68/i.test(f.source) && /RDT/i.test(f.appropriation));
    const spNow = funding.filter((f: any) => f.fy === curFy && !/J68/i.test(f.source));
    if (ph >= 4 && rdNow.length) risks.push('R&D (RDT&E) money is still planned after the project entered transition; the framework allows none.');
    if (ph === 3 && rdNow.length && !spNow.length) risks.push('Limited deployment is funded by R&D money with no sponsor co-funding this year: operating costs on R&D money are a fiscal-law risk.');
    if (t && t.status === 'DECLARED' && ph >= 3) risks.push('The pathway is declared but not committed, though the project is past Gate 2.');
    if (est.some(e => e.includes('past the planned window'))) risks.push('The current phase is running past the time planned for it.');
    risks.push(...gaps.filter(g => /transition path|receiving|funding line|POM year/.test(g)));
    sections.push({
      key: 'risks', h: '8. Risks and gaps', status: 'filled', sources: ['Derived from sections 1–7', 'Funding by appropriation'],
      body: risks.length ? risks.map(r => `• ${r}`).join('\n') : 'No transition risks stand out in the record.',
    });

    // 9 · Sponsor commitment (never drafted)
    sections.push({
      key: 'commit', h: '9. Sponsor commitment', status: 'owner', sources: [],
      body: '[For the sponsor: signature, position and date. Committing names the receiving organization, the funding line and (Path B) the POM year.]',
    });

    return {
      kind: 'TRANSITION_PLAN', title: `Transition plan: ${p.title}`, esh_id: p.esh_id, assembledAt: new Date().toISOString(),
      note: 'Assembled from the project record. A draft for the PM to review and the sponsor to commit; it does not commit the pathway or close a criterion by itself.',
      ownerLabel: 'For the sponsor to complete', sections, gaps,
    };
  }));
}
