import { readFileSync } from 'node:fs';

import { SPORTS } from '@/lib/sports/registry';

/**
 * FOUR-WAY CROSS-WALK RATCHET.
 *
 * A sport exists in four places: the Prisma enum, the registry, and the two
 * message catalogues. They drift silently.
 *
 * Add PICKLEBALL to the enum and forget the Bulgarian label, and nothing
 * fails — a Bulgarian user just sees the raw string "PICKLEBALL" where a
 * sport name should be. Add it to the registry and forget the enum, and the
 * database rejects the write at runtime, in production, on the first person
 * who tries to book one.
 *
 * So all four must agree, and the build says so.
 */

function prismaEnumMembers(): string[] {
  const schema = readFileSync('prisma/schema/enums.prisma', 'utf8');
  const block = schema.match(/enum SportType \{([\s\S]*?)\}/)?.[1] ?? '';
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
}

function messageKeys(locale: 'bg' | 'en'): string[] {
  const json = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8'));
  return Object.keys(json.sports ?? {});
}

describe('sport registry completeness (four-way cross-walk)', () => {
  const enumMembers = prismaEnumMembers();
  const registryKeys = Object.keys(SPORTS);

  it('the schema parser actually found the enum', () => {
    // A broken regex here would make every assertion below vacuous.
    expect(enumMembers.length).toBeGreaterThanOrEqual(14);
    expect(enumMembers).toContain('CHESS');
  });

  it('Prisma enum ⟷ registry', () => {
    expect([...registryKeys].sort()).toEqual([...enumMembers].sort());
  });

  it.each(['bg', 'en'] as const)('registry ⟷ messages/%s.json', (locale) => {
    const keys = messageKeys(locale);

    const missing = registryKeys.filter((k) => !keys.includes(k));
    const orphan = keys.filter((k) => !registryKeys.includes(k));

    if (missing.length || orphan.length) {
      throw new Error(
        `messages/${locale}.json is out of sync with the sport registry.\n` +
          (missing.length ? `  MISSING (a user sees the raw enum key): ${missing.join(', ')}\n` : '') +
          (orphan.length ? `  ORPHANED (no such sport): ${orphan.join(', ')}\n` : ''),
      );
    }

    expect(missing).toEqual([]);
    expect(orphan).toEqual([]);
  });

  it('no message label is just the enum key echoed back', () => {
    // The laziest way to "fix" this ratchet is to paste the key in as the
    // label. That passes the cross-walk and still shows PICKLEBALL to a
    // Bulgarian user.
    const bg = JSON.parse(readFileSync('messages/bg.json', 'utf8')).sports;
    for (const [key, label] of Object.entries(bg as Record<string, string>)) {
      expect(label).not.toBe(key);
    }
  });
});
