import bcrypt from 'bcryptjs';

/**
 * Password hashing, and the timing side-channel nobody thinks about.
 *
 * The obvious sign-in implementation is:
 *
 *     const user = await findUser(email);
 *     if (!user) return null;              // ← returns in ~1ms
 *     return bcrypt.compare(pw, user.hash) // ← returns in ~100ms
 *
 * That is a **user-enumeration oracle**. An attacker times the response and
 * learns which email addresses have accounts — no error message required.
 * On a booking platform that leaks your customer list; combined with a
 * password dump it turns credential-stuffing from a shotgun into a rifle.
 *
 * `dummyVerify()` closes it: when the user does not exist, we still run a
 * bcrypt comparison against a fixed hash, so both paths cost the same.
 */

export const BCRYPT_ROUNDS = 12;

/**
 * A real bcrypt hash of a value nobody can guess, used ONLY to burn the
 * same CPU time as a genuine comparison. It is not a credential and
 * authenticates nothing — verifying against it always fails.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.PoOQNjHTGkkPHrLbwGvXPGqLMKCXqe'; // pragma: allowlist secret

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Burn the same time a real verify would, then fail.
 *
 * Call this on EVERY path where authentication fails for a reason other
 * than a wrong password — user not found, no password set (OAuth-only
 * account), user deactivated. Skipping it on any one of them reopens the
 * oracle for that case.
 */
export async function dummyVerify(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}
