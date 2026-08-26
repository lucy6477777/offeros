import { describe, expect, it } from "vitest";
import { createCapturedJobPosting } from "../capture";

describe("captured job normalization", () => {
  it("turns a browser capture into a stable canonical posting", () => {
    const posting = createCapturedJobPosting({
      source: "browser",
      url: "https://jobs.example.com/acme/123/?utm_source=panel&igshid=abc#apply",
      title: " Platform Engineer ",
      company: " Acme ",
      location: "Remote, United States",
      description: "Build TypeScript services.",
      fetchedAt: 42,
    });

    expect(posting).toMatchObject({
      id: expect.stringMatching(/^capture:/),
      title: "Platform Engineer",
      company: "Acme",
      workplace: "remote",
      applyUrl: "https://jobs.example.com/acme/123",
      liveness: "unknown",
    });
    expect(posting.sources[0]).toEqual({
      provider: "browser-capture",
      kind: "browser",
      externalId: posting.id.replace("capture:", ""),
      sourceUrl: "https://jobs.example.com/acme/123/?utm_source=panel&igshid=abc#apply",
      applyUrl: "https://jobs.example.com/acme/123",
      fetchedAt: 42,
    });
  });

  it("gives manual and browser captures of the same URL the same job identity", () => {
    const base = {
      url: "https://jobs.example.com/acme/123",
      title: "Engineer",
      company: "Acme",
    };
    const manual = createCapturedJobPosting({ ...base, source: "manual" });
    const browser = createCapturedJobPosting({ ...base, source: "browser" });

    expect(manual.id).toBe(browser.id);
    expect(manual.sources[0]!.provider).toBe("manual-url");
    expect(browser.sources[0]!.provider).toBe("browser-capture");
  });

  it("rejects non-web page URLs", () => {
    expect(() =>
      createCapturedJobPosting({
        source: "browser",
        url: "chrome://extensions",
        title: "Not a posting",
        company: "Browser",
      }),
    ).toThrow(/HTTP or HTTPS/);
  });
});
