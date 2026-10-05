import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";
import "./recruiters.css";

// Recruiter directory + outreach tracker, shared by both watches.
// Firms and contacts come from a private list (import_recruiters.py) and are
// readable only by the two signed-in profiles; outreach rows are per watch.
// Nothing from the list is bundled into this code.

export const OUTREACH = [
  ["none", "Not contacted"],
  ["emailed", "Emailed"],
  ["replied", "Replied"],
  ["call", "Call set"],
  ["follow_up", "Follow up"],
  ["not_interested", "Not a fit"],
];
const OUTREACH_LABEL = Object.fromEntries(OUTREACH);
const OPEN = new Set(["none", "emailed", "follow_up", "replied", "call"]);

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const scoreKey = (watch) => (watch === "tech" ? "tech_score" : "street_score");
const typeShort = (t = "") =>
  t.toLowerCase().startsWith("contingency") ? "Contingency" : /aesc|major/i.test(t) ? "Retained · major" : "Retained";

// ---------------------------------------------------------------- data
async function fetchAll(table, select = "*") {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Loads the directory once per watch. state: loading | ready | unavailable
// ("unavailable" = tables not created yet, or this account isn't a member).
export function useRecruiters(watch) {
  const [state, setState] = useState("loading");
  const [firms, setFirms] = useState({});
  const [contacts, setContacts] = useState([]);
  const [outreach, setOutreach] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [f, c, o] = await Promise.all([
          fetchAll("recruiter_firms"),
          fetchAll("recruiter_contacts"),
          supabase.from("recruiter_outreach").select("*").eq("watch", watch),
        ]);
        if (o.error) throw o.error;
        if (!live) return;
        setFirms(Object.fromEntries(f.map((x) => [x.id, x])));
        setContacts(c);
        setOutreach(Object.fromEntries(o.data.map((x) => [x.contact_id, x])));
        setState(c.length ? "ready" : "unavailable");
      } catch (e) {
        if (live) setState("unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, [watch]);

  const save = useCallback(
    async (contactId, patch) => {
      const prev = outreach[contactId];
      const row = { status: "none", ...prev, ...patch, watch, contact_id: contactId, updated_at: new Date().toISOString() };
      setOutreach((o) => ({ ...o, [contactId]: row }));
      const { error: e } = await supabase.from("recruiter_outreach").upsert(row);
      if (e) {
        setOutreach((o) => ({ ...o, [contactId]: prev }));
        setError(`Couldn't save: ${e.message}`);
        setTimeout(() => setError(""), 5000);
      }
    },
    [outreach, watch]
  );

  return { state, firms, contacts, outreach, save, error, scoreKey: scoreKey(watch), watch };
}

// ---------------------------------------------------------------- job matching
// Which recruiter industry/position codes a role calls for.
const STREET_CAT_IND = {
  "Bulge Bracket": ["BAN", "INV", "FIN", "BRK"],
  "Elite Boutique": ["INV", "BAN", "FIN"],
  "Middle Market IB": ["INV", "BAN", "FIN"],
  "PE & Alts": ["VEN", "INV", "FIN"],
  "Asset Management": ["INV", "FIN"],
  Banks: ["BAN", "FIN"],
  Trading: ["INV", "BRK", "FIN", "CMM"],
  Consulting: ["CON", "GEN"],
  Fintech: ["FTC", "FIN"],
  "Fashion & Luxury": ["RTL", "CSG", "CPG", "LEI"],
};
const TECH_SECTOR_IND = {
  Tech: ["HIT", "SFT", "WWW", "BIG", "CYB", "CMP", "APP"],
  Fintech: ["FTC", "FIN"],
  Finance: ["FIN", "BAN", "INV"],
};

function jobCodes(job, watch, category) {
  const t = (job.title || "").toLowerCase();
  if (watch === "tech") return { ind: TECH_SECTOR_IND[job.sector] || [], pos: ["QNT", "MIS", "TEC"] };
  const ind = STREET_CAT_IND[category] || [];
  let pos = ["FIN", "QNT", "MNA"];
  if (category === "Fintech" || category === "Fashion & Luxury") pos = ["MAR", "SAL"];
  if (/risk|compliance|kyc|aml|regulat/.test(t)) pos = ["RIS", "REG", ...pos];
  if (/operations|\bops\b/.test(t)) pos = ["OPS", ...pos];
  return { ind, pos };
}

const overlap = (a = [], b = []) => a.filter((x) => b.includes(x)).length;

// Top recruiters for a role: must cover both its industry and its function;
// one person per firm; people marked "Not a fit" are skipped.
export function matchRecruiters(rec, job, category, n = 3) {
  if (rec.state !== "ready" || !job) return [];
  const { ind, pos } = jobCodes(job, rec.watch, category);
  if (!ind.length) return [];
  const scored = [];
  for (const c of rec.contacts) {
    const i = overlap(c.ind_codes, ind);
    const p = overlap(c.pos_codes, pos);
    if (!i || !p || rec.outreach[c.id]?.status === "not_interested") continue;
    scored.push([(c[rec.scoreKey] ?? 40) + 6 * Math.min(i, 3) + 6 * Math.min(p, 3), c]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = [];
  const firmsSeen = new Set();
  for (const [, c] of scored) {
    if (firmsSeen.has(c.firm_id)) continue;
    firmsSeen.add(c.firm_id);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------- views
export function RecruitersView({ rec, aiFetch, aiReady, onSetupAi }) {
  const [q, setQ] = useState("");
  const [fitOnly, setFitOnly] = useState(true);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(null); // contact id
  const [expanded, setExpanded] = useState(() => new Set());

  const due = useMemo(
    () =>
      Object.values(rec.outreach).filter((o) => o.next_date && o.next_date <= today() && OPEN.has(o.status)).length,
    [rec.outreach]
  );

  const groups = useMemo(() => {
    if (rec.state !== "ready") return [];
    const needle = q.trim().toLowerCase();
    const byFirm = {};
    for (const c of rec.contacts) {
      const f = rec.firms[c.firm_id];
      if (!f) continue;
      const o = rec.outreach[c.id];
      const st = o?.status || "none";
      if (fitOnly && c[rec.scoreKey] == null) continue;
      if (type !== "all" && typeShort(f.type).split(" ")[0].toLowerCase() !== type) continue;
      if (status === "due" ? !(o?.next_date && o.next_date <= today() && OPEN.has(st)) : status !== "all" && st !== status) continue;
      if (needle && !`${f.name} ${c.name} ${c.title} ${f.industries} ${f.positions}`.toLowerCase().includes(needle)) continue;
      (byFirm[f.id] ||= { firm: f, people: [] }).people.push(c);
    }
    const list = Object.values(byFirm);
    for (const g of list) {
      g.people.sort((a, b) => (b[rec.scoreKey] ?? -1) - (a[rec.scoreKey] ?? -1));
      g.best = g.people[0][rec.scoreKey] ?? -1;
    }
    return list.sort((a, b) => b.best - a.best || a.firm.name.localeCompare(b.firm.name));
  }, [rec, q, fitOnly, type, status]);

  if (rec.state === "loading") return <div className="rc-empty">Loading recruiters…</div>;
  if (rec.state === "unavailable")
    return (
      <div className="rc-empty">
        The recruiter directory isn't set up yet. Run <code>schema_recruiters.sql</code> in Supabase, then{" "}
        <code>python import_recruiters.py "path/to/Recruiter.pdf"</code>.
      </div>
    );

  const people = groups.reduce((n, g) => n + g.people.length, 0);
  const contacted = Object.values(rec.outreach).filter((o) => o.status !== "none").length;
  const openContact = open && rec.contacts.find((c) => c.id === open);

  return (
    <div className="rc">
      <div className="rc-bar">
        <input type="search" placeholder="Search firm, person, industry…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="rc-check">
          <input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} /> Covers my field
        </label>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Firm type">
          <option value="all">All firm types</option>
          <option value="contingency">Contingency (works with candidates)</option>
          <option value="retained">Retained (hired by companies)</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Outreach status">
          <option value="all">Any status</option>
          <option value="due">Follow-up due ({due})</option>
          {OUTREACH.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="rc-meta">
        {groups.length} firms · {people} people · {contacted} contacted
        {due > 0 && (
          <button className="rc-due" onClick={() => setStatus("due")}>
            {due} follow-up{due === 1 ? "" : "s"} due
          </button>
        )}
        <span className="rc-hint">Contingency firms are paid when they place someone, so they're the ones most open to hearing from candidates.</span>
      </div>
      {rec.error && <div className="rc-err">{rec.error}</div>}

      <div className="rc-firms">
        {groups.map(({ firm: f, people: ps }) => {
          const isOpen = expanded.has(f.id);
          return (
            <section className="rc-firm" key={f.id}>
              <div className="rc-firm-h">
                <div>
                  <h3>{f.name}</h3>
                  <div className="rc-firm-meta">
                    <span className={`rc-type ${typeShort(f.type).startsWith("Contingency") ? "cont" : ""}`}>{typeShort(f.type)}</span>
                    {f.min_salary ? <span>min ${Math.round(f.min_salary / 1000)}k</span> : null}
                    {f.website && (
                      <a href={`https://${f.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noopener noreferrer">
                        {f.website.replace(/^https?:\/\//, "")} ↗
                      </a>
                    )}
                  </div>
                </div>
                {f.about && (
                  <button
                    className="rc-link"
                    onClick={() =>
                      setExpanded((s) => {
                        const n = new Set(s);
                        n.has(f.id) ? n.delete(f.id) : n.add(f.id);
                        return n;
                      })
                    }
                  >
                    {isOpen ? "Hide about" : "About"}
                  </button>
                )}
              </div>
              {isOpen && <p className="rc-about">{f.about}</p>}
              <ul className="rc-people">
                {ps.map((c) => (
                  <PersonRow key={c.id} c={c} o={rec.outreach[c.id]} onOpen={() => setOpen(c.id)} />
                ))}
              </ul>
            </section>
          );
        })}
        {!groups.length && <div className="rc-empty">No recruiters match these filters.</div>}
      </div>

      {openContact && (
        <OutreachModal
          rec={rec}
          contact={openContact}
          aiFetch={aiFetch}
          aiReady={aiReady}
          onSetupAi={onSetupAi}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PersonRow({ c, o, onOpen }) {
  const st = o?.status || "none";
  const isDue = o?.next_date && o.next_date <= today() && OPEN.has(st);
  return (
    <li>
      <button className="rc-person" onClick={onOpen}>
        <span className="rc-person-main">
          <b>{c.name}</b>
          <span>{c.title}</span>
        </span>
        <span className="rc-person-tags">
          {c.level === "recruiter" && <span className="rc-tag">recruiter</span>}
          {(c.pos_codes || []).slice(0, 4).map((x) => (
            <span className="rc-code" key={x}>
              {x}
            </span>
          ))}
          {st !== "none" && <span className={`rc-st st-${st}`}>{OUTREACH_LABEL[st]}</span>}
          {isDue && <span className="rc-st due">due {o.next_date}</span>}
        </span>
      </button>
    </li>
  );
}

// Recruiters for one role. `compact` renders a short list for a detail pane.
export function RecruiterMatches({ rec, job, category, aiFetch, aiReady, onSetupAi, compact }) {
  const [open, setOpen] = useState(null);
  const list = useMemo(() => matchRecruiters(rec, job, category, compact ? 3 : 5), [rec, job, category, compact]);
  if (rec.state !== "ready") return null;
  return (
    <div className="rc-match">
      {list.length === 0 ? (
        <div className="rc-hint">No recruiter in your list covers this kind of role.</div>
      ) : (
        <ul>
          {list.map((c) => {
            const st = rec.outreach[c.id]?.status || "none";
            return (
              <li key={c.id}>
                <button className="rc-match-row" onClick={() => setOpen(c)}>
                  <span>
                    <b>{c.name}</b> · {rec.firms[c.firm_id]?.name}
                    <small>{c.title}</small>
                  </span>
                  {st !== "none" && <span className={`rc-st st-${st}`}>{OUTREACH_LABEL[st]}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <OutreachModal
          rec={rec}
          contact={open}
          job={job}
          aiFetch={aiFetch}
          aiReady={aiReady}
          onSetupAi={onSetupAi}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// Card button + modal listing the matches (Street Watch's card grid).
export function RecruitersButton({ rec, job, category, aiFetch, aiReady, onSetupAi }) {
  const [open, setOpen] = useState(false);
  const n = useMemo(() => matchRecruiters(rec, job, category, 5).length, [rec, job, category]);
  if (rec.state !== "ready" || !n) return null;
  return (
    <>
      <button className="aiBtn" onClick={() => setOpen(true)} title="Recruiters in your list who cover this kind of role">
        👥 {n}
      </button>
      {open && (
        <RcModal title={`Recruiters for ${job.firm} — ${job.title}`} onClose={() => setOpen(false)}>
          <RecruiterMatches rec={rec} job={job} category={category} aiFetch={aiFetch} aiReady={aiReady} onSetupAi={onSetupAi} />
        </RcModal>
      )}
    </>
  );
}

function RcModal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rc-modal" role="dialog" aria-modal="true" aria-label={title}>
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

export function OutreachModal({ rec, contact: c, job, aiFetch, aiReady, onSetupAi, onClose }) {
  const f = rec.firms[c.firm_id] || {};
  const o = rec.outreach[c.id] || {};
  const st = o.status || "none";
  const [notes, setNotes] = useState(o.notes || "");
  const [subject, setSubject] = useState(o.draft_subject || "");
  const [body, setBody] = useState(o.draft_body || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  function setSt(next) {
    const patch = { status: next };
    if (next === "emailed") {
      patch.last_contacted = today();
      if (!o.next_date) patch.next_date = plusDays(7); // nudge again in a week
    }
    if (next === "not_interested") patch.next_date = null;
    rec.save(c.id, patch);
  }

  async function draft() {
    setBusy(true);
    setErr("");
    try {
      const d = await aiFetch("outreach", {
        contact_id: c.id,
        job: job ? { id: job.id, firm: job.firm, title: job.title, location: job.location } : null,
      });
      setSubject(d.subject);
      setBody(d.body);
      rec.save(c.id, { draft_subject: d.subject, draft_body: d.body, drafted_at: new Date().toISOString() });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  }

  const mailto =
    c.email && body ? `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null;

  return (
    <RcModal title={`${c.name} · ${f.name || ""}`} onClose={onClose}>
      <div className="rc-o-head">
        <div>{c.title}</div>
        <div className="rc-firm-meta">
          <span className={`rc-type ${typeShort(f.type).startsWith("Contingency") ? "cont" : ""}`}>{typeShort(f.type)}</span>
          {f.min_salary ? <span>min ${Math.round(f.min_salary / 1000)}k</span> : null}
          {c.email && (
            <button className="rc-link" onClick={() => copy("email", c.email)}>
              {copied === "email" ? "Copied ✓" : c.email}
            </button>
          )}
          {f.phone && <span>{f.phone}</span>}
        </div>
        {job && (
          <div className="rc-hint">
            About: {job.firm} — {job.title}
          </div>
        )}
      </div>

      <div className="rc-o-status" role="group" aria-label="Outreach status">
        {OUTREACH.map(([v, l]) => (
          <button key={v} className={st === v ? `on st-${v}` : ""} aria-pressed={st === v} onClick={() => setSt(v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="rc-o-row">
        <label>
          Follow up on{" "}
          <input type="date" value={o.next_date || ""} onChange={(e) => rec.save(c.id, { next_date: e.target.value || null })} />
        </label>
        {o.last_contacted && <span className="rc-hint">last contacted {o.last_contacted}</span>}
      </div>
      <textarea
        className="noteBox"
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (o.notes || "") && rec.save(c.id, { notes })}
        placeholder="Notes: what they said, roles they mentioned, who referred you…"
      />

      <div className="rc-o-draft">
        <div className="rc-o-draft-h">
          <b>Email</b>
          {aiReady ? (
            <button className="aiBtn" disabled={busy} onClick={draft}>
              {busy ? "Writing…" : body ? "↻ Redraft" : "✨ Draft email"}
            </button>
          ) : (
            <button className="aiBtn" onClick={onSetupAi}>
              Add your resume to draft
            </button>
          )}
        </div>
        {err && <div className="aiNote bad">{err}</div>}
        {(body || subject) && (
          <>
            <input
              className="rc-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => subject !== (o.draft_subject || "") && rec.save(c.id, { draft_subject: subject })}
              placeholder="Subject"
            />
            <textarea
              className="draftBox"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => body !== (o.draft_body || "") && rec.save(c.id, { draft_body: body })}
            />
            <div className="rc-hint">A first draft from your resume and this recruiter's focus. Check every line before you send it.</div>
            <div className="addActions">
              <button className="clearBtn ghost" onClick={() => copy("body", `${subject}\n\n${body}`)}>
                {copied === "body" ? "Copied ✓" : "Copy"}
              </button>
              {mailto && (
                <a className="addBtn on" href={mailto} onClick={() => st === "none" && setSt("emailed")}>
                  Open in email app
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </RcModal>
  );
}
