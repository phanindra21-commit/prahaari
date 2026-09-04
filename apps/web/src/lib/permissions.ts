import { permissionsConfig } from "@punarvas/shared";
import type { UserRole } from "@punarvas/shared";

/** Mirrors apps/api/src/lib/permissions.ts's check — same single-source-of-truth
 * config (packages/shared/src/config/permissions.json), read here only to
 * decide what to SHOW (nav items, buttons); the API remains the sole
 * enforcement point regardless of what the UI decides to render. */
export function hasPermission(role: UserRole, permission: string): boolean {
  return (permissionsConfig.roles[role] as string[] | undefined)?.includes(permission) ?? false;
}
