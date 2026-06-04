/**
 * User utility functions
 *
 * IMPORTANT: All user data comes from auth system (auth_user in localStorage)
 * This is the ONLY source of truth for user identity.
 * DO NOT add any alternative storage keys or default values.
 */

import { getAuthUser, type AuthUser } from "./auth";

export type UserRole = "dm" | "player" | "spectator";

/**
 * Get current user ID from auth system
 * Returns empty string if not logged in
 */
export function getCurrentUserId(): string {
  const user = getAuthUser();
  return user?.id || "";
}

/**
 * Get current user's display name
 */
export function getCurrentUserName(): string {
  const user = getAuthUser();
  return user?.display_name || "";
}

/**
 * Get current user's email
 */
export function getCurrentUserEmail(): string {
  const user = getAuthUser();
  return user?.email || "";
}

/**
 * Get current user's role from auth system
 */
export function getCurrentUserRole(): UserRole {
  const user = getAuthUser();
  // Map auth role to app role
  if (user?.role === "admin") return "dm";
  return (user?.role as UserRole) || "player";
}

/**
 * Get combined user identity
 */
export function getCurrentUser(): { id: string; role: UserRole; name: string } {
  const user = getAuthUser();
  return {
    id: user?.id || "",
    role: getCurrentUserRole(),
    name: user?.display_name || ""
  };
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  return !!getCurrentUserId();
}

/**
 * @deprecated Use auth system directly. This function is kept for backwards compatibility.
 */
export function setCurrentUserId(_userId: string, _role?: UserRole): void {
  console.warn("setCurrentUserId is deprecated. Use auth system (login/logout) instead.");
}

/**
 * @deprecated Use auth system directly. This function is kept for backwards compatibility.
 */
export function setCurrentUserRole(_role: UserRole): void {
  console.warn("setCurrentUserRole is deprecated. Use auth system instead.");
}

/**
 * @deprecated No more test users. Users must log in.
 */
export function getTestUsers(): string[] {
  return [];
}
