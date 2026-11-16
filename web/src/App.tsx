import { createContext, useContext, useEffect, useState } from 'react';
import { api, getUserId, setUserId } from './api';
import { ErrorBox, Loading } from './ui';
import { Dashboard } from './views/Dashboard';
import { Pipeline } from './views/Pipeline';
import { Phase } from './views/Phase';
import { Projects } from './views/Projects';
import { Record } from './views/Record';
import { Brief } from './views/Brief';
import { Triage } from './views/Triage';
import { Audit } from './views/Audit';
import { J1 } from './views/J1';
import { Org, Orgs } from './views/Org';

export type Meta = {
  me: { id: number; name: string; role: string; person_id: number | null };
  latestFy: number; asOf: string;
  users: { id: number; name: string; role: string; person_id: number | null }[];
  elements: { code: string; name: string }[];
  programs: { code: string; name: string; element_code: string | null; n: number }[];
  pms: { id: number; name: string; n: number }[];
  criteria: { id: number; gate: number; ord: number; text: string; non_waivable: boolean }[];
  priorities: { id: number; fy: number; owner: string; label: string; ord: number }[];
  fys: { fy: number; name: string; status: string }[];
  lastImport: { at: string; totals: Record<string, number> } | null;
  synthetic: { projects: number };
  scenarios: { ord: number; esh_id: string; title: string; story: string; look_for: string; project_title: string; track: 'ESF' | 'J1' }[];
  kotter: string[];
  unconfirmed: number;
};
const MetaCtx = createContext<Meta | null>(null);
export const useMeta = () => useContext(MetaCtx)!;

const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => { setH(location.hash); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#\/?/, '');
};

type NavItem = { h: string; r: string; l: string; i: string; roles?: string[] };
/** Left navigation. Administration is shown only to the roles that use it: phase review is the admin's onboarding queue,
    the audit log is for the admin and the gate authority (every project record keeps its own audit trail for everyone). */
const NAV: { g: string; items: NavItem[] }[] = [
  { g: 'Portfolio', items: [
    { h: '', r: 'dash', l: 'Dashboard', i: '▦' }, { h: 'board', r: 'board', l: 'Pipeline', i: '⇶' },
    { h: 'projects', r: 'projects', l: 'Projects', i: '☰' }, { h: 'orgs', r: 'orgs', l: 'Organizations', i: '⌂' },
  ] },
  { g: 'Workforce', items: [{ h: 'j1', r: 'j1', l: 'Workforce & change', i: '◎' }] },
  { g: 'Administration', items: [
    { h: 'triage', r: 'triage', l: 'Phase review', i: '✓', roles: ['ADMIN'] },
    { h: 'audit', r: 'audit', l: 'Audit log', i: '⧗', roles: ['ADMIN', 'AUTHORITY'] },
  ] },
];

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<number | null>(getUserId());
  const route = useHash();

  useEffect(() => {
    api<Meta>('/meta').then(m => {
      if (!uid || !m.users.some(u => u.id === uid)) { const admin = m.users.find(u => u.role === 'ADMIN')!; setUserId(admin.id); setUid(admin.id); return; }
      setMeta(m);
    }).catch(e => setErr(String(e.message)));
  }, [uid]);

  if (err) return <main><ErrorBox msg={`Cannot reach the ESH API: ${err}. Is the server running (npm run dev)? Has the import been run (npm run import)?`} /></main>;
  if (!meta) return <main><Loading /></main>;

  const key = route === '' ? 'dash' : route.split('/')[0] === 'p' || route.split('/')[0] === 'brief' ? '' : route.startsWith('phase/') ? 'board' : route.startsWith('org/') ? 'orgs' : route.split('?')[0];
  let view;
  if (route.startsWith('p/')) view = <Record key={route} esh={route.slice(2)} />;
  else if (route.startsWith('brief/')) view = <Brief esh={route.slice(6)} />;
  else if (route.startsWith('board')) view = <Pipeline />;
  else if (/^phase\/[0-5]$/.test(route)) view = <Phase key={route} ph={Number(route.slice(6))} />;
  else if (route.startsWith('projects')) view = <Projects key={route} initial={route.split('?')[1] ?? ''} />;
  else if (route.startsWith('triage')) view = <Triage />;
  else if (route.startsWith('j1')) view = <J1 />;
  else if (/^org\/\d+$/.test(route)) view = <Org key={route} id={Number(route.slice(4))} />;
  else if (route.startsWith('orgs')) view = <Orgs />;
  else if (route.startsWith('audit')) view = <Audit />;
  else view = <Dashboard />;

  return (
    <MetaCtx.Provider value={meta}>
      <div className="shell">
        <aside id="side">
          <a className="brand" href="#/"><b>ESH<span>.</span></b><small>Enterprise Scaling Hub</small></a>
          <nav>
            {NAV.map(sec => {
              const items = sec.items.filter(n => !n.roles || n.roles.includes(meta.me.role));
              return items.length ? (
                <div key={sec.g} className="navsec">
                  <div className="navg">{sec.g}</div>
                  {items.map(n => (
                    <a key={n.r} href={'#/' + n.h} className={key === n.r ? 'on' : ''}>
                      <span className="ic" aria-hidden="true">{n.i}</span>{n.l}
                      {n.r === 'triage' && meta.unconfirmed > 0 && <span className="badge" title="Projects whose ESF phase is still a suggestion">{meta.unconfirmed}</span>}
                    </a>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
          <label className="who">
            <span>Acting as</span>
            <select value={uid ?? ''} onChange={e => { setUserId(Number(e.target.value)); setUid(Number(e.target.value)); setMeta(null); }}>
              {['ADMIN', 'AUTHORITY', 'J1', 'VIEWER', 'PM'].map(role => (
                <optgroup key={role} label={{ ADMIN: 'J68 admin', AUTHORITY: 'Gate authority', J1: 'J1 Human Capital', VIEWER: 'Viewer', PM: 'Program managers' }[role]}>
                  {meta.users.filter(u => u.role === role).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </optgroup>
              ))}
            </select>
            <small>Demo role switcher · production uses single sign-on</small>
          </label>
        </aside>
        <div className="content">
          {meta.synthetic.projects > 0 && (
            <div className="synbar">
              <b>Synthetic demo data.</b> Values tagged <span className="syn">SYNTHETIC</span> are generated for this demo: gaps in the project inventory (status, PoP, sponsors, alignment and more),
              the ESF lifecycle on {meta.synthetic.projects} projects (phases, gates, evidence, funding, value, pathways, audit history), workforce impact, readiness and contacts.
            </div>
          )}
          <main>{view}</main>
          <footer className="foot">
            Data: FY{meta.fys.map(f => f.fy).join(' / FY')} R&D alignment workbooks · imported {meta.lastImport ? new Date(meta.lastImport.at).toLocaleString() : '—'} ·
            {' '}{meta.lastImport?.totals.projects ?? 0} projects · rules evaluated as of {meta.asOf} · local demo, not for distribution
          </footer>
        </div>
      </div>
    </MetaCtx.Provider>
  );
}
