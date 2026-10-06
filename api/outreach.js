// POST /api/outreach — draft a short email to a recruiter from the private list.
//   Body: { contact_id, job?: { id, firm, title, location } }
//   Returns { subject, body } and saves it on the watch's recruiter_outreach row.
// Nothing is sent: the dashboard shows the draft to copy or open in a mail app.
import { MODEL, checkAuth, db, json, askJson, errorResponse, getResume, watchOf } from "./_lib.js";
import { COMMON_RULES, stripDashes } from "./_voice.js";

const TARGET = {
  street:
    "entry level Analyst or Associate roles in finance (investment banking, private equity, asset management, " +
    "markets, banks, fintech), in New York, Chicago or the San Francisco Bay Area",
  tech: "data engineering roles at new grad to mid level (about 0 to 4 years), at tech or finance companies, anywhere in the US or remote",
};

// Fixed sign-off per watch (null = use the name on the resume).
const SIGN_OFF = { street: "Best,\nSerena Tian", tech: null };

// Swap whatever closing the model wrote for the fixed one.
function withSignOff(body, signOff) {
  if (!signOff) return body;
  const trimmed = body.replace(/\n+\s*(best|best regards|regards|thanks|thank you|sincerely)[,.!]?\s*(\n[^\n]*)?\s*$/i, "");
  return `${trimmed.trimEnd()}\n\n${signOff}`;
}

const SYSTEM = `You write a short first email from a job seeker to an external recruiter (an agency or search firm recruiter, not the hiring company).

${COMMON_RULES}

## This email
- Purpose: introduce the candidate and ask whether the recruiter is working on, or expects, searches that fit. Recruiters skim, so it must be short and concrete.
- Greeting "Hi <first name>,". Then one or two sentences on who the candidate is, using the two or three strongest true facts from the resume.
- One sentence on why this recruiter specifically: their firm's focus or this person's practice (from the recruiter details), stated plainly. Never flatter.
- One sentence on exactly what the candidate is looking for (role type, level, locations).
- If a specific role is given, mention it in one sentence as an example of the kind of role, without claiming the recruiter is hiring for it.
- Close with one light ask (a 15 minute call, or keeping the candidate in mind for relevant searches) and "My resume is attached." Then "Best," and the candidate's name from the resume.
- 90 to 150 words in the body. Plain text, short paragraphs. No bullet points.
- subject: 4 to 9 words, specific (role type + one credential), no clickbait, no exclamation marks.`;

const SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
  additionalProperties: false,
};

// Recruiter data is limited to the two profiles in user_profiles (open sign-ups
// would otherwise let any registered account through checkAuth).
async function isMember(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return !!process.env.STREET_WATCH_KEY && request.headers.get("x-sw-key") === process.env.STREET_WATCH_KEY;
  const { data } = await db().auth.getUser(token);
  if (!data?.user) return false;
  const { data: p } = await db().from("user_profiles").select("user_id").eq("user_id", data.user.id).maybeSingle();
  return !!p;
}

export async function POST(request) {
  const denied = await checkAuth(request);
  if (denied) return denied;
  try {
    if (!(await isMember(request))) return json({ error: "Not allowed." }, 403);
    const { contact_id, job } = await request.json();
    if (!contact_id) return json({ error: "contact_id is required." }, 400);
    const watch = watchOf(request);

    const { data: c, error } = await db()
      .from("recruiter_contacts")
      .select("name, title, ind_codes, pos_codes, firm_id, recruiter_firms(name, type, about, industries, positions)")
      .eq("id", contact_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!c) return json({ error: "Recruiter not found." }, 404);

    const profile = await getResume(watch);
    if (!profile?.resume_text) return json({ error: "Add your resume first (✨ AI setup)." }, 400);

    const f = c.recruiter_firms || {};
    const out = await askJson({
      system: SYSTEM,
      effort: "low",
      maxTokens: 3000,
      schema: SCHEMA,
      content: [
        `<resume>\n${profile.resume_text}\n</resume>`,
        `<looking_for>\n${TARGET[watch]}\n</looking_for>`,
        `<recruiter>\nName: ${c.name}\nTitle: ${c.title || "—"}\nFirm: ${f.name}\nFirm type: ${f.type || "—"}\n` +
          `Person's industry codes: ${(c.ind_codes || []).join(", ") || "—"}\nPerson's function codes: ${(c.pos_codes || []).join(", ") || "—"}\n` +
          `Firm industries: ${(f.industries || "").slice(0, 600)}\nFirm functions: ${(f.positions || "").slice(0, 600)}\n` +
          `About the firm: ${(f.about || "").slice(0, 1200)}\n</recruiter>`,
        SIGN_OFF[watch] ? `<sign_off>\nEnd the email with exactly:\n${SIGN_OFF[watch]}\n</sign_off>` : null,
        job ? `<example_role>\n${job.firm}: ${job.title}${job.location ? ` (${job.location})` : ""}\n</example_role>` : null,
        "Write the email.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const subject = stripDashes(String(out.subject || "").trim());
    const body = withSignOff(stripDashes(String(out.body || "").trim()), SIGN_OFF[watch]);
    const { error: e2 } = await db()
      .from("recruiter_outreach")
      .upsert(
        { watch, contact_id, draft_subject: subject, draft_body: body, drafted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { onConflict: "watch,contact_id" }
      );
    if (e2) console.warn(`recruiter_outreach write failed: ${e2.message}`);
    return json({ subject, body, model: MODEL });
  } catch (e) {
    return errorResponse(e);
  }
}
