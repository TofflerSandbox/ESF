import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './icons';

export type PaletteItem = { kind: 'Page' | 'Project' | 'Program' | 'Organization'; label: string; sub?: string; href: string; icon?: string; keys: string };
type Pages = { label: string; href: string; icon: string; group: string }[];

const KIND_IC: Record<string, string> = { Project: 'list', Program: 'layers', Organization: 'building' };
let cache: PaletteItem[] | null = null;   // projects and organizations, loaded the first time the palette opens

/** Ctrl+K / ⌘K: jump to any page, project, program or organization. Arrow keys move, Enter opens, Esc closes. */
export function Palette({ pages, programs }: { pages: Pages; programs: { code: string; name: string; n: number }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [data, setData] = useState<PaletteItem[] | null>(cache);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
      else if (e.key === '/' && !open && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    addEventListener('keydown', onKey); addEventListener('esh:palette', onOpen);
    return () => { removeEventListener('keydown', onKey); removeEventListener('esh:palette', onOpen); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0);
    if (!cache) Promise.all([api<any>('/projects'), api<any>('/orgs')]).then(([p, o]) => {
      cache = [
        ...p.rows.map((r: any): PaletteItem => ({ kind: 'Project', label: r.title, sub: `${r.esh_id}${r.program_code ? ' · ' + r.program_code : ''}${r.esf_status === 'AT_SCALE' ? ' · at scale' : r.esf_status === 'SUNSET' || r.esf_status === 'DESCOPED' ? ' · exited' : ''}`,
          href: '#/p/' + r.esh_id, keys: `${r.title} ${r.esh_id} ${r.program_code ?? ''} ${r.sponsors ?? ''}`.toLowerCase() })),
        ...o.rows.map((r: any): PaletteItem => ({ kind: 'Organization', label: r.name, sub: `${r.n} project${r.n === 1 ? '' : 's'}`, href: '#/org/' + r.id, keys: r.name.toLowerCase() })),
      ];
      setData(cache);
    }).catch(() => setData([]));
  }, [open]);

  const results = useMemo(() => {
    const base: PaletteItem[] = [
      ...pages.map(p => ({ kind: 'Page' as const, label: p.label, sub: p.group, href: p.href, icon: p.icon, keys: `${p.label} ${p.group}`.toLowerCase() })),
      ...programs.map(p => ({ kind: 'Program' as const, label: `${p.code} · ${p.name}`, sub: `${p.n} project${p.n === 1 ? '' : 's'}`, href: '#/program/' + p.code, keys: `${p.code} ${p.name}`.toLowerCase() })),
      ...(data ?? []),
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return base.filter(b => b.kind === 'Page').slice(0, 12);
    // rank: label starts with the query, then whole-word matches, then anywhere; pages first on ties
    const score = (b: PaletteItem) => {
      const l = b.label.toLowerCase(), qq = terms.join(' ');
      return (l.startsWith(qq) ? 0 : l.includes(qq) ? 1 : 2) * 10 + ({ Page: 0, Program: 1, Project: 2, Organization: 3 }[b.kind]);
    };
    return base.filter(b => terms.every(t => b.keys.includes(t))).sort((a, b) => score(a) - score(b)).slice(0, 40);
  }, [q, data, pages, programs]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!open) return null;

  const go = (it?: PaletteItem) => { if (!it) return; setOpen(false); location.hash = it.href; };
  return (
    <div className="pal-back" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="pal" role="dialog" aria-label="Search the Hub">
        <div className="pal-in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects, programs, organizations and pages…" aria-label="Search"
            onKeyDown={e => {
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') go(results[sel]);
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul className="pal-list" ref={list} role="listbox">
          {results.map((it, i) => (
            <li key={it.kind + it.href} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
              <span className="pal-ic"><Icon n={it.icon ?? KIND_IC[it.kind] ?? 'grid'} /></span>
              <span className="pal-l">{it.label}{it.sub && <span className="pal-s">{it.sub}</span>}</span>
              <span className="pal-k">{it.kind}</span>
            </li>
          ))}
          {!results.length && <li className="pal-none">{data ? 'No matches.' : 'Loading the portfolio…'}</li>}
        </ul>
        <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> or <kbd>/</kbd> anywhere</span></div>
      </div>
    </div>
  );
}
