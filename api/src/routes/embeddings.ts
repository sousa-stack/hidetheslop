import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CURRENT_MODEL_VERSION, EMBEDDING_MIN_VOTES, EMBEDDINGS_RATE_LIMIT, MAX_BATCH } from '../config.js';
import type { Db } from '../db/client.js';
import { hexToSigned } from '../lib/phash.js';
import { phashSchema, tokenSchema } from './votes.js';

const VECTOR_BYTES = 512;

// Buffer ignores anything it can't decode, so only a round trip proves the text is the
// one canonical base64 of 512 bytes.
function isCanonicalVector(text: string): boolean {
  const bytes = Buffer.from(text, 'base64');
  return bytes.length === VECTOR_BYTES && bytes.toString('base64') === text;
}

const body = z.strictObject({
  hashVersion: z.literal(1),
  modelVersion: z.literal(CURRENT_MODEL_VERSION),
  items: z
    .array(
      z.strictObject({
        phash: phashSchema,
        token: tokenSchema,
        vector: z.string().refine(isCanonicalVector),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
});

export const embeddingsRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    '/v1/embeddings',
    {
      config: { rateLimit: EMBEDDINGS_RATE_LIMIT },
      schema: {
        body,
        response: { 202: z.strictObject({ accepted: z.number() }) },
      },
    },
    async (request, reply) => {
      const { hashVersion, modelVersion, items } = request.body;
      // Sorted so two requests can't deadlock on each other's rows.
      const sorted = [...items].sort((a, b) => (a.phash < b.phash ? -1 : 1));

      await db.transaction(async (tx) => {
        for (const item of sorted) {
          await tx.execute(sql`
            insert into embeddings (hash_id, model_version, vector)
            select h.id, ${modelVersion}::smallint, ${Buffer.from(item.vector, 'base64')}::bytea
            from hashes h
            where h.hash_version = ${hashVersion}::smallint
              and h.phash = ${hexToSigned(item.phash)}::bigint
              and exists (select 1 from votes v where v.hash_id = h.id and v.token = ${item.token})
              and (select count(*) from votes v where v.hash_id = h.id) >= ${EMBEDDING_MIN_VOTES}
              and not exists (
                select 1 from embeddings e
                join hashes member on member.id = e.hash_id
                where e.model_version = ${modelVersion}::smallint
                  and coalesce(member.canonical_id, member.id) = coalesce(h.canonical_id, h.id)
              )
            on conflict do nothing
          `);
        }
      });

      // Items received, not stored, so the response doesn't reveal what the server holds.
      return reply.code(202).send({ accepted: items.length });
    },
  );
};
