import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "./components/toast.js";
import Login, { loginLoader } from "./routes/login.js";
import Shell, { shellLoader } from "./routes/shell.js";
import OverviewPage from "./routes/overview.js";
import ActivityPage from "./routes/activity.js";
import IntegrationsPage from "./routes/integrations.js";
import ToolsPage from "./routes/tools.js";
import FundsPage from "./routes/funds.js";
import WatchlistPage from "./routes/watchlist.js";
import NotesPage from "./routes/notes.js";
import AssistantPage from "./routes/assistant.js";
import TokensPage from "./routes/tokens.js";
import ClientsPage from "./routes/clients.js";
import SettingsPage from "./routes/settings.js";
import AdminUsersPage from "./routes/admin-users.js";
import AdminClientsPage from "./routes/admin-clients.js";
import AdminAuditPage from "./routes/admin-audit.js";
import "./app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function ErrorScreen() {
  return (
    <div className="grid min-h-screen place-items-center p-4 text-center">
      <div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Try reloading the page. If the problem persists, contact an administrator.
        </p>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: "/login", loader: loginLoader, element: <Login />, errorElement: <ErrorScreen /> },
  {
    id: "shell",
    path: "/",
    loader: shellLoader,
    element: <Shell />,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "activity", element: <ActivityPage /> },
      { path: "integrations", element: <IntegrationsPage /> },
      { path: "tools", element: <ToolsPage /> },
      { path: "funds", element: <FundsPage /> },
      { path: "watchlist", element: <WatchlistPage /> },
      { path: "notes", element: <NotesPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "tokens", element: <TokensPage /> },
      { path: "clients", element: <ClientsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "admin/users", element: <AdminUsersPage /> },
      { path: "admin/clients", element: <AdminClientsPage /> },
      { path: "admin/audit", element: <AdminAuditPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
