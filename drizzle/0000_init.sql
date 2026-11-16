CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`outcome` text NOT NULL,
	`min_people` integer NOT NULL,
	`max_people` integer NOT NULL,
	`duration_min` integer NOT NULL,
	`bring` text DEFAULT '' NOT NULL,
	`materials_cost_pence` integer DEFAULT 0 NOT NULL,
	`place_kind` text NOT NULL,
	`needs_knower` integer DEFAULT false NOT NULL,
	`season` text,
	`instructions` text,
	`state` text DEFAULT 'in_review' NOT NULL,
	`author_id` text,
	`rejection_reason` text,
	`times_run` integer DEFAULT 0 NOT NULL,
	`last_interest_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_min_people" CHECK("activity"."min_people" >= 2),
	CONSTRAINT "activity_max_people" CHECK("activity"."max_people" >= "activity"."min_people"),
	CONSTRAINT "activity_duration" CHECK("activity"."duration_min" > 0),
	CONSTRAINT "activity_cost" CHECK("activity"."materials_cost_pence" >= 0),
	CONSTRAINT "activity_place_kind" CHECK("activity"."place_kind" IN ('venue', 'public')),
	CONSTRAINT "activity_state_check" CHECK("activity"."state" IN ('in_review', 'in_catalogue', 'choosing', 'awaiting_place', 'scheduled', 'removed'))
);
--> statement-breakpoint
CREATE INDEX `activity_state` ON `activity` (`state`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`gathering_id` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text DEFAULT 'going' NOT NULL,
	`joined_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`gathering_id`, `person_id`),
	FOREIGN KEY (`gathering_id`) REFERENCES `gathering`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gathering` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`place_id` text,
	`host_person_id` text,
	`status` text DEFAULT 'awaiting_place' NOT NULL,
	`owner_attended` integer,
	FOREIGN KEY (`round_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`host_person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "gathering_scheduled_needs_place_and_host" CHECK("gathering"."status" <> 'scheduled' OR ("gathering"."place_id" IS NOT NULL AND "gathering"."host_person_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gathering_round_id_unique` ON `gathering` (`round_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gathering_slot_id_unique` ON `gathering` (`slot_id`);--> statement-breakpoint
CREATE TABLE `host_offer` (
	`id` text PRIMARY KEY NOT NULL,
	`gathering_id` text NOT NULL,
	`person_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`response` text,
	`token_hash` text NOT NULL,
	FOREIGN KEY (`gathering_id`) REFERENCES `gathering`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_offer_token_hash_unique` ON `host_offer` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_offer_once` ON `host_offer` (`gathering_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `host_offer_due` ON `host_offer` (`deadline_at`) WHERE response IS NULL;--> statement-breakpoint
CREATE TABLE `interest` (
	`person_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`times` text DEFAULT '[]' NOT NULL,
	`level` text,
	`bringing` text,
	`queued` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`person_id`, `activity_id`),
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interest_activity` ON `interest` (`activity_id`);--> statement-breakpoint
CREATE TABLE `mod_action` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`postcode_district` text NOT NULL,
	`adult_confirmed_at` text NOT NULL,
	`rules_version` text NOT NULL,
	`show_name` integer DEFAULT false NOT NULL,
	`email_prefs` text DEFAULT '{"digest":false}' NOT NULL,
	`role` text DEFAULT 'participant' NOT NULL,
	`blocked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "person_name_length" CHECK(length("person"."display_name") BETWEEN 1 AND 40),
	CONSTRAINT "person_district_length" CHECK(length("person"."postcode_district") BETWEEN 2 AND 4),
	CONSTRAINT "person_role" CHECK("person"."role" IN ('participant', 'moderator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_auth_user_id_unique` ON `person` (`auth_user_id`);--> statement-breakpoint
CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`postcode_district` text NOT NULL,
	`kind` text NOT NULL,
	`capacity` integer,
	`facilities` text DEFAULT '' NOT NULL,
	`step_free` integer NOT NULL,
	`price_text` text,
	`terms_text` text,
	`booking_email` text,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "place_venue_email" CHECK("place"."kind" = 'public' OR "place"."booking_email" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `place_window` (
	`id` text PRIMARY KEY NOT NULL,
	`place_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`auto_approve` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "place_window_weekday" CHECK("place_window"."weekday" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`reporter_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `round` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`outcome` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_one_open` ON `round` (`activity_id`) WHERE outcome = 'open';--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slot` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_one_winner` ON `slot` (`round_id`) WHERE status = 'won';--> statement-breakpoint
CREATE TABLE `slot_vote` (
	`slot_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`slot_id`, `person_id`),
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `venue_request` (
	`id` text PRIMARY KEY NOT NULL,
	`gathering_id` text NOT NULL,
	`place_id` text NOT NULL,
	`sent_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`response` text,
	`responded_at` text,
	`token_hash` text NOT NULL,
	FOREIGN KEY (`gathering_id`) REFERENCES `gathering`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venue_request_token_hash_unique` ON `venue_request` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `venue_request_once` ON `venue_request` (`gathering_id`,`place_id`);--> statement-breakpoint
CREATE INDEX `venue_request_due` ON `venue_request` (`deadline_at`) WHERE response IS NULL;