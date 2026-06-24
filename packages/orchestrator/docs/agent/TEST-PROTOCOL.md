# Test protocol — validate at BOTH layers, every time

The governing rule of this workspace: **every change is validated at the CLI/
back-end layer AND the GUI layer.** Passing a back-end test is _necessary but not
sufficient_. The class of bug that keeps reaching humans is "the engine works,
but the button is missing / disabled / wired wrong" — found only by manual
clicking. We eliminate it by testing the **UI's presence and its behavior**
programmatically, the same way we test the CLI.

**Companion doc:** `CONTINUOUS-VERIFICATION.md` is the _inventory of validated behaviors_
(what must be re-proven on a change, with exact commands, plus known pre-existing failures
not to re-flag). This file is _how_ to run each tier; that one is _what_ to cover. Consult it
on every non-trivial change and add to it when you validate new behavior.

## Test the real use case, and describe tests accurately (non-negotiable)

The harness exists so the **user does not do the testing** — they should only have to test if
you explicitly tell them to AND there's a real reason. So:

- **Test the actual feature in the way it's used.** Change app-linking → run `mjdev app link`
  end-to-end. Change boot → boot it. Prefer tests that mimic the **production environment + real
  use case** so real issues surface. A passing unit test is not "it works."
- **When you say "this works," it must mean you exercised the real use case.** Never report a
  feature as working off a partial test.
- **A half-test is fine to save time — but you MUST label it as a half-test** and state exactly
  what you did and didn't cover. Claiming something works when it doesn't is the worst outcome;
  an accurately-labeled partial test is honest and useful.
- **Very-involved tests:** surface that to the user and ask for advice — UNLESS they've told you
  to roll through / "just do the change and the testing." If told to roll through, print a short
  console line ("beginning long testing") so a watching user can intervene, then proceed.

## Reusable dev instances (keep them; don't always start from scratch)

The slow part of a real test is standing up an instance. So **keep a few (~3-4) dedicated dev
instances in the dev MJDev app** (`~/.mjdev-dev`, the isolated dev workspace — **never** the prod
workspace a human relies on) specifically for development testing. If a test creates an instance
that could serve the same kind of test again (e.g. an app-link smoke instance on a current MJ
base), it's good to keep it rather than delete it, so the next request reuses it. Name them
obviously (e.g. `applink-smoke`).

So for any UI-shaped change you must, in addition to the CLI/engine test:

1. **Assert the element is PRESENT** (the button/field/row you expect renders).
2. **Assert it DOES what it should** — clicking it drives the real engine and the
   UI reflects the resulting state (and shows the right error on failure).

This roughly doubles test effort on UI work. That is the expected, accepted cost.

## Tiers (cheapest first — don't run the most expensive every commit)

| Change                             | Always                                           | Plus                                                                 |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `shared` / `preload` / pure engine | unit + typecheck                                 | —                                                                    |
| `orchestrator` semantics           | unit + integration                               | live instance only when un-fakeable                                  |
| `renderer` / `main` UI or workflow | unit + typecheck                                 | **seeded GUI e2e** (presence + behavior)                             |
| inside-instance app work           | the worktree's own `npm test` / `turbo run test` | `mjdev e2e <slug>` against live Explorer/GraphQL                     |
| pre-PR / pre-big-commit            | **`npm run test:full`**                          | + a live create→setup→link→boot pass if the change touches that path |

Run the cheapest tier that actually exercises the change; batch plumbing changes
behind one e2e run. But never skip the **dual** (CLI+GUI) verification for
UI-shaped work just because the CLI side is green.

## Running unit/package tests: use MJ's OWN tooling (mjdev does not wrap it)

mjdev intentionally does **not** ship its own `test`/`app test` commands. Running
MJ's or an app's package tests is already a solved, first-class capability — you
(and agents) run it directly. Wrapping it would duplicate functionality, confuse
agents with a redundant surface, add maintenance, and create a brittle hard
dependency that breaks the moment MJ moves the command. A doc pointer is a **soft
dependency**: same benefit, and if the command changes we update this line, not code.

