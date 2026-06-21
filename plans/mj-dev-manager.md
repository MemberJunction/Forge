# MJ Dev Manager — Subsystem Guide, Conventions & Progress

> **Read this before working on MJ Dev Manager, the `packages/orchestrator` engine, the `mjdev` CLI, or open-app dev-linking.** It captures the load-bearing design decisions, the conventions a future contributor (human or AI) must preserve, the current build status, and the validation strategy. It is a _living_ doc — update the status table and append to the changelog as work lands.

_Last updated: 2026-06-21 · current work branch: `MT-forge-mjdev-tools`_

---

## What this subsystem is

MJ Dev Manager is a developer tool **inside the Forge Electron app** (this repo) that spins up isolated local MemberJunction (MJ) dev instances — each with its own Docker SQL Server, git worktree, and generated config/ports — so a developer (or a swarm of agents) can develop and test features/branches concurrently without collisions.

All orchestration logic lives in **one shared, pure-Node engine** (`packages/orchestrator`, `@mj-forge/orchestrator`, zero Electron imports) consumed by **both** surfaces:

- the **GUI** (renderer → preload → `packages/main` IPC handlers), and
- the **`mjdev` CLI** (`packages/cli`), for headless/agent use.

The full design lives in `~/.claude/plans/we-re-forking-memberjunction-forge-to-lovely-avalanche.md` (MVP + Phase 2 identity + Milestone 3 restructure + Phase B open-app dev-linking). This file is the in-repo distillation of the parts a future session most needs.

### The nested-repo map (don't get these confused)

- **This repo (Forge)** — `/Users/marcelotorres/projects/MJ` working dir; the MJ Dev Manager _tool_ lives here. All our code + tracked changes go here.
- **The MJ repo** — `/Users/marcelotorres/projects/MJ/MJ`. We **never edit it**. Instances are git worktrees off a managed central clone of it.
- **Open-app repos** (e.g. `mj-sample-open-app`, `bizapps-accounting`) — dev-linked _into_ an instance's MJ worktree.

---

## Phase B — Open-App Dev-Linking (the current milestone)

**Goal:** let a developer point an instance at _local_ Open-App source and have it run inside the instance **exactly as a real `mj app install` would** — same schema, migrations, class-registration config, and `MJ: Open Apps` record — the only deltas being (a) where the bytes resolve from and (b) an optional version-range override. Dev mode is a **resolution override layered on the install path, not a fork.**

### The keystone — three files carry the whole design

1. **`engineEntrySource.ts`** — a generated `.mjs` written into the instance worktree under a git-hidden `.mjdev/` dir and run with the instance's _own_ Node. Its bare imports resolve to the **worktree's own built** `@memberjunction/open-app-engine` + `@memberjunction/sqlserver-dataprovider` — never a Forge-pinned copy. It boots the MJ provider (mirroring MJCLI's `open-app-context`) and dispatches ordered **steps** to the engine's granular handlers. _This is why dev-link can't drift from install behavior across MJ versions._
2. **`WorktreeEngineRunner.ts`** — the Forge→worktree bridge. Writes the entry + a JSON job spec, spawns it, and parses a sentinel-prefixed NDJSON stream (`@@MJDEV-ENGINE@@`) back into `EventSink` progress + a captured result. Entry source is injectable so the spawn/parse protocol is unit-tested DB-free.
3. **`OpenAppManager.ts`** — reproduces the install **shell** (step ordering) and delegates each step to the engine. The **only** reproduced engine internals are the two genuinely non-exported ones: `entityPackageName` mapping (`entityPackageMapping.ts`, golden-tested) and `RemoveAppEntityMetadata` (ported into the entry for reset/teardown). Everything else is the engine's own exported code.

---

## Conventions & patterns — LOAD-BEARING, preserve in review and future work

1. **Reproduce the shell, delegate the steps.** When MJ's engine adds/changes an install step, add/adjust a _step name_ in the entry script that calls the exported handler. Only reproduce a handler if it's truly not exported — and then golden-test it against a real install. _Upstream opportunity: an exported "install-from-local-path" + exported `AddEntityPackageMapping`/`RemoveEntityPackageMapping` would let us delete both reproductions._
2. **Option Y — nested real worktree at the member path.** The dev-linked app is a real `git worktree` at `packages/dev-apps/<app>`, made a workspace member via the **deep** glob `packages/dev-apps/*/packages/*` (open apps are their own workspaces). A symlink fails dedup; a shallow glob hits the registry (E404). Empirically locked — don't "simplify" it.
3. **The single-copy invariant is sacred.** Exactly one resolved `@memberjunction/core`/`global`, shared by MJAPI + the app member, **no nested copy**. Asserted pre/post install. A second copy = split `BaseSingleton`/ClassFactory = _silent_ failure. Any change to resolution must re-assert this.
4. **Mutations stay in the disposable worktree; secrets stay hidden.** All tracked churn lands in the per-instance MJ worktree (the sanctioned location `ConfigWriter` already uses). Nested app worktrees + the `.mjdev/` scratch are hidden via the git **common** dir's `info/exclude` (NOT `.gitignore` — that'd be an MJ-repo edit). Magic-link keys / ports / persona mapping live in `~/.mjdev`, outside the shareable worktree, so an agent can't repoint them.
5. **Per-instance app worktrees (the swarm requirement).** Each instance gets its own app working copy on its own branch off one shared clone — so instances can develop the _same_ app on different branches in parallel and merge back (shared object store). Never one shared checkout symlinked everywhere.
6. **One façade, three surfaces.** `InstanceOrchestrator` is the single API; GUI (IPC) and CLI both call it, never the managers directly. New capability = façade method → CLI command + IPC channel + preload entry. Build the DB config from the instance record + codegen secrets _inside_ the façade.
7. **Drift is detected, not assumed.** Skyway silently _skips_ an edited applied migration (`Migrate()` returns success, 0 applied) — so we call `Validate()` to catch checksum drift loudly. `resetAppSchema` (Clean + metadata cleanup + Migrate) is the fix for an edited _versioned_ migration; `repairAppSchema` does NOT re-run SQL and the UI must say so.

