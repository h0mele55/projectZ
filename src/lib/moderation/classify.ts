/**
 * Content moderation, via the Claude API.
 *
 * ─── Why Claude, and what it costs us ────────────────────────────────
 *
 * The product is Bulgarian, and that eliminates most of the field outright:
 *
 *   • Perspective API   — no Bulgarian. Not "poor Bulgarian": none.
 *   • Detoxify          — English/Russian/others; no Bulgarian.
 *   • A keyword blocklist — defeated by transliteration (Cyrillic ↔ Latin) or
 *     any word the author of the list did not think of, while producing
 *     confident FALSE positives on ordinary words.
 *
 * Claude covers Bulgarian properly, and — unlike a purpose-built classifier —
 * it can WEIGH CONTEXT. That matters more here than it sounds. A scoring
 * classifier reads "this place is a nightmare, the owner is a monster" as
 * harassment; it is a legitimate, angry review. A model that reads the sentence
 * can tell the difference between abuse and a bad night at the tennis club.
 *
 * The honest trade-off: Claude has NO moderation endpoint. This is the Messages
 * API doing classification, which means:
 *
 *   1. It COSTS TOKENS per review, where OpenAI's /moderations was free. Hence
 *      Haiku — the smallest, fastest model — because this is a short, extremely
 *      high-volume, low-ambiguity task. Paying Opus rates to read a two-line
 *      review would be absurd.
 *
 *   2. A chat model returns TEXT, and text has to be parsed. We do NOT parse
 *      prose. The call forces a TOOL CALL (`tool_choice`), so the model's only
 *      way to answer is to fill in a typed schema. There is no "sometimes it
 *      replies with a preamble" failure mode, because a preamble is not a
 *      legal response.
 *
 * ─── The moderator is an ADVISOR, not a judge ────────────────────────
 *
 *   • a HIGH score auto-rejects — but ONLY for categories where a false
 *     positive is survivable (a wrongly-hidden review is a bad day; published
 *     sexual content involving a minor is a catastrophe);
 *   • a MIDDLING score goes to a HUMAN QUEUE, not to the bin;
 *   • an OUTAGE fails to the QUEUE, never to "publish".
 *
 * That last one is the important one. If the classifier is down and we default
 * to publishing, then the way to get anything at all onto the site is to attack
 * our moderation provider — and nobody notices, because nothing errored. The
 * safe default under uncertainty is "a person looks at it", not "ship it".
 */

export type ModerationDecision = 'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED';

export interface ModerationResult {
  decision: ModerationDecision;
  /** The highest score across all categories, 0..1. */
  maxScore: number;
  /** Which category drove the decision. */
  reason: string | null;
  /** Every category score, for the human reviewer to read. */
  scores: Record<string, number>;
}

/**
 * The smallest model that can do this job.
 *
 * Moderation is a short, high-volume, low-ambiguity classification. Spending a
 * frontier model on it would multiply the bill by an order of magnitude to
 * decide whether "great courts, friendly staff" is abusive.
 */
export const MODERATION_MODEL = 'claude-haiku-4-5-20251001';

/**
 * The categories we ask about.
 *
 * Kept deliberately close to the industry-standard taxonomy so the thresholds
 * below mean something, and so a future switch of provider is a change of
 * transport rather than a change of policy.
 */
export const CATEGORIES = [
  'harassment',
  'hate',
  'sexual',
  'sexual/minors',
  'violence',
  'self-harm',
  'self-harm/instructions',
  'spam',
] as const;

/**
 * The same categories, in names the API will actually accept.
 *
 * Anthropic validates tool property keys against `^[a-zA-Z0-9_.-]{1,64}$`.
 * `sexual/minors` and `self-harm/instructions` contain a SLASH, so a tool
 * schema using the canonical names is rejected with a 400 — every single call,
 * for every piece of text.
 *
 * Note the failure that would have caused: `moderateOrQueue` swallows an
 * outage and queues the item. So a 400 on every call does not throw, does not
 * page anyone, and does not fail a test. It just quietly sends EVERY review to
 * the human queue, forever, and the moderators wonder why the backlog never
 * ends. It was caught by calling the real API, and only by that.
 *
 * The canonical names stay as our POLICY vocabulary — they are what we store in
 * `moderationScoresJson` and what the thresholds are written against — so a
 * future change of provider is a change of this map, not of the policy.
 */
const WIRE_KEY: Record<(typeof CATEGORIES)[number], string> = {
  harassment: 'harassment',
  hate: 'hate',
  sexual: 'sexual',
  'sexual/minors': 'sexual_minors',
  violence: 'violence',
  'self-harm': 'self_harm',
  'self-harm/instructions': 'self_harm_instructions',
  spam: 'spam',
};

/** Wire key → canonical category. */
const FROM_WIRE: Record<string, string> = Object.fromEntries(
  Object.entries(WIRE_KEY).map(([canonical, wire]) => [wire, canonical]),
);

/**
 * Categories where we auto-reject rather than queue.
 *
 * Deliberately two entries long. Everything NOT on this list — harassment,
 * hate, violence — goes to a human even at a high score, because context is
 * exactly what an automated judgement lacks and a wrongly-deleted honest review
 * is a user we lose silently.
 */
const AUTO_REJECT_CATEGORIES = new Set(['sexual/minors', 'self-harm/instructions']);

/** Above this, a human must look before it goes live. */
export const REVIEW_THRESHOLD = 0.3;

/** Above this, in an auto-reject category, it never goes live at all. */
export const REJECT_THRESHOLD = 0.5;

