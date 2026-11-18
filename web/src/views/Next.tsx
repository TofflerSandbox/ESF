import { useMeta } from '../App';
import { Card } from '../ui';

const FINDINGS: { f: string; does: string; see: [string, string][] }[] = [
  { f: 'R&D is seen as J68’s portfolio', does: 'Sponsors sign the gate criteria that are theirs and commit transition pathways in the Hub. Each organization has a page and a queue, and a scorecard compares sponsors’ records.',
    see: [['Organizations', '#/orgs'], ['My work', '#/me']] },
  { f: 'Work gets duplicated', does: 'Every project is compared with the whole inventory on title and description. Gate 0 requires likely overlaps to be linked or dismissed, and new ideas can be checked before they start.',
    see: [['Overlaps', '#/overlaps']] },
  { f: 'ROI isn’t tracked from the start', does: 'A value case is declared at intake, J8 certifies it at Gate 2, and every gate decision freezes the claim, so the promise can be traced from idea to fielding.',
    see: [['Return on investment', '#/roi']] },
  { f: 'Projects reach the end without a transition plan', does: 'Gate 3 requires a committed pathway naming the receiving organization, the funding line and the POM year. Funding risks and POM deadlines are tracked before they bite.',
    see: [['Funding & transition', '#/funding'], ['Gates', '#/gates']] },
  { f: 'R&D loses sight of ROI after transition', does: 'Operators report benefit monthly and J8 validates it. R&D and the operator review delivery at 6, 12 and 24 months, with actions owned by each side.',
    see: [['Stage 5', '#/phase/5'], ['Realization reviews', '#/realization']] },
];

const NEEDS: { area: string; items: string[] }[] = [
  { area: 'Access and security', items: ['Sign-in with CAC/PIV through DLA’s identity service; roles from the directory instead of the demo role switcher', 'Authority to operate on DLA infrastructure, with J6 as the hosting partner', 'CUI marking and handling for project records and documents'] },
  { area: 'Data', items: ['The annual data call run in the Hub, replacing the alignment workbooks', 'Funding lines and obligations fed from the financial system instead of typed in', 'Documents kept in DLA’s document repository and linked from each project'] },
  { area: 'People and process', items: ['A product owner and a sponsor for the Hub itself, from across the enterprise', 'Data stewards in each sponsoring organization', 'The Hub’s proposals to the ESF adopted, adjusted or dropped by the framework’s owners', 'Short role guides and training for PMs, sponsors, J8, J1 and gate authorities'] },
  { area: 'Operations', items: ['Hosting, backups and support on DLA infrastructure', 'Email or Teams reminders for what is waiting on each person', 'Section 508 accessibility review'] },
];

const PHASES: { n: string; t: string; scope: string; exit: string }[] = [
  { n: '1', t: 'Pilot', scope: 'One data call cycle with one major subordinate command and its J68 projects, on the current prototype.', exit: 'The data call runs in the Hub, gate decisions are recorded on it, and pilot users would rather use it than the workbook.' },
  { n: '2', t: 'Production', scope: 'Move to DLA infrastructure with CAC sign-in and the financial-system feed.', exit: 'Authority to operate granted; funding lines no longer typed by hand.' },
  { n: '3', t: 'Enterprise', scope: 'Every sponsoring organization, gate board and fielded capability.', exit: 'The workbooks retire, and every fielded capability reports benefit through the Hub.' },
];

const DECISIONS = [
  'Who sponsors the pilot, and which organization pilots it',
  'Who owns the Hub as a product, so it is the enterprise’s tool and not J68’s alone',
  'Which hosting platform J6 prefers, which sets the path to an authority to operate',
  'Which of the Hub’s proposals the framework’s owners want to adopt',
];

const PROPOSALS = [
  'Gate 0: likely overlaps linked or dismissed before intake',
  'Gate 3: a committed transition pathway with receiver, funding line and POM year',
  'After Gate 4: monthly benefit reports, J8 validation, and realization reviews at 6, 12 and 24 months',
  'J1 touchpoints at Gates 0, 2, 3 and 4 for workforce readiness',
];

/** For decision makers: what the prototype is, what it answers, what production needs, and what would move it forward. */
export function Next() {
  const meta = useMeta();
  const real = meta.lastImport?.totals.projects ?? 0;
  return (
    <div className="next">
      <h2 className="vt">Where this goes next</h2>
      <div className="vsub">The Enterprise Scaling Hub is a working prototype running on a synthetic, DLA-like portfolio. This page sets out what it is today, what it answers, and what it would take to run it on real data.</div>

      <div className="nx-status">
        <div className="nx-s gen"><span className="nx-l">Synthetic portfolio</span><b>{real.toLocaleString()} projects</b><span>modeled on the FY{meta.fys.map(f => String(f.fy).slice(2)).join(', FY')} alignment data calls: titles, descriptions, programs, PMs, sponsors, priorities and contracts. No figure in the prototype describes DLA&apos;s actual portfolio.</span></div>
        <div className="nx-s gen2"><span className="nx-l">Generated lifecycles</span><b>{meta.synthetic.projects.toLocaleString()} projects</b><span>gates, evidence, funding, value cases, pathways, benefit reports and workforce data, generated to show how the Hub behaves. Turn on demo markers to see each value tagged.</span></div>
        <div className="nx-s prop"><span className="nx-l">Proposed</span><b>{PROPOSALS.length} additions to the ESF</b><span>{PROPOSALS.join(' · ')}</span></div>
      </div>

      <Card title="How it answers the organizational assessment" pad={false}>
        <table className="nx-t">
          <thead><tr><th>Finding</th><th>What the Hub does</th><th>See it</th></tr></thead>
          <tbody>{FINDINGS.map(x => (
            <tr key={x.f}><td><b>{x.f}</b></td><td>{x.does}</td><td className="nx-see">{x.see.map(([l, h]) => <a key={h} href={h}>{l} →</a>)}</td></tr>
          ))}</tbody>
        </table>
      </Card>

      <div className="grid2">
        <Card title="What production needs">
          {NEEDS.map(n => <div key={n.area} className="nx-need"><div className="lbl">{n.area}</div><ul>{n.items.map(i => <li key={i}>{i}</li>)}</ul></div>)}
        </Card>
        <div className="colstack">
          <Card title="A path in three steps">
            <ol className="nx-ph">{PHASES.map(p => (
              <li key={p.n}><span className="nx-pn">{p.n}</span><div><b>{p.t}</b><p>{p.scope}</p><p className="nx-exit"><span>Done when</span>{p.exit}</p></div></li>
            ))}</ol>
          </Card>
          <Card title="Decisions that would move it forward">
            <ol className="nx-dec">{DECISIONS.map(d => <li key={d}>{d}</li>)}</ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
