/* Process map content: the project journey through the Enterprise Scaling Framework. Index = ESF phase 0..5. */

export type PMItem = { kind: 'check' | 'note' | 'warn'; text: string; docs?: string[] };
export type PMStage = {
  label: string; gate: string; icon: string; name: string; funding: string; zone: 'pre' | 'rdte' | 'transition' | 'enterprise';
  title: string; sub: string; stats: [string, string][]; sections: { t: string; items: PMItem[] }[];
};

const c = (text: string, docs?: string[]): PMItem => ({ kind: 'check', text, docs });
const n = (text: string, docs?: string[]): PMItem => ({ kind: 'note', text, docs });
const w = (text: string): PMItem => ({ kind: 'warn', text });

export const STAGES: PMStage[] = [
  {
    label: 'Stage 0', gate: 'Gate 0', icon: '🔍', name: 'Ideation & Intake', funding: 'No J68 funds', zone: 'pre',
    title: 'Stage 0 — Ideation & Intake', sub: 'Pre-funding · Problem scoping · Co-sponsor identification',
    stats: [['General duration', '≤ 90 days'], ['J68 funding', '$0'], ['Color of money', 'None'], ['Gate authority', 'J68 Director']],
    sections: [
      { t: 'To advance — Gate 0', items: [c('Functional co-sponsor named with signed LOI', ['LOI']), c('Problem scoped to DLA operational need'), c('Value path declared: Path A or Path B'),
        c('Rough order of magnitude lifecycle cost estimated'), c('No disqualifying program duplication confirmed')] },
      { t: 'J68 role at this stage', items: [n('J68 Director: reviews and approves intake package'), n('J68 PM: builds problem statement, identifies co-sponsor'), n('J68 PM: confirms no program duplication')] },
      { t: 'Co-sponsor role at this stage', items: [n('Sign LOI at SES level — verbal support is not sufficient', ['LOI']), n('Name a specific GS-15 or equivalent as point of contact'),
        n('Declare intended value path (Path A or Path B)'), n('Commit to monthly engagement through Phase I')] },
    ],
  },
  {
    label: 'Phase I', gate: 'Gate 1', icon: '🔬', name: 'Feasibility Study', funding: 'RDT&E · ~$100K', zone: 'rdte',
    title: 'Phase I — Feasibility Study', sub: 'Technical merit · Commercial potential · JHU-APL TRA',
    stats: [['General duration', '3–6 months'], ['Typical max funding', '~$100,000'], ['Color of money', 'RDT&E'], ['Gate authority', 'J68 Director + SES']],
    sections: [
      { t: 'Potential required deliverables', items: [c('Monthly contractor progress, status & management reports'), c('Vendor site visit to DLA facility'),
        c("DLA visit to vendor's commercial deployment"), c('JHU-APL TRA (all 5 components)', ['TRA']), c('Final Scientific & Technical Report', ['ST-Report'])] },
      { t: 'J68 role at this stage', items: [n('J68 PM: manages contract, coordinates TRA schedule'), n('J68 PM: facilitates site visits both directions'),
        n('J68 Director: chairs Gate 1 review, makes advance/exit decision')] },
      { t: 'Proposed TRA components (JHU-APL)', items: [n('CTE — Critical Technology Element identification'), n('CONOPS evaluation and operational review'),
        n('Capability gap assessment'), n('Design document review'), n('Requirements document review')] },
      { t: 'Co-sponsor role at this stage', items: [n('Facilitate vendor site visit to DLA facility'), n('Provide operational input to CONOPS review'),
        n('Attend Gate 1 review and reaffirm or withdraw commitment')] },
    ],
  },
  {
    label: 'Phase II', gate: 'Gate 2', icon: '⚙️', name: 'Prototype', funding: 'RDT&E · ~$1M', zone: 'rdte',
    title: 'Phase II — Prototype', sub: 'Systems engineering · Operational experiment · ROI quantification',
    stats: [['General duration', 'Up to 24 months'], ['Typical max funding', '~$1M'], ['Color of money', 'RDT&E'], ['Gate authority', 'J68 + J8 Finance']],
    sections: [
      { t: 'Proposed milestone reviews (SE process)', items: [c('SRR — System Requirements Review', ['SRR']), c('PDR — Preliminary Design Review', ['PDR']),
        c('CDR — Critical Design Review', ['CDR']), c('TRR — Test Readiness Review', ['TRR']), c('PRR — Product Readiness Review ★', ['PRR'])] },
      { t: 'J68 role at this stage', items: [n('J68 PM: chairs all SE milestone reviews'), n('J68 PM: develops ROI quantification model'),
        n('J68 PM: coordinates J8 Finance certification'), n('J68 Director + J8: Gate 2 advance/exit decision')] },
      { t: 'Financial path — named at PRR', items: [n('ROI quantified vs. DLA baseline — J8 must certify'), n('Path A: WCF rate structure drafted'),
        n('Path B: POM program line identified, PPBE timing confirmed'), w('No named path = Gate 2 is not cleared')] },
      { t: 'Co-sponsor role at this stage', items: [n('Reaffirm commitment at start of Phase II'), n('Declare financial path (A or B) — binding at PRR'),
        n('Begin J8 Finance engagement for rate or POM preparation'), n('Attend Gate 2 review')] },
    ],
  },
  {
    label: 'Phase III', gate: 'Gate 3 ★', icon: '🔑', name: 'Limited Deployment', funding: 'Bridge + co-fund', zone: 'transition',
    title: 'Phase III — Limited Deployment', sub: '★ The funding commitment gate — requires an SES-level signed commitment before Phase III begins',
    stats: [['General duration', '12–24 months'], ['Funding model', 'Bridge + co-fund'], ['Gate authority', 'SES / GOFO'], ['POM alignment', 'Required (Path B)']],
    sections: [
      { t: 'Before Phase III begins', items: [c('Path A: WCF rate committed in Annual Operating Budget'), c('Path B: POM submission confirmed and SES-signed'),
        c('J6 sandbox / production mirror connectivity active'), c('Contracting, Finance, RM, Operations formally documented'),
        c('SES co-sponsor signs Gate 3 commitment document'), c('ATO plan approved by J6 — or ATO in hand')] },
      { t: 'J68 role at this stage', items: [n('J68 Director: co-signs Gate 3 commitment document'), n('J68 PM: manages bridge contract (SE activities only)'),
        n('J68 PM: coordinates multi-site deployment with co-sponsor'), n('J68 PM: prepares Gate 4 handoff package')] },
      { t: 'Co-sponsor role at this stage', items: [n('SES: sign Gate 3 commitment document — non-delegable'), n('Provide co-funding per signed commitment'),
        n('Facilitate multi-site deployment at DLA facilities'), n('Manage real operational users during limited deployment'), n('Begin preparing for formal sustainment acceptance at Gate 4')] },
      { t: 'Funding transition behaviors', items: [c('J68 bridge: SE and integration testing activities only (RDT&E-eligible)'), c('Co-sponsor covers operational costs from their budget'),
        w('Operational costs on J68 RDT&E = fiscal law risk')] },
    ],
  },
  {
    label: 'Phase IV', gate: 'Gate 4', icon: '🤝', name: 'Enterprise Transition', funding: 'WCF / POM', zone: 'transition',
    title: 'Phase IV — Enterprise Transition', sub: 'Owner takes the wheel · J68 advisory only · 12–18 months',
    stats: [['General duration', '12–18 months'], ['Funding', 'WCF or POM'], ['J68 role', 'Advisory only'], ['New RDT&E', 'None']],
    sections: [
      { t: 'Gate 4 closeout criteria', items: [c('Owner formally accepts all program documentation and sustainment'), c('WCF customer orders active, OR POM program line executing'),
        c('Zero J68 financial obligations remain'), c('Lessons learned documented in portfolio knowledge base'), c('Annual review schedule agreed with operational owner')] },
      { t: 'J68 role at this stage', items: [n('Advisory only — no contractual or fiscal role'), n('Delivers comprehensive technical handoff package'), n('Closes portfolio entry upon Gate 4 confirmation')] },
      { t: 'Co-sponsor role at this stage', items: [n('Accept all technical documentation and design history'), n('Manage vendor relationships and contract modifications'),
        n('Execute WCF rate billing or POM program line management'), n('Submit annual performance data to J68 portfolio archive')] },
      { t: 'Descope option', items: [n('Partial enterprise accepted if full scope infeasible'), n('Narrower WCF scope or adjusted POM request'), n('Partial success formally credited and documented')] },
    ],
  },
  {
    label: 'Stage 5', gate: 'Success', icon: '🏁', name: 'Enterprise at Scale', funding: 'Self-sustaining', zone: 'enterprise',
    title: 'Stage 5 — Enterprise at Scale', sub: 'J68 closed · Self-sustaining · Annual reviews vs. the Gate 0 value declaration',
    stats: [['J68 role', 'None / archived'], ['Funding', 'WCF or appropriated'], ['Review cadence', 'Annual'], ['Benchmark', 'Gate 0 declaration']],
    sections: [
      { t: 'Path A — success indicators', items: [c('WCF customer orders meeting volume projections'), c('Stabilized rate sustaining operations at break-even'), c('External DoD / federal demand confirmed')] },
      { t: 'Path B — success indicators', items: [c('Cost avoidance realized and tracked vs. baseline'), c('Savings reflected in POM baseline for future cycles'), c('Annual reviews confirm sustained ROI')] },
      { t: 'J68 role at this stage', items: [n('None — portfolio entry fully archived')] },
      { t: 'Co-sponsor role at this stage', items: [n('Submit annual performance report to J68 archive'), n('Manage rate reviews (Path A) or POM adjustments (Path B)')] },
    ],
  },
];

