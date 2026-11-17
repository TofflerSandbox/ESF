import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Help, Loading, Syn, VALUE_PATH, go, money, useAsync } from '../ui';
import { HubProposal } from './Ownership';

const $ = (v: number | null | undefined) => (v == null ? '—' : money(v).replace('.00M', 'M'));
const pc = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const MON = (p: string) => new Date(p.slice(0, 7) + '-15').toLocaleString('en-US', { month: 'short', year: '2-digit' });
const d10 = (s: string | null) => (s ? s.slice(0, 10) : '—');
const OWNER_C: Record<string, string> = { 'R&D': '#27568F', SPONSOR: '#2F7D5C', J8: '#8A6B25', J1: '#5B3E8C' };

/* ── on the project record: how the value claim moved from gate to gate, and what is left to spend ── */
export function ProjectValueHistory({ esh }: { esh: string }) {
  const { data: d, error, reload } = useAsync(() => api(`/projects/${esh}/realization`), [esh]);
  const [edit, setEdit] = useState(false);
  const [amt, setAmt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return null;
  const s = d.snapshots.filter((x: any) => x.annual != null);
  const save = async () => {
    setErr(null);
    try { await api(`/projects/${esh}/cost-to-complete`, { method: 'PUT', body: { amount: amt.trim() ? Number(amt) : null } }); setEdit(false); reload(); }
    catch (e: any) { setErr(String(e.message)); }
  };
  return (
    <div className="vh">
      <div className="lbl">How the value claim moved <Help title="Promise history">Each gate decision freezes the value case and what the project had cost at that moment, so the promise can be traced from intake to the Gate 4 baseline, and then against what is delivered. Early claims are usually optimistic; the portfolio-wide pattern is on the ROI page.</Help></div>
      {s.length === 0 ? <div className="note">No value claim was on record at a gate decision yet.</div> : (
        <table className="list flat vh-t">
          <thead><tr><th>Gate</th><th>Decided</th><th className="num">Annual value claimed</th><th className="num">Change</th><th className="num">Cost to date</th><th>J8</th></tr></thead>
          <tbody>{s.map((x: any, i: number) => {
            const prev = i ? s[i - 1].annual : null, ch = prev ? x.annual / prev - 1 : null;
            return (
              <tr key={i} style={{ cursor: 'default' }}>
                <td>Gate {x.gate} <span className="muted sm">{x.outcome?.toLowerCase()}</span></td><td className="mono sm">{d10(x.taken_at)}</td>
                <td className="num"><b>{$(x.annual)}</b> <Syn on={x.synthetic} /></td>
                <td className="num sm" style={{ color: ch == null ? undefined : ch < -0.05 ? 'var(--red)' : ch > 0.05 ? 'var(--spon)' : 'var(--slate)' }}>{ch == null ? '—' : `${ch > 0 ? '+' : ''}${Math.round(100 * ch)}%`}</td>
                <td className="num sm">{$(x.cost)}</td><td className="sm">{x.j8_certified ? '✓' : ''}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <div className="vh-ctc">
        <span><b>Cost to complete:</b> {d.costToComplete != null ? $(d.costToComplete) : <span className="muted">not estimated</span>} {d.costToCompleteSynthetic && <Syn />}
          <span className="sub"> PM's estimate of what is left to spend, all sources. The ROI page divides value by spent plus this.</span></span>
        {d.canEditCost && !edit && <button className="link" onClick={() => { setAmt(d.costToComplete != null ? String(d.costToComplete) : ''); setEdit(true); }}>update</button>}
      </div>
      {edit && <div className="inline-form"><input type="number" placeholder="$ left to spend" value={amt} onChange={e => setAmt(e.target.value)} /><button className="btn sm" onClick={save}>Save</button><button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button></div>}
      {err && <ErrorBox msg={err} />}
    </div>
  );
}

/* ── on a fielded project's record: the baseline, monthly delivery, reports, reviews and actions ── */
export function ProjectRealization({ esh }: { esh: string }) {
  const meta = useMeta();
  const { data: d, error, reload } = useAsync(() => api(`/projects/${esh}/realization`), [esh]);
  const [err, setErr] = useState<string | null>(null);
  const [rep, setRep] = useState<{ period: string; realized: string; method: string; note: string } | null>(null);
  const [hold, setHold] = useState<any>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!d || !d.baseline) return null;
  const b = d.baseline, ms = d.measures;
  const pl = ms.reduce((a: number, m: any) => a + m.planned, 0), re = ms.reduce((a: number, m: any) => a + m.realized, 0);
  const run = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); reload(); return true; } catch (e: any) { setErr(String(e.message)); return false; } };
  // chart: the last 24 reported months, planned vs delivered
  const S = ms.slice(-24), W = 520, H = 130, max = Math.max(1, ...S.map((m: any) => Math.max(m.planned, m.realized)));
  const bw = S.length ? (W - 20) / S.length : 0;
  const nextDue = d.reviews.find((r: any) => r.status === 'SCHEDULED');
  return (
    <Card title={<>Realized value: tracking since transition <Help title="Realized value">At Gate 4 the value case was frozen as this baseline. Each month the operational owner reports the benefit delivered; J8 validates it. Planned benefit follows a six-month adoption ramp, then the full baseline. Realization reviews at 6, 12 and 24 months record an outcome and owned actions, so R&D keeps working with the owner until the value is proven.</Help></>}
      right={<span className="hint">owner: {b.owner ?? '—'} {b.synthetic && <Syn />}</span>} className="rz-card">
      <div className="rz-kpis">
        <div><span>Baseline</span><b>{$(b.annual)}</b><small>a year · {VALUE_PATH[b.path]?.l ?? b.path} · since {d10(b.transitioned_on)}</small></div>
        <div><span>Delivered to date</span><b>{$(re)}</b><small>of {$(pl)} planned</small></div>
        <div><span>Of plan</span><b style={{ color: pl ? (re / pl >= 0.9 ? 'var(--spon)' : re / pl >= 0.6 ? 'var(--goldD)' : 'var(--red)') : undefined }}>{pl ? pc(re / pl) : '—'}</b><small>{ms.length} monthly report{ms.length === 1 ? '' : 's'}</small></div>
        <div><span>Next review</span><b>{nextDue ? `${nextDue.months} mo` : '—'}</b><small>{nextDue ? `due ${nextDue.due_on}${nextDue.due_on < d.asOf ? ' · overdue' : ''}` : 'none scheduled'}</small></div>
      </div>
      {S.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ width: '100%', height: 'auto' }}>
          {S.map((m: any, i: number) => (
            <g key={m.period}>
              <rect x={10 + i * bw + bw * 0.12} y={H - (H - 8) * m.planned / max} width={bw * 0.76} height={(H - 8) * m.planned / max} fill="#E4E0D5" />
              <rect x={10 + i * bw + bw * 0.28} y={H - (H - 8) * m.realized / max} width={bw * 0.44} height={(H - 8) * m.realized / max} fill={m.method === 'J8' ? '#1F6E4A' : '#58A47E'}>
                <title>{`${MON(m.period)}: delivered ${$(m.realized)} of ${$(m.planned)} planned · ${m.method === 'J8' ? 'J8 validated' : m.method === 'SYSTEM' ? 'system data' : 'sponsor estimate'}${m.note ? ' · ' + m.note : ''}`}</title>
              </rect>
              {(i % Math.ceil(S.length / 8) === 0) && <text x={10 + i * bw + bw / 2} y={H + 13} textAnchor="middle" fontSize={9} fill="var(--slate)">{MON(m.period)}</text>}
            </g>
          ))}
        </svg>
      )}
      <div className="legend"><span><i style={{ background: '#E4E0D5' }} />Planned</span><span><i style={{ background: '#58A47E' }} />Delivered (reported)</span><span><i style={{ background: '#1F6E4A' }} />Delivered (J8 validated)</span></div>

      {d.canReport && d.nextPeriod && !rep && <button className="btn sm" onClick={() => setRep({ period: d.nextPeriod.slice(0, 7), realized: '', method: 'SYSTEM', note: '' })}>Report {MON(d.nextPeriod)} benefit</button>}
      {rep && (
        <div className="form">
          <input type="month" value={rep.period} onChange={e => setRep({ ...rep, period: e.target.value })} />
          <input type="number" placeholder="Benefit delivered that month ($)" value={rep.realized} onChange={e => setRep({ ...rep, realized: e.target.value })} />
          <select value={rep.method} onChange={e => setRep({ ...rep, method: e.target.value })}><option value="SYSTEM">From system data</option><option value="SPONSOR">Sponsor estimate</option></select>
          <input placeholder="Note (optional): what moved the number" value={rep.note} onChange={e => setRep({ ...rep, note: e.target.value })} />
          <div><button className="btn sm" onClick={async () => { if (await run(() => api(`/projects/${esh}/benefits`, { method: 'POST', body: { period: rep.period, realized: Number(rep.realized), method: rep.method, note: rep.note || null } }))) setRep(null); }}>File report</button>
            <button className="btn sm ghost" onClick={() => setRep(null)}>Cancel</button></div>
        </div>
      )}
      {d.canValidate && ms.some((m: any) => m.method !== 'J8') && (
        <div className="sub" style={{ marginTop: 6 }}>J8 validation: {ms.filter((m: any) => m.method !== 'J8').slice(0, 6).map((m: any) => (
          <button key={m.period} className="chip-btn" onClick={() => run(() => api(`/projects/${esh}/benefits/${m.period.slice(0, 7)}/validate`, { method: 'POST' }))}>validate {MON(m.period)}</button>))}</div>
      )}

      <div className="lbl" style={{ marginTop: 12 }}>Realization reviews <HubProposal /></div>
      {d.reviews.map((r: any) => (
        <div key={r.id} className={'rz-rev' + (r.status === 'SCHEDULED' && r.due_on < d.asOf ? ' late' : '')}>
          <div className="row">
            <b>{r.months}-month review</b>
            {r.status === 'HELD'
              ? <span><span className="rs-chip" style={{ color: d.outcomes[r.outcome].c, borderColor: d.outcomes[r.outcome].c }}>{d.outcomes[r.outcome].l}</span> <span className="mono sm">{r.held_on}{r.realization != null ? ` · ${pc(Number(r.realization))} of plan` : ''}</span></span>
              : <span className="mono sm" style={{ color: r.due_on < d.asOf ? 'var(--red)' : undefined }}>due {r.due_on}{r.due_on < d.asOf ? ' · overdue' : ''}</span>}
          </div>
          {r.summary && <div className="sub">{r.summary}</div>}
          {r.actions.map((a: any) => (
            <div key={a.id} className={'rz-act' + (a.status === 'OPEN' && a.due_on < d.asOf ? ' late' : '')}>
              <span className="rz-own" style={{ background: OWNER_C[a.owner] }}>{a.owner}</span>
              <span className={a.status === 'DONE' ? 'done' : ''}>{a.text}</span>
              <span className="mono sm">{a.status === 'DONE' ? `done ${a.done_on}` : `due ${a.due_on}`}</span>
              {a.status === 'OPEN' && d.canAct && <button className="link" onClick={() => run(() => api(`/actions/${a.id}/done`, { method: 'POST' }))}>mark done</button>}
            </div>
          ))}
          {r.status === 'SCHEDULED' && d.canReview && hold?.id !== r.id && <button className="btn sm ghost" onClick={() => setHold({ id: r.id, outcome: 'ON_TRACK', summary: '', actions: [] })}>Record this review</button>}
          {hold?.id === r.id && (
            <div className="form">
              <select value={hold.outcome} onChange={e => setHold({ ...hold, outcome: e.target.value })}>{Object.entries(d.outcomes).map(([k, v]: [string, any]) => <option key={k} value={k}>{v.l}</option>)}</select>
              <textarea placeholder="What the review found (required)" value={hold.summary} onChange={e => setHold({ ...hold, summary: e.target.value })} />
              {hold.actions.map((a: any, i: number) => (
                <div key={i} className="inline-form">
                  <select value={a.owner} onChange={e => { const x = [...hold.actions]; x[i] = { ...a, owner: e.target.value }; setHold({ ...hold, actions: x }); }}>{Object.keys(d.owners).map(k => <option key={k} value={k}>{k}</option>)}</select>
                  <input placeholder="Action" value={a.text} onChange={e => { const x = [...hold.actions]; x[i] = { ...a, text: e.target.value }; setHold({ ...hold, actions: x }); }} />
                  <input type="date" value={a.due_on} onChange={e => { const x = [...hold.actions]; x[i] = { ...a, due_on: e.target.value }; setHold({ ...hold, actions: x }); }} />
                </div>
              ))}
              <div><button className="link" onClick={() => setHold({ ...hold, actions: [...hold.actions, { owner: 'SPONSOR', text: '', due_on: '' }] })}>+ add an owned action</button></div>
              <div><button className="btn sm" onClick={async () => { if (await run(() => api(`/projects/${esh}/reviews/${hold.id}/hold`, { method: 'POST', body: { outcome: hold.outcome, summary: hold.summary, actions: hold.actions.filter((a: any) => a.text.trim()) } }))) setHold(null); }}>Record review</button>
                <button className="btn sm ghost" onClick={() => setHold(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}
      {!d.reviews.length && <div className="note">No realization reviews scheduled.</div>}
      {err && <ErrorBox msg={err} />}
      {meta.me.role === 'SPONSOR' && !d.canReport && <div className="note sm">Your organization isn't this project's operational owner.</div>}
    </Card>
  );
}

/* ── the page: reviews due, outcomes, and open actions by owner ── */
export function Realization() {
  const { data: d, error } = useAsync(() => api('/realization'), []);
  const [owner, setOwner] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const T = d.totals;
  const acts = d.actions.filter((a: any) => !owner || a.owner === owner);
  const held12 = d.held.filter((r: any) => r.held_on >= new Date(new Date(d.asOf).getTime() - 365 * 864e5).toISOString().slice(0, 10));
  const Rev = ({ r, late }: { r: any; late?: boolean }) => (
    <a className={'own-item' + (late ? ' late' : '')} href={'#/p/' + r.esh_id}>
      <span className="own-k">{r.months}-month review · {r.esh_id} · <b style={{ color: late ? 'var(--red)' : undefined }}>due {r.due_on}</b></span>
      <span className="own-t">{r.title}</span><span className="sub">Owner: {r.owner ?? '—'}</span>
    </a>
  );
  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Realization reviews <HubProposal /></h2>
          <div className="vsub">R&D's work doesn't end at Gate 4. The operational owner reports benefit monthly, and at 6, 12 and 24 months after transition R&D and the owner review delivery against the baseline, agree an outcome, and own the actions that close the gap.</div></div>
      </div>
      <div className="takeaway">
        {T.fielded} fielded projects are being tracked; {T.reportedLastMonth} filed last month's benefit report. {d.overdue.length} review{d.overdue.length === 1 ? ' is' : 's are'} overdue and {d.upcoming.length} fall due in the next 90 days.
        {' '}{d.actions.length} actions are open, {T.overdueActions} past due: <b>{T.openByOwner['R&D']} with R&D</b>, {T.openByOwner.SPONSOR} with sponsors, {T.openByOwner.J8} with J8, {T.openByOwner.J1} with J1.
      </div>
      <div className="hk-grid fit">
        <div className="hk"><span className="hk-l">Fielded, tracked</span><span className="hk-v">{T.fielded}</span><span className="hk-s">projects with a Gate 4 baseline</span></div>
        <div className="hk"><span className="hk-l">Reported last month</span><span className="hk-v">{T.reportedLastMonth}/{T.fielded}</span><span className="hk-s">monthly benefit reports filed by owners</span></div>
        <div className="hk"><span className="hk-l">Reviews overdue</span><span className="hk-v" style={{ color: d.overdue.length ? 'var(--red)' : undefined }}>{d.overdue.length}</span><span className="hk-s">due and not yet held</span></div>
        <div className="hk"><span className="hk-l">Due in 90 days</span><span className="hk-v">{d.upcoming.length}</span><span className="hk-s">to schedule with owners</span></div>
        <div className="hk"><span className="hk-l">Open actions</span><span className="hk-v">{d.actions.length}</span><span className="hk-s">{T.overdueActions} past due · {d.actionsDone} closed so far</span></div>
      </div>

      <div className="grid2">
        <Card title="Overdue and upcoming reviews" right={<span className="hint">next 90 days</span>}>
          {d.overdue.map((r: any) => <Rev key={r.id} r={r} late />)}
          {d.upcoming.map((r: any) => <Rev key={r.id} r={r} />)}
          {!d.overdue.length && !d.upcoming.length && <div className="note">Nothing due.</div>}
        </Card>
        <Card title="Review outcomes" right={<span className="hint">held in the last 12 months</span>}>
          <div className="rs-bars">
            {Object.entries(d.outcomes).map(([k, v]: [string, any]) => {
              const n = held12.filter((r: any) => r.outcome === k).length;
              return <div key={k} className="rs-bar" style={{ cursor: 'default' }}><span className="rs-l">{v.l}</span><span className="rs-track"><span style={{ width: `${100 * n / Math.max(1, held12.length)}%`, background: v.c }} /></span><b>{n}</b></div>;
            })}
          </div>
          <div className="mini-list" style={{ maxHeight: 260, overflowY: 'auto', marginTop: 10 }}>
            {held12.slice(0, 20).map((r: any) => (
              <div key={r.id} className="alert-row" onClick={() => go('#/p/' + r.esh_id)}>
                <span style={{ flex: 1 }}><b>{r.title}</b><br /><span className="sub"><b style={{ color: d.outcomes[r.outcome].c }}>{d.outcomes[r.outcome].l}</b> at {r.months} months · {r.held_on}{r.realization != null ? ` · ${pc(r.realization)} of plan` : ''}</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Open actions by owner" pad={false} right={<span className="tabs">
        <button className={!owner ? 'on' : ''} onClick={() => setOwner(null)}>All {d.actions.length}</button>
        {Object.entries(d.owners).map(([k, l]: [string, any]) => <button key={k} className={owner === k ? 'on' : ''} onClick={() => setOwner(k)} title={l}>{k} {T.openByOwner[k]}</button>)}
      </span>}>
        <table className="list flat rows">
          <thead><tr><th>Owner</th><th>Action</th><th>Project</th><th>From</th><th>Due</th></tr></thead>
          <tbody>{acts.map((a: any) => (
            <tr key={a.id} onClick={() => go('#/p/' + a.esh_id)}>
              <td><span className="rz-own" style={{ background: OWNER_C[a.owner] }}>{a.owner}</span></td>
              <td className="ttl">{a.text}</td><td className="sm">{a.title}<div className="sub mono">{a.esh_id} · {a.org ?? '—'}</div></td>
              <td className="sm">{a.months}-month review</td>
              <td className="mono sm" style={{ color: a.overdue ? 'var(--red)' : undefined, fontWeight: a.overdue ? 700 : 400 }}>{a.due_on}{a.overdue ? ' · overdue' : ''}</td>
            </tr>
          ))}</tbody>
        </table>
        {!acts.length && <div className="note" style={{ padding: 14 }}>No open actions.</div>}
      </Card>
      <div className="fine" style={{ marginTop: 8 }}>◆ Baselines, benefit reports, reviews and actions in this demo are synthetic. Realization reviews are a Hub proposal to the ESF, which ends J68's role at Gate 4.</div>
    </div>
  );
}

/* ── ROI page, realized lens: promise vs delivery ── */
export function PromiseVsDelivery() {
  const { data: d, error } = useAsync(() => api('/value-drift'), []);
  const [by, setBy] = useState<'byOwner' | 'byProgram'>('byOwner');
  if (error) return <ErrorBox msg={error} />;
  if (!d) return null;
  const T = d.totals;
  const bars = [
    { l: 'Gate 2 promise', v: T.promiseWithRun, c: '#B9B4A8' },
    { l: 'Gate 4 baseline', v: d.fielded.filter((f: any) => f.runRate != null).reduce((a: number, f: any) => a + f.baseline, 0), c: '#9FD0B6' },
    { l: 'Run rate today', v: T.runRate, c: '#2F7D5C' },
  ];
  const max = Math.max(1, ...bars.map(b => b.v));
  return (
    <Card title={<>Promise vs delivery <Help title="Promise vs delivery">Every gate decision freezes the value claim. For fielded projects at least nine months past transition (past the adoption ramp), this compares what was promised at Gate 2, the Gate 4 baseline, and the annual run rate being delivered now. Forecast accuracy = run rate ÷ Gate 2 promise.</Help></>}
      right={<span className="tabs"><button className={by === 'byOwner' ? 'on' : ''} onClick={() => setBy('byOwner')}>By owner</button><button className={by === 'byProgram' ? 'on' : ''} onClick={() => setBy('byProgram')}>By program</button></span>}>
      <div className="pvd">
        <div>
          {bars.map(b => (
            <div key={b.l} className="pvd-bar"><span className="pvd-l">{b.l}</span><span className="pvd-track"><span style={{ width: `${100 * b.v / max}%`, background: b.c }} /></span><b>{$(b.v)}</b></div>
          ))}
          <div className="chart-note">
            Across {d.fielded.filter((f: any) => f.runRate != null).length} projects past the ramp, the median project delivers <b>{pc(T.medianAccuracy)}</b> of its Gate 2 promise.
            Promises shrink on the way: the median claim at Gate 0 is {d.byGate[0]?.vsBaseline ? `${Math.round(100 * (d.byGate[0].vsBaseline - 1))}% above` : '—'} the eventual Gate 4 baseline.
          </div>
          <div className="pvd-gates">{d.byGate.map((g: any) => <span key={g.gate}><b>Gate {g.gate}</b>{g.vsBaseline ? `${g.vsBaseline.toFixed(2)}×` : '—'}</span>)}<small>median claim ÷ Gate 4 baseline</small></div>
        </div>
        <table className="list flat">
          <thead><tr><th>{by === 'byOwner' ? 'Owner' : 'Program'}</th><th className="num">Fielded</th><th className="num">Gate 2 promise</th><th className="num">Run rate</th><th className="num">Accuracy</th></tr></thead>
          <tbody>{d[by].slice(0, 10).map((g: any) => (
            <tr key={g.k} style={{ cursor: 'default' }}>
              <td className="ttl">{g.k}</td><td className="num mono">{g.n}</td><td className="num">{$(g.promise)}</td><td className="num">{g.runRate ? $(g.runRate) : '—'}</td>
              <td className="num"><b style={{ color: g.accuracy == null ? undefined : g.accuracy >= 0.9 ? 'var(--spon)' : g.accuracy >= 0.6 ? 'var(--goldD)' : 'var(--red)' }}>{pc(g.accuracy)}</b></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}
