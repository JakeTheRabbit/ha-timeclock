"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, House, KeyRound, LogOut, ShieldCheck, Timer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { PinPad } from "@/components/kiosk/PinPad";
import { useSession, type SessionEmployee } from "@/hooks/use-session";
import { useT } from "@/lib/i18n";

interface KioskEmployees {
  employees: { id: string; displayName: string; hasPin: boolean }[];
}
interface Whoami {
  ha: { haUserId: string; displayName: string | null } | null;
  employee: { id: string; displayName: string; role: string } | null;
  bootstrapped: boolean;
}

export default function PinPage() {
  const qc = useQueryClient();
  const { session } = useSession();
  const t = useT();
  const [selected, setSelected] = useState<{ id: string; displayName: string } | null>(null);

  const staff = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: () => apiGet<KioskEmployees>("/auth/kiosk-employees"),
  });
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<Whoami>("/auth/whoami"),
  });

  const claim = useMutation({
    mutationFn: () => apiPost<{ claimed: boolean }>("/auth/claim-admin"),
    onSuccess: () => {
      toast.success(t("toast.adminClaimed"));
      qc.invalidateQueries();
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? t("toast.claimFailedStatus", { status: e.status })
          : t("toast.claimFailed"),
      ),
  });

  const login = useMutation({
    mutationFn: (vars: { employeeId: string; pin: string }) =>
      apiPost<{ ok: boolean; employee: SessionEmployee }>("/auth/pin-login", vars),
    onSuccess: (data) => {
      toast.success(t("toast.signedInAs", { name: data.employee.displayName }));
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | null)?.error;
        toast.error(
          code === "rate_limited"
            ? t("toast.rateLimited")
            : code === "device_not_bound"
              ? t("toast.deviceNotBound")
              : t("toast.wrongPin"),
        );
      } else toast.error(t("toast.loginFailed"));
    },
  });

  const logout = useMutation({
    mutationFn: () => apiPost("/auth/logout"),
    onSuccess: () => {
      toast.success(t("toast.signedOut"));
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? t("toast.signOutFailedStatus", { status: e.status })
          : t("toast.signOutFailed"),
      ),
  });

  const showClaim =
    whoami.data?.ha != null && whoami.data.employee == null && !whoami.data.bootstrapped;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6 pb-safe">
      <div className="flex items-center gap-3">
        <Clock className="size-8 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">{t("pin.title")}</h1>
      </div>

      {session ? (
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 py-4 text-center">
            <p className="text-lg">
              {t("pin.signedInAs")}{" "}
              <span className="font-semibold">{session.employee.displayName}</span>
            </p>
            <Badge variant="secondary" className="capitalize">
              {session.employee.role}
            </Badge>
            <Button asChild size="lg" className="h-14 w-full text-lg">
              <Link href="/clock">
                <Timer className="size-5" aria-hidden="true" /> {t("pin.goToClock")}
              </Link>
            </Button>
            <Button
              variant="ghost"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut aria-hidden="true" /> {t("common.signOut")}
            </Button>
          </CardContent>
        </Card>
      ) : selected ? (
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 py-4">
            <p className="text-lg font-semibold">
              {t("pin.greeting", { name: selected.displayName })}
            </p>
            <PinPad
              disabled={login.isPending}
              onSubmit={(pin) => login.mutate({ employeeId: selected.id, pin })}
            />
            <Button variant="ghost" onClick={() => setSelected(null)}>
              <ChevronLeft aria-hidden="true" /> {t("pin.backToStaffList")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          {staff.isLoading ? (
            <div className="grid w-full grid-cols-2 gap-3">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : (
            <div className="grid w-full grid-cols-2 gap-3">
              {staff.data?.employees.map((e) =>
                e.hasPin ? (
                  <Button
                    key={e.id}
                    variant="secondary"
                    onClick={() => setSelected(e)}
                    className="h-auto min-h-16 flex-col gap-2 whitespace-normal rounded-xl px-4 py-4 text-lg font-medium"
                  >
                    <Avatar employeeId={e.id} name={e.displayName} size="md" />
                    {e.displayName}
                  </Button>
                ) : (
                  <div
                    key={e.id}
                    aria-disabled="true"
                    title={t("pin.noPinSetTooltip")}
                    className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-4 py-3 text-lg font-medium text-muted-foreground opacity-60"
                  >
                    <Avatar employeeId={e.id} name={e.displayName} size="md" className="opacity-80" />
                    {e.displayName}
                    <Badge variant="outline" className="font-normal">
                      {t("pin.noPinSet")}
                    </Badge>
                  </div>
                ),
              )}
            </div>
          )}
          {staff.data?.employees.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              {t("pin.noStaffYet")}
              {whoami.data?.employee ? t("pin.addThemInAdmin") : ""}
            </p>
          )}
          {showClaim && (
            <Button
              size="lg"
              disabled={claim.isPending}
              onClick={() => claim.mutate()}
            >
              <ShieldCheck aria-hidden="true" /> {t("pin.claimAdmin")}
            </Button>
          )}
          {!session && !selected && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden="true" />
              {t("pin.tapName")}
            </p>
          )}
        </div>
      )}

      {/* The lock screen has no shell chrome, so give it its own way out —
          never rely on the browser back button (it exits the HA ingress iframe). */}
      <Button asChild variant="ghost" className="text-muted-foreground">
        <Link href="/">
          <House aria-hidden="true" /> {t("pin.backToHome")}
        </Link>
      </Button>
    </main>
  );
}
