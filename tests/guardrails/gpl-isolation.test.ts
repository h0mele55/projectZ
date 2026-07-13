import { existsSync, readFileSync, globSync } from 'node:fs';

/**
 * STOCKFISH IS GPL-3. IT MUST NOT BECOME PART OF OUR PROGRAM.
 *
 * GPL-3 is a STRONG COPYLEFT licence. If Stockfish is linked into our
 * application, our application is a derivative work and must itself be released
 * under GPL-3 — all of it, source included.
 *
 * `import Stockfish from 'stockfish'` does exactly that: the bundler resolves
 * it, inlines it, and the artefact we ship is one combined work. That is a
 * licence violation and a genuine legal exposure — not a style problem, not a
 * lint warning, and not something to weigh against convenience.
 *
 * The arrangement that keeps them separate:
 *
 *   • the engine is a STATIC FILE in public/engine/, never touched by a bundler;
 *   • it is UNMODIFIED — patching it makes a derivative of Stockfish itself;
 *   • it is loaded at RUNTIME into a Web Worker, by URL, and talked to over
 *     message passing — two programs at arm's length, as Lichess does it;
 *   • the GPL-3 text ships beside it and the UI links to the source, because
 *     GPL-3 requires recipients can actually GET the source.
 *
 * This file makes each of those unmergeable to break.
 *
 * If a test here fails, do not silence it. Talk to somebody. The failure mode
 * is a lawyer's letter, not a broken build.
 */

const SOURCE_FILES = globSync('src/**/*.{ts,tsx}').map((f) => f.toString());

/** Strip comments — this very file's PROSE names the things it forbids. */
function code(source: string): string {
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

    if (line.trim()) out.push(line);
  }

  return out.join('\n');
}

describe('the scan is not vacuous', () => {
  it('found the source tree', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(50);
  });
});

// ── 1. Never imported. This is THE rule. ─────────────────────────────

