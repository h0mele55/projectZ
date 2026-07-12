import { createHash } from 'node:crypto';

/**
 * Have I Been Pwned, via the k-anonymity range API.
 *
 * We send the FIRST FIVE characters of the SHA-1 of the password and
 * nothing else. HIBP returns every suffix sharing that prefix (~500 of
 * them) and we scan locally. The password never leaves this process, and
 * HIBP cannot tell which of the 500 candidates we were asking about.
 *
 * Sending the full hash would be a catastrophe: a password reuse oracle
 * handed to a third party.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const TIMEOUT_MS = 2_000;

export interface BreachCheckResult {
  breached: boolean;
  count: number;
  /** True when HIBP could not be reached and we let the password through. */
  degraded: boolean;
}

/**
 * FAIL OPEN, deliberately.
 *
 * If HIBP is down or slow, we allow the password rather than blocking
 * registration. That is a real trade-off and it is the right way round:
 *
 *   - fail closed → HIBP's outage becomes OUR outage. Nobody can sign up
 *     or reset a password. An availability dependency on a free
 *     third-party service is a bad trade.
 *   - fail open  → for the duration of the outage, a user *might* pick a
 *     breached password. That is a marginal weakening of a defence that is
 *     itself only advisory — the password is still hashed with bcrypt, the
 *     account is still rate-limited, and the user can still enable MFA.
 *
 * The `degraded` flag is returned so the caller can log it. A silent
 * fail-open that nobody can see is how a security control quietly stops
 * existing.
 */
export async function checkPasswordAgainstHIBP(password: string): Promise<BreachCheckResult> {
  // ── Why SHA-1 here is correct, and not a password-hashing weakness ──
  //
  // CodeQL flags this as `js/insufficient-password-hash`. It is a false
  // positive, and the distinction matters:
  //
  //   - This digest is NEVER stored and NEVER used to authenticate anyone.
  //     Password storage is bcrypt at 12 rounds — see lib/auth/passwords.ts.
  //   - SHA-1 is MANDATED by HIBP's range API. It is the protocol. Using a
  //     stronger digest here would simply not work: the server has no
  //     bcrypt/argon2 index to query.
  //   - Only the first FIVE hex characters ever leave this process
  //     (k-anonymity), and HIBP returns ~500 candidate suffixes. It cannot
  //     tell which one we were asking about.
  //
  // The alert is dismissed in the Security tab with this rationale rather
  // than suppressed silently.
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true' },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      return { breached: false, count: 0, degraded: true };
    }

    const body = await res.text();

    for (const line of body.split('\n')) {
      const [candidate, countRaw] = line.trim().split(':');
      if (candidate === suffix) {
        const count = Number.parseInt(countRaw ?? '0', 10);
        // HIBP's padding responses carry a count of 0 — those are decoys,
        // not real hits. Treating one as a breach would reject a perfectly
        // good password.
        if (count > 0) {
          return { breached: true, count, degraded: false };
        }
      }
    }

    return { breached: false, count: 0, degraded: false };
  } catch {
    return { breached: false, count: 0, degraded: true };
  }
}