/** Exit (or descope) triggers at the gate that closes each stage; index = gate 0..4. */
export const EXIT: { title: string; items: string[] }[] = [
  { title: 'Exit criteria — Gate 0', items: ['No functional directorate willing to name a co-sponsor POC', 'Value path (A or B) cannot be articulated', 'Problem is outside DLA mission scope', 'Funded program already addresses the need'] },
  { title: 'Exit criteria — Gate 1 (Phase I)', items: ['JHU-APL TRA reveals fundamental technical barriers', 'CONOPS assessed as operationally unrealistic for DLA', 'Value hypothesis fails against operational data', 'Co-sponsor withdraws after Phase I results'] },
  { title: 'Exit criteria — Gate 2 (Phase II)', items: ['PRR fails — prototype does not meet requirements', 'ROI insufficient to justify Phase III investment', 'No financial path (A or B) identified or feasible', 'DLA architecture integration proves infeasible', 'Co-sponsor withdraws'] },
  { title: 'Exit criteria — Gate 3 (Phase III)', items: ['No funding owner commits by POM deadline', 'Multi-site deployment reveals unresolvable integration failures', 'Co-sponsor formally declines ownership', 'J6/ATO approval denied and unresolvable'] },
  { title: 'Descope criteria — Gate 4', items: ['Owner cannot absorb full enterprise scope', 'WCF volume insufficient to sustain full deployment', 'POM program line approved at reduced funding level'] },
];
export const EXIT_NOTE = 'A documented project exit at any gate is the framework working as designed — not a failure. It redirects investment to projects with genuine co-sponsor commitment.';

