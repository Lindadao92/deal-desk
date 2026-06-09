// ============================================================
// agent.ts — the loop. Trigger -> Enrich -> Precedent -> Score -> Execute.
// Composio executes every external action; Claude is the brain.
// ============================================================
import Anthropic from "@anthropic-ai/sdk";
import { Composio } from "@composio/core";
import { createClient } from "@supabase/supabase-js";
import { findPrecedent, summarizePrecedent } from "./retrieval";
import { SCORING_PROMPT } from "./scoring_prompt";
import { randomUUID } from "node:crypto";

// ---- Composio action slugs ----------------------------------------------
// These four slugs name the external actions the agent fires. Composio slugs
// change over time — confirm the exact names in your Composio dashboard and
// adjust here. Everything downstream references these constants, not literals.
// Exported so the reply loop (lib/replies.ts) reuses the SAME slugs, not copies.
export const ACTION_CREATE_CRM_RECORD = "NOTION_INSERT_ROW_DATABASE"; // CRM = a Notion DB page
export const ACTION_SEND_EMAIL        = "GMAIL_SEND_EMAIL";
export const ACTION_BOOK_MEETING      = "GOOGLECALENDAR_CREATE_EVENT";
export const ACTION_NOTIFY_TEAM       = "SLACK_SEND_MESSAGE";

// The Slack channel the team is notified in (shared with the reply loop).
export const SLACK_CHANNEL = "#deal-desk";

// Exported so lib/replies.ts shares the SAME clients (one Composio/Anthropic/Supabase each).
export const anthropic = new Anthropic();           // ANTHROPIC_API_KEY in env
const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY }); // v3 SDK
export const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

// Composio v3 scopes every tool execution to a connected user. Set the user id
// you connected Notion/Gmail/Calendar/Slack under (defaults to "default").
const COMPOSIO_USER_ID = process.env.COMPOSIO_USER_ID || "default";

export const MODEL = "claude-sonnet-4-6"; // current Sonnet for cost/speed

