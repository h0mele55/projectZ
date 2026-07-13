import type { PrismaClient } from '@prisma/client';

import {
  NoProofOfVisitError,
  createReview,
  recomputeVenueRating,
  reportContent,
  resolveCase,
} from '@/app-layer/usecases/reviews';
import { pgErrorCode } from '@/lib/db/pg-errors';

import { prismaTestClient, seedTenant, type SeededTenant } from '../helpers/db';
import { setModerationScores, useMswServer } from '../helpers/msw';
import { asAppSuperuser } from '../helpers/rls';

/**
 * Reviews and moderation.
 *
 * The OpenAI classifier is MSW-mocked (per the agreed plan; real keys come
 * after the roadmap). So these tests prove our POLICY and our DATABASE, not
 * OpenAI's accuracy on Bulgarian — that can only be established by running real
 * Bulgarian text through the real model.
 *
 * What they do prove is the part that is ours to get wrong: that an unverified
 * stranger cannot review a venue, that nothing is visible before it is
 * moderated, and that a classifier outage queues rather than publishes.
 */

const HOUR = 3_600_000;

let db: PrismaClient;
let tenant: SeededTenant;
let venueId: string;
let otherUserId: string;

useMswServer();

beforeAll(() => {
  db = prismaTestClient();
});

beforeEach(async () => {
  tenant = await seedTenant();

  const seeded = await asAppSuperuser(db, async (tx) => {
    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Court Complex',
        slug: `venue-${Math.random().toString(36).slice(2, 10)}`,
        city: 'Sofia',
        addressLine: '1 Vitosha Blvd',
        lat: 42.6977,
        lng: 23.3219,
        email: 'v@playerz.test',
      },
    });

    const stranger = await tx.user.create({
      data: { email: `stranger-${Math.random().toString(36).slice(2, 8)}@playerz.test` },
    });

    return { venueId: venue.id, otherUserId: stranger.id };
  });

  venueId = seeded.venueId;
  otherUserId = seeded.otherUserId;
});

/** A booking, in whatever state the test needs. */
async function seedBooking(
  opts: {
    userId?: string;
    status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    atVenueId?: string;
  } = {},
) {
  return asAppSuperuser(db, async (tx) => {
    const resource = await tx.resource.create({
      data: {
        tenantId: tenant.tenantId,
        venueId: opts.atVenueId ?? venueId,
        name: 'Court 1',
        sport: 'TENNIS',
        resourceType: 'COURT',
        surface: 'HARD',
        basePriceCents: 2400,
      },
    });

    return tx.booking.create({
      data: {
        tenantId: tenant.tenantId,
        resourceId: resource.id,
        startTs: new Date(Date.now() - 2 * HOUR),
        endTs: new Date(Date.now() - HOUR),
        bookedByUserId: opts.userId ?? tenant.userId,
        status: opts.status ?? 'COMPLETED',
        totalCents: 2400,
        idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      },
    });
  });
}

// ══ Proof of visit ═══════════════════════════════════════════════════

describe('you can only review a venue you actually played at', () => {
  it('accepts a review backed by a COMPLETED booking', async () => {
    const booking = await seedBooking();

    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'Excellent courts.',
    });

    expect(r.status).toBe('PUBLISHED');
  });

  it('REFUSES a review from someone with no booking at all', async () => {
    // Without this check the review box is an open comment field, and a rival
    // club can leave one-stars from a burner account.
    await expect(
      createReview(db, {
        tenantId: tenant.tenantId,
        venueId,
        authorUserId: otherUserId,
        bookingId: 'bk_does_not_exist',
        rating: 1,
        body: 'Terrible place.',
      }),
    ).rejects.toThrow(NoProofOfVisitError);

    expect(await db.review.count({ where: { venueId } })).toBe(0);
  });

  it("REFUSES a review against SOMEONE ELSE'S booking", async () => {
    const booking = await seedBooking({ userId: tenant.userId });

    // The stranger points at a real, completed booking — just not theirs.
    await expect(
      createReview(db, {
        tenantId: tenant.tenantId,
        venueId,
        authorUserId: otherUserId,
        bookingId: booking.id,
        rating: 1,
      }),
    ).rejects.toThrow(NoProofOfVisitError);
  });

  it('REFUSES a review on a booking that was never COMPLETED', async () => {
    // The sneaky one. A PENDING booking costs nothing to create and nothing to
    // abandon — book, review, cancel, repeat.
    const pending = await seedBooking({ status: 'PENDING' });

    await expect(
      createReview(db, {
        tenantId: tenant.tenantId,
        venueId,
        authorUserId: tenant.userId,
        bookingId: pending.id,
        rating: 5,
      }),
    ).rejects.toThrow(NoProofOfVisitError);
  });

  it('REFUSES a booking at a DIFFERENT venue being used to review this one', async () => {
    const otherVenue = await asAppSuperuser(db, (tx) =>
      tx.venue.create({
        data: {
          tenantId: tenant.tenantId,
          name: 'Cheap Courts',
          slug: `other-${Math.random().toString(36).slice(2, 10)}`,
          city: 'Sofia',
          addressLine: '2 Vitosha Blvd',
          lat: 42.7,
          lng: 23.33,
          email: 'o@playerz.test',
        },
      }),
    );

    // Book the cheapest court in the city, then use it to review anywhere.
    const booking = await seedBooking({ atVenueId: otherVenue.id });

    await expect(
      createReview(db, {
        tenantId: tenant.tenantId,
        venueId, // ← reviewing a venue they never visited
        authorUserId: tenant.userId,
        bookingId: booking.id,
        rating: 1,
      }),
    ).rejects.toThrow(NoProofOfVisitError);
  });

  it('one booking is worth exactly ONE review', async () => {
    const booking = await seedBooking();

    await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
    });

    // The DB unique on bookingId is the thing that enforces this — a single
    // visit is otherwise worth as many reviews as the author has patience for.
    const second = createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
    });

    await expect(second.catch((e) => pgErrorCode(e))).resolves.toBe('23505');
  });

  it('the DATABASE refuses a 0- or 6-star rating, not just the app', async () => {
    const booking = await seedBooking();

    const attempt = asAppSuperuser(db, (tx) =>
      tx.review.create({
        data: {
          tenantId: tenant.tenantId,
          venueId,
          authorUserId: tenant.userId,
          bookingId: booking.id,
          rating: 6,
        },
      }),
    );

    await expect(attempt.catch((e) => pgErrorCode(e))).resolves.toBe('23514');
  });
});

