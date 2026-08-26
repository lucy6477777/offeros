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

const matchTermSchema = z.string().trim().min(1).max(100);

/** User-owned deterministic rules for one saved search. Missing facts never
 * become a rejection: only explicit blockers can produce `skip`. */
export const jobMatchPreferencesSchema = z
  .object({
    prioritySkills: z.array(matchTermSchema).max(50).default([]),
    excludedKeywords: z.array(matchTermSchema).max(50).default([]),
    excludedCompanies: z.array(matchTermSchema).max(50).default([]),
    maximumSeniority: z.enum(JOB_SENIORITY_LEVELS).optional(),
  })
  .strict();

export const jobMatchEvidenceSchema = z.object({
  signal: z.enum(["role", "skill", "seniority", "exclusion", "status"]),
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
});

export type JobSeniority = (typeof JOB_SENIORITY_LEVELS)[number];
export type JobMatchVerdict = (typeof JOB_MATCH_VERDICTS)[number];
export type JobMatchPreferences = z.infer<typeof jobMatchPreferencesSchema>;
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

  if (posting.liveness === "closed") {
    blockers.push("Job is marked closed.");
    evidence.push({ signal: "status", source: "status", detail: "Provider status: closed" });
  } else if (posting.liveness === "unknown") {
    reviewReasons.push("Current job status is unknown.");
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
  });
}
