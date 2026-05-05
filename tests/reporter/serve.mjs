#!/usr/bin/env node
// Live dashboard server for the MJ Forge regression harness.
//
// Brings the Docker harness up, then runs `vitest --watch` for both the unit
// and integration tiers and hosts a live HTML dashboard at http://127.0.0.1:5188.
// Each vitest watcher uses a custom reporter (vitest-live-reporter.mjs) that
// POSTs run-start / module-start / test-result / run-end events to this
// server, which mutates state and pushes Server-Sent Events to the dashboard.
//
// Per-test results stream into the dashboard test-by-test as vitest runs, so
// the UI reflects in-flight progress rather than only the final result.
//
// Lifecycle:
//   - Ctrl+C  → stop the vitest watchers and exit. Docker is left running
//               (use `npm run test:harness:down` when you're done).

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReportBody, STYLES, SCRIPT } from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache');
const REPORTER_PATH = join(REPO_ROOT, 'tests', 'reporter', 'vitest-live-reporter.mjs');

const PORT = Number(process.env.FORGE_DASHBOARD_PORT ?? 5188);
const HOST = '127.0.0.1';
const REPORTER_URL = `http://${HOST}:${PORT}/_event`;

// ---- state ----

const state = {
  startedAt: Date.now(),
  git: { branch: 'unknown', commit: 'unknown', dirty: false },
  tiers: {
    unit: makeTier('Unit', 'Initializing — first run in progress…'),
    integration: makeTier('Integration', 'Initializing — first run in progress…'),
  },
};

function makeTier(label, note) {
  return {
    label,
    status: 'initializing',
    runState: 'idle',
    note,
    suites: new Map(), // Map<file, suite>
    totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    durationMs: 0,
    runStartedAt: 0,
    currentTest: null,
    testsCompleted: 0,
    lastUpdatedAt: 0,
  };
}

function makeSuite(file) {
  return {
    name: relative(REPO_ROOT, file),
    file,
    runState: 'idle',
    tests: new Map(), // Map<fullName, test>
    totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    durationMs: 0,
  };
}

const sseClients = new Set();

// ---- main ----

await main();

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  state.git = await getGit();

  await ensureHarnessUp();

  const unitProc = spawnVitest('unit', []);
  const intProc = spawnVitest('integration', ['--config', 'vitest.integration.config.ts']);

  watchChildExit('unit', unitProc);
  watchChildExit('integration', intProc);

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  MJ Forge live dashboard:  http://${HOST}:${PORT}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Vitest is watching both tiers. Edit code, see live updates.');
    console.log('  Ctrl+C to stop watchers (Docker stays up).');
    console.log('');
  });

  const stop = () => {
    console.log('\n▶ Stopping vitest watchers (Docker harness stays up)…');
    unitProc.kill('SIGTERM');
    intProc.kill('SIGTERM');
    server.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// ---- HTTP routing ----

function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderDashboardHtml());
    return;
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(serializeState()));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/body') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderReportBody(serializeState()));
    return;
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    pushTo(res, 'state', serializeState());
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method === 'POST' && req.url === '/_event') {
    return handleEventPost(req, res);
  }
  res.writeHead(404);
  res.end('Not found');
}

function pushTo(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Throttled broadcast: coalesces bursts of test-result events into one SSE
// message ~every 80ms so the browser doesn't get hammered when 200+ unit
// tests finish in the same second.
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastNow();
  }, 80);
}
function broadcastNow() {
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  const snapshot = serializeState();
  for (const res of sseClients) {
    try {
      pushTo(res, 'state', snapshot);
    } catch (err) {
      console.error('SSE broadcast failed for one client:', err);
      sseClients.delete(res);
    }
  }
}

// ---- event ingestion (custom Vitest reporter posts here) ----

function handleEventPost(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      res.writeHead(400);
      res.end('bad json');
      return;
    }
    handleEvent(event);
    res.writeHead(204);
    res.end();
  });
}

