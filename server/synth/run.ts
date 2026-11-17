/* Synthetic ESF lifecycle data for the sandbox demo.

   The workbooks supply the project inventory. This fills the lifecycle layer ESH adds on top of it:
   confirmed phases, phase history, gate decisions, criteria evidence, funding lines, value cases,
   transition pathways and an audit trail, plus five scripted demo scenarios.
   Generation is anchored on each real project (its suggested phase, PoP dates, sponsor, title),
   deterministic per seed, and every row is flagged `synthetic`.

   Usage:  npm run synth                 replace any synthetic data (seed 2027)
           npm run synth -- --seed=7     a different, equally repeatable draw
           npm run synth -- --remove     delete all synthetic data and restore suggested phases
   Stop the server first: the embedded database allows one process at a time. */
import type { Transaction } from '@electric-sql/pglite';
import { getDb, closeDb } from '../db/db.js';
import { AS_OF, ROOT, config } from '../config.js';
import { CRITERIA, followOns, suggestPhase, type ExitReason } from '../domain.js';
import { seedPeople, removePeople } from './people.js';
import { seedOps, removeOps } from './ops.js';
import { seedBenefits, removeBenefits } from './benefits.js';
import { seedOwnership } from './ownership.js';
import { seedRealization, removeRealization } from './realization.js';
import { seedOverlap, removeOverlap } from './overlap.js';
import { rngFor, type R } from './util.js';
import { fillInventory, inventoryGaps, removeFill } from './fill.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED = Number(process.argv.find(a => a.startsWith('--seed='))?.slice(7)) || 2027;
const REMOVE = process.argv.includes('--remove');
const GAPS_ONLY = process.argv.includes('--gaps');
/** Left untouched so the live walkthrough (confirm phase → criteria → gate) still works on it. Set in esh.config.local.json. */
const KEEP_UNSEEDED = new Set((config.demo?.keepUnseeded ?? []).map(t => t.trim().toUpperCase()));
/** The J1 walkthrough project ("intake to scale"): a configured title, else the first live Gen AI project. */
const FLAGSHIP = config.demo?.flagshipTitle?.trim().toLowerCase() ?? '';
export const isFlagship = (title: string, s?: { status: string }) =>
  FLAGSHIP ? title.trim().toLowerCase() === FLAGSHIP : /gen ?ai|\bllm\b|language model/i.test(title) && (!s || s.status === 'ACTIVE');

const DAY = 864e5;
const J1_USER = 'J1 Human Capital Transformation';
/** Demo assumption: J1's gate roles (white paper §3.1) apply to gate decisions from FY26 on; earlier gates show "not assessed". */
const J1_ADOPTED = new Date(Date.UTC(2025, 9, 1));
const ORDS: Record<number, number[]> = Object.fromEntries(Object.entries(CRITERIA).map(([g, l]) => [Number(g), l.map((_, i) => i + 1)]));
const J1_ORD: Record<number, number> = Object.fromEntries(Object.entries(CRITERIA).flatMap(([g, l]) => l.flatMap((c, i) => (c.owner === 'J1' ? [[Number(g), i + 1]] : []))));
const MID_MONTHS = [1, 4.5, 21, 18, 15, 0];           // design duration midpoints per phase (domain PHASES)
const ADMIN = 'J68 Portfolio Admin', DCG = 'Gate Authority (DCG)';
const GATE_AUTHORITY = ['J68 R&D Portfolio Board', 'J68 R&D Portfolio Board', 'J68 Director', DCG, DCG];
const MSC = /DLA (Aviation|Land and Maritime|Troop Support|Distribution|Energy|Disposition)/i;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const minD = (...ds: Date[]) => new Date(Math.min(...ds.map(d => d.getTime())));
const maxD = (...ds: Date[]) => new Date(Math.max(...ds.map(d => d.getTime())));
const $m = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
const round5k = (n: number) => Math.round(n / 5000) * 5000;


type Status = 'ACTIVE' | 'HOLD' | 'AT_SCALE' | 'SUNSET' | 'DESCOPED';
type Proj = {
  id: number; esh_id: string; title: string; element_code: string | null; program_code: string | null; status_code: string | null;
  pop_start: Date | null; pop_end: Date | null; first_fy: number; transition_phase: string | null; transition_type: string | null;
  pm: string | null; sponsor: string | null; npri: number; fys: number[];
};
type Crit = { gate: number; ord: number; status: 'MET' | 'PENDING' | 'WAIVED'; evidence: string | null; by: string; at: Date };
type Gen = {
  phase: number; status: Status; suggested: { phase: number; status: Status };
  entered: Date[]; end: Date;
  gates: { gate: number; outcome: 'PASS' | 'HOLD' | 'SUNSET' | 'DESCOPE'; date: Date; authority: string; rationale: string; exit_reason?: ExitReason; technical_result?: 'MET' | 'PARTIAL' | 'NOT_MET' }[];
  crits: Crit[];
  funding: { fy: number; appropriation: string; source: string; amount: number; pop_end: Date | null }[];
  values: { path: 'REVENUE' | 'COST' | 'RISK' | 'PERFORMANCE'; is_primary: boolean; metric: string; baseline: string; projected: string; annual_value: number; narrative: string; j8_certified: boolean }[];
  paths: { path: 'A_WCF' | 'B_POM'; mechanism: string; status: 'DECLARED' | 'COMMITTED' | 'ACTIVE'; committed_at: Date | null }[];
  confirmedAt: Date;
};
type Opts = { phase?: number; status?: Status; currentSince?: Date; end?: Date; ready?: boolean; noCorrection?: boolean };

