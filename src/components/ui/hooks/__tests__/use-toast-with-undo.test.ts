/**
 * Epic 67 — `useToastWithUndo` hardening tests.
 *
 * Lives next to the hook (rather than under `tests/rendered/`) so the
 * timer + cancellation contract for the destructive-action foundation
 * is reviewable in the same diff that touches the hook itself. The
 * complementary baseline tests at `tests/rendered/use-toast-with-undo.
 * test.tsx` cover the happy path (delay default, undo cancel, custom
 * delay, concurrent triggers, trigger identity); this file covers the
 * regressions a future refactor is most likely to introduce.
 *
 * Edge classes covered:
 *
 *   1. Rapid-fire triggers (5+ in flight) — every commit fires once
 *      and only once at the correct deadline.
 *   2. Re-trigger after undo on the same logical resource — proves
 *      the pending Map cleanup doesn't leak the previous entry.
 *   3. Cancellation edge cases — unknown id and post-settle id both
 *      return false (idempotent contract).
 *   4. Hook unmount mid-window — commit STILL fires (Gmail "undo
 *      send" UX is the load-bearing invariant; tying the timer to
 *      component lifecycle would silently drop destructive commits
 *      on navigation).
 *   5. Synchronous throw in `action` — routed to `onError`, never
 *      bubbled as an unhandled rejection.
 *   6. Race: explicit cancel arriving after the commit timer has
 *      fired — cancel returns false, commit is not double-counted.
 *
 * The mock seam mirrors the baseline test (`toast.custom` captured
 * synchronously, `toast.dismiss` recorded). Hardening tests exercise
 * the trigger directly without rendering the UndoToast component —
 * the visual variant has its own dedicated test at
 * `tests/rendered/undo-toast.test.tsx`.
 */
/** @jest-environment jsdom */

import { createElement, useEffect } from 'react';
import type { ReactElement } from 'react';
import { act, render } from '@testing-library/react';

// ─── sonner mock ────────────────────────────────────────────────────

interface CapturedCustomCall {
  id: number;
  factory: (id: number) => ReactElement;
}
const customCalls: CapturedCustomCall[] = [];
const dismissedIds: Array<string | number> = [];
let nextSonnerId = 1;

jest.mock('sonner', () => ({
  toast: {
    custom: (factory: (id: number) => ReactElement) => {
      const id = nextSonnerId++;
      customCalls.push({ id, factory });
      return id;
    },
    dismiss: (id: string | number) => {
      dismissedIds.push(id);
      return id;
    },
  },
}));

import {
  useToastWithUndo,
  cancelPendingUndoToast,
  __resetPendingUndoToastsForTest,
  __pendingUndoToastCountForTest,
  type TriggerUndoToast,
} from '@/components/ui/hooks/use-toast-with-undo';

// ─── Harness ────────────────────────────────────────────────────────

function Harness({ onReady }: { onReady: (api: TriggerUndoToast) => void }) {
  const trigger = useToastWithUndo();
  useEffect(() => {
    onReady(trigger);
  }, [trigger, onReady]);
  return null;
}

function captureTrigger(): {
  trigger: TriggerUndoToast;
  unmount: () => void;
} {
  let captured: TriggerUndoToast | null = null;
  const result = render(
    createElement(Harness, {
      onReady: (t: TriggerUndoToast) => {
        captured = t;
      },
    }),
  );
  if (!captured) throw new Error('trigger not captured');
  return { trigger: captured, unmount: result.unmount };
}

interface TriggeredCallProps {
  onUndo: (pendingId: string) => void;
  pendingId: string;
}

function clickUndo(call: CapturedCustomCall): void {
  const element = call.factory(call.id);
  const props = (element as unknown as { props: TriggeredCallProps }).props;
  props.onUndo(props.pendingId);
}

beforeEach(() => {
  customCalls.length = 0;
  dismissedIds.length = 0;
  nextSonnerId = 1;
  __resetPendingUndoToastsForTest();
});

// ─── Edge case 1 — rapid-fire triggers ──────────────────────────────

