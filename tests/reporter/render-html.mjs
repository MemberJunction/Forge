// HTML renderer for the regression-test report.
//
// Pure function: takes a normalized report object, returns a self-contained
// HTML string with embedded CSS and JS. No I/O. No side effects.
//
// Aesthetic matches packages/renderer/src/styles.scss — purple-tinted dark
// theme by default, light theme via prefers-color-scheme, Inter font, the
// same status colors and radii as the app.

const STATUS_BADGE = {
  passed:  { label: 'PASS',    klass: 'badge-pass'    },
  failed:  { label: 'FAIL',    klass: 'badge-fail'    },
  skipped: { label: 'SKIP',    klass: 'badge-skip'    },
  pending: { label: 'PENDING', klass: 'badge-pending' },
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
    return `${totals.failed} of ${totals.total} regression checks failed. ` +
      `Failures concentrated in: ${failingTiers}. See engineering details below.`;
  }
  return 'No tests were executed in this run.';
}

// Per-section "Copy for LLM" payload (markdown-ish, token-efficient).
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

function renderTest(test) {
  const s = STATUS_BADGE[test.status] ?? STATUS_BADGE.skipped;
  const failureBlock = test.status === 'failed' && test.failureMessages?.length
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
  const isOpen = failed > 0;
  const summary = failed > 0
    ? `<span class="suite-summary text-error">${failed} failed</span>`
    : `<span class="suite-summary text-muted">${passed} passed</span>`;
  const skipNote = skipped > 0 ? `<span class="suite-summary text-muted"> · ${skipped} skipped</span>` : '';
  const payload = escapeHtml(copyPayloadForSuite(report, tier, suite));
  return `
    <details class="suite" ${isOpen ? 'open' : ''}>
      <summary>
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
        <p class="tier-note text-muted">${escapeHtml(tier.note ?? '')}</p>
      </section>
    `;
  }
  const t = tier.totals;
  const isOpen = t.failed > 0;
  const payload = escapeHtml(copyPayloadForTier(report, tier));
  return `
    <details class="tier" ${isOpen ? 'open' : ''}>
      <summary>
        <h2>${escapeHtml(tier.label)}</h2>
        <span class="tier-counts">
          <span class="text-success">${t.passed} passed</span>
          ${t.failed > 0 ? `<span class="text-error"> · ${t.failed} failed</span>` : ''}
          ${t.skipped > 0 ? `<span class="text-muted"> · ${t.skipped} skipped</span>` : ''}
        </span>
        <span class="tier-duration mono text-muted">${fmtDuration(tier.durationMs)}</span>
        <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy a token-efficient summary of this tier for pasting into an LLM">Copy for LLM</button>
      </summary>
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
  const items = failures.map(({ tier, suite, test }) => {
    const payload = escapeHtml(copyPayloadForFailure(report, tier, suite, test));
    return `
      <li class="focus-item">
        <div class="focus-head">
          <span class="badge badge-fail">FAIL</span>
          <span class="mono">${escapeHtml(suite.name)}</span>
          <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy this single failure for pasting into an LLM">Copy for LLM</button>
        </div>
        <div class="focus-test">${escapeHtml(test.fullName)}</div>
        <pre class="failure">${escapeHtml((test.failureMessages ?? []).join('\n\n'))}</pre>
      </li>
    `;
  }).join('');
  return `
    <section class="focus">
      <h2>Failures (${failures.length})</h2>
      <ul class="focus-list">${items}</ul>
    </section>
  `;
}

// ---- Top-level template ----

const STYLES = /* css */ `
  :root {
    --bg-primary: #1e1e2e;
    --bg-secondary: #262637;
    --bg-tertiary: #2a2a3d;
    --bg-elevated: #32324a;
    --bg-hover: #32324a;
    --text-primary: #e0e0f0;
    --text-secondary: #a0a0c0;
    --text-muted: #666690;
    --text-accent: #9b8ff8;
    --accent: #7c6ef6;
    --border-primary: #3a3a55;
    --border-secondary: #4a4a65;
    --status-success: #4ade80;
    --status-warning: #fbbf24;
    --status-error: #f87171;
    --status-info: #60a5fa;
    --radius-sm: 2px;
    --radius-md: 4px;
    --radius-lg: 8px;
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 16px;
    --spacing-lg: 24px;
    --spacing-xl: 32px;
    --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg-primary: #fafafe;
      --bg-secondary: #f0f0f8;
      --bg-tertiary: #e6e6f0;
      --bg-elevated: #ffffff;
      --bg-hover: #e8e8f4;
      --text-primary: #1e1e2e;
      --text-secondary: #555570;
      --text-muted: #9090a8;
      --text-accent: #6356e0;
      --border-primary: #dddde8;
      --border-secondary: #c8c8d8;
      --status-success: #16a34a;
      --status-warning: #d97706;
      --status-error: #dc2626;
      --status-info: #2563eb;
    }
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: var(--font-family);
    font-size: 14px;
    line-height: 1.5;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    -webkit-font-smoothing: antialiased;
  }
  body { padding: var(--spacing-xl) var(--spacing-lg); }
  main { max-width: 1100px; margin: 0 auto; }
  .mono { font-family: var(--font-mono); }
  .text-muted { color: var(--text-muted); }
  .text-success { color: var(--status-success); }
  .text-error { color: var(--status-error); }
  .text-warning { color: var(--status-warning); }
  pre {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-md);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  .header h1 {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .header h1 .accent { color: var(--text-accent); }
  .header .subtitle { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
  .header .subtitle .dirty { color: var(--status-warning); }
  .hero {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  .counter {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    padding: var(--spacing-md);
    text-align: center;
  }
  .counter.is-pass { border-color: var(--status-success); }
  .counter.is-fail { border-color: var(--status-error); }
  .counter.is-skip { border-color: var(--status-warning); }
  .counter-num {
    font-size: 36px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .counter.is-pass .counter-num { color: var(--status-success); }
  .counter.is-fail .counter-num { color: var(--status-error); }
  .counter.is-skip .counter-num { color: var(--status-warning); }
  .counter-label {
    margin-top: 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .synopsis {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
    font-size: 15px;
    line-height: 1.6;
  }
  .focus {
    background: rgba(248, 113, 113, 0.05);
    border: 1px solid var(--status-error);
    border-radius: var(--radius-lg);
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  .focus h2 {
    color: var(--status-error);
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: var(--spacing-sm);
  }
  .focus-list { list-style: none; }
  .focus-item + .focus-item { margin-top: var(--spacing-md); padding-top: var(--spacing-md); border-top: 1px solid var(--border-primary); }
  .focus-head { display: flex; align-items: center; gap: var(--spacing-sm); flex-wrap: wrap; }
  .focus-test { font-weight: 600; margin: var(--spacing-xs) 0; }
  .tier {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    margin-bottom: var(--spacing-md);
    overflow: hidden;
  }
  .tier > summary {
    list-style: none;
    cursor: pointer;
    padding: var(--spacing-md);
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }
  .tier > summary::-webkit-details-marker { display: none; }
  .tier > summary::before {
    content: '▸';
    color: var(--text-muted);
    transition: transform 0.15s ease;
    width: 12px;
    text-align: center;
  }
  .tier[open] > summary::before { transform: rotate(90deg); }
  .tier:hover > summary { background: var(--bg-hover); }
  .tier h2 {
    font-size: 16px;
    font-weight: 600;
    flex: 1;
  }
  .tier-counts { font-size: 13px; }
  .tier-duration { font-size: 12px; }
  .tier-pending {
    padding: var(--spacing-md);
    opacity: 0.7;
  }
  .tier-pending .tier-header { display: flex; align-items: center; gap: var(--spacing-md); }
  .tier-pending h2 { font-size: 16px; font-weight: 600; flex: 1; }
  .tier-note { margin-top: var(--spacing-xs); font-size: 12px; }
  .suite-list { padding: 0 var(--spacing-md) var(--spacing-md); }
  .suite {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-md);
    margin-top: var(--spacing-sm);
    overflow: hidden;
  }
  .suite > summary {
    list-style: none;
    cursor: pointer;
    padding: var(--spacing-sm) var(--spacing-md);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }
  .suite > summary::-webkit-details-marker { display: none; }
  .suite > summary::before {
    content: '▸';
    color: var(--text-muted);
    transition: transform 0.15s ease;
    width: 10px;
    text-align: center;
  }
  .suite[open] > summary::before { transform: rotate(90deg); }
  .suite:hover > summary { background: var(--bg-hover); }
  .suite-name { font-size: 13px; flex: 1; word-break: break-all; }
  .suite-summary, .suite-duration { font-size: 12px; }
  .test-list { list-style: none; padding: 0 var(--spacing-md) var(--spacing-sm); }
  .test {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: var(--spacing-sm);
    padding: 4px 0;
    font-size: 13px;
  }
  .test-name { word-break: break-word; }
  .test-duration { color: var(--text-muted); font-size: 11px; }
  .test-failed .test-name { color: var(--status-error); font-weight: 500; }
  .test .failure {
    grid-column: 1 / -1;
    margin-top: var(--spacing-xs);
    border-left: 2px solid var(--status-error);
  }
  .focus .failure { margin-top: var(--spacing-xs); }
  .badge {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    line-height: 1.4;
  }
  .badge-pass    { background: rgba(74, 222, 128, 0.15);  color: var(--status-success); }
  .badge-fail    { background: rgba(248, 113, 113, 0.15); color: var(--status-error);   }
  .badge-skip    { background: rgba(251, 191, 36, 0.15);  color: var(--status-warning); }
  .badge-pending { background: rgba(96, 165, 250, 0.15);  color: var(--status-info);    }
  .copy-btn {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-secondary);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .copy-btn:hover { color: var(--text-primary); background: var(--bg-hover); border-color: var(--accent); }
  .copy-btn:focus-visible { outline: 2px solid var(--status-info); outline-offset: 1px; }
  .copy-btn.copied { color: var(--status-success); border-color: var(--status-success); }
  .footer {
    margin-top: var(--spacing-xl);
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
`;

const SCRIPT = /* javascript */ `
  // Per-section "Copy for LLM": copies the data-copy-payload attribute to the
  // clipboard. Modern Clipboard API first, textarea fallback for file:// URLs
  // where some browsers reject the secure-context API.
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
      try {
        document.execCommand('copy');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(ta);
      }
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
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = original;
      }, 1500);
    }).catch((err) => {
      btn.textContent = 'Copy failed';
      console.error('clipboard copy failed:', err);
    });
  });

  // Prevent the copy button click from toggling the surrounding <details>.
  // The handler above stops propagation, but Safari occasionally still fires
  // the toggle from native summary semantics. Belt-and-suspenders.
  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('.copy-btn')) event.stopPropagation();
  }, true);
`;

/**
 * Renders the inner body of the report (hero + synopsis + failure focus +
 * tier sections). Used both by the static `renderReportHtml` and by the
 * live dashboard which re-renders this chunk on every state update.
 */
export function renderReportBody(report) {
  return `
    ${renderHero(report)}
    <p class="synopsis">${escapeHtml(buildSynopsis(report))}</p>
    ${renderFailureFocusList(report)}
    ${report.tiers.map((t) => renderTier(report, t)).join('')}
  `;
}

export function renderReportHtml(report) {
  const dirtyMark = report.git.dirty ? ' <span class="dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MJ Forge — regression report (${escapeHtml(fmtTimestamp(report.startedAt))})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">MJ Forge</span> regression report</h1>
    <div class="subtitle">
      ${escapeHtml(report.git.branch)}@${escapeHtml(report.git.commit)}${dirtyMark}
      &nbsp;·&nbsp; ${escapeHtml(fmtTimestamp(report.startedAt))}
    </div>
  </header>

  ${renderReportBody(report)}

  <footer class="footer">
    Generated by <span class="mono">tests/reporter/build-report.mjs</span>
  </footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export { STYLES, SCRIPT };
