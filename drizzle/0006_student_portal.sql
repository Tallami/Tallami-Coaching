CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"youtube_video_id" text,
	"url" text,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_kind_valid" CHECK ("deliveries"."kind" in ('youtube', 'pdf', 'link')),
	CONSTRAINT "deliveries_title_length" CHECK (char_length("deliveries"."title") between 1 and 120),
	CONSTRAINT "deliveries_one_field_per_kind" CHECK ((
        ("deliveries"."kind" = 'youtube' and "deliveries"."youtube_video_id" is not null and "deliveries"."url" is null and "deliveries"."file_id" is null)
        or ("deliveries"."kind" = 'link' and "deliveries"."url" is not null and "deliveries"."youtube_video_id" is null and "deliveries"."file_id" is null)
        or ("deliveries"."kind" = 'pdf' and "deliveries"."file_id" is not null and "deliveries"."youtube_video_id" is null and "deliveries"."url" is null)
      )),
	CONSTRAINT "deliveries_url_is_https" CHECK ("deliveries"."url" is null or "deliveries"."url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_accounts_identity_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "portal_accounts_provider_valid" CHECK ("portal_accounts"."provider" in ('discord', 'google', 'test'))
);
--> statement-breakpoint
ALTER TABLE "portal_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portal_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_account_id" uuid,
	CONSTRAINT "portal_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "portal_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "portal_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_file_id_delivery_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."delivery_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_invites" ADD CONSTRAINT "portal_invites_used_by_account_id_portal_accounts_id_fk" FOREIGN KEY ("used_by_account_id") REFERENCES "public"."portal_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_account_id_portal_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."portal_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_sale_id_idx" ON "deliveries" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "deliveries_file_id_idx" ON "deliveries" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_customer_id_unique" ON "portal_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "portal_invites_customer_id_idx" ON "portal_invites" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "portal_invites_used_by_account_id_idx" ON "portal_invites" USING btree ("used_by_account_id");--> statement-breakpoint
CREATE INDEX "portal_sessions_account_id_idx" ON "portal_sessions" USING btree ("account_id");