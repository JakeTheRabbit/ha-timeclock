"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session; getQueryClient memoizes on the client and
  // returns a fresh instance on the server (avoids cross-request state bleed).
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {/* Inside the query client so I18nProvider's useLocale (GET /api/locale)
          works and re-renders translations when ["locale"] is invalidated. */}
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
