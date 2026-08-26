import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  savedJobSearchDefinitionSchema,
  type SavedJobSearch,
  type SavedJobSearchDefinition,
} from "@offeros/job-search";
import type { Db } from "../db/client";
import { savedJobSearches } from "../db/schema";

type Row = typeof savedJobSearches.$inferSelect;

function toSavedSearch(row: Row): SavedJobSearch {
  const definition = savedJobSearchDefinitionSchema.parse({
    name: row.name,
    criteria: row.criteria,
    sources: row.sources,
    match: row.matchPreferences,
  });
  return {
    id: row.id,
    ...definition,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.lastRunId ? { lastRunId: row.lastRunId } : {}),
    ...(row.lastRunAt !== null ? { lastRunAt: row.lastRunAt } : {}),
  };
}

export function listSavedJobSearches(db: Db): SavedJobSearch[] {
  return db
    .select()
    .from(savedJobSearches)
    .orderBy(desc(savedJobSearches.updatedAt))
    .all()
    .map(toSavedSearch);
}

export function getSavedJobSearch(db: Db, id: string): SavedJobSearch | null {
  const row = db.select().from(savedJobSearches).where(eq(savedJobSearches.id, id)).get();
  return row ? toSavedSearch(row) : null;
}

export function createSavedJobSearch(
  db: Db,
  input: SavedJobSearchDefinition,
  options: { id?: string; now?: number } = {},
): SavedJobSearch {
  const definition = savedJobSearchDefinitionSchema.parse(input);
  const now = options.now ?? Date.now();
  const row: Row = {
    id: options.id ?? randomUUID(),
    name: definition.name,
    criteria: definition.criteria,
    sources: definition.sources,
    matchPreferences: definition.match,
    lastRunId: null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(savedJobSearches).values(row).run();
  return toSavedSearch(row);
}

/** Saved-search edits replace the definition as one validated document. This
 * avoids stale ATS rows surviving when a user removes a source in the UI. */
export function updateSavedJobSearch(
  db: Db,
  id: string,
  input: SavedJobSearchDefinition,
  now = Date.now(),
): SavedJobSearch | null {
  const existing = db.select().from(savedJobSearches).where(eq(savedJobSearches.id, id)).get();
  if (!existing) return null;
  const definition = savedJobSearchDefinitionSchema.parse(input);
  db.update(savedJobSearches)
    .set({
      name: definition.name,
      criteria: definition.criteria,
      sources: definition.sources,
      matchPreferences: definition.match,
      updatedAt: now,
    })
    .where(eq(savedJobSearches.id, id))
    .run();
  return toSavedSearch({
    ...existing,
    name: definition.name,
    criteria: definition.criteria,
    sources: definition.sources,
    matchPreferences: definition.match,
    updatedAt: now,
  });
}

export function deleteSavedJobSearch(db: Db, id: string): boolean {
  if (!getSavedJobSearch(db, id)) return false;
  db.delete(savedJobSearches).where(eq(savedJobSearches.id, id)).run();
  return true;
}

/** Link a completed, already-persisted run back to its reusable definition. */
export function recordSavedJobSearchRun(
  db: Db,
  id: string,
  run: { id: string; finishedAt: number },
): SavedJobSearch | null {
  const existing = db.select().from(savedJobSearches).where(eq(savedJobSearches.id, id)).get();
  if (!existing) return null;
  const row = {
    ...existing,
    lastRunId: run.id,
    lastRunAt: run.finishedAt,
    updatedAt: run.finishedAt,
  };
  db.update(savedJobSearches)
    .set({ lastRunId: run.id, lastRunAt: run.finishedAt, updatedAt: run.finishedAt })
    .where(eq(savedJobSearches.id, id))
    .run();
  return toSavedSearch(row);
}
