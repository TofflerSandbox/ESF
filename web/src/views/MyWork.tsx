import { api } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Loading, d10, go, rel, useAsync } from '../ui';

const ROLE_SUB: Record<string, string> = {
  PM: 'Your projects: criteria to close, data call responses, and contracts running out',
  SPONSOR: 'What your organization owes: signatures, transition pathways, benefit reports and review actions',
  AUTHORITY: 'Decisions waiting on you, boards coming up, and open senior leader decisions',
  J1: 'Workforce items holding a gate, changes going live, and review actions for J1',
  ADMIN: 'Running the process: dockets, data call reviews, realization reviews and R&D actions',
};

/** Each role's queue: everything it owes the process, warnings first, then by due date. */
export function MyWork() {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api<any>('/me/work'), [meta.me.id]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const asOf = new Date(d.asOf + 'T00:00:00Z');
  const T = d.totals;
  return (
    <div className="home mywork">
      <div className="vhead">
        <div><h2 className="vt">My work</h2>
          <div className="vsub">{meta.me.name} · {ROLE_SUB[d.role] ?? ''}</div></div>
      </div>

      {T.items > 0 ? (
        <div className="mw-sum">
          <span><b>{T.items}</b> open item{T.items === 1 ? '' : 's'}</span>
          {T.overdue > 0 && <span className="warn"><b>{T.overdue}</b> overdue</span>}
          {T.week > 0 && <span><b>{T.week}</b> due this week</span>}
          {T.warn > 0 && <span className="warn"><b>{T.warn}</b> need attention</span>}
        </div>
      ) : (
        <div className="mw-empty"><b>You're all caught up.</b> Nothing is waiting on you right now.</div>
      )}

      {d.sections.map((s: any) => (
        <Card key={s.key} title={<>{s.title} <span className="mw-n">{s.items.length + (s.more?.n ?? 0)}</span></>} right={<span className="hint">{s.hint}</span>} pad={false}>
          <ul className="mw-list">
            {s.items.map((it: any, i: number) => {
              const overdue = it.due && it.due < d.asOf;
              return (
                <li key={i} className={it.tone ?? ''} onClick={() => go(it.href)}>
                  <span className="mw-dot" aria-hidden="true" />
                  <span className="mw-main">
                    <a href={it.href} onClick={e => e.stopPropagation()} className="mw-t">{it.title}</a>
                    <span className="mw-w">{it.esh_id && <span className="mono">{it.esh_id} · </span>}{it.what}</span>
                  </span>
                  {it.due && <span className={'mw-due' + (overdue ? ' over' : '')}><b>{rel(it.due, asOf)}</b><span>{d10(it.due)}</span></span>}
                </li>
              );
            })}
          </ul>
          {s.more && <a className="mw-more" href={s.more.href}>{s.more.n} more →</a>}
        </Card>
      ))}
    </div>
  );
}
