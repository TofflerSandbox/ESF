/* Reference data and ESF rules shared by importer and API. */
import { config } from './config.js';

export const PHASES = [
  { n: 0, short: 'Stage 0', name: 'Intake', design: [0.7, 1] },
  { n: 1, short: 'Phase I', name: 'Feasibility', design: [3, 6] },
  { n: 2, short: 'Phase II', name: 'Prototype', design: [18, 24] },
  { n: 3, short: 'Phase III', name: 'Limited Deployment', design: [12, 24] },
  { n: 4, short: 'Phase IV', name: 'Transition', design: [12, 18] },
  { n: 5, short: 'Stage 5', name: 'At Scale', design: [0, 0] },
] as const;

/** Gate criteria — taken from the ESH prototype (spec §6). Placeholder until the ESF spec v0.1 is in hand.
    `owner: 'J1'` rows are J1's roles in the ESF (white paper §3.1): only J1 (or the admin) can close them. */
export const CRITERIA: Record<number, { t: string; hard?: boolean; owner?: 'J68' | 'J1' }[]> = {
  0: [{ t: 'Co-sponsor named (signed LOI)', hard: true }, { t: 'Problem statement scoped' }, { t: 'Value path declared' }, { t: 'ROM estimate provided' }, { t: 'No disqualifying duplication' },
      { t: 'J1 workforce screening and staffing plan', owner: 'J1' }],
  1: [{ t: 'JHU-APL TRA fully satisfactory (5/5)', hard: true }, { t: 'Value hypothesis validated on DLA data' }, { t: 'CONOPS operationally realistic' }, { t: 'Final S&T report delivered' }, { t: 'Co-sponsor reaffirms commitment' }],
  2: [{ t: 'PRR passed (SRR→PRR complete)' }, { t: 'J8 Finance ROI certification in writing', hard: true }, { t: 'Transition path formally declared' }, { t: 'Co-sponsor written reaffirmation' }, { t: 'Contracting, Finance, RM, J6 on record' },
      { t: 'J1 workforce readiness check (CM Impact Assessment)', owner: 'J1' }],
  3: [{ t: 'Signed funding commitment — SES level', hard: true }, { t: 'Multi-site deployment with real users (≥2)' }, { t: 'J6 ATO plan approved' }, { t: 'J6 sandbox connectivity established' }, { t: 'OGC/J7 bridge eligibility documented' },
      { t: 'Change management statement on the DCG brief (J1)', owner: 'J1' }],
  4: [{ t: 'Operational owner formal acceptance' }, { t: 'J7 contract closeout / novation confirmed', hard: true }, { t: 'Funding mechanism active' }, { t: 'Performance review schedule established' }, { t: 'Lessons learned documented' },
      { t: 'Workforce absorption confirmed (J1)', owner: 'J1' }],
};

/** The five gates: the question each answers, who decides, and the move it controls (from the ESF process map). */
export const GATES = [
  { gate: 0, name: 'Gate 0 — Intake', question: 'Is there a real DLA problem and a committed co-sponsor?', authority: 'J68 Director', from: 0, to: 1 },
  { gate: 1, name: 'Gate 1 — Feasibility', question: 'Is it technically feasible and is the value hypothesis real?', authority: 'J68 Director + SES co-sponsor', from: 1, to: 2 },
  { gate: 2, name: 'Gate 2 — Prototype', question: 'Does the prototype work, and is the ROI certified with a named funding path?', authority: 'J68 Director + J8 Finance', from: 2, to: 3 },
  { gate: 3, name: 'Gate 3 — Funding commitment', question: 'Will an SES sign to fund deployment, and is it ready to run on DLA systems?', authority: 'SES / GOFO (DCG)', from: 3, to: 4 },
  { gate: 4, name: 'Gate 4 — Enterprise handoff', question: 'Has the operational owner accepted it, with funding running and J68 money closed out?', authority: 'Operational owner + DCG', from: 4, to: 5 },
] as const;

