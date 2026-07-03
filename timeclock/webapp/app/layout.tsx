import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { themeInitScript } from "@/lib/theme";
import { DemoBanner } from "@/components/demo/demo-banner";

export const metadata: Metadata = {
  title: "Time Clock",
  description: "Employee time-clock system with an immutable audit trail.",
};

// Kiosk tablet: lock zoom, cover the notch, no user-scalable jank on punch.
// themeColor per scheme mirrors HA's primary-background-color (dark #111111 /
// light #fafafa) so the browser chrome matches the resolved theme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // required for env(safe-area-inset-*) utilities
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-NZ" suppressHydrationWarning>
      <head>
        {/* Set data-theme + accent from localStorage BEFORE first paint so the
            app never flashes the wrong theme (falls back to prefers-color-scheme). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body>
        <DemoBanner />
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
