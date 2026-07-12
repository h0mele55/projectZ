import { z } from 'zod';

import { cuidSchema, paginationSchema, sportSchema } from './common';

/** P08+ fills these in as the use cases land. */
export const sessionIdSchema = z.object({ sessionId: cuidSchema });
export const listSessionsSchema = paginationSchema.extend({
  sport: sportSchema.optional(),
});
