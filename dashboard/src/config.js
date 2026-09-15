// Public Supabase config. The anon key is a public, read-only-by-default key
// (writes are governed by RLS), so it's safe to ship in client code — same as
// the top of the original index.html. Override at build time with a .env file:
//   VITE_SUPABASE_URL=...     VITE_SUPABASE_ANON_KEY=...
const env = import.meta.env;

export const SUPABASE_URL =
  env.VITE_SUPABASE_URL || "https://lspdfpveonvxwjxrdrpf.supabase.co";

export const SUPABASE_ANON_KEY =
  env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzcGRmcHZlb252eHdqeHJkcnBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MjI1ODEsImV4cCI6MjEwNDk5ODU4MX0.84R9eFuvO7_CeQFWAJlPQGL6KSSJvm4MLQShdeI9bGc";
