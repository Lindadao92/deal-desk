# Deal Desk Agent — starter kit

An inbound-lead agent. A lead arrives → the agent researches it → decides if it's
worth pursuing (the branching brain) → and if so, logs it to CRM, sends a
personalized email, books a calendar hold, and pings Slack — autonomously.
If not, it routes to nurture with a different Slack note and **no email**.

Built for the Composio Agentic Execution Hackathon. Composio is the execution
layer for every external action; Claude is the brain.

## Files

| File | What it is |
|------|------------|
| `schema.sql` | `past_deals` (the agent's sales memory) + `leads` (live + dedup + execution log) |
| `seed_deals.sql` | ~20 realistic past deals so every demo lead gets a clean precedent match |
| `retrieval.ts` | Finds similar past deals and summarizes the winning angle |
| `scoring_prompt.txt` | The brain: research + precedent → decision JSON |
| `agent.ts` | The loop: trigger → enrich → precedent → score → execute via Composio (CRM = Notion) |

## How the pieces connect

```
inbound lead ─▶ enrich (web research) ─▶ findPrecedent() ─▶ scoring_prompt (Claude)
                                                                   │
                                            decision JSON ─────────┘
                                                   │
                    ┌──────────────────────────────┼───────────────────────────┐
                  HOT (≥75)                      WARM (45–74)                 COLD (<45)
            CRM + email + AUTO-BOOK          CRM + email (propose times)    CRM (nurture)
                 + Slack                          + Slack                   + Slack, NO email
```

The decision JSON's `tier` and `auto_book` fields are what physically decide
which Composio actions fire.

## Setup (build order matters — de-risk auth first)

1. **Composio + Butterbase**: connect Butterbase before you start (hackathon
   requirement). In Composio, connect Notion, Gmail, Google Calendar, Slack —
   and fire each action ONCE with a hardcoded payload before writing any brain
   logic. Auth breaking at hour 10 is the #1 way teams lose.
2. **Notion CRM database**: create a Notion database with these columns —
   `Name` (title), `Email` (email), `Company` (text), `Tier` (select: hot/warm/cold),
   `Score` (number), `Status` (select: Lead/Nurture), `Angle` (select), `Notes` (text).
   Then **share the database with your Notion integration** (open the DB → `•••` →
   Connections → add it) or Composio can't see it. Copy the database ID into env.
3. **DB**: run `schema.sql` then `seed_deals.sql` in Supabase.
4. **Env**: `ANTHROPIC_API_KEY`, `COMPOSIO_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, `NOTION_DATABASE_ID`.
5. **Trigger**: simplest reliable demo trigger is a form that POSTs to a route
   calling `handleLead()`. Also wire a Gmail poll as the "production" trigger.

> Composio action slugs (`NOTION_CREATE_DATABASE_ITEM`, etc.) change — confirm the
> exact names in your Composio dashboard. Notion property keys must match your
> column names exactly (case-sensitive).

## Demo tips

- **Run two leads back to back**: one hot (fintech, ~45ppl, Series A, VP Ops —
  matches the seeded ROI winners) and one junk (free-Gmail student). The
  contrast — full outreach vs. nurture-only — *is* the proof the brain branches.
- **Use recipient inboxes you own** so the sent email visibly lands on screen,
  and keep your Notion CRM database open in a tab — the new row appearing live
  (Tier + Score + Angle filled in) is a great demo beat.
- **Show the `trace`/activity feed** as your execution-log deliverable.
- **Let a judge tweak the ICP** in `scoring_prompt.txt` and re-run the same lead
  to watch it change paths. Interactivity wins.

## Hackathon gotchas

- Final submission code: **EXECUTE2026** in the Composio portal.
- Dedup on email (the `leads.email` unique constraint) so re-running the demo
  doesn't fire 20 duplicate sends.
- Keep a dry-run toggle for practice; flip to live for the real run.

## Next upgrades (depth of agency, not more apps)

- **Close the loop**: poll Gmail for the lead's reply, reschedule/confirm/escalate.
- **Recover from failure**: if a calendar slot conflicts, retry another or escalate to Slack.
- **Three-way fork** is already in the prompt (hot/warm/cold) — make sure the UI shows it.
