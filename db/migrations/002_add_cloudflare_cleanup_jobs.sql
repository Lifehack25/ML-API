-- Migration: Add Cloudflare cleanup jobs table
-- Date: 2025-11-05
-- Purpose: Track and retry failed Cloudflare Images/Stream deletion operations

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

-- Index for job processor queries (find pending jobs ready for retry)
CREATE INDEX idx_cleanup_jobs_status_retry ON cloudflare_cleanup_jobs(status, next_retry_at);

-- Index for deduplication (prevent scheduling same cleanup twice)
CREATE INDEX idx_cleanup_jobs_cloudflare_id ON cloudflare_cleanup_jobs(cloudflare_id);
