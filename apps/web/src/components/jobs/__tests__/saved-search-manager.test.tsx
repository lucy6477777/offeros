// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SavedJobSearch } from "@offeros/job-search";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  api: { jobs: { savedSearches: mocks } },
}));

const { SavedSearchManager } = await import("../saved-search-manager");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function saved(overrides: Partial<SavedJobSearch> = {}): SavedJobSearch {
  return {
    id: "saved-1",
    name: "Remote platform roles",
    criteria: {
      query: "platform engineer",
      locationScope: "remote-us",
      unknownLocationPolicy: "include",
      maxResults: 100,
    },
    sources: {
      freehire: true,
      greenhouse: [{ company: "Acme", token: "acme" }],
      lever: [],
      ashby: [],
    },
    match: {
      skillSource: "manual",
      prioritySkills: ["TypeScript", "PostgreSQL"],
      excludedKeywords: ["contract"],
      excludedCompanies: [],
      maximumSeniority: "senior",
      eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
    },
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

describe("SavedSearchManager", () => {
  it("creates a repeatable search and ATS watchlist without exposing JSON", async () => {
    const created = saved();
    mocks.create.mockResolvedValue(created);
    const onActivate = vi.fn();
    render(
      <SavedSearchManager
        initialSavedSearches={[]}
        profileSkills={[]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={onActivate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    fireEvent.change(screen.getByLabelText("Search name"), {
      target: { value: "Remote platform roles" },
    });
    fireEvent.change(screen.getByLabelText("Saved keywords"), {
      target: { value: "platform engineer" },
    });
    expect((screen.getByLabelText("Search-specific skills only") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText("Search-specific priority skills"), {
      target: { value: "TypeScript, PostgreSQL" },
    });
    fireEvent.change(screen.getByLabelText("Excluded keywords"), {
      target: { value: "contract" },
    });
    fireEvent.change(screen.getByLabelText("Maximum title seniority"), {
      target: { value: "senior" },
    });
    fireEvent.change(screen.getByLabelText("Current US work authorization"), {
      target: { value: "authorized" },
    });
    fireEvent.change(screen.getByLabelText("Employer sponsorship need"), {
      target: { value: "required" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Greenhouse board" }));
    fireEvent.change(screen.getByLabelText("Greenhouse company 1"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByLabelText("Greenhouse board token 1"), {
      target: { value: "acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        name: "Remote platform roles",
        criteria: {
          query: "platform engineer",
          locationScope: "remote-us",
          unknownLocationPolicy: "include",
          maxResults: 100,
        },
        sources: {
          freehire: true,
          greenhouse: [{ company: "Acme", token: "acme" }],
          lever: [],
          ashby: [],
        },
        match: {
          skillSource: "manual",
          prioritySkills: ["TypeScript", "PostgreSQL"],
          excludedKeywords: ["contract"],
          excludedCompanies: [],
          maximumSeniority: "senior",
          eligibility: { usWorkAuthorization: "authorized", sponsorshipNeed: "required" },
        },
      }),
    );
    expect(onActivate).toHaveBeenCalledWith(created);
    expect(await screen.findByText("Remote platform roles")).toBeTruthy();
    expect(screen.getByText("Greenhouse · 1")).toBeTruthy();
    expect(screen.getByText("Needs sponsorship")).toBeTruthy();
    expect(screen.queryByText(/\{"/)).toBeNull();
  });

  it("explains that at least one source must remain selected", () => {
    render(
      <SavedSearchManager
        initialSavedSearches={[]}
        profileSkills={[]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "Platform" } });
    fireEvent.change(screen.getByLabelText("Saved keywords"), {
      target: { value: "platform" },
    });
    fireEvent.click(screen.getByLabelText("Search the freehire public index"));
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));

    expect(screen.getByRole("alert").textContent).toContain("Choose freehire");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("runs a saved search, reports it upstream, and shows its persisted last run", async () => {
    const completed = saved({ lastRunId: "run-1", lastRunAt: 30, updatedAt: 30 });
    const result = {
      savedSearch: completed,
      run: {
        id: "run-1",
        criteria: completed.criteria,
        providerRuns: [],
        stages: [],
        status: "success" as const,
        resultCount: 2,
        startedAt: 20,
        finishedAt: 30,
      },
      postings: [],
      providerRuns: [],
      stages: [],
    };
    mocks.run.mockResolvedValue(result);
    const onRunComplete = vi.fn().mockResolvedValue(undefined);
    const onActivate = vi.fn();
    render(
      <SavedSearchManager
        initialSavedSearches={[saved()]}
        profileSkills={[]}
        onRunComplete={onRunComplete}
        activeSearchId={null}
        onActivate={onActivate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith("saved-1"));
    expect(onRunComplete).toHaveBeenCalledWith(result);
    expect(onActivate).toHaveBeenCalledWith(completed);
    expect(await screen.findByText(/Last run: Jan 1, 1970/)).toBeTruthy();
  });

  it("replaces an edited definition and can delete the saved search", async () => {
    const updated = saved({ name: "Senior platform roles", updatedAt: 20 });
    mocks.update.mockResolvedValue(updated);
    mocks.remove.mockResolvedValue({ id: "saved-1" });
    render(
      <SavedSearchManager
        initialSavedSearches={[saved()]}
        profileSkills={[]}
        onRunComplete={vi.fn()}
        activeSearchId="saved-1"
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Search name"), {
      target: { value: "Senior platform roles" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("saved-1", expect.any(Object)));
    expect(await screen.findByText("Senior platform roles")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete Senior platform roles" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("saved-1"));
    expect(screen.getByText(/No saved searches yet/)).toBeTruthy();
  });

  it("activates a saved search for deterministic shortlist viewing", () => {
    const onActivate = vi.fn();
    const search = saved();
    render(
      <SavedSearchManager
        initialSavedSearches={[search]}
        profileSkills={[]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={onActivate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View shortlist" }));

    expect(onActivate).toHaveBeenCalledWith(search);
    expect(screen.getByText("2 custom skills")).toBeTruthy();
    expect(screen.getByText("1 exclusions")).toBeTruthy();
  });

  it("defaults a new search to live Profile skills and never copies their snapshot", async () => {
    const created = saved({
      match: {
        ...saved().match,
        skillSource: "profile",
        prioritySkills: [],
      },
    });
    mocks.create.mockResolvedValue(created);
    render(
      <SavedSearchManager
        initialSavedSearches={[]}
        profileSkills={["TypeScript", "PostgreSQL"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    expect((screen.getByLabelText("My Profile skills") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Search-specific priority skills")).toBeNull();
    expect(screen.getByText(/Using 2 Profile skills for ranking/).textContent).toContain(
      "TypeScript, PostgreSQL",
    );
    expect(screen.getByRole("link", { name: "Edit Profile skills" }).getAttribute("href")).toBe(
      "/profile",
    );

    fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "Profile fit" } });
    fireEvent.change(screen.getByLabelText("Saved keywords"), {
      target: { value: "platform engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0].match).toMatchObject({
      skillSource: "profile",
      prioritySkills: [],
    });
    expect(screen.getByText("Profile skills")).toBeTruthy();
  });

  it("combines live Profile skills with persisted search-specific additions", async () => {
    const created = saved({
      match: {
        ...saved().match,
        skillSource: "combined",
        prioritySkills: ["Rust", "Go"],
      },
    });
    mocks.create.mockResolvedValue(created);
    render(
      <SavedSearchManager
        initialSavedSearches={[]}
        profileSkills={["TypeScript"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    fireEvent.click(screen.getByLabelText("Profile + search-specific skills"));
    fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "Combined fit" } });
    fireEvent.change(screen.getByLabelText("Saved keywords"), {
      target: { value: "platform engineer" },
    });
    fireEvent.change(screen.getByLabelText("Search-specific skill additions"), {
      target: { value: "Rust, Go" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0].match).toMatchObject({
      skillSource: "combined",
      prioritySkills: ["Rust", "Go"],
    });
    expect(screen.getByText("Profile + 2 custom")).toBeTruthy();
  });

  it("warns about an empty Profile but allows the user to save that live source", async () => {
    const created = saved({
      match: { ...saved().match, skillSource: "profile", prioritySkills: [] },
    });
    mocks.create.mockResolvedValue(created);
    render(
      <SavedSearchManager
        initialSavedSearches={[]}
        profileSkills={[]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New saved search" }));
    expect((screen.getByLabelText("Search-specific skills only") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByLabelText("My Profile skills"));
    expect(screen.getByRole("status").textContent).toContain("no usable skills");
    expect(screen.getByRole("link", { name: "Add skills to Profile" }).getAttribute("href")).toBe(
      "/profile",
    );
    fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "Future fit" } });
    fireEvent.change(screen.getByLabelText("Saved keywords"), {
      target: { value: "platform engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0].match.skillSource).toBe("profile");
  });

  it("keeps parsed legacy searches manual and preserves hidden custom skills in Profile mode", async () => {
    const legacy = saved();
    const updated = saved({
      match: { ...legacy.match, skillSource: "profile" },
      updatedAt: 20,
    });
    mocks.update.mockResolvedValue(updated);
    render(
      <SavedSearchManager
        initialSavedSearches={[legacy]}
        profileSkills={["TypeScript"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Search-specific skills only") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Search-specific priority skills") as HTMLInputElement).value,
    ).toBe("TypeScript, PostgreSQL");
    fireEvent.click(screen.getByLabelText("My Profile skills"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![1].match).toMatchObject({
      skillSource: "profile",
      prioritySkills: ["TypeScript", "PostgreSQL"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("My Profile skills") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Search-specific priority skills")).toBeNull();
    fireEvent.click(screen.getByLabelText("Search-specific skills only"));
    expect(
      (screen.getByLabelText("Search-specific priority skills") as HTMLInputElement).value,
    ).toBe("TypeScript, PostgreSQL");
  });

  it("shows when only one Profile skill fits after 49 search-specific additions", () => {
    const customSkills = Array.from({ length: 49 }, (_, index) => `Custom ${index}`);
    render(
      <SavedSearchManager
        initialSavedSearches={[
          saved({
            match: { ...saved().match, skillSource: "combined", prioritySkills: customSkills },
          }),
        ]}
        profileSkills={["Profile A", "Profile B"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Using 1 Profile skill for ranking/).textContent).toContain(
      "Profile A",
    );
    expect(
      screen.getByText(/1 Profile skill is excluded by the 50-skill ranking limit/).textContent,
    ).toContain("Profile B");
  });

  it("shows when 50 search-specific additions leave no room for Profile skills", () => {
    const customSkills = Array.from({ length: 50 }, (_, index) => `Custom ${index}`);
    render(
      <SavedSearchManager
        initialSavedSearches={[
          saved({
            match: { ...saved().match, skillSource: "combined", prioritySkills: customSkills },
          }),
        ]}
        profileSkills={["Profile A"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("No Profile skills are currently included in ranking.")).toBeTruthy();
    expect(
      screen.getByText(/1 Profile skill is excluded by the 50-skill ranking limit/),
    ).toBeTruthy();
  });

  it("counts only unique Profile contributions when sources overlap", () => {
    render(
      <SavedSearchManager
        initialSavedSearches={[
          saved({
            match: {
              ...saved().match,
              skillSource: "combined",
              prioritySkills: ["TypeScript"],
            },
          }),
        ]}
        profileSkills={["typescript", "PostgreSQL"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const preview = screen.getByText(/Using 1 Profile skill for ranking/);
    expect(preview.textContent).toContain("PostgreSQL");
    expect(preview.textContent).not.toContain("typescript");
    expect(screen.getByText(/1 Profile skill is already covered/).textContent).toContain(
      "typescript",
    );
    expect(screen.queryByText(/excluded by the 50-skill ranking limit/)).toBeNull();
  });

  it("reports included, covered, and limited Profile skills separately in a mixed case", () => {
    const manualSkills = [
      "Node.js",
      ...Array.from({ length: 48 }, (_, index) => `Custom ${index}`),
    ];
    render(
      <SavedSearchManager
        initialSavedSearches={[
          saved({
            match: { ...saved().match, skillSource: "combined", prioritySkills: manualSkills },
          }),
        ]}
        profileSkills={["NodeJS", "Profile A", "Profile B"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Using 1 Profile skill for ranking/).textContent).toContain(
      "Profile A",
    );
    expect(screen.getByText(/1 Profile skill is already covered/).textContent).toContain("NodeJS");
    expect(
      screen.getByText(/1 Profile skill is excluded by the 50-skill ranking limit/).textContent,
    ).toContain("Profile B");
  });

  it("deduplicates many manual aliases before applying the combined skill limit", () => {
    const aliases = Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0 ? "Node.js" : "NodeJS",
    );
    render(
      <SavedSearchManager
        initialSavedSearches={[
          saved({
            match: { ...saved().match, skillSource: "combined", prioritySkills: aliases },
          }),
        ]}
        profileSkills={["PostgreSQL"]}
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Using 1 Profile skill for ranking/).textContent).toContain(
      "PostgreSQL",
    );
    expect(screen.queryByText(/excluded by the 50-skill ranking limit/)).toBeNull();
  });
});
