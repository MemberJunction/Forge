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
