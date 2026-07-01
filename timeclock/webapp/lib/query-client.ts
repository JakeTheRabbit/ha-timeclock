import { QueryClient, isServer } from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Kiosk board polls frequently; keep data fresh but avoid refetch storms.
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) {
    // Server: always a fresh client so requests never share cache.
    return makeQueryClient();
  }
  // Browser: reuse one client across renders.
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
