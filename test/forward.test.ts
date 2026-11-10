import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  ImportproofClient,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Suite for the relay client. The upstream is a fake
 * fetch that speaks the session sequence
 * (initialize, notifications/initialized, tools/call);
 * nothing here contacts the real endpoint.
 */

const fixturePath = new URL(
  "../../../harness/fixtures/eu-import-preflight-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(fixturePath);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(fixturePath, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const EORI = "validate_eori";
const TARIC = "search_taric_codes";
const MEASURES = "check_eu_import_measures";
const COST = "estimate_low_value_import_cost";
const RECEIPT = "prepare_import_preflight_receipt";
const ALL = [EORI, TARIC, MEASURES, COST, RECEIPT];

const SAMPLE = {
  content: [{ type: "text", text: "{\"status\":\"needs_review\"}" }],
  structuredContent: { status: "needs_review" },
};

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOpts {
  result?: Record<string, unknown>;
  rawBody?: string;
  rpcError?: Record<string, unknown>;
  status?: number;
  initRpcError?: Record<string, unknown>;
  throwMethod?: string;
  session?: string | null;
  hang?: boolean;
  sse?: boolean;
}

function respond(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => map.get(n.toLowerCase()) ?? null },
    text: async () => body,
  };
}

function jsonRespond(status: number, payload: unknown, headers = {}) {
  return respond(status, JSON.stringify(payload), headers);
}

