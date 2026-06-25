import { describe, it, expect } from 'vitest';
import { FULL_SETUP_ORDER, setupFlagForStep } from '../../dist/index.js';
import type { SetupStep } from '@mj-forge/shared';

describe('SetupRunner full-setup order', () => {
  it('provisions with deps → build → migrate only (no codegen, no sync)', () => {
    expect(FULL_SETUP_ORDER).toEqual(['deps', 'build', 'migrate']);
  });

  it('builds before migrate (the mj CLI must be compiled first)', () => {
    expect(FULL_SETUP_ORDER.indexOf('build')).toBeLessThan(FULL_SETUP_ORDER.indexOf('migrate'));
  });

  it('does NOT auto-run codegen (it is on-demand only — see ADR-007)', () => {
    expect(FULL_SETUP_ORDER).not.toContain('codegen');
  });
});

describe('setupFlagForStep', () => {
  it('maps every step to its InstanceSetupState flag', () => {
    const expected: Record<SetupStep, string> = {
      deps: 'depsInstalled',
      migrate: 'migrated',
      codegen: 'codegen',
      build: 'built',
    };
    for (const step of Object.keys(expected) as SetupStep[]) {
      expect(setupFlagForStep(step)).toBe(expected[step]);
    }
  });
});
