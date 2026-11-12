"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, TriangleAlert } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { useLocale } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { exportFormats, type ExportFormat, type PayrollAdapter } from "@/lib/exports";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Pay-period exports: primary "Payroll export" through the configured adapter
 * (settings.payroll.adapter), other formats in a menu, a confirm step when the
 * period isn't locked yet, and the last-export stamp from the audit log.
 */
export function ExportMenu({ period }: { period: { id: string; lockedAt: string | null } }) {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);
  const [confirm, setConfirm] = useState<ExportFormat | null>(null);

  const adapters = useQuery({
    queryKey: ["report-adapters"],
    queryFn: () => apiGet<{ adapters: PayrollAdapter[]; configured?: string }>("/reports/adapters"),
    staleTime: 5 * 60_000,
  });
  const last = useQuery({
    queryKey: ["last-export", period.id],
    queryFn: () =>
      apiGet<{ lastExport: { at: string; by: string | null; format: string | null } | null }>(
        `/reports/last-export?periodId=${period.id}`,
      ),
  });

  const list = adapters.data?.adapters ?? [];
  const { primary, others } = exportFormats(period.id, list, adapters.data?.configured);
  const href = (f: ExportFormat) => `${BASE}/api${f.path}`;
  // Translated name for a format id (same ids as lib/exports).
  const labelOf = (id: string | null) => {
    if (!id) return t("export.export");
    if (id === "timesheet.csv") return t("export.timesheetCsv");
    if (id === "timesheet.pdf") return t("export.timesheetPdf");
    return t("export.payrollFormat", { name: list.find((a) => a.id === id)?.label ?? id });
  };

  // Downloads are plain navigations (no callback) — refresh the stamp shortly after.
  const exported = () => {
    setMoreOpen(false);
    setTimeout(() => qc.invalidateQueries({ queryKey: ["last-export", period.id] }), 1500);
  };
  const onPick = (f: ExportFormat) => (e: MouseEvent) => {
    if (!period.lockedAt) {
      e.preventDefault();
      setMoreOpen(false);
      setConfirm(f);
      return;
    }
    exported();
  };

  const stamp = last.data?.lastExport;

  return (
    <>
      <div className="flex items-center">
        <Button asChild className="rounded-r-none">
          <a href={href(primary)} onClick={onPick(primary)}>
            <Download /> {t("export.payroll")}
          </a>
        </Button>
        <div className="relative" ref={menuRef}>
          <Button
            variant="default"
            size="icon"
            className="rounded-l-none border-l border-primary-foreground/20"
            aria-label={t("export.more")}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <ChevronDown />
          </Button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1 flex min-w-48 flex-col rounded-md border border-border bg-popover p-1 shadow-md"
            >
              {others.map((f) => (
                <a
                  key={f.id}
                  role="menuitem"
                  href={href(f)}
                  onClick={onPick(f)}
                  className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
                >
                  <Download className="size-4" aria-hidden="true" /> {labelOf(f.id)}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground">
        {stamp
          ? `${stamp.by ? t("export.lastBy", { when: loc.dateTime(stamp.at), by: stamp.by }) : t("export.last", { when: loc.dateTime(stamp.at) })} · ${labelOf(stamp.format)}`
          : last.isSuccess
            ? t("export.never")
            : null}
      </span>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-500 dark:text-amber-400" aria-hidden="true" /> {t("export.notLocked")}
            </DialogTitle>
            <DialogDescription>
              {t("export.notLockedBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("common.cancel")}</Button>
            </DialogClose>
            {confirm && (
              <Button asChild variant="secondary">
                <a
                  href={href(confirm)}
                  onClick={() => {
                    setConfirm(null);
                    exported();
                  }}
                >
                  <Download /> {t("export.anyway", { name: labelOf(confirm.id) })}
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
