"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarRange,
  Check,
  ChevronRight,
  ScrollText,
  X,
} from "lucide-react";

import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Board {
  now: string;
  clockedIn: {
    entryId: string;
    employeeId: string;
    employeeName: string;
    clockIn: string;
    onBreak: boolean;
    breakSince: string | null;
  }[];
  todayClosedMin: Record<string, number>;
}
interface PendingCorrection {
  id: string;
  employeeName: string;
  reason: string;
  requested: { clockIn?: string; clockOut?: string; note?: string };
  createdAt: string;
}
interface PendingLeave {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: string;
  note: string | null;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.body as { error?: string } | null)?.error;
    return detail ? `${detail} (${e.status})` : `Request failed (${e.status})`;
  }
  return "Request failed.";
}

function LiveRow({ e }: { e: Board["clockedIn"][number] }) {
  const timer = useLiveTimer(e.clockIn);
  return (
    <div className="flex min-h-11 items-center gap-3">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${
          e.onBreak ? "bg-amber-400" : "bg-emerald-400"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.employeeName}</div>
        <div className="text-xs text-muted-foreground">
          {e.onBreak ? "On break" : "Working"}
        </div>
      </div>
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {timer}
      </span>
    </div>
  );
}

export default function ManagerPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const canSee =
    session && ["lead", "manager", "admin"].includes(session.employee.role);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => apiGet<Board>("/manager/board"),
    enabled: !!canSee,
    refetchInterval: 15_000,
  });
  const corrections = useQuery({
    queryKey: ["pending-corrections"],
    queryFn: () =>
      apiGet<{ corrections: PendingCorrection[] }>("/corrections/pending"),
    enabled: !!canSee,
  });
  const leave = useQuery({
    queryKey: ["pending-leave"],
    queryFn: () => apiGet<{ requests: PendingLeave[] }>("/leave/pending"),
    enabled: !!canSee,
  });

  const decideCorrection = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiPost(`/corrections/${id}/${action}`, {}),
    onSuccess: (_data, v) => {
      toast.success(
        v.action === "approve" ? "Correction approved." : "Correction declined.",
      );
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decideLeave = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      apiPost(`/leave/${id}/${action}`, {}),
    onSuccess: (_data, v) => {
      toast.success(
        v.action === "approve" ? "Leave approved." : "Leave declined.",
      );
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
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
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/pin">PIN sign-in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* Live who-is-in board */}
      <Card>
        <CardHeader>
          <CardTitle>On the clock now</CardTitle>
          <CardDescription>Live — refreshes every 15 seconds</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {board.isLoading && <Skeleton className="h-11 w-full" />}
          {board.data?.clockedIn.length === 0 && (
            <div className="flex min-h-11 items-center gap-3">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
              />
              <span className="text-sm text-muted-foreground">
                Nobody clocked in.
              </span>
            </div>
          )}
          {board.data?.clockedIn.map((e) => (
            <LiveRow key={e.entryId} e={e} />
          ))}
        </CardContent>
      </Card>

      {/* Correction approval queue */}
      <Card>
        <CardHeader>
          <CardTitle>Correction requests</CardTitle>
          <CardAction>
            <Badge variant="secondary">
              {corrections.data?.corrections.length ?? 0}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {corrections.isLoading && <Skeleton className="h-20 w-full" />}
          {corrections.data?.corrections.length === 0 && (
            <p className="text-sm text-muted-foreground">None pending.</p>
          )}
          {corrections.data?.corrections.map((cr) => (
            <div
              key={cr.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="text-sm">
                <span className="font-medium">{cr.employeeName}</span>{" "}
                <span className="text-muted-foreground">— {cr.reason}</span>
                <div className="mt-1 text-xs text-muted-foreground">
                  {cr.requested.clockIn && (
                    <>
                      in → {new Date(cr.requested.clockIn).toLocaleString("en-NZ")}
                      {" · "}
                    </>
                  )}
                  {cr.requested.clockOut && (
                    <>
                      out →{" "}
                      {new Date(cr.requested.clockOut).toLocaleString("en-NZ")}
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  disabled={decideCorrection.isPending}
                  onClick={() =>
                    decideCorrection.mutate({ id: cr.id, action: "approve" })
                  }
                >
                  <Check /> Approve
                </Button>
                <Button
                  variant="destructive"
                  disabled={decideCorrection.isPending}
                  onClick={() =>
                    decideCorrection.mutate({ id: cr.id, action: "reject" })
                  }
                >
                  <X /> Decline
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Leave approval queue */}
      <Card>
        <CardHeader>
          <CardTitle>Leave requests</CardTitle>
          <CardAction>
            <Badge variant="secondary">{leave.data?.requests.length ?? 0}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {leave.isLoading && <Skeleton className="h-20 w-full" />}
          {leave.data?.requests.length === 0 && (
            <p className="text-sm text-muted-foreground">None pending.</p>
          )}
          {leave.data?.requests.map((lr) => (
            <div
              key={lr.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="text-sm">
                <span className="font-medium">{lr.employeeName}</span>{" "}
                <span className="capitalize text-muted-foreground">
                  — {lr.type}
                </span>
                <div className="mt-1 text-xs text-muted-foreground">
                  {lr.startDate} → {lr.endDate} ({lr.hours}h)
                  {lr.note ? ` · ${lr.note}` : ""}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  disabled={decideLeave.isPending}
                  onClick={() =>
                    decideLeave.mutate({ id: lr.id, action: "approve" })
                  }
                >
                  <Check /> Approve
                </Button>
                <Button
                  variant="destructive"
                  disabled={decideLeave.isPending}
                  onClick={() =>
                    decideLeave.mutate({ id: lr.id, action: "reject" })
                  }
                >
                  <X /> Decline
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Section links */}
      <Card className="py-1">
        <CardContent className="px-0">
          <Link
            href="/manager/pay-periods"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <CalendarRange className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Pay periods</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
          <Separator />
          <Link
            href="/manager/audit"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <ScrollText className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Audit log</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
