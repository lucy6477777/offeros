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
    fireEvent.change(screen.getByLabelText("Priority skills"), {
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
        onRunComplete={vi.fn()}
        activeSearchId={null}
        onActivate={onActivate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View shortlist" }));

    expect(onActivate).toHaveBeenCalledWith(search);
    expect(screen.getByText("2 priority skills")).toBeTruthy();
    expect(screen.getByText("1 exclusions")).toBeTruthy();
  });
});
