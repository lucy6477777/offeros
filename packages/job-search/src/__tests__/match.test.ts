import { describe, expect, it } from "vitest";
import type { JobPosting } from "../types";
import {
  assessJobMatch,
  extractJobEligibilityFacts,
  inferJobSeniority,
  jobMatchPreferencesSchema,
  resolveJobMatchSkills,
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
    skillSource: "manual",
    prioritySkills: [],
    excludedKeywords: [],
    excludedCompanies: [],
    eligibility: { usWorkAuthorization: "unknown", sponsorshipNeed: "unknown" },
    ...overrides,
  };
}

describe("deterministic job matching", () => {
  it("defaults old preferences to manual skills and round-trips every skill source", () => {
    expect(
      jobMatchPreferencesSchema.parse({
        prioritySkills: [],
        excludedKeywords: [],
        excludedCompanies: [],
        eligibility: {},
      }).skillSource,
    ).toBe("manual");

    for (const skillSource of ["manual", "profile", "combined"] as const) {
      expect(
        jobMatchPreferencesSchema.parse({
          skillSource,
          prioritySkills: [],
          excludedKeywords: [],
          excludedCompanies: [],
          eligibility: {},
        }).skillSource,
      ).toBe(skillSource);
    }
  });

  it("resolves manual, profile, and combined skills with stable normalized deduplication", () => {
    const manual = preferences({
      skillSource: "manual",
      prioritySkills: [" TypeScript ", "Node.js", "NodeJS"],
    });
    const profile = [" nodejs ", "PostgreSQL", "", "TypeScript"];

    expect(resolveJobMatchSkills(manual, profile)).toMatchObject({
      source: "manual",
      skills: ["TypeScript", "Node.js"],
      profileMissing: false,
    });
    expect(resolveJobMatchSkills({ ...manual, skillSource: "profile" }, profile)).toMatchObject({
      source: "profile",
      skills: ["nodejs", "PostgreSQL", "TypeScript"],
      profileMissing: false,
    });
    expect(resolveJobMatchSkills({ ...manual, skillSource: "combined" }, profile)).toMatchObject({
      source: "combined",
      skills: ["TypeScript", "Node.js", "PostgreSQL"],
      manualSkills: ["TypeScript", "Node.js"],
      profileSkills: ["nodejs", "PostgreSQL", "TypeScript"],
      profileMissing: false,
    });
  });

  it("defensively cleans profile skills, caps the final set, and reports missing profile data", () => {
    const dirtyProfile = [
      null,
      undefined,
      42,
      " ",
      "x".repeat(101),
      ...Array.from({ length: 55 }, (_, i) => ` Skill ${i} `),
    ];
    const profilePreferences = preferences({ skillSource: "profile" });
    const resolved = resolveJobMatchSkills(profilePreferences, dirtyProfile);

    expect(resolved.skills).toHaveLength(50);
    expect(resolved.skills[0]).toBe("Skill 0");
    expect(resolved.skills[49]).toBe("Skill 49");
    expect(resolved.profileMissing).toBe(false);
    expect(resolveJobMatchSkills(profilePreferences, [null, " "]).profileMissing).toBe(true);
    expect(resolveJobMatchSkills(profilePreferences, ["x".repeat(101)]).profileMissing).toBe(true);
    expect(resolveJobMatchSkills(preferences({ skillSource: "manual" }), []).profileMissing).toBe(
      false,
    );
  });

  it("caps combined skills at 50 with manual-first ordering and cross-source aliases deduped", () => {
    const fortyNineManual = [
      "Node.js",
      ...Array.from({ length: 48 }, (_, i) => `Manual Skill ${i}`),
    ];
    const withOneProfileSlot = resolveJobMatchSkills(
      preferences({ skillSource: "combined", prioritySkills: fortyNineManual }),
      ["NodeJS", "Profile Skill 0", "Profile Skill 1"],
    );

    expect(withOneProfileSlot.skills).toHaveLength(50);
    expect(withOneProfileSlot.skills.slice(0, 49)).toEqual(fortyNineManual);
    expect(withOneProfileSlot.skills[49]).toBe("Profile Skill 0");
    expect(withOneProfileSlot.skills).not.toContain("NodeJS");
    expect(withOneProfileSlot.skills).not.toContain("Profile Skill 1");

    const fiftyManual = [...fortyNineManual, "Manual Skill 48"];
    const withoutProfileSlots = resolveJobMatchSkills(
      preferences({ skillSource: "combined", prioritySkills: fiftyManual }),
      ["NodeJS", "Profile Skill 0"],
    );

    expect(withoutProfileSlots.skills).toEqual(fiftyManual);
    expect(withoutProfileSlots.skills).toHaveLength(50);
    expect(withoutProfileSlots.skills).not.toContain("Profile Skill 0");
  });

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

  it("scores profile-only skills from live runtime context", () => {
    const result = assessJobMatch(
      posting(),
      "platform engineer",
      preferences({ skillSource: "profile", prioritySkills: ["Rust"] }),
      { profileSkills: ["TypeScript", "NodeJS", "Python"] },
    );

    expect(result).toMatchObject({
      verdict: "strong",
      score: 87,
      matchedSkills: ["TypeScript", "NodeJS"],
      missingSkills: ["Python"],
      blockers: [],
    });
  });

  it("reviews an empty profile source without turning it into a blocker", () => {
    const result = assessJobMatch(
      posting(),
      "platform engineer",
      preferences({ skillSource: "profile", prioritySkills: ["TypeScript"] }),
      { profileSkills: [] },
    );

    expect(result.verdict).toBe("review");
    expect(result.blockers).toEqual([]);
    expect(result.matchedSkills).toEqual([]);
    expect(result.reviewReasons).toContain(
      "Profile has no skills, so skill evidence is unavailable.",
    );
  });

  it("keeps explicit blockers above an empty-profile review", () => {
    const result = assessJobMatch(
      posting({ company: "Blocked Labs" }),
      "platform engineer",
      preferences({
        skillSource: "profile",
        excludedCompanies: ["Blocked Labs"],
      }),
      { profileSkills: [] },
    );

    expect(result.verdict).toBe("skip");
    expect(result.blockers).toContain("Excluded company matched: Blocked Labs.");
    expect(result.reviewReasons).toContain(
      "Profile has no skills, so skill evidence is unavailable.",
    );
  });

  it("falls back quietly to manual skills for combined mode when Profile is empty", () => {
    const withManual = assessJobMatch(
      posting(),
      "platform engineer",
      preferences({ skillSource: "combined", prioritySkills: ["TypeScript", "Node.js"] }),
      { profileSkills: [] },
    );
    const withoutManual = assessJobMatch(
      posting(),
      "platform engineer",
      preferences({ skillSource: "combined" }),
      { profileSkills: [] },
    );

    expect(withManual.verdict).toBe("strong");
    expect(withManual.matchedSkills).toEqual(["TypeScript", "Node.js"]);
    expect(withManual.reviewReasons).not.toContain(
      "Profile has no skills and no manual priority skills are set, so skill evidence is unavailable.",
    );
    expect(withoutManual.verdict).toBe("review");
    expect(withoutManual.reviewReasons).toContain(
      "Profile has no skills and no manual priority skills are set, so skill evidence is unavailable.",
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
