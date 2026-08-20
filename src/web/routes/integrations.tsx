import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CheckCircle2,
  ExternalLink,
  FolderTree,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import {
  AntigravityIcon,
  ClaudeCodeIcon,
  ClaudeIcon,
  CodexIcon,
  CursorIcon,
  GeminiIcon,
  McpIcon,
  VsCodeIcon,
  type BrandIconComponent,
} from "../components/brand-icons.js";
import { Card, CodeCopyBlock, CopyField, PageHeader } from "../components/ui.js";

export type ClientId =
  | "claude"
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "antigravity"
  | "gemini"
  | "generic";

interface ClientOption {
  id: ClientId;
  label: string;
  description: string;
  icon: BrandIconComponent;
}

const CLIENTS: ClientOption[] = [
  { id: "claude", label: "Claude", description: "Web, Desktop & Cowork", icon: ClaudeIcon },
  { id: "claude-code", label: "Claude Code", description: "CLI and IDE", icon: ClaudeCodeIcon },
  { id: "codex", label: "Codex", description: "App, CLI and IDE", icon: CodexIcon },
  { id: "cursor", label: "Cursor", description: "Editor and Agent CLI", icon: CursorIcon },
  { id: "vscode", label: "VS Code", description: "Copilot agent mode", icon: VsCodeIcon },
  { id: "antigravity", label: "Antigravity 2", description: "App, IDE and CLI", icon: AntigravityIcon },
  { id: "gemini", label: "Gemini Spark", description: "Web & Cloud Agents", icon: GeminiIcon },
  { id: "generic", label: "Common MCP", description: "Any HTTP client", icon: McpIcon },
];

const CLIENT_IDS = new Set<ClientId>(CLIENTS.map((client) => client.id));
const TOKEN_CLIENTS = CLIENTS.filter((client) => client.id !== "claude" && client.id !== "gemini");

const DOCS: Record<ClientId, string> = {
  claude: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  "claude-code": "https://code.claude.com/docs/en/mcp",
  codex: "https://developers.openai.com/codex/mcp/",
  cursor: "https://cursor.com/docs/mcp",
  vscode: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
  antigravity: "https://antigravity.google/docs/mcp",
  gemini: "https://support.google.com/gemini/answer/16289947",
  generic: "https://modelcontextprotocol.io/docs/develop/connect-remote-servers",
};

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 sm:gap-3">
      <div className="grid size-6 sm:size-7 shrink-0 place-items-center rounded-full bg-indigo-100 text-[11px] sm:text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
        {number}
      </div>
      <div className="min-w-0 flex-1 pb-4 sm:pb-5">
        <h3 className="text-xs sm:text-sm font-semibold leading-snug">{title}</h3>
        <div className="mt-1.5 space-y-2.5 sm:space-y-3 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-600 dark:text-zinc-300">{children}</div>
      </div>
    </div>
  );
}

