# Part V: Implementation Task List

## Overview

This section provides a comprehensive, ordered task list for implementing MJ Forge. Tasks are organized into major phases, each with detailed sub-phases and individual work items.

### Task Priority Legend

| Priority | Meaning |
|----------|---------|
| 🔴 P0 | Critical path - blocks other work |
| 🟠 P1 | High priority - core functionality |
| 🟡 P2 | Medium priority - important features |
| 🟢 P3 | Lower priority - nice to have for v1 |

### Task Status Tracking

```
[ ] Not started
[~] In progress
[x] Completed
[-] Blocked
[!] Needs review
```

---

## Phase 0: Project Foundation

**Goal:** Establish the development environment, project structure, and core infrastructure.

### 0.1 Project Initialization

```
[ ] 0.1.1  🔴 Initialize npm project with TypeScript
           - Create package.json with project metadata
           - Configure TypeScript (tsconfig.json) for both main/renderer
           - Set up path aliases (@main, @renderer, @shared, @preload)

[ ] 0.1.2  🔴 Install core dependencies
           Dependencies:
           - electron, electron-builder
           - @angular/core, @angular/cli (v18+)
           - mssql (SQL Server driver)
           - keytar (Keychain access)
           - dockerode (Docker API)
           - rxjs, uuid
           Dev dependencies:
           - typescript, ts-node
           - eslint, prettier
           - jest, @testing-library/*
           - concurrently, wait-on

[ ] 0.1.3  🔴 Create directory structure
           - Set up src/main, src/renderer, src/preload, src/shared
           - Create plans/, scripts/, resources/, tests/
           - Add .gitignore, .eslintrc, .prettierrc

[ ] 0.1.4  🟠 Configure build pipeline
           - Set up Angular CLI for renderer build
           - Configure electron-builder for packaging
           - Create npm scripts (dev, build, package)
           - Configure hot reload for development
```

### 0.2 Electron Shell

```
[ ] 0.2.1  🔴 Create main process entry point
           File: src/main/index.ts
           - Initialize Electron app
           - Handle app lifecycle events (ready, quit, activate)
           - Set up error handling and crash reporting

[ ] 0.2.2  🔴 Implement window management
           File: src/main/window.ts
           - Create BrowserWindow with security settings
           - Configure context isolation, sandbox
           - Handle window state persistence (size, position)
           - Implement minimize to dock behavior

[ ] 0.2.3  🔴 Create preload script
           File: src/preload/index.ts
           - Set up contextBridge
           - Define and expose ForgeAPI interface
           - Implement IPC wrapper functions
           - Add TypeScript declarations for window.forge

[ ] 0.2.4  🟠 Implement application menu
           File: src/main/menu.ts
           - Create macOS-native menu structure
           - Add standard Edit menu (copy/paste/undo)
           - Add View menu (reload, dev tools in dev mode)
           - Add Help menu (documentation, about)
           - Wire up keyboard shortcuts
```

### 0.3 Angular Application Bootstrap

```
[ ] 0.3.1  🔴 Initialize Angular application
           - Run ng new with standalone components
           - Configure for Electron (remove SSR, adjust base href)
           - Set up SCSS and global styles
           - Configure Angular build output for Electron

[ ] 0.3.2  🔴 Create app shell components
           Files:
           - src/renderer/app/layout/shell/shell.component.ts
           - src/renderer/app/layout/sidebar/sidebar.component.ts
           - src/renderer/app/layout/status-bar/status-bar.component.ts
           Implementation:
           - Three-column layout (sidebar, content, optional panel)
           - Resizable sidebar with drag handle
           - Fixed status bar at bottom

[ ] 0.3.3  🔴 Set up routing
           File: src/renderer/app/app.routes.ts
           - Define lazy-loaded feature routes
           - Implement route guards for connection state
           - Configure default route (welcome or workspace)

[ ] 0.3.4  🟠 Create IPC service
           File: src/renderer/app/core/services/ipc.service.ts
           - Wrap window.forge API
           - Handle NgZone for callbacks
           - Add error handling and logging
```

