import { describe, expect, it } from "vitest";
import {
  ROLES,
  atLeast,
  canManageRosters,
  canViewConfidentialEmployment,
  isOrganisationAdmin,
  isRole,
} from "./roles";

describe("role hierarchy", () => {
  it("treats a role as at least itself", () => {
    for (const role of ROLES) {
      expect(atLeast(role, role)).toBe(true);
    }
  });

  it("ranks roles from staff up to owner", () => {
    expect(atLeast("owner", "administrator")).toBe(true);
    expect(atLeast("administrator", "manager")).toBe(true);
    expect(atLeast("manager", "supervisor")).toBe(true);
    expect(atLeast("supervisor", "staff")).toBe(true);
  });

  it("does not let a lower role satisfy a higher requirement", () => {
    expect(atLeast("staff", "supervisor")).toBe(false);
    expect(atLeast("supervisor", "manager")).toBe(false);
    expect(atLeast("manager", "administrator")).toBe(false);
    expect(atLeast("administrator", "owner")).toBe(false);
  });
});

describe("confidential employment information", () => {
  // Explicitly required: supervisors must not see pay rates, employment
  // records or emergency contacts.
  it("is hidden from supervisors and staff", () => {
    expect(canViewConfidentialEmployment("staff")).toBe(false);
    expect(canViewConfidentialEmployment("supervisor")).toBe(false);
  });

  it("is visible to managers and above", () => {
    expect(canViewConfidentialEmployment("manager")).toBe(true);
    expect(canViewConfidentialEmployment("administrator")).toBe(true);
    expect(canViewConfidentialEmployment("owner")).toBe(true);
  });
});

describe("capability helpers", () => {
  it("limits roster management to managers and above", () => {
    expect(canManageRosters("supervisor")).toBe(false);
    expect(canManageRosters("manager")).toBe(true);
  });

  it("limits organisation administration to administrators and owners", () => {
    expect(isOrganisationAdmin("manager")).toBe(false);
    expect(isOrganisationAdmin("administrator")).toBe(true);
    expect(isOrganisationAdmin("owner")).toBe(true);
  });
});

describe("isRole", () => {
  it("accepts known roles", () => {
    expect(isRole("manager")).toBe(true);
  });

  it("rejects anything else, including near-misses from the database", () => {
    expect(isRole("admin")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
