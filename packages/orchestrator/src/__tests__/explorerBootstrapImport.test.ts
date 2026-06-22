import { describe, it, expect } from 'vitest';
import { applyAddBootstrapImport, applyRemoveBootstrapImport } from '../explorerBootstrapImport.js';

/** The shipped MJExplorer entry this mutation targets (no bootstrap import). */
const MAIN_TS = `import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch(err => console.error(err));
`;

describe('explorerBootstrapImport', () => {
  it('prepends one marked side-effect import of the generated bootstrap', () => {
    const out = applyAddBootstrapImport(MAIN_TS);
    expect(out).not.toBe(MAIN_TS);
    expect(out).toContain('mjdev:dev-app-client-bootstrap');
    expect(out).toContain("import './app/generated/open-app-bootstrap.generated';");
    // Original entry is preserved below the injected import.
    expect(out).toContain('bootstrapModule(AppModule)');
    expect(out.indexOf('open-app-bootstrap')).toBeLessThan(out.indexOf('platformBrowserDynamic'));
  });

  it('is idempotent — a second add does not duplicate the import', () => {
    const once = applyAddBootstrapImport(MAIN_TS);
    const twice = applyAddBootstrapImport(once);
    expect(twice).toBe(once);
    expect(twice.match(/mjdev:dev-app-client-bootstrap/g)).toHaveLength(1);
  });

  it('round-trips cleanly: add then remove restores the original bytes', () => {
    const added = applyAddBootstrapImport(MAIN_TS);
    expect(applyRemoveBootstrapImport(added)).toBe(MAIN_TS);
  });

  it('remove is a no-op when the import is absent', () => {
    expect(applyRemoveBootstrapImport(MAIN_TS)).toBe(MAIN_TS);
  });
});
