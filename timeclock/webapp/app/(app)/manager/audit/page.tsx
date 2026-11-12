"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { actionLabel, diffFields, entityLabel, formatValue, humanise } from "@/lib/audit";
import { entriesHref } from "@/lib/links";
import { tzOffset } from "@/lib/tz";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ENTITY_TYPES = [
  "time_entry",
  "break",
  "modification",
  "day",
  "correction",
  "employee",
  "leave_request",
  "leave_ledger",
  "roster",
  "pay_period",
  "bonus",
  "device",
  "settings",
  "job",
];
const PAGE = 50;

interface AuditRow {
  id: number;
  createdAt: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  day: string | null;
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  hash: string;
}

/** Facility-local midnight of a YYYY-MM-DD day, as an ISO instant. */
const midnightIso = (day: string) =>
  new Date(`${day}T00:00:00${tzOffset(new Date(`${day}T12:00:00Z`))}`).toISOString();
const addDay = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export default function AuditPage() {
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const [entityType, setEntityType] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const canSee =
    session && ["lead", "manager", "admin"].includes(session.employee.role);

  const verify = useQuery({
    queryKey: ["audit-verify"],
    queryFn: () =>
      apiGet<{ ok: boolean; broken_at: number | null; detail: string }>(
        "/manager/audit/verify",
      ),
    enabled: !!canSee,
  });
  const people = useQuery({
    queryKey: ["manager-employees"],
    queryFn: () =>
      apiGet<{ employees: { id: string; displayName: string; active: boolean }[] }>("/manager/employees"),
    enabled: !!canSee,
  });
  const rows = useInfiniteQuery({
    queryKey: ["audit-rows", entityType, employeeId, from, to, q],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (entityType) p.set("entityType", entityType);
      if (employeeId) p.set("employeeId", employeeId);
      if (from) p.set("from", midnightIso(from));
      if (to) p.set("to", midnightIso(addDay(to)));
      if (q) p.set("q", q);
      if (pageParam) p.set("before", String(pageParam));
      return apiGet<{ rows: AuditRow[]; nextCursor: number | null }>(`/manager/audit?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!canSee,
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

  const visible = rows.data?.pages.flatMap((p) => p.rows) ?? [];
  const filtered = !!(entityType || employeeId || from || to || q);
  const fmt = { dateTime: (v: string) => loc.dateTime(v), money: (n: number) => loc.money(n) };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* Chain verification status */}
      {verify.data &&
        (verify.data.ok ? (
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 [&>svg]:size-4"
          >
            <ShieldCheck /> Hash chain intact
          </Badge>
        ) : (
          <Badge
            variant="destructive"
            className="gap-1.5 px-3 py-1.5 text-sm [&>svg]:size-4"
          >
            <ShieldAlert /> CHAIN BROKEN at #{verify.data.broken_at}
          </Badge>
        ))}

      {/* Filter rows (all applied server-side) */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select
            value={entityType || "all"}
            onValueChange={(v) => setEntityType(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-full" aria-label="Filter by type">
              <SelectValue placeholder="Everything" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {entityLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={employeeId || "all"}
            onValueChange={(v) => setEmployeeId(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-full" aria-label="Filter by person">
              <SelectValue placeholder="Everyone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {(people.data?.employees ?? []).map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.displayName}
                  {!e.active && " (inactive)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From day"
              className="w-full sm:w-40"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To day"
              className="w-full sm:w-40"
            />
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action, reason, name…"
              className="pl-9"
              aria-label="Search audit log"
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEntityType("");
                setEmployeeId("");
                setFrom("");
                setTo("");
                setSearch("");
              }}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Entries */}
      <div className="flex flex-col gap-1.5">
        {rows.isLoading && (
          <>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </>
        )}
        {rows.isError && (
          <p className="py-6 text-center text-sm text-destructive">{apiErrorText(rows.error)}</p>
        )}
        {!rows.isLoading && !rows.isError && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No matching audit entries.
          </p>
        )}
        {visible.map((r) => {
          const changes = diffFields(r.oldValue, r.newValue);
          return (
            <details
              key={r.id}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <summary className="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-xs text-muted-foreground">
                  {loc.dateTime(r.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-medium">{r.actorName ?? (r.actorId ? "Unknown" : "System")}</span>
                <span className="text-primary">{actionLabel(r.action)}</span>
                <span className="text-muted-foreground">·</span>
                <span>{entityLabel(r.entityType)}</span>
                {r.subjectName && r.subjectId !== r.actorId && (
                  <span className="text-muted-foreground">for {r.subjectName}</span>
                )}
                {r.subjectId && r.day && (
                  <Link
                    href={entriesHref(r.subjectId, r.day)}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {loc.date(`${r.day}T12:00:00Z`, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })} →
                  </Link>
                )}
                {r.reason && (
                  <span className="w-full text-muted-foreground">“{r.reason}”</span>
                )}
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {changes.length > 0 ? (
                  <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
                    {changes.map((c) => (
                      <div key={c.field} className="contents">
                        <dt className="text-muted-foreground">{humanise(c.field)}</dt>
                        <dd className="break-words">
                          {r.oldValue != null && (
                            <span className="text-destructive/80 line-through decoration-1">
                              {formatValue(c.before, c.field, fmt)}
                            </span>
                          )}
                          {r.oldValue != null && r.newValue != null && (
                            <span className="text-muted-foreground"> ⇒ </span>
                          )}
                          {r.newValue != null && (
                            <span className="text-emerald-300/90">{formatValue(c.after, c.field, fmt)}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">No field changes recorded.</p>
                )}
                <div className="break-all font-mono text-[11px] text-muted-foreground">
                  #{r.id} · {r.entityType} {r.entityId} · hash {r.hash.slice(0, 16)}…
                </div>
              </div>
            </details>
          );
        })}
        {rows.hasNextPage && (
          <Button
            variant="secondary"
            className="self-center"
            disabled={rows.isFetchingNextPage}
            onClick={() => rows.fetchNextPage()}
          >
            {rows.isFetchingNextPage ? "Loading…" : "Load older"}
          </Button>
        )}
      </div>
    </div>
  );
}
