#!/usr/bin/env node
// Orchestrator: runs the unit and integration tiers end-to-end, captures their
// JSON output, normalizes the results, and writes a self-contained HTML report
// to tests/reports/.
//
// Usage:
//   node tests/reporter/build-report.mjs            # default: bring harness up, leave running
//   node tests/reporter/build-report.mjs --teardown # tear down harness when done
//   node tests/reporter/build-report.mjs --no-harness  # skip integration tier (unit only)
//
// Exit code is 0 only if every executed tier passed.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReportHtml } from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const REPORTS_DIR = join(REPO_ROOT, 'tests', 'reports');
const CACHE_DIR = join(REPORTS_DIR, '.cache');

const ARGS = parseArgs(process.argv.slice(2));

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  const startedAt = Date.now();
  const git = await getGitContext();

  console.log('▶ MJ Forge regression run starting');
  console.log(`  git: ${git.branch}@${git.commit}${git.dirty ? ' (dirty)' : ''}`);

  const tiers = [];

  // Tier 1: unit
  const unitResult = await runVitestTier({
    label: 'Unit',
    configFlag: [],
    cacheFile: join(CACHE_DIR, 'unit.json'),
  });
  tiers.push(unitResult);

  // Tier 2: integration (skippable via --no-harness)
  if (ARGS.harness) {
    await ensureHarnessUp();
    const integrationResult = await runVitestTier({
      label: 'Integration',
      configFlag: ['--config', 'vitest.integration.config.ts'],
      cacheFile: join(CACHE_DIR, 'integration.json'),
    });
    tiers.push(integrationResult);
  } else {
    tiers.push({
      label: 'Integration',
      status: 'pending',
      note: 'Skipped via --no-harness (Docker network not started).',
    });
  }

  // Tier 3-5: placeholders for future phases (E2E, visual, AI cassettes).
  tiers.push({ label: 'E2E (Playwright + Electron)', status: 'pending', note: 'Phase 4 — not yet implemented.' });
  tiers.push({ label: 'Visual regression', status: 'pending', note: 'Phase 5 — not yet implemented.' });

  const durationMs = Date.now() - startedAt;
  const totals = aggregateTotals(tiers);

  const report = { startedAt, durationMs, git, totals, tiers };
  const html = renderReportHtml(report);
  const reportPath = await writeReport(html, startedAt);

  console.log('');
  console.log(`▶ Result: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${formatMs(durationMs)})`);
  console.log(`▶ Report: ${reportPath}`);
  console.log(`         file://${reportPath}`);

  if (ARGS.teardown) {
    await tearDownHarness();
  }

  process.exit(totals.failed > 0 ? 1 : 0);
}

// ---- args ----

function parseArgs(argv) {
  const args = { harness: true, teardown: false };
  for (const a of argv) {
    if (a === '--no-harness') args.harness = false;
    else if (a === '--teardown') args.teardown = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tests/reporter/build-report.mjs [--no-harness] [--teardown]');
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---- git ----

async function getGitContext() {
  const branch = (await runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], REPO_ROOT)).stdout.trim();
  const commit = (await runCapture('git', ['rev-parse', '--short', 'HEAD'], REPO_ROOT)).stdout.trim();
  const dirty = (await runCapture('git', ['status', '--porcelain'], REPO_ROOT)).stdout.trim().length > 0;
  return { branch, commit, dirty };
}

// ---- harness ----

async function ensureHarnessUp() {
  console.log('▶ Bringing test harness up (idempotent)…');
  const ensureKey = await run('node', ['tests/scripts/ensure-ssh-key.mjs'], REPO_ROOT);
  if (ensureKey.code !== 0) throw new Error('ensure-ssh-key.mjs failed');

  const up = await run(
    'docker',
    ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait'],
    REPO_ROOT,
  );
  if (up.code !== 0) throw new Error('docker compose up --wait failed');
}