/* ── text templates ── */
const EVIDENCE: Record<number, ((x: { sp: string; d: string; r: R }) => string)[]> = {
  0: [x => `Signed LOI — ${x.sp}, ${x.d}`, x => `Problem statement v1.${x.r.int(0, 3)} approved ${x.d}`, x => `Value path memo filed ${x.d}`,
      x => `ROM estimate ${$m(round5k(x.r.between(250e3, 3e6)))} — J68 cost team, ${x.d}`, x => `Duplication check vs DTIC / SPM — no overlap (${x.d})`],
  1: [x => `JHU-APL TRA report APL-${x.r.int(2100, 2999)}: 5/5 satisfactory`, x => `Validation brief on DLA ${x.r.pick(['EBS', 'DSS', 'FLIS', 'DIBBS', 'WebFLIS'])} data, ${x.d}`,
      x => `CONOPS v${x.r.int(1, 3)}.0 reviewed with ${x.sp}`, x => `Final S&T report, CDRL A00${x.r.int(1, 9)}, delivered ${x.d}`, x => `Co-sponsor reaffirmation email, ${x.sp}, ${x.d}`],
  2: [x => `PRR minutes ${x.d}`, x => `J8 ROI certification memo J8-${x.d.slice(2, 4)}-${x.r.int(100, 480)}`, x => `Transition plan v${x.r.int(1, 3)}.0 declared ${x.d}`,
      x => `Written reaffirmation, ${x.sp}, ${x.d}`, x => `Stakeholder sign-off (J7, J8, RM, J6) ${x.d}`],
  3: [x => `SES funding commitment signed ${x.d}`, x => `Deployment report: ${x.r.int(2, 6)} sites, ${x.r.int(40, 900)} users`, x => `J6 ATO plan approved ${x.d}`,
      x => `J6 sandbox connectivity test passed ${x.d}`, x => `OGC/J7 bridge eligibility memo ${x.d}`,
      x => `Change management statement ${x.d}`,   // ord 6 is J1's (J1_EVIDENCE); kept so ord 7 lines up
      x => `Pathway committed by ${x.sp}, ${x.d}`],  // ord 7, Hub proposal: rewritten from the pathway in synth/ownership.ts
  4: [x => `Operational acceptance memo — ${x.sp}, ${x.d}`, x => `J7 closeout / novation confirmed ${x.d}`, x => `Funding line active in ${x.sp} execution plan`,
      x => `Quarterly performance review schedule set ${x.d}`, x => `Lessons learned report filed ${x.d}`],
};
const J1_EVIDENCE: Record<number, (x: { sp: string; d: string; r: R }) => string> = {
  0: x => `Workforce screening ${x.d}: staffing plan names ${x.r.int(3, 7)} staff, no overcommitment flags`,
  2: x => `CM Impact Assessment ${x.d}: readiness ${x.r.int(3, 5)}/5, training plan approved before go-live`,
  3: x => `Change management statement on the DCG brief, ${x.d}; SES sponsor accountable under Kotter accelerators 1–3`,
  4: x => `Workforce absorption memo ${x.d}: ${x.r.int(72, 94)}% adoption at 90 days, no staffing gaps`,
};
const evidenceFor = (gate: number, ord: number, x: { sp: string; d: string; r: R }) => (J1_ORD[gate] === ord ? J1_EVIDENCE[gate](x) : EVIDENCE[gate][ord - 1](x));

/** A waiver reason that fits each waivable criterion (non-waivable ones have none). */
const WAIVER: Record<string, string> = {
  '0:2': 'problem statement carried over from the predecessor effort',
  '0:3': 'value path to be declared in Phase I by board direction',
  '0:4': 'cost bounded by the SBIR topic award ceiling',
  '0:5': 'continuation of an effort already checked for duplication',
  '1:2': 'DLA data access pending J6 data-sharing agreement; validate before Gate 2',
  '1:3': 'CONOPS folded into the sponsor\'s existing CONOPS',
  '1:4': 'interim S&T report accepted; final due at Phase II midpoint',
  '1:5': 'sponsor reaffirmation recorded in PMR minutes',
  '2:1': 'PRR combined with the sponsor\'s design review',
  '2:3': 'transition path declared at Gate 1 still current',
  '2:4': 'sponsor reaffirmation recorded in PMR minutes',
  '2:5': 'non-IT effort — J6 sign-off not required',
  '3:2': 'single-MSC capability; one deployment site accepted',
  '3:3': 'non-IT effort — no ATO required',
  '3:4': 'non-IT effort — no J6 sandbox required',
  '3:5': 'no bridge funding needed; sponsor funds from FY start',
  '4:1': 'acceptance delegated to the MSC program office',
  '4:3': 'funding mechanism confirmed in the sponsor POM submission',
  '4:4': 'reviews held through the sponsor\'s existing PMR cycle',
  '4:5': 'lessons learned captured in the final S&T report',
};
const PASS_RATIONALE = [
  'Sponsor LOI in hand and problem scoped; approved to enter Phase I feasibility.',
  'TRA satisfactory and value hypothesis validated on DLA data; proceed to prototype.',
  'PRR complete and J8 ROI certified; approved for limited deployment.',
  'SES funding commitment signed and multi-site deployment successful; approved for transition.',
  'Operational owner accepted; funding mechanism active; transitioned to sustainment at scale.',
];
const HOLD_RATIONALE = (gate: number, hard: string) => `Hold at Gate ${gate}: "${hard}" (non-waivable) outstanding. Revisit at next board.`;
/** Exit stories, each with its structured reason and technical result, so the exits dashboard can count them. */
const SUNSET_RATIONALE: { t: string; reason: ExitReason; tech: 'MET' | 'PARTIAL' | 'NOT_MET'; w: number }[] = [
  { t: 'The technology worked at test, but no operational owner would commit follow-on funding. Close out and file the S&T report.', reason: 'NO_OWNER', tech: 'MET', w: 3 },
  { t: 'Value hypothesis not validated on DLA data; the measured benefit was well below the Stage 0 estimate. Close out at PoP end.', reason: 'VALUE', tech: 'PARTIAL', w: 3 },
  { t: 'Technical results below threshold at test; residual knowledge captured in the final report.', reason: 'TECHNICAL', tech: 'NOT_MET', w: 2 },
  { t: 'Sponsor withdrew after a change in its priorities; no other directorate would take the project on.', reason: 'SPONSOR', tech: 'PARTIAL', w: 2 },
  { t: 'A commercial product now meets the need at lower cost; stop and redirect funds.', reason: 'SUPERSEDED', tech: 'MET', w: 1 },
];
const FOLLOW_ON_RATIONALE = 'This phase met its objectives; the work continues as a follow-on project, so this record closes here.';
const DESCOPE_RATIONALE = 'Descoped to an S&T report — findings published to DTIC; no transition planned.';
/** Projects whose work continues under a later project (same title stem, later data call or higher phase). Filled in main(). */
const HAS_FOLLOW_ON = new Set<number>();
const HARD_TEXT = ['Co-sponsor named (signed LOI)', 'JHU-APL TRA fully satisfactory (5/5)', 'J8 Finance ROI certification in writing', 'Signed funding commitment — SES level', 'J7 contract closeout / novation confirmed'];
const HARD_ORD = [1, 1, 2, 1, 2];

