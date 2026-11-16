import { api } from '../api';
import { useMeta } from '../App';
import { auditText } from '../auditText';
import { ErrorBox, Loading, Syn, go, useAsync } from '../ui';

export function Audit() {
  const meta = useMeta();
  const { data, error } = useAsync(() => api('/audit'), []);
  return (
    <>
      <h2 className="vt">Audit log</h2>
      <div className="vsub">Append-only record of every change, who made it, and the before/after values (hover a row for the raw record). Latest 200, newest first. Rows tagged SYNTHETIC are generated demo history.</div>
      <ErrorBox msg={error} />
      {!data ? <Loading /> : (
        <table className="list">
          <thead><tr><th>When</th><th>Who</th><th>Record</th><th>What changed</th></tr></thead>
          <tbody>{data.rows.map((a: any) => {
            const t = auditText(a, meta);
            return (
              <tr key={a.id} onClick={() => a.entity === 'project' && go('#/p/' + a.entity_id)} title={JSON.stringify({ before: a.before, after: a.after })}>
                <td className="mono sm nowrap">{new Date(a.at).toLocaleString()}</td>
                <td className="sm">{a.actor}</td>
                <td className="mono code">{a.entity_id}</td>
                <td className="sm">{t.head} <Syn on={a.synthetic} />{t.detail && <div className="muted" style={{ marginTop: 2 }}>{t.detail}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </>
  );
}
