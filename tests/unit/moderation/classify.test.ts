/**
 * @jest-environment node
 *
 * Node, not jsdom: MSW's interceptors need the fetch/Request globals that jsdom
 * does not provide. Same reason as tests/unit/helpers/msw.test.ts.
 */
import {
  MODERATION_MODEL,
  REJECT_THRESHOLD,
  REVIEW_THRESHOLD,
  decide,
  moderateOrQueue,
} from '@/lib/moderation/classify';

import { findRequest, mswServer, setModerationScores, useMswServer } from '../../helpers/msw';
import { http, HttpResponse } from 'msw';

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
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const r = await moderateOrQueue('anything at all');

      expect(r.decision).toBe('NEEDS_REVIEW');
      expect(r.decision).not.toBe('APPROVED');
      expect(r.reason).toBe('classifier_unavailable');
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it('never throws — a caller making a publish decision must always get an answer', async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(moderateOrQueue('text')).resolves.toBeDefined();
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe('the Claude call itself', () => {
  it('FORCES the tool call — the model is never given the option to reply in prose', async () => {
    setModerationScores({ harassment: 0.01 });
    await moderateOrQueue('Great courts.');

    const body = findRequest('anthropic.com')!.body as Record<string, unknown>;

    // Without tool_choice, the model may answer in English — and we would be
    // parsing a paragraph to decide whether to publish someone's review.
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_moderation_scores' });
    expect(body.tools).toHaveLength(1);

    // The cheapest model that can do the job. Moderation is short, high-volume
    // and low-ambiguity; a frontier model would multiply the bill to decide
    // whether "friendly staff" is abusive.
    expect(body.model).toBe(MODERATION_MODEL);
  });

  it('reads scores out of the tool_use block, not out of text', async () => {
    setModerationScores({ harassment: 0.42, violence: 0.01 });

    const r = await moderateOrQueue('borderline');

    expect(r.scores.harassment).toBe(0.42);
    expect(r.decision).toBe('NEEDS_REVIEW');
  });

  it('a response with NO tool call is an OUTAGE, not an approval', async () => {
    // The model replied with prose — an API change, a refusal, a truncation.
    // Treating that as "clean" is precisely the bug this file is arranged to
    // prevent: unparseable must never mean publishable.
    mswServer.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I cannot help with that.' }],
        }),
      ),
    );

    const r = await moderateOrQueue('anything');

    expect(r.decision).toBe('NEEDS_REVIEW');
    expect(r.decision).not.toBe('APPROVED');
    expect(r.reason).toBe('classifier_unavailable');
  });

  it('a MISSING score is dropped, not coerced — NaN would silently read as clean', async () => {
    // Number(undefined) is NaN, and NaN loses every comparison. A category the
    // model failed to fill in must not become an implicit zero.
    setModerationScores({ harassment: 0.9 } as Record<string, number>);

    const r = await moderateOrQueue('text');

    expect(Number.isNaN(r.maxScore)).toBe(false);
    expect(r.maxScore).toBe(0.9);
    expect(r.decision).toBe('NEEDS_REVIEW');
  });

  it('an out-of-range score is clamped rather than trusted', async () => {
    mswServer.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({
          content: [
            {
              type: 'tool_use',
              name: 'report_moderation_scores',
              input: { harassment: 4.7, violence: -2 },
            },
          ],
        }),
      ),
    );

    const r = await moderateOrQueue('text');

    expect(r.maxScore).toBeLessThanOrEqual(1);
    expect(Math.min(...Object.values(r.scores))).toBeGreaterThanOrEqual(0);
  });

  it('an HTTP error queues rather than publishes', async () => {
    mswServer.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({ error: 'overloaded' }, { status: 529 }),
      ),
    );

    const r = await moderateOrQueue('text');
    expect(r.decision).toBe('NEEDS_REVIEW');
  });
});

describe('the tool schema is one the API will actually accept', () => {
  // Anthropic validates tool property keys against ^[a-zA-Z0-9_.-]{1,64}$.
  // The canonical taxonomy has `sexual/minors` and `self-harm/instructions` in
  // it, and a SLASH is rejected — with a 400, on every call, for every text.
  //
  // The reason this needs a test rather than a comment: `moderateOrQueue`
  // swallows an outage and QUEUES. So a 400 on every request does not throw,
  // does not page anyone, and does not fail any behavioural test. It silently
  // sends every review on the platform to the human queue, forever. It was
  // found by calling the real API and only by that; this stops it coming back.
  const API_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

  it('every wire key the tool declares is a legal property name', async () => {
    setModerationScores({ harassment: 0.01 });
    await moderateOrQueue('text');

    const body = findRequest('anthropic.com')!.body as {
      tools: Array<{ input_schema: { properties: Record<string, unknown>; required: string[] } }>;
    };

    const properties = Object.keys(body.tools[0]!.input_schema.properties);
    expect(properties.length).toBeGreaterThan(0);

    for (const key of properties) {
      expect(key).toMatch(API_KEY_PATTERN);
    }
    for (const key of body.tools[0]!.input_schema.required) {
      expect(key).toMatch(API_KEY_PATTERN);
    }
  });

  it('the canonical names, which we still score against, would NOT be legal', () => {
    // The negative control: proves the pattern above is actually load-bearing
    // and not just passing because everything happens to be alphanumeric.
    expect('sexual/minors').not.toMatch(API_KEY_PATTERN);
    expect('self-harm/instructions').not.toMatch(API_KEY_PATTERN);
  });

  it('a wire score maps back to its canonical category name', async () => {
    // The round trip. The API answers `sexual_minors`; our policy, our
    // thresholds and the scores we store all speak `sexual/minors`.
    setModerationScores({ 'sexual/minors': 0.9 });

    const r = await moderateOrQueue('text');

    expect(r.decision).toBe('REJECTED');
    expect(r.reason).toBe('sexual/minors');
    expect(r.scores['sexual/minors']).toBe(0.9);
  });
});
