// POST /api/fit — score how well your resume fits one or more roles.
// Body: { jobs: [{ id, firm, title, location, url }], description? }
//   `description` (pasted by you) is only used when scoring a single role
//   whose posting couldn't be fetched automatically.
// Returns { results: { [job_id]: {score, reason} | {need_jd: true} | {error} } }
import { MODEL, checkAuth, db, json, askJson, errorResponse, getResume, getDescription, saveDescription, jobHeader } from "./_lib.js";
import { fetchDescription } from "./_jd.js";

const MAX_PER_CALL = 5;

const SYSTEM = `You are a candid recruiting advisor for finance careers (investment banking, private equity, asset management, sales & trading, consulting).
Given a candidate's resume and one job posting, score how well the candidate fits the role from 0 to 100:
- 85–100: strong fit — meets the stated experience level and core requirements; a credible, competitive applicant
- 70–84: good fit — meets most requirements; one gap
- 50–69: stretch — plausible but missing key experience, level or skills
- 0–49: poor fit — wrong level, function or hard requirements unmet
Weigh, in order: seniority/years of experience vs. the role's level, relevant functional experience, technical skills and credentials, industry/sector overlap, and hard requirements (work authorization, licenses, location) when stated.
Be calibrated and honest; do not inflate. The reason is ONE line (max 20 words) naming the deciding factor, specific to this resume and role.`;

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0-100 fit score" },
    reason: { type: "string", description: "One line, max 20 words" },
  },
  required: ["score", "reason"],
  additionalProperties: false,
};

async function scoreOne(job, resume, pasted) {
  let description = pasted?.trim();
  if (description) await saveDescription(job.id, description);
  else description = await getDescription(job, fetchDescription);
  if (!description) return { need_jd: true };

  const out = await askJson({
    system: [
      { type: "text", text: SYSTEM },
      // resume is identical across a bulk run — let it cache
      { type: "text", text: `<resume>\n${resume}\n</resume>`, cache_control: { type: "ephemeral" } },
    ],
    effort: "low",
    maxTokens: 4000,
    schema: SCHEMA,
    content: `<job>\n${jobHeader(job)}\n\n${description}\n</job>\n\nScore this candidate's fit for the job.`,
  });
  const score = Math.max(0, Math.min(100, Math.round(Number(out.score) || 0)));
  const reason = String(out.reason || "").trim().slice(0, 240);
  const { error } = await db()
    .from("ai_fit")
    .upsert({ job_id: job.id, score, reason, model: MODEL, created_at: new Date().toISOString() });
  if (error) console.warn(`ai_fit write failed: ${error.message}`);
  return { score, reason };
}

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const jobs = (body.jobs || []).filter((j) => j && j.id && j.firm && j.title).slice(0, MAX_PER_CALL);
    if (!jobs.length) return json({ error: "No roles given." }, 400);

    const profile = await getResume();
    if (!profile?.resume_text) return json({ error: "Add your resume first (✨ AI setup)." }, 400);

    const pasted = jobs.length === 1 ? body.description : null;
    const settled = await Promise.allSettled(jobs.map((j) => scoreOne(j, profile.resume_text, pasted)));
    const results = {};
    settled.forEach((s, i) => {
      results[jobs[i].id] = s.status === "fulfilled" ? s.value : { error: s.reason?.message || String(s.reason) };
    });
    return json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
