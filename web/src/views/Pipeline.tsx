import { useState } from 'react';
import { api, qs } from '../api';
import { useMeta } from '../App';
import { ErrorBox, Loading, OrgLink, PH_COL, PH_NAME, PH_SHORT, PH_TXT, go, useAsync } from '../ui';

export function Pipeline() {
  const meta = useMeta();
  const [element, setElement] = useState('');
  const [program, setProgram] = useState('');
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [search, setSearch] = useState('');
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
        title={p.esf_source === 'SUGGESTED' ? 'Phase suggested from workbook data — not yet confirmed' : 'Phase confirmed'}>
        <div className="code">{p.esh_id} · {p.program_code ?? '—'}{p.esf_status === 'HOLD' && <span style={{ color: 'var(--goldD)' }}> · HOLD</span>}{p.esf_source === 'SUGGESTED' && <span className="sg">suggested</span>}</div>
        <div className="nm">{p.title}</div>
        <div className="mt"><span>{p.sponsor_list?.[0] ? <OrgLink id={p.sponsor_list[0].id} name={p.sponsor_list[0].name} /> : 'no sponsor'}</span><span className="mono">{p.pm?.split(' ').slice(-1)[0] ?? ''}</span></div>
      </div>
    );
  };

  return (
    <>
      <div className="vhead">
        <div><h2 className="vt">Pipeline</h2>
          <div className="vsub">FY{meta.latestFy} portfolio by ESF phase. Cards move only by a recorded gate decision (or an admin triage), never by drag. Dashed cards are unconfirmed suggestions.</div></div>
      </div>
      <div className="fbar">
        <input type="search" className="search" placeholder="Find a project — title, ESH ID, PM, sponsor…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <select value={element} onChange={e => { setElement(e.target.value); setProgram(''); }}><option value="">Element: all</option>{meta.elements.map(e => <option key={e.code} value={e.code}>{e.code}</option>)}</select>
        <select value={program} onChange={e => setProgram(e.target.value)}><option value="">Program: all</option>{meta.programs.filter(p => !element || p.element_code === element).map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} /> Confirmed only</label>
        <span className="cnt">{terms.length ? `${rows.length} of ${data.rows.length} match` : `${rows.length} projects`}</span>
      </div>
      <div id="board">
        {cols.map(c => (
          <div key={c.ph} className="col">
            <a className="colh link" href={'#/phase/' + c.ph} title={`Open the ${PH_SHORT[c.ph]} dashboard`}>
              <div className="t" style={{ color: PH_TXT[c.ph] }}>{PH_SHORT[c.ph]} <span className="arr">→</span><span>{c.items.length}</span></div>
              <div className="s">{PH_NAME[c.ph]} · {c.items.filter(p => p.esf_source === 'CONFIRMED').length} confirmed</div></a>
            <div className="cards">{c.items.length ? c.items.map(card) : <div className="empty">—</div>}</div>
          </div>
        ))}
        <div className="col">
          <div className="colh"><div className="t" style={{ color: 'var(--red)' }}>Managed exits<span>{exits.length}</span></div><div className="s">sunset + descoped</div></div>
          <div className="cards">{exits.map(card)}</div>
        </div>
      </div>
    </>
  );
}
