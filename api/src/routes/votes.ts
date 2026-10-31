import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CURRENT_MODEL_VERSION, EMBEDDING_MIN_VOTES, MAX_BATCH, VOTES_RATE_LIMIT } from '../config.js';
import { RacedAggregateError, type Db } from '../db/client.js';
import { hashes, votes } from '../db/schema.js';
import { hexToSigned, signedToHex } from '../lib/phash.js';

export const phashSchema = z.string().regex(/^[0-9a-f]{16}$/);
export const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/);

const body = z.strictObject({
  hashVersion: z.literal(1),
  votes: z
    .array(
      z.strictObject({
        phash: phashSchema,
        token: tokenSchema,
        label: z.enum(['ai', 'real']),
        source: z.enum(['rated', 'hid']),
      }),
    )
    .min(1)
    .max(MAX_BATCH),
});

export const votesRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    '/v1/votes',
    {
      config: { rateLimit: VOTES_RATE_LIMIT },
      schema: {
        body,
        response: {
          202: z.strictObject({ accepted: z.number(), needEmbedding: z.array(z.string()) }),
          400: z.strictObject({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { hashVersion, votes: batch } = request.body;

      // A real client never sends this, and it would let one request confirm a picture.
      // Past this check a phash has one token, so the last vote for a phash is the last
      // vote for that phash and token.
      const latest = new Map<string, (typeof batch)[number]>();
      for (const vote of batch) {
        const seen = latest.get(vote.phash);
        if (seen && seen.token !== vote.token) return reply.code(400).send({ error: 'invalid_request' });
        latest.set(vote.phash, vote);
      }

      // Sorted so two batches can't deadlock on each other's rows.
      const sorted = [...latest.values()].sort((a, b) => (a.phash < b.phash ? -1 : 1));
      const phashes = sorted.map((vote) => hexToSigned(vote.phash));

      const needEmbedding = await db.transaction(async (tx) => {
        await tx
          .insert(hashes)
          .values(phashes.map((phash) => ({ hashVersion, phash })))
          .onConflictDoNothing();

        const stored = await tx
          .select({ id: hashes.id, phash: hashes.phash })
          .from(hashes)
          .where(and(eq(hashes.hashVersion, hashVersion), inArray(hashes.phash, phashes)));
        const idOf = new Map(stored.map((row) => [row.phash, row.id]));

        const rows = sorted.map((vote) => {
          const hashId = idOf.get(hexToSigned(vote.phash));
          if (!hashId) throw new RacedAggregateError();
          return { hashId, token: vote.token, label: vote.label, source: vote.source };
        });
        await tx
          .insert(votes)
          .values(rows)
          .onConflictDoUpdate({
            target: [votes.hashId, votes.token],
            set: { label: sql`excluded.label`, source: sql`excluded.source` },
          });

        // The gate counts votes on the exact hash, so one person rating near-identical
        // copies can't open it. "No embedding yet" looks across the whole picture.
        return tx
          .select({ phash: hashes.phash })
          .from(hashes)
          .where(
            and(
              inArray(
                hashes.id,
                rows.map((row) => row.hashId),
              ),
              sql`(select count(*) from votes v where v.hash_id = ${hashes.id}) >= ${EMBEDDING_MIN_VOTES}`,
              sql`not exists (
                select 1 from embeddings e
                join hashes member on member.id = e.hash_id
                where e.model_version = ${CURRENT_MODEL_VERSION}
                  and coalesce(member.canonical_id, member.id) = coalesce(${hashes.canonicalId}, ${hashes.id})
              )`,
            ),
          )
          .orderBy(hashes.phash);
      });

      return reply.code(202).send({
        accepted: sorted.length,
        needEmbedding: needEmbedding.map((row) => signedToHex(row.phash)),
      });
    },
  );
};
