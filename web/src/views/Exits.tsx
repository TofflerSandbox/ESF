import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Bars, Card, Donut, ErrorBox, Loading, PH_COL, d10, go, money, useAsync } from '../ui';

const REASON_COL: Record<string, string> = {
  FOLLOW_ON: '#2F7D5C', KNOWLEDGE: '#3F90CB', NO_OWNER: '#F9B018', VALUE: '#D9822B', TECHNICAL: '#CE0F3E', SPONSOR: '#6B3FA0', SUPERSEDED: '#8A6B25', null: '#B9B4A8',
};
const TECH_COL: Record<string, string> = { MET: '#2F7D5C', PARTIAL: '#C9A961', NOT_MET: '#CE0F3E', null: '#CFCBBF' };
const $ = (v: number) => money(v).replace('.00M', 'M');

/** Managed exits: why projects stop before scale, whether they worked, and what came after. */
export function Exits() {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api('/exits'), []);
  const [reason, setReason] = useState<string | null>(null);
  const [tech, setTech] = useState<string | null>(null);
  const [gate, setGate] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const rowsAll: any[] = d?.rows ?? [];
  const filtered = rowsAll.filter(r => (reason == null || String(r.reason) === reason) && (tech == null || String(r.technical) === tech) && (gate == null || r.gate === gate)
    && (!q || `${r.title} ${r.esh_id} ${r.program_name} ${r.rationale ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const { sorted, Th } = useSort(filtered, { key: 'decided_at', dir: -1 }, { decided_at: r => r.decided_at ? new Date(r.decided_at).getTime() : null, next: r => r.next.length });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const k = d.kpis;
  const reasonMax = Math.max(...d.byReason.map((r: any) => r.n), 1);
  const progMax = Math.max(...d.byProgram.map((p: any) => p.exits), 1);
  const progName = (c: string) => meta.programs.find(p => p.code === c)?.name ?? c;
  const filters = [reason != null && d.byReason.find((r: any) => String(r.reason) === reason)?.label, tech != null && (d.tech[tech] ?? 'Not recorded'), gate != null && `Gate ${gate}`].filter(Boolean);

  return (
    <div className="home">
      <div className="vhead">
        <div><div className="crumb"><a href="#/board">Pipeline</a> / Managed exits</div>
          <h2 className="vt">Managed exits</h2>
          <div className="vsub">Projects stopped at a gate before reaching scale (sunset or descoped). Why did they stop, did they work, and what came after? A documented exit is the framework working, not a failure.</div></div>
      </div>

      <div className="takeaway">{d.takeaway}</div>

      <div className="hk-grid six">
        <div className="hk"><span className="hk-l">Projects stopped</span><span className="hk-v">{k.exits}</span><span className="hk-s">{$(k.cost)} spent before stopping</span></div>
        <div className="hk"><span className="hk-l">Worked technically</span><span className="hk-v">{k.workedPct}%</span><span className="hk-s">{k.worked} worked, {k.partly} partly worked</span></div>
        <div className="hk click" onClick={() => setReason(reason === 'NO_OWNER' ? null : 'NO_OWNER')}><span className="hk-l">Worked, no owner</span><span className="hk-v" style={{ color: '#B07607' }}>{k.orphaned}</span>
          <span className="hk-s">{$(k.orphanedCost)} of proven work left without a home</span></div>
        <div className="hk click" onClick={() => setReason(reason === 'FOLLOW_ON' ? null : 'FOLLOW_ON')}><span className="hk-l">Continued as a follow-on</span><span className="hk-v">{k.continued}</span>
          <span className="hk-s">Later phases of the same effort, found from project titles</span></div>
        <div className="hk click" onClick={() => setReason(reason === 'KNOWLEDGE' ? null : 'KNOWLEDGE')}><span className="hk-l">Delivered a report</span><span className="hk-v">{k.knowledge}</span><span className="hk-s">Ended as an S&T report or DTIC publication</span></div>
        <div className="hk"><span className="hk-l">Time before stopping</span><span className="hk-v">{k.medianMonths != null ? Math.round(k.medianMonths) : '—'}<small style={{ fontSize: 16 }}> mo</small></span><span className="hk-s">Median from Phase I start to the stop decision</span></div>
      </div>
      <div className="fine">◆ Exit reasons and technical results in this demo are synthetic, apart from follow-on projects (matched from real titles) and DTIC reports (from the data call).</div>

      <div className="grid2">
        <Card title="Why projects stopped" right={<span className="hint">click a reason to filter the list</span>}>
          <div className="obars">
            {d.byReason.map((r: any) => (
              <div key={String(r.reason)} className={'obar click' + (reason === String(r.reason) ? ' sel' : '')} onClick={() => setReason(reason === String(r.reason) ? null : String(r.reason))}>
                <span className="on wide">{r.label}</span>
                <span className="track"><span style={{ width: `${Math.max(3, 100 * r.n / reasonMax)}%`, background: REASON_COL[String(r.reason)] }} /></span>
                <span className="ov">{r.n}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Did it work technically?" right={<span className="hint">click to filter</span>}>
          <div className="vdonut">
            <Donut slices={d.byTech.map((t: any) => ({ k: String(t.tech), l: t.label, v: t.n, c: TECH_COL[String(t.tech)] }))} size={220} center={`${k.workedPct}%`} sub="worked" onClick={kk => setTech(tech === kk ? null : kk)} />
            <div className="vlegend">
              {d.byTech.map((t: any) => (
                <button key={String(t.tech)} className={'vl' + (tech === String(t.tech) ? ' on' : '')} onClick={() => setTech(tech === String(t.tech) ? null : String(t.tech))}>
                  <i style={{ background: TECH_COL[String(t.tech)] }} /><span><b>{t.label}</b> <span className="pc">{t.n}</span></span>
                </button>
              ))}
              <div className="chart-note">A project can work and still stop — no owner, no budget line, or a cheaper option. Those are the ones worth a second look.</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Where they stopped" right={<span className="hint">click a gate to filter</span>}>
          <Bars h={240} items={d.byGate.map((g: any) => ({ l: g.label, v: g.n, c: PH_COL[g.phase], sub: g.n ? $(g.cost) : '', onClick: () => setGate(gate === g.gate ? null : g.gate) }))} />
          <div className="chart-note">Most stops happen at Gate 2 (ROI certified, funding path named) and Gate 3 (a signed funding commitment). <a href="#/gates">See the gates →</a></div>
        </Card>
        <Card title="Stops by program" right={<span className="hint">stopped · share of the program's projects</span>}>
          <div className="obars">
            {d.byProgram.slice(0, 12).map((p: any) => (
              <div key={p.program} className="obar click" onClick={() => setQ(p.name)} title={`${p.name}: ${p.exits} stopped, ${p.live} still live`}>
                <span className="on">{p.program}</span>
                <span className="track"><span style={{ width: `${Math.max(3, 100 * p.exits / progMax)}%`, background: '#8A8378' }} /></span>
                <span className="ov" style={{ width: 70 }}>{p.exits} <small className="muted">· {p.rate}%</small></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title={`Stopped projects${filters.length ? ' — ' + filters.join(' · ') : ''}`} pad={false}
        right={<span className="tabs"><input type="search" placeholder="Search title, program, rationale…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
          {(filters.length > 0 || q) && <button onClick={() => { setReason(null); setTech(null); setGate(null); setQ(''); }}>Clear filters</button>}</span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr>
              <Th k="title">Project</Th><Th k="program_name">Program</Th><Th k="gate">Stopped at</Th><Th k="decided_at">Date</Th>
              <Th k="reason_label">Why</Th><Th k="technical">Worked?</Th><Th k="next">What came after</Th><Th k="cost" num>Spent</Th>
            </tr></thead>
            <tbody>{sorted.map((r: any) => (
              <tr key={r.esh_id} onClick={() => go('#/p/' + r.esh_id)} title={r.rationale ?? ''}>
                <td className="ttl">{r.title}<div className="sub mono">{r.esh_id}</div></td>
                <td className="sm">{progName(r.program_code)}</td>
                <td className="sm"><span className="phdot" style={{ background: PH_COL[Math.min(r.gate, 5)] }} />Gate {r.gate}</td>
                <td className="mono sm nowrap">{d10(r.decided_at)}</td>
                <td className="sm"><span className="phdot" style={{ background: REASON_COL[String(r.reason)] }} />{r.reason_label}</td>
                <td className="sm" style={{ color: TECH_COL[String(r.technical)] === '#CFCBBF' ? 'var(--slate2)' : TECH_COL[String(r.technical)], fontWeight: 600 }}>{r.technical ? d.tech[r.technical] : '—'}</td>
                <td className="sm">{r.next.length ? r.next.map((n: any) => <a key={n.esh_id} href={'#/p/' + n.esh_id} onClick={e => e.stopPropagation()} className="nxt">→ {n.title.slice(0, 50)}{n.title.length > 50 ? '…' : ''}</a>)
                  : r.reason === 'KNOWLEDGE' ? 'S&T report / DTIC' : <span className="muted">—</span>}</td>
                <td className="num mono">{r.cost ? $(r.cost) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
          {!sorted.length && <div className="note" style={{ padding: 14 }}>No stopped projects match.</div>}
        </div>
      </Card>
      <div className="note" style={{ marginTop: 8 }}>Hover a row to read the gate authority's rationale. New stop decisions require a reason and a technical result, so this analysis builds as the Hub is used.</div>
    </div>
  );
}
