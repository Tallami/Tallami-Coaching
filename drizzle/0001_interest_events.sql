CREATE TABLE "interest_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item" text NOT NULL,
	"locale" text NOT NULL,
	"country" char(2),
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_events_item_valid" CHECK ("interest_events"."item" in ('vodRecorded', 'vodLive', 'lesson', 'lessonPack', 'gamePlan', 'tournament', 'proSeason')),
	CONSTRAINT "interest_events_locale_valid" CHECK ("interest_events"."locale" in ('es', 'pt', 'en')),
	CONSTRAINT "interest_events_country_valid" CHECK ("interest_events"."country" is null or "interest_events"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE INDEX "interest_events_created_at_idx" ON "interest_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "interest_events_ip_hash_created_at_idx" ON "interest_events" USING btree ("ip_hash","created_at");