/** Why a project left the pipeline before scale. Recorded with each SUNSET / DESCOPE gate decision. */
export const EXIT_REASONS = {
  FOLLOW_ON: 'Continued under a follow-on project',
  KNOWLEDGE: 'Delivered a report or knowledge product',
  NO_OWNER: 'Worked, but no owner to take it on',
  VALUE: 'Value not proven on DLA data',
  TECHNICAL: 'Technical results fell short',
  SPONSOR: 'Sponsor withdrew or priorities changed',
  SUPERSEDED: 'Overtaken by another program or commercial product',
} as const;
export type ExitReason = keyof typeof EXIT_REASONS;
export const TECH_RESULTS = { MET: 'Worked technically', PARTIAL: 'Partly worked', NOT_MET: 'Did not work technically' } as const;

/** A title with phase / program words stripped, so successive phases of one effort match
    ("Bipolar 6TAGM batteries Phase I" ≈ "Bipolar 6TAGM batteries Phase II"). */
export function titleStem(t: string) {
  const s = t.toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/\b(sbir|sttr|phase\s*(iii|ii|i|iv|[1-4])|pilot|study|feasibility|prototype|follow[- ]on|continuation|part\s*\d+|year\s*\d+)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 1);
  return s.slice(0, 6).join(' ');
}

const phaseNum = (t: string) => { const m = t.toLowerCase().match(/phase\s*(iii|ii|i|[1-3])\b/); return m ? ({ i: 1, ii: 2, iii: 3 } as Record<string, number>)[m[1]] ?? Number(m[1]) : 0; };
/** For each project, the later projects that continue the same effort: same title stem, and either a
    later first data call or a higher phase numeral in the title. Derived from real titles only. */
export function followOns<T extends { id: number; title: string; first_fy: number }>(ps: T[]) {
  const byStem = new Map<string, T[]>();
  for (const p of ps) { const s = titleStem(p.title); if (s.split(' ').length < 2) continue; byStem.set(s, [...(byStem.get(s) ?? []), p]); }
  const out = new Map<number, T[]>();
  for (const group of byStem.values()) {
    if (group.length < 2) continue;
    for (const p of group) {
      const later = group.filter(o => o.id !== p.id && (o.first_fy > p.first_fy || (phaseNum(p.title) > 0 && phaseNum(o.title) > phaseNum(p.title))));
      if (later.length) out.set(p.id, later);
    }
  }
  return out;
}

/** Kotter's 8 Accelerators — adopted by the DLA SES Executive Board for senior leader accountability. */
export const KOTTER = [
  'Create a sense of urgency', 'Build a guiding coalition', 'Form a strategic vision and initiatives', 'Enlist a volunteer army',
  'Enable action by removing barriers', 'Generate short-term wins', 'Sustain acceleration', 'Institute change',
] as const;

export const ELEMENTS: Record<string, string> = {
  'LOG R&D': 'Logistics R&D',
  MANTECH: 'Manufacturing Technology',
  SBIR: 'Small Business Innovation Research',
};

export const PROGRAMS: Record<string, string> = {
  AM: 'Additive Manufacturing',
  AME: 'Advanced Microcircuit Emulation',
  AMTR: 'Acquisition Modernization Technology Research',
  BATTNET: 'Battery Network',
  CASTING: 'Casting',
  DLIR: 'Defense Logistics Information Research',
  ERP: 'Energy Readiness Program',
  FORGING: 'Forging',
  LTR: 'Logistics Technology Research',
  MUST: 'Military Unique Sustainment Technology',
  'SCM-S': 'Supply Chain Management — Sustainability',
  SDD: 'Strategic Distribution & Disposition',
  SUBNET: 'Subsistence Network',
  ARTET: 'Applied Research & Testing Emergent Technologies',
  SM: 'Strategic Materials',
  SBIR: 'SBIR (general)',
};

/** Normalize the various spellings of program codes seen in the workbooks. */
export function programCode(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  const map: Record<string, string> = { SCMS: 'SCM-S', 'SCM S': 'SCM-S', CASTINGS: 'CASTING', 'SBIP SM': 'SM' };
  return map[k] ?? k;
}

