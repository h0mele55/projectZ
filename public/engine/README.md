# Stockfish — third-party, GPL-3, kept at arm's length

The files in this directory are **not part of playerz.bg**. They are an
unmodified copy of the [Stockfish](https://github.com/official-stockfish/Stockfish)
chess engine, which is licensed under the **GNU General Public License v3**.

## Why they live here rather than in `src/`

GPL-3 is a strong copyleft licence. If Stockfish were compiled or bundled into
our application, our application would become a derivative work and would have
to be released under GPL-3 in its entirety.

So it isn't. The engine is:

- **unbundled** — served as a static file; no bundler ever processes it;
- **unmodified** — fetched byte-for-byte by `scripts/fetch-stockfish.sh`;
- **separate** — loaded at runtime into a Web Worker and communicated with over
  message passing, as one program talks to another;
- **attributed** — the full licence text is in `LICENSE`, and the app links to
  the upstream source, as GPL-3 requires.

`tests/guardrails/gpl-isolation.test.ts` fails the build if anything in `src/`
ever `import`s the engine.

## Source

<https://github.com/official-stockfish/Stockfish>

You are entitled to the complete source of this engine under the terms of the
GPL-3. It is available at the link above, and the licence text is in `LICENSE`.

## These files are not committed

`scripts/fetch-stockfish.sh` downloads them. They are gitignored deliberately:
committing a GPL-3 binary into a proprietary repository invites exactly the
confusion this whole arrangement exists to avoid.
