import { describe, expect, it } from "vitest";
import type { JobPosting } from "../types";
import { assessJobMatch, inferJobSeniority } from "../match";

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

describe("deterministic job matching", () => {
  it("ranks explicit role and skill evidence without an AI call", () => {
    const result = assessJobMatch(posting(), "platform engineer", {
      prioritySkills: ["TypeScript", "Node.js", "Python"],
      excludedKeywords: [],
      excludedCompanies: [],
      maximumSeniority: "senior",
    });

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
      {
        prioritySkills: [],
        excludedKeywords: ["contract"],
        excludedCompanies: ["Blocked Labs"],
        maximumSeniority: "senior",
      },
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
      {
        prioritySkills: ["Rust"],
        excludedKeywords: [],
        excludedCompanies: [],
        maximumSeniority: "senior",
      },
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
});
