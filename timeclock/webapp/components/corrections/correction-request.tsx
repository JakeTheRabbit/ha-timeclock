"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { HourDots, liveMinutes } from "@/components/entries/month-calendar";
import { localDay, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { entriesHref } from "@/lib/links";

export interface PendingCorrection {
  id: string;
  timeEntryId: string;
  employeeId: string;
  employeeName: string;
  reason: string;
  requested: { clockIn?: string; clockOut?: string; note?: string };
  createdAt: string;
  day: string;
  original: { clockIn: string; clockOut: string | null };
  dayEntries: EntryRow[];
}

/** Worked minutes of `e` if it ran inStr→outStr (unpaid breaks clipped to the new span). */
function workedIf(e: EntryRow | undefined, inStr: string, outStr: string | null): number | null {
  if (!outStr) return null;
  const a = +new Date(inStr);
  const b = +new Date(outStr);
  if (b <= a) return null;
  const unpaid = (e?.breaks ?? [])
    .filter((x) => !x.paid && x.endAt)
    .reduce((s, x) => s + Math.max(0, Math.min(b, +new Date(x.endAt!)) - Math.max(a, +new Date(x.startAt))), 0);
  return Math.round((b - a - unpaid) / 60_000);
}

const h = (min: number) => (min / 60).toFixed(2) + "h";

/** One correction request on the manager dashboard: old ⇒ new, hours change, the day now. */
export function CorrectionRequest({
  cr,
  busy,
  onDecide,
}: {
  cr: PendingCorrection;
  busy: boolean;
  onDecide: (action: "approve" | "reject", note?: string) => void;
}) {
  const t = useT();
  const loc = useLocale();
  const [note, setNote] = useState("");
  const entry = cr.dayEntries.find((e) => e.id === cr.timeEntryId);
  // Times on another day than the shift's get the date too.
  const at = (s: string) => (localDay(new Date(s)) === cr.day ? loc.time(s) : loc.dateTime(s));
  const newIn = cr.requested.clockIn ?? cr.original.clockIn;
  const newOut = cr.requested.clockOut ?? cr.original.clockOut;
  const oldMin = entry ? liveMinutes(entry) : null;
  const newMin = workedIf(entry, newIn, newOut);
  const delta = oldMin != null && newMin != null ? newMin - oldMin : null;

  const row = (label: string, old: string | null, next: string | undefined) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">
        {next && next !== old ? (
          <>
            <s className="text-muted-foreground">{old ? at(old) : t("corrections.running")}</s> ⇒{" "}
            <span className="font-medium">{at(next)}</span>
          </>
        ) : old ? (
          at(old)
        ) : (
          t("corrections.running")
        )}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{cr.employeeName}</span>
        <span className="text-muted-foreground">
          {loc.date(`${cr.day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        <Link href={entriesHref(cr.employeeId, cr.day)} className="ml-auto text-xs text-primary hover:underline">
          <Pencil className="inline size-3" /> {t("corrections.openDay")}
        </Link>
        <div className="w-full text-muted-foreground">— {cr.reason}</div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {row(t("corrections.in"), cr.original.clockIn, cr.requested.clockIn)}
        {row(t("corrections.out"), cr.original.clockOut, cr.requested.clockOut)}
        {(oldMin != null || newMin != null) && (
          <>
            <span className="text-muted-foreground">{t("corrections.worked")}</span>
            <span className="font-mono">
              {oldMin != null && newMin != null && delta !== 0 ? (
                <>
                  <s className="text-muted-foreground">{h(oldMin)}</s> ⇒ <span className="font-medium">{h(newMin)}</span>{" "}
                  <span className={delta! > 0 ? "text-emerald-400" : "text-amber-400"}>
                    ({delta! > 0 ? "+" : "−"}
                    {h(Math.abs(delta!))})
                  </span>
                </>
              ) : (
                h((newMin ?? oldMin)!)
              )}
            </span>
          </>
        )}
      </div>
      {cr.requested.note !== undefined && (
        <div className="text-xs text-muted-foreground">{t("corrections.requestedNote", { note: cr.requested.note })}</div>
      )}

      <HourDots day={cr.day} entries={cr.dayEntries} />

      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={t("corrections.notePlaceholder", { name: cr.employeeName })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={() => onDecide("approve", note.trim() || undefined)}>
          <Check /> Approve
        </Button>
        <Button variant="destructive" disabled={busy} onClick={() => onDecide("reject", note.trim() || undefined)}>
          <X /> Decline
        </Button>
      </div>
    </div>
  );
}
