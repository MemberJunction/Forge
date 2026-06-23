import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Keeps the authored CLI reference honest without coupling main/orchestrator to
 * the CLI at runtime: parse every literal `.command('name')` out of the CLI
 * source and assert each appears in CLI-REFERENCE.md. A new command that isn't
 * documented fails this test. (Dynamically-registered verbs — `.command(verb)`
 * for start/stop, enable/disable, reset-schema/repair-schema — are documented
 * manually and not enforced here.)
 */
const root = process.cwd();
const cliSrc = fs.readFileSync(path.join(root, 'packages/cli/src/mjdev.ts'), 'utf8');
const ref = fs.readFileSync(
  path.join(root, 'packages/orchestrator/docs/agent/CLI-REFERENCE.md'),
  'utf8'
);

const literalCommands = [
  ...new Set([...cliSrc.matchAll(/\.command\('([a-z][a-z0-9-]*)'\)/g)].map(m => m[1])),
];

describe('CLI reference drift', () => {
  it('parses a non-trivial command list from the CLI source', () => {
    // Sanity: if the regex stops matching, the guard is silently useless.
    expect(literalCommands.length).toBeGreaterThan(15);
    expect(literalCommands).toContain('create');
    expect(literalCommands).toContain('link');
  });

  it('documents every literal mjdev command in CLI-REFERENCE.md', () => {
    const missing = literalCommands.filter(c => !ref.includes(c));
    expect(missing, `undocumented commands: ${missing.join(', ')}`).toEqual([]);
  });
});