async function tearDownHarness() {
  console.log('▶ Tearing harness down…');
  const down = await run(
    'docker',
    ['compose', '-f', 'tests/docker-compose.test.yml', 'down', '-v'],
    REPO_ROOT,
  );
  if (down.code !== 0) console.error('docker compose down -v failed (continuing)');
}

// ---- vitest tier runner ----

async function runVitestTier({ label, configFlag, cacheFile }) {
  console.log(`▶ Running ${label} tests…`);
  const startedAt = Date.now();
  const args = [
    'vitest', 'run',
    ...configFlag,
    '--reporter=verbose',
    '--reporter=json',
    `--outputFile=${cacheFile}`,
  ];
  const { code } = await run('npx', args, REPO_ROOT);
  const durationMs = Date.now() - startedAt;

  if (!existsSync(cacheFile)) {
    return {
      label,
      status: 'failed',
      durationMs,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      suites: [{
        name: '<no JSON output>',
        durationMs,
        totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
        tests: [{
          fullName: 'vitest produced no JSON output',
          status: 'failed',
          durationMs,
          failureMessages: [`Expected JSON at ${cacheFile} but it was not written. Check stdout above.`],
        }],
      }],
    };
  }

  const json = JSON.parse(await readFile(cacheFile, 'utf8'));
  const tier = normalizeVitestJson(label, json);
  // If vitest itself failed but reported zero failures (e.g. crash), surface as failure.
  if (code !== 0 && tier.totals.failed === 0) {
    tier.status = 'failed';
    tier.totals.failed = 1;
    tier.totals.total += 1;
    tier.suites.unshift({
      name: '<runner exit>',
      durationMs: 0,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      tests: [{
        fullName: 'vitest exited with non-zero status',
        status: 'failed',
        durationMs: 0,
        failureMessages: [`vitest exited with code ${code} despite reporting no test failures.`],
      }],
    });
  }
  return tier;
}

// ---- normalizers ----

function normalizeVitestJson(label, json) {
  const suites = (json.testResults ?? []).map((file) => {
    const tests = (file.assertionResults ?? []).map((t) => ({
      fullName: t.fullName,
      status: t.status === 'pending' ? 'skipped' : t.status,
      durationMs: t.duration,
      failureMessages: t.failureMessages ?? [],
    }));
    const totals = countByStatus(tests);
    return {
      name: relative(REPO_ROOT, file.name),
      durationMs: file.endTime - file.startTime,
      totals,
      tests,
    };
  });
  const totals = {
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
    total: json.numTotalTests ?? 0,
  };
  return {
    label,
    status: totals.failed > 0 ? 'failed' : 'ok',
    durationMs: suites.reduce((acc, s) => acc + (s.durationMs || 0), 0),
    totals,
    suites,
  };
}

function countByStatus(tests) {
  const totals = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  for (const t of tests) {
    if (t.status === 'passed') totals.passed += 1;
    else if (t.status === 'failed') totals.failed += 1;
    else totals.skipped += 1;
  }
  return totals;
}

function aggregateTotals(tiers) {
  const totals = { passed: 0, failed: 0, skipped: 0, total: 0 };
  for (const t of tiers) {
    if (!t.totals) continue;
    totals.passed += t.totals.passed;
    totals.failed += t.totals.failed;
    totals.skipped += t.totals.skipped;
    totals.total += t.totals.total;
  }
  return totals;
}

// ---- write ----

async function writeReport(html, startedAt) {
  await mkdir(REPORTS_DIR, { recursive: true });
  const ts = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const versioned = join(REPORTS_DIR, `report-${ts}.html`);
  const latest = join(REPORTS_DIR, 'latest.html');
  await writeFile(versioned, html, 'utf8');
  await copyFile(versioned, latest);
  return versioned;
}

// ---- shell helpers ----

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
  });
}

function runCapture(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

main().catch((err) => {
  console.error('▶ build-report.mjs crashed:', err);
  process.exit(2);
});
