import { useState } from 'react';
import { api } from '../api';
import { Card, ErrorBox, Help, Loading, PhaseChip, ProgramLink, Syn, go, useAsync } from '../ui';
import { HubProposal } from './Ownership';

const KIND_C: Record<string, string> = { FOLLOW_ON: '#27568F', DUPLICATE: '#CE0F3E', RELATED: '#2F7D5C', NOT_RELATED: '#8A8378' };
const Score = ({ s, strong }: { s: number; strong: boolean }) => (
  <span className="ov-score" title={`Similarity ${Math.round(100 * s)}%${strong ? ' (likely overlap)' : ''}`}>
    <span className="mini-track"><span style={{ width: `${Math.round(100 * Math.min(1, s))}%`, background: strong ? '#CE0F3E' : '#C9A961' }} /></span>
    <span className="mono sm">{Math.round(100 * s)}%</span>
  </span>
);
const Why = ({ why, same }: { why: string[]; same?: boolean }) => (
  <span className="ov-why">{same && <span className="ov-same">same effort name</span>}{why.map(w => <span key={w}>{w}</span>)}</span>
);

/** Link or dismiss: the decision form shared by the record card and the Overlaps page. */
function Resolve({ esh, other, onDone }: { esh: string; other: string; onDone: () => void }) {
  const [kind, setKind] = useState('');
  const [dir, setDir] = useState('THIS_CONTINUES');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!kind) return (
    <span className="ov-acts">
      {[['FOLLOW_ON', 'Follow-on'], ['DUPLICATE', 'Duplicate'], ['RELATED', 'Related'], ['NOT_RELATED', 'Not related']].map(([k, l]) =>
        <button key={k} className="chip-btn" style={{ borderColor: KIND_C[k], color: KIND_C[k] }} onClick={e => { e.stopPropagation(); setKind(k); }}>{l}</button>)}
    </span>
  );
  const needNote = kind === 'DUPLICATE' || kind === 'NOT_RELATED';
  return (
    <span className="inline-form" onClick={e => e.stopPropagation()}>
      {kind === 'FOLLOW_ON' && <select value={dir} onChange={e => setDir(e.target.value)}><option value="THIS_CONTINUES">{esh} continues {other}</option><option value="THIS_IS_CONTINUED">{other} continues {esh}</option></select>}
      <input placeholder={needNote ? 'Why (required)' : 'Note (optional)'} value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn sm" onClick={async () => {
        setErr(null);
        try { await api(`/projects/${esh}/links`, { method: 'POST', body: { other, kind, ...(kind === 'FOLLOW_ON' ? { direction: dir } : {}), note: note.trim() || null } }); onDone(); }
        catch (e: any) { setErr(String(e.message)); }
      }}>Save</button>
      <button className="btn sm ghost" onClick={() => setKind('')}>Cancel</button>
      {err && <span className="err sm">{err}</span>}
    </span>
  );
}