// ══ Moderation ═══════════════════════════════════════════════════════

describe('nothing is visible until it has been moderated', () => {
  it('a flagged review is held as PENDING_REVIEW and opens a case', async () => {
    setModerationScores({ harassment: 0.6 });
    const booking = await seedBooking();

    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 1,
      body: 'something the classifier dislikes',
    });

    expect(r.status).toBe('PENDING_REVIEW');

    const c = await db.moderationCase.findFirstOrThrow({
      where: { subjectType: 'REVIEW', subjectId: r.id },
    });
    expect(c.status).toBe('OPEN');
    expect(c.reason).toBe('harassment');
  });

  it('a PENDING review does NOT move the venue score', async () => {
    // A one-star nobody has verified must not drag the average down while a
    // human is still deciding whether it is real.
    setModerationScores({ harassment: 0.6 });
    const booking = await seedBooking();

    await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 1,
      body: 'held for review',
    });

    const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(venue.reviewCount).toBe(0);
  });

  it('an auto-REJECTED review still opens a case — an automated decision nobody can appeal is not acceptable', async () => {
    setModerationScores({ 'sexual/minors': 0.9 });
    const booking = await seedBooking();

    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 1,
      body: 'auto-rejected content',
    });

    expect(r.status).toBe('REJECTED');

    // The case exists, so "why was my review taken down?" has an answer.
    const c = await db.moderationCase.findFirstOrThrow({
      where: { subjectType: 'REVIEW', subjectId: r.id },
    });
    expect(c.reason).toBe('sexual/minors');
  });

  it('a classifier OUTAGE queues the review — it does not publish it', async () => {
    // If an outage defaulted to publishing, the way to get anything onto the
    // site would be to attack our moderation provider.
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const booking = await seedBooking();

      const r = await createReview(db, {
        tenantId: tenant.tenantId,
        venueId,
        authorUserId: tenant.userId,
        bookingId: booking.id,
        rating: 5,
        body: 'anything at all',
      });

      expect(r.status).toBe('PENDING_REVIEW');
      expect(r.status).not.toBe('PUBLISHED');

      const c = await db.moderationCase.findFirstOrThrow({ where: { subjectId: r.id } });
      expect(c.reason).toBe('classifier_unavailable');
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it('a star-only review with no text is published without calling the classifier', async () => {
    const booking = await seedBooking();

    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 4,
    });

    expect(r.status).toBe('PUBLISHED');
  });

  it('a moderator publishing a held review MOVES the score', async () => {
    setModerationScores({ harassment: 0.6 });
    const booking = await seedBooking();

    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'held, then approved',
    });

    const before = await db.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(before.reviewCount).toBe(0);

    const c = await db.moderationCase.findFirstOrThrow({ where: { subjectId: r.id } });
    await resolveCase(db, { caseId: c.id, moderatorUserId: tenant.userId, approve: true });

    // If the score did not move, moderation would have no effect on the thing
    // reviews exist to produce.
    const after = await db.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(after.reviewCount).toBe(1);

    const review = await db.review.findUniqueOrThrow({ where: { id: r.id } });
    expect(review.status).toBe('PUBLISHED');
  });

  it('a moderator rejecting a published review REMOVES it from the score', async () => {
    const booking = await seedBooking();
    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'published, then taken down',
    });
    expect(r.status).toBe('PUBLISHED');

    const { caseId } = await reportContent(db, {
      tenantId: tenant.tenantId,
      subjectType: 'REVIEW',
      subjectId: r.id,
      reporterUserId: otherUserId,
      reason: 'fake review',
    });

    await resolveCase(db, { caseId, moderatorUserId: tenant.userId, approve: false });

    const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(venue.reviewCount).toBe(0);
  });
});

