import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const data = JSON.parse(await readFile(new URL('../data/compare-data.json', import.meta.url), 'utf8'));
const starter = data.starters[0];
const orderedPair = data.pairs[starter.ids.join(',')];
// The Ask matcher below answers from the two records of the prepared airflow pair only (Codex's lane, unchanged). It is the
// answer when the model is off; with the model on, /api/ask sends that question through retrieval and the model too.
const records = new Map(orderedPair.records.map(record => [record.id, record]));
// Everything else reads the 13 hand-checked NASA records; 11 are runs with prepared comparisons, and SAME's two Kapton
// material baselines are records only.
const checked = new Map(data.checked.map(record => [record.id, record]));
const comparable = new Set(data.records.map(record => record.id));
// Moon & Mars air: a snapshot of the full-data demo's habitat answers (counts and record ids only; data/moon-mars-air.json,
// copied beside the pages because the preview ships this folder whole). Names and NASA sources come from the checked records.
const habitat = JSON.parse(await readFile(new URL('moon-mars-air.json', import.meta.url), 'utf8'));
const habitatRecords = Object.fromEntries([...checked.values()].map(record =>
  [record.id, {name: record.name, investigation: record.investigation, source: record.source, comparable: comparable.has(record.id)}]));

const files = new Set([
  'index.html', 'answer.html', 'browse.html', 'compare.html', 'evidence.html', 'habitat.html',
  'insights.html', 'system.html', 'developers.html', 'app.js', 'compare.js', 'drawer.js', 'pages.js', 'styles.css', 'favicon.svg', 'favicon.png',
]);
const types = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'svg': 'image/svg+xml', 'png': 'image/png'};
const notIncluded = 'This view needs the full NASA PSI dataset, which the team shows in the full-data demo.';
const cutoffQuestion = 'How long did the flame take to go out after airflow was cut?';
const scopeLimit = 'The cited passages give no elapsed time from airflow shutoff to extinction in seconds.';
const saffireDuration = ' In Saffire, 420 seconds is the time up to shutoff.';

function answer(query) {
  const mentionsCutoff = /\b(?:airflow|flow|fan)\b.{0,36}\b(?:cut|off|stop(?:s|ped)?|shut)\b|\b(?:cutoff|shutoff)\b/i.test(query);
  const mentionsExtinction = /\b(?:extinction|extinguish\w*|(?:go|went) out|how (?:long|quickly)|time|seconds?)\b/i.test(query);
  const asksWhatHappened = /^what (?:happened|happens) (?:when|after|once)\b/i.test(query);
  const selected = [
    [/\b(?:B1|BASS(?:-II)?)\b/i, 'B1'],
    [/\b(?:Saffire|S1)\b/i, 'S1'],
  ].filter(([pattern]) => pattern.test(query)).map(([, id]) => records.get(id));
  const pair = selected.length ? selected : [...records.values()];
  const findings = mentionsCutoff && (mentionsExtinction || asksWhatHappened) ? pair.map(record => ({
    text: record.id === 'B1'
      ? 'The BASS-II B1 flame went out quickly after airflow was stopped.'
      : 'The Saffire I-1 flame went out immediately when airflow stopped at the end of the run.',
    source: record.source,
  })) : [];
  const related = mentionsCutoff || selected.length > 0;
  return {
    query,
    status: findings.length ? 'supported' : 'no-match',
    findings,
    limitation: findings.length ? scopeLimit + (pair.some(record => record.id === 'S1') ? saffireDuration : '') : 'Ask didn’t find a checked NASA record that answers this directly. Try a question about how flames spread, burn or go out.',
    supportingSources: findings.map(finding => finding.source),
    ranks: (related ? pair : []).map(record => ({
      id: record.id, name: record.name, relevance: 'Checked record', source: record.source, comparable: true,
    })),
    compare: related && pair.length === 2 ? starter.ids : null,
    investigations: [], passages: [],
  };
}

