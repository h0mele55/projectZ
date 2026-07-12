import {
  PRIOR_MEAN,
  assertValidRating,
  bayesianAverage,
  wilsonLowerBound,
} from '@/lib/ratings/score';

describe('bayesianAverage', () => {
  it('a venue with no reviews sits at the prior, not at zero', () => {
    // Zero would rank a brand-new club below one with a hundred one-star
    // reviews. It has no score; it does not have a BAD score.
    expect(bayesianAverage([])).toBe(PRIOR_MEAN);
  });

  it('one five-star review does NOT make a venue a 5.0', () => {
    // The whole point. Otherwise the optimal strategy for a new club is: ask
    // one friend to review, then never ask anyone again.
    const score = bayesianAverage([5]);

    expect(score).toBeCloseTo(4.1, 1);
    expect(score).toBeLessThan(4.2);
  });

  it('one one-star review does NOT make a venue a 1.0 either', () => {
    // The prior cuts both ways — which is what makes it fair rather than
    // merely defensive. A rival cannot tank a new club with one burner account.
    const score = bayesianAverage([1]);

    expect(score).toBeGreaterThan(3.5);
  });

  it('a venue EARNS its way to a high score with volume', () => {
    const one = bayesianAverage([5]);
    const ten = bayesianAverage(Array(10).fill(5));
    const fifty = bayesianAverage(Array(50).fill(5));

    expect(one).toBeLessThan(ten);
    expect(ten).toBeLessThan(fifty);
    expect(fifty).toBeGreaterThanOrEqual(4.8);

    // …but never quite reaches a perfect 5, because the prior never fully
    // disappears. That is correct: certainty is not something a finite sample
    // buys you.
    expect(fifty).toBeLessThanOrEqual(5);
  });

  it('converges on the true mean given enough reviews', () => {
    const ratings = Array(1000).fill(3);
    expect(bayesianAverage(ratings)).toBeCloseTo(3.0, 1);
  });

  it('rounds to one decimal — the column is Decimal(2,1)', () => {
    const score = bayesianAverage([5, 4, 3]);
    expect(score * 10).toBe(Math.round(score * 10));
  });
});

describe('wilsonLowerBound', () => {
  it('ranks a well-evidenced good venue above a barely-evidenced perfect one', () => {
    // THE test. 200 reviews averaging 4.5 vs 3 reviews averaging 5.0.
    //
    // A naive average ranks the second first. Wilson ranks the first, because
    // we KNOW it is good and merely SUSPECT the second is.
    // 100 fours and 100 fives — a genuine 4.5 average, deterministically.
    const established = wilsonLowerBound([...Array(100).fill(4), ...Array(100).fill(5)]);
    const newcomer = wilsonLowerBound([5, 5, 5]);

    expect(established).toBeGreaterThan(newcomer);
  });

  it('the bound RISES as evidence accumulates for the same average', () => {
    const three = wilsonLowerBound(Array(3).fill(5));
    const thirty = wilsonLowerBound(Array(30).fill(5));
    const threeHundred = wilsonLowerBound(Array(300).fill(5));

    expect(three).toBeLessThan(thirty);
    expect(thirty).toBeLessThan(threeHundred);

    // It approaches 1.0 but never arrives — a finite sample never buys
    // certainty.
    expect(threeHundred).toBeLessThan(1);
  });

  it('is always a lower bound — never above the observed proportion', () => {
    for (const n of [1, 5, 50, 500]) {
      const ratings = Array(n).fill(4); // 4★ → 0.75 on [0,1]
      const bound = wilsonLowerBound(ratings);

      expect(bound).toBeLessThanOrEqual(0.75);
      expect(bound).toBeGreaterThanOrEqual(0);
    }
  });

  it('an all-one-star venue bounds near zero, not below it', () => {
    const bound = wilsonLowerBound(Array(20).fill(1));

    expect(bound).toBeGreaterThanOrEqual(0);
    expect(bound).toBeLessThan(0.2);
  });

  it('no reviews returns 0 — the absence of a score, for the caller to place', () => {
    expect(wilsonLowerBound([])).toBe(0);
  });
});

describe('assertValidRating', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i', (r) => {
    expect(() => assertValidRating(r)).not.toThrow();
  });

  it.each([0, 6, -1, 4.5, NaN, Infinity])('REJECTS %p rather than clamping it', (r) => {
    // Clamping a 7 to a 5 hides the bug that produced the 7.
    expect(() => assertValidRating(r)).toThrow(/whole number from 1 to 5/);
  });
});
