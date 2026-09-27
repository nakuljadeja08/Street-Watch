// Writing guide for Tech Watch drafts (Nakul's data engineering applications).
// Same shared rules as Street Watch (voice, grounding, strict no-dashes), plus
// the candidate's own narration pattern and story bank, taken from the letters
// they sent on 2026-09-27 (Perpay, LERETA, EXL, TheGuarantors, JPMorganChase).
// Edit this file to change how every Tech Watch draft is written.
import { COMMON_RULES } from "./_voice.js";

export const TECH_APPLICATION_GUIDE = COMMON_RULES + `## Structure: the candidate's narration pattern
Their strongest letters move the same way. Follow it.
1. Open on the company's own stakes, not on the candidate. Name one concrete thing the company does and show why the data under it has to be right, in plain words. Shapes that worked: "A small error in a property tax calculation is not really small. It becomes an incorrect escrow payment, a late fee, sometimes a lien." / Perpay+ turning repayment history into credit building "only works if the underlying data is trustworthy at every step". Then connect it in one sentence to the candidate's through line: making sure that when data moves between systems, the numbers on the other end are still true, so people downstream can trust it enough to decide from it. Never open with "I am writing to apply", the degree, or a restatement of the job title.
2. Map the posting. Pick the one or two focus areas from the job description that matter most ("Two of your focus areas jumped out immediately: …") and answer each with a real project, told with the actual stack and the number that changed.
3. Firsthand proof from production. ExxonMobil first for scale and rigor, Return on Creators for startup speed and access control, Wayne Industries only when the role touches AI, agents or LLM tooling. Keep it specific: tools, data sources, who used it, what moved. Say what the candidate is proudest of when it is the unglamorous upstream part (clean, versioned, reliably delivered data).
4. Name gaps plainly, then bridge. If the posting asks for a tool the candidate has not used (AWS, Redshift, Glue, SSIS, Fivetran, DataHub…), say so in one honest sentence ("My cloud experience so far is on Azure, not AWS, and I'd rather say that plainly.") and map it to the equivalent they have run in production, ending on why the ramp is about specifics, not fundamentals. Never pretend to experience the resume does not show.
5. Why this company, specifically: something real from the research (a product, a recent integration, team size relative to the problem, who the data ultimately protects), and why that is the kind of stakes the candidate wants their work to carry. Financial services and regulated, high stakes data are the domain they most want to grow in.
6. Close short: the MS at Stevens when it helps, an offer to talk about a specific initiative from the posting or research, then a plain thank you.
Keep paragraphs to two to six sentences. Plain, direct, a little dry; confident without bragging.

## Candidate story bank (true, from the candidate's own letters; use alongside the resume)
Pick the ones that fit the role. Do not stack them all.
- ExxonMobil, Data Engineer II, two years: built ETL pipelines in Azure Data Factory and Databricks (PySpark), ingesting and transforming multi source drilling and well data into Snowflake and Azure Data Lake Gen2. Owned the CI/CD lifecycle for the team's data solutions and automated deployment through GitHub, cutting deployment time by 82 percent.
- ExxonMobil, Hole Section Grading project (led it): combined drilling data from many sources into one standardized set of KPIs, cutting evaluation errors by 15 percent; earned two leadership recommendation letters.
- ExxonMobil, reach: built the Spotfire and Power BI layer on top of those pipelines, used by more than 200 engineers and credited with about $5M in annual savings. The candidate is proudest of the work upstream of any dashboard: getting the data clean, versioned and reliably delivered. Lesson: a pipeline only matters when the people downstream trust it enough to make decisions from it.
- Return on Creators, Data Engineering Intern (summer 2026, US startup): built the scoring logic brands use to evaluate and rank creators; set up an isolated Supabase staging environment with a CI/CD flow that auto syncs schema migrations from production so changes are tested before they touch live data; wrote Row Level Security policies enforcing per brand data isolation (access governance at the row level); cut query latency by restructuring slow queries and adding indexes. Lesson: data quality and pipeline performance are not separate concerns.
- Wayne Industries (personal project, Claude API): a six agent autonomous pipeline that generates trade signals from OHLCV data. Hard position caps and risk tiered cash floors are enforced in Python before any model call, a Watchdog agent audits the system's own output end to end, and a Decision Trace panel shows exactly why the system made each call. Lesson: AI only earns trust in a regulated setting when the guardrails and explainability sit outside the model, not inside a prompt.
- Regal Shipping (earlier): SQL dashboards tracking fleet fuel use, voyage duration and maintenance; improved compliance tracking by 20 percent and cut vessel turnaround time by 12 percent. Reconciliation work at heart: catch where a number does not match, then build a process so nobody has to catch it by hand again.
- Education and credentials: completing an MS in Computer Science at Stevens Institute of Technology; IBM Data Engineering Professional Certificate; Snowflake Data Engineering Professional Certificate (2026).
- Stack honesty: production cloud is Azure (Data Factory, Databricks, ADLS Gen2) plus Snowflake, GitHub Actions, Supabase/Postgres. Not yet AWS (S3, Glue, Athena, Lambda, Redshift), SSIS, Fivetran, DataHub or Ataccama: name these as gaps with the Azure/Snowflake equivalent when a posting asks for them.
- Uses AI assisted tools (including the Claude API) as a normal part of the engineering workflow.`;

// Tech Watch letters run a little longer than Street Watch's (the candidate's
// own run about 350 to 450 words) and close the way the candidate does.
export function techReturnSpec(spec) {
  return spec
    .replace(/\bshe\b/g, "they")
    .replace("220 to 320 words", "300 to 420 words")
    .replace('End with "Thank you for considering my application." then "Sincerely,"', 'End with "Thank you for your time and consideration." then "Sincerely,"');
}
