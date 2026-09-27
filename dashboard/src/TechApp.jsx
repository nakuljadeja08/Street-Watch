import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, authHeaders } from "./supabaseClient.js";
import Trends from "./Trends.jsx";
import { DraftModal, PasteJdModal, fileToBase64 } from "./App.jsx";
import "./tech.css";

// Tech Watch: data engineering roles (tech_pipeline.py -> Supabase tech_*).
// Layout is a dev-tool board (sidebar / list / detail pane) driven by one
// command line: every filter is a token in it, so the sidebar, saved searches
// and the URL all just write the command.

const HUBS = [
  ["nyc", "NYC Area"], ["sf", "SF Bay Area"], ["seattle", "Seattle"], ["chicago", "Chicago"],
  ["boston", "Boston"], ["texas", "Texas"], ["dc", "DC / Virginia"], ["la", "Los Angeles"],
  ["charlotte", "Charlotte"], ["atlanta", "Atlanta"], ["denver", "Denver"],
  ["remote", "Remote (US)"], ["other", "Other US"],
];
const HUB_OF = Object.fromEntries(HUBS);
const SLUG_OF = Object.fromEntries(HUBS.map(([s, n]) => [n, s]));
const SECTORS = ["Tech", "Fintech", "Finance"];
const STATUSES = ["interested", "applied", "interview", "offer", "rejected"];
const STATUS_LABEL = { interested: "Interested", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const SORTS = ["new", "fit", "firm"];

const today = () => new Date().toISOString().slice(0, 10);
function daysSince(d) {
  const t = d ? Date.parse(d + "T00:00:00Z") : NaN;
  return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}
const ageOf = (j) => daysSince(j.posted_date) ?? daysSince(j.first_seen);
const pickJob = (j) => ({ id: j.id, firm: j.firm, title: j.title, location: j.location, url: j.url });

// "sector:fintech hub:nyc new spark" -> filter spec. Unknown words search.
export function parseCmd(cmd) {
  const f = { words: [], sector: null, hub: null, status: null, sort: "new", isNew: false, days: null };
  for (const tok of cmd.trim().split(/\s+/).filter(Boolean)) {
    const [k, ...rest] = tok.split(":");
    const v = rest.join(":").toLowerCase();
    const key = k.toLowerCase();
    if (rest.length && key === "sector") f.sector = SECTORS.find((s) => s.toLowerCase() === v) || null;
    else if (rest.length && key === "hub") f.hub = HUB_OF[v] || null;
    else if (rest.length && key === "status") f.status = v === "tracked" || STATUSES.includes(v) ? v : null;
    else if (rest.length && key === "sort") f.sort = SORTS.includes(v) ? v : "new";
    else if (rest.length && key === "age") f.days = Number(v) || null;
    else if (!rest.length && key === "new") f.isNew = true;
    else if (!rest.length && key === "remote") f.hub = "Remote (US)";
    else f.words.push(tok.toLowerCase());
  }
  f.q = f.words.join(" ");
  return f;
}

function matches(j, f, status) {
  if (f.sector && j.sector !== f.sector) return false;
  if (f.hub && j.metro !== f.hub) return false;
  if (f.isNew && !j.is_new) return false;
  if (f.days != null) {
    const a = ageOf(j);
    if (a == null || a > f.days) return false;
  }
  if (f.status === "tracked" && !status) return false;
  if (f.status && f.status !== "tracked" && status !== f.status) return false;
  if (f.q) {
    const hay = `${j.firm} ${j.title} ${j.location || ""}`.toLowerCase();
    if (!f.words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

// Dev fallback: the last local pull, when the Supabase tables aren't set up yet.
const LOCAL_PULL = import.meta.env.DEV ? import.meta.glob("../../tech_watch_jobs.json", { import: "default" }) : {};

async function fetchAll(table) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await supabase.from(table).select("*").order("id").range(from, from + PAGE - 1);
    if (res.error) return res;
    rows.push(...res.data);
    if (res.data.length < PAGE) return { data: rows, error: null };
  }
}

function initialCmd() {
  try {
    return new URLSearchParams(window.location.search).get("q") || "";
  } catch {
    return "";
  }
}

export default function TechApp({ header, signedIn }) {
  const [jobs, setJobs] = useState([]);
  const [apps, setApps] = useState({});
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cmd, setCmd] = useState(initialCmd);
  const [cmdFocus, setCmdFocus] = useState(false);
  const [view, setView] = useState(() => (new URLSearchParams(window.location.search).get("view") === "trends" ? "trends" : "list"));
  const [selId, setSelId] = useState(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("sw-theme") || "auto";
    } catch {
      return "auto";
    }
  });
  const cmdRef = useRef(null);
  const listRef = useRef(null);

  function flash(msg, ms = 5000) {
    setError(msg);
    setTimeout(() => setError((e) => (e === msg ? "" : e)), ms);
  }

  // ------------------------------------------------------------ data
  useEffect(() => {
    (async () => {
      try {
        const [jRes, aRes, sRes] = await Promise.all([
          fetchAll("tech_jobs"),
          supabase.from("tech_applications").select("*"),
          supabase.from("tech_saved_searches").select("*").order("created_at"),
        ]);
        let rows = jRes.data;
        if (jRes.error) {
          if (!import.meta.env.DEV) throw jRes.error;
          // local preview before the tables exist: last committed pull
          const load = Object.values(LOCAL_PULL)[0];
          if (!load) throw jRes.error;
          rows = await load();
          console.warn("tech_jobs unavailable, using tech_watch_jobs.json:", jRes.error.message);
        }
        setJobs(rows || []);
        if (!aRes.error) setApps(Object.fromEntries(aRes.data.map((a) => [a.job_id, a])));
        if (!sRes.error) setSearches(sRes.data || []);
      } catch (e) {
        setError(`Couldn't load Tech Watch (run schema_tech.sql?): ${e.message || e}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ------------------------------------------------------------ theme + URL
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("sw-theme", theme);
    } catch {}
  }, [theme]);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "auto" && prefersDark);

  useEffect(() => {
    const p = new URLSearchParams();
    if (cmd.trim()) p.set("q", cmd.trim());
    if (view !== "list") p.set("view", view);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [cmd, view]);

  // ------------------------------------------------------------ AI
  const [ai, setAi] = useState({ state: "off", resume: null, fits: {}, drafts: [], error: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [scoring, setScoring] = useState(() => new Set());
  const [draftFor, setDraftFor] = useState(null);
  const [pasteFor, setPasteFor] = useState(null);
  const aiReady = ai.state === "ready" && !!ai.resume;

  async function aiFetch(path, body) {
    const r = await fetch(`/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: { ...(await authHeaders()), "x-watch": "tech", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setAi((a) => ({ ...a, state: "loading" }));
    aiFetch("status")
      .then((d) => live && setAi({ state: "ready", resume: d.resume, fits: d.fits || {}, drafts: d.drafts || [], error: "" }))
      .catch((e) => live && setAi((a) => ({ ...a, state: "error", error: e.message })));
    return () => {
      live = false;
    };
  }, [signedIn]);

  async function scoreJobs(list, description) {
    const ids = list.map((j) => j.id);
    setScoring((s) => new Set([...s, ...ids]));
    try {
      const { results } = await aiFetch("fit", { jobs: list.map(pickJob), description });
      const fits = {};
      for (const j of list) {
        const r = results[j.id] || {};
        if (r.score != null) fits[j.id] = { score: r.score, reason: r.reason };
        else if (r.need_jd && list.length === 1) setPasteFor(j);
        else if (r.error) flash(`Scoring failed: ${r.error}`);
      }
      setAi((a) => ({ ...a, fits: { ...a.fits, ...fits } }));
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

  // ------------------------------------------------------------ tracker
  async function setStatus(job, next) {
    const prev = apps[job.id];
    const row = next
      ? {
          job_id: job.id,
          status: next,
          applied_at: next === "applied" && !prev?.applied_at ? today() : prev?.applied_at || null,
          notes: prev?.notes || null,
        }
      : null;
    setApps((m) => {
      const c = { ...m };
      if (row) c[job.id] = row;
      else delete c[job.id];
      return c;
    });
    const { error } = row
      ? await supabase.from("tech_applications").upsert(row, { onConflict: "job_id" })
      : await supabase.from("tech_applications").delete().eq("job_id", job.id);
    if (error) {
      setApps((m) => {
        const c = { ...m };
        if (prev) c[job.id] = prev;
        else delete c[job.id];
        return c;
      });
      flash(`Could not save status: ${error.message}`);
    }
  }

  async function saveNotes(job, raw) {
    const prev = apps[job.id];
    const notes = raw.trim() || null;
    if (!prev || (prev.notes || null) === notes) return;
    setApps((m) => ({ ...m, [job.id]: { ...prev, notes } }));
    const { error } = await supabase.from("tech_applications").update({ notes }).eq("job_id", job.id);
    if (error) {
      setApps((m) => ({ ...m, [job.id]: prev }));
      flash(`Could not save note: ${error.message}`);
    }
  }

  // ------------------------------------------------------------ saved searches
  const spec = useMemo(() => parseCmd(cmd), [cmd]);
  async function saveSearch() {
    const name = cmd.trim();
    if (!name) return;
    const row = {
      name,
      filters: { cmd: name, metro: spec.hub || "all", sector: spec.sector || "all", q: spec.q },
      last_seen: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    };
    const { data, error } = await supabase.from("tech_saved_searches").insert(row).select().single();
    if (error) flash(`Could not save search: ${error.message}`);
    else setSearches((s) => [...s, data]);
  }
  async function deleteSearch(s) {
    setSearches((all) => all.filter((x) => x.id !== s.id));
    const { error } = await supabase.from("tech_saved_searches").delete().eq("id", s.id);
    if (error) {
      setSearches((all) => [...all, s]);
      flash(`Could not delete search: ${error.message}`);
    }
  }

  // ------------------------------------------------------------ derived
  const statusOf = (id) => apps[id]?.status || null;
  const rows = useMemo(() => {
    const out = jobs.filter((j) => matches(j, spec, statusOf(j.id)));
    const fit = (j) => ai.fits[j.id]?.score ?? -1;
    if (spec.sort === "fit") out.sort((a, b) => fit(b) - fit(a) || (ageOf(a) ?? 99) - (ageOf(b) ?? 99));
    else if (spec.sort === "firm") out.sort((a, b) => a.firm.localeCompare(b.firm) || a.title.localeCompare(b.title));
    else out.sort((a, b) => (ageOf(a) ?? 99) - (ageOf(b) ?? 99) || a.firm.localeCompare(b.firm));
    return out;
  }, [jobs, spec, apps, ai.fits]);

  const counts = useMemo(() => {
    const c = { all: jobs.length, new: 0, sector: {}, hub: {}, status: {} };
    for (const j of jobs) {
      if (j.is_new) c.new++;
      c.sector[j.sector] = (c.sector[j.sector] || 0) + 1;
      c.hub[j.metro] = (c.hub[j.metro] || 0) + 1;
      const st = statusOf(j.id);
      if (st) c.status[st] = (c.status[st] || 0) + 1;
    }
    return c;
  }, [jobs, apps]);

  const sectorOfFirm = useMemo(() => {
    const m = {};
    for (const j of jobs) m[j.firm] = j.sector;
    return m;
  }, [jobs]);

  const sel = rows.find((j) => j.id === selId) || rows[0] || null;
  const lastPull = useMemo(() => jobs.reduce((m, j) => (j.first_seen > m ? j.first_seen : m), ""), [jobs]);

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        cmdRef.current?.focus();
        cmdRef.current?.select();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || draftFor || pasteFor || view !== "list") return;
      const i = rows.findIndex((j) => j.id === sel?.id);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const n = rows[Math.min(rows.length - 1, i + 1)];
        if (n) setSelId(n.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = rows[Math.max(0, i - 1)];
        if (n) setSelId(n.id);
      } else if (e.key === "o" && sel?.url) window.open(sel.url, "_blank", "noopener");
      else if (e.key === "a" && sel) setStatus(sel, "applied");
      else if (e.key === "f" && sel && aiReady) scoreJobs([sel]);
      else if (e.key === "w" && sel && aiReady) setDraftFor(sel);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, draftFor, pasteFor, view, aiReady, apps]);

  useEffect(() => {
    listRef.current?.querySelector(".tw-row.on")?.scrollIntoView({ block: "nearest" });
  }, [sel?.id]);

  // clicking a sidebar entry toggles that token in the command
  function toggleToken(tok, family) {
    const toks = cmd.trim().split(/\s+/).filter(Boolean);
    const has = toks.includes(tok);
    const kept = toks.filter((t) => t !== tok && !(family && t.toLowerCase().startsWith(family + ":")));
    setCmd((has ? kept : [...kept, tok]).join(" "));
    setView("list");
  }
  const hasTok = (tok) => cmd.trim().split(/\s+/).includes(tok);

  const chips = [
    spec.sector && `sector:${spec.sector.toLowerCase()}`,
    spec.hub && `hub:${SLUG_OF[spec.hub]}`,
    spec.status && `status:${spec.status}`,
    spec.isNew && "new",
    spec.days != null && `age:${spec.days}`,
    spec.q && `grep "${spec.q}"`,
    spec.sort !== "new" && `sort:${spec.sort}`,
  ].filter(Boolean);

  const unscored = rows.filter((j) => !ai.fits[j.id] && !scoring.has(j.id)).slice(0, 5);

  return (
    <div className="tw">
      {header}
      <div className="tw-shell">
        <aside className="tw-side" aria-label="Views">
          <div className="tw-logo">
            <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
              <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--tw-ink)" />
              <path d="M6 7l3 3-3 3M10.5 13H14" stroke="var(--tw-bg)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
            tech_watch
          </div>

          <NavGroup title="Views">
            <NavItem on={!cmd.trim() && view === "list"} n={counts.all} onClick={() => (setCmd(""), setView("list"))}>All roles</NavItem>
            <NavItem on={hasTok("new")} n={counts.new} onClick={() => toggleToken("new")}>New today</NavItem>
            {SECTORS.map((s) => (
              <NavItem key={s} on={spec.sector === s} n={counts.sector[s] || 0} onClick={() => toggleToken(`sector:${s.toLowerCase()}`, "sector")}>
                {s}
              </NavItem>
            ))}
            <NavItem on={view === "trends"} onClick={() => setView(view === "trends" ? "list" : "trends")}>Hiring trends</NavItem>
          </NavGroup>

          <NavGroup title="Where">
            {HUBS.filter(([, name]) => counts.hub[name]).map(([slug, name]) => (
              <NavItem key={slug} on={spec.hub === name} n={counts.hub[name]} onClick={() => toggleToken(`hub:${slug}`, "hub")}>
                {name}
              </NavItem>
            ))}
          </NavGroup>

          <NavGroup title="Tracker">
            {STATUSES.map((s) => (
              <NavItem key={s} on={spec.status === s} n={counts.status[s] || 0} onClick={() => toggleToken(`status:${s}`, "status")}>
                {STATUS_LABEL[s]}
              </NavItem>
            ))}
          </NavGroup>

          <NavGroup title="Saved">
            {searches.map((s) => (
              <div className="tw-saved" key={s.id}>
                <button className={`tw-nav ${cmd.trim() === (s.filters?.cmd || s.name) ? "on" : ""}`} onClick={() => (setCmd(s.filters?.cmd || s.name), setView("list"))}>
                  <span className="tw-mono">{s.name}</span>
                </button>
                <button className="tw-x" aria-label={`Delete saved search ${s.name}`} onClick={() => deleteSearch(s)}>
                  ×
                </button>
              </div>
            ))}
            {!searches.length && <div className="tw-hint">Type a command, then ☆ to save it. New matches show up in the morning email.</div>}
          </NavGroup>

          <div className="tw-side-foot">
            <button className="tw-btn ghost" onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? "☀ Light" : "☾ Dark"}
            </button>
            <button className={`tw-btn ${aiReady ? "" : "ghost"}`} onClick={() => setAiOpen((o) => !o)}>
              ✨ {aiReady ? "AI" : "AI setup"}
            </button>
          </div>
        </aside>

        <main className="tw-main">
          <div className="tw-cmd">
            <label htmlFor="tw-cmd" className="tw-prompt">
              tw ❯
            </label>
            <input
              id="tw-cmd"
              ref={cmdRef}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onFocus={() => setCmdFocus(true)}
              onBlur={() => setCmdFocus(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.blur();
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  setView("list");
                }
              }}
              placeholder="spark · sector:fintech · hub:nyc · new · status:applied · sort:fit"
              autoComplete="off"
              spellCheck="false"
            />
            <kbd>⌘K</kbd>
            <button className="tw-btn ghost" onClick={saveSearch} disabled={!cmd.trim()} title="Save this command as a search">
              ☆
            </button>
          </div>

          <div className="tw-log" aria-live="polite">
            <span className="ok">✓</span> {jobs.length} live
            <span className="sep">·</span>
            <span className="gain">+{counts.new} new</span>
            {lastPull && (
              <>
                <span className="sep">·</span>
                <span className="dim">last pull {lastPull}</span>
              </>
            )}
            {chips.length > 0 && (
              <>
                <span className="sep">·</span>
                {chips.map((c) => (
                  <span className="tw-chip" key={c}>
                    {c}
                  </span>
                ))}
              </>
            )}
            {aiReady && unscored.length > 0 && view === "list" && (
              <button className="tw-btn ghost small" onClick={() => scoreJobs(unscored)} disabled={scoring.size > 0}>
                ✨ score next {unscored.length}
              </button>
            )}
          </div>

          {error && <div className="tw-err" role="alert">{error}</div>}
          {aiOpen && <ResumePanel ai={ai} setAi={setAi} aiFetch={aiFetch} signedIn={signedIn} onClose={() => setAiOpen(false)} />}

          {view === "trends" ? (
            <div className="tw-trends">
              <Trends
                table="tech_hiring_trends"
                metro={spec.hub || "all"}
                category={spec.sector || "all"}
                q={spec.q}
                categoryOf={(f) => sectorOfFirm[f] || "Other"}
              />
            </div>
          ) : (
            <div className="tw-body">
              <div className="tw-list" ref={listRef} role="listbox" aria-label="Roles">
                {loading && <div className="tw-empty">$ fetching roles…</div>}
                {!loading && !rows.length && <div className="tw-empty">0 rows. Try a shorter command, or clear it.</div>}
                {rows.map((j) => (
                  <Row
                    key={j.id}
                    job={j}
                    on={sel?.id === j.id}
                    status={statusOf(j.id)}
                    fit={ai.fits[j.id]}
                    onClick={() => setSelId(j.id)}
                  />
                ))}
              </div>
              {sel && (
                <Detail
                  job={sel}
                  app={apps[sel.id]}
                  fit={ai.fits[sel.id]}
                  scoring={scoring.has(sel.id)}
                  aiReady={aiReady}
                  hasDraft={ai.drafts.includes(sel.id)}
                  onStatus={(s) => setStatus(sel, s)}
                  onNotes={(n) => saveNotes(sel, n)}
                  onFit={() => scoreJobs([sel])}
                  onDraft={() => setDraftFor(sel)}
                  onSetupAi={() => setAiOpen(true)}
                />
              )}
            </div>
          )}

          <div className="tw-status">
            <span className="mode">{cmdFocus ? "INSERT" : "NORMAL"}</span>
            <span>{view === "trends" ? "trends" : `${rows.length} rows`}</span>
            <span>sort: {spec.sort}</span>
            <span className="keys">/ search · j k move · o open · a applied · f fit · w write</span>
          </div>
        </main>
      </div>

      {draftFor && (
        <DraftModal
          job={draftFor}
          notes={apps[draftFor.id]?.notes || ""}
          hasDraft={ai.drafts.includes(draftFor.id)}
          aiFetch={aiFetch}
          onSaved={(id) => setAi((a) => ({ ...a, drafts: a.drafts.includes(id) ? a.drafts : [...a.drafts, id] }))}
          onClose={() => setDraftFor(null)}
        />
      )}
      {pasteFor && (
        <PasteJdModal
          job={pasteFor}
          onClose={() => setPasteFor(null)}
          onSubmit={(text) => {
            const j = pasteFor;
            setPasteFor(null);
            scoreJobs([j], text);
          }}
        />
      )}
    </div>
  );
}

