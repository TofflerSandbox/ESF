import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Help, Loading, PH_COL, PH_SHORT, d10, go, useAsync } from '../ui';
import { Brief } from './Brief';

const OUT_COL: Record<string, string> = { PASS: '#2F7D5C', HOLD: '#C9A961', SUNSET: '#CE0F3E', DESCOPE: '#8A8378' };
const OUT_L: Record<string, string> = { PASS: 'Passed', HOLD: 'On hold', SUNSET: 'Sunset', DESCOPE: 'Descoped' };
const fmt = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Gate boards: schedule a board, build its docket from projects that are ready, decide in the meeting, keep minutes and actions. */
export function Boards() {
  const meta = useMeta();
  const { data: d, error, reload } = useAsync(() => api('/boards'), []);
  const [creating, setCreating] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const canRun = meta.me.role === 'ADMIN' || meta.me.role === 'AUTHORITY';
  const upcoming = d.rows.filter((b: any) => b.status === 'SCHEDULED').sort((a: any, b: any) => a.board_date.localeCompare(b.board_date));
  const past = d.rows.filter((b: any) => b.status !== 'SCHEDULED');
  const openActions = d.rows.reduce((a: number, b: any) => a + b.open_actions, 0);

  return (
    <div className="home">
      <div className="vhead">
        <div><h2 className="vt">Gate boards</h2>
          <div className="vsub">How gates are actually run: each board has a date, a decision authority, and a docket of projects ready for a decision. Decisions recorded here go straight onto each project's record with every gate rule enforced.</div></div>
        {canRun && <button className="btn" onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : '+ Schedule a board'}</button>}
      </div>
      {creating && <NewBoard onDone={(id: number) => { setCreating(false); reload(); go('#/boards/' + id); }} />}

      <div className="hk-grid">
        <div className="hk"><span className="hk-l">Next board</span><span className="hk-v" style={{ fontSize: 22 }}>{upcoming[0] ? fmt(upcoming[0].board_date) : '—'}</span><span className="hk-s">{upcoming[0]?.title ?? 'None scheduled'}</span></div>
        <div className="hk"><span className="hk-l">On the next dockets</span><span className="hk-v">{upcoming.reduce((a: number, b: any) => a + b.items, 0)}</span><span className="hk-s">projects across {upcoming.length} scheduled board{upcoming.length === 1 ? '' : 's'}</span></div>
        <div className="hk"><span className="hk-l">Boards held, last 6 months</span><span className="hk-v">{past.length}</span><span className="hk-s">{past.reduce((a: number, b: any) => a + b.decided, 0)} decisions recorded</span></div>
        <div className="hk"><span className="hk-l">Open actions</span><span className="hk-v" style={{ color: openActions ? 'var(--goldD)' : undefined }}>{openActions}</span><span className="hk-s">Assigned at boards, not yet closed</span></div>
      </div>
      <div className="fine dm">Boards held before today, and their minutes and actions, are synthetic.</div>

      <Card title="Scheduled" pad={false}>
        {upcoming.length === 0 && <div className="note" style={{ padding: 14 }}>No boards scheduled.</div>}
        {upcoming.map((b: any) => <BoardRow key={b.id} b={b} />)}
      </Card>
      <Card title="Held" pad={false}>
        {past.map((b: any) => <BoardRow key={b.id} b={b} />)}
      </Card>
    </div>
  );
}

