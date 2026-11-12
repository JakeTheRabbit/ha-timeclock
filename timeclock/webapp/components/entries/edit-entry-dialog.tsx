"use client";

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Undo2 } from "lucide-react";
import { api, apiPatch, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
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

export const errMsg = (e: unknown, t: TFn) => apiErrorText(e, t);

// <input type="datetime-local"> speaks browser-local wall time without zone.
const toLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const plusMin = (local: string, min: number) =>
  local ? toLocal(new Date(new Date(local).getTime() + min * 60_000).toISOString()) : local;
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const ms = (local: string) => (local ? new Date(local).getTime() : NaN);

/** Browser-local YYYY-MM-DD (not UTC — NZ mornings are "yesterday" in UTC). */
export const localDay = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const minOfDay = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

export interface Typical {
  start: string; // HH:MM
  end: string; // HH:MM
  /** 0=Sun..6=Sat days this person usually works. */
  weekdays: number[];
}

/** The person's usual first start / last finish, from their recent days. */
export function typicalFrom(entries: EntryRow[]): Typical {
  const byDay = new Map<string, EntryRow[]>();
  for (const e of entries) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const starts: number[] = [];
  const ends: number[] = [];
  const wd = new Map<number, number>();
  for (const [day, es] of byDay) {
    starts.push(Math.min(...es.map((e) => minOfDay(e.clockIn))));
    const outs = es.filter((e) => e.clockOut).map((e) => minOfDay(e.clockOut!));
    if (outs.length) ends.push(Math.max(...outs));
    const w = new Date(`${day}T12:00:00`).getDay();
    wd.set(w, (wd.get(w) ?? 0) + 1);
  }
  const s = median(starts);
  const e = median(ends);
  return {
    start: Number.isFinite(s) ? hhmm(s) : "08:00",
    end: Number.isFinite(e) && e > s ? hhmm(e) : "16:30",
    weekdays: wd.size ? [...wd.keys()] : [1, 2, 3, 4, 5],
  };
}

/** Most recent usual workday (today back 14 days) with nothing recorded. */
export function suggestMissingDay(entries: EntryRow[], typical: Typical): string {
  const have = new Set(entries.map((e) => e.day));
  const d = new Date();
  // Today only counts once their usual start has passed.
  const [sh, sm] = typical.start.split(":").map(Number);
  if (d.getHours() * 60 + d.getMinutes() < sh * 60 + sm) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 14; i++, d.setDate(d.getDate() - 1)) {
    if (typical.weekdays.includes(d.getDay()) && !have.has(localDay(d))) return localDay(d);
  }
  return localDay();
}

/** Likely missing start/finish on a day: the biggest hole inside usual hours. */
function suggestSlot(drafts: EntryDraft[], day: string, typical: Typical): [string, string] {
  const live = drafts.filter((d) => !d.removed && d.cin).sort((a, b) => ms(a.cin) - ms(b.cin));
  const tStart = `${day}T${typical.start}`;
  const tEnd = `${day}T${typical.end}`;
  if (live.length === 0) return [tStart, tEnd];
  const edges: [string, string][] = [[tStart, live[0].cin]];
  for (let i = 1; i < live.length; i++) if (live[i - 1].cout) edges.push([live[i - 1].cout, live[i].cin]);
  const last = live[live.length - 1];
  if (last.cout) edges.push([last.cout, tEnd]);
  const best = edges.filter(([a, b]) => ms(b) - ms(a) >= 15 * 60_000).sort((x, y) => ms(y[1]) - ms(y[0]) - (ms(x[1]) - ms(x[0])))[0];
  if (best) return best;
  const from = last.cout || last.cin;
  return [plusMin(from, 30), plusMin(from, 150)];
}

