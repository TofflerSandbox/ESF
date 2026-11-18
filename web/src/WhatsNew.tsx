import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { d10 } from './ui';

type Change = { kind: string; at: string; esh_id: string | null; title: string; what: string; by: string | null; href: string; tone?: 'warn' | 'good' };
type Changes = { since: string; first: boolean; total: number; scope: string; kinds: Record<string, string>; kinds1: Record<string, string>; counts: Record<string, number>; projects: string[]; items: Change[] };
type Ctx = { data: Changes | null; fresh: Set<string>; markSeen: () => void };

const ChangesCtx = createContext<Ctx>({ data: null, fresh: new Set(), markSeen: () => {} });
/** Projects that changed since the user's last visit (for "Updated" marks in lists). */
export const useFresh = () => useContext(ChangesCtx).fresh;
/** A small "updated since your last visit" dot for list rows. */
export const FreshDot = ({ esh }: { esh: string }) => (useFresh().has(esh) ? <span className="fresh-dot" title="Updated since your last visit" aria-label="Updated since your last visit" /> : null);

/** Loads the user's changes once per visit and shares them with the page. */
export function ChangesProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const [data, setData] = useState<Changes | null>(null);
  useEffect(() => { setData(null); api<Changes>('/me/changes').then(setData).catch(() => setData(null)); }, [userId]);
  const markSeen = () => { api('/me/seen', { method: 'POST' }).then(() => setData(d => (d ? { ...d, total: 0, items: [], projects: [], counts: {}, since: new Date().toISOString(), first: false } : d))); };
  return <ChangesCtx.Provider value={{ data, fresh: new Set(data?.projects ?? []), markSeen }}>{children}</ChangesCtx.Provider>;
}

const dayLabel = (iso: string) => {
  const d = iso.slice(0, 10), t = new Date(), y = new Date(t.getTime() - 864e5);
  return d === t.toISOString().slice(0, 10) ? 'Today' : d === y.toISOString().slice(0, 10) ? 'Yesterday' : d10(d);
};

/** The top-bar button and its panel. */
export function WhatsNew() {
  const { data, markSeen } = useContext(ChangesCtx);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!data) return null;
  const items = data.items.filter(c => !kind || c.kind === kind);
  const days: [string, Change[]][] = [];
  for (const c of items) { const k = dayLabel(c.at); const last = days[days.length - 1]; if (last && last[0] === k) last[1].push(c); else days.push([k, [c]]); }
  const sinceL = data.first ? 'in the last two weeks' : `since your last visit, ${d10(data.since)}`;
  return (
    <div className="wn" ref={ref}>
      <button className={'wn-btn' + (data.total ? ' has' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`What's new: ${data.total} changes`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        What's new{data.total > 0 && <span className="wn-n">{data.total > 99 ? '99+' : data.total}</span>}
      </button>
      {open && (
        <div className="wn-pop" role="dialog" aria-label="What's new">
          <div className="wn-h">
            <div><b>What's new</b><span>{data.total ? `${data.total} change${data.total === 1 ? '' : 's'} to ${data.scope} ${sinceL}` : `Nothing new ${sinceL}`}</span></div>
            {data.total > 0 && <button className="linkbtn" onClick={() => { markSeen(); setKind(null); }}>Mark all as seen</button>}
          </div>
          {data.total > 0 && (
            <div className="wn-k">
              <button className={!kind ? 'on' : ''} onClick={() => setKind(null)}>All <b>{data.total}</b></button>
              {Object.entries(data.counts).map(([k, n]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(kind === k ? null : k)}>{data.kinds[k]} <b>{n}</b></button>)}
            </div>
          )}
          <div className="wn-list">
            {days.map(([day, cs]) => (
              <div key={day}>
                <div className="wn-day">{day}</div>
                {cs.map((c, i) => (
                  <a key={i} className={'wn-i ' + (c.tone ?? '')} href={c.href} onClick={() => setOpen(false)}>
                    <span className="wn-dot" aria-hidden="true" />
                    <span className="wn-m"><span className="wn-t">{c.title}</span><span className="wn-w">{c.esh_id && <span className="mono">{c.esh_id} · </span>}{c.what}{c.by ? <span className="muted"> · {c.by}</span> : null}</span></span>
                  </a>
                ))}
              </div>
            ))}
            {!data.total && <div className="wn-empty">You're up to date. Changes others make to {data.scope} will show here.</div>}
            {data.total > data.items.length && !kind && <div className="wn-more">Showing the latest {data.items.length} of {data.total}.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** A compact strip for the top of My work: what changed, by kind, with a link into the panel. */
export function WhatsNewStrip() {
  const { data } = useContext(ChangesCtx);
  if (!data || !data.total) return null;
  const parts = Object.entries(data.counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} ${(n === 1 ? data.kinds1[k] : data.kinds[k]).toLowerCase()}`);
  return (
    <div className="wn-strip">
      <b>{data.first ? 'In the last two weeks' : `Since your last visit (${d10(data.since)})`}:</b> {parts.join(' · ')}
      <button className="linkbtn" onClick={() => (document.querySelector('.wn-btn') as HTMLButtonElement | null)?.click()}>See what changed →</button>
    </div>
  );
}
