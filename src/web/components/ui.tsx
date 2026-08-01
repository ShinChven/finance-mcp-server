import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-400 dark:disabled:bg-indigo-900",
  secondary:
    "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-400",
  ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        buttonVariants[variant],
        className,
      )}
    >
      {busy && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-zinc-400",
        "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20",
        "dark:border-zinc-700 dark:bg-zinc-900",
        props.className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none",
        "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20",
        "dark:border-zinc-700 dark:bg-zinc-900",
        props.className,
      )}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-sm font-medium">{children}</label>;
}

const badgeColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  disabled: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  revoked: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  admin: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400",
  user: "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400",
  expired: "bg-zinc-200 text-zinc-600 dark:bg-zinc-600/30 dark:text-zinc-400",
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cx(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        badgeColors[value] ?? badgeColors.user,
      )}
    >
      {label ?? value}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="py-16 text-center">
      <p className="font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">{description}</p>}
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
      {label && (
        <span className="shrink-0 text-xs font-medium text-zinc-400 select-none">{label}</span>
      )}
      <code className="flex-1 overflow-x-auto text-xs whitespace-nowrap">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Copy value"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function CodeCopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-300 bg-zinc-950 dark:border-zinc-700">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-zinc-300 hover:bg-zinc-800"
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-5 text-zinc-200">
        <code>{value}</code>
      </pre>
    </div>
  );
}
