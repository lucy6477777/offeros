import { z } from "zod";
import { normalizeSearchText } from "./normalize";
import type { JobPosting } from "./types";

export const JOB_SENIORITY_LEVELS = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
] as const;

export const JOB_MATCH_VERDICTS = ["strong", "possible", "review", "skip"] as const;
export const US_WORK_AUTHORIZATION_STATUSES = ["unknown", "authorized", "not-authorized"] as const;
export const US_SPONSORSHIP_NEEDS = ["unknown", "not-needed", "required"] as const;
export const JOB_SPONSORSHIP_STATES = [
  "available",
  "unavailable",
  "ambiguous",
  "not-mentioned",
] as const;
export const JOB_WORK_AUTHORIZATION_STATES = ["required", "restricted", "not-mentioned"] as const;

const matchTermSchema = z.string().trim().min(1).max(100);

export const jobEligibilityPreferencesSchema = z
  .object({
    usWorkAuthorization: z.enum(US_WORK_AUTHORIZATION_STATUSES).default("unknown"),
    sponsorshipNeed: z.enum(US_SPONSORSHIP_NEEDS).default("unknown"),
  })
  .strict();

const eligibilityEvidenceSchema = z.string().trim().min(1).max(500);

export const jobEligibilityFactsSchema = z.object({
  sponsorship: z.object({
    state: z.enum(JOB_SPONSORSHIP_STATES),
    evidence: z.array(eligibilityEvidenceSchema),
  }),
  usWorkAuthorization: z.object({
    state: z.enum(JOB_WORK_AUTHORIZATION_STATES),
    evidence: z.array(eligibilityEvidenceSchema),
  }),
});

/** User-owned deterministic rules for one saved search. Missing facts never
 * become a rejection: only explicit blockers can produce `skip`. */
export const jobMatchPreferencesSchema = z
  .object({
    prioritySkills: z.array(matchTermSchema).max(50).default([]),
    excludedKeywords: z.array(matchTermSchema).max(50).default([]),
    excludedCompanies: z.array(matchTermSchema).max(50).default([]),
    maximumSeniority: z.enum(JOB_SENIORITY_LEVELS).optional(),
    eligibility: jobEligibilityPreferencesSchema.default({}),
  })
  .strict();

export const jobMatchEvidenceSchema = z.object({
  signal: z.enum(["role", "skill", "seniority", "eligibility", "exclusion", "status"]),
  source: z.enum(["title", "company", "department", "description", "status"]),
  detail: z.string().min(1),
});

export const jobMatchAssessmentSchema = z.object({
  verdict: z.enum(JOB_MATCH_VERDICTS),
  score: z.number().int().min(0).max(100),
  inferredSeniority: z.union([z.enum(JOB_SENIORITY_LEVELS), z.literal("unknown")]),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  blockers: z.array(z.string()),
  reviewReasons: z.array(z.string()),
  evidence: z.array(jobMatchEvidenceSchema),
  eligibility: jobEligibilityFactsSchema,
});

export type JobSeniority = (typeof JOB_SENIORITY_LEVELS)[number];
export type JobMatchVerdict = (typeof JOB_MATCH_VERDICTS)[number];
export type UsWorkAuthorizationStatus = (typeof US_WORK_AUTHORIZATION_STATUSES)[number];
export type UsSponsorshipNeed = (typeof US_SPONSORSHIP_NEEDS)[number];
export type JobMatchPreferences = z.infer<typeof jobMatchPreferencesSchema>;
export type JobEligibilityPreferences = z.infer<typeof jobEligibilityPreferencesSchema>;
export type JobEligibilityFacts = z.infer<typeof jobEligibilityFactsSchema>;
export type JobMatchEvidence = z.infer<typeof jobMatchEvidenceSchema>;
export type JobMatchAssessment = z.infer<typeof jobMatchAssessmentSchema>;

const SENIORITY_RANK = new Map(JOB_SENIORITY_LEVELS.map((level, index) => [level, index]));

