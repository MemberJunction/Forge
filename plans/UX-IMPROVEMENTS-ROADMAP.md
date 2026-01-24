# MJ Forge: World-Class UX & Feature Improvements Roadmap

## Executive Summary

This document outlines prioritized improvements to transform MJ Forge from a solid v1.0 MVP into an indispensable tool that Mac developers using SQL Server will love.

### Current State (v1.0 MVP - Complete)

| Feature | Status | Quality |
|---------|--------|---------|
| Connection Management | ✅ Complete | Excellent - Keychain integration, pooling |
| Query Editor | ✅ Complete | Great - Monaco, F5, history, export |
| Object Explorer | ✅ Complete | Solid - Lazy load, context menus |
| Results Grid | ✅ Complete | Good - ag-grid, multiple result sets |
| Backup/Restore | ✅ Complete | Excellent - Progress streaming, wizards |
| Docker Integration | ✅ Complete | Great - Auto-detection, volume mapping |
| Table Properties | ✅ Complete | Comprehensive - All metadata types |
| Theming | ✅ CSS Ready | Dark applied, light defined but no toggle |

---

## Tier 1: Quick Wins (1-2 days each)

These leverage existing infrastructure for maximum impact with minimal effort.

### 1.1 Theme Toggle (Hours)

**Status:** CSS is already perfect. Just need the UI toggle.

**Implementation:**
```typescript
// Add to settings-panel.component.ts or status-bar.component.ts
toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  this.settingsService.set('theme', next);
}
```

**UI:** Add 🌙/☀️ toggle to status bar or settings menu.

---

### 1.2 SQL Formatting (Hours)

**Status:** Button exists at line 119 in query.component.ts. Just wire it up.

**Dependencies:**
```bash
npm install sql-formatter
```

**Implementation:**
```typescript
import { format } from 'sql-formatter';

formatSql(): void {
  if (!this.editor) return;
  const sql = this.editor.getValue();
  const formatted = format(sql, { language: 'tsql' });
  this.editor.setValue(formatted);
  this.notification.success('SQL formatted');
}
```

---

### 1.3 Actual Query Cancellation (Hours)

**Status:** QueryExecutor has structure but doesn't actually cancel running queries.

**Implementation:**
```typescript
// In packages/main/src/services/sql/query-executor.ts
private activeRequests = new Map<string, mssql.Request>();

async execute(options: QueryOptions): Promise<QueryResult> {
  const request = pool.request();
  this.activeRequests.set(options.queryId, request);

  try {
    const result = await request.query(options.sql);
    // ... existing logic
  } finally {
    this.activeRequests.delete(options.queryId);
  }
}

cancel(queryId: string): boolean {
  const request = this.activeRequests.get(queryId);
  if (request) {
    request.cancel();
    this.activeRequests.delete(queryId);
    return true;
  }
  return false;
}
```

---

### 1.4 State Persistence (Half Day)

**Status:** App state not saved across restarts. Critical for UX.

**Implementation:**
```typescript
// Add to main process - packages/main/src/services/config/app-state.ts
interface AppState {
  windowBounds: { x: number; y: number; width: number; height: number };
  lastConnectionId: string | null;
  lastDatabase: string | null;
  editorHeight: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  recentQueries: string[]; // Last 10
  openTabs: TabState[];
}

// Save on window close via 'before-quit' event
// Restore on startup in window.ts
```

**What to persist:**
- Window size and position
- Last active connection
- Last selected database
- Editor/results pane split ratio
- Sidebar width
- Open query tabs with content

---

## Tier 2: High-Impact Features (1-2 weeks each)

### 2.1 ⌘K Command Palette

**Impact:** 🔥🔥🔥🔥🔥 - The single most impactful UX feature for power users.

**Design:**
```
┌─────────────────────────────────────────────────────────┐
│ ⌘K                                                      │
├─────────────────────────────────────────────────────────┤
│  > backup                                               │
├─────────────────────────────────────────────────────────┤
│  🗄️ Backup Database...              Backup current DB   │
│  📋 Backup history                  View past backups   │
│  ─────────────────────────────────────────────────────  │
│  Recent                                                 │
│  🔌 Connect to Production                               │
│  📊 SELECT * FROM Users             2 min ago           │
└─────────────────────────────────────────────────────────┘
```

