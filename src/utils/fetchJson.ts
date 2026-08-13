import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** What to show for a failed request: the server's own reason when it sent one, else the status.
 *
 *  Every `/api` route answers a failure as `res.status(4xx).json({ error })`, so the reason a
 *  thing was refused — a setting to change, a name already taken — is right there in the body.
 *  Reporting only `HTTP 400` turns a fixable problem into an unexplained one (#913). Exported
 *  because a caller running its own request (a DELETE that answers success with no body) needs
 *  the same rule rather than a second copy of it. */
export function errorMessage(body: unknown, status: number): string {
  return isRecord(body) && typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${status}`;
}

/** Reads a response body into the caller's shape. See `fetchJson` for why it is not optional. */
export type JsonReader<T> = (raw: unknown) => T;

/**
 * `read` is required, and that is the point: `Response.json()` answers `any`, so a bare
 * `fetchJson<T>(url)` used to hand back whatever the server sent under the name the CALLER chose —
 * a claim about the server rather than a question asked of it. Taking the reader from the caller
 * is the same fix wikiApi's `getJson` already uses.
 */
export async function fetchJson<T>(input: RequestInfo | URL, read: JsonReader<T>, init?: RequestInit, timeout_ms?: number): Promise<FetchResult<T>> {
  try {
    // Bounded here so every caller of this helper is, without each one remembering to ask.
    // A request with no deadline reports nothing at all rather than an error, and this function's
    // whole contract is to turn a request into an answer the caller can act on.
    const res = await fetchWithTimeout(input, init, timeout_ms);
    // `status` is the HTTP status on an HTTP failure, or 0 on a transport failure (no response).
    if (!res.ok) return { ok: false, error: errorMessage(await readErrorBody(res), res.status), status: res.status };
    const body: unknown = await res.json();
    return { ok: true, data: read(body) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}

/** The parsed error body, or null when there is none to parse — a proxy's HTML page, an empty
 *  body, or a test stub with no `json` at all. Its OWN try/catch, deliberately not the one
 *  above: that one answers `status: 0`, which means "the request never reached a server", and
 *  the collection UI branches on that to tell offline apart from missing. */
export async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
