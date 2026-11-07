// Shared tracker/workflow helpers used by both boards (Street Watch + Tech Watch):
// follow-up reminders, per-firm research links, and CSV export of tracked roles.

// A role you've applied to but haven't heard back on becomes a "follow up" after
// this many days (status still "applied", i.e. not moved to interview/offer/etc.).
export const FOLLOW_UP_DAYS = 7;

function daysSince(d) {
  if (!d) return null;
  const t = Date.parse(d + "T00:00:00Z");
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// Whole days since you applied, or null if the role isn't an open application.
export function daysSinceApplied(app) {
  if (!app || app.status !== "applied") return null;
  return daysSince(app.applied_at);
}

// True once an open application has gone quiet for FOLLOW_UP_DAYS+ days.
export function needsFollowUp(app, threshold = FOLLOW_UP_DAYS) {
  const n = daysSinceApplied(app);
  return n !== null && n >= threshold;
}

// --- pay, staleness, takedowns (pipeline.py, added 2026-11-07) -------------
// "$85k–$105k", "$95k", "$30–44/hr", or "" when the posting states no pay.
// Same format as pay_label() in pipeline.py.
export function payLabel(j) {
  const lo = j?.pay_min, hi = j?.pay_max;
  if (!lo) return "";
  if (j.pay_period === "hour") return lo === hi ? `$${lo}/hr` : `$${lo}–${hi}/hr`;
  const k = (v) => `$${Math.round(v / 1000)}k`;
  return lo === hi ? k(lo) : `${k(lo)}–${k(hi)}`;
}

// Annual top of the range, for "pay ≥ X" filters and sorting (hourly × 2080).
export function payTop(j) {
  if (!j?.pay_max) return null;
  return j.pay_period === "hour" ? j.pay_max * 2080 : j.pay_max;
}

// A role still up this many days after we (or the firm) first listed it gets an
// "open Nd" badge: long-open and reposted roles are the usual ghost-job signs.
// 45, not 30: at 30 over a third of each board was flagged (2026-11-07).
export const STALE_DAYS = 45;

// Days the role has been open: from the earliest of its post date, when we
// first saw it, and (for a reposted role) when we first saw the original.
export function openDays(j) {
  const ds = [j?.posted_date, j?.first_seen, j?.orig_first_seen].map(daysSince).filter((n) => n !== null);
  return ds.length ? Math.max(...ds) : null;
}

// "Reposted ×2 · first seen 2026-09-19 · open 49 days"
export function staleTitle(j) {
  const parts = [];
  if (j?.repost_count > 0)
    parts.push(`Taken down and reposted ${j.repost_count > 1 ? `${j.repost_count} times` : "once"}`);
  if (j?.orig_first_seen) parts.push(`first seen ${j.orig_first_seen}`);
  const n = openDays(j);
  if (n !== null) parts.push(`open ${n} days`);
  return parts.join(" · ");
}

// Tracked roles the firm took down in the last `days` days, Interested first.
export function recentTakedowns(jobs, appMap, days = 14) {
  const rank = { interested: 0, applied: 1, interview: 2 };
  return jobs
    .filter((j) => j.taken_down_on && rank[appMap[j.id]?.status] !== undefined && daysSince(j.taken_down_on) <= days)
    .sort((a, b) => rank[appMap[a.id].status] - rank[appMap[b.id].status] || b.taken_down_on.localeCompare(a.taken_down_on));
}

// Quick company-research links for a firm (+ optional role title). No API — just
// opens the usual places in a new tab.
export function researchLinks(firm, title = "") {
  const f = encodeURIComponent(firm);
  const ft = encodeURIComponent(`${firm} ${title}`.trim());
  return [
    { label: "LinkedIn", url: `https://www.linkedin.com/search/results/all/?keywords=${f}` },
    { label: "Glassdoor", url: `https://www.glassdoor.com/Search/results.htm?keyword=${f}` },
    { label: "Levels", url: `https://www.levels.fyi/?search=${f}` },
    { label: "Google", url: `https://www.google.com/search?q=${ft}` },
  ];
}

// --- CSV export -----------------------------------------------------------
const CSV_COLS = ["firm", "title", "status", "applied_at", "location", "metro", "source", "url", "notes"];

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Rows are plain job-ish objects; missing columns come out blank.
export function jobsToCsv(rows, cols = CSV_COLS) {
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n");
}

// Trigger a browser download of `text` as `filename` (client-side, no server).
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
