# Temporal exceptions

**Time-bound** caveats that override the normal docs **for now**. Each has a removal
condition — when it's met, delete the entry (and any pointer in the managed `AGENTS.md`
block + `DEV-LOOPS.md`). These exist because the upstream MJ `next` branch (the MJ project's
main working branch) is sometimes in a state that breaks an otherwise-normal workflow. Keep
this list short and current.

---

## (none active)

There are currently **no active temporal exceptions** — agents do not need to ask before
running any standard workflow.

### Former TE-1 — `mj sync push` breaks on the integration deletions — REMOVED 2026-06-25 (ADR-009)

TE-1 used to require agents to _ask the user first_ before running `mj sync push`, because on `next`
a full push breaks (the `metadata/integration-object-deletes/` connector-retirement deletes plus an
iMIS integration-object migration↔metadata primary-key divergence → `UQ_IntegrationObject_Name`).

**That manual gate is gone.** Under ADR-009 the setup loop runs sync with `--format=json`
(non-interactive — it never hangs on the validation prompt), branches on `errorCount`, attempts a
**one-shot codegen repair**, and on a second failure **escalates loudly**: red CLI error text, a
non-dismissing GUI modal, and a persistent log at
`~/MJDev/instances/<slug>/logs/setup-escalations.md`. So on `next` today a core `mj sync push` that
hits this divergence surfaces as a clean, explained escalation instead of a hang or a silent break —
no human pre-gate needed. (The push is transactional, so the connector-retirement deletes never
commit when it fails.)

The **underlying upstream problem still exists** and is tracked — not as a behavioral gate — in
`docs/action-items/mj-dev-manager-backlog.md` → "Upstream hand-offs": the integration metadata IDs must match
the migrations and the connector retirement must be captured in a migration, so a plain
`mj sync push` completes without manual intervention.
