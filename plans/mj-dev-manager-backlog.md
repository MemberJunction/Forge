# MJ Dev Manager — Backlog

Durable, shared backlog for the `mjdev` / MJ Forge "Instances" subsystem. **Any agent
picking up this work reads this first** (alongside `plans/mj-dev-manager.md` for the big
design and `plans/mj-dev-manager-decisions.md` for ADRs). It's committed so it survives
across sessions and checkouts.

**Keep it current** (per the standing doc-upkeep rule in `CLAUDE.md`): when you finish an
item move it to "Recently shipped" with the commit; when you discover work, add it under
the right heading with enough context to act on cold (what / where / why). The in-session
Task tool is the live tracker; this file is the persistent source of truth — IDs below
map to those tasks where they exist.

_Last updated: 2026-06-24 (after the setup-step rework, commit `87d730b`)._

---

## Active — pick these up next

### #59 — Handle open-app version mismatches better

- **What:** `mjdev app install` can't relax the manifest version range or npm peer-deps,
  and `app link`'s `--ignore-version-range` is a near-silent ignore that can surprise users.
- **Where:** `packages/orchestrator` install path; engine `InstallApp` in the worktree
  (`OpenApp/Engine/src/install/install-orchestrator.ts` hard-gates `CheckMJVersionCompatibility`).
- **Why it's not trivial:** the real fix needs an **upstream** engine `IgnoreVersionRange`
  option on `InstallApp` (a Forge-side flag would be a no-op) + an npm peer-deps passthrough
  (`--legacy-peer-deps`/`--force`). Surface the mismatch loudly instead of silently ignoring.
- **Status:** scoped; blocked on upstream engine support for the install path. Worth doing
  the "surface it loudly" Forge-side part independently.

### #55 — Malformed / orphan instance surfacing

- **What:** detect untracked instance folders (e.g. an orphaned `is-a-record-creation` dir
  with no `instances.json` record) and show a **flagged, read-only** entry in the GUI/CLI.
- **Scope guard:** display only — **no adoption**, no auto-repair. Just stop them being invisible.
- **Where:** `InstanceStore` / `InstanceOrchestrator.list` (reconcile filesystem vs records) +
  renderer instances list.
- **Status:** pending, unstarted.

---

## Parked / blocked

### #43 — Exploratory GUI walk + visual baselines

- **What:** Phase-2 exploratory control-walk + `toHaveScreenshot` visual baselines for the
  Instances / Open-Apps panels (the 28-item control inventory in `DEV-LOOPS.md`).
- **Blocked on:** the **GUI refactor** (below) — baselines would just churn until then.

### GUI refactor (not yet a task)

- **What:** the larger Instances/Open-Apps panel refactor. Gates #43.
- **Status:** discussion-only; no design doc yet.

---

## Release & onboarding (the overarching goal — get colleagues using it)

- **CLI shipping in the packaged app** — today prod is a checkout; `bin/mjdev` launcher is
  written into `~/MJDev`. Packaging the CLI is a noted follow-up (Phase-1 deferral).
- **Managed `~/MJDev/CLAUDE.md` section** — auto-create thin `CLAUDE.md` importing the
  managed block (parallels the `AGENTS.md` managed-region pattern). Partially designed in M4.
- **Onboarding doc / first-run flow** for a new developer or agent swarm.
- **Performance walkthrough** — `create` + `setup all` is minutes; matters for the
  orchestrator pre-provision/recycle (golden-instance) story.

---

## Upstream hand-offs (MJ-core, NOT mjdev — track, don't fix here)

These surfaced during the metadata/codegen investigation (see ADR-007 + `~/MJDev/MJDEV-ISSUES.md`):

- **Integration metadata ↔ migration PK divergence:** the same records (e.g. iMIS
  `GLAccount`) have different primary keys in the baseline migration (`949501CF…`) vs the
  `metadata/integrations` files (`6b528e9b…`) → `mj sync push --dir=metadata` can't complete
  (`UQ_IntegrationObject_Name` violation). Upstream data-consistency bug.
- **Connector retirement not captured in a migration:** the `.old-*-seed.deletes.json`
  retirement is metadata-only, so a fresh DB shows pending deletes forever.
- **`mj sync push --dry-run` may not be read-only on deletes:** the dry-run summary reported
  `Deleted 589` + "✓ Successfully deleted 589 records" outside a `[DRY RUN]` marker — possible
  footgun (a dry run shouldn't mutate). **Unverified** — confirm against a throwaway DB then
  flag to MJ-core if real.
- **Codegen-clobber convention:** metadata changes must ship their `*_Metadata_Sync` migration;
  the durable catch is an **MJ-core CI** check (run codegen against a fresh migrated+seeded DB,
  fail on committed-generated-file drift). mjdev deliberately does not compensate (ADR-007).

---

## Housekeeping & standing constraints

- **Merge the dev-commit stack to prod** when convenient — commits beyond the last prod pull
  include `87d730b` (setup rework) and `d947075` (app-install summary) plus earlier fixes.
- **Remove `TEMP_DEFAULT_BASE_REF`** (`fix-notifier-injection-bug`) from the create dialog
  **before any Forge PR**.
- **No PRs yet** (standing user instruction).
- **Never `git push`** — the user pushes/merges to prod via local `git merge`.
- **Madhav PR throwaways** (`madhav-validate` / `madhav-install` in `~/.mjdev-dev`) — tear down
  when that PR merges.
- **`synctest`** throwaway in `~/MJDev-dev` — delete (`mjdev delete synctest`) when the
  metadata-sync investigation is fully done.

---

## Recently shipped (for context; trim periodically)

- **Setup-step rework** (`87d730b`, 2026-06-24): `setup all` = `deps → build → migrate`;
  codegen on-demand (CLI + confirm-gated GUI "Advanced" card); `mj sync push` documented-manual;
  ADR-007. Reverted a brief auto-`sync` experiment after proving sync push is a destructive
  reconcile that can't complete on current bases.
- **app-install Summary surfacing** (`d947075`): echo engine `Summary` + `warn` when an app
  installs but is left Disabled.
- **Shared SQL Server consolidation** (CC1–CC6): one container per workspace prefix, one DB
  per instance; dev/prod isolation preserved; prod converted live; auto-registered Forge
  connection.
- **Open-app link fixes:** client-bootstrap refactor tracking (`b99d2c0`/`0feca29`),
  link-saga rollback + fail-fast version gate (`b5405c3`/`dcdbabb`), `app link` flag docs.
