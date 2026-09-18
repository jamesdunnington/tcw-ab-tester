import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../lib/api.js";

interface CurrentUser {
  id: string;
  email: string;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Only succeeds once, while zero admin accounts exist — see routes/auth.ts bootstrap(). */
  bootstrap: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: CurrentUser }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ user: CurrentUser }>("/api/auth/login", { email, password });
    setUser(res.user);
  }

  async function bootstrap(email: string, password: string) {
    try {
      const res = await api.post<{ user: CurrentUser }>("/api/auth/bootstrap", { email, password });
      setUser(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        throw new Error("An admin account already exists — use Log In instead.");
      }
      throw err;
    }
  }

  async function logout() {
    await api.post("/api/auth/logout");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, bootstrap, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
