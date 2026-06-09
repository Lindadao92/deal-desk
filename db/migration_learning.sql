-- ============================================================
-- Learning loop migration — let the agent write outcomes back into past_deals.
-- `outcome` already exists in schema.sql; `source` is new. Both use IF NOT EXISTS
-- so this is safe to run repeatedly. Adding `source` with a default backfills
-- existing seed rows to 'seed'; learned rows are inserted with source='learned'.
-- Run in the Supabase SQL editor.
-- ============================================================

alter table past_deals add column if not exists outcome text;
alter table past_deals add column if not exists source text default 'seed';