function fakeUpstream(opts: FakeOpts = {}): { fetchFn: FetchFn; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    seen.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (opts.throwMethod === method) throw new Error("connection reset");
    if (method === "initialize") {
      if (opts.initRpcError) {
        return jsonRespond(200, { jsonrpc: "2.0", id: body.id, error: opts.initRpcError });
      }
      const hdrs: Record<string, string> = {};
      const sid = opts.session === undefined ? "sess-41" : opts.session;
      if (sid !== null) hdrs["mcp-session-id"] = sid;
      return jsonRespond(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "eu-import", version: "0.4.1" },
          },
        },
        hdrs,
      );
    }
    if (method === "notifications/initialized") return respond(202, "");
    if (method === "tools/call") {
      if (opts.hang) {
        return new Promise<FetchResponseLike>((_res, reject) => {
          const sig = init?.signal;
          if (sig) {
            if (sig.aborted) return reject(new Error("aborted"));
            sig.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (opts.rawBody !== undefined) return respond(opts.status ?? 200, opts.rawBody);
      if (opts.rpcError) {
        return jsonRespond(200, { jsonrpc: "2.0", id: body.id, error: opts.rpcError });
      }
      const payload = { jsonrpc: "2.0", id: body.id, result: opts.result ?? SAMPLE };
      if (opts.sse) {
        return respond(200, `event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      return jsonRespond(opts.status ?? 200, payload);
    }
    return jsonRespond(200, {});
  };
  return { fetchFn, seen };
}

function stub(opts: FakeOpts = {}, extra: Record<string, unknown> = {}) {
  const up = fakeUpstream(opts);
  const client = new ImportproofClient({ fetchFn: up.fetchFn, env: {}, ...extra });
  return { client, seen: up.seen, up };
}

function firstText(r: ToolResult): string {
  return (r.content as Array<{ text: string }>)[0].text;
}
function seq(seen: Seen[]): string[] {
  return seen.map((s) => s.body.method as string);
}

describe("registration integrity", () => {
  it("deep-equals the fixture's five tools in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 5);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });
  it("exposes the five names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, ALL);
  });
  it("each tool carries exactly name, title, description, inputSchema", () => {
    for (const t of TOOL_DEFS) {
      assert.deepEqual(Object.keys(t).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });
  it("titles match the fixture", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      fixture.tools.map((t) => t.title),
    );
  });
  it("first four tools have no required key; receipt requires bundle and createdAt", () => {
    for (let i = 0; i < 4; i += 1) {
      assert.equal("required" in (TOOL_DEFS[i].inputSchema as object), false);
      assert.equal(
        (TOOL_DEFS[i].inputSchema as { required?: unknown }).required,
        undefined,
      );
    }
    assert.deepEqual(
      (TOOL_DEFS[4].inputSchema as { required?: string[] }).required,
      ["bundle", "createdAt"],
    );
  });
  it("property keys per tool match the fixture in order", () => {
    const expected: Record<string, string[]> = {
      validate_eori: ["eori"],
      search_taric_codes: ["productDescription", "knownProperties"],
      check_eu_import_measures: [
        "code",
        "originCountry",
        "destinationCountry",
        "date",
        "goodsValueEur",
        "itemCount",
      ],
      estimate_low_value_import_cost: [
        "destinationCountry",
        "originCountry",
        "currency",
        "asOfDate",
        "items",
        "iossUsed",
        "destinationVatRatePercent",
      ],
      prepare_import_preflight_receipt: ["bundle", "createdAt"],
    };
    for (const t of TOOL_DEFS) {
      assert.deepEqual(
        Object.keys((t.inputSchema as { properties: object }).properties),
        expected[t.name],
      );
    }
  });
  it("schema flags match the fixture", () => {
    for (const t of TOOL_DEFS) {
      assert.equal((t.inputSchema as { type: string }).type, "object");
      assert.equal(
        (t.inputSchema as { additionalProperties: boolean }).additionalProperties,
        false,
      );
    }
  });
  it("spot-checks captured property constraints", () => {
    const eoriProps = (TOOL_DEFS[0].inputSchema as any).properties;
    assert.equal(eoriProps.eori.maxLength, 20);
    assert.equal(eoriProps.eori.minLength, 1);
    const costProps = (TOOL_DEFS[3].inputSchema as any).properties;
    assert.equal(costProps.items.maxItems, 500);
    assert.deepEqual(costProps.items.items.required, ["intrinsicValue"]);
    const receiptProps = (TOOL_DEFS[4].inputSchema as any).properties;
    assert.equal(receiptProps.createdAt.maxLength, 40);
    assert.equal(receiptProps.bundle.type, "object");
  });
  it("isKnownTool accepts all five and rejects others", () => {
    for (const n of ALL) assert.equal(isKnownTool(n), true);
    assert.equal(isKnownTool("validateEori"), false);
    assert.equal(isKnownTool(""), false);
  });
});

describe("session handling", () => {
  it("performs initialize, initialized, then tools/call against the pinned endpoint", async () => {
    const { client, seen } = stub();
    const out = await client.callTool(EORI, { eori: "BE0123456749" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(seq(seen), ["initialize", "notifications/initialized", "tools/call"]);
    assert.equal(DEFAULT_ENDPOINT_URL, "https://import.mcp.jithox.com/mcp");
    assert.ok(seen.every((s) => s.url === DEFAULT_ENDPOINT_URL));
  });
  it("initialize carries protocol version, empty capabilities and importproof clientInfo", async () => {
    const { client, seen } = stub();
    await client.callTool(TARIC, { productDescription: "shoes" });
    const params = seen[0].body.params as any;
    assert.equal(params.protocolVersion, "2025-03-26");
    assert.equal(PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual(params.capabilities, {});
    assert.deepEqual(params.clientInfo, { name: "importproof", version: VERSION });
  });
  it("sends JSON content headers on every request", async () => {
    const { client, seen } = stub();
    await client.callTool(EORI, { eori: "DE123" });
    for (const s of seen) {
      assert.equal(s.headers["Content-Type"], "application/json");
      assert.equal(s.headers.Accept, "application/json, text/event-stream");
    }
  });
  it("carries the issued session id on later requests only", async () => {
    const { client, seen } = stub();
    await client.callTool(EORI, { eori: "DE123" });
    assert.equal(seen[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(seen[1].headers["Mcp-Session-Id"], "sess-41");
    assert.equal(seen[2].headers["Mcp-Session-Id"], "sess-41");
  });
  it("reuses one session for consecutive calls and increments ids", async () => {
    const { client, seen } = stub();
    await client.callTool(EORI, { eori: "DE123" });
    await client.callTool(MEASURES, { code: "6403", originCountry: "CN", destinationCountry: "DE" });
    assert.deepEqual(seq(seen), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.notEqual(seen[2].body.id, seen[3].body.id);
  });
  it("sends no session header when none is issued", async () => {
    const { client, seen } = stub({ session: null });
    await client.callTool(EORI, { eori: "DE123" });
    assert.ok(seen.every((s) => s.headers["Mcp-Session-Id"] === undefined));
  });
});

describe("endpoint override and API key", () => {
  it("uses EU_IMPORT_MCP_URL when set", async () => {
    const up = fakeUpstream();
    const c = new ImportproofClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_MCP_URL: "https://mirror.example.com/mcp" },
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.ok(up.seen.every((s) => s.url === "https://mirror.example.com/mcp"));
  });
  it("explicit url wins over env and default", async () => {
    const up = fakeUpstream();
    const c = createClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_MCP_URL: "https://env.example.com/mcp" },
      url: "https://explicit.example.com/mcp",
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.ok(up.seen.every((s) => s.url === "https://explicit.example.com/mcp"));
  });
  it("blank env override falls back to the pinned endpoint", async () => {
    const up = fakeUpstream();
    const c = new ImportproofClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_MCP_URL: "  " },
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.ok(up.seen.every((s) => s.url === DEFAULT_ENDPOINT_URL));
  });
  it("sends Bearer authorization on all requests when EU_IMPORT_API_KEY is set", async () => {
    const up = fakeUpstream();
    const c = new ImportproofClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_API_KEY: "eu-key-7" },
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.equal(up.seen.length, 3);
    assert.ok(up.seen.every((s) => s.headers.Authorization === "Bearer eu-key-7"));
  });
  it("sends no authorization header when the key is unset", async () => {
    const { client, seen } = stub();
    await client.callTool(EORI, { eori: "DE123" });
    assert.ok(seen.every((s) => s.headers.Authorization === undefined));
  });
  it("sends no authorization header when the key is blank", async () => {
    const up = fakeUpstream();
    const c = new ImportproofClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_API_KEY: "   " },
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.ok(up.seen.every((s) => s.headers.Authorization === undefined));
  });
  it("never sends X-API-Key in either branch", async () => {
    const up = fakeUpstream();
    const c = new ImportproofClient({
      fetchFn: up.fetchFn,
      env: { EU_IMPORT_API_KEY: "eu-key-7" },
    });
    await c.callTool(EORI, { eori: "DE123" });
    assert.ok(up.seen.every((s) => s.headers["X-API-Key"] === undefined));
    const plain = stub();
    await plain.client.callTool(EORI, { eori: "DE123" });
    assert.ok(plain.seen.every((s) => s.headers["X-API-Key"] === undefined));
  });
});

describe("forwarding and pass-through", () => {
  it("forwards validate_eori arguments verbatim", async () => {
    const { client, seen } = stub();
    const args = { eori: "BE0123456749" };
    await client.callTool(EORI, args);
    const params = seen[2].body.params as any;
    assert.equal(params.name, EORI);
    assert.deepEqual(params.arguments, args);
  });
  it("forwards search_taric_codes arguments verbatim", async () => {
    const { client, seen } = stub();
    const args = {
      productDescription: "leather handbag",
      knownProperties: ["leather", "hand carried"],
    };
    await client.callTool(TARIC, args);
    assert.deepEqual((seen[2].body.params as any).arguments, args);
  });
  it("forwards check_eu_import_measures arguments verbatim", async () => {
    const { client, seen } = stub();
    const args = {
      code: "42022100",
      originCountry: "CN",
      destinationCountry: "FR",
      date: "2026-10-28",
      goodsValueEur: 900,
      itemCount: 12,
    };
    await client.callTool(MEASURES, args);
    const params = seen[2].body.params as any;
    assert.equal(params.name, MEASURES);
    assert.deepEqual(params.arguments, args);
  });
  it("forwards estimate_low_value_import_cost arguments verbatim", async () => {
    const { client, seen } = stub();
    const args = {
      destinationCountry: "DE",
      originCountry: "GB",
      currency: "EUR",
      asOfDate: "2026-08-01",
      items: [{ intrinsicValue: 42.5, taricCandidate: "640399" }],
      iossUsed: true,
      destinationVatRatePercent: 19,
    };
    await client.callTool(COST, args);
    assert.deepEqual((seen[2].body.params as any).arguments, args);
  });
  it("forwards prepare_import_preflight_receipt arguments verbatim", async () => {
    const { client, seen } = stub();
    const args = {
      bundle: { eori: { status: "valid" }, cost: { total: 10 } },
      createdAt: "2026-10-28T09:00:00Z",
    };
    await client.callTool(RECEIPT, args);
    const params = seen[2].body.params as any;
    assert.equal(params.name, RECEIPT);
    assert.deepEqual(params.arguments, args);
  });
  it("returns the upstream result unchanged including extra fields", async () => {
    const { client } = stub();
    assert.deepEqual(await client.callTool(EORI, { eori: "DE123" }), SAMPLE);
  });
  it("returns an upstream isError result unchanged", async () => {
    const errResult = { content: [{ type: "text", text: "no snapshot" }], isError: true };
    const { client } = stub({ result: errResult });
    assert.deepEqual(await client.callTool(TARIC, { productDescription: "x" }), errResult);
  });
  it("understands SSE-framed replies", async () => {
    const { client } = stub({ sse: true });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE);
  });
  it("one-shot callTool helper forwards with the requested name", async () => {
    const up = fakeUpstream();
    const out = await callTool(
      COST,
      { destinationCountry: "DE", currency: "EUR", items: [] },
      { fetchFn: up.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    assert.equal((up.seen[2].body.params as any).name, COST);
  });
});

describe("error rendering", () => {
  it("renders a tools/call JSON-RPC error as importproof error text", async () => {
    const { client } = stub({ rpcError: { code: -32001, message: "snapshot missing" } });
    const out = await client.callTool(TARIC, { productDescription: "x" });
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "importproof error: snapshot missing");
  });
  it("renders an initialize JSON-RPC error the same way", async () => {
    const { client } = stub({ initRpcError: { code: -32600, message: "bad init" } });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "importproof error: bad init");
  });
  it("renders an unparseable body as a malformed response", async () => {
    const { client } = stub({ rawBody: "<html>down</html>" });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(firstText(out), "importproof error: malformed response");
  });
  it("renders a null result as a malformed response", async () => {
    const { client } = stub({ rawBody: '{"jsonrpc":"2.0","id":3,"result":null}' });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(firstText(out), "importproof error: malformed response");
  });
  it("renders a non-2xx status as an HTTP error", async () => {
    const { client } = stub({ rawBody: "oops", status: 503 });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(firstText(out), "importproof error: HTTP 503");
  });
  it("renders a throwing tools/call fetch as an error", async () => {
    const { client } = stub({ throwMethod: "tools/call" });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^importproof error: /);
  });
  it("renders a throwing initialize fetch as an error", async () => {
    const { client } = stub({ throwMethod: "initialize" });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(firstText(out), "importproof error: connection reset");
  });
  it("renders a timed-out call as an error", async () => {
    const { client } = stub({ hang: true }, { timeoutMs: 20 });
    const out = await client.callTool(EORI, { eori: "DE123" });
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^importproof error: /);
  });
});

describe("parseRpcBody", () => {
  it("parses a plain JSON message and selects by id", () => {
    assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":9,"result":{"a":1}}', 9), {
      jsonrpc: "2.0",
      id: 9,
      result: { a: 1 },
    });
  });
  it("parses SSE data lines", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });
  it("selects the matching id among several SSE messages", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });
  it("skips the SSE DONE sentinel", () => {
    const body = 'data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n';
    assert.deepEqual(parseRpcBody(body, 4), {
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });
  it("returns null for empty, non-JSON and array bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("hello"), null);
    assert.equal(parseRpcBody("[1,2]"), null);
  });
});

describe("MCP layer", () => {
  it("rejects unknown tools with MethodNotFound and no network use", async () => {
    const up = fakeUpstream();
    const c = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "file_declaration", {}),
      (e: unknown) => e instanceof McpError && e.code === ErrorCode.MethodNotFound,
    );
    assert.equal(up.seen.length, 0);
  });
  it("rejects array arguments with InvalidParams and no network use", async () => {
    const up = fakeUpstream();
    const c = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, EORI, ["x"]),
      (e: unknown) => e instanceof McpError && e.code === ErrorCode.InvalidParams,
    );
    assert.equal(up.seen.length, 0);
  });
  it("rejects string arguments with InvalidParams", async () => {
    const up = fakeUpstream();
    const c = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, EORI, "BE0123"),
      (e: unknown) => e instanceof McpError && e.code === ErrorCode.InvalidParams,
    );
    assert.equal(up.seen.length, 0);
  });
  it("forwards a valid call through handleCallTool", async () => {
    const up = fakeUpstream();
    const c = createClient({ fetchFn: up.fetchFn, env: {} });
    const out = await handleCallTool(c, RECEIPT, {
      bundle: {},
      createdAt: "2026-10-28T00:00:00Z",
    });
    assert.deepEqual(out, SAMPLE);
    assert.equal((up.seen[2].body.params as any).name, RECEIPT);
  });
  it("treats omitted arguments as an empty object", async () => {
    const up = fakeUpstream();
    const c = createClient({ fetchFn: up.fetchFn, env: {} });
    const out = await handleCallTool(c, EORI, undefined);
    assert.deepEqual(out, SAMPLE);
    assert.deepEqual((up.seen[2].body.params as any).arguments, {});
  });
});

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  function run(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }
  it("--version prints the package version", () => {
    const r = run(["--version"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "0.1.0");
    assert.equal(r.stdout.trim(), VERSION);
  });
  it("-v prints the package version", () => {
    const r = run(["-v"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "0.1.0");
  });
  it("unknown subcommand prints usage and exits 2", () => {
    const r = run(["not-a-tool"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage:/);
  });
  it("non-JSON tool argument exits 2", () => {
    const r = run([EORI, "not json"]);
    assert.equal(r.status, 2);
  });
  it("JSON array tool argument exits 2", () => {
    const r = run([EORI, "[]"]);
    assert.equal(r.status, 2);
  });
  it("extra argument after mcp exits 2", () => {
    const r = run(["mcp", "extra"]);
    assert.equal(r.status, 2);
  });
});
