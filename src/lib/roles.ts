import type { Role, User } from "../types";

export const ADMIN_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN"];
export const OPERATIONS_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF"];
export const CUSTOMER_BOOKING_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "CUSTOMER"];

export function hasAnyRole(user: User | null | undefined, roles: readonly Role[]) {
  return Boolean(user?.roles.some((role) => roles.includes(role)));
}

export function primaryRole(user: User | null | undefined): Role {
  const priority: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "COACH", "CUSTOMER"];
  return priority.find((role) => user?.roles.includes(role)) ?? "CUSTOMER";
}
