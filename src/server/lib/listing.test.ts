import { describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { users } from "../db/schema.js";
import { escapeLike, listQuerySchema, parseSort } from "./listing.js";

describe("escapeLike", () => {
  it("escapes LIKE wildcards", () => {
    expect(escapeLike("50%_done\\x")).toBe("50\\%\\_done\\\\x");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("listQuerySchema", () => {
  it("applies defaults", () => {
    const parsed = listQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.per_page).toBe(20);
  });

  it("coerces and bounds values", () => {
    expect(listQuerySchema.parse({ page: "3", per_page: "50" })).toMatchObject({ page: 3, per_page: 50 });
    expect(() => listQuerySchema.parse({ page: "0" })).toThrow();
    expect(() => listQuerySchema.parse({ per_page: "1000" })).toThrow();
  });
});

describe("parseSort", () => {
  const columns = { email: users.email, created_at: users.createdAt };
  const fallback = desc(users.createdAt);

  it("uses the fallback for unknown or missing sort", () => {
    expect(parseSort(undefined, columns, fallback)).toBe(fallback);
    expect(parseSort("evil_column.desc", columns, fallback)).toBe(fallback);
    expect(parseSort("nonsense", columns, fallback)).toBe(fallback);
  });

  it("parses whitelisted column.direction", () => {
    expect(parseSort("email.asc", columns, fallback)).not.toBe(fallback);
    expect(parseSort("created_at.desc", columns, fallback)).not.toBe(fallback);
  });
});
