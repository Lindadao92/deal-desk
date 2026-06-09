-- ============================================================
-- Deal Desk Agent — database schema (Supabase / Postgres)
-- ============================================================

-- The agent's SALES MEMORY. Seeded with historical deals so the
-- agent can reason from precedent ("leads like this won on the ROI angle").
create table if not exists past_deals (
  id            uuid primary key default gen_random_uuid(),
  company_name  text,
  vertical      text,   -- 'fintech','devtools','healthtech'
  company_size  int,    -- headcount
  funding_stage text,   -- 'pre-seed','seed','series_a','series_b+'
  persona       text,   -- 'VP Ops','Founder','Head of Eng'
  pain_signal   text,   -- short: 'manual reconciliation'
  angle_used    text,   -- 'roi','time_saved','compliance','peer_proof'
  outcome       text,   -- 'won','lost','no_response'
  cycle_days    int,    -- days to close (0 if not won)
  notes         text    -- one-liner: what actually worked / didn't
);

-- LIVE leads the agent processes. Also your dedup + execution log.
-- The `trace` jsonb column is your "execution logs" deliverable.
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,          -- dedup key: don't double-fire
  name          text,
  raw_message   text,
  enrichment    jsonb,                          -- what research found
  decision      jsonb,                          -- the scoring JSON
  status        text default 'received',        -- received|qualified|nurtured|errored
  trace         jsonb default '[]'::jsonb,       -- ordered list of agent steps + tool calls
  created_at    timestamptz default now()
);
