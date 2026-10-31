import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { failureCode, type Db } from '../db/client.js';

export const healthRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: z.strictObject({ status: z.literal('ok') }),
          503: z.strictObject({ status: z.literal('unavailable') }),
        },
      },
    },
    async (request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return reply.send({ status: 'ok' });
      } catch (err) {
        request.log.error({ route: '/health', code: failureCode(err) }, 'database unreachable');
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
};
