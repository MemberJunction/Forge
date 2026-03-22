Build, tag, and publish a new release of MJ Forge to GitHub with CI-built installers for macOS and Windows.

## Inputs

Ask the user:
1. **Version number** (e.g. `0.4.0`) — or suggest the next patch/minor based on current version in `package.json`
2. **Release notes** — or offer to auto-generate from commits since the last tag

## Steps

### 1. Pre-flight checks

- Ensure working tree is clean (`git status` — no uncommitted changes)
- Ensure you're on the `main` branch
- Confirm all packages build successfully: `npm run build`
- Check the current version in `package.json` and the latest git tag

### 2. Bump version

- Update `version` in root `package.json` to the new version number

### 3. Commit and push

- Stage `package.json`
- Commit: `chore: bump version to v{VERSION}`
- Push to `origin main`

### 4. Tag and push tag

- Create annotated tag: `git tag v{VERSION}`
- Push tag: `git push origin v{VERSION}`
- This triggers the GitHub Actions CI workflow (`.github/workflows/build-release.yml`) which builds:
  - macOS: DMG + ZIP for both arm64 and x64
  - Windows: NSIS installer + ZIP for both x64 and arm64

### 5. Monitor CI

- Watch the GitHub Actions run: `gh run list --repo MemberJunction/Forge --limit 1`
- Wait for completion: `gh run watch {RUN_ID} --repo MemberJunction/Forge --exit-status`
- Both `macos-latest` and `windows-latest` jobs must pass
- If a job fails, investigate with `gh run view --job={JOB_ID} --log-failed`, fix, and re-tag

### 6. Verify release

- Check the release page: `gh release view v{VERSION} --repo MemberJunction/Forge`
- Confirm all expected assets are present (typically 16 files: DMGs, ZIPs, EXEs, blockmaps)

### 7. Local test install (macOS)

- Download the arm64 DMG: `gh release download v{VERSION} --repo MemberJunction/Forge --pattern "*arm64.dmg" --dir ~/Downloads`
- Inform the user the DMG is ready at `~/Downloads/` for manual testing
- Remind: right-click → Open to bypass Gatekeeper (app is not yet notarized)

## Troubleshooting

- **`cpu-features` build failure**: The `scripts/before-build.js` hook removes this incompatible optional module before `@electron/rebuild` runs. If it still fails, check that `before-build.js` exists and is referenced in `electron-builder.yml` under `beforeBuild`.
- **Missing dependencies in packaged app**: The `beforeBuild` hook MUST return `true`. Returning `false` tells electron-builder that node_modules are handled externally, which excludes all deps from the asar.
- **Workspace symlink issues**: `scripts/prepare-package.js` replaces the `@mj-forge/shared` symlink with a real copy. This runs automatically as part of `npm run package`.
