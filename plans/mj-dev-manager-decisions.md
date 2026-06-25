# MJ Dev Manager — Architectural Decision Record

A running log of load-bearing, structural decisions for the MJ Dev Manager subsystem
(`packages/orchestrator`, the `mjdev` CLI, instance + open-app dev-linking) and the
reasoning behind them. **Record a decision here whenever you make a structural or
architectural choice** — especially one that's counterintuitive or that you had to
re-derive from memory. The point is that the _why_ survives in the repo, not just in a
plan file or a chat. See the standing rule in `CLAUDE.md`.

Format: each entry is dated, states the decision, the reasoning, and what it rules out.

---

## ADR-001 — Dev-linked open apps are npm **workspace members** (nested worktrees), not `npm link`/symlinks

**Decision.** A dev-linked open app is materialized as a real git worktree nested
**inside** the instance's MJ worktree at `packages/dev-apps/<app>`, added to the MJ
worktree's `package.json` `workspaces` glob — i.e. a true npm workspace member ("Option
Y"). We do **not** use `npm link`, a global symlink, a symlinked member pointing at an
external directory ("Option X"), or any bidirectional link scheme.

**Why (the load-bearing reason — single-copy singleton).** MJ's class system
(`@RegisterClass` + `BaseSingleton`, keyed on `globalThis`) only works if there is
**exactly one** copy of `@memberjunction/global` (and `core`) loaded in the process. A
second copy splits the `ClassFactory` and registration silently fails — the app's
classes/resolvers register in their own factory while MJAPI reads the host's. npm
collapses the app and host to one copy **only when the app is a workspace member whose
`@memberjunction/*` specs the host versions satisfy** (so npm dedupes to the host copy).

- `npm link` / a symlinked external member resolve to the package's **realpath outside
  the workspace**, so Node can't see the host's `@memberjunction/*` → `MODULE_NOT_FOUND`
  or a nested second copy → split singleton. Empirically proven with a `node` probe
  (Option X fails; Option Y dedupes).
- A nested **real directory** member dedupes correctly: both MJAPI and the member resolve
  to the one host copy.

