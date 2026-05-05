// HTML renderer for the regression-test report.
//
// Pure function module: takes a normalized report object, returns a self-
// contained HTML string with embedded CSS and JS. No I/O, no side effects.
//
// Aesthetic: "Vital Signs Telemetry" — a warm-dark mission-control cockpit
// in IBM Plex (Sans + Sans Condensed + Mono) with a phosphor-amber accent
// and engine-tinted indicators. Extends the Forge identity into its own
// dedicated dev-tool surface; deliberately distinct from the app's purple
// theme so the dashboard reads as instrument panel, not application chrome.

const STATUS_BADGE = {
  passed:  { label: 'PASS',    klass: 'badge-pass'    },
  failed:  { label: 'FAIL',    klass: 'badge-fail'    },
  skipped: { label: 'SKIP',    klass: 'badge-skip'    },
  pending: { label: 'PENDING', klass: 'badge-pending' },
  running: { label: 'RUN',     klass: 'badge-running' },
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTimestamp(epochMs) {
  return new Date(epochMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function fmtBytesMiB(bytes) {
  if (!bytes || bytes < 0) return '0';
  return (bytes / (1024 * 1024)).toFixed(0);
}

function fmtRelative(ts) {
  if (!ts) return '—';
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 1500) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

// Synopsis: short business-language paragraph derived from the run summary.
function buildSynopsis(report) {
  const totals = report.totals;
  if (totals.failed === 0 && totals.total > 0) {
    const tiers = report.tiers
      .filter((t) => t.status !== 'pending')
      .map((t) => t.label)
      .join(' and ');
    return `All ${totals.total} regression checks passed across the ${tiers} tier${
      report.tiers.filter((t) => t.status !== 'pending').length === 1 ? '' : 's'
    }. No regressions detected since the last run.`;
  }
  if (totals.failed > 0) {
    const failingTiers = report.tiers
      .filter((t) => t.totals?.failed > 0)
      .map((t) => `${t.label} (${t.totals.failed})`)
      .join(', ');
    return (
      `${totals.failed} of ${totals.total} regression checks failed. ` +
      `Failures concentrated in: ${failingTiers}. See engineering details below.`
    );
  }
  return 'No tests were executed in this run.';
}

// ---- Per-section "Copy for LLM" payloads ----

function copyPayloadForTier(report, tier) {
  const lines = [
    `# Forge regression / ${tier.label} tier`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `run: ${fmtTimestamp(report.startedAt)}`,
    `result: ${tier.totals.passed}/${tier.totals.total} passed (${fmtDuration(tier.durationMs)})`,
  ];
  const failures = tier.suites.flatMap((s) =>
    s.tests.filter((t) => t.status === 'failed').map((t) => ({ suite: s.name, test: t })),
  );
  if (failures.length) {
    lines.push('');
    lines.push('FAILED:');
    for (const { suite, test } of failures) {
      lines.push(`- ${suite} > ${test.fullName}`);
      const firstError = test.failureMessages?.[0]?.split('\n').slice(0, 6).join('\n');
      if (firstError) lines.push(`  ${firstError.replaceAll('\n', '\n  ')}`);
    }
  }
  return lines.join('\n');
}

function copyPayloadForSuite(report, tier, suite) {
  const lines = [
    `# Forge regression / ${tier.label} / ${suite.name}`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `result: ${suite.totals.passed}/${suite.totals.total} passed (${fmtDuration(suite.durationMs)})`,
  ];
  const failures = suite.tests.filter((t) => t.status === 'failed');
  if (failures.length) {
    lines.push('');
    lines.push('FAILED:');
    for (const t of failures) {
      lines.push(`- ${t.fullName}`);
      for (const msg of t.failureMessages ?? []) {
        const trimmed = msg.split('\n').slice(0, 8).join('\n');
        lines.push(`  ${trimmed.replaceAll('\n', '\n  ')}`);
      }
    }
  } else {
    lines.push('all passing');
  }
  return lines.join('\n');
}

function copyPayloadForFailure(report, tier, suite, test) {
  return [
    `# Forge regression failure`,
    `tier: ${tier.label}`,
    `suite: ${suite.name}`,
    `test: ${test.fullName}`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `duration: ${fmtDuration(test.durationMs)}`,
    '',
    'error:',
    ...((test.failureMessages ?? []).map((m) => m)),
  ].join('\n');
}

// ---- HTML chunks ----

function renderHero(report) {
  const t = report.totals;
  return `
    <section class="hero">
      <div class="counter ${t.passed > 0 ? 'is-pass' : ''}">
        <div class="counter-num">${t.passed}</div>
        <div class="counter-label">passed</div>
      </div>
      <div class="counter ${t.failed > 0 ? 'is-fail' : ''}">
        <div class="counter-num">${t.failed}</div>
        <div class="counter-label">failed</div>
      </div>
      <div class="counter ${t.skipped > 0 ? 'is-skip' : ''}">
        <div class="counter-num">${t.skipped}</div>
        <div class="counter-label">skipped</div>
      </div>
      <div class="counter">
        <div class="counter-num">${fmtDuration(report.durationMs)}</div>
        <div class="counter-label">duration</div>
      </div>
    </section>
  `;
}

// ---- Infrastructure (Docker container) panel ----

export function renderInfrastructure(infra) {
  if (!infra) return '';
  if (infra.error) {
    return `
      <section class="infra">
        <div class="section-label"><span>Infrastructure</span></div>
        <div class="infra-error">${escapeHtml(infra.error)}</div>
      </section>
    `;
  }
  if (!infra.containers || infra.containers.length === 0) {
    return `
      <section class="infra">
        <div class="section-label"><span>Infrastructure</span></div>
        <div class="infra-empty">Awaiting Docker — run <span class="mono">npm run test:harness:up</span></div>
      </section>
    `;
  }
  const cards = infra.containers.map(renderInfraCard).join('');
  const polled = infra.lastPolledAt
    ? `<span class="meta-readout">polled ${escapeHtml(fmtRelative(infra.lastPolledAt))}</span>`
    : '';
  return `
    <section class="infra">
      <div class="section-label"><span>Infrastructure</span>${polled}</div>
      <div class="infra-grid">${cards}</div>
    </section>
  `;
}

function renderInfraCard(c) {
  const cpu = Number.isFinite(c.cpuPct) ? c.cpuPct : 0;
  const memMB = fmtBytesMiB(c.memBytes);
  const memLimitMB = fmtBytesMiB(c.memLimit);
  const memPct = Number.isFinite(c.memPct) ? c.memPct : 0;
  const stateLabel = (c.state || 'unknown').toUpperCase();
  return `
    <article class="infra-card" data-id="${escapeHtml(c.name)}" data-engine="${escapeHtml(c.engine)}" data-state="${escapeHtml(c.state)}">
      <div class="infra-top">
        <span class="infra-state-dot" title="${escapeHtml(stateLabel)}"></span>
        <span class="infra-name">${escapeHtml(c.name)}</span>
      </div>
      <div class="infra-role">${escapeHtml(c.role)}</div>
      <div class="infra-cpu">
        <div class="infra-cpu-num">${cpu.toFixed(1)}<span class="unit">%</span></div>
        ${renderSparkline(c.history)}
      </div>
      <div class="infra-mem">
        <div class="mem-row">
          <span class="mem-vals">${memMB} / ${memLimitMB} <span class="mem-unit">MiB</span></span>
          <span class="mem-pct">${memPct.toFixed(1)}%</span>
        </div>
        <div class="infra-mem-bar"><span style="--pct: ${memPct.toFixed(1)}%"></span></div>
      </div>
    </article>
  `;
}

function renderSparkline(history) {
  if (!history || history.length < 2) {
    return `<svg class="infra-spark" viewBox="0 0 100 28" preserveAspectRatio="none"></svg>`;
  }
  const w = 100;
  const h = 28;
  const max = Math.max(20, ...history); // baseline 20% so an idle line isn't pinned to the top
  const step = w / (history.length - 1);
  const pts = history.map((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`;
  return `
    <svg class="infra-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path class="area" d="${areaPath}"/>
      <path d="${linePath}"/>
    </svg>
  `;
}

// ---- Test sections ----

function renderTest(test) {
  const s = STATUS_BADGE[test.status] ?? STATUS_BADGE.skipped;
  const failureBlock =
    test.status === 'failed' && test.failureMessages?.length
      ? `<pre class="failure">${escapeHtml(test.failureMessages.join('\n\n'))}</pre>`
      : '';
  return `
    <li class="test test-${test.status}">
      <span class="badge ${s.klass}">${s.label}</span>
      <span class="test-name">${escapeHtml(test.fullName)}</span>
      <span class="test-duration mono">${fmtDuration(test.durationMs)}</span>
      ${failureBlock}
    </li>
  `;
}

function renderSuite(report, tier, suite) {
  const failed = suite.totals.failed;
  const passed = suite.totals.passed;
  const skipped = suite.totals.skipped;
  const running = suite.runState === 'running';
  const isOpen = failed > 0 || running;
  const summary =
    failed > 0
      ? `<span class="suite-summary text-error">${failed} failed</span>`
      : `<span class="suite-summary text-muted">${passed} passed</span>`;
  const skipNote = skipped > 0 ? `<span class="suite-summary text-muted"> · ${skipped} skipped</span>` : '';
  const runBadge = running ? `<span class="badge badge-running">RUN</span>` : '';
  const payload = escapeHtml(copyPayloadForSuite(report, tier, suite));
  // Stable data-id so the dashboard's open-state preserver can re-open this
  // suite after a body refresh.
  const id = `suite:${tier.label}:${suite.name}`;
  return `
    <details class="suite ${running ? 'is-running' : ''}" data-id="${escapeHtml(id)}" ${isOpen ? 'open' : ''}>
      <summary>
        ${runBadge}
        <span class="suite-name mono">${escapeHtml(suite.name)}</span>
        ${summary}${skipNote}
        <span class="suite-duration mono text-muted">${fmtDuration(suite.durationMs)}</span>
        <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy a token-efficient summary of this suite for pasting into an LLM">Copy for LLM</button>
      </summary>
      <ul class="test-list">
        ${suite.tests.map(renderTest).join('')}
      </ul>
    </details>
  `;
}

function renderTier(report, tier) {
  if (tier.status === 'pending') {
    return `
      <section class="tier tier-pending">
        <div class="tier-header">
          <h2>${escapeHtml(tier.label)}</h2>
          <span class="badge badge-pending">PENDING</span>
        </div>
        <p class="tier-note">${escapeHtml(tier.note ?? '')}</p>
      </section>
    `;
  }
  const t = tier.totals;
  const running = tier.runState === 'running';
  const isOpen = t.failed > 0 || running;
  const payload = escapeHtml(copyPayloadForTier(report, tier));
  const runBadge = running
    ? `<span class="badge badge-running" title="Tests are running right now">RUN ${escapeHtml(String(tier.testsCompleted ?? 0))}</span>`
    : '';
  const currentTest =
    running && tier.currentTest
      ? `<div class="tier-current mono">↳ ${escapeHtml(tier.currentTest)}</div>`
      : '';
  const id = `tier:${tier.label}`;
  return `
    <details class="tier ${running ? 'is-running' : ''}" data-id="${escapeHtml(id)}" ${isOpen ? 'open' : ''}>
      <summary>
        ${runBadge}
        <h2>${escapeHtml(tier.label)}</h2>
        <span class="tier-counts">
          <span class="text-success">${t.passed} passed</span>
          ${t.failed > 0 ? `<span class="text-error"> · ${t.failed} failed</span>` : ''}
          ${t.skipped > 0 ? `<span class="text-muted"> · ${t.skipped} skipped</span>` : ''}
        </span>
        <span class="tier-duration mono">${fmtDuration(tier.durationMs)}</span>
        <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy a token-efficient summary of this tier for pasting into an LLM">Copy for LLM</button>
      </summary>
      ${currentTest}
      <div class="suite-list">
        ${tier.suites.map((s) => renderSuite(report, tier, s)).join('')}
      </div>
    </details>
  `;
}

function renderFailureFocusList(report) {
  const failures = [];
  for (const tier of report.tiers) {
    if (!tier.suites) continue;
    for (const suite of tier.suites) {
      for (const test of suite.tests) {
        if (test.status === 'failed') failures.push({ tier, suite, test });
      }
    }
  }
  if (failures.length === 0) return '';
  const items = failures
    .map(({ tier, suite, test }) => {
      const payload = escapeHtml(copyPayloadForFailure(report, tier, suite, test));
      return `
        <li class="focus-item">
          <div class="focus-head">
            <span class="badge badge-fail">FAIL</span>
            <span class="mono focus-suite">${escapeHtml(suite.name)}</span>
            <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy this single failure for pasting into an LLM">Copy for LLM</button>
          </div>
          <div class="focus-test">${escapeHtml(test.fullName)}</div>
          <pre class="failure">${escapeHtml((test.failureMessages ?? []).join('\n\n'))}</pre>
        </li>
      `;
    })
    .join('');
  return `
    <section class="focus">
      <h2>Failures · ${failures.length}</h2>
      <ul class="focus-list">${items}</ul>
    </section>
  `;
}

// ---- Top-level template ----

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
`;

const STYLES = /* css */ `
:root {
  --bg-base: #0d0d12;
  --bg-surface: #14141d;
  --bg-elevated: #1c1c28;
  --bg-deep: #07070b;

  --line: #2a2a3a;
  --line-soft: #1d1d28;

  --ink-primary: #e8e6df;
  --ink-secondary: #8a8aa0;
  --ink-muted: #54546a;
  --ink-faint: #36364a;

  --accent: #ffb84d;
  --accent-soft: rgba(255, 184, 77, 0.10);
  --accent-line: rgba(255, 184, 77, 0.35);

  --pass: #7ed957;
  --fail: #ff5e5e;
  --warn: #f0b94a;
  --info: #5fb4d6;

  --engine-mssql: #5fb4d6;
  --engine-postgres: #52a3a8;
  --engine-postgres-private: #3d7a7e;
  --engine-mysql: #e2925b;
  --engine-bastion: #7ed957;
  --engine-other: #8a8aa0;

  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --font-condensed: 'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, 'Menlo', monospace;

  --space-1: 2px;
  --space-2: 4px;
  --space-3: 8px;
  --space-4: 12px;
  --space-5: 16px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  background: var(--bg-base);
  color: var(--ink-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'tnum' on, 'ss01' on;
}

body {
  min-height: 100vh;
  position: relative;
  background:
    radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(255, 184, 77, 0.045), transparent 60%),
    radial-gradient(ellipse 800px 600px at 50% 110%, rgba(95, 180, 214, 0.025), transparent 60%),
    var(--bg-base);
  padding: var(--space-7) var(--space-6);
}

/* CRT scanlines — subtle */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 2px,
    rgba(0, 0, 0, 0.16) 2px,
    rgba(0, 0, 0, 0.16) 3px
  );
  opacity: 0.32;
  mix-blend-mode: multiply;
  z-index: 1;
}

/* Noise grain */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1, 0 0 0 0 1, 0 0 0 0 1, 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.5;
  z-index: 2;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
  z-index: 3;
  animation: fadeUp 0.5s ease-out both;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.mono { font-family: var(--font-mono); }
.text-muted { color: var(--ink-muted); }
.text-secondary { color: var(--ink-secondary); }
.text-success { color: var(--pass); }
.text-warning { color: var(--warn); }
.text-error { color: var(--fail); }

pre {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-deep);
  color: var(--ink-primary);
  padding: var(--space-3) var(--space-4);
  border-radius: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

/* HEADER ─────────────────────────────────────────────── */
.header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--space-6);
}

.header h1 {
  font-family: var(--font-condensed);
  font-weight: 700;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.015em;
  text-transform: uppercase;
  color: var(--ink-primary);
}

.header h1 .accent {
  color: var(--accent);
  position: relative;
}

.header h1 .accent::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--accent);
  margin-left: 6px;
  vertical-align: 6px;
  animation: blink 1.4s steps(2) infinite;
}
@keyframes blink {
  50% { opacity: 0.25; }
}

.header-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  display: grid;
  grid-template-columns: auto auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  color: var(--ink-secondary);
  text-align: right;
}

.header-meta .label {
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 9px;
  text-align: right;
}

.header-meta .value {
  color: var(--ink-primary);
  text-align: right;
  word-break: break-all;
}

.header-meta .value.dirty { color: var(--warn); }

/* LIVE BANNER ────────────────────────────────────────── */
.live-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--ink-secondary);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: heartbeat 1.5s ease-in-out infinite;
}
.live-dot.disconnected {
  background: var(--fail);
  animation: none;
}
@keyframes heartbeat {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-line); opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.4; }
}

/* HERO ─────────────────────────────────────────────── */
.hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--space-7);
}

.counter {
  position: relative;
  padding: var(--space-5) var(--space-4);
  text-align: center;
}

.counter + .counter::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--line);
}

.counter-num {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 46px;
  line-height: 0.95;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
}
.counter.is-pass .counter-num { color: var(--pass); }
.counter.is-fail .counter-num { color: var(--fail); }
.counter.is-skip .counter-num { color: var(--warn); }

.counter-label {
  margin-top: var(--space-3);
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

/* SYNOPSIS ───────────────────────────────────────────── */
.synopsis {
  font-family: var(--font-sans);
  font-style: italic;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-primary);
  padding: 0 var(--space-7) var(--space-6);
  margin-bottom: var(--space-6);
  border-bottom: 1px dashed var(--line);
  text-align: center;
}
.synopsis::before { content: '“'; color: var(--accent); margin-right: 4px; font-size: 22px; vertical-align: -3px; font-style: normal; }
.synopsis::after  { content: '”'; color: var(--accent); margin-left: 4px;  font-size: 22px; vertical-align: -3px; font-style: normal; }

/* SECTION LABELS ─────────────────────────────────────── */
.section-label {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  color: var(--ink-muted);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.section-label > span:first-child { color: var(--ink-secondary); }
.section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.section-label .meta-readout {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ink-muted);
  text-transform: uppercase;
}

/* INFRASTRUCTURE ─────────────────────────────────────── */
.infra {
  margin-bottom: var(--space-7);
}

.infra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-3);
}

.infra-card {
  position: relative;
  padding: var(--space-4);
  background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-deep) 130%);
  border: 1px solid var(--line);
  border-top: 2px solid var(--engine, var(--ink-muted));
  display: grid;
  grid-template-rows: auto auto auto auto;
  gap: var(--space-3);
  font-family: var(--font-mono);
  overflow: hidden;
}

.infra-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.infra-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-muted);
  flex-shrink: 0;
}
.infra-card[data-state="running"] .infra-state-dot {
  background: var(--engine, var(--pass));
  animation: dotPulse 2s ease-in-out infinite;
}
@keyframes dotPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--engine, var(--pass)); }
  50%      { box-shadow: 0 0 0 4px transparent; }
}

.infra-name {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-primary);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.infra-role {
  font-size: 9px;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  margin-top: -4px;
}

.infra-cpu {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: end;
  gap: var(--space-3);
}

.infra-cpu-num {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 30px;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
  letter-spacing: -0.02em;
}

.infra-cpu-num .unit {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-muted);
  margin-left: 2px;
  font-weight: 400;
}

.infra-spark {
  width: 100%;
  height: 28px;
  display: block;
  align-self: end;
}
.infra-spark path {
  fill: none;
  stroke: var(--engine, var(--accent));
  stroke-width: 1.25;
  stroke-linejoin: round;
  stroke-linecap: round;
  opacity: 0.85;
}
.infra-spark .area {
  fill: var(--engine, var(--accent));
  opacity: 0.10;
  stroke: none;
}

.infra-mem {
  display: grid;
  gap: 4px;
  font-size: 10px;
  color: var(--ink-secondary);
}
.infra-mem .mem-row {
  display: flex;
  justify-content: space-between;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.infra-mem .mem-unit { color: var(--ink-muted); }
.infra-mem-bar {
  height: 3px;
  background: var(--line-soft);
  position: relative;
  overflow: hidden;
}
.infra-mem-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--engine, var(--info));
  width: var(--pct, 0%);
  transition: width 0.6s ease;
}

.infra-empty, .infra-error {
  padding: var(--space-5);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-secondary);
  border: 1px dashed var(--line);
  text-align: center;
  letter-spacing: 0.06em;
}
.infra-error { color: var(--fail); border-color: var(--fail); }

[data-engine="mssql"]            { --engine: var(--engine-mssql); }
[data-engine="postgres"]         { --engine: var(--engine-postgres); }
[data-engine="postgres-private"] { --engine: var(--engine-postgres-private); }
[data-engine="mysql"]            { --engine: var(--engine-mysql); }
[data-engine="bastion"]          { --engine: var(--engine-bastion); }

/* TIER SECTIONS ──────────────────────────────────────── */
.tier {
  background: var(--bg-surface);
  border: 1px solid var(--line);
  margin-bottom: var(--space-3);
}
.tier > summary {
  list-style: none;
  cursor: pointer;
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.tier > summary::-webkit-details-marker { display: none; }
.tier > summary::before {
  content: '+';
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 16px;
  width: 14px;
  text-align: center;
}
.tier[open] > summary::before { content: '−'; color: var(--accent); }
.tier:hover > summary { background: rgba(255, 184, 77, 0.025); }

.tier h2 {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
  color: var(--ink-primary);
}

.tier.is-running { border-left: 2px solid var(--accent); }
.tier-counts { font-family: var(--font-mono); font-size: 11px; }
.tier-counts .text-success { color: var(--pass); }
.tier-counts .text-error { color: var(--fail); }
.tier-counts .text-muted { color: var(--ink-muted); }
.tier-duration { font-family: var(--font-mono); font-size: 10px; color: var(--ink-muted); }

.tier-pending {
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--line);
  margin-bottom: var(--space-3);
  opacity: 0.65;
}
.tier-pending .tier-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.tier-pending h2 {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
  color: var(--ink-secondary);
}
.tier-note {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.tier-current {
  padding: 0 var(--space-5) var(--space-3);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-secondary);
  word-break: break-word;
}

.suite-list {
  padding: 0 var(--space-5) var(--space-4);
}

.suite {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  margin-top: var(--space-3);
}
.suite > summary {
  list-style: none;
  cursor: pointer;
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.suite > summary::-webkit-details-marker { display: none; }
.suite > summary::before {
  content: '›';
  color: var(--ink-muted);
  font-family: var(--font-mono);
  width: 10px;
  font-size: 14px;
  transition: transform 0.18s ease;
}
.suite[open] > summary::before { transform: rotate(90deg); color: var(--accent); }
.suite:hover > summary { background: rgba(255, 184, 77, 0.025); }
.suite.is-running { border-left: 2px solid var(--accent); }

.suite-name { font-family: var(--font-mono); font-size: 11px; flex: 1; word-break: break-all; color: var(--ink-primary); }
.suite-summary { font-family: var(--font-mono); font-size: 10px; }
.suite-summary.text-error { color: var(--fail); }
.suite-summary.text-muted { color: var(--ink-muted); }
.suite-duration { font-family: var(--font-mono); font-size: 10px; color: var(--ink-muted); }

.test-list { list-style: none; padding: var(--space-3) var(--space-5); }
.test {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: 12px;
  font-family: var(--font-mono);
}
.test-name { word-break: break-word; color: var(--ink-secondary); }
.test-failed .test-name { color: var(--fail); font-weight: 600; }
.test-skipped .test-name { color: var(--ink-muted); }
.test-duration { color: var(--ink-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.test .failure {
  grid-column: 1 / -1;
  margin-top: var(--space-2);
  border-left: 2px solid var(--fail);
  padding: var(--space-3);
  font-size: 11px;
  background: rgba(255, 94, 94, 0.04);
  color: var(--ink-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* FAILURE FOCUS ──────────────────────────────────────── */
.focus {
  background: linear-gradient(180deg, rgba(255, 94, 94, 0.07), rgba(255, 94, 94, 0.01));
  border: 1px solid var(--fail);
  padding: var(--space-5);
  margin-bottom: var(--space-6);
  position: relative;
}
.focus::before {
  content: 'CRIT';
  position: absolute;
  top: -8px;
  left: 16px;
  background: var(--bg-base);
  color: var(--fail);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  padding: 0 var(--space-2);
}
.focus h2 {
  font-family: var(--font-condensed);
  font-weight: 700;
  color: var(--fail);
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: var(--space-4);
}
.focus-list { list-style: none; }
.focus-item + .focus-item { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--line); }
.focus-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.focus-suite { font-size: 11px; color: var(--ink-secondary); }
.focus-test { font-weight: 600; font-family: var(--font-mono); font-size: 12px; margin: var(--space-2) 0; color: var(--ink-primary); word-break: break-word; }
.focus .failure {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-deep);
  border-left: 2px solid var(--fail);
  padding: var(--space-3);
  color: var(--ink-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* BADGES ─────────────────────────────────────────────── */
.badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  padding: 3px 7px;
  text-transform: uppercase;
  line-height: 1.4;
  display: inline-block;
}
.badge-pass    { background: rgba(126, 217, 87, 0.13);  color: var(--pass); }
.badge-fail    { background: rgba(255, 94, 94, 0.16);   color: var(--fail); }
.badge-skip    { background: rgba(240, 185, 74, 0.14);  color: var(--warn); }
.badge-pending { background: rgba(95, 180, 214, 0.12);  color: var(--info); }
.badge-running {
  background: rgba(255, 184, 77, 0.16);
  color: var(--accent);
  animation: phosphorPulse 1.6s ease-in-out infinite;
}
@keyframes phosphorPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

/* COPY BUTTON ────────────────────────────────────────── */
.copy-btn {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 4px 10px;
  background: transparent;
  color: var(--ink-secondary);
  border: 1px solid var(--line);
  cursor: pointer;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: all 0.12s ease;
}
.copy-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.copy-btn.copied {
  color: var(--pass);
  border-color: var(--pass);
}
.copy-btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

/* FOOTER ─────────────────────────────────────────────── */
.footer {
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ink-muted);
  text-transform: uppercase;
  text-align: center;
}

/* LIGHT THEME ────────────────────────────────────────── */
@media (prefers-color-scheme: light) {
  :root {
    --bg-base: #faf8f1;
    --bg-surface: #f1eee2;
    --bg-elevated: #ffffff;
    --bg-deep: #ece8d9;

    --line: #d6d1bf;
    --line-soft: #e6e2d2;

    --ink-primary: #1a1a24;
    --ink-secondary: #555570;
    --ink-muted: #8a8aa0;
    --ink-faint: #c0c0c8;

    --accent: #b86200;
    --accent-soft: rgba(184, 98, 0, 0.10);
    --accent-line: rgba(184, 98, 0, 0.35);

    --pass: #16a34a;
    --fail: #dc2626;
    --warn: #d97706;
    --info: #2563eb;

    --engine-mssql: #2563eb;
    --engine-postgres: #0f766e;
    --engine-postgres-private: #0c5358;
    --engine-mysql: #c2410c;
    --engine-bastion: #15803d;
    --engine-other: #555570;
  }

  body {
    background:
      radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(184, 98, 0, 0.06), transparent 60%),
      radial-gradient(ellipse 800px 600px at 50% 110%, rgba(37, 99, 235, 0.03), transparent 60%),
      var(--bg-base);
  }
  /* Tone scanlines + grain way down on light bg — they read as dirt instead of CRT */
  body::before { opacity: 0.08; mix-blend-mode: multiply; }
  body::after  { opacity: 0.18; }

  pre { background: var(--bg-deep); }

  .focus { background: linear-gradient(180deg, rgba(220, 38, 38, 0.05), rgba(220, 38, 38, 0.005)); }
  .focus::before { background: var(--bg-base); }
  .focus .failure { background: var(--bg-deep); }
}

/* RESPONSIVE ─────────────────────────────────────────── */
@media (max-width: 760px) {
  body { padding: var(--space-5) var(--space-4); }
  .header { grid-template-columns: 1fr; gap: var(--space-3); }
  .header h1 { font-size: 22px; }
  .header-meta { text-align: left; grid-template-columns: auto 1fr; gap: 2px var(--space-3); }
  .header-meta .label, .header-meta .value { text-align: left; }
  .hero { grid-template-columns: repeat(2, 1fr); }
  .counter-num { font-size: 32px; }
  .counter + .counter:nth-child(3)::before { display: none; }
  .synopsis { padding: 0 0 var(--space-5); font-size: 14px; }
  .copy-btn { flex-basis: 100%; margin-left: 0; margin-top: var(--space-2); text-align: center; }
  .infra-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 420px) {
  .counter-num { font-size: 26px; }
  .header h1 { font-size: 18px; }
  .infra-grid { grid-template-columns: 1fr; }
}
`;

const SCRIPT = /* javascript */ `
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (err) { reject(err); }
    finally { document.body.removeChild(ta); }
  });
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('.copy-btn');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  const payload = btn.dataset.copyPayload || '';
  copyToClipboard(payload).then(() => {
    const original = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = original; }, 1500);
  }).catch((err) => {
    btn.textContent = 'Copy failed';
    console.error('clipboard copy failed:', err);
  });
});

document.addEventListener('mousedown', (event) => {
  if (event.target.closest('.copy-btn')) event.stopPropagation();
}, true);
`;

export function renderReportBody(report) {
  // Note: infrastructure is intentionally rendered separately by the live
  // dashboard so its 2s polls don't trigger a full body remount (which would
  // collapse open <details> and reset CSS animations). Static reports don't
  // include infra at all.
  return `
    ${renderHero(report)}
    <p class="synopsis">${escapeHtml(buildSynopsis(report))}</p>
    ${renderFailureFocusList(report)}
    ${report.tiers.map((t) => renderTier(report, t)).join('')}
  `;
}

export function renderReportHtml(report) {
  const dirtyMark = report.git.dirty ? '<span class="value dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MJ Forge — regression report (${escapeHtml(fmtTimestamp(report.startedAt))})</title>
${FONT_LINKS}
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">MJ Forge</span> Regression Report</h1>
    <div class="header-meta">
      <span class="label">Repo</span>
      <span class="value">${escapeHtml(report.git.branch)}@${escapeHtml(report.git.commit)} ${dirtyMark}</span>
      <span class="label">Run</span>
      <span class="value">${escapeHtml(fmtTimestamp(report.startedAt))}</span>
    </div>
  </header>

  ${renderReportBody(report)}

  <footer class="footer">
    Generated by tests/reporter/build-report.mjs
  </footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export { STYLES, SCRIPT, FONT_LINKS };
