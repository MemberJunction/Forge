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
const TIER = process.env.FORGE_LIVE_REPORTER_TIER || 'e2e';

async function post(event) {
  if (!URL) return;
  try {
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: TIER, at: Date.now(), ...event }),
    });
  } catch (err) {
    process.stderr.write(`[playwright-live-reporter] post failed: ${err?.message ?? err}\n`);
  }
}

function fullNameOf(test) {
  return test.titlePath().slice(1).filter(Boolean).join(' > ') || test.title;
}

export default class ForgePlaywrightLiveReporter {
  async onBegin(_config, suite) {
    const files = new Set();
    for (const test of suite.allTests()) {
      if (test.location?.file) files.add(test.location.file);
    }
    await post({ type: 'run-start', files: Array.from(files) });
  }

  async onTestBegin(test) {
    await post({ type: 'module-start', file: test.location?.file ?? '' });
  }

  async onTestEnd(test, result) {
    const status = normalizeStatus(result.status);
    const failureMessages = (result.errors ?? []).map((e) => e?.message ?? String(e));
    await post({
      type: 'test-result',
      file: test.location?.file ?? '',
      fullName: fullNameOf(test),
      status,
      durationMs: result.duration,
      failureMessages,
    });
  }

  async onEnd(result) {
    await post({ type: 'run-end', reason: result.status });
  }
}

function normalizeStatus(s) {
  if (s === 'passed' || s === 'failed' || s === 'skipped') return s;
  // Playwright also emits 'timedOut', 'interrupted'. Treat as failed.
  return 'failed';
}