export function elementCode(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (k.startsWith('LOG')) return 'LOG R&D';
  if (k.startsWith('MANTECH') || k === 'MAN TECH') return 'MANTECH';
  if (k.startsWith('SBIR')) return 'SBIR';
  return k;
}

/* ───────── people ───────── */

/** Spelling variants of the same PM seen across the workbooks → one canonical name. */
/** Misspellings of people's names in the source data; the entries are customer-specific and live in esh.config.local.json. */
const PERSON_ALIASES: Record<string, string> = Object.fromEntries(Object.entries(config.personAliases ?? {}).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, ' '), v]));
export const personName = (raw: string | null) => (raw ? PERSON_ALIASES[raw.trim().toLowerCase().replace(/\s+/g, ' ')] ?? raw.trim().replace(/\s+/g, ' ') : null);

/* ───────── organizations ───────── */

export const NULLISH = new Set(['', 'n/a', 'na', 'none', 'tbd', 'multiple', '-', '--', 'n/a sbir project', 'no', 'unknown', '?']);

export const orgKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();

type OrgSeed = { name: string; kind: string; aliases: string[] };
export const ORG_SEEDS: OrgSeed[] = [
  { name: 'DLA J68 (R&D)', kind: 'DLA_JCODE', aliases: ['J68', 'DLA J68', 'DLA R&D', 'R&D', 'J-68', 'DLA J68 R&D'] },
  { name: 'DLA Aviation', kind: 'DLA_MSC', aliases: ['Aviation', 'DLA Aviation', 'DLA-Aviation', 'DLA AV'] },
  { name: 'DLA Land & Maritime', kind: 'DLA_MSC', aliases: ['Land & Maritime', 'Land and Maritime', 'DLA Land and Maritime', 'DLA Land & Maritime', 'L&M', 'DLA L&M', 'Land & Maritme', 'Land & Mrtm', 'DLA Land & Mrtm'] },
  { name: 'DLA Troop Support', kind: 'DLA_MSC', aliases: ['Troop Support', 'DLA Troop Support', 'DLA TS', 'TS', 'DLA Toop Support', 'Toop Support'] },
  { name: 'DLA Troop Support — Subsistence', kind: 'DLA_MSC', aliases: ['DLA Troop Support Subsistence', 'Troop Support Subsistence', 'Subsistence'] },
  { name: 'DLA Troop Support — C&T', kind: 'DLA_MSC', aliases: ['Troop Support C&T', 'C&T', 'Clothing & Textiles', 'Clothing and Textiles', 'Troop Support Clothing & Textiles', 'DLA Troop Support Clothing & Textiles'] },
  { name: 'DLA Troop Support — Class IV', kind: 'DLA_MSC', aliases: ['DLA Troop Support Class IV (CLIV)', 'DLA Troop Support Class IV', 'DLA Troop Support Customer Operations Construction & Equiptment Directorate Class IV'] },
  { name: 'US Army DEVCOM GVSC', kind: 'SERVICE', aliases: ['US Army GVSC', 'US Army DEVCOM GVSC', 'Army GVSC', 'GVSC'] },
  { name: 'US Army DEVCOM C5ISR', kind: 'SERVICE', aliases: ['US Army C5ISR', 'US Army DEVCOM C5ISR', 'C5ISR'] },
  { name: 'US Army DEVCOM CBC', kind: 'SERVICE', aliases: ['US Army DEVCOM CBC', 'DEVCOM CBC'] },
  { name: 'US Army Soldier Center (Natick)', kind: 'SERVICE', aliases: ['U.S. Army Soldier Center (Natick)', 'U.S. Army Soldier Center', 'US Army Soldier Center', 'Natick'] },
  { name: 'AFRL', kind: 'SERVICE', aliases: ['AFRL', 'Air Force Research Laboratory'] },
  { name: 'DLA Energy', kind: 'DLA_MSC', aliases: ['Energy', 'DLA Energy'] },
  { name: 'DLA Distribution', kind: 'DLA_MSC', aliases: ['Distribution', 'DLA Distribution'] },
  { name: 'DLA Distribution J5', kind: 'DLA_MSC', aliases: ['Distribution J5'] },
  { name: 'DLA Disposition Services', kind: 'DLA_MSC', aliases: ['Disposition', 'DLA Disposition', 'Disposition Services', 'DLA Disposition Services'] },
  { name: 'DLA Strategic Materials', kind: 'DLA_MSC', aliases: ['Strategic Materials', 'DLA Strategic Materials', 'DLA SM'] },
  { name: 'DLA Weapon Support', kind: 'DLA_MSC', aliases: ['Weapon Support', 'DLA Weapon Support', 'WS'] },
  { name: 'US Air Force', kind: 'SERVICE', aliases: ['USAF', 'US Air Force', 'Air Force', 'U.S. Air Force', 'AF', 'US AF'] },
  { name: 'US Navy', kind: 'SERVICE', aliases: ['USN', 'US Navy', 'Navy', 'U.S. Navy'] },
  { name: 'US Army', kind: 'SERVICE', aliases: ['US Army', 'Army', 'U.S. Army', 'USA'] },
  { name: 'US Marine Corps', kind: 'SERVICE', aliases: ['USMC', 'Marine Corps', 'US Marine Corps', 'Marines'] },
  { name: 'US Space Force', kind: 'SERVICE', aliases: ['USSF', 'Space Force'] },
  { name: 'US Coast Guard', kind: 'SERVICE', aliases: ['USCG', 'Coast Guard'] },
  { name: 'Military Services (all)', kind: 'SERVICE', aliases: ['Military Services', 'All Services', 'Military Service', 'Services'] },
  { name: 'NIWC', kind: 'SERVICE', aliases: ['NIWC', 'NIWC Atlantic', 'NIWC Pacific'] },
  { name: 'Johns Hopkins University', kind: 'ACADEMIA', aliases: ['John Hopkins University', 'Johns Hopkins University', 'JHU', 'JHU-APL', 'JHU APL', 'Johns Hopkins'] },
  { name: 'Advanced Technology International (ATI)', kind: 'INDUSTRY', aliases: ['Advanced Technology International', 'Advance Technology International', 'ATI', 'Advanced Technology International (ATI)', 'Advance Technology International (ATI)'] },
  { name: 'OSD R&E / A&S', kind: 'OSD', aliases: ['OSD', 'OSD R&E', 'OSD A&S', 'OSD, R&E or A&S'] },
];

