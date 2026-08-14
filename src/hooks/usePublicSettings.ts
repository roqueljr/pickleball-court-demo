import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";

export type PublicSettings = { businessName: string; logoUrl: string; address: string; phone: string; email: string; businessHours: string; currency: string; timezone: string };

export function usePublicSettings() {
  return useQuery({ queryKey: ["public-settings"], queryFn: () => apiFetch<PublicSettings>("/api/settings/public"), staleTime: 5 * 60_000 });
}
