"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, House, KeyRound, LogOut, Search, ShieldCheck, Timer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { PinPad } from "@/components/kiosk/PinPad";
import { useSession, type SessionEmployee } from "@/hooks/use-session";
import { loadRecent, orderStaff, rememberSignIn } from "@/lib/kiosk-staff";
import { useT } from "@/lib/i18n";

interface KioskEmployees {
  employees: { id: string; displayName: string; hasPin: boolean; clockedIn?: boolean }[];
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
  const [pinError, setPinError] = useState("");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(loadRecent()), []); // localStorage: client only
  const pick = (e: { id: string; displayName: string } | null) => {
    setSelected(e);
    setPinError("");
  };

  const staff = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: () => apiGet<KioskEmployees>("/auth/kiosk-employees"),
  });
  // Search filter, then who last signed in on this device first.
  const shown = orderStaff(staff.data?.employees ?? [], recent, query);
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

  const router = useRouter();
  const login = useMutation({
    mutationFn: (vars: { employeeId: string; pin: string }) =>
      apiPost<{ ok: boolean; employee: SessionEmployee }>("/auth/pin-login", vars),
    onSuccess: (data) => {
      toast.success(t("toast.signedInAs", { name: data.employee.displayName }));
      rememberSignIn(data.employee.id);
      setQuery("");
      pick(null);
      qc.invalidateQueries({ queryKey: ["session"] });
      // Straight to the clock — that's why they signed in.
      router.push("/clock");
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const body = e.body as { error?: string; attemptsLeft?: number } | null;
        const code = body?.error;
        const left = body?.attemptsLeft;
        const msg =
          code === "rate_limited"
            ? t("toast.rateLimited")
            : code === "device_not_bound"
              ? t("toast.deviceNotBound")
              : typeof left !== "number"
                ? t("toast.wrongPin")
                : left > 0
                  ? t("pin.wrongPinLeft", { n: left })
                  : t("pin.wrongPinLocked");
        setPinError(msg); // inline under the pad, where the person is looking
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
              onSubmit={(pin) => {
                setPinError("");
                login.mutate({ employeeId: selected.id, pin });
              }}
            />
            {pinError && (
              <p role="alert" className="text-center text-sm font-medium text-destructive">
                {pinError}
              </p>
            )}
            <Button variant="ghost" onClick={() => pick(null)}>
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
            <>
            {(staff.data?.employees.length ?? 0) > 0 && (
              <div className="relative w-full">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(ev) => setQuery(ev.target.value)}
                  placeholder={t("pin.search")}
                  aria-label={t("pin.search")}
                  autoComplete="off"
                  className="h-12 pl-9 text-base"
                />
              </div>
            )}
            {query.trim() !== "" && shown.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">{t("pin.noMatch", { q: query.trim() })}</p>
            )}
            <div className="grid w-full grid-cols-2 gap-3">
              {shown.map((e) =>
                e.hasPin ? (
                  <Button
                    key={e.id}
                    variant="secondary"
                    onClick={() => pick(e)}
                    className="h-auto min-h-16 flex-col gap-2 whitespace-normal rounded-xl px-4 py-4 text-lg font-medium"
                  >
                    <InDot on={e.clockedIn} label={t("clock.clockedIn")}>
                      <Avatar employeeId={e.id} name={e.displayName} size="md" />
                    </InDot>
                    {e.displayName}
                  </Button>
                ) : (
                  <div
                    key={e.id}
                    aria-disabled="true"
                    title={t("pin.noPinSetTooltip")}
                    className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-4 py-3 text-lg font-medium text-muted-foreground opacity-60"
                  >
                    <InDot on={e.clockedIn} label={t("clock.clockedIn")}>
                      <Avatar employeeId={e.id} name={e.displayName} size="md" className="opacity-80" />
                    </InDot>
                    {e.displayName}
                    <Badge variant="outline" className="font-normal">
                      {t("pin.noPinSet")}
                    </Badge>
                  </div>
                ),
              )}
            </div>
            </>
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

/** Small green "in" dot on the avatar for people currently clocked in. */
function InDot({ on, label, children }: { on?: boolean; label: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      {on && (
        <span
          role="img"
          aria-label={label}
          title={label}
          className="absolute right-0 bottom-0 size-3.5 rounded-full bg-emerald-500 ring-2 ring-background"
        />
      )}
    </span>
  );
}
