import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import { PHASES } from './domain.js';

/**
 * "Ask the portfolio": plain-English navigation over the project inventory.
 * Runs entirely on this machine — no project text leaves it. A question is parsed into
 *   1. filters (phase, ESF status, fiscal year) stated in words,
 *   2. concepts (e.g. "augmented reality" → AR, VR, mixed reality, HoloLens, remote expert …),
 *   3. remaining content words,
 * then every project is scored on title, description, program, priority alignment and organizations
 * (field weight × rarity of the term), and the answer is written from the ranked set.
 */

type Concept = { name: string; triggers: string[]; terms: [string, number][] };
const t = (s: string, w = 0.7): [string, number][] => s.split(',').map(x => [x.trim(), w] as [string, number]).filter(x => x[0]);

const CONCEPTS: Concept[] = [
  { name: 'augmented / virtual reality', triggers: ['augmented reality', 'virtual reality', 'mixed reality', 'extended reality', 'ar', 'vr', 'xr', 'hololens', 'headset', 'immersive', 'metaverse', 'smart glass'],
    terms: [...t('augmented reality, virtual reality, mixed reality, extended reality, ar, vr, xr, hololens, headset, immersive, smart glass, head mounted, remote expert', 0.9), ...t('3d visualization, digital twin, remote inspection', 0.4)] },
  { name: 'inventory management', triggers: ['inventory', 'stock', 'stockage', 'cycle count', 'replenishment'],
    terms: [...t('inventory, stockage, cycle count, replenishment, asset tracking, asset visibility, material management', 0.8), ...t('stock, rfid, warehouse, demand forecast, demand planning, supply planning, accountability', 0.45)] },
  { name: 'warehousing & distribution', triggers: ['warehouse', 'warehousing', 'distribution center', 'depot', 'fulfillment', 'picking', 'material handling'],
    terms: [...t('warehouse, distribution center, depot, material handling, picking, fulfillment, automated storage, conveyor', 0.8), ...t('distribution, storage, packing, robotic, inventory', 0.4)] },
  { name: 'forecasting & predictive analytics', triggers: ['forecast', 'forecasting', 'demand planning', 'prediction', 'predictive'],
    terms: [...t('forecast, demand planning, predictive analytic, prediction, predictive', 0.85), ...t('machine learning, model, analytic', 0.35)] },
  { name: 'AI & machine learning', triggers: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'neural', 'computer vision', 'nlp', 'natural language', 'generative', 'llm', 'large language model'],
    terms: [...t('artificial intelligence, ai, machine learning, ml, deep learning, neural network, computer vision, natural language processing, nlp, generative, large language model, llm', 0.9), ...t('predictive, algorithm, analytic, automation, cognitive', 0.35)] },
  { name: 'additive manufacturing / 3D printing', triggers: ['additive manufacturing', '3d printing', '3d print', '3d printed', 'additive'],
    terms: [...t('additive manufacturing, additive, am, 3d print, 3d printed, printed part, powder bed, laser sintering, cold spray', 0.9), ...t('reverse engineering, technical data package, qualification', 0.35)] },
  { name: 'robotics & automation', triggers: ['robot', 'robotic', 'robotics', 'automation', 'automate', 'autonomous', 'cobot', 'rpa'],
    terms: [...t('robot, robotic, automation, automated, autonomous, cobot, robotic process automation, rpa', 0.85), ...t('unmanned, machine', 0.3)] },
  { name: 'drones / unmanned systems', triggers: ['drone', 'uas', 'uav', 'unmanned'], terms: t('drone, uas, uav, unmanned aerial, unmanned, autonomous', 0.85) },
  { name: 'cybersecurity', triggers: ['cyber', 'cybersecurity', 'zero trust', 'encryption'], terms: [...t('cyber, cybersecurity, zero trust, encryption, vulnerability', 0.9), ...t('security, authentication', 0.4)] },
  { name: 'counterfeit prevention & authentication', triggers: ['counterfeit', 'anti counterfeit', 'provenance', 'tamper', 'authentication', 'authenticity'],
    terms: [...t('counterfeit, authentication, authenticity, provenance, dna marking, tamper', 0.9), ...t('serialization, marking, traceability, blockchain', 0.45)] },
  { name: 'asset tracking & visibility', triggers: ['tracking', 'track', 'rfid', 'iot', 'internet of things', 'asset visibility', 'barcode', 'sensor'],
    terms: [...t('rfid, asset tracking, tracking, internet of things, iot, asset visibility, barcode, serial number', 0.85), ...t('sensor, visibility, location, tag', 0.4)] },
  { name: 'blockchain', triggers: ['blockchain', 'distributed ledger'], terms: t('blockchain, distributed ledger, smart contract', 0.9) },
  { name: 'energy, fuel & power', triggers: ['energy', 'fuel', 'power', 'battery', 'batteries', 'microgrid', 'solar', 'renewable', 'hydrogen'],
    terms: [...t('energy, fuel, jet fuel, battery, microgrid, solar, renewable, hydrogen, petroleum, lithium', 0.85), ...t('power, generator, grid', 0.45)] },
  { name: '5G & wireless networks', triggers: ['5g', 'wireless', 'network', 'connectivity'], terms: [...t('5g, wireless, private network, connectivity', 0.9), ...t('network', 0.4)] },
  { name: 'castings & forgings', triggers: ['casting', 'castings', 'forging', 'forgings', 'foundry', 'metal'], terms: [...t('casting, forging, foundry, investment casting, metal', 0.85), ...t('machining, alloy', 0.4)] },
  { name: 'obsolescence & sustainment', triggers: ['obsolescence', 'obsolete', 'dmsms', 'diminishing', 'sustainment', 'legacy part', 'spare part', 'sole source'],
    terms: [...t('obsolescence, obsolete, dmsms, diminishing manufacturing, sustainment, legacy, spare part, sole source', 0.85), ...t('reverse engineering, emulation, technical data', 0.45)] },
  { name: 'microelectronics', triggers: ['microelectronic', 'microelectronics', 'semiconductor', 'chip', 'circuit', 'microcircuit', 'electronics'],
    terms: [...t('microelectronic, microcircuit, semiconductor, integrated circuit, circuit card, chip', 0.9), ...t('electronic, emulation', 0.45)] },
  { name: 'medical & pharmaceutical', triggers: ['medical', 'health', 'pharmaceutical', 'medicine', 'hospital', 'clinical'], terms: t('medical, pharmaceutical, medicine, health, hospital, clinical, surgical, blood, vaccine', 0.85) },
  { name: 'food & subsistence', triggers: ['food', 'ration', 'rations', 'subsistence', 'mre', 'nutrition'],
    terms: [...t('food, ration, subsistence, mre, combat ration, meal, nutrition', 0.9), ...t('shelf life, packaging', 0.4)] },
  { name: 'clothing & textiles', triggers: ['clothing', 'textile', 'textiles', 'uniform', 'apparel', 'boot', 'boots', 'body armor', 'fabric'],
    terms: t('clothing, textile, uniform, apparel, boot, fabric, body armor, garment, footwear', 0.9) },
  { name: 'supply chain risk & resilience', triggers: ['supply chain', 'supplier', 'industrial base', 'resilience', 'illumination', 'sub tier'],
    terms: [...t('supply chain, supplier, industrial base, resilience, illumination, sub tier, single source', 0.8), ...t('risk, visibility, vendor', 0.35)] },
  { name: 'procurement & contracting', triggers: ['procurement', 'contracting', 'acquisition', 'purchasing', 'solicitation', 'pricing'],
    terms: [...t('procurement, contracting, acquisition, purchasing, purchase, solicitation, pricing, bid', 0.8), ...t('contract', 0.35)] },
  { name: 'document processing', triggers: ['document', 'documents', 'ocr', 'text mining', 'paperwork'], terms: t('document, text mining, optical character, ocr, paperwork, form', 0.8) },
  { name: 'training & workforce', triggers: ['training', 'workforce', 'skill', 'skills', 'learning', 'education'], terms: t('training, workforce, skill, learning, education, employee, instruction', 0.8) },
  { name: 'disposition, hazmat & environment', triggers: ['hazmat', 'hazardous', 'disposal', 'disposition', 'recycling', 'recycle', 'demilitarization', 'demil', 'environmental', 'pfas', 'waste'],
    terms: t('hazardous, hazmat, disposal, disposition, recycling, recycle, demilitarization, demil, environmental, pfas, waste, reutilization', 0.85) },
  { name: 'transportation & fleet', triggers: ['transportation', 'transport', 'shipping', 'freight', 'vehicle', 'fleet', 'last mile'],
    terms: t('transportation, transport, shipping, freight, vehicle, fleet, route, last mile, convoy, truck', 0.8) },
  { name: 'quantum', triggers: ['quantum'], terms: t('quantum', 1) },
  { name: 'digital twin & simulation', triggers: ['digital twin', 'simulation', 'modeling', 'modelling'], terms: [...t('digital twin, simulation, modeling, modelling', 0.85), ...t('model', 0.35)] },
  { name: 'data & analytics', triggers: ['data', 'analytics', 'dashboard', 'cloud', 'big data', 'visualization'],
    terms: [...t('data analytic, analytic, dashboard, cloud, data lake, big data, visualization', 0.75), ...t('data', 0.3)] },
  { name: 'maintenance & repair', triggers: ['maintenance', 'repair', 'condition based', 'predictive maintenance', 'overhaul', 'prognostic'],
    terms: t('maintenance, repair, condition based, cbm, prognostic, overhaul, predictive maintenance', 0.85) },
];

