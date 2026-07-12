import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

/**
 * INDEX COVERAGE RATCHET.
 *
 * A missing index is invisible until it isn't. The seed database has three
 * venues and every query is instant; production has fifty thousand bookings
 * and the same query is a sequential scan that takes the site down. Nothing
 * in the type system, the tests, or code review catches it — the code is
 * *correct*, just catastrophically slow.
 *
 * So the schema itself is the thing under test:
 *
 *   Layer A — every `tenantId` must LEAD an index. Every tenant-scoped
 *             query filters on it (RLS adds the predicate whether you
 *             wrote it or not), so a tenantId that is only the second
 *             column of a composite index is not usable for that filter.
 *
 *   Layer B — every foreign key must be indexed. Postgres does NOT create
 *             an index for a FK automatically (unlike MySQL). Without one,
 *             every `ON DELETE CASCADE` scans the child table, and every
 *             join through it is a nested loop over a seq scan.
 *
 *   Layer C — curated indexes for known list queries. Populated as P08+
 *             adds real findMany call sites.
 */

interface Model {
  name: string;
  fields: Map<string, string>; // field -> type
  relations: Array<{ field: string; fkFields: string[] }>;
  indexes: string[][];
  uniques: string[][];
  idField?: string;
}

function parseModels(): Model[] {
  const models: Model[] = [];

  for (const file of globSync('prisma/schema/*.prisma')) {
    const src = readFileSync(file.toString(), 'utf8');
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m: RegExpExecArray | null;

    while ((m = re.exec(src)) !== null) {
      const [, name, body] = m;
      const model: Model = {
        name: name!,
        fields: new Map(),
        relations: [],
        indexes: [],
        uniques: [],
      };

      for (const raw of body!.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//') || line.startsWith('///')) continue;

        // @@index([a, b]) / @@unique([a, b]) / @@id([a, b])
        const idx = line.match(/@@index\(\[([^\]]+)\]/);
        if (idx) {
          model.indexes.push(idx[1]!.split(',').map((s) => s.trim()));
          continue;
        }
        const uniq = line.match(/@@unique\(\[([^\]]+)\]/);
        if (uniq) {
          model.uniques.push(uniq[1]!.split(',').map((s) => s.trim()));
          continue;
        }
        // A composite primary key IS a btree index, leading on its first
        // column. Missing this would report a false "unindexed FK" on every
        // join table.
        const compositeId = line.match(/@@id\(\[([^\]]+)\]/);
        if (compositeId) {
          model.uniques.push(compositeId[1]!.split(',').map((s) => s.trim()));
          continue;
        }
        if (line.startsWith('@@')) continue;

        // field  Type  @attrs…
        const parts = line.split(/\s+/);
        const field = parts[0]!;
        const type = parts[1] ?? '';
        model.fields.set(field, type);

        if (line.includes('@id')) model.idField = field;

        // A FIELD-level `@unique` creates a single-column unique index —
        // just as real as an `@@unique([field])`. Treating only the block
        // form as an index reports false misses on `bookingId String @unique`.
        if (/\s@unique\b/.test(line)) model.uniques.push([field]);

        // @relation(fields: [courtId], references: [id])
        const rel = line.match(/@relation\([^)]*fields:\s*\[([^\]]+)\]/);
        if (rel) {
          model.relations.push({
            field,
            fkFields: rel[1]!.split(',').map((s) => s.trim()),
          });
        }
      }

      models.push(model);
    }
  }

  return models;
}

/** An index or unique whose FIRST column is `field`. */
function isIndexLeading(model: Model, field: string): boolean {
  const leads = (cols: string[][]) => cols.some((c) => c[0] === field);
  return leads(model.indexes) || leads(model.uniques) || model.idField === field;
}

/** `field` appears anywhere in some index — enough for a FK join. */
function isIndexed(model: Model, field: string): boolean {
  const inAny = (cols: string[][]) => cols.some((c) => c.includes(field));
  return inAny(model.indexes) || inAny(model.uniques) || model.idField === field;
}

const models = parseModels();

describe('schema index coverage', () => {
  it('the parser actually found the schema (a silent no-op would pass everything)', () => {
    expect(models.length).toBeGreaterThanOrEqual(25);
    expect(models.map((m) => m.name)).toEqual(
      expect.arrayContaining(['Booking', 'Court', 'Venue', 'Payment']),
    );
  });

  // ── Layer A ───────────────────────────────────────────────────────
  const tenantScoped = models.filter((m) => m.fields.has('tenantId'));

  it('found the tenant-scoped models', () => {
    expect(tenantScoped.length).toBeGreaterThanOrEqual(20);
  });

  it.each(tenantScoped.map((m) => [m.name] as const))(
    'A: %s — tenantId LEADS at least one index',
    (name) => {
      const model = models.find((m) => m.name === name)!;
      // RLS adds `tenantId = …` to every query on this table whether the
      // caller wrote it or not. A tenantId sitting second in a composite
      // index cannot serve that predicate.
      expect(isIndexLeading(model, 'tenantId')).toBe(true);
    },
  );

  // ── Layer B ───────────────────────────────────────────────────────
  const fkPairs = models.flatMap((m) =>
    m.relations.flatMap((r) => r.fkFields.map((f) => [m.name, f] as const)),
  );

  it('found the foreign keys', () => {
    expect(fkPairs.length).toBeGreaterThanOrEqual(20);
  });

  it.each(fkPairs)('B: %s.%s — the foreign key is indexed', (modelName, fk) => {
    const model = models.find((m) => m.name === modelName)!;
    // Postgres does NOT auto-index a FK. Without one, ON DELETE CASCADE
    // seq-scans the child table and every join through it is a nested loop.
    expect(isIndexed(model, fk)).toBe(true);
  });

  // ── Layer C ───────────────────────────────────────────────────────
  //
  // Curated composite indexes for the list queries P08 will actually run.
  // Declared BEFORE the queries exist so the index lands with the schema,
  // not after the first slow-query alert.
  const LIST_QUERY_INDEXES: Array<{ model: string; index: string[]; why: string }> = [
    {
      model: 'Venue',
      index: ['city', 'country', 'status'],
      why: 'public venue search filters city + country and hides inactive venues',
    },
    {
      model: 'Court',
      index: ['tenantId', 'venueId', 'sport', 'status'],
      why: 'the court list on a venue page filters by sport',
    },
    {
      model: 'Booking',
      index: ['tenantId', 'courtId', 'startTs'],
      why: 'availability lookup — the hottest read in the product',
    },
    {
      model: 'CourtAvailability',
      index: ['courtId', 'dayOfWeek'],
      why: 'opening-hours lookup while computing slots',
    },
  ];

  it.each(LIST_QUERY_INDEXES.map((e) => [e.model, e.index.join(' + '), e.why] as const))(
    'C: %s has an index on [%s] — %s',
    (modelName, _cols, _why) => {
      const entry = LIST_QUERY_INDEXES.find((e) => e.model === modelName)!;
      const model = models.find((m) => m.name === modelName)!;

      const present = [...model.indexes, ...model.uniques].some(
        (cols) =>
          cols.length >= entry.index.length && entry.index.every((col, i) => cols[i] === col),
      );

      expect(present).toBe(true);
    },
  );
});
