import { describe, it, expect } from 'vitest';
import {
  applyAddEntityPackageMapping,
  removeEntityPackageEntry,
  resolveEntityPackageFromManifest,
} from '../../dist/index.js';

/**
 * Golden tests for the reproduced `entityPackageName` mutation — the ONE Open App
 * Engine install step not exported from `@memberjunction/open-app-engine`. These
 * pin the exact byte output (Record creation, entry insertion, de-dupe, string→Record
 * conversion) so it stays in lockstep with `config-manager.ts`. R6 mitigation.
 */
const BASE_CONFIG = `/** @type {import('@memberjunction/core').MJConfig} */
module.exports = {
  dbHost: 'localhost',
  dbDatabase: 'MJ',
  codeGenLogin: 'MJ_CodeGen',
};
`;

describe('entityPackageName reproduction', () => {
  it('resolves the entities package from a shared library entry (auto-detect)', () => {
    const pkg = resolveEntityPackageFromManifest({
      schema: { name: 'accounting' },
      packages: {
        shared: [
          { name: '@mj-biz-apps/accounting-actions', role: 'actions' },
          { name: '@mj-biz-apps/accounting-entities', role: 'library' },
        ],
      },
    });
    expect(pkg).toBe('@mj-biz-apps/accounting-entities');
  });

  it('prefers an explicit schema.entityPackage over auto-detect', () => {
    const pkg = resolveEntityPackageFromManifest({
      schema: { name: 'accounting', entityPackage: '@custom/entities' },
      packages: { shared: [{ name: '@mj-biz-apps/accounting-entities', role: 'library' }] },
    });
    expect(pkg).toBe('@custom/entities');
  });

  it('creates the entityPackageName Record and inserts the entry before the closing brace', () => {
    const out = applyAddEntityPackageMapping(
      BASE_CONFIG,
      'accounting',
      '@mj-biz-apps/accounting-entities'
    );
    expect(out).toContain('entityPackageName: {');
    expect(out).toContain("'accounting': '@mj-biz-apps/accounting-entities',");
    // Section is inside the module.exports object (before its closing `};`).
    expect(out.indexOf('entityPackageName')).toBeLessThan(out.lastIndexOf('};'));
    // The original keys survive untouched.
    expect(out).toContain("codeGenLogin: 'MJ_CodeGen'");
  });

  it('is idempotent: re-applying the same mapping does not duplicate the entry', () => {
    const once = applyAddEntityPackageMapping(
      BASE_CONFIG,
      'accounting',
      '@mj-biz-apps/accounting-entities'
    );
    const twice = applyAddEntityPackageMapping(
      once,
      'accounting',
      '@mj-biz-apps/accounting-entities'
    );
    const count = (twice.match(/'accounting'\s*:/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('updates the package when the schema is remapped (de-dupe then insert)', () => {
    const once = applyAddEntityPackageMapping(BASE_CONFIG, 'accounting', '@old/entities');
    const updated = applyAddEntityPackageMapping(once, 'accounting', '@new/entities');
    expect(updated).toContain("'accounting': '@new/entities',");
    expect(updated).not.toContain('@old/entities');
  });

  it('preserves a second schema mapping when adding/removing another', () => {
    let cfg = applyAddEntityPackageMapping(BASE_CONFIG, 'accounting', '@a/entities');
    cfg = applyAddEntityPackageMapping(cfg, 'billing', '@b/entities');
    expect(cfg).toContain("'accounting': '@a/entities',");
    expect(cfg).toContain("'billing': '@b/entities',");
    cfg = removeEntityPackageEntry(cfg, 'accounting');
    expect(cfg).not.toContain('@a/entities');
    expect(cfg).toContain("'billing': '@b/entities',");
  });

  it('converts a legacy string form into a Record', () => {
    const legacy = BASE_CONFIG.replace(
      "codeGenLogin: 'MJ_CodeGen',",
      "codeGenLogin: 'MJ_CodeGen',\n  entityPackageName: 'legacy-pkg',"
    );
    const out = applyAddEntityPackageMapping(legacy, 'accounting', '@a/entities');
    expect(out).toContain('entityPackageName: {');
    expect(out).toContain("Converted from string value 'legacy-pkg'");
    expect(out).toContain("'accounting': '@a/entities',");
  });
});
