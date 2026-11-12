"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Gift } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { groupByWeek, lastFinishedPeriod, mostOwed, nextPaymentNote } from "@/lib/pay-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

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

const RANGES = { "14": "Last 2 weeks", "28": "Last 4 weeks", "90": "Last 3 months" } as const;
type Range = keyof typeof RANGES | "period";

/** Pay screen (manager+): hours × rate, bonuses, mark paid / unpaid. */
export default function PayPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const money = (cents: number | null) => (cents == null ? "—" : loc.money(cents / 100));
  const short = (d: Date | string) => loc.date(d, { day: "numeric", month: "short" });
  const [pickedEmployee, setEmployeeId] = useState<string | null>(null);
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
      toast.success(`${r.changed.entries + r.changed.bonuses} item(s) marked ${paid ? "paid" : "unpaid"}`);
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
      toast.success("Bonus added");
      setBonus({ amount: "", reason: "", on: today() });
      refresh();
    },
    onError: (e) => toast.error(errOf(e)),
  });

  const voidBonus = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiPost(`/pay/bonuses/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success("Bonus voided");
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
            <CardTitle className="text-destructive">Access denied</CardTitle>
            <CardDescription>Manager role or above required.</CardDescription>
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
          <SelectTrigger aria-label="Select employee">
            <SelectValue placeholder="Select an employee…" />
          </SelectTrigger>
          <SelectContent>
            {people.data?.employees.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
                {p.unpaidCents > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">{money(p.unpaidCents)} owed</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={(v) => setDays(v as Range)}>
          <SelectTrigger aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lastPeriod && (
              <SelectItem value="period">
                Last pay period ({short(lastPeriod.startAt)} – {short(new Date(+new Date(lastPeriod.endAt) - 1))})
              </SelectItem>
            )}
            {Object.entries(RANGES).map(([k, label]) => (
              <SelectItem key={k} value={k}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {people.data && people.data.employees.length === 0 && (
        <p className="text-sm text-muted-foreground">Nobody has pay tracking on (Admin → Employees).</p>
      )}

      {employeeId && summary.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}

      {s && (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Rate" value={s.employee.hourlyRateCents == null ? "not set" : `${money(s.employee.hourlyRateCents)}/h`} />
              <Stat label="Owed" value={money(s.totals.unpaidCents)} strong />
              <Stat label="Unpaid hours" value={hrs(s.totals.unpaidMinutes)} />
              <Stat label="Paid" value={money(s.totals.paidCents)} />
            </CardContent>
          </Card>
          {s.employee.hourlyRateCents == null && (
            <p className="text-sm text-amber-300">Set an hourly rate in Admin → Employees to see amounts and mark time paid.</p>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Time</CardTitle>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="sm" disabled={unpaidIds.length === 0} onClick={() => setPicked(new Set(unpaidIds))}>
                  Select all unpaid
                </Button>
                {picked.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-2">
              {s.entries.length === 0 && <p className="px-2 text-sm text-muted-foreground">No entries in this range.</p>}
              {weeks.map(({ week, rows }) => {
                const weekUnpaid = rows.filter((e) => e.clockOut && !e.paidAt).map((e) => e.id);
                return (
                  <section key={week} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-2 pb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Week of {short(`${week}T12:00:00`)}</span>
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
                        Select this week
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
                            {loc.time(e.clockIn)} → {e.clockOut ? loc.time(e.clockOut) : "open"}
                          </span>
                          {(e.fraudFlags.includes("no_door_access") || e.paidAt) && (
                            <span className="flex flex-wrap gap-1">
                              {e.fraudFlags.includes("no_door_access") && (
                                <Badge className="border-transparent bg-destructive/15 text-destructive">No door swipe</Badge>
                              )}
                              {e.paidAt && <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>}
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
              <CardTitle className="text-base">Bonuses</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-2">
              {s.bonuses.length === 0 && <p className="px-2 text-sm text-muted-foreground">No bonuses yet.</p>}
              {s.bonuses.map((b) => (
                <div key={b.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    disabled={!!b.voidedAt}
                    checked={picked.has(b.id)}
                    onChange={() => toggle(b.id)}
                    aria-label={`Select bonus ${b.reason}`}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="text-sm sm:w-28">{loc.date(b.awardedOn)}</span>
                    <span className={`break-words text-sm sm:flex-1 ${b.voidedAt ? "text-muted-foreground line-through" : ""}`}>
                      {b.reason}
                      {b.voidedAt && <span className="ml-2 text-xs no-underline">(void: {b.voidReason})</span>}
                    </span>
                    {b.paidAt && (
                      <span>
                        <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-sm sm:w-20 sm:text-right">{money(b.amountCents)}</span>
                  {!b.paidAt && !b.voidedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Void bonus"
                      onClick={() => {
                        const reason = window.prompt("Why is this bonus being voided?");
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
                  <Label htmlFor="bonus-amount" className="text-xs text-muted-foreground">Amount ({loc.currency})</Label>
                  <Input
                    id="bonus-amount"
                    inputMode="decimal"
                    value={bonus.amount}
                    onChange={(e) => setBonus({ ...bonus, amount: e.target.value })}
                    placeholder="50.00"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bonus-date" className="text-xs text-muted-foreground">Date</Label>
                  <Input id="bonus-date" type="date" value={bonus.on} onChange={(e) => setBonus({ ...bonus, on: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="bonus-reason" className="text-xs text-muted-foreground">Reason</Label>
                  <Input
                    id="bonus-reason"
                    value={bonus.reason}
                    onChange={(e) => setBonus({ ...bonus, reason: e.target.value })}
                    placeholder="e.g. harvest weekend"
                  />
                </div>
                <Button disabled={!bonusAmountOk || addBonus.isPending} onClick={() => addBonus.mutate()}>
                  <Gift /> Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="sticky bottom-2 flex flex-col gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg sm:flex-row sm:items-center">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional, e.g. paid 28 Oct bank transfer)"
              className="flex-1"
            />
            <Button disabled={picked.size === 0 || mark.isPending} onClick={() => mark.mutate(true)}>
              Mark {picked.size || ""} paid
            </Button>
            <Button variant="secondary" disabled={picked.size === 0 || mark.isPending} onClick={() => mark.mutate(false)}>
              Mark unpaid
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
