# MJ Dev Manager — Flagged Items & Deferred Verifications

A running list of things **deliberately flagged or deferred** during `mjdev` development —
verifications we chose not to run, known unrelated test failures, and decisions worth a
second look later. The point is so these don't get lost: if one of them "comes up again,"
the context to act on it is here. (For active work see `mj-dev-manager-backlog.md`; for
decisions see `mj-dev-manager-decisions.md`.)

_Last updated: 2026-06-26._

---

## FI-1 — `--ai` Advanced Generation enrichment: wiring verified, paid run deliberately NOT executed

**Status:** intentionally deferred (cost). Wiring is complete and verified; an actual
token-spending enrichment pass was not run.

**Context (ADR-009).** Codegen's AI "Advanced Generation" step is ON by default in raw MJ
and is _not_ gated on an API key, so it would silently burn tokens on every setup/codegen.
The convention loop therefore always runs codegen **AI-off** via a generated `.mjrc.cjs`
overlay (`advancedGeneration.enableAdvancedGeneration: false`) at the worktree root (core)
and the member dir (apps). This zero-token default is **proven live** (fresh `next` instance:
356-entity codegen, no LLM/advanced-gen activity, overlay confirmed off).

**Opt-in path (the `--ai` flag).** `mjdev setup <slug> codegen --ai`, `mjdev app codegen
<slug> <app> --ai`, and the GUI "AI enrichment" toggle flip the overlay to
`enableAdvancedGeneration: true` for a single run, then restore it to `false` in a `finally`.
Verified by construction + clean builds + unit/e2e + the on-run token warning. **Not** exercised
as a real paid run.

**Why deferred:** a full enrichment pass on a core instance (~356 entities) makes many LLM
calls against the instance's configured providers (the verification instance had live
OpenAI / Anthropic / Mistral keys) — real cost for marginal additional assurance over the
already-verified wiring + proven zero-token default.

**How to verify enrichment if it ever matters:** run `mjdev setup <slug> codegen --ai` on an
instance that has AI provider keys in its `.env`. Expect the "AI Advanced Generation ON —
consumes tokens" warning, AI-authored entity/field descriptions in the generated output, and
real token spend. Confirm the root `.mjrc.cjs` overlay is back to `enableAdvancedGeneration:
false` afterward (the restore).

---

## FI-2 — e2e `backup-restore.spec.ts` (postgres round-trip) fails — pre-existing, unrelated

**Status:** flagged as pre-existing / environmental, not a regression.

The postgres variant of "backup/restore round-trip via dialog UI" fails waiting for the
`database restored successfully` snackbar (30s timeout). The **mysql variant of the same test
passes**, it reproduces independently on re-run, and it lives entirely in the backup/restore +
postgres-test-harness path — untouched by the sync-loop / GUI work. Observed during the
2026-06-26 full e2e run (41 e2e: 40 pass, this 1 fail). Revisit when working on backup/restore
or the postgres test harness (likely the `forge_test` postgres container restore step, not app
code).