const STOP = new Set(('a an and or the is are was were be been being there here anything something any all some what whats which who whom whose where when why how '
  + 'have has had do does did done doing we our us you your i me my it its this that these those to of in on at for with about from by as into over under '
  + 'portfolio project projects effort efforts work working worked deal deals dealing related relating relate regarding around involve involves involving '
  + 'show find list give tell see want looking look can could would should please let lets get got ever currently current today also just only more most '
  + 'many much number other else like such kind type sort stuff thing things anyone someone dla r d rd hub esf exist exists existing').split(/\s+/));
/** Words that say little on their own: kept, but at low weight. */
const GENERIC = new Set('part parts item items material materials management manage system technology technologies capability solution tool process improvement program support development study new use using based enterprise logistics defense agency'.split(' '));

const stem = (w: string) => {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4 && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
};
const toks = (s: string) => (s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) ?? []).map(stem);
const norm = (s: string) => ' ' + toks(s).join(' ') + ' ';
const count = (hay: string, needle: string) => { let n = 0, i = hay.indexOf(needle); while (i >= 0) { n++; i = hay.indexOf(needle, i + 1); } return n; };

const ROMAN: Record<string, number> = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
type Filters = { phase?: number; status?: string[]; statusLabel?: string; fy?: number; completed?: boolean };

