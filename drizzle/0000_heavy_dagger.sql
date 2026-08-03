CREATE TABLE `installations` (
	`environment` text NOT NULL,
	`tenant_id` text NOT NULL,
	`api_key` text NOT NULL,
	`webhook_secret` text NOT NULL,
	`scopes` text NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`environment`, `tenant_id`)
);
--> statement-breakpoint
CREATE TABLE `seen_events` (
	`environment` text NOT NULL,
	`tenant_id` text NOT NULL,
	`event_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`environment`, `tenant_id`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `seen_events_seen_at_idx` ON `seen_events` (`seen_at`);