const METRICS: Record<Gen['values'][number]['path'], [string, string][]> = {
  COST: [['Analyst labor hours per year', 'hrs'], ['Cost per requisition processed', '$'], ['Inventory carrying cost per year', '$M']],
  RISK: [['Nonconforming / counterfeit part escapes per year', 'escapes'], ['Days to detect a supply disruption', 'days'], ['Sole-source NSNs without a qualified alternate', 'NSNs']],
  PERFORMANCE: [['Procurement administrative lead time', 'days'], ['Backorders on critical NSNs', 'lines'], ['First-pass yield', '%']],
  REVENUE: [['Reutilization and sales proceeds per year', '$M'], ['Material recovered for resale', 'tons']],
};
function valuePath(p: Proj): Gen['values'][number]['path'] {
  const t = p.title;
  if (/reclam|disposition|resale|recycl|demil|reutiliz/i.test(t)) return 'REVENUE';
  if (/cyber|counterfeit|secur|resilien|risk|detect|authentic|blockchain|illumin|obsolesc|dmsms|anomal|fraud/i.test(t)) return 'RISK';
  if (/additive|\bam\b|manufactur|casting|forg|batter|fuel|energy|readiness|lead time|repair|material/i.test(t)) return 'PERFORMANCE';
  if (/cost|predict|automat|\bai\b|machine learning|llm|analytic|optimi|inventory|forecast|robot|model/i.test(t)) return 'COST';
  return p.element_code === 'MANTECH' ? 'PERFORMANCE' : 'COST';
}
function measure(path: Gen['values'][number]['path'], r: R) {
  const [metric, unit] = r.pick(METRICS[path]);
  const imp = r.between(0.15, 0.55);
  const fmt = (n: number) => unit === '$M' ? `$${n.toFixed(1)}M` : unit === '$' ? `$${n.toFixed(2)}` : unit === '%' ? `${n.toFixed(0)}%` : `${Math.round(n).toLocaleString('en-US')} ${unit}`;
  const base = unit === '$M' ? r.between(2, 40) : unit === '$' ? r.between(8, 120) : unit === '%' ? r.between(58, 82) : unit === 'hrs' ? r.between(8e3, 120e3)
    : unit === 'days' ? r.between(30, 240) : unit === 'tons' ? r.between(200, 5000) : r.between(40, 1500);
  const up = path === 'REVENUE' || unit === '%';
  const proj = unit === '%' ? Math.min(98, base + r.between(5, 15)) : up ? base * (1 + imp) : base * (1 - imp);
  return { metric, baseline: fmt(base), projected: fmt(proj), pct: Math.round(imp * 100) };
}