**Why also (parity + swarm).** A production `mj app install` makes the app an npm
dependency of the host workspace and lets npm dedupe one tree — exactly what the nested
member reproduces. So dev-link == install at the resolution layer ("dev mode is a
resolution override on the install path, not a fork"). And per-instance worktrees let
parallel instances run different branches of the same app over one shared object store —
a single shared/symlinked checkout would force every instance onto the same branch.

**Rules out.** `npm link`, global symlinks, symlinked external members, bidirectional
linking between two fixed checkouts. The cross-version (`ignoreVersionRange`) case is
handled by reversibly neutralizing the app's own `@memberjunction/*` pins to `"*"` so npm
still dedupes — never by tolerating a nested copy. (See the single-copy invariant in
`docs/agent/SAFETY.md`.)

---

## ADR-002 — Editor access: per-instance multi-root `.code-workspace` (for git) + convenience symlinks (for navigation), reconciled from one source of truth

**Decision.** For "open this instance in an editor" we ship **both**, owned by a single
derived reconciler (`WorkspaceArtifacts.reconcileInstanceEditorArtifacts`):

1. A per-instance multi-root `<slug>.code-workspace` (sibling of `mj/`), listing `mj/`
   and each dev-linked app's **real nested path** (`mj/packages/dev-apps/<app>`) as named
   roots. **The "Open in VS Code" button/CLI `open` opens this file**, not the bare folder.
2. Per-app convenience **symlinks** at the instance root (`<slug>/<app>` →
   `mj/packages/dev-apps/<app>`) for terminal/Finder/other-editor navigation.

Both are **derived from the dev-linked app set** and reconciled idempotently after every
link/install/unlink/switch and lazily on open (so a drifted instance self-heals). The
reconciler owns only what it created (prunes stale symlinks pointing into
`mj/packages/dev-apps/`, never touches foreign symlinks or real folders) and **manages
only the workspace `folders` array** — any `settings`/`extensions` a user adds survive.

**Why the workspace file is the git story (empirically established).** Opening the folder
with the symlinks present does **not** surface the apps' git in VS Code: VS Code
dereferences each symlink to its realpath inside `mj/`, where the app's `.git` gitlink
sits below the default `git.repositoryScanMaxDepth` (1) and inside the already-discovered
`mj` repo — so it's attributed to `mj`, not opened as its own repo. A multi-root
workspace that names the app folder as an **explicit root** forces VS Code to open a
repository there, giving per-app Source Control reliably (we also set
`repositoryScanMaxDepth: 2` + `openRepositoryInParentFolders`).

**Why keep the symlinks anyway.** They're real folders in Finder/terminal/non-VS-Code
editors (`cd <slug>/<app>`), useful to humans and agents navigating an instance. They are
**navigation sugar only** — explicitly _not_ part of the git integration.

**Why one derived reconciler (not incremental edits).** Three things must agree
(dev-linked set, symlinks, workspace roots). Maintaining them with scattered `ln`/`rm`/
JSON-edits drifts on any partial failure. Re-deriving all of it from `listApps` on each
change + on open is strictly less to manage and self-heals.

**Why this is safe for ADR-001.** The symlinks are siblings of `mj/` (outside it), so they
don't affect the MJ-worktree git-cleanliness check, and nothing imports through them — Node
resolution is unaffected. The workspace points at the real nested paths (not the symlinks)
to avoid double-listing.

**Rules out.** Opening the bare folder as the default editor action; symlinking the
_member_ out (that's Option X, ADR-001); hand-syncing the artifacts in each lifecycle
method; clobbering user edits to the workspace file.

---

## ADR-003 — mjdev does NOT mirror MJ / open-app functionality; it documents soft dependencies and focuses on integration value

**Decision.** mjdev will **not** wrap or re-implement capabilities that already exist
in MJ or the open apps — e.g. running package tests (`turbo run test` / `mj test` /
an app's `npm test`), codegen, migrate-the-CLI-already-exposes, etc. Where an agent
needs such a capability during a mjdev workflow, we **point at the existing command in
the agent docs** (a soft dependency) rather than adding a `mjdev <x>` wrapper. Concrete
first application: the proposed `mjdev test` / `mjdev app test` runners were **dropped**;
`TEST-PROTOCOL.md` instead tells agents to run the worktree's own `npm test`
(`turbo run test`), which — because dev-linked apps are workspace members via the
`packages/dev-apps/*/packages/*` glob — already spans MJ core **and** every dev-linked app.

**Why.** A wrapper would (1) duplicate a solved capability; (2) confuse agents with a
redundant, second-source surface; (3) add maintenance; and (4) create a **hard
dependency that breaks the instant MJ moves/renames the command**. A doc pointer is a
**soft dependency** with the same benefit and far less downside — if the upstream
command moves, we edit one line of prose (and can explain _where it moved_) instead of
shipping a broken tool. mjdev's actual, non-duplicative value is the **integrated
instance** (guaranteed-correct MJAPI version + the full package set you can't get from a
standalone open-app repo) and the **advanced UI/integration testing** that only makes
sense once everything is brought together — that is what the tool should invest in.

**Boundary / how to decide.** Build it in mjdev only if it (a) manages instances or the
integrated multi-repo environment, or (b) provides testing/validation that genuinely
requires bringing everything together and can't be done from a single repo. If MJ or an
app already does it (or _should_ do it), use/point-to theirs — and if it's missing
(e.g. open apps ship **stub** test scripts today), the fix belongs **upstream** (MJ or
the open-app source), not as a mjdev workaround.

**Rules out.** `mjdev test` / `mjdev app test` wrappers; any `mjdev` command that merely
shells a stock MJ/app command an agent could run directly; "fixing" missing open-app
tests inside mjdev instead of upstream.

**Verified (2026-06-23, live on `openapp-dev`).** `turbo run test` from the instance
worktree scheduled **all 10** dev-linked `@mj-biz-apps/*` sub-packages (258 packages in
the test graph) and a scoped `--filter='@mj-biz-apps/*'` run executed every one
(20/20 tasks green), each firing its `echo "No tests configured yet"` stub. So the
instance's existing test command genuinely spans dev-linked apps — when an app adds a
real suite it runs automatically, with no mjdev wrapper. (Benign: turbo warns
`no output files found for …#test` because the task's `outputs: ["coverage/**"]` yields
nothing for a stub; resolves once apps emit coverage.)

---

## ADR-004 — One shared SQL Server container per workspace (one database per instance), not a container per instance

**Decision.** A workspace runs **exactly one** SQL Server container (`mjdev-sql` /
`mjdev-dev-sql`), and each instance is a **database** (`MJ_<slug>`) on it — replacing the
old "one Docker container (its own SQL Server) per instance" model. The server's
coordinates + shared credentials live in `~/.mjdev/server.json` (0600), owned by
`SharedSqlServer.ensure()` (create-on-first-instance, reuse after, start-if-stopped). Each
instance still gets its own database, its own per-DB users mapped to the shared logins, and
its own app-level keys (encryption, magic-link, system API key).

**Why.** SQL Server natively hosts many databases in one instance, so a server-per-instance
was pure overhead: a host SQL port to allocate/track per instance, a full SQL Server process

- RAM reservation per instance, and — observed during the Madhav validation — cross-container
  CPU/IO **contention that caused a migration timeout** when two servers competed on one host.
  Consolidating removes the per-instance SQL port allocation entirely, collapses N server
  processes to one (shared buffer pool — _less_ contention, not more), and makes create/delete
  cheaper (`CREATE DATABASE` / `DROP DATABASE` vs. container build/teardown).

**Credential model (load-bearing).** Credentials are **shared across the server**, not
per-instance. The login _names_ are fixed (`MJ_Connect`, `MJ_CodeGen`), so on a shared server
the first `CREATE LOGIN` wins and the rest are `IF NOT EXISTS` no-ops — a single password per
login is the only coherent model. `server.json` holds the one `sa` + `MJ_Connect` +
`MJ_CodeGen` password set; each instance's `secrets.json` entry receives **copies** of those
shared values, so `ConfigWriter`/`IdentityManager`/`dbBootstrap` read them unchanged. The
shared `MJ_Connect` login is a user in every instance DB, so it can read across instances —
acceptable for a single developer's local data; per-instance DBs, encryption keys, and API
keys still isolate what matters.

**Lifecycle.** `create` ensures the server, then runs the (unchanged, idempotent)
`buildSetupScript` to make this instance's DB + users; rollback runs `buildDropDatabaseScript`
on **only this DB** — never the shared container. `delete` drops the DB (server stays up).
`stop` stops the instance's processes only (the server is shared — stopping it would break
other instances/agents). `start` ensures the server is running. `mjdev reset` is the explicit
full teardown (`teardownServer` removes the container + volume + any pre-consolidation
per-instance containers).

**Dev/prod isolation preserved (the constraint).** Because `server.json` lives in the
already-prefix-isolated config dir (`~/.mjdev` vs `~/.mjdev-dev`) and the container is named
per prefix on an auto-allocated port (the bind-probe makes dev land on `:1434` when prod holds
`:1433`), **dev and prod run separate shared servers**. Dev work never disturbs the production
server other agents depend on — verified live: a `mjdev-cctest` throwaway server stood up on
`:1434` without touching prod's `:1433`.

**Rules out.** A SQL container per instance; per-instance SQL ports; per-instance SQL
credentials (incoherent under fixed shared login names); stopping the SQL server on a
per-instance `stop`; tearing the server down on a per-instance `delete`.

**Verified (2026-06-23, live Docker + SQL Server, isolated `mjdev-cctest` prefix).**
`ensure()` created one container, was idempotent on re-call; two instance DBs (`MJ_cc_a`,
`MJ_cc_b`) created on the single container; the **shared `MJ_Connect` login reached BOTH** DBs
(`DB_NAME()` correct per DB — proves shared login + per-DB user + grant); dropping `MJ_cc_b`
left `MJ_cc_a` and the container intact; teardown removed the container. Plus 162 orchestrator
unit tests (incl. new `SharedSqlServer` + server-store + `PortAllocator` server-port tests) and
the seeded GUI panel spec, all green.

---

## ADR-005 — `setup all` does NOT seed core metadata before codegen; a metadata/migration misalignment is allowed to surface, not masked

> **⚠ SUPERSEDED by ADR-006 (2026-06-24).** This decision was reversed the same day. The
> reasoning below assumed seeding metadata in `setup all` would _mask_ a misalignment. That was
> wrong: `mj sync push --dir=metadata` is a legitimate install step (it's how `metadata/` reaches
> a DB in a real MJ install), not a workaround — so running it restores fidelity rather than
> hiding a bug. See ADR-006. Kept for history.

**Decision.** `mjdev setup all` (deps → migrate → codegen → build) runs core codegen against
the freshly-migrated DB **as-is**. It does **not** run a core `mj sync push` of the repo's
`metadata/` before codegen, and codegen is **not** guarded against overwriting committed
generated files. If a base carries a migration that creates a `RemoteOperation`/entity without
seeding its metadata rows in the same migration, a clean `create → setup all` will let codegen
regenerate the committed generated file from the empty table (clobbering it) and let the
downstream build break. That break is treated as the **intended signal**, not a defect to work
around.

**Why (the load-bearing reason).** By MJ convention, the commit that introduces a
`RemoteOperation` (or any entity whose committed generated code depends on seed rows) **seeds
that metadata in the same migration** that creates the structure. When that convention is
honored, a freshly-migrated DB has the rows codegen needs and there is no clobber. A
misalignment (structure migrated, metadata not seeded) is therefore an **upstream PR bug**.
Auto-seeding `metadata/` inside `setup all`, or restoring clobbered generated files, would
**mask exactly the misalignment we want a fresh setup to surface** — it would let an incomplete
migration ship looking healthy. Keeping `setup all` honest makes the misalignment fail loudly on
the first clean provision, which is where we want it caught. mjdev's job is to drive codegen
faithfully, not to compensate for an incomplete migration.

**Scope / non-goals.** The reliable _catch_ mechanism — a CI check that runs codegen against a
freshly-migrated+seeded DB and asserts no drift in committed generated files — belongs in
**MJ-core**, not mjdev. Note the interaction with turbo caching: a turbo **cache replay** of a
previously-green build can make `setup all` report rc=0 over a clobbered source, so the break
isn't always loud today — another reason the durable catch lives in MJ-core CI, not in a mjdev
workaround. Local recovery from a clobber:
`git checkout -- packages/MJCoreEntities/src/generated/{remote_operations.ts,entity_subclasses.ts}`
then rebuild.

**Rules out.** A pre-codegen core metadata-sync step in `setup all`; a "restore committed
generated files if the driving metadata is absent" guard in mjdev's codegen invocation; any
mjdev-side compensation for an incomplete upstream migration. (See MJDEV-ISSUES.md, the
NOT-MJDEV codegen-clobber triage, 2026-06-24.)

---

## ADR-006 — `setup all` runs a core metadata sync (`mj sync push --dir=metadata`) between migrate and codegen (supersedes ADR-005)

> **⚠ SUPERSEDED by ADR-007 (2026-06-24).** Live testing showed `mj sync push --dir=metadata` is
> not a "seed missing rows" step — it is a full **reconcile** that executes authored deletes
> (e.g. a connector retirement: 9,262 rows on a real base) and matches insert/update by the
> primaryKey in each file. On current MJ bases it **cannot complete** at all: the `metadata/`
> integration files and the baseline migration were authored with **different primary keys for the
> same records** (proven: iMIS `GLAccount` is `949501CF…` in the migration vs `6b528e9b…` in the
> file), so push tries to INSERT and hits `UQ_IntegrationObject_Name`. It is therefore the wrong
> instrument for provisioning. ADR-007 removes it. Kept for history.

**Decision.** The full setup pipeline is `deps → build → migrate → **sync** → codegen`. The new
`sync` step shells `node packages/MJCLI/bin/run.js sync push --dir=metadata --ci` in the
instance worktree, pushing the repo's core `metadata/` tree into the instance DB. It runs after
migrate (the schema must exist) and before codegen (codegen reads the seeded rows to regenerate
the committed entity code). Exposed as a first-class step: `mjdev setup <slug> sync`, the
`metadataSynced` flag in `InstanceSetupState`, and a checklist row in the GUI.

**Why this reverses ADR-005.** ADR-005 refused to seed metadata in setup, on the theory that
doing so would _mask_ a migration/metadata misalignment we wanted to surface. That theory was
wrong about what `mj sync push` is. In a real MJ install, core reference/seed data does **not**
live in migrations — it lives in the repo's `metadata/` tree and is loaded by `mj sync push`.
So a setup pipeline that migrates and codegens but never syncs metadata isn't "honest," it's
**incomplete** — it skips a real install step, then lets codegen regenerate committed files from
an empty DB (dropping types like `RecordProcessScopeOverride` and breaking the build). Running
the sync makes our setup faithful to production, not a workaround.

**Does this hide bugs?** No. The sync only loads what's actually present in `metadata/`. A
genuine misalignment — data that exists in **neither** a migration **nor** `metadata/` — still
surfaces as a failure (codegen still has nothing to read). What the sync fixes is the case where
the data was correctly committed to `metadata/` but our pipeline simply wasn't loading it (the
`MJ: Remote Operations` / `RecordProcess.RunNow` case that prompted this). The durable
"misalignment catch" still belongs in MJ-core CI (codegen-diff against a freshly-migrated +
**synced** DB) — and ADR-006 makes "synced" part of that baseline.

**Mechanics / safety.** `--ci` makes the push non-interactive (the plugin otherwise prompts via
inquirer) and non-zero-exits on real errors, matching how migrate/codegen surface failure
(`SetupRunner` gates each step on exit code; `runFullSetup` stops at the first failure). The step
needs the worktree's generated `mj.config.cjs` (present after ConfigWriter) for its DB
connection; it's offline (local files → DB) and idempotent.

**Rules out.** A setup pipeline that codegens without first loading `metadata/`; treating the
codegen-clobber symptom as expected/intended (ADR-005's stance). Does **not** rule out an
MJ-core CI drift check — that remains the right home for catching true misalignments.

---

## ADR-007 — `setup all` = `deps → build → migrate`; codegen and `mj sync push` are on-demand only (supersedes ADR-005 and ADR-006)

**Decision.** Provisioning (`setup all` / `runFullSetup`) runs exactly **`deps → build → migrate`**.
It runs **neither codegen nor `mj sync push`**. Both are surfaced as explicit, opt-in operations:

- **codegen** stays a `SetupStep` (`mjdev setup <slug> codegen`; a confirm-gated "Run CodeGen"
  button in the GUI's "Advanced — schema/metadata tools" card) — but is removed from
  `FULL_SETUP_ORDER`.
- **`mj sync push`** is **not** wrapped as a one-click action at all. It is documented as a
  deliberate manual operation run in the worktree (dry-run first, scope with `--include`).

**Why (three findings from live testing, all on a real next-based instance).**

1. **Committed generated code + migrations already make a fresh instance correct.** Verified: a
   `deps → build → migrate` instance has `MJAPI/src/generated/generated.ts` and the entity
   generated code present (committed, **not** gitignored) and a **clean `git status`**. Codegen at
   provisioning is redundant — it only re-derives what's already committed.
2. **Re-running codegen at provisioning is actively harmful.** Codegen reads the DB and overwrites
   the committed generated files. If the DB is missing metadata those files depend on (a teammate
   committed `metadata/` changes without the `*_Metadata_Sync` migration — a convention violation),
   codegen **clobbers** them and breaks the build. Auto-running it makes mjdev "Dev B regenerating
   against a possibly-incomplete DB" on every provision. MJ's own convention (and the user's shop
   convention) is: **commit generated code; do not run codegen at startup.**
3. **`mj sync push` is a reconcile/authoring tool, not a seed.** It executes authored deletes
   (connector-retirement: 9,262 rows observed) and matches insert/update by file primaryKey. On
   current bases it can't even complete (migration-vs-metadata PK divergence → unique-key
   violation). It is the wrong instrument for provisioning and is dangerous to wrap as one-click.

**How metadata actually reaches a fresh instance:** via **migrations** (`migrate` applies the
`*_Metadata_Sync` migrations that seed reference data + the CodeGen-appended SQL). `mj sync push`
is the single-author tool for pushing _your own_ metadata edits into _your_ DB before you codegen

- commit the seeding migration — never the distribution channel to teammates.

**Pre-codegen safety practice (documented, not auto-enforced):** before running on-demand codegen,
run `mj sync push --dir=metadata --dry-run`; if it reports pending **creates/updates**, the DB
diverges from the committed metadata and codegen may clobber — reconcile or stop first.

**Rules out.** codegen or `mj sync push` in the default provisioning path; a one-click wrapper that
runs `mj sync push --dir=metadata --ci` (destructive full reconcile). Does **not** rule out an
on-demand codegen action (kept, confirm-gated + warned) or a future safe dry-run "metadata drift"
check. The deeper MJ-core metadata/migration consistency problems (PK divergence; retirements not
captured in migrations) are flagged upstream, out of mjdev scope.
