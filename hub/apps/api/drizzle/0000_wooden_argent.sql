CREATE TYPE "public"."device_class" AS ENUM('desktop', 'tablet', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('draft', 'qa', 'running', 'winner_found', 'inconclusive', 'awaiting_decision', 'finalising', 'archived');--> statement-breakpoint
CREATE TYPE "public"."test_type" AS ENUM('page', 'element');--> statement-breakpoint
CREATE TYPE "public"."tracker_event_type" AS ENUM('pageview', 'heartbeat', 'scroll_depth', 'scroll_stop', 'hover', 'click', 'rage_click', 'visibility_end');--> statement-breakpoint
CREATE TYPE "public"."wp_post_type" AS ENUM('post', 'page');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"device" "device_class" NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"device" "device_class" NOT NULL,
	"type" "tracker_event_type" NOT NULL,
	"url" text NOT NULL,
	"data" jsonb,
	"ts" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pageviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"visitor_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"device" "device_class" NOT NULL,
	"active_ms" integer DEFAULT 0 NOT NULL,
	"max_scroll_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"clicked" boolean DEFAULT false NOT NULL,
	"rage_clicks" integer DEFAULT 0 NOT NULL,
	"engagement_score" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"display_name" text NOT NULL,
	"site_key" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"wp_version" text,
	"plugin_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "test_type" DEFAULT 'page' NOT NULL,
	"status" "test_status" DEFAULT 'draft' NOT NULL,
	"wp_post_id" integer NOT NULL,
	"wp_post_type" "wp_post_type" DEFAULT 'page' NOT NULL,
	"wp_permalink" text NOT NULL,
	"traffic_split" integer DEFAULT 50 NOT NULL,
	"min_sample_size" integer DEFAULT 200 NOT NULL,
	"min_run_days" integer DEFAULT 7 NOT NULL,
	"confidence_threshold" numeric(4, 3) DEFAULT '0.950' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_control" boolean DEFAULT false NOT NULL,
	"traffic_weight" integer NOT NULL,
	"wp_post_id" integer,
	"preview_url" text,
	"change_ops" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pageviews" ADD CONSTRAINT "pageviews_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pageviews" ADD CONSTRAINT "pageviews_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tests" ADD CONSTRAINT "tests_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "variants" ADD CONSTRAINT "variants_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assignments_test_visitor_idx" ON "assignments" USING btree ("test_id","visitor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_test_idx" ON "assignments" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_test_idx" ON "events" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_session_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_ts_idx" ON "events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pageviews_test_variant_idx" ON "pageviews" USING btree ("test_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pageviews_session_test_idx" ON "pageviews" USING btree ("session_id","test_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sites_site_key_idx" ON "sites" USING btree ("site_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tests_site_idx" ON "tests" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tests_status_idx" ON "tests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variants_test_idx" ON "variants" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "variants_test_key_idx" ON "variants" USING btree ("test_id","key");