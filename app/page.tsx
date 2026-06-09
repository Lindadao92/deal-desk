"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Decision = {
  tier?: "hot" | "warm" | "cold";
  score?: number;
  angle?: string;
  reasons?: string[];
  suggested_use_cases?: string[];
  auto_book?: boolean;
};

type Signals = {
  funding?: string | null;
  hiring?: string | null;
  news?: string | null;
  recent_activity?: string | null;
  press?: string | null;
};

type Enrichment = {
  company?: string;
  signals?: Signals | null;
  conversion_hook?: string | null;
  sources?: { title?: string; url?: string }[] | null;
};

// A structured agent step, if the lead carries a `trace` (timestamped steps).
type TraceStep = { at?: string; step?: string; detail?: unknown };

type Lead = {
  id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
  last_reply_action?: string | null;
  enrichment?: Enrichment | null;
  decision?: Decision | null;
  trace?: TraceStep[] | null;
  brief?: { est_value?: number | null } | null; // est_value lives inside the brief jsonb
};

// Estimated annual contract value → compact currency. Rounded (no float artifacts),
// "~" prefix to mark it an estimate. Returns null when there's no usable value.
const VALUE_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
function estValue(lead: Lead): number {
  const v = lead.brief?.est_value;
  return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
}
function fmtValue(n: number): string | null {
  if (!(n > 0)) return null;
  return "~" + VALUE_FMT.format(Math.round(n)).replace("K", "k");
}

// Status pill styling for the lead lifecycle (incl. reply-loop outcomes).
const STATUS_STYLES: Record<string, string> = {
  awaiting_reply: "bg-blue-100 text-blue-700",
  rescheduled: "bg-indigo-100 text-indigo-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  replied: "bg-sky-100 text-sky-700",
  closed_lost: "bg-red-100 text-red-700",
  nurtured: "bg-zinc-100 text-zinc-500",
  qualified: "bg-zinc-100 text-zinc-600",
};

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const cls = STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Prominent, color-coded tier badge: hot=red/orange, warm=amber, cold=gray.
const TIER_STYLES: Record<string, string> = {
  hot: "bg-orange-500 text-white ring-orange-300",
  warm: "bg-amber-400 text-amber-950 ring-amber-200",
  cold: "bg-zinc-400 text-white ring-zinc-200",
};

function TierBadge({ tier }: { tier?: string }) {
  const t = (tier || "—").toLowerCase();
  const cls = TIER_STYLES[t] ?? "bg-zinc-300 text-zinc-700 ring-zinc-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-5 py-1.5 text-base font-extrabold uppercase tracking-widest ring-4 ${cls}`}
    >
      {t}
    </span>
  );
}

// Tier is the only accent color: hot=green, warm=amber, cold=gray.
const TIER_ACCENT: Record<string, { text: string; dot: string; word: string }> = {
  hot: { text: "text-emerald-600", dot: "bg-emerald-500", word: "Hot" },
  warm: { text: "text-amber-600", dot: "bg-amber-500", word: "Warm" },
  cold: { text: "text-zinc-400", dot: "bg-zinc-400", word: "Cold" },
};
function tierAccent(tier?: string) {
  return TIER_ACCENT[(tier ?? "").toLowerCase()] ?? { text: "text-zinc-400", dot: "bg-zinc-300", word: "—" };
}

// One muted, monochrome chip. Sentence-case content only.
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] text-zinc-500">
      {children}
    </span>
  );
}

// Small 12px monochrome line icons for the next-action row.
function ActionIcon({ name }: { name: "mail" | "calendar" | "ban" }) {
  const c = "h-3 w-3 shrink-0";
  if (name === "calendar")
    return (
      <svg className={c} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
      </svg>
    );
  if (name === "ban")
    return (
      <svg className={c} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="8" cy="8" r="5.5" />
        <path d="m4.4 4.4 7.2 7.2" />
      </svg>
    );
  return (
    <svg className={c} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="m2.5 4.5 5.5 4 5.5-4" />
    </svg>
  );
}

