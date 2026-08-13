import { useQuery } from "@tanstack/react-query";
import { Braces, Globe, Repeat, ShieldCheck, TriangleAlert } from "lucide-react";
import { InlineMarkdown, Markdown } from "../components/markdown.js";
import { SearchInput } from "../components/table.js";
import { Card, CodeCopyBlock, EmptyState, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { schemaFields, type SchemaField } from "../lib/json-schema.js";
import { useListParams } from "../lib/params.js";
import type { McpToolInfo, ToolCatalog } from "../lib/types.js";

const MAX_VISIBLE_OPTIONS = 10;

function Chip({ children, title }: { children: string; title?: string }) {
  return (
    <code
      title={title}
      className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    >
      {children}
    </code>
  );
}

function AnnotationBadges({ annotations }: { annotations: McpToolInfo["annotations"] }) {
  const badges = [
    annotations?.readOnlyHint && { label: "Read-only", icon: ShieldCheck, tone: "emerald" },
    annotations?.destructiveHint && { label: "Destructive", icon: TriangleAlert, tone: "red" },
    annotations?.idempotentHint && { label: "Idempotent", icon: Repeat, tone: "zinc" },
    annotations?.openWorldHint && { label: "External data", icon: Globe, tone: "zinc" },
  ].filter(Boolean) as { label: string; icon: typeof ShieldCheck; tone: string }[];

  const tones: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400",
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.label}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[badge.tone]}`}
          >
            <Icon className="size-3" /> {badge.label}
          </span>
        );
      })}
    </div>
  );
}

function ParameterRow({ field }: { field: SchemaField }) {
  const extraOptions = field.options.length - MAX_VISIBLE_OPTIONS;

  return (
    <tr className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800/60">
      <td className="px-4 py-3">
        <code className="text-xs font-medium">{field.name}</code>
        <div className="mt-0.5 text-[11px] text-zinc-400">
          {field.required ? (
            <span className="text-amber-600 dark:text-amber-400">required</span>
          ) : (
            "optional"
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <code className="text-xs text-indigo-600 dark:text-indigo-400">{field.type}</code>
      </td>
      <td className="px-4 py-3">
        {field.description ? (
          <InlineMarkdown>{field.description}</InlineMarkdown>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        )}
        {field.options.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {field.options.slice(0, MAX_VISIBLE_OPTIONS).map((option) => (
              <Chip key={option}>{option}</Chip>
            ))}
            {extraOptions > 0 && (
              <Chip title={field.options.join(", ")}>{`+${extraOptions} more`}</Chip>
            )}
          </div>
        )}
        {field.constraints.length > 0 && (
          <div className="mt-1.5 text-[11px] text-zinc-400">{field.constraints.join(" · ")}</div>
        )}
      </td>
    </tr>
  );
}

function ToolDetail({ tool }: { tool: McpToolInfo }) {
  const fields = schemaFields(tool.inputSchema);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{tool.title ?? tool.name}</h2>
          <code className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{tool.name}</code>
        </div>
        <AnnotationBadges annotations={tool.annotations} />
      </div>

      {tool.description && (
        <div className="mt-4 text-zinc-600 dark:text-zinc-300">
          <Markdown>{tool.description}</Markdown>
        </div>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold">
        Parameters{" "}
        <span className="font-normal text-zinc-400">
          ({fields.length}
          {fields.length > 0 && `, ${fields.filter((field) => field.required).length} required`})
        </span>
      </h3>
      {fields.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This tool takes no parameters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-800/40">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <ParameterRow key={field.name} field={field} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="group mt-5">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <Braces className="size-3.5" /> Raw JSON Schema
        </summary>
        <div className="mt-2">
          <CodeCopyBlock
            label={`${tool.name} · inputSchema`}
            value={JSON.stringify(tool.inputSchema, null, 2)}
          />
        </div>
        {tool.outputSchema && (
          <div className="mt-2">
            <CodeCopyBlock
              label={`${tool.name} · outputSchema`}
              value={JSON.stringify(tool.outputSchema, null, 2)}
            />
          </div>
        )}
      </details>
    </Card>
  );
}

export default function ToolsPage() {
  const params = useListParams();

  const query = useQuery({
    queryKey: ["tools", params.q],
    queryFn: () =>
      api<ToolCatalog>(`/api/tools${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`),
  });

  const tools = query.data?.items ?? [];
  // The URL owns the selection; fall back to the first match when a search
  // narrows the list past the selected tool.
  const selected = tools.find((tool) => tool.name === params.tool) ?? tools[0];

  return (
    <>
      <PageHeader
        title="MCP Tools"
        description="Every tool this server exposes at /mcp, read straight from the live tool registrations."
      />

      {query.data && (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Server</div>
              <p className="mt-1 text-sm">
                <code>{query.data.server.name}</code>{" "}
                <span className="text-zinc-400">v{query.data.server.version}</span>
              </p>
            </div>
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400">
              {query.data.total} {query.data.total === 1 ? "tool" : "tools"}
              {params.q && " matching"}
            </span>
          </div>
          {query.data.server.instructions && (
            <div className="mt-2 text-zinc-600 dark:text-zinc-300">
              <Markdown>{query.data.server.instructions}</Markdown>
            </div>
          )}
        </Card>
      )}

      <div className="mb-4">
        <SearchInput params={params} placeholder="Search name, description, parameter…" />
      </div>

      {query.isPending ? (
        <Spinner />
      ) : !selected ? (
        <Card>
          <EmptyState
            title="No matching tools"
            description="Try a different term, such as a symbol, a parameter name, or part of a description."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <Card className="h-fit p-1.5">
            <nav aria-label="MCP tools">
              {tools.map((tool) => {
                const active = tool.name === selected.name;
                return (
                  <button
                    key={tool.name}
                    onClick={() => params.update({ tool: tool.name })}
                    aria-current={active ? "page" : undefined}
                    className={`block w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors ${
                      active
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <code className="block truncate text-xs font-medium">{tool.name}</code>
                    {tool.title && (
                      <span className="block truncate text-[11px] text-zinc-400">{tool.title}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </Card>
          <ToolDetail tool={selected} />
        </div>
      )}
    </>
  );
}
