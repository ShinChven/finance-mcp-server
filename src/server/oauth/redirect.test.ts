import { describe, expect, it } from "vitest";
import { validRedirectUri } from "./redirect.js";

describe("validRedirectUri", () => {
  it("allows https URIs", () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  });

  it("allows http only on loopback", () => {
    expect(validRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(validRedirectUri("http://127.0.0.1/cb")).toBe(true);
    expect(validRedirectUri("http://[::1]:8080/cb")).toBe(true);
    expect(validRedirectUri("http://example.com/cb")).toBe(false);
  });

  it("allows private-use schemes for native apps", () => {
    expect(validRedirectUri("vscode://mcp/auth")).toBe(true);
    expect(validRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
  });

  it("rejects dangerous schemes and garbage", () => {
    expect(validRedirectUri("javascript:alert(1)")).toBe(false);
    expect(validRedirectUri("data:text/html,x")).toBe(false);
    expect(validRedirectUri("file:///etc/passwd")).toBe(false);
    expect(validRedirectUri("not a url")).toBe(false);
  });
});
