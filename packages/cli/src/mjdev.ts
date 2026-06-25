#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { InstanceOrchestrator, InstanceStore } from '@mj-forge/orchestrator';
import type { InstanceEvent, SetupStep } from '@mj-forge/shared';
import { runE2E, defaultScreenshotDir, type E2ECheck } from './e2e.js';

/**
 * `mjdev` — the headless CLI for MJ Dev Manager. Shares the exact orchestration
 * engine the GUI uses. Every command supports `--json` so Claude Code (or any
 * agent swarm) can drive it and parse results: progress events stream as JSON
 * lines on stderr, and the final result is a single JSON object on stdout.
 */

function makeSink(json: boolean) {
  return (event: InstanceEvent) => {
    if (json) {
      process.stderr.write(JSON.stringify({ type: 'event', ...event }) + '\n');
      return;
    }
    const color =
      event.level === 'error'
        ? chalk.red
        : event.level === 'success'
          ? chalk.green
          : event.level === 'warn'
            ? chalk.yellow
            : chalk.gray;
    process.stderr.write(color(`  ${event.message}`) + '\n');
  };
}

function emitResult(json: boolean, data: unknown, human: () => void): void {
  if (json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else human();
}

function fail(json: boolean, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json)
    process.stdout.write(JSON.stringify({ success: false, error: message }, null, 2) + '\n');
  else console.error(chalk.red('Error:'), message);
  process.exit(1);
}

const engine = () => new InstanceOrchestrator();

const program = new Command();
program
  .name('mjdev')
  .description('MJ Dev Manager — orchestrate isolated MemberJunction dev instances')
  .version('0.1.0');

