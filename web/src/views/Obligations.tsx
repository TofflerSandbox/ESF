import { useState } from 'react';
import { api } from '../api';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Loading, go, useAsync } from '../ui';

const CODE: Record<string, { c: string; bg: string; l: string }> = {
  K: { c: '#fff', bg: '#16233C', l: 'Key decision' }, R: { c: '#fff', bg: '#3F90CB', l: 'Required' },
  O: { c: '#16233C', bg: '#DCE7F3', l: 'Optional' }, 'O*': { c: '#16233C', bg: '#F1E3BF', l: 'Escalation only' }, '—': { c: '#B9B4A8', bg: 'transparent', l: 'Not applicable' },
};
const GATE_L = ['Gate 0 · Intake', 'Gate 1 · Phase I exit', 'Gate 2 · Phase II exit', 'Gate 3 ★ · Commitment', 'Gate 4 · Handoff', 'Stage 5 · Annual review'];

/** Stakeholder obligations: the ESF matrix of who owes what at each gate, tracked live against every project. */
export function Obligations() {
  const { data: d, error } = useAsync(() => api('/obligations'), []);
  const [sel, setSel] = useState<{ a: number; g: number } | null>({ a: 2, g: 3 });
  const { sorted, Th } = useSort<any>(d?.byOrg ?? [], { key: 'owed', dir: -1 });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const cell = sel ? d.rows[sel.a].cells[sel.g] : null;
  const co = d.rows.find((r: any) => r.key === 'COSPONSOR');
  const g3 = co?.cells[3];

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Stakeholder obligations</h2>
          <div className="vsub">Who owes what to the process at each gate — the ESF Stakeholder Obligation Matrix, tracked live against every project working toward a gate. Click a cell to see what is still owed and by whom.</div></div>
      </div>

      {g3 && <div className="takeaway">
        At Gate 3 — the funding-commitment gate — co-sponsors have signed for only <b>{g3.met} of {g3.working}</b> projects ({g3.pct}%).
        {' '}{d.byOrg.filter((o: any) => o.declined > 0).length} sponsoring organizations have declined ownership at Gate 3 at least once — the "WCF perverse incentive" in senior leader decision #7.
      </div>}

      <Card title={<>The matrix <Help title="Reading the matrix"><b>K</b> = key decision, cannot be delegated. <b>R</b> = required participation. <b>O</b> = optional or recommended. <b>—</b> = not applicable. Where the Hub records the evidence for an obligation (a gate criterion), the cell shows the share of projects at that gate where it has been delivered.</Help></>} pad={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="omatrix">
            <thead><tr><th>Actor</th>{GATE_L.map((g, i) => <th key={i}>{g}</th>)}</tr></thead>
            <tbody>{d.rows.map((r: any, ai: number) => (
              <tr key={r.key}>
                <td className="actor">{r.actor}{r.hub && <span className="j1tag">HUB</span>}</td>
                {r.cells.map((c: any, gi: number) => {
                  const on = sel?.a === ai && sel?.g === gi;
                  return (
                    <td key={gi} className={(c.code === '—' ? 'na' : 'cellp') + (on ? ' on' : '')} onClick={() => c.code !== '—' && setSel({ a: ai, g: gi })} title={c.tip}>
                      {c.code !== '—' ? <>
                        <span className="ocode" style={{ background: CODE[c.code].bg, color: CODE[c.code].c }}>{c.code}</span>
                        {c.tracked && c.pct != null && <span className="opct" style={{ color: c.pct >= 70 ? 'var(--spon)' : c.pct >= 40 ? 'var(--goldD)' : 'var(--red)' }}>{c.pct}%</span>}
                        {c.tracked && c.pct == null && c.open.length > 0 && <span className="opct" style={{ color: 'var(--spon)' }}>{c.open.length} due</span>}
                        {c.tracked && c.pct != null && <span className="otrack"><span style={{ width: `${c.pct}%`, background: c.pct >= 70 ? '#2F7D5C' : c.pct >= 40 ? '#C9A961' : '#CE0F3E' }} /></span>}
                      </> : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="legend" style={{ padding: '8px 16px 12px' }}>{Object.entries(d.legend).map(([k2, l]) => <span key={k2}><i style={{ background: CODE[k2].bg === 'transparent' ? '#EDEBE4' : CODE[k2].bg }} />{k2} {String(l)}</span>)}<span>% = delivered for projects now at that gate</span></div>
      </Card>

      {cell && sel && (
        <Card title={`${d.rows[sel.a].actor} at ${GATE_L[sel.g]}`} right={<span className="ocode big" style={{ background: CODE[cell.code].bg, color: CODE[cell.code].c }}>{cell.code} · {CODE[cell.code].l}</span>}>
          <p className="gate-q" style={{ fontSize: 16 }}>{cell.tip}</p>
          {cell.tracked ? (<>
            {cell.evidence.length > 0 && <div className="sub" style={{ margin: '6px 0 10px' }}><b>Evidence the Hub tracks:</b> {cell.evidence.join(' · ')}</div>}
            {cell.pct != null && <div className="sub" style={{ marginBottom: 8 }}>Delivered for <b>{cell.met} of {cell.working}</b> projects now at this gate.</div>}
            <div className="lbl">{cell.pct == null ? 'Decisions owed' : `Still owed (${cell.open.length})`}</div>
            <div className="mini-list" style={{ maxHeight: 320, overflowY: 'auto', margin: 0 }}>
              {cell.open.slice(0, 60).map((o: any) => (
                <div key={o.esh_id} className="alert-row" onClick={() => go('#/p/' + o.esh_id)}>
                  <span style={{ flex: 1 }}><b>{o.title}</b><br /><span className="sub">{o.sponsor ?? 'No sponsor'} · PM {o.pm ?? '—'} · owes: {o.owes}</span></span>
                </div>
              ))}
              {cell.open.length === 0 && <div className="note" style={{ padding: '6px 0' }}>Nothing outstanding.</div>}
            </div>
          </>) : <div className="note">The Hub doesn't record evidence for this obligation yet; it's shown for reference.</div>}
        </Card>
      )}

      <Card title={<>Co-sponsor accountability by organization <Help title="Co-sponsor accountability">For each sponsoring organization: how many live projects it sponsors, how many owe a co-sponsor obligation at their current gate (LOI, reaffirmation, the Gate 3 funding signature, Gate 4 acceptance), and how many times it walked away at Gate 3 — sunset because the sponsor withdrew or nobody would own it.</Help></>} pad={false}>
        <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="name">Organization</Th><Th k="projects" num>Live projects</Th><Th k="owed" num>Obligation owed now</Th><Th k="pct" num>Delivered</Th><Th k="declined" num>Declined at Gate 3</Th></tr></thead>
            <tbody>{sorted.map((o: any) => (
              <tr key={o.name} onClick={() => go('#/org/' + o.id)}>
                <td className="ttl">{o.name}</td><td className="num mono">{o.projects}</td>
                <td className="num mono" style={{ color: o.owed ? 'var(--goldD)' : undefined, fontWeight: 700 }}>{o.owed}</td>
                <td className="num mono">{o.pct != null ? `${o.pct}%` : '—'}</td>
                <td className="num mono" style={{ color: o.declined ? 'var(--red)' : undefined, fontWeight: o.declined ? 700 : 400 }}>{o.declined || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <div className="fine" style={{ marginTop: 8 }}>Matrix content from the ESF v3.0 guide. The J1 row is a Hub addition (white paper §3.1). ◆ Delivery figures rest on synthetic criteria evidence in this demo.</div>
    </div>
  );
}
