import { readFileSync, globSync } from 'node:fs';

/**
 * MOTION MUST BE REFUSABLE.
 *
 * `prefers-reduced-motion: reduce` is not a preference in the way a theme is a
 * preference. People set it because motion makes them ill — vestibular disorders,
 * migraine, motion sickness. A parallax hero or a spring-loaded card is, for
 * them, a page that makes them feel sick and that they cannot use.
 *
 * The design system already honours it GLOBALLY: a media query flattens every
 * duration to 1ms, so any component built on `--duration-*` or a Tailwind
 * `transition-*` utility obeys it without opting in.
 *
 * The risk is not that somebody forgets to add it. The risk is that somebody
 * REMOVES it, or writes an animation that routes around it — a hard-coded
 * `animation: 2s` in a style attribute, a JS-driven scroll, a `!important`
 * duration that the override cannot beat.
 *
 * This ratchet keeps the global escape hatch in place.
 */

const TOKENS_CSS = readFileSync('src/styles/tokens.css', 'utf8');
const GLOBALS_CSS = readFileSync('src/app/globals.css', 'utf8');
const CSS = `${TOKENS_CSS}\n${GLOBALS_CSS}`;

describe('reduced motion is honoured globally', () => {
  it('the media query exists', () => {
    expect(CSS).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  });

  it('it flattens EVERY animation and transition, not just our own tokens', () => {
    // Flattening only `--duration-*` would leave any third-party component, or
    // any hand-written keyframe, spinning happily.
    const block =
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';

    expect(block).toMatch(/animation-duration:\s*[^;]*!important/);
    expect(block).toMatch(/transition-duration:\s*[^;]*!important/);
    // A looping animation reduced to 1ms but still iterating infinitely is still
    // a flicker.
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it('it applies to pseudo-elements too', () => {
    // A ::before that spins is as sickening as a div that spins.
    const block =
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';

    expect(block).toMatch(/::before/);
    expect(block).toMatch(/::after/);
  });

  it('it disables smooth scrolling', () => {
    // Programmatic smooth-scroll is one of the worst offenders for motion
    // sickness, and it is not covered by animation/transition rules.
    const block =
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';

    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });
});

describe('no component routes around the global override', () => {
  const COMPONENTS = [
    ...globSync('src/components/**/*.{ts,tsx}'),
    ...globSync('src/app/**/*.{ts,tsx}'),
  ].map((f) => f.toString());

  it('the scan found the components', () => {
    expect(COMPONENTS.length).toBeGreaterThan(20);
  });

  it('no inline style sets an animation or transition duration', () => {
    // An inline style beats a stylesheet rule of equal specificity — but NOT an
    // `!important`. The override does use !important, so an inline duration is
    // still beaten. The reason to forbid it anyway: an inline style is invisible
    // to the audit, and the next person copies it into a place where it wins.
    const INLINE_MOTION = /style=\{\{[^}]*(?:animation|transitionDuration|animationDuration)\s*:/;

    const violations: string[] = [];

    for (const file of COMPONENTS) {
      const src = readFileSync(file, 'utf8');
      if (INLINE_MOTION.test(src)) violations.push(file);
    }

    if (violations.length > 0) {
      throw new Error(
        `Inline animation/transition durations in:\n\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          `\n\nUse the --duration-* tokens or a Tailwind transition-* utility. Those are\n` +
          `flattened to 1ms under prefers-reduced-motion; an inline duration is invisible\n` +
          `to that audit, and the next person will copy it somewhere it wins.\n\n` +
          `People set reduced-motion because motion makes them ILL. This is not a\n` +
          `stylistic preference.`,
      );
    }
  });

  it('no infinite animation is declared outside the token layer', () => {
    // `animation: spin 1s infinite` in a component is a loop the override caps at
    // one iteration — but only because the override exists. Keeping loops in the
    // token layer keeps them auditable in one place.
    const INFINITE = /animation:[^;'"`]*\binfinite\b/;

    const violations = COMPONENTS.filter((f) => INFINITE.test(readFileSync(f, 'utf8')));

    expect(violations).toEqual([]);
  });
});

// ── Negative controls ────────────────────────────────────────────────

describe('the rules fire on the code they forbid', () => {
  it('detects an inline duration', () => {
    const INLINE_MOTION = /style=\{\{[^}]*(?:animation|transitionDuration|animationDuration)\s*:/;

    expect(INLINE_MOTION.test('<div style={{ animationDuration: "2s" }} />')).toBe(true);
    expect(INLINE_MOTION.test('<div style={{ transitionDuration: "300ms" }} />')).toBe(true);
    expect(INLINE_MOTION.test('<div style={{ width: "2px" }} />')).toBe(false);
    expect(INLINE_MOTION.test('<div className="transition-colors duration-200" />')).toBe(false);
  });

  it('detects an infinite animation', () => {
    const INFINITE = /animation:[^;'"`]*\binfinite\b/;

    expect(INFINITE.test('animation: spin 1s linear infinite;')).toBe(true);
    expect(INFINITE.test('animation: fade 200ms ease-out;')).toBe(false);
  });
});
