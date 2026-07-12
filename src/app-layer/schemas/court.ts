import { z } from 'zod';

import { cuidSchema, paginationSchema, sportSchema } from './common';

/** P08+ fills these in as the use cases land. */
export const courtIdSchema = z.object({ courtId: cuidSchema });
export const listCourtsSchema = paginationSchema.extend({
  sport: sportSchema.optional(),
});