function handleEvent(event) {
  const tier = state.tiers[event.tier];
  if (!tier) return;
  const at = event.at ?? Date.now();

  if (event.type === 'run-start') {
    tier.runState = 'running';
    tier.runStartedAt = at;
    tier.currentTest = null;
    tier.testsCompleted = 0;
    tier.note = undefined;
    // Mark every file in this run as 'running'. New files get an empty suite.
    for (const file of event.files ?? []) {
      const suite = tier.suites.get(file) ?? makeSuite(file);
      suite.runState = 'running';
      tier.suites.set(file, suite);
    }
    if (tier.status === 'initializing') tier.status = 'ok';
    scheduleBroadcast();
    return;
  }

  if (event.type === 'module-start') {
    const suite = tier.suites.get(event.file) ?? makeSuite(event.file);
    suite.runState = 'running';
    tier.suites.set(event.file, suite);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'module-end') {
    const suite = tier.suites.get(event.file);
    if (suite) {
      suite.runState = 'idle';
      recomputeSuiteTotals(suite);
    }
    recomputeTierTotals(tier);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'test-result') {
    const suite = tier.suites.get(event.file) ?? makeSuite(event.file);
    suite.tests.set(event.fullName, {
      fullName: event.fullName,
      status: normalizeStatus(event.status),
      durationMs: event.durationMs,
      failureMessages: event.failureMessages ?? [],
    });
    tier.suites.set(event.file, suite);
    tier.currentTest = event.fullName;
    tier.testsCompleted += 1;
    tier.lastUpdatedAt = at;
    recomputeSuiteTotals(suite);
    recomputeTierTotals(tier);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'run-end') {
    tier.runState = 'idle';
    tier.currentTest = null;
    for (const suite of tier.suites.values()) {
      suite.runState = 'idle';
      recomputeSuiteTotals(suite);
    }
    recomputeTierTotals(tier);
    tier.status = tier.totals.failed > 0 ? 'failed' : 'ok';
    tier.lastUpdatedAt = at;
    broadcastNow(); // flush coalesced events promptly on completion
    return;
  }
}

function normalizeStatus(s) {
  if (s === 'passed' || s === 'failed' || s === 'skipped') return s;
  if (s === 'pending' || s === 'todo' || s === 'unknown') return 'skipped';
  return 'skipped';
}

function recomputeSuiteTotals(suite) {
  const tests = Array.from(suite.tests.values());
  const t = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  let dur = 0;
  for (const x of tests) {
    if (x.status === 'passed') t.passed += 1;
    else if (x.status === 'failed') t.failed += 1;
    else t.skipped += 1;
    dur += x.durationMs ?? 0;
  }
  suite.totals = t;
  suite.durationMs = dur;
}

function recomputeTierTotals(tier) {
  const t = { passed: 0, failed: 0, skipped: 0, total: 0 };
  let dur = 0;
  for (const s of tier.suites.values()) {
    t.passed += s.totals.passed;
    t.failed += s.totals.failed;
    t.skipped += s.totals.skipped;
    t.total += s.totals.total;
    dur += s.durationMs;
  }
  tier.totals = t;
  tier.durationMs = dur;
}

// ---- vitest watch supervision ----

function spawnVitest(tier, extraArgs) {
  // `--watch` forces watch mode. Vitest's default is "watch if stdin is a TTY"
  // but when invoked through `npm run` + child_process.spawn the TTY detection
  // is unreliable, so we make it explicit.
  const args = [
    'vitest',
    '--watch',
    ...extraArgs,
    '--reporter=default',
    `--reporter=${REPORTER_PATH}`,
    '--reporter=json',
    `--outputFile=${join(CACHE_DIR, `${tier}.json`)}`,
  ];
  console.log(`▶ spawning vitest watch for ${tier}`);
  const child = spawn('npx', args, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      FORGE_LIVE_REPORTER_URL: REPORTER_URL,
      FORGE_LIVE_REPORTER_TIER: tier,
    },
  });
  return child;
}

function watchChildExit(tier, child) {
  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return; // we asked it to stop
    if (code === null || code === 0) return;
    console.error(`▶ vitest ${tier} exited unexpectedly (code ${code})`);
    const t = state.tiers[tier];
    if (t) {
      t.runState = 'idle';
      t.status = 'failed';
      t.note = `vitest ${tier} crashed (exit code ${code}). Check the terminal output.`;
      broadcastNow();
    }
  });
}

// ---- serialization ----

