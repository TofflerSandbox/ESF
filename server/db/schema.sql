-- ESH schema v0.1 — PostgreSQL (runs on embedded PGlite for the local demo; portable to managed Postgres)

-- ───────────── reference data ─────────────
CREATE TABLE IF NOT EXISTS element (
  code text PRIMARY KEY,                 -- LOG R&D | MANTECH | SBIR
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS program (
  code text PRIMARY KEY,                 -- AM, AME, AMTR, ... SM, SBIR
  name text NOT NULL,
  element_code text REFERENCES element(code)
);

CREATE TABLE IF NOT EXISTS org (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,             -- canonical
  kind text NOT NULL DEFAULT 'OTHER'     -- DLA_MSC | DLA_JCODE | SERVICE | ACADEMIA | INDUSTRY | OSD | OTHER
);

CREATE TABLE IF NOT EXISTS org_alias (
  alias_key text PRIMARY KEY,            -- normalized raw spelling
  raw text NOT NULL,
  org_id int NOT NULL REFERENCES org(id)
);

CREATE TABLE IF NOT EXISTS person (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- ───────────── portfolio (system of record) ─────────────
CREATE TABLE IF NOT EXISTS project (
  id serial PRIMARY KEY,
  esh_id text NOT NULL UNIQUE,           -- generated stable key (workbooks have none)
  title text NOT NULL,
  title_key text NOT NULL,               -- normalized title used for cross-year matching
  description text,
  element_code text REFERENCES element(code),
  program_code text REFERENCES program(code),
  pm_id int REFERENCES person(id),
  is_it boolean,
  in_artet boolean,
  environment text,
  charter text,
  status_code text,                      -- A..E (latest data call)
  pop_start date,
  pop_end date,
  okrs text,
  transition_phase text,
  transition_type text,
  dbx_type text,
  taxonomy text,
  capability text,
  first_fy int NOT NULL,
  last_fy int NOT NULL,
  -- ESF lifecycle state (captured going forward; initial value is a suggestion until confirmed)
  esf_phase int CHECK (esf_phase BETWEEN 0 AND 5),
  esf_status text CHECK (esf_status IN ('ACTIVE','HOLD','AT_SCALE','SUNSET','DESCOPED')),
  esf_source text CHECK (esf_source IN ('SUGGESTED','CONFIRMED')),
  esf_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_title_key ON project(title_key);
CREATE INDEX IF NOT EXISTS project_program ON project(program_code);

CREATE TABLE IF NOT EXISTS project_external_id (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  system text NOT NULL,                  -- SPM | CATS
  value text NOT NULL,
  PRIMARY KEY (project_id, system, value)
);

CREATE TABLE IF NOT EXISTS project_contract (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  number text NOT NULL,
  PRIMARY KEY (project_id, number)
);

CREATE TABLE IF NOT EXISTS project_org (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  org_id int NOT NULL REFERENCES org(id),
  role text NOT NULL,                    -- SPONSOR | STAKEHOLDER | TRANSITION_PARTNER | ACADEMIA | MILITARY | OSD_MII | VENDOR
  PRIMARY KEY (project_id, org_id, role)
);

-- ───────────── annual data call ─────────────
CREATE TABLE IF NOT EXISTS data_call (
  fy int PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'CLOSED'  -- OPEN | CLOSED
);

CREATE TABLE IF NOT EXISTS project_snapshot (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  fy int NOT NULL REFERENCES data_call(fy),
  source_sheet text NOT NULL,
  source_row int NOT NULL,
  status_code text,
  transition_phase text,
  pm_name text,
  raw jsonb NOT NULL,                    -- the row exactly as reported
  UNIQUE (project_id, fy)
);

CREATE TABLE IF NOT EXISTS priority (
  id serial PRIMARY KEY,
  fy int NOT NULL,
  owner text NOT NULL,                   -- Disposition | Distribution | Energy | Troop Support | Weapon Support | J1 | J3 | J6 | J7 | J8 | D-Code
  label text NOT NULL,
  raw_header text NOT NULL,
  ord int NOT NULL,
  UNIQUE (fy, raw_header)
);

CREATE TABLE IF NOT EXISTS project_priority (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  priority_id int NOT NULL REFERENCES priority(id),
  PRIMARY KEY (project_id, priority_id)
);

-- ───────────── ESF lifecycle ─────────────
CREATE TABLE IF NOT EXISTS phase_record (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  phase int NOT NULL CHECK (phase BETWEEN 0 AND 5),
  entered_at date NOT NULL,
  exited_at date
);

CREATE TABLE IF NOT EXISTS gate_decision (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  gate int NOT NULL CHECK (gate BETWEEN 0 AND 4),
  outcome text NOT NULL CHECK (outcome IN ('PASS','SUNSET','DESCOPE','HOLD')),
  decided_at date NOT NULL,
  authority text NOT NULL,
  rationale text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criterion_def (
  id serial PRIMARY KEY,
  gate int NOT NULL,
  ord int NOT NULL,
  text text NOT NULL,
  non_waivable boolean NOT NULL DEFAULT false,
  UNIQUE (gate, ord)
);

CREATE TABLE IF NOT EXISTS criterion_status (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  criterion_id int NOT NULL REFERENCES criterion_def(id),
  status text NOT NULL CHECK (status IN ('MET','PENDING','WAIVED')),
  evidence text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS funding_line (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  fy int NOT NULL,
  appropriation text NOT NULL,           -- RDT&E BA3 | RDT&E BA6 | O&M | WCF | Procurement
  source text NOT NULL,                  -- J68 R&D | sponsor org
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  pop_end date
);

CREATE TABLE IF NOT EXISTS value_case (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (path IN ('REVENUE','COST','RISK','PERFORMANCE')),
  is_primary boolean NOT NULL DEFAULT false,
  metric text NOT NULL,
  baseline text,
  projected text,
  annual_value numeric(14,2),
  narrative text,
  j8_certified boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS transition_pathway (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (path IN ('A_WCF','B_POM')),
  mechanism text NOT NULL,
  status text NOT NULL CHECK (status IN ('DECLARED','COMMITTED','ACTIVE')),
  committed_at date
);

-- ───────────── access & audit ─────────────
CREATE TABLE IF NOT EXISTS app_user (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('ADMIN','PM','AUTHORITY','VIEWER')),
  person_id int REFERENCES person(id)
);

CREATE TABLE IF NOT EXISTS audit_event (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_event(entity, entity_id);

-- ───────────── synthetic demo data (npm run synth) ─────────────
-- Every generated row is flagged so the UI can label it and `npm run synth -- --remove` can delete it.
ALTER TABLE project            ADD COLUMN IF NOT EXISTS esf_synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE phase_record       ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE gate_decision      ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE criterion_status   ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE funding_line       ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE value_case         ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE transition_pathway ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE audit_event        ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS demo_scenario (
  ord int PRIMARY KEY,
  esh_id text NOT NULL,
  title text NOT NULL,
  story text NOT NULL,
  look_for text NOT NULL
);

ALTER TABLE demo_scenario ADD COLUMN IF NOT EXISTS track text NOT NULL DEFAULT 'ESF';   -- ESF | J1

-- Gaps in the real inventory filled with synthetic values: one row per filled field, so the UI can tag it
-- and `npm run synth -- --remove` can put the blank back. Relationship fills carry their own synthetic flag.
CREATE TABLE IF NOT EXISTS project_fill (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  field text NOT NULL,                   -- a project column, or sponsor | stakeholder | transition_partner | contract | priority
  PRIMARY KEY (project_id, field)
);
ALTER TABLE project_org      ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE project_contract ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE project_priority ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;

-- ───────────── J1: workforce & change layer ─────────────
-- Production feeds (hypothesis): DCPDS (positions, series), LMS (training), DEOCS (climate),
-- the HCT Change Management Impact Assessment, and HCT's Enterprise Change Readiness Dashboard.
-- In the demo every row here is synthetic. People are pseudonymous: no names leave DCPDS.
ALTER TABLE criterion_def ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'J68';
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_role_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_role_check CHECK (role IN ('ADMIN','PM','AUTHORITY','VIEWER','J1'));

-- individual staffing profiles were dropped from the prototype (too much detail for J1's use)
DROP TABLE IF EXISTS staff_assignment;
DROP TABLE IF EXISTS staff;

-- ───────────── organization contacts ─────────────
-- R&D focal points: the 1–5 people each organization declares as its R&D points of contact.
-- Project POCs: who speaks for each sponsor / co-sponsor / transition partner on a given project.
CREATE TABLE IF NOT EXISTS org_person (
  id serial PRIMARY KEY,
  org_id int NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text NOT NULL,
  office text,
  email text,
  phone text,
  focal_rank int,                        -- 1..5 when declared an R&D focal point, else null
  synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS org_person_org ON org_person(org_id);

CREATE TABLE IF NOT EXISTS project_contact (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  org_person_id int NOT NULL REFERENCES org_person(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('SPONSOR','CO_SPONSOR','TRANSITION_PARTNER','STAKEHOLDER')),
  synthetic boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, org_person_id, role)
);

CREATE TABLE IF NOT EXISTS workforce_impact (
  id serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  org text NOT NULL,
  series text NOT NULL,
  series_title text NOT NULL,
  headcount int NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('NEW_TOOL','PROCESS','ROLE_REDESIGN')),
  training_course text,
  training_pct int,
  training_timing text CHECK (training_timing IN ('BEFORE_GO_LIVE','AT_GO_LIVE','AFTER_GO_LIVE')),
  union_notice text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (union_notice IN ('NOT_REQUIRED','PENDING','COMPLETE')),
  go_live date,
  synthetic boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS adoption_measure (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  day int NOT NULL,                      -- days after go-live: 30 | 90 | 180
  adoption_pct int NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, day)
);

CREATE TABLE IF NOT EXISTS senior_leader (
  id serial PRIMARY KEY,
  position text NOT NULL UNIQUE,         -- a position, not a person
  org text NOT NULL,
  synthetic boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS leader_readiness (
  leader_id int NOT NULL REFERENCES senior_leader(id) ON DELETE CASCADE,
  accelerator int NOT NULL CHECK (accelerator BETWEEN 1 AND 8),
  score int NOT NULL CHECK (score BETWEEN 1 AND 5),
  prior_score int,
  assessed_at date NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  PRIMARY KEY (leader_id, accelerator)
);

CREATE TABLE IF NOT EXISTS project_sponsor_leader (
  project_id int NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  leader_id int NOT NULL REFERENCES senior_leader(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, leader_id)
);

CREATE TABLE IF NOT EXISTS import_run (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  report jsonb NOT NULL
);
