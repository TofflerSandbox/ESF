import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useMeta } from '../App';
import { auditText } from '../auditText';
import { ProjectDocuments } from './Documents';
import { HubProposal, SponsorTag } from './Ownership';
import { ProjectRealization, ProjectValueHistory } from './Realization';
import { RelatedWork } from './Overlap';
import { CmImpactDraft } from './Drafts';
import { Card, Chip, ErrorBox, Loading, Locator, OrgLink, PH_COL, PH_NAME, PH_SHORT, ROLE_LABEL, STATUS, STATUS_COL, Syn, VALUE_PATH, VP, d10, money, sup, useAsync } from '../ui';

/** Darker text versions of the status colours, readable on white. */
const STATUS_COL_TXT: Record<string, string> = { ...STATUS_COL, '?': 'var(--slate2)' };

const FILL_LABEL: Record<string, string> = {
  status_code: 'status', pop_start: 'PoP start', pop_end: 'PoP end', description: 'description', program_code: 'program', element_code: 'element',
  pm_id: 'program manager', transition_type: 'transition type', transition_phase: 'transition phase', charter: 'charter',
  sponsor: 'sponsor', stakeholder: 'stakeholders', transition_partner: 'transition partner', contract: 'contract number', priority: 'priority alignment',
};
const ROLE_L: Record<string, string> = { SPONSOR: 'Sponsors', STAKEHOLDER: 'Stakeholders', TRANSITION_PARTNER: 'Transition partners', ACADEMIA: 'Academia', MILITARY: 'Military services', OSD_MII: 'OSD MII', VENDOR: 'Vendors / industry' };

const TABS = [
  { k: 'overview', l: 'Overview' }, { k: 'gate', l: 'Gate' }, { k: 'value', l: 'Value' }, { k: 'funding', l: 'Funding & transition' },
  { k: 'people', l: 'People' }, { k: 'documents', l: 'Documents' }, { k: 'history', l: 'History' },
];

