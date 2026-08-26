import { z } from "zod";
import { jobSearchCriteriaSchema } from "./types";
import { jobMatchPreferencesSchema } from "./match";
import type { GreenhouseBoard } from "./providers/greenhouse";
import type { LeverSite } from "./providers/lever";
import type { AshbyBoard } from "./providers/ashby";

export const greenhouseBoardSchema: z.ZodType<GreenhouseBoard> = z
  .object({
    token: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
  })
  .strict();

export const leverSiteSchema: z.ZodType<LeverSite> = z
  .object({
    site: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
    region: z.enum(["global", "eu"]).optional(),
  })
  .strict();

export const ashbyBoardSchema: z.ZodType<AshbyBoard> = z
  .object({
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
  })
  .strict();

/** Public sources that can be run without a browser session or private API key. */
export const jobSearchSourcesSchema = z
  .object({
    greenhouse: z.array(greenhouseBoardSchema).max(50).default([]),
    lever: z.array(leverSiteSchema).max(50).default([]),
    ashby: z.array(ashbyBoardSchema).max(50).default([]),
    freehire: z.boolean().default(false),
  })
  .strict();

export const savedJobSearchCriteriaSchema = jobSearchCriteriaSchema.extend({
  query: z.string().trim().min(1).max(200),
});

export function hasConfiguredJobSource(sources: JobSearchSources): boolean {
  return (
    sources.freehire ||
    sources.greenhouse.length > 0 ||
    sources.lever.length > 0 ||
    sources.ashby.length > 0
  );
}

/** A deliberately repeatable search. Unlike an ad-hoc local filter it always
 * has keywords and owns the ATS boards it watches. */
export const savedJobSearchDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    criteria: savedJobSearchCriteriaSchema,
    sources: jobSearchSourcesSchema,
    match: jobMatchPreferencesSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!hasConfiguredJobSource(value.sources)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "at least one job source is required",
      });
    }
  });

export type JobSearchSources = z.infer<typeof jobSearchSourcesSchema>;
export type SavedJobSearchDefinition = z.infer<typeof savedJobSearchDefinitionSchema>;

export interface SavedJobSearch extends SavedJobSearchDefinition {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  lastRunAt?: number;
}
