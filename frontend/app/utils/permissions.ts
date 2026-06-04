/**
 * User permissions utilities
 */

import { getAuthUser } from "./auth";

export enum UserRole {
  ADMIN = "admin",
  REGULAR = "regular",
}

/**
 * Get current user role from auth
 */
export function getCurrentUserRole(): UserRole {
  const user = getAuthUser();
  if (user?.role === "admin") {
    return UserRole.ADMIN;
  }
  return UserRole.REGULAR;
}

/**
 * Check if current user is admin
 */
export function isCurrentUserAdmin(): boolean {
  return getCurrentUserRole() === UserRole.ADMIN;
}

/**
 * @deprecated Use isCurrentUserAdmin() instead
 * Check if user is admin (legacy support)
 */
export function isAdmin(_userId?: string): boolean {
  return isCurrentUserAdmin();
}
