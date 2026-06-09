// POST /api/replies — on-demand trigger for the reply loop. Scans every
// awaiting_reply lead, fetches any email reply, classifies intent, and acts.
//
//   curl -X POST http://localhost:3000/api/replies
import { checkReplies } from "@/lib/replies";

// checkReplies uses the same Node-only SDKs as the agent; never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await checkReplies();
    return Response.json({ status: "ok", ...result }, { status: 200 });
  } catch (err) {
    console.error("checkReplies failed:", err);
    return Response.json(
      { error: "Reply check failed.", detail: (err as Error).message },
      { status: 500 }
    );
  }
}