// ══ Reporting ════════════════════════════════════════════════════════

describe('reporting', () => {
  it('ten people reporting one review is ONE job for a moderator', async () => {
    const booking = await seedBooking();
    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'a contested review',
    });

    const reporters = await asAppSuperuser(db, (tx) =>
      Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          tx.user.create({
            data: { email: `reporter-${i}-${Math.random().toString(36).slice(2, 8)}@playerz.test` },
          }),
        ),
      ),
    );

    const cases = await Promise.all(
      reporters.map((u) =>
        reportContent(db, {
          tenantId: tenant.tenantId,
          subjectType: 'REVIEW',
          subjectId: r.id,
          reporterUserId: u.id,
          reason: 'spam',
        }),
      ),
    );

    // One case, not ten. Otherwise a coordinated group buries the queue in
    // duplicates of a single item and everything else in it goes unlooked-at.
    const openCases = await db.moderationCase.count({
      where: { subjectId: r.id, status: 'OPEN' },
    });
    expect(openCases).toBe(1);
    expect(new Set(cases.map((c) => c.caseId)).size).toBe(1);

    // But all ten reports are on the record — that is how brigading is spotted.
    expect(await db.contentReport.count({ where: { subjectId: r.id } })).toBe(10);
  });

  it('one person cannot manufacture a consensus by reporting ten times', async () => {
    const booking = await seedBooking();
    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'a review',
    });

    for (let i = 0; i < 10; i++) {
      await reportContent(db, {
        tenantId: tenant.tenantId,
        subjectType: 'REVIEW',
        subjectId: r.id,
        reporterUserId: otherUserId,
        reason: 'spam',
      });
    }

    expect(await db.contentReport.count({ where: { subjectId: r.id } })).toBe(1);
  });

  it('a subject can be reported AGAIN after an earlier case was resolved', async () => {
    // The bug the partial index exists to avoid: a plain
    // UNIQUE(subjectType, subjectId, status) permits only one RESOLVED case
    // per subject, so the moderator's SECOND decision on an item would violate
    // it and they would get a 500 for doing their job.
    const booking = await seedBooking();
    const r = await createReview(db, {
      tenantId: tenant.tenantId,
      venueId,
      authorUserId: tenant.userId,
      bookingId: booking.id,
      rating: 5,
      body: 'a review',
    });

    const first = await reportContent(db, {
      tenantId: tenant.tenantId,
      subjectType: 'REVIEW',
      subjectId: r.id,
      reporterUserId: otherUserId,
      reason: 'spam',
    });
    await resolveCase(db, { caseId: first.caseId, moderatorUserId: tenant.userId, approve: true });

    // Someone else reports it later. This must OPEN A NEW CASE, not explode.
    const second = await reportContent(db, {
      tenantId: tenant.tenantId,
      subjectType: 'REVIEW',
      subjectId: r.id,
      reporterUserId: tenant.userId,
      reason: 'still spam',
    });

    expect(second.caseId).not.toBe(first.caseId);

    await resolveCase(db, {
      caseId: second.caseId,
      moderatorUserId: tenant.userId,
      approve: false,
    });

    const resolved = await db.moderationCase.count({
      where: { subjectId: r.id, status: { in: ['APPROVED', 'REJECTED'] } },
    });
    expect(resolved).toBe(2);
  });
});

// ══ The score ════════════════════════════════════════════════════════

describe('the venue score', () => {
  it('is recomputed from the full set, so a taken-down review really leaves', async () => {
    // Recomputing rather than incrementally adjusting is what makes moderation
    // repairable. An incremental average has no way to un-add a review.
    const ratings = [5, 5, 1];
    for (const rating of ratings) {
      const booking = await seedBooking();
      await asAppSuperuser(db, (tx) =>
        tx.review.create({
          data: {
            tenantId: tenant.tenantId,
            venueId,
            authorUserId: tenant.userId,
            bookingId: booking.id,
            rating,
            status: 'PUBLISHED',
          },
        }),
      );
      // A distinct author per review, since @@unique([venueId, authorUserId])
      // allows only one each — done via raw update to keep the fixture simple.
      await asAppSuperuser(db, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE review SET "authorUserId" = $1 WHERE "bookingId" = $2`,
          `user-${Math.random().toString(36).slice(2, 10)}`,
          booking.id,
        ),
      );
    }

    const { reviewCount, avgRating } = await recomputeVenueRating(db, {
      tenantId: tenant.tenantId,
      venueId,
    });

    expect(reviewCount).toBe(3);
    // Bayesian: (10*4 + 11) / 13 = 3.9 — NOT the naive mean of 3.67.
    expect(avgRating).toBeCloseTo(3.9, 1);
  });
});
