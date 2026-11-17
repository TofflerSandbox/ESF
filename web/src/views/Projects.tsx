import { useMemo, useState } from 'react';
import { api, qs } from '../api';
import { useMeta } from '../App';
import { EL_COL, ErrorBox, Loading, OrgList, PhaseChip, StatusChip, d10, go, useAsync, ProgramLink } from '../ui';
import { AssistPanel } from './Assist';

const KEYS = ['q', 'fy', 'element', 'program', 'pm', 'status', 'esfStatus', 'source', 'owner', 'priority', 'mine'] as const;
type F = Record<(typeof KEYS)[number], string>;

export function Projects({ initial }: { initial: string }) {
  const meta = useMeta();
  const init = useMemo(() => {
    const u = new URLSearchParams(initial);
    const f = Object.fromEntries(KEYS.map(k => [k, u.get(k) ?? ''])) as F;
    if (!initial) f.fy = String(meta.latestFy);
    return f;
  }, [initial, meta.latestFy]);
  const [f, setF] = useState<F>(init);
  const [q, setQ] = useState(init.q);
  const [sort, setSort] = useState<{ k: string; dir: number }>({ k: 'esh_id', dir: 1 });
  const { data, error } = useAsync(() => api(`/projects${qs({ ...f, q })}`), [JSON.stringify(f), q]);
  const set = (k: keyof F, v: string) => setF(x => ({ ...x, [k]: v }));
  const [pin, setPin] = useState<{ ids: string[]; label: string } | null>(null);
  const [aside, setAside] = useState<boolean>(() => { try { return localStorage.getItem('esh.assist.open') !== '0'; } catch { return true; } });
  const toggleAside = (v: boolean) => { setAside(v); try { localStorage.setItem('esh.assist.open', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const showPinned = (ids: string[], label: string) => {
    setF(Object.fromEntries(KEYS.map(k => [k, ''])) as F); setQ('');
    const box = document.querySelector<HTMLInputElement>('.fbar input[type=search]'); if (box) box.value = '';
    setPin({ ids, label }); setSort({ k: 'rank', dir: 1 });
  };

  const rows = useMemo(() => {
    const rank = new Map((pin?.ids ?? []).map((id, i) => [id, i]));
    const r: any[] = (data?.rows ?? []).filter((p: any) => !pin || rank.has(p.esh_id));
    if (sort.k === 'rank') return r.sort((a: any, b: any) => (rank.get(a.esh_id) ?? 0) - (rank.get(b.esh_id) ?? 0));
    const key = (p: any) => (sort.k === 'pop_end' ? p.pop_end ?? '' : sort.k === 'phase' ? (p.esf_phase ?? -1) : String(p[sort.k] ?? ''));
    return r.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * sort.dir);
  }, [data, sort, pin]);
  const th = (k: string, l: string) => <th onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }))}>{l} {sort.k === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</th>;
  const owners = [...new Set(meta.priorities.map(p => p.owner))];
  const prio = meta.priorities.find(p => String(p.id) === f.priority);

  return (
    <div className={'proj-layout' + (aside ? ' with-aside' : '')}>
      <div className="proj-main">
      <h2 className="vt">Projects {!aside && <button className="as-open" onClick={() => toggleAside(true)}>✦ Ask the portfolio</button>}</h2>
      <div className="vsub">Every project of record across the FY{meta.fys[0]?.fy}–FY{meta.latestFy} data calls. Search titles, descriptions, ESH IDs, contract numbers and SPM IDs.</div>
      <div className="fbar">
        <input type="search" placeholder="Search title, description, ESH ID, contract, SPM…" defaultValue={q} onChange={e => { const v = e.target.value; clearTimeout((window as any).__t); (window as any).__t = setTimeout(() => setQ(v), 250); }} />
        <select value={f.fy} onChange={e => set('fy', e.target.value)}><option value="">Data call: any</option>{meta.fys.map(x => <option key={x.fy} value={x.fy}>In FY{x.fy}</option>)}</select>
        <select value={f.element} onChange={e => set('element', e.target.value)}><option value="">Element: all</option>{meta.elements.map(e => <option key={e.code}>{e.code}</option>)}</select>
        <select value={f.program} onChange={e => set('program', e.target.value)}><option value="">Program: all</option>{meta.programs.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select>
        <select value={f.pm} onChange={e => set('pm', e.target.value)}><option value="">PM: all</option>{meta.pms.map(p => <option key={p.id} value={p.id}>{p.name} ({p.n})</option>)}</select>
        <select value={f.status} onChange={e => set('status', e.target.value)}><option value="">Status: all</option>{['A', 'B', 'C', 'D', 'E'].map(s => <option key={s} value={s}>{s} · {({ A: 'New Start', B: 'Ongoing', C: 'Monitoring', D: 'Completing/Cancelling', E: 'Complete' } as any)[s]}</option>)}</select>
        <select value={f.esfStatus} onChange={e => set('esfStatus', e.target.value)}><option value="">ESF: all</option>{['ACTIVE', 'HOLD', 'AT_SCALE', 'SUNSET', 'DESCOPED'].map(s => <option key={s}>{s}</option>)}</select>
        <select value={f.source} onChange={e => set('source', e.target.value)}><option value="">Phase: any</option><option value="SUGGESTED">Suggested</option><option value="CONFIRMED">Confirmed</option></select>
        <select value={f.owner} onChange={e => set('owner', e.target.value)}><option value="">Aligned to: any</option>{owners.map(o => <option key={o}>{o}</option>)}</select>
        {meta.me.role === 'PM' && <label className="chk"><input type="checkbox" checked={f.mine === '1'} onChange={e => set('mine', e.target.checked ? '1' : '')} /> My projects</label>}
        <button onClick={() => { setF(Object.fromEntries(KEYS.map(k => [k, ''])) as F); setQ(''); setPin(null); }}>Clear</button>
        <span className="cnt">{data ? rows.length : '…'} projects</span>
      </div>
      {pin && <div className="banner info">Showing the {pin.ids.length} project{pin.ids.length === 1 ? '' : 's'} found for <b>“{pin.label}”</b>, best match first <a href="#/projects" onClick={e => { e.preventDefault(); setPin(null); setSort({ k: 'esh_id', dir: 1 }); }} style={{ marginLeft: 8 }}>clear</a></div>}
      {prio && <div className="banner info">Filtered to FY{prio.fy} priority <b>{prio.owner}: {prio.label}</b> <a href="#/projects" style={{ marginLeft: 8 }}>clear</a></div>}
      <ErrorBox msg={error} />
      {!data ? <Loading /> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead><tr>{th('esh_id', 'ESH ID')}{th('title', 'Project')}{th('program_code', 'Program')}{th('pm', 'PM')}{th('status_code', 'Status')}{th('phase', 'ESF')}<th>Sponsor(s)</th>{th('pop_end', 'PoP end')}<th>Data calls</th></tr></thead>
            <tbody>{rows.map((p: any) => (
              <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                <td className="mono code">{p.esh_id}</td>
                <td className="ttl">{p.title}</td>
                <td><ProgramLink code={p.program_code} el={p.element_code} name={meta.programs.find(x => x.code === p.program_code)?.name} /></td>
                <td className="sm">{p.pm ?? '—'}</td>
                <td><StatusChip s={p.status_code} /></td>
                <td><PhaseChip p={p} /></td>
                <td className="sm"><OrgList list={p.sponsor_list} /></td>
                <td className="mono sm">{d10(p.pop_end)}</td>
                <td className="mono sm">{(p.fys ?? []).map((y: number) => "'" + String(y).slice(2)).join(' ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      </div>
      {aside && <AssistPanel onShow={showPinned} onClose={() => toggleAside(false)} />}
    </div>
  );
}