### 0.4 Shared Infrastructure

```
[ ] 0.4.1  🔴 Define IPC channels
           File: src/shared/constants/ipc-channels.ts
           - Define all channel names as constants
           - Group by feature (connection, database, backup, etc.)
           - Add TypeScript const assertion for type safety

[ ] 0.4.2  🔴 Create type definitions
           Files:
           - src/shared/types/connection.types.ts
           - src/shared/types/database.types.ts
           - src/shared/types/query.types.ts
           - src/shared/types/backup.types.ts
           - src/shared/types/docker.types.ts

[ ] 0.4.3  🟠 Port MJ utilities
           Files:
           - src/main/utils/singleton.ts (from @memberjunction/global)
           - src/main/utils/object-cache.ts
           - src/main/utils/json-utils.ts
           - Add unit tests for each utility
```

### 0.5 Development Workflow

```
[ ] 0.5.1  🟠 Set up development scripts
           - Create dev script (concurrent main + renderer)
           - Add hot reload for renderer
           - Configure source maps for debugging
           - Create debug configurations for VS Code

[ ] 0.5.2  🟠 Configure linting and formatting
           - Set up ESLint with TypeScript rules
           - Configure Prettier
           - Add pre-commit hooks with husky
           - Set up lint-staged

[ ] 0.5.3  🟡 Set up testing infrastructure
           - Configure Jest for unit tests
           - Set up Playwright for E2E tests
           - Create test utilities and mocks
           - Add CI configuration (GitHub Actions)

[ ] 0.5.4  🟡 Documentation setup
           - Create contributing guidelines
           - Add code of conduct
           - Set up JSDoc for public APIs
           - Create development setup guide
```

---

## Phase 1: Connection Management

**Goal:** Enable users to connect to SQL Server instances and manage connection profiles.

### 1.1 Keychain Integration

```
[ ] 1.1.1  🔴 Implement credential store
           File: src/main/services/keychain/credential-store.ts
           - Use keytar for macOS Keychain access
           - Store credentials keyed by connection ID
           - Implement get, set, delete operations
           - Handle Keychain access errors gracefully

[ ] 1.1.2  🟠 Add credential store IPC handlers
           - Implement save credential handler
           - Implement delete credential handler
           - Never expose passwords in IPC responses
           - Add logging (without sensitive data)
```

### 1.2 SQL Connection Service

```
[ ] 1.2.1  🔴 Create connection pool manager
           File: src/main/services/sql/connection-pool.ts
           - Extend BaseSingleton for singleton pattern
           - Implement pool creation with mssql config
           - Handle connection pooling and reuse
           - Implement cleanup of idle connections
           - Add connection health checks

[ ] 1.2.2  🔴 Implement connection testing
           File: src/main/services/sql/connection-tester.ts
           - Test connection with provided config
           - Retrieve server version on success
           - Parse and categorize connection errors
           - Return structured error guidance

[ ] 1.2.3  🔴 Create connection IPC handlers
           File: src/main/ipc/connection.ipc.ts
           - Handle connection:test
           - Handle connection:connect
           - Handle connection:disconnect
           - Handle connection:list
           - Handle connection:save
           - Handle connection:delete
```

### 1.3 Connection Profile Storage

```
[ ] 1.3.1  🔴 Implement profile storage
           File: src/main/services/config/connections.ts
           - Store profiles in app data directory
           - Use JSON file with encryption for at-rest security
           - Implement CRUD operations for profiles
           - Handle profile migrations (schema changes)

[ ] 1.3.2  🟠 Add profile validation
           File: src/shared/validators/connection.validator.ts
           - Validate hostname format
           - Validate port range
           - Validate required fields
           - Sanitize profile names
```

### 1.4 Connection UI