/* ── the generator ── */
function generate(p: Proj, r: R, o: Opts = {}): Gen {
  const sug = suggestPhase(p, AS_OF) as { phase: number; status: Status };
  let phase = o.phase ?? sug.phase;
  let status: Status = o.status ?? sug.status;
  if (!o.noCorrection && o.phase == null && status === 'ACTIVE' && phase >= 1 && phase <= 3 && r.chance(0.1)) phase += r.chance(0.5) ? 1 : -1;
  if (o.status == null && status === 'ACTIVE' && phase < 5 && r.chance(0.06)) status = 'HOLD';
  const exit = status === 'SUNSET' || status === 'DESCOPED';
  const live = status === 'ACTIVE' || status === 'HOLD';
  const end = o.end ?? (exit ? minD(p.pop_end ?? AS_OF, add(AS_OF, -r.between(5, 150))) : AS_OF);

  /* timeline: entered[k] = date the project entered phase k */
  let entered: Date[];
  if (phase === 0) entered = [add(end, -r.between(10, 75))];
  else {
    const w = Array.from({ length: phase - 1 }, (_, i) => MID_MONTHS[i + 1] * r.between(0.6, 1.4));
    const curW = phase === 5 ? r.between(4, 14) : MID_MONTHS[phase] * (exit ? r.between(0.3, 1) : r.between(0.15, 1));
    const W = w.reduce((a, b) => a + b, 0);
    let start = p.pop_start ?? new Date(Date.UTC(p.first_fy - 1, 9, 1));
    let cur: Date;
    if (o.currentSince) {
      cur = o.currentSince;
      const need = (phase - 1) * 75 * DAY;
      if (cur.getTime() - start.getTime() < need) start = new Date(cur.getTime() - need);
      if (phase === 1) start = cur;
    } else {
      let span = end.getTime() - start.getTime();
      const min = phase * 35 * DAY;
      if (span < min) { start = new Date(end.getTime() - min); span = min; }
      cur = new Date(start.getTime() + span * W / (W + curW));
    }
    entered = [add(start, -r.between(25, 90)), start];
    const span2 = cur.getTime() - start.getTime();
    let t = start.getTime();
    for (let k = 1; k < phase; k++) { t += W ? span2 * w[k - 1] / W : 0; entered[k + 1] = new Date(t); }
    entered[phase] = cur;
  }

  const g: Gen = { phase, status, suggested: sug, entered, end, gates: [], crits: [], funding: [], values: [], paths: [], confirmedAt: AS_OF };
  const sp = p.sponsor ?? 'sponsor not named in the data call';
  const by = p.pm ?? ADMIN;
  const ev = (gate: number, ord: number, d: Date) => evidenceFor(gate, ord, { sp, d: iso(d), r });

  /* gates passed on the way here, each with every criterion closed */
  for (let k = 0; k < phase; k++) {
    const date = entered[k + 1];
    g.gates.push({ gate: k, outcome: 'PASS', date, authority: GATE_AUTHORITY[k], rationale: PASS_RATIONALE[k] });
    for (const ord of ORDS[k]) {
      const at = maxD(entered[k], add(date, -r.between(3, 45)));
      const hard = HARD_ORD[k] === ord;
      if (J1_ORD[k] === ord) {
        if (date < J1_ADOPTED) g.crits.push({ gate: k, ord, status: 'WAIVED', evidence: 'Not assessed — gate decided before J1 criteria were added to the ESF (FY26)', by: ADMIN, at });
        else g.crits.push({ gate: k, ord, status: 'MET', evidence: ev(k, ord, at), by: J1_USER, at });
        continue;
      }
      if (!hard && WAIVER[`${k}:${ord}`] && r.chance(0.08)) g.crits.push({ gate: k, ord, status: 'WAIVED', evidence: `Waived by ${GATE_AUTHORITY[k]} — ${WAIVER[`${k}:${ord}`]}`, by: ADMIN, at });
      else g.crits.push({ gate: k, ord, status: 'MET', evidence: ev(k, ord, at), by, at });
    }
  }

  /* the gate the project is working toward now */
  if (phase < 5) {
    const gate = Math.min(phase, 4);
    const ref = live ? AS_OF : end;
    const f = (ref.getTime() - entered[phase].getTime()) / (Math.max(MID_MONTHS[phase], 1) * 30.44 * DAY);
    const ready = o.ready ?? (status === 'ACTIVE' && r.chance(0.04));
    for (const ord of ORDS[gate]) {
      const hard = HARD_ORD[gate] === ord;
      let met = ready || r.chance(Math.min(0.85, Math.max(0, 0.1 + 0.75 * f)) * (hard ? 0.55 : 1));
      if (status === 'HOLD' && hard) met = false;
      if (!met) continue;
      const at = minD(ref, add(entered[phase], r.between(7, Math.max(8, (ref.getTime() - entered[phase].getTime()) / DAY))));
      g.crits.push({ gate, ord, status: 'MET', evidence: ev(gate, ord, at), by: J1_ORD[gate] === ord ? J1_USER : by, at });
    }
    if (status === 'HOLD') {
      const date = minD(add(AS_OF, -3), maxD(add(entered[phase], 30), add(AS_OF, -r.between(20, 120))));
      g.gates.push({ gate, outcome: 'HOLD', date, authority: GATE_AUTHORITY[gate], rationale: HOLD_RATIONALE(gate, HARD_TEXT[gate]) });
    }
    if (exit) {
      const report = status === 'DESCOPED' || /dtic/i.test(p.transition_phase ?? '') || /dtic/i.test(p.transition_type ?? '');
      const story = HAS_FOLLOW_ON.has(p.id) ? { t: FOLLOW_ON_RATIONALE, reason: 'FOLLOW_ON' as ExitReason, tech: r.chance(0.8) ? 'MET' as const : 'PARTIAL' as const }
        : report ? { t: DESCOPE_RATIONALE, reason: 'KNOWLEDGE' as ExitReason, tech: r.pick(['MET', 'PARTIAL', 'PARTIAL'] as const) }
        : SUNSET_RATIONALE[r.weighted(SUNSET_RATIONALE.map(s => s.w))];
      g.gates.push({ gate, outcome: status === 'SUNSET' ? 'SUNSET' : 'DESCOPE', date: end, authority: GATE_AUTHORITY[gate], rationale: story.t, exit_reason: story.reason, technical_result: story.tech });
    }
  }

  /* transition pathway */
  const wantsPath = (phase >= 2 && live) || phase === 5;
  if (wantsPath && (phase >= 3 || r.chance(0.75))) {
    const tt = p.transition_type && !/^n\/?a$/i.test(p.transition_type) ? p.transition_type : null;
    const path: 'A_WCF' | 'B_POM' = MSC.test(p.sponsor ?? '') || /wcf|nsn|stock|catalog/i.test(tt ?? '') ? 'A_WCF' : 'B_POM';
    const mech = path === 'A_WCF' ? `Stock-funded NSN under ${MSC.test(p.sponsor ?? '') ? p.sponsor : 'DLA Troop Support'} (WCF cost recovery)` : `POM FY${r.int(28, 30)} program line — ${p.sponsor ?? 'DLA J6'}`;
    const committed = phase >= 3 ? minD(add(AS_OF, -2), add(entered[3], r.between(10, 75))) : null;
    g.paths.push({ path, mechanism: tt ? `${tt}: ${mech}` : mech, status: phase === 2 ? 'DECLARED' : phase === 3 ? 'COMMITTED' : 'ACTIVE', committed_at: committed });
  }

  /* value case */
  if (phase >= 1 && r.chance(phase >= 3 ? 0.95 : 0.8)) {
    const path = valuePath(p);
    const m = measure(path, r);
    // early-phase value is a hypothesis, so keep it modest; portfolio total should look like a realistic R&D return
    const scale = [0, [50e3, 250e3], [100e3, 900e3], [250e3, 2e6], [500e3, 4e6], [500e3, 4e6]][phase] as [number, number];
    const annual = round5k(r.between(...scale));
    const j8 = phase >= 3 || g.crits.some(c => c.gate === 2 && c.ord === 2 && c.status === 'MET');
    g.values.push({ path, is_primary: true, ...m, annual_value: annual, j8_certified: j8,
      narrative: `Reduces ${m.metric.toLowerCase()} by about ${m.pct}% for ${p.sponsor ?? 'DLA'} — roughly ${$m(annual)} a year once fielded. ${j8 ? 'Certified by J8.' : 'PM estimate, pending J8 certification at Gate 2.'}` });
    if (r.chance(0.25)) {
      const p2 = r.pick((['COST', 'RISK', 'PERFORMANCE'] as const).filter(x => x !== path));
      const m2 = measure(p2, r);
      g.values.push({ path: p2, is_primary: false, ...m2, annual_value: round5k(annual * r.between(0.1, 0.4)), j8_certified: false, narrative: `Secondary benefit: ${m2.metric.toLowerCase()} improves about ${m2.pct}%.` });
    }
  }

  /* funding: J68 R&D in phases I–IV, sponsor money from Phase III on */
  const phaseAt = (d: Date) => { if (exit && d > end) return -1; let k = -1; entered.forEach((e, i) => { if (e <= d) k = i; }); return k; };
  const gate4 = g.gates.find(x => x.gate === 4 && x.outcome === 'PASS')?.date;
  const path = g.paths[0]?.path;
  for (const fy of p.fys) {
    const probe = minD(add(new Date(Date.UTC(fy - 1, 9, 1)), 150), AS_OF);
    const k = phaseAt(probe);
    // ESF: J68 RDT&E funds Phases I–III; Phase IV gets none (a few slip through, as the fiscal-law register should catch)
    if (k >= 1 && (k <= 3 || (k === 4 && r.chance(0.08)))) {
      const amt = round5k(r.between(...([[0, 0], [100e3, 300e3], [300e3, 1.2e6], [600e3, 1.8e6], [200e3, 700e3]][k] as [number, number])));
      let pe = p.pop_end ?? new Date(Date.UTC(fy, 8, 30));
      if (gate4 && pe >= gate4) pe = add(gate4, -r.between(10, 60));       // RDT&E closes before Gate 4 (no ADA) — scenario 3 breaks this on purpose
      g.funding.push({ fy, appropriation: p.element_code === 'SBIR' ? 'RDT&E BA6' : 'RDT&E BA3', source: p.element_code === 'SBIR' ? 'J68 R&D (SBIR)' : 'J68 R&D', amount: amt, pop_end: pe });
    }
    // sponsors co-fund from Phase III on (a few Phase III projects run on J68 money alone — a fiscal-law risk)
    if (k >= 4 || (k === 3 && r.chance(0.9))) g.funding.push({ fy, appropriation: path === 'A_WCF' ? 'WCF' : 'O&M', source: p.sponsor ?? 'Sponsor MSC', amount: round5k(r.between(200e3, 1.2e6) * (k === 5 ? 1.5 : 1)), pop_end: new Date(Date.UTC(fy, 8, 30)) });
  }

  g.confirmedAt = minD(add(AS_OF, -1), maxD(entered[phase], add(AS_OF, -r.between(20, 330))));
  return g;
}

