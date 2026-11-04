CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"account_id" uuid,
	"buyer_name" text NOT NULL,
	"buyer_email" text,
	"buyer_handle" text,
	"item" text NOT NULL,
	"amount_usd_minor" bigint NOT NULL,
	"ars_per_usd" numeric(14, 4) NOT NULL,
	"amount_ars_minor" bigint NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_payment_id" text,
	"adult_confirmed_at" timestamp with time zone NOT NULL,
	"locale" text NOT NULL,
	"sale_id" uuid,
	"pro_payment_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orders_provider_payment_unique" UNIQUE("provider","provider_payment_id"),
	CONSTRAINT "orders_provider_valid" CHECK ("orders"."provider" in ('mercadopago')),
	CONSTRAINT "orders_item_valid" CHECK ("orders"."item" in ('vodRecorded', 'tournamentReview', 'vodLive', 'gamePlan', 'proSeason', 'lesson', 'lessonPack', 'tournament', 'other')),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('created', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back')),
	CONSTRAINT "orders_locale_valid" CHECK ("orders"."locale" in ('es', 'pt', 'en')),
	CONSTRAINT "orders_amounts_positive" CHECK ("orders"."amount_usd_minor" > 0 and "orders"."amount_ars_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pro_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"discord" text NOT NULL,
	"team_members" text NOT NULL,
	"results" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"locale" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pro_applications_status_valid" CHECK ("pro_applications"."status" in ('new', 'talking', 'accepted', 'rejected')),
	CONSTRAINT "pro_applications_locale_valid" CHECK ("pro_applications"."locale" in ('es', 'pt', 'en'))
);
--> statement-breakpoint
ALTER TABLE "pro_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pro_payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"amount_usd_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "pro_payment_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "pro_payment_links_amount_positive" CHECK ("pro_payment_links"."amount_usd_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "pro_payment_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"order_reference" text,
	"message" text,
	"locale" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"email_sent_at" timestamp with time zone,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "site_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "site_requests_kind_valid" CHECK ("site_requests"."kind" in ('withdrawal', 'cancellation', 'contact')),
	CONSTRAINT "site_requests_status_valid" CHECK ("site_requests"."status" in ('new', 'handled')),
	CONSTRAINT "site_requests_locale_valid" CHECK ("site_requests"."locale" in ('es', 'pt', 'en'))
);
--> statement-breakpoint
ALTER TABLE "site_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portal_accounts" ADD COLUMN "provider_handle" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "replay_codes" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "replay_codes_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_portal_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."portal_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pro_payment_link_id_pro_payment_links_id_fk" FOREIGN KEY ("pro_payment_link_id") REFERENCES "public"."pro_payment_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_payment_links" ADD CONSTRAINT "pro_payment_links_application_id_pro_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."pro_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_account_id_idx" ON "orders" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "orders_sale_id_idx" ON "orders" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "orders_pro_payment_link_id_idx" ON "orders" USING btree ("pro_payment_link_id");--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "pro_payment_links_application_id_idx" ON "pro_payment_links" USING btree ("application_id");