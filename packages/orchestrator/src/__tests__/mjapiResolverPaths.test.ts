import { describe, it, expect } from 'vitest';
import {
  applyAddDevAppResolverGlob,
  applyRemoveDevAppResolverGlob,
} from '../mjapiResolverPaths.js';

/** The shipped MJAPI entry shape this mutation targets. */
const MJAPI_INDEX = `import { createMJServer } from '@memberjunction/server-bootstrap';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import 'mj_generatedentities';
import './generated/class-registrations-manifest.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const resolverPaths = [resolve(__dirname, 'generated/generated.{js,ts}')];

createMJServer({ resolverPaths }).catch(console.error);
`;

describe('mjapiResolverPaths', () => {
  it('injects one marked dev-app resolver glob into the resolverPaths array', () => {
    const out = applyAddDevAppResolverGlob(MJAPI_INDEX);
    expect(out).not.toBe(MJAPI_INDEX);
    expect(out).toContain('mjdev:dev-app-resolvers');
    expect(out).toContain('dev-apps/*/packages/*/dist/generated/generated.{js,ts}');
    // Original MJAPI resolver entry is preserved.
    expect(out).toContain("resolve(__dirname, 'generated/generated.{js,ts}')");
    // The injected entry is inside the array (before the original entry).
    const arrayBody = out.slice(out.indexOf('['), out.indexOf(']'));
    expect(arrayBody).toContain('mjdev:dev-app-resolvers');
  });

  it('is idempotent — a second add does not duplicate the glob', () => {
    const once = applyAddDevAppResolverGlob(MJAPI_INDEX);
    const twice = applyAddDevAppResolverGlob(once);
    expect(twice).toBe(once);
    expect(twice.match(/mjdev:dev-app-resolvers/g)).toHaveLength(1);
  });

  it('round-trips cleanly: add then remove restores the original bytes', () => {
    const added = applyAddDevAppResolverGlob(MJAPI_INDEX);
    const removed = applyRemoveDevAppResolverGlob(added);
    expect(removed).toBe(MJAPI_INDEX);
  });

  it('remove is a no-op when the glob is absent', () => {
    expect(applyRemoveDevAppResolverGlob(MJAPI_INDEX)).toBe(MJAPI_INDEX);
  });

  it('add is a no-op (returns input) when the resolverPaths anchor is missing', () => {
    const noAnchor = `createMJServer().catch(console.error);\n`;
    expect(applyAddDevAppResolverGlob(noAnchor)).toBe(noAnchor);
  });
});
