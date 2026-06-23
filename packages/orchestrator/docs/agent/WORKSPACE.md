# Workspace layout

Two roots: a **visible, shareable** workspace and a **hidden** secrets/state root.

## `~/MJDev/` — visible workspace (safe to browse/share)

```
~/MJDev/
├─ repos/
│  ├─ mj/                     # app-managed MJ clone — instances are git worktrees of this
│  └─ apps/<app>/             # open-app source clones (object store for app worktrees)
├─ instances/
│  └─ <slug>/
│     ├─ mj/                  # this instance's MJ worktree (its branch)
│     ├─ apps/<app>/          # dev-linked open-app worktrees (nested into mj/ as workspace members)
│     └─ config/              # per-instance non-secret config / notes
├─ bin/mjdev                  # CLI launcher (pins this workspace's isolation env)
├─ .mjdev-docs/               # THESE docs (regenerated each app launch)
├─ AGENTS.md                  # agent guide (managed block + your own prose preserved)
├─ CLAUDE.md                  # thin `@AGENTS.md` import (created only if absent)
└─ MJDEV-ISSUES.md            # suspected-mjdev-bug escalation log (never clobbered)
```

## `~/.mjdev/` — hidden secrets/state (DO NOT hand-edit — use the CLI)

```
~/.mjdev/
├─ instances.json    # instance registry (source of truth)
├─ secrets.json      # SA/DB passwords, encryption + RSA keys (0600)
├─ personas.json     # dev persona roster + active persona
├─ apikeys.json      # minted per-instance/per-persona mj_sk_* keys (0600)
├─ processes.json    # shared running-process registry (CLI + GUI peers)
├─ openapps.json     # per-instance open-app dev-link state
└─ proc-logs/        # detached-process stdout logs
```

These hold secrets and the authoritative state both the CLI and GUI read. Editing
them by hand desyncs the tool — always go through `mjdev` / the GUI.

## Dev vs production (isolation)

|                  | Production     | Isolated dev           |
| ---------------- | -------------- | ---------------------- |
| Workspace root   | `~/MJDev`      | `~/MJDev-dev`          |
| Secrets/state    | `~/.mjdev`     | `~/.mjdev-dev`         |
| Container prefix | `mjdev-<slug>` | `mjdev-dev-<slug>`     |
| Launch           | `npm run dev`  | `npm run dev:isolated` |

The dev workspace clones its **own** standalone MJ (and open apps) — it is not a
worktree of the production clone — so dev work can never corrupt prod repos.

## Env overrides (resolution order: option → env → default)

- `MJDEV_WORKSPACE_DIR` — workspace root (default `~/MJDev`).
- `MJDEV_CONFIG_DIR` — hidden secrets/state root (default `~/.mjdev`).
- `MJDEV_CONTAINER_PREFIX` — Docker container/volume prefix (default `mjdev`).
- `MJDEV_MJ_SOURCE` — local checkout the managed MJ clone is _seeded_ from.
- `MJDEV_MJ_REPO` — escape hatch: worktree directly from an existing checkout (skips the managed clone).

The `bin/mjdev` launcher exports the first three automatically so CLI and GUI
share one workspace's state.
