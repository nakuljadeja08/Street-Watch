// GET  /api/draft?job_id=…  — the saved draft for a role (or { draft: null })
// POST /api/draft           — write a fresh cover letter + "why this firm"
//   Body: { job: { id, firm, title, location, url }, notes?, guidance?, description? }
//   `guidance` is the candidate's answer to the draft's follow-up question (or
//   anything they want emphasized); it steers a regeneration.
// Follows the user's job-application-answers skill (see _voice.js).
import { MODEL, checkAuth, db, json, askJson, errorResponse, getResume, getDescription, saveDescription, jobHeader, researchFirm } from "./_lib.js";
import { fetchDescription } from "./_jd.js";
import { APPLICATION_GUIDE, stripDashes } from "./_voice.js";

const SYSTEM = `You write job application materials for a finance candidate (investment banking, PE, asset management, markets, consulting).

${APPLICATION_GUIDE}

## What to return
- cover_letter: 250 to 350 words. Start with "Dear Hiring Team," (or the recruiter's name if the notes give one) and end with "Sincerely," then the candidate's name from the resume. Plain text, short paragraphs separated by blank lines.
- why_firm: 120 to 180 words answering "Why <firm>?" in first person. Plain text, no heading.
- question: if the strongest version needs a detail that is NOT in the resume, notes or guidance (a motivation, a specific project moment, a personal connection to the firm), ONE short focused question to ask the candidate. Otherwise an empty string. Never invent the detail instead.
- alternative_angle: one sentence proposing a different angle the candidate could choose instead.`;

const SCHEMA = {
  type: "object",
  properties: {
    cover_letter: { type: "string" },
    why_firm: { type: "string" },
    question: { type: "string" },
    alternative_angle: { type: "string" },
  },
  required: ["cover_letter", "why_firm", "question", "alternative_angle"],
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
    const { job, notes, guidance, description: pasted } = await request.json();
    if (!job?.id || !job.firm || !job.title) return json({ error: "Missing role." }, 400);

    const profile = await getResume();
    if (!profile?.resume_text) return json({ error: "Add your resume first (✨ AI setup)." }, 400);

    let description = pasted?.trim();
    if (description) await saveDescription(job.id, description);
    else description = await getDescription(job, fetchDescription);
    if (!description) return json({ need_jd: true });

    const research = await researchFirm(job, description);

    const out = await askJson({
      system: SYSTEM,
      effort: "medium",
      maxTokens: 12000,
      schema: SCHEMA,
      content: [
        `<resume>\n${profile.resume_text}\n</resume>`,
        `<job>\n${jobHeader(job)}\n\n${description}\n</job>`,
        research ? `<firm_research>\n${research}\n</firm_research>` : "<firm_research>unavailable: rely on the posting and well known facts only</firm_research>",
        notes?.trim() ? `<candidate_notes>\n${notes.trim()}\n</candidate_notes>` : null,
        guidance?.trim() ? `<candidate_guidance>\n${guidance.trim()}\n</candidate_guidance>` : null,
        `Write the cover letter and the "Why ${job.firm}?" answer.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const draft = {
      cover_letter: stripDashes(String(out.cover_letter || "").trim()),
      why_firm: stripDashes(String(out.why_firm || "").trim()),
      created_at: new Date().toISOString(),
    };
    const { error } = await db()
      .from("ai_drafts")
      .upsert({ job_id: job.id, ...draft, model: MODEL });
    if (error) console.warn(`ai_drafts write failed: ${error.message}`);
    return json({
      draft,
      question: String(out.question || "").trim(),
      alternative_angle: String(out.alternative_angle || "").trim(),
      researched: !!research,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
