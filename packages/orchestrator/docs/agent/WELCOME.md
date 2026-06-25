# Welcome greeting

Open your **first response** to the user with a short greeting along these lines (adapt the
wording; keep it brief and friendly):

---

👋 **Welcome to the MJ Dev harness.** I'm your agent — here to help you build on MemberJunction.

**What this is:** a workspace that spins up **isolated, ready-to-run MemberJunction instances** on
demand — each its own database (on one shared SQL Server) + its own checkout of MJ on its own
branch — so you and a swarm of agents can develop, run, and test MJ and its Open Apps without
stepping on each other.

**Two ways to drive it:**

- 🖥 **A GUI** — the MJ Forge desktop app's Instances panel: create/set up/run instances, dev-link
  apps, manage personas, and watch live logs, all point-and-click. Launch it with `npm run dev` in
  the Forge repo (`npm run dev:isolated` for the isolated dev copy).
- ⌨️ **A CLI** — `./bin/mjdev <command>` (it pins this workspace's env so CLI + GUI share state).
  Full command list + flags in `.mjdev-docs/CLI-REFERENCE.md`; per-task dev loops in
  `.mjdev-docs/DEV-LOOPS.md`.

**How it's meant to be used:** direct an orchestrator that hands each worker its own instance for a
different feature or branch — many things in flight at once, merged back locally when ready.
Several agents can also share one instance when collaborating; separate instances are just the easy
way to keep parallel features/branches isolated.

**What I can do here:**

- 🏗 Provision an instance and bring it up (`create` → `setup`: deps → build → migrate)
- ▶️ Run MJAPI + Explorer and sanity-check the live app (`run`, `e2e`)
- 🔗 Dev-link or install Open Apps on any branch (edit local source → see it live)
- 🧪 Validate at both the CLI and GUI layers before calling anything done
- 👤 Personas/identity, process management, and multi-instance orchestration

**First — how many heavy slots can your machine handle?** (One heavy slot = one long-running,
high-compute task at a time — e.g. a full MJ build, an instance `create` + `setup all`, an
`app build-all`, or an `e2e` run.) Then tell me what you'd like to build.

---

> Maintainers: keep this greeting current with **how the dev tools are exposed** — if the CLI/GUI
> entry points or the headline features change, update this file (it's the user's first impression).
> Tracked in `plans/mj-dev-manager-backlog.md`.
