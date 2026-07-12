import { expect, test } from '@playwright/test';

/**
 * The public discovery flow, driven through a real browser against a real
 * database — the path every player takes before they ever sign in.
 */
test.describe('venue discovery', () => {
  test('the venues page lists venues and links through to one', async ({ page }) => {
    await page.goto('/venues');

    await expect(page.getByRole('heading', { level: 1, name: 'Play' })).toBeVisible();

    const cards = page.getByRole('link').filter({ hasText: /Sofia|Plovdiv/ });
    await expect(cards.first()).toBeVisible();
  });

  test('has no critical or serious accessibility violations', async ({ page }) => {
    const AxeBuilder = (await import('@axe-core/playwright')).default;
    await page.goto('/venues');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    const report = blocking
      .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.target.join(' ')}`)
      .join('\n');

    expect(blocking, `axe found ${blocking.length} blocking violation(s):\n${report}`).toEqual([]);
  });
});
