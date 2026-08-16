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
const serviceWorker = await fs.readFile(path.join(root, 'sw.js'), 'utf8');
const editor = await fs.readFile(path.join(root, 'src/ui/LogicEditorUI.js'), 'utf8');
const menuUi = await fs.readFile(path.join(root, 'src/ui/MainMenu.js'), 'utf8');
const gameState = await fs.readFile(path.join(root, 'src/core/GameState.js'), 'utf8');
const modifiers = await fs.readFile(path.join(root, 'src/systems/RunModifiers.js'), 'utf8');
const history = await fs.readFile(path.join(root, 'src/systems/RunHistory.js'), 'utf8');
const archive = await fs.readFile(path.join(root, 'src/systems/RunArchive.js'), 'utf8');
const i18n = await fs.readFile(path.join(root, 'src/i18n/I18n.js'), 'utf8');
const arena = await fs.readFile(path.join(root, 'src/core/CombatArena.js'), 'utf8');
const reportUi = await fs.readFile(path.join(root, 'src/ui/PostBattleReportUI.js'), 'utf8');
const victoryUi = await fs.readFile(path.join(root, 'src/ui/VictoryUI.js'), 'utf8');
const runVerification = await fs.readFile(path.join(root, 'src/systems/RunVerification.js'), 'utf8');
const templates = await fs.readFile(path.join(root, 'src/logic/RuleTemplates.js'), 'utf8');
const operationsConfig = await fs.readFile(path.join(root, 'src/systems/OperationsConfig.js'), 'utf8');
const productTelemetry = await fs.readFile(path.join(root, 'src/systems/ProductTelemetry.js'), 'utf8');
const enemyTable = JSON.parse(await fs.readFile(path.join(root, 'data/enemies.json'), 'utf8'));
const battleTable = JSON.parse(await fs.readFile(path.join(root, 'data/battles.json'), 'utf8'));
const operationsTable = JSON.parse(await fs.readFile(path.join(root, 'data/operations.json'), 'utf8'));
const contentTables = await Promise.all(['conditions', 'actions', 'enemies', 'battles', 'rewards']
  .map(async (name) => JSON.parse(await fs.readFile(path.join(root, `data/${name}.json`), 'utf8'))));
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
check(/id="profile-overlay"/.test(html) && /renderProfileDialog/.test(menuUi) && /trapDialogFocus\(this\.profileOverlay\)/.test(menuUi),
  'operator dossier must use an accessible localized dialog');
check(/id="victory-receipt"/.test(html) && /runReceipt/.test(victoryUi) && !runVerification.includes('OLR1-'),
  'victory screen must expose a deterministic run receipt without hardcoding a receipt value');

check(/prefers-reduced-motion\s*:\s*reduce/.test(css), 'CSS must honor prefers-reduced-motion');
check(/reduceMotion/.test(main) && /visibilitychange/.test(main), 'runtime must wire motion settings and visibility pausing');
check(/addEventListener\(['"]error['"]/.test(main) && /unhandledrejection/.test(main), 'runtime errors must be contained and diagnosed');
check(/addEventListener\(['"]online['"]/.test(main) && /addEventListener\(['"]offline['"]/.test(main), 'offline/online transitions must be surfaced');
check(/refreshAppNoticeCopy/.test(main) && /overlogic:localechange/.test(main), 'dynamic runtime notices must refresh when the locale changes');
check(/high-contrast/.test(main) && /high-contrast/.test(css), 'accessibility contrast preference must reach the visual system');
check(/\.overlay\s*\{[\s\S]*?z-index:\s*13000/.test(css) && /\.app-notice\s*\{[\s\S]*?z-index:\s*12000/.test(css),
  'modal overlays must remain clickable above transient app notices');
check(operationsTable.schemaVersion === 1 && operationsTable.features && operationsTable.limits,
  'operations manifest must declare a versioned feature and limit contract');
check(contentTables.every((table) => table.schemaVersion === 1),
  'all simulation content tables must declare the supported schema version');
check(/normalizeOperationsConfig/.test(operationsConfig) && /loadOperationsConfig/.test(main) && /operationsSnapshot/.test(gameState),
  'operations manifest must be normalized at boot and included in support diagnostics');
check(/id="setting-product-metrics"/.test(html) && /productMetrics:\s*false/.test(gameState),
  'local product metrics must require explicit opt-in consent');
check(/MAX_RECENT\s*=\s*40/.test(productTelemetry) && !/\bfetch\s*\(/.test(productTelemetry) && /clearProductMetrics/.test(productTelemetry),
  'product metrics must remain bounded, local-only, and immediately erasable');
check(/sw\.js\?v=/.test(main) && /updateViaCache:\s*['"]none['"]/.test(main), 'service worker registration must be tied to the release version');
check(/versionedNetworkFirst/.test(serviceWorker) && /searchParams\.has\(['"]v['"]\)/.test(serviceWorker), 'versioned runtime assets must prefer the network and fall back offline');

check(manifest.name && manifest.short_name && manifest.start_url && manifest.scope, 'PWA manifest core metadata is incomplete');
check(manifest.display === 'standalone', 'PWA must remain installable as a standalone app');
check(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'PWA manifest must declare an icon');
check(/rel="manifest"/.test(html) && /name="theme-color"/.test(html), 'install shell metadata is incomplete');

check(/value="weekly"/.test(html), 'the shell must expose the weekly challenge mode');
check(/weeklyIdentity/.test(gameState) && /weeklySeed/.test(gameState) && /OLR1/.test(gameState), 'weekly mode must use a stable challenge seed and share code');
check(/weeklyProtocol/.test(modifiers) && /mode === 'weekly'/.test(modifiers), 'weekly mode must apply an explicit protocol layer');
check(/weekly/.test(history) && /weekly/.test(archive), 'history and archive must preserve weekly mode');
check(/weeklyProtocol/.test(i18n) && /mode\.weekly/.test(i18n), 'weekly mode must be localized in every dictionary');
check(enemyTable.enemies.some((enemy) => enemy.id === 'shield_drone' && enemy.behaviorType === 'shield_support'), 'content must include a shield relay support enemy');
check(battleTable.battles.some((battle) => battle.enemySpawns?.some((spawn) => spawn.enemyId === 'shield_drone')), 'a campaign battle must exercise the shield relay');
check(/ShieldRelayEnemy/.test(arena) && /shield_drone/.test(arena), 'combat runtime must instantiate shield relay behavior');
check(/enemy_shield_mitigation/.test(reportUi) && /report\.timelineShield/.test(reportUi), 'post-battle report must explain shield relay telemetry');
check(/RULE_TEMPLATES/.test(templates) && /applyRuleTemplate/.test(gameState) && /RULE_TEMPLATES/.test(editor), 'rule templates must use a dedicated data module and state API');

check(/npm run quality-audit/.test(workflow), 'CI must run the product quality gate before deployment');
check(/npm run performance-audit/.test(workflow), 'CI must enforce deterministic performance budgets before deployment');
check(/needs:\s*verify/.test(workflow), 'Pages deploy must depend on verification');

console.log(`QUALITY_AUDIT_OK (${checks} checks)`);
