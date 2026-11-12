"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCheck, CircleCheck, MessageCircleQuestion, Pencil, Send, Undo2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { entriesHref } from "@/lib/links";
import { useT } from "@/lib/i18n";
import { errMsg, localDay, Textarea } from "@/components/entries/edit-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "entry_add" | "entry_edit" | "entry_remove" | "break_add" | "break_edit" | "break_remove";
type Status = "pending" | "acknowledged" | "disputed" | "resolved";

interface Mod {
  id: string;
  employeeId: string;
  employeeName: string;
  day: string;
  kind: Kind;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  status: Status;
  createdAt: string;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  disputedByName: string | null;
  resolvedByName: string | null;
  messages: { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
}

interface DaySummary {
  day: string;
  entries: { id: string; clockIn: string; clockOut: string | null; workedMinutes: number | null; breaks: unknown[] }[];
  workedMinutes: number;
  hasOpen: boolean;
  approved: { at: string; by: string } | null;
  pendingMods: number;
  disputedMods: number;
}

const KIND: Record<Kind, string> = {
  entry_add: "Added time",
  entry_edit: "Changed times",
  entry_remove: "Removed time",
  break_add: "Added break",
  break_edit: "Changed break",
  break_remove: "Removed break",
};
const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  disputed: "bg-destructive/15 text-destructive",
  acknowledged: "bg-emerald-500/15 text-emerald-300",
  resolved: "bg-sky-500/15 text-sky-300",
};

const hrs = (min: number) => (min / 60).toFixed(2) + "h";

function useSpan() {
  const loc = useLocale();
  return (v: Record<string, unknown> | null): string => {
    if (!v) return "—";
    const a = (v.clockIn ?? v.startAt) as string | undefined;
    const b = (v.clockOut ?? v.endAt) as string | null | undefined;
    if (!a) return "—";
    const span = `${loc.time(a)} → ${b ? loc.time(b) : "open"}`;
    const extra = "paid" in v ? (v.paid ? " (paid)" : " (unpaid)") : "";
    const brks = Array.isArray(v.breaks) && v.breaks.length ? ` · ${v.breaks.length} break(s)` : "";
    return span + extra + brks;
  };
}

