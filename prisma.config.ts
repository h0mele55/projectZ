/**
 * Prisma 7 config. Prisma 7 rejects an inline `url` on the `datasource db`
 * block, so connection URLs are resolved here for the CLI (migrate /
 * generate / studio). The runtime client reads the env var directly.
 */
import path from 'node:path';

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
});
