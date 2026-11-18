import { api, setUserId } from '../api';
import { useMeta } from '../App';
import { Card, ErrorBox, Loading, useAsync } from '../ui';

type Open = { l: string; href: string; as?: { id: number; name: string } | null };
type Step = { n: string; finding?: string; title: string; show: string; say: string; open: Open[] };

/** Opens a page, switching the acting user first when the step is about another role's view. */
function go(o: Open, meId: number) {
  if (o.as && o.as.id !== meId) { setUserId(o.as.id); location.hash = o.href; location.reload(); return; }
  location.hash = o.href;
}

/**
 * The demo script: the five findings of the organizational assessment, in the order a leader would ask about them,
 * told through one project's journey (the local flagship) from intake to the enterprise.
 */
export function Tour() {
  const meta = useMeta();
  const { data: s, error } = useAsync(() => api<any>('/demo/story'), []);
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  const F = s.flagship, P = s.predecessor, S = s.sponsor, seats = s.seats;
  const fp = (tab = '') => (F ? `#/p/${F.esh_id}${tab ? '/' + tab : ''}` : '#/projects');
  const fname = F ? F.title : 'the flagship project';
  const admin = seats.admin, sponsorSeat = S?.user ?? null;

  const steps: Step[] = [
    { n: 'Open', title: 'From spreadsheets to one system of record',
      show: 'The Dashboard: the whole portfolio from the annual data call, where every number opens the projects behind it. Search reaches any project in a keystroke (Ctrl+K), and What’s new shows what changed since the last visit.',
      say: 'Today this lives in workbooks that are rebuilt every year. Here, the data call updates a living record, and each person sees what is waiting on them.',
      open: [{ l: 'Dashboard', href: '#/', as: admin }, { l: 'My work (J68)', href: '#/me', as: admin }] },
    { n: '1', finding: 'R&D is seen as J68’s portfolio', title: 'Enterprise ownership',
      show: `Act as ${S ? S.org : 'a sponsoring organization'}: its own queue of signatures, pathways to commit and benefit reports. Then the scorecard that puts each sponsor’s record side by side.`,
      say: 'Sponsors sign the gate criteria that are theirs. When a project stalls on a sponsor, it shows, by name of organization, not by person.',
      open: [{ l: 'My work', href: '#/me', as: sponsorSeat }, ...(S ? [{ l: 'Its organization page', href: `#/org/${S.org_id}`, as: sponsorSeat }] : []), { l: 'Ownership scorecard', href: '#/orgs', as: admin }] },
    { n: '2', finding: 'Work gets duplicated', title: 'Duplication caught at intake',
      show: `On Overlaps, check a new idea against everything the portfolio has done${s.intakeIdea ? ` (try “${s.intakeIdea}”)` : ''}. Then the flagship’s Related work: ${P ? `its predecessor ${P.esh_id} is linked as a follow-on` : 'its lineage is linked'}, so the history travels with it.`,
      say: 'Gate 0 now requires every likely overlap to be linked or dismissed. Nobody has to remember what was tried five years ago.',
      open: [{ l: 'Overlaps', href: '#/overlaps', as: admin }, { l: 'Flagship: related work', href: fp('overview'), as: admin }] },
    { n: '3', finding: 'ROI isn’t tracked from the start', title: 'ROI from the onset',
      show: `${fname}: the value case declared at intake, how the claim moved at each gate, and which parts J8 certified. Then the prospective ROI across the active portfolio.`,
      say: 'Every gate freezes the value claim, so we can see whether promises grow or shrink, and a project carries one value story from idea to fielding.',
      open: [{ l: 'Flagship: value', href: fp('value'), as: admin }, { l: 'Return on investment', href: '#/roi', as: admin }] },
    { n: '4', finding: 'Projects reach the end without a transition plan', title: 'A committed transition plan',
      show: `The flagship’s Gate 3 scorecard: the sponsor’s signed funding commitment and a committed pathway that names the receiving organization, the funding line and the POM year. Then the Funding page: who must clear Gate 2 before the POM window.`,
      say: 'No named receiver, no funding line, no Gate 3. Transition stops being a hope at the end and becomes a condition of moving forward.',
      open: [{ l: 'Flagship: Gate 3', href: fp('gate'), as: admin }, { l: 'Flagship: funding & transition', href: fp('funding'), as: admin }, { l: 'Funding & transition', href: '#/funding', as: admin }] },
    { n: '5', title: 'The decision',
      show: 'Act as the gate authority: My work lists what is ready for a decision and which board it is docketed on. Open the decision brief and print it for the board book.',
      say: 'The board sees the same record the PM and sponsor worked from. The decision is recorded once, on the project, with its rationale.',
      open: [{ l: 'My work', href: '#/me', as: seats.authority }, { l: 'Gate boards', href: '#/boards', as: seats.authority }, ...(F ? [{ l: 'Decision brief', href: `#/brief/${F.esh_id}`, as: seats.authority }] : [])] },
    { n: '6', finding: 'R&D loses sight of ROI after transition', title: 'Working with the customer after transition',
      show: `Stage 5 as the enterprise sees it: which organization runs each capability now, how it is paid for, and whether it delivers. ${s.fielded ? `Then a fielded project behind plan (${s.fielded.esh_id}): monthly benefit reports, and reviews at 6, 12 and 24 months with actions owned by R&D and the operator.` : ''}`,
      say: 'R&D’s job doesn’t end at Gate 4. The operator reports benefit, J8 validates it, and we sit down together when it falls behind.',
      open: [{ l: 'Stage 5', href: '#/phase/5', as: admin }, ...(s.fielded ? [{ l: 'A fielded project behind plan', href: `#/p/${s.fielded.esh_id}/gate`, as: admin }] : []), { l: 'Realization reviews', href: '#/realization', as: admin }] },
    { n: 'Close', title: 'Where this goes next',
      show: 'What is real, what is synthetic, what production needs, and the decisions that would move it forward.',
      say: 'This is a working prototype on synthetic data. The ask is a pilot on the next data call, so we can measure the real portfolio.',
      open: [{ l: 'Where this goes next', href: '#/next', as: admin }] },
  ];

  const stories = meta.scenarios;
  return (
    <div className="tour">
      <h2 className="vt">Guided tour</h2>
      <div className="vsub">A 20-minute walkthrough of how the Hub answers the organizational assessment, following {F ? <a href={fp()}>{F.esh_id}</a> : 'one project'} from intake to the enterprise. Each step opens the right page as the right role.</div>
      {!F && <div className="banner warn">No flagship project is configured. Set <span className="mono">demo.gate3Flagship</span> in esh.config.local.json and run the synthetic data again.</div>}

      <ol className="tour-steps">
        {steps.map(st => (
          <li key={st.n} className="tour-step">
            <div className="tour-n">{st.n}</div>
            <div className="tour-b">
              {st.finding && <div className="tour-f">Assessment finding: <b>{st.finding}</b></div>}
              <h3>{st.title}</h3>
              <p><span className="tour-k">Show</span>{st.show}</p>
              <p className="tour-say"><span className="tour-k">Say</span>{st.say}</p>
              <div className="tour-open">
                {st.open.map(o => (
                  <button key={o.l} className="btn sm" onClick={() => go(o, meta.me.id)}>{o.l}{o.as && o.as.id !== meta.me.id ? <span className="tour-as"> · as {o.as.name}</span> : null}</button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {stories.length > 0 && (
        <Card title="More stories" right={<span className="hint">projects whose lifecycle data is synthetic</span>} pad={false}>
          <div className="scen">
            {stories.map((sc, i) => (
              <a key={sc.ord} href={'#/p/' + sc.esh_id} className="sc">
                <div className="n">{i + 1}</div>
                <div><b>{sc.title}</b><div className="code mono">{sc.esh_id} · {sc.project_title}</div><p>{sc.story}</p><div className="lf">Look for: {sc.look_for}</div></div>
              </a>
            ))}
          </div>
        </Card>
      )}
      <div className="fine">Before a live demo: as the J68 admin, turn on demo markers and use <b>Reset demo</b> so every walkthrough starts from the same data.</div>
    </div>
  );
}
