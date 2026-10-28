"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Gift } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
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

const money = (cents: number | null) =>
  cents == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");
const errOf = (e: unknown) =>
  e instanceof ApiError ? ((e.body as { error?: string })?.error ?? `HTTP ${e.status}`) : "Request failed";
const today = () => new Date().toLocaleDateString("en-CA");

const RANGES = { "14": "Last 2 weeks", "28": "Last 4 weeks", "90": "Last 3 months" } as const;

/** Pay screen (manager+): hours × rate, bonuses, mark paid / unpaid. */
export default function PayPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [days, setDays] = useState<keyof typeof RANGES>("28");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [bonus, setBonus] = useState({ amount: "", reason: "", on: today() });
  const canSee = session && ["manager", "admin"].includes(session.employee.role);

  const { from, to } = useMemo(
    () => ({ from: new Date(Date.now() - Number(days) * 86400_000), to: new Date(Date.now() + 86400_000) }),
    [days],
  );
  const people = useQuery({
    queryKey: ["pay-employees"],
    queryFn: () => apiGet<{ employees: { id: string; displayName: string }[] }>("/pay/employees"),
    enabled: !!canSee,
  });
  const summary = useQuery({
    queryKey: ["pay", employeeId, days],
    queryFn: () => apiGet<PaySummary>(`/pay/${employeeId}?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!employeeId,
  });
  const refresh = () => {
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: ["pay"] });
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
      setNote("");
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
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={(v) => setDays(v as keyof typeof RANGES)}>
          <SelectTrigger aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
            <CardHeader>
              <CardTitle className="text-base">Time</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 px-2">
              {s.entries.length === 0 && <p className="px-2 text-sm text-muted-foreground">No entries in this range.</p>}
              {s.entries.map((e) => (
                <label
                  key={e.id}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-accent has-[:disabled]:opacity-60"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={!e.clockOut}
                    checked={picked.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span className="w-28 text-sm">{loc.date(e.clockIn)}</span>
                  <span className="flex-1 font-mono text-xs text-muted-foreground">
                    {loc.time(e.clockIn)} → {e.clockOut ? loc.time(e.clockOut) : "open"}
                  </span>
                  {e.fraudFlags.includes("no_door_access") && (
                    <Badge className="border-transparent bg-destructive/15 text-destructive">No door swipe</Badge>
                  )}
                  {e.paidAt && <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>}
                  <span className="w-14 text-right font-mono text-sm">{hrs(e.workedMinutes)}</span>
                  <span className="w-20 text-right font-mono text-sm">{money(e.amountCents)}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bonuses</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 px-2">
              {s.bonuses.length === 0 && <p className="px-2 text-sm text-muted-foreground">No bonuses yet.</p>}
              {s.bonuses.map((b) => (
                <div key={b.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={!!b.voidedAt}
                    checked={picked.has(b.id)}
                    onChange={() => toggle(b.id)}
                    aria-label={`Select bonus ${b.reason}`}
                  />
                  <span className="w-28 text-sm">{loc.date(b.awardedOn)}</span>
                  <span className={`flex-1 text-sm ${b.voidedAt ? "text-muted-foreground line-through" : ""}`}>
                    {b.reason}
                    {b.voidedAt && <span className="ml-2 text-xs no-underline">(void: {b.voidReason})</span>}
                  </span>
                  {b.paidAt && <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>}
                  <span className="w-20 text-right font-mono text-sm">{money(b.amountCents)}</span>
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
                  <Label htmlFor="bonus-amount" className="text-xs text-muted-foreground">Amount ($)</Label>
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
