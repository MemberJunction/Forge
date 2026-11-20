# Release lines

MJ Forge is a standalone Electron desktop application (not an MJ OpenApp — it has no `mj-app.json`
or OpenApp SQL migrations). It adopts the MemberJunction release-line branch model adapted for
standalone semantic-versioned lines (`lts/<major>.<minor>`) while preserving the existing `main`
workflow and tag-based desktop releases (`build-release.yml` on `v*` tags).

| Branch | Purpose | What lands there |
|---|---|---|
| `main` | Active development (default branch) & primary release source | All new work, first |
| `next` | Optional integration branch (mirrors `main` at cut; ready if development moves off `main`) | Future development if adopted |
| `lts/X.Y` | Release / LTS line for `X.Y.x` | Cherry-picked backports from `main` (or `next`) |

## The line status record

[`release-lines.json`](../release-lines.json) lists each standalone release line: its branch
(`lts/X.Y`), the semver it was cut at (`version`, never changed once cut), whether it is `open` or
`lts`, and whether it releases through `main` or from its own branch. CI reads the authoritative
copy on `main` (the configured `developmentBranch`). Freezing a line to `lts` is a support
decision: have one of the owners in `.github/CODEOWNERS` review the change.

A line is `open` (features and fixes backported from `main`) or `lts` (fixes only). An LTS line
never reopens.

## Daily flow

1. Open your PR against `main` (or `next` if adopted).
2. Add a `backport lts/X.Y` label for each release line the change should reach (before or after
   merging). When the PR merges, the backport workflow opens one cherry-pick PR per labelled line.
3. If a cherry-pick hits a conflict, the workflow opens a draft PR for you to finish. If you add a
   commit of your own to resolve the conflict, add the `backport-adjusted` label so reviewers and
   `lines: on next first` recognize the conflict-resolution commit.
4. Direct PRs into `lts/*` that bypass `main` / `next` are rejected by `lines: on next first`.

## Releases

Desktop builds remain driven by `.github/workflows/build-release.yml` whenever a `v*` tag is pushed
(e.g. `v0.5.0`, `v0.5.1`). Tagging a commit on `lts/X.Y` builds and attaches macOS and Windows
release artifacts via the same workflow without any changes to `build-release.yml`.

## The checks

| Check | On | What it enforces |
|---|---|---|
| `lines: record` | PRs into `main` / `next` | `release-lines.json` is valid, line identity never changes, LTS never reopens, backport labels name real lines, and script unit tests pass |
| `lines: on next first` | PRs into `lts/*` | Every commit carries `(cherry picked from commit <sha>)` with `<sha>` on `main` or `next`; conflict fixes need `backport-adjusted`; line-cut PRs require a maintainer/admin-applied `line-cut` label |
| `Type-check & Test` | All PRs (`main`, `next`, `lts/*`) | Shared build, main/renderer/preload typecheck, and Vitest suite with coverage |

## Cutting a new release line

1. On `main`, add the new line to `release-lines.json` (`status: "open"`, `version: "X.Y.0"`,
   `releasesThrough: "main"`) and update the previous line to `releasesThrough: "branch"`. Have one
   of its `CODEOWNERS` review and merge.
2. Create the `backport lts/X.Y` label and ensure the `protect-lts` ruleset covers `refs/heads/lts/*`.
3. Push `lts/X.Y` from `main`.
4. Open a `ci/cut-lts-X.Y` PR into `lts/X.Y` setting `.github/CODEOWNERS` to `* @bg-BC @rkihm-BC`,
   apply the `line-cut` label (maintainer/admin only), and request code-owner review.
