import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Release-audit validates files on disk. This companion gate validates the
// artifact through the same HTTP surface that a static host exposes: status
// codes, MIME types, versioned URLs, module imports, data tables, and the
// service worker. It intentionally uses only Node's built-in fetch so CI does
// not need a browser or a third-party dependency.
const root = process.cwd();
const dist = path.join(root, 'dist');
const release = JSON.parse(await fs.readFile(path.join(dist, 'release.json'), 'utf8')).release;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += String(chunk);
      const match = output.match(/Overlogic dev server: http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on('data', onData);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`HTTP smoke server exited with ${code}`));
    });
  });
}

const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: '0', OVERLOGIC_SERVE_ROOT: dist },
  stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  const port = await waitForServer(server);
  const base = `http://127.0.0.1:${port}/`;
  const checked = new Set();
  const queue = [];

  function enqueue(file, expectedType = null) {
    const normalized = String(file || '').replace(/^\/+/, '').split('?')[0];
    if (!normalized || normalized.includes('..')) return;
    const key = `${normalized}|${expectedType || ''}`;
    if (!checked.has(key)) queue.push({ file: normalized, expectedType });
  }

  function expectedMime(file) {
    if (file.endsWith('.html')) return /text\/html/;
    if (file.endsWith('.css')) return /text\/css/;
    if (file.endsWith('.js')) return /javascript/;
    if (file.endsWith('.json')) return /application\/json/;
    if (file.endsWith('.webmanifest')) return /manifest\+json|json/;
    if (file.endsWith('.svg')) return /image\/svg\+xml|image\/svg/;
    return null;
  }

  async function fetchText(file, expectedType = expectedMime(file)) {
    const response = await fetch(new URL(file, base));
    assert.equal(response.status, 200, `${file} must return HTTP 200`);
    const contentType = response.headers.get('content-type') || '';
    if (expectedType) assert.match(contentType, expectedType, `${file} has the wrong MIME type`);
    return response.text();
  }

  enqueue(`index.html?release=${release}`);
  enqueue(`style.css?v=${release}`);
  enqueue(`manifest.webmanifest?v=${release}`);
  enqueue(`icon.svg`);
  enqueue(`sw.js?v=${release}`);
  enqueue(`release.json`);

  const index = await fetchText('index.html');
  assert.match(index, new RegExp(`name="overlogic-release" content="${release}"`),
    'index must expose the built release id');
  assert.match(index, /src\/main\.js\?v=[A-Za-z0-9._-]+/, 'index must version the entry module');
  for (const match of index.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const resource = match[1];
    if (!/^https?:\/\//.test(resource) && !resource.startsWith('data:')) enqueue(resource);
  }

  const dataEntries = await fs.readdir(path.join(dist, 'data'), { withFileTypes: true });
  for (const entry of dataEntries) if (entry.isFile() && entry.name.endsWith('.json')) enqueue(`data/${entry.name}`);

  const modulePattern = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (checked.has(`${item.file}|${item.expectedType || ''}`)) continue;
    const source = await fetchText(item.file, item.expectedType || expectedMime(item.file));
    checked.add(`${item.file}|${item.expectedType || ''}`);
    if (!item.file.endsWith('.js')) continue;
    for (const match of source.matchAll(modulePattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const resolved = new URL(specifier, new URL(item.file, base)).pathname;
      enqueue(resolved);
    }
  }

  assert(checked.size >= 60, `HTTP smoke test traversed too few release resources (${checked.size})`);
  console.log(`HTTP_AUDIT_OK ${release} (${checked.size} resources)`);
} finally {
  server.kill();
}
