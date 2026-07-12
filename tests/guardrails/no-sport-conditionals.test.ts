import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * NO SPORT CONDITIONALS.
 *
 * `if (sport === 'CHESS')` looks harmless with three sports. With sixteen it
 * is unmaintainable, and — the part that actually hurts — it fails SILENTLY.
 *
 * Add a seventeenth sport and every `sport === '…'` branch you miss does not
 * throw. It just quietly falls through to the else, and the new sport behaves
 * like tennis. Nobody finds out until a pickleball player is offered a
 * 90-minute padel slot.
 *
 * Sport-specific behaviour is DATA (src/lib/sports/registry.ts). This fails
 * the build on a hard-coded sport comparison in a component or a route.
 */
const SOURCES = ['src/components/**/*.tsx', 'src/components/**/*.ts', 'src/app/**/*.tsx', 'src/app/**/*.ts'];

/** `sport === "CHESS"`, `sport == 'PADEL'`, `s.sport === "TENNIS"` … */
const SPORT_CONDITIONAL = /\bsport\w*\s*===?\s*['"][A-Z_]+['"]/;

const ALLOW = /guardrail-allow:\s*sport-conditional/;

/**
 * Curated exceptions. Max 5, each with a written reason.
 * Currently empty — the registry has covered every case so far.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [];

describe('no sport conditionals', () => {
  const files = SOURCES.flatMap((p) => globSync(p).map((f) => f.toString()));

  it('the scan reaches the component and route tree', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('sport behaviour routes through the registry, not through if-chains', () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file));
    const hits: Array<{ file: string; line: number; snippet: string }> = [];

    for (const file of files) {
      if (allowed.has(file)) continue;

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          if (!SPORT_CONDITIONAL.test(line)) return;
          if (ALLOW.test(line)) return;
          hits.push({ file, line: i + 1, snippet: t.slice(0, 80) });
        });
    }

    if (hits.length > 0) {
      const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.snippet}`).join('\n');
      throw new Error(
        `${hits.length} hard-coded sport comparison(s):\n${report}\n\n` +
          `These fail SILENTLY. Add a 17th sport and every branch you miss falls through\n` +
          `to the else — the new sport quietly behaves like tennis, and nobody finds out\n` +
          `until a pickleball player is offered a 90-minute padel slot.\n\n` +
          `Fix: put the behaviour in the sport registry and read it from there.`,
      );
    }

    expect(hits).toHaveLength(0);
  });

  it('the allowlist stays at or below 5 (ratchet-only)', () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(5);
  });
});