describe('useToastWithUndo — rapid-fire triggers', () => {
  it('five triggers in quick succession all commit at their own deadlines', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const actions = Array.from({ length: 5 }, () => jest.fn().mockResolvedValue(undefined));
      const onCommits = Array.from({ length: 5 }, () => jest.fn());

      await act(async () => {
        actions.forEach((action, i) => {
          trigger({
            action,
            message: `Action ${i + 1}`,
            undoMessage: 'Undo',
            delayMs: 1000 * (i + 1),
            onCommit: onCommits[i],
          });
        });
      });

      expect(__pendingUndoToastCountForTest()).toBe(5);
      actions.forEach((a) => expect(a).not.toHaveBeenCalled());

      // Advance to 1s — first commit only.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(actions[0]).toHaveBeenCalledTimes(1);
      expect(actions.slice(1).every((a) => a.mock.calls.length === 0)).toBe(true);
      expect(__pendingUndoToastCountForTest()).toBe(4);

      // Advance to 5s — every commit fires exactly once.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      actions.forEach((a) => expect(a).toHaveBeenCalledTimes(1));
      onCommits.forEach((c) => expect(c).toHaveBeenCalledTimes(1));
      expect(__pendingUndoToastCountForTest()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ten parallel triggers settle independently — no cross-contamination via the Map', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const actions = Array.from({ length: 10 }, () => jest.fn().mockResolvedValue(undefined));

      await act(async () => {
        actions.forEach((action, i) => {
          trigger({
            action,
            message: `Item ${i}`,
            undoMessage: 'Undo',
            delayMs: 5000,
          });
        });
      });

      // Cancel the third entry's trigger via the captured undo
      // callback. Every other commit must still fire.
      await act(async () => {
        clickUndo(customCalls[2]!);
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      actions.forEach((a, i) => {
        if (i === 2) expect(a).not.toHaveBeenCalled();
        else expect(a).toHaveBeenCalledTimes(1);
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Edge case 2 — re-trigger after undo on the same resource ───────

describe('useToastWithUndo — re-trigger after undo', () => {
  it('trigger → undo → trigger fires the second commit cleanly', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const firstAction = jest.fn().mockResolvedValue(undefined);
      const secondAction = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        trigger({
          action: firstAction,
          message: 'Risk deleted',
          undoMessage: 'Undo',
        });
      });
      await act(async () => {
        clickUndo(customCalls[0]!);
      });

      // Same logical resource, fresh action — fires on schedule.
      await act(async () => {
        trigger({
          action: secondAction,
          message: 'Risk deleted',
          undoMessage: 'Undo',
        });
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(firstAction).not.toHaveBeenCalled();
      expect(secondAction).toHaveBeenCalledTimes(1);
      expect(__pendingUndoToastCountForTest()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Edge case 3 — cancellation edge cases ──────────────────────────

describe('useToastWithUndo — cancellation idempotency', () => {
  it('cancelPendingUndoToast(unknownId) returns false', () => {
    expect(cancelPendingUndoToast('never-existed')).toBe(false);
  });

  it('cancelPendingUndoToast after the commit fires returns false', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        trigger({
          action,
          message: 'x',
          undoMessage: 'Undo',
        });
      });

      // Pull pendingId off the captured element BEFORE commit.
      const element = customCalls[0]!.factory(customCalls[0]!.id);
      const pendingId = (
        element as unknown as {
          props: { pendingId: string };
        }
      ).props.pendingId;

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(action).toHaveBeenCalledTimes(1);
      // Post-commit cancel is a no-op.
      expect(cancelPendingUndoToast(pendingId)).toBe(false);
      // And the Map has been cleaned up.
      expect(__pendingUndoToastCountForTest()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancelPendingUndoToast called twice on the same id returns false the second time', async () => {
    const { trigger } = captureTrigger();
    const action = jest.fn().mockResolvedValue(undefined);

    await act(async () => {
      trigger({
        action,
        message: 'x',
        undoMessage: 'Undo',
      });
    });

    const element = customCalls[0]!.factory(customCalls[0]!.id);
    const pendingId = (
      element as unknown as {
        props: { pendingId: string };
      }
    ).props.pendingId;

    expect(cancelPendingUndoToast(pendingId)).toBe(true);
    expect(cancelPendingUndoToast(pendingId)).toBe(false);
  });
});

// ─── Edge case 4 — hook unmount mid-window ──────────────────────────

describe('useToastWithUndo — lifecycle safety', () => {
  it('unmounting the component mid-window does NOT cancel the commit', async () => {
    jest.useFakeTimers();
    try {
      const { trigger, unmount } = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);
      const onCommit = jest.fn();

      await act(async () => {
        trigger({
          action,
          message: 'Risk deleted',
          undoMessage: 'Undo',
          onCommit,
        });
      });

      // Halfway through the window the consumer unmounts (e.g.
      // the user navigated away). The commit should STILL fire
      // — that's the Gmail "undo send" load-bearing invariant.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2500);
      });
      unmount();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2500);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('unmount + re-mount still uses the same module-level pending Map', async () => {
    jest.useFakeTimers();
    try {
      const first = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        first.trigger({
          action,
          message: 'x',
          undoMessage: 'Undo',
        });
      });
      first.unmount();

      // Mount a second instance. The Map carries the original
      // pending entry, and a second trigger from this fresh
      // hook coexists with it.
      const second = captureTrigger();
      const secondAction = jest.fn().mockResolvedValue(undefined);
      await act(async () => {
        second.trigger({
          action: secondAction,
          message: 'y',
          undoMessage: 'Undo',
        });
      });

      expect(__pendingUndoToastCountForTest()).toBe(2);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(action).toHaveBeenCalledTimes(1);
      expect(secondAction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Edge case 5 — sync throw in action ─────────────────────────────

describe('useToastWithUndo — error routing', () => {
  it('a synchronously-thrown action error is routed to onError', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const onError = jest.fn();
      const onCommit = jest.fn();

      await act(async () => {
        trigger({
          action: () => {
            throw new Error('sync-boom');
          },
          onError,
          onCommit,
          message: 'x',
          undoMessage: 'Undo',
        });
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(onError).toHaveBeenCalledTimes(1);
      const err = onError.mock.calls[0]?.[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('sync-boom');
      expect(onCommit).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('an async action that rejects is routed to onError too (regression baseline)', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const onError = jest.fn();

      await act(async () => {
        trigger({
          action: async () => {
            throw new Error('async-boom');
          },
          onError,
          message: 'x',
          undoMessage: 'Undo',
        });
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as Error).message).toBe('async-boom');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Edge case 6 — explicit cancel race ─────────────────────────────

describe('useToastWithUndo — cancel-after-commit race', () => {
  it('cancelPendingUndoToast called after the timer fires returns false and does not re-run undoAction', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);
      const undoAction = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        trigger({
          action,
          undoAction,
          message: 'x',
          undoMessage: 'Undo',
        });
      });

      const element = customCalls[0]!.factory(customCalls[0]!.id);
      const pendingId = (
        element as unknown as {
          props: { pendingId: string };
        }
      ).props.pendingId;

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      // Commit fired exactly once.
      expect(action).toHaveBeenCalledTimes(1);

      // A cancellation that arrives after the commit must NOT
      // re-run undoAction — that would visually undo a commit
      // the user already saw succeed.
      expect(cancelPendingUndoToast(pendingId)).toBe(false);
      expect(undoAction).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clicking Undo after the commit fires does not re-run undoAction', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);
      const undoAction = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        trigger({
          action,
          undoAction,
          message: 'x',
          undoMessage: 'Undo',
        });
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      // Late Undo click — already settled.
      await act(async () => {
        clickUndo(customCalls[0]!);
      });

      expect(action).toHaveBeenCalledTimes(1);
      expect(undoAction).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Edge case 7 — Gracefully tolerated odd inputs ──────────────────

describe('useToastWithUndo — defensive contract', () => {
  it('trigger returns the sonner toast id (truthy number) so callers can chain dismiss', async () => {
    const { trigger } = captureTrigger();
    let id: string | number = '';
    await act(async () => {
      id = trigger({
        action: () => Promise.resolve(),
        message: 'x',
        undoMessage: 'Undo',
      });
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('custom delayMs of 0 still defers commit through one timer tick', async () => {
    jest.useFakeTimers();
    try {
      const { trigger } = captureTrigger();
      const action = jest.fn().mockResolvedValue(undefined);

      await act(async () => {
        trigger({
          action,
          message: 'x',
          undoMessage: 'Undo',
          delayMs: 0,
        });
      });

      // Synchronous after trigger → still pending (setTimeout 0
      // is the timer-loop earliest tick, not synchronous).
      expect(action).not.toHaveBeenCalled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
