import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { User } from "../types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (input: { email: string; password: string }) => Promise<User>;
  register: (input: { email: string; password: string; firstName: string; lastName: string; phone?: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<User | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try { return (await apiFetch<{ user: User }>("/api/auth/me")).user; } catch { return null; }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false
  });
  const loginMutation = useMutation({
    mutationFn: (input: { email: string; password: string }) => apiFetch<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (data) => queryClient.setQueryData(["auth", "me"], data.user)
  });
  const registerMutation = useMutation({
    mutationFn: (input: { email: string; password: string; firstName: string; lastName: string; phone?: string }) => apiFetch<{ user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (data) => queryClient.setQueryData(["auth", "me"], data.user)
  });
  const refreshAuth = useCallback(async () => (await meQuery.refetch()).data ?? null, [meQuery]);
  const value = useMemo<AuthContextValue>(() => ({
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    login: async (input) => (await loginMutation.mutateAsync(input)).user,
    register: async (input) => (await registerMutation.mutateAsync(input)).user,
    logout: async () => { await apiFetch<null>("/api/auth/logout", { method: "POST" }); queryClient.setQueryData(["auth", "me"], null); },
    refreshAuth
  }), [meQuery.data, meQuery.isLoading, loginMutation, registerMutation, queryClient, refreshAuth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
