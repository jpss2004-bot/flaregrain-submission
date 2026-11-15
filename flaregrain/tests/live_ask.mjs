// Model-written Ask checks for redesign/server.mjs, against a stand-in model proxy on a free local port. run.py runs this
// and reads its "passed"/"FAILED" lines. Nothing leaves this computer.
import http from 'node:http';
import {server, rankSources, askFacts, liveAsk} from '../redesign/server.mjs';

delete process.env.FLAREGRAIN_MINI_EXPLAIN_URL; delete process.env.FLAREGRAIN_LIVE_ASK;
let failed = 0;
const expect = (name, ok, detail = '') => { if (!ok) failed += 1; console.log((ok ? 'passed ' : 'FAILED ') + 'model Ask: ' + name + (ok || !detail ? '' : ' (' + detail + ')')); };
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s.address().port)));

const seen = [];
let reply = null; // (body) => [status, json]
let delayMs = 0;
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => { seen.push({path: req.url, body}); const [status, json] = reply(JSON.parse(body));
    setTimeout(() => { if (res.destroyed) return; res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(json)); }, delayMs); });
});
const proxyUrl = 'http://127.0.0.1:' + await listen(proxy);
const site = 'http://127.0.0.1:' + await listen(server);
const ask = q => fetch(site + '/api/ask?q=' + encodeURIComponent(q)).then(r => r.json());
const reading = (body, type = 'application/json') => fetch(site + '/api/ask-reading', {method: 'POST', headers: {'Content-Type': type}, body: typeof body === 'string' ? body : JSON.stringify(body)})
  .then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const Q = 'How does oxygen change flame spread?';
const PLAIN = 'how does oxygen change flame spread'; // what the proxy is sent for Q
const PREPARED = 'How long did the flame take to go out after airflow was cut?';

// Off (the default): /api/ask is today's, and nothing reaches a proxy.
let a = await ask(Q);
expect('off: no reading, no ranked sources, today\'s message', !a.reading && a.ranks.length === 0 && a.passages.length === 0 && /didn’t find a checked NASA record that answers this directly/.test(a.limitation), JSON.stringify(a).slice(0, 200));
const LIMIT = 'NASA’s Table A.1 row for B1 and the Saffire results page give no elapsed time from airflow shutoff to extinction. The BASS-II report (PDF p. 21) describes a test where the flow was cut off abruptly and the flame went out within 2 s; it does not name the test. In Saffire, 420 seconds is the time up to shutoff.';
const prepared = await ask(PREPARED);
expect('off: the airflow question keeps the team\'s prepared answer', prepared.status === 'supported' && prepared.findings.length === 2 && !prepared.reading && !prepared.note &&
  prepared.limitation === LIMIT && String(prepared.compare) === 'B1,S1' && prepared.supportingSources.length === 2);
let r = await reading({q: Q});
expect('off: the reading endpoint falls back at once', r.status === 200 && r.body.status === 'fallback' && r.body.reason === 'off');
process.env.FLAREGRAIN_MINI_EXPLAIN_URL = proxyUrl;
a = await ask(Q);
expect('the proxy address alone does not switch it on', !a.reading && seen.length === 0);

process.env.FLAREGRAIN_LIVE_ASK = '1';
a = await ask(PREPARED);
const rankedAir = await rankSources(PREPARED);
expect('on: the airflow question has no prepared answer; it gets ranked sources and a reading like any other',
  a.status === 'no-match' && a.findings.length === 0 && a.supportingSources.length === 0 && a.reading?.live === true &&
  String(a.ranks.map(x => x.id)) === String(rankedAir.records) && a.passages.length === rankedAir.passages.length &&
  a.reading.facts === askFacts(rankedAir.records, rankedAir.passages, rankedAir.reports).facts.length, JSON.stringify(a).slice(0, 300));
expect('on: retrieval ranks BASS-II B1 and Saffire I-1 as the top two records for it', rankedAir.records.slice(0, 2).sort().join() === 'B1,S1', String(rankedAir.records));
expect('on: the team\'s limitation travels as a note, and Compare keeps the prepared pair', a.note === LIMIT && String(a.compare) === 'B1,S1');
expect('the limitation links its BASS-II words to PDF p. 21 of the report, in both modes', [a, prepared].every(x => x.limitLink?.text === 'BASS-II report (PDF p. 21)' && LIMIT.includes(x.limitLink.text) &&
  x.limitLink.url === rankedAir.reports.docs['20210011385'].url + '#page=21'));
