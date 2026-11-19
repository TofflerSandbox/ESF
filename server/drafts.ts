import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { PHASES } from './domain.js';

type Wrap = (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any;
type Section = { key: string; h: string; body: string; sources: string[]; status: 'filled' | 'partial' | 'gap' | 'owner' };

const CHANGE: Record<string, string> = { NEW_TOOL: 'a new tool to learn and use', PROCESS: 'a change to how work is done', ROLE_REDESIGN: 'a change to roles and responsibilities' };
const TIMING: Record<string, string> = { BEFORE_GO_LIVE: 'before go-live', AT_GO_LIVE: 'at go-live', AFTER_GO_LIVE: 'after go-live' };
const people = (n: number) => (n < 10 ? 'fewer than 10' : n.toLocaleString('en-US'));   // counts under 10 are suppressed
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
    const [wf, orgs, adoption, gates] = await Promise.all([
      q(`SELECT * FROM workforce_impact WHERE project_id = $1 ORDER BY headcount DESC`, [p.id]),
      q(`SELECT o.name, po.role FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = $1 ORDER BY po.role, o.name`, [p.id]),
      q(`SELECT day, adoption_pct FROM adoption_measure WHERE project_id = $1 ORDER BY day`, [p.id]),
      q(`SELECT d.ord, d.text, coalesce(s.status, 'PENDING') status FROM criterion_def d LEFT JOIN criterion_status s ON s.criterion_id = d.id AND s.project_id = $1
         WHERE d.owner = 'J1' ORDER BY d.gate, d.ord`, [p.id]),
    ]);
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
      sources: ['Project description', 'ESF phase', 'Workforce impact: change type, go-live'],
      body: [
        `${p.title} (${p.esh_id}) is in ${PHASES[p.esf_phase ?? 0]?.short ?? 'an early phase'}${p.program_code ? `, under the ${p.program_code} program` : ''}.`,
        p.description ? `What it does: ${p.description.trim().replace(/\s+/g, ' ')}` : '[Describe what the capability does, in plain language.]',
        types.length ? `For the workforce this is ${types.map(t => CHANGE[t] ?? t.toLowerCase()).join(', and ')}.` : '[State whether this is a new tool, a process change, or a change to roles.]',
        goLives.length ? `Planned go-live: ${goLives.map(fd).join(', ')}.` : '[Planned go-live date.]',
      ].join('\n'),
    });

    // 2 · Who is affected
    if (!wf.length) gaps.push('No workforce impact is recorded: which organizations and job series are affected, and how many people.');
    sections.push({
      key: 'who', h: '2. Who is affected', status: wf.length ? 'filled' : 'gap',
      sources: ['Workforce impact: organization, job series, headcount'],
      body: wf.length
        ? [`About ${people(total)} people in ${orgSet.length} organization${orgSet.length === 1 ? '' : 's'}:`,
           ...wf.map((w: any) => `• ${w.org}: ${w.series_title} (${w.series}), ${people(w.headcount)}`)].join('\n')
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
      sections, gaps,
    };
  }));
}
