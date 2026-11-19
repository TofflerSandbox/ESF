import { useEffect, useState } from 'react';
import { api } from '../api';
import { ErrorBox, Loading, d10, useAsync } from '../ui';

type Section = { key: string; h: string; body: string; sources: string[]; status: 'filled' | 'partial' | 'gap' | 'owner' };
type Draft = { kind: string; title: string; esh_id: string; assembledAt: string; note: string; ownerLabel?: string; sections: Section[]; gaps: string[] };

/** The documents the Hub can draft from the record. Each files on the project as its own document type. */
export type DraftKind = 'cm-impact' | 'cm-statement' | 'transition-plan';
const KINDS: Record<DraftKind, { name: string; docType: string; docTitle: string; file: string; banner: string; saved: string }> = {
  'cm-impact': {
    name: 'Change Management Impact Assessment', docType: 'CM_IMPACT', docTitle: 'CM Impact Assessment (drafted from the record)', file: 'CM Impact Assessment',
    banner: 'DRAFT FOR J1 REVIEW', saved: 'CM Impact Assessment filed on the project. Mark the criterion met once J1 has reviewed and signed it.',
  },
  'cm-statement': {
    name: 'Change management statement', docType: 'CM_STATEMENT', docTitle: 'Change management statement for the DCG brief (drafted from the record)', file: 'CM Statement',
    banner: 'DRAFT FOR J1 APPROVAL', saved: 'Change management statement filed on the project. Mark the criterion met once J1 has approved it for the brief.',
  },
  'transition-plan': {
    name: 'Transition plan', docType: 'TRANSITION_PLAN', docTitle: 'Transition plan (drafted from the record)', file: 'Transition Plan',
    banner: 'DRAFT FOR PM REVIEW AND SPONSOR COMMITMENT', saved: 'Transition plan filed on the project. The sponsor still commits the pathway, and the criterion stays open until it is met.',
  },
};

const STATUS: Record<Section['status'], { l: string; cls: string }> = {
  filled: { l: 'Filled from the record', cls: 'ok' }, partial: { l: 'Partly filled', cls: 'part' }, gap: { l: 'Needs input', cls: 'gap' }, owner: { l: 'For the owner to complete', cls: 'own' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A Word-readable document (HTML saved as .doc) from the edited sections: bullets become lists, other lines paragraphs. */
function toWordHtml(d: Draft, bodies: Record<string, string>, by: string, banner: string) {
  const block = (text: string) => {
    const out: string[] = []; let list: string[] = [];
    const flush = () => { if (list.length) { out.push('<ul>' + list.map(li => `<li>${esc(li)}</li>`).join('') + '</ul>'); list = []; } };
    for (const line of text.split('\n')) { const t = line.trim(); if (!t) continue; if (/^[•\-*]\s*/.test(t)) list.push(t.replace(/^[•\-*]\s*/, '')); else { flush(); out.push(`<p>${esc(t)}</p>`); } }
    flush(); return out.join('');
  };
  return `<html><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1C2434} h1{font-family:Cambria,serif;font-size:18pt;color:#16233C;margin:0 0 4pt}
h2{font-family:Cambria,serif;font-size:13pt;color:#16233C;margin:14pt 0 4pt} .meta{color:#525B69;font-size:9.5pt} .draft{color:#B30838;font-weight:bold;font-size:9pt;letter-spacing:1pt}
</style></head><body><p class="draft">${esc(banner)}</p><h1>${esc(d.title)}</h1>
<p class="meta">${esc(d.esh_id)} · Assembled from the Enterprise Scaling Hub record on ${d10(d.assembledAt)} · Edited by ${esc(by)} · ${esc(d.note)}</p>
${d.sections.map(s => `<h2>${esc(s.h)}</h2>${block(bodies[s.key] ?? s.body)}`).join('')}</body></html>`;
}
const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };

/**
 * A document drafted from the project record (CM Impact Assessment, transition plan). The owner edits each section, then downloads
 * it or files it on the project. Filing never closes a criterion or commits anything: the owner still does that.
 */
export function DraftPanel({ kind, esh, canSave, me, onClose, onSaved }: { kind: DraftKind; esh: string; canSave: boolean; me: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const K = KINDS[kind];
  const { data: d, error } = useAsync(() => api<Draft>(`/projects/${esh}/drafts/${kind}`), [esh, kind]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (d) setBodies(Object.fromEntries(d.sections.map(s => [s.key, s.body]))); }, [d]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  const fileName = `${K.file} - ${esh}.doc`;
  const download = () => {
    if (!d) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toWordHtml(d, bodies, me, K.banner)], { type: 'application/msword' }));
    a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const save = async () => {
    if (!d) return;
    setBusy(true); setErr(null);
    try {
      await api(`/projects/${esh}/documents`, { method: 'POST', body: { doc_type: K.docType, title: K.docTitle, file_name: fileName, mime: 'application/msword', data: b64(toWordHtml(d, bodies, me, K.banner)) } });
      onSaved(K.saved);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="dr-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dr" role="dialog" aria-label={`Draft: ${K.name}`}>
        <div className="dr-h">
          <div>
            <div className="dr-k">DRAFT FROM THE RECORD</div>
            <b>{d?.title ?? K.name}</b>
            {d && <span>{d.note}</span>}
          </div>
          <button className="as-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dr-body">
          <ErrorBox msg={error} />
          {!d && !error && <Loading />}
          {d && d.gaps.length > 0 && (
            <div className="dr-gaps"><b>The record is missing {d.gaps.length === 1 ? 'one thing' : `${d.gaps.length} things`} that would make this draft complete:</b>
              <ul>{d.gaps.map(g => <li key={g}>{g}</li>)}</ul></div>
          )}
          {d && d.gaps.length === 0 && <div className="dr-ok">The record has what this template needs. Review each section, then complete the owner’s section.</div>}
          {d?.sections.map(s => (
            <div key={s.key} className={'dr-sec ' + STATUS[s.status].cls}>
              <div className="dr-sh"><b>{s.h}</b><span className="dr-st">{s.status === 'owner' ? d.ownerLabel ?? STATUS.owner.l : STATUS[s.status].l}</span></div>
              {s.sources.length > 0 && <div className="dr-src">{s.sources.map(x => <span key={x}>{x}</span>)}</div>}
              <textarea value={bodies[s.key] ?? ''} onChange={e => setBodies({ ...bodies, [s.key]: e.target.value })}
                rows={Math.min(14, Math.max(3, (bodies[s.key] ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0) + 1))} aria-label={s.h} />
            </div>
          ))}
        </div>
        <div className="dr-f">
          {err && <span className="dr-err">{err}</span>}
          <span className="muted">Assembled locally from the record; nothing leaves this machine.</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={download} disabled={!d}>Download as Word</button>
          {canSave && <button className="btn" onClick={save} disabled={!d || busy}>{busy ? 'Filing…' : 'File on the project'}</button>}
        </div>
      </div>
    </div>
  );
}
