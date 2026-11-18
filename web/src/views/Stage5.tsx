import { useState } from 'react';
import { api } from '../api';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Insights, Loading, OrgLink, ProgramLink, VALUE_PATH, d10, fmtMY, go, money, rel, useAsync } from '../ui';
import { useMeta } from '../App';

const $ = (v: number | null | undefined) => (v == null ? '—' : money(v).replace('.00M', 'M'));
const pc = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const isRD = (o: any) => !!o && /J68/.test(o.name);   // still owned by R&D: no enterprise owner yet

/** Stage 5 as the enterprise sees it: who runs each fielded capability, how it is paid for, whether it delivers, whether people use it. */
export function Stage5() {
  const { data: d, error } = useAsync(() => api('/enterprise'), []);
  const asOf = new Date(useMeta().asOf);
  const [op, setOp] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (d?.rows ?? []).filter((r: any) => (op == null || r.operator?.id === op) && (!status || (status === 'NO_OWNER' ? isRD(r.operator) : r.status === status))
    && terms.every(t => `${r.title} ${r.esh_id} ${r.program_code ?? ''} ${r.operator?.name ?? ''} ${r.funding_line ?? ''}`.toLowerCase().includes(t)));
  const { sorted, Th } = useSort<any>(rows, { key: 'operator', dir: 1 }, {
    operator: r => r.operator?.name ?? 'zzz', months: r => r.months ?? -1, realization: r => r.realization, adoption: r => r.adoption?.pct ?? -1,
    status: r => ['AT_RISK', 'SILENT', 'BEHIND', 'NEW', 'ON_TRACK', 'EXCEEDING'].indexOf(r.status ?? ''), next: r => r.nextReview?.due ?? '9999', paid: r => r.path ?? 'z',
  });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const T = d.totals, S = d.status;
  const noOwner = d.rows.filter((r: any) => isRD(r.operator)).length;
  const maxOp = Math.max(1, ...d.operators.map((o: any) => o.n));
  return (
    <div className="home">

      <div className="hk-grid three">
        <div className="hk click" onClick={() => { setOp(null); setStatus(null); }}><span className="hk-l">In the enterprise</span><span className="hk-v">{T.n}</span><span className="hk-s">capabilities fielded at scale</span></div>
        <div className="hk"><span className="hk-l">Operating organizations</span><span className="hk-v">{T.operators}</span><span className="hk-s">own and run them day to day</span></div>
        <div className="hk click" onClick={() => setStatus('NO_OWNER')}><span className="hk-l">No enterprise owner yet</span><span className="hk-v" style={{ color: noOwner ? 'var(--red)' : undefined }}>{noOwner}</span><span className="hk-s">fielded, but still recorded under J68</span></div>
        <div className="hk"><span className="hk-l">Delivered vs plan</span><span className="hk-v" style={{ color: T.planned && T.realized / T.planned >= 0.9 ? 'var(--spon)' : 'var(--goldD)' }}>{pc(T.planned ? T.realized / T.planned : null)}</span><span className="hk-s">{$(T.realized)} of {$(T.planned)} since transition · <a href="#/roi" onClick={e => e.stopPropagation()}>ROI →</a></span></div>
        <div className="hk"><span className="hk-l">Adoption</span><span className="hk-v">{T.medianAdoption != null ? `${T.medianAdoption}%` : '—'}</span><span className="hk-s">median at the latest measure, {T.measured} of {T.n} measured · <a href="#/j1">Workforce →</a></span></div>
        <div className="hk click" onClick={() => go('#/realization')}><span className="hk-l">Needs attention</span><span className="hk-v" style={{ color: T.attention ? 'var(--red)' : undefined }}>{T.attention}</span><span className="hk-s">at risk, not reporting, or a review or action overdue →</span></div>
      </div>

      <Insights items={[
        { t: <>Reaching about <b>{T.people.toLocaleString()} people</b> across {T.operators} operating organizations</> },
        { t: `Running at ${$(T.runRate)} a year against a ${$(T.baseline)} combined baseline` },
        (() => {
          const low = d.operators.filter((o: any) => o.n >= 3 && o.realization != null && !isRD(o)).sort((a: any, b: any) => a.realization - b.realization)[0];
          return low && low.realization < 0.9 && { t: <><OrgLink id={low.id} name={low.name} /> delivers {pc(low.realization)} of plan across {low.n} capabilities, the lowest of any operator running 3 or more</>, tone: 'warn' as const };
        })(),
        T.reviewsDue > 0 && { t: `${T.reviewsDue} realization review${T.reviewsDue === 1 ? '' : 's'} fall due in the next 90 days`, href: '#/realization' },
      ]} />

      <div className="grid2">
        <Card title={<>Who runs them now <Help title="Operating organization">The organization that owns and runs the capability after Gate 4: the owner of its value baseline, else the receiver of its transition pathway, else its sponsor. Click one to filter.</Help></>} right={<span className="hint">capabilities · share of planned value delivered</span>}>
          <div className="s5-ops">
            {d.operators.map((o: any) => (
              <button key={o.id} className={'s5-op' + (op === o.id ? ' on' : '') + (isRD(o) ? ' rd' : '')} onClick={() => setOp(op === o.id ? null : o.id)}>
                <span className="s5-on">{o.name}{isRD(o) && <span className="s5-warn">no enterprise owner</span>}</span>
                <span className="s5-track"><span style={{ width: `${100 * o.n / maxOp}%` }} /></span>
                <b>{o.n}</b>
                <span className="s5-pc" style={{ color: o.realization == null ? undefined : o.realization >= 0.9 ? 'var(--spon)' : o.realization >= 0.6 ? 'var(--goldD)' : 'var(--red)' }}>{pc(o.realization)}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card title="How they are tracking, and how they are paid for">
          <div className="rs-bars">
            {Object.entries(S).map(([k, v]: [string, any]) => {
              const n = d.rows.filter((r: any) => r.status === k).length;
              return (
                <button key={k} className={'rs-bar' + (status === k ? ' on' : '')} onClick={() => setStatus(status === k ? null : k)} disabled={!n}>
                  <span className="rs-l">{v.l}</span><span className="rs-track"><span style={{ width: `${100 * n / Math.max(1, T.n)}%`, background: v.c }} /></span><b>{n}</b>
                </button>
              );
            })}
          </div>
          <div className="lbl" style={{ marginTop: 14 }}>Paid for through</div>
          <div className="prog-ready">
            <div><i style={{ background: '#3F90CB' }} /><span>Path A · WCF rate</span><b>{d.funding.WCF}</b></div>
            <div><i style={{ background: '#6B3FA0' }} /><span>Path B · POM line</span><b>{d.funding.POM}</b></div>
            <div><i style={{ background: '#B9B4A8' }} /><span>Not recorded</span><b>{d.funding.NONE}</b></div>
          </div>
          <div className="chart-note">{T.reviewsDue} realization review{T.reviewsDue === 1 ? '' : 's'} fall due in the next 90 days. <a href="#/realization">Realization reviews →</a></div>
        </Card>
      </div>

      <Card title={`Fielded capabilities${op != null ? ` · ${d.operators.find((o: any) => o.id === op)?.name}` : ''}${status ? ` · ${status === 'NO_OWNER' ? 'No enterprise owner' : S[status]?.l}` : ''}`} pad={false}
        right={<span className="tabs">
          <input type="search" placeholder="Search capability, program, operator, funding line…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search fielded capabilities" />
          {(op != null || status) && <button onClick={() => { setOp(null); setStatus(null); }}>Clear filters</button>}
          <span className="hint">{sorted.length}</span>
        </span>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="list flat rows">
            <thead><tr><Th k="title">Capability</Th><Th k="operator">Operated by</Th><Th k="program_code">Program</Th><Th k="months" num>In service</Th><Th k="paid">Paid through</Th>
              <Th k="realization" num>Delivering</Th><Th k="status">Status</Th><Th k="adoption" num>Adoption</Th><Th k="next">Next review</Th></tr></thead>
            <tbody>{sorted.map((r: any) => (
              <tr key={r.esh_id} onClick={() => go('#/p/' + r.esh_id)}>
                <td className="ttl">{r.title}<div className="sub mono">{r.esh_id}{r.valuePath ? ` · ${VALUE_PATH[r.valuePath]?.l}` : ''}</div></td>
                <td className="sm">{r.operator ? <OrgLink id={r.operator.id} name={r.operator.name} /> : <span className="muted">not named</span>}{isRD(r.operator) && <div className="sub" style={{ color: 'var(--red)' }}>no enterprise owner</div>}</td>
                <td className="sm"><ProgramLink code={r.program_code} el={r.element_code} /></td>
                <td className="num sm">{r.months != null ? `${r.months} mo` : '—'}<div className="sub">{r.since ? `since ${fmtMY(r.since)}` : ''}</div></td>
                <td className="sm">{r.path ? (r.path === 'A_WCF' ? 'WCF rate' : `POM${r.pom_fy ? ' FY' + String(r.pom_fy).slice(2) : ''}`) : <span className="muted">not recorded</span>}{r.funding_line && <div className="sub">{r.funding_line}</div>}</td>
                <td className="num">{r.planned ? <><span className="mini-track"><span style={{ width: `${Math.min(100, 100 * (r.realization ?? 0))}%`, background: S[r.status]?.c ?? 'var(--slate2)' }} /></span> <span className="mono sm">{pc(r.realization)}</span><div className="sub">{$(r.realized)} of {$(r.planned)}</div></> : <span className="muted">—</span>}</td>
                <td>{r.status && <span className="rs-chip" style={{ color: S[r.status].c, borderColor: S[r.status].c }}>{S[r.status].l}</span>}{r.note && <div className="sub">{r.note}</div>}</td>
                <td className="num sm">{r.adoption ? <><b>{r.adoption.pct}%</b><div className="sub">at {r.adoption.day} days</div></> : <span className="muted">not measured</span>}</td>
                <td className="sm">{r.nextReview ? <><span style={{ color: r.nextReview.overdue ? 'var(--red)' : undefined, fontWeight: r.nextReview.overdue ? 700 : 400 }}>{r.nextReview.months}-month · {rel(r.nextReview.due, asOf)}</span><div className="sub">{d10(r.nextReview.due)}</div></> : <span className="muted">—</span>}
                  {r.openActions > 0 && <div className="sub" style={{ color: r.overdueActions ? 'var(--red)' : undefined }}>{r.openActions} open action{r.openActions === 1 ? '' : 's'}{r.overdueActions ? `, ${r.overdueActions} overdue` : ''}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
          {!sorted.length && <div className="note" style={{ padding: 14 }}>No capabilities match.</div>}
        </div>
      </Card>
      <div className="fine dm" style={{ marginTop: 8 }}>Operating organizations, funding lines, benefit and adoption figures in this demo are synthetic, built on the real inventory.</div>
    </div>
  );
}
