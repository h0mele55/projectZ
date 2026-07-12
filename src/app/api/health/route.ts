import { NextResponse } from 'next/server';

/**
 * Liveness. Deliberately does NOT touch the database.
 *
 * A health check that queries Postgres reports the DATABASE's health, not
 * the pod's — so a brief database blip makes Kubernetes kill every healthy
 * pod at once, turning a recoverable incident into an outage. Readiness
 * (P12) is where dependency checks belong.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'playerz.bg' });
}
