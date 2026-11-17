import { useState } from 'react';
import { api } from '../api';
import { useSort } from '../sort';
import { Bars, Card, Donut, EL_COL, ErrorBox, Help, Loading, OrgList, PH_COL, PH_SHORT, PhaseChip, Stack, VALUE_PATH, go, money, useAsync } from '../ui';

const $ = (v: number | null | undefined) => (v == null ? '—' : money(v).replace('.00M', 'M'));
const x = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}×`);
const pc = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const tone = (v: number | null | undefined, good: number, ok: number) => (v == null ? undefined : v >= good ? 'var(--spon)' : v >= ok ? 'var(--goldD)' : 'var(--red)');
const STAGE: Record<string, { l: string; c: string }> = { preparing: { l: 'Preparing', c: '#3F90CB' }, nearly: { l: 'Nearly ready', c: '#C9A961' }, ready: { l: 'Ready', c: '#2F7D5C' }, hold: { l: 'On hold', c: '#8A6B25' } };

/* ── index: every program side by side ── */
export function Programs() {
  const { data: d, error } = useAsync(() => api('/programs'), []);
  const { sorted, Th } = useSort<any>(d?.rows ?? [], { key: 'live', dir: -1 }, {});
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  return (
    <div className="home">
      <div className="vhead"><div><h2 className="vt">Programs</h2>
        <div className="vsub">The portfolio by program: what each one has in work and at scale, what it has cost, what it is projected to return, and what its fielded projects are delivering. Click a program for its page.</div></div></div>
      <Card title="All programs" pad={false} right={<span className="hint">{d.rows.length} programs</span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="code">Program</Th><Th k="live" num>Active</Th><Th k="atScale" num>At scale</Th><Th k="exits" num>Exits</Th><Th k="invested" num>Invested</Th>
              <Th k="riskAdj" num>Risk-adj. value (5 yrs)</Th><Th k="multiple" num>Multiple</Th><Th k="realization" num>Fielded: of plan</Th><Th k="ready" num>Ready for a gate</Th></tr></thead>
            <tbody>{sorted.map((r: any) => (
              <tr key={r.code} onClick={() => go('#/program/' + r.code)}>
                <td className="ttl"><span className="mono" style={{ color: EL_COL[r.element_code] ?? 'var(--navy)', fontWeight: 700 }}>{r.code}</span> <span className="sm muted">{r.name}</span></td>
                <td className="num mono">{r.live}</td><td className="num mono">{r.atScale || '—'}</td><td className="num mono">{r.exits || '—'}</td>
                <td className="num">{$(r.invested)}</td><td className="num">{$(r.riskAdj)}</td>
                <td className="num"><b style={{ color: tone(r.multiple, 1.5, 1) }}>{x(r.multiple)}</b></td>
                <td className="num"><b style={{ color: tone(r.realization, 0.9, 0.6) }}>{r.atScale ? pc(r.realization) : '—'}</b></td>
                <td className="num mono">{r.ready || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <div className="fine" style={{ marginTop: 8 }}>◆ Lifecycle, funding and value data in this demo are synthetic. Programs come from the data-call workbooks.</div>
    </div>
  );
}

/* ── one program ── */
export function Program({ code }: { code: string }) {
  const { data: d, error } = useAsync(() => api(`/programs/${code}`), [code]);
  const [ph, setPh] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [liveOnly, setLiveOnly] = useState(true);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (d?.projects ?? []).filter((p: any) => (!liveOnly || ['ACTIVE', 'HOLD', 'AT_SCALE'].includes(p.esf_status))
    && (ph == null || (ph === 5 ? p.esf_status === 'AT_SCALE' : p.esf_phase === ph && p.esf_status !== 'AT_SCALE'))
    && terms.every(t => `${p.title} ${p.esh_id} ${p.pm ?? ''} ${(p.sponsor_list ?? []).map((s: any) => s.name).join(' ')}`.toLowerCase().includes(t)));
  const { sorted, Th } = useSort<any>(rows, { key: 'phase', dir: -1 }, {
    phase: p => (p.esf_status === 'AT_SCALE' ? 5 : p.esf_phase ?? -1), sponsor: p => p.sponsor_list?.[0]?.name ?? null,
  });
  if (error) return <><a className="bk" href="#/programs">← Programs</a><ErrorBox msg={error} /></>;
  if (!d) return <Loading />;
  const P = d.program, R = d.row, col = EL_COL[P.element_code] ?? 'var(--navy)';
  const slices = d.byPath.map((b: any) => ({ k: b.path, l: VALUE_PATH[b.path].l, v: b.annual, c: VALUE_PATH[b.path].c })).filter((s: any) => s.v > 0);
  const fielded = Object.values(d.realizedStatus as Record<string, number>).reduce((a, n) => a + n, 0);
  return (
    <div className="home">
      <a className="bk" href="#/programs">← Programs</a>
      <div className="prog-head" style={{ ['--pc' as any]: col }}>
        <div>
          <div className="crumb">{P.element_code ?? '—'} program</div>
          <h2 className="vt"><span className="mono">{P.code}</span> · {P.name}</h2>
          <div className="vsub">{R.projects} projects across the data calls · {R.live} active · {R.atScale} at scale · {R.exits} managed exits{R.unconfirmed ? ` · ${R.unconfirmed} awaiting phase review` : ''}
            {d.rank.live && <> · {ordinal(d.rank.live.pos)} of {d.rank.live.of} programs by active projects</>}</div>
        </div>
        <a className="btn ghost" href={`#/projects?program=${P.code}`}>Open in Projects →</a>
      </div>

      <div className="hk-grid three">
        <div className="hk"><span className="hk-l">Invested</span><span className="hk-v">{$(R.invested)}</span><span className="hk-s">{$(R.j68)} J68 R&D · {$(R.invested - R.j68)} sponsors ({R.invested ? pc((R.invested - R.j68) / R.invested) : '—'})</span></div>
        <div className="hk"><span className="hk-l">Projected return</span><span className="hk-v" style={{ color: tone(R.multiple, 1.5, 1) }}>{x(R.multiple)}</span><span className="hk-s">{$(R.riskAdj)} risk-adjusted over 5 years · {x(R.fullMultiple)} on full cost</span></div>
        <div className="hk"><span className="hk-l">Fielded: of plan</span><span className="hk-v" style={{ color: tone(R.realization, 0.9, 0.6) }}>{R.atScale ? pc(R.realization) : '—'}</span><span className="hk-s">{R.atScale ? `${$(R.realized)} delivered · ${R.backPerDollar != null ? (R.backPerDollar < 1 ? Math.round(100 * R.backPerDollar) + '¢' : '$' + R.backPerDollar.toFixed(2)) : '—'} back per $ so far` : 'nothing fielded yet'}</span></div>
      </div>

      <div className="grid2">
        <Card title="Where its projects are" right={<span className="hint">active by ESF phase, and at scale · click a bar to filter</span>}>
          <Bars h={200} items={d.phases.map((p: any) => ({ l: p.name, v: p.n, c: PH_COL[p.phase], onClick: () => { setPh(ph === p.phase ? null : p.phase); setLiveOnly(true); } }))} />
        </Card>
        <Card title="Projected value by type of return" right={<span className="hint">active projects, a year</span>}>
          {slices.length ? (
            <div className="vdonut">
              <Donut slices={slices} size={200} center={$(R.annual)} sub="a year" />
              <div className="vlegend">{d.byPath.filter((b: any) => b.annual > 0 || b.fielded > 0).map((b: any) => (
                <div key={b.path} className="vl"><i style={{ background: VALUE_PATH[b.path].c }} /><span><b>{VALUE_PATH[b.path].l}</b><br />
                  <span className="sub">{$(b.annual)} a year · {b.n} active{b.fielded ? ` · ${$(b.realized)} delivered by ${b.fielded} fielded` : ''}</span></span></div>
              ))}</div>
            </div>
          ) : <div className="note">No value cases recorded for this program's active projects.</div>}
        </Card>
      </div>

      <div className="grid2">
        <Card title={<>Gate readiness <Help title="Gate readiness">Active projects by the gate they are working toward: preparing, nearly ready (75%+ of criteria closed), ready for a decision, or on hold.</Help></>} right={<a href="#/gates">All gates →</a>}>
          <table className="list flat prog-gates">
            <thead><tr><th>Gate</th>{Object.values(STAGE).map(s => <th key={s.l} className="num"><i className="dot" style={{ background: s.c }} />{s.l}</th>)}<th className="num">Running late</th></tr></thead>
            <tbody>{d.gates.map((g: any) => (
              <tr key={g.gate} style={{ cursor: 'default' }}>
                <td className="sm"><b>Gate {g.gate}</b> <span className="muted">{g.from_name} → {g.to_name}</span></td>
                {Object.keys(STAGE).map(k => <td key={k} className="num mono" style={{ color: g[k] && k === 'ready' ? 'var(--spon)' : undefined, fontWeight: g[k] && k === 'ready' ? 700 : 400 }}>{g[k] || '—'}</td>)}
                <td className="num mono" style={{ color: g.late ? 'var(--red)' : undefined }}>{g.late || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Transition readiness" right={<a href="#/funding">Funding & transition →</a>}>
          <div className="prog-ready">{d.readiness.map((r: any) => (
            <div key={r.k}><i style={{ background: r.c }} /><span>{r.l}</span><b>{r.n}</b></div>
          ))}</div>
          <div className="chart-note">Phase II–IV projects. A pathway is committed when the receiving organization, funding line and (Path B) POM year are named.</div>
          {fielded > 0 && <>
            <div className="lbl" style={{ marginTop: 12 }}>Fielded projects: how they are tracking</div>
            <div className="prog-ready">{Object.entries(d.statusMap).filter(([k]) => d.realizedStatus[k]).map(([k, v]: [string, any]) => (
              <div key={k}><i style={{ background: v.c }} /><span>{v.l}</span><b>{d.realizedStatus[k]}</b></div>
            ))}</div>
          </>}
        </Card>
      </div>

      <div className="grid2">
        <Card title="Who sponsors its projects" pad={false}>
          <table className="list flat rows">
            <thead><tr><th>Organization</th><th className="num">Active</th><th className="num">At scale</th><th className="num">All</th></tr></thead>
            <tbody>{d.sponsors.slice(0, 10).map((s: any) => (
              <tr key={s.id} onClick={() => go('#/org/' + s.id)}><td className="ttl">{s.name}</td><td className="num mono">{s.live || '—'}</td><td className="num mono">{s.atScale || '—'}</td><td className="num mono">{s.all}</td></tr>
            ))}</tbody>
          </table>
          {!d.sponsors.length && <div className="note" style={{ padding: 12 }}>No sponsors named.</div>}
        </Card>
        <Card title="Why projects left" right={<a href="#/exits">Managed exits →</a>}>
          {d.exitReasons.length ? <div className="obars">{d.exitReasons.map((e: any) => (
            <div key={e.k} className="obar"><span className="on wide">{e.l}</span><span className="track"><span style={{ width: `${100 * e.n / Math.max(...d.exitReasons.map((z: any) => z.n))}%`, background: '#8A8378' }} /></span><span className="ov">{e.n}</span></div>
          ))}</div> : <div className="note">No managed exits recorded.</div>}
          {d.byFy.length > 0 && <>
            <div className="lbl" style={{ marginTop: 12 }}>Who pays, year by year ($ millions)</div>
            <Stack h={150} rows={d.byFy.map((f: any) => ({ l: 'FY' + String(f.fy).slice(2), v: { J68: f.j68 / 1e6, Sponsor: f.sponsor / 1e6 } }))} keys={['J68', 'Sponsor']}
              colors={{ J68: '#3F90CB', Sponsor: '#2F7D5C' }} labels={{ J68: 'J68 R&D', Sponsor: 'Sponsors' }} fmt={v => v.toFixed(1)} />
          </>}
        </Card>
      </div>

      <Card title={`Projects${ph != null ? ` · ${PH_SHORT[ph]}` : ''}`} pad={false} right={<span className="tabs">
        <input type="search" placeholder="Search project, PM, sponsor…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} aria-label="Search projects" />
        {ph != null && <button onClick={() => setPh(null)}>All phases</button>}
        <label className="chk"><input type="checkbox" checked={liveOnly} onChange={e => setLiveOnly(e.target.checked)} /> active and at scale only</label>
        <span className="hint">{sorted.length}</span>
      </span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="title">Project</Th><Th k="phase">ESF</Th><Th k="sponsor">Sponsor</Th><Th k="pm">PM</Th><Th k="annual" num>Value a year</Th><Th k="multiple" num>Multiple</Th><th>Gate / transition / delivery</th></tr></thead>
            <tbody>{sorted.map((p: any) => (
              <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                <td className="ttl">{p.title}<div className="sub mono">{p.esh_id}</div></td>
                <td><PhaseChip p={p} /></td>
                <td className="sm"><OrgList list={p.sponsor_list} /></td>
                <td className="sm">{p.pm ?? '—'}</td>
                <td className="num">{p.annual ? $(p.annual) : '—'}</td>
                <td className="num">{p.multiple != null ? <b style={{ color: tone(p.multiple, 1.5, 1) }}>{x(p.multiple)}</b> : '—'}</td>
                <td className="sm">
                  {p.gateStage && <span style={{ color: STAGE[p.gateStage.stage]?.c, fontWeight: 600 }}>Gate {p.gateStage.gate}: {STAGE[p.gateStage.stage]?.l} ({p.gateStage.done}/{p.gateStage.total})</span>}
                  {p.readiness && <div className="sub">Pathway: {p.readiness.toLowerCase().replace('_', ' ')}</div>}
                  {p.realStatus && <span style={{ color: d.statusMap[p.realStatus].c, fontWeight: 600 }}>{d.statusMap[p.realStatus].l}{p.realization != null ? ` · ${pc(p.realization)} of plan` : ''}</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!sorted.length && <div className="note" style={{ padding: 14 }}>No projects match.</div>}
        </div>
      </Card>
      <div className="fine" style={{ marginTop: 8 }}>◆ Lifecycle, funding and value data in this demo are synthetic.</div>
    </div>
  );
}

const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
