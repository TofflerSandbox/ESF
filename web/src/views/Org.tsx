import { useState } from 'react';
import { api } from '../api';
import { Bars, Card, EL_COL, ErrorBox, Loading, ORG_KIND, PH_COL, PH_SHORT, PhaseChip, ROLE_LABEL, StatusChip, Syn, d10, go, sup, useAsync } from '../ui';

const ROLE_ORDER = ['SPONSOR', 'STAKEHOLDER', 'TRANSITION_PARTNER', 'ACADEMIA', 'MILITARY', 'OSD_MII', 'VENDOR'];

/** One organization: the same layout for every MSC, J-code, service, university or company. */
export function Org({ id }: { id: number }) {
  const { data: d, error } = useAsync(() => api(`/orgs/${id}`), [id]);
  const [role, setRole] = useState<string>('');
  const [liveOnly, setLiveOnly] = useState(true);
  if (error) return <><a className="bk" href="#/orgs">← Organizations</a><ErrorBox msg={error} /></>;
  if (!d) return <Loading />;
  const live = (p: any) => ['ACTIVE', 'HOLD', 'AT_SCALE'].includes(p.esf_status);
  const rows = d.projects.filter((p: any) => (!role || p.roles.includes(role)) && (!liveOnly || live(p)));
  const roles = ROLE_ORDER.filter(r => d.byRole[r].total > 0);
  const liveTotal = d.projects.filter(live).length;
  const pocSyn = d.focal.some((f: any) => f.synthetic) || d.pocs.some((f: any) => f.synthetic);

  return (
    <>
      <a className="bk" href="#/orgs">← Organizations</a>
      <div className="vhead">
        <div>
          <div className="crumb">{ORG_KIND[d.org.kind] ?? d.org.kind}</div>
          <h2 className="vt">{d.org.name}</h2>
          <div className="vsub">On {d.projects.length} project{d.projects.length === 1 ? '' : 's'} across the FY data calls · {liveTotal} live today
            {d.aliases.length > 1 && <> · reported in the workbooks as {d.aliases.slice(0, 6).map((a: string) => `"${a}"`).join(', ')}{d.aliases.length > 6 ? ` +${d.aliases.length - 6} more` : ''}</>}</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi" onClick={() => { setRole(''); setLiveOnly(true); }}><div className="v">{liveTotal}</div><div className="l">live projects (any role)</div></div>
        {['SPONSOR', 'STAKEHOLDER', 'TRANSITION_PARTNER'].map(r => (
          <div key={r} className="kpi" onClick={() => { setRole(r); setLiveOnly(true); }}><div className="v">{d.byRole[r].live}<small> / {d.byRole[r].total}</small></div><div className="l">as {ROLE_LABEL[r].toLowerCase()} · live / all</div></div>
        ))}
        <div className="kpi" onClick={() => { setRole(''); setLiveOnly(false); }}><div className="v">{d.exits}</div><div className="l">managed exits (sunset or descoped)</div></div>
        <div className="kpi" onClick={() => go('#/j1')}><div className="v">{sup(d.workforce.headcount)}</div><div className="l">of its people reached by {d.workforce.projects} upcoming change{d.workforce.projects === 1 ? '' : 's'}</div></div>
      </div>

      <div className="grid2">
        <Card title="Live projects by ESF phase">
          <Bars h={170} items={d.phases.map((n: number, i: number) => ({ l: PH_SHORT[i], v: n, c: PH_COL[i] }))} />
        </Card>
        <Card title="R&D focal points" right={pocSyn ? <Syn /> : undefined}>
          {d.focal.length === 0 ? <div className="note">No R&D focal points declared. Focal points are declared by DLA organizations (MSCs and J-codes).</div> : (
            <div className="people">
              {d.focal.map((f: any) => (
                <div key={f.email} className="person">
                  <div className="nm">{f.name}{f.focal_rank === 1 && <span className="tagmini">PRIMARY</span>}</div>
                  <div className="sub">{f.title}{f.office ? ` · ${f.office}` : ''}</div>
                  <div className="mono sub">{f.email} · {f.phone}</div>
                </div>
              ))}
            </div>
          )}
          {d.programs.length > 0 && <>
            <div className="lbl">Live projects by program</div>
            <div className="chips">{d.programs.map((p: any) => <span key={p.k} className="chip" style={{ color: EL_COL[d.projects.find((x: any) => x.program_code === p.k)?.element_code] ?? 'var(--slate)', background: '#EDEBE4' }}>{p.k} · {p.n}</span>)}</div>
          </>}
        </Card>
      </div>

      <Card title="Projects" pad={false} right={
        <span className="tabs">
          <button className={!role ? 'on' : ''} onClick={() => setRole('')}>All roles</button>
          {roles.map(r => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{ROLE_LABEL[r]} {d.byRole[r].total}</button>)}
          <label className="chk"><input type="checkbox" checked={liveOnly} onChange={e => setLiveOnly(e.target.checked)} /> live only</label>
        </span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat">
            <thead><tr><th>ESH ID</th><th>Project</th><th>Role</th><th>Program</th><th>PM</th><th>Status</th><th>ESF</th><th>PoP end</th></tr></thead>
            <tbody>{rows.map((p: any) => (
              <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                <td className="mono code">{p.esh_id}</td><td className="ttl">{p.title}</td>
                <td className="sm">{p.roles.sort((a: string, b: string) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)).map((r: string) => ROLE_LABEL[r]).join(', ')}</td>
                <td className="mono sm">{p.program_code ?? '—'}</td><td className="sm">{p.pm ?? '—'}</td>
                <td><StatusChip s={p.status_code} /></td><td><PhaseChip p={p} /></td><td className="mono sm">{d10(p.pop_end)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length && <div className="note" style={{ padding: 12 }}>No projects match.</div>}
        </div>
      </Card>

      {d.pocs.length > 0 && (
        <Card title="Project points of contact" right={pocSyn ? <Syn /> : undefined} pad={false}>
          <table className="list flat">
            <thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Projects</th><th>Contact</th></tr></thead>
            <tbody>{d.pocs.map((c: any, i: number) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><b>{c.name}</b></td><td className="sm">{c.title}</td><td className="sm">{ROLE_LABEL[c.role]}</td>
                <td className="mono sm">{c.esh_ids.slice(0, 6).map((e: string) => <a key={e} href={'#/p/' + e} style={{ marginRight: 6 }}>{e}</a>)}{c.n > 6 ? `+${c.n - 6}` : ''}</td>
                <td className="mono sm">{c.email}<br />{c.phone}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/** Index of every organization on any project. */
export function Orgs() {
  const { data, error } = useAsync(() => api('/org-index'), []);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  const rows = data.rows.filter((o: any) => (!kind || o.kind === kind) && (!q || o.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <h2 className="vt">Organizations</h2>
      <div className="vsub">Every sponsor, stakeholder, transition partner and partner organization on a project. Spellings from the workbooks are merged through the alias table.</div>
      <div className="fbar">
        <input type="search" placeholder="Find an organization…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={kind} onChange={e => setKind(e.target.value)}><option value="">Type: all</option>{Object.entries(ORG_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <span className="cnt">{rows.length} organizations</span>
      </div>
      <table className="list">
        <thead><tr><th>Organization</th><th>Type</th><th>Live projects</th><th>Sponsor</th><th>Stakeholder</th><th>Transition partner</th><th>All projects</th><th>Focal points</th></tr></thead>
        <tbody>{rows.map((o: any) => (
          <tr key={o.id} onClick={() => go('#/org/' + o.id)}>
            <td className="ttl">{o.name}</td><td className="sm">{ORG_KIND[o.kind] ?? o.kind}</td>
            <td className="mono">{o.live}</td><td className="mono">{o.sponsor || '—'}</td><td className="mono">{o.stakeholder || '—'}</td><td className="mono">{o.transition || '—'}</td>
            <td className="mono">{o.projects}</td><td className="mono">{o.focal || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  );
}
