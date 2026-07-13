import { readFileSync } from 'node:fs';

/**
 * THE COVERAGE FLOOR IS A RATCHET, NOT A DIAL.
 *
 * A threshold that can be lowered is not a threshold. The failure mode is
 * entirely predictable: somebody's PR drops coverage by two points, the build
 * goes red, and the fastest way to green is to edit the number. It is a one-line
 * diff, it looks harmless in review, and the floor never goes back up.
 *
 * So the floor is pinned HERE, and lowering it means editing this file too — a
 * change nobody makes by accident, and one a reviewer cannot miss.
 *
 * ─── The trap this whole arrangement exists to avoid ─────────────────
 *
 * Jest SILENTLY IGNORES a top-level `coverageThreshold` in multi-project mode.
 * The run exits 0 however low coverage falls. We were bitten by exactly that in
 * P03: the thresholds were configured, they were never enforced, and nothing
 * said so.
 *
 * Hence: thresholds live inside the PROJECT blocks, and `jest.thresholds.json`
 * is the single source of truth that CI passes explicitly on the command line.
 */

const MINIMUM = {
  statements: 80,
  functions: 80,
  lines: 80,
  // Branches lag the others, and that is honest rather than lazy: an error path
  // that only fires when Postgres returns a specific SQLSTATE is genuinely harder
  // to reach than the happy path, and padding it with a contrived test buys
  // nothing but a number.
  branches: 72,
} as const;

describe('the coverage floor', () => {
  const configured = JSON.parse(readFileSync('jest.thresholds.json', 'utf8')) as {
    global: Record<string, number>;
  };

  it.each(Object.entries(MINIMUM))('%s is at least %i%%', (metric, minimum) => {
    const actual = configured.global[metric];

    if (actual === undefined) {
      throw new Error(`jest.thresholds.json has no "${metric}" threshold at all.`);
    }

    if (actual < minimum) {
      throw new Error(
        `The ${metric} coverage floor has been LOWERED to ${actual}% (minimum ${minimum}%).\n\n` +
          `A threshold that can be lowered is not a threshold. If a change genuinely\n` +
          `cannot meet the floor, that is a conversation — not a one-line edit to make\n` +
          `the build green.\n\n` +
          `Raise it back, or change MINIMUM in this file and explain why in the PR.`,
      );
    }
  });

  it('CI enforces the floor on the command line, not just in config', () => {
    // Jest SILENTLY IGNORES a top-level coverageThreshold in multi-project mode
    // — it exits 0 however low coverage falls. Configuring it is not enforcing
    // it, and we were bitten by exactly that in P03.
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(ci).toMatch(/coverageThreshold|jest\.thresholds\.json/);
  });

  it('the Phase-2 domain logic is INSIDE the measured scope', () => {
    // A floor that only measures the code you wrote first is a floor that rises
    // while the uncovered surface grows underneath it. Money, ratings, brackets
    // and moderation policy are all authored domain logic and all belong in it.
    const config = readFileSync('jest.config.mjs', 'utf8');

    for (const path of [
      'src/lib/billing',
      'src/lib/gamification',
      'src/lib/ratings',
      'src/lib/tournaments',
      'src/lib/moderation',
    ]) {
      expect(config).toContain(path);
    }
  });
});
