import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { BODY_LIMIT_BYTES } from './config.js';
import { failureCode, RacedAggregateError, type Db } from './db/client.js';
import { embeddingsRoutes } from './routes/embeddings.js';
import { healthRoutes } from './routes/health.js';
import { verdictsRoutes } from './routes/verdicts.js';
import { votesRoutes } from './routes/votes.js';

export interface BuildAppOptions {
  db: Db;
  logStream?: { write(line: string): void };
  logLevel?: string;
}

// Racing the aggregate job: a foreign-key failure or a deadlock. The client retries.
const RETRY_LATER_CODES = new Set(['23503', '40P01']);

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'not_found',
  413: 'too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

function statusOf(err: unknown): number {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return 500;
  return typeof err.statusCode === 'number' ? err.statusCode : 500;
}

export async function buildApp({ db, logStream, logLevel = 'info' }: BuildAppOptions) {
  const app = Fastify({
    // Trust one hop: only Caddy talks to the API, and it sets X-Forwarded-For to the real
    // client. It has to be a function. Fastify treats `trustProxy: 1` as trusting nobody,
    // which would put every client behind Caddy's own address and one shared rate limit.
    trustProxy: (_address, hop) => hop < 1,
    bodyLimit: BODY_LIMIT_BYTES,
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: logLevel,
      // Requests carry IPs and URLs, and errors carry query values. `err` is a backstop:
      // our own log lines never pass it, but Fastify's internal ones do.
      serializers: {
        req: () => ({}),
        res: () => ({}),
        err: (err) => ({ type: 'error', message: '', stack: '', code: failureCode(err) }),
      },
      ...(logStream ? { stream: logStream } : {}),
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Fastify's default 404 puts the URL in its response and its log.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  // Answers with a short code and never the input. A 5xx logs only a fixed string, the
  // route and the SQLSTATE, because Drizzle puts query values in the error's message.
  app.setErrorHandler((err, request, reply) => {
    // A route may have set this before it failed, and an error must never be cached.
    reply.removeHeader('cache-control');
    const status = statusOf(err);
    if (status < 500) return reply.code(status).send({ error: CLIENT_ERROR_CODES[status] ?? 'bad_request' });
    const code = failureCode(err);
    request.log.error({ route: request.routeOptions.url, code }, 'request failed');
    if (err instanceof RacedAggregateError || RETRY_LATER_CODES.has(code)) {
      return reply.code(503).send({ error: 'unavailable' });
    }
    return reply.code(500).send({ error: 'internal' });
  });

  // In memory, so IPs never reach the disk. Routes opt in; /health doesn't.
  await app.register(rateLimit, { global: false });

  await app.register(healthRoutes, { db });
  await app.register(votesRoutes, { db });
  await app.register(embeddingsRoutes, { db });
  await app.register(verdictsRoutes, { db });
  return app;
}