function summary() {
  const countFields = tier => [...checked.values()].flatMap(record =>
    record.fields.filter(field => field.tier === tier).map(field => ({record: record.name, field: field.field})));
  const describe = fields => ({
    values: fields.length, records: new Set(fields.map(field => field.record)).size,
    checkedRecords: checked.size, example: fields[0] || null,
  });
  return {
    library: {investigations: new Set([...checked.values()].map(record => record.study)).size, runs: comparable.size},
    moon: {runs: '—', investigations: []},
    gaps: describe(countFields('missing')), disputes: describe(countFields('dispute')),
  };
}

function catalog(search) {
  const query = (search.get('q') || '').trim().toLowerCase();
  const study = search.get('study');
  const rows = [...checked.values()].filter(record =>
    (!study || record.study === study) && [record.name, record.study, record.observation, ...(record.events || [])].join(' ').toLowerCase().includes(query));
  return {
    total: rows.length, page: 0, pageSize: checked.size,
    records: rows.map(record => ({...record, observation: (record.events || []).at(-1) ?? record.observation, origin: 'checked', comparable: comparable.has(record.id)})),
    studies: [...new Set([...checked.values()].map(record => record.study))].map(name => ({name})),
  };
}

function evidence(ids) {
  return ids.map(id => {
    const record = checked.get(id);
    const citedFields = record.fields.filter(field => field.tier === 'dispute')
      .flatMap(field => [{label: field.source, url: field.url}, {label: field.archive, url: field.archiveUrl}]);
    const sources = [...new Map([record.source, ...citedFields].filter(source => source.url)
      .map(source => [source.url, source])).values()];
    return {...record, sources};
  });
}

function exportRows(pair, format) {
  const rows = pair.records.flatMap(record => record.fields.map(field => ({record: record.name, ...field})));
  if (format === 'json') return JSON.stringify({ids: pair.ids, rows}, null, 2);
  const cols = ['record', 'field', 'value', 'tier', 'status', 'source', 'url', 'archive', 'archiveUrl'];
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [cols.join(','), ...rows.map(row => cols.map(col => quote(row[col])).join(','))].join('\r\n') + '\r\n';
}

// Live Explain (#13, #15). Off unless the deployment sets FLAREGRAIN_MINI_EXPLAIN_URL to the public model proxy's base
// URL (never committed). Only the three starter pairs, in either order. The server first asks the proxy's /health for up
// to 4 s: if it can't be reached or the hourly cap is used up, the page gets its saved comparison back at once and no
// live answer is spent. Otherwise it waits for checked sentences, but never past 40 s from the request in all,
// because the deployment's functions stop at 45 s. A warm answer takes about 13 s on the Mini and about 4 s more through
// the tunnel and the function start, so a 14 s limit cut off every answer. It keeps the sentences only if they name the pair
// asked for and carry the facts fingerprint of the published records below. Anything else (429, 503, another pair or
// fingerprint, a timeout or a network error) returns what the page already shows for the pair, with a short status.
// While the variable is unset, every other response is unchanged.
export const live = {checkMs: 4000, retryMs: 1500, waitMs: 40000, deadlineMs: 40000};
const livePairs = new Set([['B1', 'S1'], ['B1', 'B10'], ['FLEX-002', 'S31']].flatMap(([a, b]) => [a + ',' + b, b + ',' + a]));
const unavailable = 'Live model unavailable. The saved comparison stays.';
const limited = 'Live answers are limited right now. The saved comparison stays.';

