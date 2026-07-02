"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

interface Shift {
  id: string;
  employeeId: string;
  employeeName?: string;
  shiftDate: string;
  startMin: number;
  endMin: number;
  note: string | null;
}
interface Compare {
  date: string;
  shifts: {
    rosterId: string;
    employeeName: string;
    startMin: number;
    endMin: number;
    status: "ok" | "late" | "no_show" | "in_progress" | "upcoming";
    lateMin: number;
    actualIn: string | null;
  }[];
}
interface Emp { id: string; displayName: string }

const t = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

const STATUS_BADGE: Record<Compare["shifts"][number]["status"], string> = {
  ok: "border-transparent bg-emerald-500/15 text-emerald-300",
  in_progress: "border-transparent bg-sky-500/15 text-sky-300",
  upcoming: "border-transparent bg-secondary text-secondary-foreground",
  late: "border-transparent bg-amber-500/15 text-amber-300",
  no_show: "border-transparent bg-rose-500/15 text-rose-300",
};

const errMsg = (e: unknown) =>
  e instanceof ApiError
    ? ((e.body as { error?: string })?.error ?? `Error ${e.status}`)
    : "Request failed";

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function RosterPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const isLead = session && ["lead", "manager", "admin"].includes(session.employee.role);
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({ employeeId: "", start: "08:00", end: "16:30" });
  const [cancelTarget, setCancelTarget] = useState<Shift | null>(null);

  const week = useMemo(() => {
    const from = new Date(date + "T00:00:00");
    const to = new Date(from.getTime() + 6 * 86_400_000);
    return { from: date, to: to.toISOString().slice(0, 10) };
  }, [date]);

  const shiftWeek = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toLocaleDateString("en-CA"));
  };

  const mine = useQuery({
    queryKey: ["roster-mine", week.from],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster/mine?from=${week.from}&to=${week.to}`),
    enabled: !!session && !isLead,
  });
  const all = useQuery({
    queryKey: ["roster-all", week.from],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster?from=${week.from}&to=${week.to}`),
    enabled: !!isLead,
  });
  const compare = useQuery({
    queryKey: ["roster-compare", date],
    queryFn: () => apiGet<Compare>(`/roster/compare?date=${date}`),
    enabled: !!isLead,
    refetchInterval: 30_000,
  });
  const staff = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: () => apiGet<{ employees: Emp[] }>("/auth/kiosk-employees"),
    enabled: !!isLead,
  });

  const toMin = (hhmm: string) => {
    const [hh, mm] = hhmm.split(":").map(Number);
    return hh * 60 + (mm || 0);
  };

  const add = useMutation({
    mutationFn: () =>
      apiPost("/roster", {
        employeeId: form.employeeId,
        shiftDate: date,
        startMin: toMin(form.start),
        endMin: toMin(form.end),
      }),
    onSuccess: () => {
      toast.success("Shift added.");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/roster/${id}/cancel`),
    onSuccess: () => {
      toast.success("Shift cancelled.");
      setCancelTarget(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
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

  const shifts = (isLead ? all.data?.shifts : mine.data?.shifts) ?? [];

  return (
    <Container>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(-7)} aria-label="Previous week">
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
          aria-label="Week starting date"
        />
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(7)} aria-label="Next week">
          <ChevronRight />
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">week of {week.from}</span>
      </div>

      {isLead && (
        <Card>
          <CardHeader>
            <CardTitle>Add shift · {date}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2 sm:col-span-3">
                <Label htmlFor="shift-employee">Employee</Label>
                <Select
                  value={form.employeeId}
                  onValueChange={(v) => setForm({ ...form, employeeId: v })}
                >
                  <SelectTrigger id="shift-employee">
                    <SelectValue placeholder="Choose employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.data?.employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shift-start">Start</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shift-end">End</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => add.mutate()}
                  disabled={!form.employeeId || add.isPending}
                >
                  <CalendarPlus /> {add.isPending ? "Adding…" : "Add shift"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLead && compare.data && compare.data.shifts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled vs actual · {date}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {compare.data.shifts.map((s) => (
              <div key={s.rosterId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="font-medium">{s.employeeName}</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {t(s.startMin)}–{t(s.endMin)}
                </span>
                <span className="font-mono text-sm text-muted-foreground">
                  {s.actualIn
                    ? `in ${new Date(s.actualIn).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`
                    : "no punch"}
                </span>
                <Badge variant="secondary" className={cn("ml-auto capitalize", STATUS_BADGE[s.status])}>
                  {s.status.replace("_", " ")}
                  {s.lateMin > 0 && ` +${s.lateMin}m`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isLead ? "All shifts this week" : "My shifts this week"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {(isLead ? all.isLoading : mine.isLoading) && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          )}
          {shifts.length === 0 && !(isLead ? all.isLoading : mine.isLoading) && (
            <p className="py-1 text-sm text-muted-foreground">No shifts.</p>
          )}
          {shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                <span className="font-mono text-muted-foreground">{s.shiftDate}</span>
                <span className="font-mono">
                  {t(s.startMin)}–{t(s.endMin)}
                </span>
                {isLead && <span className="font-medium">{s.employeeName}</span>}
                {s.note && <span className="text-muted-foreground">· {s.note}</span>}
              </div>
              {isLead && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setCancelTarget(s)}
                  disabled={cancel.isPending}
                  aria-label="Cancel shift"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Confirm before destroying a shift — a single stray tap should never
          cancel someone's roster. */}
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this shift?</DialogTitle>
            <DialogDescription>
              {cancelTarget && (
                <>
                  {cancelTarget.employeeName ? `${cancelTarget.employeeName} · ` : ""}
                  {cancelTarget.shiftDate} · {t(cancelTarget.startMin)}–
                  {t(cancelTarget.endMin)}. This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              Keep shift
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancelTarget && cancel.mutate(cancelTarget.id)}
            >
              <Trash2 /> {cancel.isPending ? "Cancelling…" : "Cancel shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  );
}
