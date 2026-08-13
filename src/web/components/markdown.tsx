import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Tailwind's preflight already zeroes element margins, so spacing is opt-in per variant.
const markdownClass =
  "[&_a]:text-indigo-600 [&_a]:underline [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs dark:[&_a]:text-indigo-400 dark:[&_code]:bg-zinc-800 [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-100 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 dark:[&_pre]:bg-zinc-950 [&_table]:my-2 [&_table]:text-xs [&_td]:border [&_td]:border-zinc-200 [&_td]:px-2 [&_td]:py-1 dark:[&_td]:border-zinc-700 [&_th]:border [&_th]:border-zinc-200 [&_th]:px-2 [&_th]:py-1 dark:[&_th]:border-zinc-700 [&_ul]:list-disc [&_ul]:pl-5";

/** Renders trusted markdown (assistant replies, MCP tool descriptions) as HTML. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`${className ?? "text-sm leading-relaxed"} [&_p]:my-1.5 ${markdownClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

/** Compact, margin-free variant for one-line descriptions inside tables. */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <div className={`text-xs leading-5 ${markdownClass}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