/** New break: middle of the longest stretch without one; first long one unpaid 30m. */
function suggestBreak(d: EntryDraft): Pick<BreakDraft, "start" | "end" | "paid"> {
  const a = ms(d.cin);
  const b = d.still || !d.cout ? Date.now() : ms(d.cout);
  const live = d.brks.filter((x) => !x.removed && x.start).sort((x, y) => ms(x.start) - ms(y.start));
  const cuts = [a, ...live.flatMap((x) => [ms(x.start), x.end ? ms(x.end) : ms(x.start)]), b];
  let gs = a;
  let ge = b;
  for (let i = 0; i + 1 < cuts.length; i += 2) if (cuts[i + 1] - cuts[i] > ge - gs || i === 0) [gs, ge] = [cuts[i], cuts[i + 1]];
  const longShift = b - a >= 5 * 3600_000;
  const meal = longShift && !live.some((x) => !x.paid);
  const len = (meal ? 30 : 10) * 60_000;
  const start = Math.round((gs + (ge - gs) / 2 - len / 2) / 300_000) * 300_000; // nearest 5 min
  return {
    start: toLocal(new Date(start).toISOString()),
    end: toLocal(new Date(start + len).toISOString()),
    paid: !meal,
  };
}

export const apiDelete = <T,>(path: string, data: unknown) =>
  api<T>(path, { method: "DELETE", body: JSON.stringify(data) });
// Unshadowed names for the write-counting wrappers in the save.
const post = apiPost;
const patch = apiPatch;
const del = apiDelete;

interface BreakDraft {
  key: string;
  id: string | null; // null = new break
  start: string;
  end: string;
  paid: boolean;
  orig: string; // serialized original, to send only what changed
  removed: boolean;
}

interface EntryDraft {
  key: string;
  id: string | null; // null = new start/finish
  cin: string;
  cout: string;
  still: boolean;
  brks: BreakDraft[];
  removed: boolean;
  /** Can't be changed in this mode (approved/paid) — shown greyed. */
  ro: boolean;
  canRemove: boolean;
  src: EntryRow | null;
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

const draftFrom = (e: EntryRow, mode: "self" | "manager"): EntryDraft => ({
  key: e.id,
  id: e.id,
  cin: toLocal(e.clockIn),
  cout: toLocal(e.clockOut),
  still: e.clockOut == null,
  brks: e.breaks.map((b) => {
    const d = { start: toLocal(b.startAt), end: toLocal(b.endAt), paid: b.paid };
    return { key: b.id, id: b.id, ...d, orig: JSON.stringify(d), removed: false };
  }),
  removed: false,
  ro: mode === "self" && !e.selfEditable,
  canRemove: mode === "self" ? e.selfEditable : !e.paidAt,
  src: e,
});

const newDraft = (cin: string, cout: string): EntryDraft => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  id: null,
  cin,
  cout,
  still: false,
  brks: [],
  removed: false,
  ro: false,
  canRemove: true,
  src: null,
});

/** Problems the server would reject anyway — shown before save. */
function findProblems(drafts: EntryDraft[], t: TFn): Map<string, string> {
  const out = new Map<string, string>();
  const live = drafts.filter((d) => !d.removed);
  const now = Date.now();
  const span = (d: EntryDraft) => [ms(d.cin), d.still ? now : ms(d.cout)] as const;
  for (const d of live) {
    const [a, b] = span(d);
    if (!(b > a)) out.set(d.key, t("myHours.problemOrder"));
    for (const br of d.brks.filter((x) => !x.removed)) {
      const s = ms(br.start);
      const e = br.end ? ms(br.end) : now;
      if (!(e > s) || s < a || e > b) out.set(d.key, t("myHours.problemBreak"));
    }
  }
  const sorted = [...live].sort((x, y) => ms(x.cin) - ms(y.cin));
  for (let i = 1; i < sorted.length; i++) {
    if (ms(sorted[i].cin) < span(sorted[i - 1])[1]) {
      out.set(sorted[i].key, t("myHours.problemOverlap"));
      out.set(sorted[i - 1].key, t("myHours.problemOverlap"));
    }
  }
  return out;
}

