import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Bars, Card, Donut, EL_COL, ErrorBox, Insights, Loading, PH_COL, PH_SHORT, Stack, VALUE_PATH, go, money, useAsync } from '../ui';

/** A colour per priority owner (MSCs and J-codes), so the priority chart reads at a glance. */
const OWNER_COL = ['#27568F', '#2F7D5C', '#C9A961', '#CE0F3E', '#3F90CB', '#8A6B25', '#6B3FA0', '#D9822B', '#16233C', '#6BA37E', '#9B1B2E', '#8A9099'];
const ACTION: Record<string, { l: string; c: string }> = {
  READY: { l: 'Ready to decide', c: 'var(--spon)' },
  HOLD: { l: 'Waiting on a sign-off', c: 'var(--goldD)' },
  POM: { l: 'Budget deadline', c: 'var(--j68D)' },
  POP: { l: 'Contracts ending', c: 'var(--red)' },
  OVERDUE: { l: 'Running late', c: 'var(--slate)' },
};

/** Director's home: is the portfolio healthy, what needs my decision, is R&D paying off. */
export function Dashboard() {
  const meta = useMeta();
  const [fy, setFy] = useState(meta.latestFy);
  const [open, setOpen] = useState<number | null>(null);
  const { data: d, error } = useAsync(() => api(`/home?fy=${fy}`), [fy]);
  const { data: roi } = useAsync(() => api('/roi?horizon=5'), []);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const slices = roi ? roi.byPath.map((p: any) => ({ k: p.path, l: VALUE_PATH[p.path].l, v: p.annual, c: VALUE_PATH[p.path].c })) : [];
  const valTotal = slices.reduce((a: number, s: any) => a + s.v, 0);

  const fmt = (k: any) => k.value == null ? '—' : k.unit === '%' ? `${k.value}%` : k.unit === '$' ? money(k.value).replace('.00M', 'M') : String(k.value);
  const fy2 = String(fy).slice(2);

  // charts
  const phaseBars = d.funnel.map((f: any) => ({ l: PH_SHORT[f.phase], v: f.n, c: PH_COL[f.phase], sub: f.over ? `${f.over} running late` : 'on pace', onClick: () => go('#/phase/' + f.phase) }));
  const changes = d.funnel.filter((f: any) => Math.abs(f.n - f.yearAgo) >= 10).map((f: any) => `${PH_SHORT[f.phase]} ${f.n > f.yearAgo ? 'up' : 'down'} ${Math.abs(f.n - f.yearAgo)}`);
  const yieldBars = d.yieldTrend.map((y: any, i: number) => ({ l: 'FY' + String(y.fy).slice(2), v: y.pct ?? 0, c: y.fy === fy ? '#2F7D5C' : ['#A9C9B8', '#7FB39A', '#55997A'][i % 3] }));
  const fundRows = d.fundingByPhase.map((f: any) => ({ l: PH_SHORT[f.phase], v: { J68: f.j68 / 1e6, Sponsor: f.sponsor / 1e6 } }));
  const owners = [...new Set(d.coverage.map((c: any) => c.owner))] as string[];
  const byOwner = owners.map((o, i) => ({ o, c: OWNER_COL[i % OWNER_COL.length], n: d.coverage.filter((c: any) => c.owner === o).reduce((a: number, c: any) => a + c.live, 0) }))
    .sort((a, b) => b.n - a.n);
  const ownerMax = Math.max(...byOwner.map(x => x.n), 1);
  const uncovered = d.coverage.filter((c: any) => c.live === 0);
  const progMax = Math.max(...d.programs.map((p: any) => p.n), 1);

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Portfolio</h2>
          <div className="vsub">FY{fy} data call · as of {new Date(d.asOf + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</div></div>
        <label className="fy">Data call <select value={fy} onChange={e => setFy(Number(e.target.value))}>{meta.fys.map(f => <option key={f.fy} value={f.fy}>FY{f.fy}</option>)}</select></label>
      </div>

      <div className="hk-grid">
        {d.kpis.map((k: any) => {
          const delta = k.prev != null && k.value != null ? k.value - k.prev : null;
          const met = k.target != null && k.value != null ? k.value >= k.target : null;
          return (
            <a key={k.key} className="hk" href={k.link} onClick={e => { if (k.link.startsWith('#decisions')) { e.preventDefault(); document.getElementById('decisions')?.scrollIntoView({ behavior: 'smooth' }); } }}>
              <span className="hk-l">{k.label}{k.source !== 'real' && <sup title="Grows as the Hub is used; synthetic in this demo"> ◆</sup>}</span>
              <span className="hk-v">{fmt(k)}</span>
              <span className="hk-pills">
                {met != null && <span className={'pill ' + (met ? 'good' : 'bad')}>{met ? 'On target' : `Target ${k.target}%`}</span>}
                {delta != null && delta !== 0 && <span className={'pill ' + (delta > 0 ? 'good' : 'bad')}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs last year</span>}
              </span>
              <span className="hk-s">{k.sub}</span>
            </a>
          );
        })}
      </div>
      <div className="fine">◆ Grows as the Hub is used. In this demo these values are synthetic.</div>
      <Insights items={d.insights} />

      <div className="grid2">
        <Card title="Where projects are today" right={<a href="#/map">What the phases mean →</a>}>
          <Bars items={phaseBars} h={260} />
          <div className="chart-note">{changes.length ? `Since last year: ${changes.join(' · ')}.` : 'Little change since last year.'} Click a bar to see its projects.</div>
        </Card>
        <Card title="Where the value comes from" right={<a href="#/roi">Return on investment →</a>}>
          {!roi ? <Loading /> : (
            <div className="vdonut">
              <Donut slices={slices} size={230} center={money(valTotal).replace('.00M', 'M')} sub="expected per year" onClick={() => go('#/roi')} />
              <div className="vlegend">
                {roi.byPath.map((p: any) => (
                  <a key={p.path} href="#/roi" className="vl">
                    <i style={{ background: VALUE_PATH[p.path].c }} />
                    <span><b>{VALUE_PATH[p.path].l}</b> <span className="pc">{valTotal ? Math.round(100 * p.annual / valTotal) : 0}%</span><br />
                      <span className="sub">{money(p.annual).replace('.00M', 'M')} a year · {p.n} project{p.n === 1 ? '' : 's'}</span></span>
                  </a>
                ))}
                <a href="#/roi" className="roi-call">
                  <b>{roi.summary.riskMultiple != null ? `${roi.summary.riskMultiple.toFixed(1)}×` : '—'}</b>
                  <span>projected return on the {money(roi.summary.totalCost).replace('.00M', 'M')} invested, over 5 years, adjusted for risk ◆</span>
                </a>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid2">
        <Card title="Do finished projects transition?" right={<span className="hint">share of finished projects handed to an owner</span>}>
          <Bars items={yieldBars} h={260} fmt={v => `${v}%`} />
          <div className="chart-note">The goal is 40% or more. {d.kpis[0].sub}.</div>
        </Card>
        <Card title="Who pays at each phase" right={<span className="hint">FY{fy2} funding, $ millions</span>}>
          <Stack rows={fundRows} keys={['J68', 'Sponsor']} colors={{ J68: '#3F90CB', Sponsor: '#2F7D5C' }} labels={{ J68: 'J68 R&D', Sponsor: 'Sponsor (WCF / POM)' }} h={260}
            fmt={v => v.toFixed(v >= 10 ? 0 : 1)} onClick={i => go('#/phase/' + d.fundingByPhase[i].phase)} />
          <div className="chart-note">Healthy projects shift from J68 R&D money to sponsor money by Phase III. ◆</div>
        </Card>
      </div>

      <div className="grid2">
        <Card title={`Projects by priority owner`} right={<span className="hint">live projects aligned to FY{fy2} priorities</span>}>
          <div className="obars">
            {byOwner.map(x => (
              <div key={x.o} className="obar">
                <span className="on">{x.o}</span>
                <span className="track"><span style={{ width: `${Math.max(x.n ? 3 : 0, 100 * x.n / ownerMax)}%`, background: x.c }} /></span>
                <span className="ov">{x.n}</span>
              </div>
            ))}
          </div>
          {uncovered.length > 0 && <div className="chart-note"><b>Not yet covered:</b> {uncovered.map((c: any) => `${c.owner} — ${c.label}`).join(' · ')}</div>}
        </Card>
        <Card title="Projects by program" right={Object.entries(EL_COL).map(([e, c]) => <span key={e} className="hint" style={{ color: c, marginLeft: 8, fontWeight: 700 }}>{e}</span>)}>
          <div className="obars">
            {d.programs.slice(0, 12).map((r: any) => (
              <div key={r.k} className="obar click" onClick={() => go(`#/projects?fy=${fy}&program=${encodeURIComponent(r.k)}`)}>
                <span className="on">{r.k}</span>
                <span className="track"><span style={{ width: `${Math.max(3, 100 * r.n / progMax)}%`, background: EL_COL[r.el] ?? 'var(--slate2)' }} /></span>
                <span className="ov">{r.n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid3">
        <Card title="What needs a decision" id="decisions" pad={false}>
          {d.decisions.map((x: any, i: number) => (
            <div key={i} className="dec">
              <span className="dot" style={{ background: ACTION[x.kind].c }} />
              <span className="dec-b">
                <span className="dec-k" style={{ color: ACTION[x.kind].c }}>{ACTION[x.kind].l}</span>
                <a href={x.link}>{x.esh_id ? <><b>{x.title}</b> — {x.text.replace(' — every criterion is closed', '')}</> : x.text}</a>
                <span className="sub">{x.owner}{x.when !== d.asOf ? ` · by ${new Date(x.when + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''}
                  {x.items?.length ? <> · <button className="link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'hide projects' : 'see projects'}</button></> : null}</span>
                {open === i && x.items?.length > 0 && <span className="dec-items">{x.items.map((p: any) => <a key={p.esh_id} href={'#/p/' + p.esh_id}>{p.title}</a>)}</span>}
              </span>
            </div>
          ))}
        </Card>
        <div className="colstack">
          <a className="health" href="#/health">
            <span className="hs" style={{ color: (d.health.score ?? 0) >= 80 ? 'var(--spon)' : (d.health.score ?? 0) >= 60 ? 'var(--goldD)' : 'var(--red)' }}>{d.health.score ?? '—'}%</span>
            <span><b>Data health</b><br /><span className="sub">{d.health.flagged} projects have something for their program manager to fix. See the list →</span></span>
          </a>
        </div>
      </div>
    </div>
  );
}
