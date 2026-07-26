import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
const release = String(process.env.GITHUB_SHA || process.env.OVERLOGIC_RELEASE || Date.now()).slice(0, 12);
const include = ['index.html', 'style.css', '.nojekyll', 'LICENSE', 'README.md', 'data', 'src'];

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
    const updated = source.replace(/\?v=[A-Za-z0-9._-]+/g, `?v=${release}`);
    await fs.writeFile(target, updated);
  }
}

await rewrite(output);
await fs.writeFile(path.join(output, 'release.json'), JSON.stringify({
  release,
  builtAt: new Date().toISOString(),
}, null, 2));

console.log(`BUILD_OK ${release}`);
