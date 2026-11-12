// Starting points. They'll need tuning once real votes arrive.

// The default for the CONFIRM_MIN_VOTES setting, which stays 5 outside testing.
export const CONFIRM_MIN_VOTES = 5;
export const CONFIRM_MIN_SHARE = 0.8;
export const EMBEDDING_MIN_VOTES = 3;
export const MERGE_MAX_BITS = 3;
// A block reaches every stored hash this close to it, wider than a merge, because it errs
// on the side of not hiding: a slightly different copy of a real picture stays unhidden too.
// Distances come in twos; copies measured up to 4 bits apart, flyers from one template 8 or
// more, and different pictures 12 or more.
export const BLOCK_MAX_BITS = 6;
export const LONE_HASH_DAYS = 90;
// Fixed, not tied to CONFIRM_MIN_VOTES. "Fewer than 5 votes is deleted after 90 days" is a
// public promise, and a test setting mustn't move it.
export const LONE_HASH_MIN_VOTES = 5;
// "Hide slop" may only mean you don't like the post, so it counts for less than a rating.
export const HID_WEIGHT = 0.5;
export const CURRENT_MODEL_VERSION = 1;
export const VERDICTS_PAGE_SIZE = 10000;
export const MAX_BATCH = 50;

// Matches `max_size 64KB` in the Caddyfile, which Caddy reads as 64,000 bytes.
export const BODY_LIMIT_BYTES = 64_000;

// How long after startup the aggregate job first runs, as well as on its interval.
export const AGGREGATE_BOOT_DELAY_MS = 30_000;

export const VOTES_RATE_LIMIT = { max: 60, timeWindow: '1 hour' };
export const EMBEDDINGS_RATE_LIMIT = { max: 60, timeWindow: '1 hour' };
export const VERDICTS_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };
