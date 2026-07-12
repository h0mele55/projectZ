import { z } from 'zod';

import { cuidSchema, paginationSchema, sportSchema } from './common';

/** P08+ fills these in as the use cases land. */
export const coachIdSchema = z.object({ coachId: cuidSchema });
export const listCoachsSchema = paginationSchema.extend({
  sport: sportSchema.optional(),
});