export class ModerationUnavailableError extends Error {
  readonly code = 'moderation_unavailable';
  constructor(cause: string) {
    super(`Moderation is unavailable: ${cause}`);
    this.name = 'ModerationUnavailableError';
  }
}

/**
 * The tool the model is FORCED to call.
 *
 * This is the whole reason we can trust the output. With `tool_choice` set to
 * this tool, the model cannot reply with prose, cannot hedge, and cannot
 * preface its answer — the only legal response is a filled-in schema. We never
 * regex a model's paragraph and hope.
 */
const CLASSIFY_TOOL = {
  name: 'report_moderation_scores',
  description:
    'Report the likelihood that the text falls into each moderation category. ' +
    'Score each category from 0 (definitely not) to 1 (definitely yes).',
  input_schema: {
    type: 'object' as const,
    properties: Object.fromEntries(
      CATEGORIES.map((c) => [
        WIRE_KEY[c],
        { type: 'number', minimum: 0, maximum: 1, description: `Likelihood of ${c}.` },
      ]),
    ),
    required: CATEGORIES.map((c) => WIRE_KEY[c]),
  },
};

const SYSTEM_PROMPT = `You are a content moderation classifier for a sports venue booking platform in Bulgaria. You will be shown a user-submitted review, message, or profile text, which may be in Bulgarian, English, or a mix, and may use Latin transliteration of Cyrillic.

Score the text against each moderation category. Be precise, not squeamish:

- A NEGATIVE review is not harassment. "This place is filthy, the owner is rude and the courts are a disgrace" is a legitimate, angry customer review. Score it LOW.
- Harassment means targeting a person with abuse, threats, or slurs — not criticising a business.
- Profanity alone is not abuse. Bulgarians swear; a frustrated review with a swear word in it is still a review.
- Judge the text as it is, not what it might be hinting at.

You are advising a human reviewer, not passing sentence. Report what you actually see.`;

interface AnthropicResponse {
  content: Array<{
    type: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
}

/**
 * Classify a piece of user text.
 *
 * THROWS on failure, deliberately. See `moderateOrQueue` — the caller who has
 * to make a publish decision must state explicitly what an outage means.
 * Swallowing the error here and returning APPROVED would make "the classifier
 * is down" indistinguishable from "the text is fine".
 */
export async function classifyText(text: string): Promise<ModerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ModerationUnavailableError('ANTHROPIC_API_KEY is not set');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        // The tool schema is the entire output. It does not need room to think
        // out loud, and capping this protects against a runaway bill on a
        // pathological input.
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [CLASSIFY_TOOL],
        // FORCE the tool. Without this the model may answer in prose, and we
        // would be parsing English to decide whether to publish something.
        tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
        messages: [{ role: 'user', content: text }],
      }),
      // A moderation call must not hold a request open indefinitely. If it is
      // slow, treat it as down and queue the item — a short delay for a human
      // reviewer, not a hung page for the author.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new ModerationUnavailableError(e instanceof Error ? e.message : 'network error');
  }

  if (!res.ok) {
    throw new ModerationUnavailableError(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as AnthropicResponse;

  const toolUse = json.content?.find((b) => b.type === 'tool_use' && b.name === CLASSIFY_TOOL.name);

  // We forced the tool, so its absence means something is genuinely wrong (an
  // API change, a truncated response). That is an OUTAGE, not an approval —
  // treating a malformed response as "clean" is exactly the bug this whole file
  // is arranged to prevent.
  if (!toolUse?.input) {
    throw new ModerationUnavailableError('model did not return the classification tool call');
  }

  return decide(coerceScores(toolUse.input));
}

/**
 * Take only what we asked for, and only if it is a real number in range.
 *
 * The model is forced into a schema, but the schema is enforced by the model,
 * not by us. A category we do not recognise is ignored; a score that is not a
 * number in [0,1] is dropped rather than coerced — `Number(undefined)` is NaN,
 * and NaN silently loses every comparison, which would make a missing score
 * read as APPROVED.
 */
function coerceScores(input: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};

  for (const [wire, raw] of Object.entries(input)) {
    // Translate back to the canonical name. An unrecognised key is ignored —
    // we score against OUR taxonomy, not whatever the model decided to invent.
    const category = FROM_WIRE[wire];
    if (!category) continue;

    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;

    out[category] = Math.min(1, Math.max(0, raw));
  }

  return out;
}

/** The scoring policy, separated from the transport so it can be tested alone. */
export function decide(scores: Record<string, number>): ModerationResult {
  let maxScore = 0;
  let maxCategory: string | null = null;

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxCategory = category;
    }
  }

  // Auto-reject is checked PER CATEGORY, not against the max. A 0.6 on
  // "sexual/minors" must reject even when some other category scored 0.99.
  for (const [category, score] of Object.entries(scores)) {
    if (AUTO_REJECT_CATEGORIES.has(category) && score >= REJECT_THRESHOLD) {
      return { decision: 'REJECTED', maxScore: score, reason: category, scores };
    }
  }

  if (maxScore >= REVIEW_THRESHOLD) {
    return { decision: 'NEEDS_REVIEW', maxScore, reason: maxCategory, scores };
  }

  return { decision: 'APPROVED', maxScore, reason: null, scores };
}

/**
 * Classify, and on ANY failure, send it to a human.
 *
 * This is the function callers should use. It cannot throw, and it cannot
 * return APPROVED for text it did not successfully classify.
 */
export async function moderateOrQueue(text: string): Promise<ModerationResult> {
  try {
    return await classifyText(text);
  } catch {
    return {
      decision: 'NEEDS_REVIEW',
      maxScore: 0,
      reason: 'classifier_unavailable',
      scores: {},
    };
  }
}
