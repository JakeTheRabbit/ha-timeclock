"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useLocale } from "@/lib/format";
import { useSession } from "@/hooks/use-session";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import {
  calendarDays,
  formatLeaveRange,
  groupRequests,
  nextWorkday,
  pendingHoursByType,
  usualDailyHours,
  workdaysBetween,
} from "@/lib/leave-days";
import { cn } from "@/lib/utils";
import { localDay, typicalFrom, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, Undo2 } from "lucide-react";

interface LeaveRequestRow {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: string;
  status: string;
  note: string | null;
  reviewNote?: string | null;
}

interface Mine {
  balances: Record<string, number>;
  requests: LeaveRequestRow[];
}

const LEAVE_TYPES = ["annual", "sick", "bereavement", "alt_holiday", "unpaid"];

type TFn = (key: MessageKey, vars?: TVars) => string;

const TYPE_KEY: Record<string, MessageKey> = {
  annual: "leave.typeAnnual",
  sick: "leave.typeSick",
  bereavement: "leave.typeBereavement",
  alt_holiday: "leave.typeAltHoliday",
  unpaid: "leave.typeUnpaid",
};

const STATUS_KEY: Record<string, MessageKey> = {
  pending: "leave.statusPending",
  approved: "leave.statusApproved",
  rejected: "leave.statusRejected",
  cancelled: "leave.statusCancelled",
};

const typeLabel = (type: string, t: TFn) =>
  TYPE_KEY[type] ? t(TYPE_KEY[type]) : type.replace("_", " ");

const STATUS_TONE: Record<string, Status> = {
  pending: "pending",
  approved: "approved",
  rejected: "declined",
  cancelled: "cancelled",
};

const errMsg = (e: unknown, t: TFn) => apiErrorText(e, t);

const dayCount = (n: number, t: TFn) => (n === 1 ? t("leave.oneDay") : t("leave.nDays", { n }));