function Notice({
  kind = "info",
  className = "",
  children,
}: {
  kind?: "info" | "warning";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 sm:px-3.5 sm:py-3 text-xs sm:text-sm leading-5 sm:leading-6 ${
        kind === "warning"
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          : "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function GuideHeader({
  title,
  description,
  client,
}: {
  title: string;
  description: string;
  client: ClientId;
}) {
  return (
    <div className="mb-4 sm:mb-5 flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 border-b border-zinc-200 pb-4 sm:pb-5 dark:border-zinc-800">
      <div>
        <h2 className="text-base sm:text-lg font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <a
        href={DOCS[client]}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 self-start text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
      >
        Official docs <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function AuthSummary() {
  const [searchParams] = useSearchParams();
  const client = searchParams.get("client");
  const tokensLink = client ? `/tokens?client=${encodeURIComponent(client)}` : "/tokens";

  return (
    <div className="mb-4 sm:mb-5 grid gap-2.5 sm:gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="size-4 shrink-0" /> OAuth 2.1 — recommended
        </div>
        <p className="mt-1 text-xs leading-5 text-emerald-700 dark:text-emerald-200/80">
          Add only the server URL, then sign in in your browser. The client stores and refreshes its own credentials.
        </p>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
          <KeyRound className="size-4 shrink-0" /> Personal token — fallback
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          Use an Authorization Bearer header when a client cannot complete OAuth. Create and revoke tokens on the{" "}
          <Link to={tokensLink} className="font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
            Access Tokens
          </Link>{" "}
          page.
        </p>
      </div>
    </div>
  );
}

function ClaudeGuide({ mcpUrl, isLocal }: { mcpUrl: string; isLocal: boolean }) {
  return (
    <>
      <GuideHeader
        client="claude"
        title="Claude, Claude Desktop and Cowork"
        description="Add this server as a remote custom connector. The connector is linked to your Claude account and can be enabled per conversation."
      />
      {isLocal && (
        <Notice kind="warning" className="mb-5">
          Claude remote connectors run from Anthropic's cloud and cannot reach <code>localhost</code>. Deploy this app at a public HTTPS URL first, or use the Claude Code guide for local testing.
        </Notice>
      )}
      <Step number={1} title="Open connector settings">
        <p>
          For an individual account, open <strong>Customize → Connectors</strong>, select <strong>+</strong>, then choose{" "}
          <strong>Add custom connector</strong>. Team and Enterprise owners use <strong>Organization settings → Connectors → Add → Custom → Web</strong>.
        </p>
      </Step>
      <Step number={2} title="Enter the remote MCP URL">
        <p>Name the connector “MCP Server” and paste this exact endpoint. Leave advanced OAuth client credentials empty; this server supports automatic client registration.</p>
        <CopyField value={mcpUrl} />
      </Step>
      <Step number={3} title="Connect with OAuth">
        <p>
          Select <strong>Connect</strong>, complete the browser sign-in, and approve access. Authentication is per user, so each teammate connects their own account.
        </p>
      </Step>
      <Step number={4} title="Enable it in a conversation">
        <p>
          In a Claude conversation, select the <strong>+</strong> menu, open <strong>Connectors</strong>, and enable MCP Server. Ask Claude to list the available tools to verify the connection.
        </p>
      </Step>
    </>
  );
}

function ClaudeCodeGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const addCommand = `claude mcp add --transport http --scope user mcp-server ${mcpUrl}`;
  const loginCommand = "claude mcp login mcp-server";
  const listCommand = "claude mcp list";
  const tokenCommands = `export MCP_SERVER_TOKEN="${token ?? "mcp_…"}"
claude mcp add-json --scope user mcp-server '${JSON.stringify({
    type: "http",
    url: mcpUrl,
    headers: { Authorization: "Bearer ${MCP_SERVER_TOKEN}" },
  })}'`;
  const projectCommand = `claude mcp add --transport http --scope project mcp-server ${mcpUrl}`;
  const projectJson = JSON.stringify({ mcpServers: { "mcp-server": { type: "http", url: mcpUrl } } }, null, 2);

  return (
    <>
      <GuideHeader
        client="claude-code"
        title="Claude Code"
        description="Connect the CLI and IDE extension to this Streamable HTTP server. User scope makes the server available across your projects."
      />
      {!token && <AuthSummary />}
      {!token && (
        <Step number={1} title="Add the server and authenticate">
          <p>Run these commands one at a time. OAuth opens a browser and stores refreshable credentials securely.</p>
          <div className="space-y-3">
            <CodeCopyBlock label="1 · Add server" value={addCommand} />
            <CodeCopyBlock label="2 · Sign in" value={loginCommand} />
            <CodeCopyBlock label="3 · Check connection" value={listCommand} />
          </div>
        </Step>
      )}
      <Step number={token ? 1 : 2} title={token ? "Add with your access token" : "Or use a personal token"}>
        {token ? (
          <p>
            Your new token is already exported as <code>MCP_SERVER_TOKEN</code> in this command. Claude Code expands
            the environment variable when it connects, so the raw token stays out of its JSON configuration.
          </p>
        ) : (
          <p>
            Create a token in this dashboard and expose it as <code>MCP_SERVER_TOKEN</code>. Claude Code expands the environment variable when it connects, so the raw token stays out of its JSON configuration.
          </p>
        )}
        <CodeCopyBlock label="Bearer token · shell" value={tokenCommands} />
      </Step>
      <Step number={token ? 2 : 3} title="Verify and use">
        <p>
          Run <code>claude mcp list</code>, or open Claude Code and enter <code>/mcp</code>. The server should show as
          connected and expose its tools.
          {!token && <> If it shows “Needs authentication,” run <code>claude mcp login mcp-server</code> again.</>}
        </p>
      </Step>
      <Step number={token ? 3 : 4} title="Or share it with one repository">
        <p>
          Use <code>--scope project</code> instead of <code>--scope user</code> and Claude Code writes{" "}
          <code>.mcp.json</code> at your repository root. Commit that file and every teammate gets the server.
        </p>
        <CodeCopyBlock label="Project scope · shell" value={projectCommand} />
        <p>
          The command creates the file below, which you can also write by hand. The leading dot and the repository
          root are both required — a plain <code>mcp.json</code> in the project folder is ignored.
        </p>
        <CodeCopyBlock label=".mcp.json · repository root" value={projectJson} />
        <p>
          Claude Code asks each user to approve servers from <code>.mcp.json</code> before connecting, so the file is
          safe to commit. Run <code>claude</code> in the repository and accept, or reset earlier answers with{" "}
          <code>claude mcp reset-project-choices</code>. Never commit a token in this file — use OAuth, or reference{" "}
          <code>{"${MCP_SERVER_TOKEN}"}</code> in a <code>headers</code> entry so each machine supplies its own.
        </p>
      </Step>
    </>
  );
}

function CodexGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const oauthCommands = `codex mcp add mcp-server --url ${mcpUrl}
codex mcp login mcp-server
codex mcp list`;
  const tokenCommands = `export MCP_SERVER_TOKEN="${token ?? "mcp_…"}"
codex mcp add mcp-server --url ${mcpUrl} \\
  --bearer-token-env-var MCP_SERVER_TOKEN`;
  const toml = `[mcp_servers.mcp_server]
url = "${mcpUrl}"
bearer_token_env_var = "MCP_SERVER_TOKEN"`;

  return (
    <>
      <GuideHeader
        client="codex"
        title="Codex"
        description="Codex App, CLI and IDE extension share the same MCP configuration, so you only need to add this server once per Codex host."
      />
      {!token && <AuthSummary />}
      {!token && (
        <Step number={1} title="Add with OAuth">
          <p>Add the remote server, start its browser login, and verify the saved configuration.</p>
          <CodeCopyBlock label="OAuth · shell" value={oauthCommands} />
        </Step>
      )}
      <Step number={token ? 1 : 2} title={token ? "Add with your access token" : "Or add a personal token"}>
        <p>
          {token
            ? "Your new token is already filled into the environment-variable command below. Codex reads it when connecting and sends it as an Authorization Bearer header."
            : "Keep the token in an environment variable; Codex reads it when connecting and sends it as an Authorization Bearer header."}
        </p>
        <CodeCopyBlock label="Bearer token · shell" value={tokenCommands} />
      </Step>
      <Step number={token ? 2 : 3} title="Manual configuration option">
        <p>
          Add this table to <code>~/.codex/config.toml</code> for a global server, or <code>.codex/config.toml</code> for a trusted project.
        </p>
        <CodeCopyBlock label="config.toml" value={toml} />
      </Step>
      <Step number={token ? 3 : 4} title="Restart and verify">
        <p>
          Restart the Codex App or IDE extension after editing configuration. Use <code>/mcp</code> in a Codex session, or <code>codex mcp list</code> in a terminal, to inspect the server and tools.
        </p>
      </Step>
    </>
  );
}

function CursorGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const oauthJson = JSON.stringify({ mcpServers: { "mcp-server": { url: mcpUrl } } }, null, 2);
  const tokenJson = JSON.stringify(
    {
      mcpServers: {
        "mcp-server": {
          url: mcpUrl,
          headers: { Authorization: token ? `Bearer ${token}` : "Bearer ${env:MCP_SERVER_TOKEN}" },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <GuideHeader
        client="cursor"
        title="Cursor"
        description={
          token
            ? "Configure the server globally for every workspace or commit a project-level configuration for one repository."
            : "Configure the server globally for every workspace or commit a project-level configuration for one repository. Cursor supports Streamable HTTP and OAuth."
        }
      />
      {!token && <AuthSummary />}
      <Notice kind="warning" className="mb-5">
        Each snippet below is a complete <code>mcp.json</code>. If that file already configures other MCP servers, merge the <code>"mcp-server"</code> entry into your existing <code>mcpServers</code> object — don't paste over the whole file.
      </Notice>
      <Step number={1} title="Choose a configuration scope">
        <p>
          Use <code>~/.cursor/mcp.json</code> for all projects, or <code>.cursor/mcp.json</code> inside a repository for project-only access.
        </p>
      </Step>
      {!token && (
        <Step number={2} title="Add the OAuth configuration">
          <p>Paste this JSON into the selected file. With no Authorization header, Cursor discovers this server's OAuth endpoints automatically.</p>
          <CodeCopyBlock label="mcp.json · OAuth" value={oauthJson} />
        </Step>
      )}
      <Step number={token ? 2 : 3} title={token ? "Add your access token" : "Or use a personal token"}>
        {token ? (
          <p>Your new token is already filled into this configuration. Keep the file private and never commit it.</p>
        ) : (
          <p>
            Set <code>MCP_SERVER_TOKEN</code> in the environment that launches Cursor, then use this configuration. Restart Cursor after changing GUI environment variables.
          </p>
        )}
        <CodeCopyBlock label="mcp.json · Bearer token" value={tokenJson} />
      </Step>
      <Step number={token ? 3 : 4} title="Connect and verify">
        {token ? (
          <p>
            Restart Cursor, open <strong>Cursor Settings → Tools & Integrations → MCP</strong>, then confirm MCP Server
            is connected and its tools are enabled.
          </p>
        ) : (
          <p>
            Open <strong>Cursor Settings → Tools & Integrations → MCP</strong>. Select <strong>Connect</strong> or <strong>Needs authentication</strong> for MCP Server, complete OAuth, then confirm its tools are enabled. Cursor Agent CLI users can run <code>cursor-agent mcp login mcp-server</code> and <code>cursor-agent mcp list-tools mcp-server</code>.
          </p>
        )}
      </Step>
    </>
  );
}

function VsCodeGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const oauthJson = JSON.stringify({ servers: { "mcp-server": { type: "http", url: mcpUrl } } }, null, 2);
  const tokenJson = JSON.stringify(
    token
      ? {
          servers: {
            "mcp-server": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } },
          },
        }
      : {
          servers: {
            "mcp-server": {
              type: "http",
              url: mcpUrl,
              headers: { Authorization: "Bearer ${input:mcp-server-token}" },
            },
          },
          inputs: [
            {
              id: "mcp-server-token",
              type: "promptString",
              description: "MCP Server personal access token",
              password: true,
            },
          ],
        },
    null,
    2,
  );

  return (
    <>
      <GuideHeader
        client="vscode"
        title="Visual Studio Code"
        description="Copilot agent mode reads MCP servers from a workspace file you can commit, or from your user profile. VS Code names the map servers, not mcpServers."
      />
      {!token && <AuthSummary />}
      <Notice kind="warning" className="mb-5">
        VS Code uses <code>servers</code> as the root key. A snippet copied from another client's{" "}
        <code>mcpServers</code> map will not load here.
      </Notice>
      <Step number={1} title="Choose a configuration scope">
        <p>
          Create <code>.vscode/mcp.json</code> in the repository to share the server with your team, or run{" "}
          <strong>MCP: Open User Configuration</strong> from the Command Palette for a profile-wide file that follows
          you across workspaces.
        </p>
      </Step>
      {!token && (
        <Step number={2} title="Add the OAuth configuration">
          <p>
            Paste this JSON into the file you chose. With no Authorization header, VS Code discovers this server's
            OAuth endpoints and opens browser sign-in the first time it starts the server.
          </p>
          <CodeCopyBlock label="mcp.json · OAuth" value={oauthJson} />
        </Step>
      )}
      <Step number={token ? 2 : 3} title={token ? "Add your access token" : "Or use a personal token"}>
        {token ? (
          <p>
            Your new token is filled in below. Put this version in the user configuration rather than{" "}
            <code>.vscode/mcp.json</code>, or replace it with the prompted <code>inputs</code> form before committing.
          </p>
        ) : (
          <p>
            The <code>inputs</code> block makes VS Code prompt for the token once and store it in secret storage, so a
            committed <code>.vscode/mcp.json</code> never contains the secret.
          </p>
        )}
        <CodeCopyBlock label="mcp.json · Bearer token" value={tokenJson} />
      </Step>
      <Step number={token ? 3 : 4} title="Start and verify">
        <p>
          Select <strong>Start</strong> on the server entry in <code>mcp.json</code>, or run{" "}
          <strong>MCP: List Servers</strong> from the Command Palette and start it there. Then open Chat, switch to{" "}
          <strong>Agent</strong> mode, and enable this server's tools in the <strong>Tools</strong> picker.
        </p>
      </Step>
      <Notice className="mt-4">
        Server configurations support variables such as <code>{"${workspaceFolder}"}</code> and{" "}
        <code>{"${input:id}"}</code>. If a server fails to start, use <strong>MCP: List Servers → Show Output</strong>{" "}
        to read its log.
      </Notice>
    </>
  );
}

function AntigravityGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const cliAddCommand = token
    ? `agy mcp add --header "Authorization: Bearer ${token}" mcp-server ${mcpUrl}`
    : `agy mcp add mcp-server ${mcpUrl}`;
  const cliListCommand = "agy mcp list";

  const oauthJson = JSON.stringify({ mcpServers: { "mcp-server": { serverUrl: mcpUrl } } }, null, 2);
  const tokenJson = JSON.stringify(
    {
      mcpServers: {
        "mcp-server": {
          serverUrl: mcpUrl,
          headers: { Authorization: `Bearer ${token ?? "YOUR_PERSONAL_ACCESS_TOKEN"}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <GuideHeader
        client="antigravity"
        title="Google Antigravity 2"
        description="Antigravity 2.0, Antigravity IDE and Antigravity CLI (agy) share the same remote MCP schema. Remote servers must use the serverUrl field."
      />
      {!token && <AuthSummary />}
      <Notice kind="warning" className="mb-5">
        Each snippet below is a complete <code>mcp_config.json</code>. If that file already configures other MCP servers, merge the <code>"mcp-server"</code> entry into your existing <code>mcpServers</code> object — don't paste over the whole file.
      </Notice>

      <Step number={1} title="Antigravity 2.0 & IDE (UI Setup)">
        <p>Configure the server directly in the Antigravity user interface:</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            Open <strong>Settings</strong> (<code>⌘+,</code> / <code>Ctrl+,</code>) → <strong>Customizations</strong> → <strong>Installed MCP Servers</strong>.
          </li>
          <li>
            Click <strong>Add MCP Server</strong> (or <strong>+</strong>).
          </li>
          <li>
            Set Name to <code>mcp-server</code> and enter the remote URL:
          </li>
        </ol>
        <div className="mt-2">
          <CopyField value={mcpUrl} />
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {token
            ? `In the Headers section, add header Authorization with value Bearer ${token}.`
            : "Click Authenticate next to the server to complete browser sign-in. Antigravity refreshes credentials automatically."}
        </p>
      </Step>

      <Step number={2} title="Antigravity CLI (agy commands)">
        <p>
          Configure and inspect the server using native <code>agy mcp</code> commands:
        </p>
        <div className="space-y-3">
          <CodeCopyBlock label="CLI · Add MCP server" value={cliAddCommand} />
          <CodeCopyBlock label="CLI · List configured servers" value={cliListCommand} />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          You can also run <code>agy</code> and type <code>/mcp</code> inside the interactive session to manage servers.
        </p>
      </Step>

      <Step number={3} title="Manual configuration reference (optional)">
        <p>
          The global file is <code>~/.gemini/config/mcp_config.json</code>; the workspace file is <code>.agents/mcp_config.json</code>. Merge this object under <code>mcpServers</code>:
        </p>
        <CodeCopyBlock
          label={token ? "mcp_config.json · Bearer token" : "mcp_config.json · OAuth"}
          value={token ? tokenJson : oauthJson}
        />
      </Step>

      <Notice className="mt-4">
        Antigravity uses <code>serverUrl</code>. The legacy keys <code>url</code> and <code>httpUrl</code> are not valid for remote MCP configurations.
      </Notice>
    </>
  );
}

function GeminiGuide({ mcpUrl, isLocal }: { mcpUrl: string; isLocal: boolean }) {
  return (
    <>
      <GuideHeader
        client="gemini"
        title="Google Gemini & Gemini Spark"
        description="Connect this MCP server to Gemini Spark via Connected Apps in the Gemini web interface."
      />
      {isLocal && (
        <Notice kind="warning" className="mb-5">
          Gemini Spark runs from Google Cloud and cannot connect to <code>localhost</code>. Deploy this app at a public HTTPS URL first, or use Antigravity 2 / CLI for local testing.
        </Notice>
      )}
      <Step number={1} title="Open Connected Apps in Gemini">
        <p>
          Navigate to <strong>gemini.google.com</strong> on your computer. Open <strong>Settings & help</strong> (or your profile icon) at the bottom left, then select <strong>Connected Apps</strong>.
        </p>
      </Step>
      <Step number={2} title="Add custom MCP app for Spark">
        <p>
          In the Connected Apps panel, locate the <strong>Custom apps for Spark</strong> section and click <strong>Add MCP server</strong> (or <strong>+</strong>).
        </p>
      </Step>
      <Step number={3} title="Enter the MCP endpoint URL">
        <p>Paste the Streamable HTTP endpoint URL for this server:</p>
        <CopyField value={mcpUrl} />
      </Step>
      <Step number={4} title="Authorize and use in Spark">
        <p>
          Complete the connection authorization prompt. Once connected, Gemini Spark can discover and execute these finance tools in conversations, scheduled tasks, and persistent background workflows.
        </p>
      </Step>
      <Notice className="mt-4">
        Ensure <strong>Keep Activity</strong> is turned on in your Google Account settings, as Gemini Spark requires activity history to maintain connected custom MCP apps.
      </Notice>
    </>
  );
}

function GenericGuide({ mcpUrl, token }: { mcpUrl: string; token?: string }) {
  const oauthJson = JSON.stringify(
    { mcpServers: { "mcp-server": { type: "streamable-http", url: mcpUrl } } },
    null,
    2,
  );
  const tokenJson = JSON.stringify(
    {
      mcpServers: {
        "mcp-server": {
          type: "streamable-http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token ?? "YOUR_PERSONAL_ACCESS_TOKEN"}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <GuideHeader
        client="generic"
        title="Common Streamable HTTP MCP clients"
        description={
          token
            ? "Use this when your client is not listed above. Field names vary by client, but the endpoint, transport and Bearer header are the same."
            : "Use this when your client is not listed above. Field names vary by client, but the endpoint, transport and authentication behavior are the same."
        }
      />
      {!token && <AuthSummary />}
      <Notice kind="warning" className="mb-5">
        The JSON snippets below illustrate a full config file for clients that use an <code>mcpServers</code> map. If your client's file already lists other servers, merge the <code>"mcp-server"</code> entry into your existing <code>mcpServers</code> object — don't paste over the whole file.
      </Notice>
      <Step number={1} title="Select Streamable HTTP transport">
        <p>
          Configure a remote <strong>Streamable HTTP</strong> server—not legacy SSE—and use the complete endpoint including <code>/mcp</code>.
        </p>
        <CopyField value={mcpUrl} />
      </Step>
      {!token && (
        <Step number={2} title="Prefer automatic OAuth discovery">
          <p>
            Start with URL-only configuration. A compatible client receives a 401 response, discovers the authorization metadata, registers itself, and opens browser sign-in.
          </p>
          <CodeCopyBlock label="Generic JSON · OAuth" value={oauthJson} />
        </Step>
      )}
      <Step number={token ? 2 : 3} title={token ? "Add your access token" : "Use a Bearer token when needed"}>
        <p>
          {token
            ? "Your new token is already included in the Authorization header below. Never put tokens in query parameters."
            : "Create a personal token and include it in every MCP request using the Authorization header. Never put tokens in query parameters."}
        </p>
        <CodeCopyBlock label="Generic JSON · Bearer token" value={tokenJson} />
      </Step>
      <Step number={token ? 3 : 4} title="Map the schema to your client">
        <div className="-mx-1 sm:mx-0 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-left text-xs min-w-[360px]">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">Client family</th>
                <th className="px-3 py-2 font-medium">Remote URL key</th>
                <th className="px-3 py-2 font-medium">Transport hint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              <tr><td className="px-3 py-2 font-medium">Claude Code</td><td className="px-3 py-2"><code>url</code></td><td className="px-3 py-2"><code>type: http</code></td></tr>
              <tr><td className="px-3 py-2 font-medium">Codex</td><td className="px-3 py-2"><code>url</code></td><td className="px-3 py-2">Inferred</td></tr>
              <tr><td className="px-3 py-2 font-medium">Cursor</td><td className="px-3 py-2"><code>url</code></td><td className="px-3 py-2">Inferred</td></tr>
              <tr><td className="px-3 py-2 font-medium">VS Code</td><td className="px-3 py-2"><code>url</code> under <code>servers</code></td><td className="px-3 py-2"><code>type: http</code></td></tr>
              <tr><td className="px-3 py-2 font-medium">Antigravity 2</td><td className="px-3 py-2"><code>serverUrl</code></td><td className="px-3 py-2">Inferred</td></tr>
              <tr><td className="px-3 py-2 font-medium">Gemini Spark</td><td className="px-3 py-2">URL endpoint</td><td className="px-3 py-2">Streamable HTTP</td></tr>
            </tbody>
          </table>
        </div>
      </Step>
      <Notice className="mt-4">
        Cloud-hosted clients require a publicly reachable HTTPS endpoint. Local desktop and CLI clients can use <code>http://localhost</code> while this app is running locally.
      </Notice>
    </>
  );
}

interface ProjectScopeRow {
  client: string;
  path: string;
  note: string;
}

const PROJECT_SCOPES: ProjectScopeRow[] = [
  { client: "Claude Code", path: ".mcp.json", note: "Repository root. Each user approves the server once." },
  { client: "Cursor", path: ".cursor/mcp.json", note: "Overrides the same server name in ~/.cursor/mcp.json." },
  { client: "VS Code", path: ".vscode/mcp.json", note: "Root key is servers, not mcpServers." },
  { client: "Codex", path: ".codex/config.toml", note: "TOML, and only for projects you have trusted." },
  { client: "Antigravity 2", path: ".agents/mcp_config.json", note: "Workspace file alongside global ~/.gemini/config/mcp_config.json." },
  { client: "Gemini Spark", path: "—", note: "Account-level Connected Apps; no project file." },
  { client: "Claude Web, Desktop, Cowork", path: "—", note: "Connectors are per account; no project file." },
  { client: "Windsurf, Cline", path: "—", note: "Global configuration only." },
];

function ProjectScopeReference() {
  return (
    <Card className="mt-4 sm:mt-5 p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <FolderTree className="mt-0.5 size-4 shrink-0 text-indigo-500" />
        <div>
          <h2 className="text-xs sm:text-sm font-semibold">Per-project configuration</h2>
          <p className="mt-1 text-xs sm:text-sm leading-5 sm:leading-6 text-zinc-500 dark:text-zinc-400">
            Most clients can load this server from a file inside a repository instead of your home directory, so a
            checkout carries its own tools. There is no shared format: each client reads one exact filename in one
            exact folder.
          </p>
        </div>
      </div>
      <Notice kind="warning" className="mt-3 sm:mt-4">
        A file named <code>mcp.json</code> at the root of your project is not read by any client. Claude Code wants
        the leading dot in <code>.mcp.json</code>; Cursor and VS Code want their own dot-folders.
      </Notice>
      <div className="mt-3 sm:mt-4 -mx-1 sm:mx-0 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-xs min-w-[480px]">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">File in your project folder</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {PROJECT_SCOPES.map((row) => (
              <tr key={row.client}>
                <td className="px-3 py-2 whitespace-nowrap font-medium">{row.client}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.path === "—" ? <span className="text-zinc-400">—</span> : <code>{row.path}</code>}
                </td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        Claude Code and Cursor share the same <code>mcpServers</code> shape, so a single <code>.mcp.json</code> can be
        symlinked to <code>.cursor/mcp.json</code>. VS Code and Codex cannot join that link — different key and
        different file format. Commit project files only when they authenticate with OAuth or read the token from an
        environment variable or prompt; a raw Bearer token belongs in your own machine's configuration.
      </p>
    </Card>
  );
}

function Troubleshooting({ tokenOnly = false }: { tokenOnly?: boolean }) {
  const items = tokenOnly
    ? [
        "Use the exact endpoint, including /mcp.",
        "Restart the client after editing config files.",
        "Send the token as an Authorization Bearer header.",
        "A 401 means the token is invalid, disabled, revoked or expired.",
        "Never put the token in a URL or commit it to source control.",
        "For cloud clients, deploy behind a valid public HTTPS certificate.",
      ]
    : [
        "Use the exact endpoint, including /mcp.",
        "Restart the client after editing config files.",
        "Use OAuth without an Authorization header, or a token—not both.",
        "A 401 means sign-in is required or the token is invalid.",
        "Make sure the signed-in Google email has dashboard access.",
        "For cloud clients, deploy behind a valid public HTTPS certificate.",
      ];

  return (
    <Card className="mt-4 sm:mt-5 p-4 sm:p-5">
      <h2 className="text-xs sm:text-sm font-semibold">Connection checklist</h2>
      <ul className="mt-3 grid gap-2 sm:gap-2.5 text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-3.5 sm:size-4 shrink-0 text-emerald-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function IntegrationGuides({
  mcpUrl,
  token,
  basePath = "/integrations",
  defaultClient = "claude",
}: {
  mcpUrl: string;
  token?: string;
  basePath?: string;
  defaultClient?: ClientId;
}) {
  const [searchParams] = useSearchParams();
  const tokenOnly = !!token;
  const clients = tokenOnly ? TOKEN_CLIENTS : CLIENTS;
  const requestedClient = searchParams.get("client") as ClientId | null;
  const selectedClient =
    requestedClient && CLIENT_IDS.has(requestedClient) && clients.some((client) => client.id === requestedClient)
      ? requestedClient
      : defaultClient;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  return (
    <>
      <Card className="mb-4 sm:mb-5 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <div>
            <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Your endpoint</div>
            <p className="mt-0.5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
              {tokenOnly
                ? "Streamable HTTP · Personal Bearer token"
                : "Streamable HTTP · OAuth 2.1 with PKCE · Personal Bearer tokens"}
            </p>
          </div>
          <div className="inline-flex self-start sm:self-auto items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            {tokenOnly ? <KeyRound className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
            {tokenOnly ? "Token ready" : "OAuth ready"}
          </div>
        </div>
        <div className="mt-3">
          <CopyField value={mcpUrl} />
        </div>
      </Card>

      <nav
        aria-label="MCP client guides"
        className="mb-4 sm:mb-5 flex items-center gap-1 sm:gap-1.5 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 sm:p-1.5 dark:border-zinc-800 dark:bg-zinc-900/60"
      >
        {clients.map((client) => {
          const Icon = client.icon;
          const active = selectedClient === client.id;
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set("client", client.id);
          return (
            <Link
              key={client.id}
              to={`${basePath}?${nextSearchParams.toString()}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 sm:gap-2 rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2 text-xs sm:text-sm font-medium transition-all ${
                active
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-600 hover:bg-white/50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100"
              }`}
            >
              <Icon className="size-3.5 sm:size-4 shrink-0" />
              <span>{client.label}</span>
            </Link>
          );
        })}
      </nav>

      <Card className="p-4 sm:p-6">
        {!tokenOnly && selectedClient === "claude" && <ClaudeGuide mcpUrl={mcpUrl} isLocal={isLocal} />}
        {selectedClient === "claude-code" && <ClaudeCodeGuide mcpUrl={mcpUrl} token={token} />}
        {selectedClient === "codex" && <CodexGuide mcpUrl={mcpUrl} token={token} />}
        {selectedClient === "cursor" && <CursorGuide mcpUrl={mcpUrl} token={token} />}
        {selectedClient === "vscode" && <VsCodeGuide mcpUrl={mcpUrl} token={token} />}
        {selectedClient === "antigravity" && <AntigravityGuide mcpUrl={mcpUrl} token={token} />}
        {!tokenOnly && selectedClient === "gemini" && <GeminiGuide mcpUrl={mcpUrl} isLocal={isLocal} />}
        {selectedClient === "generic" && <GenericGuide mcpUrl={mcpUrl} token={token} />}
      </Card>

      <ProjectScopeReference />

      <Troubleshooting tokenOnly={tokenOnly} />
    </>
  );
}

export default function IntegrationsPage() {
  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <>
      <PageHeader
        title="MCP Integrations"
        description="Choose your client for exact setup commands, authentication options, and verification steps."
      />
      <IntegrationGuides mcpUrl={mcpUrl} />
    </>
  );
}
