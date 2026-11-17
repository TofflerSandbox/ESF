import { useEffect, useState, type ReactNode } from 'react';

export const PH_COL = ['#002060', '#3F90CB', '#3F90CB', '#CE0F3E', '#CE0F3E', '#F9B018'];
export const PH_TXT = ['#002060', '#2E7CB7', '#2E7CB7', '#B30D36', '#B30D36', '#B07607'];
export const PH_SHORT = ['Stage 0', 'Phase I', 'Phase II', 'Phase III', 'Phase IV', 'Stage 5'];
export const PH_NAME = ['Intake', 'Feasibility', 'Prototype', 'Ltd Deployment', 'Transition', 'At Scale'];
export const STATUS: Record<string, string> = { A: 'New Start', B: 'Ongoing', C: 'Monitoring', D: 'Completing / Cancelling', E: 'Complete' };
export const STATUS_COL: Record<string, string> = { A: '#2F7D5C', B: '#27568F', C: '#8A6B25', D: '#9B1B2E', E: '#8A9099', '?': '#CFCBBF' };
export const EL_COL: Record<string, string> = { 'LOG R&D': '#27568F', MANTECH: '#8A6B25', SBIR: '#2F7D5C' };
export const VP: Record<string, { l: string; c: string }> = {
  REVENUE: { l: '↑ Revenue', c: '#2F7D5C' }, RISK: { l: '↓ Risk', c: '#8A6B25' }, COST: { l: '↓ Cost', c: '#27568F' }, PERFORMANCE: { l: '↑ Performance', c: '#16233C' },
};

export const d10 = (s?: string | null) => (s ? String(s).slice(0, 10) : '—');
export const fmtMY = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const money = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  // fewer digits as amounts grow: $1.25M, $12.5M, $311M, $1.21B
  return n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e8 ? '$' + Math.round(n / 1e6) + 'M' : n >= 1e7 ? '$' + (n / 1e6).toFixed(1) + 'M'
    : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : '$' + Math.round(n / 1e3) + 'K';
};
export const go = (h: string) => { location.hash = h; };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then(d => live && setData(d)).catch(e => live && setError(String(e.message ?? e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN(x => x + 1) };
}

export const Chip = ({ c, bg, children, title }: { c: string; bg?: string; children: ReactNode; title?: string }) => (
  <span className="chip" title={title} style={{ color: c, background: bg ?? c + '14' }}>{children}</span>
);

export function PhaseChip({ p }: { p: { esf_phase: number | null; esf_status: string | null; esf_source?: string | null } }) {
  if (p.esf_status === 'SUNSET') return <Chip c="var(--red)" bg="var(--redBg)">SUNSET · {PH_SHORT[p.esf_phase ?? 0]}</Chip>;
  if (p.esf_status === 'DESCOPED') return <Chip c="var(--slate)" bg="#EDEBE4">DESCOPED</Chip>;
  const ph = p.esf_phase ?? 0;
  return (
    <span className="chip" style={{ background: PH_COL[ph] + '14', color: PH_TXT[ph], outline: p.esf_source === 'SUGGESTED' ? `1px dashed ${PH_COL[ph]}88` : undefined }}
      title={p.esf_source === 'SUGGESTED' ? 'Suggested from workbook data — not yet confirmed' : 'Confirmed'}>
      <i style={{ background: PH_COL[ph] }} />{PH_SHORT[ph]}{p.esf_status === 'HOLD' ? ' · HOLD' : ''}{p.esf_source === 'SUGGESTED' ? ' ?' : ''}
    </span>
  );
}

/** A small "?" next to a section title that opens a short primer. Closes on outside click or Escape. */
export function Help({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.help')) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span className="help">
      <button type="button" className="help-q" aria-label={`What is “${title}”?`} aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(!open); }}>?</button>
      {open && <span className="help-pop" role="dialog" aria-label={title}><b>{title}</b>{children}</span>}
    </span>
  );
}