/* ── the five scripted scenarios ── */
type Scenario = { track?: 'ESF' | 'J1'; title: string; pick: (p: Proj, s: { phase: number; status: Status }) => boolean; build: (p: Proj, r: R) => Gen; story: (p: Proj, g: Gen) => string; look: string };
const after = (days: number) => add(AS_OF, -days);
const SCENARIOS: Scenario[] = [
  {
    title: 'Clean Gate 2 pass',
    pick: (p, s) => s.status === 'ACTIVE' && (s.phase === 2 || s.phase === 3) && p.element_code !== 'SBIR' && !!p.sponsor && p.npri > 0 && !!p.pop_end && p.pop_end > add(AS_OF, 120),
    build: (p, r) => {
      const g = generate(p, r, { phase: 3, status: 'ACTIVE', currentSince: after(40), noCorrection: true });
      const g2 = g.gates.find(x => x.gate === 2)!;
      g2.rationale = `All five Gate 2 criteria met with evidence. J8 certified the ROI in writing; ${p.sponsor} reaffirmed sponsorship and declared the transition path. Approved for limited deployment.`;
      g.crits = g.crits.filter(c => c.gate !== 3);
      g.crits = g.crits.map(c => c.gate === 2 ? { ...c, status: 'MET' as const, by: J1_ORD[2] === c.ord ? J1_USER : c.by, evidence: evidenceFor(2, c.ord, { sp: p.sponsor!, d: iso(add(g2.date, -(7 - c.ord) * 6)), r }) } : c);
      g.crits.push({ gate: 3, ord: 4, status: 'MET', evidence: `J6 sandbox connectivity test passed ${iso(after(12))}`, by: p.pm ?? ADMIN, at: after(12) });
      if (!g.values.length) g.values.push({ path: 'COST', is_primary: true, ...measure('COST', r), annual_value: 2.4e6, j8_certified: true, narrative: '' });
      g.values[0] = { ...g.values[0], is_primary: true, j8_certified: true, narrative: `${g.values[0].metric} improves from ${g.values[0].baseline} to ${g.values[0].projected} — ${$m(g.values[0].annual_value)} a year. Certified by J8 before Gate 2.` };
      g.paths = [{ path: MSC.test(p.sponsor ?? '') ? 'A_WCF' : 'B_POM', mechanism: g.paths[0]?.mechanism ?? `POM FY28 program line — ${p.sponsor}`, status: 'COMMITTED', committed_at: add(g2.date, 5) }];
      return g;
    },
    story: (p, g) => `Passed Gate 2 on ${iso(g.gates.find(x => x.gate === 2)!.date)} with every criterion evidenced, a J8-certified value case and a committed transition path. Now in Phase III working Gate 3.`,
    look: 'Gate 2 decision in ESF history · J8-certified value case · committed pathway · Gate 3 scorecard 1/5',
  },
  {
    title: 'Stuck on the non-waivable J8 ROI criterion',
    pick: (p, s) => s.status === 'ACTIVE' && s.phase === 2 && !!p.sponsor && !!p.pop_end && p.pop_end > add(AS_OF, 60),
    build: (p, r) => {
      const g = generate(p, r, { phase: 2, status: 'HOLD', currentSince: after(430), noCorrection: true });
      g.crits = g.crits.filter(c => c.gate !== 2);
      for (const ord of [1, 3, 4, 5, 6]) { const at = after(260 - ord * 25); g.crits.push({ gate: 2, ord, status: 'MET', evidence: evidenceFor(2, ord, { sp: p.sponsor!, d: iso(at), r }), by: ord === J1_ORD[2] ? J1_USER : p.pm ?? ADMIN, at }); }
      g.gates = g.gates.filter(x => x.outcome !== 'HOLD');
      g.gates.push({ gate: 2, outcome: 'HOLD', date: after(75), authority: 'J68 Director', rationale: 'Four of five criteria met. J8 returned the business case for a revised baseline and has not certified the ROI in writing — non-waivable. Hold until J8 certifies; re-brief at the next board.' });
      if (!g.values.length) g.values.push({ path: valuePath(p), is_primary: true, ...measure(valuePath(p), r), annual_value: 1.6e6, j8_certified: false, narrative: '' });
      g.values[0] = { ...g.values[0], j8_certified: false, narrative: `PM estimate of ${$m(g.values[0].annual_value)} a year. J8 asked for a sourced baseline for "${g.values[0].metric}" before certifying.` };
      g.paths = g.paths.length ? g.paths : [{ path: 'B_POM', mechanism: `POM FY28 program line — ${p.sponsor}`, status: 'DECLARED', committed_at: null }];
      return g;
    },
    story: () => `Fourteen months in Phase II with every Gate 2 criterion met except one. J8 ROI certification is non-waivable, so the board put it on HOLD 75 days ago. It cannot pass and cannot be waived through.`,
    look: 'HOLD status · Gate 2 scorecard 5/6 with the NON-WAIVABLE row pending · value case marked PM estimate',
  },
  {
    title: 'Anti-Deficiency Act exposure',
    pick: (p, s) => s.status === 'AT_SCALE',
    build: (p, r) => {
      const g = generate(p, r, { phase: 5, status: 'AT_SCALE', currentSince: after(150), noCorrection: true });
      const g4 = g.gates.find(x => x.gate === 4)!;
      g.funding.push({ fy: 2027, appropriation: 'RDT&E BA3', source: 'J68 R&D', amount: 640e3, pop_end: add(g4.date, 120) });
      return g;
    },
    story: (p, g) => `Transitioned at Gate 4 on ${iso(g.gates.find(x => x.gate === 4)!.date)}, but an FY27 J68 RDT&E line runs 120 days past that date. R&D money funding a fielded capability is an ADA risk for J8/J7 to resolve.`,
    look: 'ADA alert at the top of the Dashboard attention queue · FY27 J68 line with PoP end after the Gate 4 date',
  },
  {
    title: 'Sunset with lessons learned',
    pick: (p, s) => s.status === 'SUNSET' && !!p.pop_start,
    build: (p, r) => {
      const g = generate(p, r, { phase: 2, status: 'SUNSET', end: after(45), currentSince: after(420), noCorrection: true });
      g.crits = g.crits.filter(c => c.gate !== 2);
      g.crits.push({ gate: 2, ord: 1, status: 'MET', evidence: `PRR minutes ${iso(after(160))}`, by: p.pm ?? ADMIN, at: after(160) });
      g.crits.push({ gate: 2, ord: 3, status: 'MET', evidence: `Transition plan v1.0 declared ${iso(after(200))}`, by: p.pm ?? ADMIN, at: after(200) });
      const sg = g.gates.find(x => x.outcome === 'SUNSET')!;
      sg.exit_reason = 'VALUE'; sg.technical_result = 'PARTIAL';
      sg.rationale = 'Sunset at Gate 2. The prototype met its technical targets, but measured savings were about a third of the Stage 0 hypothesis and J8 declined to certify the ROI; the sponsor did not reaffirm. Lessons learned: validate the baseline with J8 at Stage 0, and secure written co-sponsor commitment before PRR.';
      g.values = [{ path: valuePath(p), is_primary: true, ...measure(valuePath(p), r), annual_value: 0, j8_certified: false, narrative: 'Not realized. Measured savings fell well short of the Stage 0 hypothesis; see the Gate 2 sunset rationale for lessons learned.' }];
      g.paths = [];
      return g;
    },
    story: () => 'Sunset at Gate 2 after the prototype missed its value case: J8 would not certify the ROI and the sponsor did not reaffirm. The decision records the lessons learned — a managed exit, not a quiet lapse.',
    look: 'Managed exits column on the Pipeline · SUNSET decision and lessons learned in ESF history',
  },
  {
    title: 'At-scale success with realized value',
    pick: (p, s) => s.status === 'AT_SCALE' && !!p.sponsor && !/J68/i.test(p.sponsor),
    build: (p, r) => {
      const g = generate(p, r, { phase: 5, status: 'AT_SCALE', currentSince: after(300), noCorrection: true });
      const path = valuePath(p), m = measure(path, r);
      g.values = [{ path, is_primary: true, ...m, annual_value: 6.8e6, j8_certified: true,
        narrative: `Realized FY26: ${$m(7.3e6)} against ${$m(6.8e6)} projected (J8 validated, ${iso(after(40))}). ${m.metric} went from ${m.baseline} to ${m.projected} across ${p.sponsor}.` }];
      g.paths = [{ path: 'A_WCF', mechanism: `Stock-funded under ${MSC.test(p.sponsor ?? '') ? p.sponsor : 'DLA Troop Support'} (WCF cost recovery)`, status: 'ACTIVE', committed_at: add(g.entered[4], 20) }];
      g.funding = g.funding.filter(f => /^J68/.test(f.source));
      g.funding.push({ fy: 2026, appropriation: 'WCF', source: p.sponsor!, amount: 2.1e6, pop_end: new Date(Date.UTC(2026, 8, 30)) });
      g.funding.push({ fy: 2027, appropriation: 'WCF', source: p.sponsor!, amount: 2.4e6, pop_end: new Date(Date.UTC(2027, 8, 30)) });
      return g;
    },
    story: (p, g) => `Reached At Scale on ${iso(g.entered[5])}. ${p.sponsor} now funds it from WCF, and J8 validated ${$m(7.3e6)} of realized value in FY26 against ${$m(6.8e6)} projected.`,
    look: 'Stage 5 locator · realized value narrative · sponsor WCF funding replacing J68 R&D · ACTIVE Path A',
  },
  {
    track: 'J1',
    title: 'Intake to scale, with J1 at every gate',
    pick: (p, s) => isFlagship(p.title, s),
    build: (p, r) => {
      const g = generate(p, r, { phase: 3, status: 'ACTIVE', currentSince: after(110), noCorrection: true });
      // J1 was in from intake on this one: screening at Gate 0 and the readiness check at Gate 2, both evidenced
      g.crits = g.crits.map(c => c.ord === J1_ORD[c.gate] && c.gate < 3
        ? { ...c, status: 'MET' as const, by: J1_USER, evidence: evidenceFor(c.gate, c.ord, { sp: p.sponsor ?? 'DLA', d: iso(c.at), r }) } : c);
      g.crits = g.crits.filter(c => !(c.gate === 3 && c.ord === J1_ORD[3]));   // Gate 3 change management statement still in work
      return g;
    },
    story: (_p, g) => `An early pilot of J1 in the ESF: J1 screened the staffing plan at intake (${iso(g.gates.find(x => x.gate === 0)!.date)}) and ran the CM Impact Assessment before Gate 2 (${iso(g.gates.find(x => x.gate === 2)!.date)}). ` +
      'Now in limited deployment: the change management statement for the DCG brief is in work, and the rollout will reach about 5,500 analysts, inventory and contract specialists across DLA.',
    look: 'Workforce & change card on the record: J1 touchpoints G0 ✓ G2 ✓ G3 in work · who the change reaches · training before go-live · sponsor and transition-partner POCs',
  },
];

