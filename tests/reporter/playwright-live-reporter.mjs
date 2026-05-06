// Custom Playwright reporter that POSTs per-test events to the Forge live
// dashboard server. Uses the same /_event protocol as the Vitest reporter
// so the server treats Playwright runs uniformly with the Vitest tiers.
//
// Activated by setting FORGE_LIVE_REPORTER_URL in the environment when
// invoking Playwright. When the env var is missing this reporter no-ops,
// so the same playwright.config.ts is safe in CI / one-shot scenarios.
//
// Tier defaults to 'e2e' but can be overridden with FORGE_LIVE_REPORTER_TIER
// for future sub-tier splits (e.g., 'visual').

const URL = process.env.FORGE_LIVE_REPORTER_URL;
const DEFAULT_TIER = process.env.FORGE_LIVE_REPORTER_TIER || 'e2e';

// Visual baselines live under tests/e2e/visual/ — route them to the
// dedicated 'visual' tier so the dashboard shows them as a distinct row.
function tierForFile(file) {
  if (typeof file === 'string' && file.includes('/tests/e2e/visual/')) return 'visual';
  return DEFAULT_TIER;
}

async function post(tier, event) {
  if (!URL) return;
  try {
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, at: Date.now(), ...event }),
    });
  } catch (err) {
    process.stderr.write(`[playwright-live-reporter] post failed: ${err?.message ?? err}\n`);
  }
}

function fullNameOf(test) {
  return test.titlePath().slice(1).filter(Boolean).join(' > ') || test.title;
}

export default class ForgePlaywrightLiveReporter {
  constructor() {
    // Tracks which tiers actually started in this run, so onEnd only flushes
    // run-end events for tiers that had a run-start. Avoids flipping an idle
    // tier (e.g., 'visual' when only e2e ran) to 'ok'/'failed'.
    this._activeTiers = new Set();
  }

  async onBegin(_config, suite) {
    const filesByTier = new Map();
    for (const test of suite.allTests()) {
      const file = test.location?.file ?? '';
      if (!file) continue;
      const tier = tierForFile(file);
      if (!filesByTier.has(tier)) filesByTier.set(tier, new Set());
      filesByTier.get(tier).add(file);
    }
    for (const [tier, files] of filesByTier) {
      this._activeTiers.add(tier);
      await post(tier, { type: 'run-start', files: Array.from(files) });
    }
  }

  async onTestBegin(test) {
    const file = test.location?.file ?? '';
    await post(tierForFile(file), { type: 'module-start', file });
  }

  async onTestEnd(test, result) {
    const file = test.location?.file ?? '';
    const status = normalizeStatus(result.status);
    const failureMessages = (result.errors ?? []).map((e) => e?.message ?? String(e));
    await post(tierForFile(file), {
      type: 'test-result',
      file,
      fullName: fullNameOf(test),
      status,
      durationMs: result.duration,
      failureMessages,
    });
  }

  async onEnd(result) {
    await Promise.all(
      Array.from(this._activeTiers).map((tier) =>
        post(tier, { type: 'run-end', reason: result.status }),
      ),
    );
    this._activeTiers.clear();
  }
}

function normalizeStatus(s) {
  if (s === 'passed' || s === 'failed' || s === 'skipped') return s;
  // Playwright also emits 'timedOut', 'interrupted'. Treat as failed.
  return 'failed';
}
