CREATE TABLE "api_keys" (
	"provider" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"last4" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"title" text NOT NULL,
	"org" text NOT NULL,
	"location_text" text DEFAULT '' NOT NULL,
	"location_norm" text DEFAULT '' NOT NULL,
	"work_mode" text DEFAULT 'unknown' NOT NULL,
	"contract" text DEFAULT 'unknown' NOT NULL,
	"hours_text" text DEFAULT '' NOT NULL,
	"salary_text" text DEFAULT '' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"sponsorship" text DEFAULT 'not_stated' NOT NULL,
	"sponsorship_evidence" text DEFAULT '' NOT NULL,
	"licensed_sponsor" boolean DEFAULT false NOT NULL,
	"sponsor_match_name" text,
	"posted_date" text,
	"closing_date" text,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"cited" boolean DEFAULT false NOT NULL,
	"link_status" text DEFAULT 'unchecked' NOT NULL,
	"first_seen" bigint NOT NULL,
	"last_seen" bigint NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"applied_at" bigint,
	"provider" text,
	"model" text
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"attempted_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"status" text NOT NULL,
	"progress" text DEFAULT '{}' NOT NULL,
	"used_default_key" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"color" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"locations" text NOT NULL,
	"notes" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"seen_up_to" bigint,
	"last_refresh_at" bigint,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsor_register" (
	"org_name" text NOT NULL,
	"org_norm" text NOT NULL,
	"town" text DEFAULT '' NOT NULL,
	"county" text DEFAULT '' NOT NULL,
	"rating" text DEFAULT '' NOT NULL,
	"route" text DEFAULT '' NOT NULL,
	CONSTRAINT "sponsor_register_org_norm_route_pk" PRIMARY KEY("org_norm","route")
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"date" text NOT NULL,
	"provider" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_date_provider_pk" PRIMARY KEY("date","provider")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_role_idx" ON "jobs" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "jobs_canonical_idx" ON "jobs" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "refresh_runs_started_idx" ON "refresh_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "roles_sort_idx" ON "roles" USING btree ("archived","sort_order");--> statement-breakpoint
CREATE INDEX "sponsor_register_norm_idx" ON "sponsor_register" USING btree ("org_norm");