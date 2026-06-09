-- ============================================================
-- Reply-loop migration — adds columns to `leads` for tracking
-- outreach, reply-handling idempotency, and the feed's status line.
-- Run this in the Supabase SQL editor AFTER schema.sql.
-- ============================================================

-- What we sent + the ids needed to find/act on a reply later:
--   { recipient, subject, thread_id, sent_message_id, calendar_event_id, notion_page_id }
alter table leads add column if not exists outreach jsonb;

-- The id of the most recent INBOUND reply we've already handled (idempotency key:
-- a given reply is processed exactly once).
alter table leads add column if not exists last_message_id text;

-- Short human-readable summary of the last reply action, shown on the feed card.
alter table leads add column if not exists last_reply_action text;

-- New status values used by the reply loop (no constraint to enforce, documented here):
--   awaiting_reply | rescheduled | confirmed | replied | closed_lost
-- (existing: received | qualified | nurtured | errored)
