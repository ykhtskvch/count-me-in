ALTER TABLE `activity` ADD `published_at` text;
--> statement-breakpoint
UPDATE activity SET published_at = created_at WHERE state <> 'in_review';
