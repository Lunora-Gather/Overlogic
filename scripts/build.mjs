import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
const requestedRelease = String(process.env.GITHUB_SHA || process.env.OVERLOGIC_RELEASE || Date.now()).slice(0, 40);
const release = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(requestedRelease)
  ? requestedRelease
  : String(Date.now());
const include = ['index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'sw.js', '.nojekyll', 'LICENSE', 'README.md', 'data', 'src'];

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

for (const entry of include) {
  await fs.cp(path.join(root, entry), path.join(output, entry), { recursive: true });
}

async function rewrite(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) {
      await rewrite(target);
      continue;
    }
    if (!/\.(?:html|js)$/.test(item.name)) continue;
    const source = await fs.readFile(target, 'utf8');
    const updated = source
      .replace(/\?v=[A-Za-z0-9._-]+/g, `?v=${release}`)
      .replaceAll('__RELEASE__', release);
    await fs.writeFile(target, updated);
  }
}

await rewrite(output);
const serviceWorker = path.join(output, 'sw.js');
const serviceWorkerSource = await fs.readFile(serviceWorker, 'utf8');
async function collectPrecacheUrls(dir, out = []) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) {
      await collectPrecacheUrls(target, out);
      continue;
    }
    const relative = path.relative(output, target).split(path.sep).join('/');
    if (relative === 'release.json' || relative === '.nojekyll' || relative === 'README.md' || relative === 'LICENSE') continue;
    out.push(`./${relative}`);
  }
  return out;
}
const precacheUrls = ['./', ...(await collectPrecacheUrls(output)).sort()];
const rewrittenServiceWorker = serviceWorkerSource
  .replaceAll('__RELEASE__', release)
  .replace('/*__PRECACHE_URLS__*/APP_SHELL', JSON.stringify(precacheUrls));
await fs.writeFile(serviceWorker, rewrittenServiceWorker);
await fs.writeFile(path.join(output, 'release.json'), JSON.stringify({
  release,
  builtAt: new Date().toISOString(),
}, null, 2));

console.log(`BUILD_OK ${release}`);
