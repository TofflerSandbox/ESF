import { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Card, ErrorBox, GroupBars, Loading, PH_COL, d10, go, useAsync, ProgramLink } from '../ui';
import { HubProposal, SponsorTag } from './Ownership';

const OUT_COL: Record<string, string> = { PASS: '#2F7D5C', HOLD: '#C9A961', SUNSET: '#CE0F3E', DESCOPE: '#8A8378' };
const OUT_L: Record<string, string> = { PASS: 'Passed', HOLD: 'Held', SUNSET: 'Sunset', DESCOPE: 'Descoped' };
type Stage = 'all' | 'preparing' | 'nearly' | 'ready' | 'hold' | 'late';
const STAGES: { k: Stage; l: string; c: string; tip: string }[] = [
  { k: 'preparing', l: 'Preparing', c: '#3F90CB', tip: 'Working toward the gate, under 75% of its criteria closed' },
  { k: 'nearly', l: 'Nearly ready', c: '#C9A961', tip: '75% or more of the criteria closed' },
  { k: 'ready', l: 'Ready', c: '#2F7D5C', tip: 'Every criterion closed; waiting for a decision' },
  { k: 'hold', l: 'On hold', c: '#8A6B25', tip: 'Held at the last decision' },
  { k: 'late', l: 'Running late', c: '#CE0F3E', tip: 'Longer in the phase than the ESF design allows' },
];
const MON = (m: string) => new Date(m + '-15').toLocaleString('en-US', { month: 'short' }) + " '" + m.slice(2, 4);
const short = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Gates: the five decision points up top, every number clickable into the projects behind it,
    and the movement of projects through the system below. */
