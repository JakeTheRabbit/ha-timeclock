/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * Starts node-cron jobs (auto-clockout, backups, accrual). Disabled in tests
 * and local dev via ENABLE_CRON=0.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_CRON !== "0") {
    const { startScheduler } = await import("@/server/jobs/scheduler");
    startScheduler();
  }
}
