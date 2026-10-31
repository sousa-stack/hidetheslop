import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { failureCode } from './db/client.js';
import { loadEnv } from './env.js';

// Runs from src/ under tsx and from dist/ in the image, with drizzle/ beside both.
const migrationsFolder = join(import.meta.dirname, '..', 'drizzle');

const client = postgres(loadEnv().DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('migrations applied');
} catch (err) {
  console.error(`migration failed: ${failureCode(err)}`);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
