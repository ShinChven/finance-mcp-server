# URL-Driven State

Every page-level UI state in the dashboard lives in **React Router URL search
parameters** — never in component state or a global store. It is a mandatory
project rule, not a preference.

| State | Parameter |
|---|---|
| Search / query text | `?q=` |
| Pagination | `?page=`, `?per_page=` |
| Filtering | `?status=`, `?role=`, `?action=`, … |
| Tab switching | `?tab=` |
| Sorting | `?sort=` (e.g. `sort=created_at.desc`) |

## What it buys you

- **Every view is a link.** A filtered fund list, a note that is open, a specific
  page of the audit log — all shareable and bookmarkable.
- **Back and forward work.** Navigation, reload and history all reproduce the
  exact same page content, because TanStack Query derives its query keys from the
  parsed search params.
- **The URL maps 1:1 to the API call.** Backend list endpoints accept the same
  parameter names — `q`, `status`, `page`, `per_page`, `sort` — so what you see in
  the address bar is what the server was asked.

## The rules

- Read and write params with `useSearchParams` (or a loader's `request.url`), and
  parse them through a shared zod helper that applies defaults.
- Updating a filter or search **resets `page` to 1**.
- Keystroke-level updates (a debounced search input) use `setSearchParams` with
  `replace: true`; discrete actions (tab, page, filter) push history.
- Params equal to their default are **omitted**, to keep URLs clean.
