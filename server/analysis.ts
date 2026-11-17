/* Gate and managed-exit analysis. */
import type { PGlite } from '@electric-sql/pglite';
import { AS_OF } from './config.js';
import { EXIT_REASONS, GATES, PHASES, TECH_RESULTS, followOns } from './domain.js';

const MONTH = 30.44 * 864e5;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? Math.round(100 * a / b) : null);

/* ── managed exits: why projects stop before scale ── */
export async function exitsData(db: PGlite) {
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);
  const [all, exits, funding, starts] = await Promise.all([
    q(`SELECT p.id, p.esh_id, p.title, p.first_fy, p.esf_phase, p.esf_status FROM project p`),
    q(`SELECT p.id, p.esh_id, p.title, p.program_code, coalesce(pr.name, p.program_code) program_name, p.element_code, p.esf_phase, p.esf_status, p.esf_source,
         p.first_fy, p.last_fy, p.pop_start, p.pop_end, p.transition_phase, p.transition_type,
         g.gate, g.outcome, g.decided_at, g.rationale, g.exit_reason, g.technical_result, g.synthetic g_synthetic,
         (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsor_list
       FROM project p LEFT JOIN program pr ON pr.code = p.program_code
       LEFT JOIN LATERAL (SELECT * FROM gate_decision g WHERE g.project_id = p.id AND g.outcome IN ('SUNSET','DESCOPE') ORDER BY g.decided_at DESC LIMIT 1) g ON true
       WHERE p.esf_status IN ('SUNSET','DESCOPED') ORDER BY g.decided_at DESC NULLS LAST, p.esh_id`),
    q(`SELECT project_id, sum(amount)::float amt FROM funding_line GROUP BY 1`),
    q(`SELECT project_id, min(entered_at) started FROM phase_record WHERE phase >= 1 GROUP BY 1`),
  ]);
  const chains = followOns(all);
  const byId = new Map(all.map((p: any) => [p.id, p]));
  const cost = new Map(funding.map((f: any) => [f.project_id, f.amt]));
  const start = new Map(starts.map((s: any) => [s.project_id, s.started]));

  const rows = exits.map((p: any) => {
    const next = (chains.get(p.id) ?? []).map((o: any) => ({ esh_id: o.esh_id, title: o.title, phase: o.esf_phase, status: o.esf_status }));
    const report = p.esf_status === 'DESCOPED' || /dtic/i.test(p.transition_phase ?? '') || /dtic/i.test(p.transition_type ?? '');
    const reason = p.exit_reason ?? (next.length ? 'FOLLOW_ON' : report ? 'KNOWLEDGE' : null);
    const s = start.get(p.id), end = p.decided_at ?? p.pop_end;
    return {
      esh_id: p.esh_id, title: p.title, program_code: p.program_code, program_name: p.program_name, element_code: p.element_code, sponsor_list: p.sponsor_list,
      gate: p.gate ?? Math.min(p.esf_phase ?? 0, 4), phase: p.esf_phase, status: p.esf_status, decided_at: p.decided_at, recorded: !!p.decided_at,
      reason, reason_label: reason ? EXIT_REASONS[reason as keyof typeof EXIT_REASONS] : 'Not recorded', technical: p.technical_result,
      rationale: p.rationale, cost: cost.get(p.id) ?? 0, next,
      months: s && end ? Math.max(0, (new Date(end).getTime() - new Date(s).getTime()) / MONTH) : null, synthetic: !!p.g_synthetic,
    };
  });

  const count = (f: (r: any) => boolean) => rows.filter(f).length;
  const sum = (rs: any[]) => rs.reduce((a, r) => a + r.cost, 0);
  const byReason = [...Object.keys(EXIT_REASONS), null].map(k => {
    const rs = rows.filter(r => r.reason === k);
    return { reason: k, label: k ? EXIT_REASONS[k as keyof typeof EXIT_REASONS] : 'Not recorded', n: rs.length, cost: sum(rs) };
  }).filter(r => r.n > 0).sort((a, b) => b.n - a.n);
  const byTech = [...Object.keys(TECH_RESULTS), null].map(k => ({ tech: k, label: k ? TECH_RESULTS[k as keyof typeof TECH_RESULTS] : 'Not recorded', n: count(r => r.technical === k) }));
  const byGate = GATES.map(g => ({ gate: g.gate, label: `Gate ${g.gate}`, phase: g.from, n: count(r => r.gate === g.gate), cost: sum(rows.filter(r => r.gate === g.gate)) }));
  const progAll = new Map<string, { live: number; exits: number; name: string }>();
  for (const p of (await q(`SELECT coalesce(p.program_code,'?') k, coalesce(pr.name, p.program_code, '?') name, p.esf_status FROM project p LEFT JOIN program pr ON pr.code = p.program_code`))) {
    const x = progAll.get(p.k) ?? { live: 0, exits: 0, name: p.name };
    if (['SUNSET', 'DESCOPED'].includes(p.esf_status)) x.exits++; else if (['ACTIVE', 'HOLD', 'AT_SCALE'].includes(p.esf_status)) x.live++;
    progAll.set(p.k, x);
  }
  const byProgram = [...progAll.entries()].map(([k, v]) => ({ program: k, name: v.name, exits: v.exits, live: v.live, rate: pct(v.exits, v.exits + v.live) }))
    .filter(x => x.exits > 0).sort((a, b) => b.exits - a.exits);

  const worked = count(r => r.technical === 'MET'), partly = count(r => r.technical === 'PARTIAL');
  const continued = count(r => r.next.length > 0), knowledge = count(r => r.reason === 'KNOWLEDGE'), orphaned = count(r => r.reason === 'NO_OWNER');
  const totalCost = sum(rows);
  const kpis = {
    exits: rows.length, cost: totalCost, worked, partly, workedPct: pct(worked, rows.length), continued, continuedPct: pct(continued, rows.length),
    knowledge, orphaned, orphanedCost: sum(rows.filter(r => r.reason === 'NO_OWNER')),
    medianMonths: median(rows.map(r => r.months).filter((m): m is number => m != null)),
    useful: count(r => r.next.length > 0 || r.reason === 'KNOWLEDGE' || r.technical === 'MET'),
  };
  const top = byReason[0];
  const takeaway = [
    `${rows.length} projects left the pipeline before scale, after ${'$' + Math.round(totalCost / 1e6)}M of spending.`,
    `${pct(kpis.useful, rows.length)}% left something behind: ${continued} continue as a follow-on project, ${knowledge} delivered a report, and ${worked} worked technically.`,
    orphaned ? `${orphaned} worked but found no owner to take them on — the gap the ESF funding handoff is meant to close.` : '',
    top ? `The most common reason: ${top.label.toLowerCase()} (${top.n}).` : '',
  ].filter(Boolean).join(' ');
  return { asOf: AS_OF.toISOString().slice(0, 10), takeaway, kpis, byReason, byTech, byGate, byProgram, rows, reasons: EXIT_REASONS, tech: TECH_RESULTS };
}

