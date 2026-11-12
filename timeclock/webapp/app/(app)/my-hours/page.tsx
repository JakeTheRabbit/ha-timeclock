"use client";

import Link from "next/link";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, MessageCircleQuestion, Pencil, Plus, Send } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  EditEntryDialog,
  Textarea,
  errMsg,
  localDay,
  suggestMissingDay,
  typicalFrom,
  type EntryRow,
} from "@/components/entries/edit-entry-dialog";
import { HourDots, liveMinutes, MonthCalendar, monthGrid, monthStart } from "@/components/entries/month-calendar";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type TFn = (key: MessageKey, vars?: TVars) => string;

export interface ModRow {
  id: string;
  day: string;
  kind: "entry_add" | "entry_edit" | "entry_remove" | "break_add" | "break_edit" | "break_remove";
  reason: string;
  status: "pending" | "acknowledged" | "disputed" | "resolved";
  createdAt: string;
  messages: { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
}

const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

const breaksLabel = (e: EntryRow, t: TFn) =>
  e.breaks.length === 0
    ? "—"
    : e.breaks
        .map(
          (b) =>
            `${b.autoDeducted ? t("myHours.breakAuto") : ""}${b.paid ? t("myHours.breakPaid") : t("myHours.breakUnpaid")} ${
              b.endAt
                ? Math.round((+new Date(b.endAt) - +new Date(b.startAt)) / 60000) + "m"
                : t("myHours.breakOpen")
            }`,
        )
        .join(", ");

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

/** A dispute from the manager, with the conversation and a reply box. */
function DisputeCard({
  mod,
  myId,
  onSent,
  onOpenDay,
}: {
  mod: ModRow;
  myId: string;
  onSent: () => void;
  onOpenDay: (day: string) => void;
}) {
  const t = useT();
  const loc = useLocale();
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => apiPost(`/review/modifications/${mod.id}/messages`, { body: text }),
    onSuccess: () => {
      setText("");
      toast.success(t("toast.replySent"));
      onSent();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 p-3">
      <div className="text-sm font-medium">
        {t("myHours.disputeAbout", { day: loc.date(`${mod.day}T12:00:00`), what: t(`myHours.kind.${mod.kind}` as MessageKey) })}
      </div>
      <div className="text-xs text-muted-foreground">{t("myHours.yourReason", { reason: mod.reason })}</div>
      <div className="flex flex-col gap-2">
        {mod.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.authorId === myId ? "self-end bg-primary/15" : "self-start bg-muted"
            }`}
          >
            <div className="text-xs text-muted-foreground">
              {m.authorName} · {loc.dateTime(m.createdAt)}
            </div>
            {m.body}
          </div>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("myHours.replyPlaceholder")}
        className="min-h-14"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onOpenDay(mod.day)}>
          <Pencil /> {t("myHours.openDay")}
        </Button>
        <Button size="sm" className="ml-auto" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>
          <Send /> {t("myHours.send")}
        </Button>
      </div>
    </div>
  );
}

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const loc = useLocale();
  const fmtT = (s: string) => loc.time(s);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selected, setSelected] = useState<string | null>(localDay());
  const [editing, setEditing] = useState<{ day: string; focusId?: string; addNew?: boolean } | null>(null);

  const { start: from, end: to } = useMemo(() => monthGrid(month), [month]);
  const list = useQuery({
    queryKey: ["my-hours", from.toISOString()],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(`/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!session,
  });
  const review = useQuery({
    queryKey: ["my-review", from.toISOString()],
    queryFn: () =>
      apiGet<{ approvedDays: string[]; modifications: ModRow[] }>(
        `/review/mine?from=${localDay(new Date(from.getTime() - 86400_000))}&to=${localDay(to)}`,
      ),
    enabled: !!session,
  });
  const disputes = useQuery({
    queryKey: ["my-disputes"],
    queryFn: () => apiGet<{ modifications: ModRow[] }>("/review/mine/disputes"),
    enabled: !!session,
    refetchInterval: 60_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-hours"] });
    qc.invalidateQueries({ queryKey: ["my-review"] });
    qc.invalidateQueries({ queryKey: ["my-disputes"] });
  };

  const entries = useMemo(() => list.data?.entries ?? [], [list.data]);
  const typical = useMemo(() => typicalFrom(entries), [entries]);

  // Group by facility day, newest first; entries inside a day oldest first.
  const days = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, es]) => ({ day, entries: es.sort((a, b) => +new Date(a.clockIn) - +new Date(b.clockIn)) }));
  }, [entries]);
  // "Open this day" from a dispute: jump the calendar there, then open the
  // editor once that month's entries are in.
  const [editOnLoad, setEditOnLoad] = useState<string | null>(null);
  const openDay = (day: string) => {
    setSelected(day);
    setMonth(monthStart(new Date(`${day}T12:00:00`)));
    setEditOnLoad(day);
  };
  useEffect(() => {
    if (!editOnLoad || !list.data || list.isFetching) return;
    const es = days.find((d) => d.day === editOnLoad)?.entries ?? [];
    setEditing(es.length ? { day: editOnLoad, focusId: es[0].id } : { day: editOnLoad, addNew: true });
    setEditOnLoad(null);
  }, [editOnLoad, list.data, list.isFetching, days]);

  const pendingByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of review.data?.modifications ?? []) if (x.status === "pending") m.set(x.day, (m.get(x.day) ?? 0) + 1);
    return m;
  }, [review.data]);

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
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

  return (
    <Container>
      {(disputes.data?.modifications.length ?? 0) > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleQuestion className="size-5 text-amber-400" /> {t("myHours.disputesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {disputes.data!.modifications.map((m) => (
              <DisputeCard key={m.id} mod={m} myId={session.employee.id} onSent={refresh} onOpenDay={openDay} />
            ))}
          </CardContent>
        </Card>
      )}

      <MonthCalendar
        month={month}
        onMonth={setMonth}
        entries={entries}
        selected={selected}
        onSelect={setSelected}
        approvedDays={new Set(review.data?.approvedDays ?? [])}
        flaggedDays={new Set([...pendingByDay.keys(), ...(disputes.data?.modifications.map((m) => m.day) ?? [])])}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11"
          onClick={() => {
            const day = suggestMissingDay(entries, typical);
            setSelected(day);
            setEditing({ day, addNew: true });
          }}
        >
          <Plus /> {t("myHours.addShift")}
        </Button>
        <p className="flex-1 text-xs text-muted-foreground">{t("myHours.editHint")}</p>
      </div>

      {list.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!list.isLoading && selected && !days.some((d) => d.day === selected) && (
        <Card className="border-primary/60">
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{loc.date(`${selected}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className="text-sm text-muted-foreground">{t("myHours.noEntries")}</span>
            {selected <= localDay() && (
              <Button size="sm" className="ml-auto" onClick={() => setEditing({ day: selected, addNew: true })}>
                <Plus /> {t("myHours.addTime")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {[...days.filter((d) => d.day === selected), ...days.filter((d) => d.day !== selected)].map(({ day, entries: es }) => {
        const approved = es.some((e) => e.dayApproved);
        const dayMin = es.reduce((a, e) => a + liveMinutes(e), 0);
        const waiting = pendingByDay.get(day) ?? 0;
        return (
          <Card key={day} className={day === selected ? "border-primary/60" : undefined}>
            <CardContent className="flex flex-col gap-3">
              <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => setSelected(day)}>
                <span className="font-medium">{loc.date(`${day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
                {approved ? (
                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">
                    <CircleCheck className="size-3" /> {t("myHours.dayApproved")}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t("myHours.dayOpen")}</Badge>
                )}
                {waiting > 0 && (
                  <Badge className="border-transparent bg-amber-500/15 text-amber-300">
                    {t("myHours.changesWaiting", { n: waiting })}
                  </Badge>
                )}
                <span className="ml-auto font-mono text-sm">{hrs(dayMin)}</span>
              </button>

              <HourDots day={day} entries={es} />

              <div className="flex flex-col gap-1">
                {es.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    {fmtT(e.clockIn)} → {e.clockOut ? fmtT(e.clockOut) : t("myHours.breakOpen")}
                    <span className="text-muted-foreground">{hrs(liveMinutes(e))}</span>
                    <span className="font-sans text-xs text-muted-foreground">
                      {t("myHours.breaks", { value: breaksLabel(e, t) })}
                      {e.job && <> · {e.job.name}</>}
                    </span>
                    {e.edited && (
                      <Badge className="border-transparent bg-amber-500/15 font-sans text-amber-300">{t("myHours.edited")}</Badge>
                    )}
                    {e.paidAt && (
                      <Badge className="border-transparent bg-emerald-500/15 font-sans text-emerald-300">{t("myHours.paid")}</Badge>
                    )}
                  </div>
                ))}
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="min-h-11 self-start sm:min-h-9"
                onClick={() => setEditing({ day, focusId: es[0]?.id })}
              >
                <Pencil /> {t("myHours.fixTimes")}
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {editing && (
        <EditEntryDialog
          entries={days.find((d) => d.day === editing.day)?.entries ?? []}
          focusId={editing.focusId}
          addNew={editing.addNew}
          defaultDay={editing.day}
          typical={typical}
          mode="self"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}
