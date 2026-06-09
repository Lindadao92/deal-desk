// ============================================================
// replies.ts — the REPLY LOOP. The agent reacts to a lead's email reply:
// fetch reply -> classify intent (Claude) -> act via Composio -> update status + trace.
//
// Reuses the SAME Composio v3 client, action-slug constants, Anthropic client,
// Supabase client, and JSON parser as lib/agent.ts (imported, not copied).
// ============================================================
import {
  runAction,
  supabase,
  anthropic,
  MODEL,
  safeJson,
  nextBusinessSlot,
  ACTION_SEND_EMAIL,
  ACTION_NOTIFY_TEAM,
  ACTION_BOOK_MEETING,
  SLACK_CHANNEL,
  type Outreach,
} from "./agent";

// ---- New Composio action slugs for the reply loop (mirror agent.ts style;
// confirm exact names in your Composio dashboard before running) ----
const ACTION_FETCH_THREAD      = "GMAIL_FETCH_MESSAGE_BY_THREAD_ID";
const ACTION_FETCH_EMAILS      = "GMAIL_FETCH_EMAILS";
const ACTION_UPDATE_EVENT      = "GOOGLECALENDAR_PATCH_EVENT";
const ACTION_UPDATE_CRM_RECORD = "NOTION_UPDATE_ROW_DATABASE";

const MEETING_MINUTES = 30;

type LeadRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  outreach: Outreach | null;
  last_message_id: string | null;
  trace: any[] | null;
};

type Intent = "reschedule" | "confirm" | "question" | "not_interested";
type Classification = {
  intent: Intent;
  proposed_time: string | null; // ISO 8601 w/ offset, only for reschedule
  summary: string;
};

type ReplyResult = {
  id: string;
  email: string;
  action: string;
  status?: string;
};

// ---- Composio response helpers (shapes vary, so coalesce defensively) ----
function extractMessages(fetchRes: any): any[] {
  const d = fetchRes?.data ?? {};
  return d.messages ?? d.data?.messages ?? (Array.isArray(d) ? d : []) ?? [];
}

function messageId(m: any): string | null {
  return m?.messageId ?? m?.id ?? m?.message_id ?? null;
}

function messageText(m: any): string {
  return (
    m?.messageText ??
    m?.preview?.body ??
    m?.snippet ??
    m?.text ??
    m?.body ??
    ""
  );
}

// Was a thread message sent by us (the agent), not the lead? Our sent mail carries
// the Gmail "SENT" label; inbound replies don't. Fall back to the sender address.
function isSentByAgent(m: any, leadEmail: string): boolean {
  const labels = m?.labelIds ?? m?.label_ids ?? [];
  if (Array.isArray(labels) && labels.length) return labels.includes("SENT");
  const sender = String(m?.sender ?? m?.from ?? "").toLowerCase();
  if (sender) return !sender.includes(leadEmail.toLowerCase());
  return false; // unknown provenance → treat as a candidate reply
}

// Newest message by timestamp (handles ISO strings and epoch-ms `internalDate`).
function pickLatest(msgs: any[]): any | null {
  if (!msgs.length) return null;
  const ts = (m: any) => {
    const t = m?.messageTimestamp ?? m?.internalDate ?? m?.date;
    if (!t) return 0;
    const n = new Date(isNaN(Number(t)) ? t : Number(t)).getTime();
    return isNaN(n) ? 0 : n;
  };
  return [...msgs].sort((a, b) => ts(b) - ts(a))[0];
}

function addMinutesIso(iso: string, mins: number): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + mins * 60_000).toISOString();
}

function firstName(name: string): string {
  return (name || "there").trim().split(/\s+/)[0];
}

