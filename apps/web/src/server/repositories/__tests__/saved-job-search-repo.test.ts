import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import {
  createSavedJobSearch,
  deleteSavedJobSearch,
  getSavedJobSearch,
  listSavedJobSearches,
  recordSavedJobSearchRun,
  updateSavedJobSearch,
} from "../saved-job-search-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-saved-search-repo-"));
  db = createDb(join(dir, "search.db"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const definition = {
  name: "Remote platform roles",
  criteria: {
    query: "platform engineer",
    locationScope: "remote-us" as const,
    unknownLocationPolicy: "include" as const,
  },
  sources: {
    freehire: true,
    greenhouse: [{ token: "acme", company: "Acme" }],
    lever: [],
    ashby: [],
  },
};

describe("saved-job-search repository", () => {
  it("creates, lists, edits, and deletes a validated search", () => {
    const created = createSavedJobSearch(db, definition, { id: "saved-1", now: 10 });
    expect(created).toMatchObject({ id: "saved-1", createdAt: 10, updatedAt: 10 });
    expect(listSavedJobSearches(db)).toEqual([created]);

    const updated = updateSavedJobSearch(
      db,
      created.id,
      {
        ...definition,
        name: "US platform roles",
        sources: {
          freehire: false,
          greenhouse: [],
          lever: [],
          ashby: [{ name: "beta", company: "Beta" }],
        },
      },
      20,
    );
    expect(updated).toMatchObject({ name: "US platform roles", updatedAt: 20 });
    expect(updated?.sources.ashby).toEqual([{ name: "beta", company: "Beta" }]);

    expect(deleteSavedJobSearch(db, created.id)).toBe(true);
    expect(deleteSavedJobSearch(db, created.id)).toBe(false);
    expect(getSavedJobSearch(db, created.id)).toBeNull();
  });

  it("records the latest completed run without losing the definition", () => {
    createSavedJobSearch(db, definition, { id: "saved-1", now: 10 });
    const updated = recordSavedJobSearchRun(db, "saved-1", { id: "run-1", finishedAt: 30 });

    expect(updated).toMatchObject({
      id: "saved-1",
      name: definition.name,
      lastRunId: "run-1",
      lastRunAt: 30,
      updatedAt: 30,
    });
    expect(recordSavedJobSearchRun(db, "missing", { id: "run-2", finishedAt: 40 })).toBeNull();
  });

  it("rejects invalid source-free definitions before writing", () => {
    expect(() =>
      createSavedJobSearch(db, {
        ...definition,
        sources: { freehire: false, greenhouse: [], lever: [], ashby: [] },
      }),
    ).toThrow(/at least one job source is required/);
    expect(listSavedJobSearches(db)).toEqual([]);
  });
});
