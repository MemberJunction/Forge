---
name: forge-regression-harness
description: Use the MJ Forge regression test harness to verify changes don't break anything. Trigger this skill BEFORE starting any non-trivial dev work that touches packages/main, packages/renderer, packages/shared, or packages/preload — and AFTER making changes (to catch regressions early). The user has 268+ tests across four tiers (unit, integration, e2e, visual) wired into a fast pipeline at `npm run test:full`. Make sure to use this skill whenever the user asks you to fix, implement, refactor, add, or otherwise modify substantive code in this repo, even if they don't explicitly ask you to "run the tests" — they expect you to verify your work. The dashboard at http://127.0.0.1:5188 is for the human to watch your progress; you should rely on programmatic mechanisms (npm scripts, structured JSON output) to drive and interpret runs.
---

# MJ Forge Regression Harness

This repo has a comprehensive regression test harness. Use it. The workflow below tells you when and how.

## When to use

The harness is fast (~13s for the full pipeline) and the cost of running it is far lower than the cost of shipping a regression. Run it proactively at three points:

| Moment                                   | Command                                    | Why                                                              |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| **Before starting** non-trivial dev work | `npm test` (unit baseline)                 | Confirms the starting state is green so any new failure is yours |
| **After a logical chunk** of work        | The narrowest tier you touched (see below) | Tight feedback loop while you're iterating                       |
| **Before declaring done** / committing   | `npm run test:full`                        | Complete picture across all tiers                                |

**Don't run** for trivial changes (typos, comments, doc-only changes, modifications to the test harness itself). Running tests on tests is recursive — `tests/integration/harness.spec.ts` is the canary that verifies the harness, you don't need a meta-canary.

## How to trigger (programmatic)

The dashboard at http://127.0.0.1:5188 is for the **human** to watch — you should drive runs with these:

| Script                     | Tier(s)                     | Wall time | Infra needed                    |
| -------------------------- | --------------------------- | --------- | ------------------------------- |
| `npm test`                 | Unit                        | ~700ms    | None                            |
| `npm run test:integration` | Integration                 | ~3s       | `npm run test:harness:up` first |
| `npm run test:e2e`         | E2E (Playwright + Electron) | ~3s       | `npm run build` first           |
| `npm run test:visual`      | Visual regression baselines | ~10s      | `npm run build` first           |
| `npm run test:full`        | All four                    | ~13s      | Brings harness up automatically |

`npm run test:full` is your most useful single command: it brings the Docker harness up, runs every tier, writes structured JSON to `tests/reports/.cache/`, generates the HTML report at `tests/reports/latest.html`, and exits non-zero on any failure.

If the user already has the dashboard running (`npm run test:dashboard` in another terminal), you can also trigger via HTTP — but always fall back to the npm scripts as the reliable path:

```
POST http://127.0.0.1:5188/control/run-tier   {"tier":"unit"|"integration"|"e2e"|"visual"}
POST http://127.0.0.1:5188/control/run-suite  {"tier":"…","file":"tests/…"}
```

## How to interpret results

Three signals, in order of preference:

1. **Exit code** — primary signal (0 = pass, non-zero = fail). Don't celebrate green based on a quick scan of stdout; trust the exit.

2. **Structured JSON** at `tests/reports/.cache/{unit,integration,e2e,visual}.json` — read these for per-test details. Failure messages and stack traces are inline in `testResults[].assertionResults[].failureMessages` for vitest output and in nested `suites[].specs[].tests[].results[]` for playwright. Visual tests expose snapshot paths.

3. **Static HTML report** at `tests/reports/latest.html` — has every result with per-section "Copy for LLM" payloads embedded as `data-copy-payload` attributes. Useful when you want the same compressed failure context the human is looking at.

## How to iterate on failures

When a test fails, do this — not a dump-and-pray full-pipeline retry:

1. **Read the JSON** to find the failing test's source file and the specific assertion that failed.
2. **Read the failing test source** to understand what it's verifying.
3. **Read the production code under test** — the test usually targets a specific module.
4. **Make a focused fix** — narrow scope, don't refactor adjacent code.
5. **Re-run JUST that suite** to iterate quickly:
   - Vitest: `npx vitest run <path/to/spec.ts>` (unit) or `npx vitest run --config vitest.integration.config.ts <path>` (integration)
   - Playwright: `npx playwright test --project=e2e <path>` or `--project=visual <path>`
6. Once the targeted suite passes, run the broader tier (`npm test` / `npm run test:integration` / etc.) to ensure your fix didn't break neighbors.
7. Before declaring done, run `npm run test:full`.