/* ── persistence ── */
async function removeSynthetic(tx: Transaction) {
  await removeOverlap(tx);
  await removeRealization(tx);
  await removeBenefits(tx);
  await removeOps(tx);
  await removePeople(tx);
  const unfilled = await removeFill(tx);
  await tx.exec(`DELETE FROM demo_scenario; DELETE FROM audit_event WHERE synthetic; DELETE FROM gate_decision WHERE synthetic;
    DELETE FROM criterion_status WHERE synthetic; DELETE FROM funding_line WHERE synthetic; DELETE FROM value_case WHERE synthetic;
    DELETE FROM transition_pathway WHERE synthetic; DELETE FROM phase_record WHERE synthetic;`);
  const n = (await tx.query<{ n: number }>('SELECT count(*)::int n FROM project WHERE esf_synthetic')).rows[0].n;
  await resuggest(tx);
  return { projects: n, unfilled };
}

/** Recompute the suggested ESF phase (and its initial phase record) for every unconfirmed or synthetic-confirmed project,
    from the project's current fields — run after inventory gaps are filled or restored. */
async function resuggest(tx: Transaction) {
  const ps = (await tx.query<any>(`SELECT id, status_code, transition_phase, transition_type, title, element_code, pop_start, pop_end, first_fy
    FROM project WHERE esf_synthetic OR esf_source = 'SUGGESTED'`)).rows;
  for (const p of ps) {
    const s = suggestPhase(p, AS_OF);
    await tx.query(`UPDATE project SET esf_phase=$2, esf_status=$3, esf_source='SUGGESTED', esf_reason=$4, esf_synthetic=false WHERE id=$1`, [p.id, s.phase, s.status, s.reason]);
    await tx.query('DELETE FROM phase_record WHERE project_id=$1 AND NOT synthetic', [p.id]);
    const entered = p.pop_start ?? new Date(Date.UTC(p.first_fy - 1, 9, 1));   // same initial record the importer writes
    await tx.query('INSERT INTO phase_record (project_id, phase, entered_at, exited_at) VALUES ($1,$2,$3,$4)',
      [p.id, s.phase, iso(new Date(entered)), ['ACTIVE', 'HOLD', 'AT_SCALE'].includes(s.status) || !p.pop_end ? null : iso(new Date(p.pop_end))]);
  }
}