function liveBase() {
  try {
    const url = new URL((process.env.FLAREGRAIN_MINI_EXPLAIN_URL || '').trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

// The dashboard's facts fingerprint (factsDigest over explanationFacts in its model code): FNV-1a over the record name,
// field, value and status of every exported field except the sample identifier, in the order of the pair.
export function factsDigest(ids) {
  const text = ids.flatMap(id => checked.get(id).fields.filter(field => field.field !== 'Sample or identifier')
    .map(field => [checked.get(id).name, field.field, String(field.value), field.status || ''].join('|'))).join('\n');
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

// A proxy answer counts only for the pair asked, with these records' fingerprint, and only its checked sentences go out.
function bound(answer, ids, started) {
  const sentence = item => item && typeof item.text === 'string' && item.text.trim() && item.text.length <= 600 &&
    (item.problems === undefined || (Array.isArray(item.problems) && !item.problems.length));
  if (!answer || !Array.isArray(answer.ids) || answer.ids.length !== 2 || answer.ids[0] !== ids[0] || answer.ids[1] !== ids[1] ||
    answer.factsHash !== factsDigest(ids) || !Array.isArray(answer.passed) || !answer.passed.length || answer.passed.length > 7 ||
    !answer.passed.every(sentence) || (answer.removed !== undefined && !Array.isArray(answer.removed))) return null;
  return {
    ids, records: ids.map(id => checked.get(id).name), model: typeof answer.model === 'string' ? answer.model.slice(0, 40) : 'qwen3:4b',
    seconds: Number.isFinite(answer.seconds) ? answer.seconds : +((Date.now() - started) / 1000).toFixed(1),
    factsHash: answer.factsHash, passed: answer.passed.map(item => ({text: item.text.trim()})),
    removed: (answer.removed || []).map(() => ({})), // counted on the page; sentences the checker removed are not sent
    // The proxy keeps each pair's answer and sends it again at once (same model, same facts, temperature 0); the page says
    // when the model wrote it, so a reused answer is never shown as freshly written.
    ...(answer.cached === true && typeof answer.generatedAt === 'string' && Number.isFinite(Date.parse(answer.generatedAt))
      ? {cached: true, generatedAt: new Date(Date.parse(answer.generatedAt)).toISOString()} : {}),
  };
}

// ---------- Model-written Ask (JP, November 15) ----------
// Off unless FLAREGRAIN_LIVE_ASK=1 and FLAREGRAIN_MINI_EXPLAIN_URL is set; then today's Ask is unchanged for the questions
// it answers and the fallback for everything else. For other questions this server ranks the published sources itself
// (the 11 comparable checked records and the report passages from the five NASA-series documents) and shows the closest
// ones at once. The page then asks POST /api/ask-reading, which sends the question and the chosen source IDs, never source
// text, to the Mini's proxy. The proxy builds the facts from its own copy of the same public data, qwen3:4b writes 1 to 4
// sentences, and the page's checker keeps only those that cite facts and match them. This server keeps an answer only if it
// names the same sources and carries the fingerprint of these facts, and shows each kept sentence with its NASA links.
export const liveAsk = {waitMs: 40000, deadlineMs: 40000, limits: {question: 200, records: 3, passages: 4}};
const askOn = () => process.env.FLAREGRAIN_LIVE_ASK === '1' && !!liveBase();
const offTopic = 'Flaregrain covers NASA fire experiments in space: how materials burn, how flames spread and how they go out in different air, airflow and gravity. Try “How long did the flame take to go out after airflow was cut?” or “How does oxygen change flame spread?”';
const askNoAnswer = 'Flaregrain answers from the checked NASA records and report pages closest to your question, listed below.';
const fireWords = /flam|fire|burn|combust|ignit|extin|oxygen|\bo2\b|o₂|air ?flow|\bflow|\bfans?\b|spread|smoke|soot|pressure|\bpsi\b|gravity|fuel|droplet|pmma|acrylic|fabric|sibal|cotton|kapton|methanol|heptane|ethanol|material|sample|saffire|bass|\bflex\b|cfi|temperat|heat|radiat|suppress|detect|habitat|moon|mars|cabin|spacecraft|candle|\bwire|velocity|thick|film|char|melt|pyroly/i;
const stop = new Set(('the and for from with into over under than then there their they them this that these those what which who whom how why when where ' +
  'does did can could would should will about was were are has have had been being its not but you your our nasa test tests tested record records report reports').split(' '));
const askTokens = text => (String(text).toLowerCase().match(/[a-z0-9][a-z0-9.-]*[a-z0-9]|[a-z0-9]/g) || [])
  .filter(word => word.length > 2 && !stop.has(word)).map(word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
let askData = null;
async function askSources() {
  if (askData !== null) return askData || null;
  try {
    const reports = JSON.parse(await readFile(new URL('../data/report-passages.json', import.meta.url), 'utf8'));
    const index = docs => {
      const tf = docs.map(tokens => tokens.reduce((map, word) => map.set(word, (map.get(word) || 0) + 1), new Map()));
      const df = new Map(); tf.forEach(map => map.forEach((_, word) => df.set(word, (df.get(word) || 0) + 1)));
      const avg = docs.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, docs.length);
      return Object.assign(query => tf.map((map, i) => query.reduce((score, word) => {
        const f = map.get(word); if (!f) return score;
        const idf = Math.log(1 + (docs.length - df.get(word) + 0.5) / (df.get(word) + 0.5));
        return score + idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * docs[i].length / avg));
      }, 0)), {tf, df});
    };
    const recordIds = [...comparable];
    const recordText = id => { const r = checked.get(id); return [r.name, r.study, r.investigation, r.events, r.observation, ...r.fields.map(f => f.field + ' ' + f.value)].join(' '); };
    askData = {reports, recordIds, scoreRecords: index(recordIds.map(id => askTokens(recordText(id)))),
      scorePassages: index(reports.passages.map(p => askTokens(p[2]))), frontMatter: reports.passages.map(p => frontMatter(p[2]))};
  } catch (error) { console.error('Ask: report passages unavailable', error.message); askData = false; }
  return askData || null;
}
// Report pages that never answer a question: contents, acronym and reference lists, acknowledgements, the NASA STI notice.
const frontMatter = text => /^\s*(?:table of contents|contents|acronyms|abbreviations|acknowledg|references|nomenclature|report documentation page)\b/i.test(text) ||
  /nasa sti program|trade names and trademarks/i.test(text) || (text.match(/\.{5,}/g) || []).length >= 3 || (text.match(/\b(?:vol|pp)\.\s/g) || []).length >= 4 ||
  ((text.match(/[A-Z][A-Za-z'’-]+,\s+(?:[A-Z]\.|[A-Z][a-z]+)[^:]{0,80}:\s/g) || []).length >= 2 && (text.match(/\b(?:19|20)\d\d\b/g) || []).length >= 2);
// Question words that say nothing about which report page answers it. They still score, but don't count as a passage's matched
// words; records are ranked as before.
const askGeneric = new Set(askTokens('change use used using fast level happen effect affect make made many much long take go out after kind type way show find know tell ' +
  'happened changes affects effects differ difference different compare during work'));
const passageLabel = doc => doc.name + ' report';
// Rank the published sources for a question. Returns null when the question is outside fire science.
export async function rankSources(query) {
  const src = await askSources();
  const words = [...new Set(askTokens(query))];
  if (!src || !words.length || !fireWords.test(query)) return null;
  const top = (scores, n, min) => scores.map((score, i) => [score, i]).filter(([score]) => score >= min).sort((a, b) => b[0] - a[0]).slice(0, n);
  const recs = top(src.scoreRecords(words), liveAsk.limits.records, 0.5).map(([, i]) => src.recordIds[i]);
  // Passages: hyphenated words also count by their parts. A page must not be front matter and must match two of the
  // question's specific words (askGeneric left out), or one word found on fewer than 1% of pages; if none does, the best
  // pages by score are kept as before, so a fire question never loses its passages to this filter.
  const all = [...new Set(words.flatMap(word => word.includes('-') ? [word, ...askTokens(word.replaceAll('-', ' '))] : [word]))];
  const specific = all.filter(word => !askGeneric.has(word)), {tf, df} = src.scorePassages, scores = src.scorePassages(all);
  const need = Math.min(2, specific.length), hits = tf.map(map => specific.reduce((n, word) => n + (map.has(word) ? (df.get(word) * 100 < tf.length ? 2 : 1) : 0), 0));
  let pas = top(scores.map((score, i) => hits[i] >= need && !src.frontMatter[i] ? score : 0), 3, 3).map(([, i]) => i);
  if (!pas.length) pas = top(scores.map((score, i) => src.frontMatter[i] ? 0 : score), 3, 3).map(([, i]) => i);
  return recs.length || pas.length ? {words, records: recs, passages: pas, reports: src.reports} : null;
}
function snippet(text, words) {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...words.map(word => lower.indexOf(word)).filter(i => i >= 0), text.length) - 80);
  let cut = text.slice(at, at + 260).trim();
  for (const word of words.filter(word => word.length > 3)) cut = cut.replace(new RegExp('\\b(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*)', 'gi'), '<mark>$1</mark>');
  return (at > 0 ? '… ' : '') + cut + (at + 260 < text.length ? ' …' : '');
}
// The facts the proxy builds for these sources, in its order, with the label and NASA link each one cites.
export function askFacts(recordIds, passageIds, reports) {
  const facts = recordIds.flatMap(id => checked.get(id).fields.filter(field => field.field !== 'Sample or identifier')
    .map(field => ({line: [checked.get(id).name, field.field, String(field.value), field.status || ''].join('|'), label: field.source || checked.get(id).source.label, url: field.url || checked.get(id).source.url})));
  for (const i of passageIds) {
    const [docId, page, text] = reports.passages[i]; const doc = reports.docs[docId];
    facts.push({line: [passageLabel(doc), 'PDF p. ' + page, text, ''].join('|'), label: doc.name + ' · PDF p. ' + page, url: doc.url + '#page=' + page});
  }
  let hash = 2166136261 >>> 0;
  const text = facts.map(fact => fact.line).join('\n');
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  return {facts, digest: hash.toString(16).padStart(8, '0')};
}
// Extra Ask fields for /api/ask when model-written Ask is on and today's Ask has no prepared answer.
async function askExtras(query) {
  const ranked = await rankSources(query);
  if (!ranked) return {status: 'unanswerable', limitation: offTopic, ranks: [], passages: [], compare: null};
  return {
    limitation: askNoAnswer,
    ranks: ranked.records.map(id => { const r = checked.get(id); return {id, name: r.name, relevance: 'Checked record', reason: 'Ranked by its NASA fields for this question.', source: r.source, comparable: true}; }),
    passages: ranked.passages.map(i => { const [docId, page, text] = ranked.reports.passages[i]; const doc = ranked.reports.docs[docId];
      return {report: doc.name, page, url: doc.url + '#page=' + page, snippet: snippet(text, ranked.words)}; }),
    compare: null, reading: {live: true, facts: askFacts(ranked.records, ranked.passages, ranked.reports).facts.length},
  };
}
async function askReading(req, res) {
  const started = Date.now();
  const noStore = {'Cache-Control': 'no-store'};
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, {error: 'Send application/json.'}, undefined, noStore);
  const text = await readBody(req, 1024);
  if (text === null) return send(res, 413, {error: 'Request too large.'}, undefined, noStore);
  let body; try { body = JSON.parse(text); } catch { return send(res, 400, {error: 'Send {"q": "…"}.'}, undefined, noStore); }
  const query = body && typeof body.q === 'string' && Object.keys(body).join() === 'q' ? body.q.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!query) return send(res, 400, {error: 'Send {"q": "…"}.'}, undefined, noStore);
  const fallback = (reason, status, extra = {}) => send(res, 200, {status: 'fallback', reason, message: status, ...extra}, undefined, noStore);
  // The checker's reason for each removed sentence, for the page's steps: the first problem only, at most 4, never the text.
  const reasons = removed => (Array.isArray(removed) ? removed : []).slice(0, 4)
    .map(item => Array.isArray(item?.problems) && typeof item.problems[0] === 'string' ? item.problems[0].slice(0, 120) : 'Did not match its facts');
  if (!askOn()) return fallback('off', 'The live model is off. The closest evidence is below.');
  const ranked = await rankSources(query);
  if (!ranked) return fallback('scope', offTopic);
  // Sent to the model in one plain form (lower case, single spaces, no punctuation at either end), so a question asked
  // before is recognised when only its capitals, spacing or final punctuation differ. Ranking uses the question as typed.
  const q = (query.toLowerCase().replace(/\s+/g, ' ').replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '') || query).slice(0, liveAsk.limits.question);
  const {facts, digest} = askFacts(ranked.records, ranked.passages, ranked.reports);
  try {
    const reply = await fetch(liveBase() + '/ask', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({q, records: ranked.records, passages: ranked.passages}), signal: AbortSignal.timeout(Math.max(1000, liveAsk.deadlineMs - (Date.now() - started)))});
    const answer = await reply.json().catch(() => null);
    if (reply.status === 429) return fallback('limited', 'Live answers are limited right now. The closest evidence is below.');
    if (reply.status === 503) return fallback('busy', 'The live model is busy with another question. The closest evidence is below.');
    if (!reply.ok || !answer) return fallback('unavailable', 'Live model unavailable. The closest evidence is below.');
    const sentence = item => item && typeof item.text === 'string' && item.text.trim() && item.text.length <= 600 && Array.isArray(item.cites) && item.cites.length &&
      item.cites.every(id => typeof id === 'string' && /^F\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= facts.length) &&
      (item.problems === undefined || (Array.isArray(item.problems) && !item.problems.length));
    if (String(answer.records) !== String(ranked.records) || String(answer.passages) !== String(ranked.passages) || answer.factsHash !== digest ||
      !Array.isArray(answer.passed) || answer.passed.length > 4 || !answer.passed.every(sentence) || (answer.removed !== undefined && !Array.isArray(answer.removed))) {
      return fallback('mismatch', 'Live model unavailable. The closest evidence is below.');
    }
    if (!answer.passed.length) return fallback('none', 'The live model wrote nothing that passed the checker for this question. The closest evidence is below.',
      {removed: (answer.removed || []).length, reasons: reasons(answer.removed), seconds: Number.isFinite(answer.seconds) ? answer.seconds : null});
    const cited = item => [...new Map(item.cites.map(id => facts[Number(id.slice(1)) - 1]).map(fact => [fact.url, {label: fact.label, url: fact.url}])).values()];
    return send(res, 200, {
      status: 'ok', model: typeof answer.model === 'string' ? answer.model.slice(0, 40) : 'qwen3:4b',
      seconds: Number.isFinite(answer.seconds) ? answer.seconds : +((Date.now() - started) / 1000).toFixed(1), factsHash: digest,
      sentences: answer.passed.map(item => ({text: item.text.trim(), sources: cited(item)})), removed: (answer.removed || []).length,
      reasons: reasons(answer.removed), counts: {records: ranked.records.length, passages: ranked.passages.length, facts: facts.length},
      ...(answer.cached === true && typeof answer.generatedAt === 'string' && Number.isFinite(Date.parse(answer.generatedAt)) ? {cached: true, generatedAt: new Date(Date.parse(answer.generatedAt)).toISOString()} : {}),
    }, undefined, noStore);
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    return fallback(timeout ? 'timeout' : 'unreachable', 'Live model unavailable. The closest evidence is below.');
  }
}

