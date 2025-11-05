-- Migration: Add idempotency keys table
-- Date: 2025-11-05
-- Purpose: Support idempotent request handling to prevent duplicate operations

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

-- Index for efficient cleanup of expired keys
CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- Index for user-scoped queries (debugging, auditing)
CREATE INDEX idx_idempotency_user ON idempotency_keys(user_id) WHERE user_id IS NOT NULL;
