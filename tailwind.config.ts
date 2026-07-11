import type { Config } from 'tailwindcss';

/**
 * Semantic tokens only. The brand hue is the playerz green; every other
 * colour is referenced through a semantic name (bg-default, content-muted,
 * border-subtle …) so a rebrand touches this file and nothing else.
 * P02 ports the full token system from inflect-compliance.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          500: '#16A34A',
          600: '#15803D',
          700: '#166534',
        },
      },
    },
  },
  plugins: [],
};

export default config;
