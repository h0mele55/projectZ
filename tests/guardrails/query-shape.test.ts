import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * QUERY SHAPE RATCHET.
 *
 * Two failure modes that pass every functional test and then take the site
 * down for your most successful customer:
 *
 *   D1 — a Prisma read inside a loop. `for (const court of courts) { await
 *        db.booking.findMany(...) }` is an N+1: 12 queries with the seed
 *        data, 4,000 on a real venue page. The code is *correct*. It is just
 *        catastrophically slow, and nothing fails.
 *
 *   D2 — a `findMany` with no `take`. It returns 3 rows in dev and 200,000
 *        in production, then the pod OOMs. Again: correct, and fatal.
 *
 * Neither is caught by types, tests, or review. So they are caught here.
 */

const SOURCES = ['src/app-layer/**/*.ts', 'src/lib/**/*.ts', 'src/app/**/*.ts'];

interface Finding {
  file: string;
  line: number;
  snippet: string;
}

function sourceFiles(): string[] {
  return SOURCES.flatMap((p) => globSync(p).map((f) => f.toString())).filter(
    (f) => !f.endsWith('.d.ts'),
  );
}

const READ_CALL = /\b(?:db|tx|prisma)\.\w+\.(findMany|findFirst|findUnique|count|aggregate)\s*\(/;
const LOOP_START = /^\s*(for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(\s*async)/;
const ALLOW = /guardrail-allow:\s*(unbounded|n-plus-one)/;

describe('query shape', () => {
  const files = sourceFiles();

  it('the scan actually found source files', () => {
    // A broken glob would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it('D1: no Prisma read inside a loop (N+1)', () => {
    const findings: Finding[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      let loopDepth = 0;
      let braceAtLoopStart = 0;
      let braces = 0;

      lines.forEach((line, i) => {
        const opened = (line.match(/\{/g) ?? []).length;
        const closed = (line.match(/\}/g) ?? []).length;

        if (LOOP_START.test(line)) {
          loopDepth++;
          braceAtLoopStart = braces;
        }

        if (loopDepth > 0 && READ_CALL.test(line) && !ALLOW.test(line)) {
          findings.push({ file, line: i + 1, snippet: line.trim().slice(0, 90) });
        }

        braces += opened - closed;
        if (loopDepth > 0 && braces <= braceAtLoopStart && closed > 0) {
          loopDepth = Math.max(0, loopDepth - 1);
        }
      });
    }

    if (findings.length) {
      const report = findings.map((f) => `  ${f.file}:${f.line}\n    ${f.snippet}`).join('\n');
      throw new Error(
        `${findings.length} Prisma read(s) inside a loop — an N+1 that is fast with seed ` +
          `data and fatal in production:\n${report}\n\n` +
          `Fix: hoist the query out and fetch the whole set once (findMany with an \`in\` ` +
          `filter), or annotate the line with \`// guardrail-allow: n-plus-one <reason>\`.`,
      );
    }

    expect(findings).toHaveLength(0);
  });

  it('D2: every findMany is bounded by take', () => {
    const findings: Finding[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');

      lines.forEach((line, i) => {
        if (!/\.findMany\s*\(/.test(line)) return;
        if (ALLOW.test(line)) return;

        // Look ahead to the end of the call for a `take:`.
        const window = lines.slice(i, i + 25).join('\n');
        const call = window.slice(0, matchingParenEnd(window));

        if (/\btake\s*:/.test(call)) return;
        if (ALLOW.test(call)) return;

        findings.push({ file, line: i + 1, snippet: line.trim().slice(0, 90) });
      });
    }

    if (findings.length) {
      const report = findings.map((f) => `  ${f.file}:${f.line}\n    ${f.snippet}`).join('\n');
      throw new Error(
        `${findings.length} unbounded findMany — returns 3 rows in dev and 200,000 in ` +
          `production:\n${report}\n\n` +
          `Fix: add \`take:\`, or annotate with \`// guardrail-allow: unbounded <reason>\`.`,
      );
    }

    expect(findings).toHaveLength(0);
  });
});

/** Index just past the paren that closes the first `(` in `s`. */
function matchingParenEnd(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}
