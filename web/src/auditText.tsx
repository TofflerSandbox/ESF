import type { ReactNode } from 'react';
import type { Meta } from './App';
import { PH_SHORT, STATUS, VP, money } from './ui';

const PATH_L: Record<string, string> = { A_WCF: 'Path A — WCF', B_POM: 'Path B — POM' };
const FIELD_L: Record<string, string> = {
  description: 'Description', status_code: 'Status', pop_start: 'PoP start', pop_end: 'PoP end', transition_phase: 'Transition phase',
  transition_type: 'Transition type', environment: 'Environment', charter: 'Charter', okrs: 'OKRs',
};
const val = (k: string, v: unknown) => (v == null || v === '' ? '—' : k === 'status_code' ? `${v} · ${STATUS[String(v)] ?? ''}` : String(v).slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? String(v).slice(0, 10) : String(v));

/** Turns an audit_event row into a readable headline + detail line. Falls back to raw JSON for unknown actions. */
export function auditText(a: any, meta: Meta): { head: ReactNode; detail?: ReactNode } {
  const x = a.after ?? {}, b = a.before ?? {};
  const crit = (gate: number, ord?: number, text?: string) => {
    const d = ord != null ? meta.criteria.find(c => c.gate === gate && c.ord === ord) : meta.criteria.find(c => c.gate === gate && c.text === text);
    return `${d ? d.ord + '. ' : ''}${d?.text ?? text ?? 'criterion'}`;
  };
  switch (a.action) {
    case 'CRITERION':
      return { head: <>Gate {x.gate} · {crit(x.gate, x.ord, x.criterion)} → <b>{x.status}</b>{b.status && b.status !== x.status ? <span className="muted"> (was {b.status})</span> : null}</>,
        detail: x.evidence ? <>{x.status === 'WAIVED' ? 'Reason' : 'Evidence'}: {x.evidence}</> : undefined };
    case 'GATE_DECISION':
      return { head: <>Gate {x.gate} decision: <b>{x.outcome}</b>{x.esf_phase != null && x.outcome === 'PASS' ? <> → {PH_SHORT[x.esf_phase]}</> : null}</>, detail: x.rationale };
    case 'ESF_TRIAGE':
      return { head: <>ESF phase confirmed: <b>{PH_SHORT[x.phase]} · {x.status}</b>{b.esf_phase != null ? <span className="muted"> (suggested {PH_SHORT[b.esf_phase]} · {b.esf_status})</span> : null}</>, detail: x.note };
    case 'FUNDING_ADD':
      return { head: <>Funding line added: <b>{money(x.amount)}</b> FY{String(x.fy).slice(2)} {x.appropriation}</>, detail: <>Source: {x.source}{x.pop_end ? ` · PoP end ${String(x.pop_end).slice(0, 10)}` : ''}</> };
    case 'VALUE_CASE_ADD':
      return { head: <>Value case added: <b>{VP[x.path]?.l ?? x.path}</b>{x.annual_value ? ` · ${money(x.annual_value)}/yr` : ''}</>, detail: x.metric };
    case 'PATHWAY_DECLARE':
      return { head: <>Transition pathway declared: <b>{PATH_L[x.path] ?? x.path}</b></>, detail: x.mechanism };
    case 'PATHWAY_ADVANCE':
      return { head: <>Transition pathway {b.status ?? ''} → <b>{x.status}</b></> };
    case 'EDIT':
      return { head: <>Data-call fields updated</>, detail: Object.keys(x).map(k => `${FIELD_L[k] ?? k}: ${val(k, b[k])} → ${val(k, x[k])}`).join(' · ') };
    case 'IMPORT':
      return { head: <>Workbook imported: <b>{x.projects}</b> projects</> };
    default:
      return { head: <>{a.action}</>, detail: <span className="mono">{JSON.stringify(x)}</span> };
  }
}
