CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"discord" text,
	"email" text,
	"country" char(2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text NOT NULL,
	"quoted_on" date NOT NULL,
	"ars_per_unit" numeric(14, 4) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_currency_quoted_on_pk" PRIMARY KEY("currency","quoted_on")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"item" text NOT NULL,
	"description" text,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"ars_per_unit" numeric(14, 4) NOT NULL,
	"ars_per_usd" numeric(14, 4) NOT NULL,
	"rate_source" text NOT NULL,
	"rate_quoted_on" date,
	"amount_ars_minor" bigint NOT NULL,
	"amount_usd_minor" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"paid_on" date,
	"due_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"invoice_status" text DEFAULT 'pending' NOT NULL,
	"invoice_type" text,
	"invoice_number" text,
	"invoiced_on" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_item_valid" CHECK ("sales"."item" in ('vodRecorded', 'vodLive', 'lesson', 'lessonPack', 'gamePlan', 'tournament', 'proSeason', 'other')),
	CONSTRAINT "sales_currency_valid" CHECK ("sales"."currency" in ('USD', 'ARS', 'BRL', 'USDT')),
	CONSTRAINT "sales_rate_source_valid" CHECK ("sales"."rate_source" in ('bcra', 'manual', 'fixed')),
	CONSTRAINT "sales_payment_method_valid" CHECK ("sales"."payment_method" in ('mercadopago', 'pix', 'paypal', 'crypto', 'transfer', 'cash', 'other')),
	CONSTRAINT "sales_status_valid" CHECK ("sales"."status" in ('pending', 'paid', 'delivered', 'cancelled', 'refunded')),
	CONSTRAINT "sales_invoice_status_valid" CHECK ("sales"."invoice_status" in ('pending', 'issued', 'not_required')),
	CONSTRAINT "sales_invoice_type_valid" CHECK ("sales"."invoice_type" is null or "sales"."invoice_type" in ('C', 'E')),
	CONSTRAINT "sales_amount_positive" CHECK ("sales"."amount_minor" > 0),
	CONSTRAINT "sales_other_needs_description" CHECK ("sales"."item" <> 'other' or nullif(btrim("sales"."description"), '') is not null),
	CONSTRAINT "sales_paid_needs_paid_on" CHECK ("sales"."status" not in ('paid', 'delivered', 'refunded') or "sales"."paid_on" is not null),
	CONSTRAINT "sales_issued_invoice_needs_data" CHECK ("sales"."invoice_status" <> 'issued' or (
        "sales"."invoice_type" is not null
        and nullif(btrim("sales"."invoice_number"), '') is not null
        and "sales"."invoiced_on" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_ip_hash_created_at_idx" ON "login_attempts" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "sales_paid_on_idx" ON "sales" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "sales_customer_id_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_status_idx" ON "sales" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sales_invoice_status_idx" ON "sales" USING btree ("invoice_status");