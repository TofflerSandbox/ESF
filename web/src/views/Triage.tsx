import { useState } from 'react';
import { api, qs } from '../api';
import { useMeta } from '../App';
import { ErrorBox, Loading, PH_SHORT, PhaseChip, StatusChip, d10, go, useAsync, ProgramLink } from '../ui';

/** Admin work queue: confirm or correct the ESF phase suggested for each imported project. */
export function Triage() {
  const meta = useMeta();
  const [program, setProgram] = useState('');
  const [pm, setPm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, reload } = useAsync(() => api(`/projects${qs({ fy: meta.latestFy, source: 'SUGGESTED', program, pm })}`), [program, pm]);
  const admin = meta.me.role === 'ADMIN';
  const confirm = async (esh: string, phase: number, status: string) => {
    try { await api(`/projects/${esh}/triage`, { method: 'POST', body: { phase, status } }); setMsg(`${esh} confirmed as ${PH_SHORT[phase]} · ${status}`); reload(); }
    catch (e: any) { setMsg(e.message); }
  };

  return (
    <>
      <h2 className="vt">Phase review</h2>
      <div className="vsub">Onboarding queue for imported projects. Source data carries no ESF phase, so ESH suggests one per project from status, transition fields and PoP; an admin confirms or corrects it before gates can be worked. The queue empties as projects are confirmed, and new imports refill it. {admin ? '' : <b>Switch to the J68 admin user to confirm.</b>}</div>
      <div className="fbar">
        <select value={program} onChange={e => setProgram(e.target.value)}><option value="">Program: all</option>{meta.programs.map(p => <option key={p.code} value={p.code}>{p.code}</option>)}</select>
        <select value={pm} onChange={e => setPm(e.target.value)}><option value="">PM: all</option>{meta.pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span className="cnt">{data ? data.rows.length : '…'} awaiting confirmation (FY{meta.latestFy})</span>
      </div>
      {msg && <div className="banner info" onClick={() => setMsg(null)}>{msg}</div>}
      <ErrorBox msg={error} />
      {!data ? <Loading /> : (
        <table className="list">
          <thead><tr><th>ESH ID</th><th>Project</th><th>Program</th><th>Status</th><th>PoP</th><th>Suggested</th><th>Why</th>{admin && <th>Confirm as</th>}</tr></thead>
          <tbody>{data.rows.map((p: any) => <Row key={p.esh_id} p={p} admin={admin} onConfirm={confirm} />)}</tbody>
        </table>
      )}
    </>
  );
}

function Row({ p, admin, onConfirm }: { p: any; admin: boolean; onConfirm: (esh: string, phase: number, status: string) => void }) {
  const [phase, setPhase] = useState<number>(p.esf_phase);
  const [status, setStatus] = useState<string>(p.esf_status);
  const [reason, setReason] = useState<string | null>(null);
  return (
    <tr>
      <td className="mono code" onClick={() => go('#/p/' + p.esh_id)}>{p.esh_id}</td>
      <td className="ttl" onClick={() => go('#/p/' + p.esh_id)}>{p.title}</td>
      <td className="mono sm"><ProgramLink code={p.program_code} /></td>
      <td><StatusChip s={p.status_code} /></td>
      <td className="mono sm">{d10(p.pop_start)}<br />{d10(p.pop_end)}</td>
      <td><PhaseChip p={p} /></td>
      <td className="sm">{reason ?? <button className="link" onClick={async () => setReason((await api(`/projects/${p.esh_id}`)).project.esf_reason)}>show</button>}</td>
      {admin && <td className="nowrap">
        <select value={phase} onChange={e => { const v = Number(e.target.value); setPhase(v); setStatus(v === 5 ? 'AT_SCALE' : status === 'AT_SCALE' ? 'ACTIVE' : status); }}>{PH_SHORT.map((s, i) => <option key={i} value={i}>{s}</option>)}</select>
        <select value={status} onChange={e => setStatus(e.target.value)}>{(phase === 5 ? ['AT_SCALE'] : ['ACTIVE', 'HOLD', 'SUNSET', 'DESCOPED']).map(s => <option key={s}>{s}</option>)}</select>
        <button className="btn sm" onClick={() => onConfirm(p.esh_id, phase, status)}>✓</button>
      </td>}
    </tr>
  );
}