---

## Status by slice (Phase B)

Commits below are on `MT-forge-mjdev-tools` (Forge). Nothing is pushed — the user pushes explicitly.

| Slice | What                                                                                                         | Status       | Proof                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------- |
| 0     | Resolution spine — single-copy workspace member (Option Y nested worktree)                                   | ✅ done      | single-copy invariant + git-clean (earlier session)                       |
| 1     | DB spine — schema + local migrations via worktree engine                                                     | ✅ done      | live: schema created, 2 migrations, `flyway_schema_history` in app schema |
| 2     | Full mutation set + parity oracle                                                                            | ✅ done      | live: `MJ: Open Apps` Active, all artifacts + snapshot; 7 golden tests    |
| 3     | Unlink reversal + pure dev⇄installed switch                                                                  | ✅ done      | live: round-trip **zero drift** (snapshot A === B)                        |
| 4     | Recovery + version override (drift detect, reset, repair)                                                    | ✅ done      | live: version gate/override; drift caught exact checksum; reset recovered |
| 6     | Mandatory build + live-edit watch targets                                                                    | ✅ done      | live: built app sub-package `dist`; watch command emitted                 |
| 8a    | `linkApp` + `InstanceOrchestrator` façade + `mjdev app` CLI                                                  | ✅ done      | live: CLI list/drift/reset-schema/build against real instance             |
| 8b    | OPEN_APPS IPC channels + preload bridge                                                                      | ✅ done      | typechecks; renderer reaches engine over IPC                              |
| 8c    | Renderer "Open Apps" card                                                                                    | ✅ done      | renderer builds clean                                                     |
| —     | MJAPI boot integrity with a dev-link present                                                                 | ✅ done      | live: "Server ready at :4020", no `MODULE_NOT_FOUND`                      |
| 5     | Validate-as-install tiers — Light (pack+`file:`+oracle) & Full (Verdaccio + real `InstallApp` + golden file) | ⬜ remaining | needs throwaway instance + Verdaccio (heavy)                              |
| 7     | `bizapps-accounting` multi-package link + boot + runtime `@RegisterClass` registration                       | ⬜ remaining | sample app is degenerate (is-odd); needs the real app                     |
| B-val | Full GUI Playwright e2e + edit→see-it-live acceptance                                                        | ⬜ remaining | needs running stack + real app                                            |

**Commit map:** `3df3fb1` (1) · `f8036e7` (2) · `07f3271` (3) · `321ba20` (4) · `0b7fbfb` (8a) · `af78322` (8b) · `b3cd961` (6) · `9123b68` (8c). Slice 0 + Phase A foundations: `e88d564`, `2cef756`, `99f5a99`.

### Remaining work — flagged, NOT shipped unproven

Per the standing "tell me if you can't fully validate" rule, these three need a live run that hinges on a real multi-package app + long-running infra:

