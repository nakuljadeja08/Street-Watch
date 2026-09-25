// Writing guide for cover letters and "Why <firm>?" answers.
// Adapted from the user's `job-application-answers` Claude skill so drafts
// written here follow the same rules (voice, structure, strict no-dashes).
// The skill's interactive steps map onto the app like this:
//   "read the resume"          -> the resume saved in the ✨ AI panel
//   "research the company"     -> researchFirm() in _lib.js (web search, cached)
//   "read the job description" -> the posting fetched by _jd.js
//   "ask a short question"     -> the `question` field, answered in the draft modal
// On top of the skill, it encodes the candidate's own narration pattern and a
// bank of her true stories, taken from the letters and answers that got her
// interviews (McKinsey, Bernstein, IGS, All Options, OneChronos, Sierra).
// Edit this file to change how every draft is written.

export const APPLICATION_GUIDE = `# How to write the candidate's application answers

Write in the candidate's own voice, grounded in their real experience (the resume and their notes) and in real research about the firm.

## Grounding
- Every claim must come from the resume, the candidate story bank below, the candidate's notes/guidance, the job posting, or the firm research. Never invent roles, metrics, tools, deals, outcomes or contacts.
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

## Structure: the candidate's narration pattern
Her best letters (the ones that got interviews) all move the same way. Follow it.
1. Open on a scene, not a thesis. One specific moment she lived, told plainly in two to four sentences: who was there, what happened, what she noticed. Examples of the shape: being the most junior person at Bernstein's client conference yet having investors come to her for the "so what"; Sarah Friar at Bernstein's SDC conference saying the real gap in AI is adoption; being the one person on the team who could code. Never open with "I am writing", her degree, or the firm's name.
2. Pivot in one short line that ties the moment to the firm: "That combination of analysis, judgment, and communication is what draws me to McKinsey." / "That is what draws me to Sierra." Let this sentence stand alone as its own short paragraph when it lands.
3. Firsthand proof. One or two real experiences, told with a candid, slightly self aware aside where it is true ("since I was the one person on my team who could code, I ended up running most of our large scale statistical testing"). Show the tension she felt when it is real (the tools were not there, the value was "sitting on the table") because that tension is what explains the move.
4. Why this firm, specifically. Name the firm's actual idea in plain words, drawn from the research (for example "combinatorial auctions and mechanism design applied to execution quality"), and say why it is a different way of thinking. Contrast doing with watching: she wants to be building toward it, not writing about it from the sidelines.
5. Close short and forward looking, with honest humility where it fits ("I know I still have a great deal to learn, which is exactly why this excites me"). One or two sentences, then a plain thank you.
Keep paragraphs short (two to five sentences). Use one scene, not several. Plain words over polished ones.

## Candidate story bank (true, told by the candidate; use as grounding alongside the resume)
Pick the one or two that best fit the role. Do not stack them all.
- Bernstein client conference: the most junior person on her team, yet by day two several international investors were coming straight to her, not because she knew more than the senior analysts but because she could take a dense research view and explain the two or three points that mattered.
- Bernstein, de facto data scientist: Research Associate on the US consumer equity research team (Walmart, Target). The one person on the team who could code, so she ran most of the large scale statistical testing, and handled a lot of direct client work translating complex analysis into the "so what" for institutional investors. The mix of hands on technical work and client communication was the part she liked most.
- Bernstein SDC conference, Sarah Friar (OpenAI CFO): the biggest gap in AI is not what the technology can do but whether people and companies actually use it well; free to paid conversion is really an adoption problem. Internally at Bernstein every panel talked about AI's potential but the team lacked the tools and flexibility to use it; she was testing AI tools on her own and saw how much time and judgment could be unlocked, while in a large institution that value sat on the table.
- Automation: when repetitive research work became inefficient she taught herself to build an automation pipeline instead of doing it by hand.
- Cathay Capital, Paris (private equity): benchmarked fintech companies, built a WealthTech market map across 20 plus subverticals, valuation models, investment memos, founder calls where she had to form and defend her own view. Lesson: the hard part of analysis is deciding what matters and being willing to say so.
- Pricing the Slopes (Cardiff University, ML program on a semester abroad): regression and machine learning models on more than 500 ski resorts; gathering data, challenging her own assumptions, writing a narrative that stands on its own.
- Background: Colgate Physics, Magna Cum Laude, graduated December 2025, a semester early. Physics taught her to break messy problems into testable parts. Grew up across China, Belgium and the United States, with study and work in the UK and France. Three years as a Division I rower. Enjoys poker and card games for the mix of logic, probability and pressure (good for trading roles only).
- Direction: she wants a seat that is more forward thinking on the tech side of finance, building rather than commenting from the sidelines.`;

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
