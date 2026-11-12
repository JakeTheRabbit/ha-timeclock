"use client";

import * as React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Minus, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { roleAtLeast } from "@/server/auth/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_TEXT } from "@/components/ui/status-badge";

interface Person {
  id: string;
  displayName: string;
  balances: Record<string, number>;
  pending: Record<string, number>;
  accruedThrough: string | null;
}
interface Balances {
  types: string[];
  annualAccrualRate: number;
  employees: Person[];
}
interface LedgerRow {
  id: string;
  type: string;
  deltaHours: string;
  source: string;
  note: string | null;
  createdAt: string;
}

const TYPE_KEY: Record<string, MessageKey> = {
  annual: "leave.typeAnnual",
  sick: "leave.typeSick",
  bereavement: "leave.typeBereavement",
  alt_holiday: "leave.typeAltHoliday",
  unpaid: "leave.typeUnpaid",
};
const SOURCE_KEY: Record<string, MessageKey> = {
  accrual: "leaveBal.source.accrual",
  request: "leaveBal.source.request",
  adjustment: "leaveBal.source.adjustment",
};

/** Translated leave type (unknown types shown as-is). */
function useTypeLabel() {
  const t = useT();
  return (type: string) => (TYPE_KEY[type] ? t(TYPE_KEY[type]) : type);
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function LeaveBalancesPage() {
  const qc = useQueryClient();
  const t = useT();
  const typeLabel = useTypeLabel();
  const loc = useLocale();
  const { session, isLoading } = useSession();
  const canSee = !!session && roleAtLeast(session.employee.role, "manager");
  const [adjusting, setAdjusting] = useState<Person | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ["leave-balances"],
    queryFn: () => apiGet<Balances>("/leave/balances"),
    enabled: canSee,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["leave-balances"] });
    qc.invalidateQueries({ queryKey: ["leave-ledger"] });
  };

  const accrue = useMutation({
    mutationFn: () => apiPost<{ results: { accruedHours: number }[] }>("/leave/accrue"),
    onSuccess: (r) => {
      toast.success(
        r.results.length
          ? t(r.results.length === 1 ? "leaveBal.accrued.one" : "leaveBal.accrued.other", { n: r.results.length })
          : t("leaveBal.nothingToAccrue"),
      );
      refresh();
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </Container>
    );

  if (!canSee)
    return (
      <Container>
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">{t("pay.managerRequired")}</p>
          </CardContent>
        </Card>
      </Container>
    );

  const types = data.data?.types ?? [];
  const rate = data.data?.annualAccrualRate ?? 0;
  const h = (n: number) => loc.number(n, { maximumFractionDigits: 2 });

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle>{t("home.leaveBalances.label")}</CardTitle>
          <CardDescription>{t("leaveBal.hint", { pct: h(rate * 100) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => accrue.mutate()} disabled={accrue.isPending}>
            <RefreshCw className={cn(accrue.isPending && "animate-spin")} /> {t("leaveBal.runAccrual")}
          </Button>
        </CardContent>
      </Card>

      {data.isLoading && <Skeleton className="h-64 w-full rounded-xl" />}
      {data.data?.employees.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("leaveBal.noStaff")}</p>
      )}

      {data.data?.employees.map((p) => (
        <Card key={p.id} className="gap-3">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <CardTitle>{p.displayName}</CardTitle>
              <span className="text-xs text-muted-foreground">
                {p.accruedThrough ? t("leaveBal.accruedThrough", { when: loc.dateTime(p.accruedThrough) }) : t("leaveBal.notAccrued")}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === p.id ? null : p.id)}>
                <ChevronDown className={cn("transition-transform", open === p.id && "rotate-180")} /> {t("leaveBal.history")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdjusting(p)}>
                <SlidersHorizontal /> {t("leaveBal.adjust")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {types.map((ty) => (
                <div key={ty} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{typeLabel(ty)}</div>
                  <div className={cn("font-semibold tabular-nums", p.balances[ty] < 0 && "text-destructive")}>
                    {h(p.balances[ty] ?? 0)}h
                  </div>
                  {(p.pending[ty] ?? 0) > 0 && (
                    <div className={cn("text-xs", STATUS_TEXT.pending)}>{t("leaveBal.pendingH", { hours: h(p.pending[ty]) })}</div>
                  )}
                </div>
              ))}
            </div>
            {open === p.id && <Ledger employeeId={p.id} />}
          </CardContent>
        </Card>
      ))}

      {adjusting && (
        <AdjustDialog
          person={adjusting}
          types={types}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}

function Ledger({ employeeId }: { employeeId: string }) {
  const t = useT();
  const typeLabel = useTypeLabel();
  const loc = useLocale();
  const q = useQuery({
    queryKey: ["leave-ledger", employeeId],
    queryFn: () => apiGet<{ entries: LedgerRow[] }>(`/leave/ledger/${employeeId}`),
  });
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (!q.data?.entries.length) return <p className="text-sm text-muted-foreground">{t("leaveBal.noLedger")}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
      {q.data.entries.map((r) => {
        const n = Number(r.deltaHours);
        return (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{loc.date(r.createdAt)}</span>
            <span className="w-24 shrink-0">{typeLabel(r.type)}</span>
            <span className={cn("w-16 shrink-0 tabular-nums", n < 0 ? "text-destructive" : STATUS_TEXT.approved)}>
              {n > 0 ? "+" : ""}
              {loc.number(n, { maximumFractionDigits: 2 })}h
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {SOURCE_KEY[r.source] ? t(SOURCE_KEY[r.source]) : r.source}
              {r.note ? ` · ${r.note}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AdjustDialog({
  person,
  types,
  onClose,
  onDone,
}: {
  person: Person;
  types: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const typeLabel = useTypeLabel();
  const loc = useLocale();
  const [type, setType] = useState(types[0] ?? "annual");
  const [sign, setSign] = useState<1 | -1>(1);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const n = Number(hours);
  const valid = Number.isFinite(n) && n > 0 && n <= 1000 && note.trim().length >= 3;
  const after = (person.balances[type] ?? 0) + (valid ? sign * n : 0);

  const save = useMutation({
    mutationFn: () =>
      apiPost("/leave/adjust", { employeeId: person.id, type, deltaHours: sign * n, note: note.trim() }),
    onSuccess: () => {
      toast.success(t("leaveBal.recorded", { name: person.displayName, type: typeLabel(type), delta: `${sign > 0 ? "+" : "−"}${n}` }));
      onDone();
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("leaveBal.adjustTitle", { name: person.displayName })}</DialogTitle>
          <DialogDescription>{t("leaveBal.adjustHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("leaveBal.leaveType")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    {typeLabel(ty)} ({loc.number(person.balances[ty] ?? 0, { maximumFractionDigits: 2 })}h)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adj-hours">{t("leave.hoursField")}</Label>
            <div className="flex gap-2">
              <div className="flex rounded-md border border-border p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={sign > 0 ? "default" : "ghost"}
                  aria-pressed={sign > 0}
                  onClick={() => setSign(1)}
                >
                  <Plus /> {t("pay.add")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sign < 0 ? "default" : "ghost"}
                  aria-pressed={sign < 0}
                  onClick={() => setSign(-1)}
                >
                  <Minus /> {t("myHours.remove")}
                </Button>
              </div>
              <Input
                id="adj-hours"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-28"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {t("leaveBal.balanceAfter", { hours: loc.number(after, { maximumFractionDigits: 2 }) })}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adj-note">{t("pay.reason")}</Label>
            <Input
              id="adj-note"
              value={note}
              maxLength={300}
              placeholder={t("leaveBal.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
          </DialogClose>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t("leaveBal.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
