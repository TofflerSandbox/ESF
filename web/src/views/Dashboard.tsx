import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Bars, Card, Chip, EL_COL, ErrorBox, Loading, PH_COL, PH_SHORT, STATUS, STATUS_COL, Stack, go, useAsync } from '../ui';

const TAG: Record<string, { c: string; bg: string; l: string }> = {
  ADA: { c: 'var(--red)', bg: 'var(--redBg)', l: 'Anti-Deficiency exposure' },
  READY: { c: 'var(--spon)', bg: 'var(--sponBg)', l: 'Ready for gate decision' },
  'POP-LAPSED': { c: 'var(--red)', bg: 'var(--redBg)', l: 'PoP ended, still "Ongoing"' },
  'POP-END': { c: 'var(--goldD)', bg: 'var(--goldBg)', l: 'PoP ends within 6 months' },
  'NO-SPONSOR': { c: 'var(--slate)', bg: '#EDEBE4', l: 'No sponsor on record' },
  'NO-ALIGN': { c: 'var(--slate)', bg: '#EDEBE4', l: 'Not aligned to a priority' },
};

export function Dashboard() {
  const meta = useMeta();
  const [fy, setFy] = useState(meta.latestFy);
  const [tag, setTag] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { data: d, error } = useAsync(() => api(`/dashboard?fy=${fy}`), [fy]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;

  const sum = (rows: any[]) => rows.reduce((a, r) => a + r.n, 0);
  const st = Object.fromEntries(d.byStatus.map((r: any) => [r.s, r.n]));
  const live = (st.A ?? 0) + (st.B ?? 0) + (st.C ?? 0);
  const transitioned = d.byTransition.reduce((a: number, r: any) => a + r.done, 0);
  const confirmed = d.triage.find((t: any) => t.esf_source === 'CONFIRMED')?.n ?? 0;
  const total = sum(d.byStatus);

  const years = [...new Set(d.byYear.map((r: any) => r.fy))] as number[];
  const yearRows = years.map(y => ({ l: 'FY' + String(y).slice(2), v: Object.fromEntries(d.byYear.filter((r: any) => r.fy === y).map((r: any) => [r.s, r.n])) }));

  const esfActive = [0, 1, 2, 3, 4, 5].map(ph => ({
    l: PH_SHORT[ph], c: PH_COL[ph], onClick: () => go('#/phase/' + ph),
    v: d.esf.filter((r: any) => r.esf_phase === ph && (ph === 5 ? r.esf_status === 'AT_SCALE' : ['ACTIVE', 'HOLD'].includes(r.esf_status))).reduce((a: number, r: any) => a + r.n, 0),
  }));

  const owners = [...new Set(meta.priorities.filter(p => p.fy === fy).map(p => p.owner))];
  const programs = [...new Set(d.heat.map((h: any) => h.program))].sort() as string[];
  const heatMax = Math.max(...d.heat.map((h: any) => h.n), 1);
  const cell = (p: string, o: string) => d.heat.find((h: any) => h.program === p && h.owner === o)?.n ?? 0;

  const alerts = tag ? d.alerts.filter((a: any) => a.tag === tag) : d.alerts;

  return (
    <>
      <div className="vhead">
        <div><h2 className="vt">Portfolio Dashboard</h2>
          <div className="vsub">J68 R&D portfolio as reported in the FY{fy} alignment data call · {total} projects of record · rules as of {d.asOf}</div></div>
        <label className="fy">Data call <select value={fy} onChange={e => setFy(Number(e.target.value))}>{meta.fys.map(f => <option key={f.fy} value={f.fy}>FY{f.fy}</option>)}</select></label>
      </div>
      <div className="kpi-grid">
        <div className="kpi" onClick={() => go(`#/projects?fy=${fy}&status=B`)}><div className="v">{live}</div><div className="l">live projects (new start, ongoing, monitoring)</div></div>
        <div className="kpi" onClick={() => go(`#/projects?fy=${fy}&status=A`)}><div className="v">{st.A ?? 0}</div><div className="l">new starts this cycle</div></div>
        <div className="kpi"><div className="v">{transitioned}</div><div className="l">transitions marked complete</div></div>
        <div className="kpi" onClick={() => go(`#/projects?fy=${fy}&status=D`)}><div className="v">{st.D ?? 0}</div><div className="l">completing or cancelling</div></div>
        <div className="kpi warn" onClick={() => setTag('POP-LAPSED')}><div className="v">{d.alertCounts['POP-LAPSED']}</div><div className="l">PoP lapsed but still "Ongoing" — data-call hygiene</div></div>
        <div className="kpi" onClick={() => go('#/triage')}><div className="v">{confirmed}<small> / {total}</small></div><div className="l">ESF phase confirmed (rest are suggestions)</div></div>
      </div>

      {meta.scenarios.some(s => s.track === 'ESF') && (
        <Card title="Demo scenarios" right={<span className="syn">SYNTHETIC</span>} pad={false}>
          <div className="scen">
            {meta.scenarios.filter(s => s.track === 'ESF').map(s => (
              <a key={s.ord} href={'#/p/' + s.esh_id} className="sc">
                <div className="n">{s.ord}</div>
                <div><b>{s.title}</b><div className="code mono">{s.esh_id} · {s.project_title}</div>
                  <p>{s.story}</p><div className="lf">Look for: {s.look_for}</div></div>
              </a>
            ))}
          </div>
        </Card>
      )}

      <div className="grid2">
        <Card title="Portfolio by data call and status" right={<span className="mono">projects reported</span>}>
          <Stack rows={yearRows} keys={['A', 'B', 'C', 'D', 'E', '?']} colors={STATUS_COL} labels={{ ...STATUS, '?': 'No status' }} />
        </Card>
        <Card title="ESF phase — live portfolio" right={<a href="#/board">open pipeline →</a>}>
          <Bars items={esfActive} />
          <div className="note">Phases are <b>suggested</b> from status, transition fields, SBIR phase and PoP elapsed until a J68 admin confirms them in Phase review.</div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Live projects by program" right={Object.entries(EL_COL).map(([e, c]) => <Chip key={e} c={c}>{e}</Chip>)}>
          <div className="hbars">
            {d.byProgram.filter((r: any) => r.live > 0).map((r: any) => {
              const mx = Math.max(...d.byProgram.map((x: any) => x.live), 1);
              return (
                <div key={r.k} className="hbar" onClick={() => go(`#/projects?fy=${fy}&program=${encodeURIComponent(r.k)}`)}>
                  <span className="mono" style={{ color: EL_COL[r.el] ?? 'var(--slate)' }}>{r.k}</span>
                  <span className="track"><span style={{ width: `${Math.max(2, 100 * r.live / mx)}%`, background: EL_COL[r.el] ?? 'var(--slate2)' }} /></span>
                  <span className="mono n">{r.live}<small> / {r.n}</small></span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Transition type" right={<span className="mono">reported · complete</span>}>
          <div className="hbars">
            {d.byTransition.slice(0, 11).map((r: any) => {
              const mx = Math.max(...d.byTransition.map((x: any) => x.n), 1);
              return (
                <div key={r.k} className="hbar wide">
                  <span title={r.k}>{r.k}</span>
                  <span className="track"><span style={{ width: `${Math.max(2, 100 * r.n / mx)}%`, background: 'var(--j68)' }} /><span style={{ width: `${100 * r.done / mx}%`, background: 'var(--spon)' }} /></span>
                  <span className="mono n">{r.n}<small> · {r.done}</small></span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title={`Priority alignment — FY${fy} · program × priority owner`} right={<span className="mono">projects aligned</span>}>
        {programs.length === 0 ? <div className="note">No alignment data for FY{fy}.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="heat">
              <thead><tr><th />{owners.map(o => <th key={o}>{o}</th>)}</tr></thead>
              <tbody>{programs.map(p => (
                <tr key={p}><th className="mono">{p}</th>{owners.map(o => {
                  const n = cell(p, o);
                  return <td key={o} onClick={() => n && go(`#/projects?fy=${fy}&program=${encodeURIComponent(p)}&owner=${encodeURIComponent(o)}`)}
                    style={{ background: n ? `rgba(22,35,60,${0.08 + 0.8 * n / heatMax})` : undefined, color: n / heatMax > 0.45 ? '#fff' : 'var(--navy)', cursor: n ? 'pointer' : undefined }}>{n || ''}</td>;
                })}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="toppri">
          {d.topPriorities.map((p: any) => <a key={p.id} href={`#/projects?fy=${fy}&priority=${p.id}`}><b>{p.n}</b> {p.owner}: {p.label}</a>)}
        </div>
      </Card>

      <div className="grid3" style={{ marginTop: 14 }}>
        <Card title="Attention queue" pad={false} right={
          <span className="tags">{Object.entries(d.alertCounts).map(([t, n]) => (n as number) > 0 &&
            <button key={t} className={'tagbtn' + (tag === t ? ' on' : '')} style={{ color: TAG[t].c, background: TAG[t].bg }} onClick={() => setTag(tag === t ? null : t)} title={TAG[t].l}>{t} {n as number}</button>)}</span>}>
          {alerts.slice(0, showAll ? alerts.length : 14).map((a: any, i: number) => (
            <div key={i} className="alert-row" onClick={() => go('#/p/' + a.esh_id)}>
              <span className="tag" style={{ color: TAG[a.tag].c, background: TAG[a.tag].bg }}>{a.tag}</span>
              <span><b>{a.esh_id}</b> · {a.title}<br /><span className="sub">{a.text}</span></span>
            </div>
          ))}
          {alerts.length > 14 && <button className="more link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${alerts.length}`}</button>}
        </Card>
        <Card title="Decision queue" pad={false}>
          {d.ready.length ? d.ready.map((p: any) => (
            <div key={p.esh_id} className="alert-row" onClick={() => go('#/p/' + p.esh_id)}>
              <span className="tag" style={{ color: 'var(--goldD)', background: 'var(--goldBg)' }}>G{p.gate}</span>
              <span><b>{p.esh_id}</b> — {p.title}</span>
            </div>
          )) : <div className="cbd note">No confirmed project has all gate criteria met yet. Confirm phases in <a href="#/triage">Phase review</a>, then record criteria evidence on the project record.</div>}
        </Card>
      </div>
    </>
  );
}
