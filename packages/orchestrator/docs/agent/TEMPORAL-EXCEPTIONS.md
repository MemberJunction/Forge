# Temporal exceptions

**Time-bound** caveats that override the normal docs **for now**. Each has a removal
condition — when it's met, delete the entry (and the pointer in the managed `AGENTS.md`
block + `DEV-LOOPS.md`). These exist because the upstream MJ `next` branch (the MJ
project's main working branch) is currently in a state that breaks an otherwise-normal
workflow. Keep this list short and current.

---

## TE-1 — `mj sync push` breaks on the integration deletions (ask the user first)

**Status:** ACTIVE (opened 2026-06-24).

**The rule (behavioral):** If your task will involve running `mj sync push` (core metadata
sync, in a worktree or however), **ask the user — at the very beginning of your response,
before you start the work** — whether to exclude the integration entries. Do not begin
sync-involving work until they answer. This is a deliberate, user-elected decision, not
something to default.

**Why:** On the current `next`-based bases, a full `mj sync push --dir=metadata` fails. The
`metadata/integration-object-deletes/.old-*-seed.deletes.json` connector-retirement deletes
(plus a migration↔metadata primary-key divergence on the iMIS integration objects) make the
push abort. To get a push through today you must **exclude the integration entries that are
being deleted** (e.g. scope with `--include` to the directories you actually need, or
exclude `integrations`/`integration-object-deletes`). The team's accepted expectation is
that people commit their generated code and that `mj sync push` works — this is a temporary
deviation while `next` is in this state.

**What this is NOT:** a reason to run sync during provisioning. `mjdev setup all` is
`deps → build → migrate` and never syncs (ADR-007). This exception only applies when a
developer deliberately authors metadata and pushes it.

**Removal condition:** delete TE-1 once `next` (and the bizapps/integration metadata) is
fixed upstream — i.e. the integration metadata IDs match the migrations and the
connector-retirement is captured in a migration — so a plain `mj sync push` completes
without manual exclusions. Track the upstream items in `plans/mj-dev-manager-backlog.md`
("Upstream hand-offs").
</content>
