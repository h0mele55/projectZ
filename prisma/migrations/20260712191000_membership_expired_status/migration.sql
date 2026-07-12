-- A lapsed subscription is not a suspension.
--
-- `SUSPENDED` is a deliberate act by the club (unpaid dues, a conduct issue).
-- `EXPIRED` is a card that stopped working. Showing a member the first message
-- when the second thing happened is how you lose a member.
--
-- Note: ALTER TYPE ... ADD VALUE cannot be USED in the same transaction that
-- adds it (Postgres restriction). It is only added here; the first code that
-- writes it runs in a later transaction, which is fine.
ALTER TYPE "MembershipStatus" ADD VALUE 'EXPIRED';