/** A project. `arg` is "ESH-0410" or "ESH-0410/<tab>", so each tab has its own link. */
export function Record({ esh: arg }: { esh: string }) {
  const [esh, tabArg] = arg.split('/');
  const meta = useMeta();
  const { data: r, error, reload } = useAsync(() => api(`/projects/${esh}`), [esh, meta.me.id]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [tabSel, setTabSel] = useState<string | null>(TABS.some(t => t.k === tabArg) ? tabArg : null);
  const [draftOpen, setDraftOpen] = useState(false);
  // once the tab bar sticks to the top, it carries the project's title
  useEffect(() => {
    const s = document.querySelector('.rtabs-sentinel'), bar = document.querySelector('.rtabs');
    if (!s || !bar) return;
    const io = new IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, [r]);
  if (error) return <><a className="bk" href="#/projects">← Projects</a><ErrorBox msg={error} /></>;
  if (!r) return <Loading />;
  const p = r.project;
  const act = async (path: string, method: string, body: unknown, okText: string) => {
    try { await api(`/projects/${esh}${path}`, { method, body }); setMsg({ ok: true, t: okText }); reload(); return true; }
    catch (e: any) { setMsg({ ok: false, t: e.message }); return false; }
  };
  const gate = Math.min(p.esf_phase ?? 0, 4);
  const crits = r.criteria.filter((c: any) => c.gate === gate);
  const live = p.esf_status === 'ACTIVE' || p.esf_status === 'HOLD';
  const program = meta.programs.find(x => x.code === p.program_code);
  const lastFy = Math.max(...r.snapshots.map((s: any) => s.fy));
  const gaps = [
    !p.status_code && 'status', !p.pop_start && 'PoP start', !p.pop_end && 'PoP end', !p.description && 'description',
    !r.orgs.some((o: any) => o.role === 'SPONSOR') && 'sponsor', !r.priorities.length && 'priority alignment',
    !p.transition_type && 'transition type', !r.contracts.length && 'contract number',
  ].filter(Boolean) as string[];
  const filled = new Set<string>(r.fills);
  const exited = p.esf_status === 'SUNSET' || p.esf_status === 'DESCOPED';
  const phIdx = p.esf_status === 'AT_SCALE' ? 5 : p.esf_phase ?? 0;
  const phCol = exited ? '#5E5A55' : PH_COL[phIdx];
  const sponsors = r.orgs.filter((o: any) => o.role === 'SPONSOR');
  const primary = r.values.find((v: any) => v.is_primary) ?? r.values[0];
  const F = (...fields: string[]) => (fields.some(f => filled.has(f)) ? <Syn /> : null);

  // tabs: the gate tab is the scorecard while live, realization once at scale, absent after an exit
  const gateTab = live ? `Gate ${gate}` : p.esf_status === 'AT_SCALE' ? 'Realization' : null;
  const tab = tabSel && (tabSel !== 'gate' || gateTab) ? tabSel : gateTab ? 'gate' : 'overview';
  const setTab = (k: string) => { setTabSel(k); history.replaceState(null, '', `#/p/${esh}/${k}`); };
  const closedN = crits.filter((c: any) => c.status !== 'PENDING').length;
  const badge = (k: string): string | number | null =>
    k === 'gate' && live ? `${closedN}/${crits.length}` : k === 'documents' ? (r.documents?.length || null) : null;
  // the single most useful next move for this project, in plain words
  const openOwn = crits.filter((c: any) => c.status === 'PENDING');
  const committed = r.paths.some((t: any) => ['COMMITTED', 'ACTIVE'].includes(t.status));
  const toGate = <button className="linkbtn" onClick={() => setTab('gate')}>Open the scorecard →</button>;
  const nextStep: ReactNode = !live ? null
    : p.esf_status === 'HOLD' ? <>On hold. Close the non-waivable criterion named in the hold, then return to the board. {toGate}</>
    : openOwn.length === 0 ? <>Every Gate {gate} criterion is closed. It is ready for the gate authority. {toGate}</>
    : <>{openOwn.length} of {crits.length} Gate {gate} criteria still open. Next: <b>{openOwn[0].text}</b>{openOwn[0].owner === 'SPONSOR' ? ' (the sponsor signs)' : openOwn[0].owner === 'J1' ? ' (J1 closes it)' : ''}.
      {gate >= 2 && !committed ? ' No transition pathway is committed yet.' : ''} {toGate}</>;

  const PathwaysCard = () => (
    <Card title="Transition pathways">
{r.paths.map((t: any) => {
              const missing = [!t.receiver_org_id && 'receiving organization', !t.funding_line && 'funding line', t.path === 'B_POM' && !t.pom_fy && 'POM year'].filter(Boolean) as string[];
              return (
                <div key={t.id} className="path">
                  <div className="row"><b>Path {t.path === 'A_WCF' ? 'A — WCF' : 'B — POM'}</b><span><Syn on={t.synthetic} /> <Chip c={t.status === 'ACTIVE' ? 'var(--spon)' : t.status === 'COMMITTED' ? 'var(--goldD)' : 'var(--slate)'}>{t.status}</Chip></span></div>
                  <div className="sub">{t.mechanism}</div>
                  <div className="path-facts">
                    <span><i>Receiver</i>{t.receiver ?? <em>not named</em>}</span>
                    <span><i>Funding line</i>{t.funding_line ?? <em>not named</em>}</span>
                    {t.path === 'B_POM' && <span><i>POM year</i>{t.pom_fy ? `FY${t.pom_fy}` : <em>not set</em>}</span>}
                  </div>
                  {t.status !== 'DECLARED' && missing.length > 0 && <div className="banner warn sm">Committed without a {missing.join(', ')}. It won't meet the Gate 3 Hub proposal until the sponsor completes it.</div>}
                  <div className="mono sub">{t.committed_at ? 'committed ' + d10(t.committed_at) + ' · ' : ''}{t.path === 'A_WCF' ? '18-mo rate-setting' : 'POM window Jul–Aug'}</div>
                  {r.canSponsor && t.status === 'DECLARED' && <CommitForm t={t} label="Commit (sponsor)" onSave={(b) => act(`/pathways/${t.id}/advance`, 'POST', { status: 'COMMITTED', ...b }, 'Pathway committed')} />}
                  {r.canSponsor && t.status === 'COMMITTED' && missing.length > 0 && <CommitForm t={t} label="Complete the commitment" onSave={(b) => act(`/pathways/${t.id}`, 'PATCH', b, 'Commitment completed')} />}
                  {r.canSponsor && t.status === 'COMMITTED' && missing.length === 0 && <button className="btn sm ghost" onClick={() => act(`/pathways/${t.id}/advance`, 'POST', { status: 'ACTIVE' }, 'Pathway active')}>Mark active (receiver is running it)</button>}
                  {!r.canSponsor && t.status === 'DECLARED' && <div className="note sm">Only the sponsoring organization can commit this pathway.</div>}
                </div>
              );
            })}
            {r.paths.length === 0 && <div className="note">No pathway declared.</div>}
            {(r.canEdit || r.canSponsor) && <PathForm onSave={(b) => act('/pathways', 'POST', b, 'Pathway declared')} />}
            <div className="note">The PM or sponsor declares a path; only the sponsor commits it, naming the receiving organization, the funding line and (Path B) the POM year. Committed fields are locked.</div>
          </Card>
  );
  const RecordCard = () => (
    <Card title="Record" right={r.canEdit ? <EditToggle p={p} onSave={(b) => act('', 'PATCH', b, 'Project updated')} /> : <span className="mono">read only</span>}>
      <dl className="kv">
        <dt>Description</dt><dd>{p.description ?? '—'} {F('description')}</dd>
        <dt>Program mgr</dt><dd>{r.pm?.name ?? '—'} {F('pm_id')}</dd>
        <dt>Program</dt><dd>{p.program_code ? <a className="proglink" href={'#/program/' + p.program_code}>{program ? `${program.name} (${program.code})` : p.program_code}</a> : '—'} · {p.element_code ?? '—'} {F('program_code', 'element_code')}</dd>
        <dt>Status</dt><dd>{p.status_code ? `${p.status_code} · ${STATUS[p.status_code]}` : '—'} {F('status_code')}</dd>
        <dt>PoP</dt><dd>{d10(p.pop_start)} → {d10(p.pop_end)} {F('pop_start', 'pop_end')}</dd>
        <dt>Charter</dt><dd>{p.charter ?? '—'} {F('charter')}</dd>
        <dt>Contracts</dt><dd className="mono">{r.contracts.length ? r.contracts.map((c: any) => <span key={c.number}>{c.number} <Syn on={c.synthetic} /> </span>) : '—'}</dd>
        <dt>External IDs</dt><dd className="mono">{r.ext.map((x: any) => `${x.system} ${x.value}`).join(', ') || '—'}</dd>
        <dt>Transition</dt><dd>{[p.transition_phase, p.transition_type].filter(Boolean).join(' · ') || '—'} {F('transition_phase', 'transition_type')}</dd>
        {p.environment && <><dt>Environment</dt><dd>{p.environment}{p.is_it ? ' · IT' : ''}{p.in_artet ? ' · in ARTET' : ''}</dd></>}
        {p.okrs && <><dt>OKRs</dt><dd className="mono">{p.okrs}</dd></>}
        {p.dbx_type && <><dt>D-BX type</dt><dd>{p.dbx_type}</dd></>}
        {p.taxonomy && <><dt>Taxonomy</dt><dd>{p.taxonomy}</dd></>}
        {p.capability && <><dt>Capability</dt><dd>{p.capability}</dd></>}
      </dl>
    </Card>
  );
  const DataCallHistory = () => (
    <Card title="Data-call history — as reported each year">
      <table className="gh-tbl"><thead><tr><th>FY</th><th>STATUS</th><th>TRANSITION</th><th>PM</th><th>SOURCE</th></tr></thead>
        <tbody>{r.snapshots.map((s: any) => (
          <tr key={s.fy}><td className="mono">FY{s.fy}</td><td>{s.status_code ? `${s.status_code} · ${STATUS[s.status_code]}` : '—'}</td><td>{s.transition_phase ?? '—'}</td><td>{s.pm_name ?? '—'}</td>
            <td><details><summary className="mono">{s.source_sheet} r{s.source_row}</summary><dl className="kv raw">{Object.entries(s.raw).map(([k, v]) => <Frag key={k}><dt>{k}</dt><dd>{String(v)}</dd></Frag>)}</dl></details></td></tr>
        ))}</tbody></table>
    </Card>
  );

  return (
    <>
      <a className="bk" href="#/projects">← Projects</a>
      <div className="rhead" style={{ ['--ph' as any]: phCol }}>
        <div style={{ minWidth: 0 }}>
          <div className="code">{p.esh_id} · {p.program_code ? <a className="proglink" href={'#/program/' + p.program_code}>{program ? `${program.name} (${program.code})` : p.program_code}</a> : 'No program'} · {p.element_code ?? '—'} · in data calls {r.snapshots.map((s: any) => 'FY' + String(s.fy).slice(2)).join(', ')}</div>
          <h2>{p.title}</h2>
          <div className="facts">
            <a className="fact phase" href={exited ? '#/exits' : '#/phase/' + phIdx} title={p.esf_source === 'SUGGESTED' ? 'Suggested from workbook data — not yet confirmed' : 'Open this phase'}
              style={{ background: phCol, color: phIdx === 5 && !exited ? '#16233C' : '#fff' }}>
              <span className="fl">ESF phase{p.esf_source === 'SUGGESTED' ? ' · suggested' : ''}</span>
              <span className="fv">{exited ? `${p.esf_status === 'SUNSET' ? 'Sunset' : 'Descoped'} at ${PH_SHORT[phIdx]}` : PH_SHORT[phIdx]}{p.esf_status === 'HOLD' ? ' · on hold' : ''}</span>
              <span className="fs">{exited ? 'Managed exit' : PH_NAME[phIdx]}</span>
            </a>
            <div className="fact sponsor">
              <span className="fl">Sponsor{sponsors.length > 1 ? 's' : ''}</span>
              <span className="fv">{sponsors.length ? sponsors.map((o: any, i: number) => <span key={o.id}>{i > 0 && <span className="sep"> · </span>}<a href={'#/org/' + o.id}>{o.name}</a>{o.synthetic && <span className="synmini" title="Synthetic: filled because the data call left it blank">S</span>}</span>) : <span className="muted">Not named</span>}</span>
              <span className="fs">Owns the problem and the transition</span>
            </div>
            {primary && (
              <a className="fact value" href="#/roi" style={{ ['--vc' as any]: VALUE_PATH[primary.path].c }}>
                <span className="fl">Value path</span>
                <span className="fv">{VALUE_PATH[primary.path].l}</span>
                <span className="fs">{primary.annual_value ? `${money(primary.annual_value)} a year` : 'Not quantified'}{primary.j8_certified ? ' · J8 certified' : ''}</span>
              </a>
            )}
            <div className="fact plain">
              <span className="fl">Data-call status</span>
              <span className="fv" style={{ color: STATUS_COL_TXT[p.status_code ?? '?'] }}>{p.status_code ? STATUS[p.status_code] : 'Not reported'}</span>
              <span className="fs">{p.pop_end ? `Contract ends ${d10(p.pop_end)}` : 'No contract end date'}</span>
            </div>
            {p.esf_synthetic && <Syn />}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Locator phase={p.esf_phase} status={p.esf_status} w={250} />
          <div style={{ marginTop: 8 }}><button className="btn" onClick={() => (location.hash = '#/brief/' + esh)}>Generate decision brief</button></div>
        </div>
      </div>

      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'err')} onClick={() => setMsg(null)}>{msg.t}</div>}
      {draftOpen && <CmImpactDraft esh={esh} me={meta.me.name} canSave={r.canJ1 || r.canEdit} onClose={() => setDraftOpen(false)}
        onSaved={(t) => { setDraftOpen(false); setMsg({ ok: true, t }); reload(); }} />}
      {filled.size > 0 && (
        <div className="banner gap dm">
          <Syn /> <b>Filled with synthetic values</b> because the FY{lastFy} data call left them blank: {[...filled].map(f => FILL_LABEL[f] ?? f).join(', ')}.
          Each filled value is tagged below.
        </div>
      )}
      {gaps.length > 0 && (
        <div className="banner gap">
          <b>Still not reported in the FY{lastFy} data call:</b> {gaps.join(', ')}. The PM updates these in the next data call{r.canEdit ? <> (you can use <i>update for data call</i> under Record)</> : ''}.
        </div>
      )}
      {p.esf_source === 'SUGGESTED' && (
        <div className="banner warn">
          <b>ESF phase not yet confirmed.</b> Suggested <b>{PH_SHORT[p.esf_phase]} · {p.esf_status}</b> — {p.esf_reason}.
          {r.canTriage ? <TriageForm p={p} onSave={(b) => act('/triage', 'POST', b, 'ESF phase confirmed')} /> : <span> A J68 admin confirms phases in Phase review.</span>}
        </div>
      )}

      {meta.me.role === 'SPONSOR' && r.canSponsor && (() => {
        const toSign = live ? crits.filter((c: any) => c.owner === 'SPONSOR' && c.status === 'PENDING') : [];
        const toCommit = r.paths.filter((t: any) => t.status === 'DECLARED' || (t.status === 'COMMITTED' && (!t.receiver_org_id || !t.funding_line || (t.path === 'B_POM' && !t.pom_fy))));
        return (
          <div className="banner own">
            <b>Your organization sponsors this project.</b>{' '}
            {toSign.length || toCommit.length
              ? <>Waiting on you: {toSign.map((c: any) => `Gate ${c.gate} criterion ${c.ord} (${c.text})`).join('; ')}{toSign.length && toCommit.length ? '; ' : ''}{toCommit.length ? `${toCommit.length} pathway${toCommit.length === 1 ? '' : 's'} to commit or complete` : ''}.</>
              : 'Nothing is waiting on your organization at this gate.'}
          </div>
        );
      })()}

      <div className="rtabs-sentinel" aria-hidden="true" />
      <div className="rtabs" role="tablist" aria-label="Project sections">
        <span className="rtabs-t" title={p.title}><span className="mono">{p.esh_id}</span> {p.title}</span>
        {TABS.filter(t => t.k !== 'gate' || gateTab).map(t => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
            {t.k === 'gate' ? gateTab : t.l}{badge(t.k) != null && <span className="rtabs-n">{badge(t.k)}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="rgrid">
          <div className="colstack">
            {nextStep && <Card title="Next step"><div className="nextstep">{nextStep}</div></Card>}
            <RelatedWork esh={p.esh_id} />
            <Card title="Organizations">
              {Object.keys(ROLE_L).map(role => {
                const os = r.orgs.filter((o: any) => o.role === role);
                return os.length ? <div key={role} className="orgrow"><span className="lbl">{ROLE_L[role]}</span><span>{os.map((o: any) => <span key={o.id}><OrgLink id={o.id} name={o.name} chip />{o.synthetic && <Syn />}</span>)}</span></div> : null;
              })}
              {r.orgs.length === 0 && <div className="note">No organizations reported in the data call: sponsor, stakeholder and partner columns were blank.</div>}
            </Card>
            <Card title="Priority alignment">
              {r.priorities.length === 0 ? <div className="note">Not aligned to any MSC / J-code priority in the alignment data call.</div> :
                [...new Set(r.priorities.map((x: any) => x.fy))].map(fy => (
                  <div key={String(fy)} className="orgrow"><span className="lbl">FY{String(fy)}</span>
                    <span>{r.priorities.filter((x: any) => x.fy === fy).map((x: any) => <span key={x.id}><a className="org" href={`#/projects?fy=${fy}&priority=${x.id}`}>{x.owner}: {x.label}</a>{x.synthetic && <Syn />}</span>)}</span></div>
                ))}
            </Card>
          </div>
          <div className="colstack">
            <RecordCard />
          </div>
        </div>
      )}

      {tab === 'gate' && (
        <div className="rgrid one">
          {live && (
            <Card title={`Gate ${gate} scorecard — ${crits.filter((c: any) => c.status !== 'PENDING').length}/${crits.length} closed`}
              right={r.criteria && crits.every((c: any) => c.status === 'MET' || (c.status === 'WAIVED' && !c.non_waivable)) ? <b style={{ color: 'var(--spon)' }}>READY FOR AUTHORITY</b> : <span className="mono">IN WORK</span>}>
              {crits.map((c: any) => {
                const own = c.owner === 'J1' ? r.canJ1 : c.owner === 'SPONSOR' ? r.canSponsor : r.canEdit;
                const sponsorish = c.owner === 'SPONSOR' || c.proposal;
                // documents the Hub can draft from the record (the J1 CM Impact Assessment at Gate 2)
                const drafts = c.owner === 'J1' && c.gate === 2 && c.ord === 6;
                return <CriterionRow key={c.id} c={c} canClose={own} canWaive={sponsorish ? r.canDecide : own && !c.non_waivable}
                  canEdit={(own || (sponsorish && r.canDecide)) && p.esf_source === 'CONFIRMED'} onSave={(b) => act(`/criteria/${c.id}`, 'PUT', b, 'Criterion updated')}
                  onDraft={drafts ? () => setDraftOpen(true) : undefined} />;
              })}
              {p.esf_source !== 'CONFIRMED' && <div className="note">Criteria can be worked once the phase is confirmed.</div>}
              {r.canDecide && p.esf_source === 'CONFIRMED' && <GateForm gate={gate} onSave={(b) => act('/gates', 'POST', b, 'Gate decision recorded')} />}
            </Card>
          )}

          {p.esf_status === 'AT_SCALE' && <ProjectRealization esh={p.esh_id} />}
        </div>
      )}

      {tab === 'value' && (
        <div className="rgrid one">
          <Card title="Value case — why this creates ROI for DLA" id="vcase">
            {r.values.length === 0 && <div className="note">No value case recorded. The workbooks don't carry one; it is declared at Stage 0 and certified by J8 at Gate 2.</div>}
            {r.values.map((v: any) => (
              <div key={v.id} className="vcase" style={{ borderLeftColor: VP[v.path].c }}>
                <div className="row"><b style={{ color: VP[v.path].c }}>{VP[v.path].l}{v.is_primary ? ' — primary' : ''} <Syn on={v.synthetic} /></b><span className="mono">{v.annual_value ? money(v.annual_value) + '/yr' : ''}</span></div>
                {v.narrative && <p>{v.narrative}</p>}
                <table className="gh-tbl"><thead><tr><th>MEASURE</th><th>BASELINE</th><th>PROJECTED</th><th>J8</th></tr></thead>
                  <tbody><tr><td>{v.metric}</td><td>{v.baseline ?? '—'}</td><td>{v.projected ?? '—'}</td><td>{v.j8_certified ? 'certified' : 'PM estimate'}</td></tr></tbody></table>
              </div>
            ))}
            {r.canEdit && <ValueForm onSave={(b) => act('/value-cases', 'POST', b, 'Value case added')} />}
            <ProjectValueHistory key={r.gates.length} esh={p.esh_id} />
          </Card>
        </div>
      )}

      {tab === 'funding' && (
        <div className="rgrid">
          <div className="colstack">
          <Card title="Funding — the handoff" right={<span><Chip c="var(--j68D)" bg="var(--j68Bg)">J68</Chip> <Chip c="var(--spon)" bg="var(--sponBg)">Sponsor</Chip></span>}>
            {r.funding.length === 0 ? <div className="note">No funding lines. The workbooks carry contract numbers but no obligations by FY/appropriation; enter them here (later: feed from the financial system).</div> : (
              <table className="gh-tbl"><thead><tr><th>FY</th><th>APPROPRIATION</th><th>SOURCE</th><th>AMOUNT</th><th>POP END</th></tr></thead>
                <tbody>{r.funding.map((f: any) => <tr key={f.id}><td className="mono">FY{String(f.fy).slice(2)}</td><td>{f.appropriation}</td>
                  <td style={{ color: /^J68/i.test(f.source) ? 'var(--j68D)' : 'var(--spon)' }}>{f.source}</td><td className="money">{money(f.amount)}</td><td className="mono">{d10(f.pop_end)} <Syn on={f.synthetic} /></td></tr>)}</tbody></table>
            )}
            {r.canEdit && <FundingForm onSave={(b) => act('/funding', 'POST', b, 'Funding line added')} />}
          </Card>
          </div>
          <div className="colstack">
          <PathwaysCard />
          </div>
        </div>
      )}

      {tab === 'people' && (
        <div className="rgrid">
          <div className="colstack"><Workforce r={r} /></div>
          <div className="colstack">
          <Card title="Points of contact" right={r.contacts.some((c: any) => c.synthetic) ? <Syn /> : undefined}>
            <div className="people">
              <div className="person"><div className="lblr">Program manager (J68)</div><div className="nm">{r.pm?.name ?? '—'}</div><div className="sub">From the data call</div></div>
              {r.contacts.map((c: any, i: number) => (
                <div key={i} className="person">
                  <div className="lblr">{ROLE_LABEL[c.role]} · <OrgLink id={c.org_id} name={c.org} /></div>
                  <div className="nm">{c.name}{c.focal_rank != null && <span className="tagmini" title="Declared R&D focal point for this organization">R&D FOCAL POINT</span>}</div>
                  <div className="sub">{c.title}</div>
                  <div className="mono sub">{c.email} · {c.phone}</div>
                </div>
              ))}
            </div>
            {r.contacts.length === 0 && <div className="note">No sponsor or transition partner was reported in the data call, so there is no one to list.</div>}
          </Card>
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="rgrid one">
          <ProjectDocuments r={r} onChange={(t, ok = true) => { setMsg({ ok, t }); if (ok) reload(); }} />
        </div>
      )}

      {tab === 'history' && (
        <div className="rgrid">
          <div className="colstack">
          <Card title="Project history">
            <ul className="tl">
              {[...r.phases.map((x: any) => ({ d: x.entered_at, s: x.synthetic, t: <>Entered {PH_SHORT[x.phase]}{x.exited_at ? ` (exited ${d10(x.exited_at)})` : ''}</> })),
                ...r.gates.map((g: any) => ({ d: g.decided_at, s: g.synthetic, t: <><b>Gate {g.gate} — {g.outcome}</b> · {g.authority}{g.rationale ? ': ' + g.rationale : ''}</> }))]
                .sort((a, b) => new Date(a.d).getTime() - new Date(b.d).getTime()).map((e, i) => <li key={i}><span className="d">{d10(e.d)}</span><span>{e.t} <Syn on={e.s} /></span></li>)}
            </ul>
          </Card>
          <DataCallHistory />
          </div>
          <div className="colstack">
          <Card title="Audit trail">
            {r.audit.length === 0 ? <div className="note">No changes since import.</div> : (
              <ul className="tl">{r.audit.map((a: any) => {
                const t = auditText(a, meta);
                return <li key={a.id}><span className="d">{d10(a.at)}</span><span title={JSON.stringify({ before: a.before, after: a.after })}>{t.head} <Syn on={a.synthetic} /><br />
                  <span className="sub">{t.detail}{t.detail ? ' · ' : ''}<span className="muted">{a.actor}</span></span></span></li>;
              })}</ul>
            )}
          </Card>
          </div>
        </div>
      )}
    </>
  );
}

const Frag = ({ children }: { children: ReactNode }) => <>{children}</>;

const J1_TOUCH: [number, string][] = [[0, 'Screening & staffing plan'], [2, 'Readiness check'], [3, 'CM statement (DCG brief)'], [4, 'Workforce absorption']];
const CHANGE_L: Record<string, string> = { NEW_TOOL: 'New tool', PROCESS: 'Process change', ROLE_REDESIGN: 'Role redesign' };
const TIMING_L: Record<string, string> = { BEFORE_GO_LIVE: 'before go-live', AT_GO_LIVE: 'at go-live', AFTER_GO_LIVE: 'after go-live' };

/** J1's view of one project: where J1 comes in, who the change reaches, who is staffed, and sponsor readiness. */
function Workforce({ r }: { r: any }) {
  const p = r.project, w = r.workforce;
  const gate = p.esf_status === 'AT_SCALE' ? 5 : Math.min(p.esf_phase ?? 0, 4);
  const exited = p.esf_status === 'SUNSET' || p.esf_status === 'DESCOPED';
  const j1 = r.criteria.filter((c: any) => c.owner === 'J1');
  const empty = !w.impacts.length && !w.adoption.length;
  const syn = w.impacts.some((i: any) => i.synthetic) || w.adoption.some((a: any) => a.synthetic);
  return (
    <Card title="Workforce & change (J1)" right={<span>{syn && <Syn />} <a href="#/j1">J1 view →</a></span>}>
      <div className="j1strip">
        {J1_TOUCH.map(([g, l]) => {
          const c = j1.find((x: any) => x.gate === g);
          const st = !c ? '—' : c.status === 'MET' ? 'MET' : c.status === 'WAIVED' ? 'NOT ASSESSED' : g < gate || exited ? 'MISSED' : g === gate ? 'IN WORK' : 'UPCOMING';
          const cls = { MET: 'ok', 'NOT ASSESSED': 'na', MISSED: 'bad', 'IN WORK': 'now', UPCOMING: 'up', '—': 'up' }[st];
          return <div key={g} className={'tp ' + cls} title={c?.evidence ?? ''}><span className="g">G{g}</span><b>{l}</b><span className="s">{st}</span></div>;
        })}
      </div>
      {empty && <div className="note">{(p.esf_phase ?? 0) < 2 && !exited
        ? 'Who the change reaches is recorded from Phase II, when J1 runs the CM Impact Assessment for the Gate 2 readiness check.'
        : 'No workforce impact recorded for this project.'}</div>}

      {w.impacts.length > 0 && (<>
        <div className="lbl">Who the change reaches</div>
        <table className="gh-tbl"><thead><tr><th>ORG</th><th>OCCUPATIONAL SERIES</th><th>PEOPLE</th><th>CHANGE</th><th>TRAINING</th><th>UNION NOTICE</th><th>GO-LIVE</th></tr></thead>
          <tbody>{w.impacts.map((i: any) => (
            <tr key={i.id}><td className="sm">{i.org}</td><td className="sm">{i.series} {i.series_title}</td><td className="mono">{sup(i.headcount)}</td><td className="sm">{CHANGE_L[i.change_type]}</td>
              <td className="sm" style={{ color: i.training_timing === 'AFTER_GO_LIVE' ? 'var(--red)' : undefined }} title={i.training_course}>{i.training_pct}% · {TIMING_L[i.training_timing] ?? '—'}</td>
              <td className="sm">{i.union_notice === 'NOT_REQUIRED' ? '—' : i.union_notice === 'PENDING' ? <b style={{ color: 'var(--goldD)' }}>pending (+30–60 days)</b> : 'complete'}</td>
              <td className="mono sm">{d10(i.go_live)}</td></tr>
          ))}</tbody></table>
      </>)}

      {w.adoption.length > 0 && (<>
        <div className="lbl">Adoption after go-live</div>
        <div className="adopt">{w.adoption.map((a: any) => (
          <div key={a.day}><span className="mono">{a.day} days</span><span className="track"><span style={{ width: `${a.adoption_pct}%`, background: a.adoption_pct < 50 ? 'var(--red)' : a.adoption_pct < 70 ? 'var(--gold)' : 'var(--spon)' }} /></span><b className="mono">{a.adoption_pct}%</b></div>
        ))}</div>
      </>)}
    </Card>
  );
}

function TriageForm({ p, onSave }: { p: any; onSave: (b: any) => Promise<boolean> }) {
  const [phase, setPhase] = useState<number>(p.esf_phase ?? 0);
  const [status, setStatus] = useState<string>(p.esf_status ?? 'ACTIVE');
  const [note, setNote] = useState('');
  return (
    <div className="inline-form">
      <select value={phase} onChange={e => { const v = Number(e.target.value); setPhase(v); if (v === 5) setStatus('AT_SCALE'); else if (status === 'AT_SCALE') setStatus('ACTIVE'); }}>
        {PH_SHORT.map((s, i) => <option key={i} value={i}>{s}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value)}>{(phase === 5 ? ['AT_SCALE'] : ['ACTIVE', 'HOLD', 'SUNSET', 'DESCOPED']).map(s => <option key={s}>{s}</option>)}</select>
      <input placeholder="Note (source, e.g. PMR Mar-26)" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn sm" onClick={() => onSave({ phase, status, ...(note ? { note } : {}) })}>Confirm phase</button>
    </div>
  );
}

function CriterionRow({ c, canEdit, canClose = canEdit, canWaive = canEdit && !c.non_waivable, onSave, onDraft }: { c: any; canEdit: boolean; canClose?: boolean; canWaive?: boolean; onSave: (b: any) => Promise<boolean>; onDraft?: () => void }) {
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(c.status);
  const [ev, setEv] = useState(c.evidence ?? '');
  const col = c.status === 'MET' ? ['var(--spon)', 'var(--sponBg)'] : c.status === 'WAIVED' ? ['var(--slate)', '#EDEBE4'] : ['var(--goldD)', 'var(--goldBg)'];
  const options = ['PENDING', ...(canClose ? ['MET'] : []), ...(canWaive && !c.non_waivable ? ['WAIVED'] : [])];
  const pathwayCrit = c.proposal && c.gate === 3;
  return (
    <div className={'crit' + (c.non_waivable ? ' hard' : '') + (c.owner === 'SPONSOR' ? ' sp' : '')}>
      <span className="st" style={{ color: col[0], background: col[1] }}>{c.status}</span>
      <span className="tx">
        <b>{c.ord}. {c.text}{c.non_waivable && <span className="hardtag">NON-WAIVABLE</span>}{c.owner === 'J1' && <span className="j1tag" title="Closed by J1 Human Capital Transformation">J1</span>}
          {c.owner === 'SPONSOR' && <SponsorTag />}{c.proposal && <HubProposal />}
          {c.gate === 0 && c.ord === 5 && <span className="proptag" title="Hub proposal: met only when every likely overlap in the portfolio is linked or dismissed (see Related work)">CHECKED AGAINST THE PORTFOLIO</span>}</b>
        {c.evidence ? <>Evidence: {c.evidence} <span className="muted">· {c.updated_by}</span> <Syn on={c.synthetic} /></>
          : c.owner === 'SPONSOR' ? 'Awaiting the sponsoring organization’s signature.' : 'Awaiting evidence or signature.'}
        {edit && (
          <span className="inline-form">
            <select value={status} onChange={e => setStatus(e.target.value)}>{options.map(s => <option key={s} value={s}>{s === 'MET' && c.owner === 'SPONSOR' ? 'MET (sign)' : s}</option>)}</select>
            <input placeholder={pathwayCrit ? 'Filled from the committed pathway' : status === 'WAIVED' ? 'Why it is waived (required)' : c.owner === 'SPONSOR' ? 'Signature reference (memo #, date, signer position)' : 'Evidence reference (doc #, date, signer)'} value={ev} onChange={e => setEv(e.target.value)} />
            <button className="btn sm" onClick={async () => { if (await onSave({ status, evidence: ev || null })) setEdit(false); }}>Save</button>
            <button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button>
          </span>
        )}
      </span>
      <span className="crit-act">
        {onDraft && c.status === 'PENDING' && <button className="draft-btn" onClick={onDraft} title="Assemble a draft of this document from the project record">Draft from the record</button>}
        {canEdit && !edit && <button className="link" onClick={() => setEdit(true)}>update</button>}
      </span>
    </div>
  );
}

function GateForm({ gate, onSave }: { gate: number; onSave: (b: any) => Promise<boolean> }) {
  const meta = useMeta();
  const [outcome, setOutcome] = useState('PASS');
  const [rationale, setRationale] = useState('');
  const [reason, setReason] = useState('');
  const [tech, setTech] = useState('');
  const stop = outcome === 'SUNSET' || outcome === 'DESCOPE';
  return (
    <div className="decide">
      <div className="lbl">Record Gate {gate} decision</div>
      <div className="inline-form">
        <select value={outcome} onChange={e => setOutcome(e.target.value)}>{['PASS', 'HOLD', 'DESCOPE', 'SUNSET'].map(s => <option key={s}>{s}</option>)}</select>
        {stop && <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Why it stopped"><option value="">Why it stopped…</option>{Object.entries(meta.exitReasons).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        {stop && <select value={tech} onChange={e => setTech(e.target.value)} aria-label="Technical result"><option value="">Did it work technically?…</option>{Object.entries(meta.techResults).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <input placeholder="Rationale (required)" value={rationale} onChange={e => setRationale(e.target.value)} />
        <button className="btn sm" onClick={async () => { if (await onSave({ outcome, rationale, ...(stop ? { exit_reason: reason || undefined, technical_result: tech || undefined } : {}) })) setRationale(''); }}>Record decision</button>
      </div>
    </div>
  );
}

function ValueForm({ onSave }: { onSave: (b: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState({ path: 'RISK', is_primary: true, metric: '', baseline: '', projected: '', annual_value: '', narrative: '' });
  if (!open) return <button className="link" onClick={() => setOpen(true)}>+ add value path</button>;
  const s = (k: string) => (e: any) => setB({ ...b, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="form">
      <select value={b.path} onChange={s('path')}>{Object.keys(VP).map(k => <option key={k} value={k}>{VP[k].l}</option>)}</select>
      <label className="chk"><input type="checkbox" checked={b.is_primary} onChange={s('is_primary')} /> primary</label>
      <input placeholder="Metric" value={b.metric} onChange={s('metric')} />
      <input placeholder="Baseline (Stage 0)" value={b.baseline} onChange={s('baseline')} />
      <input placeholder="Projected" value={b.projected} onChange={s('projected')} />
      <input placeholder="Annual value $" type="number" value={b.annual_value} onChange={s('annual_value')} />
      <textarea placeholder="Argument — how this creates value" value={b.narrative} onChange={s('narrative')} />
      <div><button className="btn sm" onClick={async () => { if (await onSave({ ...b, annual_value: b.annual_value ? Number(b.annual_value) : null, baseline: b.baseline || null, projected: b.projected || null, narrative: b.narrative || null })) setOpen(false); }}>Add</button>
        <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

function FundingForm({ onSave }: { onSave: (b: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState({ fy: '2026', appropriation: 'RDT&E BA3', source: 'J68 R&D', amount: '', pop_end: '' });
  if (!open) return <button className="link" onClick={() => setOpen(true)}>+ add funding line</button>;
  const s = (k: string) => (e: any) => setB({ ...b, [k]: e.target.value });
  return (
    <div className="form">
      <input type="number" placeholder="FY" value={b.fy} onChange={s('fy')} />
      <select value={b.appropriation} onChange={s('appropriation')}>{['RDT&E BA3', 'RDT&E BA6', 'O&M', 'WCF', 'Procurement'].map(a => <option key={a}>{a}</option>)}</select>
      <input placeholder="Source (J68 R&D or sponsor)" value={b.source} onChange={s('source')} />
      <input type="number" placeholder="Amount $" value={b.amount} onChange={s('amount')} />
      <input type="date" title="PoP end" value={b.pop_end} onChange={s('pop_end')} />
      <div><button className="btn sm" onClick={async () => { if (await onSave({ fy: Number(b.fy), appropriation: b.appropriation, source: b.source, amount: Number(b.amount), pop_end: b.pop_end || null })) setOpen(false); }}>Add</button>
        <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

/** The sponsor's commitment: who receives the capability, the line that pays for it, and (Path B) the POM year. Prefilled from what is already there. */
function CommitForm({ t, label, onSave }: { t: any; label: string; onSave: (b: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const { data: orgs } = useAsync(() => (open ? api('/org-index') : Promise.resolve(null)), [open]);
  const [b, setB] = useState({ receiver_org_id: t.receiver_org_id ? String(t.receiver_org_id) : '', funding_line: t.funding_line ?? '', pom_fy: t.pom_fy ? String(t.pom_fy) : '' });
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}>{label}</button>;
  const dla = (orgs?.rows ?? []).filter((o: any) => ['DLA_MSC', 'DLA_JCODE'].includes(o.kind)).sort((a: any, c: any) => a.name.localeCompare(c.name));
  const s = (k: string) => (e: any) => setB({ ...b, [k]: e.target.value });
  return (
    <div className="form">
      <select value={b.receiver_org_id} onChange={s('receiver_org_id')} disabled={!!t.receiver_org_id && t.status !== 'DECLARED'} aria-label="Receiving organization">
        <option value="">Receiving organization…</option>{dla.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      <input placeholder={t.path === 'A_WCF' ? 'Funding line (e.g. WCF cost recovery — DLA Troop Support supply chain)' : 'Funding line (e.g. O&M, DLA Distribution — sustainment line)'} value={b.funding_line} onChange={s('funding_line')} disabled={!!t.funding_line && t.status !== 'DECLARED'} />
      {t.path === 'B_POM' && <input type="number" placeholder="POM year (e.g. 2028)" value={b.pom_fy} onChange={s('pom_fy')} disabled={!!t.pom_fy && t.status !== 'DECLARED'} />}
      <div><button className="btn sm" onClick={async () => {
        const body: any = {};
        if (b.receiver_org_id) body.receiver_org_id = Number(b.receiver_org_id);
        if (b.funding_line.trim()) body.funding_line = b.funding_line.trim();
        if (b.pom_fy) body.pom_fy = Number(b.pom_fy);
        if (await onSave(body)) setOpen(false);
      }}>{label}</button><button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

function PathForm({ onSave }: { onSave: (b: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('A_WCF');
  const [mechanism, setMech] = useState('');
  if (!open) return <button className="link" onClick={() => setOpen(true)}>+ declare pathway</button>;
  return (
    <div className="form">
      <select value={path} onChange={e => setPath(e.target.value)}><option value="A_WCF">Path A — WCF</option><option value="B_POM">Path B — POM</option></select>
      <input placeholder="Mechanism (e.g. NSN under Troop Support, POM program line)" value={mechanism} onChange={e => setMech(e.target.value)} />
      <div><button className="btn sm" onClick={async () => { if (await onSave({ path, mechanism })) setOpen(false); }}>Declare</button>
        <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

function EditToggle({ p, onSave }: { p: any; onSave: (b: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState({ description: p.description ?? '', status_code: p.status_code ?? 'B', pop_start: d10(p.pop_start).replace('—', ''), pop_end: d10(p.pop_end).replace('—', ''),
    transition_phase: p.transition_phase ?? '', transition_type: p.transition_type ?? '', charter: p.charter ?? '' });
  if (!open) return <button className="link" onClick={() => setOpen(true)}>update for data call</button>;
  const s = (k: string) => (e: any) => setB({ ...b, [k]: e.target.value });
  const n = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <div className="modal-bg" onClick={() => setOpen(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Update {p.esh_id} for the data call</h3>
        <label>Status<select value={b.status_code} onChange={s('status_code')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></label>
        <label>PoP start<input type="date" value={b.pop_start} onChange={s('pop_start')} /></label>
        <label>PoP end<input type="date" value={b.pop_end} onChange={s('pop_end')} /></label>
        <label>Transition phase<select value={b.transition_phase} onChange={s('transition_phase')}><option value="">—</option>{['In Development', 'Complete', 'DTIC-Strategy Document/Report Published'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Transition type<input value={b.transition_type} onChange={s('transition_type')} /></label>
        <label>Charter<input value={b.charter} onChange={s('charter')} /></label>
        <label>Description<textarea rows={5} value={b.description} onChange={s('description')} /></label>
        <div className="row">
          <button className="btn" onClick={async () => { if (await onSave({ status_code: b.status_code, pop_start: n(b.pop_start), pop_end: n(b.pop_end), transition_phase: n(b.transition_phase), transition_type: n(b.transition_type), charter: n(b.charter), description: n(b.description) })) setOpen(false); }}>Save</button>
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
        <div className="note">Every change is written to the audit log with your name.</div>
      </div>
    </div>
  );
}
