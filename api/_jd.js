// Fetch a job's full description text from the firm's own careers system.
//
// Files in api/ that start with "_" are helpers, not Vercel routes.
// Strategy: use each ATS's JSON detail endpoint where one exists (Workday,
// Greenhouse, Ashby, Oracle, Goldman), otherwise fetch the public page and
// read its schema.org JobPosting JSON-LD, falling back to the page's text.
// Returns plain text, or "" when nothing usable was found (the UI then asks
// the user to paste the description).

const UA = { "User-Agent": "street-watch/0.2 (personal job tracker)" };
const TIMEOUT_MS = 15000;

async function get(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { ...UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// HTML → readable plain text (keeps paragraph / bullet structure)
function stripTags(s) {
  return s
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToText(html) {
  if (!html) return "";
  // Some sources entity-escape their HTML once or even twice (Greenhouse,
  // Radancy JSON-LD, Workday's "&#xa;"), so strip + decode until stable.
  let s = String(html);
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(stripTags(s));
    if (next === s) break;
    s = next;
  }
  return s
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- per-ATS
async function workday(u) {
  // https://<tenant>.<dc>.myworkdayjobs.com/<site>/job/<path>
  // https://<dc>.myworkdaysite.com/recruiting/<tenant>/<site>/job/<path>
  let tenant, site, rest;
  const parts = u.pathname.split("/").filter(Boolean);
  const jobIdx = parts.indexOf("job");
  if (jobIdx < 0) return "";
  rest = parts.slice(jobIdx + 1).join("/");
  if (u.host.endsWith("myworkdaysite.com")) {
    tenant = parts[jobIdx - 2];
    site = parts[jobIdx - 1];
  } else {
    tenant = u.host.split(".")[0];
    site = parts[jobIdx - 1];
    // some sites carry a locale segment first (/en-US/<site>/job/...)
  }
  const api = `https://${u.host}/wday/cxs/${tenant}/${site}/job/${rest}`;
  const j = await (await get(api, { headers: { Accept: "application/json" } })).json();
  return htmlToText(j?.jobPostingInfo?.jobDescription);
}

async function greenhouse(jobId) {
  // gh-<token>-<numeric id>; the token itself may contain dashes
  const m = /^gh-(.+)-(\d+)$/.exec(jobId);
  if (!m) return "";
  const j = await (await get(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`)).json();
  return htmlToText(j?.content);
}

async function ashby(jobId) {
  // ashby-<board>-<uuid>
  const m = /^ashby-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(jobId);
  if (!m) return "";
  const j = await (await get(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=false`)).json();
  const job = (j?.jobs || []).find((x) => x.id === m[2]);
  return job ? job.descriptionPlain || htmlToText(job.descriptionHtml) : "";
}

async function oracle(u) {
  // https://<host>/hcmUI/CandidateExperience/en/sites/<siteNumber>/job/<id>
  const m = /\/sites\/([^/]+)\/job\/(\d+)/.exec(u.pathname);
  if (!m) return "";
  const finder = `ById;Id="${m[2]}",siteNumber=${m[1]}`;
  const api =
    `https://${u.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?onlyData=true&expand=all&finder=${encodeURIComponent(finder)}`;
  const j = await (await get(api, { headers: { Accept: "application/json" } })).json();
  const it = j?.items?.[0] || {};
  return htmlToText(
    [it.ExternalDescriptionStr, it.ExternalResponsibilitiesStr, it.ExternalQualificationsStr]
      .filter(Boolean)
      .join("\n")
  );
}

const GS_GRAPHQL = "https://api-higher.gs.com/gateway/api/v1/graphql";
async function goldman(jobId) {
  // gs-<roleId>, e.g. gs-162057_GS_EARLY_CAREER
  const roleId = jobId.replace(/^gs-/, "");
  const body = {
    operationName: "GetRole",
    query:
      "query GetRole($externalSource: ExternalSourceInput!) { role(externalSource: $externalSource) { roleId jobTitle descriptionHtml } }",
    variables: { externalSource: { sourceId: roleId } },
  };
  const r = await get(GS_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://higher.gs.com",
      Referer: "https://higher.gs.com/",
      "x-higher-session-id": crypto.randomUUID(),
      "x-higher-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return htmlToText(j?.data?.role?.descriptionHtml);
}

// schema.org JobPosting JSON-LD (Radancy, Jibe, iCIMS, PageUp, Pinpoint…)
function fromJsonLd(html) {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const b of blocks) {
    const raw = b.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const d = stack.pop();
      if (!d || typeof d !== "object") continue;
      if (Array.isArray(d)) {
        stack.push(...d);
        continue;
      }
      if (d["@graph"]) stack.push(d["@graph"]);
      const t = d["@type"];
      if ((t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) && d.description)
        return htmlToText(d.description);
    }
  }
  return "";
}

async function generic(url) {
  const html = await (await get(url, { headers: { Accept: "text/html" } })).text();
  const ld = fromJsonLd(html);
  if (ld.length > 300) return ld;
  // fall back to the page body; prefer <main>/<article> when present
  const main =
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] || /<article[\s\S]*?<\/article>/i.exec(html)?.[0] || html;
  return htmlToText(main);
}

// ---------------------------------------------------------------- entry
export async function fetchDescription(job) {
  const id = String(job.id || "");
  let u = null;
  try {
    u = job.url ? new URL(job.url) : null;
  } catch {}

  const attempts = [];
  if (id.startsWith("gh-")) attempts.push(() => greenhouse(id));
  if (id.startsWith("ashby-")) attempts.push(() => ashby(id));
  if (id.startsWith("gs-")) attempts.push(() => goldman(id));
  if (u && /myworkday(jobs|site)\.com$/.test(u.host)) attempts.push(() => workday(u));
  if (u && /oraclecloud\.com$/.test(u.host)) attempts.push(() => oracle(u));
  if (u) attempts.push(() => generic(u.href));

  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text && text.length > 300) return text.slice(0, 20000);
    } catch (e) {
      console.warn(`jd fetch failed for ${id}: ${e.message}`);
    }
  }
  return "";
}
