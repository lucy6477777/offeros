import { z } from "zod";
import { descriptionFingerprint, inferWorkplace, normalizePostingUrl } from "./normalize";
import { JOB_WORKPLACE_TYPES, jobPostingSchema, type JobPosting } from "./types";

export const JOB_CAPTURE_SOURCES = ["manual", "browser"] as const;

export const capturedJobInputSchema = z
  .object({
    source: z.enum(JOB_CAPTURE_SOURCES),
    url: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "captured job URL must use HTTP or HTTPS",
      }),
    title: z.string().trim().min(1),
    company: z.string().trim().min(1),
    location: z.string().trim().min(1).optional(),
    workplace: z.enum(JOB_WORKPLACE_TYPES).optional(),
    employmentType: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    salary: z.string().trim().min(1).optional(),
    postedAt: z.string().datetime({ offset: true }).optional(),
    fetchedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export type JobCaptureSource = (typeof JOB_CAPTURE_SOURCES)[number];
export type CapturedJobInput = z.infer<typeof capturedJobInputSchema>;

/**
 * Convert a user-triggered URL or rendered-browser capture into the same
 * provider-neutral JobPosting contract used by search providers.
 *
 * A capture proves that the page was seen, not that the employer is still
 * accepting applications, so its canonical liveness remains unknown.
 */
export function createCapturedJobPosting(inputValue: unknown): JobPosting {
  const input = capturedJobInputSchema.parse(inputValue);
  const applyUrl = normalizePostingUrl(input.url);
  const fingerprint = descriptionFingerprint(applyUrl);
  const provider = input.source === "browser" ? "browser-capture" : "manual-url";
  return jobPostingSchema.parse({
    id: `capture:${fingerprint}`,
    title: input.title,
    company: input.company,
    ...(input.location ? { location: input.location } : {}),
    workplace: input.workplace ?? inferWorkplace(input.title, input.location, input.description),
    ...(input.employmentType ? { employmentType: input.employmentType } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.salary ? { salary: input.salary } : {}),
    ...(input.postedAt ? { postedAt: input.postedAt } : {}),
    applyUrl,
    liveness: "unknown",
    sources: [
      {
        provider,
        kind: input.source,
        externalId: fingerprint,
        sourceUrl: input.url,
        applyUrl,
        fetchedAt: input.fetchedAt ?? Date.now(),
      },
    ],
  });
}
