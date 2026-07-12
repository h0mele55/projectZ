/**
 * @jest-environment node
 */
import {
  InvalidTenantIdError,
  NestedTenantContextError,
  runInTenantContext,
} from '@/lib/db/rls-middleware';

/** A PrismaClient stub that records the raw SQL the middleware issues. */
function fakeClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return 1;
    }),
  };
  const client = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client: client as never, tx, calls };
}

const TENANT = 'clx1234567890abcdefghij';

describe('runInTenantContext', () => {
  it('sets app.tenant_id and assumes app_user BEFORE running the callback', async () => {
    const { client, calls } = fakeClient();
    const order: string[] = [];

    await runInTenantContext(
      TENANT,
      async () => {
        order.push('callback');
        return 'ok';
      },
      client,
    );

    // The binding must be established first — a callback that queried
    // before SET LOCAL would run unscoped and see zero rows.
    expect(calls[0]!.sql).toContain("set_config('app.tenant_id', $1, true)");
    expect(calls[0]!.params).toEqual([TENANT]);
    expect(calls[1]!.sql).toContain('SET LOCAL ROLE app_user');
    expect(order).toEqual(['callback']);
  });

  it('passes the tenant id as a BOUND PARAMETER, never interpolated into SQL', async () => {
    const { client, calls } = fakeClient();
    await runInTenantContext(TENANT, async () => null, client);

    // The tenant id must not appear in the SQL text itself.
    expect(calls[0]!.sql).not.toContain(TENANT);
    expect(calls[0]!.params).toContain(TENANT);
  });

  it('rejects a malformed tenant id BEFORE touching the database', async () => {
    const { client, calls } = fakeClient();

    await expect(
      runInTenantContext("'; DROP TABLE venue_org; --", async () => null, client),
    ).rejects.toThrow(InvalidTenantIdError);

    // The point: not one statement was issued. The guard fires before the
    // client is touched at all.
    expect(calls).toHaveLength(0);
  });

  it('does not RESET the binding on error — SET LOCAL is transaction-scoped', async () => {
    const { client, calls } = fakeClient();

    await expect(
      runInTenantContext(
        TENANT,
        async () => {
          throw new Error('boom');
        },
        client,
      ),
    ).rejects.toThrow('boom');

    // SET LOCAL / set_config(..., true) are released when the transaction
    // ends — commit OR rollback. An explicit RESET would be dead code that
    // implies a leak is possible.
    const sql = calls.map((c) => c.sql).join(' ');
    expect(sql).not.toMatch(/RESET|SET ROLE NONE/i);
  });

  it('refuses to nest into a DIFFERENT tenant', async () => {
    const { client } = fakeClient();

    await expect(
      runInTenantContext(
        TENANT,
        async () =>
          // Silently re-binding halfway through a request would widen or
          // narrow the tenant scope invisibly.
          runInTenantContext('clzzzzzzzzzzzzzzzzzzzz', async () => null, client),
        client,
      ),
    ).rejects.toThrow(NestedTenantContextError);
  });
});
