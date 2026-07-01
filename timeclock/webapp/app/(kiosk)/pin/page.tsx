"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { PinPad } from "@/components/kiosk/PinPad";
import { useSession, type SessionEmployee } from "@/hooks/use-session";

interface KioskEmployees {
  employees: { id: string; displayName: string }[];
}
interface Whoami {
  ha: { haUserId: string; displayName: string | null } | null;
  employee: { id: string; displayName: string; role: string } | null;
}

export default function PinPage() {
  const qc = useQueryClient();
  const { session } = useSession();
  const [selected, setSelected] = useState<{ id: string; displayName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: () => apiGet<KioskEmployees>("/auth/kiosk-employees"),
  });
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<Whoami>("/auth/whoami"),
  });

  const claim = useMutation({
    mutationFn: () => apiPost<{ claimed: boolean }>("/auth/claim-admin"),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => setError(e instanceof ApiError ? `Claim failed (${e.status})` : "Claim failed"),
  });

  const login = useMutation({
    mutationFn: (vars: { employeeId: string; pin: string }) =>
      apiPost<{ ok: boolean; employee: SessionEmployee }>("/auth/pin-login", vars),
    onSuccess: () => {
      setError(null);
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | null)?.error;
        setError(
          code === "rate_limited"
            ? "Too many attempts — wait a minute."
            : code === "device_not_bound"
              ? "This device is not a bound kiosk. Ask an admin to bind it."
              : "Wrong PIN.",
        );
      } else setError("Login failed.");
    },
  });

  const logout = useMutation({
    mutationFn: () => apiPost("/auth/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });

  const showClaim =
    staff.data?.employees.length === 0 && whoami.data?.ha != null && whoami.data.employee == null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">🕐 Time Clock</h1>

      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg">
            Signed in: <span className="font-semibold">{session.employee.displayName}</span>{" "}
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase text-slate-400">
              {session.employee.role}
            </span>
          </p>
          <Link
            href="/clock"
            className="rounded-xl bg-sky-500 px-8 py-4 text-lg font-semibold text-slate-950 hover:bg-sky-400"
          >
            Go to clock →
          </Link>
          <button
            onClick={() => logout.mutate()}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
          >
            Sign out
          </button>
        </div>
      ) : selected ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg">
            Hi, <span className="font-semibold">{selected.displayName}</span>
          </p>
          <PinPad
            disabled={login.isPending}
            onSubmit={(pin) => login.mutate({ employeeId: selected.id, pin })}
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button className="text-sm text-slate-500 underline" onClick={() => setSelected(null)}>
            ← back to staff list
          </button>
        </div>
      ) : (
        <div className="flex max-w-md flex-col items-center gap-4">
          {staff.isLoading && <p className="text-slate-500">Loading staff…</p>}
          <div className="grid grid-cols-2 gap-3">
            {staff.data?.employees.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setError(null);
                  setSelected(e);
                }}
                className="rounded-xl bg-slate-800 px-6 py-4 text-lg font-medium hover:bg-slate-700"
              >
                {e.displayName}
              </button>
            ))}
          </div>
          {staff.data?.employees.length === 0 && (
            <p className="text-center text-sm text-slate-500">
              No staff with PINs yet.
              {whoami.data?.employee ? " Set PINs in Admin → Employees." : ""}
            </p>
          )}
          {showClaim && (
            <button
              onClick={() => claim.mutate()}
              className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
            >
              First-time setup: claim admin
            </button>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      )}
    </main>
  );
}
