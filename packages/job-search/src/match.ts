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
export const JOB_MATCH_SKILL_SOURCES = ["manual", "profile", "combined"] as const;
export const US_WORK_AUTHORIZATION_STATUSES = ["unknown", "authorized", "not-authorized"] as const;
export const US_SPONSORSHIP_NEEDS = ["unknown", "not-needed", "required"] as const;
export const JOB_SPONSORSHIP_STATES = [
  "available",
  "unavailable",
  "ambiguous",
  "not-mentioned",
] as const;
export const JOB_WORK_AUTHORIZATION_STATES = ["required", "restricted", "not-mentioned"] as const;
export const JOB_SALARY_STATES = [
  "annual-usd",
  "ambiguous",
  "unsupported",
  "not-mentioned",
] as const;
export const JOB_SALARY_BOUNDS = [
  "range",
  "exact",
  "minimum-only",
  "maximum-only",
  "unknown",
] as const;
export const JOB_EXPERIENCE_STATES = ["explicit-minimum", "ambiguous", "not-mentioned"] as const;
export const JOB_RULE_DECISION_STATUSES = [
  "not-configured",
  "satisfied",
  "review",
  "blocker",
] as const;

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

const jobFactEvidenceSchema = z.string().trim().min(1).max(500);
const nonnegativeFactNumberSchema = z.number().finite().nonnegative();
const factEvidenceObject = { evidence: z.array(jobFactEvidenceSchema) };

const annualSalaryRangeFactsSchema = z
  .object({
    state: z.literal("annual-usd"),
    bound: z.literal("range"),
    minimum: nonnegativeFactNumberSchema,
    maximum: nonnegativeFactNumberSchema,
    ...factEvidenceObject,
  })
  .strict()
  .refine((facts) => facts.maximum >= facts.minimum, {
    message: "salary range maximum must be greater than or equal to minimum",
    path: ["maximum"],
  });

const annualSalaryExactFactsSchema = z
  .object({
    state: z.literal("annual-usd"),
    bound: z.literal("exact"),
    minimum: nonnegativeFactNumberSchema,
    maximum: nonnegativeFactNumberSchema,
    ...factEvidenceObject,
  })
  .strict()
  .refine((facts) => facts.maximum === facts.minimum, {
    message: "exact salary minimum and maximum must match",
    path: ["maximum"],
  });

const annualSalaryMinimumFactsSchema = z
  .object({
    state: z.literal("annual-usd"),
    bound: z.literal("minimum-only"),
    minimum: nonnegativeFactNumberSchema,
    ...factEvidenceObject,
  })
  .strict();

const annualSalaryMaximumFactsSchema = z
  .object({
    state: z.literal("annual-usd"),
    bound: z.literal("maximum-only"),
    maximum: nonnegativeFactNumberSchema,
    ...factEvidenceObject,
  })
  .strict();

const ambiguousSalaryFactsSchema = z
  .object({ state: z.literal("ambiguous"), bound: z.literal("unknown"), ...factEvidenceObject })
  .strict();
const unsupportedSalaryFactsSchema = z
  .object({ state: z.literal("unsupported"), bound: z.literal("unknown"), ...factEvidenceObject })
  .strict();
const unmentionedSalaryFactsSchema = z
  .object({ state: z.literal("not-mentioned"), bound: z.literal("unknown"), ...factEvidenceObject })
  .strict();

export const jobSalaryFactsSchema = z.union([
  annualSalaryRangeFactsSchema,
  annualSalaryExactFactsSchema,
  annualSalaryMinimumFactsSchema,
  annualSalaryMaximumFactsSchema,
  ambiguousSalaryFactsSchema,
  unsupportedSalaryFactsSchema,
  unmentionedSalaryFactsSchema,
]);

const explicitExperienceFactsSchema = z
  .object({
    state: z.literal("explicit-minimum"),
    minimumYears: nonnegativeFactNumberSchema,
    maximumYears: nonnegativeFactNumberSchema.optional(),
    ...factEvidenceObject,
  })
  .strict()
  .refine((facts) => facts.maximumYears === undefined || facts.maximumYears >= facts.minimumYears, {
    message: "experience maximum must be greater than or equal to minimum",
    path: ["maximumYears"],
  });