**Implementation Approach:**
1. Create `CommandPaletteComponent` as modal overlay
2. Register commands from all features via `CommandRegistry` service
3. Fuzzy search with fuse.js library
4. Recent items weighted from query history
5. Keyboard navigation (↑↓ Enter Esc)

**Commands to Register:**
- All menu actions (New Query, Backup, Restore, etc.)
- Recent connections (Connect to X)
- Recent queries (with preview)
- Object search (table/view/proc names)
- Database switch (Use database X)
- Theme toggle
- Settings
- Keyboard shortcuts help

**Files to Create:**
- `packages/renderer/src/app/shared/components/command-palette/command-palette.component.ts`
- `packages/renderer/src/app/core/services/command-registry.service.ts`

---

### 2.2 Instant Object Search

**Impact:** 🔥🔥🔥🔥 - Finding objects in large databases is painful. Make it instant.

**Design:**
```
┌──────────────────────────────────────────────────────┐
│ 🔍 Find object...                         ⌘⇧O        │
├──────────────────────────────────────────────────────┤
│  usr                                                 │
├──────────────────────────────────────────────────────┤
│  📋 dbo.Users                     Table   OrdersDB   │
│  📋 dbo.UserRoles                 Table   OrdersDB   │
│  🔧 dbo.sp_GetUserById            Proc    OrdersDB   │
│  📋 auth.UserSessions             Table   AuthDB     │
└──────────────────────────────────────────────────────┘
```

**Implementation:**
1. Index all objects from MetadataService cache after connection
2. Background indexing triggered on database change
3. Fuse.js for fuzzy matching with configurable threshold
4. Reuse object type icons from tree-view component
5. Click result → navigate to object in explorer + open properties tab

**Performance Target:** Sub-50ms search across 10,000+ objects

---

### 2.3 Intelligent Error Messages

**Impact:** 🔥🔥🔥🔥 - SQL errors are cryptic. Help developers fix them.

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ ❌ Conversion Error                                         │
├─────────────────────────────────────────────────────────────┤
│ Error converting data type varchar to int                   │
│                                                             │
│ 📍 Location: Line 3, Column "CustomerAge"                   │
│                                                             │
│ 💡 This usually happens when:                               │
│    • Column contains non-numeric text like "N/A" or ""      │
│    • There are NULL values being converted                  │
│                                                             │
│ 🔧 Quick Fixes:                                             │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ TRY_CAST(CustomerAge AS INT)                        │  │
│    │ -- Returns NULL instead of error for bad values     │  │
│    └─────────────────────────────────────────────────────┘  │
│    [Apply Fix]  [Show Bad Data]  [Learn More]               │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
1. Create error code → explanation mapping for top 50 SQL Server errors
2. Parse error message to extract context (line number, column name, object name)
3. Generate suggested fixes with one-click apply to editor
4. "Show Bad Data" generates diagnostic query
5. "Learn More" links to Microsoft docs

**Error Codes to Map First:**
- 208: Invalid object name
- 207: Invalid column name
- 245: Conversion failed
- 515: Cannot insert NULL
- 547: Constraint violation
- 1205: Deadlock victim
- 2627: Duplicate key
- 4060: Cannot open database
- 18456: Login failed

---

### 2.4 Monaco IntelliSense

**Impact:** 🔥🔥🔥🔥🔥 - Table/column autocomplete is expected in modern tools.

