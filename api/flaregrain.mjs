// Vercel Git deployment of the Flaregrain submission: one function serves the whole site through
// flaregrain/redesign/server.mjs, the same server the team's preview runs (vercel.json routes every path here).
// Live Explain and model Ask stay off unless the project sets FLAREGRAIN_MINI_EXPLAIN_URL (and FLAREGRAIN_LIVE_ASK=1).
const app = import('../flaregrain/redesign/server.mjs');

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://flaregrain.invalid');
  const path = url.searchParams.get('__flaregrain_path');
  url.searchParams.delete('__flaregrain_path');
  if (path !== null) url.pathname = '/' + path.replace(/^\/+/, '');
  req.url = url.pathname + url.search;
  res.setHeader('Referrer-Policy', 'no-referrer');
  const {server} = await app;
  server.emit('request', req, res);
}
