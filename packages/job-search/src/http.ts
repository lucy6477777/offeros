import type { JobSearchContext, ProviderIssue } from "./types";

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

type JsonResult =
  { ok: true; value: unknown } | { ok: false; issue: Omit<ProviderIssue, "provider" | "scope"> };

/** Bounded JSON read for public provider endpoints. */
export async function fetchJson(url: string, context: JobSearchContext = {}): Promise<JsonResult> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
    response = await (context.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return {
      ok: false,
      issue: { code: "network", message: "provider request failed", retryable: true },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      issue: {
        code: "http",
        message: `provider answered HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      },
    };
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    return {
      ok: false,
      issue: {
        code: "response-too-large",
        message: "provider response exceeded 10 MiB",
        retryable: false,
      },
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return {
      ok: false,
      issue: { code: "network", message: "provider response could not be read", retryable: true },
    };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    return {
      ok: false,
      issue: {
        code: "response-too-large",
        message: "provider response exceeded 10 MiB",
        retryable: false,
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      issue: { code: "invalid-json", message: "provider returned invalid JSON", retryable: false },
    };
  }
}