## Picking the right tier for your change

Match the tier to what you touched:

- **Pure logic changes** (utilities, parsers, validators in `packages/*/src/`) → `npm test` (unit). Almost always the right starting point.
- **Service / SQL / DB changes** (anything in `packages/main/src/services/sql`, `services/ssh`, dialects, providers) → `npm run test:integration`. Real DB roundtrips catch what mocks can't.
- **AI / LLM provider changes** → `npm run test` for the unit-level llm-providers spec. (Live LLM calls are intentionally not in the suite — manual pre-release check.)
- **UI / Angular component changes** → `npm run build && npm run test:e2e` for functional, plus `npm run test:visual` for layout regression.
- **Anything significant** → `npm run test:full` before declaring done.

## Visual regression specifics

The visual tier uses Playwright's `toHaveScreenshot()` against committed PNG baselines under `tests/__snapshots__/visual/`. It's macOS-only by design (per-developer M-series Macs all produce equivalent baselines).

When you make an **intentional UI change**, the visual tests will fail (the new look doesn't match the old baseline). Re-capture with:

```
npm run test:visual:update
```

Then verify the regenerated baselines look right (the human will see them in the dashboard / static report) and commit them alongside the UI change. Don't blindly run `:update` to silence failures — confirm the change was deliberate first.

## Infrastructure context

The test harness is Docker Compose (`tests/docker-compose.test.yml`) with five services:

- `mssql` — SQL Server 2022 dev edition, host port 11433
- `postgres` — PostgreSQL 16, host port 15432
- `mysql` — MySQL 8, host port 13306
- `bastion` — SSH bastion (linuxserver/openssh-server, patched config to allow TCP forwarding), host port 12222
- `postgres-private` — A second PostgreSQL only reachable through the bastion (for SSH tunnel tests)

Synthetic e-commerce schema (products / customers / orders / order_items) lives at `tests/fixtures/{mssql,postgres,mysql}/{schema,seed}.sql` — the seed data is identical across all three engines so cross-engine result comparisons work.

Key helpers in `tests/helpers/`:

- `db-fixtures.ts` exports `withFreshDatabase(engine, fn)` — creates a uniquely-named database on the target engine, applies the schema, hands the callback connection config, drops on exit.
- `electron-app.ts` exports `withForge(fn)` — launches the built Forge app via Playwright's `_electron.launch()`, hands you the ElectronApplication + first Page, closes on exit.

If the harness isn't up, `npm run test:integration` will fail with a connection error. Bring it up with `npm run test:harness:up`, or just use `npm run test:full` which manages the lifecycle.

## When NOT to bother

- **Documentation-only changes** (`*.md`, comments) — no test value, skip.
- **Pure refactor with passing tests already verified seconds ago** — if you literally just ran `test:full`, don't run it again unless you've made changes since.
- **Changes inside the test harness itself** (`tests/`, `tests/reporter/`) — `tests/integration/harness.spec.ts` is the canary. Run it (`npx vitest run tests/integration/harness.spec.ts --config vitest.integration.config.ts`) and trust it.

## Common pitfalls

- **Forgetting `npm run build` before E2E/visual** — Playwright launches `packages/main/dist/index.js`, which won't reflect source changes until you build. The test will throw a clear "expected built main process" error from `electron-app.ts` if dist is missing.
- **Treating "vitest watch ran fine in the dashboard" as confirmation** — the dashboard's vitest watcher reruns AFFECTED tests, not all of them. For "is everything still green?" use `npm test` or `npm run test:full`.
- **Updating visual baselines reflexively** — `:update` regenerates from current behavior. If you didn't intend to change the UI but a visual test fails, that's a real regression you need to investigate, not silence.

## Workflow example

User says: "Add a `formatBytes` utility to the shared package and use it in the connection pool stats display."

1. **Baseline check** — `npm test` to confirm starting state is green.
2. **Implement the utility + the consumer.**
3. **Targeted re-run** — `npx vitest run packages/shared/src/utils/format-bytes.spec.ts` (write tests alongside per the repo's CLAUDE.md rule).
4. **Tier check** — `npm test` to confirm shared changes haven't broken consumers in main.
5. **UI changed?** Yes (display in renderer). Build, then visual: `npm run build && npm run test:visual`. If a baseline fails because the formatted bytes string is now visible where it wasn't, inspect the diff (it'll appear in the dashboard / static report), confirm intent, then `npm run test:visual:update` and commit the new baseline.
6. **Final check** — `npm run test:full` before declaring done.
7. Open the static report at `tests/reports/latest.html` and verify the green run, then summarize for the user.