// Ordered from most authoritative/highest to lowest so "Senior Engineering
// Manager" is treated as manager, not senior IC.
const SENIORITY_MARKERS: ReadonlyArray<readonly [JobSeniority, RegExp]> = [
  ["executive", /\b(chief|ceo|cto|cio|cpo|cfo|coo|vice president|vp|head of)\b/],
  ["director", /\b(director)\b/],
  ["manager", /\b(manager)\b/],
  ["principal", /\b(principal)\b/],
  ["staff", /\b(staff)\b/],
  ["senior", /\b(senior|sr|lead)\b/],
  ["mid", /\b(mid|midlevel|intermediate)\b/],
  ["entry", /\b(junior|jr|entry level|new grad|graduate|associate)\b/],
  ["intern", /\b(intern|internship|co op)\b/],
];

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "or",
  "remote",
  "the",
  "to",
  "u",
  "united",
  "us",
  "usa",
  "states",
]);

const SPONSORSHIP_UNAVAILABLE_PATTERNS = [
  /\b(?:do|does|will|can)(?:\s+not|n't)\s+sponsor\b|\bcannot\s+sponsor\b/i,
  /\b(?:do|does|will|can)(?:\s+not|n't)\s+(?:provide|offer|support)\b[^.!?]{0,80}\b(?:visa|immigration|employment|sponsorship)\b/i,
  /\b(?:unable|not able)\s+to\s+(?:provide|offer|support|sponsor)\b[^.!?]{0,80}\b(?:visa|immigration|employment|sponsorship)?\b/i,
  /\bno\s+(?:visa|immigration|employment|work visa)\s+sponsorship\b/i,
  /\bno\s+sponsorship\s+(?:available|offered|provided|support)\b/i,
  /\bsponsorship\s*:\s*(?:no|not available|not offered|not provided)\b/i,
  /\bsponsorship\s+(?:is|will be)\s+not\s+(?:available|offered|provided|supported)\b/i,
  /\b(?:must|required to|need to)\s+(?:be\s+)?(?:authorized|eligible|able)\b[^.!?]{0,80}\bwithout\s+(?:the\s+need\s+for\s+)?(?:current\s+or\s+future\s+)?(?:visa|employment|employer)?\s*sponsorship\b/i,
  /\b(?:ability|authorization|eligibility)\s+to\s+work\b[^.!?]{0,80}\bwithout\s+(?:the\s+need\s+for\s+)?(?:visa|employment|employer)?\s*sponsorship\b/i,
  /\bmust\s+not\s+require\b[^.!?]{0,50}\bsponsorship\b/i,
];

const SPONSORSHIP_AVAILABLE_PATTERNS = [
  /\b(?:visa|immigration|employment|h-?1b)\s+sponsorship\s+(?:(?:is|will be)\s+)?(?:available|offered|provided|supported)\b/i,
  /\b(?:we|the company|this employer)\s+(?:will\s+)?(?:provide|offer|support|sponsor(?:s)?)\b[^.!?]{0,80}\b(?:visa|h-?1b|immigration|employment|sponsorship|qualified candidates?)\b/i,
  /\b(?:will|can)\s+sponsor\s+(?:qualified\s+)?candidates?\b/i,
];

const SPONSORSHIP_CONDITIONAL_PATTERNS = [
  /\b(?:may|might)\s+(?:provide|offer|support|sponsor)\b[^.!?]{0,80}\b(?:visa|immigration|employment|sponsorship|candidates?)\b/i,
  /\bsponsorship\b[^.!?]{0,60}\b(?:case[- ]by[- ]case|depending on|subject to)\b/i,
];

const CURRENT_US_AUTHORIZATION_PATTERNS = [
  /\b(?:must|required to|need to)\s+(?:be\s+)?(?:currently\s+)?(?:legally\s+)?(?:authorized|eligible)\s+to\s+work\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states)\b/i,
  /\b(?:current|existing)\s+(?:u\.?s\.?\s+)?work authorization\s+(?:is\s+)?required\b/i,
  /\bvalid\s+(?:u\.?s\.?\s+)?work authorization\s+(?:is\s+)?required\b/i,
  /\bmust\s+(?:have|possess)\b[^.!?]{0,40}\b(?:u\.?s\.?\s+)?work authorization\b/i,
  /\b(?:authorization|eligibility)\s+to\s+work\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states)\s+(?:is\s+)?required\b/i,
  /\b(?:authorized|eligible)\s+to\s+work\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states)\s+without\s+[^.!?]{0,40}sponsorship\b/i,
];

