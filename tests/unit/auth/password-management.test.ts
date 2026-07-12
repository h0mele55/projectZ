/**
 * @jest-environment node
 */
import { resolveLoginPenalty } from '@/lib/auth/password-management';
import { dummyVerify, hashPassword, verifyPassword } from '@/lib/auth/passwords';
import { checkPasswordAgainstHIBP } from '@/lib/security/password-check';

import { setHibpClean, setHibpPwned, useMswServer } from '../../helpers/msw';

describe('progressive login throttling', () => {
  it('a typo costs nothing — the first two failures are free', () => {
    // A flat lockout hands an attacker a free denial-of-service: spray five
    // wrong passwords at a real customer and they cannot reach their booking.
    expect(resolveLoginPenalty(0)).toEqual({ delayMs: 0, lockedOut: false });
    expect(resolveLoginPenalty(1)).toEqual({ delayMs: 0, lockedOut: false });
    expect(resolveLoginPenalty(2)).toEqual({ delayMs: 0, lockedOut: false });
  });

  it('3 failures → 5s, 5 failures → 30s', () => {
    expect(resolveLoginPenalty(3)).toEqual({ delayMs: 5_000, lockedOut: false });
    expect(resolveLoginPenalty(4)).toEqual({ delayMs: 5_000, lockedOut: false });
    expect(resolveLoginPenalty(5)).toEqual({ delayMs: 30_000, lockedOut: false });
  });

  it('10 failures → a 15-minute lockout', () => {
    expect(resolveLoginPenalty(10)).toEqual({ delayMs: 15 * 60_000, lockedOut: true });
    expect(resolveLoginPenalty(50)).toEqual({ delayMs: 15 * 60_000, lockedOut: true });
  });

  it('the penalty never decreases as failures rise', () => {
    let prev = -1;
    for (let n = 0; n <= 20; n++) {
      const { delayMs } = resolveLoginPenalty(n);
      expect(delayMs).toBeGreaterThanOrEqual(prev);
      prev = delayMs;
    }
  });
});

describe('dummyVerify closes the user-enumeration timing oracle', () => {
  it('costs the same as a real bcrypt comparison', async () => {
    const hash = await hashPassword('CorrectHorse1!');

    const timeOf = async (fn: () => Promise<unknown>) => {
      const t0 = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - t0) / 1e6; // ms
    };

    // Warm up — the first bcrypt call pays a JIT cost that would skew the
    // comparison and make a real gap look like noise.
    await verifyPassword('x', hash);
    await dummyVerify('x');

    const real = await timeOf(() => verifyPassword('WrongPassword1!', hash));
    const dummy = await timeOf(() => dummyVerify('WrongPassword1!'));

    // The naive "user not found → return null" path returns in ~1ms while a
    // real compare takes ~100ms+. That 100x gap is the oracle. Both paths
    // must sit in the same order of magnitude.
    const ratio = Math.max(real, dummy) / Math.max(1, Math.min(real, dummy));
    expect(ratio).toBeLessThan(3);
    expect(dummy).toBeGreaterThan(10); // it really did run bcrypt
  }, 20_000);

  it('always fails', async () => {
    await expect(dummyVerify('anything')).resolves.toBe(false);
  });
});

describe('HIBP breach check', () => {
  useMswServer();

  it('rejects a password found in a breach', async () => {
    setHibpPwned('password123', 4213);
    const res = await checkPasswordAgainstHIBP('password123');
    expect(res.breached).toBe(true);
    expect(res.count).toBe(4213);
    expect(res.degraded).toBe(false);
  });

  it('allows a password with a zero count — those are HIBP padding decoys', () => {
    // HIBP pads its response with fake suffixes carrying count 0. Treating
    // one as a hit would reject a perfectly good password.
    setHibpClean();
    return expect(checkPasswordAgainstHIBP('a-good-password')).resolves.toMatchObject({
      breached: false,
      degraded: false,
    });
  });

  it('FAILS OPEN when HIBP is unreachable, and says so', async () => {
    const { mswServer } = await import('../../helpers/msw');
    const { http, HttpResponse } = await import('msw');
    mswServer.use(
      http.get('https://api.pwnedpasswords.com/range/:p', () =>
        HttpResponse.text('', { status: 503 }),
      ),
    );

    const res = await checkPasswordAgainstHIBP('whatever');

    // Failing CLOSED would make HIBP's outage into OUR outage — nobody
    // could sign up or reset a password. The `degraded` flag exists so the
    // fail-open is visible in logs: a silent one is how a control quietly
    // stops existing.
    expect(res.breached).toBe(false);
    expect(res.degraded).toBe(true);
  });
});
