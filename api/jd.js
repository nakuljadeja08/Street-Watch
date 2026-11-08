// POST /api/jd — a role's job description for the dashboard's detail panel.
// Body: { job: { id, firm, title, location, url } }
// Returns { description } (from the job_details cache, else fetched from the
// firm's ATS and cached) or { need_jd: true } when the site can't be read.
// No Claude call, so it costs nothing; same sign-in/passphrase gate as the rest.
import { checkAuth, json, errorResponse, getDescription } from "./_lib.js";
import { fetchDescription } from "./_jd.js";

export async function POST(request) {
  const denied = await checkAuth(request);
  if (denied) return denied;
  try {
    const { job } = await request.json();
    if (!job?.id) return json({ error: "Missing job." }, 400);
    const description = await getDescription(job, fetchDescription);
    return json(description ? { description } : { need_jd: true });
  } catch (e) {
    return errorResponse(e);
  }
}
