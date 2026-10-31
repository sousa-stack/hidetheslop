CREATE TYPE "public"."verdict_status" AS ENUM('pending', 'confirmed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."vote_label" AS ENUM('ai', 'real');--> statement-breakpoint
CREATE TYPE "public"."vote_source" AS ENUM('rated', 'hid');--> statement-breakpoint
CREATE SEQUENCE "public"."verdict_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "embeddings" (
	"hash_id" uuid NOT NULL,
	"model_version" smallint NOT NULL,
	"vector" "bytea" NOT NULL,
	CONSTRAINT "embeddings_hash_id_model_version_pk" PRIMARY KEY("hash_id","model_version")
);
--> statement-breakpoint
CREATE TABLE "hashes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash_version" smallint NOT NULL,
	"phash" bigint NOT NULL,
	"canonical_id" uuid,
	"checked" boolean DEFAULT false NOT NULL,
	"first_seen" date DEFAULT current_date NOT NULL,
	"band0" integer GENERATED ALWAYS AS (((phash >> 48) & 65535)::integer) STORED,
	"band1" integer GENERATED ALWAYS AS (((phash >> 32) & 65535)::integer) STORED,
	"band2" integer GENERATED ALWAYS AS (((phash >> 16) & 65535)::integer) STORED,
	"band3" integer GENERATED ALWAYS AS ((phash & 65535)::integer) STORED,
	CONSTRAINT "hashes_version_phash_unique" UNIQUE("hash_version","phash")
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"hash_id" uuid PRIMARY KEY NOT NULL,
	"status" "verdict_status" NOT NULL,
	"label" "vote_label",
	"ai_weight" real NOT NULL,
	"real_weight" real NOT NULL,
	"vote_count" integer NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"seq" bigint
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"hash_id" uuid NOT NULL,
	"token" char(32) NOT NULL,
	"label" "vote_label" NOT NULL,
	"source" "vote_source" NOT NULL,
	CONSTRAINT "votes_hash_id_token_pk" PRIMARY KEY("hash_id","token")
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_hash_id_hashes_id_fk" FOREIGN KEY ("hash_id") REFERENCES "public"."hashes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hashes" ADD CONSTRAINT "hashes_canonical_id_hashes_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."hashes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_hash_id_hashes_id_fk" FOREIGN KEY ("hash_id") REFERENCES "public"."hashes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_hash_id_hashes_id_fk" FOREIGN KEY ("hash_id") REFERENCES "public"."hashes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hashes_band0_idx" ON "hashes" USING btree ("hash_version","band0");--> statement-breakpoint
CREATE INDEX "hashes_band1_idx" ON "hashes" USING btree ("hash_version","band1");--> statement-breakpoint
CREATE INDEX "hashes_band2_idx" ON "hashes" USING btree ("hash_version","band2");--> statement-breakpoint
CREATE INDEX "hashes_band3_idx" ON "hashes" USING btree ("hash_version","band3");--> statement-breakpoint
CREATE INDEX "hashes_canonical_id_idx" ON "hashes" USING btree ("canonical_id");--> statement-breakpoint
CREATE INDEX "hashes_unchecked_idx" ON "hashes" USING btree ("first_seen","phash") WHERE not checked;--> statement-breakpoint
CREATE INDEX "verdicts_seq_idx" ON "verdicts" USING btree ("seq");