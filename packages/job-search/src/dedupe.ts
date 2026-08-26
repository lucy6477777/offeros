import { descriptionFingerprint, normalizePostingUrl, normalizeSearchText } from "./normalize";
import type { JobPosting, JobSourceKind, JobSourceRecord } from "./types";

const SOURCE_RANK: Record<JobSourceKind, number> = {
  "official-ats": 4,
  manual: 3,
  browser: 2,
  aggregator: 1,
};

function keys(posting: JobPosting): Set<string> {
  const result = new Set<string>();
  result.add(`url:${normalizePostingUrl(posting.applyUrl)}`);
  for (const source of posting.sources) {
    result.add(
      `source:${source.provider}:${normalizeSearchText(source.tenant ?? "")}:${source.externalId}`,
    );
  }
  if (posting.location) {
    result.add(
      `role:${normalizeSearchText(posting.company)}:${normalizeSearchText(posting.title)}:${normalizeSearchText(posting.location)}`,
    );
  }
  if (posting.description && posting.description.length >= 200) {
    result.add(
      `description:${normalizeSearchText(posting.company)}:${normalizeSearchText(posting.title)}:${descriptionFingerprint(posting.description)}`,
    );
  }
  return result;
}

function sourceKey(source: JobSourceRecord): string {
  return `${source.provider}|${source.tenant ?? ""}|${source.externalId}`;
}

function score(posting: JobPosting): number {
  const rank = Math.max(...posting.sources.map((source) => SOURCE_RANK[source.kind]));
  const completeness = [
    posting.location,
    posting.countryCode,
    posting.employmentType,
    posting.department,
    posting.salary,
    posting.postedAt,
    posting.updatedAt,
  ].filter(Boolean).length;
  return (
    rank * 1_000_000 + completeness * 10_000 + Math.min(posting.description?.length ?? 0, 9_999)
  );
}

function merge(left: JobPosting, right: JobPosting): JobPosting {
  const [primary, secondary] = score(right) > score(left) ? [right, left] : [left, right];
  const sources = new Map(primary.sources.map((source) => [sourceKey(source), source]));
  for (const source of secondary.sources) sources.set(sourceKey(source), source);
  const liveness =
    primary.liveness === "open" || secondary.liveness === "open"
      ? "open"
      : primary.liveness === "closed" && secondary.liveness === "closed"
        ? "closed"
        : "unknown";
  return {
    ...primary,
    ...(primary.location || !secondary.location ? {} : { location: secondary.location }),
    ...(primary.countryCode || !secondary.countryCode
      ? {}
      : { countryCode: secondary.countryCode }),
    ...(primary.employmentType || !secondary.employmentType
      ? {}
      : { employmentType: secondary.employmentType }),
    ...(primary.department || !secondary.department ? {} : { department: secondary.department }),
    ...(primary.description || !secondary.description
      ? {}
      : { description: secondary.description }),
    ...(primary.salary || !secondary.salary ? {} : { salary: secondary.salary }),
    ...(primary.postedAt || !secondary.postedAt ? {} : { postedAt: secondary.postedAt }),
    ...(primary.updatedAt || !secondary.updatedAt ? {} : { updatedAt: secondary.updatedAt }),
    liveness,
    sources: [...sources.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
  };
}

export function deduplicatePostings(postings: JobPosting[]): {
  postings: JobPosting[];
  duplicates: number;
} {
  const groups: Array<{ posting: JobPosting; keys: Set<string> }> = [];
  let duplicates = 0;
  for (const posting of postings) {
    const incomingKeys = keys(posting);
    const matches = groups.filter((group) => [...incomingKeys].some((key) => group.keys.has(key)));
    if (matches.length === 0) {
      groups.push({ posting, keys: incomingKeys });
      continue;
    }
    duplicates += matches.length;
    const target = matches[0]!;
    target.posting = merge(target.posting, posting);
    for (const key of incomingKeys) target.keys.add(key);
    for (const extra of matches.slice(1)) {
      target.posting = merge(target.posting, extra.posting);
      for (const key of extra.keys) target.keys.add(key);
      groups.splice(groups.indexOf(extra), 1);
    }
  }
  return { postings: groups.map((group) => group.posting), duplicates };
}
