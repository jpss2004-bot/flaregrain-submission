// Live Explain health retry: a failed /health check is tried once more after a short wait before the page falls back.
// Against a stand-in proxy on this computer only; run.py reads the "passed"/"FAILED" lines.
import http from 'node:http';
import {server, live, factsDigest} from '../redesign/server.mjs';

let failed = 0;
const expect = (name, ok, detail = '') => { if (!ok) failed += 1; console.log((ok ? 'passed ' : 'FAILED ') + 'live Explain retry: ' + name + (ok || !detail ? '' : ' (' + detail + ')')); };
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', () => resolve(s.address().port)));

let healthReplies = []; // one entry per /health call: [status, body]; status 0 = hang (no reply)
const seen = [];
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push(req.url);
    const [status, json] = req.url === '/health' ? (healthReplies.shift() || [503, {ok: false}])
      : [200, null];
    if (req.url === '/health' && status === 0) return; // hang: never answer
    const reply = req.url === '/health' ? [status, json]
      : [200, {ids: JSON.parse(body).ids, model: 'qwen3:4b', seconds: 1.2, factsHash: factsDigest(JSON.parse(body).ids),
        passed: [{text: 'Both records report a flame that went out after the airflow stopped.', cites: ['F1'], problems: []}], removed: []}];
    res.writeHead(reply[0], {'Content-Type': 'application/json'}); res.end(JSON.stringify(reply[1]));
  });
});
process.env.FLAREGRAIN_MINI_EXPLAIN_URL = 'http://127.0.0.1:' + await listen(proxy);
const site = 'http://127.0.0.1:' + await listen(server);
const post = () => { const t = Date.now(); return fetch(site + '/api/explain', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids: ['B1', 'S1']})})
  .then(async r => ({status: r.status, body: await r.json(), ms: Date.now() - t})); };
const ok = [200, {ok: true, model: 'qwen3:4b', records: 11, usedThisHour: 0, capPerHour: 6}];

expect('waits 1.5 s before one more health check after a fast failure', live.retryMs === 1500 && live.checkMs === 4000 && live.deadlineMs === 40000);

healthReplies = [[503, {ok: false}], ok]; seen.length = 0;
let r = await post();
expect('first health check fails, second succeeds: the live answer goes through', r.status === 200 && r.body.passed?.length === 1 &&
  seen.join() === '/health,/health,/explain' && r.ms >= 1400, JSON.stringify({status: r.status, seen, ms: r.ms}));

healthReplies = [[200, {ok: false}], ok]; seen.length = 0;
r = await post();
expect('a health reply that is not ok also gets the second check', r.status === 200 && seen.join() === '/health,/health,/explain', seen.join());

healthReplies = [[503, {ok: false}], [503, {ok: false}]]; seen.length = 0;
r = await post();
expect('both health checks fail: saved comparison, reason "unreachable", nothing forwarded', r.status === 503 && r.body.reason === 'unreachable' &&
  r.body.error === 'Live model unavailable. The saved comparison stays.' && seen.join() === '/health,/health', JSON.stringify({body: r.body, seen}));

healthReplies = [ok]; seen.length = 0;
r = await post();
expect('a healthy proxy is checked once, with no wait', r.status === 200 && seen.join() === '/health,/explain' && r.ms < 1400, JSON.stringify({seen, ms: r.ms}));

healthReplies = [[200, {ok: true, usedThisHour: 6, capPerHour: 6}]]; seen.length = 0;
r = await post();
expect('the hourly cap still answers at once from the first check, without a retry', r.status === 429 && seen.join() === '/health', JSON.stringify({status: r.status, seen}));

healthReplies = [[0, null], ok]; seen.length = 0;
r = await post();
expect('a health check that hangs for 4 s is not retried: saved comparison at about 4 s', r.status === 503 && r.body.reason === 'unreachable' &&
  seen.join() === '/health' && r.ms >= 3900 && r.ms < 5500, JSON.stringify({seen, ms: r.ms}));

server.close(); proxy.closeAllConnections?.(); proxy.close();
console.log(failed ? failed + ' live Explain retry check(s) failed' : 'all live Explain retry checks passed');
process.exit(failed ? 1 : 0);
