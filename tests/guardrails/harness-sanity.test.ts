import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The proving ground for the test spine: if jest cannot resolve the
 * `@/` alias or reach src/, every downstream guardrail is meaningless.
 * P03 upgrades this to assert the alias resolves through a real import.
 */
describe('harness sanity', () => {
  it('can see the src/ tree from the test runner', () => {
    expect(existsSync(join(process.cwd(), 'src'))).toBe(true);
  });

  it('resolves the @/ path alias via moduleNameMapper', () => {
    // Importing a module that does not exist must fail with jest's
    // *mapped* error — proof the mapper rewrote `@/lib/x` into
    // `<rootDir>/src/lib/x` before trying to load it. A broken mapper
    // reports an unresolved bare `@/…` specifier instead, which is the
    // failure this guardrail exists to catch.
    expect(() => require('@/lib/does-not-exist-yet')).toThrow(/mapped as:[\s\S]*\/src\//);
  });
});
