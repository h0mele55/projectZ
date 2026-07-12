/**
 * Content moderation.
 *
 * ─── Why OpenAI omni-moderation and not the obvious alternatives ─────
 *
 * The product is Bulgarian. That single fact eliminates most of the field:
 *
 *   • Perspective API   — no Bulgarian. Not "poor Bulgarian": none.
 *   • Detoxify          — English/Russian/others; no Bulgarian.
 *   • A keyword blocklist — trivially defeated by spacing, transliteration
 *     (Cyrillic ↔ Latin), or any word the author of the list did not think of.
 *     Worse, it produces confident FALSE positives on ordinary words.
 *
 * `omni-moderation-latest` is multilingual and covers Bulgarian. It is also
 * free to call, which matters when every review passes through it.
 *
 * ─── The moderator is an ADVISOR, not a judge ────────────────────────
 *
 * It returns scores, and scores are wrong sometimes. So:
 *
 *   • a HIGH score auto-rejects — but only for categories where a false
 *     positive is survivable (a wrongly-hidden review is a bad day; a published
 *     piece of sexual content about a minor is a catastrophe);
 *   • a MIDDLING score goes to a HUMAN QUEUE, not to the bin;
 *   • an OUTAGE fails to the QUEUE, never to "publish".
 *
 * That last one is the important one. If the classifier is down and we default
 * to publishing, then the way to get anything at all onto the site is to attack
 * our moderation provider. The safe default under uncertainty is "a person
 * looks at it", not "ship it".
 */

export type ModerationDecision = 'APPROVED' | 'NEEDS_REVIEW' | 'REJECTED';

export interface ModerationResult {
  decision: ModerationDecision;
  /** The highest score across all categories, 0..1. */
  maxScore: number;
  /** Which category drove the decision. */
  reason: string | null;
  /** Every category the model flagged, for the human reviewer to read. */
  scores: Record<string, number>;
}

/**
 * Categories where we auto-reject rather than queue.
 *
 * Deliberately short. Everything NOT on this list — harassment, hate,
 * violence — goes to a human even at a high score, because context is exactly
 * what a classifier does not have. "This place is a nightmare, the owner is a
 * monster" is a legitimate review; a model may score it as harassment.
 */
const AUTO_REJECT_CATEGORIES = new Set(['sexual/minors', 'self-harm/instructions']);

/** Above this, a human must look before it goes live. */
export const REVIEW_THRESHOLD = 0.3;

/** Above this, in an auto-reject category, it never goes live at all. */
export const REJECT_THRESHOLD = 0.5;

interface OpenAiModerationResponse {
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

export class ModerationUnavailableError extends Error {
  readonly code = 'moderation_unavailable';
  constructor(cause: string) {
    super(`Moderation is unavailable: ${cause}`);
    this.name = 'ModerationUnavailableError';
  }
}

/**
 * Classify a piece of user text.
 *
 * NEVER throws for a caller who has to make a publish decision — see
 * `moderateOrQueue`. This function throws so that the caller must decide,
 * explicitly, what an outage means. Swallowing the error here and returning
 * APPROVED would make "the classifier is down" indistinguishable from "the text
 * is fine".
 */
export async function classifyText(text: string): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModerationUnavailableError('OPENAI_API_KEY is not set');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      // A moderation call must not hold a request open indefinitely. If it is
      // slow, treat it as down and queue the item — that is a five-second
      // delay for a reviewer, not a hung page for the author.
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    throw new ModerationUnavailableError(e instanceof Error ? e.message : 'network error');
  }

  if (!res.ok) {
    throw new ModerationUnavailableError(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenAiModerationResponse;
  const result = json.results?.[0];

  if (!result) throw new ModerationUnavailableError('empty response');

  return decide(result.category_scores ?? {});
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

  // Auto-reject is checked per-category, not against the max. A 0.9 on
  // "sexual/minors" must reject even if some other category scored higher.
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
 *
 * The failure mode this prevents: classifier goes down → every review is
 * auto-approved → the site is unmoderated for as long as the outage lasts, and
 * nobody notices because nothing errored.
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
