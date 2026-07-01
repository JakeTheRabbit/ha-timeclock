"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";

export interface SessionEmployee {
  id: string;
  displayName: string;
  role: "employee" | "lead" | "manager" | "admin";
}

interface SessionResponse {
  session: { id: string; expiresAt: string; employee: SessionEmployee } | null;
}

export function useSession() {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => apiGet<SessionResponse>("/auth/session"),
    staleTime: 30_000,
  });
  return {
    ...query,
    session: query.data?.session ?? null,
    employee: query.data?.session?.employee ?? null,
  };
}