```
[ ] 1.4.1  🔴 Create connection list component
           File: src/renderer/app/features/connections/connection-list/
           - Display saved connections with status
           - Show connection/disconnection states
           - Enable quick connect via double-click
           - Support context menu (edit, delete)

[ ] 1.4.2  🔴 Create connection form component
           File: src/renderer/app/features/connections/connection-form/
           - Input fields for all connection properties
           - Password field with visibility toggle
           - Test connection button with feedback
           - Advanced options accordion
           - Form validation with error messages

[ ] 1.4.3  🟠 Create welcome screen
           File: src/renderer/app/features/welcome/welcome.component.ts
           - Hero section with app branding
           - "Detect Docker" prominent button
           - "Add Manually" secondary button
           - Recent connections list
           - Handle empty state gracefully

[ ] 1.4.4  🟠 Implement connection state management
           File: src/renderer/app/core/state/connection.state.ts
           - Use Angular signals for reactive state
           - Track connection profiles
           - Track active connection
           - Track connection statuses (connecting, connected, error)
```

### 1.5 Docker Detection

```
[ ] 1.5.1  🔴 Implement Docker detector service
           File: src/main/services/docker/detector.ts
           - Check if Docker is running
           - List containers with SQL Server images
           - Extract port mappings
           - Extract volume mappings
           - Handle Docker not installed/not running

[ ] 1.5.2  🔴 Create Docker detection IPC handlers
           File: src/main/ipc/docker.ipc.ts
           - Handle docker:detect
           - Handle docker:get-volumes
           - Handle docker:start-container

[ ] 1.5.3  🟠 Create Docker detection UI
           File: src/renderer/app/features/connections/docker-detect/
           - Show detected containers as cards
           - Display container state (running/stopped)
           - Show port and volume mappings
           - One-click connect for running containers
           - Option to start stopped containers
           - Fallback to manual if Docker not available
```

---

## Phase 2: Object Explorer

**Goal:** Display database objects in a navigable tree structure.

### 2.1 Metadata Service

```
[ ] 2.1.1  🔴 Create metadata query service
           File: src/main/services/sql/metadata.ts
           - Query sys.databases for database list
           - Query sys.tables for tables
           - Query sys.views for views
           - Query sys.procedures for stored procedures
           - Query sys.schemas for schema grouping (optional)

[ ] 2.1.2  🔴 Implement metadata caching
           - Use ObjectCache for database lists
           - Cache invalidation on database changes
           - TTL-based expiration (1 minute)
           - Manual refresh support

[ ] 2.1.3  🔴 Create explorer IPC handlers
           File: src/main/ipc/explorer.ipc.ts
           - Handle explorer:get-databases
           - Handle explorer:get-tables
           - Handle explorer:get-views
           - Handle explorer:get-procedures
           - Handle explorer:refresh
```

### 2.2 Tree View Component

```
[ ] 2.2.1  🔴 Create tree view base component
           File: src/renderer/app/shared/components/tree-view/
           - Generic tree node interface
           - Recursive tree rendering
           - Expand/collapse with arrow keys
           - Keyboard navigation (up/down/left/right)
           - Single and multi-select support

[ ] 2.2.2  🔴 Implement lazy loading for tree
           - Load children on expand only
           - Show loading indicator
           - Handle load errors
           - Retry mechanism for failed loads

[ ] 2.2.3  🟠 Add tree view accessibility
           - ARIA tree role and properties
           - Screen reader announcements
           - Focus management
           - Keyboard shortcuts
```

### 2.3 Explorer Implementation

```
[ ] 2.3.1  🔴 Create explorer tree component
           File: src/renderer/app/features/explorer/explorer-tree/
           - Root level: connections (grouped)
           - Second level: databases
           - Third level: object categories (Tables, Views, Procs)
           - Fourth level: individual objects

[ ] 2.3.2  🔴 Create database node component
           File: src/renderer/app/features/explorer/database-node/
           - Show database name and status
           - Icon indicating online/offline/system
           - Right-click context menu
           - Double-click to open query

[ ] 2.3.3  🟠 Create context menu component
           File: src/renderer/app/features/explorer/context-menu/
           - Dynamic menu based on node type
           - Database: Create, Rename, Delete, Backup, Restore
           - Table: Open definition, Select top 1000
           - Keyboard shortcut hints
           - Position near click location

[ ] 2.3.4  🟠 Add search/filter functionality
           - Filter input at top of explorer
           - Filter databases by name
           - Filter objects within database
           - Highlight matching text
           - Clear filter button

[ ] 2.3.5  🟠 Implement explorer state management
           File: src/renderer/app/core/state/explorer.state.ts
           - Track expanded nodes
           - Track selected node
           - Cache loaded object lists
           - Handle refresh operations
```

