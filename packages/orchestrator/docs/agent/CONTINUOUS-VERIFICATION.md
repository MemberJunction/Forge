# Continuous verification — what must be re-proven on every change

The harness exists so a human doesn't have to re-test by hand. **On any non-trivial
change, consult this list, run the checks that cover the areas you touched, and add a
line here for any new behavior you validate.** Validated behavior is re-validated
automatically — that's the contract. This file will grow; when it gets unwieldy we'll
restructure it, but for now it's the single checklist.

See @TEST-PROTOCOL.md for the tier-decision matrix (which layer to run when). This file is
the _inventory of behaviors_; that file is _how_ to run each tier.

## Automated suites (run these first — they cover most behavior deterministically)

| Suite                | Command (Forge repo)       | Covers                                                                                                                                                    | Last known-good                                  |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unit (vitest)        | `npm test`                 | orchestrator engine (paths, ports, stores, dbBootstrap, SharedSqlServer, ConfigWriter, repo/worktree/app managers), shared, main, preload, renderer logic | **449 passed / 38 files** (2026-06-24)           |
| GUI e2e (Playwright) | `npm run test:e2e`         | seeded Instances + Open-Apps + identity + editor-workspace panels; **console/pageerror capture is armed** (silent UI errors fail the spec)                | **37 passed, 1 skip, 1 known-fail** (2026-06-24) |
| Integration (gated)  | `npm run test:integration` | engine paths that need a real worktree/DB                                                                                                                 | run when engine semantics change                 |

## Behaviors that need a LIVE pass (can't be faked by unit/seeded tests)

Run these against a throwaway instance you create+delete, or a disposable existing one —
never a production instance a human is actively using.

1. **Shared SQL Server topology** — `create` two instances → exactly ONE `mjdev-sql`
   (or `mjdev-dev-sql`) container backs both; each is its own `MJ_<slug>` database; the
   shared `MJ_Connect` login reaches every instance DB. (`SharedSqlServer`, ADR-004.)
2. **Dev/prod server split** — dev (`~/.mjdev-dev`, prefix `mjdev-dev`) gets its own
   shared server on a different port; bind-probe avoids prod's. Dev work never touches the
   prod server.
3. **MJAPI boots + connects to the shared DB** — `mjdev run <slug> api` → the server
   reaches "serving"; an authenticated probe with the instance's `MJ_API_KEY`
   (`x-mj-api-key`) gets _past_ auth (reaching `INTROSPECTION_DISABLED` in prod mode is the
   tell: authenticating as the system Owner requires loading that user from the DB).
   _Header-less probes returning `UNAUTHENTICATED` also prove the server is up + DB-backed._
4. **Open-app dev-link runtime** — a dev-linked app's `@RegisterClass` classes register and
   its `-server` package's resolvers load (`Loaded Open App server package: …`). (W0.) The
   client-bootstrap step tracks MJ's CURRENT open-app API: `mjdev app link` calls the engine's
   `AddClientDynamicPackages` (writes `dynamicPackages.client`; MJExplorer's `mj codegen manifest
--ln` prebuild turns it into a per-app side-effect import) and must complete + exit 0. We target
   current MJ only (no legacy fallback) — if that engine export is absent the step throws a clear
   error naming both likely causes (instance worktree built from older MJ source → rebuild it; or
   MJ moved the API again → update the tool). If MJ changes this API, re-verify
   `engineEntrySource.ts`'s `clientBootstrap` step + `openAppRuntimeSupport.ts`'s client marker
   (`class-registrations-manifest`).
5. **Lifecycle**: `stop` stops only the instance's processes (shared server stays up);
   `delete` drops only that instance's DB (legacy records: removes their old container);
   `mjdev reset` tears the shared server down + sweeps legacy containers.
6. **Identity/magic-link** — persona mint + `mjdev e2e <slug> --check login` (when auth paths change).
7. **Editor artifacts** — `mjdev open <slug>` reconciles symlinks + `<slug>.code-workspace`.
8. **Auto-registered connection** — on Forge launch, the shared SQL Server is registered as a
   managed `ConnectionProfile` (sa @ `localhost:<port>`) from `server.json`, so it appears in
   the connection list with no manual setup. Covered by `tests/e2e/mjdev-connection-autoregister.spec.ts`
   (real-startup persistence) + `managed-connection.test.ts` (pure builder). Idempotent: one
   profile tagged `managed`, refreshed in place; user name/color edits preserved.

## Known pre-existing issues — do NOT re-flag these as regressions

- **`test:e2e` postgres backup/restore** (`backup-restore.spec.ts`, "restores into a fresh
  database") fails on a snackbar timeout — an out-of-scope SQL-manager feature, unrelated to
  mjdev. The other 37 e2e specs pass.
- **`isa-prbase` instance** fails to boot MJAPI with `Schema must contain uniquely named
types but contains multiple types named "mjBizAppsAccountingJournalEntryLine_"` — a
  duplicate GraphQL type from its WIP `isa-openapp-integration` branch (loads common+
  accounting servers). It's that branch's app/codegen issue, **not** the tool/DB. Its DB
  converts + connects fine.
- **`bizapp-common-dev`** DB contains only `__mj.flyway_schema_history` (MJ core was never
  migrated in it) — an empty-ish instance, faithfully preserved by conversion. Not a loss.

## The rule

When you add a feature or change behavior: (a) write/adjust its automated test, (b) if it's
a live-only behavior, add it to the list above with the exact command to re-prove it, and
(c) run the covering checks before handback and state what you ran. Keep this file honest —
an entry that no longer reflects reality is worse than no entry.
