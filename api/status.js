// GET /api/status — everything the dashboard needs on load: whether a resume
// is on file, every fit score, and which roles already have a draft.
import { checkAuth, db, json, errorResponse, watchOf, tables } from "./_lib.js";

export async function GET(request) {
  const denied = await checkAuth(request);
  if (denied) return denied;
  try {
    const t = tables(watchOf(request));
    const [p, f, d] = await Promise.all([
      db().from(t.profile).select("updated_at, resume_text").eq("id", 1).maybeSingle(),
      db().from(t.fit).select("job_id, score, reason"),
      db().from(t.drafts).select("job_id"),
    ]);
    for (const r of [p, f, d]) if (r.error) throw new Error(r.error.message);
    const fits = {};
    for (const row of f.data || []) fits[row.job_id] = { score: row.score, reason: row.reason };
    return json({
      resume: p.data?.resume_text
        ? { updated_at: p.data.updated_at, chars: p.data.resume_text.length, preview: p.data.resume_text.slice(0, 280) }
        : null,
      fits,
      drafts: (d.data || []).map((r) => r.job_id),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
