import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ResolvedPaths } from './paths.js';

/**
 * Publishes the agent-facing documentation + CLI launcher into the *visible*
 * workspace root (`~/MJDev`) so an AI agent that lands there is immediately
 * self-sufficient: it discovers how to stand up an instance, run the full
 * (CLI + GUI) validation cycle, and what it must never touch.
 *
 * Split of responsibilities (each is independently safe to re-run on launch):
 *  - `.mjdev-docs/*`        — fully regenerated copy of the authored docs (clobber OK).
 *  - `.mjdev-docs/WORKSPACE-SNAPSHOT.md` — live roster, regenerated each launch.
 *  - `AGENTS.md`            — only the MJDEV-MANAGED region is rewritten; user prose is preserved.
 *  - `CLAUDE.md`            — a thin `@AGENTS.md` import, written ONLY if absent.
 *  - `MJDEV-ISSUES.md`      — suspected-tool-bug log, created if absent, NEVER clobbered.
 *  - `MJDEV-REQUESTS.md`    — doc/improvement request log, created if absent, NEVER clobbered.
 *  - `logs/`                — home for agent-written working logs (so they don't litter root).
 *  - `bin/mjdev`            — launcher that pins this workspace's isolation env, mode 0755.
 *
 * Nothing here writes under the hidden secrets root (`~/.mjdev`).
 */

const MANAGED_BEGIN = '<!-- BEGIN MJDEV-MANAGED -->';
const MANAGED_END = '<!-- END MJDEV-MANAGED -->';

export interface SyncAgentDocsOptions {
  /** Source dir of the authored docs. Defaults to `<orchestrator>/docs/agent`. */
  docsSourceDir?: string;
  /** Absolute path to the built CLI entry (`.../packages/cli/dist/mjdev.js`). */
  cliEntry?: string;
  /** Live instance roster for the snapshot (slug/branch/status/ports). */
  instances?: Array<{ slug: string; branch?: string; status?: string; ports?: unknown }>;
  /** ISO timestamp for the snapshot (injectable for deterministic tests). */
  now?: string;
}

export interface SyncAgentDocsResult {
  docsDir: string;
  copied: string[];
  launcher: string;
  agentsFile: string;
  claudeCreated: boolean;
  issuesCreated: boolean;
  requestsCreated: boolean;
  settingsCreated: boolean;
}

/**
 * Hands-off-except-destructive permission settings for an agent rooted in this
 * workspace: allow read + build/test + non-destructive `mjdev` + the harness;
 * prompt on destructive instance/schema/volume ops; deny pushes, edits to the
 * hidden secrets root, and edits to the personal MJ source checkout.
 */
function claudeSettings(paths: ResolvedPaths): string {
  const settings = {
    $comment: 'Managed by MJ Dev Manager. Safe to edit — only created if absent.',
    permissions: {
      allow: [
        'Read',
        'Glob',
        'Grep',
        'Bash(./bin/mjdev list:*)',
        'Bash(./bin/mjdev info:*)',
        'Bash(./bin/mjdev ps:*)',
        'Bash(./bin/mjdev runs:*)',
        'Bash(./bin/mjdev logs:*)',
        'Bash(./bin/mjdev create:*)',
        'Bash(./bin/mjdev setup:*)',
        'Bash(./bin/mjdev run:*)',
        'Bash(./bin/mjdev e2e:*)',
        'Bash(./bin/mjdev app:*)',
        'Bash(./bin/mjdev persona:*)',
        'Bash(./bin/mjdev apps:*)',
        'Bash(npm run build:*)',
        'Bash(npm test:*)',
        'Bash(npm run test:*)',
        'Bash(npx vitest:*)',
        'Bash(npx playwright:*)',
        'Bash(git status:*)',
        'Bash(git diff:*)',
        'Bash(git log:*)',
      ],
      ask: [
        'Bash(./bin/mjdev delete:*)',
        'Bash(./bin/mjdev reset:*)',
        'Bash(./bin/mjdev app unlink:*)',
        'Bash(./bin/mjdev app reset-schema:*)',
        'Bash(docker volume rm:*)',
      ],
      deny: [
        'Bash(git push:*)',
        `Edit(${paths.configDir}/**)`,
        `Write(${paths.configDir}/**)`,
        `Edit(${paths.mjSourcePath}/**)`,
        `Write(${paths.mjSourcePath}/**)`,
      ],
    },
  };
  return JSON.stringify(settings, null, 2) + '\n';
}

