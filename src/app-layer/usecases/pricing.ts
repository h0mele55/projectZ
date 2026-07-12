import type { Prisma } from '@prisma/client';

/**
 * The pricing rule engine.
 *
 * A club's pricing is genuinely fiddly — "weekends after 6pm cost 50% more,
 * unless you're a member, and Court 1 is a flat €40 on holidays". Encoding
 * that as `if` statements means a code deploy every time a club changes its
 * prices, so rules are data.
 *
 * `ruleTrace` is not a debugging luxury. When a player asks "why did this
 * cost €36?", support needs an answer, and "the engine decided" is not one.
 * Every rule considered is returned, matched or not, with the reason.
 */

export interface PricingRuleRow {
  id: string;
  name: string;
  priority: number;
  conditionsJson: Prisma.JsonValue;
  multiplier: Prisma.Decimal | number | null;
  fixedPriceCents: number | null;
}

export interface PricingConditions {
  /** 0 = Sunday … 6 = Saturday, in the VENUE's timezone. */
  dayOfWeek?: number[];
  /** { from: "18:00", to: "22:00" } — venue-local clock time. */
  timeRange?: { from: string; to: string };
  playerTags?: string[];
  membershipLevel?: string;
}

export interface PriceContext {
  basePriceCents: number;
  /** Venue-local day-of-week and clock times, resolved by the caller. */
  localDayOfWeek: number;
  localStartMinutes: number;
  localEndMinutes: number;
  playerTags?: readonly string[];
  membershipLevel?: string | null;
}

export interface RuleTraceEntry {
  ruleId: string;
  ruleName: string;
  priority: number;
  matched: boolean;
  reason: string;
}

export interface PriceResult {
  finalPriceCents: number;
  appliedRuleId: string | null;
  ruleTrace: RuleTraceEntry[];
}

export function parseClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Does the rule's time window CONTAIN the whole booking?
 *
 * Deliberately containment, not overlap. A "peak 18:00–22:00" surcharge
 * must not be charged on a booking that runs 17:00–18:30 and merely clips
 * the edge of peak — the club would be charging peak rates for an off-peak
 * hour, and the player would (rightly) call it a bug.
 *
 * The rule must span the ENTIRE booking to apply.
 */
function timeRangeCovers(
  range: { from: string; to: string },
  startMinutes: number,
  endMinutes: number,
): boolean {
  const from = parseClock(range.from);
  const to = parseClock(range.to);
  return startMinutes >= from && endMinutes <= to;
}

function evaluate(
  conditions: PricingConditions,
  ctx: PriceContext,
): { matched: boolean; reason: string } {
  if (conditions.dayOfWeek && conditions.dayOfWeek.length > 0) {
    if (!conditions.dayOfWeek.includes(ctx.localDayOfWeek)) {
      return { matched: false, reason: `dayOfWeek ${ctx.localDayOfWeek} not in rule` };
    }
  }

  if (conditions.timeRange) {
    if (!timeRangeCovers(conditions.timeRange, ctx.localStartMinutes, ctx.localEndMinutes)) {
      return {
        matched: false,
        reason: `booking is not fully inside ${conditions.timeRange.from}–${conditions.timeRange.to}`,
      };
    }
  }

  if (conditions.playerTags && conditions.playerTags.length > 0) {
    const tags = ctx.playerTags ?? [];
    const hit = conditions.playerTags.some((t) => tags.includes(t));
    if (!hit) {
      return {
        matched: false,
        reason: `player lacks any of [${conditions.playerTags.join(', ')}]`,
      };
    }
  }

  if (conditions.membershipLevel) {
    if (ctx.membershipLevel !== conditions.membershipLevel) {
      return { matched: false, reason: `membership is not ${conditions.membershipLevel}` };
    }
  }

  return { matched: true, reason: 'all conditions satisfied' };
}

export function computePrice(rules: readonly PricingRuleRow[], ctx: PriceContext): PriceResult {
  // Highest priority wins. Sort explicitly rather than trusting the caller's
  // ORDER BY — a repository refactor that drops the order clause would
  // silently start applying the wrong price, and nothing would fail.
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);

  const ruleTrace: RuleTraceEntry[] = [];
  let applied: PricingRuleRow | null = null;

  for (const rule of ordered) {
    const conditions = (rule.conditionsJson ?? {}) as PricingConditions;
    const { matched, reason } = evaluate(conditions, ctx);

    ruleTrace.push({
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      matched: matched && applied === null,
      reason: applied !== null ? 'skipped — a higher-priority rule already matched' : reason,
    });

    if (matched && applied === null) applied = rule;
  }

  if (!applied) {
    return { finalPriceCents: ctx.basePriceCents, appliedRuleId: null, ruleTrace };
  }

  // A fixed price OVERRIDES a multiplier when both are set. "€40 flat on
  // holidays" must not also get the ×1.5 weekend surcharge stapled on.
  if (applied.fixedPriceCents != null) {
    return {
      finalPriceCents: applied.fixedPriceCents,
      appliedRuleId: applied.id,
      ruleTrace,
    };
  }

  const multiplier = applied.multiplier == null ? 1 : Number(applied.multiplier);

  return {
    // Round, don't floor. Flooring systematically under-charges by up to a
    // cent on every booking — small, but it is the club's money and it never
    // reconciles.
    finalPriceCents: Math.round(ctx.basePriceCents * multiplier),
    appliedRuleId: applied.id,
    ruleTrace,
  };
}
