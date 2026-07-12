/**
 * Index definitions.
 *
 * Settings live in CODE and are pushed idempotently at deploy
 * (scripts/search-setup.ts). The alternative — configuring Meilisearch by
 * hand through its API — means the settings exist only in a running
 * container's state: not in review, not in git, and gone the first time
 * somebody recreates the volume. You then spend a day wondering why search
 * stopped being typo-tolerant.
 */

export const INDEXES = {
  venues: {
    uid: 'venues',
    primaryKey: 'id',
    searchable: ['name', 'city', 'description'],
    filterable: ['city', 'country', 'sports', 'amenities', 'tenantId', 'status'],
    sortable: ['avgRating', 'reviewCount'],
  },
  coaches: {
    uid: 'coaches',
    primaryKey: 'id',
    searchable: ['displayName', 'bio', 'city'],
    filterable: ['sports', 'city', 'tenantId', 'verified', 'status'],
    sortable: ['hourlyRateCents', 'avgRating'],
  },
  sessions: {
    uid: 'sessions',
    primaryKey: 'id',
    searchable: ['sportLabel', 'city', 'venueName'],
    filterable: ['sport', 'sportFamily', 'city', 'skillBand', 'tenantId', 'status'],
    sortable: ['startTs', 'spotsLeft'],
  },
} as const;

export type IndexName = keyof typeof INDEXES;

/** Every model whose changes must reach an index. The ratchet reads this. */
export const INDEXED_MODELS = {
  venues: 'Venue',
  coaches: 'Coach',
  sessions: 'OpenPlaySession',
} as const satisfies Record<IndexName, string>;
