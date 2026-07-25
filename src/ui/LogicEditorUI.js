// LogicEditorUI.js — the most important screen. Lists conditions/actions, shows rules,
// lets player add/delete/edit rules + priority + condition param + action. Start button.
// Mirrors scripts/ui/LogicEditorUI.gd.

import { GameState } from '../core/GameState.js';
import { GameDatabase } from '../core/GameDatabase.js';
import { GameManager } from '../core/GameManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { escapeHtml } from './safeHtml.js';

export class LogicEditorUI {
  constructor() {
    this.el = document.getElementById('screen-editor');
    this.condList = document.getElementById('cond-list');
    this.actList  = document.getElementById('act-list');
    this.condSearch = document.getElementById('cond-search');
    this.actSearch  = document.getElementById('act-search');
    this.ruleList = document.getElementById('rule-list');
    this.btnAddRule = document.getElementById('btn-add-rule');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.ruleForm = document.getElementById('rule-form');
    this.fCond = document.getElementById('f-cond');
    this.fCondParam = document.getElementById('f-cond-param');
    this.fOp = document.getElementById('f-op');
    this.fCond2 = document.getElementById('f-cond2');
    this.fCond2Param = document.getElementById('f-cond2-param');
    this.fAct = document.getElementById('f-act');
    this.fTarget = document.getElementById('f-target');
    this.fPrio = document.getElementById('f-prio');
    this.fAdd = document.getElementById('f-add');
    this.fCancel = document.getElementById('f-cancel');
    this.edBattleName = document.getElementById('ed-battle-name');
    this.edBattlePreview = document.getElementById('ed-battle-preview');
    this.edTeach = document.getElementById('ed-teach');
    this.unitStats = document.getElementById('unit-stats');
    this.btnRun = document.getElementById('btn-run');
    this.btnSandbox = document.getElementById('btn-sandbox');
    this.mapNodesContainer = document.getElementById('map-nodes');
    this.rulesSearch = document.getElementById('rules-search');
    this.missionBriefing = document.getElementById('mission-briefing');

    if (this.condSearch) {
      this.condSearch.addEventListener('input', () => this.renderModules());
    }
    if (this.actSearch) {
      this.actSearch.addEventListener('input', () => this.renderModules());
    }
    if (this.rulesSearch) {
      this.rulesSearch.addEventListener('input', () => this.renderRules());
    }

    this.lastSavedSlot = 1;
    this._bind();
    // re-render when state changes
    GameState.on('rules', () => { this.renderRules(); this.renderBriefing(); });
    GameState.on('stats', () => { this.renderStats(); this.renderBriefing(); });
    GameState.on('progress', () => { this.renderHeader(); this.renderBriefing(); });
  }

  show() {
    this.renderAll();
  }

  renderAll() {
    this.renderHeader();
    this.renderBriefing();
    this.renderModules();
    this.renderRules();
    this.renderStats();
    this.updateLoadoutStatus();
  }

  renderHeader() {
    const battle = GameState.getActiveBattle();
    if (battle) {
      this.edBattleName.textContent = battle.displayName;
      this.edBattlePreview.textContent = `// ${this._formatBattlePreview(battle)}`;
    } else {
      const colNodes = GameState.mapNodes[GameState.currentMapColumn];
      const activeNode = colNodes ? colNodes.find(n => n.id === GameState.selectedNodeId) : null;
      if (activeNode) {
        this.edBattleName.textContent = activeNode.label;
        this.edBattlePreview.textContent = `// Instant Trigger Node`;
      } else {
        this.edBattleName.textContent = '—';
        this.edBattlePreview.textContent = '';
      }
    }
    this.edTeach.textContent = GameState.teachNode;

    // Render Map Tree
    this.mapNodesContainer.innerHTML = '';
    GameState.mapNodes.forEach((col, colIdx) => {
      const colDiv = document.createElement('div');
      colDiv.className = 'map-col';

      col.forEach(node => {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'map-node';
        nodeDiv.textContent = (node.type === 'combat' ? '⚔️ ' : (node.type === 'repair' ? '🔧 ' : '💎 ')) + node.label;
        nodeDiv.dataset.tooltipType = 'map-node';
        nodeDiv.dataset.nodeId = node.id;
        
        if (node.completed) {
          nodeDiv.classList.add('completed');
        } else if (colIdx === GameState.currentMapColumn) {
          nodeDiv.classList.add('unlocked');
          if (node.id === GameState.selectedNodeId) {
            nodeDiv.classList.add('selected');
          }
          nodeDiv.addEventListener('click', () => {
            GameState.selectMapNode(node.id);
          });
        } else if (colIdx < GameState.currentMapColumn) {
          // Passed by another path
          nodeDiv.classList.add('completed');
        }
        colDiv.appendChild(nodeDiv);
      });
      this.mapNodesContainer.appendChild(colDiv);
    });
  }

  _formatBattlePreview(battle) {
    const byEnemy = new Map();
    let maxWave = 0;
    for (const spawn of battle.enemySpawns || []) {
      maxWave = Math.max(maxWave, spawn.wave || 1);
      byEnemy.set(spawn.enemyId, (byEnemy.get(spawn.enemyId) || 0) + spawn.count);
    }
    const enemies = [...byEnemy.entries()].map(([enemyId, count]) => {
      const data = GameDatabase.getEnemy(enemyId);
      return `${count}x ${data ? data.displayName : enemyId}`;
    });
    const tags = [];
    if (maxWave > 1) tags.push(`${maxWave} waves`);
    if (['battle_4', 'battle_6'].includes(battle.id)) tags.push('2 hazards');
    if (['battle_5', 'battle_7'].includes(battle.id)) tags.push('3 hazards');
    if (['battle_8', 'battle_9', 'battle_10'].includes(battle.id)) tags.push('4 hazards');
    if ((battle.enemySpawns || []).some(s => s.enemyId.includes('warden'))) tags.push('boss');
    return [...enemies, ...tags].join(' · ');
  }

