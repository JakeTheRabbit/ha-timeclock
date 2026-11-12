"use client";

import * as React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, MonitorSmartphone, Pencil, Plus, ShieldOff } from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Device {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  boundBy: string | null;
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function DevicesAdminPage() {
  const qc = useQueryClient();
  const loc = useLocale();
  const t = useT();
  const { session, isLoading } = useSession();
  const isAdmin = session?.employee.role === "admin";
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);

  const list = useQuery({
    queryKey: ["admin-devices"],
    queryFn: () => apiGet<{ devices: Device[]; currentDeviceId: string | null }>("/admin/devices"),
    enabled: !!isAdmin,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-devices"] });

  const bind = useMutation({
    mutationFn: () => apiPost("/admin/devices/bind", { name: `Kiosk ${new Date().toISOString().slice(0, 10)}` }),
    onSuccess: () => {
      toast.success(t("devices.bound"));
      refresh();
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });
  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => apiPatch(`/admin/devices/${v.id}`, { name: v.name }),
    onSuccess: () => {
      toast.success(t("devices.renamed"));
      setRenaming(null);
      refresh();
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiPost(`/admin/devices/${id}/revoke`),
    onSuccess: () => {
      toast.success(t("devices.revokedToast"));
      setRevoking(null);
      refresh();
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });
  const testNotify = useMutation({
    mutationFn: () => apiPost<{ sent: string[]; failed: string[] }>("/admin/notify/test"),
    onSuccess: (r) => {
      if (r.failed.length)
        toast.error(
          t("devices.testFailed", { list: r.failed.join(", ") }) +
            (r.sent.length ? ` · ${t("devices.testSentList", { list: r.sent.join(", ") })}` : ""),
        );
      else if (r.sent.length) toast.success(t("devices.testSent", { list: r.sent.join(", ") }));
      else toast.warning(t("devices.noChannel"));
    },
    onError: (e) => toast.error(apiErrorText(e)),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </Container>
    );

  if (!isAdmin)
    return (
      <Container>
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">{t("common.adminRequired")}</p>
          </CardContent>
        </Card>
      </Container>
    );

  const devices = list.data?.devices ?? [];
  const current = list.data?.currentDeviceId ?? null;
  const thisBound = devices.some((d) => d.id === current && d.active);

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MonitorSmartphone className="size-5" aria-hidden="true" /> {t("devices.title")}
          </CardTitle>
          <CardDescription>{t("devices.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Button onClick={() => bind.mutate()} disabled={bind.isPending || thisBound}>
              <Plus /> {thisBound ? t("devices.thisIsBound") : t("devices.bindThis")}
            </Button>
          </div>
          {list.isLoading && <Skeleton className="h-16 w-full" />}
          {list.isSuccess && devices.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("devices.none")}</p>
          )}
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 sm:basis-auto">
                <span className={d.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                  {d.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("devices.lastSeen", { when: d.lastSeenAt ? loc.dateTime(d.lastSeenAt) : t("devices.never") })}
                  {" · "}
                  {d.boundBy
                    ? t("devices.boundOnBy", { date: loc.date(d.createdAt), name: d.boundBy })
                    : t("devices.boundOn", { date: loc.date(d.createdAt) })}
                </span>
              </div>
              {d.id === current && <Badge variant="outline">{t("devices.thisDevice")}</Badge>}
              {d.active ? (
                <StatusBadge status="approved">{t("devices.active")}</StatusBadge>
              ) : (
                <StatusBadge status="cancelled">{t("devices.revoked")}</StatusBadge>
              )}
              <Button variant="ghost" size="sm" onClick={() => setRenaming(d)}>
                <Pencil /> {t("devices.rename")}
              </Button>
              {d.active && (
                <Button variant="secondary" size="sm" onClick={() => setRevoking(d)}>
                  <ShieldOff /> {t("devices.revoke")}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-5" aria-hidden="true" /> {t("devices.notifyTitle")}
          </CardTitle>
          <CardDescription>{t("devices.notifyHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => testNotify.mutate()} disabled={testNotify.isPending}>
            <BellRing /> {t("devices.sendTest")}
          </Button>
        </CardContent>
      </Card>

      {renaming && (
        <RenameDialog
          device={renaming}
          pending={rename.isPending}
          onClose={() => setRenaming(null)}
          onSave={(name) => rename.mutate({ id: renaming.id, name })}
        />
      )}

      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("devices.revokeTitle", { name: revoking?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("devices.revokeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking.id)}
            >
              <ShieldOff /> {t("devices.revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  );
}

function RenameDialog({
  device,
  pending,
  onClose,
  onSave,
}: {
  device: Device;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(device.name);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("devices.renameTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="device-name">{t("jobs.nameField")}</Label>
          <Input id="device-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!name.trim() || pending} onClick={() => onSave(name.trim())}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
