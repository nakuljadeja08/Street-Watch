// GET  /api/draft?job_id=…  — the saved draft for a role (or { draft: null })
// POST /api/draft           — write a fresh cover letter + "why this firm"
//   Body: { job: { id, firm, title, location, url }, notes?, description? }
import { MODEL, checkAuth, db, json, askJson, errorResponse, getResume, getDescription, saveDescription, jobHeader } from "./_lib.js";
import { fetchDescription } from "./_jd.js";

const SYSTEM = `You write application materials for a finance job candidate (investment banking, PE, asset management, markets, consulting).
Write in the candidate's own voice: confident, specific, plain English, no clichés ("I am writing to express", "passionate", "fast-paced environment", "leverage").
Use ONLY facts found in the resume and the candidate's notes — never invent experience, numbers, names, or contacts. If the notes mention a referral, recruiter, conversation or event, use it naturally.
Tie 2–3 concrete resume experiences to what this specific role and firm need, drawn from the job description.

cover_letter: 250–350 words. Start with "Dear Hiring Team," (or the recruiter's name if the notes give one) and end with "Sincerely," then the candidate's name from the resume. Plain text, short paragraphs separated by blank lines.
why_firm: 120–180 words answering the interview question "Why <firm>?" in first person — what distinguishes this firm and this team (from the posting and widely known facts about the firm), and why that matches the candidate's goals and background. Plain text, no heading.`;

const SCHEMA = {
  type: "object",
  properties: {
    cover_letter: { type: "string" },
    why_firm: { type: "string" },
  },
  required: ["cover_letter", "why_firm"],
  additionalProperties: false,
};

export async function GET(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  const jobId = new URL(request.url).searchParams.get("job_id");
  if (!jobId) return json({ error: "job_id is required." }, 400);
  const { data, error } = await db()
    .from("ai_drafts")
    .select("cover_letter, why_firm, created_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return json({ draft: data });
}

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  try {
    const { job, notes, description: pasted } = await request.json();
    if (!job?.id || !job.firm || !job.title) return json({ error: "Missing role." }, 400);

    const profile = await getResume();
    if (!profile?.resume_text) return json({ error: "Add your resume first (✨ AI setup)." }, 400);

    let description = pasted?.trim();
    if (description) await saveDescription(job.id, description);
    else description = await getDescription(job, fetchDescription);
    if (!description) return json({ need_jd: true });

    const out = await askJson({
      system: SYSTEM,
      effort: "medium",
      maxTokens: 12000,
      schema: SCHEMA,
      content: [
        `<resume>\n${profile.resume_text}\n</resume>`,
        `<job>\n${jobHeader(job)}\n\n${description}\n</job>`,
        notes?.trim() ? `<candidate_notes>\n${notes.trim()}\n</candidate_notes>` : null,
        `Write the cover letter and the "Why ${job.firm}?" answer.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const draft = {
      cover_letter: String(out.cover_letter || "").trim(),
      why_firm: String(out.why_firm || "").trim(),
      created_at: new Date().toISOString(),
    };
    const { error } = await db()
      .from("ai_drafts")
      .upsert({ job_id: job.id, ...draft, model: MODEL });
    if (error) console.warn(`ai_drafts write failed: ${error.message}`);
    return json({ draft });
  } catch (e) {
    return errorResponse(e);
  }
}
