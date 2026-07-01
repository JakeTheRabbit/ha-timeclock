"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Emp {
  id: string;
  displayName: string;
  role: string;
  active: boolean;
  haUsername: string | null;
  hasPin: boolean;
}

const ROLES = ["employee", "lead", "manager", "admin"] as const;

export default function EmployeesAdminPage() {
  const qc = useQueryClient();
  const { session, isLoading: sessionLoading } = useSession();
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["admin-employees"],
    queryFn: () => apiGet<{ employees: Emp[] }>("/admin/employees"),
    enabled: session?.employee.role === "admin",
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-employees"] });
    qc.invalidateQueries({ queryKey: ["kiosk-employees"] });
  };
  const fail = (e: unknown) =>
    setMsg(e instanceof ApiError ? `Error ${e.status}: ${JSON.stringify(e.body)}` : "Failed");

  const create = useMutation({
    mutationFn: () =>
      apiPost("/admin/employees", { displayName: name, role, pin: pin || undefined }),
    onSuccess: () => {
      setName("");
      setPin("");
      setMsg("Created.");
      refresh();
    },
    onError: fail,
  });

  const setEmployeePin = useMutation({
    mutationFn: (vars: { id: string; pin: string }) =>
      apiPost(`/admin/employees/${vars.id}/pin`, { pin: vars.pin }),
    onSuccess: () => {
      setMsg("PIN updated.");
      refresh();
    },
    onError: fail,
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; data: Partial<Emp> }) =>
      apiPatch(`/admin/employees/${vars.id}`, vars.data),
    onSuccess: refresh,
    onError: fail,
  });

  const bindDevice = useMutation({
    mutationFn: () => apiPost("/admin/devices/bind", { name: `Kiosk ${new Date().toISOString().slice(0, 10)}` }),
    onSuccess: () => setMsg("This device is now a bound kiosk."),
    onError: fail,
  });

  if (sessionLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!session)
    return (
      <Shell>
        <p className="text-slate-400">
          Not signed in. Go to the <Link className="underline" href="/pin">PIN screen</Link> and
          sign in as an admin.
        </p>
      </Shell>
    );
  if (session.employee.role !== "admin")
    return (
      <Shell>
        <p className="text-rose-400">Forbidden — admin role required (you are {session.employee.role}).</p>
      </Shell>
    );

  return (
    <Shell>
      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          PIN (optional)
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            className="w-28 rounded bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!name || create.isPending}
          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
        >
          Add employee
        </button>
        <button
          onClick={() => bindDevice.mutate()}
          className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
          title="Registers THIS browser/tablet as a kiosk device"
        >
          Bind this device as kiosk
        </button>
      </section>

      {msg && <p className="text-sm text-slate-400">{msg}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">HA user</th>
            <th className="py-2 pr-4">PIN</th>
            <th className="py-2 pr-4">Active</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.employees.map((e) => (
            <tr key={e.id} className="border-b border-slate-900">
              <td className="py-2 pr-4">{e.displayName}</td>
              <td className="py-2 pr-4">
                <select
                  value={e.role}
                  onChange={(ev) => patch.mutate({ id: e.id, data: { role: ev.target.value } })}
                  className="rounded bg-slate-800 px-2 py-1"
                >
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-4 font-mono text-xs text-slate-400">{e.haUsername ?? "—"}</td>
              <td className="py-2 pr-4">{e.hasPin ? "set" : "—"}</td>
              <td className="py-2 pr-4">{e.active ? "yes" : "no"}</td>
              <td className="flex gap-2 py-2">
                <button
                  onClick={() => {
                    const p = window.prompt(`New PIN for ${e.displayName} (4-12 digits):`);
                    if (p) setEmployeePin.mutate({ id: e.id, pin: p });
                  }}
                  className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                >
                  set PIN
                </button>
                <button
                  onClick={() => patch.mutate({ id: e.id, data: { active: !e.active } })}
                  className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                >
                  {e.active ? "deactivate" : "activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h1 className="text-xl font-semibold">Admin · Employees</h1>
        {children}
      </div>
    </main>
  );
}
