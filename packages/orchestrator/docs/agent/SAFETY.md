# Safety rules (read before you act)

These are hard rules with the _why_. The permission model is **hands-off except
destructive**: read + build/test + non-destructive `mjdev` + the test harness run
without prompting; destructive ops prompt; a few things are denied outright.

## Never (denied)

- **`git push`** — the human owns all pushes. Commit locally if asked; never push.
- **Edit the personal MJ checkout** at `/Users/marcelotorres/projects/MJ/MJ` — it's
  a read-only source the clones are seeded from. Corrupting it breaks every instance.
- **Hand-edit `~/.mjdev` / `~/.mjdev-dev`** — these hold secrets + the source-of-truth
  state (`instances.json`, `secrets.json`, personas, keys, processes, openapps).
  Mutate them only through the `mjdev` CLI / GUI, which keep CLI and GUI in sync.

## Never disrupt a production instance a human is using

A human may be actively developing in a **production** instance (e.g. the accounting
dev instance). Do **not** stop / delete / migrate / rebuild an instance you did not
create. Do your work in the **isolated dev workspace** (`npm run dev:isolated` →
`~/MJDev-dev` + `~/.mjdev-dev` + container prefix `mjdev-dev`) or in a throwaway
instance you `create` and `delete`. Ports auto-bump (bind-probe + reservation of
already-published host ports), so a dev container can't seize a prod container's
port — but that doesn't license touching prod instances.

## Architectural invariants

- **One façade.** Drive everything through `InstanceOrchestrator` (CLI/GUI). Never
  poke an instance's container/worktree/DB directly behind the engine's back.
- **Single-mode per app.** An open app is either dev-linked _or_ installed, never both
  at once. Switch with `mjdev app switch`; don't mix.
- **Single-copy invariant.** Exactly one resolved `@memberjunction/*` (esp. `global`/
  `core`) per instance — a second copy splits the class factory and silently breaks
  registration. The tool guards this; don't defeat it with manual installs.
- **Personas use `@mjdev.local`** addresses — they're local dev identities, never real accounts.

## Destructive ops (confirm-gated / human-authorized)

`mjdev delete`, `mjdev reset`, `mjdev app unlink --drop-schema`, `mjdev app reset-schema`,
and any Docker volume teardown. These prompt; pass the explicit flag only when you
truly intend the data loss, and prefer doing them only in the dev workspace.

## When in doubt

If something looks like it would touch prod state, the personal checkout, secrets,
or push to a remote — stop and ask, or pick the isolated-dev path instead. If you
suspect the _tool_ is at fault, log it in `~/MJDev/MJDEV-ISSUES.md` rather than
working around it destructively.
