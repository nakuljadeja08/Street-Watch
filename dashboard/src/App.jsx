import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, STATUSES } from "./supabaseClient.js";

const METROS = ["all", "NY + Jersey City", "SF / Bay Area", "Chicago"];
const METRO_LABEL = {
  all: "All",
  "NY + Jersey City": "NY + JC",
  "SF / Bay Area": "SF / Bay",
  Chicago: "Chicago",
};
const RECENCY = [
  { d: "all", label: "Any time" },
  { d: 1, label: "24h" },
  { d: 7, label: "7d" },
  { d: 30, label: "30d" },
];
const STATUS_META = {
  none: { label: "— Track", cls: "s-none" },
  interested: { label: "Interested", cls: "s-interested" },
  applied: { label: "Applied", cls: "s-applied" },
  interview: { label: "Interview", cls: "s-interview" },
  offer: { label: "Offer", cls: "s-offer" },
  rejected: { label: "Rejected", cls: "s-rejected" },
};
const TRACKED = STATUSES.filter((s) => s !== "none");

function daysSince(d) {
  if (!d) return null;
  const t = Date.parse(d + "T00:00:00Z");
  if (isNaN(t)) return null;
  return (Date.now() - t) / 86400000;
}
function postedLabel(d) {
  const n = daysSince(d);
  if (n === null) return "";
  if (n < 1) return "today";
  const days = Math.floor(n);
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 60) return "1mo ago";
  return `${Math.floor(days / 30)}mo ago`;
}
const today = () => new Date().toISOString().slice(0, 10);

const SORTS = [
  { v: "default", label: "Grouped" },
  { v: "newest", label: "Newest" },
  { v: "firm", label: "Firm A–Z" },
];
// pipeline columns, left → right
const BOARD_COLS = ["interested", "applied", "interview", "offer", "rejected"];

// read filter/sort/view state out of the URL so a link restores the same view
function initialParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      metro: p.get("metro") || "all",
      recency: p.get("recency") || "all",
      statusFilter: p.get("status") || "all",
      q: p.get("q") || "",
      sort: SORTS.some((s) => s.v === p.get("sort")) ? p.get("sort") : "default",
      view: p.get("view") === "board" ? "board" : "list",
    };
  } catch {
    return { metro: "all", recency: "all", statusFilter: "all", q: "", sort: "default", view: "list" };
  }
}

