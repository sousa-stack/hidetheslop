CREATE TABLE "blocked_hashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash_version" smallint NOT NULL,
	"phash" bigint NOT NULL,
	"note" varchar(80),
	CONSTRAINT "blocked_hashes_version_phash_unique" UNIQUE("hash_version","phash")
);