const RESTRICTED_US_STATUS_PATTERNS = [
  /\b(?:u\.?s\.?|united states)\s+citizens?(?:hip)?\s+(?:is\s+)?(?:required|only)\b/i,
  /\b(?:green card holders?|permanent residents?)\s+(?:are\s+)?(?:required|only)\b/i,
  /\bonly\s+(?:(?:u\.?s\.?|united states)\s+citizens?|green card holders?|permanent residents?)\b/i,
  /\b(?:(?:u\.?s\.?|united states)\s+citizens?|green card holders?|permanent residents?)\s+(?:or|and)\s+(?:(?:u\.?s\.?|united states)\s+citizens?|green card holders?|permanent residents?)\s+only\b/i,
  /\bmust\s+be\s+(?:an?\s+)?(?:u\.?s\.?|united states)\s+citizen\b/i,
];

function eligibilitySentences(description: string | undefined): string[] {
  if (!description?.trim()) return [];
  return description
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence
        .replace(/^[-*•]\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .map((sentence) => (sentence.length > 300 ? `${sentence.slice(0, 297)}…` : sentence));
}

function evidenceMatching(sentences: string[], patterns: RegExp[]): string[] {
  return sentences
    .filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
    .slice(0, 3);
}

/** Extract only statements the posting actually makes. Silence remains
 * `not-mentioned`; conditional or contradictory sponsorship language remains
 * `ambiguous` and can never become a hard rejection. */
export function extractJobEligibilityFacts(description: string | undefined): JobEligibilityFacts {
  const sentences = eligibilitySentences(description);
  const unavailable = evidenceMatching(sentences, SPONSORSHIP_UNAVAILABLE_PATTERNS);
  const available = evidenceMatching(sentences, SPONSORSHIP_AVAILABLE_PATTERNS);
  const conditional = evidenceMatching(sentences, SPONSORSHIP_CONDITIONAL_PATTERNS);

  let sponsorship: JobEligibilityFacts["sponsorship"];
  if (conditional.length > 0 || (unavailable.length > 0 && available.length > 0)) {
    sponsorship = {
      state: "ambiguous",
      evidence: [...new Set([...unavailable, ...available, ...conditional])],
    };
  } else if (unavailable.length > 0) {
    sponsorship = { state: "unavailable", evidence: unavailable };
  } else if (available.length > 0) {
    sponsorship = { state: "available", evidence: available };
  } else {
    sponsorship = { state: "not-mentioned", evidence: [] };
  }

  const restricted = evidenceMatching(sentences, RESTRICTED_US_STATUS_PATTERNS);
  const required = evidenceMatching(sentences, CURRENT_US_AUTHORIZATION_PATTERNS);
  const usWorkAuthorization: JobEligibilityFacts["usWorkAuthorization"] =
    restricted.length > 0
      ? { state: "restricted", evidence: restricted }
      : required.length > 0
        ? { state: "required", evidence: required }
        : { state: "not-mentioned", evidence: [] };

  return jobEligibilityFactsSchema.parse({ sponsorship, usWorkAuthorization });
}

function technicalText(value: string): string {
  return normalizeSearchText(
    value
      .replace(/c\+\+/gi, " cpp ")
      .replace(/c#/gi, " csharp ")
      .replace(/\.net\b/gi, " dotnet ")
      .replace(/node\.js\b/gi, " nodejs ")
      .replace(/next\.js\b/gi, " nextjs ")
      .replace(/react\.js\b/gi, " reactjs "),
  );
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = technicalText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function postingText(posting: JobPosting) {
  return {
    title: technicalText(posting.title),
    company: technicalText(posting.company),
    department: technicalText(posting.department ?? ""),
    description: technicalText(posting.description ?? ""),
  };
}

function sourceForTerm(
  text: ReturnType<typeof postingText>,
  term: string,
): "title" | "company" | "department" | "description" | undefined {
  const normalized = technicalText(term);
  if (containsPhrase(text.title, normalized)) return "title";
  if (containsPhrase(text.department, normalized)) return "department";
  if (containsPhrase(text.description, normalized)) return "description";
  if (containsPhrase(text.company, normalized)) return "company";
  return undefined;
}

export function inferJobSeniority(title: string): JobSeniority | "unknown" {
  const normalized = technicalText(title);
  return SENIORITY_MARKERS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "unknown";
}

function roleScore(
  posting: JobPosting,
  query: string,
): {
  score: number | null;
  matchedInTitle: number;
  matchedElsewhere: number;
  total: number;
} {
  const text = postingText(posting);
  const terms = [
    ...new Set(
      technicalText(query)
        .split(" ")
        .filter((term) => term && !QUERY_STOP_WORDS.has(term)),
    ),
  ];
  if (terms.length === 0) return { score: null, matchedInTitle: 0, matchedElsewhere: 0, total: 0 };

  let points = 0;
  let matchedInTitle = 0;
  let matchedElsewhere = 0;
  for (const term of terms) {
    if (containsPhrase(text.title, term)) {
      points += 1;
      matchedInTitle += 1;
    } else if (containsPhrase(text.department, term)) {
      points += 0.8;
      matchedElsewhere += 1;
    } else if (containsPhrase(text.description, term)) {
      points += 0.5;
      matchedElsewhere += 1;
    }
  }
  return {
    score: Math.round((points / terms.length) * 100),
    matchedInTitle,
    matchedElsewhere,
    total: terms.length,
  };
}

/** Rank one posting using only visible posting facts and explicit user rules.
 * The numeric score describes evidence coverage, not a prediction of hiring
 * success, and blockers always remain independently inspectable. */
export function assessJobMatch(
  posting: JobPosting,
  query: string,
  rawPreferences: JobMatchPreferences,
): JobMatchAssessment {
  const preferences = jobMatchPreferencesSchema.parse(rawPreferences);
  const text = postingText(posting);
  const blockers: string[] = [];
  const reviewReasons: string[] = [];
  const evidence: JobMatchEvidence[] = [];
  const eligibility = extractJobEligibilityFacts(posting.description);
  let eligibilityNeedsReview = false;

  function reviewEligibility(reason: string) {
    reviewReasons.push(reason);
    eligibilityNeedsReview = true;
  }

  if (posting.liveness === "closed") {
    blockers.push("Job is marked closed.");
    evidence.push({ signal: "status", source: "status", detail: "Provider status: closed" });
  } else if (posting.liveness === "unknown") {
    reviewReasons.push("Current job status is unknown.");
  }

  for (const statement of eligibility.sponsorship.evidence) {
    evidence.push({
      signal: "eligibility",
      source: "description",
      detail: `Sponsorship ${eligibility.sponsorship.state}: “${statement}”`,
    });
  }
  for (const statement of eligibility.usWorkAuthorization.evidence) {
    evidence.push({
      signal: "eligibility",
      source: "description",
      detail: `US work authorization ${eligibility.usWorkAuthorization.state}: “${statement}”`,
    });
  }

  if (preferences.eligibility.sponsorshipNeed === "required") {
    if (eligibility.sponsorship.state === "unavailable") {
      blockers.push(
        "Sponsorship conflict: you need sponsorship, and the posting explicitly says it is unavailable.",
      );
    } else if (eligibility.sponsorship.state === "ambiguous") {
      reviewEligibility("Sponsorship language is conditional or conflicting; review the evidence.");
    } else if (eligibility.sponsorship.state === "not-mentioned") {
      reviewEligibility("Sponsorship is not mentioned; verify it before applying.");
    }
  } else if (
    preferences.eligibility.sponsorshipNeed === "unknown" &&
    ["unavailable", "ambiguous"].includes(eligibility.sponsorship.state)
  ) {
    reviewEligibility("Set whether you need sponsorship to resolve this posting's policy.");
  }

  if (eligibility.usWorkAuthorization.state === "restricted") {
    reviewEligibility(
      "The posting names a specific citizenship or residency restriction; verify it manually.",
    );
  } else if (eligibility.usWorkAuthorization.state === "required") {
    if (preferences.eligibility.usWorkAuthorization === "not-authorized") {
      if (eligibility.sponsorship.state === "available") {
        reviewEligibility(
          "The posting requires current US work authorization but also mentions sponsorship; verify the apparent conflict.",
        );
      } else {
        blockers.push(
          "Work authorization conflict: you are not currently authorized to work in the US, and the posting explicitly requires current authorization.",
        );
      }
    } else if (preferences.eligibility.usWorkAuthorization === "unknown") {
      reviewEligibility(
        "Set your current US work authorization to resolve this explicit requirement.",
      );
    }
  } else if (preferences.eligibility.usWorkAuthorization === "not-authorized") {
    reviewEligibility("Current US work authorization is not mentioned; verify it before applying.");
  }

  for (const company of uniqueTerms(preferences.excludedCompanies)) {
    if (containsPhrase(text.company, technicalText(company))) {
      blockers.push(`Excluded company matched: ${company}.`);
      evidence.push({
        signal: "exclusion",
        source: "company",
        detail: `Company contains “${company}”`,
      });
    }
  }

  for (const keyword of uniqueTerms(preferences.excludedKeywords)) {
    const source = sourceForTerm(text, keyword);
    if (source) {
      blockers.push(`Excluded keyword matched: ${keyword}.`);
      evidence.push({
        signal: "exclusion",
        source,
        detail: `“${keyword}” appears in ${source}`,
      });
    }
  }

  const inferredSeniority = inferJobSeniority(posting.title);
  if (preferences.maximumSeniority) {
    if (inferredSeniority === "unknown") {
      reviewReasons.push("Seniority is not explicit in the job title.");
    } else {
      evidence.push({
        signal: "seniority",
        source: "title",
        detail: `Title indicates ${inferredSeniority} seniority`,
      });
      if (
        SENIORITY_RANK.get(inferredSeniority)! > SENIORITY_RANK.get(preferences.maximumSeniority)!
      ) {
        blockers.push(
          `Title seniority (${inferredSeniority}) exceeds the ${preferences.maximumSeniority} ceiling.`,
        );
      }
    }
  }

  const role = roleScore(posting, query);
  if (role.score !== null) {
    evidence.push({
      signal: "role",
      source: role.matchedInTitle > 0 ? "title" : "description",
      detail: `${role.matchedInTitle}/${role.total} search terms in title${
        role.matchedElsewhere > 0 ? `; ${role.matchedElsewhere} elsewhere` : ""
      }`,
    });
  }

  const prioritySkills = uniqueTerms(preferences.prioritySkills);
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const skill of prioritySkills) {
    const source = sourceForTerm(text, skill);
    if (source) {
      matchedSkills.push(skill);
      evidence.push({ signal: "skill", source, detail: `Priority skill found: ${skill}` });
    } else {
      missingSkills.push(skill);
    }
  }
  if (prioritySkills.length > 0 && !posting.description) {
    reviewReasons.push("Job description is missing, so skill evidence is incomplete.");
  }

  const skillScore =
    prioritySkills.length > 0
      ? Math.round((matchedSkills.length / prioritySkills.length) * 100)
      : null;
  let score = role.score ?? skillScore ?? 0;
  if (role.score !== null && skillScore !== null) {
    // A missing description lowers the skill weight rather than pretending
    // unobserved skills are absent.
    const skillWeight = posting.description ? 0.4 : 0.2;
    score = Math.round(role.score * (1 - skillWeight) + skillScore * skillWeight);
  }

  let verdict: JobMatchVerdict;
  if (blockers.length > 0) verdict = "skip";
  else if (eligibilityNeedsReview) verdict = "review";
  else if (score >= 75) verdict = "strong";
  else if (score >= 45) verdict = "possible";
  else verdict = "review";

  return jobMatchAssessmentSchema.parse({
    verdict,
    score,
    inferredSeniority,
    matchedSkills,
    missingSkills,
    blockers,
    reviewReasons,
    evidence,
    eligibility,
  });
}
