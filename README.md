# OVERLOGIC

2D top-down auto-combat roguelike strategy game. You do not control the robot by reflexes; you program its combat brain, run the simulation, read the result, and refine the rule stack.

Live build: https://lunora-gather.github.io/Overlogic/

## What You Play

- Program prioritized `IF condition THEN action` rules with optional `AND` / `OR` clauses.
- Choose target priorities such as nearest, lowest HP, caster, or boss.
- Watch the robot execute rules in real time, with active-rule highlighting and diagnostics.
- Clear a branching combat map with reward choices, repair nodes, passive upgrades, hazards, and boss variants.
- Use failure reports and editor warnings to understand which rules fired, which never fired, and why they were blocked.

## Current UX Features

- Responsive editor, battle, reward, report, and victory screens for desktop and mobile.
- Searchable condition/action lists and active rule filtering.
- Battle-specific readiness checks, persistent-HP risk warnings, and optional countermeasure rules.
- Click or keyboard-select modules to prefill the rule builder; priority conflicts can be normalized in one action.
- Three local loadout slots with quick save/load controls.
- Persistent settings for volume, mute, camera shake, and reduced motion.
- Tooltips for modules and map nodes.
- Post-battle charts, action frequency, damage breakdowns, and contextual rule suggestions.
- Save migration and bad-save recovery for older or corrupted local storage data.

During combat, press `P` to pause/resume, `.` to single-step while paused, and `S` to change simulation speed.

## Run Locally

The game uses native ES modules and JSON data files, so run it through a local web server.

```bash
npx serve .
```

Then open the printed local URL, usually `http://localhost:3000`.

If you prefer Python, run a local HTTP server from the repo root:

```bash
python -m http.server 8000
```

## Verification

Node.js 24 is used in CI. The project has no build step.

```bash
npm run verify
npm run balance
```

`npm run verify` checks syntax, data contracts, save migration, reward flow, report suggestions, combat completion contracts, and a headless combat simulation.

`npm run balance` gates the early battles and reports deterministic diagnostics for the full enemy roster. Verification also checks that an upgraded starter-kit build can finish the standard boss without depending on a specific action unlock.

## Deployment

GitHub Pages serves the static project directly from the repository. The workflow in `.github/workflows/verify.yml` runs the verification gate on pushes and pull requests so gameplay-critical regressions are caught before deployment.

## Project Map

- `index.html` and `style.css`: app shell and visual system.
- `data/`: editable gameplay content for actions, conditions, enemies, battles, and rewards.
- `src/core/`: state, map progress, battle lifecycle, and persistence.
- `src/logic/`: condition evaluation, rule formatting, action execution, and rule selection.
- `src/ui/`: editor, HUD, rewards, reports, victory screen, charts, and HTML escaping helpers.
- `scripts/`: CI-safe verification and deterministic balance simulation.

## Design Principle

Every system should help the player answer one question: "Why did my robot do that?" Rules, diagnostics, reports, and rewards should make iteration faster without taking control away from the player.
