-- ============================================================
-- Seed data for past_deals (~20 rows)
-- Designed so a Series A, ~45-person fintech VP Ops lead (the demo
-- "hot" lead) matches several WON deals on the ROI angle, while
-- too-small / too-early leads have only losses to match against.
-- ============================================================

insert into past_deals
  (company_name, vertical, company_size, funding_stage, persona, pain_signal, angle_used, outcome, cycle_days, notes)
values
  -- FINTECH (demo vertical) — ROI is the dominant winning angle for mid-size Series A
  ('Acme Ledger',  'fintech', 60,  'series_a',  'VP Ops',          'manual reconciliation',      'roi',        'won',         38, 'ROI calc on hours saved closed it'),
  ('PayMint',      'fintech', 35,  'series_a',  'Head of Finance', 'painful month-end close',    'roi',        'won',         45, 'Led with cost of manual close'),
  ('ClearTab',     'fintech', 120, 'series_b+', 'Director Ops',    'reconciliation errors',      'roi',        'won',         52, 'ROI + light compliance combo'),
  ('Northwind Pay','fintech', 80,  'series_a',  'VP Ops',          'reconciliation',             'roi',        'won',         41, 'Same-week demo offer sealed it'),
  ('Settle.io',    'fintech', 50,  'series_a',  'Director Finance','reconciliation',             'roi',        'won',         36, 'ROI angle, fast cycle'),
  ('Vantage',      'fintech', 45,  'series_a',  'VP Ops',          'reconciliation + reporting', 'roi',        'won',         39, 'Closest analog to the ideal lead'),
  ('Brale',        'fintech', 65,  'series_a',  'Director Finance','slow close process',         'time_saved', 'won',         44, 'time_saved also works mid-market'),
  ('Quanta',       'fintech', 200, 'series_b+', 'Head of Finance', 'audit prep',                 'compliance', 'won',         60, 'Compliance angle won (regulated)'),
  ('Granite',      'fintech', 150, 'series_b+', 'Head of Finance', 'audit trail',                'compliance', 'won',         58, 'Enterprise leans compliance'),
  ('Tilly',        'fintech', 25,  'seed',      'Founder',         'spreadsheet chaos',          'time_saved', 'lost',         0, 'Too early, no budget yet'),
  ('Echo Pay',     'fintech', 18,  'seed',      'Founder',         'general curiosity',          'roi',        'lost',         0, 'Too small to close'),
  ('Dropcoin',     'fintech', 15,  'pre-seed',  'Founder',         'just browsing',              'time_saved', 'no_response',  0, 'Ghosted — not a buyer'),
  ('Fennec',       'fintech', 90,  'series_a',  'VP Ops',          'manual ops',                 'peer_proof', 'lost',         0, 'Lost to competitor; wanted refs late'),

  -- DEVTOOLS — time_saved tends to win
  ('Forklift',     'devtools', 40, 'series_a',  'Head of Eng',     'CI flakiness',               'time_saved', 'won',         30, 'Time saved on builds'),
  ('Crate',        'devtools', 70, 'series_a',  'VP Eng',          'onboarding friction',        'time_saved', 'won',         33, 'Dev-hours framing landed'),
  ('Loophole',     'devtools', 110,'series_b+', 'Director Eng',    'scaling pains',              'roi',        'lost',         0, 'Budget froze mid-cycle'),
  ('Bitwise',      'devtools', 22, 'seed',      'Founder',         'curiosity',                  'peer_proof', 'no_response',  0, 'No real pain'),

  -- HEALTHTECH — compliance wins
  ('Medly',        'healthtech', 55, 'series_a','Head of Ops',     'compliance documentation',   'compliance', 'won',         48, 'Compliance was the whole pitch'),
  ('Caretrace',    'healthtech', 130,'series_b+','VP Ops',         'HIPAA workflow',             'compliance', 'won',         65, 'Long cycle, compliance-led'),
  ('Pulse',        'healthtech', 30, 'seed',    'Founder',         'early exploration',          'time_saved', 'lost',         0, 'Pre-product, no budget');
