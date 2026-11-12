"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Gift } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { groupByWeek, lastFinishedPeriod, mostOwed, nextPaymentNote } from "@/lib/pay-helpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, STATUS_TEXT } from "@/components/ui/status-badge";
import { useT, type MessageKey } from "@/lib/i18n";

interface PayEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  workedMinutes: number | null;
  fraudFlags: string[];
  paidAt: string | null;
  amountCents: number | null;
}
interface PayBonus {
  id: string;
  amountCents: number;
  reason: string;
  awardedOn: string;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}
interface PaySummary {
  employee: { id: string; displayName: string; hourlyRateCents: number | null };
  entries: PayEntry[];
  bonuses: PayBonus[];
  totals: { unpaidCents: number; paidCents: number; unpaidMinutes: number };
}

interface PayPeriod {
  id: string;
  startAt: string;
  endAt: string;
}

const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");
const errOf = (e: unknown) => apiErrorText(e);
const today = () => new Date().toLocaleDateString("en-CA");

const RANGES = { "14": "pay.range14", "28": "pay.range28", "90": "pay.range90" } as const satisfies Record<string, MessageKey>;
type Range = keyof typeof RANGES | "period";

/** Pay screen (manager+): hours × rate, bonuses, mark paid / unpaid. */
export default function PayPage() {
  const qc = useQueryClient();
  const t = useT();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const money = (cents: number | null) => (cents == null ? "—" : loc.money(cents / 100));
  const short = (d: Date | string) => loc.date(d, { day: "numeric", month: "short" });
  const [pickedEmployee, setEmployeeId] = useState<string | null>(null);
  // Deep link from Admin → Employees: ?employeeId=…
  useEffect(() => {
    const emp = new URLSearchParams(window.location.search).get("employeeId");
    if (emp) setEmployeeId(emp);
  }, []);
  const [pickedRange, setDays] = useState<Range | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typedNote, setNote] = useState<string | null>(null);
  const [bonus, setBonus] = useState({ amount: "", reason: "", on: today() });
  const canSee = session && ["manager", "admin"].includes(session.employee.role);

  const people = useQuery({
    queryKey: ["pay-employees"],
    queryFn: () =>
      apiGet<{ employees: { id: string; displayName: string; unpaidCents: number }[]; lastNote: string | null }>(
        "/pay/employees",
      ),
    enabled: !!canSee,
  });
  const periods = useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => apiGet<{ periods: PayPeriod[] }>("/manager/pay-periods"),
    enabled: !!canSee,
  });
  // Defaults: the person owed the most; the latest finished pay period (else 4 weeks).
  const employeeId = pickedEmployee ?? mostOwed(people.data?.employees ?? [])?.id ?? null;
  const lastPeriod = lastFinishedPeriod(periods.data?.periods ?? []);
  const days: Range = pickedRange ?? (lastPeriod ? "period" : "28");
  const note = typedNote ?? nextPaymentNote(people.data?.lastNote, new Date(), short, loc.bcp47);

  const { from, to } = useMemo(
    () =>
      days === "period" && lastPeriod
        ? { from: new Date(lastPeriod.startAt), to: new Date(lastPeriod.endAt) }
        : { from: new Date(Date.now() - Number(days === "period" ? 28 : days) * 86400_000), to: new Date(Date.now() + 86400_000) },
    [days, lastPeriod],
  );
  const summary = useQuery({
    queryKey: ["pay", employeeId, days, lastPeriod?.id],
    queryFn: () => apiGet<PaySummary>(`/pay/${employeeId}?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!employeeId,
  });
  const refresh = () => {
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: ["pay"] });
    qc.invalidateQueries({ queryKey: ["pay-employees"] });
  };

  const mark = useMutation({
    mutationFn: (paid: boolean) => {
      const ids = [...picked];
      const bonusIds = new Set(summary.data?.bonuses.map((b) => b.id));
      return apiPost<{ changed: { entries: number; bonuses: number } }>("/pay/mark", {
        entryIds: ids.filter((id) => !bonusIds.has(id)),
        bonusIds: ids.filter((id) => bonusIds.has(id)),
        paid,
        note: note.trim() || undefined,
      });
    },
    onSuccess: (r, paid) => {
      const n = r.changed.entries + r.changed.bonuses;
      toast.success(
        t(paid ? (n === 1 ? "pay.markedPaid.one" : "pay.markedPaid.other") : n === 1 ? "pay.markedUnpaid.one" : "pay.markedUnpaid.other", { n }),
      );
      setNote(null);
      refresh();
    },
    onError: (e) => toast.error(errOf(e)),
  });

  const addBonus = useMutation({
    mutationFn: () =>
      apiPost("/pay/bonuses", {
        employeeId,
        amountCents: Math.round(Number(bonus.amount.replace(/[$,\s]/g, "")) * 100),
        reason: bonus.reason.trim(),
        awardedOn: bonus.on,
      }),
    onSuccess: () => {
      toast.success(t("pay.bonusAdded"));
      setBonus({ amount: "", reason: "", on: today() });
      refresh();
    },
    onError: (e) => toast.error(errOf(e)),
  });

  const voidBonus = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiPost(`/pay/bonuses/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success(t("pay.bonusVoided"));
      refresh();
    },
    onError: (e) => toast.error(errOf(e)),
  });

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{t("pay.accessDenied")}</CardTitle>
            <CardDescription>{t("pay.managerRequired")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const s = summary.data;
  const unpaidIds = s
    ? [
        ...s.entries.filter((e) => e.clockOut && !e.paidAt).map((e) => e.id),
        ...s.bonuses.filter((b) => !b.paidAt && !b.voidedAt).map((b) => b.id),
      ]
    : [];
  const weeks = s ? groupByWeek(s.entries, (e) => e.clockIn, loc.weekStart) : [];
  const bonusAmountOk = Number(bonus.amount.replace(/[$,\s]/g, "")) > 0 && bonus.reason.trim().length >= 3;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select
          value={employeeId ?? undefined}
          onValueChange={(v) => {
            setEmployeeId(v);
            setPicked(new Set());
          }}
        >
          <SelectTrigger aria-label={t("pay.selectEmployee")}>
            <SelectValue placeholder={t("pay.selectEmployeePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {people.data?.employees.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
                {p.unpaidCents > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">{t("pay.owedAmount", { amount: money(p.unpaidCents) })}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={(v) => setDays(v as Range)}>
          <SelectTrigger aria-label={t("pay.dateRange")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lastPeriod && (
              <SelectItem value="period">
                {t("pay.lastPeriod", { from: short(lastPeriod.startAt), to: short(new Date(+new Date(lastPeriod.endAt) - 1)) })}
              </SelectItem>
            )}
            {Object.entries(RANGES).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {people.data && people.data.employees.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("pay.noneTracked")}</p>
      )}

      {employeeId && summary.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}

      {s && (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={t("pay.rate")}
                value={s.employee.hourlyRateCents == null ? t("pay.notSet") : t("pay.perHour", { amount: money(s.employee.hourlyRateCents) })}
              />
              <Stat label={t("pay.owed")} value={money(s.totals.unpaidCents)} strong />
              <Stat label={t("pay.unpaidHours")} value={hrs(s.totals.unpaidMinutes)} />
              <Stat label={t("status.paid")} value={money(s.totals.paidCents)} />
            </CardContent>
          </Card>
          {s.employee.hourlyRateCents == null && (
            <p className={`text-sm ${STATUS_TEXT.warning}`}>{t("pay.setRateHint")}</p>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{t("pay.time")}</CardTitle>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="sm" disabled={unpaidIds.length === 0} onClick={() => setPicked(new Set(unpaidIds))}>
                  {t("pay.selectAllUnpaid")}
                </Button>
                {picked.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                    {t("pay.clear")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-2">
              {s.entries.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t("pay.noEntries")}</p>}
              {weeks.map(({ week, rows }) => {
                const weekUnpaid = rows.filter((e) => e.clockOut && !e.paidAt).map((e) => e.id);
                return (
                  <section key={week} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-2 pb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t("myHours.weekOf", { date: short(`${week}T12:00:00`) })}</span>
                      <span className="font-mono">
                        {hrs(rows.reduce((a, e) => a + (e.workedMinutes ?? 0), 0))} ·{" "}
                        {money(rows.reduce((a, e) => a + (e.amountCents ?? 0), 0))}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 px-2 text-xs"
                        disabled={weekUnpaid.length === 0}
                        onClick={() => setPicked((p) => new Set([...p, ...weekUnpaid]))}
                      >
                        {t("pay.selectWeek")}
                      </Button>
                    </div>
                    {rows.map((e) => (
                      <label
                        key={e.id}
                        className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent has-[:disabled]:opacity-60"
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          disabled={!e.clockOut}
                          checked={picked.has(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                          <span className="text-sm sm:w-28">{loc.date(e.clockIn)}</span>
                          <span className="font-mono text-xs text-muted-foreground sm:flex-1">
                            {loc.time(e.clockIn)} → {e.clockOut ? loc.time(e.clockOut) : t("common.open")}
                          </span>
                          {(e.fraudFlags.includes("no_door_access") || e.paidAt) && (
                            <span className="flex flex-wrap gap-1">
                              {e.fraudFlags.includes("no_door_access") && (
                                <StatusBadge status="flag">{t("pay.noDoorSwipe")}</StatusBadge>
                              )}
                              {e.paidAt && <StatusBadge status="paid" />}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 flex-col items-end sm:flex-row sm:gap-3">
                          <span className="font-mono text-sm sm:w-14 sm:text-right">{hrs(e.workedMinutes)}</span>
                          <span className="font-mono text-sm sm:w-20 sm:text-right">{money(e.amountCents)}</span>
                        </span>
                      </label>
                    ))}
                  </section>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("pay.bonuses")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-2">
              {s.bonuses.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t("pay.noBonuses")}</p>}
              {s.bonuses.map((b) => (
                <div key={b.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    disabled={!!b.voidedAt}
                    checked={picked.has(b.id)}
                    onChange={() => toggle(b.id)}
                    aria-label={t("pay.selectBonus", { reason: b.reason })}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="text-sm sm:w-28">{loc.date(b.awardedOn)}</span>
                    <span className={`break-words text-sm sm:flex-1 ${b.voidedAt ? "text-muted-foreground line-through" : ""}`}>
                      {b.reason}
                      {b.voidedAt && <span className="ml-2 text-xs no-underline">{t("pay.voided", { reason: b.voidReason ?? "" })}</span>}
                    </span>
                    {b.paidAt && (
                      <span>
                        <StatusBadge status="paid" />
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-sm sm:w-20 sm:text-right">{money(b.amountCents)}</span>
                  {!b.paidAt && !b.voidedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("pay.voidBonus")}
                      onClick={() => {
                        const reason = window.prompt(t("pay.voidPrompt"));
                        if (reason && reason.trim().length >= 3) voidBonus.mutate({ id: b.id, reason: reason.trim() });
                      }}
                    >
                      <Ban />
                    </Button>
                  )}
                </div>
              ))}

              <div className="grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-[7rem_9rem_1fr_auto] sm:items-end">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bonus-amount" className="text-xs text-muted-foreground">{t("pay.amount", { currency: loc.currency })}</Label>
                  <Input
                    id="bonus-amount"
                    inputMode="decimal"
                    value={bonus.amount}
                    onChange={(e) => setBonus({ ...bonus, amount: e.target.value })}
                    placeholder="50.00"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bonus-date" className="text-xs text-muted-foreground">{t("myHours.dateLabel")}</Label>
                  <Input id="bonus-date" type="date" value={bonus.on} onChange={(e) => setBonus({ ...bonus, on: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bonus-reason" className="text-xs text-muted-foreground">{t("pay.reason")}</Label>
                  <Input
                    id="bonus-reason"
                    value={bonus.reason}
                    onChange={(e) => setBonus({ ...bonus, reason: e.target.value })}
                    placeholder={t("pay.reasonPlaceholder")}
                  />
                </div>
                <Button disabled={!bonusAmountOk || addBonus.isPending} onClick={() => addBonus.mutate()}>
                  <Gift /> {t("pay.add")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-2 flex flex-col gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg sm:flex-row sm:items-center">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("pay.notePlaceholder")}
              className="flex-1"
            />
            <Button disabled={picked.size === 0 || mark.isPending} onClick={() => mark.mutate(true)}>
              {picked.size ? t("pay.markNPaid", { n: picked.size }) : t("pay.markPaid")}
            </Button>
            <Button variant="secondary" disabled={picked.size === 0 || mark.isPending} onClick={() => mark.mutate(false)}>
              {t("pay.markUnpaid")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono ${strong ? "text-lg font-semibold" : "text-sm"}`}>{value}</span>
    </div>
  );
}
