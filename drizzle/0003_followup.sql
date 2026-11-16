CREATE TABLE `followup` (
	`gathering_id` text NOT NULL,
	`person_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`happened` integer,
	`again` integer,
	`answered_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`gathering_id`, `person_id`),
	FOREIGN KEY (`gathering_id`) REFERENCES `gathering`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `followup_token_hash_unique` ON `followup` (`token_hash`);