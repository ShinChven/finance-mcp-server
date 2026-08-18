import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { DEFAULT_PAGE_SIZE } from "../../shared/preferences.js";

/**
 * Project rule: all page-level state (search, filters, pagination, sorting,
 * tabs) lives in URL search params. This hook is the single reader/writer.
 * Backend list endpoints accept the same names 1:1, so `apiQuery` can be
 * appended to the endpoint directly.
 */
export interface ListParamValues {
  q: string;
  status: string;
  role: string;
  action: string;
  /** Fund category on the Funds page (`qdii`, `index`, `equity`). */
  type: string;
  tab: string;
  /** Selected entity (e.g. active conversation) — part of the URL so views are shareable. */
  c: string;
  /** Selected MCP tool on the Tools browser. */
  tool: string;
  /** Fund whose holdings are open on the Funds page. */
  fund: string;
  page: number;
  per_page: number;
  sort: string;
}

const FILTER_KEYS = ["q", "status", "role", "action", "type"] as const;

export function useListParams(defaults: Partial<ListParamValues> = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultPerPage = defaults.per_page ?? DEFAULT_PAGE_SIZE;
  const defaultSort = defaults.sort ?? "";
  const defaultTab = defaults.tab ?? "";

  const values: ListParamValues = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      status: searchParams.get("status") ?? "",
      role: searchParams.get("role") ?? "",
      action: searchParams.get("action") ?? "",
      type: searchParams.get("type") ?? "",
      tab: searchParams.get("tab") ?? defaultTab,
      c: searchParams.get("c") ?? "",
      tool: searchParams.get("tool") ?? "",
      fund: searchParams.get("fund") ?? "",
      page: Math.max(1, Number(searchParams.get("page")) || 1),
      per_page: Math.min(100, Math.max(1, Number(searchParams.get("per_page")) || defaultPerPage)),
      sort: searchParams.get("sort") ?? defaultSort,
    }),
    [searchParams, defaultPerPage, defaultSort, defaultTab],
  );

  /** Query string for the matching API list endpoint. */
  const apiQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (values.q) params.set("q", values.q);
    if (values.status) params.set("status", values.status);
    if (values.role) params.set("role", values.role);
    if (values.action) params.set("action", values.action);
    if (values.type) params.set("type", values.type);
    if (values.page > 1) params.set("page", String(values.page));
    params.set("per_page", String(values.per_page));
    if (values.sort) params.set("sort", values.sort);
    return params.toString();
  }, [values]);

  const update = useCallback(
    (patch: Partial<Record<keyof ListParamValues, string | number>>, options: { replace?: boolean } = {}) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(patch)) {
            const isDefault =
              value === "" ||
              value === undefined ||
              (key === "page" && value === 1) ||
              (key === "per_page" && value === defaultPerPage) ||
              (key === "sort" && value === defaultSort) ||
              (key === "tab" && value === defaultTab);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
          }
          // Changing a filter or search resets pagination.
          if (FILTER_KEYS.some((key) => key in patch) && !("page" in patch)) next.delete("page");
          return next;
        },
        { replace: options.replace },
      );
    },
    [setSearchParams, defaultPerPage, defaultSort, defaultTab],
  );

  return { ...values, apiQuery, update };
}
