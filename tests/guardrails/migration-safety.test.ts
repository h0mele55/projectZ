import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * MIGRATION SAFETY RATCHET.
 *
 * Every load-bearing guarantee in this product lives in a database object
 * Prisma CANNOT MODEL:
 *
 *   booking_no_overlap   — an EXCLUDE constraint. The ONLY thing that makes
 *                          double-booking impossible under concurrency.
 *   venue.geog           — a PostGIS geography column.
 *   venue_geog_idx       — a GiST index. Without it, "venues near me" is a
 *                          sequential scan.
 *   ledger_append_only   — the trigger that makes the wallet a ledger rather
 *                          than a mutable number.
 *
 * And `prisma migrate diff --from-config-datasource` compares the LIVE
 * DATABASE to the schema, so **anything Prisma cannot model looks like drift
 * to be removed**.
 *
 * This has now happened THREE times:
 *
 *   P13 — proposed `ALTER TABLE booking DROP COLUMN "courtId"`, which would
 *         have taken `booking_no_overlap` with it.
 *   P15 — the migration for CHAT proposed dropping `venue.geog` and
 *         `venue_geog_idx`, silently deleting the GEO feature added one
 *         prompt earlier.
 *   P16 — proposed dropping `venue_geog_idx` again.
 *
 * Each diff looks entirely routine. Relying on a human to read every generated
 * migration is exactly the control that fails on the busy day.
 *
 * So: a migration may not DROP a protected object unless it recreates it in
 * the same file.
 */

interface Protected {
  name: string;
  /** Matches a statement that DESTROYS it. */
  drop: RegExp;
  /** Matches a statement that RECREATES it — a rename or rebuild is fine. */
  recreate: RegExp;
  why: string;
}

const PROTECTED: Protected[] = [
  {
    name: 'booking_no_overlap (EXCLUDE constraint)',
    drop: /(?:DROP\s+CONSTRAINT\s+"?booking_no_overlap|ALTER TABLE\s+"?booking"?\s+DROP COLUMN\s+"?(?:resourceId|startTs|endTs|status)"?)/i,
    recreate: /ADD CONSTRAINT\s+booking_no_overlap|RENAME COLUMN/i,
    why: 'the ONLY defence against double-booking under concurrency',
  },
  {
    name: 'coach_no_overlap (EXCLUDE constraint)',
    drop: /DROP\s+CONSTRAINT\s+"?coach_no_overlap/i,
    recreate: /ADD CONSTRAINT\s+coach_no_overlap/i,
    why: 'a coach cannot be in two places at once',
  },
  {
    name: 'venue.geog (PostGIS column)',
    drop: /ALTER TABLE\s+"?venue"?\s+DROP COLUMN\s+"?geog"?/i,
    recreate: /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?geog/i,
    why: '"venues near me" stops working entirely',
  },
  {
    name: 'venue_geog_idx (GiST index)',
    drop: /DROP INDEX\s+(?:IF EXISTS\s+)?"?venue_geog_idx"?/i,
    recreate: /CREATE INDEX\s+(?:IF NOT EXISTS\s+)?"?venue_geog_idx"?/i,
    why: 'geo search degrades to a sequential scan over every venue',
  },
  {
    name: 'ledger append-only trigger',
    drop: /DROP TRIGGER\s+(?:IF EXISTS\s+)?"?ledger_append_only/i,
    recreate: /CREATE TRIGGER\s+"?ledger_append_only/i,
    why: 'a wallet you can UPDATE is not a ledger, it is a mutable number',
  },
];

/** A DROP inside a comment is documentation, not a statement. */
function executableLines(sql: string): string[] {
  const out: string[] = [];
  let inBlock = false;

  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('--')) continue;
    out.push(line);
  }

  return out;
}

describe('migration safety', () => {
  const migrations = globSync('prisma/migrations/**/migration.sql').map((f) => f.toString());

  it('the scan found the migration history', () => {
    // A broken glob makes the whole ratchet vacuous.
    expect(migrations.length).toBeGreaterThanOrEqual(5);
  });

  it.each(migrations)('%s does not destroy a protected object', (file) => {
    const sql = readFileSync(file, 'utf8');
    const body = executableLines(sql).join('\n');

    for (const p of PROTECTED) {
      if (!p.drop.test(body)) continue;
      if (p.recreate.test(body)) continue; // dropped AND rebuilt — fine

      throw new Error(
        `${file} destroys ${p.name} and does not recreate it.\n\n` +
          `  Why that matters: ${p.why}.\n\n` +
          `Prisma CANNOT MODEL this object, so \`migrate diff\` sees it in the live\n` +
          `database, does not find it in the schema, and proposes removing it. The diff\n` +
          `looks routine. This has already happened three times (P13, P15, P16).\n\n` +
          `If the change is intentional, recreate the object in the same migration.\n` +
          `If it is not — and it almost certainly is not — delete the statement.`,
      );
    }
  });

  it('the protected objects still exist in the final schema', () => {
    // The ratchet above catches a DROP. This catches the object never having
    // been created at all — e.g. a migration folder deleted by hand.
    const all = migrations.map((f) => readFileSync(f, 'utf8')).join('\n');

    expect(all).toMatch(/ADD CONSTRAINT\s+booking_no_overlap/i);
    expect(all).toMatch(/ADD CONSTRAINT\s+coach_no_overlap/i);
    expect(all).toMatch(/CREATE INDEX\s+(?:IF NOT EXISTS\s+)?"?venue_geog_idx"?/i);
  });
});
