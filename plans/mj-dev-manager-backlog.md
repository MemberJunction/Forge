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

_Last updated: 2026-06-24 (backlog triage with the user; setup-step rework `87d730b` merged to prod)._

> ⏳ **Temporal exceptions live in the agent docs** (`packages/orchestrator/docs/agent/TEMPORAL-EXCEPTIONS.md`,
> synced to `~/MJDev/.mjdev-docs/`). Currently **TE-1**: a full `mj sync push` breaks on the
> `next` connector-retirement deletes — agents must ask the user before running sync. Remove it
> when `next` is fixed (see "Upstream hand-offs").

---

## Active — pick these up next

### #59 — Open-app version mismatches: alert, don't force-fix (user-decided 2026-06-24)

- **Policy (locked):** a version mismatch is **the user's call** — we don't auto-fix. We only
  **alert**: if a mismatch would actually **stop things working / break a build or a test**,
  surface it **visually in the GUI and on the CLI during install**. When it's harmless, just
  inform and leave the decision to the user. No forced gating.
- **So the work is:** detect-and-surface mismatches clearly (GUI + CLI) at install/link time, and
  make `--ignore-version-range`'s effect visible instead of silent. **Deprioritized** unless it
  starts causing real failures.
- **Where:** `packages/orchestrator` install/link path; engine `InstallApp`
  (`OpenApp/Engine/src/install/install-orchestrator.ts` hard-gates `CheckMJVersionCompatibility`)
  — a true install-side override needs upstream engine support, so that part stays upstream.

### #55 — Malformed / orphan instance surfacing

- **What:** detect untracked instance folders (e.g. an orphaned `is-a-record-creation` dir
  with no `instances.json` record) and show a **flagged, read-only** entry in the GUI/CLI.
- **Scope guard (confirmed 2026-06-24):** display only — a read-only entry that just indicates
  it's there. **No adoption, no auto-repair.** Expected to slot into the planned visual updates.
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

### Instructing sub-agents / orchestrator-worker structure (discussion — decided to defer 2026-06-25)

- **What:** whether (and how) to formally instruct sub-agents about their role/scope. We **removed**
  the "orchestrator or worker?" startup question for now — it didn't change behavior (same features),
  and labeling an agent a "worker" risks it under-investing (see the 1d discussion).
- **To revisit:** if we want a sub-agent structure, frame it as **scope + how-to-report-up** (which
  instance, what task, surface blockers via MJDEV-ISSUES/REQUESTS), **never as rank**. First nail
  down how sub-agents receive context (tool-spawned = prompt only; directory-launched = read AGENTS.md).
- **Status:** parked; no change shipped beyond removing the startup question.

---

## Release & onboarding (the overarching goal — get colleagues using it)

- **CLI shipping in the packaged app** — today prod is a checkout; `bin/mjdev` launcher is
  written into `~/MJDev`. Packaging the CLI is a noted follow-up (Phase-1 deferral).
- **Onboarding doc / first-run flow** for a new developer or agent swarm.
- **Performance walkthrough** — `create` + `setup all` is minutes; matters for the
  orchestrator pre-provision/recycle (golden-instance) story.

  > ✅ **Already done** (do NOT re-list): the managed `~/MJDev/AGENTS.md` region + thin
  > only-if-absent `~/MJDev/CLAUDE.md` shipped in Phase 1 (`AgentDocs.syncAgentDocs`). Both
  > files exist; verified 2026-06-24.

---

## Upstream hand-offs (MJ-core, NOT mjdev — track, don't fix here)

These surfaced during the metadata/codegen investigation (see ADR-007 + `~/MJDev/MJDEV-ISSUES.md`):

- **Integration metadata ↔ migration PK divergence:** the same records (e.g. iMIS
  `GLAccount`) have different primary keys in the baseline migration (`949501CF…`) vs the
  `metadata/integrations` files (`6b528e9b…`) → `mj sync push --dir=metadata` can't complete
  (`UQ_IntegrationObject_Name` violation). Upstream data-consistency bug.
- **Connector retirement not captured in a migration:** the `.old-*-seed.deletes.json`
  retirement is metadata-only, so a fresh DB shows pending deletes forever — and those delete
  calls are what break `mj sync push` today (the basis for TEMPORAL-EXCEPTIONS.md TE-1).
- **Codegen-clobber convention — NOT ours to police (team-confirmed 2026-06-24).** The team's
  accepted expectation is: developers **commit their generated code** and `mj sync push` works.
  We don't manage this tightly. The durable catch (if any) is an **MJ-core CI** check (codegen
  against a fresh migrated+seeded DB, fail on generated-file drift). mjdev does not compensate
  (ADR-007). _(Dropped: the earlier "dry-run may mutate" concern — the user is confident the
  589-row delete was a separate manual delete around that time, not the dry-run; and we don't
  run dry-run anyway, so it's moot/MJ-core's.)_

---

## Housekeeping & standing constraints

- **Keep the welcome greeting current with how the dev tools are exposed.** When the CLI/GUI entry
  points or the headline feature list change, update `docs/agent/WELCOME.md` (the user's first
  impression — it describes running the GUI via `npm run dev` and the CLI via `./bin/mjdev`).
- **Merging = dev branch (`MT-mjdev-active-development`) → the LOCAL prod branch
  (`MT-forge-mjdev-tools`), NOT Forge upstream.** As of 2026-06-24, `87d730b` + `d947075` are
  already merged to local prod; only the backlog-doc commit `6ee9d15` was pending. The user does
  the merge (local `git merge`); I never push.
- **No PRs / not going into Forge upstream** — this work only lands in Forge upstream if the Forge
  developer specifically wants it (standing instruction). Before any such PR: remove
  `TEMP_DEFAULT_BASE_REF` (`fix-notifier-injection-bug`) from the create dialog.
- **Throwaways:** `synctest` deleted 2026-06-24; the Madhav PR throwaways
  (`madhav-validate`/`madhav-install`) are already gone. `mjdev-dev-test` is the kept reusable dev
  instance. The user may spin up a fresh throwaway later to revalidate Madhav's branch once more.
- **Nice-to-have (secondary to TE-1, low priority):** a GUI text box to mark metadata
  directories to exclude from `mj sync push`, auto-pre-selecting the integration-deletion ones.
  The temporal exception (ask-the-user) is the preferred lighter solution for now.

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