---

## Phase 3: Query Workspace

**Goal:** Provide a tabbed query editor with results and messages.

### 3.1 Query Execution

```
[ ] 3.1.1  🔴 Create query executor service
           File: src/main/services/sql/query-executor.ts
           - Execute SQL queries via connection pool
           - Handle multiple result sets
           - Capture row counts and messages
           - Support query cancellation
           - Measure execution time

[ ] 3.1.2  🔴 Create query IPC handlers
           File: src/main/ipc/query.ipc.ts
           - Handle query:execute
           - Handle query:cancel
           - Stream large result sets (future)
           - Return structured results with metadata
```

### 3.2 Query Editor

```
[ ] 3.2.1  🔴 Integrate code editor
           File: src/renderer/app/features/query/query-editor/
           Choice: Monaco Editor or CodeMirror 6
           - Basic SQL syntax highlighting
           - Line numbers
           - Basic key bindings
           - Selection support

[ ] 3.2.2  🔴 Create query editor component
           - Editor container with toolbar
           - Connection/database selector
           - Run button (full query)
           - Run selection button
           - Save query button
           - Connection status indicator

[ ] 3.2.3  🟠 Add editor enhancements
           - Multi-cursor support
           - Find and replace
           - Code folding
           - Bracket matching
           - Auto-indentation
```

### 3.3 Results Display

```
[ ] 3.3.1  🔴 Create results grid component
           File: src/renderer/app/features/query/results-grid/
           - Virtualized table for large results
           - Column headers from result metadata
           - Cell selection (single, row, column)
           - Copy selected cells
           - Resize columns

[ ] 3.3.2  🔴 Create messages panel component
           File: src/renderer/app/features/query/messages-panel/
           - Display row counts
           - Display PRINT output
           - Display errors with line numbers
           - Display warnings
           - Timestamp each message

[ ] 3.3.3  🟠 Add results panel features
           - Toggle between Results/Messages/T-SQL
           - Export results to CSV
           - Export results to JSON
           - Copy as INSERT statements
           - Column sorting
           - Null value display
```

### 3.4 Tab Management

```
[ ] 3.4.1  🔴 Create tab bar component
           File: src/renderer/app/layout/tab-bar/
           - Display query tabs
           - Close button on each tab
           - Unsaved indicator (dot)
           - Tab overflow handling (scroll or dropdown)
           - New tab button

[ ] 3.4.2  🔴 Implement tab state
           - Track open tabs
           - Track active tab
           - Track unsaved state per tab
           - Persist tabs across sessions
           - Confirm close on unsaved

[ ] 3.4.3  🟠 Add tab features
           - Drag to reorder tabs
           - Middle-click to close
           - Right-click context menu (Close, Close Others)
           - Pin tabs
           - Tab tooltips (full path)
```

### 3.5 Query State Management

```
[ ] 3.5.1  🔴 Implement query state
           File: src/renderer/app/core/state/query.state.ts
           - Track query tabs
           - Track query content per tab
           - Track execution state (idle, running, completed)
           - Track results per tab
           - Handle tab switching

[ ] 3.5.2  🟠 Add query history
           - Store recent queries (last 100)
           - Persist across sessions
           - Search history
           - Re-run from history
           - Clear history option
```

---

## Phase 4: Database Operations

**Goal:** Implement create, rename, and delete database operations.

### 4.1 T-SQL Builder

```
[ ] 4.1.1  🔴 Create T-SQL builder utility
           File: src/main/services/sql/tsql-builder.ts
           - Safe identifier escaping
           - Safe string escaping
           - CREATE DATABASE generation
           - ALTER DATABASE for rename
           - DROP DATABASE generation
           - Always return the T-SQL for transparency

[ ] 4.1.2  🔴 Create database IPC handlers
           File: src/main/ipc/database.ipc.ts
           - Handle database:create
           - Handle database:rename
           - Handle database:delete
           - Handle database:get-info
           - Return T-SQL with each operation
```

