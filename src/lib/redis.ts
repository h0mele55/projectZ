import Redis from 'ioredis';

/**
 * The Redis client.
 *
 * One connection, reused. Next's dev server re-evaluates modules on every hot
 * reload, and a new Redis connection per reload exhausts the server's client
 * limit within an afternoon — the same reason `prisma.ts` stashes its client on
 * `globalThis`.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

function createClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  return new Redis(url, {
    // Connect on first use rather than at import. A module-level connection
    // fires during the Next build, in every test file that transitively imports
    // this, and in scripts that never touch Redis at all.
    lazyConnect: true,

    // The offline queue must stay ON, and this is not a detail.
    //
    // `lazyConnect` means the FIRST command is what triggers the connection. If
    // the offline queue is off, that first command is rejected outright —
    // "Stream isn't writeable" — because the socket does not exist yet, and
    // nothing else is ever going to create it. The two options are
    // contradictory: together they produce a client that can never issue a
    // single command.
    //
    // With the queue on, the first command waits for the handshake and then
    // runs, which is the behaviour we actually want.
    enableOfflineQueue: true,

    // Which leaves the original worry — a queue that hangs forever against a
    // DEAD server — to be solved properly, by a timeout rather than by
    // disabling the queue.
    //
    // A leaderboard is a nice-to-have. It must never hold a page open. After
    // two seconds we would rather render without it.
    commandTimeout: 2_000,
    maxRetriesPerRequest: 2,
  });
}

export function redis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = createClient();
  }
  return globalForRedis.redis;
}

export async function closeRedis(): Promise<void> {
  const client = globalForRedis.redis;
  if (!client) return;

  // Clear the handle FIRST, so a failure below cannot leave a dead client
  // installed as the shared one — every subsequent caller would get the corpse.
  globalForRedis.redis = undefined;

  try {
    await client.quit();
  } catch {
    // Already closed, or never connected. Closing a closed connection is not an
    // error worth propagating out of a teardown path.
  }
}
