"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Search, TabletSmartphone, UserPlus } from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { filterEmployees } from "@/lib/employee-list";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { EmployeeSheet, ROLES, type Emp, type HaEntities } from "@/components/admin/employee-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Readable error; names the rejected fields when the server lists them. */
const errMsg = (e: unknown) => {
  const fields =
    e instanceof ApiError
      ? Object.keys((e.body as { detail?: { fieldErrors?: object } } | null)?.detail?.fieldErrors ?? {})
      : [];
  return apiErrorText(e) + (fields.length ? ` (${fields.join(", ")})` : "");
};

export default function EmployeesAdminPage() {
  const qc = useQueryClient();
  const { session, isLoading: sessionLoading } = useSession();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin-employees"],
    queryFn: () => apiGet<{ employees: Emp[] }>("/admin/employees"),
    enabled: session?.employee.role === "admin",
    retry: false,
  });

  // Fetched once and shared by the detail sheet's presence pickers.
  const haEntities = useQuery({
    queryKey: ["ha-entities"],
    queryFn: () => apiGet<HaEntities>("/admin/ha-entities"),
    enabled: session?.employee.role === "admin",
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-employees"] });
    qc.invalidateQueries({ queryKey: ["kiosk-employees"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ employee: { id: string } }>("/admin/employees", {
        displayName: name,
        role,
        pin: pin || undefined,
      }),
    onSuccess: (res) => {
      setName("");
      setPin("");
      toast.success("Employee created.");
      refresh();
      setOpenId(res.employee.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const setEmployeePin = useMutation({
    mutationFn: (vars: { id: string; pin: string; done: () => void }) =>
      apiPost(`/admin/employees/${vars.id}/pin`, { pin: vars.pin }),
    onSuccess: (_res, vars) => {
      toast.success("PIN updated.");
      vars.done();
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Partial<Emp> }) =>
      apiPatch(`/admin/employees/${vars.id}`, vars.data),
    onSuccess: () => {
      toast.success("Saved.");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  // Optimistic: flip the switch immediately, roll back + toast on failure.
  const toggleActive = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiPatch(`/admin/employees/${vars.id}`, { active: vars.active }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["admin-employees"] });
      const previous = qc.getQueryData<{ employees: Emp[] }>(["admin-employees"]);
      qc.setQueryData<{ employees: Emp[] }>(["admin-employees"], (old) =>
        old
          ? {
              employees: old.employees.map((e) =>
                e.id === vars.id ? { ...e, active: vars.active } : e,
              ),
            }
          : old,
      );
      return { previous };
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.active ? "Employee activated." : "Employee deactivated.");
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["admin-employees"], ctx.previous);
      toast.error(errMsg(e));
    },
    onSettled: refresh,
  });

  const bindDevice = useMutation({
    mutationFn: () =>
      apiPost("/admin/devices/bind", {
        name: `Kiosk ${new Date().toISOString().slice(0, 10)}`,
      }),
    onSuccess: () => toast.success("This device is now a bound kiosk."),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (sessionLoading)
    return (
      <Container>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </Container>
    );

  if (!session)
    return (
      <Container>
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Not signed in. Sign in as an admin from the PIN screen.
            </p>
            <Button asChild variant="secondary">
              <Link href="/pin">Go to PIN screen</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );

  if (session.employee.role !== "admin")
    return (
      <Container>
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">
              Forbidden — admin role required (you are {session.employee.role}).
            </p>
          </CardContent>
        </Card>
      </Container>
    );

  const all = list.data?.employees ?? [];
  const shown = filterEmployees(all, tab, query);
  const activeCount = all.filter((e) => e.active).length;
  const open = all.find((e) => e.id === openId) ?? null;

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle>Add employee</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem_8rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-emp-name">Name</Label>
              <Input
                id="new-emp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-emp-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="new-emp-role" className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-emp-pin">PIN (optional)</Label>
              <Input
                id="new-emp-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </div>
          <div>
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              <UserPlus /> Add employee
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "inactive")}>
              <TabsList>
                <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
                <TabsTrigger value="inactive">Inactive ({all.length - activeCount})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative sm:ml-auto sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, role, HA user"
                aria-label="Search employees"
                className="pl-9"
                autoComplete="off"
              />
            </div>
          </div>

          {list.isLoading && (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          )}
          {list.isError && <p className="text-sm text-destructive">{errMsg(list.error)}</p>}
          {list.data && shown.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {all.length === 0
                ? "No employees yet."
                : query
                  ? "Nobody matches that search."
                  : tab === "active"
                    ? "Nobody is active."
                    : "Nobody is inactive."}
            </p>
          )}

          <ul className="-mx-2 flex flex-col">
            {shown.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(e.id)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    !e.active && "opacity-60",
                  )}
                >
                  <Avatar employeeId={e.id} name={e.displayName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.displayName}</span>
                    {e.haUsername && (
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {e.haUsername}
                      </span>
                    )}
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {e.role}
                  </Badge>
                  {!e.hasPin && <Badge variant="outline">No PIN</Badge>}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs text-muted-foreground">
          Registers this browser or tablet as a kiosk device.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => bindDevice.mutate()}
          disabled={bindDevice.isPending}
        >
          <TabletSmartphone /> Bind this device as kiosk
        </Button>
      </div>

      <EmployeeSheet
        employee={open}
        haEntities={haEntities.data}
        onClose={() => setOpenId(null)}
        onPatch={(data) => open && patch.mutate({ id: open.id, data })}
        onActive={(active) => open && toggleActive.mutate({ id: open.id, active })}
        onPin={(p, done) => open && setEmployeePin.mutate({ id: open.id, pin: p, done })}
        pinPending={setEmployeePin.isPending}
      />
    </Container>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}
