"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { hasConfiguredJobSource } from "@offeros/job-search";
import type {
  JobLocationScope,
  SavedJobSearch,
  SavedJobSearchDefinition,
} from "@offeros/job-search";
import { api, type SavedJobSearchRunResult } from "@/lib/api-client";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const EMPTY_DEFINITION: SavedJobSearchDefinition = {
  name: "",
  criteria: {
    query: "",
    locationScope: "remote-us",
    unknownLocationPolicy: "include",
    maxResults: 100,
  },
  sources: { freehire: true, greenhouse: [], lever: [], ashby: [] },
};

function cloneDefinition(search?: SavedJobSearch): SavedJobSearchDefinition {
  if (!search) return structuredClone(EMPTY_DEFINITION);
  return {
    name: search.name,
    criteria: { ...search.criteria },
    sources: {
      freehire: search.sources.freehire,
      greenhouse: search.sources.greenhouse.map((board) => ({ ...board })),
      lever: search.sources.lever.map((site) => ({ ...site })),
      ashby: search.sources.ashby.map((board) => ({ ...board })),
    },
  };
}

function sourceSummary(search: SavedJobSearch): string[] {
  const labels: string[] = [];
  if (search.sources.freehire) labels.push("freehire");
  if (search.sources.greenhouse.length > 0) {
    labels.push(`Greenhouse · ${search.sources.greenhouse.length}`);
  }
  if (search.sources.lever.length > 0) labels.push(`Lever · ${search.sources.lever.length}`);
  if (search.sources.ashby.length > 0) labels.push(`Ashby · ${search.sources.ashby.length}`);
  return labels;
}

function removeAt<T>(values: T[], index: number): T[] {
  return values.filter((_, current) => current !== index);
}