export const jobExperienceFactsSchema = z.union([
  explicitExperienceFactsSchema,
  z.object({ state: z.literal("ambiguous"), ...factEvidenceObject }).strict(),
  z.object({ state: z.literal("not-mentioned"), ...factEvidenceObject }).strict(),
]);

export const jobRuleDecisionSchema = z.union([
  z.object({ status: z.literal("not-configured") }).strict(),
  z.object({ status: z.literal("satisfied") }).strict(),
  z.object({ status: z.literal("review"), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal("blocker"), reason: z.string().min(1) }).strict(),
]);

/** User-owned deterministic rules for one saved search. Missing facts never
 * become a rejection: only explicit blockers can produce `skip`. */
export const jobMatchPreferencesSchema = z
  .object({
    skillSource: z.enum(JOB_MATCH_SKILL_SOURCES).default("manual"),
    prioritySkills: z.array(matchTermSchema).max(50).default([]),
    excludedKeywords: z.array(matchTermSchema).max(50).default([]),
    excludedCompanies: z.array(matchTermSchema).max(50).default([]),
    maximumSeniority: z.enum(JOB_SENIORITY_LEVELS).optional(),
    minimumAnnualSalaryUsd: z.number().int().min(1_000).max(10_000_000).optional(),
    maximumRequiredExperienceYears: z.number().int().min(0).max(80).optional(),
    eligibility: jobEligibilityPreferencesSchema.default({}),
  })
  .strict();

export const jobMatchEvidenceSchema = z.object({
  signal: z.enum([
    "role",
    "skill",
    "seniority",
    "salary",
    "experience",
    "eligibility",
    "exclusion",
    "status",
  ]),
  source: z.enum(["title", "company", "department", "description", "salary", "status"]),
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
  salary: jobSalaryFactsSchema,
  experience: jobExperienceFactsSchema,
});

export type JobSeniority = (typeof JOB_SENIORITY_LEVELS)[number];
export type JobMatchVerdict = (typeof JOB_MATCH_VERDICTS)[number];
export type JobMatchSkillSource = (typeof JOB_MATCH_SKILL_SOURCES)[number];
export type UsWorkAuthorizationStatus = (typeof US_WORK_AUTHORIZATION_STATUSES)[number];
export type UsSponsorshipNeed = (typeof US_SPONSORSHIP_NEEDS)[number];
export type JobMatchPreferences = z.infer<typeof jobMatchPreferencesSchema>;
export type JobMatchPreferencesInput = z.input<typeof jobMatchPreferencesSchema>;
export type JobEligibilityPreferences = z.infer<typeof jobEligibilityPreferencesSchema>;
export type JobEligibilityFacts = z.infer<typeof jobEligibilityFactsSchema>;
export type JobSalaryFacts = z.infer<typeof jobSalaryFactsSchema>;
export type JobExperienceFacts = z.infer<typeof jobExperienceFactsSchema>;
export type JobRuleDecision = z.infer<typeof jobRuleDecisionSchema>;
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

const ANNUAL_SALARY_PATTERN =
  /\b(?:annual(?:ly)?|yearly|per\s+(?:calendar\s+)?year|per\s+annum|a\s+year)\b|\/(?:year|yr)\b/i;
const UNSUPPORTED_SALARY_INTERVAL_PATTERN =
  /\b(?:hourly|daily|weekly|monthly|per\s+(?:hour|day|week|month))\b|\/(?:hr|hour|day|week|month)\b/i;
const NON_USD_CURRENCY_PATTERN = /\b(?:AED|AUD|CAD|CHF|CNY|EUR|GBP|HKD|INR|JPY|NZD|SGD)\b|[€£¥₹]/i;
const AMBIGUOUS_COMPENSATION_PATTERN =
  /\b(?:OTE|on[- ]target earnings|total (?:cash )?comp(?:ensation)?|equity|stock options?|RSUs?|bonuses?|commissions?)\b/i;
const SALARY_CONTEXT_PATTERN =
  /\b(?:salary|base\s+pay|pay\s+range|annual\s+pay|cash\s+compensation|base\s+compensation)\b/i;
