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
const battleContext = await fs.readFile(path.join(root, 'src/core/BattleContext.js'), 'utf8');
const actionExecutor = await fs.readFile(path.join(root, 'src/logic/ActionExecutor.js'), 'utf8');
const reportUi = await fs.readFile(path.join(root, 'src/ui/PostBattleReportUI.js'), 'utf8');
const victoryUi = await fs.readFile(path.join(root, 'src/ui/VictoryUI.js'), 'utf8');
const clipboardUi = await fs.readFile(path.join(root, 'src/ui/Clipboard.js'), 'utf8');
const runVerification = await fs.readFile(path.join(root, 'src/systems/RunVerification.js'), 'utf8');
const runReplay = await fs.readFile(path.join(root, 'src/systems/RunReplay.js'), 'utf8');
const templates = await fs.readFile(path.join(root, 'src/logic/RuleTemplates.js'), 'utf8');
const operationsConfig = await fs.readFile(path.join(root, 'src/systems/OperationsConfig.js'), 'utf8');
const productTelemetry = await fs.readFile(path.join(root, 'src/systems/ProductTelemetry.js'), 'utf8');
const storageGate = await fs.readFile(path.join(root, 'src/systems/StorageWriteGate.js'), 'utf8');
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
check(/ArrowLeft|ArrowRight/.test(editor) && /aria-selected/.test(editor) && /aria-hidden/.test(editor) && /\.inert/.test(editor),
  'editor tabs must support keyboard navigation and keep inactive mobile panels inaccessible');
check(/id="profile-overlay"/.test(html) && /renderProfileDialog/.test(menuUi) && /trapDialogFocus\(this\.profileOverlay\)/.test(menuUi),
  'operator dossier must use an accessible localized dialog');
check(/leaderboardRuns/.test(menuUi) && /dossier-leaderboard-title/.test(menuUi),
  'operator dossier must render a normalized local leaderboard');
check(/profile-leaderboard-mode/.test(menuUi) && /profileLeaderboardDifficulty/.test(menuUi),
  'local leaderboard must expose fair mode and difficulty filters');
check(/id="victory-receipt"/.test(html) && /runReceipt/.test(victoryUi) && !runVerification.includes('OLR1-'),
  'victory screen must expose a deterministic run receipt without hardcoding a receipt value');
check(/combineReplayDigests/.test(victoryUi) && /simulationVersion/.test(victoryUi),
  'victory receipts must include archived replay facts');
check(/id="rep-replay-digest"/.test(html) && /id="btn-copy-report-replay"/.test(html) && /_renderIntegrity/.test(reportUi),
  'failure reports must expose the bounded replay digest and fixed-step facts');
check(/id="victory-replay-digest"/.test(html) && /btn-copy-victory-replay/.test(victoryUi),
  'victory reports must expose and copy the combined replay digest');
check(/navigator\.clipboard/.test(clipboardUi) && /execCommand/.test(clipboardUi),
  'shareable integrity codes must retain a manual-copy fallback when clipboard permissions are unavailable');

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
check(/storageWritesAllowed/.test(storageGate) && /markStorageWriteConflict/.test(storageGate) && /markStorageConflict/.test(main),
  'cross-tab storage conflicts must stop stale tabs from continuing to write');
check(/sw\.js\?v=/.test(main) && /updateViaCache:\s*['"]none['"]/.test(main), 'service worker registration must be tied to the release version');
check(/versionedNetworkFirst/.test(serviceWorker) && /searchParams\.has\(['"]v['"]\)/.test(serviceWorker), 'versioned runtime assets must prefer the network and fall back offline');

check(manifest.name && manifest.short_name && manifest.start_url && manifest.scope, 'PWA manifest core metadata is incomplete');
check(manifest.display === 'standalone', 'PWA must remain installable as a standalone app');
check(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'PWA manifest must declare an icon');
check(/rel="manifest"/.test(html) && /name="theme-color"/.test(html) && /name="mobile-web-app-capable"/.test(html), 'install shell metadata is incomplete');

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
check(/preventScroll:\s*true/.test(menuUi) && /profileCard\.scrollTop\s*=\s*0/.test(menuUi),
  'long operator dossiers must open at the first section while retaining dialog focus');
check(/SIMULATION_STEP_SECONDS/.test(arena) && /MAX_CATCH_UP_STEPS/.test(arena) && /simulationAccumulator/.test(arena),
  'live combat must declare and enforce a bounded fixed-step simulation');
check(/battle\.hazards/.test(arena) && !/battle\.id === ['"]battle_4['"]/.test(arena),
  'campaign hazard geometry must be data-driven');
check(battleTable.battles.every((battle) => Array.isArray(battle.hazards) && battle.hazards.length <= 16),
  'battle content must declare bounded hazard geometry');
check(/boss_laser/.test(arena) && /case ['"]boss_laser['"]/.test(await fs.readFile(path.join(root, 'src/systems/AudioManager.js'), 'utf8')),
  'boss laser feedback must have a dedicated audio cue');
check(/MAX_REPLAY_EVENTS/.test(runReplay) && /replayDigest/.test(runVerification) && /_replayDigest/.test(arena),
  'combat records must expose a bounded deterministic replay digest');
check(contentTables[0].conditions.some((condition) => condition.id === 'support_present' && condition.parameterType === 'none'),
  'support counterplay must be authored as a validated condition module');
check(/supportEnemies/.test(battleContext) && /case ['"]support['"]/.test(actionExecutor) && /support_present/.test(editor),
  'support detection, targeting, and editor advice must share one runtime contract');
check(/id="f-target"[\s\S]*?value="support"/.test(html) && /target\.support/.test(i18n),
  'support targeting must be exposed and localized in the rule editor');

check(/npm run quality-audit/.test(workflow), 'CI must run the product quality gate before deployment');
check(/npm run performance-audit/.test(workflow), 'CI must enforce deterministic performance budgets before deployment');
check(/needs:\s*verify/.test(workflow), 'Pages deploy must depend on verification');
check(/permissions:\s*\n\s*contents:\s*read/.test(workflow) && /deploy:[\s\S]*?permissions:\s*[\s\S]*?pages:\s*write[\s\S]*?id-token:\s*write/.test(workflow),
  'CI must keep Pages write permissions scoped to the deploy job');

console.log(`QUALITY_AUDIT_OK (${checks} checks)`);
