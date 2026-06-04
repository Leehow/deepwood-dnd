/**
 * Authentication utilities for token storage and user management
 */

// Use dnd_ prefix to isolate from other apps on the same domain (e.g., /chat)
export const AUTH_TOKEN_KEY = "dnd_auth_token";
export const AUTH_USER_KEY = "dnd_auth_user";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

/**
 * Get the stored auth token
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Set the auth token
 */
export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/**
 * Get the stored auth user
 */
export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const userStr = localStorage.getItem(AUTH_USER_KEY);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Set the auth user
 */
export function setAuthUser(user: AuthUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

/**
 * Clear all auth data (logout)
 */
export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  // Also clear old keys (for migration) and test user data
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  localStorage.removeItem("dnd_test_user_id");
  localStorage.removeItem("test_user_id");
  localStorage.removeItem("dnd_user");
  localStorage.removeItem("user");
  localStorage.removeItem("dnd_last_route");
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const token = getAuthToken();
  if (!token) return false;

  // Check if token is expired
  try {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return false;
    const now = Date.now() / 1000;
    return (payload.exp as number) > now;
  } catch {
    return false;
  }
}

/**
 * Parse JWT payload without verification
 */
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Login with email and password
 */
export async function login(
  email: string,
  password: string,
  apiUrl: string
): Promise<AuthResponse> {
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Login failed: ${response.status}`);
  }

  const data: AuthResponse = await response.json();

  // Store auth data
  setAuthToken(data.access_token);
  setAuthUser(data.user);

  return data;
}

/**
 * Logout and clear auth data
 */
export function logout(): void {
  clearAuth();
  // Redirect to login page with correct base path
  if (typeof window !== "undefined") {
    const basePath = typeof import.meta.env?.BASE_URL === 'string'
      ? import.meta.env.BASE_URL.replace(/\/$/, '')
      : '';
    window.location.href = `${basePath}/login`;
  }
}
