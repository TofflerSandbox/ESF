import { Fragment, useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Loading, PhaseChip, d10, go, useAsync } from '../ui';

/** Data hygiene grouped by program manager — owner-assigned, so each list has someone to clear it. */
export function Health() {
  const meta = useMeta();
  const [fy, setFy] = useState(meta.latestFy);
  const mine = meta.me.role === 'PM' ? meta.me.person_id : null;
  const [onlyMine, setOnlyMine] = useState(mine != null);
  const [openPm, setOpenPm] = useState<string | null>(null);
  const { data: d, error } = useAsync(() => api(`/health?fy=${fy}`), [fy]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const pms = d.byPm.filter((x: any) => !onlyMine || x.pm_id === mine);
  const flagsOf = (pm: string) => d.projects.filter((p: any) => p.pm === pm);
  const tot = (k: string) => d.byPm.reduce((a: number, x: any) => a + x[k], 0);

  return (
    <>
      <div className="vhead">
        <div><h2 className="vt">Data health</h2>
          <div className="vsub">Open data issues on live projects in the FY{fy} data call, grouped by the program manager who can fix them. A clean project has a live contract period, a sponsor, a priority alignment and a confirmed phase.</div></div>
        <label className="fy">Data call <select value={fy} onChange={e => setFy(Number(e.target.value))}>{meta.fys.map(f => <option key={f.fy} value={f.fy}>FY{f.fy}</option>)}</select></label>
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div className="v">{d.score}%</div><div className="l">portfolio data health ({d.clean} of {d.live} live projects clean)</div></div>
        <div className="kpi warn"><div className="v">{tot('lapsed')}</div><div className="l">contract period lapsed, still reported live</div></div>
        <div className="kpi"><div className="v">{tot('ending')}</div><div className="l">contract ends within 6 months, no committed transition</div></div>
        <div className="kpi"><div className="v">{tot('align')}</div><div className="l">not aligned to an FY{String(fy).slice(2)} priority</div></div>
        <div className="kpi" onClick={() => go('#/triage')}><div className="v">{tot('unconfirmed')}</div><div className="l">ESF phase not yet confirmed</div></div>
      </div>
      {mine != null && <label className="chk" style={{ marginBottom: 10 }}><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> Only my projects</label>}
      <Card title="By program manager" pad={false} right={<span className="mono">lowest score first · click a row for the projects</span>}>
        <table className="list flat">
          <thead><tr><th>Program manager</th><th>Health</th><th>Live</th><th>PoP lapsed</th><th>Ending, no transition</th><th>No sponsor</th><th>Not aligned</th><th>Unconfirmed</th></tr></thead>
          <tbody>{pms.map((x: any) => (
            <Fragment key={x.pm}>
              <tr onClick={() => setOpenPm(openPm === x.pm ? null : x.pm)}>
                <td className="ttl">{openPm === x.pm ? '▾' : '▸'} {x.pm}</td>
                <td><span className="hbadge" style={{ background: x.score >= 80 ? 'var(--sponBg)' : x.score >= 60 ? 'var(--goldBg)' : 'var(--redBg)', color: x.score >= 80 ? 'var(--spon)' : x.score >= 60 ? 'var(--goldD)' : 'var(--red)' }}>{x.score}%</span></td>
                <td className="mono">{x.live}</td><td className="mono">{x.lapsed || '—'}</td><td className="mono">{x.ending || '—'}</td>
                <td className="mono">{x.sponsor || '—'}</td><td className="mono">{x.align || '—'}</td><td className="mono">{x.unconfirmed || '—'}</td>
              </tr>
              {openPm === x.pm && flagsOf(x.pm).map((p: any) => (
                <tr key={x.pm + p.esh_id} className="sub-row" onClick={() => go('#/p/' + p.esh_id)}>
                  <td className="sm" colSpan={2}><b className="mono">{p.esh_id}</b> {p.title}</td>
                  <td><PhaseChip p={p} /></td>
                  <td className="sm" colSpan={5}>{p.flags.join(' · ')}{p.pop_end ? ` · PoP end ${d10(p.pop_end)}` : ''}</td>
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table>
      </Card>
      <div className="note" style={{ marginTop: 8 }}>These checks replace the dashboard's old attention queue. Blank fields that the demo filled with synthetic values count as clean here; on a real import they would show as issues.</div>
    </>
  );
}
