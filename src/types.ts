/**
 * Shared shapes for importproof.
 *
 * This package performs no customs logic of its own. It
 * keeps the captured upstream tool surface as plain data
 * and relays calls to a remote endpoint through an
 * injectable fetch, which keeps every code path testable
 * without touching the network.
 */

/** A single tool entry exactly as it should appear in a tools/list reply. */
export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

/** Decoded JSON object supplied as tool arguments. */
export type ToolArgs = Record<string, unknown>;

/** A tools/call outcome; upstream payloads keep whatever fields they arrived with. */
export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/** Minimal response surface the relay relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Fetch signature used by the relay; tests substitute a stub. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Optional collaborators for the forwarding client. */
export interface ForwardDeps {
  fetchFn?: FetchFn;
  env?: Record<string, string | undefined>;
  url?: string;
  timeoutMs?: number;
}
