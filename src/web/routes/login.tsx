import { redirect, useSearchParams } from "react-router";
import { Server } from "lucide-react";
import { api } from "../lib/api.js";
import { Card } from "../components/ui.js";

export async function loginLoader() {
  try {
    await api("/api/me");
    return redirect("/");
  } catch {
    return null;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  not_invited: "This Google account has no access. Ask an administrator to invite your email address.",
  account_disabled: "Your account has been disabled. Contact an administrator.",
  oauth_failed: "Google sign-in failed. Please try again.",
  email_unverified: "Your Google email address is not verified.",
};

export default function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";
  const href = `/auth/google?next=${encodeURIComponent(next)}`;

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-indigo-600">
          <Server className="size-6 text-white" />
        </div>
        <h1 className="text-lg font-semibold">MCP Server Dashboard</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Manage your access tokens and connected MCP clients.
        </p>
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {ERROR_MESSAGES[error] ?? "Sign-in failed."}
          </p>
        )}
        <a
          href={href}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-300 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden>
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </a>
        <p className="mt-6 text-xs text-zinc-400">Access is invitation-only, via Google sign-in.</p>
      </Card>
    </div>
  );
}
