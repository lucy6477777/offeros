import {
  createCapturedJobPosting,
  inferWorkplace,
  type JobCaptureSource,
} from "@offeros/job-search";
import { z } from "zod";
import type { JobInfo } from "@offeros/core";
import type { Db } from "../db/client";
import { saveCapturedJobPosting, type StoredJobPosting } from "../repositories/job-search-repo";

const isoTimestampSchema = z.string().datetime({ offset: true });

function isoTimestamp(value: string | undefined): string | undefined {
  const parsed = isoTimestampSchema.safeParse(value);
  return parsed.success ? new Date(parsed.data).toISOString() : undefined;
}

/**
 * Make an existing user-triggered Application entrypoint also feed the
 * canonical job catalogue. No URL means there is no stable job identity, so
 * pasted JD-only workflows remain Application-only.
 */
export function saveApplicationJobCapture(
  db: Db,
  input: {
    source: JobCaptureSource;
    jobInfo: JobInfo;
    jdText?: string;
    fetchedAt?: number;
  },
): StoredJobPosting | null {
  const url = input.jobInfo.applyLink?.trim();
  const title = input.jobInfo.jobTitle.trim();
  const company = input.jobInfo.companyName.trim();
  if (!url || !title || !company) return null;
  const workplace = inferWorkplace(
    input.jobInfo.workModel,
    title,
    input.jobInfo.jobLocation,
    input.jdText,
  );
  const postedAt = isoTimestamp(input.jobInfo.publishTimeDesc);
  const posting = createCapturedJobPosting({
    source: input.source,
    url,
    title,
    company,
    ...(input.jobInfo.jobLocation ? { location: input.jobInfo.jobLocation } : {}),
    ...(workplace === "unknown" ? {} : { workplace }),
    ...(input.jobInfo.employmentType ? { employmentType: input.jobInfo.employmentType } : {}),
    ...(input.jdText?.trim() ? { description: input.jdText.trim() } : {}),
    ...(input.jobInfo.salaryDesc ? { salary: input.jobInfo.salaryDesc } : {}),
    ...(postedAt ? { postedAt } : {}),
    ...(input.fetchedAt === undefined ? {} : { fetchedAt: input.fetchedAt }),
  });
  return saveCapturedJobPosting(db, { posting, seenAt: input.fetchedAt });
}
