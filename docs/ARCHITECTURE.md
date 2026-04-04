# MJ Forge Architecture Guide

## Overview

MJ Forge is a native desktop database IDE supporting SQL Server and PostgreSQL. Built with **Electron** (desktop shell), **Angular 18+** (UI), and **Node.js** (backend services).

```
                 ┌──────────────────────────────────────────┐
                 │              Electron Shell              │
                 │  ┌────────────────┐ ┌─────────────────┐ │
                 │  │  Main Process  │ │ Renderer Process │ │
                 │  │  (Node.js)     │ │ (Angular)        │ │
                 │  │                │ │                  │ │
                 │  │  SQL Providers │ │  Query Editor    │ │
                 │  │  AI Services   │ │  Object Explorer │ │
                 │  │  IPC Handlers  │ │  Connection Mgmt │ │
                 │  │  File I/O      │ │  Results Grid    │ │
                 │  └───────┬────────┘ └────────┬─────────┘ │
                 │          │    IPC (invoke)    │           │
                 │          └───────────────────-┘           │
                 └──────────────────────────────────────────┘
```

## Package Structure

```
packages/
├── main/                 # Electron main process (Node.js)
│   └── src/
│       ├── index.ts      # Entry point, app lifecycle, shutdown cleanup
│       ├── window.ts     # BrowserWindow creation, state persistence
│       ├── menu.ts       # Native menu bar (File, Edit, Query, etc.)
│       ├── ipc/          # IPC handler registration
│       │   ├── connection.ipc.ts   # Connect, test, save, delete
│       │   ├── query.ipc.ts        # Execute, cancel, history, export
│       │   ├── explorer.ipc.ts     # Object tree metadata
│       │   ├── database.ipc.ts     # Create, rename, drop databases
│       │   ├── backup.ipc.ts       # Backup/restore (MSSQL only)
│       │   ├── chat.ipc.ts         # AI chat conversations
│       │   ├── ai.ipc.ts           # AI features (tab rename, analysis)
│       │   └── workspace.ipc.ts    # File/folder operations
│       ├── services/
│       │   ├── sql/                # Database services
│       │   │   ├── dialect/        # SQL dialect abstraction
│       │   │   ├── provider/       # Database provider abstraction
│       │   │   ├── connection-pool.ts   # Multi-engine pool manager
│       │   │   ├── query-executor.ts    # Query execution + PG routing
│       │   │   ├── metadata.ts          # Schema introspection
│       │   │   ├── backup-restore.ts    # Backup/restore (MSSQL)
│       │   │   └── server-filesystem.ts # Server file browsing (MSSQL)
│       │   ├── ai/                # AI services
│       │   │   ├── llm-providers.ts    # Multi-vendor LLM abstraction
│       │   │   ├── ai-service.ts       # Tab rename, SQL generation
│       │   │   ├── chat-service.ts     # Chat conversations + streaming
│       │   │   └── tool-registry.ts    # AI tool calling definitions
│       │   ├── config/            # Persistent storage (electron-store)
│       │   ├── docker/            # Docker container detection
│       │   └── keychain/          # macOS Keychain credential storage
│       └── utils/
│           ├── tsql-builder.ts    # T-SQL statement generation (951 lines)
│           ├── logger.ts          # Structured logging
│           └── singleton.ts       # Singleton base class
│
├── renderer/             # Angular application
│   └── src/app/
│       ├── core/                  # Singleton services and state
│       │   ├── services/          # IPC service, menu, notifications
│       │   └── state/             # Angular signals for app state
│       ├── features/              # Feature modules (lazy-loaded)
│       │   ├── query/             # Query editor tab
│       │   ├── connections/       # Connection management page
│       │   └── chat/              # AI chat panel
│       ├── shared/                # Shared components
│       │   ├── components/        # Results grid, connection dialog, etc.
│       │   └── ...
│       └── layout/                # Shell, sidebar, tab bar
│
├── shared/               # Shared types between main/renderer
│   └── src/
│       ├── types/                 # TypeScript interfaces
│       │   ├── connection.types.ts  # DatabaseEngine, ConnectionProfile
│       │   ├── database.types.ts    # Schema, table, column metadata types
│       │   ├── query.types.ts       # QueryRequest, QueryResult
│       │   ├── ai.types.ts          # AI/chat types
│       │   └── ...
│       ├── constants/
│       │   └── ipc-channels.ts    # All IPC channel name constants
│       └── validators/            # Input validation
│
└── preload/              # Electron preload scripts
    └── src/
        └── index.ts      # Context bridge (927 lines)
```

## Multi-Database Architecture

