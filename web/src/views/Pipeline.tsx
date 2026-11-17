import { useState } from 'react';
import { api, qs } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { ErrorBox, Loading, OrgLink, OrgList, PH_COL, PH_NAME, PH_SHORT, d10, go, useAsync, ProgramLink } from '../ui';

/** The expanded lane: one row per project, sortable. */
function LaneRows({ items, exits }: { items: any[]; exits: boolean }) {
  const meta = useMeta();
  const progName = (c: string | null) => (c ? meta.programs.find(p => p.code === c)?.name ?? c : '—');
  const { sorted, Th } = useSort(items, { key: 'title' }, { program: r => progName(r.program_code), sponsor: r => r.sponsor_list?.[0]?.name ?? null, pop_end: r => (r.pop_end ? new Date(r.pop_end).getTime() : null) });
  if (!items.length) return <div className="empty" style={{ padding: 16 }}>No projects</div>;
  return (
    <div className="lane-rows">
      <table className="list flat rows">
        <thead><tr><Th k="esh_id">ID</Th><Th k="title">Project</Th><Th k="program">Program</Th><Th k="sponsor">Sponsor</Th><Th k="status_code">Status</Th><Th k="pop_end">Contract ends</Th></tr></thead>
        <tbody>{sorted.map(p => (
          <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)} className={p.esf_source === 'SUGGESTED' ? 'sugg' : ''}>
            <td className="mono code">{p.esh_id}</td>
            <td className="ttl">{p.title}</td>
            <td className="sm"><ProgramLink code={p.program_code} name={progName(p.program_code)} full /></td>
            <td className="sm">{p.sponsor_list?.length ? <OrgList list={p.sponsor_list} /> : <span className="muted">—</span>}</td>
            <td className="sm nowrap">
              {exits ? <span style={{ color: p.esf_status === 'SUNSET' ? 'var(--red)' : 'var(--slate)', fontWeight: 600 }}>{p.esf_status === 'SUNSET' ? 'Sunset' : 'Descoped'}</span>
                : p.esf_status === 'HOLD' ? <b style={{ color: 'var(--goldD)' }}>On hold</b> : p.esf_source === 'SUGGESTED' ? <span className="muted">Suggested phase</span> : 'Active'}
            </td>
            <td className="mono sm nowrap">{d10(p.pop_end)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function Pipeline() {
  const meta = useMeta();
  const [element, setElement] = useState('');
  const [program, setProgram] = useState('');
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);   // the one expanded lane; null = all lanes at equal width
  const { data, error } = useAsync(() => api(`/projects${qs({ fy: meta.latestFy, element, program, source: onlyConfirmed ? 'CONFIRMED' : '' })}`), [element, program, onlyConfirmed]);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows: any[] = (data.rows as any[]).filter(p => {
    if (!terms.length) return true;
    const hay = [p.esh_id, p.title, p.pm, p.sponsors, p.program_code, p.element_code].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  const cols = [0, 1, 2, 3, 4, 5].map(ph => ({ ph, items: rows.filter(p => p.esf_phase === ph && (ph === 5 ? p.esf_status === 'AT_SCALE' : ['ACTIVE', 'HOLD'].includes(p.esf_status))) }));
  const exits = rows.filter(p => p.esf_status === 'SUNSET' || p.esf_status === 'DESCOPED');

  const card = (p: any) => {
    const col = p.esf_status === 'SUNSET' ? 'var(--red)' : p.esf_status === 'DESCOPED' ? 'var(--slate2)' : PH_COL[p.esf_phase];
    return (
      <div key={p.esh_id} className={'pcard' + (p.esf_source === 'SUGGESTED' ? ' sugg' : '')} style={{ borderLeftColor: col }} onClick={() => go('#/p/' + p.esh_id)}
        title={`${p.title}${p.esf_source === 'SUGGESTED' ? ' — phase suggested from workbook data, not yet confirmed' : ''}`}>
        <div className="code">{p.esh_id}{p.esf_status === 'HOLD' && <span style={{ color: 'var(--goldD)' }}> · HOLD</span>}{p.esf_source === 'SUGGESTED' && <span className="sg">suggested</span>}</div>
        <div className="nm">{p.title}</div>
        <div className="mt"><span>{p.sponsor_list?.[0] ? <OrgLink id={p.sponsor_list[0].id} name={p.sponsor_list[0].name} /> : 'no sponsor'}</span><span className="mono prog"><ProgramLink code={p.program_code} /></span></div>
      </div>
    );
  };
  const lanes = [
    ...cols.map(c => ({ key: String(c.ph), label: PH_SHORT[c.ph], items: c.items, color: PH_COL[c.ph], fg: c.ph === 5 ? '#16233C' : '#fff', dash: '#/phase/' + c.ph,
      sub: `${PH_NAME[c.ph]} · ${c.items.filter(p => p.esf_source === 'CONFIRMED').length} confirmed` })),
    { key: 'exits', label: 'Managed exits', items: exits, color: '#5E5A55', fg: '#fff', dash: '#/exits' as string | null, sub: 'Sunset + descoped' },
  ];

  return (
    <>
      <div className="vhead">
        <div><h2 className="vt">Pipeline</h2>
          <div className="vsub">FY{meta.latestFy} portfolio by ESF phase. Click a phase to expand it and read its projects; click it again to see every phase. Dashed cards are unconfirmed suggestions.</div></div>
      </div>
      <div className="fbar">
        <input type="search" className="search" placeholder="Find a project — title, ESH ID, PM, sponsor…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <select value={element} onChange={e => { setElement(e.target.value); setProgram(''); }}><option value="">Element: all</option>{meta.elements.map(e => <option key={e.code} value={e.code}>{e.code}</option>)}</select>
        <select value={program} onChange={e => setProgram(e.target.value)}><option value="">Program: all</option>{meta.programs.filter(p => !element || p.element_code === element).map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} /> Confirmed only</label>
        <span className="cnt">{terms.length ? `${rows.length} of ${data.rows.length} match` : `${rows.length} projects`}</span>
      </div>
      <div id="board" className={open != null ? 'focus' : ''}
        style={open != null ? { gridTemplateColumns: lanes.map((_, i) => (i === open ? 'minmax(0,1fr)' : '52px')).join(' ') } : undefined}>
        {lanes.map((l, i) => {
          const isOpen = open === i, isMini = open != null && !isOpen;
          return (
            <div key={l.key} className={'col' + (isOpen ? ' wide' : '') + (isMini ? ' mini' : '')}>
              <button className="colh band" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}
                title={isOpen ? 'Click to show all phases again' : `Click to expand ${l.label}`}
                style={{ ['--ph' as any]: l.color, ['--phfg' as any]: l.fg }}>
                <div className="t"><span className="nm">{l.label}</span><span className="cnt">{l.items.length}</span></div>
                <div className="s">{l.sub}</div>
                {isOpen && <span className="bandx">{l.dash && <span className="lnk" role="link" onClick={e => { e.stopPropagation(); go(l.dash!); }}>{l.key === 'exits' ? 'Exits dashboard →' : 'Phase dashboard →'}</span>}<span>Show all phases ✕</span></span>}
              </button>
              {isOpen ? <LaneRows items={l.items} exits={l.key === 'exits'} />
                : !isMini && <div className="cards">{l.items.length ? l.items.map(p => card(p)) : <div className="empty">No projects</div>}</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