- **MJ core + every dev-linked app, in one shot:** from the instance worktree
  (`~/MJDev/instances/<slug>/mj`) run `npm test` (≡ `turbo run test`). The worktree's
  `workspaces` glob ends with `packages/dev-apps/*/packages/*`, so dev-linked apps'
  sub-packages are real workspace members — the worktree's test run **already spans
  them**. Scope it with `turbo run test --filter=<pkg>` (the full MJ suite is ~50
  packages). This (`npm test` / `turbo run test`) is the **canonical package/unit-test
  runner** — use it to validate code changes.
- **Not the same thing — `mj test`:** the `mj` CLI's `test` topic is the **MemberJunction
  Testing Framework** (DB-backed, metadata-defined tests: `mj test run`/`suite`/`list`/
  `compare`/`history`/`validate`/regression). It is **not** a wrapper for `turbo run test`
  and does **not** run package/unit tests. Don't reach for it to validate code — use
  `turbo run test`. (Use `mj test` only when you specifically mean the Testing Framework.)
- **A single app:** run its own `npm test` in `packages/dev-apps/<app>`.
- **Why this is the win:** the value mjdev adds is the _integrated instance_ — the
  guaranteed-correct MJAPI version and full package set you cannot get from a
  standalone open-app repo. Running tests _there_ exercises the real contract; you do
  it with the tools that already exist, not a mjdev clone of them.

> **Known gap (open-app side, not mjdev):** open apps currently ship **stub** test
> scripts (`echo "No tests configured yet"`), so a test run over them passes
> vacuously. This is an open-app-source gap — the fix is the app teams authoring real
> suites, not a mjdev workaround. Don't read a green stub run as real coverage.

## How GUI testing works here

Headless Electron via Playwright (`withForge()` in `tests/helpers/electron-app.ts`),
system Chrome, no Docker for the seeded tiers:

- **Seeded specs** — write fake `instances.json` / `openapps.json` into an isolated
  `MJDEV_CONFIG_DIR` so the panel renders deterministically; assert known flows +
  guards (setup-built gate, button presence/disabled-state, mode-switch confirm,
  dependency popup, etc.).
- **Exploratory control-walk** — drive _every_ control in the Instances + Open-Apps
  panels and **fail on any captured `console.error` / `pageerror`** (this capture is
  wired into `withForge`, so silent UI errors become test failures). This is what
  catches _new_ bugs.
- **Visual snapshots** — `toHaveScreenshot` baselines of key card states (empty,
  dev-linked, installed, recents-datalist open, warning, modals) to catch CSS/layout
  regressions functional tests miss.
- **Live-instance e2e** (heavyweight, on demand) — real create→setup→link→boot
  against the isolated dev workspace; for proving end-to-end behavior.

> **Status:** the `console.error`/`pageerror` capture (the keystone) and seeded specs
> are live now. The full **exploratory control-walk** and **visual baselines** are
> **deferred until after the planned GUI refactor** — they're tightly coupled to the
> panel DOM, so they'll be authored once, against the refactored structure with stable
> `data-testid` hooks, rather than written twice. The capture harness stays active
> through the refactor to catch regressions as the DOM moves.

## The full validation cycle (run before handing back)

```sh
npm run build            # affected packages
npm test                 # unit
npm run test:e2e         # seeded + exploratory + visual GUI specs
# if engine/live behavior changed:
npm run test:integration # or a real mjdev create->setup->...->delete in ~/MJDev-dev
npm run test:full        # pre-PR full sweep
```

Then **state what you ran** and the result. If a step was skipped, say so and why.

## What to tell the user up front

When asked to build something, reply with the plan _and_ the test matrix you'll
run (which tiers, which CLI checks, which GUI presence+behavior assertions). The
user should see the whole validation story before you write code — that is how
this tool makes the user, not just the agent, more powerful.
