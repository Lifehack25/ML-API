-- Migration: Add failed registrations table
-- Date: 2025-11-05
-- Purpose: Track user registrations that succeeded in Twilio but failed in database
--          This allows manual reconciliation of edge cases where verification codes
--          were consumed but user accounts were not created

CREATE TABLE failed_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  verification_code TEXT,
  error_message TEXT,
  twilio_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for looking up failed attempts by identifier (phone or email)
CREATE INDEX idx_failed_registrations_identifier ON failed_registrations(identifier);

-- Index for cleanup queries (purge old failed attempts)
CREATE INDEX idx_failed_registrations_created ON failed_registrations(created_at);
