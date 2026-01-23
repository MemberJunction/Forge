# MJ Forge — System Plan

> **Version:** 1.0.0
> **Last Updated:** January 2026
> **Status:** Planning Phase

---

# Part I: Business Overview

## Executive Summary

**MJ Forge** is a native macOS desktop application that delivers SSMS-style database management workflows to Mac developers working with SQL Server. It fills a critical gap in the Mac developer toolchain by providing an intuitive, UI-first experience for database operations that currently require either running Windows VMs or executing fragile CLI commands.

### The Opportunity

The rise of containerized development has made SQL Server accessible to Mac developers via Docker, yet the tooling hasn't kept pace. Azure Data Studio and VS Code extensions handle querying well, but fall short on the core DBA-lite operations developers need daily:

- **Create** new databases for feature branches
- **Clone** production data via backup/restore for local testing
- **Rename** databases during migration testing
- **Delete** old development databases to reclaim space

### Our Solution

MJ Forge is a purpose-built, Mac-native application that makes these operations as simple as they are in SSMS on Windows — while adding modern touches like Docker container detection, streaming progress visualization, and full T-SQL transparency.

---

## Problem Statement

### The Current Pain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CURRENT MAC SQL SERVER WORKFLOW                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────────────────┐ │
│   │              │      │              │      │                          │ │
│   │  Developer   │─────▶│  VS Code /   │─────▶│  Queries work great! ✓   │ │
│   │   on Mac     │      │    ADS       │      │                          │ │
│   │              │      │              │      └──────────────────────────┘ │
│   └──────────────┘      └──────────────┘                                    │
│          │                                                                  │
│          │  But when they need to backup/restore/create...                  │
│          ▼                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │  Option A: Start Windows VM, launch SSMS, wait 5 minutes...         │ │
│   │  Option B: Google T-SQL syntax, fight with docker exec, hope it works│ │
│   │  Option C: Ask teammate on Windows to do it                          │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                           ❌ FRICTION EVERYWHERE                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Quantified Impact

| Friction Point | Time Lost | Frequency | Weekly Cost |
|----------------|-----------|-----------|-------------|
| Starting VM for SSMS | 5-10 min | 3-4x/day | 1-2 hours |
| CLI backup/restore trial & error | 15-30 min | 2-3x/week | 30-90 min |
| Debugging path issues in Docker | 10-20 min | 1-2x/week | 10-40 min |
| Context switching between tools | 2-5 min | 10x/day | 2-4 hours |

**Total estimated productivity loss: 4-8 hours per developer per week**

---

## Target Users

### Primary Persona: "The Mac SQL Developer"

```
┌────────────────────────────────────────────────────────────────────────────┐
│  👤  ALEX — Senior Full-Stack Developer                                    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ENVIRONMENT                          DAILY WORKFLOW                       │
│  ─────────────────────                ──────────────────────               │
│  • MacBook Pro M3                     • 60% coding, 40% data work          │
│  • Docker Desktop                     • Creates 2-3 test DBs per sprint    │
│  • SQL Server in container            • Restores prod backup weekly        │
│  • VS Code + mssql extension          • Runs ad-hoc queries constantly     │
│                                                                            │
│  PAIN POINTS                          SUCCESS CRITERIA                     │
│  ─────────────────────                ──────────────────────               │
│  • "I just want to restore a .bak     • "I can restore a backup in        │
│    without 10 minutes of setup"         under 2 minutes of clicking"       │
│  • "Docker paths are confusing"       • "The app understands my Docker    │
│  • "I forget the T-SQL syntax           setup automatically"               │
│    for these operations"              • "I can see exactly what T-SQL      │
│                                         is being run"                      │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Secondary Persona: "The Remote Server Developer"

```
┌────────────────────────────────────────────────────────────────────────────┐
│  👤  JORDAN — Backend Developer                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ENVIRONMENT                          DAILY WORKFLOW                       │
│  ─────────────────────                ──────────────────────               │
│  • MacBook Air                        • Connects to dev/staging servers    │
│  • No local SQL Server                • Manages multiple connection        │
│  • Azure SQL + on-prem servers          profiles                           │
│  • Multiple projects                  • Needs quick switching              │
│                                                                            │
│  PAIN POINTS                          SUCCESS CRITERIA                     │
│  ─────────────────────                ──────────────────────               │
│  • "Managing connection strings       • "All my connections are saved      │
│    across projects is messy"            securely and switch instantly"     │
│  • "I need different permissions      • "Clear warnings before I do        │
│    on different servers"                something destructive"             │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Out of Scope Persona: "The Production DBA"

