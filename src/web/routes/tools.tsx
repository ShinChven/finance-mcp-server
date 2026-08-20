import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  FileSpreadsheet,
  Globe,
  Info,
  LayoutGrid,
  PieChart,
  Repeat,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  TriangleAlert,
  X,
} from "lucide-react";
import { InlineMarkdown, Markdown } from "../components/markdown.js";
import { Card, CodeCopyBlock, EmptyState, PageHeader, Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";
import { schemaFields, type SchemaField } from "../lib/json-schema.js";
import { useListParams } from "../lib/params.js";
import type { McpToolInfo, ToolCatalog } from "../lib/types.js";

const MAX_VISIBLE_OPTIONS = 8;

export interface ToolCategory {
  id: string;
  name: string;
  shortName: string;
  icon: typeof LayoutGrid;
  description: string;
  colorTone: "indigo" | "emerald" | "amber" | "sky" | "violet" | "rose" | "slate";
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: "all",
    name: "All Tools",
    shortName: "All",
    icon: LayoutGrid,
    description: "Every tool registered on this server",
    colorTone: "slate",
  },
  {
    id: "market",
    name: "Market & Quotes",
    shortName: "Market",
    icon: TrendingUp,
    description: "Yahoo Finance quotes, historical charts, options, and company news",
    colorTone: "indigo",
  },
  {
    id: "funds",
    name: "Funds & ETFs",
    shortName: "Funds",
    icon: PieChart,
    description: "Mutual funds, ETFs, portfolio holdings, and multi-market exposure",
    colorTone: "emerald",
  },
  {
    id: "sec",
    name: "SEC & Earnings",
    shortName: "SEC",
    icon: FileSpreadsheet,
    description: "SEC EDGAR 10-K/10-Q filings, financials, and earnings surprises",
    colorTone: "amber",
  },
  {
    id: "watchlists",
    name: "Watchlists",
    shortName: "Watchlists",
    icon: Bookmark,
    description: "Manage cross-market watchlists with live market & NAV updates",
    colorTone: "sky",
  },
  {
    id: "notes",
    name: "Notes & Memory",
    shortName: "Notes",
    icon: BookOpen,
    description: "Long-term thesis memory, research notes, and symbol tags",
    colorTone: "violet",
  },
  {
    id: "skills",
    name: "Skills & Procedures",
    shortName: "Skills",
    icon: Sparkles,
    description: "Custom repeatable procedures and workflows for agents",
    colorTone: "rose",
  },
  {
    id: "system",
    name: "System & Identity",
    shortName: "System",
    icon: Cpu,
    description: "Identity resolution and MCP runtime diagnostics",
    colorTone: "slate",
  },
];

export const DEFAULT_CATEGORY: ToolCategory = TOOL_CATEGORIES[0]!;

export function getCategoryById(id: string): ToolCategory {
  return TOOL_CATEGORIES.find((c) => c.id === id) ?? DEFAULT_CATEGORY;
}

export function getToolCategory(name: string): string {
  if (name === "whoami") return "system";
  if (
    name.startsWith("fund") ||
    name.startsWith("funds") ||
    name === "themeToFunds" ||
    name === "compareFunds" ||
    name === "similarFunds"
  ) {
    return "funds";
  }
  if (name.startsWith("sec") || name === "earningsAnalysis") return "sec";
  if (name.startsWith("watchlist")) return "watchlists";
  if (name.startsWith("note")) return "notes";
  if (name.startsWith("skill")) return "skills";
  return "market";
}

const categoryStyles: Record<
  ToolCategory["colorTone"],
  {
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    activeTabBg: string;
    activeTabText: string;
    iconColor: string;
  }
