import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Db = PostgresJsDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string) {
  // Notices can quote values, so they don't go to the console.
  const client = postgres(url, { onnotice: () => {} });
  return { db: drizzle(client), client };
}

// The only part of a failed query that's safe to log. Drizzle puts query values in
// `.message` and `.params`, and the stack repeats the message.
export function failureCode(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('cause' in err)) return 'unknown';
  const { cause } = err;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return 'unknown';
  return typeof cause.code === 'string' ? cause.code : 'unknown';
}

// A hash was expired by the aggregate job in the middle of a request.
export class RacedAggregateError extends Error {}
