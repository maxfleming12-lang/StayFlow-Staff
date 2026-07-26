import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeRedirectPath("/roster")).toBe("/roster");
    expect(safeRedirectPath("/roster/2026-08-03")).toBe("/roster/2026-08-03");
    expect(safeRedirectPath("/timesheets?week=32")).toBe("/timesheets?week=32");
  });

  it("rejects absolute URLs pointing at another origin", () => {
    expect(safeRedirectPath("https://evil.example/login")).toBe("/");
    expect(safeRedirectPath("http://evil.example")).toBe("/");
    expect(safeRedirectPath("evil.example")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    // "//evil.example" inherits the current scheme and leaves the site.
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("//evil.example/path")).toBe("/");
  });

  it("rejects backslash escapes that some browsers normalise to slashes", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/");
  });

  it("rejects embedded schemes", () => {
    expect(safeRedirectPath("/redirect?to=javascript://evil")).toBe("/");
  });

  it("rejects control characters used for header injection", () => {
    expect(safeRedirectPath("/roster\r\nSet-Cookie: a=b")).toBe("/");
    expect(safeRedirectPath("/roster\nX-Injected: 1")).toBe("/");
    expect(safeRedirectPath("/roster\u0000")).toBe("/");
    expect(safeRedirectPath("/roster\u007f")).toBe("/");
  });

  it("falls back to the dashboard for empty or non-string input", () => {
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(42)).toBe("/");
    // An object that stringifies to a safe path is still not a string.
    expect(safeRedirectPath({ toString: () => "/roster" })).toBe("/");
  });
});
