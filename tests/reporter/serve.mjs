#!/usr/bin/env node
// Live dashboard server for the MJ Forge regression harness.
//
// Brings the Docker harness up, then runs `vitest --watch` for both the unit
// and integration tiers and hosts a live HTML dashboard at http://127.0.0.1:5188.
// Each vitest run writes a JSON report to tests/reports/.cache/<tier>.json;
// the server watches those files and pushes Server-Sent Events to the
// dashboard so the UI stays in sync with whatever the watchers are doing.
//
// Per-file state is merged across runs so a single-file rerun doesn't wipe
// the rest of the suite from the dashboard.
//
// Lifecycle:
//   - Ctrl+C  → stop the vitest watchers and exit. Docker is left running
//               (use `npm run test:harness:down` when you're done).

import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, watchFile, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReportBody, STYLES, SCRIPT } from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache');

const PORT = Number(process.env.FORGE_DASHBOARD_PORT ?? 5188);
const HOST = '127.0.0.1';

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
  // suites is a Map<file, { name, durationMs, totals, tests }> — merged across
  // partial reruns so a one-file rerun in watch mode doesn't drop the others.
  return { label, status: 'initializing', durationMs: 0, suites: new Map(), note, lastUpdatedAt: 0 };
}

const sseClients = new Set();

// ---- main ----

await main();

async function main() {
  await mkdir(CACHE_DIR);
  state.git = await getGit();

  // Reset cache files so old runs don't show stale results on a fresh server.
  for (const tier of ['unit', 'integration']) {
    const path = cacheJsonFor(tier);
    if (!existsSync(path)) writeFileSync(path, '{}');
  }

  await ensureHarnessUp();

  // Watch JSON files
  watchTierJson('unit');
  watchTierJson('integration');

  // Spawn watchers (vitest in watch mode is the default — no `run` subcommand)
  const unitProc = spawnVitest('unit', []);
  const intProc = spawnVitest('integration', ['--config', 'vitest.integration.config.ts']);

  // HTTP server
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  MJ Forge live dashboard:  ${url}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Vitest is watching both tiers. Edit code, see updates.');
    console.log('  Ctrl+C to stop watchers (Docker stays up).');
    console.log('');
  });

  // Cleanup
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
  res.writeHead(404);
  res.end('Not found');
}

function pushTo(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event = 'state') {
  const snapshot = serializeState();
  for (const res of sseClients) {
    try {
      pushTo(res, event, snapshot);
    } catch (err) {
      console.error('SSE broadcast failed for one client:', err);
      sseClients.delete(res);
    }
  }
}

// ---- vitest watch + JSON tail ----

function cacheJsonFor(tier) {
  return join(CACHE_DIR, `${tier}.json`);
}

function spawnVitest(tier, extraArgs) {
  const args = [
    'vitest',
    ...extraArgs,
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${cacheJsonFor(tier)}`,
  ];
  console.log(`▶ spawning vitest watch for ${tier}: npx ${args.join(' ')}`);
  const child = spawn('npx', args, { stdio: 'inherit', cwd: REPO_ROOT });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`▶ vitest ${tier} exited unexpectedly with code ${code}`);
    }
  });
  return child;
}

function watchTierJson(tier) {
  const path = cacheJsonFor(tier);
  // watchFile (poll-based) is more reliable than fs.watch on macOS for files
  // that are atomically replaced by the writer. 250ms feels live enough.
  watchFile(path, { interval: 250 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    handleVitestUpdate(tier, path);
  });
}

function handleVitestUpdate(tier, path) {
  let json;
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim() || raw.trim() === '{}') return; // initial empty
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`[live] failed to parse ${path}:`, err.message);
    return;
  }
  if (!Array.isArray(json.testResults)) return;

  const t = state.tiers[tier];
  // Merge: each file present in the new JSON replaces the prior entry.
  // Files not present retain their last-known state (vitest watch reruns
  // only affected files).
  for (const file of json.testResults) {
    const tests = (file.assertionResults ?? []).map((a) => ({
      fullName: a.fullName,
      status: a.status === 'pending' ? 'skipped' : a.status,
      durationMs: a.duration,
      failureMessages: a.failureMessages ?? [],
    }));
    const totals = totalsOf(tests);
    t.suites.set(file.name, {
      name: relative(REPO_ROOT, file.name),
      durationMs: file.endTime - file.startTime,
      totals,
      tests,
    });
  }
  t.lastUpdatedAt = Date.now();
  // Recompute tier-level state.
  t.durationMs = 0;
  let totalsAcc = { passed: 0, failed: 0, skipped: 0, total: 0 };
  for (const s of t.suites.values()) {
    t.durationMs += s.durationMs || 0;
    totalsAcc.passed += s.totals.passed;
    totalsAcc.failed += s.totals.failed;
    totalsAcc.skipped += s.totals.skipped;
    totalsAcc.total += s.totals.total;
  }
  t.totals = totalsAcc;
  t.status = totalsAcc.failed > 0 ? 'failed' : 'ok';
  t.note = undefined;

  console.log(`[live] ${tier} updated — ${totalsAcc.passed}/${totalsAcc.total} passed`);
  broadcast();
}

function totalsOf(tests) {
  const t = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  for (const x of tests) {
    if (x.status === 'passed') t.passed += 1;
    else if (x.status === 'failed') t.failed += 1;
    else t.skipped += 1;
  }
  return t;
}

// ---- serialization for the renderer + SSE ----

function serializeState() {
  const tiers = [];
  for (const key of ['unit', 'integration']) {
    const t = state.tiers[key];
    if (t.status === 'initializing') {
      tiers.push({
        label: t.label,
        status: 'pending',
        note: t.note ?? 'Initializing…',
      });
    } else {
      tiers.push({
        label: t.label,
        status: t.status,
        durationMs: t.durationMs,
        totals: t.totals,
        suites: Array.from(t.suites.values()),
      });
    }
  }
  // Phase 4 / 5 placeholders — same as static report.
  tiers.push({ label: 'E2E (Playwright + Electron)', status: 'pending', note: 'Phase 4 — not yet implemented.' });
  tiers.push({ label: 'Visual regression', status: 'pending', note: 'Phase 5 — not yet implemented.' });

  // Aggregate totals
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
.flash-update {
  animation: flashUpdate 0.6s ease;
}
@keyframes flashUpdate {
  0%   { box-shadow: 0 0 0 2px var(--accent); }
  100% { box-shadow: 0 0 0 0 transparent; }
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

// Live updates: subscribe to /events; on each state push, swap the report body.
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

let lastApply = 0;
async function refreshBody() {
  try {
    const html = await (await fetch('/api/body')).text();
    reportBody.innerHTML = html;
    reportBody.classList.remove('flash-update');
    void reportBody.offsetWidth; // reflow so the animation re-fires
    reportBody.classList.add('flash-update');
    lastApply = Date.now();
  } catch (err) {
    console.error('refresh failed', err);
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

async function mkdir(path) {
  mkdirSync(path, { recursive: true });
}
