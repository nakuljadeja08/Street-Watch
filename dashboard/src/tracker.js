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