function NavGroup({ title, children }) {
  return (
    <div className="tw-group">
      <h2>{title}</h2>
      <div className="tw-navs">{children}</div>
    </div>
  );
}

function NavItem({ on, n, onClick, children }) {
  return (
    <button className={`tw-nav ${on ? "on" : ""}`} aria-pressed={!!on} onClick={onClick}>
      <span>{children}</span>
      {n != null && <span className="n">{n}</span>}
    </button>
  );
}

function Row({ job, on, status, fit, onClick }) {
  const age = ageOf(job);
  return (
    <button className={`tw-row ${on ? "on" : ""}`} role="option" aria-selected={on} onClick={onClick}>
      <span className="tw-mono-badge" aria-hidden="true">
        {job.firm[0]}
      </span>
      <span className="tw-row-main">
        <span className="tw-row-title">{job.title}</span>
        <span className="tw-row-meta">
          {job.firm} · {job.location || job.metro}
        </span>
      </span>
      <span className="tw-row-tags">
        {fit && <span className={`tw-fit ${fit.score >= 80 ? "hi" : fit.score >= 60 ? "mid" : "lo"}`}>{fit.score}</span>}
        {status && <span className={`tw-badge st-${status}`}>{status}</span>}
        {job.is_new && <span className="tw-badge new">new</span>}
        <span className={`tw-badge sec-${(job.sector || "").toLowerCase()}`}>{(job.sector || "").toLowerCase()}</span>
        <span className="tw-age">{age == null ? "–" : `${age}d`}</span>
      </span>
    </button>
  );
}

