import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { listVenues } from '@/app-layer/repositories/venue';
import { prisma } from '@/lib/db/prisma';

export const metadata = { title: 'Venues — playerz.bg' };

/**
 * Public venue search.
 *
 * A server component reading through the repository, so the query-shape and
 * tenant-isolation ratchets police it like any other call site — a page that
 * reached for Prisma directly would slip past both.
 */
export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; sport?: string }>;
}) {
  const sp = await searchParams;

  const { items } = await listVenues(
    prisma,
    {
      q: sp.q,
      city: sp.city,
      sport: sp.sport as never,
    },
    { limit: 20 },
  );

  return (
    <main className="bg-bg-page text-content-default min-h-screen px-6 py-10">
      <header className="mb-8">
        <h1 className="text-content-emphasis text-3xl font-semibold">Play</h1>
        <p className="text-content-muted mt-1 text-sm">
          {items.length} venue{items.length === 1 ? '' : 's'} available
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No venues match your search"
          description="Try a different city or sport."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v) => {
            const sports = [...new Set(v.courts.map((c) => c.sport))];
            const from = v.courts.length
              ? Math.min(...v.courts.map((c) => c.basePriceCents))
              : null;

            return (
              <li key={v.id}>
                <Link
                  href={`/venues/${v.slug}`}
                  className="border-border-subtle bg-bg-default hover:border-border-emphasis block rounded-lg border p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-content-emphasis font-medium">{v.name}</h2>
                    {v.reviewCount > 0 && (
                      <StatusBadge variant="success">
                        {Number(v.avgRating).toFixed(1)} ★
                      </StatusBadge>
                    )}
                  </div>

                  <p className="text-content-muted mt-1 text-sm">
                    {v.city}, {v.country}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {sports.map((s) => (
                      <StatusBadge key={s} variant="neutral">
                        {s.toLowerCase()}
                      </StatusBadge>
                    ))}
                  </div>

                  {from !== null && (
                    <p className="text-content-subtle mt-3 text-xs">
                      from €{(from / 100).toFixed(2)} / hour
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
