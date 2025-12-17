CREATE TABLE `cloudflare_cleanup_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cloudflare_id` text NOT NULL,
	`media_type` text NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cleanup_jobs_status_retry` ON `cloudflare_cleanup_jobs` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cleanup_jobs_unique_cloudflare_id` ON `cloudflare_cleanup_jobs` (`cloudflare_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text,
	`phone_number` text,
	`auth_provider` text DEFAULT '' NOT NULL,
	`provider_id` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`phone_verified` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text,
	`device_token` text,
	`last_notification_prompt` text
);
--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_phone` ON `users` (`phone_number`);--> statement-breakpoint
CREATE INDEX `idx_users_provider` ON `users` (`auth_provider`,`provider_id`);--> statement-breakpoint
CREATE TABLE `locks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lock_name` text DEFAULT 'Memory Lock' NOT NULL,
	`album_title` text DEFAULT 'Wonderful Memories' NOT NULL,
	`seal_date` text,
	`scan_count` integer DEFAULT 0 NOT NULL,
	`last_scan_milestone` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`user_id` integer,
	`upgraded_storage` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_locks_user_id` ON `locks` (`user_id`);--> statement-breakpoint
CREATE TABLE `media_objects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lock_id` integer NOT NULL,
	`cloudflare_id` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`thumbnail_url` text,
	`file_name` text,
	`is_image` integer DEFAULT 1 NOT NULL,
	`is_main_picture` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	FOREIGN KEY (`lock_id`) REFERENCES `locks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_objects_lock_id` ON `media_objects` (`lock_id`);--> statement-breakpoint
CREATE INDEX `idx_media_objects_display_order` ON `media_objects` (`lock_id`,`display_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_objects_cloudflare_id` ON `media_objects` (`cloudflare_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_one_main_image` ON `media_objects` (`lock_id`) WHERE "media_objects"."is_main_picture" = 1;