import { useState } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { DOCS, EXIT, EXIT_NOTE, STAGES, type PMItem } from '../processMap';
import { Card, PH_COL, PH_TXT, go, useAsync } from '../ui';

const ZONE: Record<string, { l: string; c: string }> = {
  pre: { l: 'No J68 funds', c: '#CFCBBF' }, rdte: { l: 'RDT&E funded (J68)', c: '#3F90CB' },
  transition: { l: 'Transition zone', c: '#CE0F3E' }, enterprise: { l: 'Enterprise / self-sustaining', c: '#F9B018' },
};

/** Orientation page: what each ESF stage is, who does what, what it takes to pass the gate, and what triggers an exit. */
export function ProcessMap({ initial }: { initial?: number }) {
  const meta = useMeta();
  const [sel, setSel] = useState<number>(initial ?? 0);
  const [doc, setDoc] = useState<string | null>(null);
  const [exitIdx, setExitIdx] = useState<number | null>(null);
  const { data: d } = useAsync(() => api(`/dashboard?fy=${meta.latestFy}`), []);
  const count = (ph: number) => d ? d.esf.filter((r: any) => r.esf_phase === ph && (ph === 5 ? r.esf_status === 'AT_SCALE' : ['ACTIVE', 'HOLD'].includes(r.esf_status))).reduce((a: number, r: any) => a + r.n, 0) : null;
  const s = STAGES[sel];
  const gateCrit = sel < 5 ? meta.criteria.filter(c => c.gate === sel) : [];

  const item = (it: PMItem, k: number) => (
    <div key={k} className={'pm-item ' + it.kind}>
      <span className="mk" aria-hidden="true">{it.kind === 'check' ? '✓' : it.kind === 'warn' ? '!' : '•'}</span>
      <span>{it.text}{it.docs?.map(dk => <button key={dk} className="doclink" onClick={() => setDoc(dk)} title="What is this document?">{dk === 'ST-Report' ? 'S&T report' : dk} ⓘ</button>)}</span>
    </div>
  );

  return (
    <>
      <div className="vhead">
        <div>
          <h2 className="vt">Process map — the project journey</h2>
          <div className="vsub">How a project moves from an idea to an enterprise capability: six stages, five gates, two value paths (A — WCF, B — POM).
            Select a stage to see what it is, who does what, what it takes to pass the gate, and what triggers an exit.</div>
        </div>
      </div>

      <div className="pm-track" role="tablist" aria-label="ESF stages">
        {STAGES.map((st, i) => (
          <button key={i} role="tab" aria-selected={sel === i} className={'pm-card' + (sel === i ? ' on' : '')} style={{ ['--ph' as any]: PH_COL[i] }} onClick={() => setSel(i)}>
            <span className="pm-lab">{st.label}</span>
            <span className="pm-ic" aria-hidden="true">{st.icon}</span>
            <span className="pm-nm">{st.name}</span>
            <span className="pm-fund">{st.funding}</span>
            <span className="pm-gate">{i < 5 ? `${st.gate} →` : '🏁 Success'}</span>
            {count(i) != null && <span className="pm-n" title="Live projects in this stage">{count(i)} live</span>}
          </button>
        ))}
      </div>
      <div className="pm-zones">
        {STAGES.map((st, i) => <span key={i} style={{ background: ZONE[st.zone].c }} title={ZONE[st.zone].l} />)}
      </div>
      <div className="legend" style={{ marginBottom: 14 }}>{Object.values(ZONE).map(z => <span key={z.l}><i style={{ background: z.c }} />{z.l}</span>)}</div>

      <Card title={<span style={{ color: PH_TXT[sel] }}>{s.icon} {s.title}</span>} right={
        <span className="pm-actions">
          {sel < 5 && <button className="btn sm ghost" onClick={() => setExitIdx(sel)}>{sel === 4 ? 'Descope criteria' : 'Exit criteria'}</button>}
          <button className="btn sm" onClick={() => go('#/phase/' + sel)}>Open {s.label} dashboard →</button>
        </span>}>
        <div className="pm-sub">{s.sub}</div>
        <div className="pm-stats">{s.stats.map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}</div>
        <div className="pm-cols">
          {s.sections.map(sec => (
            <div key={sec.t} className={'pm-sec' + (/co-sponsor/i.test(sec.t) ? ' spon' : /j68 role/i.test(sec.t) ? ' j68' : '')}>
              <div className="lbl">{sec.t}</div>
              {sec.items.map(item)}
            </div>
          ))}
        </div>
        {gateCrit.length > 0 && (
          <div className="pm-hub">
            <div className="lbl">How ESH enforces Gate {sel}</div>
            <div className="sub">A project in {s.label} can pass Gate {sel} only when each of these is closed with evidence on its record{gateCrit.some(c => c.non_waivable) ? '; ◆ items can never be waived' : ''}.</div>
            <ol>{gateCrit.map(c => <li key={c.id}>{c.text}{c.non_waivable && <b title="Non-waivable"> ◆</b>}</li>)}</ol>
          </div>
        )}
        <div className="pm-nav">
          <button className="link" disabled={sel === 0} onClick={() => setSel(sel - 1)}>← {sel > 0 ? STAGES[sel - 1].label : ''}</button>
          <button className="link" disabled={sel === 5} onClick={() => setSel(sel + 1)}>{sel < 5 ? STAGES[sel + 1].label : ''} →</button>
        </div>
      </Card>

      <div className="note" style={{ marginTop: 10 }}>Adapted from the Enterprise Scaling Framework v3.0 interactive guide (Toffler Associates draft). Gate criteria the Hub enforces are configured separately and may differ in wording.</div>

      {(doc || exitIdx != null) && (
        <div className="modal-bg" onClick={() => { setDoc(null); setExitIdx(null); }}>
          <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            {doc && DOCS[doc] && <>
              <h3>{DOCS[doc].title}</h3>
              <p className="pm-body">{DOCS[doc].body}</p>
              <div className="note"><b>Key details:</b> {DOCS[doc].meta}</div>
            </>}
            {exitIdx != null && <>
              <h3>{EXIT[exitIdx].title}</h3>
              <ul className="pm-exit">{EXIT[exitIdx].items.map(t => <li key={t}>{t}</li>)}</ul>
              <div className="note">{EXIT_NOTE}</div>
            </>}
            <div className="row"><button className="btn" onClick={() => { setDoc(null); setExitIdx(null); }}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
