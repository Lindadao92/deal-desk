-- ============================================================
-- Brief migration — adds the `brief` jsonb column to `leads`.
-- Holds the per-lead one-page brief (generated for hot/warm leads),
-- rendered publicly at /brief/[id]. Run in the Supabase SQL editor.
-- ============================================================

alter table leads add column if not exists brief jsonb;