// ---- 1. Classify the reply's intent ----
async function classifyReply(lead: LeadRow, replyText: string): Promise<Classification> {
  const today = new Date().toISOString();
  const prompt =
    `You are triaging a reply to a sales outreach email from ${lead.name}.\n` +
    `Our original email was about: "${lead.outreach?.subject ?? "a product demo"}".\n` +
    `Today is ${today}.\n\n` +
    `Classify the reply's intent as EXACTLY one of: reschedule, confirm, question, not_interested.\n` +
    `- reschedule: they want a different meeting time. Extract the concrete new time as an ISO 8601 ` +
    `datetime WITH a timezone offset (resolve relative phrases like "next Tuesday 2pm" against today's date). ` +
    `If no concrete time is stated, set proposed_time to null.\n` +
    `- confirm: they accept / confirm the meeting or are happy to proceed.\n` +
    `- question: they ask something or want more info before committing.\n` +
    `- not_interested: they decline, opt out, or say it's not a fit.\n\n` +
    `Return ONLY this JSON, no prose, no markdown, no backticks:\n` +
    `{"intent":"reschedule|confirm|question|not_interested","proposed_time":"<ISO 8601 or null>","summary":"<one short line>"}\n\n` +
    `REPLY:\n${replyText}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });
  return safeJson(res) as Classification;
}

// ---- Draft a short answer to a question reply ----
async function draftAnswer(lead: LeadRow, replyText: string): Promise<{ subject: string; body: string }> {
  const prompt =
    `${lead.name} replied to our outreach with a question. Write a SHORT, helpful, human answer.\n` +
    `Rules: under 120 words, one clear next step (offer to talk), NO em-dashes, no corporate fluff.\n` +
    `Their reply: "${replyText}"\n\n` +
    `Return ONLY JSON: {"subject":"...","body":"..."}. No prose, no markdown, no backticks.`;
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  return safeJson(res);
}

// ---- 2 + 3. Act on the classified intent, autonomously, via Composio ----
async function act(
  lead: LeadRow,
  cls: Classification,
  replyText: string,
  trace: any[]
): Promise<{ status: string; actionLine: string; outreach?: Outreach }> {
  const now = () => new Date().toISOString();
  const step = (s: string, detail?: any) => trace.push({ at: now(), step: s, ...(detail ? { detail } : {}) });
  const subject = `Re: ${lead.outreach?.subject ?? "our conversation"}`;
  const who = firstName(lead.name);

  // Book a fresh calendar event (sends the attendee a Google invite) and return its id.
  const bookMeeting = async (startIso: string): Promise<string | null> => {
    const calRes = await runAction(ACTION_BOOK_MEETING, {
      summary: `${lead.name} <> us — intro`,
      attendees: [lead.email],
      start_datetime: startIso,
      event_duration_minutes: MEETING_MINUTES,
    });
    return (calRes as any)?.data?.response_data?.id ?? (calRes as any)?.data?.id ?? null;
  };
  const withEvent = (eventId: string | null): Outreach =>
    ({ ...(lead.outreach ?? ({} as Outreach)), calendar_event_id: eventId });

  step("classified", { intent: cls.intent, proposed_time: cls.proposed_time, summary: cls.summary });

  if (cls.intent === "reschedule") {
    const start = cls.proposed_time;
    const end = start ? addMinutesIso(start, MEETING_MINUTES) : null;

    if (start && end) {
      let outreach: Outreach | undefined;
      if (lead.outreach?.calendar_event_id) {
        // An event exists (hot lead) — patch it to the new time.
        await runAction(ACTION_UPDATE_EVENT, {
          calendar_id: "primary",
          event_id: lead.outreach.calendar_event_id,
          start_time: start,
          end_time: end,
        });
        step("calendar_patched", { event_id: lead.outreach.calendar_event_id, start_time: start });
      } else {
        // No hold yet (warm lead) — book one at the requested time; this sends the invite.
        const eventId = await bookMeeting(start);
        outreach = withEvent(eventId);
        step("calendar_booked", { event_id: eventId, start_datetime: start });
      }

      await runAction(ACTION_SEND_EMAIL, {
        to: lead.email,
        subject,
        body: `Hi ${who},\n\nDone, our meeting is set for ${start} and a calendar invite is on its way. Talk then.\n\nBest`,
      });
      step("email_sent", { kind: "reschedule_confirmation" });

      await runAction(ACTION_NOTIFY_TEAM, {
        channel: SLACK_CHANNEL,
        markdown_text:
          `🔁 *Reschedule: ${lead.name} — ${start}*\n` +
          `• ${cls.summary}\n` +
          `✅ Calendar invite sent`,
      });
      step("slack_notified");
      return { status: "rescheduled", actionLine: `Rescheduled to ${start}`, outreach };
    }

    // Reschedule intent but no concrete time: ask for a specific time,
    // stay awaiting_reply so a future reply with a time is still handled.
    await runAction(ACTION_SEND_EMAIL, {
      to: lead.email,
      subject,
      body: `Hi ${who},\n\nHappy to move it. What day and time work best for you?\n\nBest`,
    });
    step("email_sent", { kind: "ask_for_time" });
    await runAction(ACTION_NOTIFY_TEAM, {
      channel: SLACK_CHANNEL,
      markdown_text:
        `🔁 *Reschedule (no time given): ${lead.name}*\n` +
        `• ${cls.summary}\n` +
        `→ Asked for a specific time`,
    });
    step("slack_notified");
    return { status: "awaiting_reply", actionLine: "Asked for a specific time" };
  }

  if (cls.intent === "confirm") {
    // If no hold exists yet (warm lead), book one now so the lead gets a real
    // calendar invite — confirming should put time on the calendar.
    let outreach: Outreach | undefined;
    let slot: string | null = lead.outreach?.calendar_event_id ? null : nextBusinessSlot();
    if (slot) {
      const eventId = await bookMeeting(slot);
      outreach = withEvent(eventId);
      step("calendar_booked", { event_id: eventId, start_datetime: slot });
    }

    await runAction(ACTION_SEND_EMAIL, {
      to: lead.email,
      subject,
      body: slot
        ? `Hi ${who},\n\nGreat, you're confirmed. I've sent a calendar invite for ${slot}. See you then.\n\nBest`
        : `Hi ${who},\n\nPerfect, you're all set for the time we held. Looking forward to it.\n\nBest`,
    });
    step("email_sent", { kind: "confirmation" });
    await runAction(ACTION_NOTIFY_TEAM, {
      channel: SLACK_CHANNEL,
      markdown_text:
        `✅ *Confirmed: ${lead.name}*\n• ${cls.summary}\n` +
        (slot ? `✅ Calendar invite sent (${slot})` : `✅ Confirmation sent`),
    });
    step("slack_notified");
    return {
      status: "confirmed",
      actionLine: slot ? `Confirmed + invite sent` : "Confirmed",
      outreach,
    };
  }

  if (cls.intent === "question") {
    const answer = await draftAnswer(lead, replyText);
    await runAction(ACTION_SEND_EMAIL, {
      to: lead.email,
      subject: answer.subject || subject,
      body: answer.body,
    });
    step("email_sent", { kind: "answer" });
    await runAction(ACTION_NOTIFY_TEAM, {
      channel: SLACK_CHANNEL,
      markdown_text: `💬 *Question: ${lead.name}*\n• ${cls.summary}\n✅ Answer sent`,
    });
    step("slack_notified");
    return { status: "replied", actionLine: "Answered question" };
  }

  // not_interested → NO email. Update Notion + Slack, mark closed_lost.
  if (lead.outreach?.notion_page_id) {
    await runAction(ACTION_UPDATE_CRM_RECORD, {
      row_id: lead.outreach.notion_page_id,
      properties: [{ name: "Status", type: "select", value: "Closed Lost" }],
    });
    step("notion_updated", { status: "Closed Lost" });
  }
  await runAction(ACTION_NOTIFY_TEAM, {
    channel: SLACK_CHANNEL,
    markdown_text:
      `🔴 *Not interested: ${lead.name}*\n` +
      `• ${cls.summary}\n` +
      `→ Marked closed_lost · no email sent`,
  });
  step("slack_notified");
  return { status: "closed_lost", actionLine: "Closed lost" };
}

