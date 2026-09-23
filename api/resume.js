// POST /api/resume — save your resume. Body: { pdf_base64 } or { text }.
// A PDF is transcribed to plain text by Claude once, so every later fit score
// and draft reads cheap text instead of re-sending the PDF.
import { checkAuth, db, json, askJson, errorResponse } from "./_lib.js";

const MAX_PDF_BYTES = 3 * 1024 * 1024; // base64 of this stays under Vercel's ~4.5 MB body cap

export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    let text = (body.text || "").trim();

    if (!text && body.pdf_base64) {
      if (body.pdf_base64.length * 0.75 > MAX_PDF_BYTES) return json({ error: "PDF is too large (max 3 MB)." }, 413);
      const out = await askJson({
        system: "You transcribe resumes into clean plain text.",
        effort: "low",
        schema: {
          type: "object",
          properties: { resume_text: { type: "string" } },
          required: ["resume_text"],
          additionalProperties: false,
        },
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.pdf_base64 } },
          {
            type: "text",
            text: "Transcribe this resume to plain text. Keep every fact, date, number and section heading exactly as written; use '- ' for bullets. Do not summarize or add anything.",
          },
        ],
      });
      text = (out.resume_text || "").trim();
    }

    if (text.length < 200) return json({ error: "That resume looks empty or too short." }, 400);

    const updated_at = new Date().toISOString();
    const { error } = await db().from("profile").upsert({ id: 1, resume_text: text, updated_at });
    if (error) throw new Error(`profile write failed: ${error.message}`);
    return json({ resume: { updated_at, chars: text.length, preview: text.slice(0, 280) } });
  } catch (e) {
    return errorResponse(e);
  }
}