export default function App() {
  const init = initialParams();
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState({}); // job_id -> {status, applied_at, notes}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metro, setMetro] = useState(init.metro);
  const [recency, setRecency] = useState(init.recency);
  const [statusFilter, setStatusFilter] = useState(init.statusFilter); // all | tracked | untracked | <status>
  const [q, setQ] = useState(init.q);
  const [sort, setSort] = useState(init.sort);
  const [view, setView] = useState(init.view); // list | board
  const [dragOverCol, setDragOverCol] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("sw-theme") || "auto";
    } catch {
      return "auto";
    }
  });

  // subtle shadow under the sticky filter bar once the page scrolls
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // apply + persist the theme choice ("auto" follows the system)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("sw-theme", theme);
    } catch {}
  }, [theme]);

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveDark = theme === "dark" || (theme === "auto" && prefersDark);
  const toggleTheme = () => setTheme(effectiveDark ? "light" : "dark");

  // "/" focuses the search box (unless already typing in a field)
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable)
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // mirror filters/sort into the URL (replaceState — no history spam)
  useEffect(() => {
    const p = new URLSearchParams();
    if (metro !== "all") p.set("metro", metro);
    if (recency !== "all") p.set("recency", String(recency));
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "default") p.set("sort", sort);
    if (view !== "list") p.set("view", view);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [metro, recency, statusFilter, q, sort, view]);

  useEffect(() => {
    (async () => {
      try {
        const [jRes, aRes] = await Promise.all([
          supabase
            .from("jobs")
            .select("*")
            .order("metro", { ascending: true })
            .order("firm", { ascending: true })
            .order("title", { ascending: true }),
          supabase.from("applications").select("*"),
        ]);
        if (jRes.error) throw jRes.error;
        // applications table may not exist yet — treat that as "no apps"
        const appMap = {};
        if (!aRes.error && Array.isArray(aRes.data)) {
          for (const a of aRes.data) appMap[a.job_id] = a;
        } else if (aRes.error) {
          console.warn("applications read failed (run schema_applications.sql?):", aRes.error.message);
        }
        setJobs(jRes.data || []);
        setApps(appMap);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusOf = (id) => apps[id]?.status || "none";

  const filtersActive =
    metro !== "all" ||
    recency !== "all" ||
    statusFilter !== "all" ||
    q.trim() !== "" ||
    sort !== "default";
  function clearFilters() {
    setMetro("all");
    setRecency("all");
    setStatusFilter("all");
    setQ("");
    setSort("default");
  }

  async function saveNotes(job, raw) {
    const prev = apps[job.id];
    if (!prev) return; // notes only live on a tracked (existing) row
    const value = raw.trim() || null;
    if ((prev.notes || null) === value) return; // no-op
    setApps((m) => ({ ...m, [job.id]: { ...m[job.id], notes: value } }));
    try {
      const { error } = await supabase
        .from("applications")
        .update({ notes: value })
        .eq("job_id", job.id);
      if (error) throw error;
    } catch (e) {
      setApps((m) => ({ ...m, [job.id]: { ...m[job.id], notes: prev.notes || null } }));
      setError(`Could not save note: ${e.message || e}`);
      setTimeout(() => setError(""), 4000);
    }
  }

  async function setStatus(job, next) {
    const prev = apps[job.id];
    // optimistic update
    setApps((m) => {
      const c = { ...m };
      if (next === "none") delete c[job.id];
      else
        c[job.id] = {
          job_id: job.id,
          status: next,
          applied_at:
            next === "applied" && !prev?.applied_at ? today() : prev?.applied_at || null,
          notes: prev?.notes || null,
        };
      return c;
    });
    try {
      if (next === "none") {
        const { error } = await supabase.from("applications").delete().eq("job_id", job.id);
        if (error) throw error;
      } else {
        const row = {
          job_id: job.id,
          status: next,
          applied_at:
            next === "applied" && !prev?.applied_at ? today() : prev?.applied_at || null,
          notes: prev?.notes || null,
        };
        const { error } = await supabase
          .from("applications")
          .upsert(row, { onConflict: "job_id" });
        if (error) throw error;
      }
    } catch (e) {
      // revert on failure
      setApps((m) => {
        const c = { ...m };
        if (prev) c[job.id] = prev;
        else delete c[job.id];
        return c;
      });
      setError(`Could not save status: ${e.message || e}`);
      setTimeout(() => setError(""), 4000);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const win = recency === "all" ? Infinity : Number(recency);
    const rows = jobs.filter((j) => {
      if (metro !== "all" && j.metro !== metro) return false;
      if (needle && !(j.firm + " " + j.title).toLowerCase().includes(needle)) return false;
      if (win !== Infinity) {
        const n = daysSince(j.posted_date);
        if (n === null || n > win) return false;
      }
      const st = statusOf(j.id);
      if (statusFilter === "tracked" && st === "none") return false;
      if (statusFilter === "untracked" && st !== "none") return false;
      if (["interested", "applied", "interview", "offer", "rejected"].includes(statusFilter) && st !== statusFilter)
        return false;
      return true;
    });
    if (sort === "newest") {
      // most-recently posted first; undated rows sink to the bottom
      rows.sort((a, b) => (daysSince(a.posted_date) ?? Infinity) - (daysSince(b.posted_date) ?? Infinity));
    } else if (sort === "firm") {
      rows.sort(
        (a, b) =>
          (a.firm || "").localeCompare(b.firm || "") ||
          (a.title || "").localeCompare(b.title || "")
      );
    }
    return rows;
  }, [jobs, apps, metro, recency, statusFilter, q, sort]);

  // board view: tracked roles grouped by status. Honors metro/recency/search
  // and the sort order, but ignores the status filter (columns cover all).
  const board = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const win = recency === "all" ? Infinity : Number(recency);
    const cols = Object.fromEntries(BOARD_COLS.map((s) => [s, []]));
    for (const j of jobs) {
      const st = statusOf(j.id);
      if (st === "none" || !cols[st]) continue;
      if (metro !== "all" && j.metro !== metro) continue;
      if (needle && !(j.firm + " " + j.title).toLowerCase().includes(needle)) continue;
      if (win !== Infinity) {
        const n = daysSince(j.posted_date);
        if (n === null || n > win) continue;
      }
      cols[st].push(j);
    }
    const cmp =
      sort === "firm"
        ? (a, b) =>
            (a.firm || "").localeCompare(b.firm || "") ||
            (a.title || "").localeCompare(b.title || "")
        : (a, b) => (daysSince(a.posted_date) ?? Infinity) - (daysSince(b.posted_date) ?? Infinity);
    for (const s of BOARD_COLS) cols[s].sort(cmp);
    return cols;
  }, [jobs, apps, metro, recency, q, sort]);

  const boardTotal = BOARD_COLS.reduce((n, s) => n + board[s].length, 0);

  // how many rows are hidden purely for lacking a posted_date when a recency
  // window is active (so "0 roles" under 24h is self-explanatory)
  const hiddenNoDate = useMemo(() => {
    if (recency === "all") return 0;
    const needle = q.trim().toLowerCase();
    let n = 0;
    for (const j of jobs) {
      if (metro !== "all" && j.metro !== metro) continue;
      if (needle && !(j.firm + " " + j.title).toLowerCase().includes(needle)) continue;
      const st = statusOf(j.id);
      if (statusFilter === "tracked" && st === "none") continue;
      if (statusFilter === "untracked" && st !== "none") continue;
      if (["interested", "applied", "interview", "offer", "rejected"].includes(statusFilter) && st !== statusFilter) continue;
      if (daysSince(j.posted_date) === null) n++;
    }
    return n;
  }, [jobs, apps, metro, statusFilter, q, recency]);

  const stats = useMemo(() => {
    const c = { total: jobs.length, new: 0, applied: 0, interview: 0, offer: 0, tracked: 0 };
    for (const j of jobs) if (j.is_new) c.new++;
    for (const id in apps) {
      c.tracked++;
      const s = apps[id].status;
      if (s === "applied") c.applied++;
      if (s === "interview") c.interview++;
      if (s === "offer") c.offer++;
    }
    return c;
  }, [jobs, apps]);

  return (
    <div className="app">
      <header>
        <div className="wrap">
          <button
            className="themeToggle"
            onClick={toggleTheme}
            aria-label={effectiveDark ? "Switch to light mode" : "Switch to dark mode"}
            title={effectiveDark ? "Light mode" : "Dark mode"}
          >
            {effectiveDark ? "☀" : "☾"}
          </button>
          <p className="eyebrow">Analyst &amp; Associate · Live from Supabase</p>
          <h1>Street <em>Watch</em></h1>
          <p className="sub">
            Your openings, your rhythm. Live Analyst &amp; Associate roles with a built-in
            application tracker — set a status on any role and it saves to Supabase instantly.
          </p>
          <div className="stats">
            <Stat n={stats.total} label="roles" />
            <Stat n={stats.new} label="new today" hot={stats.new > 0} />
            <Stat n={stats.tracked} label="tracked" />
            <Stat n={stats.applied} label="applied" accent />
            <Stat n={stats.interview} label="interview" accent />
            <Stat n={stats.offer} label="offer" accent />
          </div>
        </div>
      </header>

      <div className={`bar ${scrolled ? "scrolled" : ""}`}>
        <div className="bar-in">
          <Seg
            options={[
              { v: "list", label: "List" },
              { v: "board", label: "Board" },
            ]}
            value={view}
            onChange={setView}
          />
          <Seg options={METROS.map((m) => ({ v: m, label: METRO_LABEL[m] }))} value={metro} onChange={setMetro} />
          <Seg options={RECENCY.map((r) => ({ v: r.d, label: r.label }))} value={recency} onChange={setRecency} />
          <select
            className="statusSel"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort"
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {`Sort: ${s.label}`}
              </option>
            ))}
          </select>
          {view === "list" && (
            <select className="statusSel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="untracked">Not tracked</option>
              <option value="tracked">Tracked (any)</option>
              <option value="interested">Interested</option>
              <option value="applied">Applied</option>
              <option value="interview">Interview</option>
              <option value="offer">Offer</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
          <input
            ref={searchRef}
            type="search"
            placeholder="Filter by firm or role…  ( / )"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {filtersActive && (
            <button className="clearBtn" onClick={clearFilters}>
              Clear ✕
            </button>
          )}
        </div>
      </div>

      <main className="wrap">
        {error && <div className="err">{error}</div>}
        <div className="meta">
          {loading
            ? "Loading…"
            : view === "board"
            ? `${boardTotal} tracked role${boardTotal === 1 ? "" : "s"} · drag a card between columns to update its status`
            : `${filtered.length} roles` +
              (recency !== "all" ? ` · posted ≤ ${recency === 1 || recency === "1" ? "24h" : recency + "d"}` : "") +
              (hiddenNoDate ? ` · ${hiddenNoDate} hidden (no posted date)` : "")}
        </div>

        {view === "board" ? (
          !loading && boardTotal === 0 ? (
            <div className="empty">
              {filtersActive
                ? "No tracked roles match these filters."
                : "Nothing tracked yet — set a status on a role in List view and it lands here."}
            </div>
          ) : (
            <div className="board">
              {BOARD_COLS.map((s) => (
                <section
                  key={s}
                  className={`col ${dragOverCol === s ? "over" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverCol !== s) setDragOverCol(s);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverCol(null);
                    const id = e.dataTransfer.getData("text/plain");
                    const job = jobs.find((j) => String(j.id) === id);
                    if (job && statusOf(job.id) !== s) setStatus(job, s);
                  }}
                >
                  <div className="col-h">
                    <span className={`dot ${STATUS_META[s].cls}`} />
                    {STATUS_META[s].label}
                    <span className="col-n">{board[s].length}</span>
                  </div>
                  <div className="col-body">
                    {board[s].map((j) => (
                      <BoardCard key={j.id} job={j} status={s} setStatus={setStatus} />
                    ))}
                    {board[s].length === 0 && <div className="col-empty">Drop here</div>}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : (
        <>
        <div className="grid">
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div className="card skel" key={`sk${i}`} aria-hidden="true">
                <div className="sk-line sk-firm" />
                <div className="sk-line sk-title" />
                <div className="sk-line sk-title short" />
                <div className="sk-line sk-loc" />
                <div className="sk-line sk-track" />
              </div>
            ))}
          {filtered.map((j) => {
            const st = statusOf(j.id);
            const app = apps[j.id];
            const age = postedLabel(j.posted_date);
            return (
              <div className={`card ${st !== "none" ? "tracked" : ""}`} key={j.id}>
                <div className="of">
                  <span>{j.firm}</span>
                  <span className="tags">
                    {j.is_new && <span className="new">NEW</span>}
                    {st !== "none" && (
                      <span className={`pill ${STATUS_META[st].cls}`}>{STATUS_META[st].label}</span>
                    )}
                  </span>
                </div>
                <a className="role" href={j.url} target="_blank" rel="noopener noreferrer">
                  {j.title}
                </a>
                <div className="loc">
                  {(j.location || j.metro) + " · " + j.source + (age ? ` · ${age}` : "")}
                  {app?.applied_at && st === "applied" ? ` · applied ${app.applied_at}` : ""}
                </div>
                <div className="track">
                  <select
                    className={`trackSel ${STATUS_META[st].cls}`}
                    value={st}
                    onChange={(e) => setStatus(j, e.target.value)}
                  >
                    <option value="none">— Track…</option>
                    {TRACKED.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                {st !== "none" && (
                  <NoteEditor value={app?.notes} onSave={(v) => saveNotes(j, v)} />
                )}
              </div>
            );
          })}
        </div>
        {!loading && filtered.length === 0 && (
          <div className="empty">
            {filtersActive ? (
              <>
                No roles match these filters.
                <button className="clearBtn ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              "No roles yet — the pipeline hasn't populated any openings."
            )}
          </div>
        )}
        </>
        )}
      </main>

      <footer>
        <div className="wrap">
          Data refreshes daily via the pipeline. Application statuses are stored in your
          Supabase <code>applications</code> table.
        </div>
      </footer>
    </div>
  );
}

function BoardCard({ job, status, setStatus }) {
  const age = postedLabel(job.posted_date);
  return (
    <div
      className="bcard"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(job.id));
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.classList.add("dragging");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
    >
      <div className="bof">{job.firm}</div>
      <a className="brole" href={job.url} target="_blank" rel="noopener noreferrer">
        {job.title}
      </a>
      <div className="bloc">{(job.location || job.metro) + (age ? ` · ${age}` : "")}</div>
      <select
        className="bmove"
        value={status}
        onChange={(e) => setStatus(job, e.target.value)}
        aria-label="Move role to"
      >
        {BOARD_COLS.map((s) => (
          <option key={s} value={s}>
            {`→ ${STATUS_META[s].label}`}
          </option>
        ))}
        <option value="none">✕ Remove</option>
      </select>
    </div>
  );
}

function NoteEditor({ value, onSave }) {
  const [draft, setDraft] = useState(value || "");
  const [open, setOpen] = useState(!!value);
  const ref = useRef(null);
  const openByUser = useRef(false);
  useEffect(() => {
    setDraft(value || "");
    if (value) setOpen(true);
  }, [value]);
  useEffect(() => {
    if (open && openByUser.current && ref.current) {
      ref.current.focus();
      openByUser.current = false;
    }
  }, [open]);

  if (!open) {
    return (
      <button
        className="noteAdd"
        onClick={() => {
          openByUser.current = true;
          setOpen(true);
        }}
      >
        ＋ Add note
      </button>
    );
  }
  return (
    <textarea
      ref={ref}
      className="noteBox"
      rows={2}
      placeholder="Notes — recruiter, referral, deadline…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
    />
  );
}

function Stat({ n, label, hot, accent }) {
  return (
    <div className={`stat ${hot ? "hot" : ""} ${accent ? "acc" : ""}`}>
      <span className="num">{n}</span>
      <span className="lbl">{label}</span>
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.v)}
          aria-pressed={String(value) === String(o.v)}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
