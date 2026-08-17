import { execFileSync } from 'node:child_process';

// One sequential local gate for maintainers. Build must finish before the
// artifact and HTTP audits inspect dist/, so these steps intentionally do not
// run in parallel.
const windows = process.platform === 'win32';
const npmCommand = windows ? 'npm.cmd' : 'npm';
const steps = [
  'verify',
  'balance',
  'quality-audit',
  'build',
  'release-audit',
  'http-audit',
  'performance-audit',
];

for (const script of steps) {
  console.log(`CHECK_STEP ${script}`);
  const command = windows ? (process.env.ComSpec || 'cmd.exe') : npmCommand;
  const args = windows ? ['/d', '/s', '/c', `${npmCommand} run ${script}`] : ['run', script];
  // Windows exposes npm as a .cmd shim; invoke it through cmd.exe explicitly
  // instead of shell:true, which emits a deprecation warning and weakens arg
  // boundary guarantees in newer Node versions.
  execFileSync(command, args, { stdio: 'inherit' });
}

console.log('CHECK_OK');