### 4.2 Create Database

```
[ ] 4.2.1  🔴 Create database dialog component
           File: src/renderer/app/features/database/create-dialog/
           - Database name input with validation
           - Collation dropdown (optional)
           - Recovery model dropdown (optional)
           - T-SQL preview panel
           - Create and Cancel buttons

[ ] 4.2.2  🟠 Implement database name validation
           - Check SQL Server naming rules
           - Check for reserved words
           - Check for duplicates
           - Real-time validation feedback

[ ] 4.2.3  🟠 Add create database flow
           - Open dialog from context menu
           - Validate inputs
           - Show T-SQL preview
           - Execute creation
           - Refresh explorer on success
           - Show success toast
           - Handle errors with guidance
```

### 4.3 Rename Database

```
[ ] 4.3.1  🔴 Create rename dialog component
           File: src/renderer/app/features/database/rename-dialog/
           - Current name (read-only)
           - New name input with validation
           - "Close connections" checkbox
           - Warning about active connections
           - T-SQL preview panel

[ ] 4.3.2  🟠 Implement rename flow
           - Check for active connections
           - Warn if connections exist
           - Execute SINGLE_USER, MODIFY NAME, MULTI_USER
           - Refresh explorer
           - Show success toast
           - Handle errors (file locks, permissions)
```

### 4.4 Delete Database

```
[ ] 4.4.1  🔴 Create delete confirmation dialog
           File: src/renderer/app/features/database/delete-dialog/
           - Database info panel (size, tables, last backup)
           - Warning message (cannot be undone)
           - "Type database name to confirm" input
           - Close connections checkbox
           - T-SQL preview panel
           - Delete button (disabled until name matches)

[ ] 4.4.2  🔴 Implement safety checks
           - Block deletion of system databases
           - Require exact name match
           - Show database size and object count
           - Suggest backup before delete

[ ] 4.4.3  🟠 Implement delete flow
           - Validate confirmation input
           - Execute SINGLE_USER if needed
           - Execute DROP DATABASE
           - Refresh explorer
           - Show success toast
           - Handle errors (files in use, permissions)
```

---

## Phase 5: Backup Operations

**Goal:** Enable full database backups with progress streaming.

### 5.1 Backup Service

```
[ ] 5.1.1  🔴 Create backup service
           File: src/main/services/sql/backup.ts
           - Generate backup T-SQL
           - Execute backup command
           - Poll dm_exec_requests for progress
           - Handle backup completion
           - Handle backup errors

[ ] 5.1.2  🔴 Implement progress polling
           - Query sys.dm_exec_requests for percent_complete
           - Calculate bytes processed
           - Estimate remaining time
           - Send progress updates via IPC

[ ] 5.1.3  🔴 Create backup IPC handlers
           File: src/main/ipc/backup.ipc.ts
           - Handle backup:start
           - Handle backup:cancel
           - Send backup:progress events
           - Send backup:complete event
           - Send backup:error event
```

### 5.2 Volume Path Handling

```
[ ] 5.2.1  🔴 Create volume mapper
           File: src/main/services/docker/volume-mapper.ts
           - Translate local paths to container paths
           - Detect if path is accessible to SQL Server
           - Suggest volume mount commands
           - Handle non-Docker servers

[ ] 5.2.2  🟠 Add path validation
           - Check path exists (for local)
           - Check path is writable
           - Validate path is within volume mount
           - Show clear guidance for path issues
```

### 5.3 Backup UI