function BoardRow({ b }: { b: any }) {
  return (
    <div className="board-row" onClick={() => go('#/boards/' + b.id)}>
      <span className="bdate"><b>{new Date(b.board_date.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</b><span>{b.board_date.slice(0, 4)}</span></span>
      <span style={{ flex: 1 }}><b>{b.title}</b><br /><span className="sub">{b.authority}{b.location ? ` · ${b.location}` : ''}</span></span>
      <span className="bstat">{b.status === 'SCHEDULED' ? <><b>{b.items}</b> on the docket</> :
        <>{Object.entries(b.outcomes ?? {}).map(([o, n]) => <span key={o} className="opill" style={{ background: OUT_COL[o] }}>{n as number} {OUT_L[o].toLowerCase()}</span>)}</>}
        {b.open_actions > 0 && <span className="sub"> · {b.open_actions} open action{b.open_actions === 1 ? '' : 's'}</span>}</span>
    </div>
  );
}

function NewBoard({ onDone }: { onDone: (id: number) => void }) {
  const [b, setB] = useState({ title: 'J68 Portfolio Review Board', board_date: '', authority: 'J68 Director', location: 'J68 conference room / Teams', gates: [0, 1, 2] as number[] });
  const [err, setErr] = useState<string | null>(null);
  const preset = (kind: 'J68' | 'DCG') => setB(kind === 'J68' ? { ...b, title: 'J68 Portfolio Review Board', authority: 'J68 Director', gates: [0, 1, 2] } : { ...b, title: 'DCG Senior Investment Review', authority: 'Gate Authority (DCG)', location: 'HQ DLA', gates: [3, 4] });
  return (
    <Card title="Schedule a board">
      {err && <div className="banner err">{err}</div>}
      <div className="form">
        <div className="tabs"><button onClick={() => preset('J68')}>J68 board (Gates 0–2)</button><button onClick={() => preset('DCG')}>DCG board (Gates 3–4)</button></div>
        <input placeholder="Title" value={b.title} onChange={e => setB({ ...b, title: e.target.value })} />
        <input type="date" value={b.board_date} onChange={e => setB({ ...b, board_date: e.target.value })} />
        <input placeholder="Decision authority" value={b.authority} onChange={e => setB({ ...b, authority: e.target.value })} />
        <input placeholder="Location" value={b.location} onChange={e => setB({ ...b, location: e.target.value })} />
        <div className="chk-row">Gates on this board: {[0, 1, 2, 3, 4].map(g => <label key={g} className="chk"><input type="checkbox" checked={b.gates.includes(g)} onChange={e => setB({ ...b, gates: e.target.checked ? [...b.gates, g].sort() : b.gates.filter(x => x !== g) })} /> Gate {g}</label>)}</div>
        <div><button className="btn sm" disabled={!b.board_date} onClick={async () => { try { const r = await api<any>('/boards', { method: 'POST', body: b }); onDone(r.id); } catch (e: any) { setErr(e.message); } }}>Schedule and build docket</button></div>
        <div className="note">The docket fills automatically with every project that is ready for a decision at the gates you pick. You can add or remove projects afterwards.</div>
      </div>
    </Card>
  );
}

/** One board: docket, in-meeting decisions, minutes and actions. */
export function Board({ id }: { id: number }) {
  const { data: d, error, reload } = useAsync(() => api(`/boards/${id}`), [id]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [act, setAct] = useState({ text: '', owner: '', due: '' });
  if (error) return <><a className="bk" href="#/boards">← Gate boards</a><ErrorBox msg={error} /></>;
  if (!d) return <Loading />;
  const b = d.board, run = d.canRun;
  const call = async (fn: () => Promise<any>, ok: string) => { try { await fn(); setMsg({ ok: true, t: ok }); reload(); return true; } catch (e: any) { setMsg({ ok: false, t: e.message }); return false; } };
  const decided = d.items.filter((i: any) => i.outcome).length;

  return (
    <div className="home">
      <a className="bk" href="#/boards">← Gate boards</a>
      <div className="vhead">
        <div><div className="crumb">{b.status === 'SCHEDULED' ? 'Scheduled' : b.status === 'HELD' ? 'Held' : 'Cancelled'} · {fmt(b.board_date)}</div>
          <h2 className="vt">{b.title}</h2>
          <div className="vsub">Decision authority: <b>{b.authority}</b>{b.location ? ` · ${b.location}` : ''} · {d.items.length} on the docket · {decided} decided</div></div>
        <span className="pm-actions">
          <a className="btn ghost" href={`#/boards/${id}/book`}>Briefing book (print)</a>
          {run && b.status === 'SCHEDULED' && <button className="btn" onClick={() => call(() => api(`/boards/${id}`, { method: 'PUT', body: { status: 'HELD' } }), 'Board marked as held')}>Mark as held</button>}
        </span>
      </div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'err')} onClick={() => setMsg(null)}>{msg.t}</div>}

      <Card title={<>Docket <Help title="The docket">Projects coming before this board, in order. Each shows its gate and how many of that gate's criteria are closed. In the meeting, record the decision on each line — the same rules apply as on the project page: a PASS needs every criterion closed, and a stop needs a reason.</Help></>} pad={false}>
        {d.items.length === 0 && <div className="note" style={{ padding: 14 }}>Nothing on the docket.</div>}
        {d.items.map((it: any) => <DocketItem key={it.esh_id} it={it} run={run && b.status !== 'CANCELLED'} boardId={id} exitReasons={d.exitReasons} onDone={(t: string, ok = true) => { setMsg({ ok, t }); if (ok) reload(); }} />)}
        {run && b.status === 'SCHEDULED' && d.candidates.length > 0 && (
          <div className="dock-add"><span className="sub">Also ready for a decision:</span>
            {d.candidates.slice(0, 12).map((c: any) => <button key={c.esh_id} className="chip-btn" onClick={() => call(() => api(`/boards/${id}/items`, { method: 'POST', body: { esh: c.esh_id } }), 'Added to the docket')}>+ G{c.gate} {c.title.slice(0, 40)}</button>)}</div>
        )}
      </Card>

      <div className="grid2">
        <Card title="Minutes">
          {run ? (<>
            <textarea rows={7} value={minutes ?? b.minutes ?? ''} onChange={e => setMinutes(e.target.value)} placeholder="Record discussion, decisions and direction…" />
            <div style={{ marginTop: 8 }}><button className="btn sm" disabled={minutes == null} onClick={() => call(() => api(`/boards/${id}`, { method: 'PUT', body: { minutes: minutes ?? '' } }), 'Minutes saved').then(() => setMinutes(null))}>Save minutes</button></div>
          </>) : <p className="pm-body">{b.minutes ?? 'No minutes recorded.'}</p>}
        </Card>
        <Card title="Actions" pad={false}>
          {d.actions.map((a: any) => (
            <div key={a.id} className="dec">
              <input type="checkbox" checked={a.done} disabled={!run} onChange={e => call(() => api(`/boards/actions/${a.id}`, { method: 'PUT', body: { done: e.target.checked } }), e.target.checked ? 'Action closed' : 'Action reopened')} />
              <span className="dec-b" style={{ textDecoration: a.done ? 'line-through' : undefined, opacity: a.done ? 0.6 : 1 }}>
                <span><b>{a.text}</b></span><span className="sub">{a.owner}{a.due ? ` · due ${d10(a.due)}` : ''}{a.title ? ` · ${a.title}` : ''}</span></span>
            </div>
          ))}
          {d.actions.length === 0 && <div className="note" style={{ padding: 14 }}>No actions.</div>}
          {run && <div className="inline-form" style={{ padding: '10px 16px' }}>
            <input placeholder="Action" value={act.text} onChange={e => setAct({ ...act, text: e.target.value })} style={{ flex: 2 }} />
            <input placeholder="Owner" value={act.owner} onChange={e => setAct({ ...act, owner: e.target.value })} />
            <input type="date" value={act.due} onChange={e => setAct({ ...act, due: e.target.value })} />
            <button className="btn sm" disabled={!act.text || !act.owner} onClick={() => call(() => api(`/boards/${id}/actions`, { method: 'POST', body: { text: act.text, owner: act.owner, ...(act.due ? { due: act.due } : {}) } }), 'Action added').then(ok => ok && setAct({ text: '', owner: '', due: '' }))}>Add</button>
          </div>}
        </Card>
      </div>
    </div>
  );
}

function DocketItem({ it, run, boardId, exitReasons, onDone }: { it: any; run: boolean; boardId: number; exitReasons: Record<string, string>; onDone: (t: string, ok?: boolean) => void }) {
  const [outcome, setOutcome] = useState(it.ready ? 'PASS' : 'HOLD');
  const [rationale, setRationale] = useState('');
  const [reason, setReason] = useState('');
  const [tech, setTech] = useState('');
  const stop = outcome === 'SUNSET' || outcome === 'DESCOPE';
  const ph = it.gate;
  return (
    <div className="dock">
      <span className="dock-n">{it.ord}</span>
      <span className="tag" style={{ color: '#fff', background: PH_COL[ph] }}>G{it.gate}</span>
      <span className="dock-b">
        <a href={'#/p/' + it.esh_id}><b>{it.title}</b></a>
        <span className="sub">{it.esh_id} · {PH_SHORT[ph]} → {PH_SHORT[ph + 1] ?? 'Scale'} · {it.sponsor ?? 'No sponsor'} · PM {it.pm ?? '—'} · criteria {it.done}/{it.total}{it.ready ? ' · ready' : ''}</span>
        {it.outcome ? <span className="sub"><span className="opill" style={{ background: OUT_COL[it.outcome] }}>{OUT_L[it.outcome]}</span> {it.note}</span>
          : run && it.esf_source === 'CONFIRMED' && ['ACTIVE', 'HOLD'].includes(it.esf_status) && (
            <span className="inline-form">
              <select value={outcome} onChange={e => setOutcome(e.target.value)}>{['PASS', 'HOLD', 'SUNSET', 'DESCOPE'].map(o => <option key={o} value={o}>{OUT_L[o]}</option>)}</select>
              {stop && <select value={reason} onChange={e => setReason(e.target.value)}><option value="">Why it stopped…</option>{Object.entries(exitReasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
              {stop && <select value={tech} onChange={e => setTech(e.target.value)}><option value="">Did it work?…</option><option value="MET">Worked technically</option><option value="PARTIAL">Partly worked</option><option value="NOT_MET">Did not work</option></select>}
              <input placeholder="Rationale (required)" value={rationale} onChange={e => setRationale(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <button className="btn sm" onClick={async () => {
                try { await api(`/boards/${boardId}/decide`, { method: 'POST', body: { esh: it.esh_id, outcome, rationale, ...(stop ? { exit_reason: reason || undefined, technical_result: tech || undefined } : {}) } }); onDone(`${it.title}: ${OUT_L[outcome].toLowerCase()} recorded`); }
                catch (e: any) { onDone(e.message, false); }
              }}>Record</button>
              {!it.outcome && <button className="link" onClick={async () => { await api(`/boards/${boardId}/items/${it.esh_id}`, { method: 'DELETE' }); onDone('Removed from the docket'); }}>remove</button>}
            </span>
          )}
      </span>
    </div>
  );
}

/** Printable briefing book: a cover page and every project's decision brief, in docket order. */
export function BoardBook({ id }: { id: number }) {
  const { data: d, error } = useAsync(() => api(`/boards/${id}`), [id]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  return (
    <div className="book">
      <div className="no-print" style={{ marginBottom: 12 }}><a className="bk" href={`#/boards/${id}`}>← Back to the board</a> <button className="btn sm" onClick={() => window.print()}>Print / save as PDF</button></div>
      <div className="book-cover">
        <div className="mark-inline">PRE-DECISIONAL // DELIBERATIVE // DRAFT — INTERNAL DLA USE ONLY</div>
        <h1>{d.board.title}</h1>
        <p>{fmt(d.board.board_date)} · {d.board.authority}{d.board.location ? ` · ${d.board.location}` : ''}</p>
        <h3>Docket</h3>
        <ol>{d.items.map((it: any) => <li key={it.esh_id}>Gate {it.gate} — {it.title} ({it.esh_id}) · criteria {it.done}/{it.total}</li>)}</ol>
      </div>
      {d.items.map((it: any) => <div key={it.esh_id} className="book-page"><Brief esh={it.esh_id} /></div>)}
    </div>
  );
}