/** J-codes like "J6", "DLA J344", "J5" → canonical "DLA J6" etc. */
export function jcode(raw: string): string | null {
  const m = raw.trim().match(/^(?:DLA\s*)?(J-?\d{1,3})$/i);
  return m ? 'DLA ' + m[1].toUpperCase().replace('-', '') : null;
}

/** Split a free-text org cell into individual names. Keeps "Land & Maritime" / "Land and Maritime" intact. */
export function splitOrgs(raw: string | null): string[] {
  if (!raw) return [];
  // drop N/A-style tokens first so "N/A" is not split into "N" and "A"
  const s = raw.replace(/\bn\s*\/\s*a\b/gi, '');
  // split on , ; newline / | — but never inside parentheses, e.g. "DLA Internal (J6/J3/MSC)"
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;\n\/|]/.test(ch)) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map(s => s.replace(/^and\s+/i, '').replace(/\s+/g, ' ').trim())
    .filter(s => s && !NULLISH.has(s.toLowerCase()));
}

/* ───────── priorities (alignment columns) ───────── */

const TYPO: [RegExp, string][] = [
  [/Distribtuion|Distrubtion/g, 'Distribution'], [/Strengthn/g, 'Strengthen'], [/Acqusition/g, 'Acquisition'],
  [/Digitzing/g, 'Digitizing'], [/Forcasting/g, 'Forecasting'], [/Antipating/g, 'Anticipating'],
  [/Adaptiblity/g, 'Adaptability'], [/Aglity/g, 'Agility'], [/D-Codes/g, 'D-Code'], [/\s+/g, ' '],
];
export function parsePriorityHeader(h: string): { owner: string; label: string } | null {
  let s = h;
  for (const [re, rep] of TYPO) s = s.replace(re, rep);
  const m = s.match(/^\s*([^:;]+?)\s*[:;]\s*(.+?)\s*$/);
  if (!m) return null;
  return { owner: m[1].trim(), label: m[2].replace(/\s+-\s+/g, '-').replace(/\s{2,}/g, ' ').trim() };
}

