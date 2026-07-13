import { readFileSync, existsSync, globSync } from 'node:fs';

/**
 * HEALTH CHECKS, METRICS, AND THE WAYS THEY CAUSE OUTAGES.
 *
 * ═══ 1. LIVENESS MUST NOT TOUCH THE DATABASE ═══
 *
 * Liveness answers "is this process alive?". Readiness answers "can this pod
 * serve a request?".
 *
 * Put a database check in LIVENESS and a thirty-second Postgres blip makes the
 * orchestrator kill EVERY pod at once — including the ones that were perfectly
 * fine. The database recovers; there is now nothing left to serve from. A
 * degraded dependency has become a hard outage, and the restart storm makes the
 * database's own recovery slower.
 *
 * This is one of the most common and most expensive mistakes in production
 * Kubernetes, and it is invisible until the day it isn't.
 *
 * ═══ 2. READINESS MUST TOUCH THE DATABASE ═══
 *
 * The opposite error. A pod that cannot reach Postgres keeps receiving traffic
 * and 500ing at users, because as far as the load balancer knows it is healthy.
 *
 * ═══ 3. THE METRICS ENDPOINT IS NOT PUBLIC ═══
 *
 * It is an intelligence briefing: our booking volume by sport in real time, our
 * payment failure rate, our route list, our memory ceiling. And a scrape
 * serialises every series in the registry, so an open one is a DoS surface.
 *
 * ═══ 4. NO UNBOUNDED METRIC LABELS ═══
 *
 * Every distinct label combination is a time series Prometheus keeps forever. A
 * user id or a booking id as a label is a new series per value — a hundred
 * thousand users is a hundred thousand series, and Prometheus falls over. It
 * fails GRADUALLY, which is why nobody catches it in review.
 */

/** Strip comments — this file's own prose names the things it forbids. */
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

const LIVENESS = 'src/app/api/health/route.ts';
const READINESS = 'src/app/api/ready/route.ts';
const METRICS = 'src/app/api/metrics/route.ts';