export function Gates({ initial }: { initial?: number }) {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api('/gates'), []);
  const [sel, setSel] = useState(initial ?? 2);
  const [stage, setStage] = useState<Stage>('all');
  const [crit, setCrit] = useState<number | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const explorer = useRef<HTMLDivElement>(null);
  const G = d?.gates[sel];

  const rows = useMemo(() => (G?.projects ?? []).filter((p: any) =>
    (stage === 'all' || (stage === 'late' ? p.late : p.stage === stage)) && (crit == null || p.open.some((o: any) => o.ord === crit))), [G, stage, crit]);
  const { sorted, Th } = useSort<any>(rows, { key: 'done', dir: -1 }, { done: p => p.done / p.total, open: p => p.openCount, months: p => p.months ?? 0, board: p => p.board?.date ?? '9999', stage: p => ['ready', 'nearly', 'preparing', 'hold'].indexOf(p.stage) });

  if (error) return <ErrorBox msg={error} />;
  if (!d || !G) return <Loading />;
  const progName = (c: string) => meta.programs.find(p => p.code === c)?.name ?? c ?? '—';
  const open = (g: number, s: Stage, c: number | null = null) => {
    setSel(g); setStage(s); setCrit(c);
    setTimeout(() => explorer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const T = d.totals;
  const activeMonth = month ?? [...d.monthly].reverse().find((x: any) => x.passed + x.stopped + x.held > 0)?.m ?? d.monthly[d.monthly.length - 1].m;
  const monthDecisions = d.recentDecisions.filter((x: any) => x.m === activeMonth);
  const monthIntake = d.intake.filter((x: any) => x.m === activeMonth);
  const stageCount = (s: Stage) => (s === 'late' ? G.late : G[s]);

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Gates</h2>
          <div className="vsub">Who is preparing for each gate, who is ready for a decision, and how projects are moving through the framework. Click any number to see the projects behind it.</div></div>
      </div>

      {/* ── 1. the gates ── */}
      <div className="gstrip">
        {d.gates.map((g: any) => (
          <div key={g.gate} className={'gcard' + (sel === g.gate ? ' on' : '')} style={{ ['--ph' as any]: PH_COL[g.from] }}>
            <button className="gc-head" onClick={() => open(g.gate, 'all')} title={g.question}>
              <span className="gc-n">Gate {g.gate}</span>
              <span className="gc-name">{g.name.split(' — ')[1]}</span>
              <span className="gc-move">{g.from_name} → {g.to_name}</span>
            </button>
            <div className="gc-stats">
              {STAGES.map(s => {
                const v = s.k === 'late' ? g.late : g[s.k];
                return (
                  <button key={s.k} className={'gc-stat' + (v ? '' : ' zero') + (sel === g.gate && stage === s.k ? ' sel' : '')} onClick={() => open(g.gate, s.k)} title={s.tip} disabled={!v}>
                    <span className="gc-dot" style={{ background: s.c }} />{s.l}<b>{v}</b>
                  </button>
                );
              })}
            </div>
            <div className="gc-foot">
              {g.nextBoard
                ? <a href={'#/boards/' + g.nextBoard.id} title={g.nextBoard.title}>Next board <b>{short(g.nextBoard.board_date)}</b> →</a>
                : <span>No board scheduled</span>}
              <span title="Of pass or stop decisions at this gate">{g.passRate != null ? <><b>{g.passRate}%</b> pass</> : '—'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="gsum">
        <button onClick={() => open(sel, 'ready')}><b style={{ color: '#2F7D5C' }}>{T.ready}</b> ready for a decision{T.readyUnscheduled ? <> · <b style={{ color: 'var(--red)' }}>{T.readyUnscheduled}</b> not yet on a board</> : <> · all on a board</>}</button>
        <button onClick={() => open(sel, 'nearly')}><b style={{ color: '#8A6B25' }}>{T.nearly}</b> nearly ready</button>
        <button onClick={() => open(sel, 'preparing')}><b style={{ color: '#3F90CB' }}>{T.preparing}</b> preparing</button>
        <button onClick={() => open(sel, 'hold')}><b>{T.hold}</b> on hold</button>
        <span>{T.passedYear} gate passes and {T.stoppedYear} stops in the last 12 months</span>
      </div>

      {/* ── 2. explore the selected gate ── */}
      <div ref={explorer} className="gx" style={{ ['--ph' as any]: PH_COL[G.from] }}>
        <div className="gx-head">
          <div>
            <div className="gx-k">Gate {G.gate} · {G.from_name} → {G.to_name}</div>
            <div className="gate-q">“{G.question}”</div>
            <div className="gate-meta"><span><b>Decides:</b> {G.authority}</span><a href={'#/map/' + G.from}>What happens in {G.from_name} →</a><a href="#/exits">Why projects stop →</a></div>
          </div>
        </div>
        <div className="gx-chips">
          <button className={'gx-chip' + (stage === 'all' ? ' on' : '')} onClick={() => setStage('all')}>All working toward it <b>{G.working}</b></button>
          {STAGES.map(s => (
            <button key={s.k} className={'gx-chip' + (stage === s.k ? ' on' : '')} onClick={() => setStage(s.k)} disabled={!stageCount(s.k)} title={s.tip} style={{ ['--c' as any]: s.c }}>
              <span className="gc-dot" style={{ background: s.c }} />{s.l} <b>{stageCount(s.k)}</b>
            </button>
          ))}
          {crit != null && <button className="gx-chip on crit" onClick={() => setCrit(null)}>Criterion #{crit} still open ✕</button>}
        </div>

        <div className="gx-body">
          <div className="gx-crit">
            <div className="gx-sub">What is still open <span>click a criterion to see who</span></div>
            {G.criteria.map((c: any) => (
              <button key={c.ord} className={'gx-cbar' + (crit === c.ord ? ' on' : '')} onClick={() => setCrit(crit === c.ord ? null : c.ord)} disabled={!c.open}>
                <span className="gx-ct">{c.ord}. {c.text}{c.non_waivable && <span className="hardtag">NON-WAIVABLE</span>}{c.owner === 'J1' && <span className="j1tag">J1</span>}{c.owner === 'SPONSOR' && <SponsorTag />}{c.proposal && <HubProposal />}</span>
                <span className="gx-track"><span style={{ width: `${Math.max(2, c.pct ?? 0)}%` }} /></span>
                <span className="gx-cv"><b>{c.open}</b> open</span>
              </button>
            ))}
            {G.bottleneck && G.working > 0 && <div className="chart-note"><b>Biggest hold-up:</b> #{G.bottleneck.ord} is closed for only {G.bottleneck.met} of {G.bottleneck.total} projects.</div>}
          </div>

          <div className="gx-list">
            <table className="list flat rows">
              <thead><tr><Th k="title">Project</Th><Th k="stage">Readiness</Th><Th k="done">Criteria</Th><Th k="open">Still open</Th><Th k="months" num>Months in phase</Th><Th k="board">Gate board</Th></tr></thead>
              <tbody>{sorted.map((p: any) => {
                const s = STAGES.find(x => x.k === p.stage)!;
                return (
                  <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                    <td className="ttl">{p.title}<div className="sub"><ProgramLink code={p.program_code} name={progName(p.program_code)} full /> · <span className="mono">{p.esh_id}</span></div></td>
                    <td className="sm"><span className="gx-st" style={{ color: s.c }} title={p.stage === 'hold' ? p.hold_reason ?? '' : s.tip}>{s.l}</span>{p.late && <div className="sub" style={{ color: 'var(--red)' }}>running late</div>}</td>
                    <td><span className="mini-track"><span style={{ width: `${100 * p.done / p.total}%`, background: s.c }} /></span> <span className="mono sm">{p.done}/{p.total}</span></td>
                    <td className="sm">{p.open.length
                      ? p.open.map((o: any) => <span key={o.ord} className={'gx-open' + (crit === o.ord ? ' on' : '')} title={o.text} onClick={e => { e.stopPropagation(); setCrit(o.ord); }}>#{o.ord}</span>)
                      : <span style={{ color: '#2F7D5C', fontWeight: 600 }}>none</span>}</td>
                    <td className="num mono" style={{ color: p.late ? 'var(--red)' : undefined }}>{p.months != null ? Math.round(p.months) : '—'}</td>
                    <td className="sm">{p.board
                      ? <a href={'#/boards/' + p.board.id} onClick={e => e.stopPropagation()} title={p.board.title}>{short(p.board.date)} →</a>
                      : p.ready ? <b style={{ color: 'var(--red)' }}>Not scheduled</b> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            {!sorted.length && <div className="note" style={{ padding: 14 }}>No projects match. Try another filter.</div>}
          </div>
        </div>
      </div>

      {/* ── 3. movement through the system ── */}
      <h3 className="gsec">Movement through the system</h3>
      <div className="flow">
        <div className="fl-node intake"><span className="fl-v">{T.intakeYear}</span><span className="fl-l">new ideas</span><span className="fl-s">entered in 12 months</span></div>
        {d.phases.map((P: any, i: number) => {
          const g = d.gates[i];
          return (
            <div key={P.phase} className="fl-pair">
              <span className="fl-arrow sm">→</span>
              <a className="fl-node" href={'#/phase/' + P.phase} style={{ ['--ph' as any]: PH_COL[P.phase] }} title={`Open the ${P.name} dashboard`}>
                <span className="fl-v">{P.active}</span><span className="fl-l">{P.name}</span><span className="fl-s">{P.full}</span>
              </a>
              <button className={'fl-gate' + (sel === g.gate ? ' on' : '')} onClick={() => open(g.gate, 'all')} style={{ ['--ph' as any]: PH_COL[P.phase] }} title={`Gate ${g.gate}: ${g.recent.PASS} passed and ${g.recent.SUNSET + g.recent.DESCOPE} stopped in the last 12 months`}>
                <span className="fl-gn">G{g.gate}</span>
                <span className="fl-pass">{g.recent.PASS} passed</span>
                {g.ready > 0 && <span className="fl-wait">{g.ready} waiting</span>}
                {g.recent.SUNSET + g.recent.DESCOPE > 0 && <span className="fl-stop">{g.recent.SUNSET + g.recent.DESCOPE} stopped</span>}
              </button>
            </div>
          );
        })}
        <span className="fl-arrow sm">→</span>
        <a className="fl-node scale" href="#/projects?esfStatus=AT_SCALE"><span className="fl-v">{d.atScale}</span><span className="fl-l">At scale</span><span className="fl-s">enterprise capability</span></a>
      </div>
      <div className="fine" style={{ margin: '4px 0 14px' }}>Boxes are projects in each phase now; the gate markers are decisions in the last 12 months. Click a phase to open its dashboard, or a gate to explore it above.</div>

      <div className="grid2">
        <Card title="Month by month" right={<span className="hint">last 12 months · click a month</span>}>
          <GroupBars h={240} cats={d.monthly.map((x: any) => MON(x.m))}
            series={[
              { l: 'Entered Stage 0', c: '#7FA7D6', v: d.monthly.map((x: any) => x.intake) },
              { l: 'Passed a gate', c: '#2F7D5C', v: d.monthly.map((x: any) => x.passed) },
              { l: 'Held', c: '#C9A961', v: d.monthly.map((x: any) => x.held) },
              { l: 'Stopped', c: '#CE0F3E', v: d.monthly.map((x: any) => x.stopped) },
            ]}
            onClick={i => setMonth(d.monthly[i].m)} />
        </Card>
        <Card title={`${MON(activeMonth)}: what moved`} right={<span className="hint">{monthDecisions.length} decision{monthDecisions.length === 1 ? '' : 's'} · {monthIntake.length} new</span>} pad={false}>
          <div className="mv-list">
            {monthDecisions.map((x: any, i: number) => (
              <div key={i} className="dec" onClick={() => go('#/p/' + x.esh_id)} style={{ cursor: 'pointer' }}>
                <span className="dot" style={{ background: OUT_COL[x.outcome] }} />
                <span className="dec-b"><span className="dec-k" style={{ color: OUT_COL[x.outcome] }}>{OUT_L[x.outcome]} Gate {x.gate} · {d10(x.decided_at)}</span>
                  <span><b>{x.title}</b></span>{x.rationale && <span className="sub">{x.rationale}</span>}</span>
              </div>
            ))}
            {monthIntake.map((x: any) => (
              <div key={x.esh_id} className="dec" onClick={() => go('#/p/' + x.esh_id)} style={{ cursor: 'pointer' }}>
                <span className="dot" style={{ background: '#7FA7D6' }} />
                <span className="dec-b"><span className="dec-k" style={{ color: '#27568F' }}>Entered Stage 0 · {d10(x.entered_at)}</span><span><b>{x.title}</b></span></span>
              </div>
            ))}
            {!monthDecisions.length && !monthIntake.length && <div className="note" style={{ padding: 14 }}>Nothing moved this month.</div>}
          </div>
        </Card>
      </div>
      <div className="fine dm" style={{ marginTop: 8 }}>Gate decisions and criteria evidence in this demo are synthetic. Only confirmed projects are counted; unconfirmed ones are in Phase review.</div>
    </div>
  );
}