/** Every organization name links to its organization page. Stops the click reaching a clickable row or card underneath. */
export const OrgLink = ({ id, name, chip = false }: { id: number; name: string; chip?: boolean }) => (
  <a className={chip ? 'org' : 'orglink'} href={'#/org/' + id} onClick={e => e.stopPropagation()} title={`Open ${name}`}>{name}</a>
);
/** A program code that opens the program's page (stops the click reaching a clickable row). */
export const ProgramLink = ({ code, name, el, full = false }: { code: string | null | undefined; name?: string; el?: string | null; full?: boolean }) =>
  code ? <a className="proglink" href={'#/program/' + code} onClick={e => e.stopPropagation()} title={name ? `${name}: open the program page` : 'Open the program page'}
    style={el ? { color: EL_COL[el] ?? undefined } : undefined}>{code}{full && name ? <span className="proglink-n"> {name}</span> : null}</a> : <span className="muted">—</span>;
export const OrgList =({ list }: { list?: { id: number; name: string }[] | null }) =>
  list?.length ? <>{list.map((o, i) => <span key={o.id}>{i > 0 && ' · '}<OrgLink id={o.id} name={o.name} /></span>)}</> : <span className="muted">—</span>;
export const ORG_KIND: Record<string, string> = { DLA_MSC: 'DLA major subordinate command', DLA_JCODE: 'DLA J-code', SERVICE: 'Military service', ACADEMIA: 'Academia', INDUSTRY: 'Industry', OSD: 'OSD', OTHER: 'Other' };
export const ROLE_LABEL: Record<string, string> = { SPONSOR: 'Sponsor', CO_SPONSOR: 'Co-sponsor', STAKEHOLDER: 'Stakeholder', TRANSITION_PARTNER: 'Transition partner', ACADEMIA: 'Academic partner', MILITARY: 'Military partner', OSD_MII: 'OSD MII', VENDOR: 'Vendor' };

/** People counts under 10 are suppressed (J1 data-sharing rule, hypothesis). */
export const sup = (n: number | null | undefined) => (n == null ? '—' : n < 10 ? '<10' : n.toLocaleString('en-US'));
export const SCORE_COL = ['', '#B3261E', '#D9822B', '#C9A961', '#6BA37E', '#2F7D5C'];

/** Marks a row generated by `npm run synth` (demo data, not from the workbook or a real user action). */
export const Syn = ({ on = true }: { on?: boolean }) => (on ? <span className="syn" title="Synthetic demo data — generated by npm run synth, not reported by DLA">SYNTHETIC</span> : null);

export const StatusChip =({ s }: { s: string | null }) => <Chip c={STATUS_COL[s ?? '?']}>{s ? `${s} · ${STATUS[s]}` : 'No status'}</Chip>;

