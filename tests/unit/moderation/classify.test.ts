/**
 * @jest-environment node
 *
 * Node, not jsdom: MSW's interceptors need the fetch/Request globals that jsdom
 * does not provide. Same reason as tests/unit/helpers/msw.test.ts.
 */
import {
  REJECT_THRESHOLD,
  REVIEW_THRESHOLD,
  decide,
  moderateOrQueue,
} from '@/lib/moderation/classify';

import { setModerationScores, useMswServer } from '../../helpers/msw';

useMswServer();

describe('the moderation policy', () => {
  it('approves ordinary text', () => {
    const r = decide({ harassment: 0.01, violence: 0.002 });

    expect(r.decision).toBe('APPROVED');
    expect(r.reason).toBeNull();
  });

  it('sends a MIDDLING score to a human rather than the bin', () => {
    // A classifier is an advisor, not a judge. "This place is a nightmare and
    // the owner is a monster" is a legitimate review that a model may well
    // score as harassment.
    const r = decide({ harassment: 0.4 });

    expect(r.decision).toBe('NEEDS_REVIEW');
    expect(r.reason).toBe('harassment');
  });

  it('sends even a HIGH harassment score to a human, not to auto-reject', () => {
    // Deliberate. Context is exactly what the classifier does not have, and a
    // wrongly-deleted honest review is a user we lose silently.
    const r = decide({ harassment: 0.95 });

    expect(r.decision).toBe('NEEDS_REVIEW');
  });

  it('AUTO-REJECTS the categories where a false positive is survivable and a false negative is not', () => {
    // A wrongly-hidden review is a bad day. Published sexual content involving
    // a minor is a catastrophe. The asymmetry is the whole reason this list
    // exists — and the reason it is SHORT.
    const r = decide({ 'sexual/minors': 0.8, harassment: 0.9 });

    expect(r.decision).toBe('REJECTED');
    expect(r.reason).toBe('sexual/minors');
  });

  it('auto-rejects on the CATEGORY, not on whichever category happened to score highest', () => {
    // 'sexual/minors' is above its threshold but 'harassment' scores higher.
    // Checking only the max would let this through to a queue.
    const r = decide({ 'sexual/minors': 0.6, harassment: 0.99 });

    expect(r.decision).toBe('REJECTED');
    expect(r.reason).toBe('sexual/minors');
  });

  it('the thresholds are ordered — reject is stricter than review', () => {
    expect(REVIEW_THRESHOLD).toBeLessThan(REJECT_THRESHOLD);
  });

  it('reports every score so a human can judge the machine as well as the text', () => {
    const scores = { harassment: 0.4, violence: 0.1 };
    expect(decide(scores).scores).toEqual(scores);
  });
});

describe('moderateOrQueue', () => {
  it('approves clean text end-to-end', async () => {
    setModerationScores({ harassment: 0.001 });

    const r = await moderateOrQueue('Great courts, friendly staff.');
    expect(r.decision).toBe('APPROVED');
  });

  it('flags text the classifier is unsure about', async () => {
    setModerationScores({ harassment: 0.45 });

    const r = await moderateOrQueue('some borderline text');
    expect(r.decision).toBe('NEEDS_REVIEW');
  });

  it('an OUTAGE queues the item — it does NOT publish it', async () => {
    // The failure mode that matters most in this file.
    //
    // If a classifier outage defaulted to APPROVED, then the way to get
    // anything at all onto the site would be to attack our moderation
    // provider — and nobody would notice, because nothing would error.
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const r = await moderateOrQueue('anything at all');

      expect(r.decision).toBe('NEEDS_REVIEW');
      expect(r.decision).not.toBe('APPROVED');
      expect(r.reason).toBe('classifier_unavailable');
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });

  it('never throws — a caller making a publish decision must always get an answer', async () => {
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      await expect(moderateOrQueue('text')).resolves.toBeDefined();
    } finally {
      if (key !== undefined) process.env.OPENAI_API_KEY = key;
    }
  });
});