- **Slice 7 — `bizapps-accounting` acceptance.** The real proof of runtime `@RegisterClass` registration from local source (the sample app declares `is-odd`, has no MJ classes). This is the edit→save→see-it-live loop. Code path is complete; needs the real app linked/built/booted/introspected. **Best done with the user — it's their app.**
- **Slice 5 — validate-as-install tiers.** Light (pack + `file:` + oracle + single-copy) and Full (throwaway Verdaccio + real `InstallApp` + checked-in golden file). The oracle snapshot it diffs against already exists and is tested; the tier runners + Verdaccio harness remain.
- **B-validate — GUI end-to-end.** The renderer card builds and is wired; driving it through Playwright (the `withForge` harness) to assert strip states + verdicts is the last track.

---

## Validation strategy (the convention going forward)

Runtime (live) validation is **wall-clock + context heavy**; unit tests + typecheck + build are cheap. The goal is to spend the expensive loop _only_ where it buys signal the cheap loop can't. Tiers:

- **Every slice / commit — always:** unit tests + typecheck + build across affected packages. No exceptions.
- **Live run — only when a slice introduces new _runtime semantics_ the cheap loop can't fake:** DB/migration/schema behavior, package resolution / single-copy, process boot. **Batch consecutive _plumbing_ slices** (IPC/preload/renderer wiring) behind one live run at the end of the batch rather than booting per slice.
- **One capstone integration proof per milestone** (MJAPI boot, then GUI e2e), at the end — not per slice.
- **Heavy "validate-as-install" (Verdaccio/Full tier):** on demand before a PR — never per commit.

### The "golden instance" idea (planned, not yet built)

The dominant cost in a live run is the one-time `mjdev create` + `mjdev setup all` (install + full worktree build). A **pre-built, long-lived golden instance** collapses every live run from "create + install + build + link + boot" down to just "link + boot + assert."

Two-tier, by design:

- **Golden-stable instance** — pinned to a **stable MJ release** (most-validated code, reproducible baseline). Default target for regression on most slices. Refresh/rebuild when the pinned release bumps.
- **Throwaway current/target-branch instance** — created on demand _only_ for parity-against-HEAD cases (e.g. the `ignoreVersionRange` / cross-version path), which a stable golden instance cannot prove.

Companion need: a **small-but-real fixture app** (one registered entity + one `@RegisterClass` class). `mj-sample-open-app` is great for plumbing but degenerate for the most important proof (class registration / `entityPackageName`), which is why slice 7's real proof is gated on `bizapps-accounting`.

---

## Self-validation protocol (standing convention, Phase B onward)

No change set is returned to the user until it's self-validated through the tool's own surfaces — **both CLI and GUI tracks** (full detail in the plan's "Self-validation protocol" section). If any step can't be driven headlessly, **stop and flag it** rather than hand back unvalidated work. Before hand-back: orchestrator unit/integration suites green; typecheck/build across `orchestrator`/`main`/`preload`/`renderer`/`cli`; `npm run test:full` green (except the known out-of-scope postgres backup/restore).

---

## Process notes / friction log (for improving autonomous runs)

- **Runtime validation is the autonomy bottleneck** — not the tooling. The fix is _cheaper_ live runs (golden instance), not _fewer_.
- **Fixture ceiling:** the most important proof (class registration) was gated on a non-degenerate app. Need a small-but-real fixture.
- **Non-exported engine internals:** two handlers forced verbatim ports + golden tests + a drift risk. The upstream export PR removes this.
- **Milestone size vs one context window:** ~10 slices × (implement + live-validate + test + commit) exceeds one window; the heaviest validation naturally lands last. Splitting "engine spine" and "live acceptance + validate tiers" into two explicit runs is cleaner. Per-slice commits made this safe (durable, bisectable).
- **What worked:** per-slice commits, background subagents (the renderer card built in parallel), driving the real CLI/engine for live proof.

## Standing cleanup obligations

- Remove `TEMP_DEFAULT_BASE_REF` (`fix-notifier-injection-bug`) from the create dialog before any Forge PR.
- The §14 tripwire in MJ `metadata/CLAUDE.md` is pre-existing/provisional (NOT from this work) — pending the user's review.
- Disposable test instance `openapp-dev` may still exist (`mjdev delete openapp-dev`).

---

## Changelog

- **2026-06-21** — Phase B engine spine: slices 0–4, 6, 8a–8c done & live-validated; MJAPI boots clean with a dev-link. Slices 5, 7, B-validate flagged remaining (need real app + heavy infra). Doc created.
