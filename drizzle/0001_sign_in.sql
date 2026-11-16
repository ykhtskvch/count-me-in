CREATE TABLE `auth_rate_limit` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_auth_request` (
	`id` text PRIMARY KEY NOT NULL,
	`browser_token_hash` text NOT NULL,
	`email_hash` text NOT NULL,
	`continuation_path` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_auth_request_browser_token_hash_unique` ON `pending_auth_request` (`browser_token_hash`);--> statement-breakpoint
CREATE INDEX `pending_auth_expires` ON `pending_auth_request` (`expires_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`auth_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_auth_user` ON `session` (`auth_user_id`);