import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * P02 — the design-system gallery must render every primitive family,
 * flip themes, and carry zero critical/serious accessibility violations.
 */

const SECTIONS = [
  'Button',
  'Input',
  'Textarea',
  'Checkbox',
  'RadioGroup',
  'Switch',
  'StatusBadge',
  'Skeleton',
  'EmptyState',
  'ErrorState',
  'Tooltip',
  'CopyButton',
  'Modal',
  'Sheet',
  'ConfirmDialog',
  'CalendarMonth',
];

test.describe('design system', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design-system');
  });

  test('renders a section for every primitive family', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('design system');

    for (const section of SECTIONS) {
      await expect(
        page.getByRole('heading', { level: 2, name: section, exact: true }),
        `missing section: ${section}`,
      ).toBeVisible();
    }
  });

  test('theme toggle flips data-theme', async ({ page }) => {
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');

    await page.getByRole('button', { name: /theme/i }).click();

    await expect
      .poll(async () => html.getAttribute('data-theme'), {
        message: 'data-theme did not change after clicking the toggle',
      })
      .not.toBe(before);
  });

  test('has zero critical or serious axe violations', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Surface the actual rule + node so a failure is actionable rather
    // than just a count.
    const report = blocking
      .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.target.join(' ')}`)
      .join('\n');

    expect(blocking, `axe found ${blocking.length} blocking violation(s):\n${report}`).toEqual([]);
  });
});
