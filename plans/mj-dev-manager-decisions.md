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
