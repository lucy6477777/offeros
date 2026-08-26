import type { JobPosting, JobWorkplaceType } from "./types";

const TRACKING_PARAMS = new Set([
  "gh_src",
  "ref",
  "referrer",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "trk",
  "trackingid",
]);

/** Normalize only parameters known to be tracking; unknown query data may be identity. */
export function normalizePostingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\?$/, "");
  } catch {
    return raw.trim();
  }
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** ATS descriptions are escaped HTML surprisingly often, so decode before stripping tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, "&")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function inferWorkplace(...values: Array<string | undefined>): JobWorkplaceType {
  const text = normalizeSearchText(values.filter(Boolean).join(" "));
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b|\bwork from home\b|\bdistributed\b/.test(text)) return "remote";
  if (/\bon site\b|\bonsite\b|\bin office\b/.test(text)) return "on-site";
  return "unknown";
}

/** Stable, non-cryptographic fingerprint for exact normalized description matches. */
export function descriptionFingerprint(description: string): string {
  let hash = 2166136261;
  for (const ch of normalizeSearchText(description)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function matchesQuery(posting: JobPosting, query: string | undefined): boolean {
  if (!query) return true;
  const haystack = normalizeSearchText(
    [posting.title, posting.company, posting.location, posting.department, posting.description]
      .filter(Boolean)
      .join(" "),
  );
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}
