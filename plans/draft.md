
Below is a super-detailed PRD you can hand to a dev team. It’s written assuming an Electron + Angular (renderer) + Node (main process / local backend) architecture, and that SQL Server will often be local-in-Docker but must also support any reachable SQL Server.

I’m also grounding key technical assumptions in current Microsoft docs: sqlcmd is designed for ad hoc + scripted execution of any T-SQL you can run in SSMS/ADS, which includes CREATE DATABASE, BACKUP DATABASE, RESTORE DATABASE, ALTER DATABASE ... MODIFY NAME, etc.  ￼
For Mac, Microsoft supports installing ODBC Driver 18 and optionally the sqlcmd tools on macOS.  ￼
And if you prefer a pure protocol approach, the Node ecosystem includes tedious (TDS implementation) and node-mssql (higher-level client) supporting macOS.  ￼

⸻

Product Requirements Document (PRD)

Product name

(Working): “SQL Dev Manager for Mac”
Tagline: The missing SSMS workflows on macOS: Create/Rename/Delete + Backup/Restore with a modern query UI.

1. Purpose and background

Problem

Mac-based SQL Server developers commonly use VS Code SQL extensions or Azure Data Studio for querying, but they often lack a fast, reliable, UI-first workflow for:
	•	Creating databases
	•	Renaming databases
	•	Deleting databases
	•	Backing up databases
	•	Restoring databases

Developers end up running SSMS in Parallels/VMs or doing fragile manual CLI steps.

Goal

Deliver a Mac-first desktop app that covers these missing workflows with a clean UX, while still supporting “normal developer querying” in a modern multi-tabbed editor.

Non-goal

This is not a full DBA suite. We are not aiming to replace SSMS advanced features (agent jobs, profiler, maintenance plans, policy mgmt, etc.).

⸻

2. Target users and personas

Primary persona: “Mac SQL Developer”
	•	Runs SQL Server in Docker locally, often via mcr.microsoft.com/mssql/server
	•	Needs quick create/restore/backup cycles for dev/test
	•	Writes and runs queries daily
	•	Wants object explorer to browse tables/views/procs quickly

Secondary persona: “Full-stack dev connecting to remote SQL Server”
	•	Works against dev/stage SQL Server in Azure/on-prem
	•	Needs safe deletion guardrails
	•	Needs credential storage + easy switching between connections

Out of scope persona: “Production DBA”
	•	Needs deep operational tooling, RBAC auditing, performance tuning, etc.

⸻

3. Success metrics

Adoption / engagement
	•	Time-to-first-connection < 2 minutes (median)
	•	Time to restore a DB (happy path) < 3 minutes (excluding restore duration)
	•	≥ 60% of weekly active users use Backup/Restore at least once/week (internal dev teams)

Reliability
	•	≥ 99% success rate for “create DB” on a reachable server with permissions
	•	≥ 99% success rate for backup/restore when path & permissions are correct
	•	Clear, actionable errors for ≥ 95% of failures

UX quality
	•	Users can complete create/backup/restore without reading docs (qual usability)

⸻

4. High-level scope

Must-have (v1)
	1.	Connection manager (multiple servers)
	2.	Database list and operations:
	•	Create database
	•	Rename database
	•	Delete database (with safety confirmations)
	3.	Backup database:
	•	Full backup to a selected destination
	•	Progress + log output
	4.	Restore database:
	•	Restore from .bak
	•	Options for overwrite, rename, relocate files
	5.	Object explorer:
	•	Tables, views, stored procedures (min)
	6.	Query workspace:
	•	Multi-tab editor
	•	Run query and show results grid
	•	Basic “messages” pane
	7.	Docker helper (optional but strongly recommended for v1):
	•	Detect common local SQL Server docker containers
	•	Convenience connect and host/port detection

Nice-to-have (v1.1 / v2)
	•	Differential/log backups
	•	Export/import .bacpac (if feasible)
	•	Schema scripting (generate create scripts)
	•	Table viewer with paging / filtering
	•	Query history & snippets
	•	Connection health indicators
	•	“Restore as new DB” wizard and templates
	•	Simple role/user management for local dev (create login/user)

Explicit non-goals (v1)
	•	SQL Agent UI
	•	Index advisor / perf tuning dashboard
	•	Profiler / Extended Events viewer
	•	Always-on / replication tooling
	•	Visual query designer

⸻

5. Platform & architecture

Desktop framework

Electron (primary recommendation)
	•	Renderer: Angular/TypeScript
	•	Main: Node.js runtime (system access)
	•	IPC between renderer and main for privileged operations (file system, process execution, keychain, docker, etc.)