// Find the lead's latest reply. Preferred path: the actual outreach THREAD —
// the newest message in it not sent by the agent. Fallback (no stored thread, or
// thread had no inbound msg): search by the lead's sender address.
async function findReply(lead: LeadRow): Promise<{ id: string; text: string } | null> {
  if (lead.outreach?.thread_id) {
    const res = await runAction(ACTION_FETCH_THREAD, {
      thread_id: lead.outreach.thread_id,
      user_id: "me",
    });
    const inbound = extractMessages(res).filter((m) => !isSentByAgent(m, lead.email));
    const latest = pickLatest(inbound);
    const id = latest && messageId(latest);
    if (id) return { id, text: messageText(latest) };
    // else fall through to address search
  }

  const res = await runAction(ACTION_FETCH_EMAILS, {
    query: `from:${lead.email}`,
    user_id: "me",
    max_results: 5,
    include_payload: true,
  });
  const latest = pickLatest(extractMessages(res)) ?? extractMessages(res)[0];
  const id = latest && messageId(latest);
  if (id) return { id, text: messageText(latest) };
  return null;
}

// ---- Handle one awaiting-reply lead ----
async function handleOneReply(lead: LeadRow): Promise<ReplyResult> {
  const reply = await findReply(lead);
  if (!reply) return { id: lead.id, email: lead.email, action: "no reply yet" };

  const msgId = reply.id;
  // Idempotency: never process the same reply twice.
  if (msgId === lead.last_message_id) {
    return { id: lead.id, email: lead.email, action: "already handled" };
  }

  const replyText = reply.text;
  const trace: any[] = [...(lead.trace ?? [])];
  trace.push({ at: new Date().toISOString(), step: "reply_received", detail: { message_id: msgId } });

  const cls = await classifyReply(lead, replyText);
  const { status, actionLine, outreach } = await act(lead, cls, replyText, trace);

  await supabase
    .from("leads")
    .update({
      status,
      last_message_id: msgId, // mark handled
      last_reply_action: actionLine,
      trace,
      // If a meeting was newly booked during reply handling, persist its event id
      // so a later reschedule can patch it.
      ...(outreach ? { outreach } : {}),
    })
    .eq("id", lead.id);

  return { id: lead.id, email: lead.email, action: actionLine, status };
}

// ---- Entry point: react to replies for every awaiting-reply lead ----
export async function checkReplies() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id,name,email,status,outreach,last_message_id,trace")
    .eq("status", "awaiting_reply")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  const results: ReplyResult[] = [];
  for (const lead of (leads ?? []) as LeadRow[]) {
    try {
      results.push(await handleOneReply(lead));
    } catch (err) {
      results.push({
        id: lead.id,
        email: lead.email,
        action: `error: ${(err as Error).message}`,
      });
    }
  }
  return { checked: leads?.length ?? 0, results };
}
