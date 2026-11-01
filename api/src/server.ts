import { buildApp } from './app.js';
import { createDb, failureCode } from './db/client.js';
import { loadEnv } from './env.js';
import { runAggregate, scheduleAggregate, warnAboutThreshold } from './jobs/aggregate.js';

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
const app = await buildApp({ db, logLevel: env.LOG_LEVEL });
warnAboutThreshold(app.log, env.CONFIRM_MIN_VOTES);

let running: Promise<void> | null = null;

function aggregate(): void {
  if (running) return;
  running = runAggregate(db, env.CONFIRM_MIN_VOTES)
    .then(
      () => {},
      (err: unknown) => {
        app.log.error({ job: 'aggregate', code: failureCode(err) }, 'aggregate failed');
      },
    )
    .finally(() => {
      running = null;
    });
}

const stopAggregate = scheduleAggregate(aggregate, env.AGGREGATE_INTERVAL_MINUTES);

async function shutdown(): Promise<void> {
  stopAggregate();
  try {
    await app.close();
    await running;
    await client.end({ timeout: 5 });
  } catch (err) {
    app.log.error({ code: failureCode(err) }, 'shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: env.HOST, port: env.PORT });
