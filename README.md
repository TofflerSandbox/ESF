# ESH — Enterprise Scaling Hub

Portfolio software for running R&D projects through a stage-gate scaling framework (ESF), from intake to a capability fielded at scale.
ESH imports an organization's existing project list, suggests where each project sits in the lifecycle, and then becomes the system of record for:
- gate decisions and criteria evidence
- funding hand-offs and value cases
- transition pathways
- workforce readiness for the change
- a full audit trail

> **Status: working prototype by Toffler Associates.** It runs locally on an embedded database. It ships with **no customer data**: the database (`data/`), source workbooks (`*.xlsx`) and per-customer settings (`esh.config.local.json`) are git-ignored.

## Run it

Needs Node 20+.

```bash
npm install
npm run import            # read the source workbook (path in esh.config.json / esh.config.local.json) into data/pg
npm run synth             # optional: add tagged synthetic data so every feature has something to show
npm run dev               # API on :8787 + web on http://127.0.0.1:5173
```

`npm run build` then `npm start` serves the app and API from one process on http://127.0.0.1:8787.

- **Re-import:** stop the server, then run `npm run import -- --reset`. This wipes everything, including phase reviews, gates and audit history.
- **One process at a time:** the embedded database allows only one, so never run the importer or `synth` while the server is up.

## Configuration

`esh.config.json` holds the defaults: the database folder, port, workbook path, sheet names per fiscal year, and the "as of" date for rules.
Put customer-specific settings in `esh.config.local.json`, which is git-ignored and overrides the defaults:

```json
{
  "workbook": "C:/path/to/master-project-list.xlsx",
  "personAliases": { "jon smiht": "Jon Smith" },
  "demo": { "flagshipTitle": "Exact project title for the workforce walkthrough", "keepUnseeded": ["PROJECT TITLE LEFT FOR A LIVE DEMO"] }
}
```

## What's in the app

