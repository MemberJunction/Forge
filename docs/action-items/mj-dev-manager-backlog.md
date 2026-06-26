# MJ Dev Manager — Backlog

Durable, shared backlog for the `mjdev` / MJ Forge "Instances" subsystem. **Any agent
picking up this work reads this first** (alongside `docs/mj-dev-manager.md` for the big
design, `docs/mj-dev-manager-decisions.md` for ADRs, `docs/mj-dev-setup-loop.md` for the
in-depth setup/build loop + diagram + signal reference, and `docs/mj-dev-flagged-items.md`
for deliberately-deferred verifications + known unrelated test failures). It's committed so
it survives across sessions and checkouts.

**Keep it current** (per the standing doc-upkeep rule in `CLAUDE.md`): when you finish an
item move it to "Recently shipped" with the commit; when you discover work, add it under
the right heading with enough context to act on cold (what / where / why). The in-session
Task tool is the live tracker; this file is the persistent source of truth — IDs below
map to those tasks where they exist.

_Last updated: 2026-06-25 (sync-convention setup-loop rewire; ADR-009; TE-1 removed)._

> ⏳ **Temporal exceptions live in the agent docs** (`packages/orchestrator/docs/agent/TEMPORAL-EXCEPTIONS.md`,
> synced to `~/MJDev/.mjdev-docs/`). **None active.** The former **TE-1** (full `mj sync push` breaks
> on the `next` connector-retirement deletes) was **removed 2026-06-25** — ADR-009's setup loop runs
> sync with `--format=json` and escalates loudly on failure instead of a manual ask-first gate. The
> underlying upstream divergence is still tracked under "Upstream hand-offs".

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

### #62 — Managed `mj sync push` exclude-list (DEFERRED 2026-06-25, ADR-009)

- **What:** a human-validated, agent-suggested list of `metadata/` dirs/entities to exclude from
  `mj sync push` (`--exclude=…`), with dry-run capture → agent-proposes-candidate → human-approves.
- **Why deferred:** ADR-009 adopts the team convention that **sync is clean by guarantee** (codegen
  changes are committed into migrations). The setup loop assumes success and reacts to failure with a
  one-shot codegen repair + loud escalation — no exclude apparatus needed. Building a managed
  exclude-list is unstable architecture that legitimizes a broken convention.
- **Revive only if:** the sync-always-clean convention proves unenforceable in practice (recurring
  non-registration sync failures that the one-shot codegen repair can't fix and that aren't real
  upstream bugs). Until then, keep documented and in mind; do not build.

### Deletions-response planning (DEFERRED 2026-06-25, ADR-009)

- **What:** a deletion-audit/threshold/approval system for `mj sync push` (it auto-approves deletes
  in `--format=json`/non-interactive mode).
- **Why deferred:** deletions are normal declarative reconciliation; a constraint-violating delete
  fails the (transactional) push and rolls back → lands on escalation. Accepted risk per the user.
- **Revive only if:** an unintended _successful_ destructive delete actually bites in practice.

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

These surfaced during the metadata/codegen investigation (see ADR-009 (supersedes ADR-007) + `~/MJDev/MJDEV-ISSUES.md`):

- **Integration metadata ↔ migration PK divergence:** the same records (e.g. iMIS
  `GLAccount`) have different primary keys in the baseline migration (`949501CF…`) vs the
  `metadata/integrations` files (`6b528e9b…`) → `mj sync push --dir=metadata` can't complete
  (`UQ_IntegrationObject_Name` violation). Upstream data-consistency bug.
- **Connector retirement not captured in a migration:** the `.old-*-seed.deletes.json`
  retirement is metadata-only, so a fresh DB shows pending deletes forever — and those delete
  calls are what break `mj sync push` today (the former TE-1; now handled by ADR-009's loud
  escalation, not a manual ask-first gate).
- **Codegen-clobber convention — NOT ours to police (team-confirmed 2026-06-24).** The team's
  accepted expectation is: developers **commit their generated code** and `mj sync push` works.
  Under ADR-009 mjdev now **surfaces** drift (the setup loop's git-diff tripwire warns when codegen
  changes generated files — non-blocking) but still does **not auto-fix** it. The durable catch
  remains an **MJ-core CI** check (codegen against a fresh migrated+seeded DB, fail on generated-file
  drift). _(Dropped: the earlier "dry-run may mutate" concern — the user is confident the 589-row
  delete was a separate manual delete around that time, not the dry-run; and we don't run dry-run
  anyway, so it's moot/MJ-core's.)_

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
  developer specifically wants it (standing instruction). (The create dialog's default base ref is
  now permanently `next` — `InstancesPanelComponent.DEFAULT_BASE_REF` — not a temp hack to strip.)
- **Throwaways:** `synctest` deleted 2026-06-24; the Madhav PR throwaways
  (`madhav-validate`/`madhav-install`) are already gone. `mjdev-dev-test` is the kept reusable dev
  instance. The user may spin up a fresh throwaway later to revalidate Madhav's branch once more.

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
