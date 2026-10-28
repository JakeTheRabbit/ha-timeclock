"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface EntryRow {
  id: string;
  clockIn: string;
  clockOut: string | null;
  edited: boolean;
  note: string | null;
  job: { id: string; name: string } | null;
  workedMinutes: number | null;
  selfEditable: boolean;
  fraudFlags: string[];
  paidAt: string | null;
  breaks: { id: string; startAt: string; endAt: string | null; paid: boolean; autoDeducted: boolean }[];
}

type TFn = (key: MessageKey, vars?: TVars) => string;

const errMsg = (e: unknown, t: TFn) =>
  e instanceof ApiError
    ? ((e.body as { error?: string })?.error ?? t("toast.errorStatus", { status: e.status }))
    : t("toast.requestFailed");

// <input type="datetime-local"> speaks browser-local wall time without zone.
const toLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

interface BreakDraft {
  id: string | null; // null = new break
  start: string;
  end: string;
  paid: boolean;
  orig: string; // serialized original, to send only what changed
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Fix an entry's start/end times and breaks. `self` mode follows the staff
 * rules (locked past the day after -> correction request only); `manager`
 * mode edits directly at any time. Every save needs a reason and is audited.
 */
export function EditEntryDialog({
  entry,
  mode,
  onClose,
  onDone,
}: {
  entry: EntryRow;
  mode: "self" | "manager";
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const loc = useLocale();
  const open = entry.clockOut == null;
  // Past the day-after window a direct staff edit is refused (423) — only a
  // manager-approved correction can change a locked entry.
  const locked = mode === "self" && !entry.selfEditable;
  const [cin, setCin] = useState(toLocal(entry.clockIn));
  const [cout, setCout] = useState(toLocal(entry.clockOut));
  const [reason, setReason] = useState("");
  const [asCorrection, setAsCorrection] = useState(locked);
  const [brks, setBrks] = useState<BreakDraft[]>(() =>
    entry.breaks.map((b) => {
      const d = { start: toLocal(b.startAt), end: toLocal(b.endAt), paid: b.paid };
      return { id: b.id, ...d, orig: JSON.stringify(d) };
    }),
  );
  const setBrk = (i: number, patch: Partial<BreakDraft>) =>
    setBrks((all) => all.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const submit = useMutation({
    mutationFn: async () => {
      const clockIn = cin !== toLocal(entry.clockIn) ? toIso(cin) : undefined;
      const clockOut = !open && cout !== toLocal(entry.clockOut) ? toIso(cout) : undefined;
      if (asCorrection) {
        await apiPost("/corrections", {
          timeEntryId: entry.id,
          requested: { clockIn: toIso(cin), clockOut: open ? undefined : toIso(cout) },
          reason,
        });
        return t("toast.correctionRequested");
      }
      if (clockIn || clockOut) await apiPatch(`/entries/${entry.id}`, { clockIn, clockOut, reason });
      for (const b of brks) {
        const now = JSON.stringify({ start: b.start, end: b.end, paid: b.paid });
        const body = { startAt: toIso(b.start), endAt: b.end ? toIso(b.end) : null, paid: b.paid, reason };
        if (b.id == null) await apiPost(`/entries/${entry.id}/breaks`, body);
        else if (now !== b.orig) await apiPatch(`/entries/${entry.id}/breaks/${b.id}`, body);
      }
      return t("toast.timesUpdated");
    },
    onSuccess: (m) => {
      toast.success(m);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("myHours.dialogTitle")}</DialogTitle>
          <DialogDescription>{loc.date(entry.clockIn)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-in">{t("myHours.clockIn")}</Label>
              <Input id="edit-clock-in" type="datetime-local" value={cin} onChange={(e) => setCin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-out">{t("myHours.clockOut")}</Label>
              {open ? (
                <p className="flex min-h-9 items-center text-sm text-muted-foreground">{t("myHours.stillClockedIn")}</p>
              ) : (
                <Input id="edit-clock-out" type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} />
              )}
            </div>
          </div>

          {!asCorrection && (
            <div className="flex flex-col gap-2">
              <Label>{t("myHours.breaksTitle")}</Label>
              {brks.map((b, i) => (
                <div key={b.id ?? `new-${i}`} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-lg border border-border p-2">
                  <Input
                    aria-label={t("myHours.breakStartLabel")}
                    type="datetime-local"
                    value={b.start}
                    onChange={(e) => setBrk(i, { start: e.target.value })}
                  />
                  <Input
                    aria-label={t("myHours.breakEndLabel")}
                    type="datetime-local"
                    value={b.end}
                    onChange={(e) => setBrk(i, { end: e.target.value })}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Switch checked={b.paid} onCheckedChange={(v) => setBrk(i, { paid: v })} />
                    {t("myHours.breakPaidToggle")}
                  </label>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() =>
                  setBrks((all) => [...all, { id: null, start: cin, end: cin, paid: false, orig: "" }])
                }
              >
                <Plus /> {t("myHours.addBreak")}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-reason">{t("myHours.reasonLabel")}</Label>
            <Textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("myHours.reasonPlaceholder")}
            />
          </div>
          {mode === "self" &&
            (locked ? (
              <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t("myHours.locked")}</p>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <Label htmlFor="edit-as-correction" className="flex flex-col items-start gap-1">
                  {t("myHours.asCorrection")}
                  <span className="text-xs font-normal text-muted-foreground">{t("myHours.asCorrectionHint")}</span>
                </Label>
                <Switch id="edit-as-correction" checked={asCorrection} onCheckedChange={setAsCorrection} />
              </div>
            ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => submit.mutate()} disabled={reason.trim().length < 3 || submit.isPending}>
            {submit.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
