"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { roleAtLeast } from "@/server/auth/rbac";

interface Whoami {
  ha: { haUserId: string; displayName: string | null } | null;
  employee: { id: string; displayName: string; role: string } | null;
  bootstrapped: boolean;
}

const tile =
  "flex flex-col items-center gap-1 rounded-xl bg-slate-800 px-6 py-5 font-semibold hover:bg-slate-700";

export default function Home() {
  // useSession performs HA SSO server-side: an HA account linked to an
  // employee is signed in the moment this page loads, on any device.
  const { session, isLoading } = useSession();
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<Whoami>("/auth/whoami"),
  });

  const role = session?.employee.role ?? "employee";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-slate-950 p-8 text-slate-100">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-5xl">🕐</span>
        <h1 className="text-2xl font-semibold tracking-tight">Time Clock</h1>
        {session ? (
          <p className="text-sm text-slate-400">
            Hi, <span className="font-medium text-slate-200">{session.employee.displayName}</span>{" "}
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase text-slate-400">
              {session.employee.role}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-400">Employee time clock · immutable audit</p>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-500">Loading…</p>
      ) : session ? (
        <nav className="grid max-w-lg grid-cols-2 gap-3 sm:grid-cols-3">
          <Link href="/clock" className={`${tile} col-span-2 bg-sky-500 text-slate-950 hover:bg-sky-400 sm:col-span-3`}>
            <span className="text-2xl">⏱️</span> Clock in / out
          </Link>
          <Link href="/my-hours" className={tile}>
            <span className="text-2xl">📊</span> My hours
          </Link>
          <Link href="/roster" className={tile}>
            <span className="text-2xl">🗓️</span> Roster
          </Link>
          <Link href="/leave" className={tile}>
            <span className="text-2xl">🌴</span> Leave
          </Link>
          {roleAtLeast(role, "lead") && (
            <Link href="/manager" className={tile}>
              <span className="text-2xl">👥</span> Manager
            </Link>
          )}
          {roleAtLeast(role, "admin") && (
            <>
              <Link href="/admin/employees" className={tile}>
                <span className="text-2xl">🪪</span> Employees
              </Link>
              <Link href="/admin/settings" className={tile}>
                <span className="text-2xl">⚙️</span> Settings
              </Link>
            </>
          )}
        </nav>
      ) : (
        <div className="flex max-w-md flex-col items-center gap-4">
          <Link
            href="/pin"
            className="rounded-xl bg-sky-500 px-8 py-4 text-lg font-semibold text-slate-950 hover:bg-sky-400"
          >
            Kiosk sign-in →
          </Link>
          {whoami.data?.ha && !whoami.data.employee && whoami.data.bootstrapped && (
            <p className="text-center text-sm text-slate-500">
              Your Home Assistant account (
              <span className="font-mono">{whoami.data.ha.displayName ?? whoami.data.ha.haUserId}</span>
              ) isn&apos;t linked to an employee yet — an admin can link it under Admin → Employees,
              then you&apos;ll be signed in automatically.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
