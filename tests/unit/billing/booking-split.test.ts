import {
  ShareSumMismatchError,
  assertSharesSumToTotal,
  partitionEqually,
} from '@/app-layer/usecases/booking-split';

describe('partitionEqually', () => {
  it('splits evenly when it divides evenly', () => {
    expect(partitionEqually(2400, 4)).toEqual([600, 600, 600, 600]);
  });

  it('distributes the remainder a cent at a time instead of conjuring one', () => {
    // €50 across 3 is €16.6667 each. Rounding each share independently gives
    // 1667 × 3 = 5001 — one cent that came from nowhere, on every three-way
    // split, forever.
    const shares = partitionEqually(5000, 3);

    expect(shares).toEqual([1667, 1667, 1666]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(5000);
  });

  it.each([
    [100, 3],
    [1, 1],
    [999, 7],
    [2400, 5],
    [12_345, 11],
    [7, 4], // more people than cents — someone pays 1, someone pays 0…
  ])('shares always sum to EXACTLY the total (%i cents, %i ways)', (total, ways) => {
    const shares = partitionEqually(total, ways);

    expect(shares).toHaveLength(ways);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    expect(shares.every(Number.isInteger)).toBe(true);
  });

  it('nobody pays more than a cent above anybody else', () => {
    // A split where one person is quietly handed the entire remainder is a
    // support ticket. The difference must be at most 1¢.
    const shares = partitionEqually(10_000, 7);

    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('rejects a nonsensical split rather than inventing an answer', () => {
    expect(() => partitionEqually(1000, 0)).toThrow(/Cannot split/);
    expect(() => partitionEqually(1000, -2)).toThrow(/Cannot split/);
    expect(() => partitionEqually(10.5, 2)).toThrow(/non-negative integer/);
  });
});

describe('assertSharesSumToTotal', () => {
  it('accepts a custom split that sums correctly', () => {
    // A generous friend covering more than their quarter.
    expect(() => assertSharesSumToTotal([1200, 400, 400, 400], 2400)).not.toThrow();
  });

  it('rejects a split that is a cent short', () => {
    // The whole reason this function exists. One cent short on a custom split
    // means the venue is paid less than it billed — and it compounds silently.
    expect(() => assertSharesSumToTotal([600, 600, 600, 599], 2400)).toThrow(ShareSumMismatchError);
  });

  it('rejects a split that is a cent over', () => {
    expect(() => assertSharesSumToTotal([600, 600, 600, 601], 2400)).toThrow(ShareSumMismatchError);
  });

  it('rejects a zero or negative share', () => {
    // A zero share is a person on the booking who owes nothing — which is a
    // real thing someone might want, but it must be expressed by leaving them
    // off the split, not by a 0¢ row that the DB CHECK would reject anyway.
    expect(() => assertSharesSumToTotal([2400, 0], 2400)).toThrow(/positive integer/);
    expect(() => assertSharesSumToTotal([2500, -100], 2400)).toThrow(/positive integer/);
  });

  it('the error says what went wrong, in money', () => {
    try {
      assertSharesSumToTotal([600, 600, 600, 599], 2400);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/2399.*2400/s);
    }
  });
});