// Thin wrapper so every external side effect goes through one place.
// dangerouslySkipVersionCheck must be passed per-call (the SDK reads it off the
// execute body, not the client config) — otherwise v3 rejects "latest" toolkit versions.
export function runAction(slug: string, args: Record<string, any>) {
  return composio.tools.execute(slug, {
    userId: COMPOSIO_USER_ID,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
}

// Concatenate the text blocks of a Claude response (e.g. a web_search turn).
function responseText(res: Anthropic.Message): string {
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();
}

// ---- 1. ENRICH: agent researches the lead with a multi-query web search ----
// Runs several targeted web_search passes IN PARALLEL (company + person), then a
// synthesis pass that merges everything into one JSON object. Downstream code
// (decide/findPrecedent) treats company/vertical/company_size/etc. as FLAT scalars,
// so those keys are preserved; richer intel lives under signals/conversion_hook/sources.
async function enrich(lead: { email: string; message: string; researchDomain?: string }) {
  // researchDomain lets a demo/dry-run point research at a real company while the
  // outreach email still goes to an inbox you control. Defaults to the email domain.
  const domain = lead.researchDomain || lead.email.split("@")[1];
  const freeMail = ["gmail.com", "outlook.com", "yahoo.com", "icloud.com"].includes(domain);
  const ctx =
    `Email domain: ${domain}${freeMail ? " (free webmail — may not map to a company)" : ""}\n` +
    `Inbound message: ${lead.message}`;

  // One web-search-enabled research pass; returns the model's findings as text.
  const research = (instruction: string) =>
    anthropic.messages
      .create({
        model: MODEL,
        max_tokens: 1200,
        tools: [{ type: "web_search_20250305", name: "web_search" } as any],
        messages: [{ role: "user", content: `${instruction}\n\n${ctx}\n\nList concrete findings, each with the source URL you used. If nothing is found, say so explicitly — do not guess.` }],
      })
      .then(responseText);

  // 3–5 targeted queries, fanned out in parallel.
  const [companyFunding, companyNewsHiring, personBackground, personActivity] = await Promise.all([
    research(`Research the COMPANY behind this inbound lead using PUBLIC sources: funding rounds and stage, total raised, investors, and approximate headcount/size.`),
    research(`Research the COMPANY's recent activity using PUBLIC sources: recent news/press (last ~12 months), product launches, and OPEN JOB POSTINGS that imply finance/operations/reconciliation pain (controller, accounting, RevOps, finance ops).`),
    research(`Research the PERSON who sent this inbound lead using PUBLIC sources: their title and seniority, tenure at the company, and any recent job change.`),
    research(`Research the PERSON's public footprint using PUBLIC sources: recent public posts, press or podcast mentions, and what they appear to care about professionally.`),
  ]);

  // Synthesis pass (no tools): merge into the single JSON shape used downstream.
  const synth = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{
      role: "user",
      content:
        `Synthesize the research below on an inbound lead into ONE JSON object.\n` +
        `INBOUND MESSAGE: ${lead.message}\nEMAIL DOMAIN: ${domain}${freeMail ? " (free webmail)" : ""}\n\n` +
        `=== COMPANY FUNDING/SIZE ===\n${companyFunding}\n\n` +
        `=== COMPANY NEWS/HIRING ===\n${companyNewsHiring}\n\n` +
        `=== PERSON BACKGROUND ===\n${personBackground}\n\n` +
        `=== PERSON ACTIVITY ===\n${personActivity}\n\n` +
        `Return ONLY a single compact JSON object — no preamble, no markdown, no backticks — with EXACTLY:\n` +
        `{\n` +
        `  "company": "",        // best-guess company name, or "" if unknown\n` +
        `  "vertical": "",       // ONE word: fintech | devtools | healthtech | other | unknown\n` +
        `  "company_size": 0,    // integer headcount, best estimate\n` +
        `  "funding_stage": "",  // pre-seed | seed | series_a | series_b+ | unknown\n` +
        `  "persona": "",        // the contact's likely title, e.g. "VP Finance"\n` +
        `  "buying_signals": [], // short phrases\n` +
        `  "note": "",           // one sentence on what they care about + any research gaps\n` +
        `  "signals": {\n` +
        `    "funding": null,        // short string or null if not found\n` +
        `    "hiring": null,         // roles implying our pain, or null\n` +
        `    "news": null,           // recent company news/press, or null\n` +
        `    "recent_activity": null,// the person's recent posts/job change, or null\n` +
        `    "press": null           // the person's press/podcast mentions, or null\n` +
        `  },\n` +
        `  "conversion_hook": "",// the SINGLE most specific, useful fact to OPEN outreach with, plus the angle it supports\n` +
        `  "sources": []         // list of {"title":"","url":""} actually referenced in the research above\n` +
        `}\n` +
        `Rules: company/vertical/company_size/funding_stage/persona/buying_signals/note must be FLAT scalars/arrays exactly as typed. ` +
        `If a fact wasn't found, set it null and note the gap in "note". NEVER fabricate a company, person, fact, or URL — ` +
        `only include sources that literally appear in the research above.`,
    }],
  });
  return safeJson(synth); // flat scoring keys + { signals, conversion_hook, sources }
}

// ---- 2 + 3. PRECEDENT + SCORE (the brain) ----
async function decide(form: any, research: any) {
  const precedent = await findPrecedent({
    vertical: research.vertical || "unknown",
    company_size: research.company_size || 1,
  });

  const filled = SCORING_PROMPT
    .replace("{{form_data}}", JSON.stringify(form))
    .replace("{{research_signals}}", JSON.stringify(research))
    .replace("{{precedent_summary}}", summarizePrecedent(precedent));

  const res = await anthropic.messages.create({
    model: MODEL,
    // Research-rich leads produce long reasons + angle_justification +
    // suggested_use_cases; 1024 truncated the JSON mid-string. 2048 gives headroom.
    max_tokens: 2048,
    messages: [{ role: "user", content: filled }],
  });
  return safeJson(res); // the decision JSON (score, tier, action, angle, auto_book...)
}

// What we persist about a qualified lead's outreach so the reply loop can find
// the thread and reschedule the booked meeting later. null for cold leads.
export type Outreach = {
  recipient: string;
  subject: string;
  thread_id: string | null;
  sent_message_id: string | null;
  calendar_event_id: string | null;
  notion_page_id: string | null;
};