(Alternatives exist like Tauri; but v1 strongly favors Electron due to team stack fit and mature ecosystem. If you evaluate, do it after v1.)  ￼

SQL connectivity strategy (two viable approaches)

Approach A (recommended for reliability & UX): Native SQL driver in Node
	•	Use node-mssql (Tedious driver default) to connect via TDS protocol and execute:
	•	queries
	•	metadata queries
	•	create/rename/delete
	•	For backup/restore, still run T-SQL commands through the same connection (preferred)

node-mssql / tedious are cross-platform and work on macOS.  ￼

Approach B (CLI wrapper): sqlcmd
	•	Use Microsoft sqlcmd as a subprocess from Node.
	•	Execute T-SQL for create/backup/restore/rename/delete with -Q or scripts with -i.  ￼
	•	On macOS, install via Microsoft ODBC package + tools (supported).  ￼

Decision guidance
	•	If you want fewer external deps: Approach A
	•	If you want “exact same semantics as Microsoft tools” and already standardize on ODBC/sqlcmd: Approach B
	•	Either way, the app should support both with a feature flag (optional), but don’t overbuild: pick one for v1.

Local SQL Server in Docker
	•	App does not run SQL Server; it connects to it.
	•	For backup/restore, the file paths used by SQL Server must be accessible to the SQL Server process:
	•	If SQL Server is in Docker, .bak paths are inside the container unless a volume mount is used.
	•	Provide UX affordances to mitigate this (see Backup/Restore UX sections).

⸻

6. Security & permissions

Credential storage
	•	Store connection secrets in macOS Keychain (via Electron + Node keychain library).
	•	Connections can be:
	•	SQL auth (username/password)
	•	Azure AD / MFA: likely v2 unless using supported token flow in driver stack

Principle of least privilege
	•	Renderer process never gets raw credentials.
	•	Renderer requests actions; main process performs them and returns results.

Safe delete / destructive actions
	•	Explicit multi-step confirmation and “type the DB name” confirmation for delete.
	•	Default: don’t show system DBs (master, model, msdb, tempdb) in destructive menus.

⸻

7. Core user journeys

Journey 1: Connect to local Docker SQL Server
	1.	User opens app → “Connections”
	2.	Click “Detect local Docker SQL Server”
	3.	App lists candidate containers, ports
	4.	User selects and saves connection
	5.	App opens server explorer

Journey 2: Create DB
	1.	User selects server
	2.	Click “Create Database”
	3.	Enter name, optional collation, optional default file locations (advanced)
	4.	App executes create → shows success toast + refresh explorer

Journey 3: Backup DB
	1.	Select DB → Backup
	2.	Choose destination:
	•	“Server-side path” (advanced)
	•	“Local file pick” (helper that maps to a docker volume if detected)
	3.	Click Start
	4.	See streaming progress/messages
	5.	On success: show “Reveal in Finder” (if local), or “Copy server path”

Journey 4: Restore DB
	1.	Select server → Restore
	2.	Choose .bak source:
	•	local file picker (if mapped to container volume, can restore)
	•	server path (advanced)
	3.	Restore options:
	•	Restore as DB name
	•	Overwrite existing
	•	Relocate data/log files (wizard)
	4.	Start restore → streaming progress
	5.	On success: DB appears in explorer

Journey 5: Query
	1.	Open “New Query Tab”
	2.	Choose connection + database
	3.	Run query → results grid + messages pane

⸻

8. Functional requirements (detailed)

8.1 Connection Manager

Features
	•	Create/edit/delete connection profiles
	•	Test connection
	•	Default database (optional)
	•	Connection grouping/tags (optional)

Fields
	•	Name
	•	Host
	•	Port
	•	Encryption options:
	•	Encrypt true/false
	•	Trust server certificate true/false
	•	Auth type:
	•	SQL auth: username/password
	•	Windows auth: likely out of scope on macOS for v1 (note in limitations)
	•	Advanced: connection timeout, request timeout

Acceptance criteria
	•	Users can save multiple profiles and switch quickly (<2 clicks)

⸻

8.2 Server & DB Explorer

Explorer hierarchy
	•	Server
	•	Databases
	•	[DB]
	•	Tables
	•	Views
	•	Stored Procedures

Actions
	•	Refresh
	•	Filter/search objects
	•	Right-click context menus:
	•	Database: Create / Rename / Delete / Backup / Restore (restore may live on server-level too)
	•	Table/View/Proc: Open definition (v1 can be “script as CREATE” via sp_helptext or sys.sql_modules)

