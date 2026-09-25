import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, STATUSES } from "./supabaseClient.js";
import FIRM_CATEGORIES from "../../firm_categories.json";
import Trends from "./Trends.jsx";

// firm -> type ("PE & Alts", "Bulge Bracket", …); shared with pipeline.py
const CATEGORIES = Object.keys(FIRM_CATEGORIES).filter((k) => !k.startsWith("_"));
const FIRM_CAT = {};
for (const c of CATEGORIES) for (const f of FIRM_CATEGORIES[c]) FIRM_CAT[f] = c;
const categoryOf = (firm) => FIRM_CAT[firm] || "Other";

const LEVELS = [
  { v: "any", label: "Any level" },
  { v: "analyst", label: "Analyst" },
  { v: "associate", label: "Associate" },
];
const LEVEL_RE = { analyst: /\banalyst/i, associate: /\bassociate/i };

// the part of the filter state a saved search captures
function matchesSearch(j, f) {
  if (f.metro && f.metro !== "all" && j.metro !== f.metro) return false;
  if (f.category && f.category !== "all" && categoryOf(j.firm) !== f.category) return false;
  if (f.level && f.level !== "any" && !LEVEL_RE[f.level]?.test(j.title || "")) return false;
  const needle = (f.q || "").trim().toLowerCase();
  if (needle && !(j.firm + " " + j.title).toLowerCase().includes(needle)) return false;
  return true;
}
function describeSearch(f) {
  return [
    f.level && f.level !== "any" ? LEVELS.find((l) => l.v === f.level)?.label : null,
    f.metro && f.metro !== "all" ? METRO_LABEL[f.metro] : null,
    f.category && f.category !== "all" ? f.category : null,
    f.q ? `“${f.q}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  { v: "fit", label: "Best fit" },
];
const pickJob = (j) => ({ id: j.id, firm: j.firm, title: j.title, location: j.location, url: j.url });
const fitClass = (s) => (s >= 80 ? "fit-hi" : s >= 60 ? "fit-mid" : "fit-lo");
// pipeline columns, left → right
const BOARD_COLS = ["interested", "applied", "interview", "offer", "rejected"];

// Supabase caps each response at 1000 rows, so page through the jobs table
// (sorted by metro, the cap used to silently drop most SF roles).
async function fetchAllJobs() {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await supabase
      .from("jobs")
      .select("*")
      .order("metro", { ascending: true })
      .order("firm", { ascending: true })
      .order("title", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) return res;
    rows.push(...res.data);
    if (res.data.length < PAGE) return { data: rows, error: null };
  }
}

// read filter/sort/view state out of the URL so a link restores the same view
function initialParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      metro: p.get("metro") || "all",
      category: p.get("type") || "all",
      level: LEVELS.some((l) => l.v === p.get("level")) ? p.get("level") : "any",
      recency: p.get("recency") || "all",
      statusFilter: p.get("status") || "all",
      q: p.get("q") || "",
      sort: SORTS.some((s) => s.v === p.get("sort")) ? p.get("sort") : "default",
      view: ["board", "trends"].includes(p.get("view")) ? p.get("view") : "list",
    };
  } catch {
    return { metro: "all", category: "all", level: "any", recency: "all", statusFilter: "all", q: "", sort: "default", view: "list" };
  }
}

export default function App() {
  const init = initialParams();
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState({}); // job_id -> {status, applied_at, notes}
  const [customJobs, setCustomJobs] = useState([]); // off-list roles you added yourself
  const [addOpen, setAddOpen] = useState(false); // "add your own" form on the board
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metro, setMetro] = useState(init.metro);
  const [category, setCategory] = useState(init.category);
  const [level, setLevel] = useState(init.level);
  const [searches, setSearches] = useState([]); // saved searches (named filter sets)
  const [naming, setNaming] = useState(false); // "save search" name box open
  const [recency, setRecency] = useState(init.recency);
  const [statusFilter, setStatusFilter] = useState(init.statusFilter); // all | tracked | untracked | <status>
  const [q, setQ] = useState(init.q);
  const [sort, setSort] = useState(init.sort);
  const [view, setView] = useState(init.view); // list | board | trends
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
    if (category !== "all") p.set("type", category);
    if (level !== "any") p.set("level", level);
    if (recency !== "all") p.set("recency", String(recency));
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (q.trim()) p.set("q", q.trim());
    if (sort !== "default") p.set("sort", sort);
    if (view !== "list") p.set("view", view);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [metro, category, level, recency, statusFilter, q, sort, view]);

  // ---------------------------------------------------------------- AI (fit score + drafts)
  // The /api routes are gated by a passphrase (STREET_WATCH_KEY on Vercel)
  // that lives only in this browser.
  const [swKey, setSwKey] = useState(() => {
    try {
      return localStorage.getItem("sw-ai-key") || "";
    } catch {
      return "";
    }
  });
  const [ai, setAi] = useState({ state: "off", resume: null, fits: {}, drafts: [], error: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [scoring, setScoring] = useState(() => new Set()); // job ids being scored
  const [draftFor, setDraftFor] = useState(null); // job whose draft modal is open
  const [pasteFor, setPasteFor] = useState(null); // job whose posting we couldn't fetch (fit)
  const [noJd, setNoJd] = useState(() => new Set()); // unreadable postings — skipped by bulk scoring
  const aiReady = ai.state === "ready" && !!ai.resume;

  async function aiFetch(path, body) {
    const r = await fetch(`/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: { "x-sw-key": swKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  function flash(msg, ms = 5000) {
    setError(msg);
    setTimeout(() => setError((e) => (e === msg ? "" : e)), ms);
  }

  useEffect(() => {
    try {
      if (swKey) localStorage.setItem("sw-ai-key", swKey);
      else localStorage.removeItem("sw-ai-key");
    } catch {}
    if (!swKey) {
      setAi({ state: "off", resume: null, fits: {}, drafts: [], error: "" });
      return;
    }
    let live = true;
    setAi((a) => ({ ...a, state: "loading", error: "" }));
    aiFetch("status")
      .then((d) => live && setAi({ state: "ready", resume: d.resume, fits: d.fits || {}, drafts: d.drafts || [], error: "" }))
      .catch((e) => live && setAi((a) => ({ ...a, state: "error", error: e.message })));
    return () => {
      live = false;
    };
  }, [swKey]);

  async function scoreJobs(list, description) {
    const ids = list.map((j) => j.id);
    setScoring((s) => new Set([...s, ...ids]));
    try {
      const { results } = await aiFetch("fit", { jobs: list.map(pickJob), description });
      const fits = {};
      let missing = 0;
      const failures = [];
      for (const j of list) {
        const r = results[j.id] || {};
        if (r.score != null) fits[j.id] = { score: r.score, reason: r.reason };
        else if (r.need_jd) missing++;
        else if (r.error) failures.push(r.error);
      }
      setAi((a) => ({ ...a, fits: { ...a.fits, ...fits } }));
      if (missing) setNoJd((s) => new Set([...s, ...list.filter((j) => results[j.id]?.need_jd).map((j) => j.id)]));
      if (missing && list.length === 1) setPasteFor(list[0]);
      else if (missing) flash(`${missing} posting${missing === 1 ? "" : "s"} couldn't be read automatically — use ✨ Fit on that card to paste the description.`, 7000);
      if (failures.length) flash(`Scoring failed: ${failures[0]}`);
    } catch (e) {
      flash(`Scoring failed: ${e.message}`);
    } finally {
      setScoring((s) => {
        const n = new Set(s);
        ids.forEach((id) => n.delete(id));
        return n;
      });
    }
  }

  // ---------------------------------------------------------------- saved searches
  const currentSearch = { metro, category, level, q: q.trim() };
  const searchable = metro !== "all" || category !== "all" || level !== "any" || q.trim() !== "";

  async function saveSearch(name) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const row = { name: name.trim() || describeSearch(currentSearch), filters: currentSearch, last_seen: yesterday };
    try {
      const { data, error } = await supabase.from("saved_searches").insert(row).select().single();
      if (error) throw error;
      setSearches((s) => [...s, data]);
      setNaming(false);
    } catch (e) {
      flash(`Could not save search: ${e.message || e} (run schema_ai_and_searches.sql?)`);
    }
  }

  async function deleteSearch(s) {
    setSearches((all) => all.filter((x) => x.id !== s.id));
    const { error } = await supabase.from("saved_searches").delete().eq("id", s.id);
    if (error) {
      setSearches((all) => [...all, s]);
      flash(`Could not delete search: ${error.message}`);
    }
  }

  async function markSeen(s) {
    const t = today();
    setSearches((all) => all.map((x) => (x.id === s.id ? { ...x, last_seen: t } : x)));
    const { error } = await supabase.from("saved_searches").update({ last_seen: t }).eq("id", s.id);
    if (error) {
      setSearches((all) => all.map((x) => (x.id === s.id ? s : x)));
      flash(`Could not update search: ${error.message}`);
    }
  }

  function applySearch(s) {
    const f = s.filters || {};
    setMetro(f.metro || "all");
    setCategory(f.category || "all");
    setLevel(f.level || "any");
    setQ(f.q || "");
    setRecency("all");
    setStatusFilter("all");
    setView("list");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    (async () => {
      try {
        const [jRes, aRes, cRes, sRes] = await Promise.all([
          fetchAllJobs(),
          supabase.from("applications").select("*"),
          supabase.from("custom_jobs").select("*"),
          supabase.from("saved_searches").select("*").order("created_at", { ascending: true }),
        ]);
        if (jRes.error) throw jRes.error;
        // applications table may not exist yet — treat that as "no apps"
        const appMap = {};
        if (!aRes.error && Array.isArray(aRes.data)) {
          for (const a of aRes.data) appMap[a.job_id] = a;
        } else if (aRes.error) {
          console.warn("applications read failed (run schema_applications.sql?):", aRes.error.message);
        }
        // custom_jobs table may not exist yet — treat that as "none added"
        if (cRes.error) {
          console.warn("custom_jobs read failed (run schema_custom_jobs.sql?):", cRes.error.message);
        }
        setJobs(jRes.data || []);
        setApps(appMap);
        setCustomJobs(!cRes.error && Array.isArray(cRes.data) ? cRes.data : []);
        // saved_searches table may not exist yet — treat that as "none saved"
        if (sRes.error) console.warn("saved_searches read failed (run schema_ai_and_searches.sql?):", sRes.error.message);
        setSearches(!sRes.error && Array.isArray(sRes.data) ? sRes.data : []);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // represent each custom (off-list) role as a job-shaped object so it flows
  // through the same list/board/stat rendering as scraped roles
  const CUSTOM_PREFIX = "c_";
  const customToJob = (c) => ({
    id: CUSTOM_PREFIX + c.id,
    custom: true,
    custom_id: c.id,
    firm: c.firm,
    title: c.title,
    location: c.location,
    metro: c.metro,
    url: c.url,
    source: "added by you",
    posted_date: null,
    is_new: false,
  });
  const allJobs = useMemo(
    () => [...jobs, ...customJobs.map(customToJob)],
    [jobs, customJobs]
  );
  // status/notes for scraped roles live in `apps`; for custom roles they live
  // inline on the custom_jobs row — merge both into one lookup by job id
  const appMap = useMemo(() => {
    const m = { ...apps };
    for (const c of customJobs) {
      m[CUSTOM_PREFIX + c.id] = {
        job_id: CUSTOM_PREFIX + c.id,
        status: c.status,
        applied_at: c.applied_at,
        notes: c.notes,
      };
    }
    return m;
  }, [apps, customJobs]);

  const statusOf = (id) => appMap[id]?.status || "none";

  const filtersActive =
    metro !== "all" ||
    category !== "all" ||
    level !== "any" ||
    recency !== "all" ||
    statusFilter !== "all" ||
    q.trim() !== "" ||
    sort !== "default";
  function clearFilters() {
    setMetro("all");
    setCategory("all");
    setLevel("any");
    setRecency("all");
    setStatusFilter("all");
    setQ("");
    setSort("default");
  }

  async function saveNotes(job, raw) {
    const value = raw.trim() || null;

    if (job.custom) {
      const prev = customJobs.find((c) => c.id === job.custom_id);
      if (!prev || (prev.notes || null) === value) return; // no-op
      setCustomJobs((cs) => cs.map((c) => (c.id === job.custom_id ? { ...c, notes: value } : c)));
      try {
        const { error } = await supabase
          .from("custom_jobs")
          .update({ notes: value })
          .eq("id", job.custom_id);
        if (error) throw error;
      } catch (e) {
        setCustomJobs((cs) => cs.map((c) => (c.id === job.custom_id ? { ...c, notes: prev.notes || null } : c)));
        setError(`Could not save note: ${e.message || e}`);
        setTimeout(() => setError(""), 4000);
      }
      return;
    }

    const prev = apps[job.id];
    if (!prev) return; // notes only live on a tracked (existing) row
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

  // add an off-list role you applied to yourself; returns true on success
  async function addCustom({ firm, title, location, url, metro, status }) {
    const row = {
      firm: firm.trim(),
      title: title.trim(),
      location: location.trim() || null,
      url: url.trim() || null,
      metro: metro || null,
      status,
      applied_at: status === "applied" ? today() : null,
      notes: null,
    };
    try {
      const { data, error } = await supabase
        .from("custom_jobs")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      setCustomJobs((cs) => [...cs, data]);
      return true;
    } catch (e) {
      setError(`Could not add role: ${e.message || e}`);
      setTimeout(() => setError(""), 5000);
      return false;
    }
  }

  async function setStatus(job, next) {
    if (job.custom) {
      const prev = customJobs.find((c) => c.id === job.custom_id);
      if (next === "none") {
        // removing a custom role deletes it entirely (it only exists to be tracked)
        setCustomJobs((cs) => cs.filter((c) => c.id !== job.custom_id));
        try {
          const { error } = await supabase.from("custom_jobs").delete().eq("id", job.custom_id);
          if (error) throw error;
        } catch (e) {
          if (prev) setCustomJobs((cs) => [...cs, prev]);
          setError(`Could not remove role: ${e.message || e}`);
          setTimeout(() => setError(""), 4000);
        }
        return;
      }
      const applied_at = next === "applied" && !prev?.applied_at ? today() : prev?.applied_at || null;
      setCustomJobs((cs) => cs.map((c) => (c.id === job.custom_id ? { ...c, status: next, applied_at } : c)));
      try {
        const { error } = await supabase
          .from("custom_jobs")
          .update({ status: next, applied_at })
          .eq("id", job.custom_id);
        if (error) throw error;
      } catch (e) {
        if (prev) setCustomJobs((cs) => cs.map((c) => (c.id === job.custom_id ? prev : c)));
        setError(`Could not save status: ${e.message || e}`);
        setTimeout(() => setError(""), 4000);
      }
      return;
    }

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
    const f = { metro, category, level, q };
    const win = recency === "all" ? Infinity : Number(recency);
    const rows = allJobs.filter((j) => {
      if (!matchesSearch(j, f)) return false;
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
    } else if (sort === "fit") {
      // scored roles first, best fit on top; unscored keep their order below
      rows.sort((a, b) => (ai.fits[b.id]?.score ?? -1) - (ai.fits[a.id]?.score ?? -1));
    }
    return rows;
  }, [allJobs, appMap, metro, category, level, recency, statusFilter, q, sort, ai.fits]);

  // board view: tracked roles grouped by status. Honors metro/recency/search
  // and the sort order, but ignores the status filter (columns cover all).
  const board = useMemo(() => {
    const f = { metro, category, level, q };
    const win = recency === "all" ? Infinity : Number(recency);
    const cols = Object.fromEntries(BOARD_COLS.map((s) => [s, []]));
    for (const j of allJobs) {
      const st = statusOf(j.id);
      if (st === "none" || !cols[st]) continue;
      if (!matchesSearch(j, f)) continue;
      if (win !== Infinity) {
        const n = daysSince(j.posted_date);
        if (n === null || n > win) continue;
      }
      cols[st].push(j);
    }
    const cmp =
      sort === "fit"
        ? (a, b) => (ai.fits[b.id]?.score ?? -1) - (ai.fits[a.id]?.score ?? -1)
        : sort === "firm"
        ? (a, b) =>
            (a.firm || "").localeCompare(b.firm || "") ||
            (a.title || "").localeCompare(b.title || "")
        : (a, b) => (daysSince(a.posted_date) ?? Infinity) - (daysSince(b.posted_date) ?? Infinity);
    for (const s of BOARD_COLS) cols[s].sort(cmp);
    return cols;
  }, [allJobs, appMap, metro, category, level, recency, q, sort, ai.fits]);

  const boardTotal = BOARD_COLS.reduce((n, s) => n + board[s].length, 0);

  // how many rows are hidden purely for lacking a posted_date when a recency
  // window is active (so "0 roles" under 24h is self-explanatory)
  const hiddenNoDate = useMemo(() => {
    if (recency === "all") return 0;
    const f = { metro, category, level, q };
    let n = 0;
    for (const j of allJobs) {
      if (!matchesSearch(j, f)) continue;
      const st = statusOf(j.id);
      if (statusFilter === "tracked" && st === "none") continue;
      if (statusFilter === "untracked" && st !== "none") continue;
      if (["interested", "applied", "interview", "offer", "rejected"].includes(statusFilter) && st !== statusFilter) continue;
      if (daysSince(j.posted_date) === null) n++;
    }
    return n;
  }, [allJobs, appMap, metro, category, level, statusFilter, q, recency]);

  // saved searches → roles first seen after you last looked (scraped roles only)
  const searchHits = useMemo(
    () =>
      searches.map((s) => ({
        search: s,
        fresh: jobs.filter((j) => j.first_seen && j.first_seen > s.last_seen && matchesSearch(j, s.filters || {})),
      })),
    [searches, jobs]
  );
  const pinned = searchHits.filter((h) => h.fresh.length);

  // next few unscored roles in the current list order (for "Score next 5")
  const unscoredVisible = useMemo(
    () => (aiReady ? filtered.filter((j) => !ai.fits[j.id] && !scoring.has(j.id) && !noJd.has(j.id)).slice(0, 5) : []),
    [aiReady, filtered, ai.fits, scoring, noJd]
  );

  const stats = useMemo(() => {
    const c = { total: jobs.length, new: 0, applied: 0, interview: 0, offer: 0, tracked: 0 };
    for (const j of jobs) if (j.is_new) c.new++;
    for (const id in appMap) {
      c.tracked++;
      const s = appMap[id].status;
      if (s === "applied") c.applied++;
      if (s === "interview") c.interview++;
      if (s === "offer") c.offer++;
    }
    return c;
  }, [jobs, appMap]);

  function renderCard(j) {
    const st = statusOf(j.id);
    const app = appMap[j.id];
    const age = postedLabel(j.posted_date);
    const fit = ai.fits[j.id];
    const busy = scoring.has(j.id);
    return (
      <div className={`card ${st !== "none" ? "tracked" : ""}`} key={j.id}>
        <div className="of">
          <span>{j.firm}</span>
          <span className="tags">
            {fit && (
              <span className={`fit ${fitClass(fit.score)}`} title="Fit score vs. your resume">
                {fit.score}
              </span>
            )}
            {j.is_new && <span className="new">NEW</span>}
            {j.custom && <span className="mine">YOURS</span>}
            {st !== "none" && (
              <span className={`pill ${STATUS_META[st].cls}`}>{STATUS_META[st].label}</span>
            )}
          </span>
        </div>
        {j.url ? (
          <a className="role" href={j.url} target="_blank" rel="noopener noreferrer">
            {j.title}
          </a>
        ) : (
          <span className="role">{j.title}</span>
        )}
        <div className="loc">
          {(j.location || j.metro) + " · " + j.source + (age ? ` · ${age}` : "")}
          {app?.applied_at && st === "applied" ? ` · applied ${app.applied_at}` : ""}
        </div>
        {fit?.reason && <div className="fitWhy">✨ {fit.reason}</div>}
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
          {aiReady && (
            <>
              <button
                className="aiBtn"
                disabled={busy}
                onClick={() => scoreJobs([j])}
                title={fit ? "Re-score fit" : "Score how well your resume fits this role"}
              >
                {busy ? "Scoring…" : fit ? "↻ Fit" : "✨ Fit"}
              </button>
              <button className="aiBtn" onClick={() => setDraftFor(j)} title="Cover letter + why this firm">
                ✍ {ai.drafts.includes(j.id) ? "Draft" : "Write"}
              </button>
            </>
          )}
        </div>
        {st !== "none" && (
          <NoteEditor value={app?.notes} onSave={(v) => saveNotes(j, v)} />
        )}
      </div>
    );
  }

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
          <button
            className={`aiToggle ${aiReady ? "on" : ""}`}
            onClick={() => setAiOpen((o) => !o)}
            title="Resume, fit scores and cover letters"
          >
            ✨ AI{aiReady ? "" : " setup"}
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

      {aiOpen && (
        <AiPanel
          swKey={swKey}
          setSwKey={setSwKey}
          ai={ai}
          aiFetch={aiFetch}
          onResume={(resume) => setAi((a) => ({ ...a, resume }))}
          onClose={() => setAiOpen(false)}
        />
      )}

      <div className={`bar ${scrolled ? "scrolled" : ""}`}>
        <div className="bar-in">
          <Seg
            options={[
              { v: "list", label: "List" },
              { v: "board", label: "Board" },
              { v: "trends", label: "Trends" },
            ]}
            value={view}
            onChange={setView}
          />
          <Seg options={METROS.map((m) => ({ v: m, label: METRO_LABEL[m] }))} value={metro} onChange={setMetro} />
          {view !== "trends" && <Seg options={LEVELS} value={level} onChange={setLevel} />}
          <select
            className="statusSel"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Firm type"
          >
            <option value="all">All firm types</option>
            {[...CATEGORIES, "Other"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {view !== "trends" && (
            <>
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
            </>
          )}
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
            placeholder={view === "trends" ? "Filter by firm…  ( / )" : "Filter by firm or role…  ( / )"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {filtersActive && (
            <button className="clearBtn" onClick={clearFilters}>
              Clear ✕
            </button>
          )}
          {searchable && !naming && view !== "trends" && (
            <button className="saveBtn" onClick={() => setNaming(true)} title="Save these filters and get alerts for new matches">
              ☆ Save search
            </button>
          )}
        </div>
        {(naming || searches.length > 0) && (
          <div className="saved-in">
            {naming && (
              <SaveSearchForm
                placeholder={describeSearch(currentSearch)}
                onSave={saveSearch}
                onCancel={() => setNaming(false)}
              />
            )}
            {searchHits.map(({ search: s, fresh }) => (
              <span className="chip" key={s.id}>
                <button className="chip-main" onClick={() => applySearch(s)} title={describeSearch(s.filters || {})}>
                  ★ {s.name}
                  {fresh.length > 0 && <span className="chip-n">{fresh.length} new</span>}
                </button>
                <button className="chip-x" onClick={() => deleteSearch(s)} aria-label={`Delete saved search ${s.name}`}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <main className="wrap">
        {error && <div className="err">{error}</div>}
        {view === "trends" ? (
          <Trends metro={metro} category={category} q={q} categoryOf={categoryOf} />
        ) : (
        <>
        <div className="meta">
          {loading
            ? "Loading…"
            : view === "board"
            ? `${boardTotal} tracked role${boardTotal === 1 ? "" : "s"} · drag a card between columns to update its status`
            : `${filtered.length} roles` +
              (recency !== "all" ? ` · posted ≤ ${recency === 1 || recency === "1" ? "24h" : recency + "d"}` : "") +
              (hiddenNoDate ? ` · ${hiddenNoDate} hidden (no posted date)` : "")}
          {view === "list" && unscoredVisible.length > 0 && (
            <button className="aiBtn meta-btn" onClick={() => scoreJobs(unscoredVisible)}>
              ✨ Score next {unscoredVisible.length}
            </button>
          )}
          {view === "list" && scoring.size > 0 && <span className="meta-busy"> · scoring {scoring.size}…</span>}
        </div>

        {view === "board" ? (
          <>
          <div className="board-actions">
            <button
              className={`addBtn ${addOpen ? "on" : ""}`}
              onClick={() => setAddOpen((o) => !o)}
            >
              {addOpen ? "✕ Close" : "＋ Add your own"}
            </button>
            <span className="board-actions-hint">
              Applied somewhere that isn't on the list? Add it here to track it.
            </span>
          </div>
          {addOpen && (
            <AddCustomForm
              onAdd={async (fields) => {
                const ok = await addCustom(fields);
                if (ok) setAddOpen(false);
                return ok;
              }}
              onCancel={() => setAddOpen(false)}
            />
          )}
          {!loading && boardTotal === 0 ? (
            <div className="empty">
              {filtersActive
                ? "No tracked roles match these filters."
                : "Nothing tracked yet — set a status on a role in List view, or use ＋ Add your own above."}
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
                    const job = allJobs.find((j) => String(j.id) === id);
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
                      <BoardCard
                        key={j.id}
                        job={j}
                        status={s}
                        setStatus={setStatus}
                        fit={ai.fits[j.id]}
                        onDraft={aiReady ? () => setDraftFor(j) : null}
                      />
                    ))}
                    {board[s].length === 0 && <div className="col-empty">Drop here</div>}
                  </div>
                </section>
              ))}
            </div>
          )}
          </>
        ) : (
        <>
        {!loading && pinned.length > 0 && (
          <section className="pinned">
            {pinned.map(({ search: s, fresh }) => (
              <div className="pin-group" key={s.id}>
                <div className="pin-h">
                  <span>
                    📌 <b>{s.name}</b> · {fresh.length} new since {s.last_seen}
                  </span>
                  <span className="pin-actions">
                    <button className="clearBtn ghost" onClick={() => applySearch(s)}>
                      Open search
                    </button>
                    <button className="clearBtn ghost" onClick={() => markSeen(s)}>
                      Mark seen ✓
                    </button>
                  </span>
                </div>
                <div className="grid">{fresh.slice(0, 6).map(renderCard)}</div>
                {fresh.length > 6 && (
                  <button className="pin-more" onClick={() => applySearch(s)}>
                    + {fresh.length - 6} more — open the search
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
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
          {filtered.map(renderCard)}
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
        </>
        )}
      </main>

      {draftFor && (
        <DraftModal
          job={draftFor}
          notes={appMap[draftFor.id]?.notes}
          hasDraft={ai.drafts.includes(draftFor.id)}
          aiFetch={aiFetch}
          onSaved={(id) => setAi((a) => (a.drafts.includes(id) ? a : { ...a, drafts: [...a.drafts, id] }))}
          onClose={() => setDraftFor(null)}
        />
      )}
      {pasteFor && (
        <PasteJdModal
          job={pasteFor}
          onSubmit={(text) => {
            const job = pasteFor;
            setPasteFor(null);
            scoreJobs([job], text);
          }}
          onClose={() => setPasteFor(null)}
        />
      )}

      <footer>
        <div className="wrap">
          Data refreshes daily via the pipeline. Application statuses are stored in your
          Supabase <code>applications</code> table.
        </div>
      </footer>
    </div>
  );
}

function AddCustomForm({ onAdd, onCancel }) {
  const [firm, setFirm] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [metro, setMetro] = useState("");
  const [status, setStatus] = useState("applied");
  const [busy, setBusy] = useState(false);
  const firmRef = useRef(null);

  useEffect(() => {
    firmRef.current?.focus();
  }, []);

  const canSave = firm.trim() && title.trim() && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    const ok = await onAdd({ firm, title, location, url, metro, status });
    setBusy(false);
    if (!ok) return; // parent keeps the form open + shows the error
  }

  return (
    <form className="addForm" onSubmit={submit}>
      <div className="addRow">
        <label className="addField">
          <span>Firm *</span>
          <input
            ref={firmRef}
            value={firm}
            onChange={(e) => setFirm(e.target.value)}
            placeholder="e.g. Evercore"
          />
        </label>
        <label className="addField">
          <span>Role *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Investment Banking Analyst"
          />
        </label>
      </div>
      <div className="addRow">
        <label className="addField">
          <span>Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. New York, NY"
          />
        </label>
        <label className="addField">
          <span>Link</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </div>
      <div className="addRow">
        <label className="addField">
          <span>Metro</span>
          <select className="statusSel" value={metro} onChange={(e) => setMetro(e.target.value)}>
            <option value="">— None / Other</option>
            {METROS.filter((m) => m !== "all").map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="addField">
          <span>Stage</span>
          <select className="statusSel" value={status} onChange={(e) => setStatus(e.target.value)}>
            {BOARD_COLS.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="addActions">
        <button type="button" className="clearBtn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="addBtn on" disabled={!canSave}>
          {busy ? "Adding…" : "Add role"}
        </button>
      </div>
    </form>
  );
}

function BoardCard({ job, status, setStatus, fit, onDraft }) {
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
      <div className="bof">
        {job.firm}
        {job.custom && <span className="mine">YOURS</span>}
        {fit && (
          <span className={`fit ${fitClass(fit.score)}`} title={fit.reason}>
            {fit.score}
          </span>
        )}
      </div>
      {job.url ? (
        <a className="brole" href={job.url} target="_blank" rel="noopener noreferrer">
          {job.title}
        </a>
      ) : (
        <span className="brole">{job.title}</span>
      )}
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
      {onDraft && (
        <button className="aiBtn bdraft" onClick={onDraft}>
          ✍ Cover letter
        </button>
      )}
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

function SaveSearchForm({ placeholder, onSave, onCancel }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <form
      className="saveForm"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave(name);
        setBusy(false);
      }}
    >
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Name this search — e.g. ${placeholder || "SF PE Associate"}`}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <button type="submit" className="addBtn on" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="clearBtn ghost" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

// Read a File as base64 (no data: prefix)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function AiPanel({ swKey, setSwKey, ai, aiFetch, onResume, onClose }) {
  const [keyDraft, setKeyDraft] = useState(swKey);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  async function upload(body, label) {
    setBusy(label);
    setMsg("");
    try {
      const { resume } = await aiFetch("resume", body);
      onResume(resume);
      setPasting(false);
      setText("");
      setMsg("Resume saved ✓");
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      // base64 adds ~33% and Vercel caps request bodies at ~4.5 MB
      if (file.size > 3 * 1024 * 1024) return setMsg("That PDF is over 3 MB — export a smaller one or paste the text.");
      upload({ pdf_base64: await fileToBase64(file) }, "Reading your PDF…");
    } else {
      upload({ text: await file.text() }, "Saving…");
    }
  }

  const connected = ai.state === "ready";
  return (
    <section className="aiPanel">
      <div className="wrap">
        <div className="aiPanel-h">
          <h2>✨ AI assistant</h2>
          <button className="clearBtn ghost" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p className="aiPanel-sub">
          Claude reads your resume and each job posting to give you a <b>fit score</b> with a one-line reason,
          and writes a first-draft <b>cover letter</b> and <b>“Why this firm?”</b> answer on request.
        </p>

        <div className="aiStep">
          <span className="aiStep-n">1</span>
          <form
            className="aiRow"
            onSubmit={(e) => {
              e.preventDefault();
              setSwKey(keyDraft.trim());
            }}
          >
            <label className="addField">
              <span>Passphrase (STREET_WATCH_KEY)</span>
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="the passphrase you set on Vercel"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="addBtn on">
              {connected && keyDraft === swKey ? "Connected ✓" : "Connect"}
            </button>
            {swKey && (
              <button
                type="button"
                className="clearBtn ghost"
                onClick={() => {
                  setKeyDraft("");
                  setSwKey("");
                }}
              >
                Forget
              </button>
            )}
          </form>
        </div>
        {ai.state === "loading" && <div className="aiNote">Connecting…</div>}
        {ai.state === "error" && <div className="aiNote bad">{ai.error}</div>}

        {connected && (
          <div className="aiStep">
            <span className="aiStep-n">2</span>
            <div className="aiResume">
              {ai.resume ? (
                <div className="aiNote">
                  Resume on file · {ai.resume.chars.toLocaleString()} characters · updated{" "}
                  {new Date(ai.resume.updated_at).toLocaleDateString()}
                  <div className="aiPreview">{ai.resume.preview}…</div>
                </div>
              ) : (
                <div className="aiNote">No resume yet — add one to turn on fit scores and drafts.</div>
              )}
              <div className="aiRow">
                <label className={`addBtn on fileBtn ${busy ? "disabled" : ""}`}>
                  {ai.resume ? "Replace resume (PDF / .txt)" : "Upload resume (PDF / .txt)"}
                  <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={onFile} disabled={!!busy} hidden />
                </label>
                <button className="clearBtn ghost" onClick={() => setPasting((p) => !p)} disabled={!!busy}>
                  {pasting ? "Cancel paste" : "…or paste text"}
                </button>
              </div>
              {pasting && (
                <div className="aiRow col">
                  <textarea
                    className="noteBox big"
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste your resume as plain text"
                  />
                  <button className="addBtn on" disabled={!!busy || text.trim().length < 200} onClick={() => upload({ text }, "Saving…")}>
                    Save resume
                  </button>
                </div>
              )}
              {busy && <div className="aiNote">{busy}</div>}
              {msg && <div className={`aiNote ${msg.endsWith("✓") ? "" : "bad"}`}>{msg}</div>}
            </div>
          </div>
        )}
        {connected && ai.resume && (
          <div className="aiNote">
            Ready. Use <b>✨ Fit</b> / <b>✍ Write</b> on any card, <b>✨ Score next 5</b> above the list, or sort by{" "}
            <b>Best fit</b>. Each score costs about 1¢ and each draft about 3¢ of Claude API usage.
          </div>
        )}
      </div>
    </section>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="clearBtn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasteJdModal({ job, onSubmit, onClose, busy }) {
  const [text, setText] = useState("");
  return (
    <Modal title={`${job.firm} — ${job.title}`} onClose={onClose}>
      <p className="aiNote">
        This firm's careers site couldn't be read automatically.{" "}
        {job.url && (
          <a href={job.url} target="_blank" rel="noopener noreferrer">
            Open the posting ↗
          </a>
        )}{" "}
        and paste the job description here — it's saved, so you only do this once per role.
      </p>
      <textarea
        className="noteBox big"
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full job description"
        autoFocus
      />
      <div className="addActions">
        <button className="clearBtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="addBtn on" disabled={busy || text.trim().length < 200} onClick={() => onSubmit(text)}>
          Continue
        </button>
      </div>
    </Modal>
  );
}

function DraftModal({ job, notes, hasDraft, aiFetch, onSaved, onClose }) {
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("cover_letter");
  const [state, setState] = useState("loading"); // loading | writing | ready | need_jd | error
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [extra, setExtra] = useState(null); // { question, alternative_angle, researched } from the last generation
  const [guidance, setGuidance] = useState("");

  async function generate(description) {
    setState("writing");
    setErr("");
    try {
      const d = await aiFetch("draft", { job: pickJob(job), notes, guidance, description });
      if (d.need_jd) return setState("need_jd");
      setDraft(d.draft);
      setExtra({ question: d.question, alternative_angle: d.alternative_angle, researched: d.researched });
      setState("ready");
      onSaved(job.id);
    } catch (e) {
      setErr(e.message);
      setState("error");
    }
  }

  // load the saved draft or write one — once per open (StrictMode re-runs effects)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (hasDraft) {
        try {
          const d = await aiFetch(`draft?job_id=${encodeURIComponent(job.id)}`);
          if (d.draft) {
            setDraft(d.draft);
            return setState("ready");
          }
        } catch {}
      }
      generate();
    })();
  }, [job.id]);

  if (state === "need_jd")
    return <PasteJdModal job={job} onSubmit={(text) => generate(text)} onClose={onClose} />;

  const text = draft?.[tab] || "";
  return (
    <Modal title={`${job.firm} — ${job.title}`} onClose={onClose}>
      <Seg
        options={[
          { v: "cover_letter", label: "Cover letter" },
          { v: "why_firm", label: `Why ${job.firm}?` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {(state === "loading" || state === "writing") && (
        <div className="draft-wait">
          {state === "loading"
            ? "Loading…"
            : `Researching ${job.firm}, reading the posting and your resume, and writing a first draft… (~30–60s)`}
        </div>
      )}
      {state === "error" && <div className="aiNote bad">{err}</div>}
      {state === "ready" && (
        <>
          <textarea
            className="draftBox"
            value={text}
            onChange={(e) => setDraft((d) => ({ ...d, [tab]: e.target.value }))}
            rows={16}
          />
          <div className="aiNote">
            First draft from your resume{notes ? " and notes" : ""}
            {extra?.researched ? ` plus web research on ${job.firm}` : ""}, check every claim before sending.
            {draft?.created_at && ` Written ${new Date(draft.created_at).toLocaleString()}.`}
          </div>
          {extra?.alternative_angle && <div className="aiNote">💡 Another angle: {extra.alternative_angle}</div>}
          <div className="guide">
            <label className="guide-q" htmlFor="draft-guidance">
              {extra?.question ? `❓ ${extra.question}` : "Anything to emphasize or change? (optional)"}
            </label>
            <textarea
              id="draft-guidance"
              className="noteBox"
              rows={2}
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder={extra?.question ? "Your answer, then Regenerate" : "e.g. mention I met the team at the Stern info session"}
            />
          </div>
        </>
      )}
      <div className="addActions">
        <button className="clearBtn ghost" disabled={state === "writing" || state === "loading"} onClick={() => generate()}>
          {guidance.trim() ? "↻ Regenerate with this" : "↻ Regenerate"}
        </button>
        <button
          className="addBtn on"
          disabled={state !== "ready"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(tab);
              setTimeout(() => setCopied(""), 1500);
            } catch {}
          }}
        >
          {copied === tab ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </Modal>
  );
}
