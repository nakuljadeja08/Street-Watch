import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import App from "./App.jsx";
import TechApp from "./TechApp.jsx";
import Login from "./Login.jsx";

// Two boards behind one login: Street Watch at "/", Tech Watch at "/tech".
// Both people can open both; the profile only picks where you land.
const watchOfPath = () => (window.location.pathname.replace(/\/+$/, "") === "/tech" ? "tech" : "street");

// Local preview without an account: `VITE_SKIP_LOGIN=1 npm run dev`. Dev builds only.
const SKIP_LOGIN = import.meta.env.DEV && import.meta.env.VITE_SKIP_LOGIN === "1";

export default function Root() {
  const [session, setSession] = useState(SKIP_LOGIN ? null : undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [watch, setWatch] = useState(watchOfPath);

  useEffect(() => {
    if (SKIP_LOGIN) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onPop = () => setWatch(watchOfPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return setProfile(null);
    supabase
      .from("user_profiles")
      .select("display_name, home_watch")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => setProfile(data || null));
  }, [userId]);

  // each board brings its own look; the body class swaps the palette
  useEffect(() => {
    document.body.classList.toggle("tw-body", watch === "tech" && (session || SKIP_LOGIN));
    document.title = watch === "tech" ? "Tech Watch" : "Street Watch — Application Tracker";
  }, [watch, session]);

  function go(next) {
    if (next !== watchOfPath()) window.history.pushState(null, "", next === "tech" ? "/tech" : "/");
    setWatch(next);
    window.scrollTo(0, 0);
  }

  if (session === undefined) return null;
  if (!session && !SKIP_LOGIN) return <Login onSignedIn={(w) => w && go(w)} />;

  const name = profile?.display_name || session?.user?.email || "preview";
  const bar = (
    <nav className={`watchBar ${watch}`} aria-label="Boards">
      <div className="watchBar-in">
        <div className="watchBar-tabs">
          <button aria-current={watch === "street" ? "page" : undefined} onClick={() => go("street")}>
            Street Watch
          </button>
          <button aria-current={watch === "tech" ? "page" : undefined} onClick={() => go("tech")}>
            Tech Watch
          </button>
        </div>
        <div className="watchBar-me">
          <span>{name}</span>
          {!SKIP_LOGIN && <button onClick={() => supabase.auth.signOut()}>Sign out</button>}
        </div>
      </div>
    </nav>
  );

  return watch === "tech" ? (
    <TechApp header={bar} signedIn={!!session} />
  ) : (
    <App header={bar} signedIn={!!session} />
  );
}
