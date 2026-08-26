import { describe, expect, it } from "vitest";
import type { JobPosting } from "../types";
import {
  assessJobMatch,
  extractJobEligibilityFacts,
  inferJobSeniority,
  type JobMatchPreferences,
} from "../match";

function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "Senior Platform Engineer",
    company: "Acme",
    location: "Remote, United States",
    workplace: "remote",
    description: "Build distributed services with TypeScript, Node.js, and PostgreSQL.",
    applyUrl: "https://jobs.example.com/job-1",
    liveness: "open",
    sources: [
      {
        provider: "greenhouse",
        kind: "official-ats",
        externalId: "job-1",
        sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
        applyUrl: "https://jobs.example.com/job-1",
        fetchedAt: 10,
      },
    ],
    ...overrides,
  };
}

function preferences(overrides: Partial<JobMatchPreferences> = {}): JobMatchPreferences {
  return {
    prioritySkills: [],
    excludedKeywords: [],
    excludedCompanies: [],
    eligibility: { usWorkAuthorization: "unknown", sponsorshipNeed: "unknown" },
    ...overrides,
  };
}

describe("deterministic job matching", () => {
  it("ranks explicit role and skill evidence without an AI call", () => {
    const result = assessJobMatch(
      posting(),
      "platform engineer",
      preferences({
        prioritySkills: ["TypeScript", "Node.js", "Python"],
        maximumSeniority: "senior",
      }),
    );

    expect(result).toMatchObject({
      verdict: "strong",
      score: 87,
      inferredSeniority: "senior",
      matchedSkills: ["TypeScript", "Node.js"],
      missingSkills: ["Python"],
      blockers: [],
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "role", source: "title" }),
        expect.objectContaining({ signal: "skill", detail: "Priority skill found: Node.js" }),
      ]),
    );
  });

  it("applies only explicit hard blockers and keeps every reason", () => {
    const result = assessJobMatch(
      posting({
        title: "Director of Platform Engineering",
        company: "Blocked Labs, Inc.",
        description: "This contract role leads a platform organization.",
      }),
      "platform engineering",
      preferences({
        excludedKeywords: ["contract"],
        excludedCompanies: ["Blocked Labs"],
        maximumSeniority: "senior",
      }),
    );

    expect(result.verdict).toBe("skip");
    expect(result.blockers).toEqual([
      "Excluded company matched: Blocked Labs.",
      "Excluded keyword matched: contract.",
      "Title seniority (director) exceeds the senior ceiling.",
    ]);
  });

  it("keeps unknown status, seniority, and missing descriptions reviewable", () => {
    const result = assessJobMatch(
      posting({ title: "Platform Engineer", description: undefined, liveness: "unknown" }),
      "platform engineer",
      preferences({
        prioritySkills: ["Rust"],
        maximumSeniority: "senior",
      }),
    );

    expect(result.verdict).not.toBe("skip");
    expect(result.reviewReasons).toEqual([
      "Current job status is unknown.",
      "Seniority is not explicit in the job title.",
      "Job description is missing, so skill evidence is incomplete.",
    ]);
  });

  it("recognizes title levels conservatively and in precedence order", () => {
    expect(inferJobSeniority("Senior Engineering Manager")).toBe("manager");
    expect(inferJobSeniority("Principal Software Engineer")).toBe("principal");
    expect(inferJobSeniority("Engineer, Identity and Access Management")).toBe("unknown");
    expect(inferJobSeniority("Engineer III, Vulnerability Management")).toBe("unknown");
    expect(inferJobSeniority("Software Engineer")).toBe("unknown");
  });

  it("hard-blocks only an explicit no-sponsorship conflict", () => {
    const result = assessJobMatch(
      posting({
        description:
          "Build distributed systems. We do not provide visa sponsorship now or in the future.",
      }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
      }),
    );

    expect(result.verdict).toBe("skip");
    expect(result.eligibility.sponsorship).toEqual({
      state: "unavailable",
      evidence: ["We do not provide visa sponsorship now or in the future."],
    });
    expect(result.blockers).toContain(
      "Sponsorship conflict: you need sponsorship, and the posting explicitly says it is unavailable.",
    );
  });

  it("keeps sponsorship silence and conditional language reviewable", () => {
    const silent = assessJobMatch(
      posting({ description: "Build distributed systems with TypeScript." }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
      }),
    );
    const conditional = assessJobMatch(
      posting({ description: "We may sponsor qualified candidates on a case-by-case basis." }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
      }),
    );

    expect(silent.verdict).toBe("review");
    expect(silent.blockers).toEqual([]);
    expect(silent.eligibility.sponsorship.state).toBe("not-mentioned");
    expect(conditional.verdict).toBe("review");
    expect(conditional.blockers).toEqual([]);
    expect(conditional.eligibility.sponsorship.state).toBe("ambiguous");
  });

  it("blocks an explicit current-authorization conflict but reviews specific status limits", () => {
    const required = assessJobMatch(
      posting({
        description: "Candidates must be currently authorized to work in the United States.",
      }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "not-authorized", sponsorshipNeed: "unknown" },
      }),
    );
    const restricted = assessJobMatch(
      posting({ description: "U.S. citizens or permanent residents only." }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "not-needed" },
      }),
    );

    expect(required.verdict).toBe("skip");
    expect(required.eligibility.usWorkAuthorization.state).toBe("required");
    expect(restricted.verdict).toBe("review");
    expect(restricted.blockers).toEqual([]);
    expect(restricted.eligibility.usWorkAuthorization.state).toBe("restricted");
  });

  it("does not hard-block contradictory eligibility text", () => {
    const result = assessJobMatch(
      posting({
        description:
          "Candidates must be currently authorized to work in the US. We provide H-1B visa sponsorship for qualified candidates.",
      }),
      "platform engineer",
      preferences({
        eligibility: { usWorkAuthorization: "not-authorized", sponsorshipNeed: "required" },
      }),
    );

    expect(result.verdict).toBe("review");
    expect(result.blockers).toEqual([]);
    expect(result.eligibility.sponsorship.state).toBe("available");
    expect(result.reviewReasons).toContain(
      "The posting requires current US work authorization but also mentions sponsorship; verify the apparent conflict.",
    );
  });

  it("extracts explicit JD facts without treating silence as refusal", () => {
    expect(extractJobEligibilityFacts(undefined)).toEqual({
      sponsorship: { state: "not-mentioned", evidence: [] },
      usWorkAuthorization: { state: "not-mentioned", evidence: [] },
    });
    expect(
      extractJobEligibilityFacts(
        "Visa sponsorship is available. Existing US work authorization is required.",
      ),
    ).toEqual({
      sponsorship: { state: "available", evidence: ["Visa sponsorship is available."] },
      usWorkAuthorization: {
        state: "required",
        evidence: ["Existing US work authorization is required."],
      },
    });
    expect(extractJobEligibilityFacts("No sponsorship required to apply.").sponsorship.state).toBe(
      "not-mentioned",
    );
    expect(extractJobEligibilityFacts("Sponsorship: No.").sponsorship.state).toBe("unavailable");
    expect(
      extractJobEligibilityFacts(
        "U.S. citizenship is not required. Existing US work authorization is required.",
      ).usWorkAuthorization.state,
    ).toBe("required");
  });
});
