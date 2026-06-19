#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { InstanceOrchestrator, InstanceStore } from '@mj-forge/orchestrator';
import type { InstanceEvent, SetupStep } from '@mj-forge/shared';

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
          chalk.cyan(
            `\n  Next: mjdev setup ${record.slug} all   (deps → migrate → codegen → build)`
          )
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
  .command('open')
  .description('Open the instance worktree in VS Code')
  .argument('<slug>')
  .action(async (slug: string) => {
    try {
      const dir = await engine().worktreePath(slug);
      spawn('code', [dir], { detached: true, stdio: 'ignore' }).unref();
      console.log(chalk.green(`✓ Opening ${dir} in VS Code`));
    } catch (err) {
      fail(false, err);
    }
  });

program
  .command('setup')
  .description('Run a setup step: deps | migrate | codegen | build | all')
  .argument('<slug>')
  .argument('<step>', 'deps | migrate | codegen | build | all')
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
  .command('run')
  .description('Launch a service: api | explorer | <package-script>')
  .argument('<slug>')
  .argument('<target>', 'api | explorer | <script-name>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, target: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const launch = target === 'api' || target === 'explorer' ? target : { script: target };
      const proc = await engine().startProcess(slug, launch, makeSink(json));
      emitResult(json, { success: true, process: proc }, () =>
        console.log(
          chalk.green(
            `✓ Started ${proc.label}${proc.port ? ` on :${proc.port}` : ''} (pid ${proc.pid})`
          )
        )
      );
      // Keep the CLI alive so the child process keeps running when run headless.
      process.stdin.resume();
    } catch (err) {
      fail(json, err);
    }
  });

program
  .command('ps')
  .description('List running processes for an instance and their ports')
  .argument('<slug>')
  .option('--json', 'machine-readable output')
  .action(async (slug: string, opts: { json?: boolean }) => {
    const json = !!opts.json;
    try {
      const processes = engine().listProcesses(slug);
      emitResult(json, { success: true, processes }, () => {
        if (processes.length === 0) return console.log(chalk.gray('No running processes.'));
        for (const p of processes)
          console.log(
            `${p.status === 'running' ? chalk.green('●') : chalk.gray('○')} ${p.label}  ${p.port ? `:${p.port}` : ''}  pid ${p.pid}  ${p.status}`
          );
      });
    } catch (err) {
      fail(json, err);
    }
  });

program.parseAsync().catch(err => fail(false, err));
