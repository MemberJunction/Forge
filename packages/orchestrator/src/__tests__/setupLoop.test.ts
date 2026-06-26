import { describe, it, expect, vi } from 'vitest';
import { runSyncConventionLoop } from '../../dist/index.js';
import type { EventSink } from '../../dist/index.js';

type StepResult = { ok: boolean; error?: string; fatal?: boolean };

/** Build loop steps + spies from a script of outcomes. */
function harness(opts: {
  sync: Array<StepResult>; // successive sync() outcomes
  codegen?: StepResult;
  diff?: { changed: boolean; files: string[] };
  build?: StepResult;
}) {
  const syncQueue = [...opts.sync];
  const calls = { sync: 0, codegen: 0, diff: 0, build: 0 };
  const codegenAi: boolean[] = [];
  const escalations: Array<{ summary: string; detail: string }> = [];
  const events: Array<{ level: string; message: string }> = [];

  const steps = {
    sync: vi.fn(async () => {
      calls.sync++;
      return syncQueue.shift() ?? { ok: true };
    }),
    codegen: vi.fn(async ({ ai }: { ai: boolean }) => {
      calls.codegen++;
      codegenAi.push(ai);
      return opts.codegen ?? { ok: true };
    }),
    diff: vi.fn(async () => {
      calls.diff++;
      return opts.diff ?? { changed: false, files: [] };
    }),
    build: vi.fn(async () => {
      calls.build++;
      return opts.build ?? { ok: true };
    }),
  };
  const sink: EventSink = e => events.push({ level: e.level, message: e.message });
  const escalate = async (summary: string, detail: string) => {
    escalations.push({ summary, detail });
  };
  return { steps, calls, codegenAi, escalations, events, sink, escalate };
}

describe('runSyncConventionLoop (ADR-009)', () => {
  it('happy path: sync ok → codegen → diff(clean) → build', async () => {
    const h = harness({ sync: [{ ok: true }] });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(true);
    expect(out.escalated).toBe(false);
    expect(out.syncRepaired).toBe(false);
    expect(out.driftWarning).toBe(false);
    expect(h.calls).toEqual({ sync: 1, codegen: 1, diff: 1, build: 1 });
    expect(h.codegenAi).toEqual([false]); // loop never spends tokens
    expect(h.escalations).toHaveLength(0);
  });

  it('codegen runs with AI OFF always in the loop', async () => {
    const h = harness({ sync: [{ ok: true }] });
    await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(h.codegenAi.every(ai => ai === false)).toBe(true);
  });

  it('repair branch: first sync fails → warn + one-shot codegen → resync ok → diff → build (codegen runs ONCE)', async () => {
    const h = harness({ sync: [{ ok: false, error: 'Entity not found' }, { ok: true }] });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(true);
    expect(out.syncRepaired).toBe(true);
    expect(h.calls).toEqual({ sync: 2, codegen: 1, diff: 1, build: 1 }); // codegen exactly once
    expect(h.escalations).toHaveLength(0);
    expect(h.events.some(e => e.level === 'warn' && /convention is\s+broken/.test(e.message))).toBe(
      true
    );
  });

  it('escalates when sync still fails after the codegen repair (no infinite loop)', async () => {
    const h = harness({
      sync: [
        { ok: false, error: 'UQ violation' },
        { ok: false, error: 'UQ violation again' },
      ],
    });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(false);
    expect(out.escalated).toBe(true);
    expect(h.calls.sync).toBe(2); // exactly two syncs — bounded, no loop
    expect(h.calls.codegen).toBe(1);
    expect(h.calls.build).toBe(0); // never builds on escalation
    expect(h.escalations).toHaveLength(1);
    expect(h.escalations[0].detail).toMatch(/after a one-shot codegen repair/i);
  });

  it('escalates IMMEDIATELY on a fatal sync failure (old mj) — no codegen, no resync, no misleading warn', async () => {
    const h = harness({
      sync: [{ ok: false, error: 'mj too old for --format=json', fatal: true }],
    });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(false);
    expect(out.escalated).toBe(true);
    expect(h.calls.sync).toBe(1); // exactly one sync — no resync
    expect(h.calls.codegen).toBe(0); // codegen never runs — it can't fix a CLI version gap
    expect(h.calls.build).toBe(0);
    // No "convention is broken / attempting repair" warning on the fatal path.
    expect(h.events.some(e => e.level === 'warn' && /convention is\s+broken/.test(e.message))).toBe(
      false
    );
    expect(h.escalations).toHaveLength(1);
    expect(h.escalations[0].summary).toMatch(/codegen repair cannot fix/i);
  });

  it('escalates when the one-shot codegen repair itself fails', async () => {
    const h = harness({
      sync: [{ ok: false, error: 'sync boom' }],
      codegen: { ok: false, error: 'codegen boom' },
    });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(false);
    expect(out.escalated).toBe(true);
    expect(h.calls.sync).toBe(1); // never re-synced because repair failed
    expect(h.escalations[0].detail).toMatch(/codegen repair also failed/i);
  });

  it('escalates when the verification codegen fails on the happy path', async () => {
    const h = harness({ sync: [{ ok: true }], codegen: { ok: false, error: 'codegen boom' } });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(false);
    expect(out.escalated).toBe(true);
    expect(h.calls.build).toBe(0);
  });

  it('fires the tripwire warning (non-blocking) when generated code drifts, still builds', async () => {
    const h = harness({
      sync: [{ ok: true }],
      diff: {
        changed: true,
        files: ['packages/MJCoreEntities/src/generated/entity_subclasses.ts'],
      },
    });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(true); // drift is non-blocking
    expect(out.driftWarning).toBe(true);
    expect(out.driftFiles).toContain('packages/MJCoreEntities/src/generated/entity_subclasses.ts');
    expect(h.calls.build).toBe(1);
    expect(h.events.some(e => e.level === 'warn' && /Generated code changed/.test(e.message))).toBe(
      true
    );
  });

  it('a build failure is a normal failure (not an escalation)', async () => {
    const h = harness({ sync: [{ ok: true }], build: { ok: false, error: 'tsc error' } });
    const out = await runSyncConventionLoop('s', 'setup', h.steps, h.sink, h.escalate);
    expect(out.ok).toBe(false);
    expect(out.escalated).toBe(false);
    expect(out.error).toBe('tsc error');
    expect(h.escalations).toHaveLength(0);
  });
});
