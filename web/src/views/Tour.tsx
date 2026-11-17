import { useMeta } from '../App';
import { Card } from '../ui';

/** Guided tour for sales demos: scripted stories over the synthetic data. Only shown in demo mode. */
export function Tour() {
  const meta = useMeta();
  const groups: [string, string, string][] = [['ESF', 'Gate decisions and funding', 'Stories about how projects move through the gates.'], ['J1', 'Workforce and change', 'Stories about the people side of scaling a capability.']];
  return (
    <>
      <h2 className="vt">Guided tour</h2>
      <div className="vsub">Scripted walkthroughs for demos. Each story opens a real project record whose lifecycle data is synthetic. Turn demo mode off in the sidebar to hide this page.</div>
      {groups.map(([track, title, sub]) => {
        const list = meta.scenarios.filter(s => s.track === track);
        return list.length ? (
          <Card key={track} title={title} right={<span className="syn">SYNTHETIC</span>} pad={false}>
            <div className="note" style={{ padding: '10px 16px 0' }}>{sub}</div>
            <div className="scen">
              {list.map((s, i) => (
                <a key={s.ord} href={'#/p/' + s.esh_id} className="sc">
                  <div className="n">{i + 1}</div>
                  <div><b>{s.title}</b><div className="code mono">{s.esh_id} · {s.project_title}</div><p>{s.story}</p><div className="lf">Look for: {s.look_for}</div></div>
                </a>
              ))}
            </div>
          </Card>
        ) : null;
      })}
      {meta.scenarios.length === 0 && <div className="note">No demo stories. Run <span className="mono">npm run synth</span> to generate them.</div>}
    </>
  );
}
