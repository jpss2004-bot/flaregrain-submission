/* Secondary destinations: Browse, Evidence, Moon & Mars air, System design. Data comes from the prototype API. Findings is static. */
(function () {
  const D = window.FlaregrainDrawer;
  const esc = D.esc, mk = D.mk;
  const $ = id => document.getElementById(id);
  const page = document.body.dataset.page;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OUT = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 8 8 2M3.5 2H8v4.5"/></svg>';
  const ARROW = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 5h8M5.5 1.5 9 5 5.5 8.5"/></svg>';
  const plural = (n, one, many) => n.toLocaleString('en-CA') + ' ' + (n === 1 ? one : many);
  const store = {get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }};

  const api = path => fetch(path, {headers: {Accept: 'application/json'}}).then(async r => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || 'Request failed'), {status: r.status});
    return body;
  });
  function offline(el) {
    el.innerHTML = `<div class="cmp-offline"><h2>Start the prototype server</h2><p>This page reads the dashboard’s own data through the small local server:</p>
      <pre>cd server && node server.mjs</pre><p>Then open <a href="http://127.0.0.1:8790/${esc(location.pathname.split('/').pop())}">http://127.0.0.1:8790/${esc(location.pathname.split('/').pop())}</a>.</p></div>`;
  }
  const served = location.protocol !== 'file:';
  const retry = (status, message, again) => {
    status.innerHTML = `${esc(message)} <button type="button" class="retry">Retry</button>`;
    status.querySelector('.retry').addEventListener('click', again);
  };
  // This submission carries the 13 hand-checked records. Views that need the full dataset say so plainly, instead of an error with Retry.
  const SCOPE = `<p><b>Part of the full-data demo.</b> This view reads Flaregrain’s full NASA PSI dataset (24 investigations, 2,009 table rows), which the team shows live. This public site carries 13 hand-checked NASA records (11 comparable runs), with links to the original reports.</p>
    <p class="scope-links"><a class="btn btn-line" href="compare.html?ids=B1,S1">Compare B1 and Saffire I-1</a> <a class="btn btn-line" href="evidence.html">Open the evidence</a></p>`;
  const scope = (el, hide = []) => {
    hide.forEach(x => { if (x) { x.hidden = true; x.textContent = ''; } });
    el.className = 'scope-note';
    el.innerHTML = SCOPE;
  };

  // Tabs with arrow-key movement (role=tablist).
  function tabs(list, onSelect) {
    const all = [...list.querySelectorAll('[role=tab]')];
    const select = (tab, focus) => {
      all.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
      if (focus) tab.focus();
      onSelect(tab);
    };
    all.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', e => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        select(all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length], true);
      });
    });
    return select;
  }

  // The dashboard's own view, embedded unchanged and opened on the right destination by its own controls.
  function embed(el) {
    if (el.dataset.loaded) return;
    el.dataset.loaded = '1';
    if (!served) return offline(el);
    const frame = document.createElement('iframe');
    frame.title = el.dataset.embedView === 'map' ? 'Atlas map from the current dashboard' : 'System design from the current dashboard';
    frame.src = '/dashboard/Foundry%20dashboard.html';
    frame.loading = 'lazy';
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      const click = sel => doc?.querySelector(sel)?.click();
      if (el.dataset.embedView === 'system') click('[data-view="system"]');
      else { click('[data-view="explore"]'); setTimeout(() => click('[data-explore-pane="map"]'), 150); }
    });
    el.appendChild(frame);
  }

  document.addEventListener('click', async e => {
    const opener = e.target.closest('[data-open]');
    if (opener) {
      store.set('fg-last-record', opener.dataset.open);
      try { await D.open(opener.dataset.open, {opener}); } catch (err) { opener.insertAdjacentHTML('afterend', `<span class="small" role="status">${esc(err.message)}</span>`); }
    }
  });

  /* ---------- Browse: Catalog list + Atlas map ---------- */
  if (page === 'browse') {
    const list = $('cat-list'), status = $('cat-status'), q = $('cat-q'), study = $('cat-study'), pager = $('cat-pager');
    let pageNo = 0, timer = 0, ticket = 0;
    const load = async () => {
      if (!served) return offline(list);
      const mine = ++ticket;
      status.textContent = 'Loading records…';
      try {
        const data = await api(`/api/catalog?q=${encodeURIComponent(q.value.trim())}&study=${encodeURIComponent(study.value)}&page=${pageNo}`);
        if (mine !== ticket) return;
        if (study.options.length === 1) study.insertAdjacentHTML('beforeend', data.studies.map(s => `<option value="${esc(s.name)}">${esc(s.name)}${s.psi ? ' · ' + esc(s.psi) : ''}</option>`).join(''));
        const from = data.page * data.pageSize + 1, to = Math.min(data.total, from + data.records.length - 1);
        status.textContent = data.total ? `${plural(data.total, 'record', 'records')}${data.total > data.pageSize ? ` · showing ${from}–${to}` : ''}` : 'No records match. Try fewer words or another investigation.';
        list.innerHTML = data.records.map(r => `<li class="cat-row">
          <div class="cat-main">${mk(r.origin === 'checked' ? 'checked' : 'psi')}<b>${esc(r.name)}</b><span class="mono">${r.origin === 'checked' ? 'Checked NASA record' : 'PSI table row'}</span></div>
          <p>${esc([r.conditions, r.observation].filter(Boolean).join(' · '))}</p>
          <div class="acts"><button class="btn btn-line" type="button" data-open="${esc(r.id)}">Open full record ${ARROW}</button>
          ${r.comparable ? `<a class="btn btn-line" href="compare.html?a=${encodeURIComponent(r.id)}">Compare with… ${ARROW}</a>` : ''}</div></li>`).join('');
        const pages = Math.ceil(data.total / data.pageSize);
        pager.innerHTML = pages > 1 ? `<button class="btn btn-line" type="button" data-pg="-1"${data.page === 0 ? ' disabled' : ''}>Previous</button><span class="mono">Page ${data.page + 1} of ${pages}</span><button class="btn btn-line" type="button" data-pg="1"${data.page + 1 >= pages ? ' disabled' : ''}>Next</button>` : '';
      } catch (err) { if (mine === ticket) retry(status, err.status ? err.message : 'The catalog is unavailable right now.', load); }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { pageNo = 0; load(); }, 250); });
    study.addEventListener('change', () => { pageNo = 0; load(); });
    $('cat-form').addEventListener('submit', e => { e.preventDefault(); pageNo = 0; load(); });
    pager.addEventListener('click', e => { const b = e.target.closest('[data-pg]'); if (b) { pageNo += Number(b.dataset.pg); load(); list.scrollIntoView({behavior: reduced ? 'auto' : 'smooth'}); } });
    const sel = tabs(document.querySelector('.tabs-bar'), tab => {
      const atlas = tab.id === 'tab-atlas';
      $('panel-catalog').hidden = atlas; $('panel-atlas').hidden = !atlas;
      if (atlas) embed($('atlas-embed'));
      history.replaceState(null, '', atlas ? '#atlas' : location.pathname);
    });
    if (location.hash === '#atlas') sel($('tab-atlas'));
    load();
  }

  /* ---------- Evidence: one or two records side by side ---------- */
  if (page === 'evidence') {
    const cols = $('ev-cols'), status = $('ev-status'), a = $('ev-a'), b = $('ev-b');
    const fieldRow = (f, r) => `<div class="${f.tier === 'missing' ? 'miss' : ''}">${mk(f.tier)}<dt>${esc(f.field)}</dt><dd>${esc(f.value)}${f.status ? `<small>${esc(f.status)}</small>` : ''}${f.url && f.url !== r.source.url ? ` <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)}</a>` : ''}</dd></div>`;
    const column = r => `<article class="ev-col">
      <p class="mono">${esc([r.investigation, r.sample].filter(Boolean).join(' · '))}</p>
      <h2>${esc(r.name)}</h2>
      ${r.sources.map(s => `<figure class="excerpt">${s.excerpt ? `<a href="${esc(s.url)}" target="_blank" rel="noopener"><img src="${esc(s.excerpt.src)}" alt="${esc(s.excerpt.alt)}"${s.excerpt.width ? ` width="${s.excerpt.width}" height="${s.excerpt.height}"` : ''}></a>` : ''}
        <figcaption><a class="cite-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ${OUT}</a>${s.excerpt ? '' : ' <span class="mono">· no page crop yet</span>'}</figcaption></figure>`).join('')}
      ${r.fields.some(f => f.tier === 'dispute') ? `<div class="sec"><span class="mono">Needs a second reading</span>${r.fields.filter(f => f.tier === 'dispute').map(f => `<div class="dispute-box"><div class="t">${mk('dispute')}${esc(f.field)} · sources disagree</div><p>${esc(f.value)}</p></div>`).join('')}</div>` : ''}
      <div class="sec"><span class="mono">Every field</span><dl class="fields">${r.fields.filter(f => f.tier !== 'dispute').map(f => fieldRow(f, r)).join('')}</dl></div>
    </article>`;
    async function show(ids) {
      status.textContent = 'Loading sources…';
      try {
        const {records} = await api('/api/evidence?ids=' + ids.map(encodeURIComponent).join(','));
        cols.innerHTML = records.map(column).join('');
        cols.classList.toggle('one', records.length === 1);
        status.textContent = records.length === 2 ? `${records[0].name} and ${records[1].name}, side by side.` : `${records[0].name}.`;
        history.replaceState(null, '', '?ids=' + ids.map(encodeURIComponent).join(','));
        if (ids.length === 2) store.set('fg-last-pair', ids.join(','));
      } catch (err) { retry(status, err.status ? err.message : 'The sources are unavailable right now.', () => show(ids)); }
    }
    (async () => {
      if (!served) return offline(cols);
      let records;
      try { ({records} = await api('/api/records')); } catch { return offline(cols); }
      const opts = sel => records.map(r => `<option value="${esc(r.id)}"${r.id === sel ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
      // From the nav: your last pair or record; otherwise the cutoff pair.
      const asked = (new URLSearchParams(location.search).get('ids') || store.get('fg-last-pair') || store.get('fg-last-record') || 'B1,S1').split(',').filter(Boolean).slice(0, 2);
      a.innerHTML = opts(asked[0]); b.innerHTML = '<option value="">None (one record)</option>' + opts(asked[1]);
      if (!records.some(r => r.id === asked[0])) a.insertAdjacentHTML('afterbegin', `<option value="${esc(asked[0])}" selected>${esc(asked[0])}</option>`);
      const go = () => { if (a.value === b.value) { status.textContent = 'Choose two different records, or none for B.'; return; } show([a.value, b.value].filter(Boolean)); };
      a.addEventListener('change', go); b.addEventListener('change', go);
      show(asked);
    })();
  }

  /* Particle planets for the Moon & Mars air opening: dots on a sphere, lit from the upper left like the home page's flame.
     They turn slowly, pause off screen and in background tabs, and hold still with reduced motion. */
  function planets() {
    document.querySelectorAll('canvas[data-planet]').forEach(canvas => {
      const mars = canvas.dataset.planet === 'mars', g = canvas.getContext('2d');
      let seed = mars ? 7 : 3;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const unit = () => { const y = rnd() * 2 - 1, r = Math.sqrt(1 - y * y), t = rnd() * 6.283; return [r * Math.cos(t), y, r * Math.sin(t)]; };
      const blobs = Array.from({length: mars ? 9 : 12}, () => [...unit(), .25 + rnd() * .35]);
      const dots = Array.from({length: mars ? 9000 : 8000}, () => {
        const [x, y, z] = unit();
        let dark = 0;
        for (const [bx, by, bz, br] of blobs) { const d = Math.hypot(x - bx, y - by, z - bz); if (d < br) dark = Math.max(dark, 1 - d / br); }
        const cap = mars && Math.abs(y) > .9;
        const base = cap ? [245, 235, 225] : mars ? [205 - dark * 70, 95 - dark * 35, 50 - dark * 20] : [150 - dark * 55, 149 - dark * 55, 147 - dark * 54];
        return {x, y, z, base, lift: cap ? [0, 0, 0] : mars ? [70, 70, 55] : [95, 94, 93], a: .6 + rnd() * .4, s: .7 + rnd() * .9};
      });
      const L = [-.55, -.6, .58];
      let size = 0, angle = rnd() * 6.283, last = 0, visible = true, frame = 0;
      const resize = () => { size = canvas.clientWidth; canvas.width = canvas.height = Math.round(size * devicePixelRatio); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
      const paint = () => {
        const R = size * .42, c = size / 2, cos = Math.cos(angle), sin = Math.sin(angle);
        g.clearRect(0, 0, size, size);
        const glow = g.createRadialGradient(c, c, R * .6, c, c, R * 1.25);
        glow.addColorStop(0, mars ? 'rgba(210,90,40,.16)' : 'rgba(200,205,220,.10)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(0, 0, size, size);
        for (const d of dots) {
          const x = d.x * cos + d.z * sin, z = -d.x * sin + d.z * cos;
          if (z < 0) continue;
          const lit = Math.max(0, x * L[0] + d.y * L[1] + z * L[2]) * .85 + .08;
          g.fillStyle = `rgba(${Math.round(d.base[0] + lit * d.lift[0])},${Math.round(d.base[1] + lit * d.lift[1])},${Math.round(d.base[2] + lit * d.lift[2])},${((.25 + lit * .75) * d.a).toFixed(2)})`;
          g.fillRect(c + x * R, c + d.y * R, d.s, d.s);
        }
      };
      const tick = now => {
        frame = 0;
        if (!visible || document.hidden) return;
        angle += Math.min(now - (last || now), 50) * (mars ? 6.283 / 120000 : 6.283 / 150000);
        last = now; paint(); frame = requestAnimationFrame(tick);
      };
      const start = () => { if (!reduced && !frame && visible && !document.hidden) { last = 0; frame = requestAnimationFrame(tick); } };
      resize(); paint();
      addEventListener('resize', () => { resize(); paint(); });
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
      document.addEventListener('visibilitychange', start);
    });
  }

  /* ---------- Moon & Mars air: a snapshot of the full-data demo's habitat answers, plus the nearest checked records ---------- */
  if (page === 'habitat') {
    const status = $('hab-status'), chart = $('hab-chart'), read = $('hab-read'), gravity = $('hab-gravity'), cols = $('hab-cols'), presets = $('hab-presets'), method = $('hab-method');
    const SHORT = {iss: 'ISS', moon: 'Moon', 'bre-265': 'BRE 26.5%', bre: 'BRE 34%', suit: 'Suit', earth: 'Earth', mars: 'Mars'};
    const range = (r, unit) => r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`;
    const names = list => list.map(i => i.name);
    const joined = list => list.length < 3 ? list.join(' and ') : list.slice(0, -1).join(', ') + ' and ' + list.at(-1);
    let snap = null;
    planets();

    function draw(p) {
      // Oxygen 15–45% by total pressure 0–16 psi. The spacesuit preset (100% O₂) sits off the chart at the right edge.
      const W = 640, H = 400, L = 52, R = 18, T = 18, B = 48, lo = 15, hi = 45, top = 16;
      const X = v => L + (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo) * (W - L - R), Y = v => T + (1 - Math.min(v, top) / top) * (H - T - B);
      const groups = new Map();
      snap.presets.forEach(q => { const k = q.o2 + ',' + q.psi; groups.set(k, [...(groups.get(k) || []), q]); });
      const boxes = [...groups.values()].map(g => {
        const q = g[0], on = g.includes(p), off = q.o2 > hi;
        const box = off ? '' : `<rect x="${X(q.o2 - 3).toFixed(1)}" y="${Y(q.psi + 1.5).toFixed(1)}" width="${(X(q.o2 + 3) - X(q.o2 - 3)).toFixed(1)}" height="${(Y(q.psi - 1.5) - Y(q.psi + 1.5)).toFixed(1)}" style="fill:none;stroke:var(${on ? '--ink-2' : '--line-2'});stroke-dasharray:3 3"/>`;
        const cx = off ? W - R - 4 : X(q.o2), cy = Y(q.psi);
        const label = `${g.map(x => SHORT[x.id]).join(' · ')}${off ? ' (100% O₂) →' : ''} · ${plural(q.near.rows, 'row', 'rows')}`;
        // Label beside each point: left of BRE 26.5% and the off-chart suit, below BRE 34%, above-right otherwise.
        const [dx, dy, anchor] = off ? [-12, -12, 'end'] : q.o2 === 26.5 ? [-12, 4, 'end'] : q.o2 === 34 ? [12, 20, 'start'] : [12, -12, 'start'];
        return `${box}<circle class="${on ? 'you' : 'hp'}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${on ? 9 : 4}"/>
          <text x="${(cx + dx).toFixed(1)}" y="${(cy + dy).toFixed(1)}" text-anchor="${anchor}"${on ? ' style="fill:var(--ink)"' : ''}>${esc(label)}</text>`;
      }).join('');
      const placed = snap.checkedRecords.filter(c => c.o2 !== null && c.psi !== null);
      const dots = placed.map(c => `<circle class="hp${p.checked.near.includes(c.id) ? ' near' : ''}" cx="${X(c.o2).toFixed(1)}" cy="${Y(c.psi).toFixed(1)}" r="2.6"><title>${esc((snap.records[c.id]?.name || c.id) + ` · ${c.o2}% O₂ · ${c.psi} psi`)}</title></circle>`).join('');
      const ticksX = [15, 20, 25, 30, 35, 40, 45].map(v => `<text x="${X(v)}" y="${H - B + 18}" text-anchor="middle">${v}%</text>`).join('');
      const ticksY = [0, 4, 8, 12, 16].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
      chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Seven habitat presets by oxygen and pressure, each with its near box and its count of PSI table rows. ${p.label}: ${plural(p.near.rows, 'row', 'rows')} near it. ${placed.length} checked records in this site give both oxygen and pressure; ${p.checked.near.length} of them are near.`)}">
        ${ticksY}<rect class="moon" x="${X(30)}" y="${Y(10.2)}" width="${X(hi) - X(30)}" height="${Y(0) - Y(10.2)}"/>
        <text class="moon-l" x="${X(30) + 6}" y="${Y(0) - 8}">Moon base: ≥30% O₂, ≤10.2 psi</text>
        ${boxes}${dots}${ticksX}
        <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Oxygen</text><text x="14" y="${(T + H - B) / 2}" transform="rotate(-90 14 ${(T + H - B) / 2})" text-anchor="middle">Total pressure (psi)</text></svg>
        <figcaption class="mono">Ring: your preset · dashed box: within 3 points of oxygen and 1.5 psi, the demo’s “near” · small dots: checked records here that give oxygen and pressure (bright when near)</figcaption>`;
    }

    const recordLine = (id, extra) => {
      const r = snap.records[id] || {name: id};
      return `<li>${mk('checked')}<b>${esc(r.name)}</b>${extra ? ` <span class="small">${esc(extra)}</span>` : ''}
        <span class="small">${r.comparable ? `<a class="cite-link" href="compare.html?a=${encodeURIComponent(id)}">Compare ${ARROW}</a> · ` : ''}<a class="cite-link" href="evidence.html?ids=${encodeURIComponent(id)}">Evidence ${ARROW}</a></span>${r.source?.url ? `<span class="small"><a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.label)} ↗</a></span>` : ''}</li>`;
    };
    const point = id => snap.checkedRecords.find(c => c.id === id);

    function show(p, announce) {
      presets.querySelectorAll('button').forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.id === p.id));
      draw(p);
      const n = p.near, ox = p.oxygenOnly, c = p.checked;
      const table = n.investigations.length ? `<ul class="in-ev" aria-label="PSI table rows near ${esc(p.label)}, by investigation">${n.investigations.map(i =>
        `<li>${mk('psi')}<b>${esc(i.name)}</b> <span class="mono">${esc(i.psi)}</span> · ${plural(i.rows, 'row', 'rows')} · ${range(i.o2, '%')} O₂ · ${range(i.pressurePsi, ' psi')}</li>`).join('')}</ul>` : '';
      const extra = [
        n.hotIgnition.known ? `Of the ${n.hotIgnition.known} with a hot-ignition outcome, ${n.hotIgnition.ignited} ignited.` : '',
        ox.rows ? `Another ${plural(ox.rows, 'row matches', 'rows match')} the oxygen but ${ox.rows === 1 ? 'gives' : 'give'} no usable pressure (${ox.investigations.map(i => `${i.name} ${i.rows}`).join(', ')})${ox.unverifiedPressure ? `; ${ox.unverifiedPressure} of them ${ox.unverifiedPressure === 1 ? 'prints a pressure' : 'print pressures'} NASA has not verified` : ''}. They are counted apart, never placed.` : '',
      ].filter(Boolean).join(' ');
      const nearest = c.nearest.map(x => recordLine(x.id, `${x.o2Points} points of oxygen and ${x.psiApart} psi away`)).join('');
      read.innerHTML = `
        <p class="mono">${esc(p.label)} · ${p.o2}% O₂ at ${p.psi} psi · ${esc(p.gravityLabel)}</p>
        <p class="hab-big">${n.rows ? `<b>${plural(n.rows, 'NASA PSI table row', 'NASA PSI table rows')}</b> tested near this atmosphere, from ${esc(joined(names(n.investigations)))}.` : '<b>No NASA PSI table row</b> was tested near this atmosphere.'}</p>
        <p class="limit"><span class="mono">Preset</span>${esc(p.note)}</p>
        <p class="mono">Oxygen partial pressure ${p.partialPressurePsi} psi · ${p.earthAirShare}% of Earth air’s 3.09 psi</p>
        ${table}${extra ? `<p class="limit"><span class="mono">Also</span>${esc(extra)}</p>` : ''}
`;
      gravity.innerHTML = `<p class="limit"><span class="mono">Gravity</span>${n.rows ? `All ${plural(n.rows, 'row', 'rows')} counted here ${n.rows === 1 ? 'is' : 'are'} ${esc(n.gravity.join(' and '))} tests. ` : ''}${esc(p.gravityNote)}</p>`;
      cols.innerHTML = `
        <section class="hab-fan" aria-labelledby="hab-untested"><h2 id="hab-untested">Untested here</h2>
          <ul class="hab-flags">${p.flags.map(f => `<li class="flag-${esc(f.kind)}">${esc(f.text)}</li>`).join('')}${p.untested.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
        <section class="hab-fan" aria-labelledby="hab-checked"><h2 id="hab-checked">Checked records in this site</h2>
          ${c.near.length ? `<p>${plural(c.near.length, 'checked record was', 'checked records were')} tested near this atmosphere:</p><ul class="in-ev">${c.near.map(id => recordLine(id, `${point(id).o2}% O₂ · ${point(id).psi} psi`)).join('')}</ul>`
            : `<p>None of the 13 checked records was tested near this atmosphere. The nearest, by the demo’s own distance:</p><ul class="in-ev">${nearest}</ul>`}
          ${c.oxygenOnly.length ? `<p>${plural(c.oxygenOnly.length, 'more matches', 'more match')} the oxygen, but the source gives no pressure, so ${c.oxygenOnly.length === 1 ? 'it is' : 'they are'} not placed:</p><ul class="in-ev">${c.oxygenOnly.map(id => recordLine(id, `${point(id).o2}% O₂ · pressure not given`)).join('')}</ul>` : ''}
        </section>`;
      status.textContent = `${p.label}: ${plural(n.rows, 'row', 'rows')} near ${p.o2}% oxygen and ${p.psi} psi.`;
      if (announce) history.replaceState(null, '', '#' + p.id);
    }

    (async () => {
      if (!served) return offline(read);
      status.textContent = 'Loading the snapshot…';
      try { snap = await api('/api/habitat'); }
      catch (err) { return retry(status, err.status ? err.message : 'The snapshot is unavailable right now.', () => location.reload()); }
      presets.innerHTML = snap.presets.map(p => `<button type="button" data-id="${esc(p.id)}" aria-pressed="false">${esc(p.label)}</button>`).join('');
      presets.addEventListener('click', e => { const btn = e.target.closest('[data-id]'); if (btn) show(snap.presets.find(p => p.id === btn.dataset.id), true); });
      const src = snap.source, ex = snap.method.excluded.map(x => `${x.psi}: ${x.reason}`).join(' ');
      method.innerHTML = `${esc(`The full-data demo’s habitat view answers these questions live from ${src.rows.toLocaleString('en-CA')} NASA PSI table rows in ${src.investigations} investigations. This page shows its answers for seven presets, taken at commit ${src.commit} with the demo’s own rules. ${snap.method.near} ${snap.method.oxygenOnly} ${ex} ${snap.method.checked} Interpolation: ${snap.method.interpolation}`)}`;
      show(snap.presets.find(p => p.id === location.hash.slice(1)) || snap.presets.find(p => p.id === 'moon'), false);
    })();
  }

  /* ---------- System design ---------- */
  if (page === 'system' && $('system-embed')) scope($('system-embed'));
})();
