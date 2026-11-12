"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, KeyRound, Languages } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { asLang, setLangOverride, useLangOverride, useT, type Lang } from "@/lib/i18n";
import { pinChangeProblem, validNotifyService } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { ThemeControls } from "@/components/theme/theme-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

// Language names in their own language — never translated.
const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  da: "Dansk",
  de: "Deutsch",
  fr: "Français",
  sv: "Svenska",
};

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function ProfilePage() {
  const t = useT();
  const { session, isLoading } = useSession();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<{ hasPin: boolean; notifyService: string | null }>("/auth/me"),
    enabled: !!session,
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </Container>
    );

  if (!session)
    return (
      <Container>
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t("common.notSignedIn")}</p>
            <Button asChild variant="secondary">
              <Link href="/pin">{t("common.pinSignIn")}</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );

  return (
    <Container>
      {me.data ? <PinCard hasPin={me.data.hasPin} /> : <Skeleton className="h-48 w-full rounded-xl" />}
      <LanguageCard />
      {me.data && <NotifyCard initial={me.data.notifyService ?? ""} />}
      <Card>
        <CardHeader>
          <CardTitle>{t("theme.title")}</CardTitle>
          <CardDescription>{t("theme.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeControls />
        </CardContent>
      </Card>
    </Container>
  );
}

function PinCard({ hasPin }: { hasPin: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const problem = pinChangeProblem(current, next, repeat, hasPin);
  const ready = (!hasPin || current.length >= 4) && problem === null;

  const change = useMutation({
    mutationFn: () => apiPost("/auth/pin/change", { currentPin: hasPin ? current : undefined, newPin: next }),
    onSuccess: () => {
      toast.success(t("me.pin.changed"));
      setCurrent("");
      setNext("");
      setRepeat("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(apiErrorText(e, t)),
  });

  // Only nag once they've typed enough to mean it.
  const hint =
    next.length >= 4 && problem === "format"
      ? t("me.pin.format")
      : repeat.length >= next.length && repeat.length > 0 && problem === "mismatch"
        ? t("me.pin.mismatch")
        : problem === "same"
          ? t("me.pin.same")
          : null;

  const pinInput = (id: string, value: string, set: (v: string) => void, label: string) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete={id === "pin-current" ? "current-password" : "new-password"}
        maxLength={12}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden="true" /> {t("me.pin.title")}
        </CardTitle>
        <CardDescription>
          {t("me.pin.hint")} {t("me.pin.format")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) change.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {hasPin && pinInput("pin-current", current, setCurrent, t("me.pin.current"))}
            {pinInput("pin-new", next, setNext, t("me.pin.new"))}
            {pinInput("pin-repeat", repeat, setRepeat, t("me.pin.confirm"))}
          </div>
          {hint && <p className="text-sm text-amber-500">{hint}</p>}
          <div>
            <Button type="submit" disabled={!ready || change.isPending}>
              {hasPin ? t("me.pin.change") : t("me.pin.set")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LanguageCard() {
  const t = useT();
  const override = useLangOverride();
  const site = asLang(useLocale().language);
  const options: { value: Lang | null; label: string }[] = [
    { value: null, label: `${t("me.lang.default")} (${LANG_NAMES[site]})` },
    ...(Object.keys(LANG_NAMES) as Lang[]).map((l) => ({ value: l, label: LANG_NAMES[l] })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="size-5" aria-hidden="true" /> {t("me.lang.title")}
        </CardTitle>
        <CardDescription>{t("me.lang.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label={t("me.lang.title")} className="flex flex-wrap gap-2">
          {options.map((o) => {
            const active = override === o.value;
            return (
              <button
                key={o.value ?? "site"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setLangOverride(o.value)}
                className={cn(
                  "min-h-10 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function NotifyCard({ initial }: { initial: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const trimmed = value.trim();
  const valid = validNotifyService(trimmed);

  const save = useMutation({
    mutationFn: () => apiPatch("/auth/me", { notifyService: trimmed }),
    onSuccess: () => {
      toast.success(t("me.notify.saved"));
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(apiErrorText(e, t)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-5" aria-hidden="true" /> {t("me.notify.title")}
        </CardTitle>
        <CardDescription>{t("me.notify.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && trimmed !== initial) save.mutate();
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Input
              aria-label={t("me.notify.title")}
              placeholder="notify.mobile_app_…"
              value={value}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
            />
            {!valid && <span className="text-xs text-amber-500">{t("me.notify.invalid")}</span>}
          </div>
          <Button type="submit" disabled={!valid || trimmed === initial || save.isPending}>
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
