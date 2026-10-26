"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { EditEntryDialog, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pencil } from "lucide-react";

type Range = "today" | "week" | "fortnight";

function rangeDates(r: Range): { from: Date; to: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (r === "week") {
    const day = (start.getDay() + 6) % 7; // Monday start
    start.setDate(start.getDate() - day);
  } else if (r === "fortnight") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day - 7);
  }
  const to = new Date(now.getTime() + 24 * 3600_000);
  return { from: start, to };
}

type TFn = (key: MessageKey, vars?: TVars) => string;

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

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const loc = useLocale();
  const fmtT = (s: string) => loc.time(s);
  const fmtD = (s: string) => loc.date(s);
  const [range, setRange] = useState<Range>("week");
  const [editing, setEditing] = useState<EntryRow | null>(null);

  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const list = useQuery({
    queryKey: ["my-hours", range],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    enabled: !!session,
  });

  const totalMin = list.data?.entries.reduce((a, e) => a + (e.workedMinutes ?? 0), 0) ?? 0;

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

  const entries = list.data?.entries ?? [];

  return (
    <Container>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            {(
              [
                ["today", "myHours.rangeToday"],
                ["week", "myHours.rangeWeek"],
                ["fortnight", "myHours.rangeFortnight"],
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

      {list.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!list.isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">
            {t("myHours.noEntries")}
          </CardContent>
        </Card>
      )}

      {/* Mobile: stacked cards */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {entries.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{fmtD(e.clockIn)}</span>
                  {e.edited && (
                    <Badge className="border-transparent bg-amber-500/15 text-amber-300">
                      {t("myHours.edited")}
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-sm">{hrs(e.workedMinutes)}</span>
                </div>
                <div className="font-mono text-sm text-muted-foreground">
                  {fmtT(e.clockIn)} → {e.clockOut ? fmtT(e.clockOut) : t("myHours.breakOpen")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("myHours.breaks", { value: breaksLabel(e, t) })}
                  {e.job && <> · {e.job.name}</>}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1 min-h-11 self-start"
                  onClick={() => setEditing(e)}
                >
                  <Pencil /> {t("myHours.fixTimes")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Desktop: table */}
      {entries.length > 0 && (
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("myHours.colDay")}</TableHead>
                <TableHead>{t("myHours.colIn")}</TableHead>
                <TableHead>{t("myHours.colOut")}</TableHead>
                <TableHead>{t("myHours.colBreaks")}</TableHead>
                <TableHead>{t("myHours.colJob")}</TableHead>
                <TableHead>{t("myHours.colWorked")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{fmtD(e.clockIn)}</TableCell>
                  <TableCell className="font-mono">{fmtT(e.clockIn)}</TableCell>
                  <TableCell className="font-mono">{e.clockOut ? fmtT(e.clockOut) : t("myHours.breakOpen")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{breaksLabel(e, t)}</TableCell>
                  <TableCell>{e.job?.name ?? t("common.none")}</TableCell>
                  <TableCell className="font-mono">
                    {hrs(e.workedMinutes)}
                    {e.edited && (
                      <Badge className="ml-2 border-transparent bg-amber-500/15 text-amber-300">
                        {t("myHours.edited")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(e)}>
                      <Pencil /> {t("myHours.fixTimes")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <EditEntryDialog
          entry={editing}
          mode="self"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["my-hours"] });
          }}
        />
      )}
    </Container>
  );
}
