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
const forbidden = ['__RELEASE__', '?v=20260725-4', '__PRECACHE_URLS__'];
const forbiddenPatterns = [
  [/\beval\s*\(/, 'dynamic eval'],
  [/\bnew\s+Function\s*\(/, 'dynamic Function constructor'],
  [/\bdebugger\s*;/, 'debugger statement'],
  [/sourceMappingURL=/, 'source map marker'],
];
for (const file of textFiles) {
  const source = await fs.readFile(file, 'utf8');
  for (const marker of forbidden) {
    if (source.includes(marker)) throw new Error(`unresolved release marker ${marker} in ${path.relative(dist, file)}`);
  }
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(source)) throw new Error(`forbidden ${label} in ${path.relative(dist, file)}`);
  }
}

const indexSource = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
if (/\s(on[a-z]+)\s*=/i.test(indexSource)) throw new Error('inline event handlers are not allowed in the release shell');
const externalHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'lunora-gather.github.io']);
for (const match of indexSource.matchAll(/https?:\/\/([^/\s"');]+)/gi)) {
  if (!externalHosts.has(match[1].toLowerCase())) throw new Error(`unapproved external origin in index.html: ${match[1]}`);
}
for (const requiredMeta of [
  'http-equiv="Content-Security-Policy"', 'name="referrer" content="no-referrer"',
  'name="viewport"', 'name="description"', 'name="theme-color"', 'rel="manifest"', 'name="overlogic-release"',
]) {
  if (!indexSource.includes(requiredMeta)) throw new Error(`release shell metadata missing: ${requiredMeta}`);
}
for (const cspDirective of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "connect-src 'self'"]) {
  if (!indexSource.includes(cspDirective)) throw new Error(`release shell CSP missing: ${cspDirective}`);
}

const dataFiles = (await collectFiles(path.join(dist, 'data'))).filter((file) => file.endsWith('.json'));
for (const file of dataFiles) JSON.parse(await fs.readFile(file, 'utf8'));

const rootNames = new Set((await fs.readdir(dist, { withFileTypes: true })).map((entry) => entry.name));
const unexpected = [...rootNames].filter((name) => !new Set(required).has(name));
if (unexpected.length > 0) throw new Error(`unexpected release root files: ${unexpected.join(', ')}`);

console.log(`RELEASE_AUDIT_OK ${release.release} (${files.length} files)`);
