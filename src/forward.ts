/**
 * importproof core: relay client for the hosted EU
 * import preflight service.
 *
 * The five tools below are preflight checks only:
 * EORI validation, candidate TARIC classification,
 * import measures, a low-value landed-cost estimate,
 * and bundling earlier checks into a signed receipt.
 * None of that work happens in this process. This
 * module holds the captured tool definitions for a
 * local tools/list reply and forwards each tools/call
 * to the remote endpoint.
 *
 * A call opens a streamable-HTTP JSON-RPC session on
 * first use: initialize, then
 * notifications/initialized, then tools/call. If the
 * initialize reply carries an Mcp-Session-Id header,
 * that identifier is attached to the remaining
 * requests and the session is kept for later calls.
 * Replies can be a single JSON document or an SSE
 * stream of data lines; either form is unwrapped to
 * the JSON-RPC message for the request in flight.
 *
 * The remote address is fixed to
 * https://import.mcp.jithox.com/mcp unless the
 * EU_IMPORT_MCP_URL environment variable replaces it
 * (a labelled reconstruction). If EU_IMPORT_API_KEY
 * holds a value, requests carry
 * `Authorization: Bearer <value>`; with no value, no
 * such header is emitted (the header name follows the
 * original registry record, while the env name, the
 * Bearer form and the forwarding itself are labelled
 * reconstructions, because the surface was captured
 * without a key).
 *
 * Whatever the upstream returns for a call is handed
 * back untouched. Anything that prevents a usable
 * upstream reply — a JSON-RPC error object, an HTTP
 * failure status, an unreadable body, or a transport
 * failure — is converted into an isError result whose
 * text starts with `importproof error:` (also a
 * labelled reconstruction).
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_ENDPOINT_URL = "https://import.mcp.jithox.com/mcp";
export const DEFAULT_TIMEOUT_MS = 30000;
export const PROTOCOL_VERSION = "2025-03-26";

/* Tool literals below were produced by parsing the
 * captured fixture JSON and re-serialising it with
 * /tmp/b39-importproof-gen.py; they were not typed by
 * hand. */
export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "validate_eori",
    "title": "Validate an EORI number",
    "description": "Structural check of an EORI number and, when the EU EOS provider is configured, an authoritative existence check. Provider outage or unknown status returns 'unavailable'/'needs_review', never a false 'invalid'. Structural validity is not proof of customs authorisation. Read-only preflight; not customs/tax/legal advice, not a customs decision or clearance.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "eori": {
          "type": "string",
          "minLength": 1,
          "maxLength": 20,
          "description": "An EORI number, e.g. \"BE0123456749\"."
        }
      }
    }
  },
  {
    "name": "search_taric_codes",
    "title": "Search candidate TARIC classifications",
    "description": "From a plain-language product description, return CANDIDATE TARIC/CN codes from a dated TARIC snapshot, ranked with the evidence used. Returns 'needs_review' (candidates to confirm) or 'unavailable' when no snapshot is provisioned — never an invented code. Classifications/measures are CANDIDATES for a declarant to confirm; only a BTI binds. TARIC carries no national VAT/excise — those are separate. Every result carries its source, retrieval time and validity window.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "productDescription": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Plain-language description of the good."
        },
        "knownProperties": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          },
          "description": "Optional known attributes (material, use, form)."
        }
      }
    }
  },
  {
    "name": "check_eu_import_measures",
    "title": "Check EU import measures for a classification",
    "description": "For a candidate TARIC code + origin, list EU-level import measures from a dated snapshot: third-country duty, tariff preferences, prohibitions/restrictions, surveillance. A restriction hit is a 'not_ready' signal to review, not a legal determination; compound/unknown measures return 'needs_review'; no snapshot → 'unavailable'. Classifications/measures are CANDIDATES for a declarant to confirm; only a BTI binds. TARIC carries no national VAT/excise — those are separate. Every result carries its source, retrieval time and validity window.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "code": {
          "type": "string",
          "minLength": 1,
          "maxLength": 12,
          "description": "Candidate TARIC/CN code."
        },
        "originCountry": {
          "type": "string",
          "minLength": 2,
          "maxLength": 2,
          "description": "ISO alpha-2 country of origin."
        },
        "destinationCountry": {
          "type": "string",
          "minLength": 2,
          "maxLength": 2,
          "description": "ISO alpha-2 EU destination."
        },
        "date": {
          "type": "string",
          "maxLength": 10,
          "description": "ISO date to evaluate (defaults to today)."
        },
        "goodsValueEur": {
          "type": "number",
          "minimum": 0,
          "description": "Customs value in EUR (optional)."
        },
        "itemCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100000,
          "description": "Number of items (optional)."
        }
      }
    }
  },
  {
    "name": "estimate_low_value_import_cost",
    "title": "Estimate low-value import cost",
    "description": "Estimate the landed cost for a low-value consignment (intrinsic value ≤ EUR 150) to an EU state on a given date: EUR 150 duty relief until 2026-06-30, then the temporary EUR 3-per-item duty from 2026-07-01, plus destination import VAT. All amounts are candidates; missing data is returned as 'missing', never guessed. TARIC carries no national VAT/excise — those are separate. Every result carries its source, retrieval time and validity window.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "destinationCountry": {
          "type": "string",
          "minLength": 2,
          "maxLength": 2,
          "description": "ISO alpha-2 EU destination."
        },
        "originCountry": {
          "type": "string",
          "minLength": 2,
          "maxLength": 2,
          "description": "ISO alpha-2 origin (optional)."
        },
        "currency": {
          "type": "string",
          "minLength": 3,
          "maxLength": 3,
          "description": "ISO 4217 currency of the values."
        },
        "asOfDate": {
          "type": "string",
          "maxLength": 10,
          "description": "ISO date that selects the duty regime."
        },
        "items": {
          "type": "array",
          "maxItems": 500,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "intrinsicValue"
            ],
            "properties": {
              "intrinsicValue": {
                "type": "number",
                "minimum": 0,
                "description": "Item intrinsic value (excl. shipping/VAT)."
              },
              "taricCandidate": {
                "type": "string",
                "maxLength": 12,
                "description": "Optional candidate TARIC code."
              }
            }
          },
          "description": "The consignment items."
        },
        "iossUsed": {
          "type": "boolean",
          "description": "Whether IOSS is used for VAT (optional)."
        },
        "destinationVatRatePercent": {
          "type": "number",
          "minimum": 0,
          "maximum": 100,
          "description": "Destination VAT rate % (optional)."
        }
      }
    }
  },
  {
    "name": "prepare_import_preflight_receipt",
    "title": "Prepare an import-preflight receipt",
    "description": "Bundle the preflight checks (EORI, candidate classification, measures, cost) into one idempotent Ed25519-signed receipt committing to the inputs, sources, retrieval times and validity dates — provable evidence of WHAT was checked and WHEN. Attests the checks, not a compliance or clearance outcome. Read-only preflight; not customs/tax/legal advice, not a customs decision or clearance.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bundle",
        "createdAt"
      ],
      "properties": {
        "bundle": {
          "type": "object",
          "description": "The preflight results to attest (EORI/classification/measures/cost)."
        },
        "createdAt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40,
          "description": "ISO timestamp the bundle was assembled."
        }
      }
    }
  }
];

