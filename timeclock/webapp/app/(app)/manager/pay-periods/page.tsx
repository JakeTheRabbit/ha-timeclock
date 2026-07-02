"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Lock, LockKeyhole } from "lucide-react";

import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface Period {
  id: string;
  startAt: string;
  endAt: string;
  lockedAt: string | null;
}
interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  totals: {
    workedMin: number;
    ordinaryMin: number;
    ot1Min: number;
    ot2Min: number;
    statT15Min: number;
    altHolidaysEarned: number;
    editedDays: number;
    complianceFlagCount: number;
  };
}

const h = (min: number) => (min / 60).toFixed(2);

export default function PayPeriodsPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const d = (iso: string) => loc.date(iso, { day: "numeric", month: "short" });
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canSee =
    session && ["lead", "manager", "admin"].includes(session.employee.role);

  const periods = useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => apiGet<{ periods: Period[] }>("/manager/pay-periods"),
    enabled: !!canSee,
  });
  const timesheet = useQuery({
    queryKey: ["timesheet", selected],
    queryFn: () =>
      apiGet<{ period: Period; rows: TimesheetRow[] }>(
        `/manager/pay-periods/${selected}/timesheet`,
      ),
    enabled: !!selected,
  });

  const lock = useMutation({
    mutationFn: (id: string) => apiPost(`/manager/pay-periods/${id}/lock`),
    onSuccess: () => {
      toast.success("Period locked — entries inside are now immutable.");
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
      qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Lock refused: ${(e.body as { error?: string })?.error}`
          : "Lock failed",
      ),
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canSee) {
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
  }

  const period = timesheet.data?.period;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* Period selector */}
      <Select value={selected ?? undefined} onValueChange={setSelected}>
        <SelectTrigger aria-label="Select pay period">
          <SelectValue placeholder="Select a pay period…" />
        </SelectTrigger>
        <SelectContent>
          {periods.data?.periods.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {d(p.startAt)} – {d(p.endAt)}
              {p.lockedAt && <Lock className="size-3.5 text-muted-foreground" />}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && timesheet.isLoading && (
        <Skeleton className="h-64 w-full rounded-xl" />
      )}

      {selected && timesheet.data && period && (
        <>
          {/* Sign-off / lock + exports */}
          <div className="flex flex-wrap items-center gap-2">
            {!period.lockedAt ? (
              <>
                <Button
                  variant="destructive"
                  disabled={lock.isPending}
                  onClick={() => setConfirmOpen(true)}
                >
                  <LockKeyhole /> Sign off + LOCK period
                </Button>
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Lock this pay period?</DialogTitle>
                      <DialogDescription>
                        Signing off locks {d(period.startAt)} –{" "}
                        {d(period.endAt)}. Every time entry inside the period
                        becomes immutable. This cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        disabled={lock.isPending}
                        onClick={() => {
                          setConfirmOpen(false);
                          lock.mutate(selected);
                        }}
                      >
                        <LockKeyhole /> Lock period
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <Badge
                variant="secondary"
                className="gap-1.5 px-3 py-1.5 text-sm [&>svg]:size-4"
              >
                <Lock /> Locked {loc.dateTime(period.lockedAt)}
              </Badge>
            )}
            <Button asChild variant="outline">
              <a href={`${BASE}/api/reports/timesheet.csv?periodId=${selected}`}>
                <Download /> Timesheet CSV
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${BASE}/api/reports/timesheet.pdf?periodId=${selected}`}>
                <Download /> PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a
                href={`${BASE}/api/reports/payroll?periodId=${selected}&adapter=csv`}
              >
                <Download /> Payroll CSV
              </a>
            </Button>
          </div>

          {timesheet.data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No worked time in this period.
            </p>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {timesheet.data.rows.map((r) => (
                  <Card key={r.employeeId} className="gap-3">
                    <CardHeader>
                      <CardTitle>{r.employeeName}</CardTitle>
                      {(r.totals.editedDays > 0 ||
                        r.totals.complianceFlagCount > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                          {r.totals.editedDays > 0 && (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                            >
                              {r.totals.editedDays}d edited
                            </Badge>
                          )}
                          {r.totals.complianceFlagCount > 0 && (
                            <Badge variant="destructive">
                              {r.totals.complianceFlagCount} flags
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Worked</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.workedMin)}
                        </dd>
                        <dt className="text-muted-foreground">Ordinary</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ordinaryMin)}
                        </dd>
                        <dt className="text-muted-foreground">OT 1.5</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ot1Min)}
                        </dd>
                        <dt className="text-muted-foreground">OT 2.0</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ot2Min)}
                        </dd>
                        <dt className="text-muted-foreground">Stat T1.5</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.statT15Min)}
                        </dd>
                        <dt className="text-muted-foreground">Alt holidays</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {r.totals.altHolidaysEarned || "—"}
                        </dd>
                      </dl>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Worked</TableHead>
                      <TableHead>Ordinary</TableHead>
                      <TableHead>OT 1.5</TableHead>
                      <TableHead>OT 2.0</TableHead>
                      <TableHead>Stat T1.5</TableHead>
                      <TableHead>Alt hol.</TableHead>
                      <TableHead>Edited</TableHead>
                      <TableHead>Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timesheet.data.rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium">
                          {r.employeeName}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.workedMin)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ordinaryMin)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ot1Min)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ot2Min)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.statT15Min)}
                        </TableCell>
                        <TableCell>
                          {r.totals.altHolidaysEarned || "—"}
                        </TableCell>
                        <TableCell>
                          {r.totals.editedDays > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                            >
                              {r.totals.editedDays}d
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {r.totals.complianceFlagCount > 0 ? (
                            <Badge variant="destructive">
                              {r.totals.complianceFlagCount}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