  _battleAdvice(battle) {
    if (!battle) return null;
    const enemyIds = new Set((battle.enemySpawns || []).map(spawn => spawn.enemyId));
    const availableConditions = new Set(GameState.availableConditionIds());
    const availableActions = new Set(GameState.availableActionIds());
    const hasHazards = ['battle_4', 'battle_5', 'battle_6', 'battle_7', 'battle_8', 'battle_9', 'battle_10'].includes(battle.id);

    const options = [];
    if (hasHazards) {
      options.push({
        conditionId: 'on_hazard', conditionValue: null, actionId: 'dash_away',
        priority: 95, targetPriority: 'nearest',
        label: 'Evacuate hazard tiles', reason: 'This arena contains persistent damage zones.',
      });
    }
    if ([...enemyIds].some(id => ['charger', 'boss_warden', 'apex_warden'].includes(id))) {
      options.push({
        conditionId: 'enemy_casting', conditionValue: null, actionId: 'interrupt_shot',
        priority: 90, targetPriority: 'caster',
        label: 'Interrupt telegraphed attacks', reason: 'Chargers and wardens expose interrupt windows.',
      });
    }
    if (enemyIds.has('shooter') || enemyIds.has('emp_drone')) {
      options.push({
        conditionId: 'enemy_far', conditionValue: 5, actionId: 'dash_toward',
        priority: 50, targetPriority: 'nearest',
        label: 'Close on ranged units', reason: 'Ranged enemies punish passive spacing.',
      });
    }
    if ((battle.enemySpawns || []).reduce((sum, spawn) => sum + spawn.count, 0) >= 7) {
      options.push({
        conditionId: 'surrounded', conditionValue: [4, 3],
        actionId: availableActions.has('emp_burst') ? 'emp_burst' : 'dash_away',
        priority: 92, targetPriority: 'nearest',
        label: 'Break out when surrounded', reason: 'Large waves can trap the robot before cooldowns recover.',
      });
    }
    options.push({
      conditionId: 'enemy_nearby', conditionValue: 8, actionId: 'basic_attack',
      priority: 10, targetPriority: 'nearest',
      label: 'Keep a reliable attack fallback', reason: 'A low-priority attack prevents idle combat time.',
    });

    return options.find(option =>
      availableConditions.has(option.conditionId) && availableActions.has(option.actionId)
    ) || null;
  }

  _hasEquivalentRule(advice) {
    return !!advice && GameState.rules.some(rule =>
      rule.enabled !== false &&
      rule.conditionId === advice.conditionId &&
      rule.actionId === advice.actionId
    );
  }

  renderBriefing() {
    if (!this.missionBriefing) return;
    const battle = GameState.getActiveBattle();
    if (!battle) {
      this.missionBriefing.innerHTML = '<div class="brief-copy"><strong>Route event ready.</strong><span>Select the active node to continue.</span></div>';
      return;
    }

    const enabledRules = GameState.rules.filter(rule => rule.enabled !== false);
    const warnings = this.analyzeRules();
    const hasOffense = enabledRules.some(rule =>
      ['basic_attack', 'interrupt_shot', 'drop_mine', 'emp_burst', 'dash_through'].includes(rule.actionId)
    );
    const hasDefense = enabledRules.some(rule =>
      ['shield', 'dash_away', 'repair', 'emp_burst'].includes(rule.actionId)
    );
    const advice = this._battleAdvice(battle);
    const hasCounter = this._hasEquivalentRule(advice);
    const currentHp = GameState.persistentHp ?? GameState.stats.max_hp;
    const hpRatio = currentHp / Math.max(1, GameState.stats.max_hp);
    const healthy = hpRatio >= 0.45;
    const checks = [hasOffense, hasDefense, warnings.size === 0, hasCounter, healthy];
    const score = Math.round(checks.filter(Boolean).length / checks.length * 100);
    const risk = score >= 80 ? 'READY' : score >= 60 ? 'CAUTION' : 'RISKY';
    const riskClass = risk.toLowerCase();
    const warningCount = [...warnings.values()].reduce((sum, items) => sum + items.length, 0);
    const enemyCount = (battle.enemySpawns || []).reduce((sum, spawn) => sum + spawn.count, 0);

    this.missionBriefing.innerHTML = `
      <div class="brief-score ${riskClass}">
        <span class="brief-score-value">${score}</span>
        <span>READINESS</span>
      </div>
      <div class="brief-copy">
        <div class="brief-title">
          <strong>${escapeHtml(risk)}</strong>
          <span>${enemyCount} hostiles · HP ${Math.round(currentHp)}/${Math.round(GameState.stats.max_hp)}</span>
        </div>
        <span class="brief-advice">${escapeHtml(advice?.reason || 'Review the route event before continuing.')}</span>
      </div>
      <div class="brief-checks" aria-label="Launch checks">
        <span class="${hasOffense ? 'ok' : 'bad'}">${hasOffense ? '✓' : '!'} Offense</span>
        <span class="${hasDefense ? 'ok' : 'bad'}">${hasDefense ? '✓' : '!'} Survival</span>
        <span class="${warnings.size === 0 ? 'ok' : 'warn'}">${warnings.size === 0 ? '✓ Clean logic' : `⚠ ${warningCount} warning${warningCount === 1 ? '' : 's'}`}</span>
        <span class="${healthy ? 'ok' : 'bad'}">${healthy ? '✓ Hull stable' : '! Low persistent HP'}</span>
      </div>
      <div class="brief-actions">
        ${!hasCounter && advice ? `<button type="button" id="btn-add-counter" class="btn small">${escapeHtml(advice.label)}</button>` : '<span class="counter-ready">✓ Countermeasure loaded</span>'}
        ${warnings.size > 0 ? '<button type="button" id="btn-fix-priorities" class="btn small ghost">Space priorities</button>' : ''}
      </div>
    `;

    const addCounter = document.getElementById('btn-add-counter');
    if (addCounter && advice) {
      addCounter.addEventListener('click', () => {
        GameState.addRule(
          advice.conditionId, advice.conditionValue, advice.actionId, advice.priority,
          null, null, null, advice.targetPriority,
        );
        AudioManager.play('rule_add');
      }, { once: true });
    }
    const fixPriorities = document.getElementById('btn-fix-priorities');
    if (fixPriorities) {
      fixPriorities.addEventListener('click', () => {
        if (GameState.normalizeRulePriorities()) AudioManager.play('rule_add');
      }, { once: true });
    }
  }