> = {
  indigo: {
    badgeBg: "bg-indigo-50 dark:bg-indigo-500/10",
    badgeText: "text-indigo-700 dark:text-indigo-300",
    badgeBorder: "border-indigo-200 dark:border-indigo-500/20",
    activeTabBg: "bg-indigo-600 text-white dark:bg-indigo-500",
    activeTabText: "text-white",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  emerald: {
    badgeBg: "bg-emerald-50 dark:bg-emerald-500/10",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    badgeBorder: "border-emerald-200 dark:border-emerald-500/20",
    activeTabBg: "bg-emerald-600 text-white dark:bg-emerald-500",
    activeTabText: "text-white",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  amber: {
    badgeBg: "bg-amber-50 dark:bg-amber-500/10",
    badgeText: "text-amber-700 dark:text-amber-300",
    badgeBorder: "border-amber-200 dark:border-amber-500/20",
    activeTabBg: "bg-amber-600 text-white dark:bg-amber-500",
    activeTabText: "text-white",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  sky: {
    badgeBg: "bg-sky-50 dark:bg-sky-500/10",
    badgeText: "text-sky-700 dark:text-sky-300",
    badgeBorder: "border-sky-200 dark:border-sky-500/20",
    activeTabBg: "bg-sky-600 text-white dark:bg-sky-500",
    activeTabText: "text-white",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
  violet: {
    badgeBg: "bg-violet-50 dark:bg-violet-500/10",
    badgeText: "text-violet-700 dark:text-violet-300",
    badgeBorder: "border-violet-200 dark:border-violet-500/20",
    activeTabBg: "bg-violet-600 text-white dark:bg-violet-500",
    activeTabText: "text-white",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  rose: {
    badgeBg: "bg-rose-50 dark:bg-rose-500/10",
    badgeText: "text-rose-700 dark:text-rose-300",
    badgeBorder: "border-rose-200 dark:border-rose-500/20",
    activeTabBg: "bg-rose-600 text-white dark:bg-rose-500",
    activeTabText: "text-white",
    iconColor: "text-rose-600 dark:text-rose-400",
  },
  slate: {
    badgeBg: "bg-zinc-100 dark:bg-zinc-800",
    badgeText: "text-zinc-700 dark:text-zinc-300",
    badgeBorder: "border-zinc-200 dark:border-zinc-700",
    activeTabBg: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    activeTabText: "text-white dark:text-zinc-900",
    iconColor: "text-zinc-600 dark:text-zinc-400",
  },
};

function getTypeBadgeStyle(type: string): string {
  if (type.includes("[]")) return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20";
  if (type === "number" || type === "integer") return "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20";
  if (type === "boolean") return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20";
  if (type === "enum") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20";
  if (type === "object") return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20";
  return "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20";
}

function generateSamplePayload(tool: McpToolInfo): string {
  const properties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const sampleArgs: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(properties)) {
    if (required.has(key) || Object.keys(sampleArgs).length < 2) {
      if (prop.enum && prop.enum.length > 0) {
        sampleArgs[key] = prop.enum[0];
      } else if (prop.default !== undefined) {
        sampleArgs[key] = prop.default;
      } else if (prop.type === "string") {
        const lower = key.toLowerCase();
        if (lower.includes("symbol") || lower === "ticker") sampleArgs[key] = "AAPL";
        else if (lower.includes("code")) sampleArgs[key] = "162411";
        else if (lower.includes("query") || lower === "q") sampleArgs[key] = "semiconductor";
        else if (lower.includes("date")) sampleArgs[key] = "2025-01-01";
        else if (lower.includes("id")) sampleArgs[key] = "id_sample";
        else sampleArgs[key] = `example_${key}`;
      } else if (prop.type === "number" || prop.type === "integer") {
        sampleArgs[key] = prop.minimum ?? 10;
      } else if (prop.type === "boolean") {
        sampleArgs[key] = true;
      } else if (prop.type === "array") {
        sampleArgs[key] = ["AAPL", "MSFT"];
      } else {
        sampleArgs[key] = "sample";
      }
    }
  }

  return JSON.stringify(
    {
      name: tool.name,
      arguments: sampleArgs,
    },
    null,
    2,
  );
}

function AnnotationBadges({ annotations }: { annotations: McpToolInfo["annotations"] }) {
  const badges = [
    annotations?.readOnlyHint && { label: "Read-only", icon: ShieldCheck, tone: "emerald" },
    annotations?.destructiveHint && { label: "Destructive", icon: TriangleAlert, tone: "red" },
    annotations?.idempotentHint && { label: "Idempotent", icon: Repeat, tone: "zinc" },
    annotations?.openWorldHint && { label: "External data", icon: Globe, tone: "sky" },
  ].filter(Boolean) as { label: string; icon: typeof ShieldCheck; tone: string }[];

  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
    red: "bg-red-50 text-red-700 border-red-200/80 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
    sky: "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20",
    zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => {
        const Icon = badge.icon;
        return (
          <span
            key={badge.label}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[badge.tone]}`}
          >
            <Icon className="size-3 shrink-0" /> {badge.label}
          </span>
        );
      })}
    </div>
  );
}

function ParameterItem({ field }: { field: SchemaField }) {
  const [showAllOptions, setShowAllOptions] = useState(false);
  const extraOptions = field.options.length - MAX_VISIBLE_OPTIONS;
  const visibleOptions = showAllOptions ? field.options : field.options.slice(0, MAX_VISIBLE_OPTIONS);

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-4 transition-all hover:border-zinc-300 dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:hover:border-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <code className="rounded bg-zinc-200/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            {field.name}
          </code>
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-mono font-medium ${getTypeBadgeStyle(field.type)}`}
          >
            {field.type}
          </span>
        </div>
        <div>
          {field.required ? (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
              Required
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Optional
            </span>
          )}
        </div>
      </div>

      {field.description && (
        <div className="mt-2.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
          <InlineMarkdown>{field.description}</InlineMarkdown>
        </div>
      )}

      {field.options.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium text-zinc-400">Allowed values:</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {visibleOptions.map((option) => (
              <code
                key={option}
                className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 border border-zinc-200/60 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
              >
                {option}
              </code>
            ))}
            {extraOptions > 0 && (
              <button
                type="button"
                onClick={() => setShowAllOptions((prev) => !prev)}
                className="cursor-pointer rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-400"
              >
                {showAllOptions ? "Show less" : `+${extraOptions} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {field.constraints.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {field.constraints.map((constraint) => (
            <span
              key={constraint}
              className="inline-flex items-center rounded bg-zinc-200/50 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400"
            >
              {constraint}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool }: { tool: McpToolInfo }) {
  const [copiedToolName, setCopiedToolName] = useState(false);
  const [schemaTab, setSchemaTab] = useState<"input" | "output">("input");
  const fields = schemaFields(tool.inputSchema);
  const categoryId = getToolCategory(tool.name);
  const category = getCategoryById(categoryId);
  const CategoryIcon = category.icon;
  const style = categoryStyles[category.colorTone];
  const samplePayload = generateSamplePayload(tool);

  const copyName = () => {
    void navigator.clipboard.writeText(tool.name).then(() => {
      setCopiedToolName(true);
      setTimeout(() => setCopiedToolName(false), 2000);
    });
  };

  return (
    <Card className="overflow-hidden border border-zinc-200 shadow-xs dark:border-zinc-800">
      {/* Header Banner */}
      <div className="border-b border-zinc-200/80 bg-zinc-50/50 p-5 sm:p-6 dark:border-zinc-800/80 dark:bg-zinc-900/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.badgeBg} ${style.badgeText} ${style.badgeBorder}`}
            >
              <CategoryIcon className="size-3.5" />
              {category.name}
            </span>
          </div>
          <AnnotationBadges annotations={tool.annotations} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-zinc-50">
              {tool.title ?? tool.name}
            </h1>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="rounded bg-zinc-200/70 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                {tool.name}
              </code>
              <button
                type="button"
                onClick={copyName}
                aria-label="Copy tool name"
                className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {copiedToolName ? (
                  <>
                    <Check className="size-3 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Copy name</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-5 sm:p-6 space-y-6">
        {/* Description Section */}
        {tool.description && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Description
            </h2>
            <div className="rounded-xl border border-zinc-200/60 bg-white p-4 text-sm leading-relaxed text-zinc-700 shadow-xs dark:border-zinc-800/60 dark:bg-zinc-900/60 dark:text-zinc-300">
              <Markdown>{tool.description}</Markdown>
            </div>
          </div>
        )}

        {/* Parameters Section */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <span>Parameters</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {fields.length}
              </span>
              {fields.length > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                  {fields.filter((f) => f.required).length} required
                </span>
              )}
            </h2>
          </div>

          {fields.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
              <ShieldCheck className="mx-auto size-6 text-emerald-500" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                No parameters required
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                This tool can be executed with an empty arguments object: <code>{"{}"}</code>
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {fields.map((field) => (
                <ParameterItem key={field.name} field={field} />
              ))}
            </div>
          )}
        </div>

        {/* Example Tool Call */}
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Example Tool Call (JSON-RPC)
          </h2>
          <CodeCopyBlock
            label={`${tool.name} · call payload`}
            value={samplePayload}
          />
        </div>

        {/* Schema Inspector Section */}
        <div>
          <details className="group rounded-xl border border-zinc-200 bg-zinc-50/30 p-4 transition-all dark:border-zinc-800 dark:bg-zinc-900/20">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200">
              <span className="flex items-center gap-2">
                <Braces className="size-4 text-indigo-500" />
                <span>Raw JSON Schema Definition</span>
              </span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </summary>

            <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSchemaTab("input")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    schemaTab === "input"
                      ? "bg-indigo-600 text-white dark:bg-indigo-500"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  inputSchema
                </button>
                {tool.outputSchema && (
                  <button
                    type="button"
                    onClick={() => setSchemaTab("output")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      schemaTab === "output"
                        ? "bg-indigo-600 text-white dark:bg-indigo-500"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    outputSchema
                  </button>
                )}
              </div>

              {schemaTab === "input" ? (
                <CodeCopyBlock
                  label={`${tool.name} · inputSchema`}
                  value={JSON.stringify(tool.inputSchema, null, 2)}
                />
              ) : (
                <CodeCopyBlock
                  label={`${tool.name} · outputSchema`}
                  value={JSON.stringify(tool.outputSchema, null, 2)}
                />
              )}
            </div>
          </details>
        </div>
      </div>
    </Card>
  );
}

export default function ToolsPage() {
  const params = useListParams();
  const [showInstructions, setShowInstructions] = useState(false);

  const query = useQuery({
    queryKey: ["tools", params.q],
    queryFn: () =>
      api<ToolCatalog>(`/api/tools${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`),
  });

  const allTools = query.data?.items ?? [];

  // Compute category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allTools.length };
    for (const tool of allTools) {
      const cat = getToolCategory(tool.name);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [allTools]);

  // Filter tools by category and search query
  const filteredTools = useMemo(() => {
    const selectedCategory = params.category || "all";
    if (selectedCategory === "all") return allTools;
    return allTools.filter((tool) => getToolCategory(tool.name) === selectedCategory);
  }, [allTools, params.category]);

  // Selected tool resolution
  const selected =
    filteredTools.find((tool) => tool.name === params.tool) ??
    filteredTools[0] ??
    allTools[0];

  const totalReadOnly = useMemo(
    () => allTools.filter((t) => t.annotations?.readOnlyHint).length,
    [allTools],
  );

  const totalExternal = useMemo(
    () => allTools.filter((t) => t.annotations?.openWorldHint).length,
    [allTools],
  );

  return (
    <>
      <PageHeader
        title="MCP Tools"
        description="Inspect and explore all tool registrations exposed live over Model Context Protocol (/mcp)."
      />

      {/* Server Status Overview Banner */}
      {query.data && (
        <Card className="mb-6 overflow-hidden border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400">
                  <Terminal className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {query.data.server.name}
                    </span>
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      v{query.data.server.version}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                      <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live /mcp
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    JSON-RPC 2.0 endpoint with active in-memory catalog reflection
                  </p>
                </div>
              </div>

              {/* Quick Metrics */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-[11px] font-medium text-zinc-400 uppercase">Total Tools</div>
                  <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {query.data.total}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-[11px] font-medium text-zinc-400 uppercase">Read-Only</div>
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {totalReadOnly}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-[11px] font-medium text-zinc-400 uppercase">Live Data</div>
                  <div className="text-sm font-bold text-sky-600 dark:text-sky-400">
                    {totalExternal}
                  </div>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-[11px] font-medium text-zinc-400 uppercase">Families</div>
                  <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {TOOL_CATEGORIES.length - 1}
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible Server Instructions */}
            {query.data.server.instructions && (
              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80">
                <button
                  type="button"
                  onClick={() => setShowInstructions((prev) => !prev)}
                  className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400"
                >
                  <Info className="size-3.5" />
                  <span>{showInstructions ? "Hide Agent Instructions & Guidance" : "View Agent Instructions & Guidance"}</span>
                  <ChevronDown className={`size-3.5 transition-transform ${showInstructions ? "rotate-180" : ""}`} />
                </button>

                {showInstructions && (
                  <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
                    <Markdown>{query.data.server.instructions}</Markdown>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Category Pills Tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {TOOL_CATEGORIES.map((category) => {
          const count = categoryCounts[category.id] ?? 0;
          const isSelected = (params.category || "all") === category.id;
          const Icon = category.icon;
          const style = categoryStyles[category.colorTone];

          return (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                const nextCategory = category.id === "all" ? "" : category.id;
                // If the currently selected tool is not in this new category, pick the first in the new category
                const firstToolInCat =
                  category.id === "all"
                    ? allTools[0]?.name
                    : allTools.find((t) => getToolCategory(t.name) === category.id)?.name;
                params.update({
                  category: nextCategory,
                  tool: firstToolInCat ?? params.tool,
                });
              }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                isSelected
                  ? style.activeTabBg
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Icon className="size-3.5" />
              <span>{category.shortName}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                  isSelected
                    ? "bg-white/20 text-white"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={params.q}
            onChange={(e) => params.update({ q: e.target.value }, { replace: true })}
            placeholder={`Search ${allTools.length} tools by name, parameter, or description…`}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pr-9 pl-9 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {params.q && (
            <button
              type="button"
              onClick={() => params.update({ q: "" }, { replace: true })}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {params.q && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {filteredTools.length} of {allTools.length} tools matched
          </span>
        )}
      </div>

      {/* Main Two-Column Master-Detail Layout */}
      {query.isPending ? (
        <Spinner />
      ) : filteredTools.length === 0 ? (
        <Card>
          <EmptyState
            title="No matching tools"
            description="Try clearing your search query or selecting a different tool category."
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          {/* Left Column: Tools List */}
          <div className="space-y-1.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-1.5">
            {filteredTools.map((tool) => {
              const active = tool.name === selected?.name;
              const categoryId = getToolCategory(tool.name);
              const category = getCategoryById(categoryId);
              const CategoryIcon = category.icon;
              const fieldCount = Object.keys(tool.inputSchema?.properties ?? {}).length;
              const isReadOnly = tool.annotations?.readOnlyHint;

              return (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => params.update({ tool: tool.name })}
                  aria-current={active ? "page" : undefined}
                  className={`group relative block w-full cursor-pointer rounded-xl border p-3 text-left transition-all ${
                    active
                      ? "border-indigo-500/80 bg-indigo-50/70 shadow-xs ring-1 ring-indigo-500/20 dark:border-indigo-500/50 dark:bg-indigo-950/40 dark:ring-indigo-500/30"
                      : "border-zinc-200/80 bg-white hover:border-zinc-300 hover:bg-zinc-50/60 dark:border-zinc-800/80 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <code
                          className={`truncate font-mono text-xs font-semibold ${
                            active
                              ? "text-indigo-700 dark:text-indigo-300"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {tool.name}
                        </code>
                      </div>

                      {tool.title && (
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                          {tool.title}
                        </p>
                      )}
                    </div>

                    <CategoryIcon
                      className={`size-3.5 shrink-0 ${
                        active
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                      }`}
                    />
                  </div>

                  {/* Micro Metadata */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {fieldCount === 0 ? "0 params" : `${fieldCount} ${fieldCount === 1 ? "param" : "params"}`}
                    </span>
                    {isReadOnly && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 border border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                        Read-only
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Column: Tool Detail Inspector */}
          <div>
            {selected ? (
              <ToolDetail tool={selected} />
            ) : (
              <Card>
                <EmptyState
                  title="Select a tool"
                  description="Choose a tool from the list on the left to inspect its parameters and schemas."
                />
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
