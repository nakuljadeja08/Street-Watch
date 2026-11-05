// To-do notepad on the homepage of each watch. One list per watch, kept in the
// Supabase `todos` table (schema_todos.sql) so it follows you between devices.
// Until that table exists, or when the database refuses a write, items live in
// this browser instead; the next load that can reach the table moves them up.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import "./notepad.css";

const localKey = (watch) => `todos-${watch}`;
const readLocal = (watch) => {
  try {
    const v = JSON.parse(localStorage.getItem(localKey(watch)) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeLocal = (watch, items) => {
  try {
    if (items.length) localStorage.setItem(localKey(watch), JSON.stringify(items));
    else localStorage.removeItem(localKey(watch));
  } catch {
    /* private mode or storage full: the list still works for this visit */
  }
};
const readFlag = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const writeFlag = (key, on) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
};

const now = () => new Date().toISOString();
const localId = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const migrating = new Set(); // watches whose browser-only items are being moved up right now

export default function Notepad({ watch }) {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState("loading"); // loading | db | local
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null); // { id, text }
  const [open, setOpen] = useState(() => readFlag(`np-open-${watch}`, true));
  const [showDone, setShowDone] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("todos")
      .select("id, text, done, created_at, done_at")
      .eq("watch", watch)
      .order("created_at");
    if (error) {
      setMode("local");
      setItems(readLocal(watch));
      return;
    }
    let rows = data || [];
    const pending = readLocal(watch);
    if (pending.length && !migrating.has(watch)) {
      migrating.add(watch);
      const { data: moved, error: e2 } = await supabase
        .from("todos")
        .insert(pending.map(({ text, done, created_at, done_at }) => ({ watch, text, done, created_at, done_at })))
        .select("id, text, done, created_at, done_at");
      if (!e2) {
        writeLocal(watch, []);
        rows = [...rows, ...(moved || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
      } else {
        // the table is readable but won't take writes (e.g. not a member): stay local
        migrating.delete(watch);
        setMode("local");
        setItems(pending);
        return;
      }
      migrating.delete(watch);
    }
    setMode("db");
    setItems(rows);
  }, [watch]);

  useEffect(() => {
    setMode("loading");
    setEditing(null);
    load();
    // pick up edits made on another device when you come back to the tab
    const onFocus = () => modeRef.current === "db" && load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // every change goes through here: update the screen first, then save
  function commit(next, save) {
    setItems(next);
    if (modeRef.current !== "db") return writeLocal(watch, next);
    save().then(({ error } = {}) => {
      if (!error) return;
      // the database said no: keep what's on screen in this browser instead
      setMode("local");
      writeLocal(watch, next);
    });
  }

  function add(e) {
    e.preventDefault();
    const text = draft.trim().slice(0, 500);
    if (!text) return;
    const row = { id: localId(), text, done: false, created_at: now(), done_at: null };
    setDraft("");
    const next = [...items, row];
    commit(next, async () => {
      const res = await supabase.from("todos").insert({ watch, text, created_at: row.created_at }).select("id").single();
      if (!res.error) setItems((cur) => cur.map((t) => (t.id === row.id ? { ...t, id: res.data.id } : t)));
      return res;
    });
  }

  function toggle(t) {
    const done = !t.done;
    const done_at = done ? now() : null;
    commit(
      items.map((x) => (x.id === t.id ? { ...x, done, done_at } : x)),
      () => supabase.from("todos").update({ done, done_at }).eq("id", t.id),
    );
  }

  function remove(t) {
    commit(
      items.filter((x) => x.id !== t.id),
      () => supabase.from("todos").delete().eq("id", t.id),
    );
  }

  function saveEdit() {
    if (!editing) return;
    const t = items.find((x) => x.id === editing.id);
    const text = editing.text.trim().slice(0, 500);
    setEditing(null);
    if (!t || text === t.text) return;
    if (!text) return remove(t);
    commit(
      items.map((x) => (x.id === t.id ? { ...x, text } : x)),
      () => supabase.from("todos").update({ text }).eq("id", t.id),
    );
  }

  function clearDone() {
    const ids = items.filter((t) => t.done).map((t) => t.id);
    if (!ids.length) return;
    commit(
      items.filter((t) => !t.done),
      () => supabase.from("todos").delete().in("id", ids),
    );
  }

  function toggleOpen() {
    setOpen((o) => {
      writeFlag(`np-open-${watch}`, !o);
      return !o;
    });
  }

  const todo = items.filter((t) => !t.done);
  const done = items.filter((t) => t.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""));

  const row = (t) => (
    <li className={`np-item ${t.done ? "done" : ""}`} key={t.id}>
      <input
        type="checkbox"
        className="np-check"
        checked={t.done}
        onChange={() => toggle(t)}
        aria-label={`${t.done ? "Mark not done" : "Mark done"}: ${t.text}`}
      />
      {editing?.id === t.id ? (
        <input
          className="np-edit"
          value={editing.text}
          autoFocus
          maxLength={500}
          onChange={(e) => setEditing({ id: t.id, text: e.target.value })}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(null);
          }}
          aria-label="Edit to-do"
        />
      ) : (
        <button className="np-text" onClick={() => setEditing({ id: t.id, text: t.text })} title="Click to edit">
          {t.text}
        </button>
      )}
      <button className="np-x" onClick={() => remove(t)} aria-label={`Delete: ${t.text}`} title="Delete">
        ×
      </button>
    </li>
  );

  return (
    <section className={`np np-${watch} ${open ? "" : "closed"}`} aria-label="To-do notepad">
      <div className="np-head">
        <button className="np-title" onClick={toggleOpen} aria-expanded={open}>
          <span className="np-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <h2>To-dos</h2>
          {mode !== "loading" && <span className="np-n">{todo.length}</span>}
        </button>
      </div>

      {open && (
        <div className="np-body">
          <form className="np-add" onSubmit={add}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={watch === "tech" ? "add a to-do ⏎" : "Add a to-do and press Enter…"}
              maxLength={500}
              aria-label="New to-do"
            />
            <button type="submit" className="np-addBtn" disabled={!draft.trim()} aria-label="Add to-do">
              ＋
            </button>
          </form>

          {mode === "loading" ? (
            <p className="np-empty">Loading…</p>
          ) : (
            <>
              {todo.length ? <ul className="np-list">{todo.map(row)}</ul> : <p className="np-empty">Nothing on the list. Nice.</p>}
              {done.length > 0 && (
                <div className="np-doneBar">
                  <button className="np-link" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                    {showDone ? "Hide" : "Show"} done ({done.length})
                  </button>
                  <button className="np-link" onClick={clearDone}>
                    Clear done
                  </button>
                </div>
              )}
              {showDone && done.length > 0 && <ul className="np-list">{done.map(row)}</ul>}
              {mode === "local" && <p className="np-note">Saved on this device only for now.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
