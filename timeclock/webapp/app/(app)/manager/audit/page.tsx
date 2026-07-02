"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Badge } from "@/components/ui/badge";
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
  "employee",
  "correction",
  "leave_request",
  "leave_ledger",
  "roster",
  "pay_period",
  "device",
  "settings",
  "job",
];

interface AuditRow {
  id: number;
  createdAt: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  hash: string;
}

export default function AuditPage() {
  const { session, isLoading } = useSession();
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
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
  const rows = useQuery({
    queryKey: ["audit-rows", entityType],
    queryFn: () =>
      apiGet<{ rows: AuditRow[] }>(
        `/manager/audit?limit=200${entityType ? `&entityType=${entityType}` : ""}`,
      ),
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

  // Client-side text filter over the fetched page of rows.
  const needle = search.trim().toLowerCase();
  const visible = (rows.data?.rows ?? []).filter(
    (r) =>
      !needle ||
      r.action.toLowerCase().includes(needle) ||
      r.entityType.toLowerCase().includes(needle) ||
      r.entityId.toLowerCase().includes(needle) ||
      (r.reason ?? "").toLowerCase().includes(needle) ||
      (r.actorId ?? "").toLowerCase().includes(needle),
  );

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

      {/* Filter row */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value={entityType || "all"}
          onValueChange={(v) => setEntityType(v === "all" ? "" : v)}
        >
          <SelectTrigger className="sm:w-52" aria-label="Filter by entity type">
            <SelectValue placeholder="All entities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter entries…"
            className="pl-9"
            aria-label="Filter entries"
          />
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
        {!rows.isLoading && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No matching audit entries.
          </p>
        )}
        {visible.map((r) => (
          <details
            key={r.id}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <summary className="flex min-h-8 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="font-mono text-xs text-muted-foreground">
                #{r.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("en-NZ")}
              </span>
              <span className="font-medium">{r.entityType}</span>
              <span className="text-primary">{r.action}</span>
              {r.reason && (
                <span className="text-muted-foreground">— {r.reason}</span>
              )}
            </summary>
            <div className="mt-2 grid gap-1 break-all font-mono text-xs text-muted-foreground">
              <div>entity: {r.entityId}</div>
              {r.actorId && <div>actor: {r.actorId}</div>}
              {r.oldValue && (
                <div className="text-destructive/80">old: {r.oldValue}</div>
              )}
              {r.newValue && (
                <div className="text-emerald-300/80">new: {r.newValue}</div>
              )}
              <div>hash: {r.hash.slice(0, 16)}…</div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
