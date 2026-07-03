"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChartColumn,
  IdCard,
  KeyRound,
  Settings2,
  Timer,
  TreePalm,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";
import { roleAtLeast } from "@/server/auth/rbac";
import { useT } from "@/lib/i18n";
import { ThemeControls } from "@/components/theme/theme-controls";

interface Whoami {
  ha: { haUserId: string; displayName: string | null } | null;
  employee: { id: string; displayName: string; role: string } | null;
  bootstrapped: boolean;
}

function Tile({
  href,
  icon: Icon,
  label,
  description,
  primary,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-24 flex-col justify-center gap-1 rounded-xl border p-4 shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]",
        primary
          ? "col-span-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      <Icon className={cn(primary ? "size-8" : "size-6")} aria-hidden="true" />
      <span className={cn("font-semibold", primary && "text-lg")}>{label}</span>
      <span
        className={cn(
          "text-sm",
          primary ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {description}
      </span>
    </Link>
  );
}

export default function Home() {
  // useSession performs HA SSO server-side: an HA account linked to an
  // employee is signed in the moment this page loads, on any device.
  const { session, isLoading } = useSession();
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<Whoami>("/auth/whoami"),
  });
  const t = useT();

  const role = session?.employee.role ?? "employee";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="col-span-2 h-28 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : session ? (
        <nav aria-label="Sections" className="grid grid-cols-2 gap-3">
          <Tile
            href="/clock"
            icon={Timer}
            label={t("home.clock.label")}
            description={t("home.clock.description")}
            primary
          />
          <Tile
            href="/my-hours"
            icon={ChartColumn}
            label={t("home.myHours.label")}
            description={t("home.myHours.description")}
          />
          <Tile
            href="/roster"
            icon={CalendarDays}
            label={t("home.roster.label")}
            description={t("home.roster.description")}
          />
          <Tile
            href="/leave"
            icon={TreePalm}
            label={t("home.leave.label")}
            description={t("home.leave.description")}
          />
          {roleAtLeast(role, "lead") && (
            <Tile
              href="/manager"
              icon={Users}
              label={t("home.manager.label")}
              description={t("home.manager.description")}
            />
          )}
          {roleAtLeast(role, "admin") && (
            <>
              <Tile
                href="/admin/employees"
                icon={IdCard}
                label={t("home.employees.label")}
                description={t("home.employees.description")}
              />
              <Tile
                href="/admin/settings"
                icon={Settings2}
                label={t("home.settings.label")}
                description={t("home.settings.description")}
              />
            </>
          )}
        </nav>
      ) : null}

      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("theme.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ThemeControls />
          </CardContent>
        </Card>
      )}

      {!session && !isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
            <Timer className="size-10 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">{t("home.notSignedIn")}</p>
              <p className="text-sm text-muted-foreground">
                {t("home.tagline")}
              </p>
            </div>
            <Button asChild size="lg" className="w-full max-w-xs">
              <Link href="/pin">
                <KeyRound aria-hidden="true" /> {t("home.kioskSignIn")}
              </Link>
            </Button>
            {whoami.data?.ha && !whoami.data.employee && whoami.data.bootstrapped && (
              <p className="text-sm text-muted-foreground">
                {t("home.notLinkedHint", {
                  account: whoami.data.ha.displayName ?? whoami.data.ha.haUserId,
                })}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