describe('Stockfish is never linked into our program', () => {
  /**
   * Any form of module resolution. A dynamic `import('stockfish')` is bundled
   * too — it becomes a lazy chunk, which is still our artefact containing their
   * GPL code.
   */
  const IMPORTS_ENGINE =
    /(?:^|\s)import\s[^;]*from\s+['"][^'"]*stockfish[^'"]*['"]|import\s*\(\s*['"][^'"]*stockfish[^'"]*['"]\s*\)|require\s*\(\s*['"][^'"]*stockfish[^'"]*['"]\s*\)/im;

  it('no file in src/ imports, requires, or dynamically imports it', () => {
    const violations: string[] = [];

    for (const file of SOURCE_FILES) {
      const src = code(readFileSync(file, 'utf8'));
      if (IMPORTS_ENGINE.test(src)) violations.push(file);
    }

    if (violations.length > 0) {
      throw new Error(
        `Stockfish is IMPORTED in:\n\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          `\n\n══ THIS IS A GPL-3 LICENCE VIOLATION ══\n\n` +
          `An import puts Stockfish through the bundler, which LINKS it into our\n` +
          `JavaScript. The artefact we ship becomes a single derivative work — and\n` +
          `GPL-3 then requires that our ENTIRE APPLICATION be released under GPL-3,\n` +
          `source and all.\n\n` +
          `The engine must be loaded at RUNTIME from /engine/stockfish.js, into a Web\n` +
          `Worker, as a separate program. See src/lib/chess/engine.ts.\n\n` +
          `Do not silence this test. Talk to somebody.`,
      );
    }
  });

  it('stockfish is not a package dependency', () => {
    // Even an unused dependency is a signal that somebody is about to import it,
    // and `npm ls` in a licence audit would report GPL-3 in our tree.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const offenders = Object.keys(all).filter((name) => /stockfish/i.test(name));

    expect(offenders).toEqual([]);
  });

  it('the engine is referenced only as a URL, never as a module specifier', () => {
    const engine = code(readFileSync('src/lib/chess/engine.ts', 'utf8'));

    // The one sanctioned reference: a path the BROWSER fetches.
    expect(engine).toMatch(/['"]\/engine\/stockfish\.js['"]/);
    // Constructed as a Worker — a separate execution context, message-passing only.
    expect(engine).toMatch(/new Worker\(/);
    // And never resolved by the bundler.
    expect(IMPORTS_ENGINE.test(engine)).toBe(false);
  });
});

// ── 2. Unmodified, and fetched as a standalone artefact ──────────────

describe('the engine ships unmodified, with its licence', () => {
  it('there is a fetch script rather than a dependency', () => {
    expect(existsSync('scripts/fetch-stockfish.sh')).toBe(true);
  });

  it('the fetch script also fetches the GPL-3 text', () => {
    const script = readFileSync('scripts/fetch-stockfish.sh', 'utf8');

    // GPL-3 requires that whoever receives the program receives the licence and
    // can obtain the source. Shipping the engine WITHOUT it is the violation,
    // even though the code itself is unmodified and unbundled.
    expect(script).toMatch(/gpl-3\.0\.txt/);
    expect(script).toMatch(/LICENSE/);
  });

  it('the script REFUSES to leave an engine installed without its licence', () => {
    // A half-installed engine — binary present, licence missing — is worse than
    // no engine: it is a shipped violation that looks like a working feature.
    const script = readFileSync('scripts/fetch-stockfish.sh', 'utf8');

    expect(script).toMatch(/rm -f .*stockfish\.js/);
    expect(script).toMatch(/exit 1/);
  });

  it('the engine binaries are NOT committed to this repository', () => {
    // A GPL-3 binary sitting in a proprietary repo invites exactly the confusion
    // the arms-length arrangement exists to avoid — and a casual reader would
    // reasonably conclude we had vendored it into the product.
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toMatch(/public\/engine\/stockfish\.js/);
    expect(gitignore).toMatch(/public\/engine\/stockfish\.wasm/);
  });

  it('the engine directory documents WHY it is quarantined', () => {
    // The next person to touch this must find out before they act, not after.
    const readme = readFileSync('public/engine/README.md', 'utf8');

    expect(readme).toMatch(/GPL/);
    expect(readme).toMatch(/unmodified/i);
    expect(readme).toMatch(/github\.com\/official-stockfish\/Stockfish/);
  });
});

// ── 3. Attribution is a licence CONDITION, not decoration ────────────

describe('the source link is reachable by a user', () => {
  it('the engine module exposes a source URL and a licence URL', () => {
    const engine = readFileSync('src/lib/chess/engine.ts', 'utf8');

    expect(engine).toMatch(
      /ENGINE_SOURCE_URL\s*=\s*['"]https:\/\/github\.com\/official-stockfish\/Stockfish['"]/,
    );
    expect(engine).toMatch(/ENGINE_LICENSE_URL/);
  });

  it('a UI surface actually renders the attribution', () => {
    // An exported constant nobody displays satisfies nothing. GPL-3 requires
    // that RECIPIENTS can get the source — a link in a file they never see is
    // not a link.
    const rendered = SOURCE_FILES.filter((f) => f.endsWith('.tsx')).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /ENGINE_SOURCE_URL|ENGINE_LICENSE_URL/.test(src);
    });

    if (rendered.length === 0) {
      throw new Error(
        `No component renders the Stockfish attribution.\n\n` +
          `GPL-3 requires that recipients can obtain the source. An exported constant\n` +
          `that nobody displays satisfies nothing — the link has to be somewhere a\n` +
          `USER can find it.\n\n` +
          `Render ENGINE_SOURCE_URL and ENGINE_LICENSE_URL wherever the analysis\n` +
          `feature appears.`,
      );
    }
  });
});

// ── Negative controls ────────────────────────────────────────────────

describe('the rules fire on the code they forbid', () => {
  const IMPORTS_ENGINE =
    /(?:^|\s)import\s[^;]*from\s+['"][^'"]*stockfish[^'"]*['"]|import\s*\(\s*['"][^'"]*stockfish[^'"]*['"]\s*\)|require\s*\(\s*['"][^'"]*stockfish[^'"]*['"]\s*\)/im;

  it.each([
    "import Stockfish from 'stockfish';",
    "import { engine } from 'stockfish.wasm';",
    "const sf = await import('stockfish');",
    "const sf = require('stockfish');",
    "import Engine from '@lichess-org/stockfish.wasm';",
  ])('catches: %s', (bad) => {
    expect(IMPORTS_ENGINE.test(bad)).toBe(true);
  });

  it.each([
    "const ENGINE_URL = '/engine/stockfish.js';",
    'this.worker = new Worker(ENGINE_URL);',
    "import { Chess } from 'chess.js';",
  ])('does NOT flag: %s', (good) => {
    expect(IMPORTS_ENGINE.test(good)).toBe(false);
  });
});
