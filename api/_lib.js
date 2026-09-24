// Shared helpers for the AI routes (files starting with "_" aren't routes).
//
// Env (set in Vercel → Project → Settings → Environment Variables, or .env locally):
//   ANTHROPIC_API_KEY     Claude API key
//   SUPABASE_SERVICE_KEY  service_role key — the AI tables are locked to it
//   STREET_WATCH_KEY      passphrase the dashboard must send (x-sw-key header);
//                         keeps strangers from spending your API credits or
//                         reading your resume
//   SUPABASE_URL          optional; defaults to the project URL
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// Sonnet 5: scoring and drafting are well within its range at a fraction of
// Opus's price ($2 / $10 per million input / output tokens).
export const MODEL = "claude-sonnet-5";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://lspdfpveonvxwjxrdrpf.supabase.co";

export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Returns an error Response when the request isn't allowed, else null.
export function checkAuth(request) {
  const want = process.env.STREET_WATCH_KEY;
  if (!want) return json({ error: "Server is missing STREET_WATCH_KEY." }, 500);
  if (request.headers.get("x-sw-key") !== want) return json({ error: "Wrong passphrase." }, 401);
  if (!process.env.SUPABASE_SERVICE_KEY) return json({ error: "Server is missing SUPABASE_SERVICE_KEY." }, 500);
  return null;
}

let _db;
export function db() {
  _db ??= createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  return _db;
}

let _claude;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Server is missing ANTHROPIC_API_KEY.");
  _claude ??= new Anthropic();
  return _claude;
}

export async function getResume() {
  const { data, error } = await db().from("profile").select("resume_text, updated_at").eq("id", 1).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return data;
}

// One Claude call that must come back as JSON matching `schema`.
export async function askJson({ system, content, schema, effort = "medium", maxTokens = 8000 }) {
  const response = await claude().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Response was cut off — try again.");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Empty response from Claude.");
  return JSON.parse(text);
}

// Turn a thrown error into a JSON error response with a useful status.
export function errorResponse(e) {
  if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude is rate-limited — try again in a minute." }, 429);
  if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY is invalid." }, 500);
  if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}: ${e.message}` }, 502);
  return json({ error: e.message || String(e) }, 500);
}

// Cached job description, fetched from the firm's site on first use.
export async function getDescription(job, fetchDescription) {
  const { data } = await db().from("job_details").select("description").eq("job_id", job.id).maybeSingle();
  if (data?.description) return data.description;
  const text = await fetchDescription(job);
  if (text) await saveDescription(job.id, text);
  return text;
}

export async function saveDescription(jobId, text) {
  const { error } = await db()
    .from("job_details")
    .upsert({ job_id: jobId, description: text, fetched_at: new Date().toISOString() });
  if (error) console.warn(`job_details write failed: ${error.message}`);
}

// Firm research for drafts (the skill's "research the company" step): Claude
// searches the web and writes a short fact brief. Cached per firm for 14 days
// in job_details under a "research:<firm>" key, so roles at the same firm reuse
// it. Returns "" if search is unavailable — drafting then proceeds without it.
const RESEARCH_TTL_MS = 14 * 86400000;

export async function researchFirm(job, description) {
  const key = `research:${job.firm}`;
  const { data } = await db().from("job_details").select("description, fetched_at").eq("job_id", key).maybeSingle();
  if (data?.description && Date.now() - Date.parse(data.fetched_at) < RESEARCH_TTL_MS) return data.description;

  try {
    const messages = [
      {
        role: "user",
        content:
          `Research ${job.firm} for a candidate applying to "${job.title}"${job.location ? ` in ${job.location}` : ""}.\n` +
          `Job posting excerpt:\n${description.slice(0, 3000)}\n\n` +
          `Find: what the firm and this team/business actually do, notable recent news, deals or growth (last ~18 months, with dates), ` +
          `and its stated values/culture or anything distinctive about how it works or trains junior staff. ` +
          `Answer with 6 to 10 short factual bullets, each specific and true, with a date where relevant. No intro, no advice.`,
      },
    ];
    let response;
    for (let turn = 0; turn < 3; turn++) {
      response = await claude().messages.create({
        model: MODEL,
        max_tokens: 6000,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      });
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content }); // server resumes the search loop
    }
    const brief = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (brief) {
      await db()
        .from("job_details")
        .upsert({ job_id: key, description: brief, fetched_at: new Date().toISOString() });
    }
    return brief;
  } catch (e) {
    console.warn(`firm research failed for ${job.firm}: ${e.message}`);
    return "";
  }
}

export function jobHeader(job) {
  return [
    `Firm: ${job.firm}`,
    `Role: ${job.title}`,
    job.location ? `Location: ${job.location}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
