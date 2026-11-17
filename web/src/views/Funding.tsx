import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Loading, PH_COL, PH_SHORT, Stack, d10, go, money, useAsync, ProgramLink } from '../ui';
import { TransitionReadiness } from './Ownership';

const SEV: Record<string, string> = { Critical: '#9B1B2E', High: '#CE0F3E', Medium: '#D9822B' };
const KIND: Record<string, string> = {
  ADA: 'Anti-Deficiency exposure', OPS_ON_RDTE: 'Operations on R&D money', RDTE_AFTER_TRANSITION: 'New R&D money after transition',
  NO_POM_COMMIT: 'POM line not committed', NO_PATH: 'No named transition path',
};
const STAGE_A: Record<string, string> = { DECLARED: 'Rate structure drafted', COMMITTED: 'Rate committed in the AOB', ACTIVE: 'WCF orders billing' };
const STAGE_B: Record<string, string> = { DECLARED: 'POM line identified', COMMITTED: 'POM submission SES-signed', ACTIVE: 'POM line executing' };

/** Funding & transition: the money side of the ESF — Path A (WCF) vs Path B (POM), the POM window, and fiscal-law risk. */
export function Funding() {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api('/funding'), []);
  const [kind, setKind] = useState<string | null>(null);
  const risks = (d?.risks ?? []).filter((r: any) => !kind || r.kind === kind);
  const { sorted, Th } = useSort<any>(risks, { key: 'severity' }, { severity: r => ({ Critical: 0, High: 1, Medium: 2 } as any)[r.severity], kind: r => KIND[r.kind] });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const k = d.kpis;
  const progName = (c: string) => meta.programs.find(p => p.code === c)?.name ?? c;
  const kinds = [...new Set(d.risks.map((r: any) => r.kind))] as string[];

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Funding &amp; transition</h2>
          <div className="vsub">The money side of the ESF: how each project will be paid for once J68 R&D steps back — Path A (a WCF stabilized rate) or Path B (a POM program line) — and the fiscal-law risks along the way.</div></div>
      </div>

      <div className="takeaway">
        The next POM window opens <b>{new Date(d.pom.open + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</b>, in {d.pom.days} days.
        {' '}{d.pom.projects.length} Path B projects in Phase II must clear PRR (Gate 2) first; {d.pom.projects.filter((p: any) => p.risk === 'HIGH').length} have closed less than half their Gate 2 criteria.
        {' '}Sponsors now carry {k.sponsorShare}% of FY{String(d.fy).slice(2)} funding. {k.risks} fiscal-law risk{k.risks === 1 ? '' : 's'} need attention{k.critical ? `, ${k.critical} critical` : ''}.
      </div>

      <div className="hk-grid six">
        <div className="hk"><span className="hk-l">Path A — WCF</span><span className="hk-v" style={{ color: '#3F90CB' }}>{k.pathA}</span><span className="hk-s">Projects that will recover cost through a WCF rate</span></div>
        <div className="hk"><span className="hk-l">Path B — POM</span><span className="hk-v" style={{ color: '#6B3FA0' }}>{k.pathB}</span><span className="hk-s">Projects that need an appropriated POM line</span></div>
        <div className="hk"><span className="hk-l">No named path</span><span className="hk-v" style={{ color: k.noPath ? 'var(--red)' : undefined }}>{k.noPath}</span><span className="hk-s">In Phase II–IV without Path A or B — can't clear Gate 2</span></div>
        <div className="hk"><span className="hk-l">Days to POM window</span><span className="hk-v">{k.daysToPom}</span><span className="hk-s">Window: {d10(d.pom.open)} to {d10(d.pom.close)}</span></div>
        <div className="hk"><span className="hk-l">Paid by sponsors</span><span className="hk-v">{k.sponsorShare}%</span><span className="hk-s">Share of FY{String(d.fy).slice(2)} funding not from J68 R&D</span></div>
        <div className="hk click" onClick={() => document.getElementById('risks')?.scrollIntoView({ behavior: 'smooth' })}><span className="hk-l">Fiscal-law risks</span><span className="hk-v" style={{ color: 'var(--red)' }}>{k.risks}</span><span className="hk-s">{k.critical} critical · see the register</span></div>
      </div>
      <div className="fine">◆ Funding lines and pathways in this demo are synthetic.</div>

      <TransitionReadiness />

      <div className="grid2">
        <Card title={<>Who pays, year by year <Help title="Who pays, year by year">The ESF moves a project from J68 R&D money (RDT&E) to its sponsor's money (WCF or O&M) as it nears scale. Each bar is one fiscal year's funding lines across the portfolio. A healthy portfolio shows the green share growing.</Help></>} right={<span className="hint">$ millions</span>}>
          <Stack rows={d.byFy.map((x: any) => ({ l: 'FY' + String(x.fy).slice(2), v: { J68: x.j68 / 1e6, Sponsor: x.sponsor / 1e6 } }))} keys={['J68', 'Sponsor']}
            colors={{ J68: '#3F90CB', Sponsor: '#2F7D5C' }} labels={{ J68: 'J68 R&D', Sponsor: 'Sponsor (WCF / O&M)' }} h={250} fmt={v => v.toFixed(0)} />
        </Card>
        <Card title={<>Transition paths <Help title="Path A and Path B">Every project must name how it will be paid for after J68 steps back, by PRR at the latest. <b>Path A (WCF):</b> the adopting directorate sets a stabilized rate and recovers cost from customer orders. <b>Path B (POM):</b> the sponsor wins a program line in the POM cycle. Declared → Committed (locked, rule R6) → Active.</Help></>} right={<span className="hint">projects by path and stage</span>}>
          <Stack rows={d.pipeline.map((p: any) => ({ l: p.path === 'A_WCF' ? 'Path A — WCF' : 'Path B — POM', v: { DECLARED: p.DECLARED, COMMITTED: p.COMMITTED, ACTIVE: p.ACTIVE } }))}
            keys={['DECLARED', 'COMMITTED', 'ACTIVE']} colors={{ DECLARED: '#C9C3B5', COMMITTED: '#C9A961', ACTIVE: '#2F7D5C' }} labels={{ DECLARED: 'Declared', COMMITTED: 'Committed', ACTIVE: 'Active' }} h={250} />
        </Card>
      </div>

      <div className="grid2">
        <Card title={<>Path B: racing the POM window <Help title="The POM window">Path B projects need a program line in the POM, which is built each July–August. A project must pass PRR (Gate 2) and have J8 certify its ROI before then, or it waits a full year. "A PRR that passes in September misses the July–August POM window."</Help></>} pad={false}
          right={<span className="hint">Phase II Path B projects · Gate 2 criteria closed</span>}>
          <div className="mini-list" style={{ maxHeight: 380, overflowY: 'auto', margin: 0 }}>
            {d.pom.projects.map((p: any) => (
              <div key={p.esh_id} className="alert-row" onClick={() => go('#/p/' + p.esh_id)}>
                <span className="tag" style={{ background: p.risk === 'HIGH' ? 'var(--redBg)' : p.risk === 'READY' ? 'var(--sponBg)' : 'var(--goldBg)', color: p.risk === 'HIGH' ? 'var(--red)' : p.risk === 'READY' ? 'var(--spon)' : 'var(--goldD)' }}>
                  {p.risk === 'READY' ? 'READY' : p.risk === 'HIGH' ? 'AT RISK' : 'ON TRACK'}</span>
                <span style={{ flex: 1 }}><b>{p.title}</b><br /><span className="sub">{STAGE_B[p.pstatus] ?? 'POM line identified'} · {p.sponsor ?? 'No sponsor'} · <ProgramLink code={p.program_code} name={progName(p.program_code)} full /></span></span>
                <span className="mini-track" style={{ width: 80 }}><span style={{ width: `${100 * p.g2done / p.g2total}%`, background: p.risk === 'HIGH' ? '#CE0F3E' : '#2F7D5C' }} /></span>
                <span className="mono sm" style={{ width: 34, textAlign: 'right' }}>{p.g2done}/{p.g2total}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={<>Path A: WCF rate status <Help title="WCF rates">Path A solutions recover their cost through a stabilized WCF rate, which OSD Comptroller, J8 and the activity group manager set — typically 18 months before the execution year. The stage shows how far the rate has got.</Help></>} pad={false} right={<span className="hint">by phase</span>}>
          <div className="mini-list" style={{ maxHeight: 380, overflowY: 'auto', margin: 0 }}>
            {d.wcf.slice(0, 40).map((p: any) => (
              <div key={p.esh_id} className="alert-row" onClick={() => go('#/p/' + p.esh_id)}>
                <span className="tag" style={{ color: '#fff', background: PH_COL[p.phase] }}>{PH_SHORT[p.phase]}</span>
                <span style={{ flex: 1 }}><b>{p.title}</b><br /><span className="sub">{STAGE_A[p.pstatus] ?? p.pstatus} · {p.sponsor ?? 'No sponsor'}</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card id="risks" title={<>Fiscal-law risk register <Help title="Fiscal-law risk">Color-of-money rules: R&D (RDT&E) money can pay for development and integration testing, not for running a fielded capability. The register flags R&D money past the Gate 4 handoff (Anti-Deficiency Act exposure), operations funded only by R&D, new R&D after transition, and projects deploying without a committed funding path. Senior leader decision #5 sets the Phase III bridge rules.</Help></>} pad={false}
        right={<span className="tabs"><button className={!kind ? 'on' : ''} onClick={() => setKind(null)}>All {d.risks.length}</button>
          {kinds.map(kk => <button key={kk} className={kind === kk ? 'on' : ''} onClick={() => setKind(kk)}>{KIND[kk]} {d.risks.filter((r: any) => r.kind === kk).length}</button>)}</span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="severity">Severity</Th><Th k="title">Project</Th><Th k="kind">Risk</Th><Th k="phase">Phase</Th><Th k="amount" num>Amount</Th></tr></thead>
            <tbody>{sorted.map((r: any, i: number) => (
              <tr key={i} onClick={() => go('#/p/' + r.esh_id)}>
                <td><span className="sevtag" style={{ background: SEV[r.severity] }}>{r.severity}</span></td>
                <td className="ttl">{r.title}<div className="sub">{r.text}</div></td>
                <td className="sm">{KIND[r.kind]}</td>
                <td className="sm nowrap"><span className="phdot" style={{ background: PH_COL[r.phase] }} />{PH_SHORT[r.phase]}</td>
                <td className="num mono">{r.amount ? money(r.amount) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!sorted.length && <div className="note" style={{ padding: 14 }}>No fiscal-law risks found.</div>}
        </div>
      </Card>
    </div>
  );
}