describe('liveness never touches a dependency', () => {
  it('the liveness route exists', () => {
    expect(existsSync(LIVENESS)).toBe(true);
  });

  it('it does NOT query the database', () => {
    const src = code(readFileSync(LIVENESS, 'utf8'));

    const TOUCHES_DB = /prisma|\bdb\.|\$queryRaw|PrismaClient/;

    if (TOUCHES_DB.test(src)) {
      throw new Error(
        `The LIVENESS probe (${LIVENESS}) touches the database.\n\n` +
          `A thirty-second Postgres blip will now make the orchestrator kill EVERY pod\n` +
          `at once — including the ones that were fine. The database comes back and there\n` +
          `is nothing left to serve from: a degraded dependency has become a hard outage,\n` +
          `and the restart storm makes the database's recovery slower.\n\n` +
          `Dependency checks belong in READINESS (${READINESS}).`,
      );
    }
  });

  it('it does not touch Redis or any other dependency either', () => {
    const src = code(readFileSync(LIVENESS, 'utf8'));

    expect(src).not.toMatch(/redis|ioredis|meilisearch|fetch\(/i);
  });
});

describe('readiness DOES check its dependencies', () => {
  it('the readiness route exists', () => {
    // Without it, a pod that cannot reach Postgres keeps taking traffic and
    // 500ing at users, because the load balancer thinks it is healthy.
    expect(existsSync(READINESS)).toBe(true);
  });

  it('it checks Postgres AND Redis', () => {
    const src = code(readFileSync(READINESS, 'utf8'));

    expect(src).toMatch(/prisma|\$queryRaw/);
    expect(src).toMatch(/redis/i);
  });

  it('it returns 503 when not ready — not a 200 with a sad message', () => {
    // Every orchestrator on earth reads the STATUS CODE. A 200 carrying
    // `{"status":"not_ready"}` is a health check that nothing acts on, and the
    // pod stays in rotation serving errors.
    const src = code(readFileSync(READINESS, 'utf8'));

    expect(src).toMatch(/503/);
  });

  it('the dependency checks are BOUNDED by a timeout', () => {
    // Without one, a hung database means the readiness probe itself hangs, and
    // the orchestrator cannot tell "slow" from "dead".
    const src = code(readFileSync(READINESS, 'utf8'));

    expect(src).toMatch(/setTimeout|AbortSignal\.timeout|Promise\.race/);
  });
});

describe('the metrics endpoint is not public', () => {
  it('the metrics route exists', () => {
    expect(existsSync(METRICS)).toBe(true);
  });

  it('it requires a token', () => {
    const src = code(readFileSync(METRICS, 'utf8'));

    expect(src).toMatch(/METRICS_TOKEN/);
    expect(src).toMatch(/authorization/i);
  });

  it('it compares the token in CONSTANT TIME', () => {
    // `a === b` on a secret leaks its length and prefix through timing — a real
    // attack on a token you can guess a character at a time.
    const src = code(readFileSync(METRICS, 'utf8'));

    expect(src).toMatch(/timingSafeEqual/);
  });

  it('a MISSING token closes the endpoint rather than opening it', () => {
    // The failure mode of a forgotten environment variable must never be
    // "no security". Forgetting METRICS_TOKEN in production must not silently
    // publish our booking volume to the internet.
    const src = code(readFileSync(METRICS, 'utf8'));

    // The `!expected` branch must return, not fall through to serving.
    expect(src).toMatch(/if \(!expected\)[\s\S]{0,120}(?:404|401|403)/);
  });
});

describe('no metric carries an unbounded label', () => {
  const METRIC_FILES = globSync('src/lib/observability/*.ts').map((f) => f.toString());

  it('the scan found the metric definitions', () => {
    expect(METRIC_FILES.length).toBeGreaterThan(0);
  });

  it('no labelNames includes an id-shaped label', () => {
    // Every distinct label combination is a series Prometheus keeps FOREVER. A
    // user id is a new series per user. It fails gradually: memory creeps,
    // queries slow, and the retention is unusable before anyone notices.
    const UNBOUNDED =
      /\b(userId|user_id|bookingId|booking_id|venueId|venue_id|tenantId|tenant_id|email|ip|sessionId|session_id|path|url)\b/;

    const violations: string[] = [];

    for (const file of METRIC_FILES) {
      const src = code(readFileSync(file, 'utf8'));

      // Look inside every labelNames: [...] array.
      const labelArrays = src.matchAll(/labelNames:\s*\[([^\]]*)\]/g);

      for (const match of labelArrays) {
        const labels = match[1]!;
        if (UNBOUNDED.test(labels)) {
          violations.push(`${file}: labelNames: [${labels.trim()}]`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Unbounded metric label(s):\n\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          `\n\nEvery distinct combination of label values is a time series Prometheus stores\n` +
          `FOREVER. An id label creates a new series per id — a hundred thousand users is a\n` +
          `hundred thousand series, and Prometheus falls over.\n\n` +
          `It fails GRADUALLY, which is why nobody catches it in review: memory creeps,\n` +
          `queries get slow, and by the time anyone looks, the retention is unusable.\n\n` +
          `Use a bounded label — a sport (16 values), a status (5), a normalised ROUTE\n` +
          `TEMPLATE (/api/bookings/[id], not /api/bookings/abc123).`,
      );
    }
  });
});

// ── Negative controls ────────────────────────────────────────────────

describe('the rules fire on the code they forbid', () => {
  it('detects a database call in a route', () => {
    const TOUCHES_DB = /prisma|\bdb\.|\$queryRaw|PrismaClient/;

    expect(TOUCHES_DB.test('await prisma.$queryRaw`SELECT 1`;')).toBe(true);
    expect(TOUCHES_DB.test('await db.booking.count();')).toBe(true);
    expect(TOUCHES_DB.test("return NextResponse.json({ status: 'ok' });")).toBe(false);
  });

  it('detects an unbounded label', () => {
    const UNBOUNDED =
      /\b(userId|user_id|bookingId|booking_id|venueId|venue_id|tenantId|tenant_id|email|ip|sessionId|session_id|path|url)\b/;

    expect(UNBOUNDED.test("'sport', 'userId'")).toBe(true);
    expect(UNBOUNDED.test("'method', 'path'")).toBe(true);
    expect(UNBOUNDED.test("'method', 'route', 'status'")).toBe(false);
    expect(UNBOUNDED.test("'sport'")).toBe(false);
  });
});
