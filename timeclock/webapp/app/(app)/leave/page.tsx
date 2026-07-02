"use client";

import Link from "next/link";
import * as React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
import { Send } from "lucide-react";

interface Mine {
  balances: Record<string, number>;
  requests: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    hours: string;
    status: string;
    note: string | null;
  }[];
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
};

const typeLabel = (type: string, t: TFn) =>
  TYPE_KEY[type] ? t(TYPE_KEY[type]) : type.replace("_", " ");

const STATUS_BADGE: Record<string, string> = {
  approved: "border-transparent bg-emerald-500/15 text-emerald-300",
  rejected: "border-transparent bg-rose-500/15 text-rose-300",
};

const errMsg = (e: unknown, t: TFn) =>
  e instanceof ApiError
    ? ((e.body as { error?: string })?.error ?? t("toast.errorStatus", { status: e.status }))
    : t("toast.requestFailed");

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function LeavePage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const [form, setForm] = useState({ type: "annual", startDate: "", endDate: "", hours: "8", note: "" });

  const mine = useQuery({
    queryKey: ["leave-mine"],
    queryFn: () => apiGet<Mine>("/leave/mine"),
    enabled: !!session,
  });

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/leave", {
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        hours: Number(form.hours),
        note: form.note || undefined,
      }),
    onSuccess: () => {
      toast.success(t("toast.leaveRequested"));
      qc.invalidateQueries({ queryKey: ["leave-mine"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && (e.body as { error?: string })?.error === "insufficient_balance"
          ? t("toast.insufficientBalance", {
              available: (e.body as { available?: number }).available?.toFixed(1) ?? "0",
            })
          : errMsg(e, t),
      ),
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

  const requests = mine.data?.requests ?? [];

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
                  {LEAVE_TYPES.map((lt) => (
                    <SelectItem key={lt} value={lt} className="capitalize">
                      {typeLabel(lt, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-hours">{t("leave.hoursField")}</Label>
              <Input
                id="leave-hours"
                inputMode="decimal"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-from">{t("leave.fromField")}</Label>
              <Input
                id="leave-from"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-to">{t("leave.toField")}</Label>
              <Input
                id="leave-to"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
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
            disabled={!form.startDate || submit.isPending}
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
        <CardContent className="flex flex-col divide-y divide-border">
          {mine.isLoading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          )}
          {!mine.isLoading && requests.length === 0 && (
            <p className="py-1 text-sm text-muted-foreground">{t("leave.noRequests")}</p>
          )}
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
              <span className="font-medium capitalize">{typeLabel(r.type, t)}</span>
              <span className="text-sm text-muted-foreground">
                {r.startDate} → {r.endDate}
              </span>
              <span className="font-mono text-sm">{r.hours}h</span>
              <Badge variant="secondary" className={cn("ml-auto capitalize", STATUS_BADGE[r.status])}>
                {STATUS_KEY[r.status] ? t(STATUS_KEY[r.status]) : r.status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </Container>
  );
}