function parseFilters(q: string): { rest: string; f: Filters; labels: string[] } {
  let s = ' ' + q.toLowerCase() + ' ';
  const f: Filters = {}, labels: string[] = [];
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { const m = s.match(re); if (m) { fn(m); s = s.replace(re, ' '); } };
  take(/\bstage\s*(0|zero)\b/, () => { f.phase = 0; });
  take(/\bphase\s*(0|1|2|3|4|5|iii|ii|iv|i|v)\b/, m => { f.phase = ROMAN[m[1]]; });
  take(/\bintake\b/, () => { f.phase ??= 0; });
  take(/\b(at scale|scaled|fielded at scale|reached scale)\b/, () => { f.status = ['AT_SCALE']; f.statusLabel = 'at scale'; });
  take(/\b(exit|exits|exited|sunset|sunsetted|cancell?ed|descoped|managed exits?|killed|stopped)\b/, () => { f.status = ['SUNSET', 'DESCOPED']; f.statusLabel = 'exited'; });
  take(/\b(on hold|paused)\b/, () => { f.status = ['HOLD']; f.statusLabel = 'on hold'; });
  take(/\b(active|ongoing|in progress|underway)\b/, () => { f.status = ['ACTIVE']; f.statusLabel = 'active'; });
  take(/\b(completed|finished)\b/, () => { f.completed = true; });
  take(/\bfy\s*(20)?(\d\d)\b/, m => { f.fy = 2000 + Number(m[2]); });
  if (f.phase !== undefined) labels.push(PHASES[f.phase].short);
  if (f.statusLabel) labels.push(f.statusLabel[0].toUpperCase() + f.statusLabel.slice(1));
  if (f.completed) labels.push('Completed');
  if (f.fy) labels.push('In FY' + f.fy + ' data call');
  return { rest: s, f, labels };
}

