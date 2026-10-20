CREATE TABLE `api_keys` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`last4` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`role_id` text NOT NULL,
	`title` text NOT NULL,
	`org` text NOT NULL,
	`location_text` text DEFAULT '' NOT NULL,
	`location_norm` text DEFAULT '' NOT NULL,
	`work_mode` text DEFAULT 'unknown' NOT NULL,
	`contract` text DEFAULT 'unknown' NOT NULL,
	`hours_text` text DEFAULT '' NOT NULL,
	`salary_text` text DEFAULT '' NOT NULL,
	`salary_min` integer,
	`salary_max` integer,
	`sponsorship` text DEFAULT 'not_stated' NOT NULL,
	`sponsorship_evidence` text DEFAULT '' NOT NULL,
	`licensed_sponsor` integer DEFAULT false NOT NULL,
	`sponsor_match_name` text,
	`posted_date` text,
	`closing_date` text,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`cited` integer DEFAULT false NOT NULL,
	`link_status` text DEFAULT 'unchecked' NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`status` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`applied_at` integer,
	`provider` text,
	`model` text,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_role_idx` ON `jobs` (`role_id`);--> statement-breakpoint
CREATE INDEX `jobs_canonical_idx` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `refresh_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`progress` text DEFAULT '{}' NOT NULL,
	`used_default_key` integer DEFAULT true NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `refresh_runs_started_idx` ON `refresh_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`color` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `roles_sort_idx` ON `roles` (`archived`,`sort_order`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`sector` text NOT NULL,
	`locations` text NOT NULL,
	`notes` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`seen_up_to` integer,
	`last_refresh_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sponsor_register` (
	`org_name` text NOT NULL,
	`org_norm` text NOT NULL,
	`town` text DEFAULT '' NOT NULL,
	`county` text DEFAULT '' NOT NULL,
	`rating` text DEFAULT '' NOT NULL,
	`route` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`org_norm`, `route`)
);
--> statement-breakpoint
CREATE INDEX `sponsor_register_norm_idx` ON `sponsor_register` (`org_norm`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`provider` text NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `provider`)
);