function scoreColor(score?: number) {
  if (score == null) return "text-zinc-400";
  if (score >= 75) return "text-emerald-600";
  if (score >= 45) return "text-amber-600";
  return "text-zinc-500";
}

function hostname(url?: string) {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

// One-click demo presets. Swap the hot/warm emails for inboxes you control so the
// agent's autonomous sends land somewhere safe. The cold lead never gets emailed
// (free-webmail + low score routes to nurture), so its address is harmless.
const PRESETS = [
  {
    label: "Hot fintech lead",
    name: "Dana Lee",
    email: "linda+hot@failfasterventures.com", // delivers to real inbox
    message:
      "We're a Series A fintech, ~45 people, and manual reconciliation is killing us — want a demo.",
  },
  {
    label: "Warm mid-market lead",
    name: "Sam Rivera",
    email: "linda+warm@failfasterventures.com", // delivers to real inbox
    message:
      "Ops manager at a 130-person Series B fintech. We have some reconciliation pain, but we're just researching options for next year — no rush.",
  },
  {
    label: "Cold student",
    name: "Alex Kim",
    email: "alex.kim.student@gmail.com",
    message:
      "Hi! I'm a CS student working on a class project and curious how your product works.",
  },
];

// ---- The per-lead "Research" section (deepened enrichment) ----
function ResearchSection({ enr, useCases }: { enr: Enrichment; useCases?: string[] }) {
  const s = enr.signals ?? {};
  const rows: [string, string | null | undefined][] = [
    ["Funding", s.funding],
    ["Hiring", s.hiring],
    ["News", s.news],
    ["Recent activity", s.recent_activity],
    ["Press", s.press],
  ];
  const signalRows = rows.filter(([, v]) => v && String(v).trim());
  const sources = (enr.sources ?? []).filter((x) => x?.url);
  const cases = (useCases ?? []).filter((c) => c && String(c).trim());

  if (
    !enr.conversion_hook &&
    signalRows.length === 0 &&
    sources.length === 0 &&
    cases.length === 0
  )
    return null;

  return (
    <div className="mt-4 rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-100">
      <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Research
      </div>

      {enr.conversion_hook && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
            🎯 Conversion hook
          </span>
          <p className="mt-0.5 text-sm leading-snug text-amber-900">{enr.conversion_hook}</p>
        </div>
      )}

      {signalRows.length > 0 && (
        <dl className="space-y-2.5">
          {signalRows.map(([label, val]) => (
            <div key={label}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-zinc-700">{val}</dd>
            </div>
          ))}
        </dl>
      )}

      {cases.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Suggested use cases
          </div>
          <ul className="space-y-1">
            {cases.map((c, i) => (
              <li key={i} className="flex gap-2 text-xs leading-snug text-zinc-700">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sources.map((src, i) => (
            <a
              key={i}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-blue-600 ring-1 ring-zinc-200 transition hover:bg-blue-50"
              title={src.url}
            >
              {src.title || hostname(src.url)} <span aria-hidden>↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Workflow stages, left → right.
type Stage = "Outreach Sent" | "Booked" | "Nurture";

const COLUMNS: { key: Stage; label: string; dot: string }[] = [
  { key: "Outreach Sent", label: "Outreach sent", dot: "bg-blue-500" },
  { key: "Booked", label: "Booked", dot: "bg-emerald-500" },
  { key: "Nurture", label: "Nurture", dot: "bg-zinc-400" },
];

// Derive a lead's pipeline STAGE from existing fields only (tier, status,
// last_reply_action). `lost` flags not-interested / closed-lost leads, which sit
// in Nurture with a "Lost" tag. Re-runs every render, so a lead moves columns as
// its status changes (e.g. awaiting_reply → confirmed after Check replies).
function deriveStage(lead: Lead): { stage: Stage; lost: boolean } {
  const tier = (lead.decision?.tier ?? "").toLowerCase();
  const status = lead.status ?? "";
  const action = (lead.last_reply_action ?? "").toLowerCase();

  // not-interested / closed lost → Nurture, tagged Lost (even if hot/warm).
  if (status === "closed_lost" || action.includes("lost") || action.includes("not interested")) {
    return { stage: "Nurture", lost: true };
  }

  // cold leads are nurture-only.
  if (tier === "cold") return { stage: "Nurture", lost: false };

  // a meeting was booked or the reply was confirmed/rescheduled.
  if (
    status === "confirmed" ||
    status === "rescheduled" ||
    action.includes("confirmed") ||
    action.includes("rescheduled") ||
    action.includes("invite sent") ||
    action.includes("booked")
  ) {
    return { stage: "Booked", lost: false };
  }

  // everything else: hot/warm with outreach fired — awaiting reply, or a question
  // answered with no terminal outcome yet.
  return { stage: "Outreach Sent", lost: false };
}

// ---- Card derivations (presentation only, from existing fields) ----

// Readable pitch label, sentence case: roi -> ROI, time_saved -> Time saved.
function prettyAngle(a?: string): string {
  if (!a) return "";
  if (a.toLowerCase() === "roi") return "ROI";
  const s = a.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function isBooked(lead: Lead): boolean {
  const status = lead.status ?? "";
  const action = (lead.last_reply_action ?? "").toLowerCase();
  return (
    status === "confirmed" ||
    status === "rescheduled" ||
    /confirmed|rescheduled|invite sent|booked/.test(action)
  );
}

// The single status chip label.
function statusLabel(lead: Lead, lost: boolean): string {
  const tier = (lead.decision?.tier ?? "").toLowerCase();
  const action = (lead.last_reply_action ?? "").toLowerCase();
  if (lost) return "Closed lost";
  if (tier === "cold") return "Nurturing";
  if (lead.status === "rescheduled" || action.includes("rescheduled")) return "Rescheduled";
  if (isBooked(lead)) return "Meeting booked";
  return "Awaiting reply";
}

function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function meetingTime(action?: string | null): string | null {
  const m = (action ?? "").match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[^\s]*/);
  if (!m) return null;
  const d = new Date(m[0]);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

// The next-action line: an icon + a muted sentence.
function nextAction(lead: Lead, lost: boolean): { icon: "mail" | "calendar" | "ban"; text: string } {
  const tier = (lead.decision?.tier ?? "").toLowerCase();
  if (lost) return { icon: "ban", text: "Closed, not interested" };
  if (tier === "cold") return { icon: "ban", text: "No outreach, below ICP" };
  if (isBooked(lead)) {
    const when = meetingTime(lead.last_reply_action);
    return { icon: "calendar", text: when ? `Meeting · ${when}` : "Meeting · scheduled" };
  }
  const days = daysSince(lead.created_at);
  const ago = days === 0 ? "today" : `${days}d ago`;
  return { icon: "mail", text: `Emailed ${shortDate(lead.created_at)} · ${ago}` };
}

// A compact lead card. Clicking it opens the detail drawer. Tier is the only
// accent (the dot + colored score), so the board reads near-monochrome.
function LeadCard({
  lead,
  highlight,
  lost,
  onSelect,
}: {
  lead: Lead;
  highlight: boolean;
  lost: boolean;
  onSelect: () => void;
}) {
  const d = lead.decision ?? {};
  const enr = lead.enrichment ?? {};
  const company = enr.company || "—";
  const accent = tierAccent(d.tier);
  const na = nextAction(lead, lost);
  const value = fmtValue(estValue(lead)); // null for cold / no-brief leads

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border-[0.5px] px-4 py-3.5 transition-colors duration-500 ${
        highlight ? "border-zinc-300 bg-zinc-50" : "border-zinc-200 bg-white hover:bg-zinc-50"
      }`}
    >
      {/* top row: tier dot + name/company  |  score + tier word */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${accent.dot}`} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium leading-tight text-zinc-800">{lead.name}</div>
            <div className="truncate text-[13px] leading-tight text-zinc-400">{company}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[22px] font-medium leading-none ${accent.text}`}>{d.score ?? "—"}</div>
          <div className={`mt-0.5 text-[11px] leading-none ${accent.text}`}>{accent.word}</div>
          {value && <div className="mt-1 text-[11px] leading-none text-zinc-400">{value}</div>}
        </div>
      </div>

      {/* up to two chips: pitch (hot/warm) + one status */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {d.tier !== "cold" && d.angle && <Chip>{prettyAngle(d.angle)} pitch</Chip>}
        <Chip>{statusLabel(lead, lost)}</Chip>
      </div>

      {/* next-action line */}
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-zinc-400">
        <ActionIcon name={na.icon} />
        <span className="truncate">{na.text}</span>
      </div>
    </div>
  );
}

// ---- Activity timeline (presentation only, from data already on the lead) ----
type TimelineRow = { label: string; app?: string; at?: string | null };

// Maps a structured trace step to a readable row.
const STEP_LABELS: Record<string, { label: string; app: string }> = {
  reply_received: { label: "Reply received", app: "Gmail" },
  classified: { label: "Reply classified", app: "Claude" },
  email_sent: { label: "Email sent", app: "Gmail" },
  calendar_booked: { label: "Calendar hold placed", app: "Google Calendar" },
  calendar_patched: { label: "Calendar updated", app: "Google Calendar" },
  slack_notified: { label: "Slack team notified", app: "Slack" },
  notion_updated: { label: "CRM record updated", app: "Notion" },
};

function replyOutcome(action?: string | null): string {
  const a = (action ?? "").toLowerCase();
  if (a.includes("reschedul")) return "rescheduled";
  if (a.includes("confirm")) return "confirmed";
  if (a.includes("answer")) return "answered";
  if (a.includes("closed") || a.includes("lost") || a.includes("not interested")) return "closed";
  return action ? action : "handled";
}

function fmtStamp(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Prefer a real structured trace; otherwise reconstruct the story from existing fields.
function buildTimeline(lead: Lead): TimelineRow[] {
  const trace = Array.isArray(lead.trace) ? lead.trace : [];
  if (trace.length) {
    return trace.map((t) => {
      const known = t.step ? STEP_LABELS[t.step] : undefined;
      let label = known?.label ?? (t.step ?? "Step").replace(/_/g, " ");
      const intent = (t.detail as { intent?: string } | undefined)?.intent;
      if (t.step === "classified" && intent) label = `Reply classified: ${intent}`;
      return { label, app: known?.app, at: t.at ?? null };
    });
  }

  const d = lead.decision ?? {};
  const tier = (d.tier ?? "").toLowerCase();
  const rows: TimelineRow[] = [{ label: "Lead received", app: "Form", at: lead.created_at }];

  if (d.score != null && tier) {
    rows.push({ label: `Researched and scored ${d.score}/${tier}`, app: "Claude" });
  }

  if (tier === "cold") {
    rows.push({ label: "CRM record created", app: "Notion" });
    rows.push({ label: "Routed to nurture, no outreach", app: "Slack" });
  } else if (tier) {
    rows.push({ label: "CRM record created", app: "Notion" });
    rows.push({ label: "Email sent", app: "Gmail" });
    if (d.auto_book) rows.push({ label: "Calendar hold placed", app: "Google Calendar" });
    rows.push({ label: "Slack team notified", app: "Slack" });
  }

  if (lead.last_reply_action) {
    rows.push({ label: `Reply received → ${replyOutcome(lead.last_reply_action)}`, app: "Gmail" });
  }
  return rows;
}

function ActivityTimeline({ rows }: { rows: TimelineRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        Activity
      </div>
      <ol className="relative space-y-3 border-l border-zinc-200 pl-4">
        {rows.map((row, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-zinc-300 ring-2 ring-white" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm leading-snug text-zinc-700">{row.label}</span>
              {row.at && (
                <time className="shrink-0 text-[11px] text-zinc-400">{fmtStamp(row.at)}</time>
              )}
            </div>
            {row.app && <div className="text-[11px] text-zinc-400">{row.app}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Right-side detail drawer for a selected lead. Slides in over a translucent
// backdrop; closes via the X button, a backdrop click, or Esc.
function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [shown, setShown] = useState(false);

  // Animate in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = lead.decision ?? {};
  const enr = lead.enrichment ?? {};
  const company = enr.company || "—";
  const reasons = d.reasons ?? [];
  const timeline = buildTimeline(lead);

  return (
    <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-zinc-900/30 backdrop-blur-sm transition-opacity duration-300 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* sliding panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold tracking-tight text-zinc-900">
              {lead.name}
              <span className="ml-1.5 font-normal text-zinc-400">@ {company}</span>
            </div>
            <div className="truncate text-xs text-zinc-400">{lead.email}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <span className="block h-5 w-5 text-center text-xl leading-5" aria-hidden>
              ×
            </span>
          </button>
        </div>

        {/* scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* focal score + tier */}
          <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-4 py-2.5">
            <div className="text-right">
              <div className={`text-5xl font-black leading-none tracking-tight ${scoreColor(d.score)}`}>
                {d.score ?? "—"}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                score
              </div>
            </div>
            <TierBadge tier={d.tier} />
          </div>

          {/* angle / nurture + status */}
          <div className="flex flex-wrap items-center gap-2">
            {d.tier === "cold" ? (
              <span className="inline-flex items-center rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
                nurture — no outreach
              </span>
            ) : (
              d.angle && (
                <span className="inline-flex items-center rounded-md bg-zinc-900/5 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  Pitch: <span className="ml-1 font-semibold">{prettyAngle(d.angle)}</span>
                </span>
              )
            )}
            <StatusPill status={lead.status} />
            {lead.last_reply_action && (
              <span className="text-xs text-zinc-500">· {lead.last_reply_action}</span>
            )}
          </div>

          {/* Research — full-width signals, hook, use cases, sources */}
          <ResearchSection enr={enr} useCases={d.suggested_use_cases} />

          {/* scoring reasons */}
          {reasons.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Why this score
              </div>
              <ul className="space-y-1.5">
                {reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-snug text-zinc-600">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-300" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Activity — the chronological story of what the agent did */}
          <ActivityTimeline rows={timeline} />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string> | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const next: Lead[] = json.leads ?? [];

      // Briefly highlight leads that arrived since the last poll (skip the first load).
      const ids = new Set<string>(next.map((l) => l.id));
      if (seenIdsRef.current === null) {
        seenIdsRef.current = ids;
      } else {
        const fresh = [...ids].filter((id) => !seenIdsRef.current!.has(id));
        seenIdsRef.current = ids;
        if (fresh.length) {
          setHighlightIds((prev) => {
            const s = new Set(prev);
            fresh.forEach((id) => s.add(id));
            return s;
          });
          fresh.forEach((id) =>
            setTimeout(() => {
              setHighlightIds((prev) => {
                const s = new Set(prev);
                s.delete(id);
                return s;
              });
            }, 2500)
          );
        }
      }

      setLeads(next);
    } catch {
      /* ignore transient polling errors */
    }
  }, []);

  // Poll the feed every 3 seconds.
  useEffect(() => {
    loadLeads();
    const id = setInterval(loadLeads, 3000);
    return () => clearInterval(id);
  }, [loadLeads]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ kind: "err", text: json.error ?? "Something went wrong." });
      } else if (json.status === "skipped") {
        setNotice({ kind: "ok", text: "Already processed this email (deduped)." });
      } else {
        const d = json.decision ?? {};
        setNotice({
          kind: "ok",
          text: `Processed ${name || "lead"} — ${d.tier ?? "?"} (score ${d.score ?? "?"}, ${d.angle ?? "?"}).`,
        });
        setMessage("");
        setShowForm(false);
      }
      loadLeads();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function onCheckReplies() {
    if (checking) return;
    setChecking(true);
    setNotice(null);
    try {
      const res = await fetch("/api/replies", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setNotice({ kind: "err", text: json.error ?? "Reply check failed." });
      } else {
        const acted = (json.results ?? []).filter((r: { status?: string }) => r.status).length;
        setNotice({
          kind: "ok",
          text: `Checked ${json.checked ?? 0} awaiting · ${acted} updated.`,
        });
      }
      loadLeads();
    } catch (err) {
      setNotice({ kind: "err", text: (err as Error).message });
    } finally {
      setChecking(false);
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setName(p.name);
    setEmail(p.email);
    setMessage(p.message);
    setNotice(null);
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

  // Derive the open lead from the live list each render — so polling keeps running
  // and the drawer reflects fresh data; closes itself if the lead leaves the list.
  const selectedLead = selectedId ? leads.find((l) => l.id === selectedId) ?? null : null;

  // Re-derive every render (and thus every poll) so leads re-bucket automatically.
  const staged = leads.map((l) => ({ lead: l, ...deriveStage(l) }));

  return (
    <div className="min-h-screen w-full bg-zinc-100/70">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-sm font-black text-white">
              D
            </div>
            <div>
              <h1 className="text-sm font-bold leading-none tracking-tight text-zinc-900">Deal Desk</h1>
              <p className="mt-0.5 text-[11px] leading-none text-zinc-400">inbound-lead agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCheckReplies}
              disabled={checking}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {checking && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
              )}
              {checking ? "Checking…" : "Check replies"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700"
            >
              {showForm ? "Close" : "+ New lead"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-6">
        {/* Notice banner */}
        {notice && (
          <div
            className={`mb-4 max-w-2xl rounded-lg px-4 py-2.5 text-sm font-medium ${
              notice.kind === "ok"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-red-50 text-red-700 ring-1 ring-red-200"
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Collapsible new-lead form */}
        {showForm && (
          <form
            onSubmit={onSubmit}
            className="mb-6 max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-4">
              <span className="text-xs font-medium text-zinc-400">Quick demos:</span>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={submitting}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100 disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Name</label>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dana Lee"
                  required
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Email</label>
                <input
                  className={inputCls}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vp@acme.com"
                  required
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-600">Message</label>
              <textarea
                className={`${inputCls} min-h-[90px] resize-y`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="We're a Series A fintech, ~45 people, and manual reconciliation is killing us — want a demo."
                required
                disabled={submitting}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {submitting ? "Processing…" : "Submit lead"}
              </button>
              {submitting && (
                <span className="text-xs text-zinc-500">
                  researching (multi-query web search), scoring, executing — this takes ~40–60s
                </span>
              )}
            </div>
          </form>
        )}

        {/* Pipeline — quiet heading, monochrome live indicator */}
        <div className="mb-5 flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-300 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-400" />
          </span>
          <h2 className="text-[15px] font-medium text-zinc-700">Pipeline</h2>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">{leads.length}</span>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 min-[900px]:grid-cols-3">
          {COLUMNS.map((col) => {
            const colItems = staged.filter((s) => s.stage === col.key);
            const colValue = fmtValue(colItems.reduce((sum, { lead }) => sum + estValue(lead), 0));
            return (
              <section key={col.key} className="flex flex-col">
                {/* quiet header row: dot + sentence-case name + muted count + est value sum */}
                <div className="mb-3 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                  <h3 className="text-[15px] font-medium text-zinc-700">{col.label}</h3>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">
                    {colItems.length}
                  </span>
                  {colValue && <span className="text-[11px] text-zinc-400">{colValue}</span>}
                </div>

                {/* scrollable card list — newest at top (API returns newest-first) */}
                <div className="flex max-h-[calc(100vh-210px)] flex-col gap-2.5 overflow-y-auto pr-0.5">
                  {colItems.length === 0 ? (
                    <div className="rounded-xl border-[0.5px] border-dashed border-zinc-200 px-4 py-6 text-center text-[12px] text-zinc-400">
                      No leads yet
                    </div>
                  ) : (
                    colItems.map(({ lead, lost }) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        lost={lost}
                        highlight={highlightIds.has(lead.id)}
                        onSelect={() => setSelectedId(lead.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>

      {selectedLead && (
        <LeadDrawer lead={selectedLead} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