```
[ ] 5.3.1  🔴 Create backup panel component
           File: src/renderer/app/features/backup/backup-panel/
           - Database info display
           - Backup type selection (Full, Copy Only)
           - Destination path input with browse
           - Docker volume mapping info
           - Compression checkbox
           - T-SQL preview panel
           - Start Backup button

[ ] 5.3.2  🔴 Create backup progress component
           File: src/renderer/app/features/backup/backup-progress/
           - Progress bar with percentage
           - Bytes processed / total
           - Elapsed time
           - Estimated remaining time
           - Live log display
           - Cancel button

[ ] 5.3.3  🟠 Implement backup completion UI
           - Success state with file info
           - "Reveal in Finder" button (if local)
           - "Copy Path" button
           - Error state with guidance
           - Retry button on error
```

### 5.4 Backup Flow

```
[ ] 5.4.1  🔴 Implement end-to-end backup flow
           - Validate destination path
           - Translate path if Docker
           - Build backup T-SQL
           - Execute backup
           - Stream progress to UI
           - Handle completion
           - Refresh explorer (update last backup time)

[ ] 5.4.2  🟠 Add backup history
           - Store recent backups (last 20)
           - Show backup history in panel
           - Quick restore from history
```

---

## Phase 6: Restore Operations

**Goal:** Enable database restore with file relocation wizard.

### 6.1 Restore Service

```
[ ] 6.1.1  🔴 Create restore service
           File: src/main/services/sql/restore.ts
           - Read backup file metadata (FILELISTONLY)
           - Read backup header (HEADERONLY)
           - Generate restore T-SQL with MOVE
           - Execute restore command
           - Poll for restore progress

[ ] 6.1.2  🔴 Create restore IPC handlers
           File: src/main/ipc/restore.ipc.ts
           - Handle restore:read-info
           - Handle restore:start
           - Handle restore:cancel
           - Send restore:progress events
           - Send restore:complete event
           - Send restore:error event
```

### 6.2 Restore Wizard

```
[ ] 6.2.1  🔴 Create restore wizard shell
           File: src/renderer/app/features/restore/restore-wizard/
           - Multi-step wizard layout
           - Step indicator (1. Source, 2. Configure, 3. Review)
           - Navigation buttons (Back, Next, Cancel)
           - State management across steps

[ ] 6.2.2  🔴 Create source selection step
           File: src/renderer/app/features/restore/source-step/
           - File picker for local files
           - Server path input for remote
           - List .bak files in selected directory
           - Show file size and date
           - Docker volume path translation
           - Validate backup file accessibility

[ ] 6.2.3  🔴 Create configuration step
           File: src/renderer/app/features/restore/config-step/
           - Display backup metadata
           - Target database name input
           - Overwrite existing checkbox (with warning)
           - File relocation table
             - Logical name, type, original path
             - Editable destination path
           - Reset to defaults button

[ ] 6.2.4  🔴 Create review step
           File: src/renderer/app/features/restore/review-step/
           - Summary of all options
           - Full T-SQL preview
           - Confirmation checkbox
           - Start Restore button

[ ] 6.2.5  🔴 Create restore progress component
           File: src/renderer/app/features/restore/restore-progress/
           - Similar to backup progress
           - Progress bar with percentage
           - Live log output
           - Cancel button
           - Completion state with next steps
```

### 6.3 Restore Flow

```
[ ] 6.3.1  🔴 Implement end-to-end restore flow
           - Read backup metadata
           - Validate target database name
           - Generate MOVE clauses for files
           - Check for existing database
           - Execute restore
           - Stream progress
           - Bring database online
           - Refresh explorer

[ ] 6.3.2  🟠 Handle restore edge cases
           - Backup from newer SQL version (warn)
           - Missing volume mounts (guide)
           - Existing database without REPLACE (block)
           - Corrupted backup file (error guidance)
           - Insufficient disk space (warning)
```

---

## Phase 7: Polish & Refinement

**Goal:** Enhance UX, fix edge cases, and prepare for release.

### 7.1 Notification System

```
[ ] 7.1.1  🟠 Create toast notification component
           File: src/renderer/app/shared/components/toast/
           - Success, error, warning, info variants
           - Auto-dismiss with configurable duration
           - Manual dismiss button
           - Action buttons (Reveal, Retry)
           - Stack multiple toasts
           - Animation enter/exit

[ ] 7.1.2  🟠 Create notification service
           File: src/renderer/app/core/services/notification.service.ts
           - Show toast from anywhere
           - Handle toast queue
           - Persist important notifications
           - Optional macOS native notifications
```

