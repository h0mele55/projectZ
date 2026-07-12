/**
 * @jest-environment node
 *
 * The geo helpers import Prisma, which needs Node — jsdom has no TextEncoder.
 */
import { toSessionDoc, toVenueDoc } from '@/lib/search/documents';
import { clampRadiusKm, MAX_RADIUS_KM } from '@/app-layer/repositories/geo';

/**
 * The mappers are null-safe on purpose.
 *
 * A single `undefined` in a document does NOT throw — Meilisearch accepts it —
 * but it makes the venue unfilterable by that field, silently, forever. So the
 * mappers are tested with SPARSE rows, which is the shape that actually
 * breaks them.
 */
const baseVenue = {
  id: 'v1',
  tenantId: 't1',
  slug: 'sofia-padel',
  name: 'Sofia Padel',
  city: 'Sofia',
  country: 'BG',
  description: null,
  status: 'ACTIVE',
  avgRating: 4.5,
  reviewCount: 12,
  lat: 42.6977,
  lng: 23.3219,
  resources: [{ sport: 'PADEL' }, { sport: 'PADEL' }, { sport: 'TENNIS' }],
  amenities: [{ code: 'PARKING' }],
} as never;

describe('venue document mapper', () => {
  it('dedupes sports across resources', () => {
    const doc = toVenueDoc(baseVenue);
    expect(doc.sports.sort()).toEqual(['PADEL', 'TENNIS']);
  });

  it('survives a venue with NO resources and NO amenities', () => {
    // A brand-new venue is still a venue. `undefined` here would make it
    // unfilterable rather than absent — much harder to notice.
    const sparse = { ...(baseVenue as object), resources: undefined, amenities: undefined } as never;
    const doc = toVenueDoc(sparse);
    expect(doc.sports).toEqual([]);
    expect(doc.amenities).toEqual([]);
  });

  it('carries _geo when coordinates exist, and omits it when they do not', () => {
    expect(toVenueDoc(baseVenue)._geo).toEqual({ lat: 42.6977, lng: 23.3219 });

    const noGeo = { ...(baseVenue as object), lat: null, lng: null } as never;
    expect(toVenueDoc(noGeo)._geo).toBeUndefined();
  });

  it('coerces Decimal ratings to numbers', () => {
    // A Prisma Decimal serialises to an object, not a number — the index would
    // then sort by rating lexicographically, which is nonsense.
    expect(typeof toVenueDoc(baseVenue).avgRating).toBe('number');
  });
});

describe('session document mapper', () => {
  const session = {
    id: 's1',
    tenantId: 't1',
    sport: 'PADEL',
    startTs: new Date('2026-08-01T10:00:00Z'),
    maxParticipants: 4,
    currentCount: 1,
    minSkillLevel: 'BEGINNER',
    maxSkillLevel: 'ADVANCED',
    status: 'CONFIRMED',
    resource: { venue: { city: 'Sofia', name: 'Sofia Padel' } },
  } as never;

  it('computes spotsLeft', () => {
    expect(toSessionDoc(session).spotsLeft).toBe(3);
  });

  it('spotsLeft NEVER goes negative', () => {
    // If currentCount ever exceeded max (a bug elsewhere), a negative
    // spotsLeft would sort to the top of "most available".
    const over = { ...(session as object), currentCount: 9 } as never;
    expect(toSessionDoc(over).spotsLeft).toBe(0);
  });

  it('takes the sport LABEL from the registry, so a new sport is searchable by name', () => {
    expect(toSessionDoc(session).sportLabel).toBe('Padel');
    expect(toSessionDoc(session).sportFamily).toBe('RACKET');
  });

  it('survives a MEETING_POINT session with no resource (running)', () => {
    // Running sessions have no venue. A mapper that assumed one would throw on
    // every single run.
    const running = {
      ...(session as object),
      sport: 'RUNNING',
      resource: null,
    } as never;

    const doc = toSessionDoc(running);
    expect(doc.city).toBeNull();
    expect(doc.venueName).toBeNull();
    expect(doc.sportFamily).toBe('ENDURANCE');
  });
});

describe('geo param validation', () => {
  it('clamps the radius to the ceiling', () => {
    expect(clampRadiusKm(20_000)).toBe(MAX_RADIUS_KM);
    expect(clampRadiusKm(5)).toBe(5);
    expect(clampRadiusKm(0)).toBe(10);
    expect(clampRadiusKm(NaN)).toBe(10);
  });
});
