import { sql } from 'drizzle-orm';
import {
  AGGREGATE_BOOT_DELAY_MS,
  CONFIRM_MIN_SHARE,
  CONFIRM_MIN_VOTES,
  HID_WEIGHT,
  LONE_HASH_DAYS,
  LONE_HASH_MIN_VOTES,
  MERGE_MAX_BITS,
} from '../config.js';
import type { Db, Tx } from '../db/client.js';

// Any fixed number works, as long as nothing else in this database takes the same lock.
export const AGGREGATE_LOCK_KEY = 487_204_116;

type Queryable = Db | Tx;

// Each new hash joins the oldest root within MERGE_MAX_BITS. One at a time and in order,
// because a hash checked early can be the root a later one joins. Roots never chain:
// only an unchecked hash gets a canonical_id, and it can only point at a root.
export async function mergeNearDuplicates(db: Queryable): Promise<void> {
  const unchecked = await db.execute<{ id: string }>(sql`
    select id from hashes where not checked order by first_seen, phash
  `);
  for (const { id } of unchecked) {
    await db.execute(sql`
      update hashes h
      set checked = true,
          canonical_id = (
            select r.id from hashes r
            where r.canonical_id is null
              and r.checked
              and r.hash_version = h.hash_version
              and (r.band0 = h.band0 or r.band1 = h.band1 or r.band2 = h.band2 or r.band3 = h.band3)
              and bit_count((r.phash # h.phash)::bit(64)) <= ${MERGE_MAX_BITS}
            order by r.first_seen, r.phash
            limit 1
          )
      where h.id = ${id}
    `);
  }
}

// Counts each picture and upserts its verdict. Only checked roots count, so a hash
// committed after the merge step waits for the next run instead of getting a verdict
// before it had the chance to join a root. `published` takes a new seq only when it
// changes, or on a new row that's published, so clients fetch just what changed.
export async function updateVerdicts(db: Queryable, minVotes = CONFIRM_MIN_VOTES): Promise<void> {
  await db.execute(sql`
    with counted as (
      select r.id as hash_id,
             count(v.token)::integer as vote_count,
             coalesce(sum(case v.source when 'rated' then 1 else ${HID_WEIGHT}::double precision end)
               filter (where v.label = 'ai'), 0)::double precision as ai_weight,
             coalesce(sum(case v.source when 'rated' then 1 else ${HID_WEIGHT}::double precision end)
               filter (where v.label = 'real'), 0)::double precision as real_weight
      from hashes r
      join hashes member on member.id = r.id or member.canonical_id = r.id
      left join votes v on v.hash_id = member.id
      where r.canonical_id is null and r.checked
      group by r.id
    ),
    labelled as (
      select c.*,
             case
               when c.vote_count < ${minVotes}::integer then null
               when c.ai_weight / (c.ai_weight + c.real_weight) >= ${CONFIRM_MIN_SHARE}::double precision
                 then 'ai'::vote_label
               when c.real_weight / (c.ai_weight + c.real_weight) >= ${CONFIRM_MIN_SHARE}::double precision
                 then 'real'::vote_label
             end as label
      from counted c
    ),
    judged as (
      select l.*,
             case
               when l.vote_count < ${minVotes}::integer then 'pending'::verdict_status
               when l.label is not null then 'confirmed'::verdict_status
               else 'disputed'::verdict_status
             end as status,
             l.label is not distinct from 'ai'::vote_label as published
      from labelled l
    )
    insert into verdicts (hash_id, status, label, ai_weight, real_weight, vote_count, published, seq)
    select j.hash_id, j.status, j.label, j.ai_weight, j.real_weight, j.vote_count, j.published,
           case when j.published and old.hash_id is null then nextval('verdict_seq') end
    from judged j
    left join verdicts old on old.hash_id = j.hash_id
    on conflict (hash_id) do update
      set status = excluded.status,
          label = excluded.label,
          ai_weight = excluded.ai_weight,
          real_weight = excluded.real_weight,
          vote_count = excluded.vote_count,
          published = excluded.published,
          seq = case when verdicts.published <> excluded.published then nextval('verdict_seq')
                     else verdicts.seq end
      where (verdicts.status, verdicts.label, verdicts.ai_weight, verdicts.real_weight,
             verdicts.vote_count, verdicts.published)
            is distinct from
            (excluded.status, excluded.label, excluded.ai_weight, excluded.real_weight,
             excluded.vote_count, excluded.published)
  `);
}

// A merged hash takes its root's fate, through the cascade on canonical_id.
export async function expireLoneHashes(db: Queryable): Promise<void> {
  await db.execute(sql`
    delete from hashes r
    where r.canonical_id is null
      and r.checked
      and r.first_seen < current_date - ${LONE_HASH_DAYS}::integer
      and (
        select count(*) from votes v
        join hashes member on member.id = v.hash_id
        where member.id = r.id or member.canonical_id = r.id
      ) < ${LONE_HASH_MIN_VOTES}::integer
  `);
}

// A lowered threshold publishes verdicts on fewer votes than the docs promise, so it
// shouldn't be able to stay on unnoticed.
export function warnAboutThreshold(log: { warn(message: string): void }, minVotes: number): void {
  if (minVotes !== CONFIRM_MIN_VOTES) log.warn(`CONFIRM_MIN_VOTES is ${minVotes}, not ${CONFIRM_MIN_VOTES}`);
}

// Runs the job on its interval, and once soon after startup. The interval starts over
// on every deploy, so frequent deploys could otherwise keep it from ever firing. An
// interval of 0 turns both off. Unref'd, so the timers alone never keep the process
// alive. Returns a function that stops them.
export function scheduleAggregate(run: () => void, intervalMinutes: number): () => void {
  if (intervalMinutes <= 0) return () => {};
  const first = setTimeout(run, AGGREGATE_BOOT_DELAY_MS).unref();
  const every = setInterval(run, intervalMinutes * 60_000).unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

// Returns false when another run holds the lock.
export async function runAggregate(db: Db, minVotes = CONFIRM_MIN_VOTES): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${AGGREGATE_LOCK_KEY}::bigint) as locked`,
    );
    if (!row?.locked) return false;
    await mergeNearDuplicates(tx);
    await updateVerdicts(tx, minVotes);
    await expireLoneHashes(tx);
    return true;
  });
}
