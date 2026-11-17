import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { useSort } from '../sort';
import { Card, ErrorBox, Help, Loading, PH_COL, PH_SHORT, Stack, go, money, useAsync } from '../ui';

const $ = (v: number) => money(v).replace('.00M', 'M');
const pc = (v: number | null) => (v == null ? '—' : `${Math.round(100 * v)}%`);
const tone = (v: number | null, good = 0.75, ok = 0.4) => (v == null ? 'var(--slate2)' : v >= good ? '#2F7D5C' : v >= ok ? '#C9A961' : '#CE0F3E');

/** A share as a small bar with the fraction beside it. */
function Share({ v, n, of, good, ok }: { v: number | null; n?: number; of?: number; good?: number; ok?: number }) {
  return (
    <span className="own-share">
      <span className="mini-track"><span style={{ width: `${Math.round(100 * (v ?? 0))}%`, background: tone(v, good, ok) }} /></span>
      <span className="mono sm">{n != null && of != null ? `${n}/${of}` : pc(v)}</span>
    </span>
  );
}

export const HubProposal = () => <span className="proptag" title="A Hub proposal to the ESF: not yet ESF policy. DLA can accept or reject it; only a gate authority can waive it.">HUB PROPOSAL</span>;
export const SponsorTag = () => <span className="sptag" title="Signed by the sponsoring organization in the Hub">SPONSOR SIGNS</span>;

/* ── the enterprise scorecard (Organizations page) ── */
export function Scorecard() {
  const { data: d, error } = useAsync(() => api('/scorecard'), []);
  const [all, setAll] = useState(false);
  const rows = (d?.rows ?? []).filter((r: any) => all || r.seat);
  const { sorted, Th } = useSort<any>(rows, { key: 'attention', dir: -1 }, {
    sponsored: r => r.active + r.atScale, cofundShare: r => r.cofundShare, signedShare: r => r.signedShare, pathShare: r => r.pathShare, realization: r => r.realization,
  });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const T = d.totals;
  return (
    <Card title={<>Enterprise scorecard <Help title="Why a scorecard">The organizational assessment found R&D is seen as J68's portfolio. This puts each sponsoring organization's record side by side for the DCG: what it sponsors, how much of the cost it carries, whether it has signed the commitments the ESF asks of it, whether its transitions are really committed, and whether what it fielded is delivering.</Help></>}
      right={<span className="tabs"><button className={!all ? 'on' : ''} onClick={() => setAll(false)}>Sponsor seats ({T.seats})</button><button className={all ? 'on' : ''} onClick={() => setAll(true)}>All sponsoring organizations ({T.orgs})</button></span>} pad={false}>
      <div className="own-strip">
        <div><b>{pc(T.funded ? T.sponsorFunded / T.funded : null)}</b><span>of the money on sponsored projects comes from the sponsors ({$(T.sponsorFunded)} of {$(T.funded)})</span></div>
        <div><b>{T.signed}/{T.asks}</b><span>sponsor commitments signed at the gates projects are working toward</span></div>
        <div><b>{T.pathOk}/{T.phase2plus}</b><span>Phase II+ projects with a committed pathway; {T.pathGaps} in Phase III–IV without one</span></div>
        <div><b>{pc(T.planned ? T.realized / T.planned : null)}</b><span>of planned benefit delivered by fielded projects; {T.silent} not reporting</span></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="list flat own-t">
          <thead><tr><Th k="name">Sponsoring organization</Th><Th k="sponsored" num>Sponsors</Th><Th k="cofundShare">Carries of the cost</Th><Th k="signedShare">Commitments signed</Th>
            <Th k="pathShare">Committed pathways</Th><Th k="realization">Fielded: of plan</Th><Th k="attention" num>Needs attention</Th></tr></thead>
          <tbody>{sorted.map((r: any) => (
            <tr key={r.id} onClick={() => go('#/org/' + r.id)}>
              <td className="ttl">{r.name}{r.seat && <span className="tagmini" title="Has a sponsor seat in the Hub">SEAT</span>}</td>
              <td className="num mono">{r.active}<span className="muted"> active</span>{r.atScale ? <><br /><span className="muted">{r.atScale} at scale</span></> : null}</td>
              <td><Share v={r.cofundShare} good={0.35} ok={0.15} /></td>
              <td><Share v={r.signedShare} n={r.signed} of={r.asks} /></td>
              <td><Share v={r.pathShare} n={r.pathOk} of={r.phase2plus} good={0.5} ok={0.2} />{r.pathGaps > 0 && <div className="sub" style={{ color: 'var(--red)' }}>{r.pathGaps} in Phase III–IV uncommitted</div>}</td>
              <td>{r.fielded ? <><Share v={r.realization} good={0.9} ok={0.6} /><div className="sub">{r.fielded} fielded{r.silent ? ` · ${r.silent} not reporting` : ''}</div></> : <span className="muted sm">nothing fielded yet</span>}</td>
              <td className="num"><b style={{ color: r.attention ? 'var(--red)' : 'var(--spon)' }}>{r.attention}</b></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="chart-note" style={{ padding: '8px 16px 12px' }}>
        <b>Carries of the cost</b>: sponsor-sourced funding ÷ all funding on the projects it sponsors. <b>Commitments signed</b>: the sponsor-owned criteria at each project's current gate (LOI, reaffirmations, SES funding commitment, operational acceptance, and the Gate 3 pathway Hub proposal).
        <b> Needs attention</b>: unsigned commitments + uncommitted Phase III–IV pathways + fielded projects at risk or not reporting.
      </div>
    </Card>
  );
}

/* ── one organization's ownership record and to-do list (Organization page) ── */
export function OrgOwnership({ id }: { id: number }) {
  const meta = useMeta();
  const { data: d, error } = useAsync(() => api(`/orgs/${id}/ownership`), [id]);
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  if (!d.row) return null;
  const r = d.row, mine = meta.me.role === 'SPONSOR' && meta.me.org_id === id;
  return (
    <Card title={<>{mine ? 'Your organization: what the ESF needs from you' : 'Ownership record'} <Help title="Ownership record">What this organization has committed to as a sponsor, and what is still waiting on it. Sponsor seats sign commitments and commit pathways on each project's page.</Help></>}
      right={<a href="#/orgs">Compare on the enterprise scorecard →</a>} className={mine ? 'own-mine' : ''}>
      <div className="own-kpis">
        <div><span>Carries of the cost</span><b style={{ color: tone(r.cofundShare, 0.35, 0.15) }}>{pc(r.cofundShare)}</b><small>{$(r.sponsorFunded)} of {$(r.funded)}</small></div>
        <div><span>Commitments signed</span><b style={{ color: tone(r.signedShare) }}>{r.signed}/{r.asks}</b><small>at the gates its projects face now</small></div>
        <div><span>Committed pathways</span><b style={{ color: tone(r.pathShare, 0.5, 0.2) }}>{r.pathOk}/{r.phase2plus}</b><small>Phase II and later</small></div>
        <div><span>Fielded: of plan</span><b style={{ color: tone(r.realization, 0.9, 0.6) }}>{r.fielded ? pc(r.realization) : '—'}</b><small>{r.fielded ? `${r.fielded} at scale` : 'nothing fielded yet'}</small></div>
      </div>
      <div className="own-lists">
        <div>
          <div className="lbl">Commitments to sign ({d.toSign.length})</div>
          {d.toSign.slice(0, 8).map((a: any) => (
            <a key={a.esh_id + a.id} className="own-item" href={'#/p/' + a.esh_id}>
              <span className="own-k">Gate {a.gate} · {a.esh_id}{a.othersClosed && <b className="own-last"> last signature needed</b>}</span>
              <span className="own-t">{a.title}</span>
              <span className="sub">{a.text}{a.proposal && <HubProposal />}</span>
            </a>
          ))}
          {!d.toSign.length && <div className="note">Nothing waiting for a signature.</div>}
          {d.toSign.length > 8 && <div className="sub">and {d.toSign.length - 8} more</div>}
        </div>
        <div>
          <div className="lbl">Pathways to commit ({d.toCommit.length})</div>
          {d.toCommit.slice(0, 8).map((t: any) => (
            <a key={t.esh_id} className="own-item" href={'#/p/' + t.esh_id}>
              <span className="own-k"><span className="phdot" style={{ background: PH_COL[t.phase] }} />{PH_SHORT[t.phase]} · {t.esh_id} · <b style={{ color: d.readiness[t.readiness].c }}>{d.readiness[t.readiness].l}</b></span>
              <span className="own-t">{t.title}</span>
              {t.missing.length > 0 && <span className="sub">Missing: {t.missing.join(', ')}</span>}
            </a>
          ))}
          {!d.toCommit.length && <div className="note">Every Phase II+ project has a committed pathway.</div>}
          {d.toCommit.length > 8 && <div className="sub">and {d.toCommit.length - 8} more</div>}
        </div>
        <div>
          <div className="lbl">Fielded projects needing attention ({d.reports.length})</div>
          {d.reports.slice(0, 8).map((x: any) => (
            <a key={x.esh_id} className="own-item" href={'#/p/' + x.esh_id}>
              <span className="own-k">{x.esh_id} · <b style={{ color: d.status[x.status].c }}>{d.status[x.status].l}</b>{x.realization != null && ` · ${pc(x.realization)} of plan`}</span>
              <span className="own-t">{x.title}</span>
              {x.note && <span className="sub">{x.note}</span>}
            </a>
          ))}
          {!d.reports.length && <div className="note">All fielded projects on track and reporting.</div>}
        </div>
      </div>
    </Card>
  );
}

/* ── transition readiness (Funding & transition page) ── */
export function TransitionReadiness() {
  const { data: d, error } = useAsync(() => api('/transition'), []);
  const [sel, setSel] = useState<{ phase?: number; k?: string }>({});
  const rows = (d?.rows ?? []).filter((r: any) => (sel.phase == null || r.phase === sel.phase) && (!sel.k || r.readiness === sel.k));
  const order = ['NONE', 'DECLARED', 'INCOMPLETE', 'COMMITTED', 'ACTIVE'];
  const { sorted, Th } = useSort<any>(rows, { key: 'readiness' }, { readiness: r => order.indexOf(r.readiness) * 10 - r.phase, sponsor: r => r.sponsors[0] ?? '', pom_fy: r => r.pom_fy });
  if (error) return <ErrorBox msg={error} />;
  if (!d) return <Loading />;
  const R = d.readiness;
  const g3 = d.rows.filter((r: any) => r.phase === 3);
  const g3Short = g3.filter((r: any) => !['COMMITTED', 'ACTIVE'].includes(r.readiness)).length;
  return (
    <Card title={<>Transition readiness <Help title="Transition readiness">Every project in Phase II–IV and how real its transition is. A pathway is only <b>committed</b> when an organization has signed up to receive it, named the funding line that will pay for it, and (Path B) the POM year. The Hub proposes this as a Gate 3 criterion, so no project reaches deployment without a committed home.</Help> <HubProposal /></>}
      right={<span className="hint">{g3Short} of {g3.length} Phase III projects would not pass the Gate 3 proposal today</span>} pad={false}>
      <div className="tr-top">
        <Stack h={170} rows={d.byPhase.map((p: any) => ({ l: p.name, v: Object.fromEntries(order.map(k => [k, p[k]])) }))} keys={order}
          colors={Object.fromEntries(order.map(k => [k, R[k].c]))} labels={Object.fromEntries(order.map(k => [k, R[k].l]))}
          onClick={i => setSel(s => (s.phase === d.byPhase[i].phase && !s.k ? {} : { phase: d.byPhase[i].phase }))} />
        <div className="tr-chips">
          {order.map(k => {
            const n = d.rows.filter((r: any) => r.readiness === k && (sel.phase == null || r.phase === sel.phase)).length;
            return (
              <button key={k} className={'tr-chip' + (sel.k === k ? ' on' : '')} onClick={() => setSel(s => ({ ...s, k: s.k === k ? undefined : k }))} title={R[k].d} disabled={!n}>
                <i style={{ background: R[k].c }} />{R[k].l}<b>{n}</b>
              </button>
            );
          })}
          {(sel.phase != null || sel.k) && <button className="as-link" onClick={() => setSel({})}>Clear filter</button>}
        </div>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
        <table className="list flat rows">
          <thead><tr><Th k="title">Project</Th><Th k="phase">Phase</Th><Th k="sponsor">Sponsor</Th><Th k="readiness">Pathway</Th><Th k="receiver">Receiving organization</Th><Th k="funding_line">Funding line</Th><Th k="pom_fy" num>POM year</Th></tr></thead>
          <tbody>{sorted.map((r: any) => (
            <tr key={r.esh_id} onClick={() => go('#/p/' + r.esh_id)}>
              <td className="ttl">{r.title}<div className="sub mono">{r.esh_id} · {r.program_code ?? '—'}</div></td>
              <td><span className="phdot" style={{ background: PH_COL[r.phase] }} />{PH_SHORT[r.phase]}{r.phase === 3 && r.sesSigned === false && <div className="sub" style={{ color: 'var(--red)' }}>SES commitment unsigned</div>}</td>
              <td className="sm">{r.sponsors.join(', ') || <span className="muted">none named</span>}</td>
              <td><b style={{ color: R[r.readiness].c }}>{R[r.readiness].l}</b>{r.path && <div className="sub">{r.path === 'A_WCF' ? 'Path A · WCF' : 'Path B · POM'}</div>}{r.missing.length > 0 && <div className="sub" style={{ color: '#D9822B' }}>missing {r.missing.join(', ')}</div>}</td>
              <td className="sm">{r.receiver ?? <span className="muted">—</span>}</td>
              <td className="sm">{r.funding_line ?? <span className="muted">—</span>}</td>
              <td className="num mono">{r.pom_fy ? `FY${String(r.pom_fy).slice(2)}` : r.path === 'A_WCF' ? <span className="muted">WCF</span> : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {!sorted.length && <div className="note" style={{ padding: 14 }}>No projects match.</div>}
      </div>
    </Card>
  );
}
