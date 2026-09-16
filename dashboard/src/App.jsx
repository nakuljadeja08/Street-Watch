import React, { useEffect, useMemo, useState } from "react";
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

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState({}); // job_id -> {status, applied_at, notes}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metro, setMetro] = useState("all");
  const [recency, setRecency] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all | tracked | untracked | <status>
  const [q, setQ] = useState("");

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
    return jobs.filter((j) => {
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
  }, [jobs, apps, metro, recency, statusFilter, q]);

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

      <div className="bar">
        <div className="bar-in">
          <Seg options={METROS.map((m) => ({ v: m, label: METRO_LABEL[m] }))} value={metro} onChange={setMetro} />
          <Seg options={RECENCY.map((r) => ({ v: r.d, label: r.label }))} value={recency} onChange={setRecency} />
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
          <input
            type="search"
            placeholder="Filter by firm or role…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <main className="wrap">
        {error && <div className="err">{error}</div>}
        <div className="meta">
          {loading
            ? "Loading…"
            : `${filtered.length} roles` +
              (recency !== "all" ? ` · posted ≤ ${recency === 1 || recency === "1" ? "24h" : recency + "d"}` : "") +
              (hiddenNoDate ? ` · ${hiddenNoDate} hidden (no posted date)` : "")}
        </div>
        <div className="grid">
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
              </div>
            );
          })}
        </div>
        {!loading && filtered.length === 0 && (
          <div className="empty">No roles match the current filters.</div>
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
