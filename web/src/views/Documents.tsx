import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Loading, PH_COL, Syn, d10, go, useAsync } from '../ui';

const kb = (n: number | null) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const fileUrl = (id: number) => `/api/documents/${id}/file`;

/** Documents & evidence: the documents each gate requires, filed against the criterion they close. */
export function Documents() {
  const { data: d, error } = useAsync(() => api('/documents'), []);
  const [type, setType] = useState<string | null>(null);
  const [gate, setGate] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const rows = (d?.rows ?? []).filter((r: any) => (!type || r.doc_type === type) && (gate == null || d.docTypes[r.doc_type]?.gate === gate)
    && (!q || `${r.title} ${r.esh_id} ${r.project_title} ${r.file_name ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const { sorted, Th } = useSort<any>(rows, { key: 'uploaded_at', dir: -1 }, { uploaded_at: r => new Date(r.uploaded_at).getTime(), doc_type: r => d?.docTypes[r.doc_type]?.l });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const shown = all || q ? sorted : sorted.slice(0, 50);
  const typeMax = Math.max(...d.types.map((t: any) => t.n), 1);

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Documents &amp; evidence</h2>
          <div className="vsub">The documents the gates require — LOI, TRA, S&T report, PRR, J8 ROI certification, the Gate 3 commitment, ATO, owner acceptance — each filed against the criterion it closes. Upload from any project's page.</div></div>
      </div>

      <div className="hk-grid">
        <div className="hk"><span className="hk-l">Documents on file</span><span className="hk-v">{d.rows.length.toLocaleString()}</span><span className="hk-s">{d.rows.filter((r: any) => r.has_file).length} with an uploaded file</span></div>
        {d.completeness.filter((c: any) => c.passed > 0).slice(1, 5).map((c: any) => (
          <div key={c.gate} className={'hk click' + (gate === c.gate ? ' sel' : '')} onClick={() => setGate(gate === c.gate ? null : c.gate)}>
            <span className="hk-l">Gate {c.gate} files complete</span><span className="hk-v" style={{ color: (c.pct ?? 0) >= 80 ? 'var(--spon)' : (c.pct ?? 0) >= 50 ? 'var(--goldD)' : 'var(--red)' }}>{c.pct}%</span>
            <span className="hk-s">{c.complete} of {c.passed} projects that passed have every required document</span></div>
        ))}
      </div>
      <div className="fine dm">Document records in this demo are synthetic (no file attached; opening one shows a placeholder). Files you upload are stored locally.</div>

      <div className="grid2">
        <Card title={<>Required documents by gate <Help title="Required documents">Each gate's criteria call for documents: the LOI at Gate 0, the TRA and S&T report at Gate 1, PRR minutes and the J8 ROI certification at Gate 2, the SES-signed funding commitment and ATO at Gate 3, and owner acceptance, closeout and lessons learned at Gate 4. A file is complete when every required document is on file for a project that passed that gate. Waived criteria need no document.</Help></>} pad={false}>
          {d.completeness.map((c: any) => (
            <div key={c.gate} className="req-g">
              <div className="req-h" style={{ borderLeftColor: PH_COL[c.gate] }}><b>{c.name}</b><span className="sub">{c.complete}/{c.passed} complete</span></div>
              {c.required.map((r: any) => (
                <div key={r.key} className="obar click" onClick={() => setType(type === r.key ? null : r.key)}>
                  <span className="on wide">{r.label}</span>
                  <span className="track"><span style={{ width: `${r.due ? 100 * r.have / r.due : 0}%`, background: r.due && r.have / r.due >= 0.8 ? '#2F7D5C' : '#C9A961' }} /></span>
                  <span className="ov" style={{ width: 70 }}>{r.have}<small className="muted">/{r.due}</small></span>
                </div>
              ))}
            </div>
          ))}
        </Card>
        <Card title="Missing from passed gates" pad={false} right={<span className="hint">projects that passed without every required document</span>}>
          <div className="mini-list" style={{ maxHeight: 520, overflowY: 'auto', margin: 0 }}>
            {d.completeness.flatMap((c: any) => c.missing.map((m: any) => ({ ...m, gate: c.gate }))).slice(0, 60).map((m: any) => (
              <div key={m.esh_id + m.gate} className="alert-row" onClick={() => go('#/p/' + m.esh_id)}>
                <span className="tag" style={{ color: '#fff', background: PH_COL[m.gate] }}>G{m.gate}</span>
                <span><b>{m.title}</b><br /><span className="sub">Missing: {m.missing.join(', ')}</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Library" pad={false} right={<span className="tabs">
        <input type="search" placeholder="Search title, project, file…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
        <select value={type ?? ''} onChange={e => setType(e.target.value || null)}><option value="">All types</option>{d.types.filter((t: any) => t.n > 0).map((t: any) => <option key={t.key} value={t.key}>{t.label} ({t.n})</option>)}</select>
        {(type || gate != null || q) && <button onClick={() => { setType(null); setGate(null); setQ(''); }}>Clear</button>}
        <span className="hint">{sorted.length.toLocaleString()} documents</span></span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="title">Document</Th><Th k="doc_type">Type</Th><Th k="project_title">Project</Th><Th k="gate">Criterion</Th><Th k="uploaded_by">Filed by</Th><Th k="uploaded_at">Date</Th><Th k="size" num>Size</Th></tr></thead>
            <tbody>{shown.map((r: any) => (
              <tr key={r.id} onClick={() => window.open(fileUrl(r.id), '_blank')}>
                <td className="ttl">{r.title}<div className="sub mono">{r.file_name}{r.synthetic && <> <Syn /></>}</div></td>
                <td className="sm">{d.docTypes[r.doc_type]?.l ?? r.doc_type}</td>
                <td className="sm"><a href={'#/p/' + r.esh_id} onClick={e => e.stopPropagation()}>{r.project_title}</a></td>
                <td className="sm">{r.gate != null ? `G${r.gate} · #${r.ord}` : '—'}</td>
                <td className="sm">{r.uploaded_by}</td>
                <td className="mono sm nowrap">{d10(r.uploaded_at)}</td>
                <td className="num mono sm">{kb(r.size)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!q && sorted.length > 50 && <div style={{ padding: '10px 16px' }}><button className="link" onClick={() => setAll(!all)}>{all ? 'Show the latest 50' : `Show all ${sorted.length.toLocaleString()}`}</button></div>}
        </div>
      </Card>
      <div className="lbl" style={{ marginTop: 12 }}>Documents by type</div>
      <div className="obars">{d.types.filter((t: any) => t.n > 0).sort((a: any, b: any) => b.n - a.n).map((t: any) => (
        <div key={t.key} className="obar click" onClick={() => setType(type === t.key ? null : t.key)}><span className="on wide">{t.label}</span>
          <span className="track"><span style={{ width: `${100 * t.n / typeMax}%`, background: t.gate != null ? PH_COL[t.gate] : '#8A8378' }} /></span><span className="ov">{t.n}</span></div>
      ))}</div>
    </div>
  );
}

/** The documents card on a project record, with upload. */
export function ProjectDocuments({ r, onChange }: { r: any; onChange: (t: string, ok?: boolean) => void }) {
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('LOI');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const types: Record<string, { l: string }> = meta.docTypes ?? {};
  const canUpload = r.canEdit || r.canJ1;
  const upload = async () => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { onChange('Files are limited to 10 MB', false); return; }
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(file); });
      await api(`/projects/${r.project.esh_id}/documents`, { method: 'POST', body: { doc_type: type, title: title || file.name, file_name: file.name, mime: file.type || 'application/octet-stream', data } });
      setOpen(false); setTitle(''); setFile(null); onChange('Document uploaded');
    } catch (e: any) { onChange(e.message, false); } finally { setBusy(false); }
  };
  return (
    <Card title={`Documents (${r.documents.length})`} right={canUpload ? <button className="link" onClick={() => setOpen(!open)}>{open ? 'cancel' : '+ upload'}</button> : undefined}>
      {open && (
        <div className="form" style={{ marginBottom: 10 }}>
          <select value={type} onChange={e => setType(e.target.value)}>{Object.entries(types).map(([k, v]: any) => <option key={k} value={k}>{v.l}</option>)}</select>
          <input placeholder="Title (defaults to the file name)" value={title} onChange={e => setTitle(e.target.value)} />
          <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div><button className="btn sm" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button></div>
          <div className="note">Up to 10 MB. The document is filed against the gate criterion for its type and recorded in the audit log.</div>
        </div>
      )}
      {r.documents.length === 0 && <div className="note">No documents on file.</div>}
      <div className="people">{r.documents.map((x: any) => (
        <div key={x.id} className="person">
          <div className="lblr">{types[x.doc_type]?.l ?? x.doc_type}</div>
          <div><a href={fileUrl(x.id)} target="_blank" rel="noreferrer"><b>{x.title}</b></a> {x.synthetic && <Syn />}</div>
          <div className="mono sub">{x.file_name} · {kb(x.size)} · {x.uploaded_by} · {d10(x.uploaded_at)}</div>
        </div>
      ))}</div>
    </Card>
  );
}
