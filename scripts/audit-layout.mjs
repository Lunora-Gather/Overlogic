// Exercise the built game in a fresh Chrome profile, without npm dependencies.
// Requires Node 24 and Chrome/Chromium. Optionally pass the deployed URL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const profile = await mkdtemp(path.join(tmpdir(), 'overlogic-layout-'));
const binary = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
let chrome, server, socket, nextId = 0;
const pending = new Map();

async function matchLine(child, stream, re) {
  const lines = createInterface({ input: stream });
  const onError = error => stream.destroy(error);
  child.once('error', onError);
  try {
    for await (const line of lines) { const match = line.match(re); if (match) return match[1]; }
    throw new Error(`Process exited before announcing ${re}`);
  } finally { child.off('error', onError); lines.close(); }
}
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const { result, exceptionDetails } = await command('Runtime.evaluate', { expression, returnByValue: true });
  assert(!exceptionDetails, exceptionDetails?.exception?.description || exceptionDetails?.text);
  return result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out waiting for ${expression}`);
}
const rect = selector => `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()`;
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const abort = setTimeout(() => { socket?.close(); chrome?.kill(); server?.kill(); }, 90000);
try {
  let url = process.argv[2];
  if (!url) {
    server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '0', OVERLOGIC_SERVE_ROOT: path.resolve('dist') } });
    url = await matchLine(server, server.stdout, /(http:\/\/127\.0\.0\.1:\d+)/);
  }
  chrome = spawn(binary, ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--disable-sync', '--no-first-run', '--disable-background-networking', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await matchLine(chrome, chrome.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('Browser disconnected')); pending.clear(); });
  socket.addEventListener('message', ({ data }) => {
    const { id, result, error } = JSON.parse(data); if (!pending.has(id)) return;
    const p = pending.get(id); pending.delete(id); if (error) p.reject(new Error(error.message)); else p.resolve(result);
  });
  const viewport = (width, height) => command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await viewport(375, 667);
  await command('Page.navigate', { url });
  await waitFor("document.getElementById('btn-start')?.offsetWidth && !document.documentElement.classList.contains('booting')");
  for (const locale of ['en', 'zh-TW', 'zh-CN']) {
    await click(`button[data-locale="${locale}"]`);
    assert.equal(await evaluate('document.documentElement.dataset.locale'), locale);
    const bottom = await evaluate(`${rect('#btn-start')}.bottom`);
    assert(bottom > 0 && bottom <= 667, `${locale}: workstation entry ends at ${bottom}px, below the 667px fold`);
  }
  await click('#btn-start');
  const first = '.rule-row [data-focus-field="condition-primary"]';
  await waitFor(`document.querySelector('${first}')?.offsetWidth`);
  assert(await evaluate(`${rect(first)}.bottom <= innerHeight && ${rect(first)}.top >= 0`), 'First editable condition below fold');
  await viewport(1440, 900);
  assert(await evaluate(`(() => {
    const el = document.querySelector('${first}'), css = getComputedStyle(el), ctx = document.createElement('canvas').getContext('2d');
    ctx.font = css.font; return el.clientWidth >= ctx.measureText(el.selectedOptions[0].text).width + parseFloat(css.paddingLeft) + 16;
  })()`), 'Desktop condition label clipped');
  const searchTops = await evaluate(`['#cond-search', '#rules-search', '#act-search']
    .map(selector => document.querySelector(selector).getBoundingClientRect().top)`);
  assert(Math.max(...searchTops) - Math.min(...searchTops) <= 1, 'Desktop editor searches sit on different rows');
  await viewport(1024, 600);
  await click('.editor-library > summary'); await click('.editor-prep > summary');
  await click('#synergy-panel > summary');
  assert(await evaluate(`
    ${rect('#synergy-panel')}.bottom <= ${rect('.editor-header')}.bottom + 1 &&
    ${rect('.editor-header')}.bottom <= ${rect('.editor-grid')}.top + 1 &&
    ${rect('.brief-score')}.right <= ${rect('.brief-copy')}.left
  `), 'Expanded prep overlaps the editor at 1024×600');
  assert(await evaluate("document.querySelector('#rule-list').clientHeight >= 44"), 'Expanded sections collapse rule list');
  for (const selector of ['#synergy-list .synergy-chip:last-child', '#btn-save-1', first]) {
    assert(await evaluate(`(() => {
      const el = document.querySelector('${selector}'); el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })()`), `Expanded sections obstruct ${selector}`);
  }
  await click('#synergy-panel > summary');
  await click('.editor-library > summary'); await click('.editor-prep > summary');
  for (const [width, height] of [[320, 568], [844, 390], [1024, 600]]) {
    await viewport(width, height);
    await evaluate("document.querySelector('#screen-editor').scrollTop = document.querySelector('#screen-editor').scrollHeight");
    const reachable = selector => evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })()`);
    assert(await reachable('#btn-run'), `Launch control is unreachable at ${width}×${height}`);
    await click('.editor-sandbox summary');
    assert(await reachable('#sandbox-preset') && await reachable('#btn-sandbox'), `Sandbox controls are clipped at ${width}×${height}`);
    await click('.editor-sandbox summary');
    await click('#btn-add-rule');
    await sleep(80);
    assert(await reachable('#f-cond') && await reachable('#f-add'), `Add rule controls are split across the viewport at ${width}×${height}`);
    await click('#f-cancel');
  }
  await viewport(390, 844); await click('#btn-run');
  await waitFor(`document.querySelector('#arena')?.offsetWidth && ${rect('#arena')}.width > 100`);
  await click('#btn-pause');
  assert(await evaluate(`(() => {
    const canvas = document.querySelector('#arena'), r = canvas.getBoundingClientRect();
    return [r.left + 12, r.right - 12].every(x => [r.top + 12, r.bottom - 12].every(y => document.elementFromPoint(x,y) === canvas));
  })()`), 'Combat HUD or diagnostics cover the arena');
  const toggle = '#btn-combat-inspector';
  assert(await evaluate(`document.querySelector('${toggle}').getAttribute('aria-expanded') === 'false'`));
  await click(toggle);
  assert(await evaluate("document.querySelector('#combat-console-log').offsetHeight > 0"), 'Cannot open combat log');
  await click(toggle);
  assert(await evaluate(`${rect('.combat-decision')}.bottom <= innerHeight`), 'Decision readout is below the fold on a 390px viewport');
  for (const [width, height] of [[320, 568], [844, 390]]) {
    await viewport(width, height);
    await sleep(100);
    assert(await evaluate(`(() => {
      const screen = document.querySelector('#screen-combat');
      const board = document.querySelector('#arena').getBoundingClientRect();
      return screen.scrollWidth <= screen.clientWidth + 1 && board.width >= 155 &&
        board.left >= 0 && board.right <= innerWidth && board.top >= 0 && board.bottom <= innerHeight;
    })()`), `Combat canvas overflowed ${width}×${height}`);
  }
  console.log('LAYOUT_AUDIT_OK: three locales, phone launch and editing, desktop rule label, four arena corners, combat log and compact portrait/landscape');
} finally {
  clearTimeout(abort); socket?.close(); server?.kill();
  if (chrome?.exitCode === null && chrome.pid) { const closed = once(chrome, 'close'); chrome.kill(); await closed; }
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