/** Default authored-docs dir, resolved relative to this compiled module. */
function defaultDocsSourceDir(): string {
  // Compiled to CommonJS — __dirname is dist/, docs live at ../docs/agent.
  return path.resolve(__dirname, '..', 'docs', 'agent');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace (or insert) the single MJDEV-MANAGED region in `existing`, preserving
 * everything the user wrote outside it. Returns the full new file contents.
 */
export function upsertManagedRegion(existing: string | null, managed: string): string {
  const block = `${MANAGED_BEGIN}\n${managed.trimEnd()}\n${MANAGED_END}`;
  if (!existing || existing.trim() === '') return `${block}\n`;
  if (existing.includes(MANAGED_BEGIN) && existing.includes(MANAGED_END)) {
    const re = new RegExp(`${escapeRegExp(MANAGED_BEGIN)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}`);
    return existing.replace(re, block);
  }
  // No managed region yet — append it, keeping the user's existing prose on top.
  return `${existing.trimEnd()}\n\n${block}\n`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The managed AGENTS.md block: a compact index pointing at the synced docs. */
function managedAgentsBlock(): string {
  return [
    '# MJ Dev Manager — agent guide',
    '',
    'You are working in an **MJ Dev Manager** workspace. This tool provisions isolated',
    'local MemberJunction (MJ) dev instances (Docker SQL + git worktree + config) and',
    'supports developing MJ and "open apps" against them. Full docs live in `./.mjdev-docs/`.',
    '',
    '**Start here:** @.mjdev-docs/ORCHESTRATION.md — read it.',
    '',
    "📖 **MemberJunction's own `CLAUDE.md` is the HIGHEST source of truth** for anything",
    'MemberJunction-related — go read it: `repos/mj/CLAUDE.md` (or `mj/CLAUDE.md` inside any',
    'instance worktree). When these mjdev docs do not cover something, fall back to it.',
    '',
    '**On startup, ask the user TWO things:**',
    '1. **"Am I the orchestrator, or a worker?"** The *orchestrator* coordinates a swarm',
    '   (provisions/assigns/recycles instances for other agents); a *worker* develops on a single',
    '   assigned instance. Your role changes how you operate (see the swarm model in',
    '   ORCHESTRATION.md). Ask if it is not already clear, and read ORCHESTRATION.md either way.',
    '2. **"How many heavy slots should I run?"** A *heavy slot* = one long-running, high-compute',
    '   task in flight (e.g. a full MJ `turbo build`, an instance `create` + `setup all`, an',
    '   `app build-all`, or a Playwright/e2e run). The user picks how many can run at once on',
    '   their machine; keep concurrent heavy tasks within that budget. (Run heavy work in the',
    '   **background** and parallelize up to the budget — see ORCHESTRATION.md "Heavy slots".)',
    '',
    '> ⏳ **TEMPORAL EXCEPTION — read before you start.** If your task will involve running',
    '> `mj sync push` (core metadata sync), **STOP and ask the user at the very start of your',
    '> response** whether to exclude the integration entries — on the current `next` base the',
    '> connector-retirement delete calls break the push. Do not begin sync-involving work until',
    '> they answer. Details + removal condition: @.mjdev-docs/TEMPORAL-EXCEPTIONS.md',
    '',
    '- Validate everything at BOTH layers (CLI *and* GUI): @.mjdev-docs/TEST-PROTOCOL.md',
    '- Per-task dev loops: @.mjdev-docs/DEV-LOOPS.md',
    '- Safety rules (read before acting): @.mjdev-docs/SAFETY.md',
    '- Command reference: @.mjdev-docs/CLI-REFERENCE.md',
    '- Workspace layout: @.mjdev-docs/WORKSPACE.md',
    '- Live instance roster: @.mjdev-docs/WORKSPACE-SNAPSHOT.md',
    '- **Logs:** write any working command output to `./logs/` (not the workspace root). The',
    "  tool's own per-process logs are in the hidden `proc-logs/` — read them with `mjdev logs <id>`.",
    '- **Handoff log — USE THIS:** `./MJDEV-ISSUES.md`. If you hit a suspected **mjdev-tool**',
    '  problem (instance provisioning, worktrees, the `mjdev` CLI, **install / dev-link**, config',
    '  generation, process management), file it here so the mjdev maintainer can triage — and',
    '  check it for known issues before you work around something. Protocol in ORCHESTRATION.md.',
    "- **Want a doc/tool improvement?** You can't edit the shipped docs/tool directly (they",
    '  regenerate each launch) — file a request in `./MJDEV-REQUESTS.md` (type: doc | improvement)',
    "  and the maintainer folds accepted ones back into the tool. That's how your ideas reach us.",
    '',
    "Run the CLI via `./bin/mjdev` — it pins this workspace's isolation env so the CLI",
    'and GUI share the same state.',
    '',
    '**Report back per task (every response):** the user runs several agents at once — bracket',
    'each distinct task with a descriptive header at BOTH the **top and bottom** of its section,',
    'naming the branch(es) + instance(s). **Number = batch (counts up each response), letter =',
    'task** (`1a`, `1b`, … then `2a`, …), e.g. `▸ Task 2c · MJExplorer debugging — branch:',
    'feature/x · instance: openapp-dev`. **Whenever you mention a task (anywhere, not just',
    'headers) use BOTH the number+letter AND the short name** — e.g. "Task 2c (MJExplorer',
    'debugging)" — the user won\'t recall the codes but the name will. See ORCHESTRATION.md.',
  ].join('\n');
}

/** Seed contents for MJDEV-ISSUES.md (written only if the file is absent). */
function issuesSeed(): string {
  return [
    '# MJDEV-ISSUES — suspected mjdev-tool bug log',
    '',
    'A shared handoff log. When an agent developing *inside* an instance suspects a bug',
    'in **the mjdev tool itself** (not MJ-core, not the app), it appends an entry here.',
    'The mjdev maintainer agent triages and replies in-file.',
    '',
    '## Is it a mjdev issue?',
    '- **YES** — instance provisioning, worktrees, config/env generation, ports, personas,',
    '  open-app dev-linking, the CLI/GUI surface, dev/prod isolation.',
    '- **NO** — MJ-core runtime behavior (BaseEntity, providers, codegen output), or a bug',
    "  in the open app's own code. Those go to the MJ / app maintainers, not here.",
    '',
    '## Status flow',
    '`OPEN` → `TRIAGING` → `RESOLVED` | `NOT-MJDEV`',
    '',
    '## Entry template',
    '```',
    '### <short title>',
    '- Status: OPEN',
    '- Reported: <date> by <agent/instance>',
    '- Repro: <exact commands / steps>',
    '- Expected vs actual:',
    '- Suspected layer:',
    '```',
    '',
    '---',
    '',
  ].join('\n');
}

/** Seed contents for MJDEV-REQUESTS.md (written only if the file is absent). */
function requestsSeed(): string {
  return [
    '# MJDEV-REQUESTS — agent doc & improvement requests',
    '',
    'Agents working in this workspace **cannot edit the shipped mjdev docs or tool directly** —',
    'the docs (`.mjdev-docs/`, the managed `AGENTS.md` region) are regenerated each launch, so any',
    'edits are overwritten. So when you have an improvement to the **docs** or the **tool**, file it',
    'here. The mjdev maintainer agent reviews requests, folds accepted ones into the shipped',
    'docs/tool (in the Forge repo), and marks them closed. This is how your improvements get back',
    'to us.',
    '',
    '## What goes here (vs MJDEV-ISSUES.md)',
    '- **doc** — a fix/addition to an agent doc: a clarification, a missing step, wrong info, a new',
    '  gotcha worth capturing.',
    '- **improvement** — a wanted change to the mjdev tool: a CLI command/flag, a GUI control, a',
    '  feature, an engine behavior.',
    '- A suspected **tool bug** goes to `MJDEV-ISSUES.md` instead — this file is for *wanted',
    '  changes*, not breakage.',
    '',
    '## Status flow',
    '`OPEN` → `CLOSED` (accepted + applied, or declined — the maintainer notes which in their reply).',
    '',
    '## Entry template',
    '```',
    '### <short title>',
    '- Status: OPEN',
    '- Type: doc | improvement',
    '- Target: <doc → the .md file, e.g. CLI-REFERENCE.md · improvement → the CLI command / tool / feature>',
    '- Requested: <date> by <agent/instance>',
    '- Request: <what you want changed and why — enough for the maintainer to act without you>',
    '- Maintainer reply: <left blank — filled on review>',
    '```',
    '',
    '---',
    '',
  ].join('\n');
}

/** Render the live workspace snapshot. */
function renderSnapshot(paths: ResolvedPaths, opts: SyncAgentDocsOptions): string {
  const now = opts.now ?? new Date().toISOString();
  const rows = (opts.instances ?? [])
    .map(i => `| ${i.slug} | ${i.branch ?? '—'} | ${i.status ?? '—'} |`)
    .join('\n');
  return [
    '# Workspace snapshot',
    '',
    `_Regenerated ${now}. Do not edit — overwritten each launch._`,
    '',
    `- Workspace root: \`${paths.workspaceRoot}\``,
    `- Secrets/state: \`${paths.configDir}\` (off-limits — use the CLI)`,
    `- MJ clone: \`${paths.mjClonePath}\``,
    `- Container prefix: \`${paths.containerPrefix}\``,
    '',
    '## Instances',
    opts.instances && opts.instances.length
      ? ['| slug | branch | status |', '| --- | --- | --- |', rows].join('\n')
      : '_No instances yet. Create one: `./bin/mjdev create <config.yaml>`._',
    '',
  ].join('\n');
}

/** Render the workspace-pinned CLI launcher script. */
function renderLauncher(paths: ResolvedPaths, cliEntry: string): string {
  return [
    '#!/bin/sh',
    '# Auto-generated by MJ Dev Manager — DO NOT EDIT.',
    "# Runs the mjdev CLI with THIS workspace's isolation env so the CLI and the",
    '# GUI operate on the same instances/state.',
    `export MJDEV_WORKSPACE_DIR="${paths.workspaceRoot}"`,
    `export MJDEV_CONFIG_DIR="${paths.configDir}"`,
    `export MJDEV_CONTAINER_PREFIX="${paths.containerPrefix}"`,
    `CLI="${cliEntry}"`,
    'if [ ! -f "$CLI" ]; then',
    '  echo "mjdev CLI not built at $CLI — run \\"npm run build\\" in the Forge repo." >&2',
    '  exit 1',
    'fi',
    'exec node "$CLI" "$@"',
    '',
  ].join('\n');
}

/**
 * Sync docs + launcher into the workspace root. Best-effort and idempotent;
 * safe to call on every app launch. Returns what it did (for logging/tests).
 */
export async function syncAgentDocs(
  paths: ResolvedPaths,
  opts: SyncAgentDocsOptions = {}
): Promise<SyncAgentDocsResult> {
  const docsSourceDir = opts.docsSourceDir ?? defaultDocsSourceDir();
  const docsDir = path.join(paths.workspaceRoot, '.mjdev-docs');
  await fs.mkdir(docsDir, { recursive: true });

  // 0) `logs/` — the home for agent-written working logs (ad-hoc command output) so they
  //    don't litter the workspace root. The tool's own per-process logs stay in the hidden
  //    `proc-logs/` (read via `mjdev logs <id>`); this is for agents' own redirected output.
  await fs.mkdir(path.join(paths.workspaceRoot, 'logs'), { recursive: true });

  // 1) Copy authored docs (fully regenerated — clobber OK).
  const copied: string[] = [];
  if (await pathExists(docsSourceDir)) {
    const entries = await fs.readdir(docsSourceDir);
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      await fs.copyFile(path.join(docsSourceDir, name), path.join(docsDir, name));
      copied.push(name);
    }
  }

  // 2) Live snapshot (always regenerated).
  await fs.writeFile(
    path.join(docsDir, 'WORKSPACE-SNAPSHOT.md'),
    renderSnapshot(paths, opts),
    'utf8'
  );

  // 3) AGENTS.md — rewrite only the managed region, preserve user prose.
  const agentsFile = path.join(paths.workspaceRoot, 'AGENTS.md');
  const existingAgents = (await pathExists(agentsFile))
    ? await fs.readFile(agentsFile, 'utf8')
    : null;
  await fs.writeFile(agentsFile, upsertManagedRegion(existingAgents, managedAgentsBlock()), 'utf8');

  // 4) CLAUDE.md — thin import, only if absent (never clobber a user's file).
  const claudeFile = path.join(paths.workspaceRoot, 'CLAUDE.md');
  let claudeCreated = false;
  if (!(await pathExists(claudeFile))) {
    await fs.writeFile(
      claudeFile,
      '# Workspace guide\n\nSee @AGENTS.md for the MJ Dev Manager agent guide.\n',
      'utf8'
    );
    claudeCreated = true;
  }

  // 5) MJDEV-ISSUES.md — create if absent, NEVER clobber existing entries.
  const issuesFile = path.join(paths.workspaceRoot, 'MJDEV-ISSUES.md');
  let issuesCreated = false;
  if (!(await pathExists(issuesFile))) {
    await fs.writeFile(issuesFile, issuesSeed(), 'utf8');
    issuesCreated = true;
  }

  // 5b) MJDEV-REQUESTS.md — doc/improvement requests; create if absent, NEVER clobber.
  const requestsFile = path.join(paths.workspaceRoot, 'MJDEV-REQUESTS.md');
  let requestsCreated = false;
  if (!(await pathExists(requestsFile))) {
    await fs.writeFile(requestsFile, requestsSeed(), 'utf8');
    requestsCreated = true;
  }

  // 6) bin/mjdev launcher (0755).
  const binDir = path.join(paths.workspaceRoot, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const launcher = path.join(binDir, 'mjdev');
  const cliEntry = opts.cliEntry ?? '';
  await fs.writeFile(launcher, renderLauncher(paths, cliEntry), 'utf8');
  await fs.chmod(launcher, 0o755);

  // 7) .claude/settings.json — hands-off-except-destructive perms, only if absent
  // (never clobber a developer's own permission tweaks).
  const settingsFile = path.join(paths.workspaceRoot, '.claude', 'settings.json');
  let settingsCreated = false;
  if (!(await pathExists(settingsFile))) {
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.writeFile(settingsFile, claudeSettings(paths), 'utf8');
    settingsCreated = true;
  }

  return {
    docsDir,
    copied,
    launcher,
    agentsFile,
    claudeCreated,
    issuesCreated,
    requestsCreated,
    settingsCreated,
  };
}
