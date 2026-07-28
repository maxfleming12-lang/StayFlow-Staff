import { describe, expect, it } from "vitest";
import { isActivePath, navItemsFor, primaryNavItemsFor } from "./navigation";

describe("navigation visibility", () => {
  it("shows staff only their own sections", () => {
    const ids = navItemsFor("staff").map((i) => i.id);
    expect(ids).toContain("roster");
    expect(ids).toContain("clock");
    expect(ids).not.toContain("team");
    expect(ids).not.toContain("reports");
  });

  it("gives supervisors the team view but not reports", () => {
    const ids = navItemsFor("supervisor").map((i) => i.id);
    expect(ids).toContain("team");
    expect(ids).not.toContain("reports");
  });

  it("gives managers and above everything", () => {
    expect(navItemsFor("manager").map((i) => i.id)).toContain("reports");
    expect(navItemsFor("owner").length).toBeGreaterThanOrEqual(
      navItemsFor("manager").length,
    );
  });

  it("never exceeds five items in the mobile bottom bar", () => {
    for (const role of ["staff", "supervisor", "manager", "owner"] as const) {
      expect(primaryNavItemsFor(role).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("isActivePath", () => {
  it("matches the dashboard only exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/", "/roster")).toBe(false);
  });

  it("matches a section and its children", () => {
    expect(isActivePath("/roster", "/roster")).toBe(true);
    expect(isActivePath("/roster", "/roster/2026-08-03")).toBe(true);
  });

  it("does not match a different section with a shared prefix", () => {
    expect(isActivePath("/task", "/tasks")).toBe(false);
  });
});