export function SavedSearchManager({
  initialSavedSearches,
  onRunComplete,
}: {
  initialSavedSearches: SavedJobSearch[];
  onRunComplete: (result: SavedJobSearchRunResult) => Promise<void>;
}) {
  const [searches, setSearches] = useState(initialSavedSearches);
  const [draft, setDraft] = useState<SavedJobSearchDefinition | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{
    id: string;
    action: "save" | "run" | "delete";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setEditingId(null);
    setDraft(cloneDefinition());
    setError(null);
  }

  function startEdit(search: SavedJobSearch) {
    setEditingId(search.id);
    setDraft(cloneDefinition(search));
    setError(null);
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    if (!hasConfiguredJobSource(draft.sources)) {
      setError("Choose freehire or add at least one company ATS board.");
      return;
    }
    setBusy({ id: editingId ?? "create", action: "save" });
    setError(null);
    try {
      const saved = editingId
        ? await api.jobs.savedSearches.update(editingId, draft)
        : await api.jobs.savedSearches.create(draft);
      setSearches((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this search.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(search: SavedJobSearch) {
    if (busy) return;
    setBusy({ id: search.id, action: "delete" });
    setError(null);
    try {
      await api.jobs.savedSearches.remove(search.id);
      setSearches((current) => current.filter((item) => item.id !== search.id));
      if (editingId === search.id) closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this search.");
    } finally {
      setBusy(null);
    }
  }

  async function run(search: SavedJobSearch) {
    if (busy) return;
    setBusy({ id: search.id, action: "run" });
    setError(null);
    try {
      const result = await api.jobs.savedSearches.run(search.id);
      setSearches((current) => [
        result.savedSearch,
        ...current.filter((item) => item.id !== result.savedSearch.id),
      ]);
      await onRunComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run this search.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-foreground">Saved searches</h2>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            Watch public company boards and run the same search again without configuring JSON.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          disabled={Boolean(busy)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-body font-semibold text-foreground press hover:bg-muted disabled:opacity-50"
        >
          <Plus aria-hidden className="size-4" />
          New saved search
        </button>
      </div>

      {draft && (
        <form onSubmit={(event) => void save(event)} className="mt-5 rounded-xl bg-muted/45 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-body-lg font-semibold text-foreground">
              {editingId ? "Edit saved search" : "Create saved search"}
            </h3>
            <button
              type="button"
              onClick={closeEditor}
              aria-label="Close saved search editor"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-muted-foreground">
                Search name
              </span>
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Remote AI roles"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-muted-foreground">
                Saved keywords
              </span>
              <input
                required
                maxLength={200}
                value={draft.criteria.query}
                onChange={(event) =>
                  setDraft({ ...draft, criteria: { ...draft.criteria, query: event.target.value } })
                }
                placeholder="ML engineer, LLM, Python…"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-muted-foreground">
                Saved location
              </span>
              <select
                value={draft.criteria.locationScope ?? "any"}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    criteria: {
                      ...draft.criteria,
                      locationScope: event.target.value as JobLocationScope,
                    },
                  })
                }
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="remote-us">Remote · United States</option>
                <option value="united-states">United States</option>
                <option value="any">Anywhere</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-caption text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.criteria.unknownLocationPolicy !== "exclude"}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    criteria: {
                      ...draft.criteria,
                      unknownLocationPolicy: event.target.checked ? "include" : "exclude",
                    },
                  })
                }
                className="size-4 rounded border-border"
              />
              Include jobs whose location is unclear
            </label>
          </div>

          <fieldset className="mt-5 border-t border-border pt-4">
            <legend className="text-body font-semibold text-foreground">Sources to watch</legend>
            <label className="mt-3 inline-flex items-center gap-2 text-body text-foreground">
              <input
                type="checkbox"
                checked={draft.sources.freehire}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    sources: { ...draft.sources, freehire: event.target.checked },
                  })
                }
                className="size-4 rounded border-border"
              />
              Search the freehire public index
            </label>

            <div className="mt-4 space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-body font-medium text-foreground">Greenhouse boards</p>
                    <p className="text-caption text-muted-foreground">
                      Token is the part after boards.greenhouse.io/ in the company URL.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sources: {
                          ...draft.sources,
                          greenhouse: [...draft.sources.greenhouse, { company: "", token: "" }],
                        },
                      })
                    }
                    className="text-caption font-semibold text-primary hover:underline"
                  >
                    Add Greenhouse board
                  </button>
                </div>
                {draft.sources.greenhouse.map((board, index) => (
                  <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      required
                      aria-label={`Greenhouse company ${index + 1}`}
                      value={board.company}
                      onChange={(event) => {
                        const greenhouse = [...draft.sources.greenhouse];
                        greenhouse[index] = { ...board, company: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, greenhouse } });
                      }}
                      placeholder="Company name"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      required
                      aria-label={`Greenhouse board token ${index + 1}`}
                      value={board.token}
                      onChange={(event) => {
                        const greenhouse = [...draft.sources.greenhouse];
                        greenhouse[index] = { ...board, token: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, greenhouse } });
                      }}
                      placeholder="Board token"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sources: {
                            ...draft.sources,
                            greenhouse: removeAt(draft.sources.greenhouse, index),
                          },
                        })
                      }
                      aria-label={`Remove Greenhouse board ${index + 1}`}
                      className="justify-self-start rounded-full p-2 text-muted-foreground hover:bg-background hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-body font-medium text-foreground">Lever sites</p>
                    <p className="text-caption text-muted-foreground">
                      Site slug is the part after jobs.lever.co/ in the company URL.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sources: {
                          ...draft.sources,
                          lever: [
                            ...draft.sources.lever,
                            { company: "", site: "", region: "global" },
                          ],
                        },
                      })
                    }
                    className="text-caption font-semibold text-primary hover:underline"
                  >
                    Add Lever site
                  </button>
                </div>
                {draft.sources.lever.map((site, index) => (
                  <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_120px_auto]">
                    <input
                      required
                      aria-label={`Lever company ${index + 1}`}
                      value={site.company}
                      onChange={(event) => {
                        const lever = [...draft.sources.lever];
                        lever[index] = { ...site, company: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, lever } });
                      }}
                      placeholder="Company name"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      required
                      aria-label={`Lever site slug ${index + 1}`}
                      value={site.site}
                      onChange={(event) => {
                        const lever = [...draft.sources.lever];
                        lever[index] = { ...site, site: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, lever } });
                      }}
                      placeholder="Site slug"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <select
                      aria-label={`Lever region ${index + 1}`}
                      value={site.region ?? "global"}
                      onChange={(event) => {
                        const lever = [...draft.sources.lever];
                        lever[index] = { ...site, region: event.target.value as "global" | "eu" };
                        setDraft({ ...draft, sources: { ...draft.sources, lever } });
                      }}
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="global">Global</option>
                      <option value="eu">EU</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sources: {
                            ...draft.sources,
                            lever: removeAt(draft.sources.lever, index),
                          },
                        })
                      }
                      aria-label={`Remove Lever site ${index + 1}`}
                      className="justify-self-start rounded-full p-2 text-muted-foreground hover:bg-background hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-body font-medium text-foreground">Ashby boards</p>
                    <p className="text-caption text-muted-foreground">
                      Board name is the part after jobs.ashbyhq.com/ in the company URL.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        sources: {
                          ...draft.sources,
                          ashby: [...draft.sources.ashby, { company: "", name: "" }],
                        },
                      })
                    }
                    className="text-caption font-semibold text-primary hover:underline"
                  >
                    Add Ashby board
                  </button>
                </div>
                {draft.sources.ashby.map((board, index) => (
                  <div key={index} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      required
                      aria-label={`Ashby company ${index + 1}`}
                      value={board.company}
                      onChange={(event) => {
                        const ashby = [...draft.sources.ashby];
                        ashby[index] = { ...board, company: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, ashby } });
                      }}
                      placeholder="Company name"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      required
                      aria-label={`Ashby board name ${index + 1}`}
                      value={board.name}
                      onChange={(event) => {
                        const ashby = [...draft.sources.ashby];
                        ashby[index] = { ...board, name: event.target.value };
                        setDraft({ ...draft, sources: { ...draft.sources, ashby } });
                      }}
                      placeholder="Board name"
                      className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          sources: {
                            ...draft.sources,
                            ashby: removeAt(draft.sources.ashby, index),
                          },
                        })
                      }
                      aria-label={`Remove Ashby board ${index + 1}`}
                      className="justify-self-start rounded-full p-2 text-muted-foreground hover:bg-background hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={Boolean(busy)}
              className="rounded-full bg-primary px-5 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
            >
              {busy?.action === "save" ? "Saving…" : editingId ? "Save changes" : "Save search"}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="text-body font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-body text-destructive"
        >
          {error}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {searches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-body text-muted-foreground">
            No saved searches yet. Add one to keep company ATS boards and criteria together.
          </p>
        ) : (
          searches.map((search) => (
            <article key={search.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-body-lg font-semibold text-foreground">{search.name}</h3>
                  <p className="mt-1 text-body text-muted-foreground">
                    {search.criteria.query} · {search.criteria.locationScope ?? "anywhere"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sourceSummary(search).map((source) => (
                      <span
                        key={source}
                        className="rounded-full bg-muted px-2.5 py-1 text-caption text-foreground"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-caption text-muted-foreground">
                    Last run:{" "}
                    {search.lastRunAt ? DATE_TIME.format(search.lastRunAt) : "Not run yet"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void run(search)}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
                  >
                    <Play aria-hidden className="size-3.5" />
                    {busy?.id === search.id && busy.action === "run" ? "Running…" : "Run now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(search)}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-caption font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <Pencil aria-hidden className="size-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(search)}
                    disabled={Boolean(busy)}
                    aria-label={`Delete ${search.name}`}
                    className="rounded-full border border-border p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
