import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { createLogger } from '~/utils/logger';
const logger = createLogger('AuthContext');

// Use dnd_ prefix to isolate from other apps on the same domain
const USER_STORAGE_KEY = 'dnd_user';
const TEST_USER_ID_KEY = 'dnd_test_user_id';


interface User {
  id: string;
  name: string;
  email?: string;
  role: 'dm' | 'player' | 'spectator';
  campaignId?: string;
}

interface AuthContextType {
  user: User | null;
  userId: string;
  userRole: 'dm' | 'player' | 'spectator';
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userId: '',
  userRole: 'player',
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
  getAuthHeaders: () => ({})
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load user from localStorage or session
    const loadUser = () => {
      try {
        // Try to get user from localStorage first
        const storedUser = localStorage.getItem(USER_STORAGE_KEY);
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        } else {
          // Fallback to getting user from URL params or session
          const urlParams = new URLSearchParams(window.location.search);
          const userId = urlParams.get('user_id');
          const userRole = urlParams.get('role');

          if (userId) {
            const defaultUser: User = {
              id: userId,
              name: `User ${userId}`,
              role: (userRole as 'dm' | 'player' | 'spectator') || 'player'
            };
            setUser(defaultUser);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(defaultUser));
          } else {
            // Fallback to test_user_id from localStorage (for test mode)
            const testUserId = localStorage.getItem(TEST_USER_ID_KEY);
            if (testUserId) {
              const defaultUser: User = {
                id: testUserId,
                name: `User ${testUserId}`,
                role: 'player'
              };
              setUser(defaultUser);
              localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(defaultUser));
            }
          }
        }
      } catch (error) {
        logger.error('Failed to load user:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(USER_STORAGE_KEY);
  };

  const updateUser = (updates: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedUser));
    }
  };

  const getAuthHeaders = (): Record<string, string> => {
    return {
      'Content-Type': 'application/json'
    };
  };

  const value: AuthContextType = {
    user,
    userId: user?.id || '',
    userRole: user?.role || 'player',
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    updateUser,
    getAuthHeaders
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to access authentication context
 * @throws Error if used outside of AuthProvider
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * HOC to protect routes that require authentication
 */
export const withAuth = <P extends object>(
  Component: React.ComponentType<P>,
  requiredRole?: 'dm' | 'player' | 'spectator'
): React.FC<P> => {
  return (props: P) => {
    const { isAuthenticated, userRole, isLoading } = useAuth();

    if (isLoading) {
      return <div>Loading...</div>;
    }

    if (!isAuthenticated) {
      return <div>Please log in to access this page</div>;
    }

    if (requiredRole && userRole !== requiredRole) {
      return <div>You don't have permission to access this page</div>;
    }

    return <Component {...props} />;
  };
};

export default AuthContext;