// ---- 4. EXECUTE via Composio, branching on the decision ----
// `trace` accumulates a timestamped record of each step (and, for email/Slack,
// the message body) so the UI can show the real story. Additive: it records what
// the existing actions do, it does not change the fork or the Composio calls.
async function execute(lead: any, research: any, decision: any, leadId: string, trace: any[]): Promise<Outreach | null> {
  // CRM = a page in a Notion database, created for every tier. GOTCHA: the Notion integration must be
  // explicitly shared with this database (open the DB -> ... -> Connections ->
  // add your integration) or Composio will get "could not find database".
  // Property keys below must match your DB's column names EXACTLY (case-sensitive).
  // NOTION_INSERT_ROW_DATABASE wants `database_id` + a LIST of {name, type, value}
  // property objects with string values (NOT the raw Notion property format).
  // Property names + types are case-sensitive and must match the DB schema.
  const crmRes = await runAction(ACTION_CREATE_CRM_RECORD, {
    database_id: process.env.NOTION_DATABASE_ID,
    properties: [
      { name: "Name",    type: "title",     value: lead.name },
      { name: "Email",   type: "email",     value: lead.email },
      { name: "Company", type: "rich_text", value: research.company || "" },
      { name: "Tier",    type: "select",    value: decision.tier },
      { name: "Score",   type: "number",    value: String(decision.score) },
      { name: "Status",  type: "select",    value: decision.tier === "cold" ? "Nurture" : "Lead" },
      { name: "Angle",   type: "select",    value: decision.angle },
      { name: "Notes",   type: "rich_text", value: decision.reasons.join("; ") },
    ],
  });
  // Notion returns the created page id; keep it so the reply loop can update the row.
  const notion_page_id: string | null = (crmRes as any)?.data?.id ?? null;
  trace.push({
    step: "crm_created",
    app: "Notion",
    at: new Date().toISOString(),
    body:
      `Name: ${lead.name}\n` +
      `Email: ${lead.email}\n` +
      `Company: ${research.company || "—"}\n` +
      `Tier: ${decision.tier}   Score: ${decision.score}   Angle: ${decision.angle}`,
  });

  if (decision.tier === "cold") {
    const company = research.company || "unknown company";
    const bullets = decision.reasons.slice(0, 2).map((r: string) => `• ${r}`).join("\n");
    const nurtureMsg =
      `⚪ *Nurture: ${lead.name} @ ${company} — ${decision.tier} (${decision.score})*\n` +
      `${bullets}\n` +
      `→ Routed to nurture · no outreach`;
    await runAction(ACTION_NOTIFY_TEAM, { channel: SLACK_CHANNEL, markdown_text: nurtureMsg });
    trace.push({ step: "slack_notified", app: "Slack", at: new Date().toISOString(), body: nurtureMsg });
    return null;
  }

  // hot / warm: draft a personalized email using the chosen angle
  const email = await draftEmail(lead, research, decision, leadId);
  const sendRes = await runAction(ACTION_SEND_EMAIL, {
    to: lead.email, subject: email.subject, body: email.body,
  });
  // Gmail returns { id, threadId, ... } — keep them so we can find the reply later.
  const thread_id: string | null = (sendRes as any)?.data?.threadId ?? null;
  const sent_message_id: string | null = (sendRes as any)?.data?.id ?? null;
  trace.push({
    step: "email_sent",
    app: "Gmail",
    at: new Date().toISOString(),
    body: `Subject: ${email.subject}\n\n${email.body}`,
  });

  let calendar_event_id: string | null = null;
  if (decision.auto_book) { // hot only
    const slot = nextBusinessSlot(); // ISO 8601
    const calRes = await runAction(ACTION_BOOK_MEETING, {
      summary: `${research.company} <> us — intro`,
      attendees: [lead.email],
      start_datetime: slot,
      event_duration_minutes: 30,
    });
    // Calendar create nests the event under response_data; keep the id to reschedule.
    calendar_event_id =
      (calRes as any)?.data?.response_data?.id ?? (calRes as any)?.data?.id ?? null;
    trace.push({
      step: "calendar_booked",
      app: "Google Calendar",
      at: new Date().toISOString(),
      body: `Meeting time: ${slot} (30 min)`,
    });
  }

  const company = research.company || "unknown company";
  const factLines = [
    `• Angle: *${decision.angle}*`,
    ...decision.reasons.slice(0, 2).map((r: string) => `• ${r}`),
  ].join("\n");
  const actionLine = decision.auto_book
    ? "✅ Emailed + held a slot"
    : "✅ Emailed · proposed times";
  const slackMsg =
    `🟢 *Qualified: ${lead.name} @ ${company} — ${decision.tier} (${decision.score})*\n` +
    `${factLines}\n` +
    `${actionLine}`;
  await runAction(ACTION_NOTIFY_TEAM, { channel: SLACK_CHANNEL, markdown_text: slackMsg });
  trace.push({ step: "slack_notified", app: "Slack", at: new Date().toISOString(), body: slackMsg });

  return {
    recipient: lead.email,
    subject: email.subject,
    thread_id,
    sent_message_id,
    calendar_event_id,
    notion_page_id,
  };
}

