"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * One status badge for the whole app — one colour per state, readable in both
 * themes (700 text on light, 300 on dark). Label defaults to the translated
 * `status.<state>`; pass children to show something else (a count, a name).
 */
export type Status =
  | "pending"
  | "acknowledged"
  | "disputed"
  | "resolved"
  | "approved"
  | "locked"
  | "paid"
  | "edited"
  | "open"
  | "warning"
  | "flag"
  | "declined"
  | "cancelled"
  | "leave"
  | "holiday";

const TONE: Record<Status, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  acknowledged: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  disputed: "bg-red-500/15 text-red-700 dark:text-red-300",
  resolved: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  locked: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  edited: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  open: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  flag: "bg-red-500/15 text-red-700 dark:text-red-300",
  declined: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground",
  leave: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  holiday: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
};

/** Text-only colour for inline status icons/text outside a badge. */
export const STATUS_TEXT: Record<Status, string> = Object.fromEntries(
  Object.entries(TONE).map(([k, v]) => [k, v.split(" ").filter((c) => !c.startsWith("bg-")).join(" ")]),
) as Record<Status, string>;

const LABEL: Record<Status, MessageKey> = {
  pending: "status.pending",
  acknowledged: "status.acknowledged",
  disputed: "status.disputed",
  resolved: "status.resolved",
  approved: "status.approved",
  locked: "status.locked",
  paid: "status.paid",
  edited: "status.edited",
  open: "status.open",
  warning: "status.warning",
  flag: "status.flag",
  declined: "status.declined",
  cancelled: "status.cancelled",
  leave: "status.leave",
  holiday: "status.holiday",
};

export function StatusBadge({
  status,
  children,
  className,
  ...props
}: { status: Status } & React.ComponentProps<"span">) {
  const t = useT();
  return (
    <Badge className={cn("border-transparent", TONE[status], className)} {...props}>
      {children ?? t(LABEL[status])}
    </Badge>
  );
}
