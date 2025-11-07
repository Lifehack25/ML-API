-- Migration 004: Add unique constraint for main image per lock
-- Ensures only one media object per lock can have is_main_picture = TRUE

-- Create unique partial index to enforce constraint
-- This will fail if multiple main images already exist for any lock
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_one_main_per_lock
ON media_objects(lock_id)
WHERE is_main_picture = TRUE;
