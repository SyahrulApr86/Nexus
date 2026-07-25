import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UserDto } from "@nexus/shared";
import { api, ApiError } from "./client.js";
import { applyTheme, type Theme } from "../theme.js";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const { user } = await api<{ user: UserDto }>("/auth/me");
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: UserDto }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ user }) => {
      qc.setQueryData(["me"], user);
      applyTheme(user.theme as Theme);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      displayName?: string;
    }) =>
      api<{ user: UserDto }>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ user }) => qc.setQueryData(["me"], user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { theme?: Theme; idleTimeoutMinutes?: number }) =>
      api<{ user: UserDto }>("/auth/preferences", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: ({ user }) => {
      qc.setQueryData(["me"], user);
      applyTheme(user.theme as Theme);
    },
  });
}
