import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSort } from '../sort';
import { Card, Donut, ErrorBox, GroupBars, Help, Insights, Loading, PH_COL, PH_SHORT, VALUE_PATH, go, money, useAsync, ProgramLink } from '../ui';
import { PromiseVsDelivery } from './Realization';

const $ = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : money(v).replace('.00M', 'M'));
const x = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}×`);
const pc = (v: number | null) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const back = (v: number | null) => (v == null ? '—' : v < 1 ? `${Math.round(100 * v)}¢` : `$${v.toFixed(2)}`);
const MON = (m: string) => new Date(m + '-15').toLocaleString('en-US', { month: 'short' }) + " '" + m.slice(2, 4);
type Lens = 'prospective' | 'realized';

/** The four ROI types as one big donut with a 2×2 legend; each tile filters the list below. */
function PathCard({ title, hint, center, sub, items, sel, onSel }: {
  title: string; hint: string; center: string; sub: string; sel: string | null; onSel: (k: string | null) => void;
  items: { k: string; v: number; big: string; lines: string[] }[];
}) {
  const total = items.reduce((a, i) => a + i.v, 0) || 1;
  return (
    <Card title={title} right={<span className="hint">{hint}</span>}>
      <div className="pathcard">
        <Donut slices={items.map(i => ({ k: i.k, l: VALUE_PATH[i.k].l, v: i.v, c: VALUE_PATH[i.k].c }))} size={250} center={center} sub={sub} onClick={k => onSel(sel === k ? null : k)} />
        <div className="pc-tiles">
          {items.map(i => (
            <button key={i.k} className={'pc-tile' + (sel === i.k ? ' on' : '')} style={{ ['--vc' as any]: VALUE_PATH[i.k].c }} onClick={() => onSel(sel === i.k ? null : i.k)} title={VALUE_PATH[i.k].d}>
              <span className="pc-l">{VALUE_PATH[i.k].l}<span className="pc-share">{Math.round(100 * i.v / total)}%</span></span>
              <span className="pc-big">{i.big}</span>
              {i.lines.map((l, j) => <span key={j} className="pc-s">{l}</span>)}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Renders the engine's answer: paragraphs, with **bold** lead-ins. */
function Prose({ text }: { text: string }) {
  return <>{text.split('\n\n').map((p, i) => <p key={i}>{p.split(/(\*\*[^*]+\*\*)/).map((s, j) => s.startsWith('**') ? <b key={j}>{s.slice(2, -2)}</b> : <Fragment key={j}>{s}</Fragment>)}</p>)}</>;
}

/** Return on investment in two lenses: what the active portfolio is projected to return, and what fielded projects are delivering. */
export function Roi() {
  const [horizon, setHorizon] = useState(5);
  const [lens, setLens] = useState<Lens>(() => { try { return (sessionStorage.getItem('esh.roi.lens') as Lens) || 'prospective'; } catch { return 'prospective'; } });
  const { data: d, error } = useAsync(() => api(`/roi?horizon=${horizon}`), [horizon]);
  const [aside, setAside] = useState<boolean>(() => { try { return localStorage.getItem('esh.roiask.open') !== '0'; } catch { return true; } });
  const toggleAside = (v: boolean) => { setAside(v); try { localStorage.setItem('esh.roiask.open', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  useEffect(() => { try { sessionStorage.setItem('esh.roi.lens', lens); } catch { /* storage unavailable */ } }, [lens]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const s = d.summary, r = d.realized.summary;

  return (
    <div className={'proj-layout' + (aside ? ' with-aside' : '')}>
    <div className="home proj-main">
      <div className="vhead">
        <div><h2 className="vt">Return on investment {!aside && <button className="as-open" onClick={() => toggleAside(true)}>✦ Ask about ROI</button>}</h2>
          <div className="vsub">Two different questions. <b>Prospective:</b> what the active portfolio is projected to return. <b>Realized:</b> what projects already in the enterprise are actually delivering against the value they promised at Gate 4.</div></div>
        <label className="fy">Look ahead <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}>{[3, 5, 10].map(h => <option key={h} value={h}>{h} years</option>)}</select></label>
      </div>

      <div className="lens-tabs" role="tablist">
        <button role="tab" aria-selected={lens === 'prospective'} className={'lens-tab pro' + (lens === 'prospective' ? ' on' : '')} onClick={() => setLens('prospective')}>
          <span className="lt-k">Prospective · the active portfolio</span>
          <span className="lt-v">{x(s.riskMultiple)} <small>risk-adjusted return on {$(s.totalCost)}</small></span>
          <span className="lt-s">{s.liveCount} projects in Stage 0 to Phase IV · {$(s.riskAdj)} risk-adjusted over {horizon} years · owned by J68 and J8</span>
        </button>
        <div className="lens-bridge" title="At Gate 4 a project's value case is frozen as its baseline and tracking begins">
          <span>Gate 4</span><small>projection becomes the baseline</small>
        </div>
        <button role="tab" aria-selected={lens === 'realized'} className={'lens-tab real' + (lens === 'realized' ? ' on' : '')} onClick={() => setLens('realized')}>
          <span className="lt-k">Realized · in the enterprise</span>
          <span className="lt-v">{pc(r.realization)} <small>of planned benefit delivered</small></span>
          <span className="lt-s">{r.n} projects at scale · {$(r.realized)} delivered so far, {back(r.roi)} back per dollar · owned by sponsors, validated by J8</span>
        </button>
      </div>

      {lens === 'prospective' ? <Prospective d={d} horizon={horizon} /> : <Realized d={d} />}
    </div>
    {aside && <AskRoi horizon={horizon} onLens={setLens} onClose={() => toggleAside(false)} />}
    </div>
  );
}

/* ── ask about ROI: right-hand sidebar ── */
type Turn = { q: string; a?: any; err?: string };

function AskRoi({ horizon, onLens, onClose }: { horizon: number; onLens: (l: Lens) => void; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem('esh.roiask') ?? '[]'); } catch { return []; } });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<Record<number, boolean>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem('esh.roiask', JSON.stringify(turns.slice(-6))); } catch { /* storage unavailable */ } end.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return;
    setQ(''); setBusy(true); setTurns(x => [...x, { q: t }]);
    try {
      const a = await api('/roi/ask', { method: 'POST', body: { q: t, horizon } });
      setTurns(x => x.map((y, i) => (i === x.length - 1 ? { ...y, a } : y)));
      if (a.lens !== 'both') onLens(a.lens);
    } catch (e: any) {
      setTurns(x => x.map((y, i) => (i === x.length - 1 ? { ...y, err: String(e.message) } : y)));
    } finally { setBusy(false); }
  };

  return (
    <aside className="assist" aria-label="Ask about ROI">
      <div className="as-head">
        <div>
          <b>Ask about ROI</b>
          <small>Ask about projected return on the active portfolio, or what fielded projects are delivering. Filter by program, sponsor, value path or topic, group, or rank.</small>
        </div>
        <div className="as-actions">
          {turns.length > 0 && <button className="as-new" onClick={() => { setTurns([]); setMore({}); setQ(''); }} disabled={busy} title="Clear this conversation and start again">New chat</button>}
          <button className="as-x" onClick={onClose} title="Hide" aria-label="Hide the ROI assistant">⟩</button>
        </div>
      </div>

      <div className="as-body">
        {!turns.length && <div className="as-empty"><p>Ask a question below. Answers use the same numbers as this page.</p></div>}
        {turns.map((t, i) => {
          const a = t.a;
          const real = a && a.lens !== 'prospective';
          const rows = a ? (real ? a.realized.rows : a.prospective.rows) : [];
          const shown = more[i] ? rows : rows.slice(0, 5);
          return (
            <div key={i} className="as-turn">
              <div className="as-q">{t.q}</div>
              {t.err && <div className="as-a err">{t.err}</div>}
              {!a && !t.err && <div className="as-a muted">Working it out…</div>}
              {a && (
                <div className="as-a">
                  <div className="as-tags">
                    <span className={'ra-lens ' + a.lens}>{a.lens === 'both' ? 'Prospective + realized' : a.lens === 'realized' ? 'Realized' : 'Prospective'}</span>
                    {a.chips.map((c: string) => <span key={c} className="as-tag f">{c}</span>)}
                  </div>
                  <div className="ra-text"><Prose text={a.answer} /></div>

                  {a.groups ? (
                    <div className="ra-groups">
                      {a.groups.map((g: any) => (
                        <div key={g.k} className="ra-g">
                          <span className="ra-gl">{g.label}</span>
                          {a.lens !== 'realized' && g.pN > 0 && <span className="ra-gm">{g.pN} active · {$(g.pRisk)} risk-adj. · <b>{x(g.pMult)}</b></span>}
                          {a.lens !== 'prospective' && g.rN > 0 && <span className="ra-gm">{g.rN} fielded · {$(g.rRealized)} delivered · <b style={{ color: g.rRate == null ? undefined : g.rRate >= 0.9 ? 'var(--spon)' : g.rRate >= 0.6 ? 'var(--goldD)' : 'var(--red)' }}>{pc(g.rRate)} of plan</b></span>}
                        </div>
                      ))}
                    </div>
                  ) : shown.map((p: any) => (
                    <a key={p.esh_id} className={'as-hit' + (real ? ' rl' : '')} href={'#/p/' + p.esh_id} style={real ? { borderLeftColor: a.status[p.status]?.c } : undefined}>
                      <span className="as-hit-top">
                        <span className="mono code">{p.esh_id}</span>
                        {real ? <StatusChip s={p.status} map={a.status} /> : <span className="sm"><span className="phdot" style={{ background: PH_COL[p.phase ?? 0] }} />{PH_SHORT[p.phase ?? 0]}</span>}
                        {p.program_code && <ProgramLink code={p.program_code} />}
                      </span>
                      <span className="as-ttl">{p.title}</span>
                      <span className="as-snip">{real
                        ? <>{$(p.realized)} delivered of {$(p.planned)} planned · <b>{pc(p.realization)}</b> · {back(p.roi)} back per $ on {$(p.cost)}</>
                        : <>{$(p.cost)} invested · {p.annual ? `${$(p.annual)} a year · ` : ''}{$(p.riskAdj)} risk-adj. · <b>{x(p.multiple)}</b></>}</span>
                      {real && p.note && <span className="as-why">{p.note}</span>}
                    </a>
                  ))}
                  {!a.groups && rows.length > 5 && <button className="as-link" onClick={() => setMore(m => ({ ...m, [i]: !m[i] }))}>{more[i] ? 'Show fewer' : `Show all ${rows.length}`}</button>}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form className="as-in" onSubmit={e => { e.preventDefault(); ask(q); }}>
        <textarea rows={2} value={q} placeholder="Ask about ROI…" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
        <div className="as-foot">
          <small title="Answered on this machine from the Hub's own numbers. Nothing is sent to an outside service.">Runs locally · no data leaves this machine</small>
          {turns.length > 0 && <button type="button" className="as-link" onClick={() => setTurns([])}>Clear</button>}
          <button type="submit" disabled={busy || !q.trim()}>Ask</button>
        </div>
      </form>
    </aside>
  );
}

function StatusChip({ s, map }: { s: string; map: Record<string, { l: string; c: string }> }) {
  const m = map[s]; if (!m) return null;
  return <span className="rs-chip" style={{ color: m.c, borderColor: m.c }}>{m.l}</span>;
}

/* ── realized: in the enterprise ── */
function Realized({ d }: { d: any }) {
  const R = d.realized, s = R.summary;
  const [status, setStatus] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = R.projects.filter((p: any) => (!status || p.status === status) && (!path || p.path === path)
    && terms.every(t => `${p.title} ${p.esh_id} ${p.program_code ?? ''} ${p.owner ?? ''} ${p.path ? VALUE_PATH[p.path].l : ''} ${R.status[p.status].l}`.toLowerCase().includes(t)));
  const { sorted, Th } = useSort<any>(rows, { key: 'realized', dir: -1 }, {
    realization: p => p.realization, roi: p => p.roi, payback: p => p.payback, status: p => Object.keys(R.status).indexOf(p.status), owner: p => p.owner ?? '',
  });

  // cumulative ledger chart
  const L = R.ledger, W = 560, H = 250, P = 46;
  const max = Math.max(...L.map((m: any) => Math.max(m.cumPlanned, m.cumRealized)), 1);
  const sx = (i: number) => P + (W - P - 12) * i / (L.length - 1), sy = (v: number) => H - 28 - (H - 44) * v / max;
  const line = (k: string) => L.map((m: any, i: number) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(m[k]).toFixed(1)}`).join(' ');
  const gap = L[L.length - 1].cumRealized - L[L.length - 1].cumPlanned;
  const steps = [0.25, 0.5, 0.75, 1].map(f => max * f);

  return (
    <>

      <div className="hk-grid three">
        <div className="hk"><span className="hk-l">Delivered to date</span><span className="hk-v">{$(s.realized)}</span><span className="hk-s">against {$(s.planned)} planned</span></div>
        <div className="hk"><span className="hk-l">Share of plan</span><span className="hk-v" style={{ color: (s.realization ?? 0) >= 0.9 ? 'var(--spon)' : 'var(--goldD)' }}>{pc(s.realization)}</span><span className="hk-s">baseline frozen at Gate 4, on its adoption ramp</span></div>
        <div className="hk"><span className="hk-l">Back per dollar, so far</span><span className="hk-v">{back(s.roi)}</span><span className="hk-s">delivered ÷ what these projects cost ({$(s.cost)})</span></div>
        <div className="hk"><span className="hk-l">Run rate</span><span className="hk-v">{$(s.runRate)}</span><span className="hk-s">a year, from the last three months · baseline {$(s.baselineAnnual)}</span></div>
        <div className="hk"><span className="hk-l">Paid back</span><span className="hk-v">{s.paidBack}</span><span className="hk-s">of {s.n} have returned more than they cost</span></div>
        <div className="hk"><span className="hk-l">Validated by J8</span><span className="hk-v">{pc(s.validatedShare)}</span><span className="hk-s">of benefit reported; the rest is sponsor or system data</span></div>
      </div>
      <Insights items={[
        s.roi != null && s.roi < 1 && s.runRate
          ? { t: <>At today's run rate, fielded projects pay back their cost in about <b>{((s.cost - s.realized) / s.runRate).toFixed(1)} more years</b></> }
          : { t: 'Fielded projects have paid back their cost', tone: 'good' },
        { t: `Run rate ${$(s.runRate)} a year against a full baseline of ${$(s.baselineAnnual)}` },
        s.status.AT_RISK + s.status.SILENT > 0 && { t: `${s.status.AT_RISK} at risk and ${s.status.SILENT} not reporting: owner conversations needed`, tone: 'warn' },
      ]} />

      <PathCard title="Value delivered, by type of return" hint="benefit delivered since transition · click a type to filter the list"
        center={$(s.realized)} sub="delivered" sel={path} onSel={setPath}
        items={R.byPath.map((p: any) => ({
          k: p.path, v: p.realized, big: $(p.realized),
          lines: [`${pc(p.planned ? p.realized / p.planned : null)} of the ${$(p.planned)} planned`, `${p.n} projects · ${back(p.cost ? p.realized / p.cost : null)} back per $ so far`],
        }))} />

      <PromiseVsDelivery />

      <div className="grid2">
        <Card title="The enterprise ledger" right={<span className="hint">cumulative benefit, all fielded projects · last 24 months</span>}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
            {steps.map(t => <g key={t}><line x1={P} y1={sy(t)} x2={W - 12} y2={sy(t)} stroke="#EEECE6" /><text x={P - 6} y={sy(t) + 3} textAnchor="end" fontSize={10} fill="var(--slate)">{$(t)}</text></g>)}
            {L.map((m: any, i: number) => i % 3 === 0 && <text key={m.m} x={sx(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--slate)">{MON(m.m)}</text>)}
            <path d={line('cumPlanned')} fill="none" stroke="#B9B4A8" strokeWidth={2} strokeDasharray="6 4" />
            <path d={`${line('cumRealized')} L${sx(L.length - 1)},${sy(0)} L${sx(0)},${sy(0)} Z`} fill="#2F7D5C" fillOpacity={0.08} />
            <path d={line('cumRealized')} fill="none" stroke="#2F7D5C" strokeWidth={2.5} />
            {L.map((m: any, i: number) => <circle key={m.m} cx={sx(i)} cy={sy(m.cumRealized)} r={7} fill="transparent"><title>{`${MON(m.m)}: delivered ${$(m.cumRealized)} of ${$(m.cumPlanned)} planned to date · ${m.reporting} projects reported`}</title></circle>)}
          </svg>
          <div className="legend"><span><i style={{ background: '#2F7D5C' }} />Delivered</span><span><i style={{ background: '#B9B4A8' }} />Planned (baseline on its ramp)</span></div>
          <div className="chart-note">{gap >= 0 ? <>Delivery is <b>{$(gap)} ahead</b> of plan in total.</> : <>Delivery is <b>{$(-gap)} behind</b> plan in total.</>} New transitions start on a six-month adoption ramp, so the planned line steepens as projects reach full value.</div>
        </Card>
        <Card title="How each fielded project is tracking" right={<span className="hint">click to filter the list</span>}>
          <div className="rs-bars">
            {Object.entries(R.status).map(([k, v]: [string, any]) => {
              const n = s.status[k] ?? 0;
              return (
                <button key={k} className={'rs-bar' + (status === k ? ' on' : '')} onClick={() => setStatus(status === k ? null : k)} disabled={!n}>
                  <span className="rs-l">{v.l}</span>
                  <span className="rs-track"><span style={{ width: `${100 * n / Math.max(1, s.n)}%`, background: v.c }} /></span>
                  <b>{n}</b>
                </button>
              );
            })}
          </div>
          <div className="chart-note">
            <b>Exceeding</b> ≥110% of plan · <b>on track</b> 90–110% · <b>behind</b> 60–90% · <b>at risk</b> under 60% · <b>not reporting</b> no report in 3+ months · <b>too early</b> under 3 reports.
          </div>
        </Card>
      </div>

      <Card title={`Fielded projects${status ? ` · ${R.status[status].l}` : ''}${path ? ` · ${VALUE_PATH[path].l}` : ''}`} pad={false}
        right={<span className="tabs">
          <input type="search" placeholder="Search project, program, owner, path, status…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} aria-label="Search fielded projects" />
          {status && <button onClick={() => setStatus(null)}>All statuses</button>}
          {path && <button onClick={() => setPath(null)}>All types</button>}
          <span className="hint">{sorted.length} project{sorted.length === 1 ? '' : 's'}</span>
        </span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat roi-t">
            <thead><tr><Th k="title">Project</Th><Th k="owner">Owner</Th><Th k="months" num>Months fielded</Th><Th k="cost" num>Invested</Th><Th k="planned" num>Planned to date</Th>
              <Th k="realized" num>Delivered</Th><Th k="realization" num>Of plan</Th><Th k="roi" num>Back per $</Th><Th k="payback" num>Payback</Th><Th k="status">Status</Th></tr></thead>
            <tbody>{sorted.map((p: any) => (
              <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)} title={p.note ?? ''}>
                <td className="ttl">{p.title}<div className="sub mono">{p.esh_id} · <ProgramLink code={p.program_code} /> · {p.path ? VALUE_PATH[p.path].l : '—'}</div>{p.note && <div className="sub">{p.note}</div>}</td>
                <td className="sm">{p.owner ?? '—'}</td>
                <td className="num mono">{p.months}</td>
                <td className="num">{$(p.cost)}</td><td className="num">{$(p.planned)}</td><td className="num">{$(p.realized)}</td>
                <td className="num"><span className="mini-track"><span style={{ width: `${Math.min(100, 100 * (p.realization ?? 0))}%`, background: R.status[p.status].c }} /></span> <span className="mono sm">{pc(p.realization)}</span></td>
                <td className="num"><b>{back(p.roi)}</b></td>
                <td className="num sm">{p.payback === 0 ? <b style={{ color: 'var(--spon)' }}>paid back</b> : p.payback != null ? `${p.payback.toFixed(1)} yrs` : '—'}</td>
                <td><StatusChip s={p.status} map={R.status} />{p.status === 'SILENT' && <div className="sub">{p.lastReport ? `last ${MON(p.lastReport.slice(0, 7))}` : 'never reported'}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!sorted.length && <div className="note" style={{ padding: 14 }}>No projects match.</div>}
      </Card>

      <div className="note" style={{ marginTop: 10 }}>
        <b>How realized return is tracked.</b> At Gate 4 the project's value case is frozen as its baseline: annual value at full adoption, its value path and the sponsor who owns it.
        Each month the sponsor reports the benefit delivered (from system data where it exists); J8 validates it a quarter later. Planned benefit follows a six-month adoption ramp, then the full baseline.
        Back per dollar = benefit delivered to date ÷ everything the project cost (J68 and sponsor). Across everything the portfolio has funded ({$(s.programCost)}, including exits and active projects),
        benefit realized so far is {back(s.programRoi)} per dollar.
        <Help title="Why two numbers?">
          The prospective return is a forecast: it tells leadership whether the bets in the pipeline are worth making. The realized return is an account: it tells them whether the bets that were made are paying off,
          and it is what earns the R&D portfolio its next budget. Keeping them apart stops a strong pipeline from hiding fielded projects that aren't delivering, and vice versa.
        </Help>
      </div>
      <div className="fine dm" style={{ marginTop: 6 }}>Baselines and monthly benefit reports in this demo are synthetic.</div>
    </>
  );
}

/* ── prospective: the active portfolio ── */
function Prospective({ d, horizon }: { d: any; horizon: number }) {
  const [all, setAll] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const projects = d.projects.filter((p: any) => (!path || p.path === path)
    && terms.every(t => `${p.title} ${p.esh_id} ${p.program_code ?? ''} ${p.path ? VALUE_PATH[p.path].l : ''} ${PH_SHORT[p.phase ?? 0]}`.toLowerCase().includes(t)));
  const { sorted, Th } = useSort<any>(projects, { key: 'net', dir: -1 }, {
    net: p => p.riskAdj - p.cost, mult: p => (p.cost ? p.riskAdj / p.cost : null), path: p => (p.path ? VALUE_PATH[p.path].l : null), annual: p => p.annual || null,
  });
  const s = d.summary;
  const slices = d.byPath.map((p: any) => ({ k: p.path, l: VALUE_PATH[p.path].l, v: p.annual, c: VALUE_PATH[p.path].c }));
  const costSlices = [{ k: 'j68', l: 'J68 R&D', v: s.j68, c: '#3F90CB' }, { k: 'sp', l: 'Sponsors', v: s.sponsor, c: '#2F7D5C' }];
  const shown = all || terms.length ? sorted : sorted.slice(0, 20);
  const pts = d.projects.filter((p: any) => p.cost > 0 && p.annual > 0);
  const lo = 1e4, hiX = Math.max(...pts.map((p: any) => p.cost), 1e6) * 1.3, hiY = Math.max(...pts.map((p: any) => p.annual), 1e6) * 1.3;
  const W = 560, H = 320, P = 42;
  const sx = (v: number) => P + (W - P - 10) * (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hiX) - Math.log10(lo));
  const sy = (v: number) => H - 30 - (H - 50) * (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hiY) - Math.log10(lo));
  const ticks = [1e5, 1e6, 1e7, 1e8].filter(t => t < Math.max(hiX, hiY));

  return (
    <>

      <div className="hk-grid three">
        <div className="hk"><span className="hk-l">Invested so far</span><span className="hk-v">{$(s.totalCost)}</span><span className="hk-s">{$(s.j68)} J68 R&D · {$(s.sponsor)} sponsors</span></div>
        <div className="hk"><span className="hk-l">Expected value, {horizon} years</span><span className="hk-v">{$(s.value)}</span><span className="hk-s">{$(s.annual)} a year from {s.withValue} projects with a value case</span></div>
        <div className="hk"><span className="hk-l">Risk-adjusted value</span><span className="hk-v">{$(s.riskAdj)}</span><span className="hk-s">each project's value × its chance of reaching scale</span></div>
        <div className="hk"><span className="hk-l">Return multiple</span><span className="hk-v">{x(s.riskMultiple)}</span>
          <span className="hk-pills"><span className={'pill ' + ((s.riskMultiple ?? 0) >= 1 ? 'good' : 'bad')}>{(s.riskMultiple ?? 0) >= 1 ? 'Returns more than it costs' : 'Below break-even'}</span></span>
          <span className="hk-s">risk-adjusted value ÷ cost · {x(s.multiple)} before risk</span></div>
        <div className="hk"><span className="hk-l">On the full cost</span><span className="hk-v" style={{ color: (s.fullMultiple ?? 0) >= 1 ? 'var(--spon)' : 'var(--red)' }}>{x(s.fullMultiple)}</span>
          <span className="hk-s">risk-adjusted value ÷ (spent + {$(s.costToComplete)} still to spend, PM estimates on {s.withCtc} projects)</span></div>
        <div className="hk click" onClick={() => go('#/exits')}><span className="hk-l">Cost of managed exits</span><span className="hk-v">{$(s.exitCost)}</span><span className="hk-s">{s.exits} projects stopped; the price of learning, carried in the whole-program view →</span></div>
      </div>
      <div className="fine dm">Value cases, funding and gate decisions in this demo are synthetic; in use they come from PMs, J8 and the gate record.</div>
      <Insights items={[
        { t: <>Every $1 invested is projected to return <b>${s.riskMultiple?.toFixed(2)}</b> over {horizon} years after risk (${s.multiple?.toFixed(2)} before)</> },
        s.fullMultiple != null && { t: `On full cost, including ${$(s.costToComplete)} still to spend: ${x(s.fullMultiple)}`, tone: (s.fullMultiple ?? 0) < 1 ? 'warn' : undefined },
        { t: `${s.annual ? Math.round(100 * s.certifiedAnnual / s.annual) : 0}% of projected value is J8-certified; the rest is PM estimate` },
      ]} />

      <PathCard title="Projected value, by type of return" hint="expected value a year from active projects · click a type to filter the list"
        center={$(s.annual)} sub="a year, projected" sel={path} onSel={setPath}
        items={d.byPath.map((p: any) => ({
          k: p.path, v: p.annual, big: `${$(p.annual)} a year`,
          lines: [`${$(p.riskAdj)} risk-adjusted over ${horizon} yrs · ${x(p.multiple)}`, `${p.n} projects · ${$(p.cost)} invested`],
        }))} />
      <div className="grid2">
        <Card title="Cost and value by phase" right={<span className="hint">$ millions · click a phase</span>}>
          <GroupBars cats={d.byPhase.map((p: any) => PH_SHORT[p.phase])} h={280}
            series={[
              { l: 'Invested', c: '#B9B4A8', v: d.byPhase.map((p: any) => p.cost / 1e6) },
              { l: `Expected value (${horizon} yrs)`, c: '#9FD0B6', v: d.byPhase.map((p: any) => p.value / 1e6) },
              { l: 'Risk-adjusted value', c: '#2F7D5C', v: d.byPhase.map((p: any) => p.riskAdj / 1e6) },
            ]}
            fmt={v => (v >= 10 ? v.toFixed(0) : v.toFixed(1))} onClick={i => go('#/phase/' + d.byPhase[i].phase)} />
          <div className="chart-note">Early-phase value is a hypothesis, so it is discounted by the chance of reaching scale:{' '}
            {d.byPhase.map((p: any) => `${PH_SHORT[p.phase]} ${Math.round(100 * p.prob)}%`).join(' · ')}. These come from the portfolio's own gate pass rates.</div>
        </Card>
        <Card title="Each project: cost against yearly value" right={<span className="hint">above the line returns more than it cost within {horizon} years</span>}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
            {ticks.map(t => <g key={'x' + t}><line x1={sx(t)} y1={10} x2={sx(t)} y2={H - 30} stroke="#EEECE6" /><text x={sx(t)} y={H - 14} textAnchor="middle" fontSize={10} fill="var(--slate)">{$(t)}</text></g>)}
            {ticks.map(t => <g key={'y' + t}><line x1={P} y1={sy(t)} x2={W - 10} y2={sy(t)} stroke="#EEECE6" /><text x={P - 5} y={sy(t) + 3} textAnchor="end" fontSize={10} fill="var(--slate)">{$(t)}</text></g>)}
            <line x1={sx(lo * horizon)} y1={sy(lo)} x2={sx(hiX)} y2={sy(hiX / horizon)} stroke="var(--goldD)" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - 14} y={sy(hiX / horizon) - 6} textAnchor="end" fontSize={10} fill="var(--goldD)">break-even in {horizon} years</text>
            {pts.map((p: any) => (
              <circle key={p.esh_id} cx={sx(p.cost)} cy={sy(p.annual)} r={4.5} fill={VALUE_PATH[p.path]?.c ?? 'var(--slate2)'} fillOpacity={path && p.path !== path ? 0.12 : 0.75}
                stroke="#fff" strokeWidth={0.8} style={{ cursor: 'pointer' }} onClick={() => go('#/p/' + p.esh_id)}>
                <title>{`${p.title}\nCost ${$(p.cost)} · ${$(p.annual)} a year · ${x(p.multiple)} risk-adjusted`}</title>
              </circle>
            ))}
            <text x={W / 2} y={H - 1} textAnchor="middle" fontSize={10.5} fill="var(--slate)">invested</text>
            <text x={12} y={H / 2} textAnchor="middle" fontSize={10.5} fill="var(--slate)" transform={`rotate(-90 12 ${H / 2})`}>value a year</text>
          </svg>
          <div className="legend">{Object.entries(VALUE_PATH).map(([k, v]) => <span key={k}><i style={{ background: v.c }} />{v.l}</span>)}</div>
        </Card>
      </div>

      <Card title="Where the money came from" right={<span className="hint">active projects</span>}>
          <div className="vdonut">
            <Donut slices={costSlices} size={230} center={$(s.totalCost)} sub="invested" />
            <div className="vlegend">
              {costSlices.map(c => <div key={c.k} className="vl"><i style={{ background: c.c }} /><span><b>{c.l}</b> <span className="pc">{s.totalCost ? Math.round(100 * c.v / s.totalCost) : 0}%</span><br /><span className="sub">{$(c.v)}</span></span></div>)}
              <div className="chart-note">Sponsors carry more of the cost as projects move into deployment: the ESF funding handoff.</div>
            </div>
          </div>
        </Card>

      <Card title={`Active projects by projected return${path ? ` · ${VALUE_PATH[path].l}` : ''}`} pad={false}
        right={<span className="tabs">
          <input type="search" placeholder="Search project, ID, program, path, phase…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 260 }} aria-label="Search projects" />
          {path && <button onClick={() => setPath(null)}>All value paths</button>}
          <span className="hint">{sorted.length} project{sorted.length === 1 ? '' : 's'}</span>
        </span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat roi-t">
            <thead><tr><Th k="title">Project</Th><Th k="phase">Phase</Th><Th k="path">Value path</Th><Th k="cost" num>Invested</Th><Th k="annual" num>Value a year</Th>
              <Th k="prob" num>Chance of scale</Th><Th k="net" num>Risk-adjusted return</Th><Th k="mult" num>Multiple</Th></tr></thead>
            <tbody>{shown.map((p: any) => {
              const net = p.riskAdj - p.cost;
              return (
                <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                  <td className="ttl">{p.title}<div className="sub mono">{p.esh_id} · <ProgramLink code={p.program_code} />{p.certified > 0 ? ' · J8 checked' : ''}</div></td>
                  <td><span className="phdot" style={{ background: PH_COL[p.phase ?? 0] }} />{PH_SHORT[p.phase ?? 0]}</td>
                  <td>{p.path ? <><span className="phdot" style={{ background: VALUE_PATH[p.path].c }} />{VALUE_PATH[p.path].l}</> : <span className="muted">no value case</span>}</td>
                  <td className="num">{$(p.cost)}</td><td className="num">{p.annual ? $(p.annual) : '—'}</td>
                  <td className="num">{Math.round(100 * p.prob)}%</td>
                  <td className="num" style={{ color: net >= 0 ? 'var(--spon)' : 'var(--red)', fontWeight: 700 }}>{net >= 0 ? '+' : '−'}{$(Math.abs(net))}</td>
                  <td className="num"><b>{p.cost ? x(p.riskAdj / p.cost) : '—'}</b></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        {!sorted.length && <div className="note" style={{ padding: 14 }}>No projects match.</div>}
        {!terms.length && sorted.length > 20 && <div style={{ padding: '10px 16px' }}><button className="link" onClick={() => setAll(!all)}>{all ? 'Show the first 20' : `Show all ${sorted.length}`}</button></div>}
      </Card>
      <div className="note" style={{ marginTop: 10 }}>
        <b>How this is calculated.</b> Cost = every funding line recorded for the active projects (J68 R&D and sponsor, all years). Value = each project's value cases × {horizon} years.
        Risk-adjusted value multiplies that by the chance of reaching scale from the current phase, the product of the remaining gates' pass rates. Return multiple = risk-adjusted value ÷ cost. No discounting is applied.
      </div>
    </>
  );
}