type Term = { p: string; w: number; from: string; raw: string; units: string[] };

function parseTerms(rest: string): { terms: Term[]; concepts: string[]; words: string[]; units: string[] } {
  const qn = norm(rest);
  const terms = new Map<string, Term>();
  const put = (p: string, w: number, from: string, units: string[]) => {
    const k = norm(p); if (!k.trim()) return;
    const old = terms.get(k), u = [...new Set([...(old?.units ?? []), ...units])];
    if (!old || old.w < w) terms.set(k, { p: k, w, from, raw: old?.raw ?? p.toLowerCase(), units: u }); else old.units = u;
  };
  const concepts: string[] = [];
  const covered = new Map<string, string>(); // stem → concept that covers it
  for (const c of CONCEPTS) {
    const hit = c.triggers.filter(tr => qn.includes(norm(tr)));
    if (!hit.length) continue;
    concepts.push(c.name);
    for (const tr of hit) { put(tr, 1, c.name, [c.name]); toks(tr).forEach(w => covered.has(w) || covered.set(w, c.name)); }
    for (const [p, w] of c.terms) put(p, w, c.name, [c.name]);
  }
  const rawWords = (rest.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) ?? []).filter(w => !STOP.has(w) && w.length > 1);
  const words = rawWords.map(stem);
  const isGeneric = (i: number) => GENERIC.has(words[i]) || GENERIC.has(rawWords[i]);
  const unitOf = (i: number) => covered.get(words[i]) ?? (isGeneric(i) ? null : words[i]);
  rawWords.forEach((w, i) => { if (!covered.has(words[i])) put(w, isGeneric(i) ? 0.25 : 1, 'your words', isGeneric(i) ? [] : [words[i]]); });
  // adjacent non-stop words typed together are worth more as a phrase ("inventory management", "jet fuel")
  for (let i = 0; i + 1 < words.length; i++) put(rawWords[i] + ' ' + rawWords[i + 1], 1.2, 'your words', [unitOf(i), unitOf(i + 1)].filter((x): x is string => !!x));
  const units = [...new Set([...concepts, ...words.map((_, i) => unitOf(i)).filter((x): x is string => !!x)])];
  return { terms: [...terms.values()], concepts, words: rawWords, units };
}

const FIELDS = [['title', 3], ['description', 1], ['program', 1.2], ['priorities', 0.8], ['orgs', 0.5]] as const;
const FIELD_LABEL: Record<string, string> = { title: 'title', description: 'description', program: 'program', priorities: 'priority alignment', orgs: 'organizations' };

export function registerAssist(app: FastifyInstance, db: PGlite, deps: { wrap: (fn: (req: FastifyRequest, u: any) => Promise<unknown>) => any }) {
  app.post('/api/assist', deps.wrap(async req => runAssist(db, z.object({ q: z.string().trim().min(1).max(500) }).parse(req.body).q)));
}

