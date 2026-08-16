import fs from 'node:fs/promises';
import path from 'node:path';

// Dependency-free product quality gate for the static shell. This intentionally
// checks the things that are easy to regress during UI/content work and hard to
// notice in a single manual browser pass: accessible names, dialog wiring,
// keyboard tabs, install metadata, and runtime safety hooks.
const root = process.cwd();
const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const css = await fs.readFile(path.join(root, 'style.css'), 'utf8');
const main = await fs.readFile(path.join(root, 'src/main.js'), 'utf8');
const editor = await fs.readFile(path.join(root, 'src/ui/LogicEditorUI.js'), 'utf8');
const workflow = await fs.readFile(path.join(root, '.github/workflows/verify.yml'), 'utf8');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));

let checks = 0;
function check(condition, message) {
  checks += 1;
  if (!condition) throw new Error(`QUALITY_AUDIT_FAILED: ${message}`);
}

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `duplicate HTML ids: ${duplicateIds.join(', ')}`);
const idSet = new Set(ids);

for (const match of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>/gi)) {
  check(idSet.has(match[1]), `label target is missing: ${match[1]}`);
}

for (const match of html.matchAll(/<button\b([^>]*)>/gi)) {
  check(/\btype\s*=\s*"(?:button|submit|reset)"/i.test(match[1]), 'every static button must declare an explicit type');
}

const dialogRefs = [...html.matchAll(/role="dialog"[^>]*aria-labelledby="([^"]+)"/gi)].map((match) => match[1]);
check(dialogRefs.length >= 4, 'all product dialogs should expose labelled titles');
for (const ref of dialogRefs) check(idSet.has(ref), `dialog title target is missing: ${ref}`);
for (const match of html.matchAll(/<div\b[^>]*\bid="([^"]*-overlay)"[^>]*>/gi)) {
  check(/\baria-hidden="(?:true|false)"/.test(match[0]), `overlay lacks aria-hidden state: ${match[1]}`);
}

const progressbars = [...html.matchAll(/role="progressbar"[^>]*>/gi)].map((match) => match[0]);
check(progressbars.length >= 4, 'combat and report meters must expose progress semantics');
for (const tag of progressbars) {
  check(/aria-valuemin=/.test(tag) && /aria-valuemax=/.test(tag) && /aria-valuenow=/.test(tag),
    'progressbar is missing a numeric ARIA value');
}

const canvases = [...html.matchAll(/<canvas\b[^>]*>/gi)].map((match) => match[0]);
for (const tag of canvases) {
  if (/role="img"/.test(tag)) check(/aria-label=|data-i18n-aria-label=/.test(tag), 'canvas image needs an accessible label');
}

const tabButtons = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/gi)].map((match) => match[0]);
check(tabButtons.length >= 3, 'editor must expose keyboard-navigable tabs');
for (const tag of tabButtons) {
  check(/id="[^"]+"/.test(tag) && /aria-controls="[^"]+"/.test(tag) && /aria-selected="(?:true|false)"/.test(tag),
    'editor tab is missing id, controlled panel, or selected state');
}
check(/role="tablist"/.test(html) && /role="tabpanel"/.test(html), 'editor tablist and panels must use ARIA roles');
check(/ArrowLeft|ArrowRight/.test(editor) && /aria-selected/.test(editor), 'editor tabs must support keyboard navigation and state updates');

check(/prefers-reduced-motion\s*:\s*reduce/.test(css), 'CSS must honor prefers-reduced-motion');
check(/reduceMotion/.test(main) && /visibilitychange/.test(main), 'runtime must wire motion settings and visibility pausing');
check(/addEventListener\(['"]error['"]/.test(main) && /unhandledrejection/.test(main), 'runtime errors must be contained and diagnosed');
check(/addEventListener\(['"]online['"]/.test(main) && /addEventListener\(['"]offline['"]/.test(main), 'offline/online transitions must be surfaced');

check(manifest.name && manifest.short_name && manifest.start_url && manifest.scope, 'PWA manifest core metadata is incomplete');
check(manifest.display === 'standalone', 'PWA must remain installable as a standalone app');
check(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'PWA manifest must declare an icon');
check(/rel="manifest"/.test(html) && /name="theme-color"/.test(html), 'install shell metadata is incomplete');

check(/npm run quality-audit/.test(workflow), 'CI must run the product quality gate before deployment');
check(/needs:\s*verify/.test(workflow), 'Pages deploy must depend on verification');

console.log(`QUALITY_AUDIT_OK (${checks} checks)`);
