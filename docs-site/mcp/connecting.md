# Connecting a Client

The MCP endpoint is `{APP_URL}/mcp`, over **Streamable HTTP**.

After signing in, open **`/connector-setup`** in the dashboard: it has
copy-ready commands, configuration files, authentication steps and
troubleshooting for Claude, Claude Code, Codex, Cursor, VS Code, Antigravity 2,
Gemini Spark and generic MCP clients. This page is the summary.

## Two ways to authorize

### OAuth 2.1 — recommended

Point the client at the URL and let it do the rest. It discovers the
authorization server through `/.well-known/oauth-protected-resource`, registers
itself dynamically, and sends you to the consent screen. Manage or revoke that
grant later on the **OAuth Clients** page.

```json
{
  "mcpServers": {
    "finance": {
      "type": "http",
      "url": "https://finance.example.com/mcp"
    }
  }
}
```

### Personal access token

Create one on the **Access Tokens** page — it is shown once — and send it as a
bearer token.

```json
{
  "mcpServers": {
    "finance": {
      "type": "http",
      "url": "https://finance.example.com/mcp",
      "headers": { "Authorization": "Bearer mcp_..." }
    }
  }
}
```

```bash
claude mcp add --transport http finance https://finance.example.com/mcp \
  --header "Authorization: Bearer mcp_..."
```

## Where each client keeps its configuration

| Client | Project file | Note |
|---|---|---|
| Claude Code | `.mcp.json` | Repository root. Each user approves the server once. |
| Cursor | `.cursor/mcp.json` | Overrides the same server name in `~/.cursor/mcp.json`. |
| VS Code | `.vscode/mcp.json` | Root key is `servers`, not `mcpServers`. |
| Codex | `.codex/config.toml` | TOML, and only for projects you have trusted. |
| Antigravity 2 | `.agents/mcp_config.json` | Alongside the global `~/.gemini/config/mcp_config.json`. |
| Gemini Spark | — | Account-level Connected Apps; no project file. |
| Claude Web, Desktop, Cowork | — | Connectors are per account; no project file. |
| Windsurf, Cline | — | Global configuration only. |

## Verifying the connection

Call `whoami`. It reports the current MCP user and which authorization method
carried the request — the fastest way to tell a working token from a working
OAuth grant, and either from an anonymous request.

## Limits

Tool responses are capped at **1 MB**. Narrow a large request by symbol count,
date range or summary modules rather than retrying it unchanged.
