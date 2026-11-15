/* Flaregrain progressive-disclosure prototype: flame, scroll morph, card reveal, and the ask flow (answers from /api/ask). */
(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isAnswerPage = document.body.classList.contains('page-answer');
  const H = isAnswerPage ? 'h1' : 'h2'; // the answer is the answer page's main heading; the home page already has its hero h1
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ---------- Ask → answer (Layer 1) → sources (Layer 2) → full record (Layer 3, drawer.js) ----------
     Every answer comes from /api/ask, which runs the dashboard's own answerCatalogQuestion(). No answer is written here. */
  const D = window.FlaregrainDrawer;
  const esc = D.esc, mk = D.mk;
  const ICON = {
    out: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 8 8 2M3.5 2H8v4.5"/></svg>',
    arrow: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 5h8M5.5 1.5 9 5 5.5 8.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="m5 8.3 2 2 4-4.3"/></svg>',
  };
  const slot = document.getElementById('answer');
  const form = document.getElementById('ask-form');
  const input = document.getElementById('ask-input');
  const served = location.protocol !== 'file:';
  let latest = 0;
  // The loader: 0 = the sphere rests in the background, 1 = it is alive beside the answer. It eases between the two over
  // 1.2 s; the particle loop below reads it every frame. Reduced motion: no movement, the value switches at once.
  const orb = {from: 0, to: 0, t0: 0, still: null};
  const LOAD_MS = 1200;
  const loadValue = now => { if (reduced) return orb.to; const t = clamp((now - orb.t0) / LOAD_MS, 0, 1); return orb.from + (orb.to - orb.from) * (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); };
  function setLoading(on) {
    if (orb.to === (on ? 1 : 0)) return;
    const now = performance.now(); orb.from = loadValue(now); orb.to = on ? 1 : 0; orb.t0 = now;
    document.documentElement.classList.toggle('ask-writing', on);
    if (orb.still) orb.still();
  }
  let thread = [];  // history for this page, newest last
  // Snippets arrive with <mark> around matched words; everything else is escaped.
  const marked = s => esc(s).replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
  // An excerpt of about two lines: the snippet cut at a word near 170 characters, its <mark> tags kept whole.
  const shorten = (snippet, max = 170) => {
    let out = '', used = 0, open = false;
    for (const part of String(snippet).split(/(<\/?mark>)/)) {
      if (part === '<mark>' || part === '</mark>') { open = part === '<mark>'; out += part; continue; }
      if (used + part.length <= max) { out += part; used += part.length; continue; }
      const room = part.slice(0, max - used), cutAt = room.lastIndexOf(' ');
      return out + (cutAt > 0 ? room.slice(0, cutAt) : room).trimEnd() + (open ? '</mark>' : '') + ' …';
    }
    return out;
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  const HEAD = {
    supported: 'What the evidence shows',
    table: 'What the PSI tables show',
    unanswerable: 'No NASA record answers this',
    'no-match': 'No written answer yet',
  };

  const figure = (ex, source) => ex ? `<figure class="excerpt"><a href="${esc(source.url)}" target="_blank" rel="noopener"><img src="${esc(ex.src)}" alt="${esc(ex.alt)}"${ex.width ? ` width="${ex.width}" height="${ex.height}"` : ''} loading="lazy"></a><figcaption class="mono">Original page · ${esc(source.label)}</figcaption></figure>` : '';

  function passageChip(f, i) {
    const panel = 'pas-' + i;
    return `<div class="chip" data-chip>
      <button class="chip-btn" type="button" aria-expanded="false" aria-controls="${panel}">
        ${mk('checked')}<b>Cited passage</b><span>${esc(f.source.label)}</span><i class="plus" aria-hidden="true"></i>
      </button>
      <div class="chip-panel" id="${panel}" role="region" aria-label="Cited passage, ${esc(f.source.label)}"><div><div class="inner">
        ${figure(f.excerpt, f.source)}
        <div class="acts"><a class="btn btn-line" href="${esc(f.source.url)}" target="_blank" rel="noopener">Open the NASA page ${ICON.out}</a></div>
      </div></div></div>
    </div>`;
  }

  function recordChip(r, i, shown = new Set()) {
    const panel = 'rec-' + i;
    return `<div class="chip" data-chip>
      <button class="chip-btn" type="button" aria-expanded="false" aria-controls="${panel}">
        ${mk(r.psiRow ? 'psi' : 'checked')}<b>${esc(r.name)}</b><span>${esc(r.relevance)}</span><i class="plus" aria-hidden="true"></i>
      </button>
      <div class="chip-panel" id="${panel}" role="region" aria-label="${esc(r.name)}"><div><div class="inner">
        <p>${esc(r.reason)}</p>
        ${r.excerpt && !shown.has(r.source.url) ? figure(r.excerpt, r.source) : ''}
        <div class="acts">
          <button class="btn btn-ink" type="button" data-open="${esc(r.id)}">Open full record ${ICON.arrow}</button>
          ${r.source.url ? `<a class="btn btn-line" href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.label)} ${ICON.out}</a>` : ''}
          ${r.comparable ? `<a class="btn btn-line" href="compare.html?a=${encodeURIComponent(r.id)}">Compare with… ${ICON.arrow}</a>` : ''}
        </div>
      </div></div></div>
    </div>`;
  }

  // A limitation's text with the words the server names as a link to the report page they describe.
  const linked = (text, link) => link && text.includes(link.text)
    ? esc(text).replace(esc(link.text), `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.text)}</a>`) : esc(text);

  function render(a) {
    const N = a.supportingSources.length;
    const passagesWithExcerpt = a.findings.filter((f, i, all) => f.excerpt && all.findIndex(g => g.source.url === f.source.url) === i);
    const shownUrls = new Set(passagesWithExcerpt.map(f => f.source.url));
    const lead = a.findings[0], rest = a.findings.slice(1);
    const cite = f => `<a class="cite-link" href="${esc(f.source.url)}" target="_blank" rel="noopener" title="${esc(f.source.label)}">${esc(f.source.label)} ${ICON.out}</a>`;
    const names = a.compare ? a.compare.map(id => (a.ranks.find(r => r.id === id) || {}).name || id) : [];
    const investigations = a.investigations.length ? `<details class="related"><summary class="mono">${plural(a.investigations.length, 'ranked investigation', 'ranked investigations')}</summary>
      <ol class="inv">${a.investigations.map(v => `<li><b>${esc(v.name)}</b> <span class="mono">${esc(v.psi)}</span>${v.matched.length ? `<span>${esc(v.matched.join(' · '))}</span>` : ''}${v.weaker ? `<span class="weak">Ranked below ${esc(a.investigations[0].name)}: ${esc(v.weaker)}</span>` : ''}</li>`).join('')}</ol></details>` : '';
    const passages = a.passages.length ? `<details class="related" open><summary class="mono">${plural(a.passages.length, 'report passage', 'report passages')}</summary>
      <ol class="passages">${a.passages.map(p => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.report)} · PDF p. ${esc(p.page)} ${ICON.out}</a><p>${marked(p.snippet)}</p></li>`).join('')}</ol></details>` : '';

    const live = !lead && a.reading?.live;
    // The evidence under an answer is one closed line that opens to the record chips and report pages.
    const sourceParts = [
      passagesWithExcerpt.length && plural(passagesWithExcerpt.length, 'cited passage', 'cited passages'),
      a.ranks.length && plural(a.ranks.length, a.ranks.every(r => !r.psiRow) ? 'checked record' : 'ranked record', a.ranks.every(r => !r.psiRow) ? 'checked records' : 'ranked records'),
      !live && a.passages.length && plural(a.passages.length, 'NASA report page', 'NASA report pages'),
      a.investigations.length && plural(a.investigations.length, 'ranked investigation', 'ranked investigations')].filter(Boolean);
    // One layout for every answer: question, headline, supporting lines, status badge, then (How we know).
    // A model-written answer fills the same places once it lands; its label stays on the block that holds its sentences.
    const top = live ? `<section class="reading-block ask-reading line-in" style="--d:1" id="ask-reading" aria-labelledby="ask-reading-h" data-state="writing">
        <span class="mono" id="ask-reading-h">AI summary · NASA sources linked below</span>
        <${H} tabindex="-1" id="answer-h">Reading the NASA sources…</${H}>
        ${a.limitation ? `<p class="plain" id="ask-lede" hidden>${esc(a.limitation)}</p>` : ''}
        ${STAGE_LINE}
        <div id="ask-lines"></div>
        <div class="support-answer" id="ask-support"></div>
        <div class="ask-making">
          <details class="related ask-made"><summary class="mono">How this answer was made</summary>
            <ol class="ask-steps" aria-label="How this answer is made">${['Sources found', 'Facts built', 'Writing', 'Checked', 'Matched'].map((name, i) =>
              `<li data-state="pending"><span class="mono n">${i + 1}</span><div><b>${name}</b> <span class="st"></span></div></li>`).join('')}</ol>
          </details>
        </div>
        <p class="small" id="ask-reading-status" role="status" hidden></p>
      </section>
      ${a.passages.length ? `<section class="says line-in" style="--d:3" aria-labelledby="says-h">
        <span class="mono" id="says-h">What the sources say</span>
        <ul>${a.passages.map(p => `<li><q>${marked(shorten(p.snippet))}</q> <a class="cite-link" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.report)} report · p. ${esc(p.page)} ${ICON.out}</a></li>`).join('')}</ul>
      </section>` : ''}` : `<${H} class="line-in" style="--d:1" tabindex="-1" id="answer-h">${lead ? esc(lead.text) : HEAD[a.status]}</${H}>
      ${lead ? `<p class="cite-row line-in" style="--d:1">${cite(lead)}</p>` : ''}
      ${rest.map((f, i) => `<p class="plain line-in" style="--d:${2 + i}">${esc(f.text)} ${cite(f)}</p>`).join('')}
      ${!lead && a.limitation ? `<p class="plain line-in" style="--d:2">${a.status === 'table' ? mk('psi') + ' ' : ''}${esc(a.limitation)}</p>` : ''}
      <div class="line-in support-answer" style="--d:3">
        ${N ? `<button class="verified" type="button" id="verified">${ICON.check}Supported by ${plural(N, 'cited NASA source', 'cited NASA sources')}</button>`
            : `<p class="no-source mono">${mk('missing')}No cited NASA source answers this directly</p>`}
        ${lead ? `<p class="team-mark mono">${mk('checked')}Checked by the team</p>` : ''}
        ${lead && a.limitation ? `<p class="limit"><span class="mono">Limitation</span><span>${linked(a.limitation, a.limitLink)}</span></p>` : ''}
      </div>
      ${a.compare ? `<div class="next line-in" style="--d:4"><a class="btn btn-ink" href="compare.html?ids=${encodeURIComponent(a.compare[0])},${encodeURIComponent(a.compare[1])}&q=${encodeURIComponent(a.query)}">Compare ${esc(names[0])} and ${esc(names[1])} ${ICON.arrow}</a></div>` : ''}`;

    slot.innerHTML = `
      ${top}
      ${sourceParts.length ? `<section class="how line-in" style="--d:5">
        <details class="related sources" id="sources" open><summary class="mono">${a.ranks.length || passagesWithExcerpt.length || (!live && a.passages.length) ? 'Sources' : 'Closest evidence'}: ${sourceParts.join(' · ')}</summary>
        ${passagesWithExcerpt.length ? `<div class="chips">${passagesWithExcerpt.map(passageChip).join('')}</div>` : ''}
        ${a.ranks.length ? `<div class="chips">${a.ranks.slice(0, 4).map((r, i) => recordChip(r, i, shownUrls)).join('')}</div>` : ''}
        ${a.ranks.length > 4 ? `<details class="related"><summary class="mono">${plural(a.ranks.length - 4, 'more ranked record', 'more ranked records')}</summary><div class="chips">${a.ranks.slice(4).map((r, i) => recordChip(r, i + 4, shownUrls)).join('')}</div></details>` : ''}
        ${investigations}${live ? '' : passages}
        </details>
      </section>` : ''}`;
    slot.hidden = false;
    slot.classList.remove('play', 'static'); void slot.offsetWidth;
    slot.classList.add(reduced ? 'static' : 'play');
    clearTimeout(render.settle);
    render.settle = setTimeout(() => slot.classList.replace('play', 'static'), 2000);
  }

  function message(html) { slot.hidden = false; slot.classList.add('static'); slot.innerHTML = html; }

  const threadBox = form && document.createElement('div');
  if (threadBox) { threadBox.className = 'thread'; threadBox.setAttribute('aria-label', 'Earlier questions'); form.insertAdjacentElement('afterend', threadBox); }
  const hint = form && document.createElement('p');
  if (hint) { hint.className = 'ask-hint mono'; hint.setAttribute('role', 'status'); form.insertAdjacentElement('afterend', hint); }
  function drawThread() {
    if (!threadBox) return;
    const earlier = thread.slice(0, -1).slice(-3).reverse();
    threadBox.innerHTML = earlier.length ? `<span class="mono">Earlier</span>${earlier.map(q => `<button type="button" class="earlier" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}<button type="button" class="clear" id="clear-thread">Clear conversation</button>` : '';
  }

  // The loading stage's one status line. show(key, html) swaps its text with a short crossfade; the same key twice is a no-op.
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const STAGE_LINE = '<p class="ask-stage" id="ask-stage" role="status"><i class="live-dot" aria-hidden="true"></i><span class="ts"><span class="t">Searching NASA records…</span></span></p>';
  function stageLine() {
    const stage = document.getElementById('ask-stage'); let shown = 1;
    return {el: stage, show(key, html) {
      const holder = stage && stage.querySelector('.ts'); if (!holder || shown === key) return; shown = key;
      const old = holder.querySelector('.t:not(.out)'), next = document.createElement('span');
      next.className = 't in'; next.innerHTML = html;
      if (old) { if (reduced) old.remove(); else { old.className = 't out'; setTimeout(() => old.remove(), 260); } }
      holder.appendChild(next);
    }};
  }
  const found = a => `Found ${plural(a.ranks.length, 'record', 'records')}${a.passages.length ? ` and ${plural(a.passages.length, 'report page', 'report pages')}` : ''}`;
  // A prepared answer gets the same thinking stage, about 2.5 s: stage 3 says it is the team's checked answer.
  async function think(a, ticket) {
    const line = stageLine(), live = () => ticket === latest && line.el && line.el.isConnected;
    setLoading(true);
    await wait(700); if (!live()) return; line.show(2, found(a));
    await wait(700); if (!live()) return; line.show(3, 'Using the team’s checked answer…');
    await wait(600); if (!live()) return; line.show(4, 'Checking every sentence…');
    await wait(500); if (!live()) return;
    setLoading(false); render(a);
    document.getElementById('answer-h').focus({preventScroll: true});
  }

  // Model-written Ask: the server sends the question and the sources it ranked to the team's model; only checked sentences come back.
  async function reading(query, ticket, a) {
    const box = document.getElementById('ask-reading'), status = document.getElementById('ask-reading-status');
    const steps = box && box.querySelector('.ask-steps'), made = box && box.querySelector('.ask-made');
    if (!box || !status || !steps || !made) return;
    // While the model writes, the page's background sphere is the loader (styles.css, .ask-writing); once a reply lands
    // it settles and the steps stay as "How this answer was made".
    setLoading(true);
    // Every live answer ends with a Compare action, like a prepared answer: the two top-ranked records as a pair, one
    // record with the other left to pick, or the Compare page itself when no record was ranked.
    const compareAction = i => {
      const pick = a.compare && a.compare.map(id => a.ranks.find(r => r.id === id)).filter(Boolean);
      const [x, y] = pick?.length === 2 ? pick : a.ranks.filter(r => r.comparable);
      const [href, label] = x && y ? [`compare.html?ids=${encodeURIComponent(x.id)},${encodeURIComponent(y.id)}&q=${encodeURIComponent(query)}`, `Compare ${esc(x.name)} and ${esc(y.name)}`]
        : x ? [`compare.html?a=${encodeURIComponent(x.id)}`, `Compare ${esc(x.name)} with…`] : ['compare.html', 'Open Compare'];
      return `<div class="next rise" style="--i:${i}"><a class="btn btn-ink" href="${href}">${label} ${ICON.arrow}</a></div>`;
    };
    // No answer to show: the neutral title and today's message take the headline's place.
    // The team's limitation for this question (the airflow question has one) sits under the answer, marked as the team's note.
    const note = i => a.note ? `<p class="limit rise" style="--i:${i}"><span class="mono">Limitation</span><span>${linked(a.note, a.limitLink)} <span class="mono by">Team’s note, not model text</span></span></p>` : '';
    const neutral = () => { document.getElementById('answer-h').textContent = 'From the closest NASA sources'; document.getElementById('ask-lede')?.removeAttribute('hidden');
      document.getElementById('ask-support').innerHTML = note(0);
      if (!box.querySelector('.next')) status.insertAdjacentHTML('afterend', compareAction(0)); settle('fallback');
      const sources = document.getElementById('sources'); if (sources) sources.open = true; };
    // The loading stage ends: the sphere settles, and the excerpts and record chips (hidden while loading) arrive after the answer's lines.
    const settle = state => { clearTimeout(toFound); clearTimeout(toWriting); setLoading(false);
      const after = box.querySelectorAll('.rise').length;
      slot.querySelectorAll('.says, .how').forEach((el, i) => { el.classList.remove('line-in'); el.classList.add('rise'); el.style.setProperty('--i', after + i); });
      box.dataset.state = state; };
    const step = (n, state, html) => { const li = steps.children[n - 1]; li.dataset.state = state; li.querySelector('.st').innerHTML = html; };
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    step(1, 'done', `${count(a.ranks.length, 'checked record', 'checked records')} and ${count(a.passages.length, 'NASA report page', 'NASA report pages')}, ranked for this question`);
    step(2, 'done', `${count(a.reading.facts || 0, 'numbered fact', 'numbered facts')} from those sources`);
    const started = Date.now();
    step(3, 'active', 'qwen3:4b on the team’s Mac mini is writing…');
    // While loading the page shows one live status line that moves through four stages; each swap is a short crossfade.
    const line = stageLine(), stage = line.el, seconds = () => Math.floor((Date.now() - started) / 1000) + ' s';
    const STAGES = [null, 'Searching NASA records…', found(a),
      `Writing from ${count(a.reading.facts || 0, 'fact', 'facts')}… <span class="tick"></span>`, 'Checking every sentence…'];
    const show = n => { line.show(n, STAGES[n]); if (n === 3) { const tick = stage.querySelector('.t:not(.out) .tick'); if (tick && !tick.textContent) tick.textContent = seconds(); } };
    // Stages 1 and 2 are done before the page is drawn; each is held 0.7 s so it can be read.
    const toFound = setTimeout(() => show(2), 700), toWriting = setTimeout(() => show(3), 1400);
    const timer = setInterval(() => { if (!box.isConnected) return clearInterval(timer); const tick = stage.querySelector('.t:not(.out) .tick'); if (tick) tick.textContent = seconds(); }, 1000);
    const reasonList = list => {
      const counts = new Map(); (list || []).forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
      return counts.size ? `<ul class="ask-reasons">${[...counts].map(([r, n]) => `<li>${esc(r)}${n > 1 ? ` (${n})` : ''}</li>`).join('')}</ul>` : '';
    };
    const at = body => new Date(body.generatedAt).toLocaleTimeString('en-CA', {timeZone: 'America/Halifax', hour: '2-digit', minute: '2-digit', hour12: false});
    const wrote = body => body.cached && body.generatedAt
      ? `Reused: written by the live model at ${at(body)} AST`
      : `qwen3:4b on the team’s Mac mini wrote it${Number.isFinite(body.seconds) ? ` in ${body.seconds} s` : ''}`;
    try {
      const res = await fetch('/api/ask-reading', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({q: query})});
      const body = await res.json().catch(() => ({}));
      clearInterval(timer);
      if (ticket !== latest || !box.isConnected) { clearTimeout(toFound); clearTimeout(toWriting); return; } // another question was asked meanwhile
      if (!res.ok || body.status !== 'ok') {
        neutral();
        const reason = body.reason || 'unavailable';
        show(reason === 'scope' ? 1 : reason === 'none' || reason === 'mismatch' ? 4 : 3); stage.classList.add('stopped'); // the line stops on the stage that failed
        if (reason === 'scope') step(1, 'failed', 'outside what Flaregrain covers');
        else if (reason === 'none') {
          step(3, 'done', wrote(body));
          step(4, 'failed', `kept 0 sentences, removed ${body.removed || 0}` + reasonList(body.reasons));
        } else if (reason === 'mismatch') {
          step(3, 'done', wrote(body)); step(4, 'done', 'the checker ran on the proxy');
          step(5, 'failed', 'the answer did not name the same sources and facts, so it is not shown');
        } else step(3, 'failed', 'no answer from the live model');
        status.textContent = body.message || 'Live model unavailable. The closest evidence is below.'; status.hidden = false;
        return;
      }
      // Every answer finishes the stages. Stages 1 and 2 are held, then stage 3 says what really happened: a fresh answer was
      // written just now; one asked before is recalled, with the time it was written (0.6 s). Then "Checking…" for 0.5 s.
      clearTimeout(toWriting);
      await wait(Math.max(0, 1400 - (Date.now() - started)));
      if (body.cached && body.generatedAt) { line.show('recall', `Recalling the answer written at ${at(body)} AST…`); await wait(600); } else show(3);
      show(4); await wait(500);
      if (ticket !== latest || !box.isConnected) return;
      stage.remove();
      step(3, 'done', wrote(body));
      step(4, 'done', `kept ${count(body.sentences.length, 'sentence', 'sentences')}, removed ${body.removed}` + reasonList(body.reasons));
      step(5, 'done', `same sources and facts fingerprint <code>${esc(body.factsHash || '')}</code>`);
      // A short link at the end of each sentence: the record or report it cites and the PDF page. The full label is the title.
      const short = src => {
        const page = (src.url.match(/#page=(\d+)/) || src.label.match(/p\.\s*(\d+)/) || [])[1];
        const doc = url => String(url || '').split('#')[0], word = name => name.split(' ')[0];
        const pas = a.passages.find(p => p.url === src.url), recs = a.ranks.filter(r => r.source?.url && doc(r.source.url) === doc(src.url));
        const name = pas ? pas.report.split(':')[0] : recs.length === 1 ? recs[0].name
          : recs.length && recs.every(r => word(r.name) === word(recs[0].name)) ? word(recs[0].name) : src.label.split(' · ')[0];
        return `<a class="cite-link" href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(src.label)}">${esc(name)}${page ? ' · p. ' + esc(page) : ''} ${ICON.out}</a>`;
      };
      const links = s => `<span class="cites-inline">${s.sources.map(short).join(' ')}</span>`;
      const sentence = (s, i) => `<p class="plain rise" style="--i:${i + 1}">${esc(s.text)} ${links(s)}</p>`;
      const [first, ...others] = body.sentences, reused = body.cached && body.generatedAt, n = body.sentences.length;
      // The answer arrives line by line: headline, then each sentence, then the badge and Compare.
      const h = document.getElementById('answer-h');
      h.innerHTML = `${esc(first.text)} ${links(first)}`; h.classList.add('rise');
      document.getElementById('ask-lede')?.remove();
      document.getElementById('ask-lines').innerHTML = others.map(sentence).join('');
      document.getElementById('ask-support').innerHTML =
        `<button class="verified rise" style="--i:${n}" type="button" id="verified">${ICON.check}${esc(n)} passed the checker, ${esc(body.removed)} removed${reused ? ` · asked before, ${at(body)} AST` : Number.isFinite(body.seconds) ? ` · ${body.seconds} s` : ''}</button>` + note(n + 1);
      document.getElementById('ask-support').insertAdjacentHTML('afterend', compareAction(n + (a.note ? 2 : 1)));
      settle(reused ? 'reused' : 'done');
    } catch {
      clearInterval(timer);
      if (ticket === latest && box.isConnected) { neutral(); show(3); stage.classList.add('stopped'); step(3, 'failed', 'no answer from the live model'); status.textContent = 'Live model unavailable. The closest evidence is below.'; status.hidden = false; }
    }
  }

  async function ask(query, {scroll = true} = {}) {
    if (thread[thread.length - 1] !== query) thread.push(query);
    if (thread.length > 12) thread = thread.slice(-12);
    drawThread();
    if (hint) hint.textContent = '';
    if (!served) {
      return message(`<div class="cmp-offline"><${H} id="answer-h" tabindex="-1">Start the prototype server to ask</${H}>
        <p>Answers come from the dashboard’s own question handling, so they need the small local server:</p>
        <pre>cd server && node server.mjs</pre><p>Then open <a href="http://127.0.0.1:8790/">http://127.0.0.1:8790/</a>.</p></div>`);
    }
    const ticket = ++latest;
    setLoading(false);
    message(`<div class="ask-shell"><${H} id="answer-h" tabindex="-1">Reading the NASA sources…</${H}>${STAGE_LINE}</div>`);
    if (scroll) slot.scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block: 'start'});
    try {
      const res = await fetch('/api/ask?q=' + encodeURIComponent(query), {headers: {Accept: 'application/json'}});
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'The answer could not be loaded.');
      if (ticket !== latest) return;
      if (body.findings.length && !body.reading?.live) return think(body, ticket); // the prepared answer
      render(body);
      document.getElementById('answer-h').focus({preventScroll: true});
      if (body.reading?.live) reading(query, ticket, body);
    } catch (e) {
      if (ticket !== latest) return;
      message(`<p class="q mono">${esc(query)}</p><${H} id="answer-h" tabindex="-1">The answer couldn’t load</${H}>
        <p class="plain">${esc(e.message === 'Failed to fetch' ? 'The prototype server isn’t answering.' : e.message)}</p>
        <button class="btn btn-line" type="button" id="retry">Retry</button>`);
      document.getElementById('retry').addEventListener('click', () => ask(query, {scroll: false}));
      document.getElementById('answer-h').focus({preventScroll: true});
    }
  }

  document.addEventListener('click', async e => {
    const opener = e.target.closest('[data-open]');
    if (opener && slot?.contains(opener)) {
      try { await D.open(opener.dataset.open, {opener}); } catch (err) { opener.insertAdjacentHTML('afterend', `<span class="small" role="status">${esc(err.message)}</span>`); }
      return;
    }
    const btn = e.target.closest('.chip-btn');
    if (btn) { const c = btn.closest('[data-chip]'); const open = !c.classList.contains('open'); c.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); return; }
    if (e.target.closest('#verified')) {
      const first = slot.querySelector('[data-chip] .chip-btn');
      if (!first) return;
      for (let d = first.closest('details'); d; d = d.parentElement.closest('details')) d.open = true; // the closed Sources line
      if (first.getAttribute('aria-expanded') !== 'true') first.click();
      first.focus({preventScroll: true});
      first.scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block: 'center'});
    }
  });

  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) { hint.textContent = 'Type a question, or pick one of the suggestions.'; input.focus(); return; }
      if (isAnswerPage) history.replaceState(null, '', '?q=' + encodeURIComponent(q));
      ask(q);
    });
    // Suggestions are the dashboard's own prepared questions.
    const sugg = document.querySelector('.sugg');
    if (sugg && served) {
      fetch('/api/questions').then(r => r.json()).then(({questions}) => {
        sugg.innerHTML = questions.map(q => `<button type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
      }).catch(() => {});
    }
    document.addEventListener('click', e => {
      if (e.target.closest('#clear-thread')) { thread = thread.slice(-1); drawThread(); input.focus(); return; }
      const b = e.target.closest('[data-ask]');
      if (b) { input.value = b.dataset.ask; form.requestSubmit(); }
    });
  }
  // The nav's "Ask & browse" link lands on the home page's Ask section: scrolled into place with the box focused, on
  // arrival and when the link is clicked on the home page itself.
  const askSection = !isAnswerPage && form && document.getElementById('ask');
  if (askSection) {
    const land = () => { if (location.hash !== '#ask') return; askSection.scrollIntoView({behavior: 'auto', block: 'start'}); input.focus({preventScroll: true}); };
    land(); addEventListener('load', land); addEventListener('hashchange', land);
    document.addEventListener('click', e => { if (e.target.closest('a[href$="index.html#ask"]')) setTimeout(land, 0); });
  }
  if (isAnswerPage) {
    const q = new URLSearchParams(location.search).get('q');
    if (q) { input.value = q; ask(q, {scroll: false}); }
    else { // arriving from the nav: an empty box, focused and ready; the page keeps one (visually hidden) h1 until an answer brings its own
      input.value = ''; slot.innerHTML = '<h1 class="vh">Ask the experiments</h1>'; input.focus();
    }
  }

  /* ---------- Summary cards: live counts from /api/summary ---------- */
  const sums = document.querySelectorAll('[data-sum]');
  if (sums.length && served) {
    fetch('/api/summary').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      const fmt = v => typeof v === 'number' ? v.toLocaleString('en-CA') : Array.isArray(v) ? v.join(', ') : v && v.field ? v.field.toLowerCase() + ' in ' + v.record : String(v ?? '–');
      sums.forEach(el => { el.textContent = fmt(el.dataset.sum.split('.').reduce((o, k) => o?.[k], data)); });
    }).catch(() => { document.querySelector('.cards')?.insertAdjacentHTML('afterend', '<p class="small cards-note">Counts are unavailable right now.</p>'); });
  } else if (sums.length) {
    document.querySelector('.cards')?.insertAdjacentHTML('afterend', '<p class="small cards-note">Start the prototype server for live counts.</p>');
  }

  /* ---------- Card reveal ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) reveals.forEach(el => el.classList.add('in'));
  else {
    const io = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .2 });
    reveals.forEach(el => io.observe(el));
  }

  /* ---------- Particle flame ---------- */
  const canvas = document.querySelector('.stage-canvas');
  const glow = document.querySelector('.glow');
  const hero = document.querySelector('.hero');
  const stateA = document.getElementById('state-a');
  const stateB = document.getElementById('state-b');
  const bar = document.querySelector('.progress');

  const VERT = `
    attribute vec4 aSeed; attribute vec3 aDir;
    uniform float uTime, uMorph, uSize, uPR, uBoost;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float t = fract(aSeed.w * 7.13 + uTime * (0.20 + aSeed.x * 0.16));
      float prof = pow(sin(3.14159 * pow(t, 0.62)), 1.35);
      float rr = 0.62 * prof * (1.0 - 0.25 * t) * sqrt(aSeed.y);
      float ang = aSeed.z * 6.28318 + uTime * 0.25;
      vec3 earth = vec3(cos(ang) * rr, t * 2.5 - 1.15, sin(ang) * rr);
      earth.x += sin(uTime * 3.1 + t * 9.0 + aSeed.w * 6.0) * 0.14 * t * t;
      earth.z += cos(uTime * 2.7 + t * 8.0 + aSeed.x * 5.0) * 0.05 * t;
      vec3 sph = aDir * (0.74 + aSeed.y * 0.10 + t * 0.24);
      sph += aDir * sin(uTime * 1.1 + aSeed.z * 6.28) * 0.015;
      vec3 p = mix(earth, sph, uMorph);
      float soot = step(0.9, aSeed.x);
      vec3 eCol = mix(vec3(1.0, 0.93, 0.70), vec3(1.0, 0.56, 0.14), smoothstep(0.05, 0.45, t));
      eCol = mix(eCol, vec3(0.80, 0.24, 0.06), smoothstep(0.5, 0.95, t));
      eCol = mix(eCol, vec3(0.42, 0.36, 0.33), soot * smoothstep(0.3, 0.8, t));
      vec3 sCol = mix(vec3(0.84, 0.91, 1.0), vec3(0.28, 0.46, 0.90), t);
      vColor = mix(mix(eCol, sCol, uMorph), vec3(1.0, 0.96, 0.90), sin(3.14159 * uMorph) * 0.55);
      float eA = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.55, 1.0, t)) * mix(0.9, 0.6, soot);
      float rim = 1.0 - abs(aDir.z);
      float sA = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.6, 1.0, t)) * mix(0.06, 1.0, pow(rim, 1.6));
      vAlpha = mix(eA, sA, uMorph) * mix(1.0, 1.0 - t, uBoost);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = uSize * (0.55 + aSeed.z * 0.9) * mix(1.0 - 0.45 * t, 1.0, uMorph) * uPR / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const FRAG = `
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vColor, a * a * vAlpha);
    }`;

  function noWebGL() { document.documentElement.classList.add('no-webgl'); return null; }
  function makeFlame() {
    if (!canvas) return null;
    if (!window.THREE) return noWebGL();
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' }); }
    catch (e) { return noWebGL(); }
    if (!renderer.getContext()) return noWebGL();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.1, 6);
    const N = innerWidth < 760 ? 3800 : 7500;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4), dir = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      let x, y, z, l;
      do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
      l = Math.sqrt(l); dir[i * 3] = x / l; dir[i * 3 + 1] = y / l; dir[i * 3 + 2] = z / l;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    const uniforms = { uTime: { value: 2.3 }, uMorph: { value: 0 }, uSize: { value: 64 }, uPR: { value: renderer.getPixelRatio() }, uBoost: { value: 0 } };
    const base = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    const glowU = Object.assign({}, uniforms, { uSize: { value: 40 }, uBoost: { value: 1 } });
    const add = new THREE.ShaderMaterial({ uniforms: glowU, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const group = new THREE.Group();
    group.add(new THREE.Points(geo, base), new THREE.Points(geo, add));
    group.frustumCulled = false; group.children.forEach(c => c.frustumCulled = false);
    scene.add(group);
    function size() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    size(); addEventListener('resize', size);
    return {
      draw(time, morph, rx, ry, x, s, y) {
        uniforms.uTime.value = time; uniforms.uMorph.value = morph;
        glowU.uTime.value = time; glowU.uMorph.value = morph;
        group.rotation.set(rx, ry, 0); group.position.x = x; group.position.y = y; group.scale.setScalar(s);
        renderer.render(scene, camera);
      }
    };
  }

  const flame = makeFlame();
  const rot = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduced) addEventListener('pointermove', e => { rot.ty = (e.clientX / innerWidth - .5) * .7; rot.tx = (e.clientY / innerHeight - .5) * .28; }, { passive: true });

  function readScroll() {
    if (isAnswerPage || !hero) return { morph: 1, fade: .5 };
    const r = hero.getBoundingClientRect();
    const p = clamp(-r.top / (r.height - innerHeight), 0, 1);
    const after = clamp((innerHeight - r.bottom) / (innerHeight * .7), 0, 1);
    let morph = smooth(.15, .75, p); // the hero is 2.4 screens tall: the flame changes over about 0.85 screens of scrolling, then rests on (B)
    if (reduced) morph = p < .5 ? 0 : 1;
    if (bar) bar.style.setProperty('--p', p.toFixed(3));
    document.documentElement.classList.toggle('past-hero', r.bottom < innerHeight * .92); // hero text fades before it reaches the nav
    return { morph, fade: 1 - after * .9 };
  }
  function applyChrome(morph, fade) {
    if (stateA) { const b = smooth(.48, .52, morph); stateA.style.opacity = 1 - smooth(.3, .46, morph); stateB.style.opacity = smooth(.54, .7, morph); stateA.setAttribute('aria-hidden', b > .5); stateB.setAttribute('aria-hidden', b <= .5); }
    const c = [232 + (110 - 232) * morph, 135 + (150 - 135) * morph, 58 + (235 - 58) * morph].map(Math.round).join(',');
    if (glow) { glow.style.setProperty('--glow', c); glow.style.opacity = fade; }
    if (canvas) canvas.style.opacity = fade;
    document.documentElement.classList.toggle('is-micro', morph > .5);
  }

  const offX = () => isAnswerPage ? (innerWidth < 760 ? 0 : 2.5) : 0;
  const scale = () => (isAnswerPage ? .55 : 1) * (innerWidth < 760 ? .76 : 1); // phone: room for the larger hero text
  const baseY = () => (innerWidth < 760 && !isAnswerPage) ? .66 : 0;
  // Where the sphere is drawn. At rest it sits in the page background. While the model writes it eases
  // to a clear place beside the answer (the home page's Ask box included), grows a little, brightens to the home page's microgravity blue with a faint warm core, and breathes slowly.
  const WIDE = 1100; // below this the answer column has no room beside it
  const HALF_H = Math.tan(17.5 * Math.PI / 180) * 6, ORB_R = 1.08; // camera: 35° at z = 6; the sphere's radius at scale 1
  function pose(now, fade) {
    const k = loadValue(now), W = innerWidth, Hh = innerHeight, halfW = HALF_H * W / Hh, unit = (Hh / 2) / HALF_H; // px per world unit
    let x = offX(), y = baseY(), s = scale();
    const wide = W >= WIDE;
    if (k > 0 && !reduced && wide) {
      const right = (W + 720) / 2 - 90, room = W - right, r = Math.min(170, room / 2 - 24), cx = right + room / 2, cy = Hh / 2 + .1 * unit;
      const lerp = (a, b) => a + (b - a) * k;
      x = lerp(x, (cx - W / 2) / unit); y = lerp(y, .1 - (cy - Hh / 2) / unit);
      s = lerp(s, r / unit / ORB_R) * (1 + k * .03 * Math.sin(now / 1000 * 2 * Math.PI / 3.6));
    }
    const breathe = reduced ? 1 : .94 + .06 * Math.sin(now / 1000 * 2 * Math.PI / 3.6);
    // Wide: the sphere brightens. Narrower (phones, tablets): there is no clear place for it, so it fades out while loading.
    if (canvas && k > 0) canvas.style.opacity = wide ? fade + (1 - fade) * k * breathe : fade * (1 - k); // at rest applyChrome's value stands
    if (glow && isAnswerPage) { // the warm core, moved with transform and opacity only (the home page keeps its hero glow)
      const r = s * ORB_R * unit;
      glow.style.transform = `translate3d(${(W / 2 + x * unit - 150).toFixed(1)}px,${(Hh / 2 - (y - .1) * unit - 150).toFixed(1)}px,0) scale(${(r / 150 * 1.25).toFixed(3)})`;
      glow.style.opacity = wide ? (k * .9 * breathe).toFixed(3) : '0';
    }
    return {x, y, s};
  }
  if (reduced) {
    const still = () => { const s = readScroll(); applyChrome(s.morph, s.fade); const p = pose(0, s.fade); if (flame) flame.draw(2.3, s.morph, 0, 0, p.x, p.s, p.y); };
    orb.still = still;
    addEventListener('scroll', still, { passive: true }); addEventListener('resize', still); still();
  } else {
    const t0 = performance.now();
    (function loop(now) {
      const s = readScroll();
      applyChrome(s.morph, s.fade);
      rot.x += (rot.tx - rot.x) * .05; rot.y += (rot.ty - rot.y) * .05;
      const p = pose(now, s.fade);
      if (flame && s.fade > .02 && !document.hidden) flame.draw((now - t0) / 1000, s.morph, rot.x, rot.y + (now - t0) / 9000, p.x, p.s, p.y);
      requestAnimationFrame(loop);
    })(t0);
  }
})();
