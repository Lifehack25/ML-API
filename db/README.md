# Database Schema Documentation

## Overview

ML-API uses Cloudflare D1, a serverless SQL database built on SQLite that runs at the edge. The schema is defined in `schema.sql` and must be applied to the D1 instance before deploying the Worker.

## Schema Management

### Initial Setup

Apply the schema to your D1 database:

```bash
# Local development
wrangler d1 execute DB --file=./db/schema.sql --local

# Production deployment
wrangler d1 execute DB --file=./db/schema.sql --remote
```

### Database Binding

The D1 database is configured in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_id = "3afe1cf6-4d2c-4461-9b41-1c8e232e8361"
```

The `DB` binding is accessible in Worker code via `env.DB`.

## Schema Structure

### Tables

#### `users`
Stores user accounts with support for multiple authentication providers.

**Columns:**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT) - Unique user identifier
- `name` (TEXT) - User's display name
- `email` (TEXT) - Email address
- `phone_number` (TEXT) - Phone number
- `auth_provider` (TEXT, default: '') - Authentication method (email, phone, google, apple)
- `provider_id` (TEXT) - External provider user ID (for OAuth)
- `email_verified` (BOOLEAN, default: FALSE) - Email verification status
- `phone_verified` (BOOLEAN, default: FALSE) - Phone verification status
- `created_at` (DATETIME, default: CURRENT_TIMESTAMP) - Account creation timestamp
- `last_login_at` (DATETIME) - Last successful login
- `device_token` (TEXT) - FCM device token for push notifications
- `last_notification_prompt` (DATETIME) - Last time user was prompted for notification permission

**Indexes:**
- `idx_users_email` on `email`
- `idx_users_phone` on `phone_number`
- `idx_users_provider` on `(auth_provider, provider_id)`

**Authentication Patterns:**
- Email/Phone: `auth_provider='email'` or `'phone'`, `provider_id=NULL`
- Google Sign-In: `auth_provider='google'`, `provider_id=<Google User ID>`
- Apple Sign-In: `auth_provider='apple'`, `provider_id=<Apple User ID>`

---

#### `locks`
Represents physical memory locks with associated album metadata.

**Columns:**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT) - Lock ID (obfuscated via Hashids for public URLs)
- `lock_name` (TEXT, default: 'Memory Lock') - Custom lock name
- `album_title` (TEXT, default: 'Wonderful Memories') - Album title
- `seal_date` (DATE) - Date the lock was sealed
- `scan_count` (INTEGER, default: 0) - Number of times QR code was scanned
- `last_scan_milestone` (INTEGER, default: 0) - Last milestone notification sent (10, 50, 100, etc.)
- `created_at` (DATETIME, default: CURRENT_TIMESTAMP) - Lock creation timestamp
- `user_id` (INTEGER, FOREIGN KEY → users.id) - Owner of the lock (NULL if unclaimed)
- `upgraded_storage` (INTEGER, default: 0) - Storage tier (0=standard, 1=premium)

**Indexes:**
- `idx_locks_user_id` on `user_id`

**Foreign Keys:**
- `user_id` REFERENCES `users(id)` ON DELETE SET NULL (orphans lock if user deleted)

**Storage Tiers:**
- Tier 0 (Standard): 25 images, 60 seconds video
- Tier 1 (Premium): 50 images, 120 seconds video

---

#### `media_objects`
Stores photos and videos associated with locks via Cloudflare Images/Stream.

**Columns:**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT) - Media object ID
- `lock_id` (INTEGER, FOREIGN KEY → locks.id) - Associated lock
- `cloudflare_id` (TEXT, default: '') - Cloudflare Images or Stream identifier
- `url` (TEXT, default: '') - Full-resolution media URL
- `thumbnail_url` (TEXT) - Thumbnail URL (for images and video posters)
- `file_name` (TEXT) - Original filename
- `is_image` (INTEGER, default: 1) - 1=image, 0=video
- `is_main_picture` (BOOLEAN, default: FALSE) - Primary album cover image
- `created_at` (DATETIME, default: CURRENT_TIMESTAMP) - Upload timestamp
- `display_order` (INTEGER, default: 0) - Custom sort order (0=chronological)
- `duration_seconds` (INTEGER) - Video duration in seconds

**Indexes:**
- `idx_media_objects_lock_id` on `lock_id`
- `idx_media_objects_display_order` on `(lock_id, display_order)`

**Foreign Keys:**
- `lock_id` REFERENCES `locks(id)` ON DELETE CASCADE (deletes media when lock is deleted)

**Media Storage:**
- Images: Cloudflare Images (automatic optimization, resizing, CDN)
- Videos: Cloudflare Stream (transcoding, adaptive bitrate, thumbnails)

---

## Data Relationships

```
users (1) ──< (N) locks (1) ──< (N) media_objects
```

- One user can own multiple locks
- One lock can have multiple media objects
- Locks can be orphaned (user_id=NULL) if created before user registration
- Deleting a user orphans their locks (sets user_id to NULL)
- Deleting a lock cascades to delete all associated media

## Migration History

The schema has evolved through migrations in the ML-DatabaseWorker project:

1. **002_add_thumbnail_url.sql** - Added thumbnail_url for optimized loading
2. **003_media_type_to_is_image.sql** - Simplified media type from string to boolean
3. **003_add_duration_seconds.sql** - Added video duration tracking
4. **20250214_remove_notified_when_scanned.sql** - Removed legacy notification flag
5. **004_add_upgraded_storage.sql** - Added two-tier storage system
6. **005_add_last_notification_prompt.sql** - Added 12-hour notification cooldown
7. **20250309_add_last_scan_milestone.sql** - Added scan milestone tracking

## Schema Validation

To verify the schema matches the codebase expectations, compare:

1. **Database models** (`src/data/models/`) - TypeScript interfaces matching table columns
2. **Repositories** (`src/data/repositories/`) - SQL queries expecting specific columns
3. **Schema file** (`db/schema.sql`) - CREATE TABLE statements

**Example validation:**

```bash
# Describe tables in local D1
wrangler d1 execute DB --local --command="SELECT name FROM sqlite_master WHERE type='table';"

