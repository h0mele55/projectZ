import { readFileSync } from 'node:fs';

import { INDEXED_MODELS, INDEXES } from '@/lib/search/indexes';

/**
 * SEARCH SYNC COVERAGE RATCHET.
 *
 * Adding a searchable model without wiring its sync is the quietest bug in
 * this file's neighbourhood: search still works, it just returns STALE data
 * forever. A venue renames itself and search shows the old name; a session
 * fills up and search still offers it; a venue closes and players keep
 * clicking through to a 404.
 *
 * Nothing throws. Nothing fails. The index simply drifts, and the only signal
 * is a slow trickle of "search is wrong" complaints that nobody can reproduce
 * because the DATABASE is correct.
 *
 * So: every index declared in `indexes.ts` must have a sync function that
 * actually writes to it.
 */
describe('search index sync coverage', () => {
  const sync = readFileSync('src/lib/search/sync.ts', 'utf8');

  it('the scan found the sync module', () => {
    expect(sync.length).toBeGreaterThan(100);
  });

  it.each(Object.keys(INDEXES))('index "%s" has a sync path that writes to it', (name) => {
    // The sync module must reference the index by its INDEXES key — a string
    // literal would drift from the definition without failing.
    const referenced = new RegExp(`INDEXES\\.${name}\\.uid`).test(sync);

    if (!referenced) {
      throw new Error(
        `Index "${name}" is declared in indexes.ts but nothing in sync.ts writes to it.\n\n` +
          `Search will still WORK — it will just return stale data forever. A venue renames\n` +
          `itself and search shows the old name; a session fills and search still offers it;\n` +
          `a venue closes and players click through to a 404. Nothing throws.\n\n` +
          `Fix: add a sync function for ${INDEXED_MODELS[name as keyof typeof INDEXED_MODELS]} ` +
          `in src/lib/search/sync.ts.`,
      );
    }

    expect(referenced).toBe(true);
  });

  it('every index has a model it maps from', () => {
    expect(Object.keys(INDEXED_MODELS).sort()).toEqual(Object.keys(INDEXES).sort());
  });

  it('reindexAll exists — a cache you cannot rebuild is a liability', () => {
    expect(sync).toMatch(/export async function reindexAll/);
  });
});
