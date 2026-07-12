/**
 * The encrypted-field manifest.
 *
 * A field lands here when it is (a) free text a human wrote, and (b) either
 * personal or a credential. Encrypting everything is not free — an
 * encrypted column cannot be indexed, filtered, or sorted — so this list is
 * deliberately short and each entry has to earn its place.
 *
 * inflect's manifest is 40+ compliance fields. playerz has six.
 */
export const ENCRYPTED_FIELDS = {
  /// Venue marketing copy. Author-written, publicly rendered → also sanitised.
  Venue: ['description'],
  /// Chat between players. Personal, and an XSS surface → also sanitised.
  SessionChatMessage: ['body'],
  /// "Player has a bad knee" — health data a coach wrote down.
  CoachBooking: ['notes'],
  /// A coach's own bio.
  Coach: ['bio'],
  /// "Ring the bell, gate code 4471" — often contains access details.
  Booking: ['notes'],
  /// A TOTP seed. Storing this in plaintext defeats the entire second factor.
  User: ['mfaSecret'],
} as const satisfies Record<string, readonly string[]>;

export type EncryptedModel = keyof typeof ENCRYPTED_FIELDS;

export function isEncryptedField(model: string, field: string): boolean {
  const fields = (ENCRYPTED_FIELDS as Record<string, readonly string[]>)[model];
  return fields?.includes(field) ?? false;
}

/** Every model:field pair, flattened — used by the guardrail. */
export function encryptedFieldPairs(): Array<{ model: string; field: string }> {
  return Object.entries(ENCRYPTED_FIELDS).flatMap(([model, fields]) =>
    fields.map((field) => ({ model, field })),
  );
}
