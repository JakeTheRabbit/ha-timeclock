"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChartColumn,
  ChevronLeft,
  House,
  LogOut,
  Settings2,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { useSession } from "@/hooks/use-session";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";
// roleAtLeast is a pure function (its hono/server imports are type-only), so
// it is safe to use from a client component.
import { roleAtLeast } from "@/server/auth/rbac";

/** Known route -> top-bar title message key. Unknown routes fall back to the last segment. */
const ROUTE_TITLES: Record<string, MessageKey> = {
  "/": "route.home",
  "/clock": "route.clock",
  "/pin": "route.pin",
  "/my-hours": "route.myHours",
  "/roster": "route.roster",
  "/leave": "route.leave",
  "/manager": "route.manager",
  "/manager/audit": "route.managerAudit",
  "/manager/pay-periods": "route.managerPayPeriods",
  "/admin/employees": "route.adminEmployees",
  "/admin/settings": "route.adminSettings",
};

/**
 * Deterministic parent map for the back button. /manager sub-pages go up to
 * /manager; everything else goes home.
 */
const PARENT_ROUTES: Record<string, string> = {
  "/manager/audit": "/manager",
  "/manager/pay-periods": "/manager",
};

function parentOf(pathname: string): string {
  return PARENT_ROUTES[pathname] ?? "/";
}

function titleOf(pathname: string, t: (key: MessageKey) => string): string {
  const known = ROUTE_TITLES[pathname];
  if (known) return t(known);
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return segment
    ? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")
    : t("route.home");
}

interface NavTab {
  href: string;
  /** Section prefix used for active-state matching ("/" matches exactly). */
  match: string;
  label: MessageKey;
  icon: LucideIcon;
}

const BASE_TABS: NavTab[] = [
  { href: "/", match: "/", label: "nav.home", icon: House },
  { href: "/clock", match: "/clock", label: "nav.clock", icon: Timer },
  { href: "/my-hours", match: "/my-hours", label: "nav.hours", icon: ChartColumn },
];

export interface AppShellProps {
  children: React.ReactNode;
  /** Override the derived top-bar title. */
  title?: string;
  /** "bare" renders children with no chrome (used for the /pin lock screen). */
  variant?: "default" | "bare";
}

export function AppShell({ children, title, variant = "default" }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { employee } = useSession();
  const [signingOut, setSigningOut] = React.useState(false);
  const t = useT();

  if (variant === "bare") {
    return <>{children}</>;
  }

  const isHome = pathname === "/";
  const pageTitle = title ?? titleOf(pathname, t);

  const tabs: NavTab[] = employee
    ? [
        ...BASE_TABS,
        ...(roleAtLeast(employee.role, "lead")
          ? [{ href: "/manager", match: "/manager", label: "nav.manager", icon: Users } as NavTab]
          : []),
        ...(roleAtLeast(employee.role, "admin")
          ? [
              {
                href: "/admin/employees",
                match: "/admin",
                label: "nav.admin",
                icon: Settings2,
              } as NavTab,
            ]
          : []),
      ]
    : [BASE_TABS[0]];

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await apiPost("/auth/logout");
      toast.success(t("toast.signedOut"));
    } catch {
      // Still refetch the session below so the UI reflects reality, but never
      // fail silently (the original app's cardinal sin).
      toast.error(t("toast.signOutFailed"));
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      setSigningOut(false);
      router.push("/");
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 pt-safe backdrop-blur">
        <div className="flex h-14 items-center gap-1 px-2">
          {!isHome && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.back")}
              onClick={() => router.push(parentOf(pathname))}
            >
              <ChevronLeft className="size-6" />
            </Button>
          )}
          <h1
            className={cn(
              "min-w-0 flex-1 truncate text-base font-semibold",
              isHome && "pl-2",
            )}
          >
            {pageTitle}
          </h1>
          {employee && (
            <div className="flex shrink-0 items-center gap-2 pr-1">
              <Avatar employeeId={employee.id} name={employee.displayName} size="sm" />
              <span className="max-w-28 truncate text-sm text-muted-foreground">
                {employee.displayName}
              </span>
              <Badge variant="secondary" className="capitalize">
                {employee.role}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.signOut")}
                disabled={signingOut}
                onClick={handleSignOut}
              >
                <LogOut className="size-5" />
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Scrollable content; padding = nav height (4rem) + 2rem breathing room
          + the safe-area inset, so the last element is never under the nav. */}
      <main className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
        {children}
      </main>

      {/* Bottom nav */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 pb-safe backdrop-blur"
      >
        <div className="flex h-16 items-stretch">
          {tabs.map((tab) => {
            const active =
              tab.match === "/"
                ? pathname === "/"
                : pathname === tab.match || pathname.startsWith(`${tab.match}/`);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-6" aria-hidden="true" />
                <span className="text-[11px] font-medium leading-none">
                  {t(tab.label)}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
