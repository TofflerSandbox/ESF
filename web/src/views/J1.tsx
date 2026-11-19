import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Help, Loading, PH_SHORT, PhaseChip, SCORE_COL, d10, go, sup, useAsync } from '../ui';

const J1_ROLE = ['Screening & staffing plan', '', 'Workforce readiness check', 'Change management statement (DCG brief)', 'Workforce absorption'];
const TIMING: Record<string, string> = { BEFORE_GO_LIVE: 'before go-live', AT_GO_LIVE: 'at go-live', AFTER_GO_LIVE: 'after go-live' };

/** One-paragraph primers behind the "?" next to each section title. */
const PRIMER = {
  gates: <>Four of the five ESF gates include a criterion that only J1 can close. <b>Gate 0:</b> J1 screens the staffing plan. <b>Gate 2:</b> J1 runs the Change Management Impact Assessment, a workforce readiness check. <b>Gate 3:</b> J1 adds the change management statement to the DCG brief. <b>Gate 4:</b> J1 confirms the workforce has absorbed the change. A project can't pass the gate while J1's item is open, so workforce readiness is part of the decision, not an afterthought.</>,
  coming: <>Projects heading for deployment, grouped by when they go live and touch real people. Each one shows how many people are affected (counts under 10 are hidden), which organizations, how much of the training is done, and whether union notice is still needed (that adds 30–60 days). Use the windows to plan J1's support: the next 3 months need action now; later windows are for planning.</>,
  kotter: <>DLA's SES Executive Board adopted <b>Kotter's 8 Accelerators</b> to track senior-leader accountability for change. Each sponsoring senior leader is rated 1 (not started) to 5 (consistently demonstrated) on each accelerator. The bars show how scores spread across all leaders, never individuals. The export is a feed for HCT's Enterprise Change Readiness Dashboard.</>,
  sustain: <>Did the change stick? For projects already at scale, the share of the intended users actually using the new capability 30, 90 and 180 days after go-live, alongside whether training happened before or after launch. Low adoption at 180 days means the workforce never fully absorbed the change.</>,
  screens: <>When a project is submitted, the PM answers a short change-impact screen adapted from HCT's CM Impact Assessment: will anyone work differently, what kind of change, who and about how many, and whether training or bargaining-unit employees are involved. Screens that say yes or "not sure" come here for J1's early look: <b>engage now</b>, <b>monitor</b>, or <b>no J1 action needed</b>. The Gate 2 CM Impact Assessment later confirms the estimate.</>,
  anchors: <>The projects that the real FY26–27 R&D data call aligns to a J1 priority (for example Tech as HR Enabler). Few projects are aligned to J1, though many affect the workforce — the visibility gap J1 described, and the reason J1 needs a seat at the gates.</>,
};

const BAND: Record<string, string> = { UNDER_10: 'under 10', '10_99': '10–99', '100_999': '100–999', '1000_PLUS': '1,000+', UNKNOWN: 'unknown number of' };
const READ: Record<string, { l: string; c: string; bg: string }> = {
  ENGAGE: { l: 'ENGAGE', c: 'var(--red)', bg: '#FBE9EC' }, MONITOR: { l: 'MONITOR', c: 'var(--slate)', bg: '#EDEBE4' }, NONE: { l: 'NO ACTION', c: 'var(--spon)', bg: 'var(--sponBg)' },
};

/** Go-live windows, in months from today. */
const WINDOWS: [string, number, number][] = [['0–3 mo', 0, 3], ['3–6 mo', 3, 6], ['6–9 mo', 6, 9], ['9–12 mo', 9, 12], ['12–18 mo', 12, 18]];
const WIN_PHRASE = ['in the next 3 months', 'in 3–6 months', 'in 6–9 months', 'in 9–12 months', 'in 12–18 months'];

