CREATE TABLE IF NOT EXISTS "library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid,
	"source_site_id" uuid,
	"source_domain" text NOT NULL,
	"name" text NOT NULL,
	"type" "test_type" NOT NULL,
	"wp_post_type" "wp_post_type" DEFAULT 'page' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text NOT NULL,
	"winner_key" text NOT NULL,
	"winner_label" text NOT NULL,
	"lift_pct" numeric(8, 2),
	"p_best" numeric(5, 4),
	"sessions" integer DEFAULT 0 NOT NULL,
	"change_ops" jsonb,
	"snapshots" jsonb,
	"final_stats" jsonb,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "winner_notified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_items" ADD CONSTRAINT "library_items_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_items" ADD CONSTRAINT "library_items_source_site_id_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "library_items_test_idx" ON "library_items" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_items_type_idx" ON "library_items" USING btree ("type");