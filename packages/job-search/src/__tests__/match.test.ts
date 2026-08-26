import { describe, expect, it } from "vitest";
import type { JobPosting } from "../types";
import {
  assessJobMatch,
  evaluateJobExperienceRule,
  evaluateJobSalaryRule,
  extractJobEligibilityFacts,
  extractJobExperienceFacts,
  extractJobSalaryFacts,
  inferJobSeniority,
  jobMatchPreferencesSchema,
  jobExperienceFactsSchema,
  jobSalaryFactsSchema,
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
  it("keeps salary and experience thresholds optional and validates their supported ranges", () => {
    const oldPreferences = jobMatchPreferencesSchema.parse({
      prioritySkills: [],
      excludedKeywords: [],
      excludedCompanies: [],
      eligibility: {},
    });
    expect(oldPreferences).not.toHaveProperty("minimumAnnualSalaryUsd");
    expect(oldPreferences).not.toHaveProperty("maximumRequiredExperienceYears");

    expect(
      jobMatchPreferencesSchema.parse({
        minimumAnnualSalaryUsd: 1_000,
        maximumRequiredExperienceYears: 0,
      }),
    ).toMatchObject({ minimumAnnualSalaryUsd: 1_000, maximumRequiredExperienceYears: 0 });
    expect(() => jobMatchPreferencesSchema.parse({ minimumAnnualSalaryUsd: 999 })).toThrow();
    expect(() => jobMatchPreferencesSchema.parse({ minimumAnnualSalaryUsd: 10_000_001 })).toThrow();
    expect(() => jobMatchPreferencesSchema.parse({ minimumAnnualSalaryUsd: 120_000.5 })).toThrow();
    expect(() => jobMatchPreferencesSchema.parse({ maximumRequiredExperienceYears: 81 })).toThrow();
    expect(() =>
      jobMatchPreferencesSchema.parse({ maximumRequiredExperienceYears: 3.5 }),
    ).toThrow();
  });

  it("rejects salary fact states with missing, extra, inconsistent, or reversed numeric fields", () => {
    const invalidFacts = [
      { state: "annual-usd", bound: "range", minimum: 150_000, evidence: [] },
      {
        state: "annual-usd",
        bound: "range",
        minimum: 150_000,
        maximum: 120_000,
        evidence: [],
      },
      {
        state: "annual-usd",
        bound: "exact",
        minimum: 120_000,
        maximum: 130_000,
        evidence: [],
      },
      {
        state: "annual-usd",
        bound: "minimum-only",
        minimum: 120_000,
        maximum: 150_000,
        evidence: [],
      },
      { state: "annual-usd", bound: "maximum-only", evidence: [] },
      {
        state: "ambiguous",
        bound: "unknown",
        minimum: 120_000,
        evidence: ["Unclear"],
      },
      { state: "unsupported", bound: "range", evidence: ["Hourly"] },
      { state: "not-mentioned", bound: "unknown", maximum: 120_000, evidence: [] },
    ];

    for (const facts of invalidFacts) expect(() => jobSalaryFactsSchema.parse(facts)).toThrow();
  });

  it("rejects experience fact states with missing, extra, or reversed numeric fields", () => {
    const invalidFacts = [
      { state: "explicit-minimum", evidence: [] },
      { state: "explicit-minimum", minimumYears: 5, maximumYears: 3, evidence: [] },
      { state: "ambiguous", minimumYears: 3, evidence: ["Unclear"] },
      { state: "not-mentioned", maximumYears: 5, evidence: [] },
    ];

    for (const facts of invalidFacts) {
      expect(() => jobExperienceFactsSchema.parse(facts)).toThrow();
    }
  });

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

  it("extracts exact, range, minimum-only, and maximum-only annual USD salary", () => {
    expect(extractJobSalaryFacts(posting({ salary: "USD 140,000 annually" }))).toMatchObject({
      state: "annual-usd",
      bound: "exact",
      minimum: 140_000,
      maximum: 140_000,
    });
    expect(extractJobSalaryFacts(posting({ salary: "US$120K - US$155K per year" }))).toMatchObject({
      state: "annual-usd",
      bound: "range",
      minimum: 120_000,
      maximum: 155_000,
    });
    expect(
      extractJobSalaryFacts(posting({ salary: "Starting at USD 125,000 per annum" })),
    ).toMatchObject({
      state: "annual-usd",
      bound: "minimum-only",
      minimum: 125_000,
    });
    expect(
      extractJobSalaryFacts(
        posting({ countryCode: "US", salary: "Up to $170K per calendar year" }),
      ),
    ).toMatchObject({
      state: "annual-usd",
      bound: "maximum-only",
      maximum: 170_000,
    });
  });

  it("allows a bare dollar only for a US posting", () => {
    expect(
      extractJobSalaryFacts(posting({ countryCode: "US", salary: "$120,000–$150,000 per year" }))
        .state,
    ).toBe("annual-usd");
    expect(
      extractJobSalaryFacts(posting({ countryCode: "CA", salary: "$120,000–$150,000 per year" }))
        .state,
    ).toBe("unsupported");
    expect(extractJobSalaryFacts(posting({ salary: "$120,000 annually" })).state).toBe(
      "unsupported",
    );
  });

  it.each([
    "USD 75 per hour",
    "USD 800 per day",
    "USD 8,000 per month",
    "EUR 120,000 per year",
    "CAD 150,000 annually",
    "USD 120,000–150,000",
  ])("keeps unsupported salary non-numeric: %s", (salary) => {
    expect(extractJobSalaryFacts(posting({ salary }))).toMatchObject({
      state: "unsupported",
      bound: "unknown",
    });
  });

  it.each([
    "OTE USD 180,000 per year",
    "Total compensation is USD 180,000 annually",
    "Base salary USD 130,000 plus USD 20,000 bonus per year",
    "USD 120,000, USD 140,000, or USD 160,000 annually",
    "USD 180,000–USD 120,000 per year",
  ])("keeps mixed or conflicting compensation ambiguous: %s", (salary) => {
    expect(extractJobSalaryFacts(posting({ salary }))).toMatchObject({
      state: "ambiguous",
      bound: "unknown",
    });
  });

  it("falls back to an explicit salary sentence in the description", () => {
    const result = assessJobMatch(
      posting({
        salary: undefined,
        countryCode: "US",
        description:
          "Build TypeScript services. The annual base salary is $130,000 to $160,000 per year.",
      }),
      "platform engineer",
      preferences(),
    );

    expect(result.salary).toMatchObject({
      state: "annual-usd",
      bound: "range",
      minimum: 130_000,
      maximum: 160_000,
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ signal: "salary", source: "description" }),
    );
  });

  it("uses a strict annual description fact when the salary field omits its interval", () => {
    const result = extractJobSalaryFacts(
      posting({
        salary: "USD 120K–150K",
        description: "The annual base salary is USD 120K–150K per year.",
      }),
    );

    expect(result).toEqual({
      state: "annual-usd",
      bound: "range",
      minimum: 120_000,
      maximum: 150_000,
      evidence: ["The annual base salary is USD 120K–150K per year."],
    });
  });

  it("does not treat unrelated annual dollar benefits as description salary facts", () => {
    expect(
      extractJobSalaryFacts(
        posting({
          salary: undefined,
          description: "We pay a USD 2,000 annual learning stipend and reimburse travel.",
        }),
      ),
    ).toEqual({ state: "not-mentioned", bound: "unknown", evidence: [] });
  });

  it("keeps conflicting annual salary fields ambiguous with both original statements", () => {
    const result = extractJobSalaryFacts(
      posting({
        salary: "USD 120K–150K per year",
        description: "The annual base salary is USD 140K–170K per year.",
      }),
    );

    expect(result).toEqual({
      state: "ambiguous",
      bound: "unknown",
      evidence: ["USD 120K–150K per year", "The annual base salary is USD 140K–170K per year."],
    });
  });

  it("applies every salary bound conservatively at and around the threshold", () => {
    const threshold = 120_000;
    const assess = (salary: string) =>
      assessJobMatch(
        posting({ salary }),
        "platform engineer",
        preferences({ minimumAnnualSalaryUsd: threshold }),
      );

    const belowRange = assess("USD 90,000–119,999 per year");
    expect(belowRange.verdict).toBe("skip");
    expect(belowRange.blockers[0]).toContain("$119,999");
    expect(belowRange.blockers[0]).toContain("$120,000");

    const equalLowerBound = assess("USD 120,000–150,000 per year");
    expect(equalLowerBound.verdict).toBe("strong");
    expect(equalLowerBound.reviewReasons).toEqual([]);

    const crossingRange = assess("USD 100,000–140,000 per year");
    expect(crossingRange.verdict).toBe("review");
    expect(crossingRange.reviewReasons[0]).toContain("$100,000–$140,000");

    const lowMinimumOnly = assess("Starting at USD 100,000 per year");
    expect(lowMinimumOnly.verdict).toBe("review");
    expect(lowMinimumOnly.blockers).toEqual([]);

    const lowMaximumOnly = assess("Up to USD 119,999 annually");
    expect(lowMaximumOnly.verdict).toBe("skip");

    const equalMaximumOnly = assess("Up to USD 120,000 annually");
    expect(equalMaximumOnly.verdict).toBe("review");
    expect(equalMaximumOnly.blockers).toEqual([]);
  });

  it("exposes the complete salary rule decision matrix as a pure helper", () => {
    const fact = (salary: string | undefined) => extractJobSalaryFacts(posting({ salary }));
    const target = 120_000;

    expect(evaluateJobSalaryRule(fact("USD 90K–110K per year"), undefined)).toEqual({
      status: "not-configured",
    });
    expect(evaluateJobSalaryRule(fact("USD 90K–110K per year"), target).status).toBe("blocker");
    expect(evaluateJobSalaryRule(fact("USD 120K–150K per year"), target)).toEqual({
      status: "satisfied",
    });
    expect(evaluateJobSalaryRule(fact("USD 100K–150K per year"), target).status).toBe("review");
    expect(evaluateJobSalaryRule(fact("USD 120K annually"), target)).toEqual({
      status: "satisfied",
    });
    expect(evaluateJobSalaryRule(fact("USD 119K annually"), target).status).toBe("blocker");
    expect(evaluateJobSalaryRule(fact("Starting at USD 120K per year"), target)).toEqual({
      status: "satisfied",
    });
    expect(evaluateJobSalaryRule(fact("Starting at USD 100K per year"), target).status).toBe(
      "review",
    );
    expect(evaluateJobSalaryRule(fact("Up to USD 119K per year"), target).status).toBe("blocker");
    expect(evaluateJobSalaryRule(fact("Up to USD 120K per year"), target).status).toBe("review");
    expect(evaluateJobSalaryRule(fact(undefined), target).status).toBe("review");
    expect(evaluateJobSalaryRule(fact("USD 80 per hour"), target).status).toBe("review");
    expect(evaluateJobSalaryRule(fact("OTE USD 180K per year"), target).status).toBe("review");
  });

  it("reviews missing, unsupported, and ambiguous salary only when a threshold is configured", () => {
    const configured = preferences({ minimumAnnualSalaryUsd: 120_000 });
    for (const salary of [undefined, "USD 80 per hour", "OTE USD 180,000 per year"]) {
      const result = assessJobMatch(posting({ salary }), "platform engineer", configured);
      expect(result.verdict).toBe("review");
      expect(result.blockers).toEqual([]);
      expect(result.reviewReasons.some((reason) => reason.includes("$120,000"))).toBe(true);
    }
  });

  it("extracts general minimum experience and chooses the largest lower bound", () => {
    expect(extractJobExperienceFacts("Candidates need 3+ years of experience.")).toMatchObject({
      state: "explicit-minimum",
      minimumYears: 3,
    });
    expect(
      extractJobExperienceFacts("A minimum of 4 years of professional experience is required."),
    ).toMatchObject({ state: "explicit-minimum", minimumYears: 4 });

    const multiple = extractJobExperienceFacts(
      "At least 2 years of relevant experience. Candidates also need 5-7 years of software engineering experience.",
    );
    expect(multiple).toMatchObject({
      state: "explicit-minimum",
      minimumYears: 5,
      maximumYears: 7,
    });
    expect(multiple.evidence).toHaveLength(2);
  });

  it.each([
    "Candidates need 5+ years of experience.",
    "At least 5 years of professional experience is required.",
    "A minimum of 5 years of experience is needed for the role.",
    "5+ years of experience are mandatory.",
    "3-5 years of relevant experience for this position.",
  ])("accepts only an explicit generic experience suffix: %s", (description) => {
    expect(extractJobExperienceFacts(description).state).toBe("explicit-minimum");
  });

  it.each([
    "A four-year degree in computer science is required.",
    "A bachelor's degree in computer science is required.",
    "Our company has 12+ years of experience serving customers.",
    "Employees receive a 4-year vesting schedule.",
    "This is a 3-year contract with extension options.",
    "The product launched 5 years ago.",
  ])("does not invent a general experience minimum from: %s", (description) => {
    expect(extractJobExperienceFacts(description)).toEqual({
      state: "not-mentioned",
      evidence: [],
    });
  });

  it.each([
    "Up to 5 years of experience is acceptable.",
    "3+ years of experience preferred.",
    "Nice-to-have: at least 4 years of experience.",
    "3+ years of Python experience is required.",
    "3+ years of experience with React is required.",
    "5+ years of experience building ML systems is required.",
    "5+ years of experience serving customers is required.",
    "5+ years of experience on AWS is required.",
    "5+ years of experience as a React developer is required.",
    "5+ years of experience across cloud platforms is required.",
    "5+ years of experience for Kubernetes is required.",
    "Acme has 20+ years of experience serving customers.",
  ])("keeps mentioned but non-comparable experience ambiguous: %s", (description) => {
    expect(extractJobExperienceFacts(description)).toEqual({
      state: "ambiguous",
      evidence: [description],
    });
  });

  it.each([
    "3+ years of experience or equivalent education is required.",
    "Candidates need 5-3 years of experience.",
    "Candidates need 3-5 years or 7-9 years of experience.",
    "5+ years of experience or a bachelor's degree is required.",
    "5+ years of experience or a bachelor’s degree is required.",
    "A bachelor's degree or 5+ years of experience is required.",
    "A bachelor's degree or 4 years of equivalent experience is accepted.",
  ])("keeps equivalent or conflicting experience ambiguous: %s", (description) => {
    expect(extractJobExperienceFacts(description).state).toBe("ambiguous");
  });

  it("keeps a clear general minimum when non-comparable add-on tenure is also present", () => {
    const result = extractJobExperienceFacts(
      "5+ years of professional experience is required. 3+ years of Python experience preferred. Up to 2 years of experience with React is acceptable. 4+ years of experience building ML systems is helpful.",
    );

    expect(result).toEqual({
      state: "explicit-minimum",
      minimumYears: 5,
      evidence: ["5+ years of professional experience is required."],
    });
  });

  it.each([
    "The ideal engineer has 5+ years of experience.",
    "A successful candidate has 5+ years of experience.",
    "The qualified applicant has 5+ years of experience.",
    "The right person has 5+ years of experience.",
    "The right fit has 5+ years of experience.",
    "The incumbent has 5+ years of experience.",
    "A consultant has 5+ years of experience.",
    "The expert has 5+ years of experience.",
  ])("does not mistake a candidate subject for company history: %s", (description) => {
    expect(extractJobExperienceFacts(description)).toMatchObject({
      state: "explicit-minimum",
      minimumYears: 5,
    });
  });

  it.each([
    "Acme has 20+ years of experience.",
    "Acme has 20+ years of experience serving customers.",
    "Our company has 20+ years of experience serving customers.",
  ])("uses posting company context to ignore employer history: %s", (description) => {
    const result = assessJobMatch(
      posting({ company: "Acme", description }),
      "platform engineer",
      preferences({ maximumRequiredExperienceYears: 3 }),
    );

    expect(result.experience).toEqual({ state: "not-mentioned", evidence: [] });
    expect(result.verdict).toBe("review");
    expect(result.blockers).toEqual([]);
    expect(result.reviewReasons).toContain(
      "Required experience is not explicitly stated; verify it against your 3 years maximum.",
    );
  });

  it("lets a true alternative override an otherwise clear general minimum", () => {
    const result = extractJobExperienceFacts(
      "5+ years of professional experience is required. A bachelor's degree or 3+ years of experience is also accepted.",
    );

    expect(result.state).toBe("ambiguous");
    expect(result.evidence).toContain(
      "A bachelor's degree or 3+ years of experience is also accepted.",
    );
  });

  it("blocks only an explicit experience minimum above the user's ceiling", () => {
    const above = assessJobMatch(
      posting({ description: "Build TypeScript services. 5+ years of experience is required." }),
      "platform engineer",
      preferences({ maximumRequiredExperienceYears: 4 }),
    );
    expect(above.verdict).toBe("skip");
    expect(above.blockers[0]).toContain("5 years");
    expect(above.blockers[0]).toContain("4 years");

    const equal = assessJobMatch(
      posting({ description: "Build TypeScript services. At least 4 years of experience." }),
      "platform engineer",
      preferences({ maximumRequiredExperienceYears: 4 }),
    );
    expect(equal.verdict).toBe("strong");
    expect(equal.blockers).toEqual([]);

    const zeroLimit = assessJobMatch(
      posting({ description: "Build services. 1+ years of experience is required." }),
      "platform engineer",
      preferences({ maximumRequiredExperienceYears: 0 }),
    );
    expect(zeroLimit.verdict).toBe("skip");
    expect(zeroLimit.blockers[0]).toContain("0 years");
  });

  it("exposes every experience rule state through the same pure decision contract", () => {
    const explicit = extractJobExperienceFacts("3+ years of experience is required.");
    const missing = extractJobExperienceFacts("Build reliable services.");
    const ambiguous = extractJobExperienceFacts("3+ years of Python experience is required.");

    expect(evaluateJobExperienceRule(explicit, undefined)).toEqual({
      status: "not-configured",
    });
    expect(evaluateJobExperienceRule(explicit, 3)).toEqual({ status: "satisfied" });
    expect(evaluateJobExperienceRule(explicit, 2).status).toBe("blocker");
    expect(evaluateJobExperienceRule(missing, 3).status).toBe("review");
    expect(evaluateJobExperienceRule(ambiguous, 3).status).toBe("review");
  });

  it("reviews missing and ambiguous experience when the user configured a ceiling", () => {
    const configured = preferences({ maximumRequiredExperienceYears: 3 });
    const missing = assessJobMatch(posting(), "platform engineer", configured);
    const ambiguous = assessJobMatch(
      posting({ description: "3+ years of experience or equivalent education is required." }),
      "platform engineer",
      configured,
    );

    expect(missing.verdict).toBe("review");
    expect(missing.reviewReasons[0]).toContain("3 years");
    expect(ambiguous.verdict).toBe("review");
    expect(ambiguous.reviewReasons[0]).toContain("3 years");
  });

  it("explains non-comparable technical tenure as ambiguous instead of missing", () => {
    const statement = "3+ years of experience with React is required.";
    const result = assessJobMatch(
      posting({ description: statement }),
      "platform engineer",
      preferences({ maximumRequiredExperienceYears: 3 }),
    );

    expect(result.experience).toEqual({ state: "ambiguous", evidence: [statement] });
    expect(result.verdict).toBe("review");
    expect(result.reviewReasons).toContain(
      "Required experience is ambiguous; verify it against your 3 years maximum.",
    );
    expect(result.reviewReasons).not.toContain(
      "Required experience is not explicitly stated; verify it against your 3 years maximum.",
    );
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        signal: "experience",
        source: "description",
        detail: expect.stringContaining(statement),
      }),
    );
  });

  it("does not change legacy verdict, score, or review reasons when new rules are not configured", () => {
    const baseline = assessJobMatch(posting(), "platform engineer", preferences());
    const withUnconfiguredFacts = assessJobMatch(
      posting({
        salary: "USD 20,000 per year",
        description: "Build distributed services. 20+ years of experience is required.",
      }),
      "platform engineer",
      preferences(),
    );

    expect(withUnconfiguredFacts.verdict).toBe(baseline.verdict);
    expect(withUnconfiguredFacts.score).toBe(baseline.score);
    expect(withUnconfiguredFacts.reviewReasons).toEqual(baseline.reviewReasons);
    expect(withUnconfiguredFacts.salary.state).toBe("annual-usd");
    expect(withUnconfiguredFacts.experience.state).toBe("explicit-minimum");
  });

  it("keeps blockers above a perfect score and preserves simultaneous review evidence", () => {
    const result = assessJobMatch(
      posting({
        countryCode: "US",
        salary: "$90,000–$100,000 per year",
        description:
          "Platform engineer TypeScript. 5+ years of experience or equivalent education is required.",
      }),
      "platform engineer",
      preferences({
        prioritySkills: ["TypeScript"],
        minimumAnnualSalaryUsd: 120_000,
        maximumRequiredExperienceYears: 3,
      }),
    );

    expect(result.score).toBe(100);
    expect(result.verdict).toBe("skip");
    expect(result.blockers).toHaveLength(1);
    expect(result.reviewReasons.some((reason) => reason.includes("ambiguous"))).toBe(true);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: "salary", source: "salary" }),
        expect.objectContaining({ signal: "experience", source: "description" }),
      ]),
    );
  });

  it("clips fact evidence from very long provider text to the public schema limit", () => {
    const longSuffix = " requirement".repeat(100);
    const salary = extractJobSalaryFacts(posting({ salary: `USD 120,000 annually ${longSuffix}` }));
    const experience = extractJobExperienceFacts(`3+ years of experience ${longSuffix}`);

    expect(salary.evidence[0]!.length).toBeLessThanOrEqual(500);
    expect(experience.evidence[0]!.length).toBeLessThanOrEqual(500);
  });
});
