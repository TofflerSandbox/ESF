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
import { ProcessMap } from './views/ProcessMap';
import { Health } from './views/Health';
import { Roi } from './views/Roi';
import { Gates } from './views/Gates';
import { Exits } from './views/Exits';
import { Funding } from './views/Funding';
import { DataCall } from './views/DataCall';
import { Board, BoardBook, Boards } from './views/Boards';
import { Obligations } from './views/Obligations';
import { Decisions } from './views/Decisions';
import { Documents } from './views/Documents';
import { Tour } from './views/Tour';
import { Realization } from './views/Realization';
import { Program, Programs } from './views/Program';
import { Overlaps } from './views/Overlap';

export type Meta = {
  me: { id: number; name: string; role: string; person_id: number | null; org_id: number | null };
  latestFy: number; asOf: string;
  users: { id: number; name: string; role: string; person_id: number | null; org_id: number | null }[];
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
  exitReasons: Record<string, string>;
  docTypes: Record<string, { l: string; gate: number | null }>;
  openDataCall: { fy: number; due_at: string } | null;
  techResults: Record<string, string>;
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
  { g: 'Your organization', items: [{ h: 'org/ME', r: 'myorg', l: 'My organization', i: '★', roles: ['SPONSOR'] }] },
  { g: 'Framework', items: [
    { h: 'map', r: 'map', l: 'Process map', i: '◇' }, { h: 'decisions', r: 'decisions', l: 'Senior leader decisions', i: '⚖' },
    { h: 'tour', r: 'tour', l: 'Guided tour', i: '▶', roles: ['DEMO'] },
  ] },
  { g: 'Portfolio', items: [
    { h: '', r: 'dash', l: 'Dashboard', i: '▦' }, { h: 'board', r: 'board', l: 'Pipeline', i: '⇶' },
    { h: 'gates', r: 'gates', l: 'Gates', i: '◆' }, { h: 'boards', r: 'boards', l: 'Gate boards', i: '▤' }, { h: 'exits', r: 'exits', l: 'Managed exits', i: '⤫' },
    { h: 'projects', r: 'projects', l: 'Projects', i: '☰' }, { h: 'programs', r: 'programs', l: 'Programs', i: '▥' }, { h: 'overlaps', r: 'overlaps', l: 'Overlaps', i: '≈' }, { h: 'orgs', r: 'orgs', l: 'Organizations', i: '⌂' },
  ] },
  { g: 'Value & funding', items: [{ h: 'roi', r: 'roi', l: 'Return on investment', i: '$' }, { h: 'realization', r: 'realization', l: 'Realization reviews', i: '↻' }, { h: 'funding', r: 'funding', l: 'Funding & transition', i: '⇄' }] },
  { g: 'People', items: [{ h: 'j1', r: 'j1', l: 'Workforce & change', i: '◎' }, { h: 'obligations', r: 'obligations', l: 'Stakeholder obligations', i: '▣' }] },
  { g: 'Data', items: [{ h: 'datacall', r: 'datacall', l: 'Data call', i: '✎' }, { h: 'documents', r: 'documents', l: 'Documents', i: '▧' }, { h: 'health', r: 'health', l: 'Data health', i: '♥' }] },
  { g: 'Administration', items: [
    { h: 'triage', r: 'triage', l: 'Phase review', i: '✓', roles: ['ADMIN'] },
    { h: 'audit', r: 'audit', l: 'Audit log', i: '⧗', roles: ['ADMIN', 'AUTHORITY'] },
  ] },
];

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uid, setUid] = useState<number | null>(getUserId());
  const [demo, setDemo] = useState<boolean>(() => { try { return localStorage.getItem('esh.demo') === '1'; } catch { return false; } });
  const route = useHash();

  useEffect(() => {
    api<Meta>('/meta').then(m => {
      if (!uid || !m.users.some(u => u.id === uid)) { const admin = m.users.find(u => u.role === 'ADMIN')!; setUserId(admin.id); setUid(admin.id); return; }
      setMeta(m);
    }).catch(e => setErr(String(e.message)));
  }, [uid]);

  if (err) return <main><ErrorBox msg={`Cannot reach the ESH API: ${err}. Is the server running (npm run dev)? Has the import been run (npm run import)?`} /></main>;
  if (!meta) return <main><Loading /></main>;

  const key = meta.me.org_id && route === `org/${meta.me.org_id}` ? 'myorg' : route === '' ? 'dash' :route.split('/')[0] === 'p' || route.split('/')[0] === 'brief' ? '' : route.startsWith('phase/') ? 'board' : route.startsWith('org/') ? 'orgs' : route.startsWith('program') ? 'programs' :route.startsWith('map') ? 'map' : route.startsWith('gates') ? 'gates' : route.startsWith('boards') ? 'boards' : route.split('?')[0];
  let view;
  if (route.startsWith('p/')) view = <Record key={route} esh={route.slice(2)} />;
  else if (route.startsWith('brief/')) view = <Brief esh={route.slice(6)} />;
  else if (/^board(\?|$)/.test(route)) view = <Pipeline />;
  else if (/^phase\/[0-5]$/.test(route)) view = <Phase key={route} ph={Number(route.slice(6))} />;
  else if (route.startsWith('projects')) view = <Projects key={route} initial={route.split('?')[1] ?? ''} />;
  else if (route.startsWith('triage')) view = <Triage />;
  else if (route.startsWith('j1')) view = <J1 />;
  else if (route.startsWith('health')) view = <Health />;
  else if (route.startsWith('roi')) view = <Roi />;
  else if (route.startsWith('realization')) view = <Realization />;
  else if (/^program\/[A-Za-z0-9-]+$/.test(route)) view = <Program key={route} code={route.slice(8)} />;
  else if (route.startsWith('programs')) view = <Programs />;
  else if (route.startsWith('overlaps')) view = <Overlaps />;
  else if (/^gates(\/[0-4])?$/.test(route)) view = <Gates key={route} initial={route.length > 6 ? Number(route.slice(6)) : undefined} />;
  else if (route.startsWith('exits')) view = <Exits />;
  else if (route.startsWith('funding')) view = <Funding />;
  else if (route.startsWith('datacall')) view = <DataCall />;
  else if (/^boards\/\d+\/book$/.test(route)) view = <BoardBook key={route} id={Number(route.split('/')[1])} />;
  else if (/^boards\/\d+$/.test(route)) view = <Board key={route} id={Number(route.split('/')[1])} />;
  else if (route.startsWith('boards')) view = <Boards />;
  else if (route.startsWith('obligations')) view = <Obligations />;
  else if (route.startsWith('decisions')) view = <Decisions />;
  else if (route.startsWith('documents')) view = <Documents />;
  else if (route.startsWith('tour')) view = <Tour />;
  else if (/^map(\/[0-5])?$/.test(route)) view = <ProcessMap key={route} initial={route.length > 4 ? Number(route.slice(4)) : 0} />;
  else if (/^org\/\d+$/.test(route)) view = <Org key={route} id={Number(route.slice(4))} />;
  else if (route.startsWith('orgs')) view = <Orgs />;
  else if (route.startsWith('audit')) view = <Audit />;
  else view = <Dashboard />;

  return (
    <MetaCtx.Provider value={meta}>
      <div className="shell">
        <aside id="side">
          <a className="brand" href="#/"><b>DLA R&amp;D HUB<span>.</span></b><small>Enterprise Scaling Hub</small></a>
          <nav>
            {NAV.map(sec => {
              const items = sec.items.filter(n => !n.roles || (n.roles.includes('DEMO') ? demo : n.roles.includes(meta.me.role)));
              return items.length ? (
                <div key={sec.g} className="navsec">
                  <div className="navg">{sec.g}</div>
                  {items.map(n => (
                    <a key={n.r} href={'#/' + (n.h === 'org/ME' ? `org/${meta.me.org_id}` : n.h)} className={key === n.r ? 'on' : ''}>
                      <span className="ic" aria-hidden="true">{n.i}</span>{n.l}
                      {n.r === 'triage' && meta.unconfirmed > 0 && <span className="badge" title="Projects whose ESF phase is still a suggestion">{meta.unconfirmed}</span>}
                      {n.r === 'datacall' && meta.openDataCall && <span className="badge open" title={`FY${meta.openDataCall.fy} data call is open`}>FY{String(meta.openDataCall.fy).slice(2)}</span>}
                    </a>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
          <label className="who">
            <span>Acting as</span>
            <select value={uid ?? ''} onChange={e => { setUserId(Number(e.target.value)); setUid(Number(e.target.value)); setMeta(null); }}>
              {['ADMIN', 'AUTHORITY', 'SPONSOR', 'J1', 'VIEWER', 'PM'].map(role => (
                <optgroup key={role} label={{ ADMIN: 'J68 admin', AUTHORITY: 'Gate authority', SPONSOR: 'Sponsoring organizations', J1: 'J1 Human Capital', VIEWER: 'Viewer', PM: 'Program managers' }[role]}>
                  {meta.users.filter(u => u.role === role).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </optgroup>
              ))}
            </select>
            <small>Demo role switcher · production uses single sign-on</small>
          </label>
          <label className="demo-toggle" title="Show the guided tour of scripted demo stories">
            <input type="checkbox" checked={demo} onChange={e => { setDemo(e.target.checked); try { localStorage.setItem('esh.demo', e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} /> Demo mode
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
