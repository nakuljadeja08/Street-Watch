// Firms the pipelines can't pull roles from, to check and apply to by hand. The
// list lives in manualFirms.json: when a firm gets wired, delete its row there.
import { useMemo, useState } from "react";
import ALL_FIRMS from "./manualFirms.json";
import "./manual.css";

const REASONS = [
  { v: "blocked", label: "Blocks automated access" },
  { v: "no_board", label: "No public job board" },
  { v: "no_reader", label: "Job system we can't read" },
  { v: "not_found", label: "Job board not found" },
  { v: "untried", label: "Not checked yet" },
  { v: "rules", label: "Left off the board" },
];
const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.v, r.label]));

export const manualFirmCount = (watch) => ALL_FIRMS.filter((f) => f.watch === watch).length;

const searchUrl = (firm) =>
  `https://www.google.com/search?q=${encodeURIComponent(`${firm.replace(/\s*\(.*\)/, "")} careers`)}`;

export default function ManualFirms({ watch }) {
  const firms = useMemo(() => ALL_FIRMS.filter((f) => f.watch === watch), [watch]);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("all");
  const [group, setGroup] = useState("all");

  const groups = useMemo(() => [...new Set(firms.map((f) => f.group))].sort(), [firms]);
  const counts = useMemo(() => {
    const c = {};
    for (const f of firms) c[f.reason] = (c[f.reason] || 0) + 1;
    return c;
  }, [firms]);

  const needle = q.trim().toLowerCase();
  const shown = firms.filter(
    (f) =>
      (reason === "all" || f.reason === reason) &&
      (group === "all" || f.group === group) &&
      (!needle || `${f.firm} ${f.group} ${f.note}`.toLowerCase().includes(needle)),
  );
  const byGroup = groups.map((g) => [g, shown.filter((f) => f.group === g)]).filter(([, rows]) => rows.length);

  return (
    <section className={`mf mf-${watch}`}>
      <h2 className="mf-title">Apply manually</h2>
      <p className="mf-intro">
        We couldn't add these {firms.length} companies to the board, so their roles won't show up here. Check their
        careers pages yourself.
      </p>

      <div className="mf-filters">
        <input
          className="mf-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies"
        />
        <select className="mf-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by type of company">
          <option value="all">All company types</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>
      <div className="mf-chips" role="group" aria-label="Filter by reason">
        <button className={`mf-chip ${reason === "all" ? "on" : ""}`} aria-pressed={reason === "all"} onClick={() => setReason("all")}>
          All <span>{firms.length}</span>
        </button>
        {REASONS.filter((r) => counts[r.v]).map((r) => (
          <button key={r.v} className={`mf-chip ${reason === r.v ? "on" : ""}`} aria-pressed={reason === r.v} onClick={() => setReason(r.v)}>
            {r.label} <span>{counts[r.v]}</span>
          </button>
        ))}
      </div>

      <p className="mf-count" aria-live="polite">{shown.length} {shown.length === 1 ? "company" : "companies"}</p>
      {byGroup.length === 0 && <p className="mf-empty">No companies match these filters.</p>}
      {byGroup.map(([g, rows]) => (
        <div className="mf-group" key={g}>
          <h3>{g} <span>{rows.length}</span></h3>
          <ul>
            {rows.map((f) => (
              <li className="mf-row" key={f.firm}>
                <div className="mf-main">
                  <span className="mf-firm">{f.firm}</span>
                  <span className="mf-reason">{REASON_LABEL[f.reason]}</span>
                  {f.note && <span className="mf-note">{f.note}</span>}
                </div>
                <a
                  className="mf-link"
                  href={f.url || searchUrl(f.firm)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${f.url ? "Open careers page for" : "Search for careers at"} ${f.firm}`}
                >
                  {f.url ? "Careers ↗" : "Search ↗"}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
