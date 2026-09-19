CREATE TYPE "public"."heat_layer" AS ENUM('click', 'hover', 'scroll', 'attention', 'rage', 'dead');--> statement-breakpoint
ALTER TYPE "public"."tracker_event_type" ADD VALUE 'section_view';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "heat_bins" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"test_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"device" "device_class" NOT NULL,
	"layer" "heat_layer" NOT NULL,
	"selector" text NOT NULL,
	"cell_x" integer DEFAULT 0 NOT NULL,
	"cell_y" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"weight" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pageviews" ADD COLUMN "sections_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pageviews" ADD COLUMN "sections_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heat_bins" ADD CONSTRAINT "heat_bins_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "heat_bins" ADD CONSTRAINT "heat_bins_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heat_bins_bin_idx" ON "heat_bins" USING btree ("test_id","variant_id","device","layer","selector","cell_x","cell_y");