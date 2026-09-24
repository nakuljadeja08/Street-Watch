// Writing guide for cover letters and "Why <firm>?" answers.
// Adapted from the user's `job-application-answers` Claude skill so drafts
// written here follow the same rules (voice, structure, strict no-dashes).
// The skill's interactive steps map onto the app like this:
//   "read the resume"          -> the resume saved in the ✨ AI panel
//   "research the company"     -> researchFirm() in _lib.js (web search, cached)
//   "read the job description" -> the posting fetched by _jd.js
//   "ask a short question"     -> the `question` field, answered in the draft modal
// Edit this file to change how every draft is written.

export const APPLICATION_GUIDE = `# How to write the candidate's application answers

Write in the candidate's own voice, grounded in their real experience (the resume and their notes) and in real research about the firm.

## Grounding
- Every claim must come from the resume, the candidate's notes/guidance, the job posting, or the firm research. Never invent roles, metrics, tools, deals, outcomes or contacts.
- Identify the 3 to 5 things this role actually cares about from the job description, and map the candidate's real experience onto them.
- Use specific, true details from the firm research instead of generic praise or the firm's own marketing copy fed back to them.

## The no-dashes rule (strict)
Never use dash characters of any kind: no em dashes, no en dashes, and no hyphens used as connectors or punctuation. Rewrite the sentence instead.
- Replace a dash break with a comma, a period, a colon, or the word it stands in for ("and", "to", "which").
- Turn hyphenated phrases into spaced words or reword them: "multi source" not "multi-source", "end to end" not "end-to-end", "200 plus engineers" not "200+ engineers".
- Number ranges use "to" or "through": "5 to 35 percent", "June 2026 to present".
Proofread for any stray dash before answering.

## Voice: sound like a real person, not a template
- First person, warm, direct, confident without bragging. Write the way a smart candidate actually talks in a strong application.
- Lead with a genuine reason or hook, not a restatement of the question or the firm's marketing copy.
- Vary sentence length. Let a short sentence land. Avoid stacked parallel clauses and buzzword pileups that read as AI generated.
- No corporate filler: "passionate", "synergy", "leverage my skill set", "I am confident that", "in today's fast paced world", "I am writing to express". Cut anything that could appear in any candidate's answer to any firm.
- Show, do not claim. Tie a specific project or number to the specific thing the role needs, so the point proves itself.
- Make it specific to THIS firm and role: reference a real detail from the research and connect it to something real the candidate has done or to how they work.

## Structure
- Open with the real reason for interest or the strongest relevant proof point.
- Middle: one or two concrete resume experiences that map directly to the role's needs, plus the specific firm and culture alignment found in research.
- Close with forward looking fit: what they want to build or grow into there, briefly.
- Keep it tight.`;

// Deterministic safety net for the no-dashes rule, applied after generation.
// Leaves emails and URLs alone.
export function stripDashes(text) {
  return text
    // number/date ranges: 5-35, 2023–2024, 2024 – present
    .replace(/(\d)\s*[‒-―-]\s*(\d|present\b|now\b|today\b)/gi, "$1 to $2")
    .split(/(\s+)/)
    .map((tok) => {
      if (/@|:\/\//.test(tok)) return tok; // emails, URLs
      return tok.replace(/(\w)[‐‑-](?=\w)/g, "$1 "); // end-to-end -> end to end
    })
    .join("")
    .replace(/\s*[‒-―]\s*/g, ", ") // em/en dash breaks -> comma
    .replace(/(^|\s)-(\s)/g, "$1,$2") // spaced hyphen used as a dash
    .replace(/ ,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,(\s*[.!?:;])/g, "$1");
}