/** Documents referenced by the stages. */
export const DOCS: Record<string, { title: string; body: string; meta: string }> = {
  LOI: { title: 'LOI — Letter of Intent', meta: 'Required at: Gate 0 passage · Authority: SES-level co-sponsor · Cannot be delegated',
    body: "A signed document formalizing the co-sponsor's commitment to the project at Stage 0. The LOI must be signed at SES level — not by a staff officer or designee. It commits the co-sponsor to monthly engagement through Phase I, attendance at Gate 1, and a declaration of which value path (A or B) the directorate intends to pursue. A verbal endorsement or email exchange does not constitute a LOI for Gate 0 purposes." },
  TRA: { title: 'TRA — Technology Readiness Assessment (JHU-APL)', meta: 'Required at: Phase I completion (Gate 1) · Conducted by: JHU-APL independently · All 5 components must pass',
    body: "An independent technical evaluation conducted by Johns Hopkins University Applied Physics Laboratory (JHU-APL). Five components are required, and all five must be satisfactory for Gate 1 passage: (1) CTE identification — identifies Critical Technology Elements and their development risk. (2) CONOPS review — evaluates whether the deployment concept is operationally realistic for DLA. (3) Capability gap assessment — documents gaps between current state and the proposed solution. (4) Design document review — evaluates technical design completeness and coherence. (5) Requirements document review — confirms requirements are complete, testable, and traceable. JHU-APL's independence is critical — they are not the vendor, not J68, and not the co-sponsor." },
  'ST-Report': { title: 'Final Scientific & Technical Report', meta: 'Required at: End of Phase I · Submitted by: Prime contractor · Reviewed by: J68 PM and JHU-APL',
    body: "The terminal Phase I deliverable. Documents the results of the feasibility study, the JHU-APL TRA findings, and provides recommendations for Phase II scope. The report should capture: the technical approach validated or invalidated, the CONOPS assessment, identified capability gaps and how Phase II will address them, and the vendor's recommended Phase II functional specification. This report is the primary evidence base for the Gate 1 decision." },
  SRR: { title: 'SRR — System Requirements Review', meta: 'Phase II milestone: First · Occurs: Early Phase II · Key question: Are requirements complete and testable?',
    body: 'The first of five required SE milestone reviews in Phase II. The SRR confirms that the system requirements are: complete (all functions documented), consistent (no contradictions), feasible (achievable within Phase II scope and budget), and testable (each requirement can be verified). A failed SRR typically indicates scope was not adequately defined during Phase I. The J68 PM chairs the SRR.' },
  PDR: { title: 'PDR — Preliminary Design Review', meta: 'Phase II milestone: Second · Key question: Does the design approach work and is it ready for detailed design?',
    body: 'The second SE milestone review. The PDR confirms the preliminary design approach satisfies requirements and is mature enough for detailed design. Key questions: Does the proposed architecture address all requirements? Are major design risks identified and mitigated? Is the preliminary design stable enough to begin detailed design work? A PDR failure typically means the design approach needs to be reconsidered before significant design investment is made.' },
  CDR: { title: 'CDR — Critical Design Review', meta: 'Phase II milestone: Third · Key question: Is the detailed design complete and ready for build? · Post-CDR changes are expensive',
    body: "The third SE milestone. CDR confirms the detailed design is complete, correct, and ready for development or fabrication. After CDR, design changes become expensive — this is the 'lock the design' gate. Key questions: Is every requirement traceable to a design element? Are all interfaces defined? Have all major risks been retired? CDR failure at this stage is costly because significant design work has been invested." },
  TRR: { title: 'TRR — Test Readiness Review', meta: 'Phase II milestone: Fourth · Key question: Is the test program ready to execute?',
    body: "The fourth SE milestone. TRR confirms the test program is ready to execute. Key questions: Is the test plan complete and approved? Is the test environment (including DLA's operational context) ready? Are acceptance criteria defined for every requirement? Are test tools and instrumentation in place? A TRR failure is often a scheduling or resources problem — the design may be ready but the test infrastructure is not." },
  PRR: { title: 'PRR — Product Readiness Review', meta: 'Phase II milestone: Terminal · Gate 2 trigger · J8 Finance certification required · Financial path declared here',
    body: 'The terminal Phase II milestone review and the trigger for the Gate 2 decision. PRR confirms the prototype is ready for limited operational deployment (Phase III). It is also the point where the financial path (A or B) must be formally declared. J8 Finance must certify the ROI quantification model at this review. Key questions: Does the prototype meet all requirements from the SRR? Has testing been completed satisfactorily? Is the ROI model certified? A PRR that passes in September misses the July–August POM window for Path B projects.' },
};
