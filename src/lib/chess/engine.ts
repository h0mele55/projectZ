/**
 * STOCKFISH — GPL-3, AND THEREFORE QUARANTINED.
 *
 * ═══ READ THIS BEFORE YOU TOUCH ANYTHING IN THIS FILE ═══
 *
 * Stockfish is licensed under the GNU General Public License v3. GPL-3 is a
 * STRONG COPYLEFT licence: if Stockfish becomes part of our program, our
 * program must be released under GPL-3 too — the entire application, source
 * and all.
 *
 * That is not a theoretical risk. `import Stockfish from 'stockfish'` puts it
 * through our bundler, which links it into our JavaScript. The output is a
 * single derivative work, and we would be distributing it. This is a licence
 * violation and a real legal exposure, not a lint warning.
 *
 * ─── So it is NEVER imported. ────────────────────────────────────────
 *
 * The engine is:
 *
 *   • UNBUNDLED — it lives in `public/engine/`, served as a static file. No
 *     bundler ever sees it. There is no `import` of it anywhere in `src/`, and
 *     a ratchet (tests/guardrails/gpl-isolation.test.ts) fails the build if one
 *     ever appears.
 *
 *   • UNMODIFIED — we ship the official release byte-for-byte, fetched by
 *     `scripts/fetch-stockfish.sh` against a pinned checksum. Modifying it would
 *     create a derivative work of Stockfish itself, which triggers obligations
 *     even in a separate file.
 *
 *   • SEPARATE — loaded into a Web Worker by URL at RUNTIME. The Worker is a
 *     distinct execution context that we talk to over message passing, exactly
 *     as one program talks to another. This is the same arrangement Lichess
 *     uses, and it is the arrangement the "separate programs communicating at
 *     arm's length" reading of the GPL depends on.
 *
 *   • ATTRIBUTED — the GPL-3 text ships beside it in `public/engine/LICENSE`,
 *     and the UI carries a visible link to the source. GPL-3 requires that
 *     recipients can GET the source; a link that nobody can find does not
 *     satisfy that.
 *
 * ─── If you are about to… ────────────────────────────────────────────
 *
 *   …`npm install stockfish` and import it — STOP. That is the violation.
 *   …copy the engine into src/ so the bundler can "optimise" it — STOP.
 *   …patch the engine to add a feature — STOP. Now it is a derivative work.
 *   …remove the source link because it clutters the footer — STOP. It is a
 *     licence condition, not decoration.
 *
 * Talk to somebody first. A mistake here is a legal problem, not a bug.
 */

/** Where the unmodified engine is served from. NOT an import specifier. */
export const ENGINE_URL = '/engine/stockfish.js';

/** Shown in the UI. GPL-3 requires recipients be able to obtain the source. */
export const ENGINE_SOURCE_URL = 'https://github.com/official-stockfish/Stockfish';
export const ENGINE_LICENSE_URL = '/engine/LICENSE';
export const ENGINE_NAME = 'Stockfish';

export interface Evaluation {
  /** Centipawns, from the side-to-move's perspective. */
  scoreCp: number | null;
  /** Mate in N. Positive = side to move mates. */
  mateIn: number | null;
  bestMove: string | null;
  depth: number;
}

export class EngineUnavailableError extends Error {
  readonly code = 'engine_unavailable';
  constructor(cause: string) {
    super(
      `The analysis engine is unavailable: ${cause}. ` +
        `It is served from ${ENGINE_URL} — run scripts/fetch-stockfish.sh.`,
    );
    this.name = 'EngineUnavailableError';
  }
}

/**
 * A handle on the engine, running in its own Worker.
 *
 * Browser-only by construction: `Worker` does not exist on the server, and the
 * engine must never be pulled into a server bundle.
 */
export class ChessEngine {
  private worker: Worker | null = null;

  /**
   * `new Worker(url)` — a RUNTIME fetch of a static file. This is the whole
   * isolation boundary, in one line.
   *
   * Note what it is NOT: it is not `import('stockfish')`, which the bundler
   * would resolve and inline. The string is a URL, the browser fetches it, and
   * the engine runs in a context we only ever talk to over `postMessage`.
   */
  async start(): Promise<void> {
    if (typeof Worker === 'undefined') {
      throw new EngineUnavailableError('no Worker (this is browser-only)');
    }

    try {
      this.worker = new Worker(ENGINE_URL);
    } catch (e) {
      throw new EngineUnavailableError(e instanceof Error ? e.message : 'failed to load');
    }

    await this.send('uci', (line) => line.startsWith('uciok'));
    await this.send('isready', (line) => line.startsWith('readyok'));
  }

  /** Send a UCI command and resolve when `done` matches a reply. */
  private send(
    command: string,
    done: (line: string) => boolean,
    onLine?: (line: string) => void,
    timeoutMs = 10_000,
  ): Promise<string[]> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new EngineUnavailableError('not started'));

    return new Promise((resolve, reject) => {
      const lines: string[] = [];

      // An engine that never answers must not hold the tab forever. A stuck
      // analysis panel is a bug; a stuck promise is a leak.
      const timer = setTimeout(() => {
        worker.removeEventListener('message', listener);
        reject(new EngineUnavailableError(`timed out waiting for a reply to "${command}"`));
      }, timeoutMs);

      const listener = (e: MessageEvent) => {
        const line = String(e.data);
        lines.push(line);
        onLine?.(line);

        if (done(line)) {
          clearTimeout(timer);
          worker.removeEventListener('message', listener);
          resolve(lines);
        }
      };

      worker.addEventListener('message', listener);
      worker.postMessage(command);
    });
  }

  /**
   * Evaluate a position.
   *
   * `depth` is capped. An uncapped depth on a phone pins the CPU until the tab
   * is killed — and the person who set it to 30 was testing on a laptop.
   */
  async evaluate(fen: string, opts: { depth?: number } = {}): Promise<Evaluation> {
    const depth = Math.min(Math.max(opts.depth ?? 15, 1), 22);

    let scoreCp: number | null = null;
    let mateIn: number | null = null;
    let reachedDepth = 0;

    const lines = await this.send(
      `position fen ${fen}\ngo depth ${depth}`,
      (line) => line.startsWith('bestmove'),
      (line) => {
        const mate = /score mate (-?\d+)/.exec(line);
        if (mate) {
          mateIn = Number(mate[1]);
          // A forced mate makes the centipawn score meaningless — "+9999" is
          // not an evaluation, it is a placeholder that a chart would plot.
          scoreCp = null;
        }

        const cp = /score cp (-?\d+)/.exec(line);
        if (cp && mateIn === null) scoreCp = Number(cp[1]);

        const d = /\bdepth (\d+)/.exec(line);
        if (d) reachedDepth = Math.max(reachedDepth, Number(d[1]));
      },
      30_000,
    );

    const best = lines.find((l) => l.startsWith('bestmove'));
    const bestMove = best?.split(/\s+/)[1] ?? null;

    return {
      scoreCp,
      mateIn,
      // Stockfish says "bestmove (none)" in a terminal position. That is not a
      // move, and rendering it as one puts "(none)" on the board.
      bestMove: bestMove && bestMove !== '(none)' ? bestMove : null,
      depth: reachedDepth,
    };
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
