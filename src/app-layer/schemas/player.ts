import { z } from 'zod';

import { cuidSchema, paginationSchema, sportSchema } from './common';

/** P08+ fills these in as the use cases land. */
export const playerIdSchema = z.object({ playerId: cuidSchema });
export const listPlayersSchema = paginationSchema.extend({
  sport: sportSchema.optional(),
});
