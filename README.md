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

## Architecture

```
  Browser: form, kanban board, lead drawer, public /brief/[id]
     |
     |  POST /api/leads      GET /api/leads (polled every 3s)      POST /api/replies
     v
  Next.js API routes (Vercel, Node runtime)
     |
     v
  Agent pipeline (lib/agent.ts):  enrich -> score -> execute -> log
     |
     +-> Claude (claude-sonnet-4-6): research, ICP scoring, brief, reply triage
     +-> Composio: Notion (CRM), Gmail, Google Calendar, Slack
     +-> Supabase (Postgres): leads + past_deals (trace and brief stored as jsonb)

  Reply loop (lib/replies.ts, the "Check replies" button):
     fetch thread (Gmail) -> classify (Claude) -> act (Composio)
        -> write the outcome back to past_deals (the learning loop)
```

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

## Brief, deal value, and learning

- Web brief: every qualified (hot/warm) lead gets a personalized one-page brief at `/brief/[id]`, linked in the outreach email. Claude generates it from the lead's research: a tailored value prop, use cases, an impact estimate, a recommended plan, an indicative price band, a proof point, and the next step. Nothing fabricated.
- Estimated deal value: the brief includes an annualized `est_value` consistent with the price band. It shows as a `~$Xk` tag on the card and is summed per kanban column.
- Activity timeline: each lead's drawer shows a timestamped trace of every step the agent took, with the actual email and Slack messages expandable inline.
- Learning loop: when a reply resolves (meeting booked, or not interested), the outcome is written back to `past_deals` (tagged `source = 'learned'`), so future scoring cites real outcomes as precedent alongside the seed deals.

## Execution logs and traces

Proof that the agent acted, not just talked:

- Supabase `trace` column on each lead row: an ordered list of every step and tool call.
- The live activity feed: leads move across the kanban (Outreach Sent, Booked, Nurture) as they progress. Click a card for the full research, score, and reasons.
- The Composio Logs panel: every tool call with its payload and result.

## Stack

Next.js (App Router), Supabase (Postgres), Claude (`claude-sonnet-4-6`), Composio.

## Run it

Set the env vars (see `.env.example`):

```
ANTHROPIC_API_KEY
COMPOSIO_API_KEY
COMPOSIO_USER_ID
NOTION_DATABASE_ID
SUPABASE_URL
SUPABASE_SERVICE_KEY
NEXT_PUBLIC_BASE_URL    # base URL for brief links, e.g. http://localhost:3000
```

Then:

```
npm install
npm run dev
```

Open http://localhost:3000 and submit a lead.

First-time setup: in the Supabase SQL editor run, in order, `db/schema.sql`, `db/seed_deals.sql`, `db/migration_reply_loop.sql`, `db/migration_brief.sql`, and `db/migration_learning.sql`. Then connect Notion, Gmail, Google Calendar, and Slack in Composio under the user id you set in `COMPOSIO_USER_ID`. Set `NEXT_PUBLIC_BASE_URL` to where the app runs (`http://localhost:3000` locally, or your deployed URL).

## Demo

The form has three one-click presets behind the "+ New lead" button:

- Hot fintech lead: a Series A fintech with reconciliation pain. Scores hot, fires full outreach.
- Warm mid-market lead: a larger company that is just researching. Scores warm, emails and proposes times, no auto-book.
- Cold student: a free Gmail address with no company. Scores cold, routes to nurture, sends no email.

Run a hot lead and a cold lead back to back. The hot one creates a CRM row, sends the email, books a calendar hold, and posts to Slack. The cold one tags for nurture and posts a Slack note with no email. That contrast is the proof the branching is real, not scripted.

While it runs, watch the kanban. Cards land in Outreach Sent or Nurture with the score and tier on each card. Click a card to open the drawer with the research, the conversion hook, the sources, the score, and the reasons behind it.

To see the reply loop, point the hot or warm preset at an inbox you control (edit the email in the form), submit, then reply to the email the agent sends. Click Check replies. The agent classifies your reply and acts: a confirm or reschedule books or moves the meeting and the card moves to Booked; a question gets a drafted answer and the card stays in Outreach sent; not interested closes the lead and the card moves to Nurture.

Heads up: hot and warm leads send real email, and a hot lead also books a real calendar hold (warm proposes times instead, and only books if it later confirms via a reply), so use an inbox you own. The cold preset never sends anything, so it is safe to run as is.

## License

MIT. See [LICENSE](LICENSE).
