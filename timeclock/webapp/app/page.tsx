import Link from "next/link";
import { APP_TZ } from "@/lib/tz";

// Home shell for the Ingress panel. Operational flows live behind the kiosk,
// manager, and admin routes.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-8 text-slate-100">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-5xl">🕐</span>
        <h1 className="text-2xl font-semibold tracking-tight">Time Clock</h1>
        <p className="text-sm text-slate-400">
          Employee time clock · immutable audit
        </p>
      </div>

      <nav className="flex flex-wrap justify-center gap-3">
        {/* next/link prefixes basePath (the ingress sentinel) automatically. */}
        <Link
          href="/pin"
          className="rounded-lg bg-sky-500 px-5 py-3 font-semibold text-slate-950 hover:bg-sky-400"
        >
          Kiosk sign-in
        </Link>
        <Link
          href="/manager"
          className="rounded-lg bg-slate-800 px-5 py-3 font-semibold hover:bg-slate-700"
        >
          Manager
        </Link>
        <Link
          href="/admin/employees"
          className="rounded-lg bg-slate-800 px-5 py-3 font-semibold hover:bg-slate-700"
        >
          Admin
        </Link>
      </nav>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-1 rounded-lg border border-slate-800 bg-slate-900/60 px-6 py-4 text-sm">
        <dt className="text-slate-400">Timezone</dt>
        <dd className="font-mono text-slate-200">{APP_TZ}</dd>
        <dt className="text-slate-400">API health</dt>
        <dd className="font-mono text-slate-200">
          <Link className="underline decoration-dotted" href="/api/health">
            api/health
          </Link>
        </dd>
      </dl>

      <p className="max-w-md text-center text-xs text-slate-500">
        Feature-complete add-on v0.1.3: kiosk clocking, immutable audit,
        manager approvals, payroll exports, anti-fraud checks, and backups.
      </p>
    </main>
  );
}