function Detail({ job, app, fit, scoring, aiReady, hasDraft, onStatus, onNotes, onFit, onDraft, onSetupAi }) {
  const [notes, setNotes] = useState(app?.notes || "");
  useEffect(() => setNotes(app?.notes || ""), [job.id, app?.notes]);
  const posted = ageOf(job);
  return (
    <aside className="tw-detail" aria-label="Role details">
      <div>
        <div className="tw-detail-firm">{job.firm}</div>
        <h2 className="tw-detail-title">{job.title}</h2>
      </div>
      <dl className="tw-kv">
        <dt>location</dt>
        <dd>{job.location || "—"}</dd>
        <dt>hub</dt>
        <dd>{job.metro}</dd>
        <dt>sector</dt>
        <dd>{job.sector}</dd>
        <dt>posted</dt>
        <dd>{job.posted_date ? `${job.posted_date} (${posted}d)` : "not given"}</dd>
        <dt>first seen</dt>
        <dd>{job.first_seen || "—"}</dd>
        <dt>source</dt>
        <dd>{job.source}</dd>
      </dl>

      <div className="tw-section">
        <h3>Track</h3>
        <div className="tw-status-btns" role="group" aria-label="Application status">
          {STATUSES.map((s) => (
            <button key={s} className={app?.status === s ? `on st-${s}` : ""} aria-pressed={app?.status === s} onClick={() => onStatus(app?.status === s ? null : s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {app && (
          <textarea
            className="tw-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onNotes(notes)}
            placeholder="Notes: referral, recruiter, what they asked…"
          />
        )}
        {app?.applied_at && <div className="tw-hint">applied {app.applied_at}</div>}
      </div>

      <div className="tw-section">
        <h3>AI fit</h3>
        {fit ? (
          <>
            <div className="tw-fitbar">
              <span className="bar">
                <i style={{ width: `${fit.score}%` }} />
              </span>
              <b>{fit.score}</b>
            </div>
            <div className="tw-hint">✨ {fit.reason}</div>
          </>
        ) : aiReady ? (
          <button className="tw-btn ghost" onClick={onFit} disabled={scoring}>
            {scoring ? "Scoring…" : "✨ Score my fit"}
          </button>
        ) : (
          <button className="tw-btn ghost" onClick={onSetupAi}>
            Add your resume to score fit
          </button>
        )}
      </div>

      <div className="tw-actions">
        <button className="tw-btn ghost" onClick={aiReady ? onDraft : onSetupAi}>
          ✍ {hasDraft ? "Open cover letter" : "Write cover letter"}
        </button>
        {job.url && (
          <a className="tw-btn pri" href={job.url} target="_blank" rel="noopener noreferrer">
            Open posting ↗
          </a>
        )}
      </div>
    </aside>
  );
}

function ResumePanel({ ai, setAi, aiFetch, signedIn, onClose }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [text, setText] = useState("");
  const [pasting, setPasting] = useState(false);

  async function upload(body, label) {
    setBusy(label);
    setMsg("");
    try {
      const { resume } = await aiFetch("resume", body);
      setAi((a) => ({ ...a, resume }));
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
      if (file.size > 3 * 1024 * 1024) return setMsg("That PDF is over 3 MB. Export a smaller one or paste the text.");
      upload({ pdf_base64: await fileToBase64(file) }, "Reading your PDF…");
    } else upload({ text: await file.text() }, "Saving…");
  }

  return (
    <section className="tw-panel" aria-label="AI setup">
      <div className="tw-panel-h">
        <h2>✨ AI assistant</h2>
        <button className="tw-btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="tw-hint">
        Claude reads your resume and each posting to score your fit (0 to 100, with the deciding reason) and to draft a cover letter and
        a "Why this company?" answer. Tech Watch keeps its own resume, separate from Street Watch.
      </p>
      {!signedIn && <div className="tw-err">Sign in to use AI.</div>}
      {ai.state === "error" && <div className="tw-err">{ai.error}</div>}
      {ai.state === "ready" && (
        <>
          <div className="tw-hint">
            {ai.resume
              ? `Resume on file · ${ai.resume.chars.toLocaleString()} characters · updated ${new Date(ai.resume.updated_at).toLocaleDateString()}`
              : "No resume yet. Add one to turn on fit scores and cover letters."}
          </div>
          {ai.resume && <pre className="tw-preview">{ai.resume.preview}…</pre>}
          <div className="tw-panel-row">
            <label className={`tw-btn ${busy ? "disabled" : ""}`}>
              {ai.resume ? "Replace resume (PDF / .txt)" : "Upload resume (PDF / .txt)"}
              <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" onChange={onFile} disabled={!!busy} hidden />
            </label>
            <button className="tw-btn ghost" onClick={() => setPasting((p) => !p)} disabled={!!busy}>
              {pasting ? "Cancel" : "Paste text"}
            </button>
          </div>
          {pasting && (
            <div className="tw-panel-row col">
              <textarea className="tw-notes" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your resume as plain text" />
              <button className="tw-btn" disabled={!!busy || text.trim().length < 200} onClick={() => upload({ text }, "Saving…")}>
                Save resume
              </button>
            </div>
          )}
          {busy && <div className="tw-hint">{busy}</div>}
          {msg && <div className={msg.endsWith("✓") ? "tw-hint" : "tw-err"}>{msg}</div>}
        </>
      )}
    </section>
  );
}