function ModCard({ mod, myId }: { mod: Mod; myId: string }) {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const span = useSpan();
  const [disputing, setDisputing] = useState(false);
  const [text, setText] = useState("");
  const done = () => {
    setText("");
    setDisputing(false);
    qc.invalidateQueries({ queryKey: ["review-mods"] });
    qc.invalidateQueries({ queryKey: ["review-days"] });
    qc.invalidateQueries({ queryKey: ["review-open-count"] });
    qc.invalidateQueries({ queryKey: ["my-disputes"] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost(`/review/modifications/${mod.id}/${path}`, body),
    onSuccess: done,
    onError: (e) => toast.error(errMsg(e, t)),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={entriesHref(mod.employeeId, mod.day)} className="font-medium underline-offset-4 hover:underline">
          {mod.employeeName}
        </Link>
        <Link href={entriesHref(mod.employeeId, mod.day)} className="text-muted-foreground underline-offset-4 hover:underline">
          {loc.date(`${mod.day}T12:00:00`)}
        </Link>
        <Badge variant="secondary">{KIND[mod.kind]}</Badge>
        <Badge className={`border-transparent capitalize ${STATUS_STYLE[mod.status]}`}>{mod.status}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{loc.dateTime(mod.createdAt)}</span>
      </div>
      <div className="font-mono text-sm">
        {mod.before && <span className="text-muted-foreground line-through">{span(mod.before)}</span>}
        {mod.before && mod.after && <span className="px-2">⇒</span>}
        {mod.after && <span>{span(mod.after)}</span>}
      </div>
      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Reason: </span>
        {mod.reason}
      </div>
      {mod.status === "acknowledged" && mod.acknowledgedByName && (
        <div className="text-xs text-muted-foreground">Seen by {mod.acknowledgedByName}</div>
      )}

      {mod.messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {mod.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.authorId === myId ? "self-end bg-primary/15" : "self-start bg-muted"}`}
            >
              <div className="text-xs text-muted-foreground">
                {m.authorName} · {loc.dateTime(m.createdAt)}
              </div>
              {m.body}
            </div>
          ))}
        </div>
      )}

      {mod.status === "pending" && !disputing && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={act.isPending} onClick={() => act.mutate({ path: "acknowledge", body: {} })}>
            <Check /> Acknowledge
          </Button>
          <Button variant="destructive" onClick={() => setDisputing(true)}>
            <MessageCircleQuestion /> Dispute
          </Button>
        </div>
      )}
      {(disputing || mod.status === "disputed") && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-14"
            placeholder={disputing ? `What's the problem? ${mod.employeeName} gets this message.` : "Reply…"}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {disputing ? (
              <>
                <Button variant="secondary" onClick={() => setDisputing(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={text.trim().length < 3 || act.isPending}
                  onClick={() => act.mutate({ path: "dispute", body: { message: text } })}
                >
                  <Send /> Send dispute
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={!text.trim() || act.isPending}
                  onClick={() => act.mutate({ path: "messages", body: { body: text } })}
                >
                  <Send /> Reply
                </Button>
                <Button
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: "resolve", body: text.trim() ? { note: text } : {} })}
                >
                  <CheckCheck /> Resolve
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Timesheet review: (1) every change staff made to their own times, each with
 * their reason — tick Acknowledge (read it) or Dispute (opens a conversation);
 * (2) approve days, which locks them against further staff edits.
 */
export default function ReviewPage() {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const { session, isLoading } = useSession();
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);
  const isManager = session && ["manager", "admin"].includes(session.employee.role);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  const mods = useQuery({
    queryKey: ["review-mods", filter],
    queryFn: () => apiGet<{ modifications: Mod[] }>(`/review/modifications?status=${filter}`),
    enabled: !!canSee,
    refetchInterval: 30_000,
  });
  const people = useQuery({
    queryKey: ["manager-employees"],
    queryFn: () => apiGet<{ employees: { id: string; displayName: string; active: boolean }[] }>("/manager/employees"),
    enabled: !!canSee,
  });
  const range = useMemo(() => ({ from: localDay(new Date(Date.now() - 20 * 86400_000)), to: localDay() }), []);
  const days = useQuery({
    queryKey: ["review-days", employeeId],
    queryFn: () =>
      apiGet<{ days: DaySummary[] }>(`/review/days?employeeId=${employeeId}&from=${range.from}&to=${range.to}`),
    enabled: !!employeeId,
  });

  const refreshDays = () => {
    qc.invalidateQueries({ queryKey: ["review-days"] });
    qc.invalidateQueries({ queryKey: ["manager-entries"] });
  };
  const approve = useMutation({
    mutationFn: (ds: string[]) =>
      apiPost<{ approved: string[]; skipped: { day: string; reason: string }[] }>("/review/days/approve", { employeeId, days: ds }),
    onSuccess: (r) => {
      if (r.approved.length) toast.success(`Approved ${r.approved.length} day(s).`);
      for (const s of r.skipped)
        toast.warning(
          `${s.day}: ${
            s.reason === "open_entry"
              ? "still clocked in — close the shift first"
              : s.reason === "dispute_open"
                ? "open dispute — resolve it first"
                : "already approved"
          }`,
        );
      refreshDays();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  const unapprove = useMutation({
    mutationFn: ({ day, reason }: { day: string; reason: string }) =>
      apiPost("/review/days/unapprove", { employeeId, day, reason }),
    onSuccess: () => {
      toast.success("Approval removed — staff can edit that day again.");
      refreshDays();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  const ackAll = useMutation({
    mutationFn: (ids: string[]) => apiPost<{ acknowledged: number }>("/review/modifications/acknowledge", { ids }),
    onSuccess: (r) => {
      toast.success(`Acknowledged ${r.acknowledged} change(s).`);
      qc.invalidateQueries({ queryKey: ["review-mods"] });
      qc.invalidateQueries({ queryKey: ["review-days"] });
      qc.invalidateQueries({ queryKey: ["review-open-count"] });
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });

  if (isLoading)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  if (!canSee)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Access denied</CardTitle>
            <CardDescription>Lead role or above required.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );

  const list = mods.data?.modifications ?? [];
  const pendingIds = list.filter((m) => m.status === "pending").map((m) => m.id);
  const eligible = (days.data?.days ?? []).filter((d) => !d.approved && !d.hasOpen && d.disputedMods === 0 && d.entries.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Staff changes to check</CardTitle>
          <CardDescription>
            Acknowledge = you have read it (no approval needed). Dispute = you don&apos;t agree; it starts a conversation with the
            employee.
          </CardDescription>
          <CardAction>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
              <TabsList>
                <TabsTrigger value="open">To check</TabsTrigger>
                <TabsTrigger value="all">History</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mods.isLoading && <Skeleton className="h-24 w-full" />}
          {!mods.isLoading && list.length === 0 && (
            <p className="text-sm text-muted-foreground">{filter === "open" ? "Nothing to check." : "No changes yet."}</p>
          )}
          {pendingIds.length > 1 && (
            <Button variant="secondary" className="self-start" disabled={ackAll.isPending} onClick={() => ackAll.mutate(pendingIds)}>
              <CheckCheck /> Acknowledge all {pendingIds.length}
            </Button>
          )}
          {list.map((m) => (
            <ModCard key={m.id} mod={m} myId={session.employee.id} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approve days</CardTitle>
          <CardDescription>An approved day is locked: the employee can no longer change it. You still can.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={employeeId ?? undefined} onValueChange={setEmployeeId}>
            <SelectTrigger aria-label="Select employee">
              <SelectValue placeholder="Select an employee…" />
            </SelectTrigger>
            <SelectContent>
              {people.data?.employees
                .filter((p) => p.active)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {employeeId && days.isLoading && <Skeleton className="h-24 w-full" />}
          {employeeId && !days.isLoading && (days.data?.days.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No time in the last 3 weeks.</p>
          )}
          {eligible.length > 1 && (
            <Button className="self-start" disabled={approve.isPending} onClick={() => approve.mutate(eligible.map((d) => d.day))}>
              <CircleCheck /> Approve all {eligible.length} ready days
            </Button>
          )}
          {days.data?.days.map((d) => (
            <div key={d.day} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{loc.date(`${d.day}T12:00:00`)}</span>
                  <span className="font-mono">{hrs(d.workedMinutes)}</span>
                  {d.approved && (
                    <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Approved by {d.approved.by}</Badge>
                  )}
                  {d.pendingMods > 0 && (
                    <Badge className="border-transparent bg-amber-500/15 text-amber-300">{d.pendingMods} to check</Badge>
                  )}
                  {d.disputedMods > 0 && (
                    <Badge className="border-transparent bg-destructive/15 text-destructive">{d.disputedMods} disputed</Badge>
                  )}
                  {d.hasOpen && <Badge variant="secondary">Clocked in</Badge>}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {d.entries
                    .map((e) => `${loc.time(e.clockIn)}–${e.clockOut ? loc.time(e.clockOut) : "open"}`)
                    .join("  ·  ") || "—"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="ghost" size="sm" aria-label="Edit this day">
                  <Link href={entriesHref(employeeId!, d.day, true)}>
                    <Pencil />
                  </Link>
                </Button>
                {d.approved ? (
                  isManager && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={unapprove.isPending}
                      onClick={() => {
                        const reason = window.prompt("Why reopen this day for the employee?");
                        if (reason && reason.trim().length >= 3) unapprove.mutate({ day: d.day, reason });
                      }}
                    >
                      <Undo2 /> Reopen
                    </Button>
                  )
                ) : d.hasOpen ? (
                  // Say why it can't be approved, and where to fix it.
                  <Button asChild variant="outline" size="sm">
                    <Link href={entriesHref(employeeId!, d.day, true)}>Still clocked in — close shift</Link>
                  </Button>
                ) : d.disputedMods > 0 ? (
                  <span className="self-center text-xs text-destructive">Dispute open — resolve above</span>
                ) : d.entries.length === 0 ? (
                  <span className="self-center text-xs text-muted-foreground">No time</span>
                ) : (
                  <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate([d.day])}>
                    <CircleCheck /> Approve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