Metadata queries
	•	Use system catalog views to list:
	•	sys.databases
	•	sys.tables, sys.views, sys.procedures
	•	optionally schema grouping using sys.schemas

Acceptance criteria
	•	Explorer loads databases in <2 seconds on typical dev servers (<100 DBs)

⸻

8.3 Create Database

UI
	•	Dialog with:
	•	Database name
	•	(Advanced) collation
	•	(Advanced) initial size options (v2 if needed)
	•	Validate DB name rules locally
	•	On submit: execute create + show messages

T-SQL
	•	CREATE DATABASE [name]
	•	Optionally collation: COLLATE ...

Acceptance criteria
	•	Success: DB appears without app restart
	•	Failure: error displayed with actionable message

⸻

8.4 Rename Database

UI
	•	Rename dialog: current name (read-only) + new name
	•	Warn if active connections exist
	•	Option: “Set SINGLE_USER with rollback immediate during rename” (checkbox, default ON for dev)

T-SQL
	•	Common approach:
	•	ALTER DATABASE [old] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
	•	ALTER DATABASE [old] MODIFY NAME = [new];
	•	ALTER DATABASE [new] SET MULTI_USER;

Acceptance criteria
	•	DB appears under new name and object explorer updates

⸻

8.5 Delete Database

UI
	•	Confirmation step:
	•	Show DB size (optional)
	•	“Type database name to confirm”
	•	Checkbox: “Close existing connections” (default ON)
	•	On confirm: execute drop safely

T-SQL
	•	ALTER DATABASE ... SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
	•	DROP DATABASE ...;

Acceptance criteria
	•	DB removed from explorer; errors handled cleanly

⸻

8.6 Backup Database

Because backup/restore is one of the “main reasons to exist,” this section is intentionally deep.

Backup type
	•	Full backup (v1)
	•	Optional: WITH COPY_ONLY toggle (v1 optional)

Destination handling
	•	Mode A: Server path (simple)
	•	User provides a path SQL Server can write to (/var/opt/mssql/backups/... in Linux containers, or a Windows path in Windows servers)
	•	Mode B: Local file picker (developer-friendly)
	•	App selects local destination
	•	If Docker detected, app can require/assist mapping that folder into container, and translate to container path

UX details
	•	Suggested default filename: {db}_{yyyyMMdd_HHmmss}.bak
	•	Show estimated DB size (if available)
	•	Stream messages and show elapsed time
	•	Provide “Copy T-SQL” and “Copy sqlcmd command” for transparency/debug

T-SQL
	•	BACKUP DATABASE [db] TO DISK = N'path' WITH INIT, COMPRESSION; (compression toggle optional)

Acceptance criteria
	•	Backup completes and file is present at destination (validated if local)
	•	If path is invalid/unwritable, app detects and gives user next step (permissions/volume mapping)

⸻

8.7 Restore Database

Restore source
	•	Server path (always supported)
	•	Local file picker (supported when docker volume mapping is available)

Wizard steps
	1.	Select backup file
	2.	Read backup metadata:
	•	RESTORE FILELISTONLY FROM DISK = ...
	•	RESTORE HEADERONLY ... (optional)
	3.	Choose target DB name:
	•	same as backup
	•	restore as new
	4.	Choose restore options:
	•	Overwrite existing DB (WITH REPLACE)
	•	Relocate files (MOVE data/log to chosen locations)
	5.	Execute restore with progress

Edge cases
	•	If DB exists and overwrite unchecked → block with clear prompt
	•	If logical file names differ, show them and map to physical paths
	•	If restore fails due to file locks, present guidance

Acceptance criteria
	•	Successful restore results in browsable DB
	•	Restore UX makes docker path issues obvious and solvable

⸻

8.8 Query Workspace

Minimum v1
	•	Multi-tab query editor
	•	Tab associated with:
	•	connection
	•	database
	•	Run (Ctrl/Cmd+Enter) selection or full script
	•	Results grid:
	•	support multiple result sets
	•	Messages pane:
	•	PRINT output
	•	row count
	•	errors/warnings

Nice v1.1
	•	Syntax highlighting
	•	IntelliSense / autocomplete (likely v2)
	•	Saved snippets

⸻

8.9 Streaming progress / logs

For long-running operations (backup/restore), the app must:
	•	stream incremental status updates to UI
	•	keep full log transcript per operation
	•	allow “Copy logs” for support/debug

Implementation:
	•	If using driver approach: poll sys.dm_exec_requests percent complete for backup/restore (optional)
	•	If using sqlcmd: stream stdout/stderr lines directly  ￼

⸻

9. System requirements

