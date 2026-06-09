// ============================================================
// test-connections.ts — fire ONE real action on each connected Composio app,
// one at a time, to confirm auth + wiring before running the full agent.
//
// Uses the SAME Composio v3 setup as lib/agent.ts:
//   new Composio({ apiKey: process.env.COMPOSIO_API_KEY })
//   userId = process.env.COMPOSIO_USER_ID
//
// Run with:  npx tsx test-connections.ts
// ============================================================
import { Composio } from "@composio/core";
import fs from "fs";
import path from "path";

// ---- EDIT THESE TWO before running -------------------------------------
const TEST_EMAIL_RECIPIENT = "linda@failfasterventures.com"; // an inbox you own
const SLACK_CHANNEL        = "#deal-desk"; // channel name or id
// ------------------------------------------------------------------------

// Minimal .env.local loader — a plain `tsx` run (unlike `next dev`) does not
// auto-load .env.local, so we read it here. Existing process.env wins.
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

// ---- Composio action slugs (mirror the constants in lib/agent.ts) -------
const ACTION_CREATE_CRM_RECORD = "NOTION_INSERT_ROW_DATABASE"; // CRM = a Notion DB page
const ACTION_SEND_EMAIL        = "GMAIL_SEND_EMAIL";
const ACTION_BOOK_MEETING      = "GOOGLECALENDAR_CREATE_EVENT";
const ACTION_NOTIFY_TEAM       = "SLACK_SEND_MESSAGE";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY }); // same as lib/agent.ts
const COMPOSIO_USER_ID = process.env.COMPOSIO_USER_ID || "default";

// Tomorrow at 10:00 local time, for the calendar test.
const start = new Date();
start.setDate(start.getDate() + 1);
start.setHours(10, 0, 0, 0);
const startIso = start.toISOString();

// Run one named action, print ✅/❌ + the full result or error, never throw.
async function fire(label: string, slug: string, args: Record<string, any>) {
  console.log(`\n--- ${label}  (${slug}) ---`);
  try {
    // dangerouslySkipVersionCheck must be passed per-call (the SDK reads it off the
    // execute body, not the client config) — otherwise v3 rejects "latest" toolkit versions.
    const res = await composio.tools.execute(slug, {
      userId: COMPOSIO_USER_ID,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });
    if (res.successful) {
      console.log(`✅ ${label} OK`);
      console.dir(res.data, { depth: 4 });
    } else {
      console.log(`❌ ${label} FAILED (action returned not-successful)`);
      console.dir(res, { depth: 6 });
    }
  } catch (err) {
    console.log(`❌ ${label} THREW`);
    console.dir(err, { depth: 6 });
  }
}

async function main() {
  if (!TEST_EMAIL_RECIPIENT || !SLACK_CHANNEL) {
    console.error(
      "✋ Fill in TEST_EMAIL_RECIPIENT and SLACK_CHANNEL at the top of this file first."
    );
    process.exit(1);
  }
  console.log(`Composio user: ${COMPOSIO_USER_ID}`);

  // NOTE: the argument KEYS below are best-effort and may differ per your
  // Composio action version — check each action's input schema in the Composio
  // dashboard if you get a validation error (a validation error still proves
  // auth/connectivity works; only a connection/auth error means the app isn't
  // linked for this user).

  // 1. Slack — SLACK_SEND_MESSAGE wants markdown_text (or fallback_text + blocks), not text.
  await fire("Slack", ACTION_NOTIFY_TEAM, {
    channel: SLACK_CHANNEL,
    markdown_text: "✅ deal-desk connectivity test",
  });

  // 2. Gmail
  await fire("Gmail", ACTION_SEND_EMAIL, {
    to: TEST_EMAIL_RECIPIENT,
    subject: "deal-desk connectivity test",
    body: "This is an automated test from deal-desk. If you received it, Gmail is wired up. ✅",
  });

  // 3. Google Calendar — 30-min event tomorrow at 10am
  await fire("Google Calendar", ACTION_BOOK_MEETING, {
    summary: "deal-desk test",
    start_datetime: startIso,
    event_duration_minutes: 30,
  });

  // 4. Notion — NOTION_INSERT_ROW_DATABASE wants database_id + a LIST of
  // {name, type, value} property objects (values as strings). A column named
  // "Status" is still type "select" unless it's a true Notion status column.
  await fire("Notion", ACTION_CREATE_CRM_RECORD, {
    database_id: process.env.NOTION_DATABASE_ID,
    properties: [
      { name: "Name",   type: "title",  value: "Test Lead" },
      { name: "Tier",   type: "select", value: "warm" },
      { name: "Score",  type: "number", value: "50" },
      { name: "Status", type: "select", value: "Lead" },
    ],
  });

  console.log("\nDone. Review each ✅/❌ above.");
}

main();
