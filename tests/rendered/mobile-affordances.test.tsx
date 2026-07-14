import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { ScrollToTop } from '@/components/mobile/ScrollToTop';
import { haptic } from '@/lib/haptics';
import { usePullToRefresh } from '@/lib/hooks/use-pull-to-refresh';

jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));

const messages = { common: { scrollToTop: 'Back to top' } };

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

/** Drag from y1 to y2 on the window. */
function pull(from: number, to: number) {
  fireEvent.touchStart(window, { touches: [{ clientY: from, clientX: 0 }] });
  fireEvent.touchMove(window, { touches: [{ clientY: to, clientX: 0 }] });
  fireEvent.touchEnd(window, { changedTouches: [{ clientY: to, clientX: 0 }] });
}

describe('pull to refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setScrollY(0);
  });

  it('fires when the user pulls down AT THE TOP', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderHook(() => usePullToRefresh(onRefresh));

    await act(async () => {
      pull(100, 400); // 300px down → well past the threshold
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it('does NOT fire when the page is scrolled away from the top', async () => {
    // THE rule. Without it the gesture fires while the user is halfway down a
    // list dragging their thumb to scroll UP. They did not ask to refresh; the
    // list reloads under them and the item they were reaching for is gone.
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    setScrollY(800);

    renderHook(() => usePullToRefresh(onRefresh));

    await act(async () => {
      pull(100, 400);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not fire on a short pull', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderHook(() => usePullToRefresh(onRefresh));

    await act(async () => {
      pull(100, 140); // 40px raw → ~16px after resistance
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not fire when pulling UP', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderHook(() => usePullToRefresh(onRefresh));

    await act(async () => {
      pull(400, 100); // upward
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('buzzes ONCE when the threshold is crossed, not on every move', async () => {
    // A phone vibrating sixty times a second is not feedback, it is a fault.
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderHook(() => usePullToRefresh(onRefresh));

    await act(async () => {
      fireEvent.touchStart(window, { touches: [{ clientY: 100, clientX: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 400, clientX: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 420, clientX: 0 }] });
      fireEvent.touchMove(window, { touches: [{ clientY: 440, clientX: 0 }] });
      fireEvent.touchEnd(window, { changedTouches: [{ clientY: 440, clientX: 0 }] });
    });

    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', async () => {
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderHook(() => usePullToRefresh(onRefresh, { enabled: false }));

    await act(async () => {
      pull(100, 400);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('scroll to top', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.scrollTo = jest.fn();
  });

  it('is HIDDEN until the user has scrolled two screens', () => {
    // A button that is always there permanently covers the bottom-right corner
    // of every page, including the ones you can see the top of.
    setScrollY(100);

    render(withIntl(<ScrollToTop />));

    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  });

  it('appears after two screens', () => {
    setScrollY(1700); // > 800 * 2

    render(withIntl(<ScrollToTop />));

    expect(screen.getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
  });

  it('is at least 44px — a miss scrolls the list, which is the opposite of what you wanted', () => {
    setScrollY(1700);

    render(withIntl(<ScrollToTop />));

    const button = screen.getByRole('button', { name: 'Back to top' });

    // size-11 = 44px in Tailwind's 4px scale.
    expect(button.className).toContain('size-11');
  });

  it('scrolls to the top and buzzes', () => {
    setScrollY(1700);

    render(withIntl(<ScrollToTop />));
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));

    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(haptic).toHaveBeenCalledWith('tap');
  });
});
