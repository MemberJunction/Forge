# MJ Forge Iterative Improvement Loop

## Core Process (REPEAT UNTIL WORLD-CLASS)

1. **Finish current work chunk** — implement features/fixes
2. **Build** — `npm run build` must succeed
3. **Test with Playwright** — run `npx playwright test e2e/feature-test.spec.ts --reporter=list` to verify
4. **Commit & Push** — descriptive commit messages, push to remote as backup
5. **Full Evaluation** — examine the app holistically:
   - Find bugs
   - Tighten UX (small stuff matters)
   - List improvements for world-class DBA tool / Mac app
6. **Build all identified features** — implement everything from the evaluation
7. **Test 100%** with Playwright — every feature must work
8. **Repeat** the cycle

## Quality Bar

The app should be so good that Jony Ive, Steve Jobs and other visionaries would be WOW'd by it. This means:
- Every feature is 100% functional
- UX is polished, consistent, and delightful
- No dead buttons, empty handlers, or stub implementations
- Error states are handled gracefully
- Performance is excellent
- The app feels like a world-class native Mac app

## User's Additional Request (2026-03-21)

Test the backup/restore flow specifically:
- Do NOT restore over an existing DB
- Restore a DB as a NEW database, OR create a new database
- Add some tables via the UI
- Backup the database
- Delete a table
- Restore the backup and verify the table is back

Also: keep this plan file so the loop instructions survive context compaction.

## Current Audit Findings to Address

### Main Process Issues
- SETTINGS IPC handlers completely missing (channels defined but no implementation)
- WORKSPACE handlers not registered in index.ts
- 96/103 IPC handlers lack try/catch error handling
- Some stub implementations (GET_OBJECT_DETAILS returns hardcoded data, REFRESH_NODE returns empty array, GET_VOLUMES returns empty array)

### Renderer Issues
- Empty /features/database/ folders
- Missing loading/empty states in ~15 components
- No breadcrumb navigation
- Shortcuts dialog has incorrect accelerators
- Welcome page openDockerSection() is empty
