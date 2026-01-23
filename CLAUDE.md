# MJ Forge - SQL Dev Manager for Mac

## Project Overview

MJ Forge is a native macOS desktop application providing SSMS-style database management workflows for SQL Server. Built with Electron + Angular + Node.js.

## Tech Stack

- **Desktop Shell**: Electron
- **UI Framework**: Angular 18+ (standalone components)
- **Main Process**: Node.js with TypeScript
- **SQL Connectivity**: node-mssql / tedious (TDS protocol)
- **State Management**: Angular signals + RxJS
- **UI Components**: Angular Material or PrimeNG
- **Build Tools**: electron-builder, Angular CLI

## Project Structure

```
mj-forge/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Main entry point
│   │   ├── ipc/              # IPC handlers
│   │   ├── services/         # Backend services
│   │   │   ├── sql/          # SQL Server operations
│   │   │   ├── docker/       # Docker detection
│   │   │   ├── keychain/     # Credential storage
│   │   │   └── backup/       # Backup/restore logic
│   │   └── utils/            # Main process utilities
│   ├── renderer/             # Angular application
│   │   ├── app/
│   │   │   ├── core/         # Singleton services, guards
│   │   │   ├── shared/       # Shared components, pipes, directives
│   │   │   ├── features/     # Feature modules
│   │   │   │   ├── connections/
│   │   │   │   ├── explorer/
│   │   │   │   ├── query/
│   │   │   │   ├── backup/
│   │   │   │   └── restore/
│   │   │   └── layout/       # Shell, sidebar, panels
│   │   ├── assets/
│   │   └── environments/
│   ├── shared/               # Shared types between main/renderer
│   │   ├── types/
│   │   └── constants/
│   └── preload/              # Electron preload scripts
├── plans/                    # Planning documents
├── scripts/                  # Build/dev scripts
└── resources/                # App icons, native resources
```

## Development Rules

### General Principles

1. **Type Safety First**: Use strict TypeScript throughout. No `any` types unless absolutely necessary with explicit justification.

2. **IPC Boundary**: All communication between renderer and main process MUST go through typed IPC channels. Never expose Node APIs directly to renderer.

3. **Security by Default**:
   - Credentials stored ONLY in macOS Keychain
   - No sensitive data in logs or error messages
   - Validate all user inputs before SQL execution
   - Use parameterized queries where possible

4. **Error Handling**: Every async operation must have proper error handling with user-friendly messages and detailed logs for debugging.

### Electron-Specific Rules

1. **Context Isolation**: Always enabled. Use preload scripts for IPC bridge.

2. **Node Integration**: Disabled in renderer. All Node operations happen in main process.

3. **IPC Pattern**:
   ```typescript
   // Define channels in shared/constants/ipc-channels.ts
   // Use invoke/handle for request-response
   // Use send/on for one-way or streaming
   ```

4. **Window Management**: Single window for v1. All state managed within Angular.

### Angular-Specific Rules

1. **Standalone Components**: Use standalone components exclusively. No NgModules for new code.

2. **Signals**: Prefer Angular signals over BehaviorSubject for component state.

3. **Smart/Dumb Pattern**:
   - Container components handle data/logic
   - Presentational components receive inputs, emit outputs

4. **Lazy Loading**: Feature areas should be lazy-loaded routes.

5. **Change Detection**: Use OnPush strategy for all components.

### SQL Operations Rules

1. **Connection Pooling**: Reuse connections via connection pool. Don't create new connections per query.

2. **Timeout Handling**: All SQL operations must have configurable timeouts.

3. **Transaction Safety**: Wrap multi-statement operations in transactions where appropriate.

4. **Streaming**: For backup/restore, stream progress via IPC events.

5. **T-SQL Transparency**: Store and display the actual T-SQL being executed for user reference.

### Code Style

1. **File Naming**:
   - Angular: `kebab-case.component.ts`, `kebab-case.service.ts`
   - Main process: `kebab-case.ts` or `PascalCase.ts` for classes
   - Types/Interfaces: `PascalCase`

2. **Imports**: Use path aliases (`@main/`, `@renderer/`, `@shared/`)

3. **Comments**: Comment the "why", not the "what". Self-documenting code preferred.

4. **Testing**:
   - Unit tests for services and utilities
   - Integration tests for IPC handlers
   - E2E tests for critical user journeys

### Git Workflow

1. **Commits**: Conventional commits format
   - `feat:` new features
   - `fix:` bug fixes
   - `refactor:` code changes without feature/fix
   - `docs:` documentation
   - `test:` test additions/changes
   - `chore:` build/tooling changes

2. **Branches**: `feature/`, `fix/`, `refactor/` prefixes

### Performance Guidelines

1. **Query Results**: Virtualize large result sets (>1000 rows)
2. **Explorer**: Lazy-load tree nodes on expand
3. **Memory**: Monitor and limit result set caching
4. **Startup**: Defer non-critical initialization

### Forbidden Patterns

- `eval()` or `new Function()` in any context
- Dynamic `require()` or `import()` (use static imports)
- Storing credentials in localStorage, files, or memory longer than necessary
- Direct DOM manipulation in Angular components
- Synchronous IPC calls (`ipcRenderer.sendSync`)
- Console.log in production code (use proper logging service)

## Common Commands

```bash
# Development
npm run dev              # Start in dev mode (hot reload)
npm run dev:main         # Start main process only
npm run dev:renderer     # Start renderer only

# Building
npm run build            # Build for production
npm run package          # Package as .app
npm run package:dmg      # Create distributable DMG

# Testing
npm run test             # Run all tests
npm run test:unit        # Unit tests only
npm run test:e2e         # E2E tests only

# Utilities
npm run lint             # Lint all code
npm run typecheck        # TypeScript check without emit
```

## Environment Setup

1. **Node.js**: v20 LTS or later
2. **npm**: v10+
3. **Xcode CLI Tools**: Required for native modules
4. **Docker** (optional): For local SQL Server testing

## Key Dependencies

- `electron`: Desktop shell
- `@angular/*`: UI framework
- `mssql`: SQL Server connectivity
- `keytar`: macOS Keychain access
- `dockerode`: Docker API client (for container detection)
- `monaco-editor`: Query editor (or CodeMirror)

## Resources

- [Electron Docs](https://www.electronjs.org/docs)
- [Angular Docs](https://angular.dev)
- [node-mssql Docs](https://github.com/tediousjs/node-mssql)
- [SQL Server T-SQL Reference](https://docs.microsoft.com/en-us/sql/t-sql/language-reference)
