# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted EU import preflight service. The captured tool list is answered locally and every tool call is relayed upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, with the Mcp-Session-Id header carried forward when the upstream issues one).
- Tools: `validate_eori`, `search_taric_codes`, `check_eu_import_measures`, `estimate_low_value_import_cost` and `prepare_import_preflight_receipt`. The surface is read-only preflight evidence only; it files no declaration, pays no duty and submits nothing.
- Upstream results are returned unchanged; upstream failures surface as `importproof error:` text results.
- One bin provides the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). The upstream endpoint can be overridden with `EU_IMPORT_MCP_URL`; when `EU_IMPORT_API_KEY` is set it is sent as an `Authorization: Bearer` header.
