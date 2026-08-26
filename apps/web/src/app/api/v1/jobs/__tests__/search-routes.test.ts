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
  if (url.includes("api.ashbyhq.com")) {
    return Response.json({
      apiVersion: "1",
      jobs: [
        {
          id: "ashby-303",
          title: "Security Engineer",
          location: "Remote",
          address: { postalAddress: { addressCountry: "United States" } },
          workplaceType: "Remote",
          isListed: true,
          descriptionPlain: "Secure cloud infrastructure.",
          publishedAt: "2026-08-24T08:00:00Z",
          jobUrl: "https://jobs.ashbyhq.com/gamma/ashby-303",
          applyUrl: "https://jobs.ashbyhq.com/gamma/ashby-303/application",
        },
      ],
    });
  }
  if (url.includes("freehire.me/api/v1/agent/jobs/search")) {
    return Response.json({
      data: [
        {
          public_slug: "data-engineer-delta-404",
          source: "workable",
          url: "https://jobs.example.com/delta/404?utm_source=freehire.me",
          title: "Data Engineer",
          company: "Delta",
          location: "United States",
          countries: ["us"],
          work_mode: "remote",
          description: "Build data pipelines.",
          posted_at: "2026-08-23T08:00:00Z",
        },
      ],
      meta: { limit: 100, offset: 0, total: 1 },
    });
  }
  return new Response("not found", { status: 404 });
});

const jobsRoute = await import("../route");
const searchRoute = await import("../search/route");
const savedSearchesRoute = await import("../saved-searches/route");
const savedSearchRoute = await import("../saved-searches/[id]/route");
const savedSearchRunRoute = await import("../saved-searches/[id]/run/route");

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
  ashby: [{ name: "gamma", company: "Gamma" }],
  freehire: true,
};

describe("job search routes", () => {
  it("searches two providers, persists the run, and queries canonical jobs locally", async () => {
    const response = await searchRoute.POST(post({ criteria: {}, sources: SOURCES }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.run).toMatchObject({ status: "success", resultCount: 4 });
    expect(body.result.postings).toHaveLength(4);
    expect(
      body.result.providerRuns.map((run: { provider: string }) => run.provider).sort(),
    ).toEqual(["ashby", "freehire", "greenhouse", "lever"]);

    const jobs = await (
      await jobsRoute.GET(
        new Request("http://localhost/api/v1/jobs?query=platform%20typescript&maxResults=5"),
      )
    ).json();
    expect(jobs.result).toHaveLength(1);
    expect(jobs.result[0].posting).toMatchObject({ company: "Acme", workplace: "remote" });

    const strictRemoteUs = await (
      await jobsRoute.GET(
        new Request(
          "http://localhost/api/v1/jobs?locationScope=remote-us&unknownLocationPolicy=exclude",
        ),
      )
    ).json();
    expect(strictRemoteUs.result).toHaveLength(3);
    expect(
      strictRemoteUs.result.every(
        (stored: { posting: { workplace: string } }) => stored.posting.workplace === "remote",
      ),
    ).toBe(true);

    const history = await (
      await searchRoute.GET(new Request("http://localhost/api/v1/jobs/search?limit=10"))
    ).json();
    expect(history.result.runs).toHaveLength(1);
    expect(history.result.sourceHealth).toHaveLength(4);
  });

  it("persists a partial run when one provider is temporarily unavailable", async () => {
    greenhouseFails = true;
    const response = await searchRoute.POST(post({ criteria: {}, sources: SOURCES }));
    greenhouseFails = false;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.run).toMatchObject({ status: "partial", resultCount: 3 });
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

describe("saved job search routes", () => {
  it("creates, edits, runs, lists, and deletes an ATS watchlist", async () => {
    const definition = {
      name: "Remote platform roles",
      criteria: {
        query: "engineer",
        locationScope: "remote-us",
        unknownLocationPolicy: "include",
        maxResults: 100,
      },
      sources: SOURCES,
    };
    const createdResponse = await savedSearchesRoute.POST(
      new Request("http://localhost/api/v1/jobs/saved-searches", {
        method: "POST",
        body: JSON.stringify(definition),
      }),
    );
    const created = (await createdResponse.json()).result;
    expect(createdResponse.status).toBe(200);
    expect(created).toMatchObject({ name: definition.name, criteria: definition.criteria });

    const editedResponse = await savedSearchRoute.PUT(
      new Request(`http://localhost/api/v1/jobs/saved-searches/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...definition, name: "US engineering roles" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect((await editedResponse.json()).result.name).toBe("US engineering roles");

    const runResponse = await savedSearchRunRoute.POST(
      new Request(`http://localhost/api/v1/jobs/saved-searches/${created.id}/run`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const run = (await runResponse.json()).result;
    expect(runResponse.status).toBe(200);
    expect(run.run).toMatchObject({ status: "success", resultCount: 3 });
    expect(run.savedSearch).toMatchObject({
      id: created.id,
      name: "US engineering roles",
      lastRunId: run.run.id,
      lastRunAt: run.run.finishedAt,
    });

    const listed = await (await savedSearchesRoute.GET()).json();
    expect(listed.result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );

    const deleted = await savedSearchRoute.DELETE(
      new Request(`http://localhost/api/v1/jobs/saved-searches/${created.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(deleted.status).toBe(200);
    const missing = await savedSearchRunRoute.POST(
      new Request(`http://localhost/api/v1/jobs/saved-searches/${created.id}/run`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(missing.status).toBe(404);
  });

  it("rejects a source-free saved search", async () => {
    const response = await savedSearchesRoute.POST(
      new Request("http://localhost/api/v1/jobs/saved-searches", {
        method: "POST",
        body: JSON.stringify({
          name: "No source",
          criteria: { query: "engineer" },
          sources: {},
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