function serializeState() {
  const tiers = [];
  for (const key of ['unit', 'integration']) {
    const t = state.tiers[key];
    if (t.status === 'initializing' && t.suites.size === 0) {
      tiers.push({
        label: t.label,
        status: 'pending',
        runState: t.runState,
        note: t.note ?? 'Initializing…',
      });
      continue;
    }
    tiers.push({
      label: t.label,
      status: t.status,
      runState: t.runState,
      durationMs: t.durationMs,
      totals: t.totals,
      currentTest: t.currentTest,
      testsCompleted: t.testsCompleted,
      suites: Array.from(t.suites.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          name: s.name,
          runState: s.runState,
          durationMs: s.durationMs,
          totals: s.totals,
          tests: Array.from(s.tests.values()),
        })),
    });
  }
  // Phase 4 / 5 placeholders.
  tiers.push({ label: 'E2E (Playwright + Electron)', status: 'pending', note: 'Phase 4 — not yet implemented.' });
  tiers.push({ label: 'Visual regression', status: 'pending', note: 'Phase 5 — not yet implemented.' });

  // Aggregate totals across active tiers.
  const totals = { passed: 0, failed: 0, skipped: 0, total: 0 };
  let durationMs = 0;
  for (const t of tiers) {
    if (!t.totals) continue;
    totals.passed += t.totals.passed;
    totals.failed += t.totals.failed;
    totals.skipped += t.totals.skipped;
    totals.total += t.totals.total;
    durationMs += t.durationMs ?? 0;
  }

  return { startedAt: state.startedAt, durationMs, git: state.git, totals, tiers };
}

// ---- dashboard HTML ----

function renderDashboardHtml() {
  const dirtyMark = state.git.dirty ? ' <span class="dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MJ Forge — live regression dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
${STYLES}
.live-banner {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-success);
  box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
  animation: livePulse 2s infinite;
}
.live-dot.disconnected {
  background: var(--status-error);
  animation: none;
  box-shadow: none;
}
@keyframes livePulse {
  0%   { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6); }
  70%  { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
}
</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">MJ Forge</span> live regression dashboard</h1>
    <div class="subtitle">
      ${escapeHtml(state.git.branch)}@${escapeHtml(state.git.commit)}${dirtyMark}
      &nbsp;·&nbsp; <span id="now"></span>
    </div>
  </header>

  <div class="live-banner">
    <span class="live-dot" id="live-dot"></span>
    <span id="live-status">Connecting…</span>
  </div>

  <div id="report-body">
    ${renderReportBody(serializeState())}
  </div>

  <footer class="footer">
    Live server at <span class="mono">http://${HOST}:${PORT}</span>
  </footer>
</main>
<script>
${SCRIPT}

const reportBody = document.getElementById('report-body');
const liveDot = document.getElementById('live-dot');
const liveStatus = document.getElementById('live-status');
const nowEl = document.getElementById('now');

function setStatus(text, connected) {
  liveStatus.textContent = text;
  liveDot.classList.toggle('disconnected', !connected);
}

function tickClock() {
  nowEl.textContent = new Date().toISOString().replace('T', ' ').replace(/\\..+$/, ' UTC');
}
tickClock();
setInterval(tickClock, 1000);

let pendingRefresh = false;
async function refreshBody() {
  if (pendingRefresh) return;
  pendingRefresh = true;
  try {
    const html = await (await fetch('/api/body')).text();
    reportBody.innerHTML = html;
  } finally {
    pendingRefresh = false;
  }
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => setStatus('Live · watching for test runs', true);
  es.addEventListener('state', () => {
    refreshBody().then(() => {
      setStatus('Live · last update ' + new Date().toLocaleTimeString(), true);
    });
  });
  es.onerror = () => {
    setStatus('Disconnected — retrying…', false);
    es.close();
    setTimeout(connect, 2000);
  };
}
connect();
</script>
</body>
</html>`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---- harness + git helpers ----

async function ensureHarnessUp() {
  console.log('▶ Bringing test harness up (idempotent)…');
  await runOnce('node', ['tests/scripts/ensure-ssh-key.mjs']);
  await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait']);
}

async function getGit() {
  const branch = (await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const commit = (await capture('git', ['rev-parse', '--short', 'HEAD'])).trim();
  const dirty = (await capture('git', ['status', '--porcelain'])).trim().length > 0;
  return { branch, commit, dirty };
}

function runOnce(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function capture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}
