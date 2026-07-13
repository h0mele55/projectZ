/**
 * The offline fallback.
 *
 * DELIBERATELY STATIC and personal to nobody. It is the only page the service
 * worker precaches, and it is what a failed navigation falls back to.
 *
 * The tempting alternative — falling back to "the last page this device saw" —
 * would serve whoever is holding the phone the PREVIOUS user's dashboard,
 * rendered, from disk. A shared laptop at a club's front desk makes that a
 * certainty rather than a risk.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">You&rsquo;re offline</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        We can&rsquo;t reach playerz.bg right now. Your bookings are safe — this page will work
        again as soon as you have a connection.
      </p>
    </main>
  );
}