async function write(tx: Transaction, p: Proj, g: Gen, critId: Map<string, number>, r: R) {
  const stamp = (d: Date) => { const x = new Date(d); x.setUTCHours(13 + r.int(0, 8), r.int(0, 59), r.int(0, 59)); return x.toISOString(); };
  const audits: { at: string; actor: string; action: string; before: unknown; after: unknown }[] = [];
  const pm = p.pm ?? ADMIN;

  await tx.query(`UPDATE project SET esf_phase=$2, esf_status=$3, esf_source='CONFIRMED', esf_reason=$4, esf_synthetic=true WHERE id=$1`,
    [p.id, g.phase, g.status, `Confirmed by ${ADMIN} on ${iso(g.confirmedAt)} (synthetic demo data)`]);
  // the triage entry shows the status as of its own date: a later HOLD/SUNSET/DESCOPE decision hasn't happened yet
  const laterExit = g.gates.some(x => x.outcome !== 'PASS' && x.date > g.confirmedAt);
  audits.push({ at: stamp(g.confirmedAt), actor: ADMIN, action: 'ESF_TRIAGE', before: { esf_phase: g.suggested.phase, esf_status: g.suggested.status, esf_source: 'SUGGESTED' },
    after: { phase: g.phase, status: laterExit ? 'ACTIVE' : g.status, esf_source: 'CONFIRMED' } });

  await tx.query('DELETE FROM phase_record WHERE project_id=$1', [p.id]);
  const exit = g.status === 'SUNSET' || g.status === 'DESCOPED';
  for (let k = 0; k <= g.phase; k++)
    await tx.query('INSERT INTO phase_record (project_id, phase, entered_at, exited_at, synthetic) VALUES ($1,$2,$3,$4,true)',
      [p.id, k, iso(g.entered[k]), k < g.phase ? iso(g.entered[k + 1]) : exit ? iso(g.end) : null]);

  for (const x of g.gates) {
    await tx.query('INSERT INTO gate_decision (project_id, gate, outcome, decided_at, authority, rationale, recorded_by, created_at, exit_reason, technical_result, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)',
      [p.id, x.gate, x.outcome, iso(x.date), x.authority, x.rationale, ADMIN, stamp(x.date), x.exit_reason ?? null, x.technical_result ?? null]);
    audits.push({ at: stamp(x.date), actor: x.authority === DCG ? DCG : ADMIN, action: 'GATE_DECISION', before: null, after: { gate: x.gate, outcome: x.outcome, rationale: x.rationale } });
  }
  for (const c of g.crits) {
    await tx.query('INSERT INTO criterion_status (project_id, criterion_id, status, evidence, updated_by, updated_at, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [p.id, critId.get(`${c.gate}:${c.ord}`), c.status, c.evidence, c.by, stamp(c.at)]);
    audits.push({ at: stamp(c.at), actor: c.by, action: 'CRITERION', before: null, after: { gate: c.gate, ord: c.ord, status: c.status, evidence: c.evidence } });
  }
  for (const f of g.funding) {
    await tx.query('INSERT INTO funding_line (project_id, fy, appropriation, source, amount, pop_end, synthetic) VALUES ($1,$2,$3,$4,$5,$6,true)',
      [p.id, f.fy, f.appropriation, f.source, f.amount, f.pop_end ? iso(f.pop_end) : null]);
    audits.push({ at: stamp(minD(AS_OF, new Date(Date.UTC(f.fy - 1, 9, 10 + r.int(0, 30))))), actor: pm, action: 'FUNDING_ADD', before: null, after: { fy: f.fy, appropriation: f.appropriation, source: f.source, amount: f.amount } });
  }
  for (const v of g.values) {
    await tx.query('INSERT INTO value_case (project_id, path, is_primary, metric, baseline, projected, annual_value, narrative, j8_certified, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',
      [p.id, v.path, v.is_primary, v.metric, v.baseline, v.projected, v.annual_value, v.narrative, v.j8_certified]);
    audits.push({ at: stamp(minD(AS_OF, add(g.entered[Math.min(1, g.phase)], 30))), actor: pm, action: 'VALUE_CASE_ADD', before: null, after: { path: v.path, metric: v.metric, annual_value: v.annual_value } });
  }
  for (const t of g.paths) {
    await tx.query('INSERT INTO transition_pathway (project_id, path, mechanism, status, committed_at, synthetic) VALUES ($1,$2,$3,$4,$5,true)',
      [p.id, t.path, t.mechanism, t.status, t.committed_at ? iso(t.committed_at) : null]);
    audits.push({ at: stamp(minD(AS_OF, add(g.entered[Math.min(2, g.phase)], 20))), actor: pm, action: 'PATHWAY_DECLARE', before: null, after: { path: t.path, mechanism: t.mechanism } });
    if (t.committed_at) audits.push({ at: stamp(t.committed_at), actor: pm, action: 'PATHWAY_ADVANCE', before: { status: 'DECLARED' }, after: { status: 'COMMITTED' } });
    if (t.status === 'ACTIVE') audits.push({ at: stamp(minD(AS_OF, add(g.entered[4], 30))), actor: pm, action: 'PATHWAY_ADVANCE', before: { status: 'COMMITTED' }, after: { status: 'ACTIVE' } });
  }
  for (const a of audits)
    await tx.query('INSERT INTO audit_event (at, actor, entity, entity_id, action, before, after, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
      [a.at, a.actor, 'project', p.esh_id, a.action, a.before == null ? null : JSON.stringify(a.before), JSON.stringify(a.after)]);
  return audits.length;
}

async function main() {
  const db = await getDb();
  await db.transaction(async tx => {
    const removed = await removeSynthetic(tx);
    const gaps = await inventoryGaps(tx);
    mkdirSync(resolve(ROOT, 'data'), { recursive: true });
    writeFileSync(resolve(ROOT, 'data/gap-report.json'), JSON.stringify({ asOf: AS_OF.toISOString().slice(0, 10), ...gaps }, null, 2));
    console.log(`Inventory gaps (real data, ${gaps.total} projects):`, gaps.counts);
    if (GAPS_ONLY) { console.log('Contract number samples:', gaps.contractSamples.join(' | ')); throw new Error('ROLLBACK (--gaps is read-only)'); }
    if (REMOVE) { console.log(`Removed synthetic data from ${removed.projects} projects and ${removed.unfilled} filled fields; real blanks and suggested phases are restored.`); return; }

    const filled = await fillInventory(tx, SEED, AS_OF);
    console.log(`Filled ${filled.filled} inventory gaps on ${filled.projects} projects:`, JSON.stringify(filled.byField));
    console.log('Gaps remaining after fill:', JSON.stringify((await inventoryGaps(tx)).counts));
    await resuggest(tx);   // phases now reflect the filled status / PoP

    const latestFy = (await tx.query<{ fy: number }>(`SELECT max(fy) fy FROM data_call WHERE status = 'CLOSED'`)).rows[0].fy;
    const critId = new Map((await tx.query<any>('SELECT id, gate, ord FROM criterion_def')).rows.map(c => [`${c.gate}:${c.ord}`, c.id] as [string, number]));
    const projects = (await tx.query<Proj>(`
      SELECT p.id, p.esh_id, p.title, p.element_code, p.program_code, p.status_code, p.pop_start, p.pop_end, p.first_fy, p.transition_phase, p.transition_type,
             pe.name pm,
             (SELECT o.name FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR'
              ORDER BY (o.name ILIKE '%J68%'), (o.kind = 'DLA_MSC') DESC, o.name LIMIT 1) sponsor,
             (SELECT count(*)::int FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id AND pri.fy = $1 WHERE pp.project_id = p.id) npri,
             coalesce((SELECT array_agg(fy ORDER BY fy) FROM project_snapshot s WHERE s.project_id = p.id), '{}') fys
      FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
      WHERE p.esf_source = 'SUGGESTED'
      ORDER BY p.esh_id`, [latestFy])).rows.filter(p => !KEEP_UNSEEDED.has(p.title.trim().toUpperCase()));

    /* which projects continue as a later project (from the real titles) — those exits read as "continued" */
    HAS_FOLLOW_ON.clear();
    for (const id of followOns((await tx.query<any>('SELECT id, title, first_fy FROM project')).rows).keys()) HAS_FOLLOW_ON.add(id);
    console.log(`Follow-on chains: ${HAS_FOLLOW_ON.size} projects continue under a later project.`);

    /* scenarios first: pick a real project for each, preferring ones in the latest data call */
    const used = new Set<number>(), usedWords = new Set<string>();
    const STOP = new Set(['phase', 'system', 'systems', 'development', 'program', 'project', 'pilot', 'study', 'with', 'from', 'for', 'and', 'the', 'dla', 'data']);
    const words = (p: Proj) => p.title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w));
    const scenarioOf = new Map<number, number>();
    for (const [i, s] of SCENARIOS.entries()) {
      // one project per scenario, from different families (so "JAMA" and "JAMA III" don't both appear)
      const ok = (p: Proj) => !used.has(p.id) && (s.track === 'J1' || !words(p).some(w => usedWords.has(w))) && s.pick(p, suggestPhase(p, AS_OF) as any);
      const hit = projects.find(p => ok(p) && p.fys.includes(latestFy)) ?? projects.find(ok);
      if (!hit) { console.warn(`No project fits scenario "${s.title}" — skipped.`); continue; }
      used.add(hit.id); words(hit).forEach(w => usedWords.add(w)); scenarioOf.set(hit.id, i);
    }

    let confirmed = 0, events = 0, skipped = 0;
    for (const p of projects) {
      const r = rngFor(SEED, p.esh_id);
      const si = scenarioOf.get(p.id);
      if (si == null && r.chance(0.12)) { skipped++; continue; }      // leave some for Phase triage
      const g = si == null ? generate(p, r) : SCENARIOS[si].build(p, r);
      events += await write(tx, p, g, critId, r);
      confirmed++;
      if (si != null) {
        const s = SCENARIOS[si];
        await tx.query('INSERT INTO demo_scenario (ord, esh_id, title, story, look_for, track) VALUES ($1,$2,$3,$4,$5,$6)',
          [s.track === 'J1' ? 11 : si + 1, p.esh_id, s.title, s.story(p, g), s.look, s.track ?? 'ESF']);
        console.log(`Scenario ${si + 1} · ${s.title}: ${p.esh_id} ${p.title}`);
      }
    }
    const count = async (t: string) => (await tx.query<{ n: number }>(`SELECT count(*)::int n FROM ${t} WHERE synthetic`)).rows[0].n;
    console.log(`Seed ${SEED}: ${confirmed} projects given synthetic lifecycle data, ${skipped} left unconfirmed for triage, ${KEEP_UNSEEDED.size} kept for the live walkthrough.`);
    console.log({ gate_decisions: await count('gate_decision'), criteria: await count('criterion_status'), funding_lines: await count('funding_line'),
      value_cases: await count('value_case'), pathways: await count('transition_pathway'), audit_events: events });

    await seedPeople(tx, SEED, AS_OF, new Set([...scenarioOf.keys()]));
    await seedOps(tx, SEED, AS_OF);
    await seedBenefits(tx, SEED, AS_OF);
    await seedOwnership(tx, SEED, AS_OF);
    await seedRealization(tx, SEED, AS_OF);
    await seedOverlap(tx, SEED, AS_OF);
  });
  await closeDb();
}

main().catch(async e => {
  if (String(e?.message).startsWith('ROLLBACK')) { console.log('Gap report only — nothing changed. Saved to data/gap-report.json'); await closeDb(); return; }
  console.error(e); await closeDb(); process.exit(1);
});
