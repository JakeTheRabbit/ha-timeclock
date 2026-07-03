"use client";

import * as React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Briefcase, Pencil, Plus } from "lucide-react";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useT } from "@/lib/i18n";
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
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Job {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function JobsAdminPage() {
  const qc = useQueryClient();
  const t = useT();
  const { session, isLoading } = useSession();
  const isAdmin = session?.employee.role === "admin";

  const [form, setForm] = useState({ name: "", code: "" });
  const [editing, setEditing] = useState<Job | null>(null);

  const list = useQuery({
    queryKey: ["admin-jobs"],
    queryFn: () => apiGet<{ jobs: Job[] }>("/admin/jobs"),
    enabled: !!isAdmin,
  });

  const errMsg = (e: unknown) =>
    e instanceof ApiError
      ? ((e.body as { error?: string })?.error ?? t("toast.errorStatus", { status: e.status }))
      : t("toast.requestFailed");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    qc.invalidateQueries({ queryKey: ["clock-jobs"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost("/admin/jobs", { name: form.name.trim(), code: form.code.trim() || null }),
    onSuccess: () => {
      toast.success(t("toast.jobAdded"));
      setForm({ name: "", code: "" });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Partial<Pick<Job, "name" | "code" | "active">> }) =>
      apiPatch(`/admin/jobs/${vars.id}`, vars.data),
    onSuccess: () => {
      toast.success(t("toast.jobUpdated"));
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
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

  return (
    <Container>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="size-5" aria-hidden="true" /> {t("jobs.addTitle")}
          </CardTitle>
          <CardDescription>{t("jobs.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-40 flex-1 flex-col gap-2">
              <Label htmlFor="job-name">{t("jobs.nameField")}</Label>
              <Input
                id="job-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex w-40 flex-col gap-2">
              <Label htmlFor="job-code">{t("jobs.codeField")}</Label>
              <Input
                id="job-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              <Plus /> {t("jobs.add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("jobs.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {list.data?.jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("jobs.empty")}</p>
          )}
          {list.data?.jobs.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={j.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                  {j.name}
                </span>
                {j.code && (
                  <span className="font-mono text-xs text-muted-foreground">{j.code}</span>
                )}
              </div>
              <Badge variant={j.active ? "default" : "secondary"}>
                {j.active ? t("jobs.active") : t("jobs.inactive")}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setEditing(j)}>
                <Pencil /> {t("jobs.edit")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={patch.isPending}
                onClick={() => patch.mutate({ id: j.id, data: { active: !j.active } })}
              >
                {j.active ? t("jobs.deactivate") : t("jobs.activate")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && (
        <EditJobDialog
          job={editing}
          pending={patch.isPending}
          onClose={() => setEditing(null)}
          onSave={(data) => patch.mutate({ id: editing.id, data })}
        />
      )}
    </Container>
  );
}

function EditJobDialog({
  job,
  pending,
  onClose,
  onSave,
}: {
  job: Job;
  pending: boolean;
  onClose: () => void;
  onSave: (data: { name: string; code: string | null }) => void;
}) {
  const t = useT();
  const [name, setName] = useState(job.name);
  const [code, setCode] = useState(job.code ?? "");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("jobs.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-job-name">{t("jobs.nameField")}</Label>
            <Input id="edit-job-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-job-code">{t("jobs.codeField")}</Label>
            <Input id="edit-job-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!name.trim() || pending}
            onClick={() => onSave({ name: name.trim(), code: code.trim() || null })}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