/* ── gates: who decides what, how often projects pass, and what holds them up ── */
export async function gatesData(db: PGlite) {
  const q = (sql: string, p: unknown[] = []) => db.query<any>(sql, p).then(r => r.rows);
  const asOf = AS_OF.toISOString().slice(0, 10);
  const yearAgo = new Date(AS_OF.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const [decisions, crits, working, status, slots, boards, intake, scaled] = await Promise.all([
    q(`SELECT g.gate, g.outcome, g.decided_at, g.authority, g.rationale, g.exit_reason, g.synthetic, p.esh_id, p.title, p.program_code
       FROM gate_decision g JOIN project p ON p.id = g.project_id ORDER BY g.decided_at DESC, g.id DESC`),
    q(`SELECT id, gate, ord, text, non_waivable, owner, proposal FROM criterion_def ORDER BY gate, ord`),
    q(`SELECT p.id, p.esh_id, p.title, p.program_code, p.esf_phase, p.esf_status, pe.name pm, LEAST(p.esf_phase, 4) gate,
         (SELECT max(entered_at) FROM phase_record r WHERE r.project_id = p.id AND r.exited_at IS NULL) entered,
         (SELECT g.rationale FROM gate_decision g WHERE g.project_id = p.id AND g.outcome = 'HOLD' ORDER BY g.decided_at DESC LIMIT 1) hold_reason
       FROM project p LEFT JOIN person pe ON pe.id = p.pm_id
       WHERE p.esf_status IN ('ACTIVE','HOLD') AND p.esf_source = 'CONFIRMED' AND p.esf_phase < 5`),
    q(`SELECT s.project_id, s.criterion_id, s.status FROM criterion_status s`),
    // the next scheduled board each project is docketed on
    q(`SELECT DISTINCT ON (i.project_id) i.project_id, b.id board_id, b.board_date, b.title
       FROM gate_board_item i JOIN gate_board b ON b.id = i.board_id
       WHERE b.status = 'SCHEDULED' AND i.outcome IS NULL ORDER BY i.project_id, b.board_date`),
    q(`SELECT b.id, b.title, b.board_date, b.authority, array_agg(DISTINCT i.gate) gates, count(i.*)::int items
       FROM gate_board b LEFT JOIN gate_board_item i ON i.board_id = b.id
       WHERE b.status = 'SCHEDULED' GROUP BY b.id ORDER BY b.board_date`),
    q(`SELECT r.entered_at, p.esh_id, p.title FROM phase_record r JOIN project p ON p.id = r.project_id
       WHERE r.phase = 0 AND r.entered_at >= $1 ORDER BY r.entered_at DESC`, [yearAgo]),
    q(`SELECT count(*)::int n FROM project WHERE esf_status = 'AT_SCALE'`),
  ]);
  const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);
  decisions.forEach((d: any) => { d.decided_at = iso(d.decided_at); });
  intake.forEach((r: any) => { r.entered_at = iso(r.entered_at); });
  slots.forEach((s: any) => { s.board_date = iso(s.board_date); });
  boards.forEach((b: any) => { b.board_date = iso(b.board_date); });
  const st = new Map<string, string>(status.map((s: any) => [`${s.project_id}:${s.criterion_id}`, s.status]));
  const closed = (pid: number, cid: number, hard: boolean) => { const v = st.get(`${pid}:${cid}`); return v === 'MET' || (!hard && v === 'WAIVED'); };
  const slotOf = new Map<number, any>(slots.map((s: any) => [s.project_id, { id: s.board_id, date: s.board_date, title: s.title }]));
  /** Preparing → nearly ready (≥75% of the gate's criteria closed) → ready (all closed); on hold is its own state. */
  const stage = (p: any) => p.status === 'HOLD' ? 'hold' : p.ready ? 'ready' : p.done / p.total >= 0.75 ? 'nearly' : 'preparing';

  const gates = GATES.map(G => {
    const cs = crits.filter((c: any) => c.gate === G.gate);
    const ws = working.filter((w: any) => w.gate === G.gate);
    const dec = decisions.filter((d: any) => d.gate === G.gate);
    const n = (o: string, recent = false) => dec.filter((d: any) => d.outcome === o && (!recent || d.decided_at >= yearAgo)).length;
    const pass = n('PASS'), stop = n('SUNSET') + n('DESCOPE');
    const projects = ws.map((w: any) => {
      const open = cs.filter((c: any) => !closed(w.id, c.id, c.non_waivable));
      const months = w.entered ? (AS_OF.getTime() - new Date(w.entered).getTime()) / MONTH : null;
      const p: any = {
        esh_id: w.esh_id, title: w.title, program_code: w.program_code, pm: w.pm, status: w.esf_status,
        done: cs.length - open.length, total: cs.length, openCount: open.length,
        open: open.map((c: any) => ({ ord: c.ord, text: c.text, owner: c.owner })),
        ready: open.length === 0 && w.esf_status === 'ACTIVE',
        months, late: months != null && months > (PHASES[G.from].design as readonly number[])[1], hold_reason: w.hold_reason,
        board: slotOf.get(w.id) ?? null,
      };
      p.stage = stage(p);
      return p;
    }).sort((a: any, b: any) => a.openCount - b.openCount || (b.months ?? 0) - (a.months ?? 0));
    const criteria = cs.map((c: any) => {
      const met = ws.filter((w: any) => closed(w.id, c.id, c.non_waivable)).length;
      return { ord: c.ord, text: c.text, non_waivable: c.non_waivable, owner: c.owner, proposal: c.proposal, met, open: ws.length - met, total: ws.length, pct: pct(met, ws.length) };
    });
    const bottleneck = [...criteria].filter(c => c.total > 0).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0] ?? null;
    const count = (s: string) => projects.filter((p: any) => p.stage === s).length;
    const ready = projects.filter((p: any) => p.ready);
    return {
      ...G, from_name: PHASES[G.from].short, to_name: PHASES[G.to].short,
      working: ws.length, preparing: count('preparing'), nearly: count('nearly'), ready: ready.length, hold: count('hold'),
      late: projects.filter((p: any) => p.late).length,
      readyUnscheduled: ready.filter((p: any) => !p.board).length,
      nextBoard: boards.find((b: any) => (b.gates ?? []).includes(G.gate)) ?? null,
      outcomes: { PASS: pass, HOLD: n('HOLD'), SUNSET: n('SUNSET'), DESCOPE: n('DESCOPE') },
      recent: { PASS: n('PASS', true), HOLD: n('HOLD', true), SUNSET: n('SUNSET', true), DESCOPE: n('DESCOPE', true) },
      passRate: pct(pass, pass + stop), criteria, bottleneck, projects,
    };
  });

  /* ── movement: the last 12 months, month by month ── */
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(AS_OF.getUTCFullYear(), AS_OF.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const recent = decisions.filter((d: any) => d.decided_at >= yearAgo && d.decided_at <= asOf);
  const ym = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);
  const monthly = months.map(m => {
    const ds = recent.filter((d: any) => ym(d.decided_at) === m);
    return {
      m, intake: intake.filter((r: any) => ym(r.entered_at) === m).length,
      passed: ds.filter((d: any) => d.outcome === 'PASS').length,
      held: ds.filter((d: any) => d.outcome === 'HOLD').length,
      stopped: ds.filter((d: any) => d.outcome === 'SUNSET' || d.outcome === 'DESCOPE').length,
    };
  });
  const phases = PHASES.slice(0, 5).map(P => ({
    phase: P.n, name: P.short, full: P.name,
    active: working.filter((w: any) => w.esf_phase === P.n).length,
  }));
  return {
    asOf, gates, boards, phases, atScale: scaled[0].n, monthly,
    recentDecisions: recent.map((d: any) => ({ ...d, m: ym(d.decided_at) })),
    intake: intake.map((r: any) => ({ ...r, m: ym(r.entered_at) })),
    totals: {
      decisions: decisions.length, lastYear: recent.length, working: working.length,
      preparing: gates.reduce((a, g) => a + g.preparing, 0), nearly: gates.reduce((a, g) => a + g.nearly, 0),
      ready: gates.reduce((a, g) => a + g.ready, 0), hold: gates.reduce((a, g) => a + g.hold, 0),
      readyUnscheduled: gates.reduce((a, g) => a + g.readyUnscheduled, 0),
      passedYear: recent.filter((d: any) => d.outcome === 'PASS').length,
      stoppedYear: recent.filter((d: any) => d.outcome === 'SUNSET' || d.outcome === 'DESCOPE').length,
      intakeYear: intake.length,
    },
    synthetic: decisions.some((d: any) => d.synthetic),
  };
}