/** Answers a plain-English question about the portfolio; also used by the ROI page to find a topic's projects. */
export async function runAssist(db: PGlite, q: string) {
  {
    const docs = (await db.query<any>(`
      SELECT p.esh_id, p.title, coalesce(p.description,'') description, p.program_code, coalesce(pr.name,'') program_name, p.element_code,
             p.esf_phase, p.esf_status, p.esf_source, p.status_code, pe.name pm,
             coalesce((SELECT string_agg(DISTINCT pri.owner || ' ' || pri.label, ' · ') FROM project_priority pp JOIN priority pri ON pri.id = pp.priority_id WHERE pp.project_id = p.id), '') priorities,
             coalesce((SELECT string_agg(DISTINCT o.name, ' · ') FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id), '') orgs,
             (SELECT string_agg(o.name, ' · ' ORDER BY o.name) FROM project_org po JOIN org o ON o.id = po.org_id WHERE po.project_id = p.id AND po.role = 'SPONSOR') sponsors,
             (SELECT array_agg(fy ORDER BY fy) FROM project_snapshot s WHERE s.project_id = p.id) fys
      FROM project p LEFT JOIN program pr ON pr.code = p.program_code LEFT JOIN person pe ON pe.id = p.pm_id`)).rows;

    const { rest, f, labels } = parseFilters(q);
    const { terms, concepts, words, units } = parseTerms(rest);
    const pool = docs.filter(d =>
      (f.phase === undefined || (d.esf_phase === f.phase && (f.status || !['SUNSET', 'DESCOPED'].includes(d.esf_status))))
      && (!f.status || f.status.includes(d.esf_status))
      && (!f.completed || d.status_code === 'E' || d.esf_status === 'AT_SCALE')
      && (!f.fy || (d.fys ?? []).includes(f.fy)));

    const N = docs.length;
    const idx = docs.map(d => ({ d, n: { title: norm(d.title), description: norm(d.description), program: norm(d.program_code + ' ' + d.program_name), priorities: norm(d.priorities), orgs: norm(d.orgs) } as Record<string, string> }));
    const df = new Map(terms.map(tm => [tm.p, idx.filter(x => FIELDS.some(([k]) => x.n[k].includes(tm.p))).length]));
    const inPool = new Set(pool.map(d => d.esh_id));

    const scored = idx.filter(x => inPool.has(x.d.esh_id)).map(({ d, n }) => {
      let score = 0;
      const hits = new Map<string, Set<string>>(); // term → fields
      const unitHit = new Set<string>();
      for (const tm of terms) {
        const dfi = df.get(tm.p) ?? 0;
        if (!dfi) continue;
        const idf = Math.log(1 + N / dfi);
        for (const [k, fw] of FIELDS) {
          const c = count(n[k], tm.p);
          if (!c) continue;
          score += tm.w * fw * idf * (1 + Math.log(c));
          if (!hits.has(tm.p)) hits.set(tm.p, new Set());
          hits.get(tm.p)!.add(k);
          tm.units.forEach(u => unitHit.add(u));
        }
      }
      // reward covering every part of what was asked: 'hypersonic propulsion' should beat 'propulsion' alone
      const cov = units.length > 1 ? unitHit.size / units.length : 1;
      score *= 0.25 + 0.75 * cov;
      return { d, score, hits, cov, uh: unitHit };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const noTerms = terms.length === 0;
    const top = scored[0]?.score ?? 0;
    const strongCut = top * 0.35, bestCov = Math.max(0, ...scored.map(x => x.cov));
    const results = noTerms
      ? pool.sort((a, b) => a.title.localeCompare(b.title)).map(d => ({ d, score: 0, cov: 1, hits: new Map<string, Set<string>>() }))
      : scored.filter(x => x.score >= top * 0.12);

    const hlWords = [...new Set(terms.flatMap(x => x.p.trim().split(' ')).filter(w => w.length > 1 && !STOP.has(w)))];
    const snippet = (d: any, hits: Map<string, Set<string>>) => {
      const best = [...hits.keys()].sort((a, b) => (terms.find(x => x.p === b)?.w ?? 0) - (terms.find(x => x.p === a)?.w ?? 0) || b.length - a.length);
      const sentences: string[] = d.description.split(/(?<=[.!?;])\s+/).filter(Boolean);
      for (const p of best) {
        const s = sentences.find(x => norm(x).includes(p));
        if (s) return s.length > 240 ? s.slice(0, 237) + '…' : s;
      }
      return d.description ? (d.description.length > 160 ? d.description.slice(0, 157) + '…' : d.description) : '';
    };
    const out = results.map(({ d, score, hits, cov }) => {
      const fields = new Set<string>(); hits.forEach(s => s.forEach(k => fields.add(k)));
      const matched = [...hits.keys()].sort((a, b) => (terms.find(x => x.p === b)?.w ?? 0) - (terms.find(x => x.p === a)?.w ?? 0)).slice(0, 4).map(x => terms.find(tm => tm.p === x)?.raw ?? x.trim());
      return {
        esh_id: d.esh_id, title: d.title, program_code: d.program_code, program_name: d.program_name, element_code: d.element_code,
        esf_phase: d.esf_phase, esf_status: d.esf_status, esf_source: d.esf_source, status_code: d.status_code, pm: d.pm, sponsors: d.sponsors,
        strength: noTerms ? 'match' : score >= strongCut && cov >= bestCov ? 'strong' : 'related',
        matched, where: [...fields].map(k => FIELD_LABEL[k]), snippet: noTerms ? (d.description.slice(0, 160) + (d.description.length > 160 ? '…' : '')) : snippet(d, hits),
      };
    });

    /* ── the written answer ── */
    const topic = concepts.length ? concepts.join(' and ') : words.length ? words.join(' ') : '';
    const scope = labels.length ? ` (${labels.join(', ')})` : '';
    const strong = out.filter(r => r.strength !== 'related');
    const phaseOf = (r: any) => r.esf_status === 'AT_SCALE' ? 'at scale' : ['SUNSET', 'DESCOPED'].includes(r.esf_status) ? 'exited' : r.esf_phase == null ? 'unphased' : PHASES[r.esf_phase].short;
    const tally = (xs: any[], key: (r: any) => string | null) => {
      const m = new Map<string, number>(); xs.forEach(r => { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const list = (xs: [string, number][], n = 3) => xs.slice(0, n).map(([k, v]) => `${v} ${k}`).join(', ');
    let answer: string;
    if (!out.length) {
      answer = topic
        ? `I couldn't find anything in the portfolio about ${topic}${scope}. Nothing in the titles, descriptions, programs, priority alignment or organizations mentions it.`
        : `No projects match${scope}.`;
    } else if (noTerms) {
      answer = `${out.length} project${out.length === 1 ? '' : 's'} match${out.length === 1 ? 'es' : ''}${scope}. By program: ${list(tally(out, r => r.program_code), 4)}.`;
    } else {
      const partial = units.length > 1 && bestCov < 1;
      const lead = strong.slice(0, 3).map(r => `“${r.title}”`).join(', ');
      answer = partial
        ? `No single project covers all of ${topic}${scope}. Closest: `
          + units.map(u => [concepts.includes(u) ? u : (words.find(w => stem(w) === u) ?? u), scored.filter(x => x.uh.has(u)).length] as [string, number])
            .map(([l, n]) => `“${l}” in ${n} project${n === 1 ? '' : 's'}`).join(', ') + `. Best single matches: ${lead}.`
        : `Yes, ${strong.length} project${strong.length === 1 ? '' : 's'} deal${strong.length === 1 ? 's' : ''} directly with ${topic}${scope}`
        + (out.length > strong.length ? `, and ${out.length - strong.length} more touch${out.length - strong.length === 1 ? 'es' : ''} on it` : '') + '. '
        + `The closest: ${lead}. `
        + `Where they stand: ${list(tally(strong, phaseOf), 4)}. `
        + (tally(strong, r => r.program_code).length ? `Mostly in ${list(tally(strong, r => r.program_code), 2)}.` : '');
    }
    return {
      q, answer, topic, concepts, filters: labels, total: out.length, strong: strong.length,
      results: out.slice(0, 60), ids: out.map(r => r.esh_id), hl: hlWords,
      engine: { kind: 'local', note: 'Keyword and concept search over the inventory on this machine. No project data leaves it.' },
    };
  }
}
