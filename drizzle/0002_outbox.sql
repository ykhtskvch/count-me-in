CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`place_id` text,
	`template` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`sent_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_outbox_recipient" CHECK("email_outbox"."person_id" IS NOT NULL OR "email_outbox"."place_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `email_outbox_unsent` ON `email_outbox` (`created_at`) WHERE sent_at IS NULL;