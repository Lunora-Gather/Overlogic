import fs from 'node:fs/promises';
import path from 'node:path';

// Conservative uncompressed budgets. GitHub Pages applies transfer encoding,
// but uncompressed limits remain deterministic and catch accidental content,
// debug assets, source maps, or monolithic modules before deployment.
const root = process.cwd();
const dist = path.join(root, 'dist');
const LIMITS = Object.freeze({
  files: 100,
  totalBytes: 1_200 * 1024,
  javascriptBytes: 700 * 1024,
  cssBytes: 140 * 1024,
  htmlBytes: 80 * 1024,
  jsonBytes: 128 * 1024,
  largestJavascriptBytes: 120 * 1024,
});

async function collectFiles(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(target, out);
    else out.push(target);
  }
  return out;
}

function bytesFor(files, extension) {
  return files.filter((file) => path.extname(file.file) === extension)
    .reduce((sum, file) => sum + file.size, 0);
}

const paths = await collectFiles(dist);
const files = await Promise.all(paths.map(async (file) => ({
  file,
  size: (await fs.stat(file)).size,
})));
const javascript = files.filter((file) => path.extname(file.file) === '.js');
const summary = {
  files: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  javascriptBytes: bytesFor(files, '.js'),
  cssBytes: bytesFor(files, '.css'),
  htmlBytes: bytesFor(files, '.html'),
  jsonBytes: bytesFor(files, '.json'),
  largestJavascriptBytes: Math.max(0, ...javascript.map((file) => file.size)),
};

const failures = Object.entries(LIMITS)
  .filter(([key, limit]) => summary[key] > limit)
  .map(([key, limit]) => `${key} ${summary[key]} exceeds ${limit}`);
if (failures.length > 0) throw new Error(`PERFORMANCE_AUDIT_FAILED: ${failures.join('; ')}`);

const largest = [...files]
  .sort((a, b) => b.size - a.size)
  .slice(0, 5)
  .map((entry) => ({ file: path.relative(dist, entry.file).split(path.sep).join('/'), bytes: entry.size }));
console.log(`PERFORMANCE_AUDIT_OK ${JSON.stringify({ ...summary, largest })}`);
