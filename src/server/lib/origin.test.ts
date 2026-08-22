import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ config: { appOrigin: "https://finance.example.com" } }));

const { isSelfOrigin } = await import("./origin.js");

/**
 * This comparison is the CSRF defence for two things at once: state-changing
 * API routes, and the realtime socket -- where it is the *only* defence, since
 * WebSockets are exempt from the same-origin policy. Worth pinning the ways a
 * string comparison over origins can be talked into saying yes.
 */
describe("isSelfOrigin", () => {
  it("accepts the configured app origin", () => {
    expect(isSelfOrigin("https://finance.example.com", "finance.example.com")).toBe(true);
  });

  it("accepts the host the request actually arrived on", () => {
    // A deployment reached by an alternate hostname still has to work.
    expect(isSelfOrigin("https://internal.example.com", "internal.example.com")).toBe(true);
    expect(isSelfOrigin("http://localhost:5173", "localhost:5173")).toBe(true);
  });

  it("rejects an unrelated origin", () => {
    expect(isSelfOrigin("https://evil.example.com", "finance.example.com")).toBe(false);
  });

  it("rejects a suffix that merely starts with the real origin", () => {
    expect(isSelfOrigin("https://finance.example.com.evil.test", "finance.example.com")).toBe(false);
  });

  it("rejects a subdomain of the real origin", () => {
    expect(isSelfOrigin("https://evil.finance.example.com", "finance.example.com")).toBe(false);
  });

  it("rejects a different port on the right host", () => {
    expect(isSelfOrigin("https://finance.example.com:8443", "finance.example.com")).toBe(false);
  });

  it("rejects an origin matching the host when no host header was sent", () => {
    // `https://undefined` must not become a valid origin through templating.
    expect(isSelfOrigin("https://undefined", undefined)).toBe(false);
  });
});
