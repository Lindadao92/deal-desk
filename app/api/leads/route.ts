// POST /api/leads — the demo trigger. Accepts an inbound lead and runs the
// full agent loop (enrich -> precedent -> score -> execute) via handleLead().
//
// Example:
//   curl -X POST http://localhost:3000/api/leads \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"vp@acmeledger.com","name":"Dana Lee","message":"reconciliation is killing us"}'
import { handleLead } from "@/lib/agent";
import { createClient } from "@supabase/supabase-js";

// agent.ts uses fs/process.cwd() and the Composio/Anthropic/Supabase SDKs, so
// this must run on the Node.js runtime (not edge). It's also never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The lead pipeline (web research + scoring + Composio actions) runs ~37s.
// Vercel Pro allows up to 300s; 120 gives ample headroom.
export const maxDuration = 120;

// Server-only Supabase client. The service key lives in env and is read here on
// the server — it is NEVER serialized to the browser (route handlers run server-side).
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// GET /api/leads — the ~20 most recent leads for the live activity feed.
export async function GET() {
  const { data, error } = await supabase
    .from("leads")
    .select("id,name,email,status,enrichment,decision,last_reply_action,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ leads: data ?? [] });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const { email, name, message, researchDomain } = (payload ?? {}) as {
    email?: string;
    name?: string;
    message?: string;
    researchDomain?: string; // optional: research a real company while emailing your own inbox
  };

  if (!email || !name || !message) {
    return Response.json(
      { error: "Missing required field(s). Expected: email, name, message." },
      { status: 400 }
    );
  }

  try {
    const result = await handleLead({ email, name, message, researchDomain });
    // handleLead returns { skipped: true } for a duplicate email.
    if ("skipped" in result && result.skipped) {
      return Response.json({ status: "skipped", reason: "already processed", email }, { status: 200 });
    }
    return Response.json({ status: "processed", ...result }, { status: 200 });
  } catch (err) {
    console.error("handleLead failed:", err);
    return Response.json(
      { error: "Lead processing failed.", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
