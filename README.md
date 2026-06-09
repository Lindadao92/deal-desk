# Deal Desk

An autonomous inbound-lead agent that researches, qualifies, and executes outreach across four apps with no human in the loop.

## Autonomous execution (the requirement)

The agent performs the final action itself. When a lead comes in, it writes the CRM row, sends the email, books the calendar hold, and posts to Slack on its own. There is no approval step and no human-in-the-loop trigger before that last action fires. The model decides and the model acts. That is the mandatory requirement for this hackathon, and it is met end to end.

## How it works

```
form submit
  -> enrich    (Claude + web research: company and person)
  -> score     (against ICP, 0 to 100)
  -> branch    (hot / warm / cold)
  -> execute   (via Composio)
  -> log       (to Supabase)
```

- Hot (score >= 75): create CRM row, send a personalized email, auto-book a 30 minute calendar hold, post to Slack.
- Warm (45 to 74): create CRM row, send an email that proposes times, post to Slack. No auto-book.
- Cold (below 45): create CRM row tagged for nurture, post a Slack note. No email.

Every scoring reason cites a specific fact from the lead, the research, or past-deal precedent. Nothing is invented, and missing data is flagged instead of guessed.

## Composio is the execution layer

Composio handles auth and tool-calling for every external action. Four apps are connected, and the agent calls these slugs:

| App | Actions used |
|-----|--------------|
| Notion (CRM) | `NOTION_INSERT_ROW_DATABASE`, `NOTION_UPDATE_ROW_DATABASE` |
| Gmail | `GMAIL_SEND_EMAIL`, `GMAIL_FETCH_MESSAGE_BY_THREAD_ID` |
| Google Calendar | `GOOGLECALENDAR_CREATE_EVENT`, `GOOGLECALENDAR_PATCH_EVENT` |
| Slack | `SLACK_SEND_MESSAGE` |

Claude is the brain, Composio is the hands.

## The reasoning

ICP scoring runs 0 to 100, weighted across vertical fit, company size and stage, seniority, pain signal, and timing. Tiers: hot >= 75, warm 45 to 74, cold below 45.

Angle selection picks the outreach hook (`roi`, `time_saved`, `compliance`, or `peer_proof`). It defaults to the angle that won most often for similar past deals and overrides only when the research gives a stronger reason.

Reply loop: when a lead replies, the agent fetches the email thread, classifies intent (`confirm`, `reschedule`, `question`, `not_interested`), and acts on its own. Confirm books a hold and sends a confirmation. Reschedule moves or books the event at the new time. A question gets a drafted answer. Not interested updates the CRM and closes the lead with no email. Replies are matched by thread id and handled exactly once.

## Execution logs and traces

Proof that the agent acted, not just talked:

- Supabase `trace` column on each lead row: an ordered list of every step and tool call.
- The live activity feed: leads move across the kanban (Outreach Sent, Booked, Nurture) as they progress. Click a card for the full research, score, and reasons.
- The Composio Logs panel: every tool call with its payload and result.

## Stack

Next.js (App Router), Supabase (Postgres), Claude (`claude-sonnet-4-6`), Composio.

## Run it

Set the six env vars (see `.env.example`):

```
ANTHROPIC_API_KEY
COMPOSIO_API_KEY
COMPOSIO_USER_ID
NOTION_DATABASE_ID
SUPABASE_URL
SUPABASE_SERVICE_KEY
```

Then:

```
npm install
npm run dev
```

Open http://localhost:3000 and submit a lead.

First-time setup: run `db/schema.sql`, `db/seed_deals.sql`, and `db/migration_reply_loop.sql` in the Supabase SQL editor, and connect Notion, Gmail, Google Calendar, and Slack in Composio under the user id you set in `COMPOSIO_USER_ID`.
