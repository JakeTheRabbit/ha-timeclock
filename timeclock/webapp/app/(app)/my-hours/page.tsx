"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

interface EntryRow {
  id: string;
  clockIn: string;
  clockOut: string | null;
  edited: boolean;
  note: string | null;
  job: { id: string; name: string } | null;
  workedMinutes: number | null;
  breaks: { id: string; startAt: string; endAt: string | null; paid: boolean; autoDeducted: boolean }[];
}

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

const fmtT = (s: string) => new Date(s).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
const fmtD = (s: string) => new Date(s).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

const breaksLabel = (e: EntryRow) =>
  e.breaks.length === 0
    ? "—"
    : e.breaks
        .map(
          (b) =>
            `${b.autoDeducted ? "auto " : ""}${b.paid ? "paid" : "unpaid"} ${
              b.endAt
                ? Math.round((+new Date(b.endAt) - +new Date(b.startAt)) / 60000) + "m"
                : "open"
            }`,
        )
        .join(", ");

const errMsg = (e: unknown) =>
  e instanceof ApiError
    ? ((e.body as { error?: string })?.error ?? `Error ${e.status}`)
    : "Request failed";

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
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
            <p className="text-sm text-muted-foreground">You are not signed in.</p>
            <Button asChild variant="secondary">
              <Link href="/pin">PIN sign-in</Link>
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
            {(["today", "week", "fortnight"] as Range[]).map((r) => (
              <TabsTrigger key={r} value={r} className="capitalize">
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="ml-auto text-sm text-muted-foreground">
          Total: <span className="font-mono text-foreground">{hrs(totalMin)}</span>
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
            No entries in range.
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
                      Edited
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-sm">{hrs(e.workedMinutes)}</span>
                </div>
                <div className="font-mono text-sm text-muted-foreground">
                  {fmtT(e.clockIn)} → {e.clockOut ? fmtT(e.clockOut) : "open"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Breaks: {breaksLabel(e)}
                  {e.job && <> · {e.job.name}</>}
                </div>
                {e.clockOut && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-1 min-h-11 self-start"
                    onClick={() => setEditing(e)}
                  >
                    <Pencil /> Fix times
                  </Button>
                )}
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
                <TableHead>Day</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Breaks</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{fmtD(e.clockIn)}</TableCell>
                  <TableCell className="font-mono">{fmtT(e.clockIn)}</TableCell>
                  <TableCell className="font-mono">{e.clockOut ? fmtT(e.clockOut) : "open"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{breaksLabel(e)}</TableCell>
                  <TableCell>{e.job?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono">
                    {hrs(e.workedMinutes)}
                    {e.edited && (
                      <Badge className="ml-2 border-transparent bg-amber-500/15 text-amber-300">
                        Edited
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {e.clockOut && (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(e)}>
                        <Pencil /> Fix times
                      </Button>
                    )}
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

function EditEntryDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: EntryRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const toLocal = (iso: string | null) =>
    iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const [cin, setCin] = useState(toLocal(entry.clockIn));
  const [cout, setCout] = useState(toLocal(entry.clockOut));
  const [reason, setReason] = useState("");
  const [asCorrection, setAsCorrection] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const clockIn = cin ? new Date(cin).toISOString() : undefined;
      const clockOut = cout ? new Date(cout).toISOString() : undefined;
      if (asCorrection) {
        await apiPost("/corrections", {
          timeEntryId: entry.id,
          requested: { clockIn, clockOut },
          reason,
        });
        return "Correction requested — awaiting approval.";
      }
      await apiPatch(`/entries/${entry.id}`, { clockIn, clockOut, reason });
      return "Times updated (flagged as edited).";
    },
    onSuccess: (m) => {
      toast.success(m);
      onDone();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fix times</DialogTitle>
          <DialogDescription>{fmtD(entry.clockIn)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-in">Clock in</Label>
              <Input
                id="edit-clock-in"
                type="datetime-local"
                value={cin}
                onChange={(e) => setCin(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-clock-out">Clock out</Label>
              <Input
                id="edit-clock-out"
                type="datetime-local"
                value={cout}
                onChange={(e) => setCout(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-reason">Reason (required)</Label>
            <Textarea
              id="edit-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. forgot to clock out"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <Label htmlFor="edit-as-correction" className="flex flex-col items-start gap-1">
              Send as correction request
              <span className="text-xs font-normal text-muted-foreground">
                A manager approves before times change
              </span>
            </Label>
            <Switch
              id="edit-as-correction"
              checked={asCorrection}
              onCheckedChange={setAsCorrection}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={reason.trim().length < 3 || submit.isPending}
          >
            {submit.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