**Implementation:**
```typescript
// In query.component.ts after Monaco initialization
monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' ', '['],
  provideCompletionItems: async (model, position) => {
    const tables = await this.metadataService.getTablesForDatabase(this.selectedDatabase);
    const word = model.getWordUntilPosition(position);

    // Context-aware: after FROM/JOIN suggest tables, after table. suggest columns
    const lineContent = model.getLineContent(position.lineNumber);
    const isAfterTable = this.detectTableContext(lineContent, position);

    if (isAfterTable) {
      const columns = await this.metadataService.getColumnsForTable(tableName);
      return {
        suggestions: columns.map(c => ({
          label: c.name,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: `[${c.name}]`,
          detail: `${c.dataType}${c.isNullable ? '' : ' NOT NULL'}`,
          documentation: c.description || undefined,
        }))
      };
    }

    return {
      suggestions: [
        ...tables.map(t => ({
          label: t.name,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: `[${t.schema}].[${t.name}]`,
          detail: `Table (${t.rowCount?.toLocaleString() || '?'} rows)`,
        })),
        ...SQL_KEYWORDS.map(kw => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
        })),
      ]
    };
  }
});
```

**Features:**
- Table name completion after FROM, JOIN, UPDATE, INSERT INTO
- Column name completion after table alias or table name with dot
- SQL keyword completion
- Stored procedure completion after EXEC
- Schema-aware (shows schema prefix)
- Row count hints for tables

---

## Tier 3: Differentiating Features (2-4 weeks each)

### 3.1 Visual Execution Plan

**Impact:** 🔥🔥🔥 - Essential for query optimization.

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ Execution Plan                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐      ┌─────────────┐      ┌──────────┐        │
│  │ SELECT  │──────│ Hash Match  │──────│ Table    │        │
│  │  100%   │      │ Inner Join  │      │ Scan     │        │
│  │         │      │    45%      │      │ Orders   │        │
│  └─────────┘      └─────────────┘      │   55%    │        │
│                          │             └──────────┘        │
│                   ┌──────┴──────┐                          │
│                   │ Index Seek  │                          │
│                   │ Customers   │                          │
│                   │    <1%      │                          │
│                   └─────────────┘                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ ⚠️ Warning: Table Scan on Orders (500K rows)               │
│ 💡 Consider adding index on OrderDate column               │
│ [Create Index Script]                                       │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
1. Execute query with `SET SHOWPLAN_XML ON` prefix
2. Parse XML execution plan response
3. Render as interactive tree/graph using D3.js or custom SVG
4. Color-code by cost percentage (green < 10%, yellow < 30%, red > 30%)
5. Click node for detailed statistics
6. Highlight expensive operations with warnings
7. Generate index recommendations for table scans

**Files to Create:**
- `packages/renderer/src/app/shared/components/execution-plan/execution-plan.component.ts`
- `packages/renderer/src/app/shared/components/execution-plan/plan-node.component.ts`
- `packages/main/src/services/sql/execution-plan-parser.ts`

---

### 3.2 One-Click Docker SQL Server

**Impact:** 🔥🔥🔥🔥 - Own the Mac + Docker experience completely.

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ 🐳 New SQL Server Container                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Name:        [dev-sqlserver           ]                    │
│  Version:     [SQL Server 2022 ▼       ]                    │
│               • SQL Server 2022 (mcr.microsoft.com/mssql/server:2022-latest)
│               • SQL Server 2019 (mcr.microsoft.com/mssql/server:2019-latest)
│               • SQL Server 2017 (mcr.microsoft.com/mssql/server:2017-latest)
│                                                             │
│  SA Password: [••••••••••••  ] 🎲 Generate                  │
│  Port:        [1433                    ]                    │
│                                                             │
│  ☑️ Persist data to ~/Docker/sqlserver                      │
│  ☑️ Auto-connect after creation                             │
│  ☐ Include sample database (AdventureWorks)                 │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  [Create Container]                        [Cancel]         │
│                                                             │
│  ℹ️ Requires Docker Desktop running (~1.5GB download)       │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
1. Add IPC channel `docker:create-container` in docker.ipc.ts
2. Use dockerode to:
   - Pull image if not present (with progress)
   - Create container with proper config
   - Set up volume mounts for data persistence
   - Configure port mapping
3. Auto-create connection profile on success
4. Optional: restore AdventureWorks from embedded .bak file