### 7.2 Error Handling

```
[ ] 7.2.1  🟠 Create error handler service
           - Categorize SQL Server errors
           - Map error codes to guidance
           - Format user-friendly messages
           - Log detailed errors for debugging

[ ] 7.2.2  🟠 Implement error guidance
           - Login failed: check credentials
           - Connection failed: check server/port
           - Path not found: Docker volume guide
           - Database in use: close connections option
           - Permission denied: admin guidance

[ ] 7.2.3  🟠 Add error dialogs
           - Detailed error view
           - Copy error details button
           - Technical details accordion
           - Suggested actions
           - Link to documentation
```

### 7.3 Drag and Drop

```
[ ] 7.3.1  🟡 Implement file drop handling
           - Detect .bak file drop → open restore wizard
           - Detect .sql file drop → open in query tab
           - Show drop overlay during drag
           - Validate file types on drop

[ ] 7.3.2  🟡 Implement tree drag to editor
           - Drag table → insert table name
           - Drag column → insert column name
           - Drag procedure → insert EXEC
           - Visual feedback during drag
```

### 7.4 Keyboard Shortcuts

```
[ ] 7.4.1  🟠 Implement global shortcuts
           - Cmd+N: New query
           - Cmd+W: Close tab
           - Cmd+S: Save query
           - Cmd+Shift+R: Refresh explorer
           - Cmd+K: Command palette (future)

[ ] 7.4.2  🟠 Implement context shortcuts
           - Cmd+Enter: Run query
           - Cmd+Shift+Enter: Run selection
           - Cmd+B: Backup (database selected)
           - Cmd+R: Restore (server selected)

[ ] 7.4.3  🟡 Create shortcuts reference
           - Shortcuts dialog (Cmd+/)
           - Display all available shortcuts
           - Group by context
```

### 7.5 Session Persistence

```
[ ] 7.5.1  🟠 Persist window state
           - Save window size and position
           - Save sidebar width
           - Restore on next launch

[ ] 7.5.2  🟠 Persist workspace state
           - Save open tabs
           - Save query content (including unsaved)
           - Save active tab
           - Restore on next launch
           - Handle file changes while closed

[ ] 7.5.3  🟡 Implement crash recovery
           - Auto-save query content periodically
           - Detect unclean shutdown
           - Offer to restore tabs on restart
```

### 7.6 Performance Optimization

```
[ ] 7.6.1  🟡 Optimize large result sets
           - Implement virtual scrolling in grid
           - Limit initial fetch (1000 rows)
           - Load more on scroll
           - Memory management for results

[ ] 7.6.2  🟡 Optimize explorer loading
           - Lazy load tree nodes
           - Cache metadata with TTL
           - Background refresh
           - Efficient diff updates

[ ] 7.6.3  🟡 Optimize startup
           - Defer non-critical initialization
           - Lazy load features
           - Minimize initial bundle size
           - Preload critical resources
```

---

## Phase 8: Testing & Documentation

**Goal:** Ensure quality and provide comprehensive documentation.

### 8.1 Unit Testing

```
[ ] 8.1.1  🟠 Test main process services
           - Connection pool manager tests
           - T-SQL builder tests
           - Credential store tests (mocked)
           - Docker detector tests (mocked)
           - Metadata service tests

[ ] 8.1.2  🟠 Test Angular components
           - Connection form tests
           - Tree view tests
           - Results grid tests
           - Dialog tests
           - State management tests

[ ] 8.1.3  🟠 Test shared utilities
           - Validator tests
           - Type guard tests
           - JSON utility tests
           - Cache tests
```

### 8.2 Integration Testing

```
[ ] 8.2.1  🟠 Test IPC communication
           - Round-trip IPC tests
           - Error propagation tests
           - Cancellation tests
           - Progress streaming tests

[ ] 8.2.2  🟡 Test with real SQL Server
           - Connection tests with Docker SQL
           - CRUD operation tests
           - Backup/restore tests
           - Performance tests with large DBs
```

