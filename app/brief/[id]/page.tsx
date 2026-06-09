// GET /brief/[id] — a PUBLIC, read-only one-page brief for a qualified lead.
// No auth: anyone with the link (it goes out in the outreach email) can view it.
import { createClient } from "@supabase/supabase-js";

// Read fresh per request (the brief is written when the lead is processed).
export const dynamic = "force-dynamic";

// Server-only Supabase client. The service key is used on the server to read one
// lead; it is never serialized to the browser (this is a server component).
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

type Brief = {
  headline?: string;
  tailored_value_prop?: string;
  use_cases?: string[];
  impact_estimate?: string;
  recommended_plan?: string;
  price_band?: string;
  proof_point?: string;
  next_step?: string;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-zinc-100 pt-5">
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </h2>
      {children}
    </section>
  );
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: lead } = await supabase
    .from("leads")
    .select("name,enrichment,brief")
    .eq("id", id)
    .maybeSingle();

  const brief = (lead?.brief ?? null) as Brief | null;
  const company = (lead?.enrichment as { company?: string } | null)?.company || "your team";

  if (!lead || !brief) {
    return (
      <div className="min-h-screen w-full bg-zinc-100/70">
        <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-5">
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <h1 className="text-lg font-semibold text-zinc-900">Brief not found</h1>
            <p className="mt-1 text-sm text-zinc-500">
              This brief does not exist yet, or the link is incorrect.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const useCases = (brief.use_cases ?? []).filter((u) => u && String(u).trim());

  return (
    <div className="min-h-screen w-full bg-zinc-100/70">
      <main className="mx-auto w-full max-w-2xl px-5 py-12">
        <article className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {/* header */}
          <header>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Prepared for {company}
            </div>
            {brief.headline && (
              <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight text-zinc-900">
                {brief.headline}
              </h1>
            )}
          </header>

          {/* value prop */}
          {brief.tailored_value_prop && (
            <p className="mt-4 text-base leading-relaxed text-zinc-700">
              {brief.tailored_value_prop}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-5">
            {useCases.length > 0 && (
              <Section label="What we'd help with">
                <ul className="space-y-1.5">
                  {useCases.map((u, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-700">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                      <span>{u}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {brief.impact_estimate && (
              <Section label="Estimated impact">
                <div className="rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm leading-snug text-amber-900 ring-1 ring-amber-200">
                  {brief.impact_estimate}
                </div>
              </Section>
            )}

            {(brief.recommended_plan || brief.price_band) && (
              <Section label="Recommended plan">
                <div className="rounded-lg bg-zinc-50 px-3.5 py-3 ring-1 ring-zinc-100">
                  {brief.recommended_plan && (
                    <div className="text-sm font-semibold text-zinc-900">{brief.recommended_plan}</div>
                  )}
                  {brief.price_band && (
                    <div className="mt-0.5 text-sm text-zinc-600">{brief.price_band}</div>
                  )}
                  <div className="mt-1 text-[11px] text-zinc-400">
                    Indicative range only, not a formal quote.
                  </div>
                </div>
              </Section>
            )}

            {brief.proof_point && (
              <Section label="Proof point">
                <p className="text-sm leading-relaxed text-zinc-700">{brief.proof_point}</p>
              </Section>
            )}

            {brief.next_step && (
              <Section label="Next step">
                <div className="rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium leading-snug text-white">
                  {brief.next_step}
                </div>
              </Section>
            )}
          </div>
        </article>

        <p className="mt-4 text-center text-[11px] text-zinc-400">
          Generated by Deal Desk for {company}.
        </p>
      </main>
    </div>
  );
}