program
  .command('create')
  .description('Provision a new instance from a YAML config')
  .argument('<config>', 'path to an instance YAML config file')
  .option('--json', 'machine-readable output')
  .action(async (config: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const cfg = await InstanceStore.parseConfigFile(config);
      const { record } = await engine().create(cfg, makeSink(json));
      emitResult(json, { success: true, record }, () => {
        console.log(chalk.green(`\n✓ Provisioned "${record.slug}"`));
        console.log(
          `  SQL :${record.ports.sql}  API :${record.ports.api}  Explorer :${record.ports.explorer}`
        );
        console.log(`  Worktree: ${record.worktreePath}`);
        console.log(
          chalk.cyan(`\n  Next: mjdev setup ${record.slug} all   (deps → build → migrate)`)
        );
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('list')
  .description('List all instances')
  .option('--json', 'machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const instances = await engine().list();
      emitResult(json, { success: true, instances }, () => {
        if (instances.length === 0)
          return console.log(
            chalk.gray('No instances yet. Create one with `mjdev create <config.yaml>`.')
          );
        for (const i of instances) {
          const dot =
            i.status === 'running'
              ? chalk.green('●')
              : i.status === 'error'
                ? chalk.red('●')
                : chalk.gray('○');
          console.log(
            `${dot} ${chalk.bold(i.slug)}  ${chalk.gray(i.branch)}  SQL :${i.ports.sql} API :${i.ports.api} Explorer :${i.ports.explorer}`
          );
        }
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('info')
  .description('Show full details for an instance')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const info = await engine().info(slug);
      emitResult(json, { success: true, ...info }, () => {
        console.log(JSON.stringify(info, null, 2));
      });
    } catch (err) {
      fail(json, err);
    }
  });

for (const verb of ['start', 'stop'] as const) {
  program
    .command(verb)
    .description(`${verb[0].toUpperCase()}${verb.slice(1)} an instance's SQL container`)
    .argument('<slug>')
    .option('--json', 'machine-readable output')
    .action(async (slug: string, opts: { json?: boolean }) => {
      const json = !!opts.json;
      try {
        const record = await engine()[verb](slug, makeSink(json));
        emitResult(json, { success: true, record }, () =>
          console.log(chalk.green(`✓ ${verb}ed ${slug}`))
        );
      } catch (err) {
        fail(json, err);
      }
    });
}

program
  .command('pull')
  .description('Pull the instance branch from its remote upstream (fast-forward only)')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().pullInstance(slug, makeSink(json));
      emitResult(json, { success: true, ...r }, () => console.log(chalk.green(`✓ ${r.message}`)));
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('merge')
  .description(
    "Merge the instance's base branch in to pick up base-branch commits (re-run migrate + build after)"
  )
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().mergeInstanceFromBase(slug, makeSink(json));
      emitResult(json, { success: true, ...r }, () => console.log(chalk.green(`✓ ${r.message}`)));
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('delete')
  .description('Delete an instance (container, volume, worktree, record)')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      await engine().delete(slug, makeSink(json));
      emitResult(json, { success: true, slug }, () =>
        console.log(chalk.green(`✓ Deleted ${slug}`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('reset')
  .description(
    'Delete ALL instances + tear down the shared SQL Server (container, volume, worktrees) — for cutover/cleanup'
  )
  .option('--yes', 'actually delete; without this, only lists what would be removed')
  .option('--json', 'machine-readable output')
  .action(async (opts: { yes?: boolean; json?: boolean }) => {
    const json = !!opts.json;
    try {
      const eng = engine();
      const instances = await eng.list();
      const slugs = instances.map(i => i.slug);
      if (!opts.yes) {
        emitResult(json, { dryRun: true, slugs }, () => {
          if (!slugs.length) console.log(chalk.dim('No instances to delete.'));
          else {
            console.log(
              chalk.yellow(`Would delete ${slugs.length} instance(s): ${slugs.join(', ')}`)
            );
            console.log(chalk.dim('Re-run with --yes to delete them.'));
          }
        });
        return;
      }
      const deleted: string[] = [];
      const failed: Array<{ slug: string; error: string }> = [];
      for (const slug of slugs) {
        try {
          await eng.delete(slug, makeSink(json));
          deleted.push(slug);
        } catch (err) {
          failed.push({ slug, error: err instanceof Error ? err.message : String(err) });
        }
      }
      // Tear down the shared SQL Server (and any legacy per-instance containers)
      // so a cutover leaves nothing orphaned.
      await eng.teardownServer(makeSink(json)).catch(() => {});
      emitResult(json, { deleted, failed, serverTornDown: true }, () => {
        if (deleted.length)
          console.log(chalk.green(`✓ Deleted ${deleted.length}: ${deleted.join(', ')}`));
        for (const f of failed) console.log(chalk.red(`✗ ${f.slug}: ${f.error}`));
        console.log(chalk.green('✓ Shared SQL Server torn down'));
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('open')
  .description('Open the instance in VS Code (multi-root workspace if apps are dev-linked)')
  .argument('<slug>')
  .action(async (slug: string) => {
    try {
      // Reconciles the symlinks + .code-workspace, then opens the workspace when present.
      const target = await engine().prepareEditorTarget(slug);
      spawn('code', [target], { detached: true, stdio: 'ignore' }).unref();
      console.log(chalk.green(`✓ Opening ${target} in VS Code`));
    } catch (err) {
      fail(false, err);
    }
  });

program
  .command('setup')
  .description(
    'Run a setup step. `all` = deps→build→migrate (provisioning). ' +
      '`codegen` is ON-DEMAND only (run when you change schema/metadata; can clobber committed generated code — see docs).'
  )
  .argument('<slug>')
  .argument('<step>', 'deps | migrate | build | codegen | all')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, step: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    const valid = ['deps', 'migrate', 'codegen', 'build', 'all'];
    if (!valid.includes(step)) fail(json, new Error(`step must be one of: ${valid.join(', ')}`));
    try {
      const record = await engine().runSetup(slug, step as SetupStep | 'all', makeSink(json));
      emitResult(json, { success: true, record }, () =>
        console.log(chalk.green(`✓ setup ${step} complete for ${slug}`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('runs')
  .description('List the launchable targets (services + scripts) for an instance')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const options = await engine().listRunTargets(slug);
      emitResult(json, { success: true, options }, () => {
        if (options.length === 0) return console.log(chalk.gray('No run targets found.'));
        for (const o of options)
          console.log(
            `${chalk.bold(o.name)}  ${chalk.gray(o.kind)}${o.port ? `  :${o.port}` : ''}  — run with \`mjdev run ${slug} ${o.name}\``
          );
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('run')
  .description('Launch a service (detached, persists): api | explorer | <package-script>')
  .argument('<slug>')
  .argument('<target>', 'api | explorer | <script-name> (see `mjdev runs <slug>`)')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, target: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const launch = target === 'api' || target === 'explorer' ? target : { script: target };
      // Detached + registry-tracked: the process keeps running after the CLI
      // exits and shows up in `mjdev ps` and the GUI. No need to block.
      const proc = await engine().startProcess(slug, launch, makeSink(json));
      emitResult(json, { success: true, process: proc }, () =>
        console.log(
          chalk.green(
            `✓ Started ${proc.label}${proc.port ? ` on :${proc.port}` : ''} (pid ${proc.pid}, id ${proc.id})`
          )
        )
      );
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('ps')
  .description('List running processes (shared with the GUI); omit slug for all instances')
  .argument('[slug]')
  .option('--json', 'machine-readable output')
  .action(async (slug: string | undefined, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const processes = await engine().listProcesses(slug);
      emitResult(json, { success: true, processes }, () => {
        if (processes.length === 0) return console.log(chalk.gray('No processes.'));
        for (const p of processes)
          console.log(
            `${p.status === 'running' ? chalk.green('●') : chalk.gray('○')} ${p.label}  ${p.port ? `:${p.port}` : ''}  ${chalk.gray(p.slug)}  pid ${p.pid ?? '?'}  ${p.status}  ${chalk.gray(`[${p.source ?? '?'}] ${p.id}`)}`
          );
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('kill')
  .description('Stop a running process by its id (from `mjdev ps`)')
  .argument('<id>')
  .option('--json', 'machine-readable output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      await engine().stopProcess(id);
      emitResult(json, { success: true, id }, () => console.log(chalk.green(`✓ Stopped ${id}`)));
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('logs')
  .description('Print the captured log tail for a process id (from `mjdev ps`)')
  .argument('<id>')
  .option('--json', 'machine-readable output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const lines = await engine().processLogs(id);
      emitResult(json, { success: true, id, lines }, () => process.stdout.write(lines.join('\n')));
    } catch (err) {
      fail(json, err);
    }
  });

// ── Developer identity / persona auth (Phase 2) ──────────────────────────────

const persona = program
  .command('persona')
  .description('Manage developer personas (dev identities)');

persona
  .command('list')
  .description('List developer personas')
  .option('--json', 'machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const eng = engine();
      const [personas, active] = await Promise.all([eng.listPersonas(), eng.getActivePersona()]);
      emitResult(json, { success: true, personas, activePersonaId: active?.id }, () => {
        if (personas.length === 0)
          return console.log(chalk.gray('No personas. Add one with `mjdev persona add`.'));
        for (const p of personas) {
          const star = p.id === active?.id ? chalk.green(' (active)') : '';
          console.log(
            `${chalk.bold(p.name)}  ${chalk.gray(p.email)}  [${p.roles.join(', ') || 'no roles'}]${star}`
          );
        }
      });
    } catch (err) {
      fail(json, err);
    }
  });

persona
  .command('add')
  .description('Create a developer persona')
  .requiredOption('--name <name>', 'display name, e.g. "Admin"')
  .requiredOption('--email <email>', 'dev email, e.g. admin@mjdev.local')
  .option('--roles <roles>', 'comma-separated MJ role names (use "Owner" for full access)', 'Owner')
  .option('--json', 'machine-readable output')
  .action(async (opts: { name: string; email: string; roles: string; json?: boolean }) => {
    const json = !!opts.json;
    try {
      const roles = opts.roles
        .split(',')
        .map(r => r.trim())
        .filter(Boolean);
      const saved = await engine().savePersona({ name: opts.name, email: opts.email, roles });
      emitResult(json, { success: true, persona: saved }, () =>
        console.log(chalk.green(`✓ Added persona "${saved.name}" (${saved.email})`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

persona
  .command('remove')
  .description('Delete a developer persona')
  .argument('<id>')
  .option('--json', 'machine-readable output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      await engine().removePersona(id);
      emitResult(json, { success: true, id }, () =>
        console.log(chalk.green(`✓ Removed persona ${id}`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('login')
  .description('Set the globally active developer persona')
  .argument('<id>', 'persona id (see `mjdev persona list`)')
  .option('--json', 'machine-readable output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      await engine().setActivePersona(id);
      const active = await engine().getActivePersona();
      emitResult(json, { success: true, active }, () =>
        console.log(chalk.green(`✓ Active persona: ${active?.name} (${active?.email})`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('whoami')
  .description('Show the active persona, or the persona an instance acts as')
  .argument('[slug]', 'optional instance slug for its effective persona')
  .option('--json', 'machine-readable output')
  .action(async (slug: string | undefined, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const who = slug ? await engine().whoami(slug) : await engine().getActivePersona();
      emitResult(json, { success: true, persona: who }, () => {
        if (!who) return console.log(chalk.gray('No active persona. Run `mjdev login <id>`.'));
        console.log(`${chalk.bold(who.name)}  ${chalk.gray(who.email)}`);
      });
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('key')
  .description(
    "Print the instance's mj_sk_* API key for the active/override persona (mints if needed)"
  )
  .argument('<slug>')
  .option('--force', 're-mint a new key even if one exists')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { force?: boolean; json?: boolean }) => {
    const json = !!opts.json;
    try {
      const rawKey = await engine().mintApiKey(slug, makeSink(json), !!opts.force);
      emitResult(json, { success: true, rawKey }, () => console.log(rawKey));
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('explorer-url')
  .description('Mint a magic-link session and print a logged-in Explorer URL (needs MJAPI running)')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const url = await engine().openExplorerAs(slug, makeSink(json));
      emitResult(json, { success: true, url }, () => console.log(url));
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('e2e')
  .description(
    'Run a headless GUI check against an instance Explorer (Playwright; needs MJAPI running)'
  )
  .argument('<slug>')
  .option('--check <kind>', 'apps | login', 'apps')
  .option('--min-apps <n>', 'minimum apps the switcher must show for --check apps', '2')
  .option('--headed', 'launch a visible browser (debugging)')
  .option('--timeout <ms>', 'per-step wait budget in ms', '30000')
  .option('--screenshot-dir <path>', 'directory for failure screenshots')
  .option('--json', 'machine-readable output')
  .action(
    async (
      slug: string,
      opts: {
        check?: string;
        minApps?: string;
        headed?: boolean;
        timeout?: string;
        screenshotDir?: string;
        json?: boolean;
      }
    ) => {
      const json = !!opts.json;
      const check: E2ECheck = opts.check === 'login' ? 'login' : 'apps';
      try {
        const result = await runE2E(engine(), slug, {
          check,
          minApps: Number.parseInt(opts.minApps ?? '2', 10) || 2,
          headed: !!opts.headed,
          timeoutMs: Number.parseInt(opts.timeout ?? '30000', 10) || 30000,
          screenshotDir: opts.screenshotDir || defaultScreenshotDir(),
          sink: makeSink(json),
        });
        emitResult(json, result, () => {
          if (result.success) {
            const extra =
              check === 'apps' ? ` — ${result.appCount} apps: ${result.apps.join(', ')}` : '';
            console.log(chalk.green(`✓ ${check} passed`) + extra);
          } else {
            console.error(
              chalk.red(`✗ ${check} failed (${result.failureKind}): ${result.details}`)
            );
            if (result.screenshotPath)
              console.error(chalk.gray(`  screenshot: ${result.screenshotPath}`));
          }
        });
        if (!result.success) process.exitCode = 1;
      } catch (err) {
        fail(json, err);
      }
    }
  );

program
  .command('backfill')
  .description('Regenerate config + auth secrets for an existing instance (pre-Phase-2 instances)')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const written = await engine().regenerateConfig(slug, makeSink(json));
      emitResult(json, { success: true, written }, () =>
        console.log(chalk.green(`✓ Regenerated ${written.length} config file(s) for ${slug}`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

// ── App access (per persona; default-on, faithful to prod UserApplication) ────

const apps = program
  .command('apps')
  .description("Manage which MJ apps the instance's persona can access (default: all on)");

apps
  .command('list')
  .description("List the instance's apps and the persona's access state")
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const list = await engine().listAppAccess(slug);
      emitResult(json, { success: true, apps: list }, () => {
        if (list.length === 0)
          return console.log(chalk.gray('No apps found (is the instance migrated?).'));
        for (const a of list) {
          const mark = a.granted ? chalk.green('✓ on ') : chalk.gray('✗ off');
          console.log(`${mark}  ${a.name}`);
        }
      });
    } catch (err) {
      fail(json, err);
    }
  });

for (const [verb, granted] of [
  ['enable', true],
  ['disable', false],
] as const) {
  apps
    .command(verb)
    .description(`${verb === 'enable' ? 'Grant' : 'Revoke'} the persona's access to an app`)
    .argument('<slug>')
    .argument('<app>', 'application name (see `mjdev apps list`)')
    .option('--json', 'machine-readable output')
    .action(async (slug: string, app: string, opts: { json?: boolean }) => {
      const json = !!opts.json;
      try {
        const list = await engine().setAppAccess(slug, app, granted, makeSink(json));
        emitResult(json, { success: true, apps: list }, () =>
          console.log(chalk.green(`✓ ${granted ? 'Enabled' : 'Disabled'} "${app}" for ${slug}`))
        );
      } catch (err) {
        fail(json, err);
      }
    });
}

// ── Open-app dev-linking (`mjdev app …`) ─────────────────────────────────────
// Distinct from `mjdev apps …` (persona application access): this group manages
// developing Open Apps against an instance with production-install parity.
const app = program
  .command('app')
  .description('Dev-link Open Apps into an instance (install parity)');

app
  .command('link')
  .description('Dev-link an Open App (GitHub URL or local path) into an instance')
  .argument('<slug>')
  .argument('<appRef>', 'GitHub URL or local path of the open app')
  .option('--ignore-version-range', 'override the manifest mjVersionRange check (off-tag dev)')
  .option(
    '--allow-double-underscore-schema',
    'allow a reserved `__`-prefixed schema (first-party MJ apps like bizapps-* need this)'
  )
  .option('--branch <branch>', 'app branch to develop on in this instance')
  .option('--base-ref <ref>', 'start point for a new app branch')
  .option('--json', 'machine-readable output')
  .action(
    async (
      slug: string,
      appRef: string,
      opts: {
        ignoreVersionRange?: boolean;
        allowDoubleUnderscoreSchema?: boolean;
        branch?: string;
        baseRef?: string;
        json?: boolean;
      }
    ) => {
      const json = !!opts.json;
      try {
        const r = await engine().linkApp(
          slug,
          appRef,
          {
            ignoreVersionRange: opts.ignoreVersionRange,
            allowDoubleUnderscore: opts.allowDoubleUnderscoreSchema,
            appBranch: opts.branch,
            baseRef: opts.baseRef,
          },
          makeSink(json)
        );
        emitResult(json, { success: true, ...r }, () =>
          console.log(chalk.green(`\n✓ Dev-linked "${r.appName}" into ${slug}`))
        );
      } catch (err) {
        fail(json, err);
      }
    }
  );

app
  .command('install')
  .description('Plain-install an Open App from GitHub (the real install path, + transitive deps)')
  .argument('<slug>')
  .argument('<source>', 'GitHub URL of the open app')
  .option('--version <version>', 'specific release/tag (default: the repo default branch)')
  .option(
    '--allow-double-underscore-schema',
    'allow a reserved `__`-prefixed schema (first-party MJ apps like bizapps-* need this)'
  )
  .option('--json', 'machine-readable output')
  .action(
    async (
      slug: string,
      source: string,
      opts: { version?: string; allowDoubleUnderscoreSchema?: boolean; json?: boolean }
    ) => {
      const json = !!opts.json;
      try {
        const r = await engine().installApp(
          slug,
          source,
          { version: opts.version, allowDoubleUnderscore: opts.allowDoubleUnderscoreSchema },
          makeSink(json)
        );
        emitResult(json, { success: true, ...r }, () =>
          console.log(
            chalk.green(
              `\n✓ Installed "${r.appName}"${r.version ? ` v${r.version}` : ''} into ${slug}`
            )
          )
        );
      } catch (err) {
        fail(json, err);
      }
    }
  );

app
  .command('remove')
  .description(
    'Remove an app (dev-linked → unlink, installed → uninstall); drops schema by default'
  )
  .argument('<slug>')
  .argument('<app>', 'app name (see `mjdev app list`)')
  .option('--keep-data', "preserve the app's schema + data (don't drop)")
  .option('--force', 'remove even if other installed apps depend on it')
  .option('--json', 'machine-readable output')
  .action(
    async (
      slug: string,
      appName: string,
      opts: { keepData?: boolean; force?: boolean; json?: boolean }
    ) => {
      const json = !!opts.json;
      try {
        await engine().removeApp(
          slug,
          appName,
          { keepData: opts.keepData, force: opts.force },
          makeSink(json)
        );
        emitResult(json, { success: true }, () =>
          console.log(chalk.green(`✓ Removed "${appName}"`))
        );
      } catch (err) {
        fail(json, err);
      }
    }
  );

app
  .command('unlink')
  .description('Reverse a dev-link (optionally drop the app schema)')
  .argument('<slug>')
  .argument('<app>', 'app dir name (see `mjdev app list`)')
  .option('--drop-schema', 'also drop the app schema + metadata (destructive)')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { dropSchema?: boolean; json?: boolean }) => {
    const json = !!opts.json;
    try {
      await engine().unlinkApp(slug, appName, { dropSchema: opts.dropSchema }, makeSink(json));
      emitResult(json, { success: true }, () =>
        console.log(chalk.green(`✓ Unlinked "${appName}"`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('switch')
  .description('Switch an app between dev (local source) and installed (published)')
  .argument('<slug>')
  .argument('<app>')
  .argument('<mode>', 'dev | installed')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, mode: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    if (mode !== 'dev' && mode !== 'installed')
      fail(json, new Error("mode must be 'dev' or 'installed'"));
    try {
      await engine().switchAppMode(slug, appName, mode as 'dev' | 'installed', makeSink(json));
      emitResult(json, { success: true }, () =>
        console.log(chalk.green(`✓ "${appName}" -> ${mode}`))
      );
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('list')
  .description('List apps dev-linked into an instance')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const linked = await engine().listApps(slug);
      emitResult(json, { success: true, apps: linked }, () => {
        if (linked.length === 0) return console.log(chalk.gray('No dev-linked apps.'));
        for (const a of linked) {
          const flag = a.ignoreVersionRangeUsed ? chalk.yellow(' (version-override)') : '';
          console.log(
            `  ${chalk.cyan(a.mode)}  ${a.appName}${flag}  ${chalk.gray(a.linkedBranch ?? '')}`
          );
        }
      });
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('drift')
  .description('Check a dev-linked app for migration checksum drift')
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().checkAppDrift(slug, appName, makeSink(json));
      emitResult(json, { success: true, ...r }, () =>
        console.log(
          r.valid ? chalk.green('✓ No drift') : chalk.red(`✗ Drift:\n  ${r.errors.join('\n  ')}`)
        )
      );
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('build')
  .description("Build a dev-linked app's workspace sub-packages (required before boot)")
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().buildApp(slug, appName, makeSink(json));
      emitResult(json, { success: r.ok, ...r }, () =>
        console.log(
          r.ok
            ? chalk.green(`✓ Built: ${r.built.join(', ') || '(nothing to build)'}`)
            : chalk.red(`✗ Build failed: ${r.failed.map(f => f.name).join(', ')}`)
        )
      );
      if (!r.ok) process.exit(1);
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('build-all')
  .description('Rebuild all dev-linked apps in an instance, in cross-app dependency order')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().buildAllApps(slug, makeSink(json));
      emitResult(json, { success: r.ok, ...r }, () =>
        console.log(
          r.ok
            ? chalk.green(
                `✓ Built ${r.apps.length} app(s): ${r.apps.map(a => a.appName).join(', ')}`
              )
            : chalk.red(
                `✗ Build failed: ${r.apps
                  .filter(a => !a.ok)
                  .map(a => a.appName)
                  .join(', ')}`
              )
        )
      );
      if (!r.ok) process.exit(1);
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('migrate')
  .description("Run a dev-linked app's schema migrations (apply newly-added migration files)")
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().migrateApp(slug, appName, makeSink(json));
      emitResult(json, { success: r.ok, ...r }, () =>
        console.log(
          r.ok
            ? chalk.green(`✓ Migrations applied for ${appName}`)
            : chalk.red(`✗ Migrate failed: ${r.error ?? 'unknown'}`)
        )
      );
      if (!r.ok) process.exit(1);
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('codegen')
  .description(
    "Regenerate a dev-linked app's entities from the instance DB + rebuild (run after migrate)"
  )
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().codegenApp(slug, appName, makeSink(json));
      emitResult(json, { success: r.ok, ...r }, () =>
        console.log(
          r.ok
            ? chalk.green(`✓ CodeGen complete for ${appName}`)
            : chalk.red(`✗ CodeGen failed: ${r.error ?? 'unknown'}`)
        )
      );
      if (!r.ok) process.exit(1);
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('setup')
  .description('Bring a dev-linked app to ready: migrate → sync → codegen → build (one step)')
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const r = await engine().setupApp(slug, appName, makeSink(json));
      emitResult(json, { success: r.ok, ...r }, () =>
        console.log(
          r.ok
            ? chalk.green(`✓ ${appName} set up (migrate→sync→codegen→build)`)
            : chalk.red(
                `✗ Setup incomplete: ${Object.entries(r.steps)
                  .map(([k, v]) => `${k}=${v ? 'ok' : 'fail'}`)
                  .join(' ')}`
              )
        )
      );
      if (!r.ok) process.exit(1);
    } catch (err) {
      fail(json, err);
    }
  });

app
  .command('sync')
  .description("Push a dev-linked app's metadata seed (e.g. currencies) into the instance DB")
  .argument('<slug>')
  .argument('<app>')
  .option('--dir <dir>', 'metadata directory (relative to the app), default: metadata')
  .option('--include <entity>', 'limit to one entity/section (e.g. currencies)')
  .option('--pull', 'pull DB → files instead of push')
  .option('--status', 'show status instead of push')
  .option('--json', 'machine-readable output')
  .action(
    async (
      slug: string,
      appName: string,
      opts: { dir?: string; include?: string; pull?: boolean; status?: boolean; json?: boolean }
    ) => {
      const json = !!opts.json;
      const mode = opts.status ? 'status' : opts.pull ? 'pull' : 'push';
      try {
        const r = await engine().syncApp(
          slug,
          appName,
          { dir: opts.dir, include: opts.include, mode },
          makeSink(json)
        );
        emitResult(json, { success: r.ok, ...r }, () =>
          console.log(
            r.ok
              ? chalk.green(`✓ Metadata ${mode} complete for ${appName}`)
              : chalk.red(`✗ Metadata sync failed: ${r.error ?? 'unknown'}`)
          )
        );
        if (!r.ok) process.exit(1);
      } catch (err) {
        fail(json, err);
      }
    }
  );

app
  .command('watch-targets')
  .description("List the watcher commands for a dev-linked app's sub-packages (live-edit)")
  .argument('<slug>')
  .argument('<app>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const targets = await engine().appWatchTargets(slug, appName);
      emitResult(json, { success: true, targets }, () => {
        for (const t of targets)
          console.log(
            `  ${chalk.cyan(t.name)}: ${t.command} ${t.args.join(' ')}${t.note ? chalk.yellow(` (${t.note})`) : ''}`
          );
      });
    } catch (err) {
      fail(json, err);
    }
  });

for (const [verb, label] of [
  [
    'reset-schema',
    'Reset (Clean + re-migrate) — fixes an edited versioned migration (destructive)',
  ],
  ['repair-schema', 'Repair migration history (realign failed/baseline rows; does NOT re-run SQL)'],
] as const) {
  app
    .command(verb)
    .description(label)
    .argument('<slug>')
    .argument('<app>')
    .option('--json', 'machine-readable output')
    .action(async (slug: string, appName: string, opts: { json?: boolean }) => {
      const json = !!opts.json;
      try {
        if (verb === 'reset-schema') await engine().resetAppSchema(slug, appName, makeSink(json));
        else await engine().repairAppSchema(slug, appName, makeSink(json));
        emitResult(json, { success: true }, () =>
          console.log(chalk.green(`✓ ${verb} done for "${appName}"`))
        );
      } catch (err) {
        fail(json, err);
      }
    });
}

program.parseAsync().catch(err => fail(false, err));