This user needs Always On, profiler, maintenance plans, policy management — features we explicitly do **not** target in v1 or v2.

---

## Solution Overview

### Product Vision

> **MJ Forge transforms SQL Server database management on Mac from a friction-filled chore into a seamless, transparent, and even enjoyable experience.**

### Core Value Propositions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MJ FORGE VALUE PILLARS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │                   │  │                   │  │                   │       │
│  │   🎯 FOCUSED      │  │   🔍 TRANSPARENT  │  │   🐳 DOCKER-AWARE │       │
│  │                   │  │                   │  │                   │       │
│  │  Does 6 things    │  │  Every operation  │  │  Auto-detects     │       │
│  │  exceptionally    │  │  shows the exact  │  │  containers and   │       │
│  │  well instead of  │  │  T-SQL being      │  │  handles path     │       │
│  │  100 things       │  │  executed         │  │  mapping          │       │
│  │  poorly           │  │                   │  │  intelligently    │       │
│  │                   │  │                   │  │                   │       │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘       │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │                   │  │                   │  │                   │       │
│  │   🔒 SECURE       │  │   ⚡ FAST         │  │   🍎 MAC-NATIVE   │       │
│  │                   │  │                   │  │                   │       │
│  │  Credentials in   │  │  < 2 clicks to    │  │  Feels at home    │       │
│  │  Keychain only.   │  │  any common       │  │  on macOS with    │       │
│  │  Multi-step       │  │  operation.       │  │  proper UX        │       │
│  │  confirmation     │  │  Instant          │  │  patterns         │       │
│  │  for destructive  │  │  connection       │  │                   │       │
│  │  actions          │  │  switching        │  │                   │       │
│  │                   │  │                   │  │                   │       │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Feature Matrix

| Feature | v1.0 | v1.1 | v2.0 |
|---------|:----:|:----:|:----:|
| **Connection Management** | ✅ | ✅ | ✅ |
| - Multiple profiles | ✅ | ✅ | ✅ |
| - Keychain storage | ✅ | ✅ | ✅ |
| - Docker detection | ✅ | ✅ | ✅ |
| - Connection grouping | — | ✅ | ✅ |
| - Azure AD auth | — | — | ✅ |
| **Database Operations** | ✅ | ✅ | ✅ |
| - Create database | ✅ | ✅ | ✅ |
| - Rename database | ✅ | ✅ | ✅ |
| - Delete database (safe) | ✅ | ✅ | ✅ |
| - Clone database | — | ✅ | ✅ |
| **Backup & Restore** | ✅ | ✅ | ✅ |
| - Full backup | ✅ | ✅ | ✅ |
| - Restore with relocate | ✅ | ✅ | ✅ |
| - Streaming progress | ✅ | ✅ | ✅ |
| - Differential backup | — | ✅ | ✅ |
| - Backup scheduling | — | — | ✅ |
| **Object Explorer** | ✅ | ✅ | ✅ |
| - Tables/Views/Procs | ✅ | ✅ | ✅ |
| - Schema grouping | — | ✅ | ✅ |
| - Script as CREATE | ✅ | ✅ | ✅ |
| - Table data viewer | — | ✅ | ✅ |
| **Query Workspace** | ✅ | ✅ | ✅ |
| - Multi-tab editor | ✅ | ✅ | ✅ |
| - Results grid | ✅ | ✅ | ✅ |
| - Messages pane | ✅ | ✅ | ✅ |
| - Syntax highlighting | ✅ | ✅ | ✅ |
| - IntelliSense | — | — | ✅ |
| - Query history | — | ✅ | ✅ |

---

## Success Metrics

### North Star Metric

> **Weekly Active Backup/Restore Operations**
>
> Target: 60% of weekly active users perform at least one backup or restore operation per week.

