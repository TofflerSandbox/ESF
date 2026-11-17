import { useState } from 'react';
import { api } from '../api';
import { Card, ErrorBox, Loading, d10, useAsync } from '../ui';

const ST: Record<string, { l: string; c: string }> = { OPEN: { l: 'Open', c: '#CE0F3E' }, IN_REVIEW: { l: 'In review', c: '#C9A961' }, DECIDED: { l: 'Decided', c: '#2F7D5C' }, DEFERRED: { l: 'Deferred', c: '#8A8378' } };
const SEV: Record<string, string> = { Critical: '#9B1B2E', High: '#D9822B', Medium: '#8A8378' };
const ICON: Record<string, string> = { 'Governance & Authority': '⚖️', 'Financial Policy & Resource Decisions': '💰', 'Organizational Design & Incentives': '🏗', 'Implementation & Change Management': '🚀' };

/** The 11 policy decisions only SES / GOFO leaders can make before the ESF can be formally implemented — tracked to resolution. */
export function Decisions() {
  const { data: d, error, reload } = useAsync(() => api('/decisions'), []);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const n = (s: string) => d.rows.filter((r: any) => r.state.status === s).length;
  const cats = [...new Set(d.rows.map((r: any) => r.category))] as string[];
  const critOpen = d.rows.filter((r: any) => r.severity === 'Critical' && r.state.status !== 'DECIDED');

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Senior leader decisions</h2>
          <div className="vsub">Eleven organizational policy, authority and resource questions that only SES or GOFO leaders can resolve before the ESF can be formally implemented. Each one has options, stakes and an owner; record the decision here when it's made.</div></div>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'err')} onClick={() => setMsg(null)}>{msg.t}</div>}

      <div className="takeaway">
        {n('DECIDED')} of 11 decided, {n('IN_REVIEW')} in review, {n('OPEN')} still open{n('DEFERRED') ? `, ${n('DEFERRED')} deferred` : ''}.
        {critOpen.length > 0 && <> {critOpen.length} critical decision{critOpen.length === 1 ? ' is' : 's are'} unresolved: {critOpen.map((r: any) => `#${r.ord}`).join(', ')}.</>}
      </div>
      <div className="hk-grid">
        {Object.entries(ST).map(([k, v]) => (
          <div key={k} className={'hk click' + (filter === k ? ' sel' : '')} onClick={() => setFilter(filter === k ? null : k)}><span className="hk-l">{v.l}</span><span className="hk-v" style={{ color: v.c }}>{n(k)}</span><span className="hk-s">click to filter</span></div>
        ))}
      </div>
      <div className="fine">◆ Decision content is from the ESF v3.0 guide; statuses, owners and dates in this demo are synthetic.</div>

      {cats.map(cat => {
        const rows = d.rows.filter((r: any) => r.category === cat && (!filter || r.state.status === filter));
        return rows.length ? (
          <Card key={cat} title={<>{ICON[cat]} {cat}</>} pad={false}>
            {rows.map((r: any) => {
              const s = r.state, isOpen = open === r.ord;
              return (
                <div key={r.ord} className={'sld' + (isOpen ? ' open' : '')}>
                  <button className="sld-h" onClick={() => setOpen(isOpen ? null : r.ord)} aria-expanded={isOpen}>
                    <span className="sld-n">{r.ord}</span>
                    <span className="sld-t"><b>{r.title}</b><span className="sub">{r.tags}</span></span>
                    <span className="sevtag" style={{ background: SEV[r.severity] }}>{r.severity}</span>
                    <span className="stpill" style={{ background: ST[s.status].c }}>{ST[s.status].l}{s.status === 'DECIDED' && s.decided_option ? ` · Option ${s.decided_option}` : ''}</span>
                    <span className="sld-o">{s.owner ?? 'Owner TBD'}{s.status !== 'DECIDED' && s.due ? ` · due ${d10(s.due)}` : s.decided_at ? ` · ${d10(s.decided_at)}` : ''}</span>
                    <span className="sld-x">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="sld-b">
                      <p>{r.body}</p>
                      <div className="sld-opts">{r.options.map((o: any) => (
                        <div key={o.k} className={'sld-opt' + (s.decided_option === o.k ? ' chosen' : '')}><b>Option {o.k}{s.decided_option === o.k ? ' — chosen' : ''}</b><span>{o.text}</span></div>
                      ))}</div>
                      <div className="sld-stake"><b>What's at stake:</b> {r.stakes}</div>
                      {s.rationale && <div className="sld-rat"><b>{s.status === 'DECIDED' ? 'Decision' : 'Status note'}:</b> {s.rationale}</div>}
                      {d.canEdit && <DecisionForm r={r} onDone={(t: string, ok = true) => { setMsg({ ok, t }); if (ok) reload(); }} />}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        ) : null;
      })}
    </div>
  );
}

function DecisionForm({ r, onDone }: { r: any; onDone: (t: string, ok?: boolean) => void }) {
  const s = r.state;
  const [b, setB] = useState({ status: s.status, owner: s.owner ?? '', due: s.due ? String(s.due).slice(0, 10) : '', decided_option: s.decided_option ?? '', rationale: s.rationale ?? '' });
  return (
    <div className="inline-form sld-form">
      <select value={b.status} onChange={e => setB({ ...b, status: e.target.value })}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
      {b.status === 'DECIDED' && <select value={b.decided_option} onChange={e => setB({ ...b, decided_option: e.target.value })}><option value="">Option chosen…</option>{r.options.map((o: any) => <option key={o.k} value={o.k}>Option {o.k}</option>)}</select>}
      <input placeholder="Owner" value={b.owner} onChange={e => setB({ ...b, owner: e.target.value })} />
      {b.status !== 'DECIDED' && <input type="date" value={b.due} onChange={e => setB({ ...b, due: e.target.value })} title="Due" />}
      <input placeholder="Decision or status note" value={b.rationale} onChange={e => setB({ ...b, rationale: e.target.value })} style={{ flex: 2, minWidth: 220 }} />
      <button className="btn sm" onClick={async () => {
        try { await api(`/decisions/${r.ord}`, { method: 'PUT', body: { status: b.status, owner: b.owner || null, due: b.status !== 'DECIDED' && b.due ? b.due : null, decided_option: b.status === 'DECIDED' ? b.decided_option || null : null, rationale: b.rationale || null } }); onDone(`Decision #${r.ord} updated`); }
        catch (e: any) { onDone(e.message, false); }
      }}>Save</button>
    </div>
  );
}