const SALARY_NUMBER_PATTERN =
  /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*[kKmM]\b|\d{4,8}(?:\.\d+)?/g;

function clippedFactEvidence(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}…` : normalized;
}

function factSentences(description: string | undefined): string[] {
  if (!description?.trim()) return [];
  return description
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((sentence) => clippedFactEvidence(sentence.replace(/^[-*•]\s*/, "")))
    .filter(Boolean);
}

function salaryDescriptionEvidence(description: string | undefined): string[] {
  return factSentences(description)
    .filter(
      (sentence) =>
        SALARY_CONTEXT_PATTERN.test(sentence) &&
        (/\b(?:USD|US\$)\b/i.test(sentence) || /[$€£¥₹]/.test(sentence)),
    )
    .slice(0, 3);
}

function salaryNumber(value: string): number {
  const normalized = value.replace(/,/g, "").replace(/\s+/g, "").toLowerCase();
  const multiplier = normalized.endsWith("k") ? 1_000 : normalized.endsWith("m") ? 1_000_000 : 1;
  return Number.parseFloat(normalized.replace(/[km]$/, "")) * multiplier;
}

function salaryNumbers(value: string): Array<{ value: number; index: number; end: number }> {
  return [...value.matchAll(SALARY_NUMBER_PATTERN)]
    .map((match) => ({
      value: salaryNumber(match[0]),
      index: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    }))
    .filter((match) => {
      if (!Number.isFinite(match.value) || match.value < 1_000) return false;
      if (/[kKmM,]/.test(match.raw) || match.value >= 10_000) return true;
      const prefix = value.slice(Math.max(0, match.index - 6), match.index);
      return /(?:USD\s*|US\$\s*|\$\s*)$/i.test(prefix);
    })
    .map(({ value: amount, index, end }) => ({ value: amount, index, end }));
}

function parseSalaryCandidate(
  value: string | undefined,
  countryCode: string | undefined,
): JobSalaryFacts {
  if (!value?.trim()) {
    return jobSalaryFactsSchema.parse({
      state: "not-mentioned",
      bound: "unknown",
      evidence: [],
    });
  }

  const text = clippedFactEvidence(value);
  const evidence = [text];
  if (AMBIGUOUS_COMPENSATION_PATTERN.test(text)) {
    return jobSalaryFactsSchema.parse({ state: "ambiguous", bound: "unknown", evidence });
  }
  if (
    NON_USD_CURRENCY_PATTERN.test(text) ||
    UNSUPPORTED_SALARY_INTERVAL_PATTERN.test(text) ||
    !ANNUAL_SALARY_PATTERN.test(text)
  ) {
    return jobSalaryFactsSchema.parse({ state: "unsupported", bound: "unknown", evidence });
  }

  const hasExplicitUsd = /\bUSD\b|US\$/i.test(text);
  const textWithoutUsDollar = text.replace(/US\$/gi, "");
  const hasBareDollar = textWithoutUsDollar.includes("$");
  if (!hasExplicitUsd && (!hasBareDollar || countryCode?.toUpperCase() !== "US")) {
    return jobSalaryFactsSchema.parse({ state: "unsupported", bound: "unknown", evidence });
  }

  const amounts = salaryNumbers(text);
  if (amounts.length === 0) {
    return jobSalaryFactsSchema.parse({ state: "unsupported", bound: "unknown", evidence });
  }
  if (amounts.length > 2) {
    return jobSalaryFactsSchema.parse({ state: "ambiguous", bound: "unknown", evidence });
  }

  if (amounts.length === 2) {
    const separator = text.slice(amounts[0]!.end, amounts[1]!.index);
    if (!/^\s*(?:-|–|—|to|through)\s*(?:USD\s*|US\$\s*|\$\s*)?$/i.test(separator)) {
      return jobSalaryFactsSchema.parse({ state: "ambiguous", bound: "unknown", evidence });
    }
    if (amounts[0]!.value > amounts[1]!.value) {
      return jobSalaryFactsSchema.parse({ state: "ambiguous", bound: "unknown", evidence });
    }
    return jobSalaryFactsSchema.parse({
      state: "annual-usd",
      bound: "range",
      minimum: amounts[0]!.value,
      maximum: amounts[1]!.value,
      evidence,
    });
  }

  const amount = amounts[0]!.value;
  if (/\b(?:at least|minimum(?: of)?|starting at|from)\b/i.test(text)) {
    return jobSalaryFactsSchema.parse({
      state: "annual-usd",
      bound: "minimum-only",
      minimum: amount,
      evidence,
    });
  }
  if (/\b(?:up to|maximum(?: of)?|not to exceed|no more than)\b/i.test(text)) {
    return jobSalaryFactsSchema.parse({
      state: "annual-usd",
      bound: "maximum-only",
      maximum: amount,
      evidence,
    });
  }
  return jobSalaryFactsSchema.parse({
    state: "annual-usd",
    bound: "exact",
    minimum: amount,
    maximum: amount,
    evidence,
  });
}

function sameAnnualSalaryFact(
  left: Extract<JobSalaryFacts, { state: "annual-usd" }>,
  right: Extract<JobSalaryFacts, { state: "annual-usd" }>,
): boolean {
  if (left.bound !== right.bound) return false;
  if (left.bound === "range" && right.bound === "range") {
    return left.minimum === right.minimum && left.maximum === right.maximum;
  }
  if (left.bound === "exact" && right.bound === "exact") {
    return left.minimum === right.minimum && left.maximum === right.maximum;
  }
  if (left.bound === "minimum-only" && right.bound === "minimum-only") {
    return left.minimum === right.minimum;
  }
  if (left.bound === "maximum-only" && right.bound === "maximum-only") {
    return left.maximum === right.maximum;
  }
  return false;
}

/** Extract a conservative annual-USD cash/base salary fact. The normalized
 * salary field is preferred, but a strict annual salary sentence in the
 * description can complete an otherwise interval-less field. Conflicting
 * annual facts stay ambiguous. */
export function extractJobSalaryFacts(posting: JobPosting): JobSalaryFacts {
  const rawCandidates = [
    ...(posting.salary?.trim() ? [posting.salary] : []),
    ...salaryDescriptionEvidence(posting.description),
  ];
  if (rawCandidates.length === 0) {
    return jobSalaryFactsSchema.parse({
      state: "not-mentioned",
      bound: "unknown",
      evidence: [],
    });
  }

  const parsed = rawCandidates.map((candidate) =>
    parseSalaryCandidate(candidate, posting.countryCode),
  );
  const annualFacts = parsed.filter(
    (facts): facts is Extract<JobSalaryFacts, { state: "annual-usd" }> =>
      facts.state === "annual-usd",
  );
  if (annualFacts.length > 0) {
    const first = annualFacts[0]!;
    if (annualFacts.some((facts) => !sameAnnualSalaryFact(first, facts))) {
      return jobSalaryFactsSchema.parse({
        state: "ambiguous",
        bound: "unknown",
        evidence: [...new Set(annualFacts.flatMap((facts) => facts.evidence))].slice(0, 3),
      });
    }
    return jobSalaryFactsSchema.parse({
      ...first,
      evidence: [...new Set(annualFacts.flatMap((facts) => facts.evidence))].slice(0, 3),
    });
  }

  const ambiguousEvidence = parsed
    .filter((facts) => facts.state === "ambiguous")
    .flatMap((facts) => facts.evidence);
  if (ambiguousEvidence.length > 0) {
    return jobSalaryFactsSchema.parse({
      state: "ambiguous",
      bound: "unknown",
      evidence: [...new Set(ambiguousEvidence)].slice(0, 3),
    });
  }
  return jobSalaryFactsSchema.parse({
    state: "unsupported",
    bound: "unknown",
    evidence: [...new Set(parsed.flatMap((facts) => facts.evidence))].slice(0, 3),
  });
}

const PREFERRED_EXPERIENCE_PATTERN =
  /\b(?:preferred|preference|nice[- ]to[- ]have|desirable|a plus|bonus qualification)\b/i;
const EQUIVALENT_EXPERIENCE_PATTERN =
  /\b(?:experience|years?)\b[^.;]{0,80}\bor equivalent\b|\bor equivalent\b[^.;]{0,80}\bexperience\b/i;
const EXPERIENCE_EDUCATION_ALTERNATIVE_PATTERN =
  /\bexperience\b[^.;]{0,80}\bor\b[^.;]{0,80}\b(?:bachelor(?:[’']s)?|master(?:[’']s)?|ph\.?d\.?|degree|education)\b|\b(?:bachelor(?:[’']s)?|master(?:[’']s)?|ph\.?d\.?|degree|education)\b[^.;]{0,80}\bor\b[^.;]{0,80}\bexperience\b/i;
const COMPANY_HISTORY_PATTERN =
  /\b(?:company|organization|business|firm|team|we)\s+(?:has|have|brings?|offers?|possesses?)\b[^.;]{0,60}\b\d+(?:\.\d+)?\s*\+?\s*years?\b/i;
const ALTERNATIVE_EXPERIENCE_PATTERN =
  /\b\d+(?:\.\d+)?(?:\s*\+|\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?\s*years?\b[^.;]{0,50}\bor\b[^.;]{0,50}\b\d+(?:\.\d+)?(?:\s*\+|\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?\s*years?\b[^.;]{0,50}\bexperience\b/i;
const NUMERIC_EXPERIENCE_MENTION_PATTERN =
  /\b\d+(?:\.\d+)?(?:\s*\+|\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?)?\s*years?\b[^,;:.]{0,60}\bexperience\b/i;
const EXPERIENCE_RANGE_PATTERN =
  /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*years?[’']?\s*(?:of\s+)?([^,;:.]{0,55}?)experience\b/gi;
const EXPERIENCE_PLUS_PATTERN =
  /(\d+(?:\.\d+)?)\s*\+\s*years?[’']?\s*(?:of\s+)?([^,;:.]{0,55}?)experience\b/gi;
const EXPERIENCE_MINIMUM_PATTERN =
  /\b(?:at least|(?:a\s+)?minimum(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*years?[’']?\s*(?:of\s+)?([^,;:.]{0,55}?)experience\b/gi;
const EXPERIENCE_MAXIMUM_PATTERN =
  /\b(?:up to|no more than|maximum(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*years?[’']?\s*(?:of\s+)?([^,;:.]{0,55}?)experience\b/gi;
const GENERAL_EXPERIENCE_MODIFIERS = new Set([
  "applicable",
  "commercial",
  "development",
  "engineering",
  "full",
  "general",
  "hands",
  "industry",
  "on",
  "overall",
  "prior",
  "professional",
  "related",
  "relevant",
  "software",
  "time",
  "work",
]);

function isGeneralExperience(modifiers: string, suffix: string): boolean {
  const modifierWords = normalizeSearchText(modifiers).split(" ").filter(Boolean);
  if (modifierWords.some((word) => !GENERAL_EXPERIENCE_MODIFIERS.has(word))) return false;
  const normalizedSuffix = suffix.trim();
  if (/^[.!?;:,”’')\]-]*$/.test(normalizedSuffix)) return true;
  return /^(?:(?:(?:is|are|will be|must be)\s+)?(?:required|needed|mandatory|necessary)(?:\s+for\s+(?:this|the)\s+(?:role|position|job))?|for\s+(?:this|the)\s+(?:role|position|job))[.!?;:,”’')\]-]*$/i.test(
    normalizedSuffix,
  );
}

function isCompanyHistory(sentence: string, companyName: string | undefined): boolean {
  if (COMPANY_HISTORY_PATTERN.test(sentence)) return true;
  const subject = sentence.match(
    /^(.{1,60}?)\s+(?:has|brings?|offers?|possesses?)\b[^.;]{0,80}\b\d+(?:\.\d+)?\s*\+?\s*years?\b[^.;]{0,60}\bexperience\b/i,
  )?.[1];
  if (!subject) return false;
  if (/\b(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co)\.?$/i.test(subject)) return true;
  if (!companyName?.trim()) return false;
  const normalizedSubject = normalizeSearchText(subject);
  const normalizedCompany = normalizeSearchText(companyName);
  return (
    normalizedSubject === normalizedCompany ||
    normalizedCompany.startsWith(`${normalizedSubject} `) ||
    normalizedSubject.startsWith(`${normalizedCompany} `)
  );
}

type ExperienceCandidate = {
  minimumYears: number;
  maximumYears?: number;
  evidence: string;
};

/** Extract only general, explicit minimum-experience requirements. A clear
 * general minimum remains usable when unrelated preferred or technology tenure
 * is also present; true alternatives or contradictory bounds remain ambiguous. */
export function extractJobExperienceFacts(
  description: string | undefined,
  context: { companyName?: string } = {},
): JobExperienceFacts {
  const sentences = factSentences(description).filter((sentence) =>
    /\bexperience\b/i.test(sentence),
  );
  if (sentences.length === 0) {
    return jobExperienceFactsSchema.parse({ state: "not-mentioned", evidence: [] });
  }

  const hardAmbiguousEvidence: string[] = [];
  const nonComparableEvidence: string[] = [];
  const candidates: ExperienceCandidate[] = [];
  const upperBounds: Array<{ maximumYears: number; evidence: string }> = [];

  for (const sentence of sentences) {
    if (isCompanyHistory(sentence, context.companyName)) continue;
    const hasNumericExperience = NUMERIC_EXPERIENCE_MENTION_PATTERN.test(sentence);
    if (
      EQUIVALENT_EXPERIENCE_PATTERN.test(sentence) ||
      EXPERIENCE_EDUCATION_ALTERNATIVE_PATTERN.test(sentence) ||
      ALTERNATIVE_EXPERIENCE_PATTERN.test(sentence)
    ) {
      hardAmbiguousEvidence.push(sentence);
      continue;
    }
    if (PREFERRED_EXPERIENCE_PATTERN.test(sentence)) {
      if (hasNumericExperience) nonComparableEvidence.push(sentence);
      continue;
    }

    for (const match of sentence.matchAll(EXPERIENCE_RANGE_PATTERN)) {
      const minimumYears = Number(match[1]);
      const maximumYears = Number(match[2]);
      const suffix = sentence.slice((match.index ?? 0) + match[0].length);
      if (!isGeneralExperience(match[3] ?? "", suffix)) {
        nonComparableEvidence.push(sentence);
        continue;
      }
      if (minimumYears > maximumYears) {
        hardAmbiguousEvidence.push(sentence);
      } else {
        candidates.push({ minimumYears, maximumYears, evidence: sentence });
      }
    }
    for (const pattern of [EXPERIENCE_PLUS_PATTERN, EXPERIENCE_MINIMUM_PATTERN]) {
      for (const match of sentence.matchAll(pattern)) {
        const suffix = sentence.slice((match.index ?? 0) + match[0].length);
        if (!isGeneralExperience(match[2] ?? "", suffix)) {
          nonComparableEvidence.push(sentence);
          continue;
        }
        candidates.push({ minimumYears: Number(match[1]), evidence: sentence });
      }
    }
    for (const match of sentence.matchAll(EXPERIENCE_MAXIMUM_PATTERN)) {
      const suffix = sentence.slice((match.index ?? 0) + match[0].length);
      if (!isGeneralExperience(match[2] ?? "", suffix)) {
        nonComparableEvidence.push(sentence);
        continue;
      }
      upperBounds.push({ maximumYears: Number(match[1]), evidence: sentence });
      nonComparableEvidence.push(sentence);
    }
  }

  const highestMinimum = candidates.reduce<ExperienceCandidate | undefined>(
    (highest, candidate) =>
      !highest || candidate.minimumYears > highest.minimumYears ? candidate : highest,
    undefined,
  );
  if (
    highestMinimum &&
    upperBounds.some((upperBound) => upperBound.maximumYears < highestMinimum.minimumYears)
  ) {
    hardAmbiguousEvidence.push(
      highestMinimum.evidence,
      ...upperBounds
        .filter((upperBound) => upperBound.maximumYears < highestMinimum.minimumYears)
        .map((upperBound) => upperBound.evidence),
    );
  }
  if (hardAmbiguousEvidence.length > 0) {
    return jobExperienceFactsSchema.parse({
      state: "ambiguous",
      evidence: [...new Set(hardAmbiguousEvidence)].slice(0, 3),
    });
  }
  if (highestMinimum) {
    return jobExperienceFactsSchema.parse({
      state: "explicit-minimum",
      minimumYears: highestMinimum.minimumYears,
      ...(highestMinimum.maximumYears === undefined
        ? {}
        : { maximumYears: highestMinimum.maximumYears }),
      evidence: [...new Set(candidates.map((candidate) => candidate.evidence))].slice(0, 3),
    });
  }
  if (nonComparableEvidence.length > 0) {
    return jobExperienceFactsSchema.parse({
      state: "ambiguous",
      evidence: [...new Set(nonComparableEvidence)].slice(0, 3),
    });
  }
  return jobExperienceFactsSchema.parse({ state: "not-mentioned", evidence: [] });
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

function cleanTerms(values: readonly unknown[], limit = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const displayValue = value.trim();
    if (displayValue.length > 100) continue;
    const normalized = technicalText(displayValue);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(displayValue);
    if (result.length >= limit) break;
  }
  return result;
}

function uniqueTerms(values: string[]): string[] {
  return cleanTerms(values);
}

export type ResolvedJobMatchSkills = {
  source: JobMatchSkillSource;
  skills: string[];
  manualSkills: string[];
  profileSkills: string[];
  profileMissing: boolean;
};

/** Resolve the live skill set used by deterministic matching. Profile skills
 * are runtime context and are never copied into the saved-search preferences. */
export function resolveJobMatchSkills(
  preferences: Pick<JobMatchPreferences, "skillSource" | "prioritySkills">,
  rawProfileSkills: readonly unknown[] = [],
): ResolvedJobMatchSkills {
  const source = preferences.skillSource;
  const manualSkills = cleanTerms(preferences.prioritySkills, 50);
  const profileSkills = cleanTerms(rawProfileSkills, 50);
  const selectedSkills =
    source === "manual"
      ? manualSkills
      : source === "profile"
        ? profileSkills
        : cleanTerms([...manualSkills, ...profileSkills], 50);

  return {
    source,
    skills: selectedSkills,
    manualSkills,
    profileSkills,
    profileMissing: source !== "manual" && profileSkills.length === 0,
  };
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

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatYears(value: number): string {
  return `${value} ${value === 1 ? "year" : "years"}`;
}

/** Evaluate one already-extracted salary fact without reading or mutating any
 * posting state. Both the Web UI and the aggregate assessment can use this
 * single decision contract. */
export function evaluateJobSalaryRule(
  salary: JobSalaryFacts,
  minimumAnnualSalaryUsd: number | undefined,
): JobRuleDecision {
  if (minimumAnnualSalaryUsd === undefined) {
    return { status: "not-configured" };
  }
  const target = minimumAnnualSalaryUsd;
  if (salary.state === "not-mentioned") {
    return {
      status: "review",
      reason: `Annual salary is not explicitly stated; verify it against your ${formatUsd(target)} minimum.`,
    };
  }
  if (salary.state === "unsupported") {
    return {
      status: "review",
      reason: `Salary is listed but is not a supported explicit annual USD cash/base amount; verify it against your ${formatUsd(target)} minimum.`,
    };
  }
  if (salary.state === "ambiguous") {
    return {
      status: "review",
      reason: `Salary or compensation is ambiguous; verify the annual USD cash/base amount against your ${formatUsd(target)} minimum.`,
    };
  }

  if (
    (salary.bound === "range" || salary.bound === "exact" || salary.bound === "maximum-only") &&
    salary.maximum < target
  ) {
    return {
      status: "blocker",
      reason: `Annual salary maximum (${formatUsd(salary.maximum)}) is below your minimum (${formatUsd(target)}).`,
    };
  }
  if (
    (salary.bound === "range" || salary.bound === "exact" || salary.bound === "minimum-only") &&
    salary.minimum >= target
  ) {
    return { status: "satisfied" };
  }
  if (salary.bound === "range") {
    return {
      status: "review",
      reason: `Annual salary range (${formatUsd(salary.minimum)}–${formatUsd(salary.maximum)}) crosses your ${formatUsd(target)} minimum; review the offer details.`,
    };
  }
  if (salary.bound === "minimum-only") {
    return {
      status: "review",
      reason: `Annual salary is listed as at least ${formatUsd(salary.minimum)}; its unknown upper bound may or may not meet your ${formatUsd(target)} minimum.`,
    };
  }
  return {
    status: "review",
    reason: `Annual salary is listed up to ${formatUsd(salary.maximum)}; verify that the offer can meet your ${formatUsd(target)} minimum.`,
  };
}

/** Evaluate a general experience fact against the user's ceiling. Ambiguous or
 * missing requirements always remain reviewable, never blockers. */
export function evaluateJobExperienceRule(
  experience: JobExperienceFacts,
  maximumRequiredExperienceYears: number | undefined,
): JobRuleDecision {
  if (maximumRequiredExperienceYears === undefined) {
    return { status: "not-configured" };
  }
  const limit = maximumRequiredExperienceYears;
  if (experience.state === "not-mentioned") {
    return {
      status: "review",
      reason: `Required experience is not explicitly stated; verify it against your ${formatYears(limit)} maximum.`,
    };
  }
  if (experience.state === "ambiguous") {
    return {
      status: "review",
      reason: `Required experience is ambiguous; verify it against your ${formatYears(limit)} maximum.`,
    };
  }
  if (experience.minimumYears > limit) {
    return {
      status: "blocker",
      reason: `Required experience minimum (${formatYears(experience.minimumYears)}) exceeds your maximum (${formatYears(limit)}).`,
    };
  }
  return { status: "satisfied" };
}

/** Rank one posting using only visible posting facts and explicit user rules.
 * The numeric score describes evidence coverage, not a prediction of hiring
 * success, and blockers always remain independently inspectable. */
export function assessJobMatch(
  posting: JobPosting,
  query: string,
  rawPreferences: JobMatchPreferencesInput,
  context: { profileSkills?: readonly string[] } = {},
): JobMatchAssessment {
  const preferences = jobMatchPreferencesSchema.parse(rawPreferences);
  const text = postingText(posting);
  const blockers: string[] = [];
  const reviewReasons: string[] = [];
  const evidence: JobMatchEvidence[] = [];
  const eligibility = extractJobEligibilityFacts(posting.description);
  const salary = extractJobSalaryFacts(posting);
  const experience = extractJobExperienceFacts(posting.description, {
    companyName: posting.company,
  });
  let eligibilityNeedsReview = false;
  let compensationNeedsReview = false;

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
  for (const statement of salary.evidence) {
    const salaryFieldEvidence = posting.salary ? clippedFactEvidence(posting.salary) : undefined;
    evidence.push({
      signal: "salary",
      source: statement === salaryFieldEvidence ? "salary" : "description",
      detail: `Salary ${salary.state}: “${statement}”`,
    });
  }
  for (const statement of experience.evidence) {
    evidence.push({
      signal: "experience",
      source: "description",
      detail: `Experience ${experience.state}: “${statement}”`,
    });
  }

  const salaryDecision = evaluateJobSalaryRule(salary, preferences.minimumAnnualSalaryUsd);
  const experienceDecision = evaluateJobExperienceRule(
    experience,
    preferences.maximumRequiredExperienceYears,
  );
  for (const decision of [salaryDecision, experienceDecision]) {
    if (decision.status === "blocker") blockers.push(decision.reason);
    if (decision.status === "review") {
      reviewReasons.push(decision.reason);
      compensationNeedsReview = true;
    }
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

  const resolvedSkills = resolveJobMatchSkills(preferences, context.profileSkills);
  const prioritySkills = resolvedSkills.skills;
  let skillSourceNeedsReview = false;
  if (resolvedSkills.source === "profile" && resolvedSkills.profileMissing) {
    reviewReasons.push("Profile has no skills, so skill evidence is unavailable.");
    skillSourceNeedsReview = true;
  } else if (
    resolvedSkills.source === "combined" &&
    resolvedSkills.profileMissing &&
    resolvedSkills.manualSkills.length === 0
  ) {
    reviewReasons.push(
      "Profile has no skills and no manual priority skills are set, so skill evidence is unavailable.",
    );
    skillSourceNeedsReview = true;
  }
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
  else if (eligibilityNeedsReview || skillSourceNeedsReview || compensationNeedsReview) {
    verdict = "review";
  } else if (score >= 75) verdict = "strong";
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
    salary,
    experience,
  });
}
