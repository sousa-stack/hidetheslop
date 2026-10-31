import { and, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { VERDICTS_PAGE_SIZE, VERDICTS_RATE_LIMIT } from '../config.js';
import type { Db } from '../db/client.js';
import { hashes, verdicts } from '../db/schema.js';
import { signedToHex } from '../lib/phash.js';

// A response cached for an hour shouldn't carry one client's rate-limit counts.
const NO_RATE_HEADERS = {
  'x-ratelimit-limit': false,
  'x-ratelimit-remaining': false,
  'x-ratelimit-reset': false,
};

export const verdictsRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/v1/verdicts',
    {
      config: {
        rateLimit: {
          ...VERDICTS_RATE_LIMIT,
          addHeaders: NO_RATE_HEADERS,
          addHeadersOnExceeding: NO_RATE_HEADERS,
        },
      },
      schema: {
        querystring: z.strictObject({
          since: z.coerce.number().int().min(0).default(0),
          hashVersion: z.coerce.number().pipe(z.literal(1)),
        }),
        response: {
          200: z.strictObject({
            seq: z.number(),
            add: z.array(z.string()),
            remove: z.array(z.string()),
            more: z.boolean(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { since, hashVersion } = request.query;
      const rows = await db
        .select({ phash: hashes.phash, published: verdicts.published, seq: verdicts.seq })
        .from(verdicts)
        .innerJoin(hashes, eq(verdicts.hashId, hashes.id))
        .where(and(eq(hashes.hashVersion, hashVersion), gt(verdicts.seq, since)))
        .orderBy(verdicts.seq)
        .limit(VERDICTS_PAGE_SIZE + 1);

      const page = rows.slice(0, VERDICTS_PAGE_SIZE);
      const add = page.filter((row) => row.published).map((row) => signedToHex(row.phash));
      // Someone starting from nothing has nothing to remove.
      const remove =
        since === 0 ? [] : page.filter((row) => !row.published).map((row) => signedToHex(row.phash));

      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send({
        seq: page.at(-1)?.seq ?? since,
        add,
        remove,
        more: rows.length > VERDICTS_PAGE_SIZE,
      });
    },
  );
};
