import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';

/**
 * TABS THAT BEHAVE LIKE NATIVE TABS.
 *
 * Two things, and the second is where the bugs live.
 */

const messages = { common: { table: { detailSections: 'Sections' } } };

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'courts', label: 'Courts' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'history', label: 'History' },
] as const;

function renderLayout(
  activeTab: string,
  onTabChange = jest.fn(),
  children: React.ReactNode = <p>body</p>,
) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EntityDetailLayout
        title="Sofia Padel"
        tabs={TABS as never}
        activeTab={activeTab as never}
        onTabChange={onTabChange}
      >
        {children}
      </EntityDetailLayout>
    </NextIntlClientProvider>,
  );
  return onTabChange;
}

/** Fire a horizontal swipe on the tab panel. */
function swipe(from: number, to: number, target?: Element) {
  const panel = screen.getByRole('tabpanel');
  const el = target ?? panel;

  fireEvent.touchStart(el, { touches: [{ clientX: from, clientY: 100 }] });
  fireEvent.touchEnd(panel, { changedTouches: [{ clientX: to, clientY: 100 }] });
}

describe('the active tab is brought into view', () => {
  it('scrolls the active tab into view on mount', () => {
    // The strip is overflow-x-auto: with six tabs on a phone only two or three
    // are visible. Deep-link to the fifth — which a notification link does — and
    // the user lands on a page whose selected tab is off-screen. Nothing on
    // screen says why, so it reads as the wrong page.
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderLayout('history');

    expect(scrollIntoView).toHaveBeenCalled();

    const opts = scrollIntoView.mock.calls[0]![0] as ScrollIntoViewOptions;
    expect(opts.inline).toBe('nearest');

    // `block: 'nearest'` is the one people forget. Without it the browser also
    // scrolls the PAGE vertically to centre the tab, yanking the user away from
    // the content they came to read.
    expect(opts.block).toBe('nearest');
  });
});

describe('swipe between tabs', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('swiping LEFT moves to the next tab', () => {
    const onTabChange = renderLayout('overview');

    swipe(300, 200); // finger travels left

    expect(onTabChange).toHaveBeenCalledWith('courts');
  });

  it('swiping RIGHT moves to the previous tab', () => {
    const onTabChange = renderLayout('reviews');

    swipe(200, 300); // finger travels right

    expect(onTabChange).toHaveBeenCalledWith('courts');
  });

  it('does NOT wrap around at the last tab', () => {
    // A swipe past the end landing on the first tab is disorienting: the user
    // swipes "forward" and travels backwards through the whole strip. Native
    // pagers stop at the ends.
    const onTabChange = renderLayout('history');

    swipe(300, 200);

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('ignores a drag that is too short to be a swipe', () => {
    const onTabChange = renderLayout('overview');

    swipe(300, 280); // 20px — a tap that wobbled

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('ignores a mostly-VERTICAL drag', () => {
    // Every downward flick has some horizontal component. A naive threshold turns
    // "scroll the page" into "change tab", which is infuriating because the user
    // did not ask for it and cannot see what they did wrong.
    const onTabChange = renderLayout('overview');

    const panel = screen.getByRole('tabpanel');
    fireEvent.touchStart(panel, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 240, clientY: 300 }] });

    // 60px across, 200px down — that is a scroll.
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('does NOT steal a swipe that starts on a horizontally-scrollable table', () => {
    // THE test. Without this the user cannot reach the columns of a table they
    // can plainly see, because every attempt to scroll it changes the tab.
    const onTabChange = renderLayout(
      'overview',
      jest.fn(),
      <div data-scroller style={{ overflowX: 'auto' }}>
        <table>
          <tbody>
            <tr>
              <td>wide</td>
            </tr>
          </tbody>
        </table>
      </div>,
    );

    const scroller = document.querySelector('[data-scroller]') as HTMLElement;

    // jsdom reports 0 for both, so make it genuinely scrollable.
    Object.defineProperty(scroller, 'scrollWidth', { value: 1200, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 390, configurable: true });

    swipe(300, 200, scroller);

    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('DOES swipe when the scrollable child has nothing to scroll', () => {
    // An `overflow-x-auto` container whose content fits is not scrollable.
    // Swallowing the gesture for it would disable swipe across most of the app.
    const onTabChange = renderLayout(
      'overview',
      jest.fn(),
      <div data-scroller style={{ overflowX: 'auto' }}>
        <p>narrow</p>
      </div>,
    );

    const scroller = document.querySelector('[data-scroller]') as HTMLElement;
    Object.defineProperty(scroller, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 390, configurable: true });

    swipe(300, 200, scroller);

    expect(onTabChange).toHaveBeenCalledWith('courts');
  });
});