9.1 Supported environments
	•	macOS 13+ (Ventura and above) (recommended target)
	•	SQL Server targets:
	•	SQL Server in Docker (Linux container)
	•	Remote SQL Server (on-prem / cloud)
	•	Azure SQL Database: connect for queries; note backup/restore semantics differ (likely limited)

9.2 Dependencies

Depending on connectivity approach:

If using sqlcmd
	•	Microsoft ODBC Driver 18 + command-line tools installed (or bundled installer guidance)  ￼
	•	App should detect presence of sqlcmd and guide install

If using Node driver
	•	Node runtime packaged with Electron
	•	node-mssql + tedious  ￼

9.3 Performance
	•	Explorer operations should be async and cancellable
	•	Query results grid should handle at least:
	•	50k rows (with paging/virtualization recommended)
	•	App memory: keep within reasonable Electron norms

⸻

10. UX/UI requirements

10.1 Layout
	•	Left sidebar: Connections + Explorer tree
	•	Main area: Tabs (Query tabs + Operation tabs)
	•	Bottom panel: Results / Messages / Logs (dockable)

10.2 Design principles
	•	“Dev tool fast path”: most common actions ≤ 2 clicks from explorer
	•	Transparency: show the exact T-SQL / command being run (copyable)
	•	Safety: destructive actions require explicit confirmation

10.3 Notifications
	•	In-app toast notifications for:
	•	success/failure
	•	operation completion
	•	Optional macOS notifications for long restores

10.4 Drag & Drop
	•	Drag .bak into restore panel
	•	Drag SQL file into query area to open

⸻

11. Error handling & diagnostics

Required
	•	Display SQL error number + message
	•	Provide “Copy diagnostic bundle” (v1 optional, v1.1 recommended):
	•	app version
	•	OS version
	•	connection type (redacted)
	•	operation logs
	•	Common error guidance:
	•	login failed
	•	certificate issues
	•	cannot open backup device
	•	access denied / path not found
	•	database in use

⸻

12. Compliance / licensing notes
	•	Ensure licensing compliance if bundling Microsoft tools.
	•	If relying on user-installed sqlcmd, provide guided instructions and checks.

⸻

13. Engineering plan (recommended milestones)

Milestone 0: Foundations (1–2 sprints)
	•	Electron shell + Angular renderer
	•	IPC framework
	•	Connection manager + keychain integration
	•	Basic query tab with execution + results

Milestone 1: Explorer + Create/Rename/Delete (1 sprint)
	•	Object explorer tree
	•	Create DB
	•	Rename DB
	•	Delete DB (safe)

Milestone 2: Backup/Restore (2 sprints)
	•	Backup UI + server path mode
	•	Restore wizard + filelistonly parsing
	•	Streaming logs + robust error UX

Milestone 3: Docker helper polish (1 sprint)
	•	Detect containers, port mapping
	•	Volume mapping guidance for backup/restore
	•	“Test local” quickstart

Milestone 4: Fit & finish (ongoing)
	•	Performance, caching, UX polish
	•	Packaging/signing, auto-update

⸻

14. Open questions / risks (call out explicitly)
	1.	Docker path mapping UX: backup/restore requires paths SQL Server can access; on Docker that’s a container path unless volumes are mounted.
	2.	Auth modes: SQL auth is straightforward; Windows auth / AAD interactive may require extra work.
	3.	Azure SQL: backup/restore differs; define exact supported subset.
	4.	Connectivity approach: Driver-first vs sqlcmd-wrapper. sqlcmd is clearly supported for executing T-SQL scripts/commands  ￼ but introduces an external dependency; Node drivers reduce dependency footprint  ￼.

⸻

15. Acceptance test checklist (v1)
	•	Add connection, test connection, save
	•	List databases
	•	Create database, verify appears
	•	Rename database, verify appears
	•	Delete database (with confirmation), verify removed
	•	Backup full to server path, verify file exists
	•	Restore from server path, verify DB online
	•	Run query in tab, view results and messages
	•	Long restore shows streaming logs and completion state
	•	Credentials stored securely (no plain text on disk)
	•	App handles common failures with clear guidance

⸻

16. Appendix: Why this is feasible with your stack
	•	sqlcmd is explicitly designed to run T-SQL statements and scripts and automate scripting tasks, so it can drive create/backup/restore/rename/delete by executing the corresponding T-SQL.  ￼
	•	macOS can install Microsoft’s SQL Server ODBC driver and optional CLI tools, making a Mac-first toolchain realistic.  ￼
	•	Node has mature SQL Server connectivity stacks (node-mssql, tedious) that support macOS and implement the SQL Server protocol (TDS).  ￼
