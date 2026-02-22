CREATE TABLE `idempotency_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`status` integer NOT NULL,
	`body` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_key_unique` ON `idempotency_keys` (`key`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_key` ON `idempotency_keys` (`key`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_created_at` ON `idempotency_keys` (`created_at`);