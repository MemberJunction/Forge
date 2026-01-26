<p align="center">
  <img src="resources/logo.png" alt="MJ Forge" width="128" height="128">
</p>

<h1 align="center">MJ Forge</h1>

<p align="center">
  <strong>The missing SSMS workflows on macOS</strong>
</p>

<p align="center">
  Create • Rename • Delete • Backup • Restore<br>
  SQL Server database management, finally native on Mac.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#why-mj-forge">Why MJ Forge?</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/SQL%20Server-2017%2B-red?style=flat-square" alt="SQL Server">
  <img src="https://img.shields.io/badge/status-beta-orange?style=flat-square" alt="Status">
</p>

---

## The Problem

You're a developer on Mac. You run SQL Server in Docker. VS Code and Azure Data Studio are great for queries, but when you need to:

- **Create** a new database for a feature branch
- **Backup** your local DB before a risky migration
- **Restore** a production dump for debugging
- **Delete** old test databases to free up space

...you're stuck. Start a Windows VM? `docker exec` with T-SQL you can never remember? Ask a teammate on Windows?

**That ends now.**

---

## Features

### Docker-Aware by Design

MJ Forge automatically detects SQL Server containers running on your machine. It understands volume mounts, so backup/restore paths just work.

```
┌───────────────────────────────────────────────────────────────────┐
│  🐳 Docker SQL Server Detection                                   │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  📦 sql-server-dev                                    ● RUNNING  │
│     Port: localhost:1433                                          │
│     Volume: ~/backups → /var/opt/mssql/backups                    │
│                                                                   │
│                                        [ Connect ]                │
└───────────────────────────────────────────────────────────────────┘
```

### Full T-SQL Transparency

Never wonder "what did the app actually do?" Every operation shows the exact T-SQL being executed. Copy it, learn it, or run it elsewhere.

```sql
BACKUP DATABASE [MyApp]
TO DISK = N'/var/opt/mssql/backups/MyApp_20260122.bak'
WITH COMPRESSION, INIT, STATS = 10;
```

### Streaming Progress

Long-running operations show real-time progress. See exactly how far along your backup or restore is, with elapsed time and speed metrics.

```
┌───────────────────────────────────────────────────────────────────┐
│  💾 Backing Up: MyApp                                             │
│                                                                   │
│  ████████████████████████████░░░░░░░░░░░░░░░░░░   67%             │
│                                                                   │
│  104 MB / 156 MB  •  00:12 elapsed  •  8.7 MB/s                   │
└───────────────────────────────────────────────────────────────────┘
```

### Safety First

Destructive operations require explicit confirmation. Type the database name to delete. System databases are protected.

### Modern Query Editor

Multi-tab query workspace with syntax highlighting, results grid, and messages pane. Everything you need for day-to-day SQL work.

### AI-Powered Analysis

Connect your own AI API keys (Anthropic, OpenAI, Google, Groq, or Cerebras) to unlock:

- **Smart Tab Naming** — Tabs auto-rename based on query content
- **Result Analysis** — Ask questions about your query results in natural language
- **Pattern Detection** — AI identifies trends and anomalies in your data

### Result History & Comparison

Every query execution is saved as a snapshot. Compare any two runs side-by-side to see exactly what changed — added rows, removed rows, and modified values highlighted.

---

## Quick Start

### Requirements

