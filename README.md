# importproof

Before goods move, an importer wants a short paper
trail: is this EORI number structurally sound and
known, which TARIC codes might describe the product,
what EU measures attach to a candidate code for a
given origin, and what a small consignment is likely
to cost once duty relief and destination VAT are
accounted for. importproof puts those five preflight
questions behind one MCP surface.

The checks themselves run on a hosted service. This
package is the local half: it answers the tool list
from the definitions captured from that service and
relays every call to it, returning the reply exactly
as it arrived. The answers are evidence for a
declarant to confirm, not determinations. Candidate
classifications stay candidates, measures from a
dated snapshot can return a review signal instead of
a verdict, and a cost figure is an estimate built
from what was supplied, with missing inputs reported
as missing rather than filled in by guesswork.

Nothing here files a customs declaration, collects
or pays a duty, books transport, or submits the
receipt anywhere. The receipt tool only bundles the
caller's own earlier checks into a signed record of
what was checked and when.

## Tools

- `validate_eori` — check an EORI number. Takes
  `eori` (up to 20 characters). The reply separates
  structural validity from an authoritative existence
  result, and an unavailable provider is reported as
  such rather than as a failed check.
- `search_taric_codes` — propose candidate TARIC/CN
  codes for a product. Takes `productDescription`
  (up to 500 characters) and optionally
  `knownProperties`, a list of short attribute strings
  such as material or intended use. Candidates come
  from a dated snapshot, ranked with their evidence.
- `check_eu_import_measures` — list EU-level measures
  for a candidate code. Takes `code`, `originCountry`
  and `destinationCountry` (ISO alpha-2), and
  optionally `date`, `goodsValueEur` and `itemCount`.
  Covers third-country duty, preferences,
  prohibitions and restrictions, and surveillance
  from a dated snapshot.
- `estimate_low_value_import_cost` — estimate landed
  cost for a consignment whose intrinsic value is at
  most EUR 150. Takes `destinationCountry`,
  `currency` and `items` (each item needs
  `intrinsicValue`, with an optional
  `taricCandidate`), and optionally `originCountry`,
  `asOfDate`, which selects the duty regime,
  `iossUsed`, and `destinationVatRatePercent`.
- `prepare_import_preflight_receipt` — assemble the
  earlier checks into one signed receipt. Requires
  `bundle` (the preflight results to attest) and
  `createdAt` (the ISO timestamp the bundle was put
  together). The receipt attests the checks; it does
  not attest a compliance or clearance outcome.

For the first four tools the captured schemas carry
no required-field list; only the receipt tool
requires its `bundle` and `createdAt` arguments.

## Configuration

- `EU_IMPORT_MCP_URL` (optional) — replace the
  upstream endpoint, which otherwise defaults to
  `https://import.mcp.jithox.com/mcp`. This override
  hook is a labelled reconstruction of this rebuild.
- `EU_IMPORT_API_KEY` (optional) — when present,
  every upstream request includes an
  `Authorization: Bearer <value>` header carrying the
  caller's key; when absent, no key header is sent.
  The header name follows the original service's
  registry record. The record does not pin a package
  environment name, so the env name, the Bearer form
  and the forwarding behaviour are labelled
  reconstructions; the original surface was captured
  without a key.

### How a call travels

The first call from a client opens a session with
three JSON-RPC posts in order: `initialize` with
protocol version `2025-03-26` and client name
`importproof`, then the `notifications/initialized`
notification, then the `tools/call` itself with the
caller's arguments unchanged. If the initialize
reply sets an `Mcp-Session-Id` header, that value is
sent on the following requests and the session is
reused afterwards. Replies in plain JSON and in
server-sent-event framing are both understood.

A reply that succeeds is passed back verbatim,
including any error flag the upstream itself set.
A call that cannot be completed — an upstream
JSON-RPC error, a non-success HTTP status, a body
that cannot be read as JSON-RPC, or a transport
failure — becomes an error result whose text begins
with `importproof error:` (that wording is a
labelled reconstruction of this rebuild).

## CLI

Each tool is also available as a subcommand whose
single argument is a JSON object string:

```bash
npx @reneturcios/importproof validate_eori '{"eori":"BE0123456749"}'
npx @reneturcios/importproof search_taric_codes '{"productDescription":"cotton t-shirt"}'
npx @reneturcios/importproof --version
```

Exit codes are `0` for a successful call, `1` for an
error result, and `2` for a usage error.

## MCP server

```bash
npx -y @reneturcios/importproof mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "importproof": {
      "command": "npx",
      "args": ["-y", "@reneturcios/importproof", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/importproof
docker run --rm ghcr.io/cloudcorprecords/importproof --version
```

With no arguments the container starts the MCP
server over stdio; any other arguments are handled
by the CLI.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

Tests stub the upstream JSON-RPC service, so the
suite makes no live network calls.

## License

MIT — see `LICENSE`.
