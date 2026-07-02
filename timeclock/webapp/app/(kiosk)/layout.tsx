"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";

export default function KioskGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  // /pin is the kiosk lock screen: no top bar, no bottom nav, no back chrome.
  if (pathname === "/pin" || pathname.endsWith("/pin")) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}
