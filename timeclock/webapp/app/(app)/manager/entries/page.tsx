"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { EditEntryDialog, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const FLAG_LABELS: Record<string, string> = {
  no_door_access: "No door swipe",
  offline_queued: "Offline punch",
};

const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

/** Manager edit screen: any employee's last 14 days, edited directly (audited). */
export default function ManagerEntriesPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);

  const { from, to } = useMemo(
    () => ({ from: new Date(Date.now() - 14 * 86400_000), to: new Date(Date.now() + 86400_000) }),
    [],
  );
  const people = useQuery({
    queryKey: ["manager-employees"],
    queryFn: () => apiGet<{ employees: { id: string; displayName: string; active: boolean }[] }>("/manager/employees"),
    enabled: !!canSee,
  });
  const list = useQuery({
    queryKey: ["manager-entries", employeeId],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/manager/entries?employeeId=${employeeId}&from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    enabled: !!employeeId,
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

  const entries = list.data?.entries ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
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

      {employeeId && list.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}
      {employeeId && !list.isLoading && entries.length === 0 && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-muted-foreground">No entries in the last 14 days.</CardContent>
        </Card>
      )}

      {entries.map((e) => (
        <Card key={e.id}>
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{loc.date(e.clockIn)}</span>
              {e.edited && <Badge className="border-transparent bg-amber-500/15 text-amber-300">Edited</Badge>}
              {e.paidAt && <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>}
              {e.fraudFlags.map((f) => (
                <Badge key={f} className="border-transparent bg-destructive/15 text-destructive">
                  {FLAG_LABELS[f] ?? f}
                </Badge>
              ))}
              <span className="ml-auto font-mono text-sm">{hrs(e.workedMinutes)}</span>
            </div>
            <div className="font-mono text-sm text-muted-foreground">
              {loc.time(e.clockIn)} → {e.clockOut ? loc.time(e.clockOut) : "still clocked in"}
              {e.breaks.length > 0 && ` · ${e.breaks.length} break${e.breaks.length > 1 ? "s" : ""}`}
            </div>
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setEditing(e)}>
              <Pencil /> Edit
            </Button>
          </CardContent>
        </Card>
      ))}

      {editing && (
        <EditEntryDialog
          entry={editing}
          mode="manager"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["manager-entries"] });
          }}
        />
      )}
    </div>
  );
}
