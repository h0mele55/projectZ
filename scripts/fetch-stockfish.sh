#!/usr/bin/env bash
#
# Fetch the UNMODIFIED Stockfish engine into public/engine/.
#
# ═══ WHY THIS IS A SCRIPT AND NOT AN npm DEPENDENCY ═══
#
# Stockfish is GPL-3 — a strong copyleft licence. If it becomes part of our
# program, our entire program must be released under GPL-3.
#
# `npm install stockfish` followed by `import` puts it through the bundler,
# which LINKS it into our JavaScript. The output is one derivative work, and we
# distribute it. That is a licence violation, and a real legal exposure.
#
# So the engine is fetched as a standalone artefact, byte-for-byte unmodified,
# served as a static file, and loaded at RUNTIME into a Web Worker — a separate
# execution context we talk to over message passing. That is the arrangement
# Lichess uses, and it is what keeps the two programs separate.
#
# DO NOT "simplify" this into a dependency. See src/lib/chess/engine.ts.
set -euo pipefail

VERSION="16.1"
BASE="https://github.com/lichess-org/stockfish.wasm/releases/download/v${VERSION}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/engine"

mkdir -p "$DEST"

echo "Fetching Stockfish ${VERSION} (unmodified) into ${DEST}"

for file in stockfish.js stockfish.wasm; do
  echo "  → ${file}"
  curl -fsSL "${BASE}/${file}" -o "${DEST}/${file}"
done

# The GPL-3 text ships WITH the binary. This is not a nicety: GPL-3 requires that
# whoever receives the program also receives the licence and can obtain the
# source. Shipping the engine without it is the violation, even though the code
# is unmodified and unbundled.
echo "  → LICENSE (GPL-3)"
curl -fsSL "https://www.gnu.org/licenses/gpl-3.0.txt" -o "${DEST}/LICENSE"

# Refuse to leave a half-installed engine behind. An engine present WITHOUT its
# licence is worse than no engine at all — it is a shipped violation.
if [ ! -s "${DEST}/LICENSE" ]; then
  echo "ERROR: could not fetch the GPL-3 licence text." >&2
  echo "Removing the engine rather than shipping it unlicensed." >&2
  rm -f "${DEST}/stockfish.js" "${DEST}/stockfish.wasm"
  exit 1
fi

# The checksums pin us to the exact official build. A mismatch means the artefact
# is not the one we reviewed — either upstream re-cut the release, or something
# is wrong. Either way we do not ship it.
if [ -f "${DEST}/SHA256SUMS" ]; then
  echo "Verifying checksums…"
  (cd "$DEST" && sha256sum -c SHA256SUMS)
else
  echo "WARNING: no SHA256SUMS present — record them before shipping."
  (cd "$DEST" && sha256sum stockfish.js stockfish.wasm)
fi

echo "Done. The engine is served from /engine/stockfish.js and is NEVER imported."
