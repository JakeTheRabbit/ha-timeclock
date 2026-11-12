"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CalendarDays, KeyRound, Wallet } from "lucide-react";
import { entriesHref } from "@/lib/links";
import { useT, type MessageKey } from "@/lib/i18n";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface Emp {
  id: string;
  displayName: string;
  role: string;
  active: boolean;
  haUsername: string | null;
  hasPin: boolean;
  notifyService: string | null;
  presenceEntity: string | null;
  accessEntities: string[];
  hourlyRateCents: number | null;
  payTracking: boolean;
}

export interface HaEntities {
  available: boolean;
  presence: { entity_id: string; name: string; state: string }[];
  notify: string[];
}

export const ROLES = ["employee", "lead", "manager", "admin"] as const;

// Radix Select forbids empty-string item values, so the "clear" option uses a
// sentinel that we translate back to "" (server stores that as NULL) on change.
const NONE = "__none__";

/**
 * One person's settings, in three sections: Access (name, role, PIN, HA user,
 * kiosk), Pay (rate, tracking) and Presence (notify, presence entity, door
 * readers). Each field saves on its own, like before; the page owns the
 * mutations so the list and this sheet stay in sync.
 */
export function EmployeeSheet({
  employee: e,
  haEntities,
  onClose,
  onPatch,
  onActive,
  onPin,
  pinPending,
}: {
  employee: Emp | null;
  haEntities: HaEntities | undefined;
  onClose: () => void;
  onPatch: (data: Partial<Emp>) => void;
  onActive: (active: boolean) => void;
  onPin: (pin: string, done: () => void) => void;
  pinPending: boolean;
}) {
  const t = useT();
  const [pin, setPin] = useState("");
  useEffect(() => setPin(""), [e?.id]);
  const manual = haEntities && !haEntities.available;
  const today = new Date().toLocaleDateString("en-CA");

  const savePin = () => {
    if (!/^\d{4,12}$/.test(pin)) {
      toast.error(t("employees.pinFormat"));
      return;
    }
    onPin(pin, () => setPin(""));
  };

  return (
    <Dialog open={!!e} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {e && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar employeeId={e.id} name={e.displayName} size="md" />
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="truncate">{e.displayName}</DialogTitle>
                  <DialogDescription>{t(`role.${e.role}` as MessageKey)}</DialogDescription>
                </div>
                <div className="flex items-center gap-2 pr-6">
                  <Label htmlFor="sheet-active" className="text-xs text-muted-foreground">
                    {e.active ? t("jobs.active") : t("jobs.inactive")}
                  </Label>
                  <Switch id="sheet-active" checked={e.active} onCheckedChange={onActive} />
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href={entriesHref(e.id, today)}>
                  <CalendarDays /> {t("roster.thisWeek")}
                </Link>
              </Button>
              {e.payTracking && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/manager/pay?employeeId=${e.id}`}>
                    <Wallet /> {t("employees.owed")}
                  </Link>
                </Button>
              )}
            </div>

            <Section title={t("employees.sectionAccess")}>
              <Field id="sheet-name" label={t("jobs.nameField")}>
                <TextField
                  id="sheet-name"
                  value={e.displayName}
                  placeholder={t("jobs.nameField")}
                  mono={false}
                  onSave={(v) => (v ? onPatch({ displayName: v }) : toast.error(t("employees.nameEmpty")))}
                />
              </Field>
              <Field id="sheet-role" label={t("employees.role")}>
                <Select value={e.role} onValueChange={(v) => onPatch({ role: v })}>
                  <SelectTrigger id="sheet-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t(`role.${r}` as MessageKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="sheet-ha" label={t("employees.haUser")} hint={t("employees.haUserHint")}>
                <TextField
                  id="sheet-ha"
                  value={e.haUsername}
                  placeholder={t("employees.haUserPlaceholder")}
                  onSave={(v) => onPatch({ haUsername: v || null })}
                />
              </Field>
              <Field
                id="sheet-pin"
                label={e.hasPin ? t("employees.resetPin") : t("me.pin.set")}
                hint={
                  !e.hasPin
                    ? t("employees.pinNone")
                    : e.active
                      ? t("employees.pinSet")
                      : t("employees.pinSetInactive")
                }
              >
                <div className="flex gap-2">
                  <Input
                    id="sheet-pin"
                    value={pin}
                    onChange={(ev) => setPin(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && !pinPending && pin && savePin()}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("employees.pinPlaceholder")}
                  />
                  <Button variant="outline" onClick={savePin} disabled={!pin || pinPending}>
                    <KeyRound /> {t("employees.savePin")}
                  </Button>
                </div>
              </Field>
            </Section>

            <Section title={t("employees.sectionPay")}>
              <Field id="sheet-rate" label={t("employees.hourlyRate")}>
                <TextField
                  id="sheet-rate"
                  value={e.hourlyRateCents == null ? null : (e.hourlyRateCents / 100).toFixed(2)}
                  placeholder={t("employees.ratePlaceholder")}
                  onSave={(v) => {
                    const n = Number(v.replace(/[$,\s]/g, ""));
                    if (v !== "" && (!Number.isFinite(n) || n < 0)) {
                      toast.error(t("employees.rateInvalid"));
                      return;
                    }
                    onPatch({ hourlyRateCents: v === "" ? null : Math.round(n * 100) });
                  }}
                />
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <Label htmlFor="sheet-paytrack" className="flex flex-col items-start gap-1">
                  {t("employees.trackPay")}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("employees.trackPayHint")}
                  </span>
                </Label>
                <Switch
                  id="sheet-paytrack"
                  checked={e.payTracking}
                  onCheckedChange={(v) => onPatch({ payTracking: v })}
                />
              </div>
            </Section>

            <Section title={t("employees.sectionPresence")}>
              <Field id="sheet-notify" label={t("employees.notifyService")}>
                {manual ? (
                  <TextField
                    id="sheet-notify"
                    value={e.notifyService}
                    placeholder="notify.mobile_app_x"
                    onSave={(v) => onPatch({ notifyService: v })}
                  />
                ) : (
                  <Select
                    value={e.notifyService ?? NONE}
                    onValueChange={(v) => onPatch({ notifyService: v === NONE ? "" : v })}
                  >
                    <SelectTrigger id="sheet-notify" className="font-mono">
                      <SelectValue placeholder={t("employees.none")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} className="text-muted-foreground">
                        {t("employees.none")}
                      </SelectItem>
                      {haEntities?.notify.map((n) => (
                        <SelectItem key={n} value={n} className="font-mono">
                          {n}
                        </SelectItem>
                      ))}
                      {/* Keep a stale/custom value selectable so it isn't silently dropped. */}
                      {e.notifyService && !haEntities?.notify.includes(e.notifyService) && (
                        <SelectItem value={e.notifyService} className="font-mono">
                          {e.notifyService}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field id="sheet-presence" label={t("employees.presenceEntity")}>
                {manual ? (
                  <TextField
                    id="sheet-presence"
                    value={e.presenceEntity}
                    placeholder="device_tracker.phone"
                    onSave={(v) => onPatch({ presenceEntity: v })}
                  />
                ) : (
                  <Select
                    value={e.presenceEntity ?? NONE}
                    onValueChange={(v) => onPatch({ presenceEntity: v === NONE ? "" : v })}
                  >
                    <SelectTrigger id="sheet-presence">
                      <SelectValue placeholder={t("employees.none")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE} className="text-muted-foreground">
                        {t("employees.none")}
                      </SelectItem>
                      {haEntities?.presence.map((p) => (
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
                        !haEntities?.presence.some((p) => p.entity_id === e.presenceEntity) && (
                          <SelectItem value={e.presenceEntity}>{e.presenceEntity}</SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <div className="sm:col-span-2">
                <Field id="sheet-access" label={t("employees.doorReaders")} hint={t("employees.doorReadersHint")}>
                  <TextField
                    id="sheet-access"
                    value={e.accessEntities.join(", ")}
                    placeholder="binary_sensor.front_door_rfid_name, …"
                    onSave={(v) =>
                      onPatch({ accessEntities: v.split(",").map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </Field>
              </div>
              {manual && (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {t("employees.manualHint")}
                </p>
              )}
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Text field that saves (trimmed) on blur or Enter when the value changed. */
function TextField({
  id,
  value,
  placeholder,
  onSave,
  mono = true,
}: {
  id: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string) => void;
  mono?: boolean;
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
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") ev.currentTarget.blur();
      }}
      placeholder={placeholder}
      className={mono ? "font-mono" : undefined}
      autoComplete="off"
    />
  );
}
