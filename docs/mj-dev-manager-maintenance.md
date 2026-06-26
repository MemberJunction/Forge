# MJ Dev Manager — Maintenance & Parity-Compliance

> **Purpose.** Dev-link reproduces a _slice_ of MJ's open-app install behavior (the engine internals that aren't exported, plus the install step ordering). As MJ and the supported open apps evolve, those reproductions can **silently drift** from the engine's real behavior — breaking the production-parity guarantee that makes this tool trustworthy. This doc enumerates exactly what must stay in sync, how it's verified, and the upgrade procedure. It is written to be **automatable** (the checks below should become CI per MJ-version × supported-app). Pairs with [`mj-dev-manager.md`](mj-dev-manager.md).

_Aligned MJ version: **5.40.2** (the central clone's current). Update this when MJ bumps._

---

## The invariant we maintain

A **dev-link** and a real **`mj app install`** of the _same app at the same MJ version_ must produce an **identical install footprint**:

- `mj.config.cjs` — `dynamicPackages.server` entries **and** the `entityPackageName` mapping
- `MJExplorer/angular.json` — prebundle `exclude` patterns
- the generated client bootstrap (`open-app-bootstrap.generated.ts`)
- `MJAPI` / `MJExplorer` `package.json` app-dep entries (**by value AND key order**)
- the `MJ: Open Apps` row + dependency rows
- the per-app schema + Skyway migration history

`OpenAppManager.captureParitySnapshot()` is the machine-checkable expression of this invariant — it's the oracle every compliance check diffs against.

---

## Reproduced surface — the maintenance burden

Everything dev-link does is delegated to the worktree's **own exported** engine handlers **except** the items below. These are the only things that can drift; they are the watch-list.

| #   | What we reproduce                                      | Mirrors (MJ engine source)                                                            | Our copy                                                       | Verified by                          | Re-check when…                                       |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| 1   | Install **step ordering** (the shell)                  | `packages/OpenApp/Engine/src/install/install-orchestrator.ts` (`InstallApp` sequence) | `engineEntrySource.ts` `runStep` + `OpenAppManager` step lists | parity oracle + live boot            | MJ adds / reorders / renames an install step         |
| 2   | `entityPackageName` mapping                            | `packages/OpenApp/Engine/src/.../config-manager.ts` (**not exported**)                | `entityPackageMapping.ts`                                      | golden test vs real `mj app install` | MJ changes the `entityPackageName` section format    |
| 3   | `RemoveAppEntityMetadata` (FK-ordered metadata delete) | `install-orchestrator.ts` (**not exported**)                                          | `cleanAppMetadata` in `engineEntrySource.ts`                   | live reset → re-migrate              | MJ changes the metadata entities or FK delete order  |
| 4   | Provider boot / system context user                    | `packages/MJCLI/src/utils/open-app-context.ts`                                        | `engineEntrySource.ts` `main()`                                | boots as MJ `x.y.z`                  | MJ changes provider setup or context-user resolution |

**Everything else** (`AddServerDynamicPackages`, `AngularConfigManager`, `RegenerateClientBootstrap`, `RunAppMigrations`, `AddAppPackages`/`RunPackageInstall`, `CheckMJVersionCompatibility`, `InstallApp` for the install path, the `history-recorder` family) uses the engine's **exported** handlers — those stay identical _for free_ because we call the engine, not a copy.

> **Upstream opportunity (retires #2 + #3):** if MJ exports `AddEntityPackageMapping`/`RemoveEntityPackageMapping` and `RemoveAppEntityMetadata`, delete our reproductions and call the engine. File the export PR; track it here.

---

## Topology invariant (decided 2026-06-21)

An instance is **pure**: either **all apps dev-linked** (an app **and its open-app dependency closure**) or **all installed**. **Never mix.** A dev-linked workspace member depending on an _installed_ (registry) app crashes npm's arborist (`Cannot read properties of null (reading 'matches')` — registry `peerDependencies` resolving onto workspace `@memberjunction/*` symlinks; a known npm bug). Both pure topologies are bug-free (pure dev-link == MJ's own monorepo layout; pure install == published-package layout).

- **Dev-link is primary.** A dev-linked app's open-app dependencies **default to dev-link too** (same-mode closure). Runtime parity (registration / schema / migrations / config / record) is **identical** to install; the only delta — published-artifact registry resolution — is covered by the `validate-as-install` tier, not the everyday flow.
- **Install path is retained** for the **`validate-as-install` tier** (throwaway pure-install instance — its true parity job) and optional future "management" instances. It is **not** used for dependencies of live dev-linked apps.
- **Guard:** warn/refuse when a dev-linked app would depend on an installed app (the mix). Don't "fix" the mix with `--legacy-peer-deps`; avoid it structurally.

MJ-version compatibility is gated by the **manifest `mjVersionRange`** (`CheckMJVersionCompatibility`), enforced on both install and dev-link — this is the authoritative user-facing conflict alert. npm `peerDependencies` on `@memberjunction/*` are a redundant second expression of the same rule and must not be relied on inside the workspace.

---

## Supported apps + version alignment

| App                  | Open-app version | Schema                   | npm packages                                                   | Notes                                                             |
| -------------------- | ---------------- | ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `mj-sample-open-app` | (fixture)        | sample_app               | —                                                              | plumbing + golden fixture (degenerate: no real classes)           |
| `bizapps-common`     | 5.31.1           | `__mj_BizAppsCommon`     | `@mj-biz-apps/common-*` (peerDeps `@memberjunction/* ^5.40.2`) | first-party; reserved `__` schema → needs allow-double-underscore |
| `bizapps-accounting` | 0.1.0            | `__mj_BizAppsAccounting` | `@mj-biz-apps/accounting-*`                                    | `mjVersionRange >=5.38.0 <6.0.0`; depends on `bizapps-common`     |

> **Known app-side issue:** `bizapps-accounting`'s manifest declares `mj-bizapps-common >=1.0.0 <2.0.0` but common is actually `5.31.1`. Harmless to npm (the npm package ranges align at `>=5.30`), but the open-app dependency declaration is stale — fix in the app's manifest.

---

## Compliance check (automatable — the core deliverable)

For each supported app, at each supported MJ version:

1. **Regenerate the golden:** real `mj app install <app>` in a throwaway worktree → `captureParitySnapshot()` → check in as the golden footprint.
2. **Diff dev-link vs golden:** dev-link the same app → `captureParitySnapshot()` → diff. **Any divergence = a reproduction (#1–#4) drifted, or an engine change we must mirror.**

This is exactly the **`validate-as-install` Full tier**. Automation target: a CI matrix `(MJ version × supported app)` that runs both tiers and fails on oracle divergence or a non-zero `ErrorPhase`.

---

## Upgrade checklist — run when MJ bumps version

- [ ] Update the central clone; record the new MJ version at the top of this doc.
- [ ] Diff the **watch-list** engine files (below) for changes affecting reproductions #1–#4.
- [ ] Re-run the **compliance check** (golden regen + oracle diff) for every supported app.
- [ ] Re-run **`validate-as-install`** (Light + Full) per supported app; confirm single-copy + clean boot.
- [ ] Re-test each supported app's `mjVersionRange` against the new MJ version; bump supported-app versions as needed.
- [ ] If MJ now exports a previously-reproduced handler, delete our copy and call the engine.
- [ ] Update the **supported apps + version alignment** table.

### Watch-list (engine files whose changes can silently break parity)

- `packages/OpenApp/Engine/src/install/install-orchestrator.ts` — step ordering, `RemoveAppEntityMetadata`, `InstallApp` signature
- `packages/OpenApp/Engine/src/.../config-manager.ts` — `entityPackageName` format
- exported-handler signatures: `AddServerDynamicPackages`, `AngularConfigManager`, `RegenerateClientBootstrap`, `RunAppMigrations`, `CheckMJVersionCompatibility`, `InstallApp`
- `packages/MJCLI/src/utils/open-app-context.ts` — provider boot / context user

---

## Known boot behaviors (not bugs — don't "fix")

- **First boot mutates `MJAPI/package.json` + nudges `npm install`.** MJAPI's prestart runs `mj codegen manifest`, which scans the dependency tree for `@RegisterClass` and adds any discovered-but-undeclared packages (e.g. an app's `*-core-entities-server`, which `mj-app.json` doesn't list) to `MJAPI/package.json`. This happens identically for a real `mj app install` and for dev-link — boot still works because the app packages are workspace members (resolvable regardless). The parity oracle is unaffected (it compares dev-link vs real-install both pre-boot). Don't pre-empt it in the link flow.
- **`dynamicPackages.server` StartupExport is a no-op in MJ 5.40.2.** Class registration loads via the manifest (`class-registrations-manifest.ts`, imported by `MJAPI/src/index.ts`); the server-extension/StartupExport path has no consumer in 5.40.2 ("Loaded 0 server extensions"). Re-verify per MJ branch (watch-list item #1).

---

## Changelog

- **2026-06-22** — Recorded known boot behaviors (manifest prestart dep-add; StartupExport no-op in 5.40.2) after the live capstone.
- **2026-06-21** — Created. Recorded the pure-topology decision (no mixed install+dev-link), the reproduced-surface watch-list, supported-app alignment, and the automatable compliance check.