const EMPTY_FORM = { type: "annual", startDate: "", endDate: "", hours: null as string | null, note: "" };

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function LeavePage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const loc = useLocale();
  // startDate/endDate "" = follow the suggested default; hours null = auto.
  const [form, setForm] = useState(EMPTY_FORM);

  const mine = useQuery({
    queryKey: ["leave-mine"],
    queryFn: () => apiGet<Mine>("/leave/mine"),
    enabled: !!session,
  });

  // Last 28 days of the person's own time → usual weekdays + usual day length.
  const recent = useQuery({
    queryKey: ["leave-recent-entries"],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - 28 * 86_400_000);
      return apiGet<{ entries: EntryRow[] }>(`/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`);
    },
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const year = new Date().getFullYear();
  const holidays = useQuery({
    queryKey: ["holidays", year, year + 1],
    queryFn: async () => {
      const get = (y: number) =>
        apiGet<{ holidays: { date: string }[] }>(`/holidays?year=${y}`)
          .then((r) => r.holidays.map((h) => h.date))
          .catch(() => [] as string[]);
      return new Set([...(await get(year)), ...(await get(year + 1))]);
    },
    enabled: !!session,
    staleTime: 60 * 60_000,
  });

  const entries = recent.data?.entries;
  const weekdays = useMemo(() => typicalFrom(entries ?? []).weekdays, [entries]);
  const dailyHours = useMemo(() => usualDailyHours(entries ?? []), [entries]);
  const holidaySet = holidays.data ?? new Set<string>();

  const today = localDay();
  const startDate = form.startDate || nextWorkday(today, weekdays, holidaySet);
  const endDate = form.endDate || startDate;
  const workdays = workdaysBetween(startDate, endDate, weekdays, holidaySet);
  const autoHours = Math.round(workdays * dailyHours * 100) / 100;
  const hoursText = form.hours ?? String(autoHours);
  const hours = Number(hoursText);

  const requests = mine.data?.requests ?? [];
  const pendingByType = pendingHoursByType(requests);
  const available = (type: string) =>
    type === "unpaid" ? null : (mine.data?.balances[type] ?? 0) - (pendingByType[type] ?? 0);
  const leftAfter = available(form.type) === null ? null : available(form.type)! - (hours || 0);

  const endBeforeStart = endDate < startDate;
  const badHours = !(hours > 0);

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/leave", {
        type: form.type,
        startDate,
        endDate,
        hours,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      toast.success(t("toast.leaveRequested"));
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["leave-mine"] });
    },
    onError: (e) => {
      const body = e instanceof ApiError ? (e.body as { error?: string; available?: number; pending?: number }) : null;
      toast.error(
        body?.error === "insufficient_balance"
          ? t("toast.insufficientBalance", { available: body.available?.toFixed(1) ?? "0" })
          : body?.error === "insufficient_balance_pending"
            ? t("toast.insufficientBalancePending", {
                available: body.available?.toFixed(1) ?? "0",
                pending: body.pending?.toFixed(1) ?? "0",
              })
            : errMsg(e, t),
      );
    },
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => apiPost(`/leave/${id}/cancel`, {}),
    onSuccess: () => {
      toast.success(t("toast.leaveWithdrawn"));
      qc.invalidateQueries({ queryKey: ["leave-mine"] });
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });

  if (isLoading)
    return (
      <Container>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-64 w-full" />
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

  const groups = groupRequests(requests, today);
  const daysOf = (r: LeaveRequestRow) =>
    workdaysBetween(r.startDate, r.endDate, weekdays, holidaySet) || calendarDays(r.startDate, r.endDate);

  return (
    <Container>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {mine.isLoading && (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        )}
        {Object.entries(mine.data?.balances ?? {}).map(([type, hours]) => (
          <Card key={type}>
            <CardContent className="flex flex-col gap-1">
              <span className="text-xs uppercase text-muted-foreground">{typeLabel(type, t)}</span>
              <span className="font-mono text-xl">{hours.toFixed(1)}h</span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("leave.requestTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-type">{t("leave.typeField")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger id="leave-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((lt) => {
                    const avail = available(lt);
                    return (
                      <SelectItem key={lt} value={lt} className="capitalize">
                        {avail === null || !mine.data
                          ? typeLabel(lt, t)
                          : t("leave.typeAvailable", { type: typeLabel(lt, t), hours: loc.number(avail) })}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end gap-1 pb-1 text-sm" aria-live="polite">
              <span>
                {dayCount(workdays, t)} · <span className="font-mono">{loc.number(hours || 0)}h</span>
              </span>
              {leftAfter !== null && mine.data && (
                <span className={cn("text-muted-foreground", leftAfter < 0 && "text-destructive")}>
                  {t("leave.leftAfter", { hours: loc.number(leftAfter) })}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-from">{t("leave.fromField")}</Label>
              <Input
                id="leave-from"
                type="date"
                value={startDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    startDate: e.target.value,
                    // To follows From unless it's set and still after it.
                    endDate: form.endDate && form.endDate >= e.target.value ? form.endDate : "",
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-to">{t("leave.toField")}</Label>
              <Input
                id="leave-to"
                type="date"
                min={startDate}
                value={endDate}
                aria-invalid={endBeforeStart || undefined}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
              {endBeforeStart && <p className="text-xs text-destructive">{t("leave.endBeforeStart")}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-hours">{t("leave.hoursField")}</Label>
              <Input
                id="leave-hours"
                inputMode="decimal"
                value={hoursText}
                aria-invalid={badHours || undefined}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
              {badHours ? (
                <p className="text-xs text-destructive">{t("leave.hoursPositive")}</p>
              ) : (
                form.hours === null && (
                  <p className="text-xs text-muted-foreground">
                    {t("leave.autoHoursHint", { hours: loc.number(dailyHours) })}
                  </p>
                )
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-note">{t("leave.noteField")}</Label>
              <Input
                id="leave-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder={t("leave.notePlaceholder")}
              />
            </div>
          </div>
          <Button
            onClick={() => submit.mutate()}
            disabled={endBeforeStart || badHours || submit.isPending}
            className="self-start"
          >
            <Send /> {submit.isPending ? t("leave.requesting") : t("leave.requestButton")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("leave.myRequestsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mine.isLoading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          )}
          {!mine.isLoading && requests.length === 0 && (
            <p className="py-1 text-sm text-muted-foreground">{t("leave.noRequests")}</p>
          )}
          {(
            [
              ["leave.groupPending", groups.pending],
              ["leave.groupUpcoming", groups.upcoming],
              ["leave.groupPast", groups.past],
            ] as const
          ).map(
            ([heading, rows]) =>
              rows.length > 0 && (
                <section key={heading} className="flex flex-col">
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">{t(heading)}</h3>
                  <div className="flex flex-col divide-y divide-border">
                    {rows.map((r) => (
                      <div key={r.id} className="flex flex-col gap-1 py-3 last:pb-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium capitalize">{typeLabel(r.type, t)}</span>
                          <span className="text-sm text-muted-foreground">
                            {formatLeaveRange(r.startDate, r.endDate, loc.bcp47)} · {dayCount(daysOf(r), t)}
                          </span>
                          <span className="font-mono text-sm">{loc.number(Number(r.hours))}h</span>
                          <span className="ml-auto flex items-center gap-2">
                            {r.status === "pending" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={withdraw.isPending}
                                onClick={() => withdraw.mutate(r.id)}
                              >
                                <Undo2 /> {t("leave.withdraw")}
                              </Button>
                            )}
                            <StatusBadge status={STATUS_TONE[r.status] ?? "cancelled"} className="capitalize">
                              {STATUS_KEY[r.status] ? t(STATUS_KEY[r.status]) : r.status}
                            </StatusBadge>
                          </span>
                        </div>
                        {r.note && (
                          <p className="text-xs text-muted-foreground">{t("leave.yourNote", { note: r.note })}</p>
                        )}
                        {r.reviewNote && (
                          <p className="text-sm">{t("leave.reviewerNote", { note: r.reviewNote })}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ),
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
