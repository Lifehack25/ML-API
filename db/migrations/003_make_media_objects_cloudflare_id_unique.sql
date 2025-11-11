-- Remove duplicate media rows referencing the same Cloudflare asset
WITH duplicates AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY cloudflare_id ORDER BY id) AS rn
    FROM media_objects
  )
  WHERE rn > 1
)
DELETE FROM media_objects
WHERE id IN (SELECT id FROM duplicates);

-- Enforce uniqueness at the database layer
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_objects_cloudflare_id
ON media_objects (cloudflare_id);