**Docker Configuration:**
```typescript
const containerConfig = {
  Image: 'mcr.microsoft.com/mssql/server:2022-latest',
  name: containerName,
  Env: [
    'ACCEPT_EULA=Y',
    `MSSQL_SA_PASSWORD=${password}`,
  ],
  HostConfig: {
    PortBindings: { '1433/tcp': [{ HostPort: port.toString() }] },
    Binds: persistData ? [`${dataPath}:/var/opt/mssql`] : [],
  },
};
```

---

### 3.3 Natural Language to SQL

**Impact:** 🔥🔥🔥 - AI assistance that's genuinely useful.

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ 💬 Ask about your data...                         ⌘⇧A      │
├─────────────────────────────────────────────────────────────┤
│  "show me customers who ordered more than $1000 last month" │
│                                                             │
│  Generated SQL:                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ SELECT c.CustomerName, SUM(o.TotalAmount) AS Total     │ │
│  │ FROM Customers c                                       │ │
│  │ JOIN Orders o ON c.CustomerID = o.CustomerID           │ │
│  │ WHERE o.OrderDate >= DATEADD(MONTH, -1, GETDATE())     │ │
│  │ GROUP BY c.CustomerName                                │ │
│  │ HAVING SUM(o.TotalAmount) > 1000                       │ │
│  │ ORDER BY Total DESC                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [Run Query]  [Edit in Editor]  [Explain]                   │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
1. Integrate Claude API via Anthropic SDK
2. Store API key in macOS Keychain (like connection passwords)
3. Build schema context from metadata cache
4. Prompt engineering for T-SQL generation
5. Always show generated SQL (transparency principle)
6. "Explain" mode: describe what query does in plain English
7. Optional: Local LLM support via Ollama for sensitive data

**Prompt Template:**
```
You are a SQL Server expert. Given the following schema:
{schema_json}

Generate a T-SQL query for: {user_request}

Rules:
- Use proper T-SQL syntax
- Include appropriate JOINs
- Use meaningful aliases
- Add ORDER BY when relevant
- Return only the SQL, no explanation
```

---

## Tier 4: Polish & Delight

### 4.1 Keyboard Shortcuts System

**Current Status:**
| Action | Shortcut | Status |
|--------|----------|--------|
| Execute query | F5 | ✅ Implemented |

