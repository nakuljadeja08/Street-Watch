import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";
import "./login.css";

// One door, two watches. Signing in on a half lands you on that board; either
// account can switch boards afterwards from the bar at the top.
export default function Login({ onSignedIn }) {
  return (
    <div className="login">
      <Half
        watch="street"
        eyebrow="Profile 01 · Finance"
        title={<h1 className="login-sw-title">Street <em>Watch</em></h1>}
        who="Analyst and Associate roles at banks, private equity, hedge funds and advisory firms."
        button="Open Street Watch"
        onSignedIn={onSignedIn}
      />
      <span className="login-or" aria-hidden="true">or</span>
      <Half
        watch="tech"
        eyebrow="Profile 02 · Data engineering"
        title={
          <h1 className="login-tw-title">
            tech_watch<span className="login-cur" aria-hidden="true" />
          </h1>
        }
        who="Data engineering roles, 0 to 4 years, at tech, fintech and finance companies across the US."
        button="$ open tech-watch"
        onSignedIn={onSignedIn}
      />
    </div>
  );
}

function Half({ watch, eyebrow, title, who, button, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
    else onSignedIn(watch);
  }

  return (
    <section className={`login-half login-${watch}`}>
      <div className="login-eyebrow">{eyebrow}</div>
      {title}
      <p className="login-who">{who}</p>
      <form className="login-card" onSubmit={submit}>
        <label htmlFor={`${watch}-email`}>Email</label>
        <input
          id={`${watch}-email`}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor={`${watch}-password`}>Password</label>
        <input
          id={`${watch}-password`}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err && (
          <div className="login-err" role="alert">
            {err}
          </div>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : button}
        </button>
      </form>
    </section>
  );
}
