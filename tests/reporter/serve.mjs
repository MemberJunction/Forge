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
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import Docker from 'dockerode';

import { renderReportBody, renderInfrastructure, STYLES, SCRIPT, FONT_LINKS } from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache');
const REPORTER_PATH = join(REPO_ROOT, 'tests', 'reporter', 'vitest-live-reporter.mjs');

const PORT = Number(process.env.FORGE_DASHBOARD_PORT ?? 5188);
// Bind to all interfaces by default so the dashboard is reachable over LAN
// / Tailscale. Override with FORGE_DASHBOARD_HOST=127.0.0.1 to restrict.
const HOST = process.env.FORGE_DASHBOARD_HOST ?? '0.0.0.0';
// Reporters running locally always POST through 127.0.0.1 — no point
// going via the external interface.
const REPORTER_URL = `http://127.0.0.1:${PORT}/_event`;

// ---- state ----

const state = {
  startedAt: Date.now(),
  git: { branch: 'unknown', commit: 'unknown', dirty: false },
  tiers: {
    unit: makeTier('Unit', 'Initializing — first run in progress…'),
    integration: makeTier('Integration', 'Initializing — first run in progress…'),
    // E2E is passive — populated when the user runs `npm run test:e2e:live`
    // in another terminal. The dashboard doesn't spawn a watcher for it
    // because Playwright + Electron is too heavy to rerun on every save.
    e2e: makeTier('E2E (Playwright + Electron)', 'Run `npm run test:e2e:live` to populate this tier.'),
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

// ---- infrastructure (Docker) ----

const docker = new Docker();
const INFRA_HISTORY = 30; // 30 samples × 2s = 60s sparkline window
const INFRA_POLL_MS = 2000;

const infra = {
  containers: new Map(), // Map<id, ContainerStat>
  lastPolledAt: 0,
  lastError: null,
};
let infraTimer = null;

// ---- main ----

await main();

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  state.git = await getGit();

  await ensureHarnessUp();

  startInfrastructurePolling();

  const unitProc = spawnVitest('unit', []);
  const intProc = spawnVitest('integration', ['--config', 'vitest.integration.config.ts']);

  watchChildExit('unit', unitProc);
  watchChildExit('integration', intProc);

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    const localUrl = `http://localhost:${PORT}`;
    const lanUrls = listLanUrls(PORT);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  MJ Forge live dashboard:  ${localUrl}`);
    for (const u of lanUrls) console.log(`                            ${u}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Vitest is watching both tiers. Edit code, see live updates.');
    console.log('  Ctrl+C to stop watchers (Docker stays up).');
    console.log('');
  });

  const stop = () => {
    console.log('\n▶ Stopping vitest watchers (Docker harness stays up)…');
    if (infraTimer) clearInterval(infraTimer);
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
    res.end(JSON.stringify({ ...serializeState(), infrastructure: serializeInfrastructure() }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/body') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderReportBody(serializeState()));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/infra') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(serializeInfrastructure()));
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
    pushTo(res, 'infra', serializeInfrastructure());
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

function broadcastInfra() {
  const snapshot = serializeInfrastructure();
  for (const res of sseClients) {
    try {
      pushTo(res, 'infra', snapshot);
    } catch (err) {
      console.error('SSE infra broadcast failed for one client:', err);
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

// ---- Docker polling ----

const ROLE_ORDER = ['bastion', 'postgres-private', 'postgres', 'mssql', 'mysql'];

function classifyContainer(name) {
  // Map container name → engine kind + display role.
  const stripped = name.replace(/^\//, '').replace(/^forge-test-/, '');
  if (stripped === 'bastion')           return { engine: 'bastion',          role: 'SSH bastion' };
  if (stripped === 'postgres-private')  return { engine: 'postgres-private', role: 'tunneled pg' };
  if (stripped === 'postgres')          return { engine: 'postgres',         role: 'PostgreSQL 16' };
  if (stripped === 'mssql')             return { engine: 'mssql',            role: 'SQL Server 2022' };
  if (stripped === 'mysql')             return { engine: 'mysql',            role: 'MySQL 8' };
  return { engine: 'other', role: stripped };
}

function computeCpuPct(stats) {
  const cpu = stats?.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const pre = stats?.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const sys = stats?.cpu_stats?.system_cpu_usage ?? 0;
  const preSys = stats?.precpu_stats?.system_cpu_usage ?? 0;
  const cores = stats?.cpu_stats?.online_cpus ?? 1;
  const cpuDelta = cpu - pre;
  const sysDelta = sys - preSys;
  if (cpuDelta > 0 && sysDelta > 0) {
    return (cpuDelta / sysDelta) * cores * 100;
  }
  return 0;
}

async function pollDockerOnce() {
  let list;
  try {
    list = await docker.listContainers({ all: true });
  } catch (err) {
    infra.lastError = `docker daemon unreachable: ${err?.message ?? err}`;
    broadcastInfra();
    return;
  }
  infra.lastError = null;

  const ours = list.filter((info) => (info.Names ?? []).some((n) => n.includes('/forge-test-')));
  const seen = new Set();

  for (const info of ours) {
    const id = info.Id;
    seen.add(id);
    const name = (info.Names?.[0] ?? '').replace(/^\//, '');
    const { engine, role } = classifyContainer(name);
    const state = info.State; // 'running' | 'exited' | …
    const status = info.Status; // human-readable

    let cpuPct = 0;
    let memBytes = 0;
    let memLimit = 0;

    if (state === 'running') {
      try {
        const stats = await docker.getContainer(id).stats({ stream: false });
        cpuPct = computeCpuPct(stats);
        memBytes = stats?.memory_stats?.usage ?? 0;
        memLimit = stats?.memory_stats?.limit ?? 0;
      } catch {
        // Container could have stopped between list + stats. Leave zeros.
      }
    }

    const prior = infra.containers.get(id);
    const history = prior?.history ?? [];
    history.push(Number.isFinite(cpuPct) ? cpuPct : 0);
    while (history.length > INFRA_HISTORY) history.shift();

    infra.containers.set(id, {
      id,
      name,
      engine,
      role,
      state,
      status,
      cpuPct,
      memBytes,
      memLimit,
      memPct: memLimit > 0 ? (memBytes / memLimit) * 100 : 0,
      history,
    });
  }

  // Drop containers that vanished (compose down, manual rm, etc.)
  for (const id of Array.from(infra.containers.keys())) {
    if (!seen.has(id)) infra.containers.delete(id);
  }

  infra.lastPolledAt = Date.now();
  broadcastInfra();
}

function startInfrastructurePolling() {
  pollDockerOnce().catch((err) => console.error('[infra] poll error:', err));
  infraTimer = setInterval(() => {
    pollDockerOnce().catch((err) => console.error('[infra] poll error:', err));
  }, INFRA_POLL_MS);
}

function serializeInfrastructure() {
  const containers = Array.from(infra.containers.values()).sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.engine);
    const bi = ROLE_ORDER.indexOf(b.engine);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });
  return {
    lastPolledAt: infra.lastPolledAt,
    error: infra.lastError,
    containers,
  };
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
  for (const key of ['unit', 'integration', 'e2e']) {
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
  // Phase 5 placeholder.
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

  // Note: infrastructure is intentionally NOT included in the state payload.
  // It travels on a separate SSE channel (event: infra) so its 2s polls don't
  // trigger a full body refresh that would collapse <details> and reset
  // animations. Direct callers that want both can use /api/state.
  return { startedAt: state.startedAt, durationMs, git: state.git, totals, tiers };
}

// ---- dashboard HTML ----

function renderDashboardHtml() {
  const dirtyMark = state.git.dirty ? '<span class="value dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MJ Forge · Live Telemetry</title>
${FONT_LINKS}
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">MJ Forge</span> Telemetry</h1>
    <div class="header-meta">
      <span class="label">Repo</span>
      <span class="value">${escapeHtml(state.git.branch)}@${escapeHtml(state.git.commit)} ${dirtyMark}</span>
      <span class="label">Bind</span>
      <span class="value">${escapeHtml(HOST)}:${PORT}</span>
      <span class="label">UTC</span>
      <span class="value" id="now">--:--:--</span>
    </div>
  </header>

  <div class="live-banner">
    <span class="live-dot" id="live-dot"></span>
    <span id="live-status">Connecting…</span>
  </div>

  <div id="infra-host">
    ${renderInfrastructure(serializeInfrastructure())}
  </div>

  <div id="report-body">
    ${renderReportBody(serializeState())}
  </div>

  <footer class="footer">
    Live server · port <span class="mono">${PORT}</span>
  </footer>
</main>
<script>
${SCRIPT}

const reportBody = document.getElementById('report-body');
const infraHost = document.getElementById('infra-host');
const liveDot = document.getElementById('live-dot');
const liveStatus = document.getElementById('live-status');
const nowEl = document.getElementById('now');

function setStatus(text, connected) {
  liveStatus.textContent = text;
  liveDot.classList.toggle('disconnected', !connected);
}

function tickClock() {
  const d = new Date();
  nowEl.textContent = d.toISOString().replace('T', ' ').replace(/\\..+$/, '');
}
tickClock();
setInterval(tickClock, 1000);

// ---- Body refresh with open-state preservation ----
//
// innerHTML swap nukes the open/closed state of every <details>. Capture
// which ones are open before the swap (by stable data-id) and re-open them
// after, so the user's expansion choices survive every test event.

function captureOpenIds() {
  const ids = new Set();
  reportBody.querySelectorAll('details[open][data-id]').forEach((d) => ids.add(d.dataset.id));
  return ids;
}
function restoreOpenIds(ids) {
  if (!ids || ids.size === 0) return;
  reportBody.querySelectorAll('details[data-id]').forEach((d) => {
    if (ids.has(d.dataset.id)) d.open = true;
  });
}

let pendingRefresh = false;
async function refreshBody() {
  if (pendingRefresh) return;
  pendingRefresh = true;
  try {
    const wasOpen = captureOpenIds();
    const html = await (await fetch('/api/body')).text();
    reportBody.innerHTML = html;
    restoreOpenIds(wasOpen);
  } finally {
    pendingRefresh = false;
  }
}

// ---- Surgical infra updates ----
//
// Updating cards in place (rather than replacing the grid's innerHTML) keeps
// the heartbeat dot animation continuous and avoids the every-2s flash that
// remounting caused. The card skeleton matches what renderInfraCard emits
// server-side; new containers get a skeleton appended, departed ones removed.

const INFRA_CARD_SKELETON =
  '<div class="infra-top">' +
    '<span class="infra-state-dot"></span>' +
    '<span class="infra-name"></span>' +
  '</div>' +
  '<div class="infra-role"></div>' +
  '<div class="infra-cpu">' +
    '<div class="infra-cpu-num">0.0<span class="unit">%</span></div>' +
    '<svg class="infra-spark" viewBox="0 0 100 28" preserveAspectRatio="none"></svg>' +
  '</div>' +
  '<div class="infra-mem">' +
    '<div class="mem-row">' +
      '<span class="mem-vals"></span>' +
      '<span class="mem-pct"></span>' +
    '</div>' +
    '<div class="infra-mem-bar"><span></span></div>' +
  '</div>';

function cssEscape(s) {
  return (window.CSS && window.CSS.escape) ? window.CSS.escape(String(s)) : String(s).replace(/["\\\\]/g, '\\\\$&');
}

function sparkPaths(history) {
  if (!history || history.length < 2) return '';
  const w = 100, h = 28;
  const max = Math.max(20, ...history);
  const step = w / (history.length - 1);
  const pts = history.map((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const linePath = 'M ' + pts.join(' L ');
  const areaPath = 'M 0,' + h + ' L ' + pts.join(' L ') + ' L ' + w + ',' + h + ' Z';
  return '<path class="area" d="' + areaPath + '"/><path d="' + linePath + '"/>';
}

function setText(node, sel, value) {
  const el = node.querySelector(sel);
  if (el && el.textContent !== String(value)) el.textContent = String(value);
}

function fmtRel(ts) {
  if (!ts) return '—';
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1500) return 'now';
  if (delta < 60000) return Math.round(delta / 1000) + 's ago';
  return Math.round(delta / 60000) + 'm ago';
}

function ensureInfraScaffold() {
  let grid = infraHost.querySelector('.infra-grid');
  if (grid) return grid;
  // Server may have rendered an empty / error placeholder; replace with grid.
  infraHost.innerHTML =
    '<section class="infra">' +
      '<div class="section-label"><span>Infrastructure</span><span class="meta-readout"></span></div>' +
      '<div class="infra-grid"></div>' +
    '</section>';
  return infraHost.querySelector('.infra-grid');
}

function applyInfra(payload) {
  if (!payload) return;
  if (payload.error) {
    infraHost.innerHTML =
      '<section class="infra">' +
        '<div class="section-label"><span>Infrastructure</span></div>' +
        '<div class="infra-error">' + payload.error.replace(/[<>&]/g, (m) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[m])) + '</div>' +
      '</section>';
    return;
  }
  const grid = ensureInfraScaffold();
  const seen = new Set();
  for (const c of payload.containers || []) {
    seen.add(c.name);
    let card = grid.querySelector('[data-id="' + cssEscape(c.name) + '"]');
    if (!card) {
      card = document.createElement('article');
      card.className = 'infra-card';
      card.dataset.id = c.name;
      card.innerHTML = INFRA_CARD_SKELETON;
      grid.appendChild(card);
    }
    if (card.dataset.engine !== c.engine) card.dataset.engine = c.engine;
    if (card.dataset.state !== c.state) card.dataset.state = c.state;

    setText(card, '.infra-name', c.name);
    setText(card, '.infra-role', c.role);
    const cpuEl = card.querySelector('.infra-cpu-num');
    if (cpuEl && cpuEl.firstChild) cpuEl.firstChild.nodeValue = (c.cpuPct ?? 0).toFixed(1);

    const spark = card.querySelector('.infra-spark');
    if (spark) spark.innerHTML = sparkPaths(c.history);

    const memMB = Math.round((c.memBytes || 0) / 1048576);
    const limitMB = Math.round((c.memLimit || 0) / 1048576);
    const memPct = (c.memPct || 0).toFixed(1);
    const valEl = card.querySelector('.mem-vals');
    if (valEl) valEl.innerHTML = memMB + ' / ' + limitMB + ' <span class="mem-unit">MiB</span>';
    setText(card, '.mem-pct', memPct + '%');
    const bar = card.querySelector('.infra-mem-bar > span');
    if (bar) bar.style.setProperty('--pct', memPct + '%');
  }
  // Remove cards no longer present
  for (const card of Array.from(grid.children)) {
    if (!seen.has(card.dataset.id)) card.remove();
  }
  // Update polled-time readout
  const meta = infraHost.querySelector('.meta-readout');
  if (meta) meta.textContent = 'polled ' + fmtRel(payload.lastPolledAt);
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => setStatus('Live', true);
  es.addEventListener('state', () => { refreshBody(); });
  es.addEventListener('infra', (event) => {
    try { applyInfra(JSON.parse(event.data)); }
    catch (err) { console.error('bad infra payload', err); }
  });
  es.onerror = () => {
    setStatus('Disconnected — retrying', false);
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

function listLanUrls(port) {
  const urls = [];
  const seen = new Set();
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.internal) continue;
      if (addr.family !== 'IPv4') continue;
      if (seen.has(addr.address)) continue;
      seen.add(addr.address);
      urls.push(`http://${addr.address}:${port}    [${name}]`);
    }
  }
  return urls;
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