/* ───────── status ───────── */

export const STATUS_LABEL: Record<string, string> = {
  A: 'New Start', B: 'Ongoing', C: 'Monitoring', D: 'Completing / Cancelling', E: 'Complete',
};
export function statusCode(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^([A-E])\s*-/i);
  if (m) return m[1].toUpperCase();
  if (/^active$/i.test(s)) return 'B';
  if (/^complete/i.test(s)) return 'E';
  if (/^cancel/i.test(s)) return 'D';
  return null;
}

/* ───────── ESF phase suggestion ─────────
   The workbooks carry no ESF phase. We suggest one from status, transition fields, SBIR phase
   in the title and time elapsed in PoP. Every suggestion must be confirmed by a J68 admin. */
export function suggestPhase(p: {
  status_code: string | null; transition_phase: string | null; transition_type: string | null;
  title: string; element_code: string | null; pop_start: Date | null; pop_end: Date | null;
}, asOf: Date): { phase: number; status: 'ACTIVE' | 'HOLD' | 'AT_SCALE' | 'SUNSET' | 'DESCOPED'; reason: string } {
  const tp = (p.transition_phase ?? '').toLowerCase();
  const tt = (p.transition_type ?? '').toLowerCase();
  const hasTransitionTarget = !!tt && !/^n\/?a$/.test(tt) && !tt.startsWith('dtic');
  const months = p.pop_start ? (asOf.getTime() - p.pop_start.getTime()) / 2629800000 : null;
  const sbirPhase = p.title.match(/phase\s*(iii|ii|i|3|2|1)\b/i)?.[1]?.toLowerCase();
  const byElapsed = (): number => months == null ? 1 : months < 6 ? 1 : months < 30 ? 2 : 3;

  switch (p.status_code) {
    case 'A':
      return { phase: 0, status: 'ACTIVE', reason: 'Status A — New Start → Stage 0 intake' };
    case 'C':
      return { phase: 4, status: 'ACTIVE', reason: 'Status C — Monitoring → Phase IV transition' };
    case 'E':
      if (tp.startsWith('complete'))
        return { phase: 5, status: 'AT_SCALE', reason: 'Complete with transition complete → Stage 5' };
      if (tp.startsWith('dtic'))
        return { phase: 2, status: 'DESCOPED', reason: 'Complete; outcome was a DTIC report, not a fielded transition → managed exit (descoped)' };
      return { phase: Math.min(byElapsed(), 3), status: 'SUNSET', reason: 'Complete without a recorded transition → managed exit' };
    case 'D':
      if (hasTransitionTarget && tp !== 'complete')
        return { phase: 4, status: 'ACTIVE', reason: `Completing with transition target "${p.transition_type}" → Phase IV` };
      return { phase: Math.min(byElapsed(), 3), status: 'SUNSET', reason: 'Completing/cancelling with no transition target → likely sunset' };
    case 'B':
    default: {
      if (p.element_code === 'SBIR' && sbirPhase) {
        const n = { i: 1, '1': 1, ii: 2, '2': 2, iii: 3, '3': 3 }[sbirPhase] ?? 1;
        return { phase: n, status: 'ACTIVE', reason: `Ongoing SBIR, title says Phase ${sbirPhase.toUpperCase()}` };
      }
      if (tp.startsWith('complete'))
        return { phase: 4, status: 'ACTIVE', reason: 'Ongoing with transition marked complete → Phase IV' };
      const ph = byElapsed();
      return { phase: ph, status: 'ACTIVE', reason: months == null ? 'Ongoing, no PoP start → Phase I' : `Ongoing, ${Math.round(months)} months into PoP → ${PHASES[ph].short}` };
    }
  }
}