  renderModules() {
    const condQuery = this.condSearch ? this.condSearch.value.toLowerCase() : '';
    const actQuery = this.actSearch ? this.actSearch.value.toLowerCase() : '';

    // Conditions
    this.condList.innerHTML = '';
    for (const id of GameState.availableConditionIds()) {
      const c = GameDatabase.getCondition(id);
      if (!c) continue;
      if (condQuery && !c.displayName.toLowerCase().includes(condQuery) && !c.description.toLowerCase().includes(condQuery)) {
        continue;
      }
      const li = document.createElement('li');
      li.innerHTML = `<span class="mod-name">${escapeHtml(c.displayName)}</span><span class="module-add-hint">+ use</span>` +
        `<span class="mod-desc">${escapeHtml(c.description)}</span>` +
        (c.parameterType !== 'none' ? `<span class="mod-meta">param: ${escapeHtml(c.parameterType)}</span>` : '');
      li.style.cursor = 'pointer';
      li.dataset.tooltipType = 'condition';
      li.dataset.tooltipId = id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Use condition ${c.displayName}`);
      
      // One click pre-fills the builder; this also works on touch devices.
      const useCondition = () => {
        this._openAddForm();
        this.fCond.value = id;
        this._refreshFormParam();
        AudioManager.play('button_click');
      };
      li.addEventListener('click', useCondition);
      li.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          useCondition();
        }
      });
      this.condList.appendChild(li);
    }
    // Actions
    this.actList.innerHTML = '';
    for (const id of GameState.availableActionIds()) {
      const a = GameDatabase.getAction(id);
      if (!a) continue;
      if (actQuery && !a.displayName.toLowerCase().includes(actQuery) && !a.description.toLowerCase().includes(actQuery)) {
        continue;
      }
      const li = document.createElement('li');
      li.innerHTML = `<span class="mod-name">${escapeHtml(a.displayName)}</span><span class="module-add-hint">+ use</span>` +
        `<span class="mod-desc">${escapeHtml(a.description)}</span>` +
        `<span class="mod-meta">cd ${escapeHtml(a.cooldown)}s · e${escapeHtml(a.energyCost)} · r${escapeHtml(a.range)}</span>`;
      li.style.cursor = 'pointer';
      li.dataset.tooltipType = 'action';
      li.dataset.tooltipId = id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `Use action ${a.displayName}`);
      
      const useAction = () => {
        this._openAddForm();
        this.fAct.value = id;
        this._toggleFormTarget();
        AudioManager.play('button_click');
      };
      li.addEventListener('click', useAction);
      li.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          useAction();
        }
      });
      this.actList.appendChild(li);
    }
  }

  analyzeRules() {
    const warnings = new Map(); // ruleId -> array of warning strings
    const rules = GameState.rules;
    
    // 1. Same priority check (only for enabled rules)
    const enabledRules = rules.filter(r => r.enabled !== false);
    const prioGroups = {};
    for (const r of enabledRules) {
      if (!prioGroups[r.priority]) prioGroups[r.priority] = [];
      prioGroups[r.priority].push(r);
    }
    for (const prio in prioGroups) {
      if (prioGroups[prio].length > 1) {
        for (const r of prioGroups[prio]) {
          if (!warnings.has(r.id)) warnings.set(r.id, []);
          warnings.get(r.id).push(`Priority Conflict: Multiple active rules share priority ${prio}. Order is unstable.`);
        }
      }
    }
    
    // 2. Unreachable/Redundant rules check
    const sortedEnabled = [...enabledRules].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < sortedEnabled.length; i++) {
      const rA = sortedEnabled[i];
      for (let j = i + 1; j < sortedEnabled.length; j++) {
        const rB = sortedEnabled[j];
        if (
          rA.conditionId === rB.conditionId &&
          JSON.stringify(rA.conditionValue) === JSON.stringify(rB.conditionValue) &&
          rA.conditionId2 === rB.conditionId2 &&
          JSON.stringify(rA.conditionValue2) === JSON.stringify(rB.conditionValue2) &&
          rA.operator === rB.operator
        ) {
          if (!warnings.has(rB.id)) warnings.set(rB.id, []);
          if (rA.actionId === rB.actionId && rA.targetPriority === rB.targetPriority) {
            warnings.get(rB.id).push(`Redundant: This rule is identical to the higher-priority rule at priority ${rA.priority}.`);
          } else {
            warnings.get(rB.id).push(`Unreachable: Overridden by the higher-priority rule (priority ${rA.priority}) with the same condition.`);
          }
        }
      }
    }

    // 3. Last-battle feedback: show rules that existed but never actually fired.
    const report = GameState.lastReport || {};
    const activeRuleIds = new Set(Array.isArray(report.active_rule_ids) ? report.active_rule_ids : []);
    const ruleUsage = report.rule_usage || {};
    const diagnostics = report.rule_diagnostics || {};
    if (activeRuleIds.size > 0) {
      for (const r of enabledRules) {
        if (!activeRuleIds.has(r.id) || ruleUsage[r.id] > 0) continue;
        if (!warnings.has(r.id)) warnings.set(r.id, []);
        const reason = this._dominantDiagnostic(diagnostics[r.id]);
        warnings.get(r.id).push(`Last run: never fired${reason ? `; mostly blocked by ${reason}.` : '.'}`);
      }
    }
    return warnings;
  }

  _dominantDiagnostic(counts) {
    if (!counts || typeof counts !== 'object') return '';
    const labels = {
      cooldown: 'cooldown',
      energy: 'low energy',
      condition_false: 'false condition',
      overridden: 'higher-priority rules',
      disabled: 'disabled state',
    };
    let best = null;
    for (const [key, count] of Object.entries(counts)) {
      if (key === 'executing') continue;
      if (!best || count > best.count) best = { key, count };
    }
    return best ? (labels[best.key] || best.key) : '';
  }

  renderRules() {
    this.ruleList.innerHTML = '';
    this._activeWarnings = this.analyzeRules();

    const searchQuery = this.rulesSearch ? this.rulesSearch.value.toLowerCase() : '';

    // Add header row
    if (GameState.rules.length > 0) {
      const header = document.createElement('div');
      header.className = 'rule-header';
      header.innerHTML = `
        <span></span>
        <span style="text-align: center;">PRIO</span>
        <span>IF CONDITION 1</span>
        <span>AND/OR</span>
        <span>IF CONDITION 2</span>
        <span>THEN ACTION</span>
        <span>TARGET</span>
        <span style="text-align: center;">DEL</span>
      `;
      this.ruleList.appendChild(header);
    } else {
      // Empty state guide card
      const guide = document.createElement('div');
      guide.className = 'rule-empty-guide';
      guide.innerHTML = `
        <div class="guide-icon">⚡</div>
        <div class="guide-title">No Rules Programmed</div>
        <div class="guide-desc">Your robot has no logic — it will default to pursuing enemies.<br>
          Click <strong>+ Add Rule</strong> above to define your first directive.</div>
        <div class="guide-example">Example: <span class="kbd">IF hp_low → THEN shield</span></div>
      `;
      this.ruleList.appendChild(guide);
    }

    // Sort rules by priority descending first so they display in order in the editor
    const sortedRules = [...GameState.rules].sort((a, b) => b.priority - a.priority);
    for (const r of sortedRules) {
      // Filter check
      if (searchQuery) {
        const c1 = GameDatabase.getCondition(r.conditionId);
        const c1Name = c1 ? c1.displayName.toLowerCase() : '';
        const c2 = GameDatabase.getCondition(r.conditionId2);
        const c2Name = c2 ? c2.displayName.toLowerCase() : '';
        const a = GameDatabase.getAction(r.actionId);
        const aName = a ? a.displayName.toLowerCase() : '';
        
        const matches = 
          c1Name.includes(searchQuery) ||
          c2Name.includes(searchQuery) ||
          aName.includes(searchQuery) ||
          r.priority.toString().includes(searchQuery);
          
        if (!matches) continue;
      }

      const row = this._buildRow(r);
      this.ruleList.appendChild(row);
    }
    this._setupDragAndDrop();
  }

  _buildRow(r) {
    const row = document.createElement('div');
    row.className = 'rule-row';
    row.dataset.id = r.id;

    // 1. Drag handle (☰)
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = '☰';
    handle.title = 'Drag to reorder';
    handle.addEventListener('mousedown', () => {
      row.setAttribute('draggable', 'true');
    });
    handle.addEventListener('mouseup', () => {
      row.removeAttribute('draggable');
    });
    row.addEventListener('dragstart', (e) => {
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', r.id);
      this._draggedRuleId = r.id; // Store dragged rule ID for priority preservation
    });
    row.addEventListener('dragend', () => {
      row.removeAttribute('draggable');
      row.classList.remove('dragging');
      this._saveNewPriorities();
    });
    row.appendChild(handle);

    // 2. Priority input
    const prio = document.createElement('input');
    prio.type = 'number'; prio.min = 0; prio.max = 100; prio.value = r.priority;
    prio.className = 'rule-prio';
    prio.setAttribute('aria-label', `Priority for rule ${r.id}`);
    prio.style.width = '45px';
    prio.addEventListener('change', () => {
      GameState.setRulePriority(r.id, +prio.value);
      AudioManager.play('button_click');
    });
    row.appendChild(prio);

    // 3. Condition 1 + Param 1 + Enable toggle
    const cond1Wrap = document.createElement('div');
    cond1Wrap.className = 'cond-wrap';
    cond1Wrap.style.display = 'flex';
    cond1Wrap.style.alignItems = 'center';
    cond1Wrap.style.gap = '6px';
    cond1Wrap.style.width = '100%';

    const tog = document.createElement('input');
    tog.type = 'checkbox';
    tog.checked = r.enabled !== false;
    tog.title = 'enable/disable';
    tog.addEventListener('change', () => GameState.setRuleEnabled(r.id, tog.checked));
    cond1Wrap.appendChild(tog);

    const cond1Sel = this._condSelect(r.conditionId);
    cond1Sel.style.flex = '1';
    cond1Sel.setAttribute('aria-label', `Primary condition for rule ${r.id}`);
    cond1Sel.addEventListener('change', () => {
      GameState.setRuleCondition(r.id, cond1Sel.value);
      AudioManager.play('button_click');
    });
    cond1Wrap.appendChild(cond1Sel);

    const paramCell1 = document.createElement('span');
    paramCell1.className = 'rule-param';
    this._fillParamCellFor(paramCell1, r.id, r.conditionId, r.conditionValue, false);
    cond1Wrap.appendChild(paramCell1);
    row.appendChild(cond1Wrap);

    // 4. Operator Select (None / AND)
    const opSel = document.createElement('select');
    opSel.className = 'rule-op';
    opSel.setAttribute('aria-label', `Condition operator for rule ${r.id}`);
    opSel.style.width = '100%';
    const optNone = document.createElement('option');
    optNone.value = ''; optNone.textContent = 'None';
    if (!r.operator) optNone.selected = true;
    opSel.appendChild(optNone);

    const optAnd = document.createElement('option');
    optAnd.value = 'and'; optAnd.textContent = 'AND';
    if (r.operator === 'and') optAnd.selected = true;
    opSel.appendChild(optAnd);

    const optOr = document.createElement('option');
    optOr.value = 'or'; optOr.textContent = 'OR';
    if (r.operator === 'or') optOr.selected = true;
    opSel.appendChild(optOr);

    opSel.addEventListener('change', () => {
      GameState.setRuleOperator(r.id, opSel.value);
      AudioManager.play('button_click');
      this.renderRules(); // refresh list to show/hide condition 2 fields
    });
    row.appendChild(opSel);

    // 5. Condition 2 + Param 2 (hidden if operator is None)
    const cond2Wrap = document.createElement('div');
    cond2Wrap.className = 'cond2-wrap';
    cond2Wrap.style.display = 'flex';
    cond2Wrap.style.alignItems = 'center';
    cond2Wrap.style.gap = '6px';
    cond2Wrap.style.width = '100%';

    if (r.operator === 'and' || r.operator === 'or') {
      const cond2Sel = this._condSelect(r.conditionId2 || 'hp_low');
      cond2Sel.style.flex = '1';
      cond2Sel.setAttribute('aria-label', `Secondary condition for rule ${r.id}`);
      cond2Sel.addEventListener('change', () => {
        GameState.setRuleCondition2(r.id, cond2Sel.value);
        AudioManager.play('button_click');
      });
      cond2Wrap.appendChild(cond2Sel);

      const paramCell2 = document.createElement('span');
      paramCell2.className = 'rule-param';
      this._fillParamCellFor(paramCell2, r.id, r.conditionId2 || 'hp_low', r.conditionValue2, true);
      cond2Wrap.appendChild(paramCell2);
    } else {
      cond2Wrap.style.visibility = 'hidden';
    }
    row.appendChild(cond2Wrap);

    // 6. Action Select
    const actSel = this._actSelect(r.actionId);
    actSel.setAttribute('aria-label', `Action for rule ${r.id}`);
    const actWrap = document.createElement('span');
    actWrap.style.display = 'flex';
    actWrap.style.flexDirection = 'column';
    actWrap.style.alignItems = 'flex-start';
    actWrap.style.gap = '3px';
    actWrap.style.width = '100%';

    const selLine = document.createElement('div');
    selLine.style.display = 'flex';
    selLine.style.alignItems = 'center';
    selLine.style.gap = '4px';
    selLine.style.width = '100%';
    selLine.appendChild(document.createTextNode('→ '));
    selLine.appendChild(actSel);
    actWrap.appendChild(selLine);

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'rule-act-badge';
    badgeSpan.style.marginLeft = '16px';
    const updateBadges = (actId) => {
      const a = GameDatabase.getAction(actId);
      if (a) {
        badgeSpan.innerHTML = `<span class="badge-cd">${a.cooldown}s</span><span class="badge-en">e${a.energyCost}</span>`;
      } else {
        badgeSpan.innerHTML = '';
      }
    };
    updateBadges(r.actionId);
    actWrap.appendChild(badgeSpan);

    actSel.addEventListener('change', () => {
      GameState.setRuleAction(r.id, actSel.value);
      updateBadges(actSel.value);
      AudioManager.play('button_click');
    });
    row.appendChild(actWrap);

    // 6.5 Targeting Priority Dropdown
    const tarSel = document.createElement('select');
    tarSel.className = 'rule-target-prio';
    tarSel.setAttribute('aria-label', `Target priority for rule ${r.id}`);
    tarSel.style.width = '100%';
    const targets = [
      { val: 'nearest', label: 'Nearest' },
      { val: 'lowest_hp', label: 'Lowest HP' },
      { val: 'caster', label: 'Caster' },
      { val: 'boss', label: 'Boss' }
    ];
    for (const t of targets) {
      const opt = document.createElement('option');
      opt.value = t.val; opt.textContent = t.label;
      if (r.targetPriority === t.val) opt.selected = true;
      tarSel.appendChild(opt);
    }
    tarSel.addEventListener('change', () => {
      GameState.setRuleTargetPriority(r.id, tarSel.value);
      AudioManager.play('button_click');
    });
    const targetsEnemies = ['basic_attack', 'dash_toward', 'dash_away', 'interrupt_shot'].includes(r.actionId);
    if (!targetsEnemies) {
      tarSel.style.visibility = 'hidden';
    }
    row.appendChild(tarSel);

    // Warnings alert icon
    const warnings = this._activeWarnings && this._activeWarnings.get(r.id);
    if (warnings && warnings.length > 0) {
      const warnSpan = document.createElement('span');
      warnSpan.className = 'rule-warn-icon';
      warnSpan.innerHTML = '⚠️';
      warnSpan.style.cursor = 'help';
      warnSpan.style.color = '#ffb938';
      warnSpan.style.marginRight = '8px';
      warnSpan.style.fontSize = '14px';
      warnSpan.style.textShadow = '0 0 6px #ffb938';
      
      warnSpan.addEventListener('mouseenter', () => {
        const tooltip = document.getElementById('custom-tooltip');
        if (!tooltip) return;
        tooltip.innerHTML = warnings.map(w => `<div style="margin-bottom: 4px; color: #ffb938; font-weight: bold;">• ${escapeHtml(w)}</div>`).join('');
        tooltip.classList.remove('hidden');
        tooltip.style.display = 'block';
        
        const rect = warnSpan.getBoundingClientRect();
        const tooltipW = tooltip.offsetWidth;
        const tooltipH = tooltip.offsetHeight;
        
        tooltip.style.left = `${window.scrollX + rect.left - tooltipW / 2 + rect.width / 2}px`;
        tooltip.style.top = `${window.scrollY + rect.top - tooltipH - 8}px`;
      });
      
      warnSpan.addEventListener('mouseleave', () => {
        const tooltip = document.getElementById('custom-tooltip');
        if (tooltip) {
          tooltip.classList.add('hidden');
          tooltip.style.display = 'none';
        }
      });

      row.appendChild(warnSpan);
    }
    
    // 7. Actions Container (Duplicate + Delete)
    const actionsContainer = document.createElement('span');
    actionsContainer.style.display = 'flex';
    actionsContainer.style.alignItems = 'center';
    actionsContainer.style.justifyContent = 'center';
    actionsContainer.style.gap = '8px';

    // 7.1 Clone Button
    const clone = document.createElement('button');
    clone.className = 'clone-btn'; clone.innerHTML = '📋'; clone.title = 'Duplicate Rule';
    clone.style.background = 'none';
    clone.style.border = 'none';
    clone.style.cursor = 'pointer';
    clone.style.color = 'var(--muted)';
    clone.style.fontSize = '12px';
    clone.style.padding = '2px';
    clone.style.transition = 'color 0.2s, transform 0.2s';
    clone.addEventListener('mouseenter', () => { clone.style.color = 'var(--accent2)'; clone.style.transform = 'scale(1.15)'; });
    clone.addEventListener('mouseleave', () => { clone.style.color = 'var(--muted)'; clone.style.transform = 'scale(1)'; });
    clone.addEventListener('click', () => {
      GameState.addRule(
        r.conditionId, r.conditionValue, r.actionId, Math.max(0, r.priority - 1),
        r.conditionId2, r.conditionValue2, r.operator, r.targetPriority
      );
      AudioManager.play('rule_add');
    });
    actionsContainer.appendChild(clone);

    // 7.2 Delete Button
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.title = 'delete';
    del.addEventListener('click', () => {
      GameState.removeRule(r.id);
      AudioManager.play('rule_add');
    });
    actionsContainer.appendChild(del);

    row.appendChild(actionsContainer);

    return row;
  }

  _condSelect(selected) {
    const sel = document.createElement('select');
    for (const id of GameState.availableConditionIds()) {
      const c = GameDatabase.getCondition(id);
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = c ? c.displayName : id;
      if (id === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  _actSelect(selected) {
    const sel = document.createElement('select');
    for (const id of GameState.availableActionIds()) {
      const a = GameDatabase.getAction(id);
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = a ? a.displayName : id;
      if (id === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  _fillParamCellFor(cell, ruleId, condId, condVal, isSecondary) {
    cell.innerHTML = '';
    const c = GameDatabase.getCondition(condId);
    if (!c || c.parameterType === 'none') { cell.textContent = ''; return; }

    const setter = (val) => {
      if (isSecondary) {
        GameState.setRuleConditionValue2(ruleId, val);
      } else {
        GameState.setRuleConditionValue(ruleId, val);
      }
    };

    if (c.parameterType === 'vec2') {
      const v = Array.isArray(condVal) ? condVal : c.defaultValue;
      const inpR = document.createElement('input'); inpR.type = 'number'; inpR.value = v[0]; inpR.step = 0.5; inpR.style.width = '45px';
      const inpC = document.createElement('input'); inpC.type = 'number'; inpC.value = v[1]; inpC.step = 1;   inpC.style.width = '35px';
      const apply = () => setter([+inpR.value, +inpC.value|0]);
      inpR.addEventListener('change', apply); inpC.addEventListener('change', apply);
      cell.appendChild(inpR); cell.appendChild(document.createTextNode('/')); cell.appendChild(inpC);
    } else if (c.parameterType === 'percent') {
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = 5; inp.max = 95; inp.value = Math.round(condVal * 100); inp.style.width = '45px';
      const suffix = document.createTextNode('%');
      inp.addEventListener('change', () => setter(+inp.value / 100));
      cell.appendChild(inp); cell.appendChild(suffix);
    } else if (c.parameterType === 'int') {
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = condVal|0; inp.style.width = '45px';
      inp.addEventListener('change', () => setter(+inp.value|0));
      cell.appendChild(inp);
    } else { // float
      const inp = document.createElement('input'); inp.type = 'number'; inp.step = 0.5; inp.value = condVal; inp.style.width = '50px';
      inp.addEventListener('change', () => setter(+inp.value));
      cell.appendChild(inp);
    }
  }

  _setupDragAndDrop() {
    const container = this.ruleList;
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = container.querySelector('.rule-row.dragging');
      if (!dragging) return;
      const afterElement = this._getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(dragging);
      } else {
        container.insertBefore(dragging, afterElement);
      }
    });
  }

  _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.rule-row:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  _saveNewPriorities() {
    const draggedId = this._draggedRuleId;
    if (!draggedId) return;
    this._draggedRuleId = null;

    const rows = [...this.ruleList.querySelectorAll('.rule-row')];
    const index = rows.findIndex(row => row.dataset.id === draggedId);
    if (index === -1) return;

    const draggedRule = GameState.rules.find(r => r.id === draggedId);
    if (!draggedRule) return;

    let prioAbove = null;
    let prioBelow = null;

    if (index > 0) {
      const rowAbove = rows[index - 1];
      const ruleAbove = GameState.rules.find(r => r.id === rowAbove.dataset.id);
      if (ruleAbove) prioAbove = ruleAbove.priority;
    }
    if (index < rows.length - 1) {
      const rowBelow = rows[index + 1];
      const ruleBelow = GameState.rules.find(r => r.id === rowBelow.dataset.id);
      if (ruleBelow) prioBelow = ruleBelow.priority;
    }

    let newPrio = draggedRule.priority;
    if (prioAbove !== null && prioBelow !== null) {
      newPrio = Math.round((prioAbove + prioBelow) / 2);
    } else if (prioBelow !== null) {
      newPrio = Math.min(100, prioBelow + 5);
    } else if (prioAbove !== null) {
      newPrio = Math.max(0, prioAbove - 5);
    }

    GameState.pushUndoState();
    draggedRule.priority = newPrio;
    GameState.saveToStorage();
    GameState._emit('rules');
    AudioManager.play('button_click');
  }

  renderStats() {
    const s = GameState.stats;
    const base = {
      max_hp: 100, max_energy: 100, energy_regen: 8,
      move_speed: 4, basic_dmg: 8, basic_cd: 0.4,
      dash_distance: 3, dash_cd: 3,
      shield_dur: 2, shield_reduce: 0.70, shield_cd: 8,
      interrupt_cd: 5, overdrive_cd: 15, overdrive_dur: 5,
      armor_piercing: 0,
    };

    const diff = (key, formatFn, isLowerBetter = false) => {
      const curVal = s[key];
      const baseVal = base[key];
      const delta = curVal - baseVal;
      if (Math.abs(delta) < 0.001) return '';
      const sign = delta > 0 ? '+' : '';
      const isBetter = isLowerBetter ? delta < 0 : delta > 0;
      const cls = isBetter ? 'stat-better' : 'stat-worse';
      return `<span class="stat-diff ${cls}">(${sign}${formatFn(delta)})</span>`;
    };

    this.unitStats.innerHTML =
      `<span class="stat">HP<b>${s.max_hp}</b>${diff('max_hp', d => d)}</span>` +
      `<span class="stat">EN<b>${s.max_energy}</b>${diff('max_energy', d => d)}</span>` +
      `<span class="stat">Regen<b>${s.energy_regen.toFixed(1)}/s</b>${diff('energy_regen', d => d.toFixed(1) + '/s')}</span>` +
      `<span class="stat">SPD<b>${s.move_speed}</b>${diff('move_speed', d => d)}</span>` +
      `<span class="stat">DMG<b>${s.basic_dmg.toFixed(1)}</b>${diff('basic_dmg', d => d.toFixed(1))}</span>` +
      `<span class="stat">DashCD<b>${s.dash_cd.toFixed(1)}s</b>${diff('dash_cd', d => d.toFixed(1) + 's', true)}</span>` +
      `<span class="stat">ShieldCD<b>${s.shield_cd}s</b>${diff('shield_cd', d => d.toFixed(1) + 's', true)}</span>` +
      `<span class="stat">AP<b>${s.armor_piercing}</b>${diff('armor_piercing', d => d)}</span>`;
  }

  _bind() {
    this.btnUndo.addEventListener('click', () => {
      if (GameState.undo()) AudioManager.play('button_click');
    });
    this.btnRedo.addEventListener('click', () => {
      if (GameState.redo()) AudioManager.play('button_click');
    });
    document.addEventListener('keydown', (e) => {
      if (this.el.classList.contains('hidden')) return;
      
      // Ctrl + Z (Undo)
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (GameState.undo()) AudioManager.play('button_click');
      }
      // Ctrl + Y (Redo)
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (GameState.redo()) AudioManager.play('button_click');
      }
      // Ctrl + S (Save Loadout)
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const slot = this.lastSavedSlot || 1;
        const btnSave = document.getElementById(`btn-save-${slot}`);
        if (btnSave) btnSave.click();
      }
      // Enter or Space to Run Simulation (when not focused on text inputs, dropdowns, or buttons)
      if (e.key === 'Enter' || (e.key === ' ' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'BUTTON')) {
        // Allow default enter behavior in rule form submit
        if (e.key === 'Enter' && this.ruleForm && !this.ruleForm.classList.contains('hidden')) {
          return;
        }
        e.preventDefault();
        if (this.btnRun) this.btnRun.click();
      }
    });

    this.btnAddRule.addEventListener('click', () => {
      AudioManager.play('button_click');
      this._openAddForm();
    });
    this.fCancel.addEventListener('click', () => {
      this.ruleForm.classList.add('hidden');
    });
    this.fAdd.addEventListener('click', () => {
      const condId = this.fCond.value;
      const actId = this.fAct.value;
      const prio = +this.fPrio.value || 50;
      const c = GameDatabase.getCondition(condId);
      const val = this._readFormParam(c);

      const op = this.fOp.value || null;
      let condId2 = null;
      let val2 = null;
      if (op === 'and' || op === 'or') {
        condId2 = this.fCond2.value;
        const c2 = GameDatabase.getCondition(condId2);
        val2 = this._readFormParam2(c2);
      }

      const targetPrio = this.fTarget.value || 'nearest';

      GameState.addRule(condId, val, actId, prio, condId2, val2, op, targetPrio);
      AudioManager.play('rule_add');
      this.ruleForm.classList.add('hidden');
    });
    this.fCond.addEventListener('change', () => this._refreshFormParam());
    this.fCond2.addEventListener('change', () => this._refreshFormParam2());
    this.fAct.addEventListener('change', () => this._toggleFormTarget());
    this.fOp.addEventListener('change', () => {
      if (this.fOp.value === 'and' || this.fOp.value === 'or') {
        this.fCond2.classList.remove('hidden');
        this.fCond2Param.classList.remove('hidden');
      } else {
        this.fCond2.classList.add('hidden');
        this.fCond2Param.classList.add('hidden');
      }
    });
    this.btnRun.addEventListener('click', () => {
      AudioManager.play('button_click');
      GameManager.goCombat();
    });
    if (this.btnSandbox) {
      this.btnSandbox.addEventListener('click', () => {
        AudioManager.play('button_click');
        GameManager.goSandbox();
      });
    }

    // Bind Slots Load/Save
    for (let slot = 1; slot <= 3; slot++) {
      const btnLoad = document.getElementById(`btn-load-${slot}`);
      const btnSave = document.getElementById(`btn-save-${slot}`);
      if (btnLoad) {
        btnLoad.addEventListener('click', () => {
          const res = GameState.loadLoadout(slot);
          if (res && res.ok) {
            this.lastSavedSlot = slot; // update last used slot
            if (res.filtered) {
              AudioManager.play('defeat');
              console.warn("Some rules from the loadout slot were locked at the current teach stage and were skipped.");
            } else {
              AudioManager.play('rule_add');
            }
            this.updateLoadoutStatus();
          }
        });
      }
      if (btnSave) {
        btnSave.addEventListener('click', () => {
          if (GameState.saveLoadout(slot)) {
            this.lastSavedSlot = slot; // update last used slot
            AudioManager.play('button_click');
            const originalText = btnSave.textContent;
            btnSave.textContent = 'SAVED!';
            btnSave.classList.add('success-flash');
            setTimeout(() => {
              btnSave.textContent = originalText;
              btnSave.classList.remove('success-flash');
            }, 1000);
            this.updateLoadoutStatus();
          }
        });
      }
    }
  }

  updateLoadoutStatus() {
    for (let slot = 1; slot <= 3; slot++) {
      const led = document.getElementById(`slot-led-${slot}`);
      const btnLoad = document.getElementById(`btn-load-${slot}`);
      if (!led) continue;
      const exists = GameState.hasLoadout(slot);
      if (exists) {
        led.style.background = '#3eff9d';
        led.style.boxShadow = '0 0 8px #3eff9d';
        if (btnLoad) btnLoad.disabled = false;
      } else {
        led.style.background = '#222';
        led.style.boxShadow = 'none';
        if (btnLoad) btnLoad.disabled = true;
      }
    }
  }

  _toggleFormTarget() {
    const targetsEnemies = ['basic_attack', 'dash_toward', 'dash_away', 'interrupt_shot'].includes(this.fAct.value);
    if (targetsEnemies) {
      this.fTarget.classList.remove('hidden');
    } else {
      this.fTarget.classList.add('hidden');
    }
  }

  _openAddForm() {
    this.fCond.innerHTML = '';
    this.fCond2.innerHTML = '';
    const conds = GameState.availableConditionIds();
    for (const id of conds) {
      const c = GameDatabase.getCondition(id);
      
      const opt = document.createElement('option'); opt.value = id; opt.textContent = c ? c.displayName : id;
      this.fCond.appendChild(opt);
      
      const opt2 = document.createElement('option'); opt2.value = id; opt2.textContent = c ? c.displayName : id;
      this.fCond2.appendChild(opt2);
    }
    this.fAct.innerHTML = '';
    for (const id of GameState.availableActionIds()) {
      const a = GameDatabase.getAction(id);
      const opt = document.createElement('option'); opt.value = id; opt.textContent = a ? a.displayName : id;
      this.fAct.appendChild(opt);
    }
    this.fPrio.value = 50;
    this.fOp.value = '';
    this.fCond2.classList.add('hidden');
    this.fCond2Param.classList.add('hidden');
    this.fTarget.value = 'nearest';
    this._toggleFormTarget();
    
    this._refreshFormParam();
    this._refreshFormParam2();
    this.ruleForm.classList.remove('hidden');
  }

  _refreshFormParam() {
    const c = GameDatabase.getCondition(this.fCond.value);
    this.fCondParam.innerHTML = '';
    this._refreshParamEl(this.fCondParam, c, 'fp-r', 'fp-c', 'fp-pct', 'fp-int', 'fp-flt');
  }

  _refreshFormParam2() {
    const c = GameDatabase.getCondition(this.fCond2.value);
    this.fCond2Param.innerHTML = '';
    this._refreshParamEl(this.fCond2Param, c, 'fp-r2', 'fp-c2', 'fp-pct2', 'fp-int2', 'fp-flt2');
  }

  _refreshParamEl(container, c, idR, idC, idPct, idInt, idFlt) {
    if (!c || c.parameterType === 'none') return;
    if (c.parameterType === 'vec2') {
      const v = c.defaultValue;
      const inpR = document.createElement('input'); inpR.type = 'number'; inpR.value = v[0]; inpR.step = 0.5; inpR.id = idR; inpR.style.width = '50px';
      const inpC = document.createElement('input'); inpC.type = 'number'; inpC.value = v[1]; inpC.step = 1;   inpC.id = idC; inpC.style.width = '40px';
      container.appendChild(inpR); container.appendChild(document.createTextNode(' / ')); container.appendChild(inpC);
    } else if (c.parameterType === 'percent') {
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = Math.round(c.defaultValue * 100); inp.min = 5; inp.max = 95; inp.id = idPct; inp.style.width = '50px';
      container.appendChild(inp); container.appendChild(document.createTextNode('%'));
    } else if (c.parameterType === 'int') {
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = c.defaultValue|0; inp.id = idInt; inp.style.width = '50px';
      container.appendChild(inp);
    } else {
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = c.defaultValue; inp.step = 0.5; inp.id = idFlt; inp.style.width = '60px';
      container.appendChild(inp);
    }
  }

  _readFormParam(c) {
    return this._readFormParamEl(c, 'fp-r', 'fp-c', 'fp-pct', 'fp-int', 'fp-flt');
  }

  _readFormParam2(c) {
    return this._readFormParamEl(c, 'fp-r2', 'fp-c2', 'fp-pct2', 'fp-int2', 'fp-flt2');
  }

  _readFormParamEl(c, idR, idC, idPct, idInt, idFlt) {
    if (!c || c.parameterType === 'none') return null;
    if (c.parameterType === 'vec2') {
      const r = document.getElementById(idR), cc = document.getElementById(idC);
      return [+r.value, +cc.value|0];
    }
    if (c.parameterType === 'percent') {
      const inp = document.getElementById(idPct);
      return +inp.value / 100;
    }
    if (c.parameterType === 'int') {
      const inp = document.getElementById(idInt);
      return +inp.value|0;
    }
    const inp = document.getElementById(idFlt);
    return +inp.value;
  }
}