// ---- glue ----
export async function handleLead(lead: { email: string; name: string; message: string; researchDomain?: string }) {
  // dedup: skip if we've already processed this email
  const { data: existing } = await supabase.from("leads").select("id").eq("email", lead.email).maybeSingle();
  if (existing) return { skipped: true };

  // Pre-generate the row id so the brief URL is known before the email is drafted.
  const leadId = randomUUID();

  // Activity trace: each step records a real timestamp; email/Slack steps also
  // store their message body so the drawer can expand them. Stored in the existing
  // `trace` jsonb (no new column).
  const trace: any[] = [{ step: "lead_received", app: "Form", at: new Date().toISOString() }];

  const research = await enrich({ email: lead.email, message: lead.message, researchDomain: lead.researchDomain });
  const decision = await decide(lead, research);
  trace.push({
    step: "scored",
    app: "Claude",
    at: new Date().toISOString(),
    detail: { score: decision.score, tier: decision.tier },
  });

  // Personalized one-page brief for qualified (hot/warm) leads only; cold skips it.
  const brief = decision.tier === "cold" ? null : await generateBrief(lead, research, decision);
  const outreach = await execute(lead, research, decision, leadId, trace);

  // Emailed (hot/warm) leads now wait for a reply; cold leads are just nurtured.
  await supabase.from("leads").insert({
    id: leadId,
    email: lead.email, name: lead.name, raw_message: lead.message,
    enrichment: research, decision,
    status: decision.tier === "cold" ? "nurtured" : "awaiting_reply",
    outreach,
    brief,
    trace,
  });
  return { research, decision };
}

// ---- helpers ----

// Pull the text out of a Claude response, strip any ```json fences, and parse it.
export function safeJson(res: Anthropic.Message): any {
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("")
    .trim();

  // If the model wrapped the JSON in a code fence, pull out the fenced content.
  // Otherwise (e.g. it added a prose preamble), slice from the first { to the
  // last } so surrounding commentary doesn't break the parse.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = (fenced ? fenced[1] : text).trim();
  if (!fenced) {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first !== -1 && last > first) candidate = candidate.slice(first, last + 1);
  }

  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `Could not parse JSON from Claude response: ${(err as Error).message}\n--- raw model text ---\n${text}`
    );
  }
}

