// Drive the built game through its visible controls in system Safari.
// All runs use a temporary loopback origin, independent of player saves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

async function play(frame, locale, width, height) {
  const win = frame.contentWindow;
  const doc = win.document;
  const errors = [];
  win.addEventListener('error', event => errors.push(event.error?.stack || event.message));
  win.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const find = selector => doc.querySelector(selector);
  const rect = selector => find(selector).getBoundingClientRect();
  const check = (ok, detail) => { if (!ok) throw new Error(locale + ' ' + width + '×' + height + ' ' + detail); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, detail) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(50); }
    throw new Error(locale + ' ' + width + '×' + height + ' timeout: ' + detail);
  };
  const click = async selector => {
    const el = find(selector);
    check(el && !el.disabled && el.offsetWidth, 'control unavailable: ' + selector);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await wait(() => {
      const r = el.getBoundingClientRect();
      return el.contains(doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }, 'control unobstructed: ' + selector);
    el.click();
  };
  const save = () => JSON.parse(win.localStorage.getItem('overlogic_run_save'));
  const onScreen = name => find('#screen-' + name)?.offsetWidth > 0;
  const fits = selector => {
    const el = find(selector);
    check(el.scrollWidth <= el.clientWidth + 1, selector + ' overflows horizontally');
  };
  async function finishBattle({ shield = false } = {}) {
    await wait(() => onScreen('combat'), 'enter combat');
    if (find('#btn-pause').getAttribute('aria-pressed') !== 'true') await click('#btn-pause');
    check(!errors.length, errors.join('\\n'));
    await wait(() => rect('#arena').top >= 0 && rect('#arena').bottom <= height + 1, 'arena within viewport');
    check(find('#arena-feed-state').dataset.i18n === 'combat.paused', 'paused feed');
    const canvas = rect('#arena');
    for (const x of [canvas.left + 8, canvas.right - 8]) {
      for (const y of [canvas.top + 8, canvas.bottom - 8]) {
        const hit = doc.elementFromPoint(x, y);
        check(hit === find('#arena'), 'arena covered at ' + [x, y] + ' by ' + (hit?.id || hit?.className) +
          '. ' + errors.join(' '));
      }
    }
    await click('#btn-step');
    if (shield) {
      const expected = locale === 'en' ? 'Shield' : locale === 'zh-CN' ? '护盾' : '護盾';
      const step = find('#btn-step');
      for (let i = 0; i < 5 && find('#current-logic').textContent !== expected && onScreen('combat'); i++) step.click();
      check(find('#current-logic').textContent === expected && find('#decision-reason').textContent.includes('50%'), 'execution matches shield rule');
      const time = find('#decision-time').textContent;
      if (onScreen('combat')) step.click();
      check(find('#decision-time').textContent === time && find('#current-logic').textContent === expected,
        'cooldown did not erase last executed action');
    }
    const step = find('#btn-step');
    for (let i = 0; i < 800 && onScreen('combat'); i++) {
      step.click();
      if (i % 32 === 0) await pause(0);
    }
    check(!onScreen('combat'), 'battle did not finish');
  }
  await wait(() => find('#btn-start')?.offsetWidth && !doc.documentElement.classList.contains('booting') &&
    win.getComputedStyle(find('#screen-combat')).display === 'none', 'boot and stylesheet');
  check(win.innerWidth === width && win.innerHeight === height, 'unexpected viewport');
  await click('button[data-locale="' + locale + '"]');
  check(doc.documentElement.dataset.locale === locale, 'language switch');
  check(rect('#btn-start').bottom <= height, 'start button below fold');
  const preview = find('#preview-hp');
  const initial = save();
  for (const [hp, active] of [[31, false], [30, true], [5, true], [60, false]]) {
    preview.value = hp;
    preview.dispatchEvent(new win.Event('input', { bubbles: true }));
    check(find('#preview-state').dataset.active === String(active), 'preview threshold ' + hp);
    check(find('#preview-value').textContent === hp + '%', 'preview readout');
  }
  check(JSON.stringify(initial) === JSON.stringify(save()), 'preview altered save');
  check(!find('.home-launch-column').open && !find('.home-dashboard').open, 'secondary home panels start closed');
  await click('.home-launch-column > summary');
  check(find('#run-mode').offsetWidth > 0 && find('#run-selection').textContent, 'run mode remains discoverable');
  await click('.home-launch-column > summary');
  await click('#btn-settings');
  check(find('#screen-main').inert, 'settings background');
  const muted = find('#setting-mute').checked;
  await click('label[for="setting-mute"]');
  check(find('#setting-mute').checked !== muted, 'whole mute row toggles');
  await click('#settings-tab-data');
  check(find('#settings-play').hidden && find('#btn-data-export').offsetWidth > 0 &&
    doc.activeElement === find('#settings-tab-data'), 'save tools visible from their tab');
  find('#settings-tab-data').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check(doc.activeElement === find('#settings-tab-play') && find('#settings-data').hidden, 'settings keyboard tabs');
  await click('#btn-settings-close');
  await wait(() => doc.activeElement === find('#btn-settings') && !find('#screen-main').inert, 'dismiss settings and restore focus');
  await click('#btn-settings');
  check(find('#setting-mute').checked === muted, 'dismissed setting was discarded');
  await click('#btn-settings-close');
  await click('#btn-start');
  await wait(() => onScreen('editor'), 'editor');
  fits('#screen-editor');
  const labels = {
    'en': ['Shield', 'basic attack', 'Shield activations'],
    'zh-CN': ['护盾', '基础攻击', '举盾'],
    'zh-TW': ['護盾', '基礎攻擊', '舉盾'],
  }[locale];
  const threshold = '.rule-row [data-focus-field="parameter-primary"]';
  check(find(threshold).value === '30' && find('#coach-message').textContent.includes('30%'), 'starter shield');
  const disclosure = '.rule-readable-summary';
  const expanded = () => [...doc.querySelectorAll(disclosure)].filter(el => el.getAttribute('aria-expanded') === 'true');
  check(expanded().length === 1, 'initial disclosure');
  await click('.rule-row:nth-child(2) ' + disclosure);
  check(expanded()[0] === find('.rule-row:nth-child(2) ' + disclosure) && !find(threshold).offsetWidth, 'switch rule');
  await click('#btn-coach');
  check(find(threshold).value === '50' && doc.activeElement === find(threshold), 'guided change and focus');
  await click('#btn-undo');
  check(find(threshold).value === '30', 'undo');
  await click('#btn-redo');
  check(find(threshold).value === '50', 'redo');
  const search = find('#rules-search');
  for (const [query, count] of [[labels[0], 1], ['zzz', 0], ['', 3]]) {
    search.value = query;
    search.dispatchEvent(new win.Event('input', { bubbles: true }));
    check(doc.querySelectorAll('.rule-row').length === count, 'filter ' + query);
    check(find('#rule-list').textContent.trim(), 'no filter feedback');
    if (!count) {
      await click('.rule-search-empty button');
      check(doc.activeElement === search && !search.value && doc.querySelectorAll('.rule-row').length === 3, 'clear filter');
    }
  }
  await click('#btn-add-rule');
  const operator = find('#f-op');
  operator.value = 'and';
  operator.dispatchEvent(new win.Event('change', { bubbles: true }));
  check(find('#f-cond2').offsetWidth > 0, 'compound condition visible');
  find('#f-prio').value = '0';
  await click('#f-add');
  const addedRule = save().rules.at(-1);
  check(addedRule.operator === 'and' && addedRule.priority === 0, 'compound rule saved');
  await click('#btn-undo');
  check(save().rules.length === 3, 'added rule can be undone');
  const before = save();
  // Isolate the shield so an intervening attack cannot replace the decision readout.
  await click('.rule-row:nth-child(2) [data-focus-field="enabled"]');
  await click('.rule-row:nth-child(3) [data-focus-field="enabled"]');
  await click('#btn-coach');
  check(find('#hp-text').textContent === '40 / 100' && find('#en-text').textContent === '100 / 100', 'drill starting resources');
  await finishBattle({ shield: true });
  check(onScreen('editor'), 'return from drill');
  const drill = save();
  const shields = drill.lastReport.action_usage.shield;
  check(shields > 0 && find('#coach-message').textContent.includes(labels[2]) &&
    find('#coach-message').textContent.includes(String(shields)), 'drill result');
  check(drill.tutorialProgress.sandboxRun && drill.persistentHp === before.persistentHp &&
    drill.currentMapColumn === before.currentMapColumn && drill.runStats.battlesWon === 0, 'drill progression');
  await click('[data-focus-field="enabled"]:checked');
  await click('#btn-run');
  await finishBattle();
  check(onScreen('report'), 'expected defeat');
  fits('#screen-report');
  const loss = save().lastReport;
  check(!loss._won && !loss._sandbox && loss.equipped_actions.length === 0, 'campaign defeat record');
  const outcome = find('#report-outcome').textContent;
  check(outcome.includes(loss.battle_time.toFixed(1)) &&
    outcome.includes(String(Math.round(Math.max(...Object.values(loss.damage_by_source))))), 'damage summary');
  check(find('#rep-suggest').textContent.toLowerCase().includes(labels[1]), 'actionable report');
  check(rect('#btn-edit').bottom <= height, 'edit button below fold');
  await click('#btn-restart');
  check(find('#screen-report').inert && doc.activeElement === find('#btn-confirm-cancel'), 'restart confirmation');
  await click('#btn-confirm-cancel');
  await wait(() => !find('#screen-report').inert && doc.activeElement === find('#btn-restart'), 'restore focus after cancel');
  check(save().runStats.runId === before.runStats.runId, 'cancel preserves run');
  await click('#rep-suggest button');
  check(find('#rep-suggest button').disabled, 'recommendation applied once');
  await click('#btn-edit');
  check(onScreen('editor') && save().rules.filter(rule => rule.enabled).length === 1, 'edit after loss');
  check(doc.activeElement === expanded()[0] && expanded()[0]?.closest('.rule-row').dataset.id === save().rules.at(-1).id,
    'new rule is open and focused after report');
  await click('#btn-run');
  await finishBattle();
  check(onScreen('reward'), 'attack rule should win the retry');
  await click('.reward-card');
  check(save().runStats.battlesWon === 1, 'reward settled');
  await click('.editor-sandbox summary');
  find('#sandbox-preset').value = 'boss';
  await click('#btn-sandbox');
  if (find('#btn-pause').getAttribute('aria-pressed') !== 'true') await click('#btn-pause');
  await click('#btn-step');
  check(find('#boss-bar-wrap').offsetWidth > 0, 'boss health is visible');
  const board = rect('#arena');
  check(board.top >= 0 && board.bottom <= height + 1 &&
    doc.elementFromPoint(board.right - 8, board.bottom - 8) === find('#arena'), 'boss health displaces rather than clips the arena');
  await click('#btn-quit');
  check(onScreen('editor') && save().runStats.battlesWon === 1, 'quit sandbox preserves campaign');
  check(!errors.length, errors.join('\n'));
  return { locale, width, height, shields, outcome, release: find('#app-version').textContent };
}

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const assets = await Promise.all((await readdir('dist', { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(async entry => {
    const file = join(entry.parentPath, entry.name);
    return [file.slice('dist/'.length), await readFile(file)];
  }));
const files = new Map(assets);
const { promise, resolve, reject } = Promise.withResolvers();
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><meta charset="utf-8"><title>Overlogic Safari test</title>
        <pre></pre><script type="module">
        const results = [];
        const play = ${play};
        let error;
        try {
          for (const [locale, width, height] of [['en', 320, 568], ['zh-CN', 390, 844], ['zh-TW', 375, 812], ['en', 844, 390]]) {
            for (const key of Object.keys(localStorage)) {
              if (key.startsWith('overlogic_')) localStorage.removeItem(key);
            }
            const frame = document.createElement('iframe');
            frame.style.cssText = 'border:0;width:' + width + 'px;height:' + height + 'px';
            frame.src = '/game/index.html?seed=136';
            document.body.prepend(frame);
            for (let attempt = 0; !frame.contentDocument?.getElementById('app') && attempt < 300; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            results.push(await play(frame, locale, width, height));
            frame.remove();
          }
        } catch (e) { error = String(e) + '\\n' + e.stack; }
        const report = { results, error, browser: navigator.userAgent };
        document.querySelector('pre').textContent = JSON.stringify(report, null, 2);
        await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
        <\/script>`);
    } else if (path === '/result' && req.method === 'POST') {
      let body = '';
      for await (const part of req) body += part;
      res.end('OK');
      resolve(JSON.parse(body));
    } else if (path.startsWith('/game/') && files.has(path.slice(6))) {
      const data = files.get(path.slice(6));
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      res.end(data);
    } else { res.writeHead(404).end(); }
  } catch (error) { res.writeHead(500).end(); reject(error); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const timeout = setTimeout(() => reject(new Error('Safari timed out')), 120000);
try {
  const url = 'http://127.0.0.1:' + server.address().port;
  console.log('Safari audit: ' + url);
  execFileSync('open', ['-b', 'com.apple.Safari', url]);
  const report = await promise;
  assert(!report.error, report.error);
  assert.match(report.browser, /Version\/.* Safari\//);
  assert.equal(report.results.length, 4);
  console.log('SAFARI_FLOW_OK', JSON.stringify(report));
} finally {
  clearTimeout(timeout);
  server.close();
  server.closeAllConnections();
}
