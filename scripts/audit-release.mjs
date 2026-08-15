import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const required = ['index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'sw.js', 'release.json', '.nojekyll', 'LICENSE', 'README.md', 'data', 'src'];

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function collectFiles(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(target, out);
    else out.push(target);
  }
  return out;
}

if (!(await exists(dist))) throw new Error('dist is missing; run npm run build first');
for (const entry of required) {
  if (!(await exists(path.join(dist, entry)))) throw new Error(`release artifact missing: ${entry}`);
}

const release = JSON.parse(await fs.readFile(path.join(dist, 'release.json'), 'utf8'));
if (!release.release || !release.builtAt) throw new Error('release.json must contain release and builtAt');

const files = await collectFiles(dist);
const textFiles = files.filter((file) => /\.(?:html|css|js|json|webmanifest|svg)$/.test(file));
const forbidden = ['__RELEASE__', '?v=20260725-4'];
for (const file of textFiles) {
  const source = await fs.readFile(file, 'utf8');
  for (const marker of forbidden) {
    if (source.includes(marker)) throw new Error(`unresolved release marker ${marker} in ${path.relative(dist, file)}`);
  }
}

const dataFiles = (await collectFiles(path.join(dist, 'data'))).filter((file) => file.endsWith('.json'));
for (const file of dataFiles) JSON.parse(await fs.readFile(file, 'utf8'));

const rootNames = new Set((await fs.readdir(dist, { withFileTypes: true })).map((entry) => entry.name));
const unexpected = [...rootNames].filter((name) => !new Set(required).has(name));
if (unexpected.length > 0) throw new Error(`unexpected release root files: ${unexpected.join(', ')}`);

console.log(`RELEASE_AUDIT_OK ${release.release} (${files.length} files)`);
