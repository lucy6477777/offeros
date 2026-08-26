import { describe, expect, it } from "vitest";
import { jobSearchSourcesSchema, savedJobSearchDefinitionSchema } from "../config";

describe("job search configuration", () => {
  it("normalizes omitted source collections", () => {
    expect(jobSearchSourcesSchema.parse({ freehire: true })).toEqual({
      freehire: true,
      greenhouse: [],
      lever: [],
      ashby: [],
    });
  });

  it("accepts a repeatable search with multiple ATS boards", () => {
    const parsed = savedJobSearchDefinitionSchema.parse({
      name: "Remote platform roles",
      criteria: { query: " platform engineer ", locationScope: "remote-us" },
      sources: {
        greenhouse: [{ token: "acme", company: "Acme" }],
        lever: [{ site: "beta", company: "Beta", region: "global" }],
      },
    });

    expect(parsed.criteria.query).toBe("platform engineer");
    expect(parsed.sources).toMatchObject({ freehire: false, ashby: [] });
    expect(parsed.match).toEqual({
      skillSource: "manual",
      prioritySkills: [],
      excludedKeywords: [],
      excludedCompanies: [],
      eligibility: { usWorkAuthorization: "unknown", sponsorshipNeed: "unknown" },
    });
  });

  it("normalizes deterministic shortlist preferences", () => {
    const parsed = savedJobSearchDefinitionSchema.parse({
      name: "Platform shortlist",
      criteria: { query: "platform engineer" },
      sources: { freehire: true },
      match: {
        prioritySkills: [" TypeScript ", "PostgreSQL"],
        excludedKeywords: ["contract"],
        excludedCompanies: ["Acme"],
        maximumSeniority: "senior",
        eligibility: {
          usWorkAuthorization: "authorized",
          sponsorshipNeed: "required",
        },
      },
    });

    expect(parsed.match).toEqual({
      skillSource: "manual",
      prioritySkills: ["TypeScript", "PostgreSQL"],
      excludedKeywords: ["contract"],
      excludedCompanies: ["Acme"],
      maximumSeniority: "senior",
      eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
    });
  });

  it("rejects searches without keywords or a configured source", () => {
    expect(() =>
      savedJobSearchDefinitionSchema.parse({
        name: "Everything",
        criteria: {},
        sources: { freehire: true },
      }),
    ).toThrow();
    expect(() =>
      savedJobSearchDefinitionSchema.parse({
        name: "Platform",
        criteria: { query: "platform" },
        sources: {},
      }),
    ).toThrow(/at least one job source is required/);
  });
});
