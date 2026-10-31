import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Past about 35,791 minutes, setInterval overflows and fires straight away, on a loop.
  AGGREGATE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(35000).default(60),
});

export type Env = z.infer<typeof schema>;

// Names only in the error: DATABASE_URL holds the database password.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = parsed.error.issues.map((issue) => issue.path.join('.'));
  throw new Error(`invalid environment: ${[...new Set(names)].join(', ')}`);
}