/* ── on the project record ── */
export function RelatedWork({ esh }: { esh: string }) {
  const { data: d, error, reload } = useAsync(() => api(`/projects/${esh}/overlaps`), [esh]);
  const [showAll, setShowAll] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return null;
  const open = d.candidates.filter((c: any) => !c.link);
  const shown = showAll ? open : open.slice(0, 4);
  const unlink = async (id: number) => { await api(`/links/${id}`, { method: 'DELETE' }); reload(); };
  if (!d.links.length && !open.length && !d.lineage.length) return null;
  return (
    <Card title={<>Related work <Help title="Related work">Projects whose titles and descriptions cover the same ground, found by the Hub across the whole inventory. Link them (follow-on, duplicate record, related) or dismiss the flag (not related). At Gate 0 the ESF asks for "no disqualifying duplication"; the Hub checks it: likely overlaps must be resolved first.</Help></>}
      right={d.unresolvedStrong.length ? <b style={{ color: 'var(--red)' }}>{d.unresolvedStrong.length} likely overlap{d.unresolvedStrong.length === 1 ? '' : 's'} to resolve</b> : <span className="hint">{d.candidates.length} similar project{d.candidates.length === 1 ? '' : 's'}</span>}>
      {d.lineage.length > 1 && (
        <div className="ov-lineage">
          {d.lineage.map((x: any, i: number) => (
            <span key={x.id} className="ov-step">
              {i > 0 && <span className="ov-arrow">→</span>}
              <a href={'#/p/' + x.esh_id} className={x.esh_id === esh ? 'on' : ''} title={x.title}><b className="mono">{x.esh_id}</b><span>{x.title}</span><PhaseChip p={x} /></a>
            </span>
          ))}
        </div>
      )}
      {d.links.map((l: any) => (
        <div key={l.id} className="ov-link" style={{ borderLeftColor: KIND_C[l.kind] }}>
          <span className="ov-kind" style={{ color: KIND_C[l.kind] }}>{l.role}</span>
          <a href={'#/p/' + l.other.esh_id}><b className="mono">{l.other.esh_id}</b> {l.other.title}</a> <PhaseChip p={l.other} />
          {l.note && <div className="sub">{l.note} · {l.created_by}, {l.created_at} <Syn on={l.synthetic} /></div>}
          {d.canLink && <button className="link" onClick={() => unlink(l.id)}>remove</button>}
        </div>
      ))}
      {open.length > 0 && <div className="lbl" style={{ marginTop: 8 }}>Possible overlaps, not yet reviewed</div>}
      {shown.map((c: any) => (
        <div key={c.id} className={'ov-cand' + (c.strong ? ' strong' : '')}>
          <div className="row">
            <a href={'#/p/' + c.esh_id}><b className="mono">{c.esh_id}</b> {c.title}</a>
            <Score s={c.score} strong={c.strong} />
          </div>
          <div className="sub"><PhaseChip p={c} /> <ProgramLink code={c.program_code} /> · first in FY{c.first_fy ?? '—'} <Why why={c.why} same={c.sameName} /></div>
          {d.canLink && <Resolve esh={esh} other={c.esh_id} onDone={reload} />}
        </div>
      ))}
      {open.length > 4 && <button className="as-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${open.length}`}</button>}
    </Card>
  );
}

/* ── the page ── */
export function Overlaps() {
  const { data: d, error, reload } = useAsync(() => api('/overlaps'), []);
  const [tab, setTab] = useState<'LIVE' | 'PRIOR' | 'RESOLVED'>('LIVE');
  const [strongOnly, setStrongOnly] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '' });
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const T = d.totals;
  const rows = d.pairs.filter((p: any) => (tab === 'RESOLVED' ? !!p.link : !p.link && p.kind === tab) && (!strongOnly || p.strong));
  const runCheck = async () => {
    if (draft.title.trim().length < 3) return;
    setBusy(true);
    try { setCheck(await api('/overlaps/check', { method: 'POST', body: draft })); } finally { setBusy(false); }
  };
  return (
    <div className="home">
      <div className="vhead"><div><h2 className="vt">Overlaps</h2>
        <div className="vsub">Avoiding duplication: check new ideas against everything the portfolio has done, and review the projects whose work overlaps. Similarity is measured on titles and descriptions, including related terms (AR and HoloLens count as one topic).</div></div></div>

      <Card title={<>Before you start something new <HubProposal /></>} right={<span className="hint">checked against all {d.pairs.length ? 'projects' : ''} in the inventory</span>}>
        <div className="ov-check">
          <input placeholder="Working title, e.g. Predictive maintenance for forklifts at distribution centers" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && runCheck()} />
          <textarea rows={2} placeholder="What it would do (optional, improves the match)" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} />
          <button className="btn" onClick={runCheck} disabled={busy || draft.title.trim().length < 3}>{busy ? 'Checking…' : 'Check for overlap'}</button>
        </div>
        {check && (
          <div className="ov-results">
            <div className="sub" style={{ marginBottom: 6 }}>{check.results.filter((r: any) => r.strong).length
              ? <><b style={{ color: 'var(--red)' }}>{check.results.filter((r: any) => r.strong).length} likely overlap{check.results.filter((r: any) => r.strong).length === 1 ? '' : 's'}.</b> Read these before Gate 0: build on them, join them, or say why yours is different.</>
              : check.results.length ? 'No likely duplicate. Related work worth knowing about:' : 'Nothing similar in the portfolio.'}</div>
            {check.results.map((r: any) => (
              <a key={r.esh_id} className={'ov-cand' + (r.strong ? ' strong' : '')} href={'#/p/' + r.esh_id}>
                <div className="row"><span><b className="mono">{r.esh_id}</b> {r.title}</span><Score s={r.score} strong={r.strong} /></div>
                <div className="sub"><PhaseChip p={r} /> <ProgramLink code={r.program_code} /> · first in FY{r.first_fy ?? '—'} <Why why={r.why} same={r.sameName} /></div>
              </a>
            ))}
          </div>
        )}
      </Card>

      <div className="hk-grid fit">
        <div className="hk click" onClick={() => setTab('LIVE')}><span className="hk-l">Overlaps in work now</span><span className="hk-v" style={{ color: T.liveStrong ? 'var(--red)' : undefined }}>{T.liveOpen}</span><span className="hk-s">both projects active, not yet reviewed · {T.liveStrong} likely duplicates</span></div>
        <div className="hk click" onClick={() => setTab('PRIOR')}><span className="hk-l">Prior work to build on</span><span className="hk-v">{T.priorOpen}</span><span className="hk-s">an active project that resembles finished or fielded work</span></div>
        <div className="hk"><span className="hk-l">Across programs</span><span className="hk-v">{T.crossProgram}</span><span className="hk-s">open overlaps between different programs: the ones nobody sees</span></div>
        <div className="hk click" onClick={() => setTab('RESOLVED')}><span className="hk-l">Reviewed</span><span className="hk-v">{Object.values(T.resolved as Record<string, number>).reduce((a, n) => a + n, 0)}</span>
          <span className="hk-s">{T.resolved.FOLLOW_ON} follow-ons · {T.resolved.DUPLICATE} duplicates · {T.resolved.RELATED} related · {T.resolved.NOT_RELATED} dismissed</span></div>
      </div>

      <Card title="Overlapping projects" pad={false} right={<span className="tabs">
        <button className={tab === 'LIVE' ? 'on' : ''} onClick={() => setTab('LIVE')}>In work now {T.liveOpen}</button>
        <button className={tab === 'PRIOR' ? 'on' : ''} onClick={() => setTab('PRIOR')}>Prior work {T.priorOpen}</button>
        <button className={tab === 'RESOLVED' ? 'on' : ''} onClick={() => setTab('RESOLVED')}>Reviewed</button>
        <label className="chk"><input type="checkbox" checked={strongOnly} onChange={e => setStrongOnly(e.target.checked)} /> likely only</label>
      </span>}>
        {rows.slice(0, 120).map((p: any) => (
          <div key={p.key} className={'ov-pair' + (p.strong ? ' strong' : '')}>
            <div className="ov-pp">
              <a href={'#/p/' + p.a.esh_id}><b className="mono">{p.a.esh_id}</b> {p.a.title}<span className="sub"><PhaseChip p={p.a} /> <ProgramLink code={p.a.program_code} /> · FY{p.a.first_fy ?? '—'}</span></a>
              <span className="ov-mid"><Score s={p.score} strong={p.strong} />{p.link && <b style={{ color: KIND_C[p.link.kind] }}>{d.kinds[p.link.kind].l}</b>}</span>
              <a href={'#/p/' + p.b.esh_id}><b className="mono">{p.b.esh_id}</b> {p.b.title}<span className="sub"><PhaseChip p={p.b} /> <ProgramLink code={p.b.program_code} /> · FY{p.b.first_fy ?? '—'}</span></a>
            </div>
            <div className="ov-foot"><Why why={p.why} same={p.sameName} />
              {!p.link && (open === p.key ? <Resolve esh={p.a.esh_id} other={p.b.esh_id} onDone={() => { setOpen(null); reload(); }} /> : <button className="link" onClick={() => setOpen(p.key)}>review</button>)}</div>
          </div>
        ))}
        {!rows.length && <div className="note" style={{ padding: 14 }}>Nothing here.</div>}
        {rows.length > 120 && <div className="note" style={{ padding: 12 }}>Showing the 120 strongest of {rows.length}.</div>}
      </Card>
      <div className="fine" style={{ marginTop: 8 }}>Similarity uses the real titles and descriptions. ◆ Review decisions (links and dismissals) in this demo are synthetic. Checking Gate 0 duplication against the portfolio is a Hub proposal to the ESF.</div>
    </div>
  );
}
