CREATE TABLE "admin_enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"created_by_session" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "admin_enrollment_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "admin_enrollment_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "admin_passkeys_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "admin_passkeys_name_length" CHECK (char_length("admin_passkeys"."name") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "admin_passkeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_pending_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"next_path" text NOT NULL,
	"ip_hash" text NOT NULL,
	"device" text NOT NULL,
	"challenge" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "admin_pending_logins_mode_valid" CHECK ("admin_pending_logins"."mode" in ('passkey', 'first-key', 'code'))
);
--> statement-breakpoint
ALTER TABLE "admin_pending_logins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"passkey_id" uuid,
	"device" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reauth_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"challenge" text,
	"challenge_purpose" text,
	"challenge_expires_at" timestamp with time zone,
	CONSTRAINT "admin_sessions_challenge_purpose_valid" CHECK ("admin_sessions"."challenge_purpose" is null or "admin_sessions"."challenge_purpose" in ('reauth', 'register'))
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_enrollment_codes" ADD CONSTRAINT "admin_enrollment_codes_created_by_session_admin_sessions_id_fk" FOREIGN KEY ("created_by_session") REFERENCES "public"."admin_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_passkey_id_admin_passkeys_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "public"."admin_passkeys"("id") ON DELETE set null ON UPDATE no action;