**Shortcuts to Add:**
| Action | Shortcut | Priority |
|--------|----------|----------|
| New query tab | ⌘N | High |
| Close tab | ⌘W | High |
| Command palette | ⌘K | High |
| Object search | ⌘⇧O | High |
| Format SQL | ⌘⇧F | High |
| Toggle history | ⌘H | Medium |
| Next tab | ⌘⇧] | Medium |
| Previous tab | ⌘⇧[ | Medium |
| Focus editor | ⌘1 | Medium |
| Focus results | ⌘2 | Medium |
| Backup database | ⌘B | Low |
| Restore database | ⌘R | Low |
| Toggle sidebar | ⌘\ | Low |
| Settings | ⌘, | Low |

**Shortcut Cheatsheet Feature:**
- Hold ⌘ for 1.5 seconds → Show overlay with all shortcuts
- Or access via Help menu / ⌘?

---

### 4.2 Results Grid Enhancements

**Current:** Basic ag-grid with toolbar.

**Enhancements:**
- **Column resize** with double-click header edge to auto-fit
- **Column hide/show** via right-click on header
- **Quick filter** per column (input in header row)
- **Copy options** via ⌘C context menu:
  - Copy cell value
  - Copy row as JSON
  - Copy row as INSERT statement
  - Copy column values
- **JSON/XML formatting** for text cells (detect and pretty-print)
- **NULL highlighting** with distinct gray italic style
- **Numeric formatting** with thousand separators
- **Date formatting** with locale-aware display
- **Row stripe** alternating background for readability

---

### 4.3 Connection Health Indicator

**Current:** Simple connected/disconnected icon.

**Enhanced Status Bar:**
```
┌──────────────────────────────────────────────────────────────┐
│ ● Production SQL │ OrdersDB │ Pool: 3/10 │ 12ms │ 🐳        │
└──────────────────────────────────────────────────────────────┘
```

**Components:**
- Connection status indicator (●/○)
- Server name (click to switch)
- Database name (click to switch)
- Pool status (active/max connections)
- Latency (periodic ping)
- Docker indicator if container

---

### 4.4 Query Tab Improvements

**Current:** Basic tabs with generic names.

**Enhancements:**
- Tab title shows first 20 chars of query or filename
- Dirty indicator (● before name) for unsaved changes
- Right-click context menu:
  - Close
  - Close Others
  - Close All
  - Close to the Right
- Drag tabs to reorder
- Double-click tab to rename
- Middle-click to close
- Tab overflow menu when too many tabs

---

### 4.5 Microinteractions & Feedback

**Add subtle animations for delight:**
- **Connection success:** Green pulse on status indicator
- **Query running:** Pulsing blue spinner + elapsed timer in status bar
- **Query complete:** Brief green flash on results tab
- **Export complete:** Checkmark animation on button
- **Error:** Gentle shake on error panel
- **Copy:** "Copied!" tooltip at cursor position (fade after 1s)
- **Long operation:** Progress ring with ETA

---

## Priority Roadmap Summary

### Phase 1: Quick Wins (Week 1)
| Feature | Effort | Impact |
|---------|--------|--------|
| Theme toggle | 2 hours | High |
| SQL formatting | 2 hours | High |
| Query cancellation fix | 4 hours | Medium |
| State persistence | 1 day | High |

### Phase 2: Core UX (Weeks 2-4)
| Feature | Effort | Impact |
|---------|--------|--------|
| ⌘K Command palette | 1 week | Very High |
| Instant object search | 3 days | High |
| Keyboard shortcuts | 2 days | High |
| Results grid enhancements | 3 days | Medium |

### Phase 3: Intelligence (Weeks 5-8)
| Feature | Effort | Impact |
|---------|--------|--------|
| Intelligent error messages | 1 week | High |
| Monaco IntelliSense | 1.5 weeks | Very High |
| Visual execution plan | 2 weeks | Medium |

### Phase 4: Differentiation (Weeks 9-12)
| Feature | Effort | Impact |
|---------|--------|--------|
| One-click Docker SQL Server | 1 week | High |
| Natural language to SQL | 1.5 weeks | Medium |
| Table data editing | 2 weeks | Medium |

---

## Success Metrics

### User Experience
- Time to first query: < 60 seconds (new user)
- Object search latency: < 50ms
- Command palette response: < 100ms
- Query execution feedback: Immediate (< 16ms to show spinner)

### Adoption
- Daily active usage: 5+ sessions/week for retained users
- Feature discovery: 80% use command palette within first week
- Error recovery: 70% of errors resolved without external search

### Quality
- Crash rate: < 0.1%
- Query success rate: > 99% (when SQL is valid)
- Connection reliability: > 99.5%

---

## Appendix: Competitive Analysis

### vs. SSMS (Windows only)
| Feature | SSMS | MJ Forge |
|---------|------|----------|
| Mac support | ❌ | ✅ |
| Startup time | Slow (~10s) | Fast (<3s) |
| IntelliSense | ✅ Excellent | 🔄 Planned |
| Execution plans | ✅ Excellent | 🔄 Planned |
| Modern UI | ❌ Dated | ✅ Modern |

### vs. Azure Data Studio
| Feature | ADS | MJ Forge |
|---------|-----|----------|
| Mac support | ✅ | ✅ |
| Startup time | Slow (~8s) | Fast (<3s) |
| Resource usage | Heavy | Light |
| Backup/Restore | Basic | ✅ Full wizards |
| Docker integration | ❌ | ✅ Native |
| Focus | Multi-DB | SQL Server focused |

### vs. TablePlus
| Feature | TablePlus | MJ Forge |
|---------|-----------|----------|
| SQL Server depth | Generic | ✅ Deep |
| Backup/Restore | ❌ | ✅ Full |
| Docker awareness | ❌ | ✅ Native |
| T-SQL transparency | ❌ | ✅ Always shown |
| Price | $99/year | Free |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-24 | Claude | Initial roadmap based on v1.0 analysis |