# Show table structure
wrangler d1 execute DB --local --command="PRAGMA table_info(users);"
wrangler d1 execute DB --local --command="PRAGMA table_info(locks);"
wrangler d1 execute DB --local --command="PRAGMA table_info(media_objects);"
```

## Common Queries

### Find orphaned locks (no owner)
```sql
SELECT id, lock_name, created_at
FROM locks
WHERE user_id IS NULL;
```

### Get lock with media count
```sql
SELECT l.*, COUNT(m.id) as media_count
FROM locks l
LEFT JOIN media_objects m ON m.lock_id = l.id
WHERE l.id = ?
GROUP BY l.id;
```

### Find users with most locks
```sql
SELECT u.id, u.name, COUNT(l.id) as lock_count
FROM users u
LEFT JOIN locks l ON l.user_id = u.id
GROUP BY u.id
ORDER BY lock_count DESC
LIMIT 10;
```

### Get storage usage by lock
```sql
SELECT l.id, l.lock_name,
       SUM(CASE WHEN m.is_image = 1 THEN 1 ELSE 0 END) as image_count,
       SUM(CASE WHEN m.is_image = 0 THEN 1 ELSE 0 END) as video_count,
       SUM(CASE WHEN m.is_image = 0 THEN m.duration_seconds ELSE 0 END) as total_video_seconds
FROM locks l
LEFT JOIN media_objects m ON m.lock_id = l.id
WHERE l.id = ?
GROUP BY l.id;
```

## Backup and Recovery

### Export database
```bash
wrangler d1 export DB --remote --output=backup.sql
```

### Import from backup
```bash
wrangler d1 execute DB --remote --file=backup.sql
```

## Performance Considerations

### Indexed Queries
All repository queries use indexed columns for optimal performance:
- User lookups by email, phone, or OAuth provider
- Lock queries by user_id
- Media queries by lock_id with display_order

### Edge Replication
D1 databases are automatically replicated across Cloudflare's global network, providing low-latency reads from any edge location.

### Connection Pooling
Cloudflare Workers maintain persistent database connections, eliminating connection overhead on each request.

## Security Notes

- No direct database access from clients - all queries go through Worker API
- User IDs in JWT tokens are validated against database before authorization
- Foreign keys enforce referential integrity (CASCADE and SET NULL behaviors)
- No sensitive data stored in plain text (passwords never stored - OAuth/Verify-based auth)

## Troubleshooting

### "Table doesn't exist" errors
```bash
# Re-apply schema
wrangler d1 execute DB --remote --file=./db/schema.sql
```

### Schema drift between environments
```bash
# Export production schema
wrangler d1 execute DB --remote --command=".schema" > prod-schema.sql

# Compare with local
diff prod-schema.sql db/schema.sql
```

### Index performance
```bash
# Check if indexes are being used
wrangler d1 execute DB --remote --command="EXPLAIN QUERY PLAN SELECT * FROM locks WHERE user_id = 1;"
```

## Future Schema Changes

When modifying the schema:

1. Create a new migration SQL file in `db/migrations/`
2. Update `db/schema.sql` to reflect the final state
3. Update TypeScript models in `src/data/models/`
4. Update affected repositories in `src/data/repositories/`
5. Update DTOs if API contracts change
6. Test locally with `wrangler d1 execute DB --local --file=migration.sql`
7. Deploy to production via `wrangler d1 execute DB --remote --file=migration.sql`

## References

- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [ML-DatabaseWorker Schema Source](../ML-DatabaseWorker/db/schema.sql)
