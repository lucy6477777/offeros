import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError, isLlmNotConfigured } from "../api-client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  // A fresh Response per call — a fetch Response body can only be read once,
  // and mockResolvedValue would hand back the same instance on every call.
  const fetchMock = vi.fn().mockImplementation(
    () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api client", () => {
  it("unwraps the envelope result", async () => {
    stubFetch({ success: true, errorCode: 10000, errorMsg: null, result: [{ id: "a" }] });
    const events = await api.applications.events("a");
    expect(events).toEqual([{ id: "a" }]);
  });

  it("calls the right url and method for a create", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { id: "x" },
    });
    await api.pipelineTasks.create({ applicationId: "app-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/agent/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ applicationId: "app-1" });
  });

  it("throws ApiError carrying the error code when success is false", async () => {
    stubFetch(
      { success: false, errorCode: 40400, errorMsg: "application not found", result: null },
      404,
    );
    await expect(api.pipelineTasks.get("missing")).rejects.toMatchObject({
      name: "ApiError",
      code: 40400,
    });
    await expect(api.pipelineTasks.get("missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("settings.llmKeys calls the right url", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { anthropic: "saved", openai: "none" },
    });
    const status = await api.settings.llmKeys();
    expect(status).toEqual({ anthropic: "saved", openai: "none" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/settings/llm-keys");
    expect(init.method).toBeUndefined();
  });

  it("settings.setLlmKey PUTs provider and key", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { anthropic: "saved" },
    });
    await api.settings.setLlmKey("anthropic", "abc");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/settings/llm-keys");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ provider: "anthropic", key: "abc" });
  });

  it("settings.testLlm POSTs provider/model/key", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { ok: true },
    });
    const res = await api.settings.testLlm({ provider: "openai", model: "gpt-4o", key: "k" });
    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/settings/test-llm");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ provider: "openai", model: "gpt-4o", key: "k" });
  });

  it("jobs.list serializes local catalogue filters", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: [],
    });

    await api.jobs.list({
      query: "platform engineer",
      locationScope: "remote-us",
      unknownLocationPolicy: "exclude",
      maxResults: 25,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "/api/v1/jobs?query=platform+engineer&locationScope=remote-us&unknownLocationPolicy=exclude&maxResults=25",
    );
    expect(init.method).toBeUndefined();
  });

  it("jobs.searchPublic uses only the broad public source", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { run: { id: "run-1" }, postings: [], providerRuns: [], stages: [] },
    });

    await api.jobs.searchPublic({ query: "ML engineer", locationScope: "remote-us" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/jobs/search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      criteria: { query: "ML engineer", locationScope: "remote-us" },
      sources: { freehire: true },
    });
  });

  it("jobs.savedSearches uses CRUD and explicit run endpoints", async () => {
    const fetchMock = stubFetch({
      success: true,
      errorCode: 10000,
      errorMsg: null,
      result: { id: "saved-1" },
    });
    const definition = {
      name: "Remote AI roles",
      criteria: { query: "ML engineer" },
      sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
      match: {
        prioritySkills: [],
        excludedKeywords: [],
        excludedCompanies: [],
        eligibility: {
          usWorkAuthorization: "unknown" as const,
          sponsorshipNeed: "unknown" as const,
        },
      },
    };

    await api.jobs.savedSearches.create(definition);
    await api.jobs.savedSearches.update("saved-1", definition);
    await api.jobs.savedSearches.run("saved-1");
    await api.jobs.savedSearches.remove("saved-1");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/jobs/saved-searches",
      "/api/v1/jobs/saved-searches/saved-1",
      "/api/v1/jobs/saved-searches/saved-1/run",
      "/api/v1/jobs/saved-searches/saved-1",
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
      "POST",
      "PUT",
      "POST",
      "DELETE",
    ]);
  });
});

describe("isLlmNotConfigured", () => {
  it("is true only for an ApiError carrying code 42000", () => {
    expect(isLlmNotConfigured(new ApiError("no key", 42000))).toBe(true);
    expect(isLlmNotConfigured(new ApiError("bad request", 40000))).toBe(false);
    expect(isLlmNotConfigured(new Error("no key"))).toBe(false);
    expect(isLlmNotConfigured(null)).toBe(false);
  });
});
