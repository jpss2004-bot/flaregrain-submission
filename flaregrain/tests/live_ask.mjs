// Model-written Ask checks for redesign/server.mjs, against a stand-in model proxy on a free local port. run.py runs this
// and reads its "passed"/"FAILED" lines. Nothing leaves this computer.
import http from 'node:http';
import {server, rankSources, askFacts} from '../redesign/server.mjs';

delete process.env.FLAREGRAIN_MINI_EXPLAIN_URL; delete process.env.FLAREGRAIN_LIVE_ASK;
let failed = 0;
const expect = (name, ok, detail = '') => { if (!ok) failed += 1; console.log((ok ? 'passed ' : 'FAILED ') + 'model Ask: ' + name + (ok || !detail ? '' : ' (' + detail + ')')); };
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s.address().port)));

const seen = [];
let reply = null; // (body) => [status, json]
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => { seen.push({path: req.url, body}); const [status, json] = reply(JSON.parse(body)); res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(json)); });
});
const proxyUrl = 'http://127.0.0.1:' + await listen(proxy);
const site = 'http://127.0.0.1:' + await listen(server);
const ask = q => fetch(site + '/api/ask?q=' + encodeURIComponent(q)).then(r => r.json());
const reading = (body, type = 'application/json') => fetch(site + '/api/ask-reading', {method: 'POST', headers: {'Content-Type': type}, body: typeof body === 'string' ? body : JSON.stringify(body)})
  .then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const Q = 'How does oxygen change flame spread?';
const PREPARED = 'How long did the flame take to go out after airflow was cut?';

// Off (the default): /api/ask is today's, and nothing reaches a proxy.
let a = await ask(Q);
expect('off: no reading, no ranked sources, today\'s message', !a.reading && a.ranks.length === 0 && a.passages.length === 0 && /No checked NASA record answers this directly/.test(a.limitation), JSON.stringify(a).slice(0, 200));
let r = await reading({q: Q});
expect('off: the reading endpoint falls back at once', r.status === 200 && r.body.status === 'fallback' && r.body.reason === 'off');
process.env.FLAREGRAIN_MINI_EXPLAIN_URL = proxyUrl;
a = await ask(Q);
expect('the proxy address alone does not switch it on', !a.reading && seen.length === 0);

process.env.FLAREGRAIN_LIVE_ASK = '1';
a = await ask(PREPARED);
expect('on: the prepared answer is unchanged', a.status === 'supported' && a.findings.length === 2 && !a.reading);
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
expect('the proxy gets only the question and the ranked source IDs', Object.keys(sent).sort().join() === 'passages,q,records' && sent.q === Q &&
  String(sent.records) === String(ranked.records) && String(sent.passages) === String(ranked.passages));
expect('a matching answer comes back with each sentence\'s NASA links and the removed count, no removed text',
  r.body.status === 'ok' && r.body.sentences.length === 2 && r.body.sentences.every(s => s.sources.length && s.sources.every(x => /^https:\/\//.test(x.url))) &&
  r.body.removed === 1 && !JSON.stringify(r.body).includes('987') && r.body.factsHash === digest, JSON.stringify(r.body).slice(0, 300));
reply = body => [200, {...good(body)[1], cached: true, generatedAt: '2026-11-15T15:02:00.000Z'}];
r = await reading({q: Q});
expect('a cached answer keeps its mark and time', r.body.status === 'ok' && r.body.cached === true && r.body.generatedAt === '2026-11-15T15:02:00.000Z');
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

server.close(); proxy.close();
console.log(failed ? failed + ' model Ask check(s) failed' : 'all model Ask checks passed');
process.exit(failed ? 1 : 0);
