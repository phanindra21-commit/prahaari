import { describe, it, expect } from "vitest";
import { permissionsConfig, USER_ROLES } from "@prahari/shared";
import type { UserRole } from "@prahari/shared";
import { hasPermission } from "./permissions";

/**
 * The RBAC matrix, restated by hand (independent of permissions.json) so
 * this test actually catches an unintended change to the JSON rather than
 * just re-reading it back — this table is what proves, to a judge asking
 * "how do you stop the wrong person approving a relocation", exactly who
 * can do what. Keep this in sync with
 * packages/shared/src/config/permissions.json deliberately, not
 * automatically: a diff here on review is the point.
 */
const EXPECTED: Record<UserRole, string[]> = {
  SUPER_ADMIN: [
    "assessment:read",
    "auditLog:read",
    "decision:read",
    "district:read",
    "fieldReport:read",
    "fieldReport:submit",
    "fieldReport:verify",
    "habitation:read",
    "habitation:write",
    "hazardEvent:read",
    "hazardEvent:write",
    "hazardZone:read",
    "hazardZone:write",
    "notification:read",
    "pipeline:run",
    "recommendation:approve",
    "recommendation:approveEscalated",
    "recommendation:read",
    "relocationSite:read",
    "relocationSite:write",
    "scenario:read",
    "scenario:run",
    "user:manage",
    "user:read",
    "user:unlock",
  ],
  STATE_ADMIN: [
    "assessment:read",
    "auditLog:read",
    "decision:read",
    "district:read",
    "fieldReport:read",
    "fieldReport:verify",
    "habitation:read",
    "habitation:write",
    "hazardEvent:read",
    "hazardEvent:write",
    "hazardZone:read",
    "hazardZone:write",
    "notification:read",
    "pipeline:run",
    "recommendation:approve",
    "recommendation:approveEscalated",
    "recommendation:read",
    "relocationSite:read",
    "relocationSite:write",
    "scenario:read",
    "scenario:run",
    "user:manage",
    "user:read",
  ],
  DISTRICT_OFFICER: [
    "assessment:read",
    "decision:read",
    "district:read",
    "fieldReport:read",
    "fieldReport:verify",
    "habitation:read",
    "hazardEvent:read",
    "hazardZone:read",
    "notification:read",
    "recommendation:approve",
    "recommendation:read",
    "relocationSite:read",
    "scenario:read",
    "scenario:run",
    "user:read",
  ],
  ANALYST: [
    "assessment:read",
    "decision:read",
    "district:read",
    "fieldReport:read",
    "habitation:read",
    "hazardEvent:read",
    "hazardZone:read",
    "notification:read",
    "pipeline:run",
    "recommendation:read",
    "relocationSite:read",
    "scenario:read",
    "scenario:run",
  ],
  FIELD_VOLUNTEER: [
    "district:read",
    "fieldReport:read",
    "fieldReport:submit",
    "habitation:read",
    "hazardEvent:read",
    "hazardZone:read",
    "notification:read",
  ],
};

const ALL_PERMISSIONS = permissionsConfig.permissions;