/** Gantt strip of the day: one row per start/finish, breaks drawn on top. */
function DayGantt({ drafts, problems }: { drafts: EntryDraft[]; problems: Map<string, string> }) {
  const loc = useLocale();
  const t = useT();
  const now = Date.now();
  const rows = drafts
    .map((d, i) => ({ d, n: i + 1, a: ms(d.cin), b: d.still ? now : ms(d.cout) }))
    .filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b));
  if (rows.length === 0) return null;
  const H = 3600_000;
  let lo = Math.floor(Math.min(...rows.map((r) => r.a)) / H) * H;
  let hi = Math.ceil(Math.max(...rows.map((r) => Math.max(r.a, r.b))) / H) * H;
  if (hi - lo < 4 * H) {
    lo -= H;
    hi = lo + 6 * H;
  }
  const step = hi - lo > 12 * H ? 2 * H : H;
  const pct = (x: number) => `${((Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const ticks: number[] = [];
  for (let x = lo; x <= hi; x += step) ticks.push(x);
  const worked = rows
    .filter((r) => !r.d.removed && r.b > r.a)
    .reduce(
      (acc, r) =>
        acc +
        (r.b - r.a) -
        r.d.brks
          .filter((x) => !x.removed && !x.paid)
          .reduce((s, x) => s + Math.max(0, (x.end ? ms(x.end) : now) - ms(x.start)), 0),
      0,
    );

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="relative h-4 text-[10px] text-muted-foreground">
        {ticks.map((x) => (
          <span key={x} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(x) }}>
            {loc.time(x, { hour: "numeric" })}
          </span>
        ))}
      </div>
      {rows.map(({ d, n, a, b }) => (
        <div key={d.key} className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">{n}</span>
          <div className="relative h-6 flex-1 rounded bg-muted/40">
            {ticks.map((x) => (
              <span key={x} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(x) }} />
            ))}
            {b > a && (
              <div
                className={cn(
                  "absolute inset-y-0.5 rounded bg-primary/70",
                  d.still && "bg-gradient-to-r from-primary/70 to-primary/20",
                  d.removed && "bg-muted-foreground/30 opacity-60",
                  problems.has(d.key) && "ring-2 ring-destructive",
                )}
                style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
                title={`${loc.time(a)} → ${d.still ? t("myHours.breakOpen") : loc.time(b)}`}
              />
            )}
            {!d.removed &&
              d.brks
                .filter((x) => !x.removed && x.start)
                .map((x) => {
                  const s = ms(x.start);
                  const e = x.end ? ms(x.end) : now;
                  return e > s ? (
                    <div
                      key={x.key}
                      className={cn(
                        "absolute inset-y-1.5 rounded-sm",
                        x.paid ? "bg-amber-400/90" : "bg-[repeating-linear-gradient(45deg,#f59e0b_0_3px,transparent_3px_6px)]",
                      )}
                      style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
                      title={`${loc.time(s)} → ${loc.time(e)}`}
                    />
                  ) : null;
                })}
          </div>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-primary/70" /> {t("myHours.legendWork")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-amber-400/90" /> {t("myHours.legendPaidBreak")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,#f59e0b_0_3px,transparent_3px_6px)]" />{" "}
          {t("myHours.legendUnpaidBreak")}
        </span>
        <span className="ml-auto font-mono text-foreground">{(worked / H).toFixed(2)}h</span>
      </div>
    </div>
  );
}

/**
 * Edit a whole day: every start/finish on it (change, add, remove) and their
 * breaks, with a Gantt strip of how it lines up. `self` mode: staff edit any
 * day until a manager approves it — after that only a correction request.
 * `manager` mode edits directly at any time. Every save needs a reason and
 * is audited; staff changes go on the manager's review list.
 */
export function EditEntryDialog({
  entries,
  focusId,
  addNew,
  mode,
  defaultDay,
  employeeId,
  typical,
  onClose,
  onDone,
}: {
  /** All start/finish rows on the day (may be empty for a new day). */
  entries: EntryRow[];
  /** Entry that was clicked — used for the correction request when locked. */
  focusId?: string;
  /** Open with a blank start/finish ready to fill. */
  addNew?: boolean;
  mode: "self" | "manager";
  /** New entry: prefill this YYYY-MM-DD. */
  defaultDay?: string;
  /** Manager adding for someone else. */
  employeeId?: string;
  /** Person's usual hours — seeds new times so they rarely need changing. */
  typical?: Typical;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const loc = useLocale();
  const usual = typical ?? { start: "08:00", end: "16:30", weekdays: [1, 2, 3, 4, 5] };
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => +new Date(a.clockIn) - +new Date(b.clockIn)),
    [entries],
  );
  const day = sortedEntries[0]?.day ?? defaultDay ?? localDay();
  const focus = sortedEntries.find((e) => e.id === focusId) ?? null;
  // Approved/paid day for staff: correction request on the clicked row only.
  const locked = mode === "self" && focus != null && !focus.selfEditable;

  const [drafts, setDrafts] = useState<EntryDraft[]>(() => {
    const base = sortedEntries.map((e) => draftFrom(e, mode));
    if (addNew || base.length === 0) base.push(newDraft(...suggestSlot(base, day, usual)));
    return base;
  });
  const [cin, setCin] = useState(focus ? toLocal(focus.clockIn) : "");
  const [cout, setCout] = useState(focus ? toLocal(focus.clockOut) : "");
  const [typed, setTyped] = useState<string | null>(null); // null = not touched
  const wrote = useRef(0); // API writes that landed in the current save

  const setD = (key: string, patch: Partial<EntryDraft>) =>
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const setBrk = (dk: string, bk: string, patch: Partial<BreakDraft>) =>
    setDrafts((all) =>
      all.map((d) => (d.key !== dk ? d : { ...d, brks: d.brks.map((b) => (b.key === bk ? { ...b, ...patch } : b)) })),
    );
  const removeBrk = (dk: string, bk: string) =>
    setDrafts((all) =>
      all.map((d) =>
        d.key !== dk
          ? d
          : { ...d, brks: d.brks.flatMap((b) => (b.key !== bk ? [b] : b.id ? [{ ...b, removed: true }] : [])) },
      ),
    );
  const removeEntry = (key: string) =>
    setDrafts((all) => all.flatMap((d) => (d.key !== key ? [d] : d.id ? [{ ...d, removed: true }] : [])));

  const problems = useMemo(() => findProblems(drafts, t), [drafts, t]);

  // Likely reasons from what actually changed, most specific first.
  const suggestions = useMemo(() => {
    const s = new Set<MessageKey>();
    const others = drafts.filter((d) => d.id && !d.removed).length;
    for (const d of drafts.filter((x) => !x.ro)) {
      if (d.removed) s.add("myHours.reason.mistake");
      else if (!d.id) s.add(others > 0 ? "myHours.reason.leftSite" : "myHours.reason.forgotIn");
      else if (d.src) {
        if (d.src.clockOut == null && !d.still) s.add("myHours.reason.forgotOut");
        if (d.brks.some((b) => !b.id && !b.removed)) s.add("myHours.reason.break");
        if (d.cin !== toLocal(d.src.clockIn) || (!d.still && d.src.clockOut && d.cout !== toLocal(d.src.clockOut)))
          s.add("myHours.reason.wrongTime");
        if (d.brks.some((b) => b.removed || (b.id && JSON.stringify({ start: b.start, end: b.end, paid: b.paid }) !== b.orig)))
          s.add("myHours.reason.wrongTime");
      }
    }
    const best = [...s][0] ?? null;
    for (const k of [
      "myHours.reason.forgotOut",
      "myHours.reason.forgotIn",
      "myHours.reason.break",
      "myHours.reason.leftSite",
      "myHours.reason.wrongTime",
    ] as MessageKey[])
      s.add(k);
    return { best, chips: [...s] };
  }, [drafts]);
  // Prefilled with the most likely reason until the person types their own.
  const reason = typed ?? (suggestions.best ? t(suggestions.best) : "");

  const submit = useMutation({
    mutationFn: async () => {
      wrote.current = 0;
      if (locked) {
        await post("/corrections", {
          timeEntryId: focus!.id,
          requested: { clockIn: toIso(cin), clockOut: toIso(cout) },
          reason,
        });
        return t("toast.correctionRequested");
      }
      const editable = drafts.filter((d) => !d.ro);
      // Count writes that land, so a failure part-way knows whether to close.
      const apiDelete = <T,>(p: string, b: unknown) => del<T>(p, b).then((r) => (wrote.current++, r));
      const apiPatch = <T,>(p: string, b: unknown) => patch<T>(p, b).then((r) => (wrote.current++, r));
      const apiPost = <T,>(p: string, b: unknown) => post<T>(p, b).then((r) => (wrote.current++, r));
      // 1. Removed start/finishes first (frees time for the others).
      for (const d of editable.filter((x) => x.removed && x.id)) await apiDelete(`/entries/${d.id}`, { reason });
      // 2. Existing ones: removed breaks, then times.
      for (const d of editable.filter((x) => !x.removed && x.id && x.src)) {
        for (const b of d.brks.filter((x) => x.removed && x.id))
          await apiDelete(`/entries/${d.id}/breaks/${b.id}`, { reason });
        const src = d.src!;
        const clockIn = d.cin !== toLocal(src.clockIn) ? toIso(d.cin) : undefined;
        const outChanged = d.still ? src.clockOut != null : d.cout !== toLocal(src.clockOut);
        if (clockIn || outChanged)
          await apiPatch(`/entries/${d.id}`, {
            ...(clockIn && { clockIn }),
            ...(outChanged && { clockOut: d.still ? null : toIso(d.cout) }),
            reason,
          });
      }
      // 3. New start/finishes, then every changed/new break.
      for (const d of editable.filter((x) => !x.removed)) {
        let id = d.id;
        if (id == null) {
          const res = await apiPost<{ entryId: string }>("/entries", {
            clockIn: toIso(d.cin),
            clockOut: d.still ? null : (toIso(d.cout) ?? null),
            reason,
            ...(employeeId && { employeeId }),
          });
          id = res.entryId;
        }
        for (const b of d.brks.filter((x) => !x.removed)) {
          const now = JSON.stringify({ start: b.start, end: b.end, paid: b.paid });
          const body = { startAt: toIso(b.start), endAt: b.end ? toIso(b.end) : null, paid: b.paid, reason };
          if (b.id == null) await apiPost(`/entries/${id}/breaks`, body);
          else if (now !== b.orig) await apiPatch(`/entries/${id}/breaks/${b.id}`, body);
        }
      }
      return t("toast.timesUpdated");
    },
    onSuccess: (m) => {
      toast.success(m);
      onDone();
    },
    onError: (e) => {
      toast.error(errMsg(e, t));
      // Nothing landed: keep the dialog and the person's edits so they can fix
      // and retry. Part landed: close and refresh so a retry can't duplicate.
      if (wrote.current > 0) onDone();
    },
  });

  const canSave = reason.trim().length >= 3 && !submit.isPending && (locked || problems.size === 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sortedEntries.length === 0 ? t("myHours.newTitle") : t("myHours.dialogTitle")}</DialogTitle>
          <DialogDescription>{loc.date(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long" })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {locked ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-clock-in">{t("myHours.clockIn")}</Label>
                  <Input id="edit-clock-in" type="datetime-local" value={cin} onChange={(e) => setCin(e.target.value)} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-clock-out">{t("myHours.clockOut")}</Label>
                  <Input id="edit-clock-out" type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} />
                </div>
              </div>
              <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{t("myHours.lockedApproved")}</p>
            </>
          ) : (
            <>
              <DayGantt drafts={drafts} problems={problems} />

              {drafts.map((d, i) => (
                <div
                  key={d.key}
                  className={cn(
                    "flex flex-col gap-3 rounded-lg border border-border p-3",
                    problems.has(d.key) && "border-destructive/60",
                    d.removed && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted font-mono text-xs">{i + 1}</span>
                    <span className="text-sm font-medium">
                      {d.removed ? t("myHours.willRemove") : t("myHours.entryN", { n: i + 1 })}
                    </span>
                    {d.ro && <span className="text-xs text-muted-foreground">{t("myHours.dayApproved")}</span>}
                    {d.removed ? (
                      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setD(d.key, { removed: false })}>
                        <Undo2 /> {t("myHours.undo")}
                      </Button>
                    ) : (
                      d.canRemove &&
                      !d.ro && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto text-destructive"
                          onClick={() => removeEntry(d.key)}
                        >
                          <Trash2 /> {t("myHours.removeEntry")}
                        </Button>
                      )
                    )}
                  </div>

                  {!d.removed && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">{t("myHours.clockIn")}</Label>
                          <Input
                            type="datetime-local"
                            value={d.cin}
                            disabled={d.ro}
                            onChange={(e) => setD(d.key, { cin: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label className="text-xs">{t("myHours.clockOut")}</Label>
                          {d.still ? (
                            <p className="flex min-h-9 items-center text-sm text-muted-foreground">{t("myHours.stillClockedIn")}</p>
                          ) : (
                            <Input
                              type="datetime-local"
                              value={d.cout}
                              disabled={d.ro}
                              onChange={(e) => setD(d.key, { cout: e.target.value })}
                            />
                          )}
                        </div>
                      </div>
                      {!d.ro && (
                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Switch
                            checked={d.still}
                            onCheckedChange={(v) =>
                              setD(d.key, {
                                still: v,
                                ...(!v &&
                                  !d.cout && {
                                    cout:
                                      d.cin.slice(0, 10) === localDay()
                                        ? toLocal(new Date().toISOString())
                                        : `${d.cin.slice(0, 10)}T${usual.end}`,
                                  }),
                              })
                            }
                          />
                          {t("myHours.stillWorking")}
                        </label>
                      )}

                      {d.brks
                        .filter((b) => !b.removed)
                        .map((b) => (
                          <div
                            key={b.key}
                            className="grid grid-cols-[1fr_1fr] items-center gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
                          >
                            <Input
                              aria-label={t("myHours.breakStartLabel")}
                              type="datetime-local"
                              value={b.start}
                              disabled={d.ro}
                              onChange={(e) => setBrk(d.key, b.key, { start: e.target.value })}
                            />
                            <Input
                              aria-label={t("myHours.breakEndLabel")}
                              type="datetime-local"
                              value={b.end}
                              disabled={d.ro}
                              onChange={(e) => setBrk(d.key, b.key, { end: e.target.value })}
                            />
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Switch
                                checked={b.paid}
                                disabled={d.ro}
                                onCheckedChange={(v) => setBrk(d.key, b.key, { paid: v })}
                              />
                              {t("myHours.breakPaidToggle")}
                            </label>
                            {!d.ro && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="justify-self-end text-destructive"
                                aria-label={t("myHours.removeBreak")}
                                onClick={() => removeBrk(d.key, b.key)}
                              >
                                <Trash2 /> <span className="sm:sr-only">{t("myHours.removeBreak")}</span>
                              </Button>
                            )}
                          </div>
                        ))}
                      {!d.ro && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="self-start"
                          onClick={() =>
                            setD(d.key, {
                              brks: [
                                ...d.brks,
                                {
                                  key: `new-${Math.random().toString(36).slice(2)}`,
                                  id: null,
                                  ...suggestBreak(d),
                                  orig: "",
                                  removed: false,
                                },
                              ],
                            })
                          }
                        >
                          <Plus /> {t("myHours.addBreak")}
                        </Button>
                      )}
                      {problems.has(d.key) && <p className="text-xs text-destructive">{problems.get(d.key)}</p>}
                    </>
                  )}
                </div>
              ))}

              <Button
                variant="outline"
                className="self-start"
                onClick={() => setDrafts((all) => [...all, newDraft(...suggestSlot(all, day, usual))])}
              >
                <Plus /> {t("myHours.addTime")}
              </Button>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-reason">{t("myHours.reasonLabel")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.chips.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTyped(t(k))}
                  className={cn(
                    "rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted",
                    reason === t(k) && "border-primary bg-primary/15 text-foreground",
                  )}
                >
                  {t(k)}
                </button>
              ))}
            </div>
            <Textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t("myHours.reasonPlaceholder")}
              className="min-h-14"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!canSave}>
            {submit.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
