import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Sessions persist in this browser so you stay signed in between visits.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "watch-auth" },
});

// Authorization header for the /api routes (they accept a signed-in session).
export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const STATUSES = [
  "none",
  "interested",
  "applied",
  "interview",
  "offer",
  "rejected",
];
