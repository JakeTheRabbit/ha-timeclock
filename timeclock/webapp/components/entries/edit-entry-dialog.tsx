"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { api, apiPatch, apiPost, ApiError } from "@/lib/api-client";
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
  day: string; // facility-local YYYY-MM-DD
  dayApproved: boolean;
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

export const errMsg = (e: unknown, t: TFn) =>
  e instanceof ApiError
    ? ((e.body as { error?: string })?.error ?? t("toast.errorStatus", { status: e.status }))
    : t("toast.requestFailed");

// <input type="datetime-local"> speaks browser-local wall time without zone.
const toLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const plusMin = (local: string, min: number) =>
  local ? toLocal(new Date(new Date(local).getTime() + min * 60_000).toISOString()) : local;
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/** Browser-local YYYY-MM-DD (not UTC — NZ mornings are "yesterday" in UTC). */
export const localDay = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const apiDelete = <T,>(path: string, data: unknown) =>
  api<T>(path, { method: "DELETE", body: JSON.stringify(data) });

interface BreakDraft {
  key: string;
  id: string | null; // null = new break
  start: string;
  end: string;
  paid: boolean;
  orig: string; // serialized original, to send only what changed
  removed: boolean;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
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
 * Change an entry's start/finish and breaks (add, change, remove), or add a
 * whole new start/finish (`entry` null). `self` mode: staff edit any day
 * until a manager approves it — after that only a correction request.
 * `manager` mode edits directly at any time. Every save needs a reason and
 * is audited; staff changes go on the manager's review list.
 */
export function EditEntryDialog({
  entry,
  mode,
  defaultDay,
  employeeId,
  onClose,
  onDone,
}: {
  entry: EntryRow | null;
  mode: "self" | "manager";
  /** New entry: prefill this YYYY-MM-DD. */
  defaultDay?: string;
  /** Manager adding for someone else. */
  employeeId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const loc = useLocale();
  const isNew = entry == null;
  const day = entry?.day ?? defaultDay ?? localDay();
  const locked = !isNew && mode === "self" && !entry.selfEditable;

  const [cin, setCin] = useState(isNew ? `${day}T08:00` : toLocal(entry.clockIn));
  const [cout, setCout] = useState(isNew ? `${day}T16:00` : toLocal(entry.clockOut));
  const [stillWorking, setStillWorking] = useState(!isNew && entry.clockOut == null);
  const [reason, setReason] = useState("");
  const [brks, setBrks] = useState<BreakDraft[]>(() =>
    (entry?.breaks ?? []).map((b) => {
      const d = { start: toLocal(b.startAt), end: toLocal(b.endAt), paid: b.paid };
      return { key: b.id, id: b.id, ...d, orig: JSON.stringify(d), removed: false };
    }),
  );
  const setBrk = (key: string, patch: Partial<BreakDraft>) =>
    setBrks((all) => all.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const removeBrk = (key: string) =>
    setBrks((all) => all.flatMap((b) => (b.key !== key ? [b] : b.id ? [{ ...b, removed: true }] : [])));

  const submit = useMutation({
    mutationFn: async () => {
      const outIso = stillWorking ? null : (toIso(cout) ?? null);
      if (locked) {
        await apiPost("/corrections", {
          timeEntryId: entry!.id,
          requested: { clockIn: toIso(cin), clockOut: outIso ?? undefined },
          reason,
        });
        return t("toast.correctionRequested");
      }

      let entryId = entry?.id;
      if (isNew) {
        const res = await apiPost<{ entryId: string }>("/entries", {
          clockIn: toIso(cin),
          clockOut: outIso,
          reason,
          ...(employeeId && { employeeId }),
        });
        entryId = res.entryId;
      } else {
        // 1. Removed breaks first (frees the shift for shorter times).
        for (const b of brks.filter((x) => x.removed && x.id))
          await apiDelete(`/entries/${entryId}/breaks/${b.id}`, { reason });
        // 2. Times.
        const clockIn = cin !== toLocal(entry.clockIn) ? toIso(cin) : undefined;
        const outChanged = stillWorking ? entry.clockOut != null : cout !== toLocal(entry.clockOut);
        if (clockIn || outChanged) {
          await apiPatch(`/entries/${entryId}`, {
            ...(clockIn && { clockIn }),
            ...(outChanged && { clockOut: outIso }),
            reason,
          });
        }
      }
      // 3. Changed and new breaks.
      for (const b of brks.filter((x) => !x.removed)) {
        const now = JSON.stringify({ start: b.start, end: b.end, paid: b.paid });
        const body = { startAt: toIso(b.start), endAt: b.end ? toIso(b.end) : null, paid: b.paid, reason };
        if (b.id == null) await apiPost(`/entries/${entryId}/breaks`, body);
        else if (now !== b.orig) await apiPatch(`/entries/${entryId}/breaks/${b.id}`, body);
      }
      return isNew ? t("toast.timeAdded") : t("toast.timesUpdated");
    },
    onSuccess: (m) => {
      toast.success(m);
      onDone();
    },
    onError: (e) => {
      toast.error(errMsg(e, t));
      // Part of a multi-step save may have landed; refresh behind the dialog.
      if (!isNew) onDone();
    },
  });

  const visible = brks.filter((b) => !b.removed);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? t("myHours.newTitle") : t("myHours.dialogTitle")}</DialogTitle>
          <DialogDescription>{loc.date(`${day}T12:00:00`)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-in">{t("myHours.clockIn")}</Label>
              <Input id="edit-clock-in" type="datetime-local" value={cin} onChange={(e) => setCin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-out">{t("myHours.clockOut")}</Label>
              {stillWorking ? (
                <p className="flex min-h-9 items-center text-sm text-muted-foreground">{t("myHours.stillClockedIn")}</p>
              ) : (
                <Input id="edit-clock-out" type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} />
              )}
            </div>
          </div>
          {!locked && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={stillWorking}
                onCheckedChange={(v) => {
                  setStillWorking(v);
                  if (!v && !cout) setCout(cin);
                }}
              />
              {t("myHours.stillWorking")}
            </label>
          )}

          {!locked && (
            <div className="flex flex-col gap-2">
              <Label>{t("myHours.breaksTitle")}</Label>
              {visible.map((b) => (
                <div
                  key={b.key}
                  className="grid grid-cols-[1fr_1fr] items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <Input
                    aria-label={t("myHours.breakStartLabel")}
                    type="datetime-local"
                    value={b.start}
                    onChange={(e) => setBrk(b.key, { start: e.target.value })}
                  />
                  <Input
                    aria-label={t("myHours.breakEndLabel")}
                    type="datetime-local"
                    value={b.end}
                    onChange={(e) => setBrk(b.key, { end: e.target.value })}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Switch checked={b.paid} onCheckedChange={(v) => setBrk(b.key, { paid: v })} />
                    {t("myHours.breakPaidToggle")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-end text-destructive"
                    aria-label={t("myHours.removeBreak")}
                    onClick={() => removeBrk(b.key)}
                  >
                    <Trash2 /> <span className="sm:sr-only">{t("myHours.removeBreak")}</span>
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() =>
                  setBrks((all) => [
                    ...all,
                    {
                      key: `new-${Date.now()}`,
                      id: null,
                      start: plusMin(cin, 120),
                      end: plusMin(cin, 135),
                      paid: true,
                      orig: "",
                      removed: false,
                    },
                  ])
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
              <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t("myHours.lockedApproved")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("myHours.editHint")}</p>
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

/** Confirm + reason, then remove a whole start/finish (and its breaks). */
export function RemoveEntryDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: EntryRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const loc = useLocale();
  const [reason, setReason] = useState("");
  const del = useMutation({
    mutationFn: () => apiDelete(`/entries/${entry.id}`, { reason }),
    onSuccess: () => {
      toast.success(t("toast.timeRemoved"));
      onDone();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("myHours.removeTitle")}</DialogTitle>
          <DialogDescription>
            {loc.date(entry.clockIn)} · {loc.time(entry.clockIn)} → {entry.clockOut ? loc.time(entry.clockOut) : t("myHours.breakOpen")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("myHours.removeHint")}</p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="remove-reason">{t("myHours.reasonLabel")}</Label>
          <Textarea id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => del.mutate()} disabled={reason.trim().length < 3 || del.isPending}>
            <Trash2 /> {t("myHours.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
