CREATE TABLE "interest_drops" (
	"day" date PRIMARY KEY NOT NULL,
	"dropped" integer NOT NULL,
	CONSTRAINT "interest_drops_dropped_positive" CHECK ("interest_drops"."dropped" > 0)
);
--> statement-breakpoint
ALTER TABLE "interest_drops" ENABLE ROW LEVEL SECURITY;