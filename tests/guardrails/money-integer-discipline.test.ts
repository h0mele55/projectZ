import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * MONEY IS INTEGER CENTS. ALWAYS.
 *
 * `2400 * 0.05` is `120.00000000000001` in IEEE-754. `0.1 + 0.2` is
 * `0.30000000000000004`. Do this to a booking total and the error is far too
 * small to notice in a test and far too persistent to explain to an accountant:
 * the books drift by a cent here and a cent there, and nobody can say where.
 *
 * The rules:
 *
 *   1. No FLOAT LITERAL in arithmetic with a `*Cents` value.
 *      Use basis points and one integer division: `(cents * bps) / 10_000`.
 *
 *   2. No `parseFloat` / `Number.parseFloat` on money.
 *
 *   3. No `.toFixed()` on a cents value — `toFixed` ROUNDS-HALF-TO-EVEN on a
 *      value that is already wrong, which launders the error rather than
 *      fixing it.
 *
 * This ratchet is the reason `platformFeeCents` looks the way it does. It is
 * negative-controlled: the test at the bottom proves the pattern actually fires
 * on the code we are trying to forbid.
 */

interface Rule {
  name: string;
  pattern: RegExp;
  fix: string;
}

const RULES: Rule[] = [
  {
    name: 'float arithmetic on a cents value',
    // `totalCents * 0.05`, `amountCents / 1.2`, `0.05 * feeCents`
    pattern: /(?:\w*[Cc]ents\w*\s*[*/]\s*\d*\.\d+)|(?:\d*\.\d+\s*[*/]\s*\w*[Cc]ents\w*)/,
    fix: 'Use integer basis points with a single division: Math.round((cents * bps) / 10_000).',
  },
  {
    name: 'parseFloat on a cents value',
    pattern: /(?:Number\.)?parseFloat\s*\([^)]*[Cc]ents/,
    fix: 'Money arrives as an integer. Use Number.parseInt, or reject the input.',
  },
  {
    name: 'toFixed on a cents value',
    pattern: /\w*[Cc]ents\w*(?:\s*\))?\s*\.toFixed\s*\(/,
    fix: 'toFixed rounds a value that is already wrong. Keep cents integral; format only at the very edge, for display.',
  },
];

/** Strip comments and string literals — a rule discussed in prose is not a violation. */
function code(source: string): string[] {
  const out: string[] = [];
  let inBlock = false;

  for (const raw of source.split('\n')) {
    let line = raw;

    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2);
    }

    const block = line.indexOf('/*');
    if (block !== -1) {
      const end = line.indexOf('*/', block + 2);
      if (end === -1) {
        inBlock = true;
        line = line.slice(0, block);
      } else {
        line = line.slice(0, block) + line.slice(end + 2);
      }
    }

    const lineComment = line.indexOf('//');
    if (lineComment !== -1) line = line.slice(0, lineComment);

    // A cents value named inside an error message is not arithmetic.
    line = line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

    if (line.trim()) out.push(line);
  }

  return out;
}

describe('money is integer cents', () => {
  const files = globSync('src/**/*.{ts,tsx}').map((f) => f.toString());

  it('the scan found the source tree', () => {
    // A broken glob makes every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(RULES.map((r) => [r.name, r] as const))('no %s anywhere in src/', (_name, rule) => {
    const violations: string[] = [];

    for (const file of files) {
      const lines = code(readFileSync(file, 'utf8'));
      for (const line of lines) {
        if (rule.pattern.test(line)) violations.push(`${file}: ${line.trim()}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `${rule.name} — ${violations.length} violation(s):\n\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          `\n\n  ${rule.fix}\n\n` +
          `Floating-point money does not fail loudly. It drifts by a cent at a time\n` +
          `until the books do not balance and nobody can say why.`,
      );
    }
  });

  // ── Negative controls ─────────────────────────────────────────────
  //
  // A guardrail nobody has seen go red is a guardrail nobody knows works.
  describe('the rules actually fire', () => {
    it.each([
      ['const fee = totalCents * 0.05;', 'float arithmetic on a cents value'],
      ['const fee = 0.05 * totalCents;', 'float arithmetic on a cents value'],
      ['const x = amountCents / 1.2;', 'float arithmetic on a cents value'],
      ['const n = parseFloat(rawCents);', 'parseFloat on a cents value'],
      ['const s = feeCents.toFixed(2);', 'toFixed on a cents value'],
    ])('%s is caught by "%s"', (bad, ruleName) => {
      const rule = RULES.find((r) => r.name === ruleName)!;
      expect(rule.pattern.test(bad)).toBe(true);
    });

    it.each([
      'const fee = Math.round((totalCents * bps) / 10_000);',
      'const half = Math.floor(totalCents / 2);',
      'const ratio = 0.5 * weight;',
      'const price = formatCurrency(totalCents);',
    ])('%s is NOT flagged', (good) => {
      for (const rule of RULES) expect(rule.pattern.test(good)).toBe(false);
    });
  });
});
