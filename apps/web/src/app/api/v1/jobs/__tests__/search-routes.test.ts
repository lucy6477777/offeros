import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-job-search-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "search.db");

let greenhouseFails = false;
vi.stubGlobal("fetch", async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("boards-api.greenhouse.io")) {
    if (greenhouseFails) throw new Error("temporary Greenhouse outage");
    return Response.json({
      jobs: [
        {
          id: 101,
          title: "Platform Engineer",
          location: { name: "Remote, United States" },
          absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
          content: "<p>Build TypeScript infrastructure.</p>",
          updated_at: "2026-08-26T08:00:00Z",
          departments: [{ name: "Engineering" }],
        },
      ],
    });
  }
  if (url.includes("api.lever.co")) {
    return Response.json([
      {
        id: "lever-202",
        text: "Product Manager",
        categories: { location: "New York, NY", commitment: "Full-time" },
        descriptionPlain: "Lead product planning.",
        applyUrl: "https://jobs.lever.co/beta/lever-202/apply",
        workplaceType: "hybrid",
        createdAt: 1_777_000_000_000,
      },
    ]);
  }
  return new Response("not found", { status: 404 });
});

const jobsRoute = await import("../route");
const searchRoute = await import("../search/route");

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.OFFEROS_DB_PATH;
  delete (globalThis as Record<string, unknown>).__offerosDb;
  delete (globalThis as Record<string, unknown>).__offerosSqlite;
  rmSync(dir, { recursive: true, force: true });
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/v1/jobs/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const SOURCES = {
  greenhouse: [{ token: "acme", company: "Acme" }],
  lever: [{ site: "beta", company: "Beta" }],
};

describe("job search routes", () => {
  it("searches two providers, persists the run, and queries canonical jobs locally", async () => {
    const response = await searchRoute.POST(post({ criteria: {}, sources: SOURCES }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.run).toMatchObject({ status: "success", resultCount: 2 });
    expect(body.result.postings).toHaveLength(2);
    expect(
      body.result.providerRuns.map((run: { provider: string }) => run.provider).sort(),
    ).toEqual(["greenhouse", "lever"]);

    const jobs = await (
      await jobsRoute.GET(
        new Request("http://localhost/api/v1/jobs?query=platform%20typescript&maxResults=5"),
      )
    ).json();
    expect(jobs.result).toHaveLength(1);
    expect(jobs.result[0].posting).toMatchObject({ company: "Acme", workplace: "remote" });

    const history = await (
      await searchRoute.GET(new Request("http://localhost/api/v1/jobs/search?limit=10"))
    ).json();
    expect(history.result.runs).toHaveLength(1);
    expect(history.result.sourceHealth).toHaveLength(2);
  });

  it("persists a partial run when one provider is temporarily unavailable", async () => {
    greenhouseFails = true;
    const response = await searchRoute.POST(post({ criteria: {}, sources: SOURCES }));
    greenhouseFails = false;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.run).toMatchObject({ status: "partial", resultCount: 1 });
    expect(body.result.providerRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "greenhouse", status: "failed" }),
        expect.objectContaining({ provider: "lever", status: "success" }),
      ]),
    );
  });

  it("rejects empty source configuration and invalid local query limits", async () => {
    const empty = await searchRoute.POST(
      post({ criteria: {}, sources: { greenhouse: [], lever: [] } }),
    );
    expect(empty.status).toBe(400);

    const invalidLimit = await jobsRoute.GET(
      new Request("http://localhost/api/v1/jobs?maxResults=not-a-number"),
    );
    expect(invalidLimit.status).toBe(400);
  });
});