- macOS 13 (Ventura) or later
- Apple Silicon (M1/M2/M3) or Intel Mac
- SQL Server 2017+ (local Docker or remote server)
- For Docker SQL Server: [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Download

**[⬇️ Download MJ Forge for macOS](https://github.com/MemberJunction/mj-forge/releases/latest)**

| Chip                     | Download                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Apple Silicon (M1/M2/M3) | [MJ Forge-x.x.x-arm64.dmg](https://github.com/MemberJunction/mj-forge/releases/latest) |
| Intel                    | [MJ Forge-x.x.x-x64.dmg](https://github.com/MemberJunction/mj-forge/releases/latest)   |

> **Note:** On first launch, right-click the app and select "Open" to bypass Gatekeeper (the app is not yet notarized).

### Build from Source

```bash
git clone https://github.com/MemberJunction/mj-forge.git
cd mj-forge
npm install
npm run dev          # Development mode with hot reload
npm run package:mac  # Build .dmg installer
```

### First Connection

1. Launch MJ Forge
2. Click **"Detect Docker SQL Server"** (or "Add Connection" for remote servers)
3. Select your container and enter the SA password
4. Start working!

---

## Screenshots

_Screenshots coming soon_

---

## Why MJ Forge?

| Feature                 | MJ Forge | Azure Data Studio | TablePlus | SSMS |
| ----------------------- | :------: | :---------------: | :-------: | :--: |
| macOS Native            |    ✅    |        ✅         |    ✅     |  ❌  |
| Create/Rename/Delete DB |    ✅    |        ❌         |    ❌     |  ✅  |
| Backup Database         |    ✅    |        ❌         |    ❌     |  ✅  |
| Restore Database        |    ✅    |        ❌         |    ❌     |  ✅  |
| Docker Detection        |    ✅    |        ❌         |    ❌     |  ❌  |
| T-SQL Transparency      |    ✅    |        N/A        |    N/A    |  ❌  |
| Query Editor            |    ✅    |        ✅         |    ✅     |  ✅  |
| Object Explorer         |    ✅    |        ✅         |    ✅     |  ✅  |
| Result History & Diff   |    ✅    |        ❌         |    ❌     |  ❌  |
| AI Analysis             |    ✅    |        ❌         |    ❌     |  ❌  |
| FK Navigation           |    ✅    |        ❌         |    ❌     |  ✅  |

---

## Tech Stack

- **Framework:** Electron + Angular 18
- **SQL Connectivity:** node-mssql (TDS protocol)
- **Security:** macOS Keychain for credentials
- **Docker:** dockerode for container detection
- **Code Editor:** Monaco Editor

Built with patterns from [MemberJunction](https://github.com/MemberJunction/MJ), the open-source metadata-driven application platform.

---

## Roadmap

### v1.0 — Core Features ✅

- [x] Project foundation
- [x] Connection management with Keychain storage
- [x] Docker SQL Server detection
- [x] Object explorer (databases, tables, views, procedures, functions)
- [x] Multi-tab query editor with results grid
- [x] Create / Rename / Delete database
- [x] Full backup with streaming progress
- [x] Restore with file relocation wizard

### v1.1 — Enhanced Experience ✅

- [x] Query result history with snapshots
- [x] Result comparison (diff view)
- [x] Dark/Light mode themes
- [x] Export results (CSV, JSON, Excel)
- [x] Foreign key navigation in results
- [x] AI-powered features (tab naming, result analysis)
- [ ] Differential backups
- [ ] Connection grouping and tagging

### v2.0 — Advanced Features

- [ ] Azure AD authentication
- [ ] IntelliSense / autocomplete
- [ ] Backup scheduling
- [ ] Schema scripting
- [ ] SQL generation with AI

---

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- Xcode Command Line Tools

### Setup

```bash
# Clone the repository
git clone https://github.com/MemberJunction/mj-forge.git
cd mj-forge

# Install dependencies
npm install

# Start development mode (hot reload)
npm run dev

# Build for production
npm run build

# Package as .app
npm run package
```

### Project Structure

```
mj-forge/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Context bridge scripts
│   ├── renderer/       # Angular application
│   └── shared/         # Shared types and constants
├── plans/              # System design documents
├── resources/          # App icons and assets
└── tests/              # Unit, integration, E2E tests
```

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines.

---

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Ways to Contribute

- **Report Bugs:** Open an issue with reproduction steps
- **Suggest Features:** Describe your use case and idea
- **Submit PRs:** Bug fixes, features, documentation
- **Spread the Word:** Star the repo, share with others

---

## Acknowledgments

MJ Forge is sponsored by and built with [MemberJunction](https://github.com/MemberJunction/MJ), the open-source metadata-driven application development platform.

<p align="center">
  <a href="https://github.com/MemberJunction/MJ">
    <img src="https://img.shields.io/badge/Powered%20by-MemberJunction-blue?style=for-the-badge" alt="Powered by MemberJunction">
  </a>
</p>

MemberJunction provides the foundational patterns used in MJ Forge:

- **Singleton patterns** for service management
- **Object caching** for performance
- **Utility functions** for data handling

If you're building data-intensive applications, check out the full [MemberJunction platform](https://github.com/MemberJunction/MJ).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ for Mac developers who work with SQL Server
</p>

<p align="center">
  <a href="https://github.com/MemberJunction/mj-forge/stargazers">⭐ Star us on GitHub</a>
</p>
