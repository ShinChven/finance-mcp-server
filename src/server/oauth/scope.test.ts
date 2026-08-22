import { describe, expect, it } from "vitest";
import { narrowScope } from "./scope.js";

describe("narrowScope", () => {
  it("keeps a request for exactly what is supported", () => {
    expect(narrowScope("mcp")).toBe("mcp");
  });

  it("drops extras rather than failing the authorization", () => {
    // The lockout this fixes: clients ask for offline_access as a matter of
    // course, and rejecting the whole request meant they could never connect.
    expect(narrowScope("mcp offline_access")).toBe("mcp");
    expect(narrowScope("openid profile mcp")).toBe("mcp");
  });

  it("defaults an empty request to the full supported set", () => {
    expect(narrowScope("")).toBe("mcp");
    expect(narrowScope("   ")).toBe("mcp");
  });

  it("still rejects a request with nothing this server grants", () => {
    expect(narrowScope("openid profile")).toBeNull();
  });

  it("returns a stable string regardless of request order", () => {
    // The consent-skip path compares the stored scope for equality, so the same
    // request must not produce two different strings.
    expect(narrowScope("offline_access mcp")).toBe(narrowScope("mcp offline_access"));
  });
});
