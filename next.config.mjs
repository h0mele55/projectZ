import createNextIntlPlugin from 'next-intl/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next 16 turns typedRoutes ON by default. The ported components build
  // hrefs as plain template strings (`/t/${slug}/dashboard`), which the
  // generated RouteImpl union rejects. Routes don't exist yet anyway —
  // P06 lands them. Revisit once the route tree is real.
  typedRoutes: false,
};

// Points next-intl at our request config (default lookup path is
// ./i18n/request.ts, which is not where ours lives).
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

export default withNextIntl(nextConfig);
