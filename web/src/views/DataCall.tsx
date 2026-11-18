import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Insights, Loading, STATUS, d10, useAsync } from '../ui';

const ST: Record<string, { l: string; c: string }> = {
  NOT_STARTED: { l: 'Not started', c: '#B9B4A8' }, IN_PROGRESS: { l: 'In progress', c: '#C9A961' }, SUBMITTED: { l: 'Awaiting review', c: '#3F90CB' },
  RETURNED: { l: 'Returned', c: '#CE0F3E' }, APPROVED: { l: 'Approved', c: '#2F7D5C' },
};
const FIELD_L: Record<string, string> = { status_code: 'Status', pop_start: 'PoP start', pop_end: 'PoP end', transition_phase: 'Transition phase', transition_type: 'Transition type', description: 'Description', charter: 'Charter' };

/** The annual data call, run in the Hub instead of a spreadsheet: assign, collect, review, close. */
export function DataCall() {
  const meta = useMeta();
  const { data: list, error: e1, reload: reloadList } = useAsync(() => api('/datacalls'), []);
  const [fy, setFy] = useState<number | null>(null);
  const cur = fy ?? list?.rows.find((r: any) => r.status === 'OPEN')?.fy ?? list?.rows[0]?.fy ?? null;
  const { data: d, error: e2, reload } = useAsync(() => (cur ? api(`/datacalls/${cur}`) : Promise.resolve(null)), [cur, meta.me.id]);
  const [status, setStatus] = useState<string | null>(null);
  const [mine, setMine] = useState(meta.me.role === 'PM');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<any | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [due, setDue] = useState('');
  const rows = (d?.rows ?? []).filter((r: any) => (!status || r.status === status) && (!mine || r.mine) && (!q || `${r.title} ${r.esh_id} ${r.pm}`.toLowerCase().includes(q.toLowerCase())));
  const { sorted, Th } = useSort<any>(rows, { key: 'status' }, { status: r => ['RETURNED', 'SUBMITTED', 'IN_PROGRESS', 'NOT_STARTED', 'APPROVED'].indexOf(r.status), changed: r => r.changed.length, updated_at: r => r.updated_at ? new Date(r.updated_at).getTime() : null });
  const pm = useSort<any>(d?.byPm ?? [], { key: 'done' });
  if (e1 || e2) return <ErrorBox msg={e1 || e2} />;
  if (!list || !d) return <Loading />;
  const c = d.call, k = d.counts, admin = meta.me.role === 'ADMIN';
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); setMsg({ ok: true, t: ok }); reload(); reloadList(); return true; } catch (e: any) { setMsg({ ok: false, t: e.message }); return false; } };
  const hasOpen = list.rows.some((r: any) => r.status === 'OPEN');
  const nextFy = Math.max(...list.rows.map((r: any) => r.fy)) + 1;

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Data call</h2>
          <div className="vsub">The annual R&D alignment data call, run in the Hub: every PM updates their projects here, J68 reviews each response, and closing the call publishes the approved updates as that year's data. It replaces the spreadsheet workbook.</div></div>
        <label className="fy">Data call <select value={cur ?? ''} onChange={e => { setFy(Number(e.target.value)); setStatus(null); }}>
          {list.rows.map((r: any) => <option key={r.fy} value={r.fy}>FY{r.fy} · {r.status === 'OPEN' ? 'open' : 'closed'}{r.source === 'WORKBOOK' ? ' (workbook)' : ''}</option>)}</select></label>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'err')} onClick={() => setMsg(null)}>{msg.t}</div>}

      {c.source === 'WORKBOOK' ? (
        <Card title={`FY${c.fy} — imported from the workbook`}>
          <div className="note">This data call ran in Excel before the Hub existed; its {list.rows.find((r: any) => r.fy === c.fy)?.projects ?? 0} project rows were imported as-is. New data calls run here.</div>
          {admin && !hasOpen && <OpenCall nextFy={nextFy} due={due} setDue={setDue} onOpen={() => act(() => api('/datacalls', { method: 'POST', body: { fy: nextFy, due_at: due } }), `FY${nextFy} data call opened`)} />}
        </Card>
      ) : (<>
        <div className="hk-grid six">
          {(['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'APPROVED'] as const).map(s => (
            <div key={s} className={'hk click' + (status === s ? ' sel' : '')} onClick={() => setStatus(status === s ? null : s)}>
              <span className="hk-l">{ST[s].l}</span><span className="hk-v" style={{ color: ST[s].c }}>{k[s]}</span><span className="hk-s">{Math.round(100 * k[s] / Math.max(k.total, 1))}% of {k.total} · click to filter</span></div>
          ))}
          <div className="hk"><span className="hk-l">{c.status === 'OPEN' ? 'Days left' : 'Closed'}</span><span className="hk-v">{c.status === 'OPEN' ? d.daysLeft : d10(c.closed_at)}</span><span className="hk-s">Opened {d10(c.opens_at)} · due {d10(c.due_at)}</span></div>
        </div>
        <div className="dc-bar">{(['APPROVED', 'SUBMITTED', 'RETURNED', 'IN_PROGRESS', 'NOT_STARTED'] as const).map(s => k[s] ? <span key={s} style={{ width: `${100 * k[s] / k.total}%`, background: ST[s].c }} title={`${ST[s].l}: ${k[s]}`} /> : null)}</div>
        {c.synthetic && <div className="fine dm">The FY{c.fy} responses are synthetic demo data.</div>}
        <Insights items={[
          { t: <><b>{Math.round(100 * (k.SUBMITTED + k.APPROVED) / Math.max(k.total, 1))}%</b> of {k.total} projects submitted{c.status === 'OPEN' && d.daysLeft != null ? `, ${d.daysLeft} days before the ${d10(c.due_at)} deadline` : ''}</> },
          k.SUBMITTED > 0 && { t: `${k.SUBMITTED} responses waiting on J68 review` },
          k.NOT_STARTED > 0 && { t: `${k.NOT_STARTED} projects not started`, tone: 'warn' },
          k.RETURNED > 0 && { t: `${k.RETURNED} returned to PMs for changes`, tone: 'warn' },
        ]} />

        {admin && c.status === 'OPEN' && (
          <div className="banner info" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}><b>Closing the call</b> publishes the {k.APPROVED} approved responses as FY{c.fy} data and records each change in the audit log. Responses not approved stay as they were.</span>
            <button className="btn sm" onClick={() => { if (confirm(`Close the FY${c.fy} data call and publish ${k.APPROVED} approved responses?`)) act(() => api(`/datacalls/${c.fy}/close`, { method: 'POST', body: {} }), `FY${c.fy} data call closed`); }}>Close data call</button>
          </div>
        )}

        <div className="grid3">
          <Card title={<>Responses <Help title="Responses">One row per live project. The PM opens it, updates what changed since last year, and submits. J68 then approves it or returns it with a note. Rows with changes show which fields moved.</Help></>} pad={false}
            right={<span className="tabs"><input type="search" placeholder="Search project, ID, PM…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
              {meta.me.role === 'PM' && <label className="chk"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine</label>}
              {status && <button onClick={() => setStatus(null)}>Show all</button>}</span>}>
            <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
              <table className="list flat rows">
                <thead><tr><Th k="title">Project</Th><Th k="pm">PM</Th><Th k="status">Status</Th><Th k="changed" num>Changes</Th><Th k="updated_at">Updated</Th></tr></thead>
                <tbody>{sorted.map((r: any) => (
                  <tr key={r.esh_id} onClick={() => setOpen(r)} className={r.mine ? 'mine' : ''}>
                    <td className="ttl">{r.title}<div className="sub mono">{r.esh_id}</div></td>
                    <td className="sm">{r.pm}</td>
                    <td><span className="stpill" style={{ background: ST[r.status].c }}>{ST[r.status].l}</span></td>
                    <td className="num sm">{r.changed.length ? r.changed.map((f: string) => FIELD_L[f]).join(', ') : '—'}</td>
                    <td className="mono sm nowrap">{r.updated_at ? d10(r.updated_at) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!sorted.length && <div className="note" style={{ padding: 14 }}>No responses match.</div>}
            </div>
          </Card>
          <Card title="Progress by program manager" pad={false}>
            <table className="list flat rows">
              <thead><tr><pm.Th k="pm">PM</pm.Th><pm.Th k="total" num>Projects</pm.Th><pm.Th k="done" num>Submitted</pm.Th></tr></thead>
              <tbody>{pm.sorted.map((x: any) => (
                <tr key={x.pm} onClick={() => setQ(x.pm)}>
                  <td className="sm"><b>{x.pm}</b><div className="dc-mini">{(['APPROVED', 'SUBMITTED', 'RETURNED', 'IN_PROGRESS', 'NOT_STARTED'] as const).map(s => x[s] ? <span key={s} style={{ width: `${100 * x[s] / x.total}%`, background: ST[s].c }} /> : null)}</div></td>
                  <td className="num mono">{x.total}</td>
                  <td className="num mono" style={{ color: (x.done ?? 0) < 30 ? 'var(--red)' : undefined, fontWeight: 700 }}>{x.done}%</td>
                </tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      </>)}

      {admin && c.source !== 'WORKBOOK' && c.status === 'CLOSED' && !hasOpen && <Card title="Start the next data call"><OpenCall nextFy={nextFy} due={due} setDue={setDue} onOpen={() => act(() => api('/datacalls', { method: 'POST', body: { fy: nextFy, due_at: due } }), `FY${nextFy} data call opened`)} /></Card>}

      {open && <ResponseModal r={open} fy={c.fy} admin={admin} callOpen={c.status === 'OPEN'} fields={d.fields} onClose={() => setOpen(null)}
        onDone={(t: string) => { setOpen(null); setMsg({ ok: true, t }); reload(); reloadList(); }} onErr={(t: string) => setMsg({ ok: false, t })} />}
    </div>
  );
}

function OpenCall({ nextFy, due, setDue, onOpen }: { nextFy: number; due: string; setDue: (s: string) => void; onOpen: () => void }) {
  return (
    <div className="inline-form" style={{ marginTop: 10 }}>
      <span>Open the <b>FY{nextFy}</b> data call for every live project, due</span>
      <input type="date" value={due} onChange={e => setDue(e.target.value)} />
      <button className="btn sm" disabled={!due} onClick={onOpen}>Open data call</button>
    </div>
  );
}

function ResponseModal({ r, fy, admin, callOpen, fields, onClose, onDone, onErr }: any) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f: string) => [f, r.payload?.[f] ?? ''])));
  const [note, setNote] = useState('');
  const save = async (submit: boolean) => {
    try { await api(`/datacalls/${fy}/${r.esh_id}`, { method: 'PUT', body: { payload: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v === '' ? null : v])), submit } }); onDone(submit ? 'Response submitted for review' : 'Draft saved'); }
    catch (e: any) { onErr(e.message); }
  };
  const review = async (action: 'APPROVE' | 'RETURN') => {
    try { await api(`/datacalls/${fy}/${r.esh_id}/review`, { method: 'POST', body: { action, ...(note ? { note } : {}) } }); onDone(action === 'APPROVE' ? 'Response approved' : 'Response returned to the PM'); }
    catch (e: any) { onErr(e.message); }
  };
  const input = (f: string) => {
    if (!r.canEdit) return <span>{display(f, r.payload?.[f])}</span>;
    if (f === 'status_code') return <select value={vals[f]} onChange={e => setVals({ ...vals, [f]: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select>;
    if (f === 'pop_start' || f === 'pop_end') return <input type="date" value={vals[f]} onChange={e => setVals({ ...vals, [f]: e.target.value })} />;
    if (f === 'description') return <textarea rows={3} value={vals[f]} onChange={e => setVals({ ...vals, [f]: e.target.value })} />;
    return <input value={vals[f]} onChange={e => setVals({ ...vals, [f]: e.target.value })} />;
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3>{r.title}</h3>
        <div className="sub mono" style={{ marginBottom: 8 }}>{r.esh_id} · PM {r.pm} · <span className="stpill" style={{ background: ST[r.status].c }}>{ST[r.status].l}</span></div>
        {r.status === 'RETURNED' && r.note && <div className="banner warn"><b>Returned by {r.reviewed_by}:</b> {r.note}</div>}
        <table className="gh-tbl dc-form">
          <thead><tr><th>FIELD</th><th>LAST YEAR</th><th>FY{fy}</th></tr></thead>
          <tbody>{fields.map((f: string) => {
            const changed = JSON.stringify((r.canEdit ? (vals[f] || null) : r.payload?.[f]) ?? null) !== JSON.stringify(r.baseline?.[f] ?? null);
            return <tr key={f} className={changed ? 'chg' : ''}><td><b>{FIELD_L[f]}</b></td><td className="sm muted">{display(f, r.baseline?.[f])}</td><td>{input(f)}</td></tr>;
          })}</tbody>
        </table>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {r.canEdit && callOpen && <><button className="btn" onClick={() => save(true)}>Submit for review</button><button className="btn ghost" onClick={() => save(false)}>Save draft</button></>}
          {admin && r.status === 'SUBMITTED' && callOpen && <>
            <button className="btn" onClick={() => review('APPROVE')}>Approve</button>
            <input placeholder="What needs fixing? (to return)" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn ghost" onClick={() => review('RETURN')}>Return to PM</button></>}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <div className="note">Changed fields are highlighted. Approved responses are published when the data call closes.</div>
      </div>
    </div>
  );
}
const display = (f: string, v: any) => (v == null || v === '' ? '—' : f === 'status_code' ? `${v} · ${STATUS[v] ?? ''}` : String(v).length > 140 ? String(v).slice(0, 140) + '…' : String(v));
