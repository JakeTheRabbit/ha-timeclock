"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCheck, Check, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { formatLeaveRange } from "@/lib/leave-days";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export interface PendingLeaveRow {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: string;
  note: string | null;
  /** Current ledger balance of this type (null for unpaid). */
  balance: number | null;
  balanceAfter: number | null;
  alsoOff: { employeeName: string; type: string; startDate: string; endDate: string }[];
  rostered: string[];
}

const TYPE_KEY: Record<string, MessageKey> = {
  annual: "leave.typeAnnual",
  sick: "leave.typeSick",
  bereavement: "leave.typeBereavement",
  alt_holiday: "leave.typeAltHoliday",
  unpaid: "leave.typeUnpaid",
};

/** Dashboard leave queue: decision context, decline reason, approve all. */
export function LeaveApprovals() {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const leave = useQuery({
    queryKey: ["pending-leave"],
    queryFn: () => apiGet<{ requests: PendingLeaveRow[] }>("/leave/pending"),
  });
  const requests = leave.data?.requests ?? [];
  const typeLabel = (type: string) => (TYPE_KEY[type] ? t(TYPE_KEY[type]) : type.replace("_", " "));

  const decide = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: "approve" | "reject"; note?: string }) =>
      apiPost(`/leave/${id}/${action}`, note ? { note } : {}),
    onSuccess: (_d, v) => {
      toast.success(v.action === "approve" ? t("toast.leaveApproved") : t("toast.leaveDeclined"));
      setDeclining(null);
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(apiErrorText(e, t)),
  });

  const approveAll = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await apiPost(`/leave/${id}/approve`, {});
      return ids.length;
    },
    onSuccess: (n) => toast.success(t("toast.leaveApprovedAll", { n })),
    onError: (e) => toast.error(apiErrorText(e, t)),
    onSettled: () => qc.invalidateQueries(),
  });

  const busy = decide.isPending || approveAll.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("leaveApprove.title")}</CardTitle>
        <CardAction className="flex items-center gap-2">
          {requests.length > 1 && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => approveAll.mutate(requests.map((r) => r.id))}>
              <CheckCheck /> {t("leaveApprove.approveAll", { n: requests.length })}
            </Button>
          )}
          <Badge variant="secondary">{requests.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {leave.isLoading && <Skeleton className="h-20 w-full" />}
        {leave.data && requests.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("leaveApprove.none")}</p>
        )}
        {requests.map((lr) => (
          <div key={lr.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-1 text-sm">
              <div>
                <span className="font-medium">{lr.employeeName}</span>{" "}
                <span className="text-muted-foreground">— {typeLabel(lr.type)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatLeaveRange(lr.startDate, lr.endDate, loc.bcp47)} · {loc.number(Number(lr.hours))}h
                {lr.note ? ` · ${lr.note}` : ""}
              </div>
              {lr.balance !== null && lr.balanceAfter !== null && (
                <div className={cn("text-xs", lr.balanceAfter < 0 ? "text-destructive" : "text-muted-foreground")}>
                  {t("leaveApprove.balanceAfter", {
                    type: typeLabel(lr.type),
                    before: loc.number(lr.balance),
                    after: loc.number(lr.balanceAfter),
                  })}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {lr.alsoOff.length
                  ? t("leaveApprove.alsoOff", {
                      names: lr.alsoOff
                        .map((o) => `${o.employeeName} (${formatLeaveRange(o.startDate, o.endDate, loc.bcp47)})`)
                        .join(", "),
                    })
                  : t("leaveApprove.nobodyOff")}
                {lr.rostered.length > 0 && ` · ${t("leaveApprove.rostered", { names: lr.rostered.join(", ") })}`}
              </div>
            </div>
            {declining === lr.id ? (
              <div className="flex flex-col gap-2">
                <Input
                  autoFocus
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("leaveApprove.reasonPlaceholder")}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setDeclining(null)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => decide.mutate({ id: lr.id, action: "reject", note: reason.trim() || undefined })}
                  >
                    <X /> {t("leaveApprove.confirmDecline")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button disabled={busy} onClick={() => decide.mutate({ id: lr.id, action: "approve" })}>
                  <Check /> {t("leaveApprove.approve")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setDeclining(lr.id);
                    setReason("");
                  }}
                >
                  <X /> {t("leaveApprove.decline")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
