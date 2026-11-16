import { useMemo, useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Bars, Card, EL_COL, ErrorBox, Loading, OrgList, PH_COL, PH_NAME, PH_SHORT, PH_TXT, PhaseChip, STATUS, STATUS_COL, StatusChip, d10, go, money, useAsync } from '../ui';

const months = (from: string | null, to: string) => (from ? (new Date(to).getTime() - new Date(from).getTime()) / (30.44 * 864e5) : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function HBars({ items, color, onPick }: { items: { k: string; n: number; c?: string; sub?: number }[]; color: string; onPick?: (k: string) => void }) {
  const mx = Math.max(...items.map(i => i.n), 1);
  return (
    <div className="hbars">
      {items.map(r => (
        <div key={r.k} className="hbar wide" onClick={() => onPick?.(r.k)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
          <span title={r.k}>{r.k}</span>
          <span className="track"><span style={{ width: `${Math.max(2, 100 * r.n / mx)}%`, background: r.c ?? color }} /></span>
          <span className="mono n">{r.n}{r.sub != null && <small> · {r.sub}</small>}</span>
        </div>
      ))}
    </div>
  );
}

export function Phase({ ph }: { ph: number }) {
  const meta = useMeta();
  const [fy, setFy] = useState(meta.latestFy);
  const [search, setSearch] = useState('');
  const [pick, setPick] = useState<{ k: 'program_code' | 'pm' | 'status_code' | 'flag'; v: string } | null>(null);
  const [sort, setSort] = useState<{ k: string; dir: number }>({ k: 'esh_id', dir: 1 });
  const { data: d, error } = useAsync(() => api(`/phase/${ph}?fy=${fy}`), [ph, fy]);

  const all: any[] = d?.rows ?? [];
  const ready = new Set<string>(d?.ready ?? []);
  const flags = (p: any) => {
    const f: string[] = [];
    if (ready.has(p.esh_id)) f.push('READY');
    if (p.lapsed) f.push('POP-LAPSED');
    if (p.ending) f.push('POP-END');
    if (!p.sponsors) f.push('NO-SPONSOR');
    if (!p.npri) f.push('NO-ALIGN');
    if (p.esf_status === 'HOLD') f.push('HOLD');
    return f;
  };
  const rows = useMemo(() => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const r = all.filter(p => {
      if (pick) {
        if (pick.k === 'flag') { if (!flags(p).includes(pick.v)) return false; }
        else if ((p[pick.k] ?? '—') !== pick.v) return false;
      }
      if (!terms.length) return true;
      const hay = [p.esh_id, p.title, p.pm, p.sponsors, p.program_code, p.element_code].join(' ').toLowerCase();
      return terms.every(t => hay.includes(t));
    });
    const key = (p: any) => sort.k === 'crit' ? p.crit_done : sort.k === 'months' ? (months(p.pop_start, d.asOf) ?? -1) : String(p[sort.k] ?? '');
    return r.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * sort.dir);
  }, [d, search, pick, sort]);

  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;

  const count = (fn: (p: any) => boolean) => all.filter(fn).length;
  const group = (k: string) => {
    const m = new Map<string, number>();
    for (const p of all) m.set(p[k] ?? '—', (m.get(p[k] ?? '—') ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
  };
  const confirmed = count(p => p.esf_source === 'CONFIRMED');
  const mos = all.map(p => months(p.pop_start, d.asOf)).filter((x): x is number => x != null && x >= 0);
  const med = median(mos);
  const buckets = [['< 6 mo', 0, 6], ['6–12 mo', 6, 12], ['1–2 yr', 12, 24], ['2–3 yr', 24, 36], ['3 yr +', 36, 1e9]] as const;
  const funding = all.reduce((a, p) => a + p.funding, 0), value = all.reduce((a, p) => a + p.value, 0);
  const total = all.length;
  const th = (k: string, l: string) => <th onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : 1 }))}>{l} {sort.k === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</th>;
  const pickBtn = (k: NonNullable<typeof pick>['k'], v: string) => () => setPick(pick?.k === k && pick.v === v ? null : { k, v });
  const FLAG_COL: Record<string, string> = { READY: 'var(--spon)', 'POP-LAPSED': 'var(--red)', 'POP-END': 'var(--goldD)', 'NO-SPONSOR': 'var(--slate)', 'NO-ALIGN': 'var(--slate)', HOLD: 'var(--goldD)' };

  return (
    <>
      <div className="vhead">
        <div>
          <div className="crumb"><a href="#/board">Pipeline</a> / {PH_SHORT[ph]}</div>
          <h2 className="vt" style={{ color: PH_TXT[ph] }}>{PH_SHORT[ph]} — {PH_NAME[ph]}</h2>
          <div className="vsub">
            {total} project{total === 1 ? '' : 's'} {ph === 5 ? 'at scale' : `active or on hold in ${PH_SHORT[ph]}`} in the FY{fy} data call
            {ph < 5 && <> · next decision: <b>Gate {d.gate}</b></>} · rules as of {d.asOf}
          </div>
        </div>
        <label className="fy">Data call <select value={fy} onChange={e => setFy(Number(e.target.value))}>{meta.fys.map(f => <option key={f.fy} value={f.fy}>FY{f.fy}</option>)}</select></label>
      </div>

      <div className="phtabs">
        {PH_SHORT.map((l, i) => <a key={i} href={'#/phase/' + i} className={i === ph ? 'on' : ''} style={i === ph ? { background: PH_COL[i], borderColor: PH_COL[i] } : { color: PH_TXT[i] }}>{l}</a>)}
      </div>

      <div className="kpi-grid">
        <div className="kpi" onClick={() => setPick(null)}><div className="v">{total}</div><div className="l">projects in {PH_SHORT[ph]}</div></div>
        <div className="kpi" onClick={() => go('#/triage')}><div className="v">{confirmed}<small> / {total}</small></div><div className="l">phase confirmed (rest are suggestions)</div></div>
        {ph < 5 && <div className="kpi" onClick={pickBtn('flag', 'READY')}><div className="v">{d.ready.length}</div><div className="l">ready for Gate {d.gate} decision</div></div>}
        {ph < 5 && <div className="kpi" onClick={pickBtn('flag', 'HOLD')}><div className="v">{count(p => p.esf_status === 'HOLD')}</div><div className="l">on hold</div></div>}
        <div className="kpi warn" onClick={pickBtn('flag', 'POP-LAPSED')}><div className="v">{count(p => p.lapsed)}</div><div className="l">PoP lapsed but still live</div></div>
        <div className="kpi" onClick={pickBtn('flag', 'POP-END')}><div className="v">{count(p => p.ending)}</div><div className="l">PoP ends within 6 months</div></div>
        <div className="kpi" onClick={pickBtn('flag', 'NO-SPONSOR')}><div className="v">{count(p => !p.sponsors)}</div><div className="l">no sponsor on record</div></div>
        <div className="kpi" onClick={pickBtn('flag', 'NO-ALIGN')}><div className="v">{count(p => !p.npri)}</div><div className="l">not aligned to an FY{fy} priority</div></div>
        <div className="kpi"><div className="v">{med == null ? '—' : Math.round(med)}<small> mo</small></div><div className="l">median time since PoP start</div></div>
        {(funding > 0 || value > 0) && <div className="kpi"><div className="v">{money(funding)}</div><div className="l">funding recorded · {money(value)}/yr value claimed</div></div>}
      </div>

      {pick && <div className="banner info">Filtered to <b>{pick.k === 'flag' ? pick.v : `${{ program_code: 'Program', pm: 'PM', status_code: 'Status' }[pick.k]} = ${pick.v}`}</b> <a href="javascript:void 0" onClick={() => setPick(null)} style={{ marginLeft: 8 }}>clear</a></div>}

      <div className="grid2">
        <Card title={`${PH_SHORT[ph]} by program`} right={<span className="mono">click to filter</span>}>
          <HBars items={group('program_code').map(r => ({ ...r, c: EL_COL[all.find(p => (p.program_code ?? '—') === r.k)?.element_code] }))} color="var(--slate2)" onPick={k => pickBtn('program_code', k)()} />
        </Card>
        <Card title={`${PH_SHORT[ph]} by program manager`} right={<span className="mono">click to filter</span>}>
          <HBars items={group('pm')} color={PH_COL[ph]} onPick={k => pickBtn('pm', k)()} />
        </Card>
      </div>

      <div className="grid2">
        <Card title={ph < 5 ? `Gate ${d.gate} readiness — criteria closed across ${total} projects` : 'Gate 4 criteria (cleared on entry to At Scale)'}>
          <HBars items={d.criteria.map((c: any) => ({ k: `${c.ord}. ${c.text}${c.non_waivable ? ' ◆' : ''}`, n: c.met + c.waived, sub: total }))} color={PH_COL[ph]} />
          <div className="note">Bars show criteria marked MET or WAIVED · ◆ non-waivable. Gate decisions recorded so far: {d.gateDecisions.length ? d.gateDecisions.map((g: any) => `${g.outcome} ${g.n}`).join(', ') : 'none'}.</div>
        </Card>
        <Card title="Time since PoP start" right={<span className="mono">projects</span>}>
          <Bars h={170} items={buckets.map(([l, lo, hi]) => ({ l, c: PH_COL[ph], v: mos.filter(m => m >= lo && m < hi).length }))} />
          <div className="legend">{group('status_code').map(s => <span key={s.k} style={{ cursor: 'pointer' }} onClick={pickBtn('status_code', s.k)}><i style={{ background: STATUS_COL[s.k] ?? STATUS_COL['?'] }} />{STATUS[s.k] ?? 'No status'} {s.n}</span>)}</div>
        </Card>
      </div>

      <div className="fbar">
        <input type="search" placeholder={`Find a ${PH_SHORT[ph]} project — title, ESH ID, PM, sponsor…`} value={search} onChange={e => setSearch(e.target.value)} />
        <span className="cnt">{rows.length} of {total}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead><tr>{th('esh_id', 'ESH ID')}{th('title', 'Project')}{th('program_code', 'Program')}{th('pm', 'PM')}{th('status_code', 'Status')}<th>ESF</th>{ph < 5 && th('crit', `G${d.gate} criteria`)}{th('months', 'On contract')}{th('pop_end', 'PoP end')}<th>Sponsor(s)</th><th>Flags</th></tr></thead>
          <tbody>{rows.map(p => {
            const m = months(p.pop_start, d.asOf);
            return (
              <tr key={p.esh_id} onClick={() => go('#/p/' + p.esh_id)}>
                <td className="mono code">{p.esh_id}</td>
                <td className="ttl">{p.title}</td>
                <td><span className="mono" style={{ color: EL_COL[p.element_code] ?? 'var(--slate)', fontWeight: 600 }}>{p.program_code ?? '—'}</span></td>
                <td className="sm">{p.pm ?? '—'}</td>
                <td><StatusChip s={p.status_code} /></td>
                <td><PhaseChip p={p} /></td>
                {ph < 5 && <td className="mono sm">{p.crit_done} / {d.criteria.length}</td>}
                <td className="mono sm">{m == null ? '—' : m < 0 ? 'not started' : `${Math.round(m)} mo`}</td>
                <td className="mono sm" style={{ color: p.lapsed ? 'var(--red)' : p.ending ? 'var(--goldD)' : undefined }}>{d10(p.pop_end)}</td>
                <td className="sm"><OrgList list={p.sponsor_list} /></td>
                <td>{flags(p).map(f => <span key={f} className="tag" style={{ color: FLAG_COL[f], marginRight: 4 }}>{f}</span>)}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {!rows.length && <div className="note" style={{ padding: 12 }}>No projects match.</div>}
      </div>

      {d.exits.length > 0 && (
        <Card title={`Managed exits from ${PH_SHORT[ph]} — ${d.exits.length}`} pad={false}>
          {d.exits.map((p: any) => (
            <div key={p.esh_id} className="alert-row" onClick={() => go('#/p/' + p.esh_id)}>
              <PhaseChip p={{ esf_phase: ph, esf_status: p.esf_status, esf_source: p.esf_source }} />
              <span><b>{p.esh_id}</b> · {p.title} <span className="sub">{p.program_code}</span></span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
