import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Loading, PH_SHORT, PhaseChip, SCORE_COL, d10, go, sup, useAsync } from '../ui';

const J1_ROLE = ['Screening & staffing plan', '', 'Workforce readiness check', 'Change management statement (DCG brief)', 'Workforce absorption'];
const TIMING: Record<string, string> = { BEFORE_GO_LIVE: 'before go-live', AT_GO_LIVE: 'at go-live', AFTER_GO_LIVE: 'after go-live' };

export function J1() {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api('/j1'), [meta.me.id]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const k = d.kpis;
  const stories = meta.scenarios.filter(s => s.track === 'J1');

  return (
    <>
      <div className="vhead">
        <div><h2 className="vt">Workforce &amp; Change (J1)</h2>
          <div className="vsub">Where the R&D pipeline meets the workforce: J1's roles at the ESF gates, which changes are coming and who they reach, and how ready senior leadership is overall, in Kotter's 8 Accelerators.
            Built to <b>feed</b> HCT's Enterprise Change Readiness Dashboard, not replace it. Readiness is shown only in aggregate; people counts under 10 are suppressed.</div></div>
        <span className="syn" style={{ alignSelf: 'flex-start' }}>SYNTHETIC WORKFORCE DATA</span>
      </div>

      <div className="kpi-grid">
        <div className="kpi" onClick={() => document.getElementById('coming')?.scrollIntoView({ behavior: 'smooth' })}><div className="v">{k.changes12}</div><div className="l">changes reaching the workforce in the next 12 months · {sup(k.people12)} people</div></div>
        <div className="kpi warn" onClick={() => document.getElementById('gates')?.scrollIntoView({ behavior: 'smooth' })}><div className="v">{k.waiting}</div><div className="l">projects waiting on J1 input at their current gate</div></div>
        <div className="kpi" onClick={() => document.getElementById('coming')?.scrollIntoView({ behavior: 'smooth' })}><div className="v">{k.unionPending}</div><div className="l">upcoming changes with union notice still pending (+30–60 days)</div></div>
        <div className="kpi" onClick={() => document.getElementById('leaders')?.scrollIntoView({ behavior: 'smooth' })}><div className="v">{k.leaderAvg ?? '—'}<small> / 5</small></div><div className="l">senior leader readiness, Kotter average across {k.leaders} sponsoring leaders</div></div>
        <div className="kpi" onClick={() => document.getElementById('sustain')?.scrollIntoView({ behavior: 'smooth' })}><div className="v">{k.adoption180 ?? '—'}<small>%</small></div><div className="l">median adoption 180 days after go-live</div></div>
      </div>

      {stories.length > 0 && (
        <Card title="J1 walkthrough" right={<span className="syn">SYNTHETIC</span>} pad={false}>
          <div className="scen">
            {stories.map((s, i) => (
              <a key={s.ord} href={'#/p/' + s.esh_id} className="sc">
                <div className="n">{i + 1}</div>
                <div><b>{s.title}</b><div className="code mono">{s.esh_id} · {s.project_title}</div><p>{s.story}</p><div className="lf">Look for: {s.look_for}</div></div>
              </a>
            ))}
          </div>
        </Card>
      )}

      <div className="grid2" style={{ marginTop: 14 }}>
        <Card title="J1 at the gates" id="gates" right={<span className="mono">white paper §3.1</span>}>
          <table className="gh-tbl">
            <thead><tr><th>GATE</th><th>J1 ROLE</th><th>WORKING IT NOW</th><th>MET</th><th>NOT ASSESSED</th></tr></thead>
            <tbody>{d.gates.map((g: any) => (
              <tr key={g.gate}><td className="mono">G{g.gate}</td><td><b>{J1_ROLE[g.gate]}</b><div className="sub">{g.text}</div></td>
                <td className="mono">{g.met_now} / {g.at_gate}</td><td className="mono">{g.met_all}</td><td className="mono muted">{g.waived_all}</td></tr>
            ))}</tbody>
          </table>
          <div className="note">"Not assessed" = gates decided before J1 was written into the ESF. Only J1 (or the J68 admin) can close these criteria; a gate can't pass while one is open.</div>
          <div className="lbl" style={{ marginTop: 12 }}>Waiting on J1 — closest to a decision first</div>
          <div className="mini-list">
            {d.waiting.slice(0, 10).map((w: any) => (
              <div key={w.esh_id} className="alert-row" onClick={() => go('#/p/' + w.esh_id)}>
                <span className="tag" style={{ color: 'var(--goldD)', background: 'var(--goldBg)' }}>G{w.gate}</span>
                <span><b>{w.esh_id}</b> · {w.title}<br /><span className="sub">{J1_ROLE[w.gate]} · other criteria {w.others_closed}/{w.others} closed · PM {w.pm ?? '—'}</span></span>
              </div>
            ))}
            {d.waiting.length > 10 && <div className="note">+ {d.waiting.length - 10} more</div>}
          </div>
        </Card>

        <Card title="Coming to the workforce — next 18 months" id="coming" pad={false}>
          <div className="mini-list" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {d.coming.map((c: any) => (
              <div key={c.esh_id} className="alert-row" onClick={() => go('#/p/' + c.esh_id)}>
                <span className="mono d" style={{ minWidth: 74 }}>{d10(c.go_live)}</span>
                <span><b>{c.esh_id}</b> · {c.title} <PhaseChip p={c} /><br />
                  <span className="sub">{sup(c.headcount)} people · {c.series} · {c.orgs} · training {c.training_pct}%{c.union_pending ? ' · union notice pending' : ''}{c.redesign ? ' · role redesign' : ''}</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Senior leader readiness — Kotter's 8 Accelerators (aggregate)" id="leaders" right={<a className="btn sm" href="/api/j1/readiness.csv" download>Export for HCT Readiness Dashboard (CSV)</a>}>
        {d.kotter.map((a: any) => (
          <div key={a.a} className="kbar">
            <span className="nm"><b>{a.a}.</b> {a.name}</span>
            <span className="dist" title={a.dist.map((n: number, i: number) => `${i + 1}: ${n}`).join(' · ')}>
              {a.dist.map((n: number, i: number) => n ? <span key={i} style={{ width: `${100 * n / a.n}%`, background: SCORE_COL[i + 1] }} /> : null)}
            </span>
            <span className="mean"><b>{a.mean.toFixed(1)}</b> {a.prior != null && a.mean !== a.prior ? <small style={{ color: a.mean > a.prior ? 'var(--spon)' : 'var(--red)' }}>{a.mean > a.prior ? '▲' : '▼'} {Math.abs(a.mean - a.prior).toFixed(1)}</small> : null}</span>
          </div>
        ))}
        <div className="legend" style={{ marginTop: 8 }}>{[1, 2, 3, 4, 5].map(s => <span key={s}><i style={{ background: SCORE_COL[s] }} />{s}{s === 1 ? ' not started' : s === 5 ? ' consistently demonstrated' : ''}</span>)}</div>
        <div className="note">Distribution of scores across the {k.leaders} sponsoring senior leaders assessed, with the average and its change since the prior assessment. Individual leaders are never shown. In production these would come from HCT's dashboard or assessment.</div>
      </Card>

      <div className="grid2" style={{ marginTop: 14 }}>
        <Card title="Sustainment after go-live" id="sustain" right={<span className="mono">adoption % at 30 · 90 · 180 days</span>}>
          <table className="gh-tbl">
            <thead><tr><th>PROJECT</th><th>GO-LIVE</th><th>TRAINING</th><th>30</th><th>90</th><th>180</th></tr></thead>
            <tbody>{d.sustain.map((s: any) => (
              <tr key={s.esh_id} onClick={() => go('#/p/' + s.esh_id)} style={{ cursor: 'pointer' }}>
                <td><b className="mono">{s.esh_id}</b> <span className="sm">{s.title.slice(0, 48)}</span></td><td className="mono sm">{d10(s.go_live)}</td>
                <td className="sm" style={{ color: /AFTER/.test(s.timing) ? 'var(--red)' : undefined }}>{s.training_pct}% · {TIMING[s.timing.split(',').sort().pop()] ?? s.timing}</td>
                {['30', '90', '180'].map(dd => <td key={dd} className="mono">{s.adoption?.[dd] != null ? <Adopt v={s.adoption[dd]} /> : <span className="muted">—</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
          <div className="note">What success looks like after the change: did the workforce actually adopt it, and did it last?</div>
        </Card>

        <Card title="J1-aligned projects (real FY26–27 alignment data)">
          {d.anchors.map((a: any) => (
            <div key={a.esh_id} className="alert-row" onClick={() => go('#/p/' + a.esh_id)}>
              <PhaseChip p={a} /><span><b>{a.esh_id}</b> · {a.title}<br /><span className="sub">J1 priority (FY{a.fy}): {a.label} · {a.program_code}</span></span>
            </div>
          ))}
          <div className="note">The only projects the R&D data call aligns to a J1 priority. The rest of the workforce impact on this page comes from projects aligned elsewhere; that is the visibility gap J1 described.</div>
        </Card>
      </div>
      <div className="note" style={{ marginTop: 10 }}>Phases: {PH_SHORT.join(' → ')}. Production feeds (to confirm with J1): DCPDS, LMS, DEOCS, the CM Impact Assessment, and HCT's Enterprise Change Readiness Dashboard.</div>
    </>
  );
}

const Adopt = ({ v }: { v: number }) => <span style={{ color: v < 50 ? 'var(--red)' : v < 70 ? 'var(--goldD)' : 'var(--spon)', fontWeight: 700 }}>{v}%</span>;