// Ask Claude to write a short, human email using the chosen angle.
async function draftEmail(
  lead: { email: string; name: string; message: string },
  research: any,
  decision: any,
  leadId: string
): Promise<{ subject: string; body: string }> {
  const timing = decision.auto_book
    ? `A 30-minute meeting time has already been HELD on the calendar. Tell them it's booked, give them the slot, and invite them to suggest another time if it doesn't work.`
    : `Propose two specific times next week for a short call and ask which works better.`;

  const prompt =
    `Write a SHORT outbound email to ${lead.name}. Use the "${decision.angle}" angle.\n` +
    `OPEN with the research "conversion_hook" if present; otherwise cite at least ONE specific item ` +
    `from research.signals (funding, hiring, news, recent_activity, press) and name it concretely. ` +
    `Do NOT invent facts — if the research is thin, keep the opener general rather than fabricating.\n` +
    `Weave in the SINGLE most relevant item from decision.suggested_use_cases — phrase it as how ` +
    `we'd specifically help THEM (tie it to their pain/vertical/size), not as a generic feature.\n` +
    `Sound like a real person wrote it: plain, direct, warm, lowercase-friendly subject ok.\n` +
    `Hard rules: under 120 words, one clear ask, NO em-dashes, no corporate fluff, no buzzwords,\n` +
    `no "I hope this email finds you well", no exclamation spam.\n` +
    `${timing}\n\n` +
    `LEAD: ${JSON.stringify(lead)}\n` +
    `RESEARCH: ${JSON.stringify(research)}\n` +
    `DECISION: ${JSON.stringify(decision)}\n\n` +
    `Return ONLY JSON: {"subject": "...", "body": "..."}. No prose, no markdown, no backticks.`;

  const res = await anthropic.messages.create({
    model: MODEL, // claude-sonnet-4-6
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const email = safeJson(res);

  // Additive: append ONE sentence linking the personalized brief. The URL is known
  // up front from the pre-generated lead id; the rest of the email is untouched.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  if (!process.env.NEXT_PUBLIC_BASE_URL) {
    console.warn("[brief] NEXT_PUBLIC_BASE_URL is not set — brief links fall back to http://localhost:3000");
  }
  const company = research.company || "your team";
  email.body = `${email.body}\n\nI put together a quick overview for ${company}: ${baseUrl}/brief/${leadId}`;
  return email;
}

// Generate a personalized one-page brief (hot/warm only). ONE Claude call, strict
// JSON, every field grounded in THIS lead's research and message. Stored on the
// `brief` jsonb column and rendered at /brief/[id].
async function generateBrief(
  lead: { email: string; name: string; message: string },
  research: any,
  scoring: any
): Promise<any> {
  const prompt =
    `Create a personalized one-page sales brief for an inbound lead. Ground EVERY field in THIS ` +
    `lead's message and research: their company, vertical, size, funding stage, the specific pain ` +
    `they named, and any number they gave. Do NOT invent facts, customer names, logos, or metrics ` +
    `you do not have. Concrete and human, no corporate fluff, no em-dashes.\n\n` +
    `LEAD: ${JSON.stringify(lead)}\n` +
    `RESEARCH: ${JSON.stringify(research)}\n` +
    `SCORING: ${JSON.stringify(scoring)}\n\n` +
    `Return ONLY this JSON, no prose, no markdown, no backticks:\n` +
    `{\n` +
    `  "headline": "",            // short, names their company and the outcome\n` +
    `  "tailored_value_prop": "", // 1-2 sentences tied to their exact pain, vertical, and size\n` +
    `  "use_cases": [],           // 2-3 short strings, each specific to them\n` +
    `  "impact_estimate": "",     // a soft estimate referencing the scale/number they gave, never a guarantee\n` +
    `  "recommended_plan": "",    // the plan/tier that fits a company their size and stage\n` +
    `  "price_band": "",          // a soft indicative range ONLY, never a hard quote\n` +
    `  "proof_point": "",         // a credible proof framing grounded in precedent; no invented specifics\n` +
    `  "next_step": "",           // the concrete next step or proposed meeting\n` +
    `  "est_value": 0             // estimated ANNUAL contract value in whole dollars (a single integer, not a range), grounded in their size + stage and CONSISTENT with price_band\n` +
    `}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  return safeJson(res);
}

// ISO 8601 (with local UTC offset) for the next weekday at 10:00 local, skipping Sat/Sun.
export function nextBusinessSlot(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1); // start from tomorrow
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // skip Sun(0)/Sat(6)
  d.setHours(10, 0, 0, 0); // 10:00 local

  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset(); // e.g. +120 for UTC+2
  const sign = offsetMin >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offM = pad(Math.abs(offsetMin) % 60);

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${offH}:${offM}`
  );
}