export const TOOL_NAMES: string[] = TOOL_DEFS.map((entry) => entry.name);

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.indexOf(name) !== -1;
}

function failure(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `importproof error: ${detail}` }],
    isError: true,
  };
}

function describeRpcError(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Extract a JSON-RPC message from a response body.
 * Plain JSON is parsed directly; otherwise each SSE
 * `data:` payload is tried. When `expectedId` is
 * given the message carrying that id is preferred,
 * falling back to the final parseable message.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const body = text.trim();
  if (body === "") return null;
  const found: Record<string, unknown>[] = [];
  const consider = (raw: string): void => {
    try {
      const value: unknown = JSON.parse(raw);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        found.push(value as Record<string, unknown>);
      }
    } catch {
      // Ignore fragments that are not JSON objects.
    }
  };
  if (body.includes("data:")) {
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload !== "" && payload !== "[DONE]") consider(payload);
    }
  } else {
    consider(body);
  }
  if (found.length === 0) return null;
  if (expectedId !== undefined) {
    for (const item of found) {
      if (item.id === expectedId) return item;
    }
  }
  return found[found.length - 1];
}

async function globalFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

export class ImportproofClient {
  private readonly deps: ForwardDeps;
  private session: string | null = null;
  private established = false;
  private opening: Promise<void> | null = null;
  private seq = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private transport(): FetchFn {
    return this.deps.fetchFn ?? globalFetch;
  }

  private target(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const fromEnv = (this.deps.env ?? process.env).EU_IMPORT_MCP_URL;
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private bearer(): string | null {
    const raw = (this.deps.env ?? process.env).EU_IMPORT_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private limit(): number {
    return typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0
      ? this.deps.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  }

  private allocId(): number {
    this.seq += 1;
    return this.seq;
  }

  private async send(
    payload: unknown,
    attachSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.bearer();
    if (key !== null) headers.Authorization = `Bearer ${key}`;
    if (attachSession && this.session !== null) {
      headers["Mcp-Session-Id"] = this.session;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.limit());
    try {
      return await this.transport()(this.target(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async openSession(): Promise<void> {
    if (this.established) return;
    if (this.opening === null) {
      this.opening = (async () => {
        const id = this.allocId();
        const res = await this.send(
          {
            jsonrpc: "2.0",
            id,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "importproof", version: VERSION },
            },
          },
          false,
        );
        const issued = res.headers.get("mcp-session-id");
        if (issued) this.session = issued;
        const text = await res.text();
        const msg = parseRpcBody(text, id);
        if (msg !== null && msg.error) throw new Error(describeRpcError(msg.error));
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        if (msg === null && text.trim() !== "") throw new Error("malformed response");
        const note = await this.send(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await note.text();
        } catch {
          // The notification reply carries nothing we need.
        }
        this.established = true;
      })();
    }
    try {
      await this.opening;
    } catch (err) {
      this.opening = null;
      this.session = null;
      throw err;
    }
  }

  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.openSession();
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }
    const id = this.allocId();
    let res: FetchResponseLike;
    try {
      res = await this.send(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return failure(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const msg = parseRpcBody(await res.text(), id);
    if (msg !== null && msg.error) return failure(describeRpcError(msg.error));
    if (res.status < 200 || res.status >= 300) return failure(`HTTP ${res.status}`);
    if (msg === null) return failure("malformed response");
    const result = msg.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return failure("malformed response");
    }
    return result;
  }
}

export function createClient(deps: ForwardDeps = {}): ImportproofClient {
  return new ImportproofClient(deps);
}

export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new ImportproofClient(deps).callTool(name, args);
}
