# BUILD REPORT — importproof

Rebuild of `com.jithox/eu-import-preflight` v0.4.1 (remote-only)
as `@reneturcios/importproof` 0.1.0 / `io.github.CloudCorpRecords/importproof`.
**Full surface built: 5/5 tools.**

## Fixture conflicts

**None.** The spec, the brief, and the fixture agree on the five tool
names and their required fields. Required fields as served, taken from
the fixture (`harness/fixtures/eu-import-preflight-tools-original.json`):

- `validate_eori` — NO `required` key in its schema
- `search_taric_codes` — NO `required` key in its schema
- `check_eu_import_measures` — NO `required` key in its schema
- `estimate_low_value_import_cost` — NO `required` key in its schema
- `prepare_import_preflight_receipt` — required: `bundle`, `createdAt`

The fixture's tool literals (name, title, description, inputSchema —
each tool carries a `title` key in the capture, and it is served)
are served verbatim from `src/forward.ts`; the literals were generated
programmatically from the fixture JSON (parsed and re-serialised by
`/tmp/b39-importproof-gen.py`, never retyped) and verified by the
registration-integrity test (served tools/list deep-equals the
fixture's 5 tool objects, in order) and again by the parity harness.

Judgment call recorded in the spec, followed here: the surface is
read-only preflight evidence — EORI checks, candidate TARIC codes
returned as needs_review candidates, import measures, a landed-cost
estimate, and a receipt that bundles the caller's own checks. No tool
files a declaration, pays a duty, books carriage or mints a key, so
the surface is built in full.

## What was built

All 19 factory files under `builds/importproof/`:

- `package.json` (`@reneturcios/importproof` 0.1.0, bin
  `importproof` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 80-char string
  "Read-only EU import preflight: EORI, TARIC candidates, measures and landed cost.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/importproof:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/importproof"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/importproof`, smoke assertion on server name
  `importproof`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://import.mcp.jithox.com/mcp` (pinned),
  overridable via `EU_IMPORT_MCP_URL` (LABELLED RECONSTRUCTION).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `importproof`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `EU_IMPORT_API_KEY` is set, an `Authorization: Bearer <value>`
  header is sent on every upstream request (header name pinned by the
  registry record's own remote declaration; the env name, the Bearer
  form and the env forwarding are LABELLED RECONSTRUCTIONS — the
  record pins no package env name and the capture was keyless). When
  unset, no key header is sent. No `X-API-Key` header is sent in
  either case. Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `importproof error:` text
  results (LABELLED RECONSTRUCTION).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration (per the task brief, overriding TEMPLATE.md §2 item 12).
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed beyond the coordinator's tools/list
  captures.

## Labelled reconstructions (from the spec's Wire section)

- `EU_IMPORT_MCP_URL` env override of the pinned endpoint
  `https://import.mcp.jithox.com/mcp`.
- `EU_IMPORT_API_KEY` env name and the forwarding of its value as
  `Authorization: Bearer <value>` (header name pinned by the registry
  record; env name pinned by nothing, capture keyless).
- The `importproof error:` failure rendering for upstream failures.

## Lockfile (Route 3, clean from birth)

Generated in the build dir with no `node_modules` present and no
pre-existing lockfile:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/importproof`,
**128 package entries**, sha256
`c087555178fedb7262dcdb78de522acfecbf8ea47b7134823d70fea2d89c451d`.
Then `npm install --offline --ignore-scripts` in the build dir for
`node_modules`.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js, forward.js, mcp.js, all
  non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **55 tests, 55 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 5 tool
  objects, names/titles in order, exactly the fixture's keys,
  no-required for the first four tools and `bundle`+`createdAt` for the
  receipt tool, property keys in order, schema flags and captured
  constraints, isKnownTool; session establishment/reuse/session-id
  handling, clientInfo/protocol version, JSON headers; env URL
  override, explicit url override and precedence, blank-env fallback;
  Authorization Bearer header present on every request when the key
  is set / absent when unset or blank / no X-API-Key in either case;
  verbatim argument forwarding for all five tools; verbatim result
  pass-through including upstream isError and SSE; JSON-RPC/init/
  malformed/null-result/HTTP/throw/timeout failures →
  `importproof error:`; parseRpcBody JSON + SSE + matching-id +
  [DONE] cases; MCP-layer MethodNotFound / InvalidParams validation;
  CLI --version / -v / unknown exit 2 / bad-JSON exit 2 / `mcp extra`
  exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/eu-import-preflight-tools-original.json --rebuild
  "stdio:node builds/importproof/dist/cli.js mcp" --out
  builds/importproof/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 5/5 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 80 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for importproof; only the
mechanics were patterned on the reference imgpage build (same
forwarding-client class), and only the fixture's tool literals are
served verbatim.
