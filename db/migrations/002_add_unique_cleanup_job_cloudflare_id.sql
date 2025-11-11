-- Ensure only one cleanup job exists per Cloudflare asset
WITH duplicates AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY cloudflare_id ORDER BY id) AS rn
    FROM cloudflare_cleanup_jobs
  )
  WHERE rn > 1
)
DELETE FROM cloudflare_cleanup_jobs
WHERE id IN (SELECT id FROM duplicates);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cleanup_jobs_unique_cloudflare_id
ON cloudflare_cleanup_jobs (cloudflare_id);
