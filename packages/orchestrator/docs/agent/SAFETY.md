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
  at once. Switch with `mjdev app switch`; don't mix the two modes for one app.
- **Don't mix dev-linked and installed apps in the SAME instance.** Keep an instance's open
  apps on **one topology** — all dev-linked, or all installed. Mixing is _very_ likely to
  break the instance. **Why:** a dev-linked app is materialized as an npm **workspace member**,
  so npm dedupes every `@memberjunction/*` down to the single host copy (that's how dev-link
  preserves the single-copy invariant). An **installed** app is an ordinary **published
  dependency** that carries its own pinned `@memberjunction/*` versions. Put both in the same
  `node_modules` and npm will very likely **nest a second copy** of `@memberjunction/global`/
  `core` under the installed app → two copies in the process → the `BaseSingleton`/ClassFactory
  registry (keyed on `globalThis`) **splits** → an app's class/resolver registrations land in a
  different factory than the one MJAPI reads → **silent** failure (entities/resolvers simply
  don't appear, with no error). So: if you need to add an app to an instance that already has
  apps, match the existing topology — don't install into a dev-linked instance or vice-versa.
- **Single-copy invariant.** Exactly one resolved `@memberjunction/*` (esp. `global`/
  `core`) per instance — a second copy splits the class factory and silently breaks
  registration. The tool guards this; don't defeat it with manual installs or by mixing
  topologies (above).
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