expect('the limitation does not say the cited passages give no time, and does not name B1 as the 2 s test', !/cited passages give no/.test(a.note) && /it does not name the test/.test(a.note));
expect('on: the hand-written sentences are not sent', !JSON.stringify(a).includes('went out quickly after airflow was stopped') && !JSON.stringify(a).includes('went out immediately when airflow stopped'));
a = await ask(Q);
expect('on: other questions carry no team note', a.reading?.live === true && a.note === undefined && a.compare === null);
a = await ask('what are the biggest dangers in space');
expect('on: an off-topic question gets the scope note and no reading', !a.reading && /Flaregrain covers NASA fire experiments/.test(a.limitation) && a.ranks.length === 0);
a = await ask(Q);
const ranked = await rankSources(Q);
expect('on: a fire question shows the ranked records and report pages, and offers a reading',
  a.reading?.live === true && a.ranks.length === ranked.records.length && a.passages.length === ranked.passages.length && a.ranks.length + a.passages.length > 0 &&
  a.passages.every(p => /^https:\/\//.test(p.url) && /#page=\d+$/.test(p.url)), JSON.stringify({ranks: a.ranks.length, passages: a.passages.length}));
expect('nothing reached the proxy while ranking', seen.length === 0);

const {facts, digest} = askFacts(ranked.records, ranked.passages, ranked.reports);
const good = body => [200, {q: body.q, records: body.records, passages: body.passages, model: 'qwen3:4b', seconds: 9.1, factsHash: digest,
  passed: [{text: 'A checked sentence.', cites: ['F1'], problems: []}, {text: 'Another checked sentence.', cites: ['F1', 'F' + facts.length], problems: []}],
  removed: [{text: 'An invented 987 vol% sentence.', cites: ['F1'], problems: ['987 vol% is not in the fields']}]}];
reply = good;
r = await reading({q: Q});
const sent = JSON.parse(seen.at(-1).body);
{ const air = askFacts(rankedAir.records, rankedAir.passages, rankedAir.reports);
  reply = body => [200, {q: body.q, records: body.records, passages: body.passages, model: 'qwen3:4b', seconds: 7.2, factsHash: air.digest,
    passed: [{text: 'A checked sentence about the airflow cut.', cites: ['F1'], problems: []}], removed: []}];
  const live = await reading({q: PREPARED}), went = JSON.parse(seen.at(-1).body);
  expect('on: the airflow question goes to the model with its ranked sources', went.q === 'how long did the flame take to go out after airflow was cut' &&
    String(went.records) === String(rankedAir.records) && String(went.passages) === String(rankedAir.passages));
  expect('on: its checked sentence comes back as a model answer', live.body.status === 'ok' && live.body.sentences.length === 1 && live.body.factsHash === air.digest, JSON.stringify(live.body).slice(0, 200));
  reply = good; }
expect('the proxy gets only the question and the ranked source IDs', Object.keys(sent).sort().join() === 'passages,q,records' && sent.q === PLAIN &&
  String(sent.records) === String(ranked.records) && String(sent.passages) === String(ranked.passages));
expect('a matching answer comes back with each sentence\'s NASA links and the removed count, no removed text',
  r.body.status === 'ok' && r.body.sentences.length === 2 && r.body.sentences.every(s => s.sources.length && s.sources.every(x => /^https:\/\//.test(x.url))) &&
  r.body.removed === 1 && !JSON.stringify(r.body).includes('invented') && r.body.factsHash === digest, JSON.stringify(r.body).slice(0, 300));
expect('steps: the instant fact count matches the facts the proxy is given', a.reading.facts === facts.length, a.reading.facts + ' vs ' + facts.length);
expect('steps: counts, fingerprint and the checker\'s reasons come back, never a removed sentence\'s text',
  r.body.counts?.records === ranked.records.length && r.body.counts?.passages === ranked.passages.length && r.body.counts?.facts === facts.length &&
  JSON.stringify(r.body.reasons) === JSON.stringify(['987 vol% is not in the fields']) && !JSON.stringify(r.body).includes('invented'), JSON.stringify(r.body).slice(0, 300));
// Asked before: small wording changes reach the proxy as the same question, so its saved answer is recognised.
for (const typed of ['  how does OXYGEN   change flame spread??  ', '“How does oxygen change flame spread?!”', 'How Does Oxygen Change Flame Spread']) {
  r = await reading({q: typed}); const again = JSON.parse(seen.at(-1).body);
  expect('asked before: ' + JSON.stringify(typed) + ' is sent as the same question, with the same sources', again.q === PLAIN &&
    String(again.records) === String(ranked.records) && String(again.passages) === String(ranked.passages) && r.body.status === 'ok', again.q);
}
r = await reading({q: 'Does flame spread change with O2 at 21%?'});
expect('asked before: only case, spacing and end punctuation change; inner words and marks stay', JSON.parse(seen.at(-1).body).q === 'does flame spread change with o2 at 21', JSON.parse(seen.at(-1).body).q);
reply = good;
reply = body => [200, {...good(body)[1], removed: Array.from({length: 6}, (_, i) => ({text: 'secret removed text ' + i, cites: ['F1'], problems: ['x'.repeat(200) + i, 'second']}))}];
r = await reading({q: Q});
expect('steps: at most 4 reasons, each cut to 120 characters, first problem only', r.body.reasons.length === 4 && r.body.reasons.every(x => x.length === 120) &&
  r.body.removed === 6 && !JSON.stringify(r.body).includes('secret'), JSON.stringify(r.body.reasons).slice(0, 120));
reply = body => [200, {...good(body)[1], passed: [], removed: [{text: 'secret', cites: ['F1'], problems: ['Gives a number without naming the record']}]}];
r = await reading({q: Q});
expect('steps: nothing kept still reports how many were removed and why', r.body.status === 'fallback' && r.body.reason === 'none' && r.body.removed === 1 &&
  r.body.reasons[0] === 'Gives a number without naming the record' && r.body.seconds === 9.1 && !JSON.stringify(r.body).includes('secret'), JSON.stringify(r.body));
reply = good; delayMs = 2500; const deadline = liveAsk.deadlineMs; liveAsk.deadlineMs = 1500;
r = await reading({q: Q});
expect('steps: a slow model falls back with reason "timeout"', r.body.status === 'fallback' && r.body.reason === 'timeout', JSON.stringify(r.body));
delayMs = 0; liveAsk.deadlineMs = deadline;
reply = body => [200, {...good(body)[1], cached: true, generatedAt: '2026-11-15T15:02:00.000Z'}];
r = await reading({q: Q});
expect('a cached answer keeps its mark and time', r.body.status === 'ok' && r.body.cached === true && r.body.generatedAt === '2026-11-15T15:02:00.000Z');
reply = body => body.q === PLAIN ? [200, {...good(body)[1], cached: true, generatedAt: '2026-11-15T15:02:00.000Z'}] : good(body);
r = await reading({q: 'how does oxygen change flame spread ?'});
expect('asked before: a reworded repeat gets the saved answer, marked cached', r.body.status === 'ok' && r.body.cached === true && r.body.sentences.length === 2, JSON.stringify(r.body).slice(0, 200));
for (const [name, make, reason] of [
  ['another fingerprint', body => [200, {...good(body)[1], factsHash: '00000000'}], 'mismatch'],
  ['other sources', body => [200, {...good(body)[1], records: []}], 'mismatch'],
  ['a cite past the facts', body => [200, {...good(body)[1], passed: [{text: 'x sentence', cites: ['F' + (facts.length + 1)], problems: []}]}], 'mismatch'],
  ['a sentence with problems', body => [200, {...good(body)[1], passed: [{text: 'x sentence', cites: ['F1'], problems: ['bad']}]}], 'mismatch'],
  ['nothing passed', body => [200, {...good(body)[1], passed: []}], 'none'],
  ['the Ask cap (429)', () => [429, {error: 'Hourly Ask limit reached'}], 'limited'],
  ['busy (503)', () => [503, {error: 'busy'}], 'busy'],
  ['a model error (502)', () => [502, {error: 'x'}], 'unavailable']]) {
  reply = make; r = await reading({q: Q});
  expect('falls back on ' + name, r.status === 200 && r.body.status === 'fallback' && r.body.reason === reason && !r.body.sentences, JSON.stringify(r.body));
}
const before = seen.length;
r = await reading({q: 'what are the biggest dangers in space'});
expect('an off-topic question never reaches the proxy', r.body.reason === 'scope' && seen.length === before);
for (const [name, body, code, type] of [['an extra key', {q: Q, records: ['B1']}, 400], ['no question', {q: '  '}, 400], ['not JSON', 'q=x', 400], ['a body over 1 KB', {q: 'x'.repeat(1100)}, 413], ['a non-JSON type', {q: Q}, 415, 'text/plain']]) {
  r = await reading(body, type); expect('refuses ' + name + ' (' + code + ')', r.status === code, 'HTTP ' + r.status);
}
expect('refused requests never reach the proxy', seen.length === before);

// Passage ranking (November 15): no off-topic or front-matter pages for these questions; the pitch question's sources stay.
const pages = async q => { const k = await rankSources(q); return {k, pages: k.passages.map(i => k.reports.docs[k.reports.passages[i][0]].name + ' p. ' + k.reports.passages[i][1])}; };
let p = await pages(Q);
expect('ranking: the oxygen question skips the organisms page', p.pages.length > 0 && !p.pages.includes('Researcher\'s Guide: Combustion Science p. 5'), p.pages.join(', '));
p = await pages('What fuel did BASS-II burn?');
expect('ranking: no contents page for the BASS-II fuel question', p.pages.length > 0 && !p.pages.includes('BASS-II p. 7'), p.pages.join(', '));
p = await pages('Does air flow speed change how fast a flame spreads?');
expect('ranking: the pitch question keeps its sources', String(p.k.records) === 'S31,S26,B1' &&
  p.pages.join(', ') === 'SAFFIRE-I p. 20, BASS-II p. 132, Researcher\'s Guide: Combustion Science p. 20', String(p.k.records) + ' / ' + p.pages.join(', '));

server.close(); proxy.close();
console.log(failed ? failed + ' model Ask check(s) failed' : 'all model Ask checks passed');
process.exit(failed ? 1 : 0);