describe("RBAC permission matrix (Step 3 Part C3)", () => {
  it("the config's role list matches USER_ROLES exactly", () => {
    expect(Object.keys(permissionsConfig.roles).sort()).toEqual([...USER_ROLES].sort());
  });

  for (const role of USER_ROLES) {
    describe(`role: ${role}`, () => {
      for (const permission of ALL_PERMISSIONS) {
        const expected = EXPECTED[role].includes(permission);
        it(`${expected ? "GRANTS" : "denies"} "${permission}"`, () => {
          expect(hasPermission(role, permission)).toBe(expected);
        });
      }
    });
  }

  describe("separation of duties", () => {
    it("SUPER_ADMIN, DISTRICT_OFFICER, and STATE_ADMIN can all approve recommendations; ANALYST and FIELD_VOLUNTEER cannot", () => {
      for (const role of USER_ROLES) {
        const canApprove = hasPermission(role, "recommendation:approve");
        const shouldApprove = role === "SUPER_ADMIN" || role === "DISTRICT_OFFICER" || role === "STATE_ADMIN";
        expect(canApprove).toBe(shouldApprove);
      }
    });

    it("STATE_ADMIN holds both evidence-write and approval — a deliberate product decision, not the earlier strict separation-of-duties property (see permissions.json's separationOfDuties.note for the mitigation: mandatory justification, hash-chained audit log, distinct decisionLevel/severity marking)", () => {
      expect(hasPermission("STATE_ADMIN", "habitation:write")).toBe(true);
      expect(hasPermission("STATE_ADMIN", "hazardZone:write")).toBe(true);
      expect(hasPermission("STATE_ADMIN", "hazardEvent:write")).toBe(true);
      expect(hasPermission("STATE_ADMIN", "relocationSite:write")).toBe(true);
      expect(hasPermission("STATE_ADMIN", "recommendation:approve")).toBe(true);
    });

    it("only SUPER_ADMIN can unlock accounts", () => {
      for (const role of USER_ROLES) {
        expect(hasPermission(role, "user:unlock")).toBe(role === "SUPER_ADMIN");
      }
    });

    it("FIELD_VOLUNTEER cannot see recommendations, decisions, assessments, candidate sites, or scenarios", () => {
      expect(hasPermission("FIELD_VOLUNTEER", "recommendation:read")).toBe(false);
      expect(hasPermission("FIELD_VOLUNTEER", "decision:read")).toBe(false);
      expect(hasPermission("FIELD_VOLUNTEER", "assessment:read")).toBe(false);
      expect(hasPermission("FIELD_VOLUNTEER", "relocationSite:read")).toBe(false);
      expect(hasPermission("FIELD_VOLUNTEER", "scenario:read")).toBe(false);
      expect(hasPermission("FIELD_VOLUNTEER", "scenario:run")).toBe(false);
    });

    it("FIELD_VOLUNTEER can read disaster history and hazard zones — safety-relevant map data, a genuine permission gap fixed in demo-rehearsal Part 1, not a deliberate restriction", () => {
      expect(hasPermission("FIELD_VOLUNTEER", "hazardEvent:read")).toBe(true);
      expect(hasPermission("FIELD_VOLUNTEER", "hazardZone:read")).toBe(true);
    });

    it("ANALYST cannot create Decisions or edit habitation data", () => {
      expect(hasPermission("ANALYST", "recommendation:approve")).toBe(false);
      expect(hasPermission("ANALYST", "habitation:write")).toBe(false);
    });

    it("only SUPER_ADMIN and STATE_ADMIN hold recommendation:approveEscalated (kept as an explicit routing/visibility permission alongside their direct recommendation:approve grant, not as their only path to approval)", () => {
      for (const role of USER_ROLES) {
        const canApproveEscalated = hasPermission(role, "recommendation:approveEscalated");
        const shouldApproveEscalated = role === "SUPER_ADMIN" || role === "STATE_ADMIN";
        expect(canApproveEscalated).toBe(shouldApproveEscalated);
      }
    });

    it("DISTRICT_OFFICER holds neither habitation:write, hazardZone:write, hazardEvent:write, nor relocationSite:write — it cannot edit the evidence it approves", () => {
      expect(hasPermission("DISTRICT_OFFICER", "habitation:write")).toBe(false);
      expect(hasPermission("DISTRICT_OFFICER", "hazardZone:write")).toBe(false);
      expect(hasPermission("DISTRICT_OFFICER", "hazardEvent:write")).toBe(false);
      expect(hasPermission("DISTRICT_OFFICER", "relocationSite:write")).toBe(false);
    });
  });

  it("returns false for an unknown permission string on every role", () => {
    for (const role of USER_ROLES) {
      expect(hasPermission(role, "notARealResource:notARealAction")).toBe(false);
    }
  });
});
