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
 *  - `MJDEV-ISSUES.md`      — escalation log, created if absent, NEVER clobbered.
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
    '**Start here:** @.mjdev-docs/ORCHESTRATION.md',
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
    '',
    "Run the CLI via `./bin/mjdev` — it pins this workspace's isolation env so the CLI",
    'and GUI share the same state.',
    '',
    'Suspect a **mjdev-tool** bug (vs an MJ-core or app bug)? Log it in `./MJDEV-ISSUES.md`',
    '(see the protocol in ORCHESTRATION.md).',
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
    settingsCreated,
  };
}
