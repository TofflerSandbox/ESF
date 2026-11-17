import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { EL_COL, PhaseChip, ProgramLink } from '../ui';

type Hit = {
  esh_id: string; title: string; program_code: string | null; program_name: string; element_code: string | null;
  esf_phase: number | null; esf_status: string | null; esf_source: string | null; strength: 'strong' | 'related' | 'match';
  matched: string[]; where: string[]; snippet: string; sponsors: string | null;
};
type Reply = { q: string; answer: string; filters: string[]; concepts: string[]; total: number; strong: number; results: Hit[]; ids: string[]; hl: string[] };
type Turn = { q: string; r?: Reply; err?: string };

const EXAMPLES = [
  'Is there anything in the portfolio that deals with augmented reality?',
  'What have we done for inventory management?',
  'Additive manufacturing projects in Phase II',
  'Anything on counterfeit parts?',
  'Which energy projects reached scale?',
  'What did we exit in warehouse automation?',
];

/** Highlights the words that made a project match (stems, so "track" lights up "tracking"). */
function Hl({ text, words }: { text: string; words: string[] }) {
  if (!words.length || !text) return <>{text}</>;
  const pat = words.map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean).sort((a, b) => b.length - a.length)
    .map(w => (w.length <= 3 ? `${w}s?` : `${w}\\w*`)).join('|');
  const re = new RegExp(`\\b(${pat})\\b`, 'gi');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export function AssistPanel({ onShow, onClose }: { onShow: (ids: string[], label: string) => void; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem('esh.assist') ?? '[]'); } catch { return []; } });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<Record<number, boolean>>({});
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem('esh.assist', JSON.stringify(turns.slice(-8))); } catch { /* storage unavailable */ } end.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  const ask = async (text: string) => {
    const s = text.trim(); if (!s || busy) return;
    setQ(''); setBusy(true);
    setTurns(t => [...t, { q: s }]);
    try {
      const r = await api<Reply>('/assist', { method: 'POST', body: { q: s } });
      setTurns(t => t.map((x, i) => (i === t.length - 1 ? { ...x, r } : x)));
    } catch (e: any) {
      setTurns(t => t.map((x, i) => (i === t.length - 1 ? { ...x, err: String(e.message) } : x)));
    } finally { setBusy(false); }
  };

  return (
    <aside className="assist" aria-label="Ask the portfolio">
      <div className="as-head">
        <div>
          <b>Ask the portfolio</b>
          <small>Ask in plain English. Searches titles, descriptions, programs, priorities and partners, including related terms.</small>
        </div>
        <button className="as-x" onClick={onClose} title="Hide the assistant" aria-label="Hide the assistant">⟩</button>
      </div>

      <div className="as-body">
        {!turns.length && (
          <div className="as-empty">
            <p>Try one of these:</p>
            {EXAMPLES.map(x => <button key={x} className="as-ex" onClick={() => ask(x)}>{x}</button>)}
          </div>
        )}
        {turns.map((t, i) => {
          const r = t.r;
          const shown = r ? (more[i] ? r.results : r.results.slice(0, 6)) : [];
          return (
            <div key={i} className="as-turn">
              <div className="as-q">{t.q}</div>
              {t.err && <div className="as-a err">{t.err}</div>}
              {!r && !t.err && <div className="as-a muted">Searching the portfolio…</div>}
              {r && (
                <div className="as-a">
                  <p>{r.answer}</p>
                  {(r.concepts.length > 0 || r.filters.length > 0) && (
                    <div className="as-tags">
                      {r.concepts.map(c => <span key={c} className="as-tag" title="Related terms were included in the search">≈ {c}</span>)}
                      {r.filters.map(c => <span key={c} className="as-tag f">{c}</span>)}
                    </div>
                  )}
                  {shown.map(h => (
                    <a key={h.esh_id} className={'as-hit ' + h.strength} href={'#/p/' + h.esh_id}>
                      <span className="as-hit-top">
                        <span className="mono code">{h.esh_id}</span>
                        <PhaseChip p={h} />
                        {h.program_code && <ProgramLink code={h.program_code} name={h.program_name} el={h.element_code} />}
                        {h.strength === 'related' && <span className="as-rel">related</span>}
                      </span>
                      <span className="as-ttl"><Hl text={h.title} words={r.hl} /></span>
                      {h.snippet && <span className="as-snip"><Hl text={h.snippet} words={r.hl} /></span>}
                      {h.matched.length > 0 && <span className="as-why">Matched {h.matched.map(m => `“${m}”`).join(', ')}{h.where.length ? ` in ${h.where.join(', ')}` : ''}</span>}
                    </a>
                  ))}
                  {r.results.length > 6 && <button className="as-link" onClick={() => setMore(m => ({ ...m, [i]: !m[i] }))}>{more[i] ? 'Show fewer' : `Show all ${r.results.length} here`}</button>}
                  {r.total > 0 && <button className="as-show" onClick={() => onShow(r.ids, t.q)}>Show {r.total === 1 ? 'it' : `these ${r.total}`} in the table →</button>}
                </div>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form className="as-in" onSubmit={e => { e.preventDefault(); ask(q); }}>
        <textarea rows={2} value={q} placeholder="e.g. What have we done for inventory management?" onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
        <div className="as-foot">
          <small title="The search runs on this machine. No project data is sent to an outside service.">Runs locally · no data leaves this machine</small>
          {turns.length > 0 && <button type="button" className="as-link" onClick={() => setTurns([])}>Clear</button>}
          <button type="submit" disabled={busy || !q.trim()}>Ask</button>
        </div>
      </form>
    </aside>
  );
}
