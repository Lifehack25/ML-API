-- Initial database schema for Memory Locks
-- Based on .NET API models with snake_case naming and default values

-- Users table
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    phone_number TEXT,
    auth_provider TEXT NOT NULL DEFAULT '',
    provider_id TEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    device_token TEXT,
    last_notification_prompt DATETIME
);

-- Locks table
CREATE TABLE locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lock_name TEXT NOT NULL DEFAULT 'Memory Lock',
    album_title TEXT NOT NULL DEFAULT 'Wonderful Memories',
    seal_date DATE,
    scan_count INTEGER NOT NULL DEFAULT 0,
    last_scan_milestone INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER,
    upgraded_storage INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Media Objects table
CREATE TABLE media_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lock_id INTEGER NOT NULL,
    cloudflare_id TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT,
    file_name TEXT,
    is_image INTEGER NOT NULL DEFAULT 1,
    is_main_picture BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    display_order INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    FOREIGN KEY (lock_id) REFERENCES locks(id) ON DELETE CASCADE
);

-- Idempotency Keys table (for preventing duplicate requests)
CREATE TABLE idempotency_keys (
  idempotency_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_id INTEGER,
  response_status INTEGER,
  response_body TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (idempotency_key, endpoint)
);

-- Cloudflare Cleanup Jobs table (for tracking media deletion retries)
CREATE TABLE cloudflare_cleanup_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloudflare_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at DATETIME,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Failed Registrations table (for tracking Twilio verification successes with DB failures)
CREATE TABLE failed_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  verification_code TEXT,
  error_message TEXT,
  twilio_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_provider ON users(auth_provider, provider_id);
CREATE INDEX idx_locks_user_id ON locks(user_id);
CREATE INDEX idx_media_objects_lock_id ON media_objects(lock_id);
CREATE INDEX idx_media_objects_display_order ON media_objects(lock_id, display_order);
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);
CREATE INDEX idx_idempotency_user ON idempotency_keys(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_cleanup_jobs_status_retry ON cloudflare_cleanup_jobs(status, next_retry_at);
CREATE INDEX idx_cleanup_jobs_cloudflare_id ON cloudflare_cleanup_jobs(cloudflare_id);
CREATE INDEX idx_failed_registrations_identifier ON failed_registrations(identifier);
CREATE INDEX idx_failed_registrations_created ON failed_registrations(created_at);