export function J1() {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api('/j1'), [meta.me.id]);
  const [win, setWin] = useState(0);
  const [showAll, setShowAll] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const k = d.kpis;
  const asOf = new Date(d.asOf + 'T00:00:00Z').getTime();
  const wins = WINDOWS.map(([l, a, b]) => {
    const items = d.coming.filter((c: any) => { const m = (new Date(c.go_live).getTime() - asOf) / (30.44 * 864e5); return m >= a && m < b; });
    return { l, items, people: items.reduce((s: number, c: any) => s + c.headcount, 0) };
  });
  const cur = wins[win];

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


      <div className="grid2" style={{ marginTop: 14 }}>
        <Card title={<>J1 at the gates <Help title="J1 at the gates">{PRIMER.gates}</Help></>} id="gates">
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

        <Card title={<>Coming to the workforce <Help title="Coming to the workforce">{PRIMER.coming}</Help></>} id="coming">
          <div className="win-tabs" role="tablist" aria-label="Go-live window">
            {wins.map((w, i) => (
              <button key={w.l} role="tab" aria-selected={win === i} className={'win' + (win === i ? ' on' : '')} onClick={() => { setWin(i); setShowAll(false); }}>
                <span className="wl">{w.l}</span><span className="wn">{w.items.length}</span><span className="wp">{sup(w.people)} people</span>
              </button>
            ))}
          </div>
          <div className="win-sum">
            <b>{cur.items.length}</b> change{cur.items.length === 1 ? ' goes' : 's go'} live {WIN_PHRASE[win]}, reaching {sup(cur.people)} people.
            {cur.items.filter((c: any) => c.training_pct < 50).length > 0 && <> <span className="flagtxt">{cur.items.filter((c: any) => c.training_pct < 50).length} are under 50% trained.</span></>}
            {cur.items.filter((c: any) => c.union_pending).length > 0 && <> <span className="flagtxt">{cur.items.filter((c: any) => c.union_pending).length} still need union notice.</span></>}
          </div>
          <div className="mini-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {cur.items.slice(0, showAll ? undefined : 8).map((c: any) => (
              <div key={c.esh_id} className="alert-row" onClick={() => go('#/p/' + c.esh_id)}>
                <span className="mono d" style={{ minWidth: 74 }}>{d10(c.go_live)}</span>
                <span><b>{c.title}</b><br />
                  <span className="sub">{sup(c.headcount)} people · {c.orgs} · <span style={{ color: c.training_pct < 50 ? 'var(--red)' : undefined }}>{c.training_pct}% trained</span>{c.union_pending ? ' · union notice pending' : ''}{c.redesign ? ' · role redesign' : ''}</span></span>
              </div>
            ))}
            {cur.items.length === 0 && <div className="note" style={{ padding: '6px 16px' }}>Nothing goes live in this window.</div>}
          </div>
          {cur.items.length > 8 && <button className="link" style={{ marginTop: 6 }} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the first 8' : `Show all ${cur.items.length}`}</button>}
        </Card>
      </div>

      <Card title={<>Early look: screened at intake <Help title="Early look">{PRIMER.screens}</Help></>} id="screens"
        right={<span className="mono">{k.toRead} to read{d.unscreened ? ` · ${d.unscreened} early project${d.unscreened === 1 ? '' : 's'} not yet screened` : ''}</span>}>
        <div className="mini-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {d.screens.map((s: any) => (
            <div key={s.esh_id} className="alert-row" onClick={() => go('#/p/' + s.esh_id + '/people')}>
              <span className="tag" style={s.j1_read ? { color: READ[s.j1_read].c, background: READ[s.j1_read].bg } : { color: 'var(--goldD)', background: 'var(--goldBg)' }}>{s.j1_read ? READ[s.j1_read].l : 'TO READ'}</span>
              <span><b>{s.esh_id}</b> · {s.title}{s.synthetic && <> <span className="syn">SYN</span></>}<br />
                <span className="sub">{PH_SHORT[s.esf_phase]} · {s.works_differently === 'YES' ? 'will change how people work' : 'may change how people work'} · {BAND[s.people_band]} people
                  {s.beyond_one_org === 'YES' ? ' · more than one organization' : ''}{s.bargaining_unit === 'YES' ? ' · bargaining unit' : ''}{s.who ? ` · ${s.who}` : ''}</span></span>
            </div>
          ))}
          {d.screens.length === 0 && <div className="note" style={{ padding: '6px 16px' }}>No intake screen says anyone will work differently.</div>}
        </div>
      </Card>

      <Card title={<>Senior leader readiness — Kotter's 8 Accelerators <Help title="Senior leader readiness">{PRIMER.kotter}</Help></>} id="leaders" right={<a className="btn sm" href="/api/j1/readiness.csv" download>Export for HCT Readiness Dashboard (CSV)</a>}>
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
        <Card title={<>Sustainment after go-live <Help title="Sustainment after go-live">{PRIMER.sustain}</Help></>} id="sustain" right={<span className="mono">adoption % at 30 · 90 · 180 days</span>}>
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

        <Card title={<>J1-aligned projects <Help title="J1-aligned projects">{PRIMER.anchors}</Help></>} right={<span className="mono">real FY26–27 data</span>}>
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
