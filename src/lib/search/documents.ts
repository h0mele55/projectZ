import type { Prisma } from '@prisma/client';

import { getSportConfig } from '@/lib/sports/registry';

/**
 * Model → index document.
 *
 * These mappers are pure and null-safe on purpose. A single undefined field in
 * a document does not throw — Meilisearch happily accepts it — but it makes
 * the venue unfindable by that field, silently, forever. So the mappers are
 * unit-tested with sparse rows.
 */

export interface VenueDoc {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  city: string;
  country: string;
  description: string | null;
  sports: string[];
  amenities: string[];
  avgRating: number;
  reviewCount: number;
  status: string;
  _geo?: { lat: number; lng: number };
}

type VenueRow = Prisma.VenueGetPayload<{
  include: { resources: true; amenities: true };
}>;

export function toVenueDoc(v: VenueRow): VenueDoc {
  return {
    id: v.id,
    tenantId: v.tenantId,
    slug: v.slug,
    name: v.name,
    city: v.city,
    country: v.country,
    description: v.description ?? null,
    // A venue with no resources yet is still a venue. `?? []` rather than
    // letting `undefined` through — an undefined facet value makes the
    // document unfilterable, not absent, which is much harder to notice.
    sports: [...new Set((v.resources ?? []).map((r) => r.sport))],
    amenities: (v.amenities ?? []).map((a) => a.code),
    avgRating: Number(v.avgRating ?? 0),
    reviewCount: v.reviewCount ?? 0,
    status: v.status,
    ...(v.lat != null && v.lng != null
      ? { _geo: { lat: Number(v.lat), lng: Number(v.lng) } }
      : {}),
  };
}

export interface SessionDoc {
  id: string;
  tenantId: string;
  sport: string;
  sportFamily: string;
  sportLabel: string;
  city: string | null;
  venueName: string | null;
  startTs: number;
  spotsLeft: number;
  skillBand: string;
  status: string;
}

type SessionRow = Prisma.OpenPlaySessionGetPayload<{
  include: { resource: { include: { venue: true } } };
}>;

export function toSessionDoc(s: SessionRow): SessionDoc {
  const cfg = getSportConfig(s.sport);

  return {
    id: s.id,
    tenantId: s.tenantId,
    sport: s.sport,
    sportFamily: cfg.family,
    // Label from the REGISTRY, not hard-coded — a new sport becomes searchable
    // by name the moment it is registered.
    sportLabel: cfg.label.en,
    // A meeting-point session (running) has no resource, hence no venue.
    city: s.resource?.venue.city ?? null,
    venueName: s.resource?.venue.name ?? null,
    startTs: s.startTs.getTime(),
    // Never negative, even if currentCount somehow exceeded the max.
    spotsLeft: Math.max(0, s.maxParticipants - s.currentCount),
    skillBand: `${s.minSkillLevel}-${s.maxSkillLevel}`,
    status: s.status,
  };
}

export interface CoachDoc {
  id: string;
  tenantId: string;
  displayName: string;
  bio: string | null;
  city: string | null;
  sports: string[];
  hourlyRateCents: number;
  verified: boolean;
  avgRating: number;
  status: string;
}

type CoachRow = Prisma.CoachGetPayload<{ include: { coachSports: true } }>;

export function toCoachDoc(c: CoachRow, displayName: string, city: string | null): CoachDoc {
  return {
    id: c.id,
    tenantId: c.tenantId,
    displayName,
    bio: c.bio ?? null,
    city,
    // `c.sports` is the authoritative array; coachSports is the join detail.
    sports: [...new Set([...(c.sports ?? []), ...(c.coachSports ?? []).map((s) => s.sport)])],
    hourlyRateCents: c.hourlyRateCents,
    verified: c.verified,
    avgRating: 0,
    status: c.status,
  };
}
