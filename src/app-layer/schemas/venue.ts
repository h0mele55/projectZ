import { z } from 'zod';

import { cuidSchema, paginationSchema, sportSchema } from './common';

/** P08+ fills these in as the use cases land. */
export const venueIdSchema = z.object({ venueId: cuidSchema });
export const listVenuesSchema = paginationSchema.extend({
  sport: sportSchema.optional(),
});