Forge supports multiple database engines through a dialect + provider abstraction inspired by [MemberJunction](https://github.com/MemberJunction/MJ).

### SQL Dialect Layer

The `SQLDialect` abstract class encapsulates all engine-specific SQL syntax:

```
dialect/
├── sql-dialect.ts      # Abstract base class
├── mssql-dialect.ts    # SQL Server: [brackets], sys.*, GO, BACKUP/RESTORE
├── pg-dialect.ts       # PostgreSQL: "double-quotes", pg_catalog, information_schema
└── index.ts            # Factory: getDialect(engine) → dialect instance
```

**Key responsibilities:**
- Identifier quoting (`[name]` vs `"name"` vs `` `name` ``)
- Database context switching (`USE [db]` vs connection-level)
- DDL generation (CREATE/ALTER/DROP DATABASE)
- All metadata queries (list databases, schemas, tables, columns, indexes, FKs, etc.)
- Feature flags (`supportsBackupRestore`, `supportsExtendedProperties`, etc.)

### Database Provider Layer

```
provider/
├── database-provider.ts  # Abstract base class
└── pg-provider.ts        # PostgreSQL provider using node-postgres
```

The `ConnectionPoolManager` (connection-pool.ts) manages both MSSQL and PG pools in parallel maps and routes operations based on `profile.engine`.

### Connection Profile

```typescript
interface ConnectionProfile {
  engine: DatabaseEngine;  // 'mssql' | 'postgresql' | 'mysql'
  server: string;
  port: number;            // Auto-set: 1433 / 5432 / 3306
  // ... other fields
}
```

Legacy profiles without `engine` are backfilled to `'mssql'` at read time.

### Adding a New Engine

1. Create `dialect/mysql-dialect.ts` extending `SQLDialect`
2. Create `provider/mysql-provider.ts` extending `DatabaseProvider`
3. Register in `dialect/index.ts`
4. Add pool management in `connection-pool.ts`
5. Add routing in `query-executor.ts`

## IPC Communication

All renderer↔main communication uses typed IPC channels defined in `shared/constants/ipc-channels.ts`.

**Pattern:** `ipcRenderer.invoke(channel, ...args)` → `ipcMain.handle(channel, handler)`

```
Renderer (Angular)                    Main (Node.js)
┌─────────────┐                       ┌──────────────┐
│ IpcService   │ ─── invoke ────────→ │ IPC Handlers │
│ (Observable) │ ←── result ────────  │ (safeHandle) │
└─────────────┘                       └──────────────┘
```

Channel naming: `domain:action` (e.g., `query:execute`, `connection:test`)

The preload script (`packages/preload/src/index.ts`) bridges the IPC channels using `contextBridge.exposeInMainWorld`.

## State Management

The renderer uses **Angular signals** for reactive state:

| Service | Purpose | Key Signals |
|---------|---------|-------------|
| `ConnectionStateService` | Active connection, profiles, databases | `activeConnectionId`, `profiles`, `databases` |
| `TabStateService` | Open tabs, active tab, tab content | `tabs`, `activeTab` |
| `QueryHistoryStateService` | Query execution history | `entries`, `isLoading` |
| `QueryResultsStateService` | Cached result snapshots | `snapshots` |
| `AIStateService` | AI model/vendor configuration | `settings`, `vendors` |

## AI Integration

Forge supports multiple LLM providers through `llm-providers.ts`:

| Provider | Models |
|----------|--------|
| Google | Gemini family |
| Anthropic | Claude family |
| OpenAI | GPT family |
| Groq | Llama, Mixtral |
| Cerebras | Fast inference |

**Key rule:** All AI calls go through the provider abstraction. Never make direct API calls.

**Features:**
- Chat with tool calling (SQL execution, schema inspection)
- Tab auto-rename via AI
- SQL generation from natural language
- Query analysis and optimization suggestions

## Query Editor

The query editor uses **Monaco Editor** with engine-aware syntax highlighting:

- **SQL Server connections:** Monaco language `sql` (T-SQL)
- **PostgreSQL connections:** Monaco language `pgsql`
- **MySQL connections:** Monaco language `mysql`

Language updates reactively when the active connection changes.

### Flyway/Skyway Placeholder Detection

When executing SQL containing `${placeholder}` tokens (Flyway syntax), Forge prompts for values before execution. Values are remembered globally in `localStorage`.

### Key Shortcuts

| Shortcut | Action |
|----------|--------|
| F5 | Execute query |
| Ctrl/Cmd+E | Execute query (SSMS-style) |
| Ctrl/Cmd+Enter | Execute query |
| Ctrl/Cmd+Shift+F | Format SQL |
| Ctrl/Cmd+G | Go to line |

## Security Model

1. **Context Isolation:** Always enabled. Renderer has no direct Node.js access.
2. **Credentials:** Stored in macOS Keychain via `keytar`. Never in files or memory longer than necessary.
3. **SQL Safety:** Identifiers escaped via dialect-specific quoting. String literals escaped.
4. **IPC Validation:** All IPC handlers wrapped in `safeHandle` for error boundaries.
5. **No eval/new Function:** Strictly forbidden in all contexts.

## App Lifecycle & Shutdown

The `before-quit` handler performs ordered cleanup:

1. Stop pool cleanup timer
2. Close workspace file watchers
3. Cancel all active SQL queries
4. Stop backup/restore progress intervals
5. Abort active AI streams
6. Close all SQL connection pools
7. Force exit after 3-second timeout if cleanup hangs

## Testing

**Framework:** Jest with ts-jest

```bash
npm test              # Run all tests
npx jest --coverage   # Run with coverage report
```

**Test structure:**
- `*.spec.ts` files co-located with source
- `packages/main/src/__mocks__/keytar.ts` — mock for native keytar module
- Root `jest.config.js` runs both `shared` and `main` projects

**CI:** GitHub Actions runs on every PR to `main`:
- Type-check all packages (main, renderer, preload)
- Run full test suite with coverage
- Coverage artifact uploaded for review

## Common Commands

```bash
npm run dev              # Start in dev mode (hot reload)
npm run build            # Build for production
npm run package          # Package as .app
npm run package:dmg      # Create distributable DMG
npm test                 # Run all tests
npm run lint             # Lint all code
npm run typecheck        # TypeScript check without emit
```
