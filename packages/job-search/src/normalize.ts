import type { JobPosting, JobSearchCriteria, JobWorkplaceType } from "./types";

const TRACKING_PARAMS = new Set([
  "gh_src",
  "ref",
  "referrer",
  "source",
  "fbclid",
  "gclid",
  "igshid",
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

const US_STATE_NAMES = new Set(
  [
    "alabama",
    "alaska",
    "arizona",
    "arkansas",
    "california",
    "colorado",
    "connecticut",
    "delaware",
    "district of columbia",
    "florida",
    "hawaii",
    "idaho",
    "illinois",
    "indiana",
    "iowa",
    "kansas",
    "kentucky",
    "louisiana",
    "maine",
    "maryland",
    "massachusetts",
    "michigan",
    "minnesota",
    "mississippi",
    "missouri",
    "montana",
    "nebraska",
    "nevada",
    "new hampshire",
    "new jersey",
    "new mexico",
    "new york",
    "north carolina",
    "north dakota",
    "ohio",
    "oklahoma",
    "oregon",
    "pennsylvania",
    "rhode island",
    "south carolina",
    "south dakota",
    "tennessee",
    "texas",
    "utah",
    "vermont",
    "virginia",
    "washington",
    "west virginia",
    "wisconsin",
    "wyoming",
  ].map(normalizeSearchText),
);

const US_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

// Conservative markers only: ambiguous regions such as "Americas" or "Worldwide"
// remain unknown instead of being confidently accepted or rejected.
const NON_US_LOCATION_MARKERS = [
  "africa",
  "apac",
  "argentina",
  "australia",
  "austria",
  "brazil",
  "canada",
  "chile",
  "china",
  "colombia",
  "denmark",
  "emea",
  "estonia",
  "europe",
  "european union",
  "france",
  "germany",
  "hungary",
  "india",
  "indonesia",
  "ireland",
  "israel",
  "italy",
  "japan",
  "malaysia",
  "mexico",
  "netherlands",
  "new zealand",
  "norway",
  "philippines",
  "poland",
  "portugal",
  "romania",
  "singapore",
  "south africa",
  "spain",
  "sweden",
  "switzerland",
  "thailand",
  "uae",
  "united arab emirates",
  "united kingdom",
  "vietnam",
] as const;

type CountryEvidence = "us" | "non-us" | "unknown";
export type LocationEligibilityReason =
  "matched" | "explicit-non-us" | "not-remote" | "unknown-included" | "unknown-excluded";

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function countryEvidence(posting: JobPosting): CountryEvidence {
  if (posting.countryCode) return posting.countryCode.toUpperCase() === "US" ? "us" : "non-us";
  if (!posting.location) return "unknown";
  const normalized = normalizeSearchText(posting.location);
  if (
    ["united states", "united states of america", "usa", "u s a", "u s"].some((value) =>
      containsPhrase(normalized, value),
    ) ||
    [...US_STATE_NAMES].some((value) => containsPhrase(normalized, value))
  ) {
    return "us";
  }
  const rawTokens = posting.location.split(/[^A-Za-z]+/).filter(Boolean);
  if (rawTokens.some((token) => token === token.toUpperCase() && US_STATE_CODES.has(token))) {
    return "us";
  }
  if (NON_US_LOCATION_MARKERS.some((value) => containsPhrase(normalized, value))) return "non-us";
  return "unknown";
}

/**
 * Evaluate one posting against the location/workplace guard without inventing
 * missing facts. Unknown eligibility is included unless the caller opts into
 * strict exclusion.
 */
export function locationEligibilityReason(
  posting: JobPosting,
  criteria: JobSearchCriteria,
): LocationEligibilityReason {
  const scope = criteria.locationScope ?? "any";
  if (scope === "any") return "matched";

  const country = countryEvidence(posting);
  if (country === "non-us") return "explicit-non-us";
  if (scope === "remote-us" && posting.workplace !== "remote") {
    if (posting.workplace !== "unknown") return "not-remote";
    return criteria.unknownLocationPolicy === "exclude" ? "unknown-excluded" : "unknown-included";
  }
  if (country === "us") return "matched";
  return criteria.unknownLocationPolicy === "exclude" ? "unknown-excluded" : "unknown-included";
}

export function matchesLocationCriteria(posting: JobPosting, criteria: JobSearchCriteria): boolean {
  const reason = locationEligibilityReason(posting, criteria);
  return reason === "matched" || reason === "unknown-included";
}
