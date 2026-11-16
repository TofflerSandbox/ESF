let userId: number | null = (() => { try { const v = localStorage.getItem('esh-user'); return v ? Number(v) : null; } catch { return null; } })();
export const getUserId = () => userId;
export const setUserId = (id: number) => { userId = id; try { localStorage.setItem('esh-user', String(id)); } catch { /* ignore */ } };

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method ?? 'GET',
    headers: { ...(userId ? { 'x-esh-user': String(userId) } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? '?' + p.join('&') : '';
};
