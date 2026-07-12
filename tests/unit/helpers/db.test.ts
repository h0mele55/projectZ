/**
 * @jest-environment node
 *
 * Node, not jsdom: this exercises the Stripe SDK (needs global fetch),
 * MSW's interceptors (need TextEncoder) and Prisma — none of which jsdom
 * provides.
 */
import { tableNames } from '../../helpers/db';

/**
 * `resetDatabase()` introspects the model list from Prisma's runtime data
 * model rather than hard-coding table names. If that contract ever breaks,
 * reset would silently truncate NOTHING and every integration test would
 * start leaking rows into the next — a failure mode that produces
 * mysterious, order-dependent flakes rather than a clean error.
 *
 * These assert the introspection itself, without needing a live database.
 */
describe('table introspection', () => {
  it('enumerates the physical table names from the Prisma data model', () => {
    const tables = tableNames();

    // @@map names, not model names — TRUNCATE needs the physical table.
    expect(tables).toEqual(expect.arrayContaining(['venue_org', 'app_user', 'tenant_membership']));
  });

  it('picks up every model in the schema (so new models are auto-truncated)', () => {
    const tables = tableNames();
    // P04/P05 add more. The point is that the list is derived, never typed
    // out by hand, so a new model cannot be forgotten.
    expect(tables.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tables).size).toBe(tables.length); // no duplicates
  });
});
