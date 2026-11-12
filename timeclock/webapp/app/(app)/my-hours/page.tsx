"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleCheck, MessageCircleQuestion, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  EditEntryDialog,
  RemoveEntryDialog,
  Textarea,
  errMsg,
  localDay,
  type EntryRow,
} from "@/components/entries/edit-entry-dialog";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Range = "today" | "week" | "fortnight" | "month";

function rangeDates(r: Range): { from: Date; to: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const monday = (start.getDay() + 6) % 7; // Monday start
  if (r === "week") start.setDate(start.getDate() - monday);
  else if (r === "fortnight") start.setDate(start.getDate() - monday - 7);
  else if (r === "month") start.setDate(start.getDate() - 30);
  const to = new Date(now.getTime() + 24 * 3600_000);
  return { from: start, to };
}

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
function DisputeCard({ mod, myId, onSent }: { mod: ModRow; myId: string; onSent: () => void }) {
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
      <Button size="sm" className="self-end" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>
        <Send /> {t("myHours.send")}
      </Button>
    </div>
  );
}

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const loc = useLocale();
  const fmtT = (s: string) => loc.time(s);
  const [range, setRange] = useState<Range>("week");
  const [editing, setEditing] = useState<{ entry: EntryRow | null; day?: string } | null>(null);
  const [removing, setRemoving] = useState<EntryRow | null>(null);

  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const list = useQuery({
    queryKey: ["my-hours", range],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(`/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!session,
  });
  const review = useQuery({
    queryKey: ["my-review", range],
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

  const entries = list.data?.entries ?? [];
  const totalMin = entries.reduce((a, e) => a + (e.workedMinutes ?? 0), 0);

  // Group by facility day, newest first; entries inside a day oldest first.
  const days = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, es]) => ({ day, entries: es.sort((a, b) => +new Date(a.clockIn) - +new Date(b.clockIn)) }));
  }, [entries]);
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
              <DisputeCard key={m.id} mod={m} myId={session.employee.id} onSent={refresh} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            {(
              [
                ["today", "myHours.rangeToday"],
                ["week", "myHours.rangeWeek"],
                ["fortnight", "myHours.rangeFortnight"],
                ["month", "myHours.rangeMonth"],
              ] as [Range, MessageKey][]
            ).map(([r, key]) => (
              <TabsTrigger key={r} value={r} className="capitalize">
                {t(key)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="ml-auto text-sm text-muted-foreground">
          {t("myHours.total")} <span className="font-mono text-foreground">{hrs(totalMin)}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11" onClick={() => setEditing({ entry: null })}>
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

      {!list.isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">{t("myHours.noEntries")}</CardContent>
        </Card>
      )}

      {days.map(({ day, entries: es }) => {
        const approved = es.some((e) => e.dayApproved);
        const dayMin = es.reduce((a, e) => a + (e.workedMinutes ?? 0), 0);
        const waiting = pendingByDay.get(day) ?? 0;
        return (
          <Card key={day}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{loc.date(`${day}T12:00:00`)}</span>
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
              </div>

              {es.map((e) => (
                <div key={e.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                      {fmtT(e.clockIn)} → {e.clockOut ? fmtT(e.clockOut) : t("myHours.breakOpen")}
                      <span className="text-muted-foreground">{hrs(e.workedMinutes)}</span>
                      {e.edited && (
                        <Badge className="border-transparent bg-amber-500/15 font-sans text-amber-300">{t("myHours.edited")}</Badge>
                      )}
                      {e.paidAt && (
                        <Badge className="border-transparent bg-emerald-500/15 font-sans text-emerald-300">{t("myHours.paid")}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("myHours.breaks", { value: breaksLabel(e, t) })}
                      {e.job && <> · {e.job.name}</>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setEditing({ entry: e })}>
                      <Pencil /> {t("myHours.fixTimes")}
                    </Button>
                    {e.selfEditable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 text-destructive sm:min-h-9"
                        aria-label={t("myHours.remove")}
                        onClick={() => setRemoving(e)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
              ))}

              {!approved && (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing({ entry: null, day })}>
                  <Plus /> {t("myHours.addTime")}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {editing && (
        <EditEntryDialog
          entry={editing.entry}
          defaultDay={editing.day}
          mode="self"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {removing && (
        <RemoveEntryDialog
          entry={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}
