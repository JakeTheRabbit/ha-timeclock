"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, ChevronDown, KeyRound, TabletSmartphone, UserPlus } from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
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
import { Switch } from "@/components/ui/switch";

interface Emp {
  id: string;
  displayName: string;
  role: string;
  active: boolean;
  haUsername: string | null;
  hasPin: boolean;
  notifyService: string | null;
  presenceEntity: string | null;
}

interface HaEntities {
  available: boolean;
  presence: { entity_id: string; name: string; state: string }[];
  notify: string[];
}

const ROLES = ["employee", "lead", "manager", "admin"] as const;

// Radix Select forbids empty-string item values, so the "clear" option uses a
// sentinel that we translate back to "" (server stores that as NULL) on change.
const NONE = "__none__";

const errMsg = (e: unknown) =>
  e instanceof ApiError ? `Error ${e.status}: ${JSON.stringify(e.body)}` : "Request failed";

export default function EmployeesAdminPage() {
  const qc = useQueryClient();
  const { session, isLoading: sessionLoading } = useSession();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [pin, setPin] = useState("");
  const [pinTarget, setPinTarget] = useState<Emp | null>(null);
  const [newPin, setNewPin] = useState("");

  const list = useQuery({
    queryKey: ["admin-employees"],
    queryFn: () => apiGet<{ employees: Emp[] }>("/admin/employees"),
    enabled: session?.employee.role === "admin",
    retry: false,
  });

  // Fetched once and shared across every employee card's presence pickers.
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
      apiPost("/admin/employees", { displayName: name, role, pin: pin || undefined }),
    onSuccess: () => {
      setName("");
      setPin("");
      toast.success("Employee created.");
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const setEmployeePin = useMutation({
    mutationFn: (vars: { id: string; pin: string }) =>
      apiPost(`/admin/employees/${vars.id}/pin`, { pin: vars.pin }),
    onSuccess: () => {
      toast.success("PIN updated.");
      setPinTarget(null);
      setNewPin("");
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
            <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>
              <UserPlus /> Add employee
            </Button>
          </div>
        </CardContent>
      </Card>

      {list.isLoading && (
        <>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </>
      )}

      {list.data?.employees.length === 0 && (
        <p className="text-sm text-muted-foreground">No employees yet.</p>
      )}

      {list.data?.employees.map((e) => (
        <Card key={e.id} className={cn(!e.active && "opacity-60")}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar employeeId={e.id} name={e.displayName} size="sm" />
                <span className="truncate font-medium">{e.displayName}</span>
                <Badge variant={e.hasPin ? "secondary" : "outline"}>
                  {e.hasPin ? "PIN set" : "No PIN"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`active-${e.id}`}
                  className="text-xs text-muted-foreground"
                >
                  {e.active ? "Active" : "Inactive"}
                </Label>
                <Switch
                  id={`active-${e.id}`}
                  checked={e.active}
                  onCheckedChange={(checked) =>
                    toggleActive.mutate({ id: e.id, active: checked })
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={`role-${e.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Role
                </Label>
                <Select
                  value={e.role}
                  onValueChange={(v) => patch.mutate({ id: e.id, data: { role: v } })}
                >
                  <SelectTrigger id={`role-${e.id}`} className="capitalize">
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
                <Label
                  htmlFor={`ha-${e.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Home Assistant username
                </Label>
                <HaUsernameField
                  id={`ha-${e.id}`}
                  employee={e}
                  onSave={(haUsername) =>
                    patch.mutate({ id: e.id, data: { haUsername } })
                  }
                />
              </div>
            </div>
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  setNewPin("");
                  setPinTarget(e);
                }}
              >
                <KeyRound /> Set PIN
              </Button>
            </div>

            <details className="group rounded-md border border-border">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                <BellRing className="size-4" />
                Presence reminders
                <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-3 border-t border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`notify-${e.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Notify service
                    </Label>
                    {haEntities.data && !haEntities.data.available ? (
                      <FreeTextField
                        id={`notify-${e.id}`}
                        value={e.notifyService}
                        placeholder="notify.mobile_app_x"
                        onSave={(v) =>
                          patch.mutate({ id: e.id, data: { notifyService: v } })
                        }
                      />
                    ) : (
                      <Select
                        value={e.notifyService ?? NONE}
                        onValueChange={(v) =>
                          patch.mutate({
                            id: e.id,
                            data: { notifyService: v === NONE ? "" : v },
                          })
                        }
                      >
                        <SelectTrigger id={`notify-${e.id}`} className="font-mono">
                          <SelectValue placeholder="— none —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE} className="text-muted-foreground">
                            — none —
                          </SelectItem>
                          {haEntities.data?.notify.map((n) => (
                            <SelectItem key={n} value={n} className="font-mono">
                              {n}
                            </SelectItem>
                          ))}
                          {/* Keep a stale/custom value selectable so it isn't silently dropped. */}
                          {e.notifyService &&
                            !haEntities.data?.notify.includes(e.notifyService) && (
                              <SelectItem
                                value={e.notifyService}
                                className="font-mono"
                              >
                                {e.notifyService}
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`presence-${e.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Presence entity
                    </Label>
                    {haEntities.data && !haEntities.data.available ? (
                      <FreeTextField
                        id={`presence-${e.id}`}
                        value={e.presenceEntity}
                        placeholder="device_tracker.phone"
                        onSave={(v) =>
                          patch.mutate({ id: e.id, data: { presenceEntity: v } })
                        }
                      />
                    ) : (
                      <Select
                        value={e.presenceEntity ?? NONE}
                        onValueChange={(v) =>
                          patch.mutate({
                            id: e.id,
                            data: { presenceEntity: v === NONE ? "" : v },
                          })
                        }
                      >
                        <SelectTrigger id={`presence-${e.id}`}>
                          <SelectValue placeholder="— none —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE} className="text-muted-foreground">
                            — none —
                          </SelectItem>
                          {haEntities.data?.presence.map((p) => (
                            <SelectItem key={p.entity_id} value={p.entity_id}>
                              <span className="flex flex-col items-start">
                                <span>{p.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {p.entity_id} · {p.state}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                          {e.presenceEntity &&
                            !haEntities.data?.presence.some(
                              (p) => p.entity_id === e.presenceEntity,
                            ) && (
                              <SelectItem value={e.presenceEntity}>
                                {e.presenceEntity}
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                {haEntities.data && !haEntities.data.available && (
                  <p className="text-xs text-muted-foreground">
                    HA discovery is unavailable — enter the notify service and
                    presence entity IDs manually.
                  </p>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      ))}

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

      <Dialog
        open={!!pinTarget}
        onOpenChange={(open) => {
          if (!open) {
            setPinTarget(null);
            setNewPin("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set PIN</DialogTitle>
            <DialogDescription>
              New PIN for {pinTarget?.displayName ?? "employee"} (4–12 digits).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-pin-input">PIN</Label>
            <Input
              id="set-pin-input"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPin && pinTarget && !setEmployeePin.isPending) {
                  setEmployeePin.mutate({ id: pinTarget.id, pin: newPin });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setPinTarget(null);
                setNewPin("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                pinTarget && setEmployeePin.mutate({ id: pinTarget.id, pin: newPin })
              }
              disabled={!newPin || setEmployeePin.isPending}
            >
              Save PIN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  );
}

/** Inline-editable HA username; PATCHes on blur or Enter when the value changed. */
function HaUsernameField({
  id,
  employee,
  onSave,
}: {
  id: string;
  employee: Emp;
  onSave: (haUsername: string | null) => void;
}) {
  const [value, setValue] = useState(employee.haUsername ?? "");

  useEffect(() => {
    setValue(employee.haUsername ?? "");
  }, [employee.haUsername]);

  const commit = () => {
    const next = value.trim() || null;
    if (next === (employee.haUsername ?? null)) return;
    onSave(next);
  };

  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="HA username"
      className="font-mono"
      autoComplete="off"
    />
  );
}

/**
 * Free-text fallback for a presence mapping when HA discovery is unavailable.
 * Commits on blur / Enter; empty string clears the mapping (server -> NULL).
 */
function FreeTextField({
  id,
  value,
  placeholder,
  onSave,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    onSave(next);
  };

  return (
    <Input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder={placeholder}
      className="font-mono"
      autoComplete="off"
    />
  );
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}