### 8.3 E2E Testing

```
[ ] 8.3.1  🟡 Set up E2E framework
           - Configure Playwright for Electron
           - Create test utilities
           - Set up test fixtures

[ ] 8.3.2  🟡 Implement critical path tests
           - First run to connection
           - Create database workflow
           - Backup database workflow
           - Restore database workflow
           - Query execution workflow
```

### 8.4 Documentation

```
[ ] 8.4.1  🟠 Create user documentation
           - Getting started guide
           - Connection setup (Docker and remote)
           - Backup/restore guide
           - Troubleshooting guide

[ ] 8.4.2  🟠 Create developer documentation
           - Architecture overview
           - Development setup
           - Code organization
           - Contributing guidelines

[ ] 8.4.3  🟡 Create in-app help
           - Contextual help tooltips
           - Error guidance integration
           - Link to documentation
```

---

## Phase 9: Build & Distribution

**Goal:** Package and distribute the application.

### 9.1 Build Configuration

```
[ ] 9.1.1  🔴 Configure production builds
           - Optimize Angular build
           - Minify and tree-shake
           - Configure source maps
           - Set production environment

[ ] 9.1.2  🔴 Configure electron-builder
           - Set up macOS build
           - Configure code signing
           - Set up notarization
           - Create DMG installer

[ ] 9.1.3  🟠 Create build scripts
           - Build all targets
           - Run pre-build checks
           - Version management
           - Changelog generation
```

### 9.2 Distribution

```
[ ] 9.2.1  🟠 Set up code signing
           - Obtain Apple Developer certificate
           - Configure Keychain access
           - Integrate with build

[ ] 9.2.2  🟠 Set up notarization
           - Configure Apple notarization
           - Automate in build process
           - Handle notarization failures

[ ] 9.2.3  🟡 Configure auto-update
           - Set up update server (GitHub releases)
           - Integrate electron-updater
           - Test update flow
           - Handle update errors
```

### 9.3 Release Process

```
[ ] 9.3.1  🟠 Create release checklist
           - Version bump
           - Changelog update
           - Final testing
           - Build and sign
           - GitHub release
           - Announce release

[ ] 9.3.2  🟡 Set up CI/CD
           - GitHub Actions for builds
           - Automated testing
           - Release automation
           - Asset publishing
```

---

## Summary: Milestone Mapping

| Phase | Milestone | Priority | Dependency |
|-------|-----------|----------|------------|
| 0 | Project Foundation | 🔴 P0 | None |
| 1 | Connection Management | 🔴 P0 | Phase 0 |
| 2 | Object Explorer | 🔴 P0 | Phase 1 |
| 3 | Query Workspace | 🔴 P0 | Phase 1 |
| 4 | Database Operations | 🟠 P1 | Phase 2 |
| 5 | Backup Operations | 🟠 P1 | Phase 4 |
| 6 | Restore Operations | 🟠 P1 | Phase 5 |
| 7 | Polish & Refinement | 🟡 P2 | Phase 6 |
| 8 | Testing & Documentation | 🟠 P1 | Phase 7 |
| 9 | Build & Distribution | 🟠 P1 | Phase 8 |

---

## Appendix: Quick Reference

### Critical Path (Minimum Viable Product)

```
Phase 0 → Phase 1.1-1.4 → Phase 2.1-2.3 → Phase 3.1-3.4 →
Phase 4.1-4.4 → Phase 5.1-5.4 → Phase 6.1-6.3 → Phase 9.1-9.2
```

### Parallelizable Work

```
After Phase 0:
├── Phase 1 (Connections)
│   └── Phase 2 (Explorer) ──┐
│                            ├── Phase 4 (DB Operations)
│   └── Phase 3 (Queries) ───┘

After Phase 4:
├── Phase 5 (Backup)
└── Phase 6 (Restore) [after Phase 5]

Parallel throughout:
├── Phase 8 (Testing)
└── Phase 7 (Polish)
```

---

*End of Implementation Task List*
