import { permissionsConfig } from "@punarvas/shared";
import type { UserRole } from "@punarvas/shared";

const grantsByRole: Record<UserRole, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(permissionsConfig.roles).map(([role, granted]) => [role, new Set(granted)]),
) as unknown as Record<UserRole, ReadonlySet<string>>;

export function hasPermission(role: UserRole, permission: string): boolean {
  return grantsByRole[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: UserRole): string[] {
  return Array.from(grantsByRole[role] ?? []);
}