export function Locator({ phase, status, w = 230 }: { phase: number | null; status: string | null; w?: number }) {
  const segW = (w - 30) / 6, h = 10, y = 6, reach = status === 'AT_SCALE' ? 5 : phase ?? 0;
  const els: ReactNode[] = [];
  for (let i = 0; i < 6; i++) els.push(<rect key={i} x={i * (segW + 5)} y={y} width={segW} height={h} rx={2} fill={i <= reach ? PH_COL[i] : '#E7E4DC'} />);
  if (status === 'ACTIVE' || status === 'HOLD') {
    const cx = (Math.min(reach, 4) + 1) * (segW + 5) - 2.5, cy = y + h / 2;
    els.push(<rect key="d" x={cx - 6} y={cy - 6} width={12} height={12} transform={`rotate(45 ${cx} ${cy})`} fill="#C9A961" stroke="#fff" strokeWidth={1.5} />);
  }
  if (status === 'SUNSET' || status === 'DESCOPED') {
    const cx = (reach + 1) * (segW + 5) - 2.5;
    els.push(<text key="x" x={cx} y={y + h / 2 + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--red)">✕</text>);
  }
  return <svg viewBox={`0 0 ${w} 24`} width={w} height={24} aria-hidden="true">{els}</svg>;
}

export function Bars({ items, h = 190, fmt = (v: number) => String(v) }: { items: { l: string; v: number; c: string; sub?: string; onClick?: () => void }[]; h?: number; fmt?: (v: number) => string }) {
  const w = 560, pad = 10, max = Math.max(...items.map(i => i.v), 1), bw = (w - pad) / Math.max(items.length, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      {[1, 2, 3].map(i => { const yy = h - 30 - (h - 50) * i / 3; return <line key={i} x1={pad} y1={yy} x2={w} y2={yy} stroke="#E7E4DC" />; })}
      {items.map((it, i) => {
        const bh = (h - 50) * it.v / max, x = pad + i * bw + bw * 0.16, y = h - 30 - bh;
        return (
          <g key={i} onClick={it.onClick} style={{ cursor: it.onClick ? 'pointer' : undefined }}>
            <rect x={x} y={y} width={bw * 0.68} height={Math.max(bh, 1)} rx={3} fill={it.c} />
            <text x={x + bw * 0.34} y={y - 5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--navy)">{fmt(it.v)}</text>
            <text x={x + bw * 0.34} y={h - 16} textAnchor="middle" fontSize={9.5} fill="var(--slate)">{it.l}</text>
            {it.sub && <text x={x + bw * 0.34} y={h - 5} textAnchor="middle" fontSize={8.5} fill="var(--slate2)">{it.sub}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** The four value paths in friendly words and distinct colours (one quadrant each). */
export const VALUE_PATH: Record<string, { l: string; c: string; d: string }> = {
  COST: { l: 'Lower cost', c: '#3F90CB', d: 'Saves money: labor hours, inventory carrying cost, cost per transaction' },
  PERFORMANCE: { l: 'Better performance', c: '#2F7D5C', d: 'Faster or better outcomes: lead time, backorders, readiness, yield' },
  RISK: { l: 'Lower risk', c: '#CE0F3E', d: 'Avoids losses: counterfeit parts, supply disruption, single sources' },
  REVENUE: { l: 'More revenue', c: '#F9B018', d: 'Brings money in: reutilization, resale, cost recovery' },
};

/** Donut / pie chart. */
export function Donut({ slices, size = 220, center, sub, onClick }: { slices: { k: string; l: string; v: number; c: string }[]; size?: number; center?: string; sub?: string; onClick?: (k: string) => void }) {
  const total = slices.reduce((a, s) => a + s.v, 0) || 1, r = size / 2, ir = r * 0.58;
  let a0 = -Math.PI / 2;
  const arc = (a1: number, a2: number) => {
    const large = a2 - a1 > Math.PI ? 1 : 0, p = (rad: number, a: number) => `${r + rad * Math.cos(a)} ${r + rad * Math.sin(a)}`;
    return `M ${p(r, a1)} A ${r} ${r} 0 ${large} 1 ${p(r, a2)} L ${p(ir, a2)} A ${ir} ${ir} 0 ${large} 0 ${p(ir, a1)} Z`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label="Donut chart">
      {slices.filter(s => s.v > 0).map(s => {
        const a1 = a0, a2 = a0 + 2 * Math.PI * s.v / total - (slices.filter(x => x.v > 0).length > 1 ? 0.012 : 0); a0 += 2 * Math.PI * s.v / total;
        const mid = (a1 + a2) / 2, pctv = Math.round(100 * s.v / total), lr = (r + ir) / 2;
        return (
          <g key={s.k} onClick={onClick ? () => onClick(s.k) : undefined} style={{ cursor: onClick ? 'pointer' : undefined }}>
            <path d={arc(a1, Math.min(a2, a1 + 2 * Math.PI - 0.001))} fill={s.c}><title>{`${s.l}: ${pctv}%`}</title></path>
            {pctv >= 6 && <text x={r + lr * Math.cos(mid)} y={r + lr * Math.sin(mid) + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">{pctv}%</text>}
          </g>
        );
      })}
      {center && <text x={r} y={r + (sub ? 0 : 6)} textAnchor="middle" fontSize={22} fontWeight={700} fontFamily="var(--serif)" fill="var(--navy)">{center}</text>}
      {sub && <text x={r} y={r + 18} textAnchor="middle" fontSize={10.5} fill="var(--slate)">{sub}</text>}
    </svg>
  );
}

/** Grouped vertical bars: a few series per category. */
export function GroupBars({ cats, series, h = 260, fmt = (v: number) => String(v), onClick }: { cats: string[]; series: { l: string; c: string; v: number[] }[]; h?: number; fmt?: (v: number) => string; onClick?: (i: number) => void }) {
  const w = 560, pad = 8, max = Math.max(...series.flatMap(s => s.v), 1), cw = (w - pad) / Math.max(cats.length, 1), bw = cw * 0.72 / series.length;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        {[1, 2, 3].map(i => { const yy = h - 30 - (h - 50) * i / 3; return <line key={i} x1={pad} y1={yy} x2={w} y2={yy} stroke="#E7E4DC" />; })}
        {cats.map((c, i) => (
          <g key={c} onClick={onClick ? () => onClick(i) : undefined} style={{ cursor: onClick ? 'pointer' : undefined }}>
            {series.map((s, j) => {
              const bh = (h - 50) * s.v[i] / max, x = pad + i * cw + cw * 0.14 + j * bw, y = h - 30 - bh;
              return <g key={s.l}><rect x={x} y={y} width={bw - 2} height={Math.max(bh, 1)} rx={3} fill={s.c}><title>{`${c} · ${s.l}: ${fmt(s.v[i])}`}</title></rect>
                {s.v[i] > 0 && <text x={x + (bw - 2) / 2} y={y - 4} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--navy)">{fmt(s.v[i])}</text>}</g>;
            })}
            <text x={pad + i * cw + cw / 2} y={h - 12} textAnchor="middle" fontSize={10.5} fill="var(--slate)">{c}</text>
          </g>
        ))}
      </svg>
      <div className="legend">{series.map(s => <span key={s.l}><i style={{ background: s.c }} />{s.l}</span>)}</div>
    </div>
  );
}

/** Stacked bars: rows of segments. */
export function Stack({ rows, keys, colors, labels, h = 200, fmt = (v: number) => String(v), onClick }: { rows: { l: string; v: Record<string, number> }[]; keys: string[]; colors: Record<string, string>; labels?: Record<string, string>; h?: number; fmt?: (v: number) => string; onClick?: (i: number) => void }) {
  const w = 560, pad = 10, max = Math.max(...rows.map(r => keys.reduce((a, k) => a + (r.v[k] ?? 0), 0)), 1), bw = (w - pad) / Math.max(rows.length, 1);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        {rows.map((r, i) => {
          const x = pad + i * bw + bw * 0.22; let y = h - 26; const tot = keys.reduce((a, k) => a + (r.v[k] ?? 0), 0);
          return (
            <g key={i} onClick={onClick ? () => onClick(i) : undefined} style={{ cursor: onClick ? 'pointer' : undefined }}>
              {keys.map(k => { const hh = (r.v[k] ?? 0) * (h - 52) / max; y -= hh; return <rect key={k} x={x} y={y} width={bw * 0.56} height={Math.max(hh, 0)} fill={colors[k]}><title>{`${labels?.[k] ?? k}: ${fmt(r.v[k] ?? 0)}`}</title></rect>; })}
              <text x={x + bw * 0.28} y={y - 5} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--navy)">{fmt(tot)}</text>
              <text x={x + bw * 0.28} y={h - 10} textAnchor="middle" fontSize={10} fill="var(--slate)">{r.l}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend">{keys.map(k => <span key={k}><i style={{ background: colors[k] }} />{labels?.[k] ?? k}</span>)}</div>
    </div>
  );
}

export const Card = ({ title, right, children, id, pad = true, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; id?: string; pad?: boolean; className?: string }) => (
  <div className={'card' + (className ? ' ' + className : '')} id={id}><div className="chd"><span>{title}</span>{right && <span>{right}</span>}</div><div className={pad ? 'cbd' : ''}>{children}</div></div>
);

export const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <div className="banner err">{msg}</div> : null);
export const Loading = () => <div className="loading">Loading…</div>;
