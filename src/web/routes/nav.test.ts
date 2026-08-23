import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "./shell.js";

/**
 * The sidebar is the only place most of these routes are reachable from, and a
 * link to a path the router does not serve renders as a normal, inviting link
 * that lands on a blank page. Nothing else in the app cross-checks the two
 * lists, so this does: `main.tsx` is read as text because importing it would
 * run `createRoot` against a DOM that does not exist here.
 */
const routerSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

const declaredPaths = new Set(
  [...routerSource.matchAll(/\{\s*path:\s*"([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .map((path) => (path.startsWith("/") ? path : `/${path}`)),
);
declaredPaths.add("/"); // the `index: true` child of the shell

const navItems = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ ...item, section: section.label })),
);

describe("sidebar navigation", () => {
  it("points every link at a route the router serves", () => {
    for (const item of navItems) expect(declaredPaths).toContain(item.to);
  });

  it("does not link the same route twice", () => {
    const targets = navItems.map((item) => item.to);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("keeps Overview exact-matched so it is not active on every route", () => {
    const overview = navItems.find((item) => item.to === "/");
    expect(overview?.end).toBe(true);
    // Any other `end` link would be a mistake: these are all leaf routes.
    expect(navItems.filter((item) => item.end)).toHaveLength(1);
  });

  it("groups the sections in the intended order, with Overview ungrouped on top", () => {
    expect(NAV_SECTIONS.map((section) => section.label)).toEqual([
      undefined,
      "Workspace",
      "Connect",
      "Account",
      "Admin",
    ]);
    expect(NAV_SECTIONS[0]?.items).toHaveLength(1);
  });

  it("restricts admin routes to the Admin section, and that section to admins", () => {
    for (const item of navItems) {
      expect(item.to.startsWith("/admin/")).toBe(item.section === "Admin");
    }
    for (const section of NAV_SECTIONS) {
      expect(Boolean(section.adminOnly)).toBe(section.label === "Admin");
    }
  });
});
