# Dev loops

Concrete edit→verify loops for the two kinds of work in this workspace. Both end
in the **dual CLI+GUI validation** from @.mjdev-docs/TEST-PROTOCOL.md.

## A. Developing MJ Dev Manager itself (the tool)

You're editing `packages/*` in the Forge repo (use the **dev worktree**, not the
human's running checkout).

```sh
npm run build            # affected packages (turbo)
npm test                 # orchestrator/shared/etc unit tests
npm run test:e2e         # seeded + exploratory + visual GUI specs
npm run dev:isolated     # relaunch the Electron app against ~/MJDev-dev / ~/.mjdev-dev
# commit (never push)
```

- Renderer/main or workflow changes → add/extend a **seeded GUI spec** that asserts
  the control is present AND does its job (presence + behavior).
- Engine semantics → unit + integration; only spin a live instance when a behavior
  can't be faked.
- No main-process hot-reload — build + relaunch is the loop (acceptable).

## B. Developing an open app (or MJ) INSIDE an instance

You're editing app/MJ source in `instances/<slug>/mj/...` (or the dev-linked app
member). **Order matters** on schema/data changes:

> **Linking the app first:** `mjdev app link <slug> <ref>` needs
> `--allow-double-underscore-schema` for first-party MJ apps whose manifest declares a
> reserved `__mj_*` schema (e.g. `bizapps-common`, `bizapps-accounting`) — without it the
> link fails at schema-create with `reserved for MJ internals`. Use `--ignore-version-range`
> to link an off-tag app onto a newer MJ. (Full flag list in CLI-REFERENCE.md.)

```sh
# code-only change (server or client):
mjdev app build <slug> <app>           # rebuild the app's workspace sub-packages
mjdev run <slug> api                    # (restart api to pick up server dist; no HMR)

# schema change:
mjdev app migrate <slug> <app>          # apply new migration files
mjdev app codegen <slug> <app>          # regenerate entities/resolvers
mjdev app build <slug> <app>

# reference-data seed:
mjdev app sync <slug> <app>             # push metadata (e.g. currencies)

# one-shot "bring to ready":
mjdev app setup <slug> <app>            # migrate -> sync -> codegen -> build

# verify:
mjdev e2e <slug> --check apps           # app renders + GraphQL live
mjdev app list <slug>                    # per-app status: migrated/codegen/built/synced
```

- **Edit → see live:** server changes need a **rebuild + API restart** (plain `node`,
  no HMR). Client changes HMR off the rebuilt dist (`mjdev app watch-targets` prints
  the turbo watch filter).
- Per-app status (`mjdev app list`) tracks migrate/codegen/build/sync **independently**
  of instance-level `setup.*` flags — an instance can be "built" while a freshly-linked
  app still needs its own setup.
- Edited an already-applied migration? `mjdev app drift` detects checksum drift;
  `mjdev app reset-schema` (destructive) is the fix; `repair-schema` only realigns
  history rows and does NOT re-run SQL.

## C. Instance-level (core MJ) codegen & metadata — on-demand, NOT part of setup

`mjdev setup <slug> all` = **`deps → build → migrate`**. It does NOT run core codegen or
`mj sync push`, and you usually never need them: a fresh instance's committed generated code
already matches its committed migrations, and `migrate` seeds reference data via the
`*_Metadata_Sync` migrations. **Trust the committed code.**

Only when **you** change this instance's core schema/metadata:

```sh
# 1. (if you edited metadata/ files) push your edits into YOUR db — MANUAL, judgment required:
#    dry-run FIRST; scope with --include; it is a full reconcile that can DELETE rows.
cd instances/<slug>/mj && mj sync push --dir=metadata --dry-run   # inspect
                          mj sync push --include=<your-dir>        # apply, scoped

# 2. regenerate derived code (ON-DEMAND step):
mjdev setup <slug> codegen     # ⚠ overwrites committed generated files

# 3. commit BOTH the regenerated code AND its *_Metadata_Sync migration together.
```

- ⚠ **Codegen clobber rule:** codegen regenerates from the DB. If the DB is missing metadata that
  committed generated files depend on (someone committed `metadata/` without its migration), codegen
  **overwrites/clobbers** them and breaks the build. **Run `mj sync push --dir=metadata --dry-run`
  first** — pending creates/updates mean the DB diverges from committed metadata; reconcile or stop.
- `mj sync push` is the **single-author** tool for your own edits, **not** how teammates' metadata
  reaches you — that's migrations. See ADR-007 + CLI-REFERENCE.md.

## GUI control inventory (what the exploratory test walks)

The Instances + Open-Apps panels expose (drive each; fail on any console/pageerror):

- **Create dialog** (name, baseRef/branch, optional port overrides).
- **Setup steps** (deps / build / migrate / run-all) with status indicators, **plus** an
  "Advanced — schema/metadata tools" card with a confirm-gated **Run CodeGen** button (on-demand).
- **Process launcher** (Start MJAPI / Explorer / run-script) + running-process list (stop/logs).
- **Branch panel** (Branch + Based-on rows + Pull + Merge-from-base buttons).
- **Persona** roster + active-identity picker + per-instance persona + "Open Explorer as…".
- **App access** toggles (enable/disable per app).
- **Open Apps card**: link app, dev⇄install toggle, unlink, reset-schema, repair-schema,
  Light test, Full installer test, dependency popup, recents dropdown, advanced/mixed-mode warning.
- **Activity log** tail.

For each control note its show/enable guard (e.g. setup buttons gated on prior step;
merge hidden when no baseRef) — the seeded specs assert these guards.
