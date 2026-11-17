import { useMemo, useRef, useState, type ReactNode } from 'react';

/** Sortable table columns: click a header to sort ascending, click again for descending. */
export function useSort<T>(rows: T[], initial: { key: string; dir?: 1 | -1 }, getters: Record<string, (r: T) => unknown> = {}) {
  const [s, setS] = useState<{ key: string; dir: 1 | -1 }>({ key: initial.key, dir: initial.dir ?? 1 });
  const ref = useRef(s); ref.current = s;
  const sorted = useMemo(() => {
    const get = getters[s.key] ?? ((r: any) => r[s.key]);
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;   // blanks last
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' })) * s.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, s]);
  // a stable component, so headers aren't remounted on every sort; it reads the current sort through the ref
  const Th = useMemo(() => function Th({ k, children, num }: { k: string; children: ReactNode; num?: boolean }) {
    const cur = ref.current;
    return (
      <th className={'sortable' + (cur.key === k ? ' on' : '') + (num ? ' num' : '')} aria-sort={cur.key === k ? (cur.dir > 0 ? 'ascending' : 'descending') : 'none'}
        onClick={() => setS(p => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : (num ? -1 : 1) }))}>
        {children}<span className="sarr">{cur.key === k ? (cur.dir > 0 ? ' ▲' : ' ▼') : ' ↕'}</span>
      </th>
    );
  }, []);
  return { sorted, Th };
}
