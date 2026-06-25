# MJ Dev Manager — orchestration guide (start here)

You are an AI agent working in an **MJ Dev Manager** workspace. This tool stands
up **isolated local MemberJunction (MJ) dev instances** — each is a **database on
the workspace's one shared SQL Server container** + a git worktree of an MJ clone

- generated config — and lets
  you develop MJ and **Open Apps** against them. Your job, by the end of this doc:
  go from "needs a human to guide every step" to **"I can stand up a tester, run
  the full validation cycle, and hand the user a plan + the exact tests I'll run."**

## The one rule that makes you useful

When the user says _"build feature X"_, respond with: a short plan, **and the
exact tests you will run at each layer (CLI + GUI)** before you call it done.
You validate everything at **both** layers — see @.mjdev-docs/TEST-PROTOCOL.md.
You exist to make the _user_ more powerful, not just yourself.

## Reporting back to the user (response format — do this every response)

The user often runs **several agents at once** and needs to orient fast. **Bracket every
distinct task in your response with a header at BOTH the top and the bottom of that task's
section.** The header gives: the task **number**, a short **descriptive name**, and the
**branch(es) + instance(s)** you worked in.

- **Number = batch, letter = task.** Each response is a **batch** whose number **counts up every
  response**; letter each task within it (`1a`, `1b`, …; the next response is `2a`, `2b`). This lets
  the user reference an older task by `<batch><letter>` and trace which batch it came from. Give
  each a **descriptive** name — e.g. "MJExplorer debugging", not "the task".
- Put the header at the **start** of a task's section **and repeat it at the end** of that section.
  With multiple tasks: `Task 1a header → …work… → Task 1a (close) → Task 1b header → …work… → Task 1b
(close)` — the final close ends your response.
- Name the **branch(es) + instance(s)** (slug → branch; note dev `~/.mjdev-dev` vs prod
  `~/.mjdev`, and the Forge repo branch if you committed). `none` is fine when nothing was touched.
- **Whenever you mention a task — anywhere, not just in headers — use BOTH the number+letter AND
  the short name**, e.g. "Task 2c (MJExplorer debugging)". The user can't remember the number
  codes, but the short name will land; the code lets them trace the batch.

Example header (used at top and bottom of the section):
`▸ Task 2c · MJExplorer debugging — branch: feature/x · instance: openapp-dev`

## The map (where things live)

- `~/MJDev/` — visible, shareable workspace: `repos/mj` (the MJ clone instances
  worktree from), `repos/apps/<app>` (open-app clones), `instances/<slug>/{mj,apps,config}`,
  `bin/mjdev` (CLI launcher), `.mjdev-docs/` (these docs), `MJDEV-ISSUES.md`,
  `MJDEV-REQUESTS.md`, and **`logs/`** — write any working command output **there**, not the
  workspace root. (The tool's own per-process logs are in hidden `~/.mjdev/proc-logs/`; read with
  `mjdev logs <id>`.)
- `~/.mjdev/` — hidden secrets/state (`instances.json`, `secrets.json`, personas, keys,
  processes, openapps). **Off-limits to hand-edit — mutate only via the CLI.**
- Full layout: @.mjdev-docs/WORKSPACE.md.
- 📖 **MemberJunction's own `CLAUDE.md`** (`repos/mj/CLAUDE.md`, or `mj/CLAUDE.md` inside any
  instance worktree) is the **highest source of truth for MJ itself** — read it, and use it as the
  fallback whenever these mjdev docs don't cover something. These docs cover the _mjdev tool_; MJ's
  CLAUDE.md covers _MemberJunction_ (the framework you're developing against).

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

## One shared SQL Server (one database per instance)

A workspace runs **exactly one** SQL Server container — `mjdev-sql` (prod) /
`mjdev-dev-sql` (dev) — recorded in `~/.mjdev/server.json`. Each instance is a
**database** (`MJ_<slug>`) on it, not its own container. Implications you'll hit:

- **Don't `docker stop` the SQL container to "stop an instance"** — every instance
  (and other agents) share it. `mjdev stop <slug>` stops only that instance's
  processes; the server stays up. `mjdev delete <slug>` drops only that DB.
- DB credentials (`MJ_Connect`/`MJ_CodeGen`/`sa`) are **shared across the server**
  and stored in `server.json`; each instance's DB has its own users + app keys.
- `mjdev reset` is the only thing that tears the shared server down (full cutover).
- Dev and prod have **separate** shared servers (separate config dirs + prefixes +
  ports), so dev work never disturbs prod. See ADR-004 in
  `plans/mj-dev-manager-decisions.md` for the full rationale.

## From zero to productive (quickstart)

```sh
# 1. Stand up an instance (provision only)
./bin/mjdev create <config.yaml> --json

# 2. Bring it up (deps -> build -> migrate; NO codegen — committed code is trusted)
./bin/mjdev setup <slug> all --json

# 3. Run it + sanity-check the live app
./bin/mjdev run <slug> api
./bin/mjdev e2e <slug> --check apps

# 4. Dev-link an open app (optional) and bring it to ready
./bin/mjdev app link <slug> ~/MJDev/repos/apps/<app> --json
./bin/mjdev app setup <slug> <app>     # migrate->sync->build (NO codegen — on-demand only)

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

## Heavy slots (concurrency budget — ask the user on startup)

Lots of mjdev work is **long-running + high-compute**: a full MJ `turbo build` (~50 packages,
minutes), an instance `create` + `setup all` (npm install GBs + build), an `app build-all`, a
Playwright/`e2e` run. Each such task = **one "heavy slot."** On startup, **ask the user how many
heavy slots to run** — i.e. how many of those they're comfortable running at once on their machine
— and keep concurrent heavy tasks within that budget.

- **Run heavy tasks in the background and parallelize up to the budget** (don't serialize when you
  have free slots; don't blow past it either). Light work (reads, single-file edits, `mjdev list`)
  doesn't count against slots.
- The budget is a guess the user refines over time — re-ask or adjust if builds start thrashing or
  if there's clearly headroom. When in doubt, fewer slots.
- This is the orchestrator's main job for throughput: keep the heavy-slot pipeline full but not
  oversubscribed across the swarm.

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

## Requesting a doc or tool improvement → `MJDEV-REQUESTS.md`

You **can't edit the shipped docs/tool directly** — `.mjdev-docs/` and the managed `AGENTS.md`
region are regenerated each launch, so edits are overwritten. When you want a **doc** change
(clarify/fix/add to an agent doc) or a **tool improvement** (a CLI command/flag, GUI control,
feature, engine behavior), append an entry to `~/MJDev/MJDEV-REQUESTS.md` (type: `doc` |
`improvement`, with a target). The maintainer reviews and folds accepted requests back into the
Forge repo. (Bugs → `MJDEV-ISSUES.md`; _wanted changes_ → here.)