function readBody(req, limit = 256) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size <= limit) chunks.push(chunk); });
    req.on('end', () => resolve(size <= limit ? Buffer.concat(chunks).toString('utf8') : null));
    req.on('error', reject);
  });
}

async function explain(req, res) {
  const started = Date.now();
  const noStore = {'Cache-Control': 'no-store'};
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, {error: 'Send application/json.'}, undefined, noStore);
  const text = await readBody(req);
  if (text === null) return send(res, 413, {error: 'Request too large.'}, undefined, noStore);
  let ids = null;
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).join() === 'ids') ids = body.ids;
  } catch {}
  if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => typeof id === 'string' && comparable.has(id)) || ids[0] === ids[1]) {
    return send(res, 400, {error: 'Choose two different runs from the 11 comparable records.'}, undefined, noStore);
  }
  const key = ids.join(',');
  const saved = (code, status, reason) =>
    send(res, code, {error: status, status, reason, ids, explanation: data.pairs[key].explanation ?? null}, undefined, noStore);
  const base = liveBase();
  if (!base) return saved(503, unavailable, 'off');
  if (!livePairs.has(key)) return saved(503, unavailable, 'pair');
  // A brief glitch between Vercel and the Mini (a refused or failed connection, an error reply) should cost one slow
  // answer, not a fallback: if the health check fails fast, wait briefly and check once more, within the overall deadline.
  // A check that hangs for the full 4 s is not retried, so an unreachable Mini still falls back after 4 s.
  const checkHealth = async () => {
    try {
      const reply = await fetch(base + '/health', {headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(live.checkMs)});
      const body = reply.ok ? await reply.json() : null;
      return body && body.ok === true ? body : null;
    } catch { return null; }
  };
  const firstCheck = Date.now();
  let health = await checkHealth();
  if (!health && Date.now() - firstCheck < live.checkMs - 500 && Date.now() - started + live.retryMs + live.checkMs < live.deadlineMs) {
    await new Promise(resolve => setTimeout(resolve, live.retryMs));
    health = await checkHealth();
  }
  if (!health) return saved(503, unavailable, 'unreachable');
  if (Number.isFinite(health.usedThisHour) && Number.isFinite(health.capPerHour) && health.usedThisHour >= health.capPerHour) {
    return saved(429, limited, 'cap');
  }
  let answer;
  try {
    const reply = await fetch(base + '/explain', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({ids}), signal: AbortSignal.timeout(Math.min(live.waitMs, live.deadlineMs - (Date.now() - started)))});
    if (reply.status === 429 || reply.status === 503) return saved(429, limited, reply.status === 429 ? 'limit' : 'busy');
    if (!reply.ok) return saved(503, unavailable, 'upstream');
    const body = await reply.text();
    try { answer = body.length <= 65536 ? JSON.parse(body) : null; } catch { answer = null; }
  } catch (error) {
    return saved(503, unavailable, error?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  const checkedAnswer = bound(answer, ids, started);
  return checkedAnswer ? send(res, 200, checkedAnswer, undefined, noStore) : saved(503, unavailable, 'mismatch');
}

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, {'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers});
  res.end(type === 'application/json' && typeof body !== 'string' ? JSON.stringify(body) : body);
}

async function api(res, url) {
  const search = url.searchParams;
  const ids = (search.get('ids') || '').split(',');
  const pair = ids.length === 2 ? data.pairs[ids.join(',')] : null;
  switch (url.pathname) {
    // commit: the Git commit Vercel deployed (null when run anywhere else), so anyone can see which revision is live.
    case '/api/health': return send(res, 200, {ok: true, records: checked.size, commit: process.env.VERCEL_GIT_COMMIT_SHA || null});
    case '/api/questions': return send(res, 200, {questions: [cutoffQuestion]});
    case '/api/records': return send(res, 200, {records: data.records});
    case '/api/starters': return send(res, 200, {starters: data.starters});
    case '/api/summary': return send(res, 200, summary());
    case '/api/catalog': return send(res, 200, catalog(search));
    case '/api/ask': {
      const query = (search.get('q') || '').trim().slice(0, 300);
      if (!query) return send(res, 400, {error: 'Type a question first.'});
      const reply = answer(query);
      if (!askOn()) return send(res, 200, reply);
      const extras = await askExtras(query);
      if (!reply.findings.length) return send(res, 200, {...reply, ...extras});
      // With the model on, the airflow question is answered like any other: ranked sources, then the model's checked
      // sentences. The hand-written sentences stay for when the model is off. The team's limitation travels along as a
      // note, and Compare keeps the prepared pair's order when those two records are the top two ranked.
      if (!extras.reading?.live) return send(res, 200, reply);
      const top = extras.ranks.slice(0, 2).map(rank => rank.id);
      return send(res, 200, {...reply, status: 'no-match', findings: [], supportingSources: [], ...extras, note: reply.limitation,
        compare: reply.compare && reply.compare.every(id => top.includes(id)) ? reply.compare : null});
    }
    case '/api/record': {
      const record = checked.get(search.get('id'));
      return record ? send(res, 200, record) : send(res, 404, {error: 'Unknown record.'});
    }
    case '/api/evidence':
      return ids.length <= 2 && new Set(ids).size === ids.length && ids.every(id => checked.has(id))
        ? send(res, 200, {records: evidence(ids)}) : send(res, 400, {error: 'Choose one or two published records.'});
    case '/api/compare':
      if (!pair) return send(res, 400, {error: 'Choose two different runs from the 11 comparable records.'});
      return send(res, 200, {...pair, conditions: pair.conditions.map(run => run.map(condition =>
        condition.readings ? {...condition, value: condition.readings.map(reading => reading.value).join(' / ')} : condition)),
        ...(liveBase() && livePairs.has(ids.join(',')) ? {live: true} : {})});
    case '/api/export': {
      if (!pair) return send(res, 400, {error: 'Choose two different runs from the 11 comparable records.'});
      const format = search.get('format') === 'json' ? 'json' : 'csv';
      return send(res, 200, exportRows(pair, format), format === 'json' ? 'application/json' : 'text/csv',
        {'Content-Disposition': 'attachment; filename="flaregrain-compare.' + format + '"'});
    }
    case '/api/habitat': return send(res, 200, {...habitat, records: habitatRecords});
    case '/api/insights':
      return send(res, 404, {error: notIncluded});
    default:
      return send(res, 404, {error: 'Not found.'});
  }
}

export const server = createServer(async (req, res) => {
  if (req.method === 'POST' && /^\/api\/ask-reading(?:\?|$)/.test(req.url)) return askReading(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) send(res, 500, {error: 'Unable to load the submission.'});
  });
  if (req.method === 'POST' && /^\/api\/explain(?:\?|$)/.test(req.url)) return explain(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) send(res, 500, {error: 'Unable to load the submission.'});
  });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, {error: 'Use GET or HEAD.'});
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) return await api(res, url);
    if (url.pathname === '/dashboard/Foundry%20dashboard.html') return send(res, 200,
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Submission scope</title><link rel="stylesheet" href="/styles.css"><main class="page-main"><p>' + notIncluded + '</p><p><a href="/compare.html" target="_parent">Open Compare</a></p></main></html>', 'text/html');
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!files.has(filename)) return send(res, 404, {error: 'Not found.'});
    const body = await readFile(new URL(filename, import.meta.url));
    return send(res, 200, body, types[filename.split('.').at(-1)]);
  } catch (error) {
    console.error(error);
    return send(res, 500, {error: 'Unable to load the submission.'});
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(Number(process.env.PORT ?? 8790), '127.0.0.1',
    () => console.log('Flaregrain ready at http://127.0.0.1:' + server.address().port + '/'));
}