### Supporting Metrics

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SUCCESS METRICS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ADOPTION                              ENGAGEMENT                           │
│  ─────────────────────                 ─────────────────────                │
│  • Time to first connection: < 2 min   • Sessions per user/week: ≥ 5       │
│  • Activation rate: ≥ 40%              • Operations per session: ≥ 3       │
│  • Week 1 retention: ≥ 60%             • Query tabs opened: ≥ 2/session    │
│                                                                             │
│  RELIABILITY                           SATISFACTION                         │
│  ─────────────────────                 ─────────────────────                │
│  • Create DB success: ≥ 99%            • NPS: ≥ 50                          │
│  • Backup success: ≥ 99%               • Support tickets/user: < 0.1/month │
│  • Restore success: ≥ 98%              • "Would recommend": ≥ 80%           │
│  • Clear error rate: ≥ 95%                                                  │
│                                                                             │
│  PERFORMANCE                                                                │
│  ─────────────────────                                                      │
│  • App launch: < 3 seconds                                                  │
│  • Connection establishment: < 2 seconds                                    │
│  • Explorer load (< 100 DBs): < 2 seconds                                   │
│  • Query result render (1K rows): < 500ms                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Business Model (Future Consideration)

### v1: Free / Open Source

- Build community and gather feedback
- Establish credibility in the Mac developer community
- No licensing complexity

### v2+: Potential Monetization

| Tier | Price | Features |
|------|-------|----------|
| **Community** | Free | Core features, single connection |
| **Pro** | $9/mo | Unlimited connections, query history, themes |
| **Team** | $29/mo/seat | Shared connections, team snippets, audit log |

*Note: Business model is exploratory. v1 focuses purely on value delivery.*

---

## Competitive Landscape

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          COMPETITIVE POSITIONING                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           Full DBA Suite                                    │
│                               ▲                                             │
│                               │                                             │
│                               │    SSMS (Windows only)                      │
│                               │         ●                                   │
│                               │                                             │
│                               │                                             │
│   Mac-First ◀─────────────────┼─────────────────────▶ Windows-First        │
│                               │                                             │
│         ●                     │                                             │
│     MJ Forge                  │         ● Azure Data Studio                 │
│   (our target)                │           (cross-platform but               │
│                               │            limited backup/restore)          │
│                               │                                             │
│              ● TablePlus      │    ● VS Code + mssql                        │
│                (multi-DB,     │      (query only)                           │
│                 no backup/    │                                             │
│                 restore)      │                                             │
│                               │                                             │
│                               ▼                                             │
│                        Query-Only Tools                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Competitive Advantages

| Competitor | Gap MJ Forge Fills |
|------------|-------------------|
| **SSMS** | Windows-only. VM overhead unacceptable for quick tasks |
| **Azure Data Studio** | No backup/restore UI. Heavy Electron app, slow startup |
| **TablePlus** | No backup/restore. Generic multi-DB, not SQL Server optimized |
| **VS Code + mssql** | Query-only. No database management operations |
| **DBeaver** | Generic. Complex UI. No Docker awareness |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Docker path complexity confuses users | High | Medium | Intelligent detection + clear guidance UI |
| SQL Server auth edge cases (AAD, Windows) | Medium | High | Focus v1 on SQL auth; clear "not supported" messaging |
| Azure SQL backup/restore differences | Medium | Medium | Document limitations; separate UX path |
| Performance with large databases | Low | Medium | Streaming UI; virtualized grids; clear progress |
| Electron security vulnerabilities | Low | High | Context isolation; no node in renderer; regular updates |

---

## MemberJunction Integration

MJ Forge leverages select packages from the MemberJunction ecosystem:

### Adopted Packages

| Package | Usage |
|---------|-------|
| `@memberjunction/global` | Singleton patterns, ClassFactory, ObjectCache, JSON utilities |
| `@memberjunction/config` | Connection profile management (v1.1+) |

### Adopted Patterns

- **BaseSingleton** — For ConnectionManager, SettingsManager, CacheManager
- **ClassFactory** — For extensible SQL provider registration
- **ObjectCache** — For query result and metadata caching

### Explicitly Not Adopted

- Metadata-driven entity system (too heavy for focused app)
- AI agent framework (future consideration for v2+ SQL optimization)
- Heavy dependency packages (storage, encryption with cloud SDKs)

---

*Continue to [Part II: UX Design & Mockups →](02-ux-mockups.md)*
