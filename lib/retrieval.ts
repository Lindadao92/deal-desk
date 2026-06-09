// ============================================================
// retrieval.ts — pull precedent from the agent's sales memory
// ============================================================
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

type EnrichedLead = {
  vertical: string;        // from research, e.g. 'fintech'
  company_size: number;    // from research
};

type Precedent = {
  n: number;
  winRate: number;
  bestAngle: string | null;
  examples: string[];      // human-readable lines fed to the model
};

// most common value in an array
function mode(arr: string[]): string | null {
  if (!arr.length) return null;
  const counts: Record<string, number> = {};
  for (const a of arr) counts[a] = (counts[a] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export async function findPrecedent(lead: EnrichedLead): Promise<Precedent> {
  // 1) similar vertical + a size band around the lead
  let { data } = await supabase
    .from("past_deals")
    .select("*")
    .eq("vertical", lead.vertical)
    .gte("company_size", Math.floor(lead.company_size * 0.4))
    .lte("company_size", Math.ceil(lead.company_size * 2.5))
    .limit(8);

  // 2) fall back to vertical-only if the band was too tight
  if (!data || data.length < 3) {
    ({ data } = await supabase
      .from("past_deals")
      .select("*")
      .eq("vertical", lead.vertical)
      .limit(8));
  }

  data = data || [];
  const won = data.filter((d: any) => d.outcome === "won");

  return {
    n: data.length,
    winRate: data.length ? won.length / data.length : 0,
    bestAngle: mode(won.map((d: any) => d.angle_used)),
    examples: data.map(
      (d: any) =>
        `${d.persona} @ ${d.vertical}/${d.company_size} (${d.funding_stage}) ` +
        `→ ${d.outcome} via ${d.angle_used}: ${d.notes}`
    ),
  };
}

// Compact summary string to drop into the scoring prompt's PRECEDENT slot.
export function summarizePrecedent(p: Precedent): string {
  if (!p.n) return "No comparable past deals found.";
  return [
    `${p.n} comparable past deals, ${(p.winRate * 100).toFixed(0)}% won.`,
    p.bestAngle ? `Most common winning angle: ${p.bestAngle}.` : "",
    "Examples:",
    ...p.examples.map((e) => `  - ${e}`),
  ]
    .filter(Boolean)
    .join("\n");
}