| Area | What it does |
|---|---|
| **Dashboard** | Portfolio KPIs, status by data call, ESF phase mix, program and priority heat map, attention and decision queues |
| **Pipeline** | Board by ESF phase with search; each phase opens its own dashboard (metrics, gate readiness, full project list) |
| **Projects** | Searchable, filterable list with an *Ask the portfolio* sidebar: plain-English questions ("anything on augmented reality?", "additive manufacturing in Phase II") answered by a local concept search with ranked, explained matches. It runs on the machine; no project data is sent out. Each project record has gate scorecard, value case, funding, pathways, points of contact, workforce impact, history and audit trail, plus a printable decision brief |
| **Programs** | The portfolio by program (SUBNET, AM, BATTNET…): an index comparing every program, and one page per program with projects by phase, projected value by type of return, gate and transition readiness, sponsors, exits, who pays by year, and fielded delivery. Program codes are links throughout the app |
| **Organizations** | An *enterprise scorecard* for the DCG (each sponsoring organization's share of the cost, commitments signed, committed pathways, fielded benefit against plan, what needs attention), then one page per organization: its ownership record and to-do list, live projects by role, phase and program, R&D focal points, project POCs |
| **Sponsor seats** | Each DLA field activity and J-code that sponsors projects has a seat (a position, not a person). Sponsors sign their own ESF commitments (LOI, reaffirmations, SES funding commitment, operational acceptance) and commit transition pathways; "My organization" lists what is waiting on them |
| **Workforce & change** | Changes coming to the workforce, the change-management role at each gate, aggregate leader readiness (Kotter's 8 Accelerators) with CSV export, adoption after go-live |
| **Return on investment** | Two lenses. *Prospective*: the active portfolio's risk-adjusted projected return. *Realized*: projects in the enterprise tracked against the value case frozen at Gate 4 (monthly sponsor reports, J8-validated quarterly; share of plan, back per dollar, payback, who has stopped reporting). An *Ask about ROI* bar answers plain-English questions across both, locally |
| **Senior leader decisions** | The 11 SES/GOFO policy decisions from the ESF guide, with options, stakes, owner and status; record the decision when made |
| **Gates / Gate boards** | Gate analysis, plus running the boards themselves: schedule a board, auto-build the docket from ready projects, decide in the meeting with every gate rule enforced, minutes, actions, a printable briefing book |
| **Realization reviews** | After Gate 4 (a Hub proposal): the operational owner reports benefit monthly and J8 validates it; reviews at 6, 12 and 24 months record an outcome (on track, corrective action, rebaseline, value proven) and actions owned by R&D, the sponsor, J8 or J1. Fielded project records show the baseline, monthly delivery, reviews and actions |
| **Value from onset** | Every gate decision freezes the value claim and cost to date, so each record shows how the promise moved; the ROI page shows promise vs delivery (Gate 2 promise, Gate 4 baseline, run rate) and the return on full cost (spent + PM-estimated cost to complete) |
| **Funding & transition** | Transition readiness for every Phase II–IV project (no pathway, declared, committed but incomplete, committed, running) with receiver, funding line and POM year; Path A (WCF) vs Path B (POM), the POM-window countdown, WCF rate status, funding by year, and a fiscal-law risk register |
| **Stakeholder obligations** | The ESF obligation matrix (who owes what at each gate), tracked live against every project, with co-sponsor accountability by organization |
| **Data call** | The annual data call run in the Hub: PMs update and submit, J68 approves or returns, closing the call publishes approved updates as that year's data |
| **Documents** | Required documents by gate, filed against the criterion they close; upload on any project (10 MB, stored under `data/files`), completeness check for passed gates |
| **Administration** | *Phase review*: onboarding queue to confirm imported projects' phases (admin). *Audit log*: append-only record of every change (admin, gate authority) |

### Roles (stand-in for single sign-on groups; switch with "Acting as")
| Role | Can |
|---|---|
| Portfolio admin | Everything; confirms ESF phases in Phase review |
| Gate authority | Records gate decisions; reads the audit log |
| Change management (J1) | Closes the change-management criteria at Gates 0, 2, 3 and 4 |
| Program manager | Edits **own** projects: data-call fields, criteria evidence, value case, funding, pathways |
| Viewer | Read only |

### Rules enforced server-side
- **Gate decisions**
  - A gate decision requires a confirmed phase.
  - A gate can PASS only when every criterion is closed. Non-waivable criteria can never be WAIVED, and change-management criteria can be closed only by that role.
  - Marking a criterion MET requires an evidence reference.
- **Transition pathways** only advance DECLARED → COMMITTED → ACTIVE (rule R6). The PM or sponsor declares; only the sponsoring organization commits, and a commitment must name the receiving organization, the funding line and (Path B) the POM year.
- **Sponsor commitments** are signed only by the sponsoring organization's seat (or the admin); nobody waives their own commitment, so only a gate authority can.
- **Gate decisions** freeze a value snapshot; passing Gate 4 also freezes the realized-value baseline and schedules realization reviews. Benefit reports come from the operational owner; a J8-validated month is locked; corrective action needs an owned action.
- **Stage 5 obligations** (Hub proposal): R&D, the owner, J8 and J1 keep tracked obligations after transition, where the ESF ends J68's role at Gate 4.
- **Hub proposals to the ESF** are flagged criteria the Hub adds for DLA to accept or reject. The first: Gate 3 requires a committed pathway with all three named; it is checked against the pathway and only a gate authority can waive it.
- **Audit trail:** every write goes to the append-only `audit_event` table with before and after values.
- **Alerts:**
  - Project ready for a gate decision.
  - Contract period (PoP) lapsed but status still Ongoing.
  - PoP ending within 180 days.
  - No sponsor, or no priority alignment.
  - Anti-Deficiency exposure: R&D money with a PoP past the Gate 4 decision.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Web | React 18 + Vite, hash routes | `web/src` |
| API | Fastify 5 + zod validation | `server/api.ts` |
| Database | PostgreSQL via embedded PGlite; the same SQL runs on managed Postgres | `server/db/schema.sql` |
| Import / ETL | ExcelJS streaming reader → clean → normalize → load | `server/import/` |
| Domain rules | Phases, gate criteria, Kotter accelerators, org aliases, phase suggestion | `server/domain.ts` |
| Synthetic data | Gap fill, lifecycle, workforce and contacts generators | `server/synth/` |

### Import pipeline
1. **Read** the yearly list sheets and alignment sheets with a streaming reader. The full reader hangs on workbooks with sheet-wide drop-down lists.
2. **Map headers** by normalized name; per-year column quirks are handled in `fieldMap`.
3. **Match projects across years** by normalized title and assign a stable `ESH-####` ID. Each year's row is kept verbatim as a snapshot.
4. **Normalize organizations** through an alias table, split multi-value cells, and drop N/A / TBD / None values.
5. **Link priorities:** the alignment "X" columns become a priority taxonomy per fiscal year.
6. **Suggest an ESF phase** for every project from status, transition fields and time elapsed. Each suggestion is reviewed in Phase review.
7. **Write a report** to `data/import-report.json`: per-year counts, unmatched alignment rows, new organization names to review, and row issues.

### Synthetic data (`npm run synth`)
Source data covers the project inventory, not the lifecycle, so the generator fills in the rest for demos:
- **Inventory gaps:** blank status, PoP, sponsor, alignment and so on. A report of the gaps goes to `data/gap-report.json`; `--gaps` produces the report only.
- **Lifecycle:** confirmed phases, phase history, gate decisions, evidence, funding, value cases, pathways and an audit history.
- **Demo scenarios.**
- **Workforce impact, aggregate leader readiness, focal points and project POCs.** Contacts use invented names, `.example` emails and fictional 555-01xx phone numbers.

Every generated value is flagged in the database and tagged **SYNTHETIC** in the UI. `npm run synth -- --remove` restores the original data exactly, and `--seed=N` gives a different but repeatable draw.

## Roadmap
- **Single sign-on:** replace the header stand-in with OIDC (Entra ID / agency IdP), mapping groups to roles.
- **Evidence uploads:** move criteria from text references to files in object storage.
- **Organization merge UI:** a screen for reviewing and merging spelling variants.
- **Deployment:** a containerized build on managed Postgres.
- **Configurable framework:** gate criteria, phases and roles held as tenant configuration instead of code.
