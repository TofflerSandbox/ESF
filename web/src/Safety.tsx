import { Component, useState, type ReactNode } from 'react';
import { api } from './api';
import { d10 } from './ui';

/** Keeps one page's error from blanking the app: shows a calm message with a way back. Reset by giving it a new key per route. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Page error:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="oops" role="alert">
        <b>This page hit a problem.</b>
        <p>The rest of the Hub is fine. Reload this page, or go back to where you were.</p>
        <div className="oops-a">
          <button className="btn" onClick={() => location.reload()}>Reload page</button>
          <button className="btn ghost" onClick={() => history.back()}>Go back</button>
          <a className="btn ghost" href="#/">Dashboard</a>
        </div>
        <details><summary>Technical detail</summary><code>{this.state.error.message}</code></details>
      </div>
    );
  }
}

/** Demo controls for the J68 admin: undo everything since the baseline, or keep the current state as the new baseline. */
export function DemoControls({ savedAt }: { savedAt: string | null }) {
  const [ask, setAsk] = useState<'reset' | 'save' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (what: 'reset' | 'save') => {
    setBusy(true); setMsg(null);
    try {
      if (what === 'reset') {
        await api('/demo/reset', { method: 'POST' });
        // the question sidebars keep their history in this tab; a reset starts them empty too
        try { ['esh.assist', 'esh.roiask'].forEach(k => sessionStorage.removeItem(k)); } catch { /* storage unavailable */ }
        location.reload(); return;
      }
      const r = await api<any>('/demo/baseline', { method: 'POST' }); setMsg(`Baseline saved ${d10(r.savedAt)}.`);
    } catch (e: any) { setMsg(e.message); }
    setBusy(false); setAsk(null);
  };
  return (
    <span className="demo-ctl">
      {!ask && <>
        <button className="linkbtn" onClick={() => setAsk('reset')}>Reset demo</button>
        <button className="linkbtn" onClick={() => setAsk('save')}>Save current state as baseline</button>
        {savedAt && <span className="muted">Baseline from {d10(savedAt)}</span>}
      </>}
      {ask === 'reset' && <>Undo every change made since the baseline{savedAt ? ` (${d10(savedAt)})` : ''}? <button className="btn sm" disabled={busy} onClick={() => run('reset')}>{busy ? 'Resetting…' : 'Reset'}</button> <button className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button></>}
      {ask === 'save' && <>Make the current data the state that Reset returns to? <button className="btn sm" disabled={busy} onClick={() => run('save')}>{busy ? 'Saving…' : 'Save baseline'}</button> <button className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button></>}
      {msg && <span className="muted"> {msg}</span>}
    </span>
  );
}
