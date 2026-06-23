# MJ Dev Manager — orchestration guide (start here)

You are an AI agent working in an **MJ Dev Manager** workspace. This tool stands
up **isolated local MemberJunction (MJ) dev instances** — each is a Docker SQL
Server container + a git worktree of an MJ clone + generated config — and lets
you develop MJ and **Open Apps** against them. Your job, by the end of this doc:
go from "needs a human to guide every step" to **"I can stand up a tester, run
the full validation cycle, and hand the user a plan + the exact tests I'll run."**

## The one rule that makes you useful

When the user says _"build feature X"_, respond with: a short plan, **and the
exact tests you will run at each layer (CLI + GUI)** before you call it done.
You validate everything at **both** layers — see @.mjdev-docs/TEST-PROTOCOL.md.
You exist to make the _user_ more powerful, not just yourself.

## The map (where things live)

- `~/MJDev/` — visible, shareable workspace: `repos/mj` (the MJ clone instances
  worktree from), `repos/apps/<app>` (open-app clones), `instances/<slug>/{mj,apps,config}`,
  `bin/mjdev` (CLI launcher), `.mjdev-docs/` (these docs), `MJDEV-ISSUES.md`.
- `~/.mjdev/` — hidden secrets/state (`instances.json`, `secrets.json`, personas, keys,
  processes, openapps). **Off-limits to hand-edit — mutate only via the CLI.**
- Full layout: @.mjdev-docs/WORKSPACE.md.

**Off-limits (full list + why: @.mjdev-docs/SAFETY.md):** never `git push`; never
edit the personal MJ checkout; never hand-edit `~/.mjdev`; never disrupt a
**production instance a human is actively developing in** — use the isolated dev
workspace or a throwaway instance you create+delete.

## Dev vs prod (so your testing never trips a human)

- **Production:** `~/MJDev` + `~/.mjdev`, container prefix `mjdev`. A human's real instances.
- **Isolated dev:** `~/MJDev-dev` + `~/.mjdev-dev`, container prefix `mjdev-dev`, launched
  with `npm run dev:isolated` (in the Forge repo). Its own standalone MJ clone — not a
  worktree of prod. Ports auto-bump and reserve already-published host ports, so a dev
  container can never collide with a running prod one.

## From zero to productive (quickstart)

```sh
# 1. Stand up an instance (provision only)
./bin/mjdev create <config.yaml> --json

# 2. Bring it up (deps -> migrate -> codegen -> build)
./bin/mjdev setup <slug> all --json

# 3. Run it + sanity-check the live app
./bin/mjdev run <slug> api
./bin/mjdev e2e <slug> --check apps

# 4. Dev-link an open app (optional) and bring it to ready
./bin/mjdev app link <slug> ~/MJDev/repos/apps/<app> --json
./bin/mjdev app setup <slug> <app>     # migrate->sync->codegen->build

# 5. When done with a throwaway tester
./bin/mjdev delete <slug>
```

Full command list: @.mjdev-docs/CLI-REFERENCE.md. Per-task loops: @.mjdev-docs/DEV-LOOPS.md.

## The swarm model

One instance per agent, each on its own branch off the shared clone (worktrees
share one object store → cheap branching + local merge-back). Orchestrator
playbook: **create → setup all → assign slug to a worker → recycle/delete.**
Provisioning is the expensive step — pre-provision or keep a golden instance and
recycle rather than create-per-task.

## Reading `--json`

Events stream as NDJSON on **stderr**; the final result object is JSON on
**stdout**. Parse stdout for the result; tail stderr for progress.

## Escalation: suspected mjdev-tool bug → `MJDEV-ISSUES.md`

If, while developing **inside** an instance, you hit something you suspect is a
bug in **the mjdev tool itself** (provisioning, worktrees, config/env, ports,
personas, open-app dev-linking, the CLI/GUI, dev/prod isolation) — append an
entry to `~/MJDev/MJDEV-ISSUES.md`. The mjdev maintainer triages it.

**It is NOT a mjdev bug** if it's MJ-core runtime behavior (BaseEntity, data
providers, codegen _output_) or a bug in the open app's own code — those go to
the MJ / app maintainers.

Entry template (status flow `OPEN → TRIAGING → RESOLVED | NOT-MJDEV`):

```
### <short title>
- Status: OPEN
- Reported: <date> by <agent/instance>
- Repro: <exact commands>
- Expected vs actual:
- Suspected layer:
```
