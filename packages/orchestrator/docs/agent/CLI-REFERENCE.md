# `mjdev` CLI reference

Run via `./bin/mjdev <command>` from the workspace root (the launcher pins this
workspace's isolation env). Most commands accept `--json` for machine-readable
output: progress **events stream on stderr**, the **final result is JSON on stdout**.

> This file is the authoritative command list and is guarded by a drift test —
> every `mjdev` command stays documented here.

## Instance lifecycle

| Command                      | What it does                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mjdev create <config.yaml>` | Provision a new instance (Docker SQL + worktree + config) from a YAML config. Provision only — no setup.                                                                                                                       |
| `mjdev list`                 | List all instances.                                                                                                                                                                                                            |
| `mjdev info <slug>`          | Show full details for an instance.                                                                                                                                                                                             |
| `mjdev start <slug>`         | Start an instance's SQL container.                                                                                                                                                                                             |
| `mjdev stop <slug>`          | Stop an instance's SQL container.                                                                                                                                                                                              |
| `mjdev pull <slug>`          | Pull the instance branch from its remote upstream (fast-forward only).                                                                                                                                                         |
| `mjdev merge <slug>`         | Merge the instance's base branch in to pick up base-branch commits (re-run migrate + build after).                                                                                                                             |
| `mjdev delete <slug>`        | Delete an instance (container, volume, worktree, record). Destructive — confirm-gated.                                                                                                                                         |
| `mjdev reset`                | Delete ALL instances — for cutover/cleanup. Destructive.                                                                                                                                                                       |
| `mjdev open <slug>`          | Open the instance in VS Code — the multi-root `.code-workspace` (one root per dev-linked app, each with its own Source Control) when apps are linked, else the worktree folder. Reconciles the workspace + nav symlinks first. |

```sh
mjdev create fixtures/golden-instance.yaml --json
mjdev list --json
mjdev info my-slug
```

## Setup & processes

| Command                     | What it does                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `mjdev setup <slug> <step>` | Run a setup step: `deps` \| `migrate` \| `build` \| `all`, or **on-demand** `codegen`. |
| `mjdev runs <slug>`         | List the launchable targets (services + scripts) for an instance.                      |
| `mjdev run <slug> <target>` | Launch a service detached (persists): `api` \| `explorer` \| `<package-script>`.       |
| `mjdev ps [slug]`           | List running processes (shared with the GUI); omit slug for all.                       |
| `mjdev kill <id>`           | Stop a running process by its id (from `mjdev ps`).                                    |
| `mjdev logs <id>`           | Print the captured log tail for a process id.                                          |

```sh
mjdev setup my-slug all          # provisioning: deps -> build -> migrate  (NO codegen, NO sync)
mjdev setup my-slug codegen      # ON-DEMAND only — see the warning below
mjdev run my-slug api            # start MJAPI (detached)
mjdev ps my-slug --json
```

**`setup all` = `deps → build → migrate`. It deliberately does NOT run codegen or `mj sync push`.**
A fresh instance's **committed generated code already matches its committed migrations**, so
provisioning needs neither. `migrate` is what brings the DB up to date (including the
`*_Metadata_Sync` migrations that seed reference data); the committed generated code + `build`
do the rest. This was verified: a `deps → build → migrate` instance has the generated resolvers/
entity code present (committed, not gitignored) and a clean `git status`.

**Don't run codegen unless you have to — it's ON-DEMAND.** The rule for **both** the instance
(`setup … codegen`) and open apps (`app codegen`; `app setup` no longer runs it): you _have to_
run codegen only when **YOU** changed the schema/metadata (of the instance or the app) and need
the committed generated code to match — then run it and commit the regenerated code **and** its
seeding migration. Otherwise **trust the committed generated code** (instances commit it under
`*/src/generated`; so do dev-linked apps). Two reasons it's on-demand, not automatic:
⚠ **(1) Clobber.** Codegen reads the DB and overwrites the committed generated files. If the DB is
missing metadata those files depend on (e.g. a teammate committed `metadata/` changes without the
`*_Metadata_Sync` migration), codegen **clobbers** them and breaks the build. **Before running it,
run `mj sync push --dir=metadata --dry-run` in the worktree** — pending creates/updates mean the
DB diverges from committed metadata; reconcile or stop first.
⚠ **(2) It can just fail.** CodeGen's AI CHECK-constraint parser needs **AI credentials** a fresh
instance won't have, so an unattended codegen at setup can error out (observed in validation).

**Metadata authoring (`mj sync push`) is a deliberate MANUAL operation, never automated.** It is a
full reconcile (it can DELETE database rows not represented in the files — e.g. a connector
retirement) and it requires human judgment on scope. Run it yourself in the worktree, dry-run
first, scope with `--include`. It is **not** the mechanism for getting teammates' metadata onto a
fresh instance — migrations are. See ADR-007 (supersedes ADR-006) and the codegen-clobber triage
in `MJDEV-ISSUES.md`.

**Metadata authoring (`mj sync push`) is a deliberate MANUAL operation, never automated.** It is a
full reconcile (it can DELETE database rows not represented in the files — e.g. a connector
retirement) and it requires human judgment on scope. Run it yourself in the worktree, dry-run
first, scope with `--include`. It is **not** the mechanism for getting teammates' metadata onto a
fresh instance — migrations are. See ADR-007 (supersedes ADR-006) and the codegen-clobber triage
in `MJDEV-ISSUES.md`.

## Personas & identity

| Command                     | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `mjdev persona list`        | List developer personas.                                                            |
| `mjdev persona add`         | Create a developer persona.                                                         |
| `mjdev persona remove`      | Delete a developer persona.                                                         |
| `mjdev login <id>`          | Set the globally active developer persona.                                          |
| `mjdev whoami [slug]`       | Show the active persona, or the persona an instance acts as.                        |
| `mjdev key <slug>`          | Print (mint if needed) the persona's `mj_sk_*` API key for that instance.           |
| `mjdev explorer-url <slug>` | Mint a magic-link session and print a logged-in Explorer URL (needs MJAPI running). |
| `mjdev e2e <slug>`          | Headless end-to-end checks against the live Explorer / GraphQL.                     |
| `mjdev backfill <slug>`     | Regenerate config + auth secrets for a pre-Phase-2 instance.                        |

## App access (which apps a persona can see)

| Command                           | What it does                                             |
| --------------------------------- | -------------------------------------------------------- |
| `mjdev apps list <slug>`          | List the instance's apps and the persona's access state. |
| `mjdev apps enable <slug> <app>`  | Grant the persona's access to an app.                    |
| `mjdev apps disable <slug> <app>` | Revoke the persona's access to an app.                   |

## Open-app development (`mjdev app …`)

| Command                                | What it does                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `mjdev app link <slug> <ref>`          | Dev-link an Open App (GitHub URL or local path) into an instance — install parity. **Flags below.** |
| `mjdev app install <slug> <ref>`       | Plain-install an Open App from GitHub (the real install path + transitive deps).                    |
| `mjdev app remove <slug> <app>`        | Remove an installed app.                                                                            |
| `mjdev app unlink <slug> <app>`        | Reverse a dev-link (optionally `--drop-schema`).                                                    |
| `mjdev app switch <slug> <app> <mode>` | Switch an app between `dev` (local source) and `installed` (published).                             |
| `mjdev app list <slug>`                | List apps dev-linked into an instance + per-app status.                                             |
| `mjdev app drift <slug> <app>`         | Check a dev-linked app for migration checksum drift.                                                |
| `mjdev app build <slug> <app>`         | Build a dev-linked app's workspace sub-packages (required before boot).                             |
| `mjdev app build-all <slug>`           | Rebuild all dev-linked apps, in cross-app dependency order.                                         |
| `mjdev app migrate <slug> <app>`       | Run a dev-linked app's schema migrations.                                                           |
| `mjdev app codegen <slug> <app>`       | Run codegen for a dev-linked app — **ON-DEMAND only** (see the codegen note below).                 |
| `mjdev app setup <slug> <app>`         | Bring a dev-linked app to ready: **migrate → sync → build** (one step). Does NOT run codegen.       |
| `mjdev app sync <slug> <app>`          | Push/pull the app's metadata (reference data seed).                                                 |
| `mjdev app watch-targets <slug> <app>` | Print the turbo watch filter for live-edit rebuilds.                                                |
| `mjdev app reset-schema <slug> <app>`  | Drop + re-migrate the app schema (destructive — fixes edited migrations).                           |
| `mjdev app repair-schema <slug> <app>` | Repair migration history (realign failed/baseline rows; does NOT re-run SQL).                       |

**`mjdev app link` flags** (also on `mjdev app link --help`):

- `--allow-double-underscore-schema` — **required for first-party MJ apps** (e.g. `bizapps-common`,
  `bizapps-accounting`) whose manifest declares a reserved `__`/`__mj_*`-prefixed schema. Without it
  the link fails at schema-create with `Schema names starting with '__' are reserved for MJ internals`.
- `--ignore-version-range` — override the manifest's `mjVersionRange` check for off-tag dev (e.g. an
  app pinned to `4.x` onto a `5.x` instance). Without it, an out-of-range app fails **fast** (before
  any worktree is materialized) — and a failed link now rolls back, so a corrected retry is clean.
- `--branch <branch>` / `--base-ref <ref>` — the app branch to develop on in this instance / its start point.

**`mjdev app install` can "succeed" with the app left DISABLED — by design.** If the install's
`npm install` step fails (commonly a peer-dep `ERESOLVE` from a published-app-vs-base version skew),
the engine **intentionally** still completes the durable work (schema, migrations, config, metadata)
and records the app as **Disabled** instead of Active — so MJ never tries to load an app whose code
packages aren't resolved (which would crash at boot). It returns success **with the reason in its
`Summary`**: _"App installed but left DISABLED — npm install failed…"_. This is resumable-by-design,
not a silent failure. **To finish:** fix the npm cause (npm login / `.npmrc` / peer-deps), run
`npm install`, then `mj app enable <app>`. ⚠ A bare `Installed <app> v<ver>` line does **not** mean
the app is Active — check the `Summary` (or `--json` output) / the app's status in `mjdev app list`.

```sh
# First-party bizapps-* declare __mj_* schemas → need --allow-double-underscore-schema:
mjdev app link my-slug ~/MJDev/repos/apps/bizapps-accounting --allow-double-underscore-schema --json
mjdev app setup my-slug bizapps-accounting   # migrate->sync->build (NO codegen)
mjdev app build my-slug bizapps-accounting
mjdev run my-slug api && mjdev e2e my-slug --check apps
```

## Conventions

- `--json`: machine output (events→stderr, result→stdout). Prefer it in scripts/agents.
- Destructive commands (`delete`, `reset`, `app unlink --drop-schema`, `app reset-schema`) are confirm-gated; pass the documented `--yes`/flag only when you mean it.
- Everything routes through the one engine façade (`InstanceOrchestrator`), so the CLI and GUI always agree on state.
